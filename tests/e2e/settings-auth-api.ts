// Test-only authenticated counterpart of the standard main-suite dataset.
import Fastify from "fastify";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import { lstat, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sql, tenant, type Database } from "../../packages/db/src/index.js";
import type { Scope } from "../../packages/shared/src/index.js";
import type { SettingsService } from "../../packages/settings/src/index.js";
import type { IdentityVault } from "../../packages/identity/src/index.js";
import { AnalyticsService } from "../../packages/analytics/src/index.js";
import { createApi } from "../../apps/api/src/server.js";
import {
  DiscordFailure,
  type DiscordPort,
} from "../../packages/discord/src/rest.js";
import { ServerAuthorization } from "../../packages/security/src/server-authorization.js";
import { ServerVerification } from "../../packages/security/src/server-verification.js";
import { PublicSessions } from "../../packages/security/src/public-sessions.js";
import { BetaOperator } from "../../packages/security/src/beta-operator.js";
import { betaInvitation } from "../../packages/security/src/hosted-beta.js";

const user = "911111111111111111",
  team = "721111111111111111";
const origin = "https://app.nexus.test:3150",
  secret = "s".repeat(64);
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const samePath = (a: string, b: string) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

function syntheticDatabase(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.username !== "nexus" ||
    url.password !== "nexus" ||
    url.pathname !== "/postgres" ||
    !/^\d+$/.test(url.port) ||
    Number(url.port) < 1024 ||
    Number(url.port) > 65535 ||
    url.search ||
    url.hash
  )
    throw new Error("SETTINGS_AUTH_DATABASE_NOT_ALLOWED");
}

/** The existing TLS wrapper consumes this fixed test bootstrap. Preserve a
 * pre-existing synthetic bootstrap and restore it only while our bytes remain. */
async function bootstrap(databaseUrl: string) {
  syntheticDatabase(databaseUrl);
  const local = resolve(".local"),
    localInfo = await lstat(local);
  if (
    !localInfo.isDirectory() ||
    localInfo.isSymbolicLink() ||
    !samePath(await realpath(local), local)
  )
    throw new Error("SETTINGS_AUTH_LOCAL_DIRECTORY_UNSAFE");
  const path = resolve(local, "verification-e2e.json");
  let before: Buffer | undefined;
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.size > 4096 ||
      !samePath(await realpath(path), path)
    )
      throw new Error("SETTINGS_AUTH_BOOTSTRAP_UNSAFE");
    before = await readFile(path);
    let parsed: unknown;
    try {
      parsed = JSON.parse(before.toString("utf8"));
    } catch {
      throw new Error("SETTINGS_AUTH_BOOTSTRAP_UNSAFE");
    }
    const previous = z
      .object({ databaseUrl: z.string() })
      .strict()
      .safeParse(parsed);
    if (!previous.success) throw new Error("SETTINGS_AUTH_BOOTSTRAP_UNSAFE");
    syntheticDatabase(previous.data.databaseUrl);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const bytes = Buffer.from(JSON.stringify({ databaseUrl }));
  await writeFile(path, bytes, { flag: before ? "w" : "wx" });
  const identity = await lstat(path);
  return async () => {
    const current = await lstat(path);
    if (
      !current.isFile() ||
      current.isSymbolicLink() ||
      current.nlink !== 1 ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino ||
      !samePath(await realpath(path), path) ||
      hash(await readFile(path)) !== hash(bytes)
    )
      throw new Error("SETTINGS_AUTH_BOOTSTRAP_OWNER_UNCONFIRMED");
    if (before) await writeFile(path, before);
    else await unlink(path);
  };
}

