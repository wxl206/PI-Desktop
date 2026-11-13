/** Stable IPC failure codes the account page can localize. */
const failureKeys = new Set([
  "BUSY", "LOGIN_REQUIRED", "CANCELLED", "NETWORK", "INVALID_RESPONSE",
  "REJECTED", "STORAGE", "KEY_UNCERTAIN", "KEY_CHANGED", "GROUP_INVALID",
  "MODEL_INVALID", "REDEMPTION_UNCERTAIN", "REDEMPTION_DISABLED",
  "DEBUG_ACTIVE", "PAYMENT_DOMAIN",
]);

/**
 * The IPC envelope carries the code as `error.code`; older details-based
 * callers may still provide `details.errorCode`. Read both before falling back.
 */
export function failureKey(error: unknown): string {
  const details = (error as { details?: { errorCode?: unknown } })?.details;
  const code = (error as { code?: unknown })?.code;
  const value = typeof details?.errorCode === "string" ? details.errorCode : code;
  return typeof value === "string" && failureKeys.has(value) ? value : "REJECTED";
}
