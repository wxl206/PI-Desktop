import { app, BrowserWindow, dialog, session, type Session } from "electron";
import type { AccountClient } from "./client";
import { AccountError, ITERATE_ORIGIN, ITERATE_SHOP } from "./contract";

export type AccountWindowLabels = {
  login: string; purchase: string; paymentOrigin: string; open: string; cancel: string;
  connecting: string;
};

function parseHttps(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

/** These windows are never registered with BrowserHost, PluginViewHost or CDP tools. */
export class AccountWindows {
  readonly website: Session;
  private readonly purchaseSession: Session;
  private readonly owned = new Set<BrowserWindow>();
  private loginWindow: BrowserWindow | null = null;
  private consoleWindow: BrowserWindow | null = null;
  private purchaseWindow: BrowserWindow | null = null;
  private pending: Promise<void> | null = null;
  private finish: ((error?: AccountError) => void) | null = null;
  private accepting = false;
  private readonly paymentOrigins = new Set(["https://catfk.com"]);
  private disposed = false;

  constructor(private readonly parent: () => BrowserWindow | null, private readonly labels: () => AccountWindowLabels) {
    this.website = session.fromPartition("persist:iterate-account-v1", { cache: false });
    this.purchaseSession = session.fromPartition("iterate-purchase-v1", { cache: false });
    for (const isolated of [this.website, this.purchaseSession]) {
      isolated.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
      isolated.setPermissionCheckHandler(() => false);
      isolated.on("will-download", this.preventDownload);
    }
  }
  private readonly preventDownload = (event: Electron.Event) => event.preventDefault();

  /** Paint feedback immediately so a slow remote load is never a white void. */
  private async loadWithSplash(window: BrowserWindow, url: string) {
    const label = this.labels().connecting.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
    const splash = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#101014;color:#ececef;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-user-select:none}body{display:grid;place-items:center}</style><div>${label}</div>`;
    try { await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splash)}`); } catch { /* best effort */ }
    if (this.disposed || window.isDestroyed()) return;
    window.show();
    await window.loadURL(url);
  }

  private create(title: string, isolated: Session) {
    if (this.disposed) throw new AccountError("CANCELLED");
    // Chromium's global debugging endpoint can enumerate windows outside BrowserHost.
    if (app.commandLine.hasSwitch("remote-debugging-port") || app.commandLine.hasSwitch("remote-debugging-pipe")) throw new AccountError("DEBUG_ACTIVE");
    const window = new BrowserWindow({ parent: this.parent() ?? undefined, width: 1000, height: 800,
      minWidth: 640, minHeight: 600, title, autoHideMenuBar: true, show: false, backgroundColor: "#101014",
      webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
        webSecurity: true, devTools: false, webviewTag: false, navigateOnDragDrop: false } });
    window.webContents.on("did-fail-load", (_event, errorCode, _description, url, isMainFrame) => {
      // ERR_ABORTED is the normal result of replacing the splash document.
      if (!isMainFrame || errorCode === -3 || url.startsWith("data:") || this.disposed) return;
      if (window === this.loginWindow) this.finish?.(new AccountError("NETWORK"));
    });
    this.owned.add(window);
    window.webContents.on("will-attach-webview", (event) => event.preventDefault());
    window.on("closed", () => this.owned.delete(window));
    return window;
  }

  login(client: AccountClient, onAccepted: () => Promise<void>): Promise<void> {
    if (this.pending) { this.loginWindow?.focus(); return this.pending; }
    const window = this.create(this.labels().login, this.website);
    this.loginWindow = window; this.accepting = false;
    this.pending = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.finish?.(new AccountError("CANCELLED")), 10 * 60 * 1000);
      this.finish = (error) => {
        clearTimeout(timer); this.finish = null;
        this.website.webRequest.onBeforeSendHeaders(null);
        this.loginWindow = null;
        if (!window.isDestroyed()) window.destroy();
        if (error) { client.clear(); reject(error); } else resolve();
      };
      this.website.webRequest.onBeforeSendHeaders({ urls: [`${ITERATE_ORIGIN}/api/*`] }, (details, callback) => {
        const authorization = Object.entries(details.requestHeaders).find(([name]) => name.toLowerCase() === "authorization")?.[1];
        const eligible = this.loginWindow === window
          && details.webContentsId === window.webContents.id
          && parseHttps(details.url)?.origin === ITERATE_ORIGIN;
        callback({ requestHeaders: details.requestHeaders });
        if (!eligible || this.accepting || typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return;
        this.accepting = true;
        void (async () => {
          let accepted = false;
          try {
            await client.accept(authorization.slice(7));
            accepted = true;
            if (this.loginWindow !== window) throw new AccountError("CANCELLED");
            await onAccepted();
            if (this.loginWindow === window) this.finish?.();
          } catch (error: unknown) {
            if (this.loginWindow !== window) return;
            // Once credentials were accepted, a commit failure is terminal for
            // this attempt and must reach the renderer instead of leaving the
            // login window open with no explanation.
            if (accepted) {
              client.clear();
              this.finish?.(error instanceof AccountError ? error : new AccountError("STORAGE"));
            } else {
              this.accepting = false;
            }
          }
        })();
      });
      const restrict = (event: Electron.Event, url: string) => {
        if (parseHttps(url)?.origin !== ITERATE_ORIGIN) event.preventDefault();
      };
      window.webContents.on("will-navigate", restrict);
      window.webContents.on("will-redirect", restrict);
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.on("closed", () => { if (this.loginWindow === window) this.finish?.(new AccountError("CANCELLED")); });
      void this.loadWithSplash(window, `${ITERATE_ORIGIN}/console`).catch(() => this.finish?.(new AccountError("NETWORK")));
    }).finally(() => { this.pending = null; });
    return this.pending;
  }

  async openConsole() {
    if (this.consoleWindow && !this.consoleWindow.isDestroyed()) {
      this.consoleWindow.show(); this.consoleWindow.focus();
      return { opened: true };
    }
    const window = this.create(this.labels().login, this.website);
    this.consoleWindow = window;
    window.on("closed", () => { if (this.consoleWindow === window) this.consoleWindow = null; });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const restrict = (event: Electron.Event, url: string) => {
      if (parseHttps(url)?.origin !== ITERATE_ORIGIN) event.preventDefault();
    };
    window.webContents.on("will-navigate", restrict); window.webContents.on("will-redirect", restrict);
    try { await this.loadWithSplash(window, `${ITERATE_ORIGIN}/console`); }
    catch { window.destroy(); throw new AccountError("NETWORK"); }
    return { opened: true };
  }

  async purchase(url = ITERATE_SHOP) {
    const initial = parseHttps(url);
    if (!initial || initial.origin !== "https://catfk.com") throw new AccountError("PAYMENT_DOMAIN");
    if (this.purchaseWindow && !this.purchaseWindow.isDestroyed()) {
      this.purchaseWindow.show(); this.purchaseWindow.focus();
      return { opened: true };
    }
    const window = this.create(this.labels().purchase, this.purchaseSession);
    this.purchaseWindow = window;
    window.on("closed", () => { if (this.purchaseWindow === window) this.purchaseWindow = null; });
    const openApproved = async (target: string) => {
      const parsed = parseHttps(target); if (!parsed) return;
      if (!this.paymentOrigins.has(parsed.origin)) {
        const labels = this.labels();
        const choice = await dialog.showMessageBox(window, { type: "question", title: labels.purchase,
          message: labels.paymentOrigin, detail: parsed.origin, buttons: [labels.cancel, labels.open], defaultId: 0, cancelId: 0 });
        if (choice.response !== 1 || window.isDestroyed() || this.disposed) return;
        this.paymentOrigins.add(parsed.origin);
      }
      await window.loadURL(target).catch(() => {});
    };
    const restrict = (event: Electron.Event, target: string) => {
      const parsed = parseHttps(target);
      if (parsed && this.paymentOrigins.has(parsed.origin)) return;
      event.preventDefault();
      if (parsed) void openApproved(target);
    };
    window.webContents.on("will-navigate", restrict); window.webContents.on("will-redirect", restrict);
    window.webContents.setWindowOpenHandler(({ url: target }) => { void openApproved(target); return { action: "deny" }; });
    try { await this.loadWithSplash(window, url); }
    catch { window.destroy(); throw new AccountError("NETWORK"); }
    return { opened: true };
  }

  async clear() {
    this.finish?.(new AccountError("CANCELLED"));
    for (const window of this.owned) if (!window.isDestroyed()) window.destroy();
    await this.website.clearStorageData(); await this.website.clearCache();
    await this.purchaseSession.clearStorageData(); await this.purchaseSession.clearCache();
    this.paymentOrigins.clear(); this.paymentOrigins.add("https://catfk.com");
  }
  dispose() {
    this.disposed = true; this.finish?.(new AccountError("CANCELLED"));
    for (const window of this.owned) if (!window.isDestroyed()) window.destroy();
    for (const isolated of [this.website, this.purchaseSession]) isolated.removeListener("will-download", this.preventDownload);
  }
}
