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
const { AccountAdmission, acquireAccountThenSession } = load("admission");
const { AccountKeys } = load("keys");
const { connectModel, discoverModels, rebindKeyToProviders } = load("models");
const { balanceFor, AccountService } = load("service");
const { failureKey } = load("../../../../../apps/desktop/src/features/settings/iterate/failure");

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
        version: 2, revision: 0, installation: "0123456789abcdef01234567",
        activeUser: null, redemptionUsers: [], records: [],
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

test("account admission serializes prompt and provider-change handoffs", async () => {
  const gate = new AccountAdmission();
  const releaseFirst = await gate.acquire();
  let secondAcquired = false;
  const second = gate.acquire().then((release) => {
    secondAcquired = true;
    return release;
  });
  await Promise.resolve();
  assert.equal(secondAcquired, false);
  releaseFirst();
  const releaseSecond = await second;
  assert.equal(secondAcquired, true);
  releaseSecond();
});

test("account and session admissions use one lock order and unwind a partial acquisition", async () => {
  const order = [];
  let releasedAccount = false;
  const admissions = await acquireAccountThenSession(
    async () => {
      order.push("account");
      return () => { releasedAccount = true; };
    },
    async () => {
      order.push("session");
      return () => {};
    },
  );
  assert.deepEqual(order, ["account", "session"]);
  admissions.session();
  admissions.account();
  assert.equal(releasedAccount, true);

  releasedAccount = false;
  await assert.rejects(acquireAccountThenSession(
    async () => () => { releasedAccount = true; },
    async () => { throw new Error("session unavailable"); },
  ), /session unavailable/);
  assert.equal(releasedAccount, true);
});

