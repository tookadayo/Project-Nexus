import { IdentityVault } from "../../packages/identity/src/index";
import { PrivacyService } from "../../packages/security/src/privacy";
import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { isolatedPostgres } from "../fixtures/postgres";
import {
  connect,
  ensureGuild,
  migrate,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { AttentionQueue } from "../../packages/operations/src/attention-queue";
import { SettingsService, type Actor } from "../../packages/settings/src/index";

let infra: Awaited<ReturnType<typeof isolatedPostgres>>, db: Database;
const now = new Date(),
  channel = "333333333333333333",
  otherChannel = "333333333333333334",
  staffRole = "222222222222222222",
  signingKey = "synthetic-attention-pagination-signing-key";
const actor: Actor = {
  key: "synthetic-attention-admin",
  permissions: "8",
  roles: [],
  source: "WEB_DASHBOARD",
  requestId: "attention-pagination",
};
const messageId = (index: number) =>
  String(444444444444444000n + BigInt(index));
const messageIds = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, index) =>
    messageId(from + index),
  );
const ids = (page: { items: { messageId: string }[] }) =>
  page.items.map((item) => item.messageId);

beforeAll(async () => {
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});

async function fixture(count = 101) {
  const s = { organizationId: randomUUID(), guildId: "111111111111111177" },
    settings = new SettingsService(db);
  await ensureGuild(db, s);
  for (const channelId of [channel, otherChannel])
    await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,visibility_state,observed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${channelId},0,'VISIBLE',${now})`.execute(
      db,
    );
  await settings.update(s, actor, 0, {
    staffRoleIds: [staffRole],
    communityModel: {
      modes: [],
      confirmed: true,
      channels: [
        { channelId: channel, purpose: "SUPPORT" },
        { channelId: otherChannel, purpose: "BUG_REPORT" },
      ],
      forumTags: [],
      voiceThresholdSeconds: 300,
    },
  });
  // All rows deliberately share a timestamp. The unique message key must
  // provide a stable order even across the 50-row API boundary.
  await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,target_surface,reason,opened_at,threshold_seconds,updated_at)
    SELECT ${s.organizationId}::uuid,${s.guildId},${channel},(${messageId(0)}::bigint+sequence)::text,${new Date(+now - 3600000)},'OPEN','TEXT_NEWCOMER','TEXT','DIRECT_REPLY_PENDING',${new Date(+now - 1800000)},1200,${new Date(+now - 1800000)} FROM generate_series(1,${count}) sequence`.execute(
    db,
  );
  return { s, settings, queue: new AttentionQueue(db, signingKey) };
}

it.each([51, 101])(
  "reaches every one of %i equal-time rows exactly once and restores previous/first pages",
  async (count) => {
    const f = await fixture(count),
      pages = [await f.queue.page(f.s, actor, { limit: 50 }, now)];
    while (pages.at(-1)!.nextCursor) {
      // A broken cursor must fail a bounded test rather than loop forever.
      expect(pages.length).toBeLessThan(4);
      pages.push(
        await f.queue.page(
          f.s,
          actor,
          { limit: 50, cursor: pages.at(-1)!.nextCursor! },
          now,
        ),
      );
    }
    const all = pages.flatMap(ids);
    expect(all).toEqual(messageIds(1, count));
    expect(new Set(all).size).toBe(count);
    expect(pages.map((page) => page.items.length)).toEqual(
      count === 51 ? [50, 1] : [50, 50, 1],
    );
    for (const page of pages) {
      expect(page.total).toBe(count);
      expect(page.activeCount).toBe(count);
      expect(page.asOf).toEqual(pages[0]!.asOf);
      expect(page.canOperate).toBe(true);
    }
    const last = pages.at(-1)!;
    expect(last.previousCursor).toBeTruthy();
    expect(
      ids(
        await f.queue.page(
          f.s,
          actor,
          { limit: 50, cursor: last.previousCursor! },
          now,
        ),
      ),
    ).toEqual(ids(pages.at(-2)!));
    expect(
      ids(
        await f.queue.page(
          f.s,
          actor,
          { limit: 50, cursor: last.firstCursor },
          now,
        ),
      ),
    ).toEqual(ids(pages[0]!));
    expect(
      ids(
        await f.queue.page(f.s, actor, { limit: 50, cursor: last.cursor }, now),
      ),
    ).toEqual(ids(last));
  },
);

