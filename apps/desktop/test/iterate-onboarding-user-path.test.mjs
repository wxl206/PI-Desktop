import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot, resolveElectronBinary } from "../../../scripts/e2e/boot.mjs";

const root = repositoryRoot();
const { build } = createRequire(join(root, "packages/agent-runtime/package.json"))("esbuild");

test("the chat home places the Iterate guide before the generic checklist", async () => {
  const surface = await readFile(
    new URL("../src/components/ChatSurface.tsx", import.meta.url),
    "utf8",
  );
  const iterate = surface.indexOf("<IterateWelcome />");
  const generic = surface.indexOf("<OnboardingChecklist />");
  assert.ok(iterate >= 0, "the Iterate guide must be mounted on the chat home");
  assert.ok(generic > iterate, "the generic checklist must follow the Iterate guide");
});

test("a persistent recharge entry stays above the composer in every chat state", async () => {
  const surface = await readFile(
    new URL("../src/components/ChatSurface.tsx", import.meta.url),
    "utf8",
  );
  const emptyState = surface.indexOf("home-composer-wrap");
  const emptyPill = surface.indexOf("<IterateQuickRecharge />", emptyState);
  const emptyBanner = surface.indexOf("<IterateLowBalanceBanner />", emptyState);
  assert.ok(emptyPill > emptyState, "the chat home must mount the quick recharge pill");
  assert.ok(emptyBanner > emptyPill, "the quick recharge pill must precede the low-balance reminder");
  const docked = surface.indexOf("session-panes");
  const dockedPill = surface.indexOf("<IterateQuickRecharge />", docked);
  const dockedBanner = surface.indexOf("<IterateLowBalanceBanner />", docked);
  assert.ok(dockedPill > docked, "mid-session chats must mount the quick recharge pill");
  assert.ok(dockedBanner > dockedPill, "the pill must also precede the reminder mid-session");
});

const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";
import { IPC } from "@pi-desktop/shared";
import { IterateWelcome } from "../../apps/desktop/src/features/settings/iterate/IterateWelcome";
import { IterateAccountPage } from "../../apps/desktop/src/features/settings/iterate/IterateAccountPage";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

await i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  keySeparator: false,
  resources: { en: { translation: flattenCatalog(catalogs.en) } },
  interpolation: { escapeValue: false },
});

