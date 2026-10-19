import EmbeddedPostgres from "embedded-postgres";
import { z } from "zod";
import Fastify from "fastify";
import { mkdir, mkdtemp, writeFile, readFile, lstat, realpath } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { createServer } from "node:net";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
} from "../../packages/db/src/index.js";
import { IdentityVault } from "../../packages/identity/src/index.js";
import { SettingsService } from "../../packages/settings/src/index.js";
import { AnalyticsService } from "../../packages/analytics/src/index.js";
import { ServerAuthorization } from "../../packages/security/src/server-authorization.js";
import { ServerVerification } from "../../packages/security/src/server-verification.js";
import { scopeForGuild } from "../../packages/security/src/scoping.js";
import { createApi } from "../../apps/api/src/server.js";
import { DiscordFailure } from "../../packages/discord/src/rest.js";
import { FakeDiscord } from "../fixtures/discord.js";
import { PromotionService } from "../../packages/settings/src/billing/index.js";
import { internalBillingActor } from "../../packages/security/src/billing-authorization.js";
import { PublicSessions } from "../../packages/security/src/public-sessions.js";
import { randomUUID, createHash } from "node:crypto";
import { BetaOperator } from "../../packages/security/src/beta-operator.js";
import { betaInvitation } from "../../packages/security/src/hosted-beta.js";
process.env.NEXUS_HOSTED_BETA = "on";
const port = Number(process.env.NEXUS_VERIFICATION_API_PORT ?? 3151),
  user = "911111111111111111",
  other = "911111111111111112",
  manager = "921111111111111111",
  admin = "921111111111111112";
const ids = [
  "931111111111111111",
  "931111111111111112",
  "931111111111111113",
  "931111111111111114",
  "931111111111111115",
];
const installed = new Set([ids[0]!, ids[1]!, ids[2]!, ids[4]!]),
  names = [
    "Verified community",
    "Unverified community",
    "Pending community",
    "Add NEXUS community",
    "Unauthorized community",
  ];
