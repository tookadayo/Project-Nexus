import { randomUUID } from "node:crypto";
import {
  ensureGuild,
  sql,
  json,
  type Database,
} from "../../packages/db/src/index";
import { SettingsService, type Actor } from "../../packages/settings/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { buildCapabilitySnapshot } from "../../packages/discord/src/discovery";
import { representativeSource } from "./community-profiles";
import { completedWindow } from "../../packages/analysis/src/index";
import { FakeDiscord } from "./discord";
export const analysisVault = new IdentityVault(
  "aa".repeat(32),
  "bb".repeat(32),
);
export async function analysisFixture(
  db: Database,
  plan = "FREE",
  withData = true,
  scope?: {organizationId:string;guildId:string},
) {
  const s = scope ?? { organizationId: randomUUID(), guildId: "111111111111111111" },
    user = "222222222222222222",
    channel = "933333333333333330",
    settings = new SettingsService(db);
  await ensureGuild(db, s);
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status) VALUES(${s.organizationId}::uuid,${s.guildId},${plan},'active')`.execute(
    db,
  );
  const actor: Actor = {
      key: analysisVault.hash(s, user),
      encryptedUserId: analysisVault.seal(s, user),
      permissions: "8",
      roles: [],
      source: "DISCORD_PANEL",
      requestId: randomUUID(),
    },
    discord = new FakeDiscord();
  discord.members.set(user, {
    permissions: "8",
    roles: [],
    bot: false,
    joinedAt: "2026-01-01T00:00:00Z",
  });
  const { start, end } = completedWindow(30),
    at = new Date(end.getTime() - 2 * 86400000),
    joined = new Date(start.getTime() + 86400000),
    epoch = randomUUID();
  await settings.update(s, actor, 0, {
    communityModel: {
      modes: ["SOCIAL", "SUPPORT_QA"],
      confirmed: true,
      forumTags: [],
      voiceThresholdSeconds: 300,
      channels: [{ channelId: channel, purpose: "SUPPORT" }],
    },
  });
  const snapshot = buildCapabilitySnapshot(representativeSource(0), new Date());
  await sql`INSERT INTO guild_capability_snapshots VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${json(snapshot)},now())`.execute(
    db,
  );
  await sql`INSERT INTO discord_integration_health(organization_id,guild_id,gateway_state,last_gateway_at,intents,last_refresh_at,updated_at) VALUES(${s.organizationId}::uuid,${s.guildId},'CONNECTED',now(),' {"members":"AVAILABLE","messages":"AVAILABLE","voice":"AVAILABLE","scheduledEvents":"AVAILABLE"}'::jsonb,now(),now())`.execute(
    db,
  );
  await sql`INSERT INTO collection_epochs(organization_id,guild_id,id,source,started_at,start_reason) VALUES(${s.organizationId}::uuid,${s.guildId},${epoch}::uuid,'GATEWAY',${start},'FIRST_OBSERVATION')`.execute(
    db,
  );
  if (withData) {
    const identity = await analysisVault.resolve(db, s, user),
      episode = randomUUID();
    await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context,screening_observed_at,guest_observed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${episode}::uuid,${identity}::uuid,${joined},'PRODUCTION',${joined},${joined})`.execute(
      db,
    );
    await sql`INSERT INTO member_observable_state(organization_id,guild_id,episode_id,roles,roles_observed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${episode}::uuid,'{}',${joined})`.execute(
      db,
    );
    for (let index = 0; index < 7; index++)
      await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',${at},'PRODUCTION',${json({ channelId: channel, messageId: String(444444444444444440n + BigInt(index)), ...(index < 5 ? { firstReplyLatencySeconds: 120 + index } : {}) })})`.execute(
        db,
      );
  }
  return { s, actor, settings, discord, user, channel, start, end };
}