it("excludes later additions with older post times until an explicit fresh query", async () => {
  const f = await fixture(51),
    first = await f.queue.page(f.s, actor, { limit: 50 }, now),
    after = new Date(+now + 1000);
  await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,target_surface,reason,opened_at,threshold_seconds,updated_at)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${channel},${messageId(0)},${new Date(+now - 7200000)},'OPEN','TEXT_NEWCOMER','TEXT','DIRECT_REPLY_PENDING',${after},1200,${after})`.execute(
    db,
  );
  const next = await f.queue.page(
    f.s,
    actor,
    { limit: 50, cursor: first.nextCursor! },
    after,
  );
  expect(ids(next)).toEqual([messageId(51)]);
  expect(next.total).toBe(51);
  expect(next.asOf).toEqual(first.asOf);
  const restoredFirst = await f.queue.page(
    f.s,
    actor,
    { limit: 50, cursor: next.firstCursor },
    after,
  );
  expect(ids(restoredFirst)).toEqual(messageIds(1, 50));
  const refreshed = await f.queue.page(f.s, actor, { limit: 50 }, after);
  expect(refreshed.total).toBe(52);
  expect(ids(refreshed)[0]).toBe(messageId(0));
});

it("continues after deleting the cursor anchor and does not resurrect a deleted later row", async () => {
  const f = await fixture(),
    first = await f.queue.page(f.s, actor, { limit: 50 }, now);
  await sql`DELETE FROM attention_items WHERE ${tenant(f.s)} AND message_id IN (${messageId(50)},${messageId(75)})`.execute(
    db,
  );
  const next = await f.queue.page(
    f.s,
    actor,
    { limit: 50, cursor: first.nextCursor! },
    now,
  );
  expect(ids(next)).toEqual([...messageIds(51, 74), ...messageIds(76, 101)]);
  expect(next.total).toBe(99);
  expect(next.nextCursor).toBeNull();
  const previous = await f.queue.page(
    f.s,
    actor,
    { limit: 50, cursor: next.previousCursor! },
    now,
  );
  expect(ids(previous)).toEqual(messageIds(1, 49));
});

it("reapplies the current state filter while continuing from an old cursor", async () => {
  const f = await fixture(),
    first = await f.queue.page(f.s, actor, { state: "OPEN", limit: 50 }, now);
  await sql`UPDATE attention_items SET status='ACKNOWLEDGED',version=version+1 WHERE ${tenant(f.s)} AND message_id=${messageId(50)}`.execute(
    db,
  );
  await sql`UPDATE attention_items SET status='RESOLVED',resolved_at=${now},version=version+1 WHERE ${tenant(f.s)} AND message_id IN (${messageId(60)},${messageId(75)})`.execute(
    db,
  );
  const next = await f.queue.page(
    f.s,
    actor,
    { state: "OPEN", limit: 50, cursor: first.nextCursor! },
    now,
  );
  expect(ids(next)).toEqual([
    ...messageIds(51, 59),
    ...messageIds(61, 74),
    ...messageIds(76, 101),
  ]);
  expect(next.items.every((item) => item.status === "OPEN")).toBe(true);
  expect(next.total).toBe(98);
  expect(next.nextCursor).toBeNull();
  const active = await f.queue.page(
    f.s,
    actor,
    { state: "ACTIVE", limit: 50 },
    now,
  );
  expect(active.total).toBe(99);
  expect(
    active.items.find((item) => item.messageId === messageId(50))?.status,
  ).toBe("ACKNOWLEDGED");
  expect(
    ids(await f.queue.page(f.s, actor, { state: "RESOLVED" }, now)),
  ).toEqual([messageId(60), messageId(75)]);
});

it("aligns channel/state totals with visible rows and rejects cross-filter, tenant and forged cursors", async () => {
  const f = await fixture(51),
    other = await fixture(1);
  await sql`UPDATE attention_items SET channel_id=${otherChannel} WHERE ${tenant(f.s)} AND message_id=${messageId(51)}`.execute(
    db,
  );
  const first = await f.queue.page(
    f.s,
    actor,
    { channelId: channel, state: "OPEN", limit: 20 },
    now,
  );
  expect(first.total).toBe(50);
  expect(
    first.items.every(
      (item) => item.channelId === channel && item.status === "OPEN",
    ),
  ).toBe(true);
  const input = {
    channelId: channel,
    state: "OPEN" as const,
    limit: 20,
    cursor: first.nextCursor!,
  };
  await expect(f.queue.page(other.s, actor, input, now)).rejects.toThrow();
  await expect(
    f.queue.page(f.s, actor, { ...input, channelId: otherChannel }, now),
  ).rejects.toThrow();
  await expect(
    f.queue.page(f.s, actor, { ...input, state: "RESOLVED" }, now),
  ).rejects.toThrow();
  const cursor = first.nextCursor!,
    tampered =
      cursor.slice(0, 10) + (cursor[10] === "A" ? "B" : "A") + cursor.slice(11);
  await expect(
    f.queue.page(f.s, actor, { ...input, cursor: tampered }, now),
  ).rejects.toThrow();
  const otherPage = await f.queue.page(
    f.s,
    actor,
    { channelId: otherChannel },
    now,
  );
  expect(otherPage.total).toBe(1);
  expect(ids(otherPage)).toEqual([messageId(51)]);
});

it("rechecks authoritative user channel visibility on every page and hides revoked rows from totals", async () => {
  const f = await fixture(51),
    checked: string[] = [];
  let allowed = true;
  const authorize = async (channelId: string) => {
    checked.push(channelId);
    return allowed;
  };
  const first = await f.queue.page(f.s, actor, { limit: 50 }, now, authorize);
  expect(first.total).toBe(51);
  expect(checked).toContain(channel);
  checked.length = 0;
  allowed = false;
  const next = await f.queue.page(
    f.s,
    actor,
    { limit: 50, cursor: first.nextCursor! },
    now,
    authorize,
  );
  expect(checked).toContain(channel);
  expect(next.items).toEqual([]);
  expect(next.total).toBe(0);
  expect(next.activeCount).toBe(0);
});

it.each(["visibility", "selection", "deletion"] as const)(
  "applies a current channel %s change before reading an old cursor",
  async (change) => {
    const f = await fixture(51),
      first = await f.queue.page(f.s, actor, { limit: 50 }, now);
    if (change === "visibility")
      await sql`UPDATE discord_surface_state SET visibility_state='UNKNOWN' WHERE ${tenant(f.s)} AND channel_id=${channel}`.execute(
        db,
      );
    else if (change === "deletion")
      await sql`UPDATE discord_surface_state SET deleted_at=${now} WHERE ${tenant(f.s)} AND channel_id=${channel}`.execute(
        db,
      );
    else {
      const settings = await f.settings.get(f.s);
      await f.settings.update(f.s, actor, settings.revision, {
        analysisScope: { mode: "include", channelIds: [otherChannel] },
      });
    }
    const next = await f.queue.page(
      f.s,
      actor,
      { limit: 50, cursor: first.nextCursor! },
      now,
    );
    expect(next.items).toEqual([]);
    expect(next.total).toBe(0);
    expect(next.activeCount).toBe(0);
  },
);

it("distinguishes READ from OPERATE and denies an old cursor after READ is revoked", async () => {
  const f = await fixture(51),
    viewer: Actor = {
      ...actor,
      key: "synthetic-staff",
      permissions: "0",
      roles: [staffRole],
    },
    first = await f.queue.page(f.s, viewer, { limit: 50 }, now);
  expect(first.items).toHaveLength(50);
  expect(first.canOperate).toBe(false);
  const settings = await f.settings.get(f.s);
  await f.settings.update(f.s, actor, settings.revision, { staffRoleIds: [] });
  await expect(
    f.queue.page(f.s, viewer, { limit: 50, cursor: first.nextCursor! }, now),
  ).rejects.toThrow("ADMIN_REQUIRED");
  await expect(
    f.queue.page(f.s, { ...actor, permissions: "0" }, {}, now),
  ).rejects.toThrow("ADMIN_REQUIRED");
});

it("applies a reduced current retention window to an existing cursor", async () => {
  const f = await fixture(51);
  await sql`UPDATE attention_items SET detected_at=${new Date(+now - 8 * 86400000)},opened_at=${new Date(+now - 8 * 86400000 + 1200000)} WHERE ${tenant(f.s)}`.execute(
    db,
  );
  const first = await f.queue.page(f.s, actor, { limit: 50 }, now);
  expect(first.total).toBe(51);
  const settings = await f.settings.get(f.s);
  await f.settings.update(f.s, actor, settings.revision, {
    detailedRetentionDays: 7,
  });
  const next = await f.queue.page(
    f.s,
    actor,
    { limit: 50, cursor: first.nextCursor! },
    now,
  );
  expect(next.items).toEqual([]);
  expect(next.total).toBe(0);
  expect(next.activeCount).toBe(0);
});

it("rejects an existing cursor after completed guild deletion", async () => {
  const f = await fixture(51),
    first = await f.queue.page(f.s, actor, { limit: 50 }, now);
  await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,lookup_hash,completed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,NULL,${now})`.execute(
    db,
  );
  await expect(
    f.queue.page(f.s, actor, { limit: 50, cursor: first.nextCursor! }, now),
  ).rejects.toThrow("PRIVACY_DELETED");
});

