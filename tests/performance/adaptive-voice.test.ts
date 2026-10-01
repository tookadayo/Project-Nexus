import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  type Database,
} from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { SettingsService } from "../../packages/settings/src/index";
import {
  projectAdaptiveMember,
  tickVoice,
} from "../../packages/lifecycle/src/adaptive-projector";
import type { Envelope } from "../../packages/events/src/index";

let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
it("keeps 600 voice participants in linear state, processes a bounded tick and creates no pair graph", async () => {
  const s = scopeForGuild("911111111111111111"),
    vault = new IdentityVault("aa".repeat(32), "bb".repeat(32)),
    settings = new SettingsService(db),
    now = new Date(),
    channel = "933333333333333339";
  await ensureGuild(db, s);
  await settings.update(
    s,
    {
      key: "performance",
      permissions: "8",
      roles: [],
      source: "SYSTEM",
      requestId: "voice-perf",
    },
    0,
    {
      communityModel: {
        modes: ["VOICE"],
        confirmed: true,
        channels: [],
        forumTags: [],
        voiceThresholdSeconds: 300,
      },
    },
  );
  const cfg = await settings.get(s),
    members: Array<{ hash: string; episode: string }> = [];
  await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,observed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${channel},2,${now})`.execute(
    db,
  );
  for (let i = 0; i < 600; i++) {
    const user = String(922222222222220000n + BigInt(i)),
      id = await vault.resolve(db, s, user),
      episode = randomUUID();
    await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context) VALUES(${s.organizationId}::uuid,${s.guildId},${episode}::uuid,${id}::uuid,${now},'PRODUCTION')`.execute(
      db,
    );
    members.push({ hash: vault.hash(s, user), episode });
  }
  const started = performance.now();
  for (const [sequence, member] of members.entries())
    await db
      .transaction()
      .execute((tx) =>
        projectAdaptiveMember(
          tx,
          s,
          {
            ...s,
            shardId: 0,
            gatewaySessionId: "voice-perf",
            sequence,
            context: "PRODUCTION",
            at: now.toISOString(),
            kind: "voice.state",
            channelId: channel,
          } satisfies Envelope,
          cfg,
          member.hash,
          member.episode,
        ),
      );
  const qualifiedAt = new Date(now.getTime() + 301000);
  await db.transaction().execute((tx) => tickVoice(tx, s, cfg, qualifiedAt));
  expect(
    (
      await sql`SELECT id FROM adaptive_facts WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId} AND kind='voice.copresence'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(500);
  await db.transaction().execute((tx) => tickVoice(tx, s, cfg, qualifiedAt));
  expect(
    (
      await sql`SELECT id FROM adaptive_facts WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId} AND kind='voice.copresence'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(600);
  const states = (
    await sql<{
      domain: string;
      count: number;
    }>`SELECT domain,count(*)::integer AS count FROM adaptive_states WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId} GROUP BY domain`.execute(
      db,
    )
  ).rows;
  expect(states.find((r) => r.domain === "voice")?.count).toBe(600);
  expect(states.find((r) => r.domain === "voice-channel")?.count).toBe(1);
  expect(
    (
      await sql`SELECT episode_id FROM member_interaction_pairs WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  const duration = performance.now() - started;
  expect(duration).toBeLessThan(30000);
  process.stdout.write(
    `Adaptive voice 600: ${Math.round(duration)} ms; 600 sessions, 1 channel clock, 0 pairs\n`,
  );
  // A safety gap invalidates duration for all sessions, including members beyond the tick bound.
  await db.transaction().execute(async (tx) => {
    const { projectStructure } =
      await import("../../packages/lifecycle/src/adaptive-projector");
    await projectStructure(
      tx,
      s,
      {
        ...s,
        shardId: 0,
        gatewaySessionId: "voice-perf",
        sequence: 601,
        context: "PRODUCTION",
        at: qualifiedAt.toISOString(),
        kind: "telemetry.disconnected",
      },
      cfg,
    );
  });
  expect(
    (
      await sql`SELECT state_key FROM adaptive_states WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId} AND domain IN ('voice','voice-channel')`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
});
