import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
  json,
  type Database,
} from "../../packages/db/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { PrivacyService } from "../../packages/security/src/privacy";
import { SettingsService } from "../../packages/settings/src/index";
import {
  projectReactionState,
  resetReactionState,
  projectPollState,
} from "../../packages/lifecycle/src/typed-state";
import { activityRollups } from "../../packages/lifecycle/src/rollups";
import { projectAdaptiveMember } from "../../packages/lifecycle/src/adaptive-projector";
import { projectObservation } from "../../packages/lifecycle/src/observation";
import type { Envelope } from "../../packages/events/src/index";
let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
const channel = "333333333333333333",
  message = "444444444444444444",
  hash = "a".repeat(64),
  emoji = "b".repeat(64),
  time = new Date("2026-10-02T00:00:00Z");
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
async function scope() {
  const s = { organizationId: randomUUID(), guildId: "111111111111111111" };
  await ensureGuild(db, s);
  return s;
}
function event(
  s: Awaited<ReturnType<typeof scope>>,
  sequence: number,
  kind: Envelope["kind"],
  fields: Partial<Envelope> = {},
): Envelope {
  return {
    ...s,
    shardId: 0,
    gatewaySessionId: "projection",
    sequence,
    at: new Date(time.getTime() + sequence * 1000).toISOString(),
    context: "PRODUCTION",
    kind,
    channelId: channel,
    messageId: message,
    emojiHash: emoji,
    ...fields,
  };
}
it("replayed and permuted reactions converge, including remove-all before an unobserved older addition", async () => {
  for (const order of [
    [1, 2, 3, 4, 5],
    [5, 3, 1, 4, 2],
    [3, 2, 2, 1, 4, 5],
  ]) {
    const s = await scope();
    for (const n of order) {
      const e = event(
        s,
        n,
        n === 5
          ? "reaction.removed_all"
          : n === 3
            ? "reaction.removed"
            : "reaction.added",
      );
      await db.transaction().execute(async (tx) => {
        if (n === 5) await resetReactionState(tx, s, e);
        else await projectReactionState(tx, s, e, hash, null);
      });
    }
    await db
      .transaction()
      .execute((tx) =>
        projectReactionState(
          tx,
          s,
          event(s, 4, "reaction.added"),
          "c".repeat(64),
          null,
        ),
      );
    expect(
      (
        await sql`SELECT * FROM reaction_state WHERE ${tenant(s)} AND active`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
    await db
      .transaction()
      .execute((tx) =>
        projectReactionState(tx, s, event(s, 6, "reaction.added"), hash, null),
      );
    expect(
      (
        await sql`SELECT * FROM reaction_state WHERE ${tenant(s)} AND active`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(1);
  }
});
it("keeps multi-answer polls independent, removes the last answer, and supports a re-vote", async () => {
  const s = await scope(),
    answer1 = "d".repeat(64),
    answer2 = "e".repeat(64);
  const vote = async (n: number, kind: Envelope["kind"], answerHash: string) =>
    db
      .transaction()
      .execute((tx) =>
        projectPollState(tx, s, event(s, n, kind, { answerHash }), hash),
      );
  await vote(2, "poll.vote_added", answer2);
  await vote(1, "poll.vote_added", answer1);
  expect((await vote(3, "poll.vote_removed", answer1))?.answers).toEqual([
    answer2,
  ]);
  expect((await vote(4, "poll.vote_removed", answer2))?.answers).toEqual([]);
  expect(await vote(3, "poll.vote_added", answer1)).toBeNull();
  expect((await vote(5, "poll.vote_added", answer1))?.answers).toEqual([
    answer1,
  ]);
  const other = { organizationId: randomUUID(), guildId: s.guildId };
  await ensureGuild(db, other);
  expect(
    (
      await sql`SELECT * FROM poll_participant_state WHERE ${tenant(other)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
});
it("marks an unorderable cross-session tie ambiguous instead of claiming complete current state", async () => {
  const s = await scope(),
    e = event(s, 1, "reaction.added");
  await projectReactionState(db, s, e, hash, null);
  const result = await projectReactionState(
    db,
    s,
    { ...e, kind: "reaction.removed", gatewaySessionId: "other" },
    hash,
    null,
  );
  expect(result.ambiguous).toBe(true);
});
async function member(s: Awaited<ReturnType<typeof scope>>) {
  const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32)),
    user = "222222222222222222",
    identity = await vault.resolve(db, s, user),
    episode = randomUUID();
  await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context,screening_observed_at,guest_observed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${episode}::uuid,${identity}::uuid,${time},'PRODUCTION',${time},${time})`.execute(
    db,
  );
  return { vault, user, episode, hash: vault.hash(s, user) };
}
it("uses voice leave tombstones so delayed joins cannot resurrect a session", async () => {
  const s = await scope(),
    m = await member(s),
    cfg = await new SettingsService(db).get(s);
  await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,observed_at,visibility_state) VALUES(${s.organizationId}::uuid,${s.guildId},${channel},2,${time},'VISIBLE')`.execute(
    db,
  );
  const send = async (e: Envelope) =>
    db
      .transaction()
      .execute((tx) => projectAdaptiveMember(tx, s, e, cfg, m.hash, m.episode));
  await send(event(s, 2, "voice.state", { channelId: null }));
  await send(event(s, 1, "voice.state"));
  expect(
    (
      await sql`SELECT * FROM voice_sessions WHERE ${tenant(s)} AND channel_id IS NOT NULL`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
  await send(event(s, 3, "voice.state"));
  expect(
    (
      await sql`SELECT * FROM voice_sessions WHERE ${tenant(s)} AND channel_id IS NOT NULL`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  await projectObservation(db, s, event(s, 3, "telemetry.heartbeat"));
  await projectObservation(db, s, event(s, 200, "telemetry.heartbeat"));
  expect(
    (
      await sql`SELECT * FROM voice_sessions WHERE ${tenant(s)} AND channel_id IS NOT NULL`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await sql`SELECT * FROM collection_epochs WHERE ${tenant(s)} AND end_reason='GATEWAY_GAP'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
});
it("rollups preserve exact boundaries, late updates, and member deletion without storing content", async () => {
  const s = await scope(),
    m = await member(s),
    ids: string[] = [];
  for (const [n, at] of [
    "2026-10-02T10:00:00Z",
    "2026-10-03T10:00:00Z",
    "2026-10-03T11:00:00Z",
    "2026-10-04T10:00:00Z",
  ].entries()) {
    const id = randomUUID();
    ids.push(id);
    await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${m.episode}::uuid,'message.sent',${new Date(at)},'PRODUCTION',${json({ channelId: channel, messageId: String(444444444444444440n + BigInt(n)), content: "must not enter rollups" })})`.execute(
      db,
    );
  }
  await sql`UPDATE lifecycle_events SET data=data||' {"receivedExplicitReply":true,"firstReplyLatencySeconds":60}'::jsonb WHERE ${tenant(s)} AND id=${ids[1]}::uuid`.execute(
    db,
  );
  const facts = await activityRollups(
    db,
    s,
    new Date("2026-10-02T12:00:00Z"),
    new Date("2026-10-04T09:00:00Z"),
  );
  expect(facts).toHaveLength(2);
  expect(facts[0]!.data.receivedExplicitReply).toBe(true);
  expect(
    (
      await sql<{
        data: unknown;
      }>`SELECT first_data AS data FROM lifecycle_daily_rollups WHERE ${tenant(s)}`.execute(
        db,
      )
    ).rows.every((r) => !("content" in (r.data as object))),
  ).toBe(true);
  await sql`DELETE FROM lifecycle_events WHERE ${tenant(s)} AND id=${ids[2]}::uuid`.execute(
    db,
  );
  expect(
    await activityRollups(
      db,
      s,
      new Date("2026-10-02T12:00:00Z"),
      new Date("2026-10-04T09:00:00Z"),
    ),
  ).toHaveLength(1);
  await new PrivacyService(db, m.vault, new SettingsService(db)).delete(
    s,
    m.user,
    {
      key: m.hash,
      permissions: "0",
      roles: [],
      source: "WEB_DASHBOARD",
      requestId: "privacy-projection",
    },
  );
  for (const table of [
    "message_observations",
    "lifecycle_daily_rollups",
    "member_daily_activity",
    "voice_sessions",
  ])
    expect(
      (
        await sql`SELECT * FROM ${sql.table(table)} WHERE ${tenant(s)}`.execute(
          db,
        )
      ).rows,
    ).toEqual([]);
});

it("preserves an interior reaction cutoff without double counting boundary facts", async () => {
  const s = await scope(),
    m = await member(s);
  for (const [n, at] of [
    "2026-10-03T10:00:00Z",
    "2026-10-03T12:00:00Z",
    "2026-10-03T13:00:00Z",
    "2026-10-03T14:00:00Z",
  ].entries())
    await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${m.episode}::uuid,'reaction.received',${new Date(at)},'PRODUCTION',${json({ channelId: channel, messageId: String(444444444444444440n + BigInt(n)) })})`.execute(
      db,
    );
  const rows = await activityRollups(
    db,
    s,
    new Date("2026-10-02T12:00:00Z"),
    new Date("2026-10-04T09:00:00Z"),
    new Date("2026-10-03T11:00:00Z"),
  );
  expect(rows).toHaveLength(3);
  expect(rows.reduce((n, r) => n + r.reaction_count, 0)).toBe(3);
  expect(rows.map((r) => r.occurred_at.toISOString())).toEqual([
    "2026-10-03T12:00:00.000Z",
    "2026-10-03T13:00:00.000Z",
    "2026-10-03T14:00:00.000Z",
  ]);
});
