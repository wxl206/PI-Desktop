import type { IterateGroup, IterateOverview } from "@pi-desktop/shared";
import { AccountClient } from "./client";
import { AccountError, object, text } from "./contract";
import { AccountKeys } from "./keys";
import { connectModel, discoverModels } from "./models";
import type { AccountJournal, JournalStore } from "./journal";

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
  constructor(readonly client: AccountClient, private readonly store: JournalStore) { this.keys = new AccountKeys(client, store); }

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
  }

  async signedIn(): Promise<void> {
    const journal = await this.store.read();
    if (journal.activeUser !== null && journal.activeUser !== this.client.id) throw new AccountError("LOGIN_REQUIRED");
    journal.activeUser = this.client.id;
    await this.restoreProviders(journal, true);
    await this.store.save(journal);
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
    const journal = await this.store.read();
    const empty: IterateOverview = { user: null, groups: [], balance: null, redemptionEnabled: false,
      redemptionUncertain: false, updatedAt: new Date().toISOString() };
    await this.recover();
    if (!this.client.id) return empty;
    try { await this.client.authenticated(); }
    catch (error) { if (error instanceof AccountError && ["LOGIN_REQUIRED", "REJECTED"].includes(error.code)) return empty; throw error; }
    const user = await this.client.identity();
    const groups = await this.groups();
    const status = object(await this.client.request("/api/status", undefined, { anonymous: true }));
    const info = object(await this.client.request("/api/user/topup/info"));
    return { ...empty, user, groups, balance: balanceFor(user.quota, status), redemptionEnabled: info.enable_redemption === true,
      redemptionUncertain: journal.redemptionUser === user.id };
  }

  private async keyFor(group: unknown) {
    const id = text(group);
    await this.client.authenticated();
    if (!(await this.groups()).some((entry) => entry.id === id)) throw new AccountError("GROUP_INVALID");
    const journal = await this.store.read();
    if (journal.activeUser !== this.client.id) throw new AccountError("LOGIN_REQUIRED");
    return { journal, ...await this.keys.ensure(journal, id) };
  }

  async discover(group: unknown) {
    const { key } = await this.keyFor(group);
    return { models: await discoverModels(this.client, key) };
  }

  async connect(group: unknown, modelId: unknown) {
    const id = text(modelId);
    const { journal, record, key } = await this.keyFor(group);
    const model = (await discoverModels(this.client, key)).find((entry) => entry.id === id);
    if (!model) throw new AccountError("MODEL_INVALID");
    const providerId = await connectModel(this.store, journal, record, key, model);
    return { providerId, modelId: model.id };
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
    const info = object(await this.client.request("/api/user/topup/info"));
    if (info.enable_redemption !== true) throw new AccountError("REDEMPTION_DISABLED");
    const journal = await this.store.read();
    if (journal.redemptionUser !== null) throw new AccountError("REDEMPTION_UNCERTAIN");
    journal.redemptionUser = this.client.id;
    await this.store.save(journal);
    try { await this.client.request("/api/user/topup", { key }); }
    catch (error) {
      if (!(error instanceof AccountError) || error.code !== "REJECTED") throw new AccountError("REDEMPTION_UNCERTAIN");
      journal.redemptionUser = null; await this.store.save(journal); throw error;
    }
    journal.redemptionUser = null; await this.store.save(journal);
    // A failed follow-up balance query must not turn a confirmed redemption into failure.
    return { redeemed: true };
  }

  async acknowledgeRedemption() {
    await this.client.authenticated();
    const journal = await this.store.read();
    if (journal.redemptionUser !== this.client.id) throw new AccountError("REJECTED");
    journal.redemptionUser = null; await this.store.save(journal);
    return { acknowledged: true };
  }

  private async restoreProviders(journal: AccountJournal, enabled: boolean) {
    const host = this.store.host();
    for (const record of journal.records.filter((entry) => entry.user === journal.activeUser)) {
      for (const entry of record.providers) await host.call("providers.update", { id: entry.id, enabled });
    }
  }

  async logout(clearSession: () => Promise<void>) {
    const journal = await this.store.read();
    // Durable logout intent before disabling connections; restart cannot restore cookies.
    const user = journal.activeUser; journal.activeUser = null;
    await this.store.save(journal);
    try {
      await this.restoreProviders({ ...journal, activeUser: user }, false);
      if (this.client.id) await this.client.request("/api/user/auth/logout", {});
    } finally { this.client.clear(); await clearSession(); }
    return { loggedOut: true };
  }
}