type TestProvider = { runId: string; ownerPid: number; host: "127.0.0.1"; port: number; username: "nexus_synthetic"; database: "nexus_alpha17_core" };
const external = Boolean(process.env.NEXUS_TEST_DATABASE_URL || process.env.NEXUS_TEST_PG_PROVIDER_RECEIPT);
let provider: TestProvider | undefined, providerSha: string | undefined, bootstrapSha: string | undefined, dir: string | undefined, pg: EmbeddedPostgres | undefined, databaseUrl: string;
let bootstrapPath = resolve(".local/verification-e2e.json");
const createdAt = new Date().toISOString();
async function ownerReceipt(state: "STARTING" | "READY" | "CLOSED", exclusive = false) {
  const target = process.env.NEXUS_TEST_FIXTURE_RECEIPT;
  if (!target) { if (provider) throw new Error("TEST_PROVIDER_OWNER_RECEIPT_REQUIRED"); return; }
  if (!process.env.NEXUS_TEST_RUN_ID) throw new Error("TEST_RUN_ID_REQUIRED");
  if (provider && target !== resolve(dirname(bootstrapPath), "fixture-owner.json")) throw new Error("TEST_OWNER_PATH_UNCONFIRMED");
  if (!exclusive) { const info = await lstat(target); if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (await realpath(target)).toLowerCase() !== resolve(target).toLowerCase()) throw new Error("TEST_OWNER_RECEIPT_UNSAFE"); }
  await writeFile(target, JSON.stringify({ runId: process.env.NEXUS_TEST_RUN_ID, ownerPid: process.pid, directory: dir, createdAt,
    ...(provider ? { provider: "DOCKER_POSTGRES", providerOwnerPid: provider.ownerPid, providerReceiptSha256: providerSha, bootstrapPath, bootstrapSha256: bootstrapSha, state } : {}),
  }), { flag: exclusive ? "wx" : "w" });
}
if (external) {
  const receiptPath = process.env.NEXUS_TEST_PG_PROVIDER_RECEIPT, rawUrl = process.env.NEXUS_TEST_DATABASE_URL;
  if (!receiptPath || !rawUrl || !process.env.NEXUS_TEST_BOOTSTRAP_FILE) throw new Error("TEST_PROVIDER_REQUIRED");
  const info = await lstat(receiptPath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16384 || (await realpath(receiptPath)).toLowerCase() !== resolve(receiptPath).toLowerCase()) throw new Error("TEST_PROVIDER_FILE_UNSAFE");
  const bytes = await readFile(receiptPath);
  providerSha = createHash("sha256").update(bytes).digest("hex");
  if (providerSha !== process.env.NEXUS_TEST_PROVIDER_RECEIPT_SHA256) throw new Error("TEST_PROVIDER_RECEIPT_CHANGED");
  let value: unknown; try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("TEST_PROVIDER_INVALID"); }
  const parsed = z.object({ schemaVersion: z.literal(1), provider: z.literal("DOCKER_POSTGRES"), runId: z.string().uuid(), ownerPid: z.number().int().positive(), syntheticOnly: z.literal(true), credentialsRecorded: z.literal(false), host: z.literal("127.0.0.1"), port: z.number().int().min(1024).max(65535), username: z.literal("nexus_synthetic"), database: z.literal("nexus_alpha17_core") }).passthrough().safeParse(value);
  if (!parsed.success || parsed.data.runId !== process.env.NEXUS_TEST_RUN_ID) throw new Error("TEST_PROVIDER_INVALID");
  provider = parsed.data;
  const screen = resolve(dirname(receiptPath), "screen");
  if (basename(receiptPath) !== "pg-provider.json" || basename(dirname(receiptPath)) !== "alpha17-screen-run-" + provider.runId || (await realpath(screen)).toLowerCase() !== screen.toLowerCase() || (await lstat(screen)).isSymbolicLink()) throw new Error("TEST_PROVIDER_DIRECTORY_UNSAFE");
  bootstrapPath = resolve(screen, "bootstrap-" + provider.runId + ".json");
  if (process.env.NEXUS_TEST_BOOTSTRAP_FILE !== bootstrapPath) throw new Error("TEST_BOOTSTRAP_PATH_UNCONFIRMED");
  let url: URL; try { url = new URL(rawUrl); } catch { throw new Error("TEST_DATABASE_NOT_ALLOWED"); }
  if (url.protocol !== "postgresql:" || url.hostname !== provider.host || url.port !== String(provider.port) || url.username !== provider.username || url.pathname !== "/" + provider.database || !url.password || url.search || url.hash) throw new Error("TEST_DATABASE_NOT_ALLOWED");
  databaseUrl = rawUrl;
  await ownerReceipt("STARTING", true);
} else {
  await mkdir(".local", { recursive: true });
  dir = await mkdtemp(resolve(".local/pg-verification-e2e-"));
  await ownerReceipt("STARTING", true);
  const pgPort = await new Promise<number>((done) => {
    const probe = createServer(); probe.listen(0, "127.0.0.1", () => { const address = probe.address(); if (!address || typeof address === "string") throw new Error("PORT_UNAVAILABLE"); probe.close(() => done(address.port)); });
  });
  pg = new EmbeddedPostgres({ databaseDir: dir, user: "nexus", password: "nexus", port: pgPort, persistent: true, onLog: () => {}, onError: () => {} });
  await pg.initialise(); await pg.start();
  databaseUrl = "postgresql://nexus:nexus@127.0.0.1:" + pgPort + "/postgres";
}
const db = connect(databaseUrl);
await migrate(db);
await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,enabled,currency,final_price_minor,provider_product_id,provider_price_id,tax_behavior) VALUES('11111111-1111-4111-8111-111111111111','GROWTH',2,'STRIPE',true,'JPY',4900,'fixture-product-verification-growth','fixture-price-verification-growth','EXCLUSIVE')`.execute(
  db,
);
class VerificationDiscord extends FakeDiscord {
  async options() {
    return { channels: [], roles: [], events: [] };
  }
}
const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32)),
  settings = new SettingsService(db),
  discord = new VerificationDiscord(),
  permissions = new Map<string, boolean>();
const billingAdmins = new Set<string>();
discord.member = async (guildId, userId) => {
  if (!installed.has(guildId)) throw new DiscordFailure(404);
  const allowed = permissions.get(`${guildId}:${userId}`) ?? guildId !== ids[4];
  return {
    roles: allowed
      ? [manager, ...(billingAdmins.has(`${guildId}:${userId}`) ? [admin] : [])]
      : [],
    permissions: "0",
    ownerId: billingAdmins.has(`${guildId}:${userId}`)
      ? userId
      : "999111111111111111",
    bot: false,
    joinedAt: "2026-01-01T00:00:00.000Z",
  };
};
const authority = new ServerAuthorization(discord, settings, vault),
  verification = new ServerVerification(db, vault, authority);
const beta = new BetaOperator(db, async (guildId) => ({
  name: names[ids.indexOf(guildId)]!,
  present: installed.has(guildId),
  canObserve: true,
  checkedAt: Date.now(),
}));
for (const guildId of installed) {
  const s = scopeForGuild(guildId);
  await ensureGuild(db, s);
  for (const action of ["register", "activate"] as const) {
    const invitation = await betaInvitation(db, s);
    await beta.change({
      guildId,
      action,
      generation: invitation?.generation ?? null,
      requestId: randomUUID(),
      reason: "Synthetic browser verification invitation",
    });
  }
  // Admission remains real and enabled. Keep this isolated grant featureless
  // so the existing suite can test each subscription tier independently.
  await sql`UPDATE entitlement_grants SET features='[]'::jsonb,limits='{}'::jsonb WHERE id=(SELECT grant_id FROM beta_guild_invitations WHERE ${tenant(s)})`.execute(
    db,
  );
  await settings.update(
    s,
    {
      key: vault.hash(s, user),
      permissions: "32",
      roles: [],
      source: "DISCORD_PANEL",
      requestId: "fixture",
    },
    0,
    { uiLanguage: "en", managerRoleIds: [manager] },
  );
}
const verified = await verification.issue(scopeForGuild(ids[0]!), user);
await verification.redeem(user, verified.code);
await verification.issue(scopeForGuild(ids[2]!), user);
const bootstrapBytes = JSON.stringify(provider ? { databaseUrl, runId: provider.runId, providerReceiptSha256: providerSha } : { databaseUrl });
await writeFile(bootstrapPath, bootstrapBytes, provider ? { encoding: "utf8", flag: "wx" } : "utf8");
if (provider) { bootstrapSha = createHash("sha256").update(bootstrapBytes).digest("hex"); await ownerReceipt("STARTING"); }
const api = createApi(
  new AnalyticsService(db, settings),
  "verification-api-key",
  db,
  discord,
  undefined,
  vault,
);
await api.listen({ host: "127.0.0.1", port: port + 2 });
const fixture = Fastify({ logger: false });
// This isolated loopback fixture shares its database and synthetic session secret
// with verification-web.ts. Session creation does not contact Discord.
const sessions = new PublicSessions(db, "s".repeat(64), async () => {
  throw new Error("VERIFICATION_REFRESH_UNAVAILABLE");
});
const sessionInput = z.object({ userId: z.enum([user, other]) }).strict();
fixture.get("/health", async () => ({ ok: true }));
fixture.post("/fixture/session", async (request, reply) => {
  const input = sessionInput.safeParse(request.body);
  if (!input.success)
    return reply.code(400).send({ error: "INVALID_FIXTURE_SESSION" });
  const reference = await sessions.create(
    input.data.userId,
    { accessToken: `verification-oauth-${input.data.userId}` },
    600,
  );
  return reply.header("Cache-Control", "no-store").send({ reference });
});
fixture.get("/fixture/discord/users/@me", async (request) => ({
  id: request.headers.authorization?.split("-").at(-1) ?? user,
}));
fixture.get("/fixture/discord/users/@me/guilds", async (request) =>
  request.headers.authorization?.startsWith("Bot ")
    ? ids.filter((id) => installed.has(id)).map((id) => ({ id }))
    : ids.map((id, index) => ({
        id,
        name: names[index],
        permissions: id === ids[3] ? "32" : "0",
      })),
);
fixture.get("/fixture/discord/guilds/:guildId", async (request, reply) => {
  const { guildId } = request.params as { guildId: string };
  return installed.has(guildId)
    ? {
        id: guildId,
        owner_id: billingAdmins.has(`${guildId}:${user}`)
          ? user
          : "999111111111111111",
      }
    : reply.code(404).send({});
});
fixture.get("/fixture/discord/guilds/:guildId/roles", async (request) => {
  const { guildId } = request.params as { guildId: string };
  return [
    { id: guildId, permissions: "0", position: 0, managed: false },
    { id: manager, permissions: "0", position: 1, managed: false },
    { id: admin, permissions: "32", position: 2, managed: false },
  ];
});
fixture.get(
  "/fixture/discord/guilds/:guildId/members/:userId",
  async (request, reply) => {
    const { guildId, userId } = request.params as {
      guildId: string;
      userId: string;
    };
    try {
      const member = await discord.member(guildId, userId);
      return {
        roles: member.roles,
        joined_at: member.joinedAt,
        user: { bot: false },
      };
    } catch {
      return reply.code(404).send({});
    }
  },
);
fixture.post("/fixture/code", async (request) => {
  const { guildId, userId = user } = request.body as {
    guildId: string;
    userId?: string;
  };
  const s = scopeForGuild(guildId);
  await sql`UPDATE server_verification_challenges SET created_at=created_at-interval '31 seconds' WHERE ${tenant(s)} AND issuer_hash=${vault.hash(s, userId)}`.execute(
    db,
  );
  const issued = await verification.issue(s, userId);
  return { code: issued.code };
});
fixture.post("/fixture/permission", async (request) => {
  const {
    guildId,
    userId = user,
    allowed,
  } = request.body as { guildId: string; userId?: string; allowed: boolean };
  permissions.set(`${guildId}:${userId}`, allowed);
  return { ok: true };
});
fixture.post("/fixture/billing-authority", async (request) => {
  const { guildId, enabled } = request.body as {
    guildId: string;
    enabled: boolean;
  };
  const key = `${guildId}:${user}`;
  if (enabled) billingAdmins.add(key);
  else billingAdmins.delete(key);
  // Explicit fixture Owner + Primary authority, separate from Discord Admin.
  const scope = scopeForGuild(guildId),
    hash = vault.digest("billing-org-actor", scope.organizationId + ":" + user);
  if (enabled)
    await sql`INSERT INTO billing_authorizations(organization_id,actor_hash,role) VALUES(${scope.organizationId}::uuid,${hash},'PRIMARY_BILLING_PRINCIPAL') ON CONFLICT(organization_id,actor_hash) DO UPDATE SET role='PRIMARY_BILLING_PRINCIPAL',revoked_at=NULL`.execute(
      db,
    );
  else
    await sql`DELETE FROM billing_authorizations WHERE organization_id=${scope.organizationId}::uuid AND actor_hash=${hash}`.execute(
      db,
    );

  return { ok: true };
});
fixture.post("/fixture/promotion", async (request) => {
  const { guildId } = request.body as { guildId: string },
    promotions = new PromotionService(db, vault),
    actor = internalBillingActor(user, vault, "Browser billing regression", {
      NEXUS_INTERNAL_ADMIN_IDS: user,
    });
  const campaign = await promotions.createCampaign(actor, {
    name: "Browser benefit",
    benefitType: "PLAN_GRANT",
    targetPlan: "GROWTH",
    durationDays: 90,
    validFrom: new Date(Date.now() - 1000).toISOString(),
    targetGuildId: guildId,
    allowedPlans: ["FREE", "STARTER", "GROWTH", "SCALE", "ENTERPRISE"],
    allowedProviders: ["MANUAL", "DISCORD", "STRIPE"],
    stackingPolicy: "MAX",
  });
  return promotions.generateCode(actor, campaign.id);
});
// Test-only server and isolated database: set exact paid tiers without inventing
// provider subscriptions or exposing a development entitlement route in the app.
fixture.post("/fixture/operations-plan", async (request) => {
  const { guildId, plan } = z
      .object({
        guildId: z.enum(ids as [string, ...string[]]),
        plan: z.enum(["FREE", "STARTER", "GROWTH", "SCALE"]),
      })
      .strict()
      .parse(request.body),
    s = scopeForGuild(guildId);
  await sql`UPDATE entitlement_grants SET revoked_at=now() WHERE ${tenant(s)} AND revoked_at IS NULL AND id IS DISTINCT FROM (SELECT grant_id FROM beta_guild_invitations WHERE ${tenant(s)})`.execute(
    db,
  );
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status) VALUES(${s.organizationId}::uuid,${s.guildId},${plan},'active') ON CONFLICT(organization_id,guild_id) DO UPDATE SET plan_key=EXCLUDED.plan_key,status='active'`.execute(
    db,
  );
  return { ok: true };
});
// A pre-existing, completed setup for the independent permission-loss case.
// This test-only seed changes no connection, role, invitation or entitlement.
fixture.post("/fixture/setup-complete", async (request) => {
  const { guildId } = z.object({ guildId: z.literal(ids[0]!) }).strict().parse(request.body);
  const s = scopeForGuild(guildId), current = await settings.get(s);
  const complete = current.setupVersion >= 3 && Object.values(current.setupSteps).every(Boolean);
  const seeded = complete ? current : await settings.update(s, {
    key: vault.hash(s, user), permissions: "32", roles: [], source: "DISCORD_PANEL", requestId: "fixture-setup-complete",
  }, current.revision, { setupVersion: 3, setupSteps: { scope: true, team: true, notifications: true, goals: true } });
  return { setupVersion: seeded.setupVersion };
});
fixture.get("/fixture/data/:guildId", async (request) => {
  const { guildId } = request.params as { guildId: string };
  return {
    settings: await settings.get(scopeForGuild(guildId)),
    connection: await verification.connection(scopeForGuild(guildId)),
    betaState: (await betaInvitation(db, scopeForGuild(guildId)))?.status,
  };
});
fixture.get("/fixture/constants", async () => ({ ids, user, other }));
await fixture.listen({ host: "127.0.0.1", port });
if (provider) await ownerReceipt("READY");
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await fixture.close();
  await api.close();
  await db.destroy();
  await pg?.stop();
  if (provider) await ownerReceipt("CLOSED");
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