export async function startSettingsAuthApi(input: {
  db: Database;
  settings: SettingsService;
  vault: IdentityVault;
  discord: DiscordPort;
  scope: Scope;
  databaseUrl: string;
}) {
  if (process.env.NEXUS_E2E_SETTINGS_AUTH !== "1")
    throw new Error("SETTINGS_AUTH_FIXTURE_NOT_SELECTED");
  const { db, settings, vault, discord, scope: s, databaseUrl } = input;
  if (s.guildId !== "321111111111111111")
    throw new Error("SETTINGS_AUTH_SCOPE_NOT_ALLOWED");
  Object.assign(process.env, {
    NEXUS_SESSION_SECRET: secret,
    NEXUS_WEB_URL: origin,
    NEXUS_HOSTED_BETA: "on",
  });
  const roleRows = [
    {
      id: s.guildId,
      name: "@everyone",
      permissions: "0",
      position: 0,
      managed: false,
    },
    {
      id: team,
      name: "Community Team",
      permissions: "32",
      position: 1,
      managed: false,
    },
  ];
  discord.member = async (guildId, userId) => {
    if (guildId !== s.guildId || userId !== user) throw new DiscordFailure(404);
    return {
      roles: [team],
      permissions: "32",
      ownerId: user,
      bot: false,
      guildName: "Development guild",
      joinedAt: "2026-01-01T00:00:00.000Z",
    };
  };
  discord.roles = async (guildId) => {
    if (guildId !== s.guildId) throw new DiscordFailure(404);
    return structuredClone(roleRows);
  };
  // Keep the actual admission and verification checks. The grant adds no
  // features/limits to the dataset's existing GROWTH subscription.
  const beta = new BetaOperator(db, async (guildId) => ({
    name: "Development guild",
    present: guildId === s.guildId,
    canObserve: true,
    checkedAt: Date.now(),
  }));
  for (const action of ["register", "activate"] as const) {
    const invitation = await betaInvitation(db, s);
    await beta.change({
      guildId: s.guildId,
      action,
      generation: invitation?.generation ?? null,
      requestId: randomUUID(),
      reason: "Synthetic authenticated settings fixture",
    });
  }
  await sql`UPDATE entitlement_grants SET features='[]'::jsonb,limits='{}'::jsonb WHERE id=(SELECT grant_id FROM beta_guild_invitations WHERE ${tenant(s)})`.execute(
    db,
  );
  const authority = new ServerAuthorization(discord, settings, vault);
  await new ServerVerification(db, vault, authority).connectOwner(s, user);
  const sessions = new PublicSessions(db, secret, async () => {
    throw new Error("SETTINGS_AUTH_REFRESH_UNAVAILABLE");
  });
  const api = createApi(
    new AnalyticsService(db, settings),
    "verification-api-key",
    db,
    discord,
    undefined,
    vault,
  );
  const fixture = Fastify({ logger: false });
  fixture.get("/health", async () => ({ ok: true }));
  fixture.post("/fixture/session", async (request, reply) => {
    const parsed = z
      .object({ userId: z.literal(user) })
      .strict()
      .safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "INVALID_FIXTURE_SESSION" });
    const reference = await sessions.create(
      user,
      { accessToken: "settings-oauth-" + user },
      600,
    );
    return reply.header("Cache-Control", "no-store").send({ reference });
  });
  const bearer = "Bearer settings-oauth-" + user,
    bot = "Bot verification-bot";
  fixture.get("/fixture/discord/users/@me", async (request, reply) =>
    request.headers.authorization === bearer
      ? { id: user }
      : reply.code(401).send({}),
  );
  fixture.get("/fixture/discord/users/@me/guilds", async (request, reply) => {
    if (request.headers.authorization === bot) return [{ id: s.guildId }];
    if (request.headers.authorization === bearer)
      return [
        {
          id: s.guildId,
          name: "Development guild",
          permissions: "32",
          owner: true,
        },
      ];
    return reply.code(401).send({});
  });
  fixture.get("/fixture/discord/guilds/:guildId", async (request, reply) => {
    const { guildId } = request.params as { guildId: string };
    return request.headers.authorization === bot && guildId === s.guildId
      ? { id: s.guildId, name: "Development guild", owner_id: user }
      : reply.code(404).send({});
  });
  fixture.get(
    "/fixture/discord/guilds/:guildId/roles",
    async (request, reply) => {
      const { guildId } = request.params as { guildId: string };
      return request.headers.authorization === bot && guildId === s.guildId
        ? roleRows
        : reply.code(404).send({});
    },
  );
  fixture.get(
    "/fixture/discord/guilds/:guildId/members/:userId",
    async (request, reply) => {
      const { guildId, userId } = request.params as {
        guildId: string;
        userId: string;
      };
      return request.headers.authorization === bot &&
        guildId === s.guildId &&
        userId === user
        ? {
            roles: [team],
            joined_at: "2026-01-01T00:00:00.000Z",
            user: { bot: false },
          }
        : reply.code(404).send({});
    },
  );
  let restore: (() => Promise<void>) | undefined,
    closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await fixture.close();
    } finally {
      try {
        await api.close();
      } finally {
        await restore?.();
      }
    }
  };
  try {
    restore = await bootstrap(databaseUrl);
    await api.listen({ host: "127.0.0.1", port: 3153 });
    await fixture.listen({ host: "127.0.0.1", port: 3151 });
    return { close };
  } catch (error) {
    await close();
    throw error;
  }
}