test("a successful HTTP response with malformed JSON is classified as an invalid response", async () => {
  const client = new AccountClient(async () => new Response("{not-json", {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
  await assert.rejects(client.request("/api/status", undefined, { anonymous: true }),
    (error) => error.code === "INVALID_RESPONSE");
});

test("a dropped create response reconciles the same name before an explicit retry", async () => {
  const store = memoryStore();
  let creates = 0;
  let created = false;
  const names = [];
  const client = new AccountClient(async (url, init) => {
    if (url.endsWith("/api/user/self")) return response({ data: { id: 7, username: "student", quota: 1000 } });
    if (url.includes("/api/token/search")) return response({ data: { items: created ? [{
      id: 42,
      name: names[0],
      group: "default",
      status: 1,
      expired_time: -1,
      user_id: 7,
    }] : [], total: created ? 1 : 0 } });
    if (url.endsWith("/api/token/")) {
      creates += 1;
      names.push(JSON.parse(init.body).name);
      if (creates === 1) throw new TypeError("socket reset after send");
      created = true;
      return response({ data: { id: 42 } });
    }
    if (url.endsWith("/api/token/42/key")) return response({ data: { key: SECRET } });
    assert.fail(`unexpected ${url}`);
  });
  await client.accept(SECRET, 7);
  const keys = new AccountKeys(client, store);
  const journal = await store.read();
  await assert.rejects(keys.ensure(journal, "default"), (error) => error.code === "NETWORK");
  assert.equal(creates, 1);
  assert.equal(journal.records[0].state, "pending");
  const retried = await keys.ensure(journal, "default");
  assert.equal(retried.key, SECRET);
  assert.equal(creates, 2);
  assert.equal(names[0], names[1]);
});

test("a key created by the prior uncertain attempt is found and validated without another create", async () => {
  const store = memoryStore();
  let creates = 0;
  const journal = await store.read();
  journal.records.push({ user: 7, group: "default", name: "iterate-pi-01234567-test",
    state: "pending", tokenId: null, rotationPending: false, providers: [] });
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
  const journal = await store.read();
  journal.activeUser = 7;
  await store.save(journal);
  const service = new AccountService(client, store);
  await assert.rejects(service.run(() => service.redeem("CODE-1")), (error) => error.code === "REDEMPTION_UNCERTAIN");
  assert.equal(posts, 1);
  await assert.rejects(service.run(() => service.redeem("CODE-1")), (error) => error.code === "REDEMPTION_UNCERTAIN");
  assert.equal(posts, 1);
  assert.deepEqual(store.journal.redemptionUsers, [7]);
});

test("redemption uncertainty is scoped to one account and acknowledgement preserves other users", async () => {
  const store = memoryStore();
  const journal = await store.read();
  journal.activeUser = 8;
  journal.redemptionUsers = [7];
  await store.save(journal);
  let currentUser = 8;
  let posts = 0;
  const client = new AccountClient(async (url) => {
    if (url.endsWith("/api/user/self")) {
      return response({ data: { id: currentUser, username: `user-${currentUser}`, quota: 1000 } });
    }
    if (url.endsWith("/api/user/auth/refresh")) {
      return response({ data: { user: { id: currentUser }, access_token: SECRET } });
    }
    if (url.endsWith("/api/user/topup/info")) return response({ data: { enable_redemption: true } });
    if (url.endsWith("/api/user/topup")) {
      posts += 1;
      throw new TypeError("connection reset");
    }
    assert.fail(`unexpected ${url}`);
  });
  await client.accept(SECRET, 8);
  const service = new AccountService(client, store);

  await assert.rejects(service.run(() => service.redeem("CODE-8")),
    (error) => error.code === "REDEMPTION_UNCERTAIN");
  assert.equal(posts, 1);
  assert.deepEqual(store.journal.redemptionUsers, [7, 8]);

  await service.run(() => service.acknowledgeRedemption());
  assert.deepEqual(store.journal.redemptionUsers, [7]);

  currentUser = 7;
  client.clear();
  await client.accept(SECRET, 7);
  const switched = await store.read();
  switched.activeUser = 7;
  await store.save(switched);
  await assert.rejects(service.run(() => service.redeem("CODE-7")),
    (error) => error.code === "REDEMPTION_UNCERTAIN");
  assert.equal(posts, 1);
  assert.deepEqual(store.journal.redemptionUsers, [7]);
});

test("switching accounts disables the old provider rows before enabling the new account", async () => {
  const store = memoryStore();
  const journal = await store.read();
  journal.activeUser = 1;
  journal.records.push(
    { user: 1, group: "default", name: "iterate-pi-old", state: "created", tokenId: 11,
      rotationPending: false, providers: [{ id: "old-provider", style: "chat_completions" }] },
    { user: 2, group: "default", name: "iterate-pi-new", state: "created", tokenId: 22,
      rotationPending: false, providers: [{ id: "new-provider", style: "chat_completions" }] },
  );
  await store.save(journal);
  const providers = [
    { id: "old-provider", name: "Old", vendorKey: "iterate", type: "openai_compatible",
      protocol: "openai_compatible", enabled: true, baseUrl: `${ORIGIN}/v1`, authKind: "api_key",
      apiStyle: "chat_completions", models: [] },
    { id: "new-provider", name: "New", vendorKey: "iterate", type: "openai_compatible",
      protocol: "openai_compatible", enabled: false, baseUrl: `${ORIGIN}/v1`, authKind: "api_key",
      apiStyle: "chat_completions", models: [] },
    { id: "unrelated", name: "Unrelated", vendorKey: "custom", type: "openai_compatible",
      protocol: "openai_compatible", enabled: true, baseUrl: "https://example.com/v1",
      authKind: "api_key", apiStyle: "chat_completions", models: [] },
  ];
  const updates = [];
  store.host = () => ({
    async call(method, params) {
      if (method === "providers.list") return { providers: structuredClone(providers) };
      if (method === "providers.update") {
        const row = providers.find((provider) => provider.id === params.id);
        Object.assign(row, params); updates.push(structuredClone(params)); return { provider: row };
      }
      throw new Error(`unexpected host method: ${method}`);
    },
  });
  const client = new AccountClient(async (url) => {
    if (url.endsWith("/api/user/self")) return response({ data: { id: 2, username: "second", quota: 1000 } });
    assert.fail(`unexpected ${url}`);
  });
  await client.accept(SECRET, 2);
  await new AccountService(client, store, () => false).signedIn();
  assert.equal(store.journal.activeUser, 2);
  assert.equal(providers.find((entry) => entry.id === "old-provider").enabled, false);
  assert.equal(providers.find((entry) => entry.id === "new-provider").enabled, true);
  assert.equal(providers.find((entry) => entry.id === "unrelated").enabled, true);
  const firstNewEnable = updates.findIndex((entry) => entry.id === "new-provider" && entry.enabled === true);
  const lastOldDisable = updates.findLastIndex((entry) => entry.id === "old-provider" && entry.enabled === false);
  assert.ok(lastOldDisable >= 0 && firstNewEnable > lastOldDisable);
});

test("account switching and sign-out fail closed while a turn is running", async () => {
  const store = memoryStore();
  const journal = await store.read();
  journal.activeUser = 1;
  await store.save(journal);
  let hostTouched = false;
  store.host = () => ({ async call() { hostTouched = true; throw new Error("must not run"); } });
  const client = new AccountClient(async (url) => {
    if (url.endsWith("/api/user/self")) return response({ data: { id: 2, username: "second", quota: 1000 } });
    assert.fail(`unexpected ${url}`);
  });
  await client.accept(SECRET, 2);
  const service = new AccountService(client, store, () => true);
  await assert.rejects(service.signedIn(), (error) => error.code === "TASKS_RUNNING");
  assert.equal(hostTouched, false);
  assert.equal(store.journal.activeUser, 1);

  client.clear();
  client.accept = async () => { client.userId = 1; };
  await client.accept(SECRET, 1);
  await assert.rejects(service.logout(async () => {}), (error) => error.code === "TASKS_RUNNING");
  assert.equal(store.journal.activeUser, 1);
});

test("model connection and provider recovery do not mutate while a turn is running", async () => {
  const store = memoryStore();
  const journal = await store.read();
  journal.activeUser = 7;
  await store.save(journal);
  let hostTouched = false;
  store.host = () => ({
    async call() {
      hostTouched = true;
      throw new Error("must not run");
    },
  });
  const client = new AccountClient(async (url) => {
    if (url.endsWith("/api/user/self")) {
      return response({ data: { id: 7, username: "student", quota: 1000 } });
    }
    assert.fail(`unexpected ${url}`);
  });
  await client.accept(SECRET, 7);
  const service = new AccountService(client, store, () => true);

  await assert.rejects(service.connect("default", "chat-a"),
    (error) => error.code === "TASKS_RUNNING");
  await service.recover();
  assert.equal(hostTouched, false);
});

test("an account change rechecks running turns after waiting for prompt admission", async () => {
  const store = memoryStore();
  const journal = await store.read();
  journal.activeUser = 1;
  await store.save(journal);
  let running = false;
  let released = false;
  const client = new AccountClient(async (url) => {
    if (url.endsWith("/api/user/self")) return response({ data: { id: 2, username: "second", quota: 1000 } });
    assert.fail(`unexpected ${url}`);
  });
  await client.accept(SECRET, 2);
  const service = new AccountService(client, store, () => running, async () => {
    await Promise.resolve();
    running = true;
    return () => { released = true; };
  });
  await assert.rejects(service.signedIn(), (error) => error.code === "TASKS_RUNNING");
  assert.equal(released, true);
  assert.equal(store.journal.activeUser, 1);
});

test("a locally recorded key that disappeared remotely can be rotated explicitly", async () => {
  const store = memoryStore();
  const journal = await store.read();
  journal.activeUser = 7;
  journal.records.push({ user: 7, group: "default", name: "iterate-pi-deleted",
    state: "created", tokenId: 42, rotationPending: false, providers: [] });
  await store.save(journal);
  let createdName = null;
  const client = new AccountClient(async (url, init) => {
    if (url.endsWith("/api/user/self")) return response({ data: { id: 7, username: "student", quota: 1000 } });
    if (url.includes("/api/token/search")) {
      const name = new URL(url).searchParams.get("keyword");
      if (name === createdName) return response({ data: { items: [{
        id: 99, name, group: "default", status: 1, expired_time: -1, user_id: 7,
      }], total: 1 } });
      return response({ data: { items: [], total: 0 } });
    }
    if (url.endsWith("/api/token/") && init.method === "POST") {
      createdName = JSON.parse(init.body).name;
      return response({ data: { id: 99 } });
    }
    if (url.endsWith("/api/token/99/key")) return response({ data: { key: "sk-new-0123456789abcdef" } });
    assert.fail(`unexpected ${url}`);
  });
  await client.accept(SECRET, 7);
  const keys = new AccountKeys(client, store);
  await assert.rejects(keys.ensure(journal, "default"), (error) => error.code === "KEY_CHANGED");
  const result = await keys.rotate(journal, "default");
  assert.equal(result.record.state, "created");
  assert.equal(result.record.tokenId, 99);
  assert.notEqual(result.record.name, "iterate-pi-deleted");
  assert.equal(result.key, "sk-new-0123456789abcdef");
});

test("provider connection uses the Host RPC contract and appends models without creating a duplicate row", async () => {
  const store = memoryStore();
  const providers = [];
  const createCalls = [];
  const updateCalls = [];
  store.host = () => ({
    async call(method, params) {
      if (method === "providers.list") return { providers: structuredClone(providers) };
      if (method === "providers.create") {
        createCalls.push(structuredClone(params));
        const provider = { id: "iterate-provider", ...structuredClone(params) };
        providers.push(provider);
        return { provider };
      }
      if (method === "providers.update") {
        updateCalls.push(structuredClone(params));
        const provider = providers.find((entry) => entry.id === params.id);
        Object.assign(provider, params);
        return { provider };
      }
      throw new Error(`unexpected host method: ${method}`);
    },
  });
  const journal = await store.read();
  const record = { user: 7, group: "default", name: "iterate-pi-01234567-test",
    state: "created", tokenId: 42, rotationPending: false,
    providers: [{ id: "deleted-provider", style: "chat_completions" }] };
  journal.records.push(record);
  await store.save(journal);
  await connectModel(store, journal, record, SECRET, { id: "chat-a", styles: ["chat_completions"] });
  await connectModel(store, journal, record, SECRET, { id: "chat-b", styles: ["chat_completions"] });
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].vendorKey, "iterate");
  assert.equal(createCalls[0].protocol, "openai_compatible");
  assert.equal(createCalls[0].baseUrl, `${ORIGIN}/v1`);
  assert.equal(createCalls[0].model, undefined);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].protocol, "openai_compatible");
  assert.deepEqual(updateCalls[0].models.map((entry) => entry.id), ["chat-a", "chat-b"]);
  assert.deepEqual(record.providers, [{ id: "iterate-provider", style: "chat_completions" }]);
});

