import type { IterateUsageDay, IterateUsageModel, IterateUsageSummary } from "@pi-desktop/shared";

/** A normalized consume-log row; only what the summary needs survives. */
export type IterateLogItem = { at: number; model: string; quota: number };

/** An average from fewer than this many recent calls is not an estimate. */
export const ESTIMATE_MIN_SAMPLES = 3;

/**
 * Consume-log pages arrive either as `{ items, total }` (current New API) or a
 * bare array (older builds). Anything malformed degrades to an empty page so a
 * summary can still be drawn from the pages that parsed.
 */
export function parseLogPage(payload: unknown): { items: IterateLogItem[]; total: number | null } {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : [];
  const total = payload && typeof payload === "object" && typeof (payload as { total?: unknown }).total === "number"
    ? (payload as { total: number }).total
    : null;
  const items: IterateLogItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    if (entry.type !== 2) continue;
    const at = typeof entry.created_at === "number" && Number.isFinite(entry.created_at)
      ? entry.created_at * 1000
      : null;
    const quota = typeof entry.quota === "number" && Number.isFinite(entry.quota) ? entry.quota : null;
    if (at === null || quota === null || quota < 0) continue;
    const model = typeof entry.model_name === "string" && entry.model_name.trim() ? entry.model_name.trim() : "unknown";
    items.push({ at, model, quota });
  }
  return { items, total };
}

/** Local-midnight day key, so "last 7 days" matches what the user calls days. */
export function dayKey(atMs: number): string {
  const date = new Date(atMs);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Summarize consume logs into `days` fixed local-day slots (oldest first) and
 * the top models by spend. Rows outside the window are ignored, so a wide
 * fetch still renders exactly the requested range.
 */
export function aggregateLogs(
  items: readonly IterateLogItem[],
  options: { days: number; nowMs: number },
): IterateUsageSummary {
  const { days, nowMs } = options;
  const windowStart = new Date(nowMs);
  windowStart.setHours(0, 0, 0, 0);
  windowStart.setDate(windowStart.getDate() - (days - 1));
  const buckets = new Map<string, IterateUsageDay>();
  for (let index = 0; index < days; index += 1) {
    const at = windowStart.getTime() + index * 24 * 60 * 60 * 1000;
    const key = dayKey(at);
    buckets.set(key, { date: key, quota: 0, count: 0 });
  }
  const models = new Map<string, IterateUsageModel>();
  let totalQuota = 0;
  let count = 0;
  for (const item of items) {
    if (item.at < windowStart.getTime() || item.at > nowMs) continue;
    const bucket = buckets.get(dayKey(item.at));
    if (!bucket) continue;
    bucket.quota += item.quota;
    bucket.count += 1;
    const model = models.get(item.model) ?? { model: item.model, quota: 0, count: 0 };
    model.quota += item.quota;
    model.count += 1;
    models.set(item.model, model);
    totalQuota += item.quota;
    count += 1;
  }
  return {
    days: [...buckets.values()],
    models: [...models.values()].sort((a, b) => b.quota - a.quota || b.count - a.count).slice(0, 8),
    totalQuota,
    count,
  };
}

/**
 * The average spend per call across the given logs, or null when the sample
 * is too thin to be an honest estimate (a single expensive call would lie).
 */
export function averageMessageQuota(
  items: readonly IterateLogItem[],
  minSamples = ESTIMATE_MIN_SAMPLES,
): number | null {
  if (items.length < minSamples) return null;
  let total = 0;
  for (const item of items) total += item.quota;
  const average = total / items.length;
  return average > 0 ? average : null;
}

/** Whole messages of runway; zero balance is zero runway, not an error. */
export function remainingMessages(balanceQuota: number, averageQuota: number | null): number | null {
  if (averageQuota === null || !Number.isFinite(averageQuota) || averageQuota <= 0) return null;
  if (!Number.isFinite(balanceQuota) || balanceQuota <= 0) return 0;
  return Math.floor(balanceQuota / averageQuota);
}
