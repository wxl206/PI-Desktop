import { randomBytes } from "node:crypto";
import type { IterateApiStyle } from "@pi-desktop/shared";
import { AccountError, object } from "./contract";

export type KeyRecord = {
  user: number; group: string; name: string;
  state: "prepared" | "pending" | "created"; tokenId: number | null;
  rotationPending: boolean;
  providers: Array<{ id: string; style: IterateApiStyle }>;
};
export type AccountJournal = {
  version: 2; revision: number; installation: string;
  activeUser: number | null; redemptionUsers: number[]; records: KeyRecord[];
};
export type AccountHost = { call<T = unknown>(method: string, params?: unknown): Promise<T> };

/** The Host validates the versioned journal and serializes CAS writes in SQLite. */
export class JournalStore {
  constructor(private readonly getHost: () => AccountHost | null) {}
  private async call<T>(method: string, params?: unknown): Promise<T> {
    const host = this.getHost(); if (!host) throw new AccountError("STORAGE");
    try {
      const value = await host.call<T>(method, params);
      if (this.getHost() !== host) throw new AccountError("STORAGE");
      return value;
    } catch { throw new AccountError("STORAGE"); }
  }
  async read(): Promise<AccountJournal> {
    const value = await this.call<AccountJournal | null>("iterateAccount.get");
    if (value === null) return {
      version: 2, revision: 0, installation: randomBytes(12).toString("hex"),
      activeUser: null, redemptionUsers: [], records: [],
    };
    // Host owns full validation; refuse protocol drift rather than silently replacing data.
    if (object(value).version !== 2 || !Array.isArray(value.redemptionUsers)
      || !Array.isArray(value.records)) throw new AccountError("STORAGE");
    return value;
  }
  async save(journal: AccountJournal): Promise<void> {
    const next = await this.call<AccountJournal>("iterateAccount.set", journal);
    journal.revision = next.revision;
  }
  host() {
    const host = this.getHost(); if (!host) throw new AccountError("STORAGE");
    return { call: <T = unknown>(method: string, params?: unknown) => this.call<T>(method, params) };
  }
}