test("rebinding a rebuilt key updates only the providers recorded for that key", async () => {
  const store = memoryStore();
  const providers = [
    { id: "managed", name: "Old name", vendorKey: "iterate", type: "openai_compatible",
      protocol: "openai-compatible", enabled: true, baseUrl: `${ORIGIN}/v1`, authKind: "api_key",
      apiStyle: "chat_completions", models: [] },
    { id: "unrelated", name: "Unrelated", vendorKey: "custom", type: "openai_compatible",
      protocol: "openai_compatible", enabled: true, baseUrl: "https://example.com/v1",
      authKind: "api_key", apiStyle: "chat_completions", models: [] },
  ];
  const updates = [];
  store.host = () => ({
    async call(method, params) {
      if (method === "providers.list") return { providers: structuredClone(providers) };
      if (method === "providers.update") {
        updates.push(structuredClone(params));
        const provider = providers.find((entry) => entry.id === params.id);
        Object.assign(provider, params);
        return { provider };
      }
      throw new Error(`unexpected host method: ${method}`);
    },
  });
  const journal = await store.read();
  const record = { user: 7, group: "default", name: "iterate-pi-new",
    state: "created", tokenId: 43, rotationPending: true,
    providers: [{ id: "managed", style: "chat_completions" }] };
  journal.records.push(record);
  await store.save(journal);
  await rebindKeyToProviders(store, journal, record, "sk-rebuilt-0123456789abcdef");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, "managed");
  assert.equal(updates[0].protocol, "openai_compatible");
  assert.equal(updates[0].secretValue, "sk-rebuilt-0123456789abcdef");
  assert.equal(updates.some((entry) => entry.id === "unrelated"), false);
});

