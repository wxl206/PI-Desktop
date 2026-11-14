import type { IterateGroup, IterateOverview, IterateUsageSummary, ProviderPublic } from "@pi-desktop/shared";
import { AccountClient } from "./client";
import { AccountError, ITERATE_ORIGIN, object, text } from "./contract";
import { AccountKeys } from "./keys";
import { connectModel, discoverModels, rebindKeyToProviders } from "./models";
import { aggregateLogs, averageMessageQuota, remainingMessages, type IterateLogItem } from "./usage";
import type { AccountJournal, JournalStore } from "./journal";

/** Caches keep the overview cheap enough for a five-minute balance poll. */
const USAGE_TTL_MS = 5 * 60 * 1000;
const STATUS_TTL_MS = 10 * 60 * 1000;
const USAGE_DAYS = 7;
const USAGE_PAGE_SIZE = 100;
const USAGE_MAX_PAGES = 10;

type UsageCache = { at: number; summary: IterateUsageSummary; average: number | null; count: number };

export function balanceFor(quota: number, status: Record<string, unknown>) {
  const perUnit = status.quota_per_unit;
  if (typeof perUnit !== "number" || !Number.isFinite(perUnit) || perUnit <= 0) return { amount: quota, unit: "quota" };
  const usd = quota / perUnit;
  if (status.quota_display_type === "USD") return { amount: usd, unit: "USD" };
  if (status.quota_display_type === "CNY" && typeof status.usd_exchange_rate === "number" && status.usd_exchange_rate > 0) return { amount: usd * status.usd_exchange_rate, unit: "CNY" };
  if (status.quota_display_type === "CUSTOM" && typeof status.custom_currency_exchange_rate === "number" && status.custom_currency_exchange_rate > 0
    && typeof status.custom_currency_symbol === "string") return { amount: usd * status.custom_currency_exchange_rate, unit: text(status.custom_currency_symbol, 20) };
  return { amount: quota, unit: "quota" };
}

