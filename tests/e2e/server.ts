import EmbeddedPostgres from "embedded-postgres";
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
const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32));
const now = new Date();
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
await sql`INSERT INTO telemetry_cursor VALUES(${s.organizationId}::uuid,${s.guildId},${joined},${now})`.execute(
  db,
);
await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key) VALUES(${s.organizationId}::uuid,${s.guildId},'GROWTH')`.execute(
  db,
);
const discord = {
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
let stopped = false;
async function stop() {
  if (stopped) return;
  stopped = true;
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