it("freezes committed membership despite a backdated insert transaction already in flight", async () => {
  const f = await fixture(51);
  let inserted!: () => void, commit!: () => void;
  const ready = new Promise<void>((resolve) => {
      inserted = resolve;
    }),
    finish = new Promise<void>((resolve) => {
      commit = resolve;
    });
  const pending = db.transaction().execute(async (tx) => {
    await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,target_surface,reason,opened_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${channel},${messageId(0)},${new Date(+now - 7200000)},'OPEN','TEXT_NEWCOMER','TEXT','DIRECT_REPLY_PENDING',${new Date(+now - 600000)})`.execute(
      tx,
    );
    inserted();
    await finish;
  });
  await ready;
  const first = await f.queue.page(f.s, actor, { limit: 50 }, now);
  commit();
  await pending;
  await sql`UPDATE attention_items SET status='ACKNOWLEDGED',version=version+1,updated_at=${now} WHERE ${tenant(f.s)} AND message_id=${messageId(51)}`.execute(
    db,
  );
  const next = await f.queue.page(
    f.s,
    actor,
    { limit: 50, cursor: first.nextCursor! },
    now,
  );
  expect(ids(next)).toEqual([messageId(51)]);
  expect(next.items[0]!.status).toBe("ACKNOWLEDGED");
  expect(next.total).toBe(51);
  const rewind = await f.queue.page(
    f.s,
    actor,
    { limit: 50, cursor: next.firstCursor },
    now,
  );
  expect(ids(rewind)).toEqual(messageIds(1, 50));
  const refreshed = await f.queue.page(f.s, actor, { limit: 50 }, now);
  expect(refreshed.total).toBe(52);
  expect(ids(refreshed)[0]).toBe(messageId(0));
});

it("binds cursors to the same actor and page size, and expires them after fifteen minutes", async () => {
  const f = await fixture(51),
    first = await f.queue.page(f.s, actor, { limit: 50 }, now);
  await expect(
    f.queue.page(
      f.s,
      { ...actor, key: "another-authorized-admin" },
      { limit: 50, cursor: first.nextCursor! },
      now,
    ),
  ).rejects.toThrow("INVALID_ATTENTION_CURSOR");
  await expect(
    f.queue.page(f.s, actor, { limit: 20, cursor: first.nextCursor! }, now),
  ).rejects.toThrow("INVALID_ATTENTION_CURSOR");
  await expect(
    f.queue.page(
      f.s,
      actor,
      { limit: 50, cursor: first.nextCursor! },
      new Date(+now + 15 * 60000),
    ),
  ).rejects.toThrow("ATTENTION_CURSOR_EXPIRED");
  const saved = (
    await sql<{
      intent: Record<string, unknown>;
      expires_at: Date;
    }>`SELECT intent,expires_at FROM component_tokens WHERE ${tenant(f.s)} AND intent->>'kind'='attention-page'`.execute(
      db,
    )
  ).rows;
  expect(saved).toHaveLength(1);
  expect(Object.keys(saved[0]!.intent).sort()).toEqual(["kind", "messageIds"]);
  expect(+saved[0]!.expires_at - +now).toBe(15 * 60000);
});

it("revokes every tenant paging membership on a participant deletion without affecting another tenant", async () => {
  const f = await fixture(51),
    other = await fixture(1),
    first = await f.queue.page(f.s, actor, { limit: 50 }, now);
  await f.queue.page(f.s, { ...actor, key: "other-viewer" }, {}, now);
  const otherPage = await other.queue.page(other.s, actor, {}, now);
  const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32)),
    user = "777777777777777777";
  await new PrivacyService(db, vault, f.settings).delete(f.s, user, {
    ...actor,
    key: vault.hash(f.s, user),
  });
  expect(
    (
      await sql`SELECT id FROM component_tokens WHERE ${tenant(f.s)} AND intent->>'kind'='attention-page'`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
  await expect(
    f.queue.page(f.s, actor, { limit: 50, cursor: first.nextCursor! }, now),
  ).rejects.toThrow("ATTENTION_CURSOR_EXPIRED");
  expect(
    (await other.queue.page(other.s, actor, { cursor: otherPage.cursor }, now))
      .total,
  ).toBe(1);
});

it("checks current OPERATE, visible channel, retention and version for each mutation", async () => {
  const f = await fixture(1),
    viewer: Actor = {
      ...actor,
      key: "viewer",
      permissions: "0",
      roles: [staffRole],
    };
  const input = {
    channelId: channel,
    messageId: messageId(1),
    status: "ACKNOWLEDGED" as const,
    version: 0,
  };
  await expect(
    f.queue.action(f.s, viewer, input, async () => true, now),
  ).rejects.toThrow("ADMIN_REQUIRED");
  await expect(
    f.queue.action(f.s, actor, input, async () => false, now),
  ).rejects.toThrow("CHANNEL_PERMISSION_MISSING");
  expect(
    await f.queue.action(f.s, actor, input, async () => true, now),
  ).toMatchObject({ status: "ACKNOWLEDGED", duplicate: false });
  await expect(
    f.queue.action(
      f.s,
      actor,
      { ...input, status: "RESOLVED" },
      async () => true,
      now,
    ),
  ).rejects.toThrow("REVISION_CONFLICT");
  expect(
    await f.queue.action(
      f.s,
      actor,
      { ...input, status: "RESOLVED", version: 1 },
      async () => true,
      now,
    ),
  ).toMatchObject({ status: "RESOLVED", duplicate: false });
  const expired = await fixture(1),
    cfg = await expired.settings.get(expired.s);
  await expired.settings.update(expired.s, actor, cfg.revision, {
    detailedRetentionDays: 7,
  });
  await sql`UPDATE attention_items SET detected_at=${new Date(+now - 8 * 86400000)} WHERE ${tenant(expired.s)}`.execute(
    db,
  );
  await expect(
    expired.queue.action(expired.s, actor, input, async () => true, now),
  ).rejects.toThrow("ATTENTION_NOT_FOUND");
});

it("does not retain a pre-deletion database snapshot while waiting for the privacy lock", async () => {
  const f = await fixture(1);
  let held!: () => void, release!: () => void;
  const acquired = new Promise<void>((resolve) => {
      held = resolve;
    }),
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  const writer = db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"privacy:" + f.s.organizationId + ":" + f.s.guildId},0))`.execute(
      tx,
    );
    held();
    await gate;
    await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,lookup_hash,completed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,NULL,${now})`.execute(
      tx,
    );
  });
  await acquired;
  const read = f.queue.page(f.s, actor, {}, now);
  const rejected = expect(read).rejects.toThrow("PRIVACY_DELETED");
  // The reader queues on the shared privacy lock before the writer commits.
  for (let tries = 0; tries < 100; tries++) {
    const blocked = (
      await sql<{
        n: number;
      }>`SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted`.execute(
        db,
      )
    ).rows[0]!.n;
    if (blocked > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  release();
  await writer;
  await rejected;
});

it("drops saved membership when source rows expire in retention cleanup", async () => {
  const f = await fixture(1),
    first = await f.queue.page(f.s, actor, {}, now);
  await sql`UPDATE attention_items SET detected_at=${new Date(+now - 31 * 86400000)} WHERE ${tenant(f.s)}`.execute(
    db,
  );
  const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32));
  await new PrivacyService(db, vault, f.settings).purge(f.s);
  expect(
    (
      await sql`SELECT id FROM component_tokens WHERE ${tenant(f.s)} AND intent->>'kind'='attention-page'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  await expect(
    f.queue.page(f.s, actor, { cursor: first.cursor }, now),
  ).rejects.toThrow("ATTENTION_CURSOR_EXPIRED");
});