test("a failed provider rebind retries the same pending key instead of creating another", async () => {
  const pendingKey = ["fixture", "provider", "key", "pending", "123456789"].join("-");
  const store = memoryStore();
  const providers = [
    { id: "provider-chat", name: "Old chat", vendorKey: "iterate", type: "openai_compatible",
      protocol: "openai_compatible", enabled: true, baseUrl: `${ORIGIN}/v1`, authKind: "api_key",
      apiStyle: "chat_completions", models: [] },
    { id: "provider-responses", name: "Old responses", vendorKey: "iterate", type: "openai_compatible",
      protocol: "openai_compatible", enabled: true, baseUrl: `${ORIGIN}/v1`, authKind: "api_key",
      apiStyle: "responses", models: [] },
  ];
  let creates = 0;
  let createdName = null;
  let failNextUpdate = true;
  const updateIds = [];
  store.host = () => ({
    async call(method, params) {
      if (method === "providers.list") return { providers: structuredClone(providers) };
      if (method === "providers.update") {
        updateIds.push(params.id);
        if (failNextUpdate) {
          failNextUpdate = false;
          throw new Error("fixture provider update failure");
        }
        const provider = providers.find((entry) => entry.id === params.id);
        Object.assign(provider, params);
        return { provider };
      }
      throw new Error(`unexpected host method: ${method}`);
    },
  });
  const client = new AccountClient(async (url, init) => {
    if (url.endsWith("/api/user/self")) return response({ data: { id: 7, username: "student", quota: 1000 } });
    if (url.includes("/api/token/search")) {
      const name = new URL(url).searchParams.get("keyword");
      if (name === createdName) return response({ data: { items: [{
        id: 99, name, group: "default", status: 1, expired_time: -1, user_id: 7,
      }], total: 1 } });
      return response({ data: { items: [], total: 0 } });
    }
    if (url.endsWith("/api/token/") && init.method === "POST") {
      creates += 1;
      createdName = JSON.parse(init.body).name;
      return response({ data: { id: 99 } });
    }
    if (url.endsWith("/api/token/99/key")) {
      return response({ data: { key: pendingKey } });
    }
    assert.fail(`unexpected ${url}`);
  });
  await client.accept(SECRET, 7);
  const journal = await store.read();
  journal.activeUser = 7;
  const record = {
    user: 7, group: "default", name: "iterate-pi-original", state: "created",
    tokenId: 42, rotationPending: false, providers: [
      { id: "provider-chat", style: "chat_completions" },
      { id: "provider-responses", style: "responses" },
    ],
  };
  journal.records.push(record);
  await store.save(journal);
  const keys = new AccountKeys(client, store);

  const first = await keys.rotate(journal, "default");
  assert.equal(creates, 1);
  assert.equal(first.record.rotationPending, true);
  assert.equal(first.key, pendingKey);
  await assert.rejects(rebindKeyToProviders(store, journal, record, first.key),
    /fixture provider update failure/);
  assert.equal(record.rotationPending, true);

  const retried = await keys.rotate(journal, "default");
  assert.equal(creates, 1, "retry must not create another remote key");
  assert.equal(retried.record.name, first.record.name);
  assert.equal(retried.record.tokenId, 99);
  assert.equal(retried.key, first.key);
  await rebindKeyToProviders(store, journal, record, retried.key);
  assert.equal(record.rotationPending, false);
  assert.deepEqual(providers.map((entry) => entry.secretValue), [pendingKey, pendingKey]);
  assert.deepEqual(updateIds, ["provider-chat", "provider-chat", "provider-responses"]);
});

test("renderer localizes the IPC error code instead of falling back to REJECTED", () => {
  assert.equal(failureKey(Object.assign(new Error("x"), { code: "NETWORK" })), "NETWORK");
  assert.equal(failureKey({ details: { errorCode: "LOGIN_REQUIRED" } }), "LOGIN_REQUIRED");
  assert.equal(failureKey(Object.assign(new Error("x"), { code: "SOMETHING_ELSE" })), "REJECTED");
  assert.equal(failureKey(Object.assign(new Error("x"), { code: "TASKS_RUNNING" })), "TASKS_RUNNING");
  assert.equal(failureKey(undefined), "REJECTED");
});
