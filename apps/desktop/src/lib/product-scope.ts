/**
 * Product scope for this fork's model access.
 *
 * The desktop ships the Iterate gateway as the first-party account flow and
 * DeepSeek as the only direct preset. Every surface that offers a new model
 * connection reads these flags, so the add-service chooser, vendor sign-in,
 * classifier card and configuration import present one consistent catalog
 * instead of four independently maintained lists. Existing connections the
 * user already configured keep working and stay editable; only new entry
 * points are scoped.
 */
export const PRODUCT_SCOPE = {
  /** Named endpoint presets offered when adding a service. */
  presetAllowlist: ["deepseek"],
  /** Subscription (OAuth) sign-in tiles and their login dialogs. */
  oauthEnabled: false,
  /** Arbitrary base URL entry for new rows. */
  customEndpointEnabled: false,
  /** TypeSafe Jev classifier card and setup entry. */
  jevEnabled: false,
  /** Importing provider rows from another tool's configuration. */
  providerImportEnabled: false,
} as const;

export const isProductPresetAllowed = (presetId: string): boolean =>
  (PRODUCT_SCOPE.presetAllowlist as readonly string[]).includes(presetId);
