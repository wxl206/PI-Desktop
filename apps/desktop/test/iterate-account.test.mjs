import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { randomBytes as nodeRandomBytes } from "node:crypto";

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
  new Function("require", "exports", "module", outputText)((id) => {
    if (id === "@pi-desktop/shared") return {};
    if (id === "node:crypto") return { randomBytes: nodeRandomBytes };
    if (id.startsWith("./")) return load(id.slice(2));
    if (id === "typescript") return ts;
    throw new Error(`unexpected dependency: ${id}`);
  }, module.exports, module);
  return module.exports;
}
const { AccountClient } = load("client");
const { AccountKeys } = load("keys");
const { discoverModels } = load("models");
const { balanceFor, AccountService } = load("service");

const ORIGIN = "https://api.wxl206.xyz";
const SECRET = "sk-fixture-secret-value-123456";

function response(data, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, ...data }), {
    status, headers: { "content-type": "application/json" },
  });
}

function memoryStore() {
  let journal = null;
  return {
    get journal() { return journal; },
    async read() {
      return journal ? structuredClone(journal) : {
        version: 1, revision: 0, installation: "0123456789abcdef01234567",
        activeUser: null, redemptionUser: null, records: [],
      };
    },
    async save(next) { journal = structuredClone({ ...next, revision: (journal?.revision ?? 0) + 1 }); next.revision = journal.revision; },
  };
}

test("website access token authenticates once and no token is exposed by account overview", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/api/user/self")) return response({ data: { id: 7, username: "student", quota: 1000 } });
    assert.fail(`unexpected ${url}`);
  };
  const client = new AccountClient(fetch);
  await client.accept(SECRET);
  assert.equal(client.id, 7);
  const user = await client.identity();
  assert.deepEqual(user, { id: 7, name: "student", quota: 1000 });
  assert.equal(calls.every((call) => call.url.startsWith(ORIGIN)), true);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(JSON.stringify(user).includes(SECRET), false);
});

test("a dropped create response reconciles the named key instead of posting twice", async () => {
  const store = memoryStore();
  let creates = 0;
  const client = new AccountClient(async (url) => {
    if (url.endsWith("/api/user/self")) return response({ data: { id: 7, username: "student", quota: 1000 } });
    if (url.includes("/api/token/search")) return response({ data: { items: [], total: 0 } });
    if (url.endsWith("/api/token/")) { creates++; throw new TypeError("socket reset after send"); }
    assert.fail(`unexpected ${url}`);
  });
  await client.accept(SECRET, 7);
  const keys = new AccountKeys(client, store);
  const journal = await store.read();
  await assert.rejects(keys.ensure(journal, "default"), (error) => error.code === "NETWORK");
  assert.equal(creates, 1);
  assert.equal(journal.records[0].state, "pending");
  await assert.rejects(keys.ensure(journal, "default"), (error) => error.code === "KEY_UNCERTAIN");
  assert.equal(creates, 1);
});

test("a key created by the prior uncertain attempt is found and validated without another create", async () => {
  const store = memoryStore();
  let creates = 0;
  const journal = await store.read();
  journal.records.push({ user: 7, group: "default", name: "iterate-pi-01234567-test",
    state: "pending", tokenId: null, providers: [] });
  await store.save(journal);
  const client = new AccountClient(async (url) => {
    if (url.endsWith("/api/user/self")) return response({ data: { id: 7, username: "student", quota: 1000 } });
    if (url.includes("/api/token/search")) return response({ data: { items: [{
      id: 42, name: "iterate-pi-01234567-test", group: "default", status: 1, expired_time: -1, user_id: 7,
    }], total: 1 } });
    if (url.endsWith("/api/token/42/key")) return response({ data: { key: SECRET } });
    if (url.endsWith("/api/token/")) creates++;
    assert.fail(`unexpected ${url}`);
  });
  await client.accept(SECRET, 7);
  const keys = new AccountKeys(client, store);
  const result = await keys.ensure(journal, "default");
  assert.equal(result.key, SECRET);
  assert.equal(creates, 0);
  assert.equal(journal.records[0].tokenId, 42);
});

test("model discovery maps only known endpoint styles and keeps a model without a style unselected", async () => {
  const client = new AccountClient(async (url) => {
    if (url.endsWith("/v1/models")) return response({ data: [{ id: "chat-a" }, { id: "unknown-a" }] });
    if (url.endsWith("/api/pricing")) return response({ data: [
      { model_name: "chat-a", supported_endpoint_types: ["openai", "openai-response", "anthropic"] },
    ] });
    assert.fail(`unexpected ${url}`);
  });
  const result = await discoverModels(client, SECRET);
  assert.deepEqual(result, [
    { id: "chat-a", styles: ["chat_completions", "responses", "anthropic_messages"] },
    { id: "unknown-a", styles: [] },
  ]);
});

test("balance conversion uses the server's unit and never invents currency", () => {
  assert.deepEqual(balanceFor(500000, { quota_per_unit: 500000, quota_display_type: "USD" }), { amount: 1, unit: "USD" });
  assert.deepEqual(balanceFor(1000, {}), { amount: 1000, unit: "quota" });
  assert.deepEqual(balanceFor(500000, { quota_per_unit: 500000, quota_display_type: "CNY", usd_exchange_rate: 7 }),
    { amount: 7, unit: "CNY" });
});

test("an uncertain redemption is not resent and requires explicit acknowledgement", async () => {
  const store = memoryStore();
  let posts = 0;
  const client = new AccountClient(async (url) => {
    if (url.endsWith("/api/user/self")) return response({ data: { id: 7, username: "student", quota: 1000 } });
    if (url.endsWith("/api/user/auth/refresh")) return response({ data: { user: { id: 7 }, access_token: SECRET } });
    if (url.endsWith("/api/user/topup/info")) return response({ data: { enable_redemption: true } });
    if (url.endsWith("/api/user/topup")) { posts++; throw new TypeError("connection reset"); }
    assert.fail(`unexpected ${url}`);
  });
  await client.accept(SECRET, 7);
  const service = new AccountService(client, store);
  await assert.rejects(service.run(() => service.redeem("CODE-1")), (error) => error.code === "REDEMPTION_UNCERTAIN");
  assert.equal(posts, 1);
  await assert.rejects(service.run(() => service.redeem("CODE-1")), (error) => error.code === "REDEMPTION_UNCERTAIN");
  assert.equal(posts, 1);
  assert.equal(store.journal.redemptionUser, 7);
});