export class AccountService {
  private busy = false;
  private readonly keys: AccountKeys;
  private usageCache: UsageCache | null = null;
  private statusCache: { at: number; value: Record<string, unknown> } | null = null;
  constructor(
    readonly client: AccountClient,
    private readonly store: JournalStore,
    private readonly hasRunningTurns: () => boolean = () => false,
    private readonly acquireAdmission: () => Promise<() => void> = async () => () => {},
  ) { this.keys = new AccountKeys(client, store); }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new AccountError("BUSY");
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }

  async recover() {
    const journal = await this.store.read();
    if (!this.client.id && journal.activeUser) {
      try { await this.client.refresh(journal.activeUser); }
      catch (error) { if (!(error instanceof AccountError) || !["LOGIN_REQUIRED", "REJECTED"].includes(error.code)) throw error; }
    }
    if (this.client.id && journal.activeUser === this.client.id) {
      // Reconciliation mutates the same Provider rows as an account switch. Do
      // not race a running turn, and re-read the journal after admission so a
      // concurrent completed operation cannot be overwritten by this snapshot.
      try {
        await this.withAccountChange(async () => {
          const latest = await this.store.read();
          const user = this.client.id;
          if (user && latest.activeUser === user) {
            await this.syncManagedProviders(latest, user);
          }
        });
      } catch (error) {
        // Overview is read-only. A turn that starts while recovery waits for
        // admission leaves provider reconciliation for the next idle overview.
        if (!(error instanceof AccountError) || error.code !== "TASKS_RUNNING") throw error;
      }
    }
  }

  async signedIn(): Promise<void> {
    this.usageCache = null;
    this.statusCache = null;
    await this.withAccountChange(async () => {
      const journal = await this.store.read();
      const nextUser = this.client.id;
      if (!nextUser) throw new AccountError("LOGIN_REQUIRED");
      if (journal.activeUser !== null && journal.activeUser !== nextUser) {
        // Persist the safe intermediate state before exposing the new account.
        await this.syncManagedProviders(journal, null);
      }
      journal.activeUser = nextUser;
      await this.store.save(journal);
      await this.syncManagedProviders(journal, nextUser);
    });
  }

  private async groups(): Promise<IterateGroup[]> {
    const groups = object(await this.client.request("/api/user/self/groups"));
    return Object.entries(groups).map(([id, raw]) => {
      const entry = object(raw);
      return { id: text(id), description: typeof entry.desc === "string" ? text(entry.desc, 1000) : id,
        ratio: typeof entry.ratio === "number" && Number.isFinite(entry.ratio) ? entry.ratio : null };
    });
  }

  async overview(): Promise<IterateOverview> {
    const empty: IterateOverview = { user: null, groups: [], balance: null, estimate: null, redemptionEnabled: false,
      redemptionUncertain: false, dedicatedKeyGroups: [], updatedAt: new Date().toISOString() };
    await this.recover();
    if (!this.client.id) return empty;
    try { await this.client.authenticated(); }
    catch (error) { if (error instanceof AccountError && ["LOGIN_REQUIRED", "REJECTED"].includes(error.code)) return empty; throw error; }
    const journal = await this.store.read();
    const user = await this.client.identity();
    const groups = await this.groups();
    const status = await this.gatewayStatus();
    const info = object(await this.client.request("/api/user/topup/info"));
    // A usage fetch that fails must not fail the balance overview: the
    // estimate is a nicety, the balance is the answer the page came for.
    let estimate: IterateOverview["estimate"] = null;
    try {
      const usage = await this.usageData();
      const remaining = remainingMessages(user.quota, usage.average);
      estimate = usage.average === null ? null
        : { averageQuota: usage.average, count: usage.count, remainingMessages: remaining };
    } catch { estimate = null; }
    return { ...empty, user, groups, balance: balanceFor(user.quota, status), estimate,
      redemptionEnabled: info.enable_redemption === true,
      redemptionUncertain: journal.redemptionUsers.includes(user.id),
      dedicatedKeyGroups: journal.records.filter((entry) => entry.user === user.id && entry.state === "created")
        .map((entry) => entry.group) };
  }

  private async gatewayStatus(): Promise<Record<string, unknown>> {
    if (this.statusCache && Date.now() - this.statusCache.at < STATUS_TTL_MS) return this.statusCache.value;
    const value = object(await this.client.request("/api/status", undefined, { anonymous: true }));
    this.statusCache = { at: Date.now(), value };
    return value;
  }

  /**
   * Consume logs for the usage window, paged and cached. The average is kept
   * alongside the summary so the overview can reuse one fetch for both.
   */
  private async usageData(force = false): Promise<UsageCache> {
    if (!force && this.usageCache && Date.now() - this.usageCache.at < USAGE_TTL_MS) return this.usageCache;
    const endSeconds = Math.floor(Date.now() / 1000);
    const startSeconds = endSeconds - USAGE_DAYS * 24 * 60 * 60;
    let items: IterateLogItem[] = [];
    let total: number | null = null;
    for (let page = 1; page <= USAGE_MAX_PAGES; page += 1) {
      const result = await this.client.logs(startSeconds, endSeconds, page, USAGE_PAGE_SIZE);
      items = items.concat(result.items);
      total = result.total;
      if (result.items.length < USAGE_PAGE_SIZE || (total !== null && items.length >= total)) break;
    }
    const summary = aggregateLogs(items, { days: USAGE_DAYS, nowMs: Date.now() });
    const entry: UsageCache = { at: Date.now(), summary, average: averageMessageQuota(items), count: items.length };
    this.usageCache = entry;
    return entry;
  }

  /** Renderer-facing usage summary; refresh bypasses the cache explicitly. */
  async usageSummary(force = false): Promise<IterateUsageSummary> {
    await this.client.authenticated();
    return (await this.usageData(force)).summary;
  }

  private async accountGroup(group: unknown) {
    const id = text(group);
    await this.client.authenticated();
    if (!(await this.groups()).some((entry) => entry.id === id)) throw new AccountError("GROUP_INVALID");
    const journal = await this.store.read();
    if (journal.activeUser !== this.client.id) throw new AccountError("LOGIN_REQUIRED");
    return { id, journal };
  }

  private async keyFor(group: unknown) {
    const { id, journal } = await this.accountGroup(group);
    return { journal, ...await this.keys.ensure(journal, id) };
  }

  async discover(group: unknown) {
    const { key } = await this.keyFor(group);
    return { models: await discoverModels(this.client, key) };
  }

  async connect(group: unknown, modelId: unknown) {
    return this.withAccountChange(async () => {
      const id = text(modelId);
      const { journal, record, key } = await this.keyFor(group);
      const model = (await discoverModels(this.client, key)).find((entry) => entry.id === id);
      if (!model) throw new AccountError("MODEL_INVALID");
      const providerId = await connectModel(this.store, journal, record, key, model);
      return { providerId, modelId: model.id };
    });
  }

  async rebuildKey(group: unknown) {
    return this.withAccountChange(async () => {
      const { id, journal } = await this.accountGroup(group);
      const { record, key } = await this.keys.rotate(journal, id);
      // Verify the replacement key before changing any live provider. A failed
      // discovery therefore leaves the durable rotation marker available for a
      // safe retry with this same key.
      const models = await discoverModels(this.client, key);
      await rebindKeyToProviders(this.store, journal, record, key);
      return { rebuilt: true as const, models };
    });
  }

  async copyKey(group: unknown, write: (value: string) => void) {
    // Copy never creates a new key as a side effect.
    const journal = await this.store.read();
    if (!journal.records.some((entry) => entry.user === this.client.id && entry.group === group && entry.state === "created")) throw new AccountError("KEY_CHANGED");
    const { key } = await this.keyFor(group); write(key);
    return { copied: true };
  }

  async redeem(code: unknown) {
    const key = text(code, 200).trim();
    await this.client.authenticated();
    const user = this.client.id;
    if (!user) throw new AccountError("LOGIN_REQUIRED");
    const journal = await this.store.read();
    if (journal.activeUser !== user) throw new AccountError("LOGIN_REQUIRED");
    const info = object(await this.client.request("/api/user/topup/info"));
    if (info.enable_redemption !== true) throw new AccountError("REDEMPTION_DISABLED");
    if (journal.redemptionUsers.includes(user)) throw new AccountError("REDEMPTION_UNCERTAIN");
    journal.redemptionUsers = [...journal.redemptionUsers, user].sort((a, b) => a - b);
    await this.store.save(journal);
    try { await this.client.request("/api/user/topup", { key }); }
    catch (error) {
      if (!(error instanceof AccountError) || error.code !== "REJECTED") throw new AccountError("REDEMPTION_UNCERTAIN");
      journal.redemptionUsers = journal.redemptionUsers.filter((entry) => entry !== user);
      await this.store.save(journal); throw error;
    }
    journal.redemptionUsers = journal.redemptionUsers.filter((entry) => entry !== user);
    await this.store.save(journal);
    // A failed follow-up balance query must not turn a confirmed redemption into failure.
    return { redeemed: true };
  }

  async acknowledgeRedemption() {
    await this.client.authenticated();
    const user = this.client.id;
    if (!user) throw new AccountError("LOGIN_REQUIRED");
    const journal = await this.store.read();
    if (!journal.redemptionUsers.includes(user)) throw new AccountError("REJECTED");
    journal.redemptionUsers = journal.redemptionUsers.filter((entry) => entry !== user);
    await this.store.save(journal);
    return { acknowledged: true };
  }

  private assertIdle() {
    if (this.hasRunningTurns()) throw new AccountError("TASKS_RUNNING");
  }

  private async withAccountChange<T>(operation: () => Promise<T>): Promise<T> {
    this.assertIdle();
    const release = await this.acquireAdmission();
    try {
      // A prompt may have been admitted while this operation waited for the
      // gate. Recheck after acquiring so provider mutation never overlaps it.
      this.assertIdle();
      return await operation();
    } finally {
      release();
    }
  }

  /**
   * Enable exactly the managed provider rows owned by the selected account and
   * disable every other journal-owned row. Provider identity is checked before
   * any mutation so a damaged journal cannot disable an unrelated provider.
   */
  private async syncManagedProviders(journal: AccountJournal, activeUser: number | null) {
    const host = this.store.host();
    const { providers } = await host.call<{ providers: ProviderPublic[] }>("providers.list", { includeDisabled: true });
    const byId = new Map(providers.map((provider) => [provider.id, provider]));
    const desired = new Map<string, { enabled: boolean; style: string }>();
    let changed = false;
    for (const record of journal.records) {
      const retained = record.providers.filter((binding) => {
        const provider = byId.get(binding.id);
        const managed = provider?.vendorKey === "iterate"
          && provider.baseUrl === `${ITERATE_ORIGIN}/v1`
          && provider.apiStyle === binding.style
          && !provider.ownerPluginId;
        if (!managed) { changed = true; return false; }
        desired.set(provider.id, { enabled: record.user === activeUser, style: binding.style });
        return true;
      });
      if (retained.length !== record.providers.length) record.providers = retained;
    }
    for (const [id, binding] of desired) {
      const provider = byId.get(id)!;
      const needsUpdate = provider.enabled !== binding.enabled
        || (binding.enabled && (provider.protocol !== "openai_compatible"
          || provider.vendorKey !== "iterate" || provider.type !== "openai_compatible"
          || provider.authKind !== "api_key" || provider.baseUrl !== `${ITERATE_ORIGIN}/v1`));
      if (!needsUpdate) continue;
      await host.call("providers.update", {
        id,
        enabled: binding.enabled,
        ...(binding.enabled ? {
          vendorKey: "iterate",
          type: "openai_compatible",
          protocol: "openai_compatible",
          authKind: "api_key",
          baseUrl: `${ITERATE_ORIGIN}/v1`,
          apiStyle: binding.style,
        } : {}),
      });
    }
    if (changed) await this.store.save(journal);
  }

  async logout(clearSession: () => Promise<void>) {
    return this.withAccountChange(async () => {
      this.usageCache = null;
      this.statusCache = null;
      const journal = await this.store.read();
      // Disable every local connection first. A crash before the journal write
      // restores the old signed-in state and re-enables its providers on recovery.
      await this.syncManagedProviders(journal, null);
      journal.activeUser = null;
      await this.store.save(journal);
      try {
        if (this.client.id) await this.client.request("/api/user/auth/logout", {}).catch(() => undefined);
      } finally { this.client.clear(); await clearSession(); }
      return { loggedOut: true };
    });
  }
}
