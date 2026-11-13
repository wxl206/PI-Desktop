import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { Host, resolveHostBinary } from "../../../scripts/e2e/host.mjs";

let hostBinary = null;
let hostSkip = "";
try {
  hostBinary = resolveHostBinary();
} catch (error) {
  hostSkip = error.message;
}

const root = new URL("../electron/main/iterate-account/", import.meta.url);
const loaded = new Map();
function load(name) {
  if (loaded.has(name)) return loaded.get(name).exports;
  const path = new URL(`${name}.ts`, root);
  const module = { exports: {} };
  loaded.set(name, module);
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: fileURLToPath(path),
  });
  new Function("require", "exports", "module", outputText)((id) => {
    if (id === "@pi-desktop/shared") return {};
    if (id.startsWith("./")) return load(id.slice(2));
    throw new Error(`unexpected dependency: ${id}`);
  }, module.exports, module);
  return module.exports;
}

const { connectModel } = load("models");

test("Iterate providers use the real Host RPC and survive delete and restart", {
  skip: hostBinary ? false : hostSkip,
  timeout: 60_000,
}, async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "pi-iterate-provider-rpc-"));
  const host = new Host(hostBinary, dataDir, { quiet: true });
  try {
    await host.start();
    const store = {
      host: () => ({ call: (method, params) => host.call(method, params) }),
      async save() {},
    };
    const modelKey = ["fixture", "provider", "key", "rpc", "123456789"].join("-");
    const journal = {
      version: 2,
      revision: 0,
      installation: "0123456789abcdef01234567",
      activeUser: 7,
      redemptionUsers: [],
      records: [],
    };
    const record = {
      user: 7,
      group: "default",
      name: "iterate-pi-rpc-fixture",
      state: "created",
      tokenId: 1,
      rotationPending: false,
      providers: [],
    };
    journal.records.push(record);

    const firstProviderId = await connectModel(
      store,
      journal,
      record,
      modelKey,
      { id: "chat-a", styles: ["chat_completions"] },
    );
    await connectModel(
      store,
      journal,
      record,
      modelKey,
      { id: "chat-b", styles: ["chat_completions"] },
    );
    let listed = (await host.call("providers.list", { includeDisabled: true })).providers;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, firstProviderId);
    assert.equal(listed[0].vendorKey, "iterate");
    assert.equal(listed[0].protocol, "openai_compatible");
    assert.equal(listed[0].apiStyle, "chat_completions");
    assert.equal(listed[0].hasSecret, true);
    assert.deepEqual(listed[0].models.map((entry) => entry.id), ["chat-a", "chat-b"]);
    assert.deepEqual(record.providers, [{ id: firstProviderId, style: "chat_completions" }]);

    await host.restart();
    listed = (await host.call("providers.list", { includeDisabled: true })).providers;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, firstProviderId);
    assert.deepEqual(listed[0].models.map((entry) => entry.id), ["chat-a", "chat-b"]);
    assert.equal(listed[0].hasSecret, true);

    await host.call("providers.delete", { id: firstProviderId });
    const replacementId = await connectModel(
      store,
      journal,
      record,
      modelKey,
      { id: "chat-a", styles: ["chat_completions"] },
    );
    assert.notEqual(replacementId, firstProviderId);
    assert.deepEqual(record.providers, [{ id: replacementId, style: "chat_completions" }]);

    await host.restart();
    listed = (await host.call("providers.list", { includeDisabled: true })).providers;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, replacementId);
    assert.deepEqual(listed[0].models.map((entry) => entry.id), ["chat-a"]);
    assert.equal(listed[0].hasSecret, true);
  } finally {
    await host.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});
