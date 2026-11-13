import type { IterateFailure } from "@pi-desktop/shared";

export const ITERATE_ORIGIN = "https://api.wxl206.xyz";
export const ITERATE_SHOP = "https://catfk.com/shop/CMCP45XV?theme=dark&lang=zh&ui_mode=embedded&src_host=https://api.wxl206.xyz";

/** Only stable, local codes cross IPC; remote errors may contain credentials. */
export class AccountError extends Error {
  readonly errorCode: IterateFailure;
  constructor(readonly code: IterateFailure) { super(code); this.errorCode = code; }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccountError("INVALID_RESPONSE");
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new AccountError("INVALID_RESPONSE");
  return value;
}
export function positiveId(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new AccountError("INVALID_RESPONSE");
  return value;
}
export function secret(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._~-]{16,8192}$/.test(value)) throw new AccountError("INVALID_RESPONSE");
  return value;
}
