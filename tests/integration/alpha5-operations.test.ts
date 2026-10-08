import { afterAll, beforeAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import { FakeDiscord } from "../fixtures/discord";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import {
  AttentionOperations,
  teamOperations,
} from "../../packages/operations/src/attention";
import { ActionWorker } from "../../apps/worker/src/actions";
import { DiscordFailure } from "../../packages/discord/src/rest";
import { SettingsService } from "../../packages/settings/src/index";
import { OnboardingService } from "../../packages/onboarding/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { CommunityService } from "../../packages/presentation/src/community";
let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32)),
  now = new Date(),
  channel = "333333333333333333",
  message = "444444444444444444";
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
async function fixture() {
  const s = { organizationId: randomUUID(), guildId: "111111111111111177" };
  await ensureGuild(db, s);
  // Saved operations remain usable through a Gateway gap when their actual
  // observed place and administrator-confirmed purpose remain available.
  await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,visibility_state,observed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${channel},0,'VISIBLE',${now})`.execute(db);
  await new SettingsService(db).update(s,{key:"fixture",permissions:"8",roles:[],source:"SYSTEM",requestId:"saved-attention"},0,{communityModel:{modes:[],confirmed:true,channels:[{channelId:channel,purpose:"SUPPORT"}],forumTags:[],voiceThresholdSeconds:300}});
  const operations = new AttentionOperations(db);
  await operations.addObserved(
    s,
    channel,
    message,
    new Date(now.getTime() - 600000),
    new Date(now.getTime() - 1200000),
  );
  return { s, operations };
}
it("preserves saved attention when current collection is unavailable", async () => {
  const f = await fixture(),
    result = await new CommunityService(db, new SettingsService(db)).overview(
      f.s,
      30,
      now,
    );
  expect(result.daily.ready).toBe(false);
  expect(result.daily.attentionCount).toBeNull();
  expect(result.attention.map((r) => r.messageId)).toContain(message);
  await f.operations.action(f.s, message, channel, "ACKNOWLEDGED", now);
  expect(
    (
      await new CommunityService(db, new SettingsService(db)).overview(
        f.s,
        30,
        now,
      )
    ).attention.find((r) => r.messageId === message)?.status,
  ).toBe("ACKNOWLEDGED");
});
it("keeps ACK/Resolve races and duplicate actions idempotent with a transactional panel outbox", async () => {
  const f = await fixture();
  const result = await Promise.all([
    f.operations.action(f.s, message, channel, "ACKNOWLEDGED", now),
    f.operations.action(f.s, message, channel, "ACKNOWLEDGED", now),
  ]);
  expect(result.filter((r) => r.duplicate)).toHaveLength(1);
  expect(
    (
      await sql`SELECT id FROM action_outbox WHERE ${tenant(f.s)} AND kind='PANEL_REFRESH'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  await Promise.all([
    f.operations.action(f.s, message, channel, "RESOLVED", now),
    f.operations.action(f.s, message, channel, "RESOLVED", now),
  ]);
  expect(
    (await sql`SELECT id FROM action_outbox WHERE ${tenant(f.s)}`.execute(db))
      .rows,
  ).toHaveLength(2);
  const stats = await teamOperations(
    db,
    f.s,
    new Date(now.getTime() - 3600000),
    new Date(now.getTime() + 1),
  );
  expect(stats.openBacklog).toBe(0);
  expect(stats.medianAcknowledgementSeconds).toBe(600);
  expect(stats.medianResolutionSeconds).toBe(600);
  expect(JSON.stringify(stats)).not.toMatch(/actor|moderator|admin/);
  await expect(
    f.operations.action(f.s, message, channel, "ACKNOWLEDGED"),
  ).rejects.toThrow("ATTENTION_NOT_ACTIVE");
});
it("snoozes until a valid future time and scopes colliding message keys by organization", async () => {
  const a = await fixture(),
    b = await fixture();
  await a.operations.action(
    a.s,
    message,
    channel,
    "SNOOZED",
    now,
    new Date(now.getTime() + 1800000),
  );
  expect(
    (
      await sql<{
        status: string;
      }>`SELECT status FROM attention_items WHERE ${tenant(b.s)}`.execute(db)
    ).rows[0]!.status,
  ).toBe("OPEN");
  await expect(
    b.operations.action(b.s, message, channel, "SNOOZED", now, null),
  ).rejects.toThrow("INVALID_SNOOZE");
});
it.each([429, 500, 0])(
  "safely retries idempotent panel edits after HTTP %i",
  async (status) => {
    const f = await fixture();
    await f.operations.action(f.s, message, channel, "RESOLVED");
    await sql`INSERT INTO settings_panels VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${channel},${message})`.execute(
      db,
    );
    const discord = new FakeDiscord();
    let attempts = 0;
    discord.editPanel = async () => {
      if (++attempts === 1)
        throw new DiscordFailure(status, 2, {
          kind: status === 0 ? "timeout" : "http",
        });
    };
    const worker = new ActionWorker(
      db,
      vault,
      discord,
      new OnboardingService(db, new SettingsService(db), vault),
      undefined,
      async () => ({ content: "safe panel" }),
    );
    await worker.tick(f.s);
    const first = (
      await sql<{
        state: string;
        error_category: string;
        attempts: number;
      }>`SELECT state,error_category,attempts FROM action_outbox WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows[0]!;
    expect(first.state).toBe("PENDING");
    expect(first.attempts).toBe(1);
    await sql`UPDATE action_outbox SET available_at=now() WHERE ${tenant(f.s)}`.execute(
      db,
    );
    await Promise.all([worker.tick(f.s), worker.tick(f.s)]);
    const last = (
      await sql<{
        state: string;
        completed_at: Date | null;
      }>`SELECT state,completed_at FROM action_outbox WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows[0]!;
    expect(last.state).toBe("SUCCEEDED");
    expect(last.completed_at).not.toBeNull();
    expect(attempts).toBe(2);
  },
);
