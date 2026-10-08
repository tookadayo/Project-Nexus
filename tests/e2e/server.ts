import EmbeddedPostgres from "embedded-postgres";
import { buildCapabilitySnapshot } from "../../packages/discord/src/discovery";
import { mkdtemp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  json,
} from "../../packages/db/src/index.js";
import { scopeForGuild } from "../../packages/security/src/index.js";
import { SettingsService } from "../../packages/settings/src/index.js";
import { AnalyticsService } from "../../packages/analytics/src/index.js";
import { IdentityVault } from "../../packages/identity/src/index.js";
import { createApi } from "../../apps/api/src/server.js";
import type { DiscordPort } from "../../packages/discord/src/rest.js";
import {
  openCollectionEpoch,
  projectObservation,
} from "../../packages/lifecycle/src/observation.js";
await mkdir(".local", { recursive: true });
const dir = await mkdtemp(resolve(".local/pg-e2e-"));
const pgPort = await new Promise<number>((resolvePort, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    if (!address || typeof address === "string")
      return reject(new Error("NO_TEST_PORT"));
    probe.close(() => resolvePort(address.port));
  });
});
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "nexus",
  password: "nexus",
  port: pgPort,
  persistent: true,
  onLog: () => {},
  onError: () => {},
});
await pg.initialise();
await pg.start();
const db = connect(`postgresql://nexus:nexus@127.0.0.1:${pgPort}/postgres`);
await migrate(db);
const s = scopeForGuild("321111111111111111");
await ensureGuild(db, s);
await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,visibility_state,observed_at) SELECT ${s.organizationId}::uuid,${s.guildId},id,0,'VISIBLE',now() FROM (VALUES ('621111111111111111'),('621111111111111112')) channels(id)`.execute(db);
await sql`INSERT INTO guild_capability_snapshots VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${json(
  buildCapabilitySnapshot({
    features: [],
    memberCount: 80,
    afkChannelId: null,
    incidents: {},
    channels: [
      {
        id: "621111111111111111",
        type: 0,
        parentId: null,
        observable: true,
        tagIds: [],
      },
      {
        id: "621111111111111112",
        type: 0,
        parentId: null,
        observable: true,
        tagIds: [],
      },
    ],
    threads: [],
    onboarding: null,
    endpointStatus: {
      channels: "AVAILABLE",
      threads: "AVAILABLE",
      onboarding: "UNAVAILABLE",
      autoMod: "PERMISSION_MISSING",
      events: "AVAILABLE",
    },
    ruleCount: null,
    welcomeCount: null,
    scheduledEvents: [],
  }),
)},now())`.execute(db);
const settings = new SettingsService(db);
await settings.update(
  s,
  {
    key: "e2e-admin",
    permissions: "32",
    roles: [],
    source: "SYSTEM",
    requestId: randomUUID(),
  },
  0,
  {
    enabled: true,
    communityModel: {
      modes: ["SOCIAL"],
      confirmed: true,
      channels: [{ channelId: "621111111111111111", purpose: "SUPPORT" }],
      forumTags: [],
      voiceThresholdSeconds: 300,
    },
    flags: {
      native_capability_v2: true,
      native_snapshot_v2: true,
      activation_dsl_v2: true,
      interventions_v2: true,
      experiments_v2: true,
      billing_v1: true,
    },
  },
);
const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32));
const now = new Date();
// Explicit synthetic observation evidence; the fixture is never production data.
await openCollectionEpoch(
  db,
  s,
  new Date(now.getTime() - 31 * 86400000),
  "BOT_INSTALLED",
);
const heartbeat = async () => {
  await projectObservation(db, s, {
    ...s,
    shardId: 0,
    gatewaySessionId: "synthetic-browser-fixture",
    sequence: 0,
    context: "PRODUCTION",
    kind: "telemetry.connected",
    requestedIntents: [
      "members",
      "messages",
      "reactions",
      "polls",
      "voice",
      "scheduledEvents",
      "autoMod",
    ],
    at: new Date().toISOString(),
  });
  await sql`UPDATE telemetry_cursor SET last_seen=now() WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId}`.execute(
    db,
  );
};
await heartbeat();
await sql`UPDATE discord_integration_health SET rest_state='AVAILABLE',last_refresh_at=${now} WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId}`.execute(
  db,
);
await sql`INSERT INTO guild_capabilities(organization_id,guild_id,id,profile,checked_at) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${json({ coverage: "healthy", sendMessages: true, manageRoles: true, nativeOnboardingEnabled: false, recommendedMode: "fallback" })},${now})`.execute(
  db,
);
const joined = new Date(now.getTime() - 9 * 86400000);
for (let i = 0; i < 24; i++) {
  const identityId = await vault.resolve(
    db,
    s,
    String(BigInt("421111111111111111") + BigInt(i)),
  );
  const episode = randomUUID();
  await sql`INSERT INTO membership_episodes VALUES(${s.organizationId}::uuid,${s.guildId},${episode}::uuid,${identityId}::uuid,${joined},NULL,'PRODUCTION')`.execute(
    db,
  );
  await sql`INSERT INTO lifecycle_events VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episode}::uuid,'activation.completed',${new Date(joined.getTime() + 60000)},'PRODUCTION',${json({})})`.execute(
    db,
  );
  await sql`INSERT INTO lifecycle_events VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',${new Date(joined.getTime() + 60000)},'PRODUCTION',${json({ messageId: String(BigInt("521111111111111111") + BigInt(i)), channelId: "621111111111111111" })})`.execute(
    db,
  );
}
const recentJoin = new Date(now.getTime() - 2 * 3600000),
  recentEpisode = randomUUID();
