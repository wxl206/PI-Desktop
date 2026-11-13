import type { IterateApiStyle, IterateModel, ModelBinding, ProviderPublic } from "@pi-desktop/shared";
import { AccountError, ITERATE_ORIGIN, object, text } from "./contract";
import type { AccountClient } from "./client";
import type { AccountJournal, JournalStore, KeyRecord } from "./journal";

const endpointStyles: Record<string, IterateApiStyle | undefined> = {
  openai: "chat_completions", "openai-response": "responses", anthropic: "anthropic_messages",
};

function managedProvider(provider: ProviderPublic, style: IterateApiStyle): boolean {
  return provider.vendorKey === "iterate"
    && provider.baseUrl === `${ITERATE_ORIGIN}/v1`
    && provider.apiStyle === style
    && !provider.ownerPluginId;
}

export async function discoverModels(client: AccountClient, key: string): Promise<IterateModel[]> {
  const visible = object(await client.request("/v1/models", undefined, { key }));
  if (!Array.isArray(visible.data)) throw new AccountError("INVALID_RESPONSE");
  const pricing = await client.request("/api/pricing", undefined, { anonymous: true });
  if (!Array.isArray(pricing)) throw new AccountError("INVALID_RESPONSE");
  const catalog = new Map(pricing.map((raw) => { const entry = object(raw); return [entry.model_name, entry]; }));
  return [...new Set(visible.data.map((raw) => text(object(raw).id)))].sort().map((id) => {
    const endpoints = catalog.get(id)?.supported_endpoint_types;
    const styles = Array.isArray(endpoints) ? [...new Set(endpoints.flatMap((entry: unknown) => {
      const style = typeof entry === "string" ? endpointStyles[entry] : undefined;
      return style ? [style] : [];
    }))] : [];
    return { id, styles };
  });
}

/** Append models to a protocol-specific row; never rewrite another group's row. */
export async function connectModel(store: JournalStore, journal: AccountJournal, record: KeyRecord, key: string, model: IterateModel): Promise<string> {
  const style = (["anthropic_messages", "responses", "chat_completions"] as const).find((candidate) => model.styles.includes(candidate));
  if (!style) throw new AccountError("MODEL_INVALID");
  const host = store.host();
  const { providers } = await host.call<{ providers: ProviderPublic[] }>("providers.list", { includeDisabled: true });
  const name = `Iterate / ${record.group.slice(0, 32)} / ${style} [${record.name}]`;
  const savedIndex = record.providers.findIndex((entry) => entry.style === style);
  let saved = savedIndex >= 0 ? record.providers[savedIndex] : undefined;
  let linked = saved ? providers.find((entry) => entry.id === saved!.id) : undefined;
  if (saved && (!linked || !managedProvider(linked, style))) {
    // The row may have been deleted or reassigned by the user. Drop only this
    // stale binding and create a fresh managed row; the API key is unchanged.
    record.providers.splice(savedIndex, 1);
    saved = undefined;
    linked = undefined;
    await store.save(journal);
  }
  const candidates = providers.filter((entry) => entry.name === name && entry.vendorKey === "iterate"
    && managedProvider(entry, style));
  if (!saved && candidates.length > 1) throw new AccountError("KEY_CHANGED");
  const provider = linked ?? candidates[0];
  const binding: ModelBinding = { id: model.id, contextWindow: 32768, maxTokens: 4096,
    thinkingLevels: [], defaultThinkingLevel: null };
  // Limits are conservative local defaults, not claims about the model's published capabilities.
  const models = provider?.models.some((entry) => entry.id === model.id) ? provider.models : [...(provider?.models ?? []), binding];
  let id: string;
  if (provider) {
    await host.call("providers.update", {
      id: provider.id, name, vendorKey: "iterate", type: "openai_compatible",
      protocol: "openai_compatible", baseUrl: `${ITERATE_ORIGIN}/v1`, authKind: "api_key",
      apiStyle: style, enabled: true, models, secretValue: key,
    });
    id = provider.id;
  } else {
    const result = await host.call<{ provider: ProviderPublic }>("providers.create", {
      name, vendorKey: "iterate", type: "openai_compatible", protocol: "openai_compatible", authKind: "api_key",
      baseUrl: `${ITERATE_ORIGIN}/v1`, apiStyle: style, models, secretValue: key,
    });
    id = result.provider.id;
  }
  if (!saved) { record.providers.push({ id, style }); await store.save(journal); }
  return id;
}

/** Re-point every provider owned by this account record at a freshly revealed key. */
export async function rebindKeyToProviders(
  store: JournalStore,
  journal: AccountJournal,
  record: KeyRecord,
  key: string,
): Promise<void> {
  const host = store.host();
  const { providers } = await host.call<{ providers: ProviderPublic[] }>("providers.list", { includeDisabled: true });
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const retained: KeyRecord["providers"] = [];
  for (const binding of record.providers) {
    const provider = byId.get(binding.id);
    if (!provider || !managedProvider(provider, binding.style)) continue;
    await host.call("providers.update", {
      id: provider.id,
      name: `Iterate / ${record.group.slice(0, 32)} / ${binding.style} [${record.name}]`,
      vendorKey: "iterate",
      type: "openai_compatible",
      protocol: "openai_compatible",
      baseUrl: `${ITERATE_ORIGIN}/v1`,
      authKind: "api_key",
      apiStyle: binding.style,
      enabled: true,
      secretValue: key,
    });
    retained.push(binding);
  }
  record.providers = retained;
  record.rotationPending = false;
  await store.save(journal);
}