it("returns the full preceding page if every item after the saved anchor was removed", async () => {
  const f = await fixture(51),
    first = await f.queue.page(f.s, actor, {}, now);
  await sql`DELETE FROM attention_items WHERE ${tenant(f.s)} AND message_id=${messageId(51)}`.execute(
    db,
  );
  const empty = await f.queue.page(
    f.s,
    actor,
    { cursor: first.nextCursor! },
    now,
  );
  expect(empty.items).toEqual([]);
  expect(empty.total).toBe(50);
  const previous = await f.queue.page(
    f.s,
    actor,
    { cursor: empty.previousCursor! },
    now,
  );
  expect(ids(previous)).toEqual(messageIds(1, 50));
});

it("can return to a sole surviving anchor after other pages are deleted", async () => {
  const f = await fixture(51),
    first = await f.queue.page(f.s, actor, {}, now);
  await sql`DELETE FROM attention_items WHERE ${tenant(f.s)} AND message_id<>${messageId(50)}`.execute(
    db,
  );
  const empty = await f.queue.page(
    f.s,
    actor,
    { cursor: first.nextCursor! },
    now,
  );
  expect(empty.items).toEqual([]);
  expect(empty.total).toBe(1);
  expect(empty.previousCursor).not.toBeNull();
  const previous = await f.queue.page(
    f.s,
    actor,
    { cursor: empty.previousCursor! },
    now,
  );
  expect(ids(previous)).toEqual([messageId(50)]);
});

