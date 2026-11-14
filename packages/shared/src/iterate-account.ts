/** First-party gateway account IPC. Website tokens and model keys never appear here. */
export type IterateApiStyle = "chat_completions" | "responses" | "anthropic_messages";
export type IterateGroup = { id: string; description: string; ratio: number | null };
export type IterateModel = { id: string; styles: IterateApiStyle[] };
export type IterateOverview = {
  user: { id: number; name: string; quota: number } | null;
  groups: IterateGroup[];
  balance: { amount: number; unit: string } | null;
  estimate: { averageQuota: number; count: number; remainingMessages: number | null } | null;
  redemptionEnabled: boolean;
  redemptionUncertain: boolean;
  dedicatedKeyGroups: string[];
  updatedAt: string;
};

export type IterateUsageDay = { date: string; quota: number; count: number };
export type IterateUsageModel = { model: string; quota: number; count: number };
export type IterateUsageSummary = {
  days: IterateUsageDay[];
  models: IterateUsageModel[];
  totalQuota: number;
  count: number;
};

/** Messages of runway at which the in-chat low-balance reminder appears. */
export const ITERATE_LOW_BALANCE_MESSAGES = 5;
/** Balance shown as "running low" when no per-message estimate exists yet. */
export const ITERATE_LOW_BALANCE_ABSOLUTE = 1;

export type IterateLowBalanceWarning =
  | { kind: "messages"; remaining: number }
  | { kind: "raw"; amount: number; unit: string };

/**
 * Decide whether the in-chat reminder should show. An estimate wins when it
 * exists; otherwise a small absolute balance still deserves a nudge, because
 * a user with no usage history cannot be told "messages" honestly.
 */
export function iterateLowBalanceWarning(input: {
  signedIn: boolean;
  remaining: number | null;
  balance: { amount: number; unit: string } | null;
}): IterateLowBalanceWarning | null {
  const { signedIn, remaining, balance } = input;
  if (!signedIn) return null;
  if (remaining !== null) {
    return remaining <= ITERATE_LOW_BALANCE_MESSAGES ? { kind: "messages", remaining } : null;
  }
  if (balance && Number.isFinite(balance.amount) && balance.amount <= ITERATE_LOW_BALANCE_ABSOLUTE) {
    return { kind: "raw", amount: balance.amount, unit: balance.unit };
  }
  return null;
}

export type IterateFailure =
  | "BUSY" | "LOGIN_REQUIRED" | "CANCELLED" | "NETWORK" | "INVALID_RESPONSE"
  | "REJECTED" | "STORAGE" | "KEY_UNCERTAIN" | "KEY_CHANGED" | "GROUP_INVALID"
  | "MODEL_INVALID" | "REDEMPTION_UNCERTAIN" | "REDEMPTION_DISABLED"
  | "TASKS_RUNNING" | "DEBUG_ACTIVE" | "PAYMENT_DOMAIN";
export type IterateReply<T> = { ok: true; value: T } | { ok: false; code: IterateFailure };
