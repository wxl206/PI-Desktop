import { randomBytes } from "node:crypto";
import { AccountError, object, positiveId, secret } from "./contract";
import type { AccountClient } from "./client";
import type { AccountJournal, JournalStore, KeyRecord } from "./journal";

export class AccountKeys {
  constructor(private readonly client: AccountClient, private readonly store: JournalStore) {}

  private async search(name: string): Promise<Record<string, unknown>[]> {
    const matches: Record<string, unknown>[] = [];
    for (let page = 1; page <= 100; page++) {
      const data = object(await this.client.request(`/api/token/search?keyword=${encodeURIComponent(name)}&p=${page}&page_size=100`));
      if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total) || Number(data.total) < 0) throw new AccountError("INVALID_RESPONSE");
      for (const raw of data.items) { const item = object(raw); if (item.name === name) matches.push(item); }
      if (page * 100 >= Number(data.total)) return matches;
    }
    throw new AccountError("KEY_UNCERTAIN");
  }

  async ensure(journal: AccountJournal, group: string): Promise<{ record: KeyRecord; key: string }> {
    const user = this.client.id; if (!user) throw new AccountError("LOGIN_REQUIRED");
    let record = journal.records.find((item) => item.user === user && item.group === group);
    if (!record) {
      record = { user, group, name: `iterate-pi-${journal.installation.slice(0, 8)}-${randomBytes(12).toString("hex")}`,
        state: "prepared", tokenId: null, providers: [] };
      journal.records.push(record);
      await this.store.save(journal);
    }
    let matches = await this.search(record.name);
    if (!matches.length && record.state === "prepared") {
      record.state = "pending";
      await this.store.save(journal);
      await this.client.request("/api/token/", {
        name: record.name, group, expired_time: -1, unlimited_quota: true, remain_quota: 0,
        model_limits_enabled: false, model_limits: "", allow_ips: "", cross_group_retry: false, allow_user_quota_query: false,
      });
      matches = await this.search(record.name);
    }
    if (matches.length !== 1) throw new AccountError("KEY_UNCERTAIN");
    const token = matches[0]; const id = positiveId(token.id);
    if (token.group !== group || token.status !== 1 || (token.user_id !== undefined && token.user_id !== user)
      || (record.tokenId !== null && record.tokenId !== id)
      || typeof token.expired_time !== "number" || (token.expired_time !== -1 && token.expired_time <= Date.now() / 1000)) throw new AccountError("KEY_CHANGED");
    record.tokenId = id; record.state = "created";
    await this.store.save(journal);
    const revealed = object(await this.client.request(`/api/token/${id}/key`, {}));
    return { record, key: secret(revealed.key) };
  }
}
