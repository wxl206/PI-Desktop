/** First-party gateway account IPC. Website tokens and model keys never appear here. */
export type IterateApiStyle = "chat_completions" | "responses" | "anthropic_messages";
export type IterateGroup = { id: string; description: string; ratio: number | null };
export type IterateModel = { id: string; styles: IterateApiStyle[] };
export type IterateOverview = {
  user: { id: number; name: string; quota: number } | null;
  groups: IterateGroup[];
  balance: { amount: number; unit: string } | null;
  redemptionEnabled: boolean;
  redemptionUncertain: boolean;
  updatedAt: string;
};

export type IterateFailure =
  | "BUSY" | "LOGIN_REQUIRED" | "CANCELLED" | "NETWORK" | "INVALID_RESPONSE"
  | "REJECTED" | "STORAGE" | "KEY_UNCERTAIN" | "KEY_CHANGED" | "GROUP_INVALID"
  | "MODEL_INVALID" | "REDEMPTION_UNCERTAIN" | "REDEMPTION_DISABLED"
  | "TASKS_RUNNING" | "DEBUG_ACTIVE" | "PAYMENT_DOMAIN";
export type IterateReply<T> = { ok: true; value: T } | { ok: false; code: IterateFailure };