let overviewUser = null;
let loginCalls = 0;
let discoverCalls = 0;
let connectCalls = 0;
let rebuildCalls = 0;
let refreshCalls = 0;
let connectionArgs = null;
let purchaseCalls = 0;
let logoutCalls = 0;
let overviewCalls = 0;
let overviewMode = "success";
let overviewDelayMs = 0;
let discoverMode = "success";
let settingsMode = "success";
let dedicatedKeyGroups = [];
let saved = [];
const toasts = [];
const groups = [{ id: "default", description: "Default group", ratio: 1.5 }];
const connectedProvider = {
  id: "iterate-provider",
  name: "Iterate / default / chat_completions",
  vendorKey: "iterate",
  enabled: true,
  hasSecret: true,
  authKind: "api_key",
  models: [{ id: "chat-a" }],
};
const existingProvider = {
  id: "existing-provider",
  name: "Existing provider",
  vendorKey: "custom",
  enabled: true,
  hasSecret: true,
  authKind: "api_key",
  models: [{ id: "existing-model" }],
};
let providerRows = [connectedProvider];
window.piDesktop = {
  platform: "win32",
  on() { return () => {}; },
  async invoke(channel, ...args) {
    if (channel === IPC.invoke.iterateOverview) {
      overviewCalls += 1;
      if (overviewMode === "error") {
        return { ok: false, error: { code: "NETWORK", message: "fixture offline" } };
      }
      const user = overviewUser;
      if (overviewDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, overviewDelayMs));
      }
      return { ok: true, data: {
        user,
        groups,
        balance: null,
        redemptionEnabled: false,
        redemptionUncertain: false,
        dedicatedKeyGroups: [...dedicatedKeyGroups],
        updatedAt: "2026-11-13T00:00:00.000Z",
      } };
    }
    if (channel === IPC.invoke.iterateLogin) {
      loginCalls += 1;
      overviewUser = { id: 7, name: "Iterate user", quota: 500000 };
      return { ok: true, data: null };
    }
    if (channel === IPC.invoke.iterateLogout) {
      logoutCalls += 1;
      overviewUser = null;
      dedicatedKeyGroups = [];
      return { ok: true, data: { loggedOut: true } };
    }
    if (channel === IPC.invoke.iterateDiscover) {
      if (discoverMode === "error") {
        return { ok: false, error: { code: "NETWORK", message: "fixture discover offline" } };
      }
      discoverCalls += 1;
      return { ok: true, data: { models: [
        { id: "unsupported-model", styles: [] },
        { id: "chat-a", styles: ["chat_completions"] },
      ] } };
    }
    if (channel === IPC.invoke.iterateConnect) {
      connectCalls += 1;
      connectionArgs = [...args];
      return { ok: true, data: { providerId: "iterate-provider", modelId: "chat-a" } };
    }
    if (channel === IPC.invoke.iterateRebuildKey) {
      rebuildCalls += 1;
      dedicatedKeyGroups = [...new Set([...dedicatedKeyGroups, String(args[0])])];
      return { ok: true, data: {
        rebuilt: true,
        models: [
          { id: "chat-a", styles: ["chat_completions"] },
          { id: "chat-b", styles: ["chat_completions"] },
        ],
      } };
    }
    if (channel === IPC.invoke.iteratePurchase) {
      purchaseCalls += 1;
      return { ok: true, data: { opened: true } };
    }
    if (channel === IPC.invoke.iterateUsage) {
      const now = new Date();
      const pad = (value) => ("0" + value).slice(-2);
      const day = (offset) => {
        const date = new Date(now);
        date.setDate(date.getDate() - offset);
        return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
      };
      return { ok: true, data: {
        days: [
          ...Array.from({ length: 5 }, (_, index) => ({ date: day(6 - index), quota: 0, count: 0 })),
          { date: day(1), quota: 120, count: 2 },
          { date: day(0), quota: 80, count: 1 },
        ],
        models: [{ model: "chat-a", quota: 200, count: 3 }],
        totalQuota: 200,
        count: 3,
      } };
    }
    if (channel === IPC.invoke.settingsSet) {
      if (settingsMode === "error") {
        return { ok: false, error: { code: "STORAGE", message: "fixture settings store offline" } };
      }
      saved.push(structuredClone(args[0]));
      return { ok: true, data: args[0] };
    }
    throw new Error("Unexpected fixture IPC: " + channel);
  },
};

const baseSettings = {
  theme: "dark",
  defaultMode: "agent",
  language: "en",
};
useAppStore.setState({
  settings: null,
  showToast(message, options) { toasts.push({ message, variant: options?.variant }); },
  setPage(page) { useAppStore.setState({ page }); },
  setSettingsTab(tab) { useAppStore.setState({ settingsTab: tab }); },
  async refreshProviders() {
    refreshCalls += 1;
    useAppStore.setState({ providers: providerRows });
  },
});

const rootNode = createRoot(document.getElementById("root"));
// Hidden Electron windows stop producing animation frames, so turn the event
// loop once instead of using rAF as an unrelated liveness dependency.
const frame = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle() { await frame(); await frame(); }
function mount(element) { flushSync(() => rootNode.render(element)); }
async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await settle();
    const value = predicate();
    if (value) return value;
  }
  throw new Error(message + " body=" + document.body.textContent);
}
function check(condition, message) {
  if (!condition) throw new Error(message);
}
function button(label) {
  return [...document.querySelectorAll("button")]
    .find((item) => item.textContent.trim() === label);
}

