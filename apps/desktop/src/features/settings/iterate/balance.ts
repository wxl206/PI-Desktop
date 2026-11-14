import { useEffect, useSyncExternalStore } from "react";
import type { IterateOverview } from "@pi-desktop/shared";
import { api } from "../../../lib/api";

/**
 * A tiny external store for the account-balance picture shared by the
 * in-chat low-balance reminder, the welcome guide and the account page.
 * It deliberately stays out of the app store: one feature's polling result
 * has no business re-rendering the whole application tree.
 */
export type IterateBalanceState = {
  checkedAt: number;
  signedIn: boolean;
  balance: { amount: number; unit: string } | null;
  remainingMessages: number | null;
};

let state: IterateBalanceState = { checkedAt: 0, signedIn: false, balance: null, remainingMessages: null };
const listeners = new Set<() => void>();

export function getIterateBalance(): IterateBalanceState {
  return state;
}

function setIterateBalance(next: IterateBalanceState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribeIterateBalance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIterateBalance(): IterateBalanceState {
  // The third argument keeps server-rendered surfaces (tests, future SSR)
  // honest: they render the same initial picture instead of crashing.
  return useSyncExternalStore(subscribeIterateBalance, getIterateBalance, getIterateBalance);
}

/** Project an overview reply into the shared balance picture. */
export function applyOverviewToBalance(overview: IterateOverview) {
  setIterateBalance({
    checkedAt: Date.now(),
    signedIn: overview.user !== null,
    balance: overview.balance,
    remainingMessages: overview.estimate?.remainingMessages ?? null,
  });
}

/** Fetch once now and then on an interval while the caller is mounted. */
export function useIterateBalancePolling(intervalMs = 5 * 60 * 1000) {
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const overview = await api.iterateOverview();
        if (alive) applyOverviewToBalance(overview);
      } catch {
        // The reminder is best-effort: a network miss just waits for the next tick.
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => { alive = false; window.clearInterval(timer); };
  }, [intervalMs]);
}
