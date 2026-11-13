import { AccountError, ITERATE_ORIGIN, object, positiveId, secret, text } from "./contract";

export type AccountFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Fixed-origin, bounded HTTP transport; never retries a mutating request. */
export class AccountClient {
  private access: string | null = null;
  private userId: number | null = null;
  private refreshing: Promise<void> | null = null;
  private generation = 0;
  constructor(private readonly fetch: AccountFetch) {}
  get id() { return this.userId; }
  clear() { this.generation++; this.access = null; this.userId = null; }

  async request(path: string, body?: unknown, options: { anonymous?: boolean; key?: string } = {}): Promise<unknown> {
    if (!path.startsWith("/") || path.startsWith("//") || new URL(path, ITERATE_ORIGIN).origin !== ITERATE_ORIGIN) throw new AccountError("REJECTED");
    try {
      const credential = options.key ?? (options.anonymous ? null : this.access);
      const response = await this.fetch(`${ITERATE_ORIGIN}${path}`, {
        method: body === undefined ? "GET" : "POST", redirect: "error", credentials: "include",
        signal: AbortSignal.timeout(30000),
        headers: { Accept: "application/json", Origin: ITERATE_ORIGIN,
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 && !options.key) throw new AccountError("LOGIN_REQUIRED");
        if (response.status >= 500) throw new AccountError("NETWORK");
        throw new AccountError("REJECTED");
      }
      if (!response.body) throw new AccountError("INVALID_RESPONSE");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > 4 * 1024 * 1024) throw new AccountError("INVALID_RESPONSE");
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const result = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (path === "/v1/models") return result;
      if (result.success !== true) throw new AccountError("REJECTED");
      return result.data;
    } catch (error) {
      if (error instanceof AccountError) throw error;
      throw new AccountError("NETWORK");
    }
  }

  async accept(candidate: unknown, expected?: number): Promise<void> {
    const generation = this.generation;
    const key = secret(candidate);
    const user = object(await this.request("/api/user/self", undefined, { key }));
    const id = positiveId(user.id);
    if (generation !== this.generation) throw new AccountError("CANCELLED");
    if (expected !== undefined && id !== expected) { this.clear(); throw new AccountError("LOGIN_REQUIRED"); }
    this.access = key; this.userId = id;
  }

  async refresh(expected?: number): Promise<void> {
    if (!this.refreshing) {
      const generation = this.generation;
      this.refreshing = (async () => {
        const bundle = object(await this.request("/api/user/auth/refresh", {}, { anonymous: true }));
        if (generation !== this.generation) throw new AccountError("CANCELLED");
        await this.accept(bundle.access_token, expected ?? this.userId ?? undefined);
      })().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  async authenticated(): Promise<void> {
    if (!this.userId) throw new AccountError("LOGIN_REQUIRED");
    try { await this.refresh(this.userId); }
    catch (error) { if (error instanceof AccountError && ["LOGIN_REQUIRED", "REJECTED"].includes(error.code)) this.clear(); throw error; }
  }

  async identity() {
    const user = object(await this.request("/api/user/self"));
    const id = positiveId(user.id);
    if (id !== this.userId) { this.clear(); throw new AccountError("LOGIN_REQUIRED"); }
    if (typeof user.quota !== "number" || !Number.isSafeInteger(user.quota)) throw new AccountError("INVALID_RESPONSE");
    return { id, name: text(user.display_name || user.username), quota: user.quota };
  }
}
