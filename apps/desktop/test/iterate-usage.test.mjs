/** Pure contracts of the usage summary, estimate and log-page parsing. */
import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = new URL("../electron/main/iterate-account/", import.meta.url);
const cached = new Map();
function load(name) {
  if (cached.has(name)) return cached.get(name).exports;
  const path = new URL(`${name}.ts`, root);
  const module = { exports: {} };
  cached.set(name, module);
  const { outputText } = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: fileURLToPath(path),
  });
  new Function("require", "exports", "module", outputText)(() => {
    throw new Error("usage.ts must stay dependency-free at runtime");
  }, module.exports, module);
  return module.exports;
}
const { parseLogPage, aggregateLogs, averageMessageQuota, remainingMessages, dayKey } = load("usage");

const NOW = new Date();
NOW.setHours(12, 0, 0, 0);
const nowMs = NOW.getTime();
const DAY = 24 * 60 * 60 * 1000;

test("parseLogPage accepts the paged shape and filters to consume rows", () => {
  const page = parseLogPage({
    items: [
      { type: 2, created_at: 1700000000, quota: 500, model_name: "deepseek-chat" },
      { type: 1, created_at: 1700000001, quota: 999999, model_name: "topup" },
      { type: 2, created_at: "junk", quota: 10, model_name: "x" },
      { type: 2, created_at: 1700000002, quota: -5, model_name: "x" },
      { type: 2, created_at: 1700000003, quota: 0, model_name: "  " },
    ],
    total: 4,
  });
  assert.equal(page.total, 4);
  assert.deepEqual(page.items, [
    { at: 1700000000 * 1000, model: "deepseek-chat", quota: 500 },
    { at: 1700000003 * 1000, model: "unknown", quota: 0 },
  ]);
});

test("parseLogPage accepts a bare array and degrades junk to an empty page", () => {
  const rows = [{ type: 2, created_at: 1700000000, quota: 7, model_name: "m" }];
  assert.deepEqual(parseLogPage(rows).items[0], { at: 1700000000 * 1000, model: "m", quota: 7 });
  assert.equal(parseLogPage(rows).total, null);
  assert.deepEqual(parseLogPage(undefined).items, []);
  assert.deepEqual(parseLogPage({ items: "nope" }).items, []);
});

test("aggregateLogs fills fixed local-day slots, ignores the window edge and ranks models", () => {
  const items = [
    { at: nowMs, model: "deepseek-chat", quota: 100 },
    { at: nowMs - 60 * 1000, model: "deepseek-chat", quota: 50 },
    { at: nowMs - DAY, model: "gpt-x", quota: 400 },
    { at: nowMs - 8 * DAY, model: "ancient", quota: 900 },
    { at: nowMs + DAY, model: "future", quota: 900 },
  ];
  const summary = aggregateLogs(items, { days: 7, nowMs });
  assert.equal(summary.days.length, 7);
  assert.equal(summary.days[6].date, dayKey(nowMs));
  assert.equal(summary.days[6].quota, 150);
  assert.equal(summary.days[6].count, 2);
  assert.equal(summary.days[5].quota, 400);
  assert.deepEqual(summary.days.slice(0, 5).map((day) => day.quota), [0, 0, 0, 0, 0]);
  assert.equal(summary.totalQuota, 550);
  assert.equal(summary.count, 3);
  assert.deepEqual(summary.models, [
    { model: "gpt-x", quota: 400, count: 1 },
    { model: "deepseek-chat", quota: 150, count: 2 },
  ]);
});

test("the per-message average needs a honest sample and a positive mean", () => {
  assert.equal(averageMessageQuota([], 3), null);
  assert.equal(averageMessageQuota([{ at: 1, model: "m", quota: 10 }], 3), null);
  const rows = [
    { at: 1, model: "m", quota: 10 },
    { at: 2, model: "m", quota: 20 },
    { at: 3, model: "m", quota: 30 },
  ];
  assert.equal(averageMessageQuota(rows, 3), 20);
  const free = rows.map((row) => ({ ...row, quota: 0 }));
  assert.equal(averageMessageQuota(free, 3), null);
});

test("remaining runway floors and treats zero balance as zero messages", () => {
  assert.equal(remainingMessages(100, null), null);
  assert.equal(remainingMessages(0, 20), 0);
  assert.equal(remainingMessages(45, 20), 2);
  assert.equal(remainingMessages(Number.NaN, 20), 0);
});
