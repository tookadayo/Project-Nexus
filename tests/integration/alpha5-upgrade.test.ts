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
import { memberEligibility } from "../../packages/shared/src/member-observation";
let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db, { throughVersion: 25 });
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
it("upgrades alpha.3 and alpha.4 without inventing flags, historical epochs or recipe definitions", async () => {
  const s = { organizationId: randomUUID(), guildId: "111111111111111111" },
    vault = new IdentityVault("aa".repeat(32), "bb".repeat(32));
  await ensureGuild(db, s);
  const identity = await vault.resolve(db, s, "222222222222222222"),
    episode = randomUUID(),
    fact = randomUUID();
  await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context) VALUES(${s.organizationId}::uuid,${s.guildId},${episode}::uuid,${identity}::uuid,now()-interval '1 day','PRODUCTION')`.execute(
    db,
  );
  await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${s.organizationId}::uuid,${s.guildId},${fact}::uuid,${episode}::uuid,'message.sent',now()-interval '1 day','PRODUCTION',${json({ channelId: "333333333333333333", messageId: "444444444444444444", receivedExplicitReply: true, firstReplyLatencySeconds: 60 })})`.execute(
    db,
  );
  await migrate(db, { throughVersion: 26 });
  await sql`INSERT INTO guild_settings(organization_id,guild_id,settings,revision) VALUES(${s.organizationId}::uuid,${s.guildId},${json({ communityModel: { confirmed: true, modes: ["SOCIAL"], channels: [], forumTags: [], voiceThresholdSeconds: 300 } })},1) ON CONFLICT(organization_id,guild_id) DO UPDATE SET settings=EXCLUDED.settings`.execute(
    db,
  );
  const alpha4 = (
    await sql<{
      screening_pending: boolean;
      is_guest: boolean;
    }>`SELECT * FROM membership_episodes WHERE ${tenant(s)}`.execute(db)
  ).rows[0]!;
  expect(alpha4.screening_pending).toBe(false);
  expect(alpha4.is_guest).toBe(false);
  await migrate(db);
  const row = (
    await sql<
      Parameters<typeof memberEligibility>[0]
    >`SELECT * FROM membership_episodes WHERE ${tenant(s)}`.execute(db)
  ).rows[0]!;
  expect(memberEligibility(row)).toBe("UNKNOWN");
  const f = (
    await sql<{
      collection_epoch_id: string | null;
      recipe_version_id: string | null;
      definition_version: string;
    }>`SELECT * FROM lifecycle_events WHERE ${tenant(s)} AND id=${fact}::uuid`.execute(
      db,
    )
  ).rows[0]!;
  expect(f.collection_epoch_id).toBeNull();
  expect(f.recipe_version_id).toBeNull();
  expect(f.definition_version).toBe("alpha4-v1");
  const recipe = (
    await sql<{
      definition: { schemaVersion: number };
      definition_version: string;
    }>`SELECT * FROM measurement_recipe_versions WHERE ${tenant(s)}`.execute(db)
  ).rows[0]!;
  expect(recipe.definition.schemaVersion).toBe(0);
  expect(recipe.definition_version).toBe("alpha4-profile-v1");
  expect(
    (await sql`SELECT * FROM collection_epochs WHERE ${tenant(s)}`.execute(db))
      .rows,
  ).toHaveLength(0);
  expect(
    (
      await sql`SELECT * FROM lifecycle_daily_rollups WHERE ${tenant(s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await sql`SELECT first_reply_seconds FROM message_observations WHERE ${tenant(s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ first_reply_seconds: null }]);
  expect(
    (
      await sql`SELECT * FROM eligible_retention_cohorts WHERE ${tenant(s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  await migrate(db);
  expect(
    (await sql`SELECT * FROM lifecycle_events WHERE ${tenant(s)}`.execute(db))
      .rows,
  ).toHaveLength(1);
  const other = { organizationId: randomUUID(), guildId: s.guildId };
  await ensureGuild(db, other);
  expect(
    (
      await sql`SELECT * FROM lifecycle_daily_rollups WHERE ${tenant(other)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
});
