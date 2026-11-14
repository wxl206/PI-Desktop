import { describe, expect, it } from "vitest";
import { ITERATE_LOW_BALANCE_ABSOLUTE, ITERATE_LOW_BALANCE_MESSAGES, iterateLowBalanceWarning } from "./iterate-account.js";

describe("iterateLowBalanceWarning", () => {
  it("stays quiet while signed out, even with an empty balance", () => {
    expect(iterateLowBalanceWarning({ signedIn: false, remaining: 0, balance: { amount: 0, unit: "USD" } })).toBeNull();
  });

  it("uses the message estimate whenever it exists and fires only at the threshold", () => {
    expect(iterateLowBalanceWarning({ signedIn: true, remaining: 6, balance: null })).toBeNull();
    expect(iterateLowBalanceWarning({ signedIn: true, remaining: ITERATE_LOW_BALANCE_MESSAGES, balance: null }))
      .toEqual({ kind: "messages", remaining: ITERATE_LOW_BALANCE_MESSAGES });
    expect(iterateLowBalanceWarning({ signedIn: true, remaining: 0, balance: { amount: 99, unit: "USD" } }))
      .toEqual({ kind: "messages", remaining: 0 });
  });

  it("falls back to a small absolute balance when no estimate exists", () => {
    expect(iterateLowBalanceWarning({ signedIn: true, remaining: null, balance: { amount: ITERATE_LOW_BALANCE_ABSOLUTE, unit: "USD" } }))
      .toEqual({ kind: "raw", amount: ITERATE_LOW_BALANCE_ABSOLUTE, unit: "USD" });
    expect(iterateLowBalanceWarning({ signedIn: true, remaining: null, balance: null })).toBeNull();
  });
});