const recentIdentity = await vault.resolve(db, s, "421111111111111999");
await sql`INSERT INTO membership_episodes VALUES(${s.organizationId}::uuid,${s.guildId},${recentEpisode}::uuid,${recentIdentity}::uuid,${recentJoin},NULL,'PRODUCTION')`.execute(
  db,
);
await sql`INSERT INTO lifecycle_events VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${recentEpisode}::uuid,'message.sent',${new Date(now.getTime() - 35 * 60000)},'PRODUCTION',${json({ messageId: "521111111111111999", channelId: "621111111111111111" })})`.execute(
  db,
);
const secondEpisode = randomUUID(),
  secondIdentity = await vault.resolve(db, s, "421111111111111998");
await sql`INSERT INTO membership_episodes VALUES(${s.organizationId}::uuid,${s.guildId},${secondEpisode}::uuid,${secondIdentity}::uuid,${recentJoin},NULL,'PRODUCTION')`.execute(
  db,
);
await sql`INSERT INTO lifecycle_events VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${secondEpisode}::uuid,'message.sent',${new Date(now.getTime() - 40 * 60000)},'PRODUCTION',${json({ messageId: "521111111111111998", channelId: "621111111111111111" })})`.execute(
  db,
);
await sql`INSERT INTO telemetry_cursor VALUES(${s.organizationId}::uuid,${s.guildId},${joined},${now})`.execute(
  db,
);
await sql`UPDATE membership_episodes SET screening_pending=false,is_guest=false,member_flags=0,screening_observed_at=joined_at,guest_observed_at=joined_at,flags_observed_at=joined_at,engagement_started_at=joined_at,observation_source='GATEWAY' WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId}`.execute(
  db,
);
await sql`UPDATE lifecycle_events SET definition_version='observation-v3' WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId}`.execute(
  db,
);
await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key) VALUES(${s.organizationId}::uuid,${s.guildId},'GROWTH')`.execute(
  db,
);
const discord = {
  checkChannel: async (_guildId: string, channelId: string) => {
    if (channelId !== "621111111111111111")
      throw new Error("CHANNEL_PERMISSION_MISSING");
  },
  sendPanel: async () => "921111111111111111",
  options: async () => ({
    channels: [
      { id: "621111111111111111", label: "#helpers" },
      { id: "621111111111111112", label: "#welcome" },
    ],
    roles: [{ id: "721111111111111111", label: "@Community Team" }],
    events: [{ id: "821111111111111111", label: "Weekly Community Call" }],
  }),
} as unknown as DiscordPort;
const api = createApi(
  new AnalyticsService(db, new SettingsService(db)),
  "test-api-key",
  db,
  discord,
);
await api.listen({ host: "127.0.0.1", port: 3101 });
const healthTimer = setInterval(() => {
  void heartbeat();
}, 30000);
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
  clearInterval(healthTimer);
  await api.close();
  await db.destroy();
  await pg.stop();
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});
