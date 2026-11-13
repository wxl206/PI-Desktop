import type { AppSettings, ProviderPublic } from "@pi-desktop/shared";
import { keepsAppDefaultModel } from "../../../components/settings/default-model";
import { api } from "../../../lib/api";
import { useAppStore } from "../../../stores/app-store";

export type IterateConnection = {
  providerId: string;
  modelId: string;
};

/**
 * A first-time connection claims the app default. An existing runnable
 * default stays put, so adding another Iterate group does not change the
 * model chosen for new chats.
 */
export function iterateDefaultPatch(
  settings: AppSettings,
  providers: readonly ProviderPublic[],
  connection: IterateConnection,
): Partial<AppSettings> | null {
  if (keepsAppDefaultModel(
    providers,
    settings.defaultProviderId,
    settings.defaultModelId,
    settings.imageGenerationModels,
  )) {
    return null;
  }
  return {
    defaultProviderId: connection.providerId,
    defaultModelId: connection.modelId,
  };
}

/** Refresh the provider row, then persist the selected model when it is needed. */
export async function activateIterateConnection(
  connection: IterateConnection,
): Promise<void> {
  await useAppStore.getState().refreshProviders();
  const state = useAppStore.getState();
  if (!state.settings) return;
  const patch = iterateDefaultPatch(state.settings, state.providers, connection);
  if (!patch) return;
  const settings = { ...state.settings, ...patch };
  await api.setSettings(settings);
  useAppStore.setState({ settings });
}