window.iterateOnboardingProbe = async () => {
  console.log("ITERATE_PROBE_STAGE welcome");
  const overviewCallsBeforeSettingsLoad = overviewCalls;
  mount(React.createElement(IterateWelcome));
  await settle();
  check(!document.querySelector('[data-testid="iterate-welcome"]'),
    "the guide rendered before persisted settings were available");
  check(overviewCalls === overviewCallsBeforeSettingsLoad,
    "the guide queried the account before persisted settings were available");
  useAppStore.setState({ settings: { ...baseSettings, iterateWelcomeDismissed: false } });
  await waitFor(() => document.querySelector('[data-testid="iterate-welcome"]'),
    "the first-run account guide did not appear after settings loaded");
  check(document.body.textContent.includes("Connect and create API key"),
    "the guide does not lead with account connection");

  flushSync(() => button("Open recharge shop").click());
  await waitFor(() => document.querySelector('[role="dialog"]'),
    "recharge did not ask for confirmation");
  check(purchaseCalls === 0, "opening the confirmation charged or opened the shop");
  flushSync(() => button("Cancel").click());
  await waitFor(() => !document.querySelector('[role="dialog"]'),
    "cancelling recharge left the confirmation open");
  check(purchaseCalls === 0, "cancelling recharge opened the shop");

  flushSync(() => button("Open recharge shop").click());
  await waitFor(() => document.querySelector('[role="dialog"]'),
    "recharge confirmation did not reopen");
  flushSync(() => button("Continue to recharge site").click());
  await waitFor(() => purchaseCalls === 1, "confirmed recharge did not open the shop");
  await waitFor(() => !document.querySelector('[role="dialog"]'),
    "confirmed recharge left the confirmation open");

  const storageToastsBeforeMissingSettings = toasts.filter((toast) =>
    toast.message === "Account records could not be saved or read.").length;
  useAppStore.setState({ settings: null });
  flushSync(() => button("Later").click());
  await waitFor(() => toasts.filter((toast) =>
    toast.message === "Account records could not be saved or read.").length
      === storageToastsBeforeMissingSettings + 1,
  "a missing settings value did not report a storage failure");
  check(document.querySelector('[data-testid="iterate-welcome"]'),
    "the guide disappeared even though missing settings could not be persisted");
  check(saved.length === 0,
    "a missing settings value was reported as successfully saved");
  useAppStore.setState({ settings: { ...baseSettings } });

  settingsMode = "error";
  flushSync(() => button("Later").click());
  await waitFor(() => toasts.some((toast) =>
    toast.message === "Account records could not be saved or read."),
  "a failed dismissal did not report the storage error");
  check(document.querySelector('[data-testid="iterate-welcome"]'),
    "the guide disappeared even though dismissal was not persisted");
  settingsMode = "success";
  flushSync(() => button("Later").click());
  await waitFor(() => !document.querySelector('[data-testid="iterate-welcome"]'),
    "Later did not hide the guide after the settings store recovered");
  await waitFor(() => saved.some((settings) => settings.iterateWelcomeDismissed === true),
    "Later did not persist the guide dismissal");

  mount(null);
  const overviewCallsBeforeReturn = overviewCalls;
  useAppStore.setState({ settings: { ...baseSettings, iterateWelcomeDismissed: true } });
  mount(React.createElement(IterateWelcome));
  await settle();
  check(!document.querySelector('[data-testid="iterate-welcome"]'),
    "the guide returned after a persisted dismissal");
  check(overviewCalls === overviewCallsBeforeReturn,
    "a dismissed guide still queried the account");

  mount(null);
  overviewUser = null;
  saved = [];
  useAppStore.setState({ settings: { ...baseSettings, iterateWelcomeDismissed: false } });
  mount(React.createElement(IterateWelcome));
  await waitFor(() => document.querySelector('[data-testid="iterate-welcome"]'),
    "the guide did not appear for the connection path");
  flushSync(() => button("Connect and create API key").click());
  await waitFor(() => loginCalls === 1, "Connect did not start account login");
  await waitFor(() => discoverCalls === 1,
    "Connect did not discover models after login");
  await waitFor(() => connectCalls === 1,
    "Connect did not create or reuse the dedicated key and model provider");
  await waitFor(() => !document.querySelector('[data-testid="iterate-welcome"]'),
    "completed account and model setup did not dismiss the guide");
  check(connectionArgs?.[0] === "default" && connectionArgs?.[1] === "chat-a",
    "Connect did not select the first runnable model in the first group");
  check(refreshCalls === 1, "Connect did not refresh the configured provider");
  check(saved.some((settings) =>
    settings.defaultProviderId === "iterate-provider" &&
    settings.defaultModelId === "chat-a"),
  "Connect did not save the selected model as the initial app default");
  await waitFor(() => saved.some((settings) => settings.iterateWelcomeDismissed === true),
    "completed setup did not persist the guide dismissal");

  console.log("ITERATE_PROBE_STAGE restored-account");
  mount(null);
  overviewUser = { id: 7, name: "Iterate user", quota: 500000 };
  saved = [];
  useAppStore.setState({ settings: { ...baseSettings }, providers: [] });
  mount(React.createElement(IterateWelcome));
  await waitFor(() => document.querySelector('[data-testid="iterate-welcome"]'),
    "a restored account without completed model setup removed the guide");
  check(document.body.textContent.includes("Finish API key and model setup"),
    "the restored account did not offer the remaining setup step");
  check(saved.length === 0,
    "restoring an account silently completed or dismissed model setup");

  console.log("ITERATE_PROBE_STAGE connection-error");
  discoverMode = "error";
  const networkToastsBefore = toasts.filter((toast) =>
    toast.message === "The gateway could not be reached.").length;
  flushSync(() => button("Finish API key and model setup").click());
  await waitFor(() => toasts.filter((toast) =>
    toast.message === "The gateway could not be reached.").length === networkToastsBefore + 1,
  "a normal model-discovery failure was not reported as a recoverable action error");
  check(document.querySelector('[data-testid="iterate-welcome"]'),
    "a normal model-discovery failure replaced the onboarding guide");
  check(!document.querySelector('[data-testid="iterate-welcome-error"]'),
    "a normal model-discovery failure was rendered as an initialization failure");
  discoverMode = "success";

  console.log("ITERATE_PROBE_STAGE error-dismissal");
  mount(null);
  overviewMode = "error";
  useAppStore.setState({ settings: { ...baseSettings, iterateWelcomeDismissed: false } });
  mount(React.createElement(IterateWelcome));
  await waitFor(() => document.querySelector('[data-testid="iterate-welcome-error"]'),
    "an account initialization error did not render the recoverable guide");
  flushSync(() => button("Later").click());
  await waitFor(() => !document.querySelector('[data-testid="iterate-welcome-error"]'),
    "Later did not dismiss the recoverable guide");
  overviewMode = "success";

  console.log("ITERATE_PROBE_STAGE account-retry");
  overviewMode = "error";
  mount(React.createElement(IterateAccountPage));
  console.log("ITERATE_PROBE_STAGE account-retry-mounted");
  await waitFor(() => document.body.textContent.includes("Could not load the Iterate account"),
    "a transient account error was shown as a signed-out account");
  console.log("ITERATE_PROBE_STAGE account-retry-error");
  check(!button("Connect Iterate"),
    "a transient account error exposed the sign-in action");
  overviewMode = "success";
  flushSync(() => button("Refresh").click());
  console.log("ITERATE_PROBE_STAGE account-retry-clicked");
  await waitFor(() => document.body.textContent.includes("Default group"),
    "retrying the account load did not render the available group");
  console.log("ITERATE_PROBE_STAGE account-retry-loaded");
  check(document.body.textContent.includes("Default group · Rate ×1.5"),
    "the account page did not show the server-provided group ratio");
  check(button("Copy dedicated key").disabled,
    "copy was enabled before the dedicated key existed");
  flushSync(() => button("Discover models").click());
  await waitFor(() => rebuildCalls === 0 && !button("Copy dedicated key").disabled,
    "discovering the dedicated key did not enable copy");
  flushSync(() => button("Recreate dedicated key").click());
  await waitFor(() => document.querySelector('[role="dialog"]'),
    "key recreation did not ask for confirmation");
  check(rebuildCalls === 0, "opening key recreation already created a key");
  flushSync(() => button("Cancel").click());
  await waitFor(() => !document.querySelector('[role="dialog"]'),
    "cancelling key recreation left the confirmation open");
  flushSync(() => button("Recreate dedicated key").click());
  await waitFor(() => button("Create new key"),
    "the key recreation confirmation did not reopen");
  flushSync(() => button("Create new key").click());
  await waitFor(() => rebuildCalls === 1,
    "confirming key recreation did not run the rebuild");
  await waitFor(() => !document.querySelector('[role="dialog"]'),
    "key recreation left the confirmation open");
  await waitFor(() => toasts.some((toast) => toast.message.includes("Dedicated key recreated")),
    "key recreation did not report success");
  console.log("ITERATE_PROBE_STAGE account-success");
  mount(null);

  providerRows = [existingProvider, connectedProvider];
  console.log("ITERATE_PROBE_STAGE existing-default");
  saved = [];
  useAppStore.setState({
    providers: providerRows,
    settings: {
      ...baseSettings,
      defaultProviderId: "existing-provider",
      defaultModelId: "existing-model",
      iterateWelcomeDismissed: true,
    },
  });
  mount(React.createElement(IterateAccountPage));
  console.log("ITERATE_PROBE_STAGE existing-default-mounted");
  await waitFor(() => document.body.textContent.includes("Default group"),
    "the account page did not render before changing an Iterate model");
  console.log("ITERATE_PROBE_STAGE existing-default-loaded");
  flushSync(() => button("Discover models").click());
  await waitFor(() => button("Connect"), "model discovery did not expose Connect");
  console.log("ITERATE_PROBE_STAGE existing-default-discovered");
  flushSync(() => button("Connect").click());
  await waitFor(() => connectCalls === 2, "the second model connection did not finish");
  await settle();
  console.log("ITERATE_PROBE_STAGE existing-default-connected");
  check(saved.length === 0,
    "connecting another Iterate model replaced an existing runnable app default");

  console.log("ITERATE_PROBE_STAGE account-login-refresh");
  mount(null);
  overviewUser = null;
  const refreshCallsBeforeLogin = refreshCalls;
  mount(React.createElement(IterateAccountPage));
  await waitFor(() => button("Connect Iterate"),
    "the signed-out account page did not expose login");
  flushSync(() => button("Connect Iterate").click());
  await waitFor(() => document.body.textContent.includes("Iterate user"),
    "account login did not reload the signed-in page");
  await waitFor(() => refreshCalls === refreshCallsBeforeLogin + 1,
    "account login did not refresh the provider rows");

  console.log("ITERATE_PROBE_STAGE stale-overview");
  overviewDelayMs = 250;
  flushSync(() => button("Refresh").click());
  flushSync(() => button("Sign out").click());
  await waitFor(() => button("Connect Iterate"),
    "logout did not return to the signed-out account page");
  await waitFor(() => logoutCalls === 1,
    "logout did not complete through the account IPC");
  await new Promise((resolve) => setTimeout(resolve, 350));
  await settle();
  check(button("Connect Iterate") && !document.body.textContent.includes("Iterate user"),
    "an overview response started before logout restored the signed-in account");
  overviewDelayMs = 0;

  flushSync(() => rootNode.unmount());
  return {
    firstRunVisible: true,
    rechargeConfirmationRequired: true,
    cancelledPurchaseCalls: 0,
    confirmedPurchaseCalls: purchaseCalls,
    dismissalPersisted: true,
    absentAfterRelaunch: true,
    connectionCompleted: true,
    connectionPersisted: true,
    defaultSelected: true,
    restoredAccountWaitsForSetup: true,
    groupRatioVisible: true,
    existingDefaultPreserved: true,
    connectionErrorStayedInline: true,
    loginRefreshedProviders: true,
    onboardingErrorDismissed: true,
    staleOverviewIgnored: true,
    toasts,
  };
};
`;

test("first-run Iterate guide connects an account and confirms recharge", {
  timeout: 60_000,
  skip: process.platform === "linux" && !process.env.DISPLAY
    ? "Isolated Electron UI test requires a display"
    : false,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-iterate-onboarding-ui-"));
  try {
    await build({
      stdin: { contents: fixture, resolveDir: join(root, "scripts/e2e"), loader: "tsx" },
      outfile: join(temp, "renderer.js"),
      bundle: true,
      platform: "browser",
      format: "esm",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      alias: {
        "@pi-desktop/i18n": join(root, "packages/i18n/src"),
        "@pi-desktop/shared": join(root, "packages/shared/src"),
        react: join(root, "apps/desktop/node_modules/react"),
        "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
        i18next: join(root, "apps/desktop/node_modules/i18next"),
        "react-i18next": join(root, "apps/desktop/node_modules/react-i18next"),
      },
      nodePaths: [join(root, "apps/desktop/node_modules")],
    });
    await writeFile(
      join(temp, "index.html"),
      '<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="renderer.js"></script>',
    );
    await writeFile(
      join(temp, "main.cjs"),
      `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 760,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on("console-message", (_event, ...details) => {
    console.log("RENDERER_CONSOLE " + JSON.stringify(details));
  });
  win.webContents.on("render-process-gone", (_event, detail) => {
    console.error("RENDERER_GONE " + JSON.stringify(detail));
  });
  try {
    await win.loadFile(path.join(__dirname, "index.html"));
    const result = await win.webContents.executeJavaScript("window.iterateOnboardingProbe()");
    console.log("ITERATE_ONBOARDING_PROBE " + JSON.stringify(result));
    app.exit(0);
  } catch (error) {
    console.error(error?.stack ?? error);
    app.exit(1);
  }
});
`,
    );

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(resolveElectronBinary(root).electronBinary, [join(temp, "main.cjs")], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => { output += chunk; });
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
    let code;
    try {
      code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
    } finally {
      clearTimeout(timer);
    }
    assert.equal(code, 0, output.slice(-6000));
    const line = output.split(/\r?\n/)
      .find((item) => item.startsWith("ITERATE_ONBOARDING_PROBE "));
    assert.ok(line, output.slice(-6000));
    const result = JSON.parse(line.slice("ITERATE_ONBOARDING_PROBE ".length));
    assert.deepEqual(
      {
        ...result,
        toasts: result.toasts.map((toast) => toast.message),
      },
      {
        firstRunVisible: true,
        rechargeConfirmationRequired: true,
        cancelledPurchaseCalls: 0,
        confirmedPurchaseCalls: 1,
        dismissalPersisted: true,
        absentAfterRelaunch: true,
        connectionCompleted: true,
        connectionPersisted: true,
        defaultSelected: true,
        restoredAccountWaitsForSetup: true,
        groupRatioVisible: true,
        existingDefaultPreserved: true,
        connectionErrorStayedInline: true,
        loginRefreshedProviders: true,
        onboardingErrorDismissed: true,
        staleOverviewIgnored: true,
        toasts: [
          "Account records could not be saved or read.",
          "Account records could not be saved or read.",
          "Model connected.",
          "The gateway could not be reached.",
          "The gateway could not be reached.",
          "Dedicated key recreated. Your connected models now use it.",
          "Model connected.",
          "Signed in to Iterate.",
        ],
      },
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