it("reports current active counts after snooze, acknowledgement and idempotent handled writes without new page tokens", async () => {
  const f = await fixture(2);
  const first = await f.queue.page(f.s, actor, {}, now);
  expect(first.activeCount).toBe(2);
  const act = (
    status: "SNOOZED" | "ACKNOWLEDGED" | "RESOLVED",
    version: number,
    minutes: 30 | 60 = 30,
  ) =>
    f.queue.action(
      f.s,
      actor,
      { channelId: channel, messageId: messageId(2), status, version, minutes },
      async () => true,
      now,
    );
  const current = () => f.queue.page(f.s, actor, { cursor: first.cursor }, now);
  await act("SNOOZED", 0);
  expect((await current()).activeCount).toBe(1);
  const deadline = async () =>
    (
      await sql<{
        snooze_until: Date;
        version: number;
      }>`SELECT snooze_until,version FROM attention_items WHERE ${tenant(f.s)} AND message_id=${messageId(2)}`.execute(
        db,
      )
    ).rows[0]!;
  const saved = await deadline();
  expect(await act("SNOOZED", 0, 60)).toMatchObject({ duplicate: true });
  expect(await deadline()).toEqual(saved);
  expect((await current()).activeCount).toBe(1);
  await act("ACKNOWLEDGED", 1);
  expect((await current()).activeCount).toBe(2);
  await act("SNOOZED", 2);
  expect((await current()).activeCount).toBe(1);
  await act("RESOLVED", 3);
  expect((await current()).activeCount).toBe(1);
  expect(await act("RESOLVED", 3)).toMatchObject({ duplicate: true });
  expect((await current()).activeCount).toBe(1);
  expect(
    (
      await sql`SELECT id FROM component_tokens WHERE ${tenant(f.s)} AND intent->>'kind'='attention-page'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
});

it("keeps the current active count independent of snapshot membership and filtered totals", async () => {
  const f = await fixture(2);
  await sql`UPDATE attention_items SET channel_id=${otherChannel} WHERE ${tenant(f.s)} AND message_id=${messageId(2)}`.execute(
    db,
  );
  const first = await f.queue.page(f.s, actor, { channelId: channel }, now);
  expect(first).toMatchObject({ total: 1, activeCount: 2 });
  const after = new Date(+now + 1000);
  await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,target_surface,reason,opened_at,threshold_seconds,updated_at)
    VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${channel},${messageId(3)},${new Date(+now - 7200000)},'OPEN','TEXT_NEWCOMER','TEXT','DIRECT_REPLY_PENDING',${after},1200,${after})`.execute(
    db,
  );
  const old = await f.queue.page(
    f.s,
    actor,
    { channelId: channel, cursor: first.cursor },
    after,
  );
  expect(old).toMatchObject({ total: 1, activeCount: 3 });
  expect(ids(old)).toEqual([messageId(1)]);
  const refreshed = await f.queue.page(
    f.s,
    actor,
    { channelId: channel },
    after,
  );
  expect(refreshed).toMatchObject({ total: 2, activeCount: 3 });
  await f.queue.action(
    f.s,
    actor,
    {
      channelId: channel,
      messageId: messageId(3),
      status: "RESOLVED",
      version: 0,
    },
    async () => true,
    after,
  );
  expect(
    await f.queue.page(
      f.s,
      actor,
      { channelId: channel, cursor: refreshed.cursor },
      after,
    ),
  ).toMatchObject({ total: 1, activeCount: 2 });
  const resolved = await f.queue.page(
    f.s,
    actor,
    { state: "RESOLVED", channelId: channel },
    after,
  );
  expect(resolved).toMatchObject({ total: 1, activeCount: 2 });
  const checked: string[] = [];
  const scoped = await f.queue.page(
    f.s,
    actor,
    { state: "RESOLVED", channelId: channel, cursor: resolved.cursor },
    after,
    async (id) => {
      checked.push(id);
      return id === channel;
    },
  );
  expect(scoped).toMatchObject({ total: 1, activeCount: 1 });
  expect(checked.sort()).toEqual([channel, otherChannel].sort());
  await sql`DELETE FROM attention_items WHERE ${tenant(f.s)} AND message_id=${messageId(1)}`.execute(
    db,
  );
  expect(
    await f.queue.page(
      f.s,
      actor,
      { state: "RESOLVED", channelId: channel, cursor: resolved.cursor },
      after,
      async (id) => id === channel,
    ),
  ).toMatchObject({ total: 1, activeCount: 0 });
});

it("fails the whole page instead of reporting a partial active count when another eligible channel cannot be checked", async () => {
  const f = await fixture(2);
  await sql`UPDATE attention_items SET channel_id=${otherChannel} WHERE ${tenant(f.s)} AND message_id=${messageId(2)}`.execute(
    db,
  );
  await expect(
    f.queue.page(f.s, actor, { channelId: channel }, now, async (id) => {
      if (id === otherChannel) throw Error("synthetic Discord unavailable");
      return true;
    }),
  ).rejects.toThrow("synthetic Discord unavailable");
  expect(
    (
      await sql`SELECT id FROM component_tokens WHERE ${tenant(f.s)} AND intent->>'kind'='attention-page'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
});
