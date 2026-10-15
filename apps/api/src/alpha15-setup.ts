import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql, tenant, type Database } from "../../../packages/db/src/index";
import { assert } from "../../../packages/shared/src/index";
import {
  DiscordFailure,
  isDiscordFailure,
  type DiscordPort,
  type DiscordRest,
} from "../../../packages/discord/src/rest";
import type { IdentityVault } from "../../../packages/identity/src/index";
import {
  publicApiContext,
  publicApiIdentity,
  type PublicApiRequest,
} from "../../../packages/security/src/public-api";
import {
  webSetupPatchSchema,
  WebSetupService,
} from "../../../packages/operations/src/web-setup";
import { discordInstallUrl } from "../../../packages/discord/src/install";
import { hostedBetaEnabled } from "../../../packages/config/src/hosted-beta";
import {
  betaInvitation,
  betaLock,
} from "../../../packages/security/src/hosted-beta";
import { InstallNotices } from "../../gateway/src/install-notices";

async function installationAdmission(
  db: Database,
  scope: { organizationId: string; guildId: string },
) {
  if (!hostedBetaEnabled()) return;
  await db.transaction().execute(async (tx) => {
    await betaLock(tx, scope);
    const invitation = await betaInvitation(tx, scope);
    assert(
      invitation &&
        ["REGISTERED", "ACTIVE"].includes(invitation.status) &&
        (!invitation.expires_at || invitation.expires_at > new Date()),
      "BETA_UNAVAILABLE",
      403,
    );
    assert(
      !(
        await sql`SELECT 1 FROM beta_deletion_jobs WHERE ${tenant(scope)}`.execute(
          tx,
        )
      ).rows.length,
      "BETA_UNAVAILABLE",
      403,
    );
  });
}

// Only the existing, official guild-selection API is used before Guild Install.
async function selectManagedGuild(accessToken: string, guildId: string) {
  let after = "";
  for (let page = 0; page < 50; page++) {
    const response = await fetch(
      `https://discord.com/api/v10/users/@me/guilds?limit=200${after ? "&after=" + after : ""}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      },
    );
    assert(response.status !== 401, "SESSION_EXPIRED", 401);
    if (!response.ok)
      throw new DiscordFailure(
        response.status,
        Number(response.headers.get("retry-after")) || 0,
        { routeCategory: "oauth-guild-selection" },
      );
    const rows = z
      .array(
        z.object({
          id: z.string().regex(/^\d{17,20}$/),
          name: z.string().max(100),
          owner: z.boolean().optional(),
          permissions: z.string().regex(/^\d+$/).optional(),
        }),
      )
      .parse(await response.json());
    const selected = rows.find((row) => row.id === guildId);
    if (selected) {
      assert(
        selected.owner || (BigInt(selected.permissions ?? "0") & 40n) !== 0n,
        "ADMIN_REQUIRED",
        403,
      );
      return selected;
    }
    if (rows.length < 200) break;
    const next = rows.at(-1)!.id;
    assert(next !== after, "AUTHORIZATION_UNAVAILABLE", 503);
    after = next;
  }
  assert(false, "ADMIN_REQUIRED", 403);
}
async function botIsInstalled(guildId: string) {
  const token = process.env.DISCORD_TOKEN;
  assert(token, "WEB_CONNECTION_UNAVAILABLE", 503);
  let after = "";
  for (let page = 0; page < 50; page++) {
    const response = await fetch(
      `https://discord.com/api/v10/users/@me/guilds?limit=200${after ? "&after=" + after : ""}`,
      {
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      },
    );
    if (!response.ok)
      throw new DiscordFailure(
        response.status,
        Number(response.headers.get("retry-after")) || 0,
        { routeCategory: "bot-installation-check" },
      );
    const rows = z
      .array(z.object({ id: z.string().regex(/^\d{17,20}$/) }))
      .parse(await response.json());
    if (rows.some((row) => row.id === guildId)) return true;
    if (rows.length < 200) return false;
    const next = rows.at(-1)!.id;
    assert(next !== after, "AUTHORIZATION_UNAVAILABLE", 503);
    after = next;
  }
  assert(false, "AUTHORIZATION_UNAVAILABLE", 503);
}
export function registerAlpha15Setup(
  app: FastifyInstance,
  db: Database,
  key: string,
  discord?: DiscordPort,
  vault?: IdentityVault,
) {
  const base = "/v3/organizations/:organizationId/guilds/:guildId/web-setup";
  app.addHook("onSend", async (req, reply) => {
    if (req.routeOptions.url?.startsWith(base))
      reply.header("Cache-Control", "no-store");
  });
  const context = (req: PublicApiRequest) =>
    publicApiContext(req, db, key, discord, vault, "CONFIGURE", {
      setup: true,
    });
  const service = async (req: PublicApiRequest) => {
    const auth = await context(req);
    assert(discord, "WEB_CONNECTION_UNAVAILABLE", 503);
    return { auth, setup: new WebSetupService(db, discord, auth) };
  };
  const installUrl = (guildId: string) =>
    process.env.DISCORD_APPLICATION_ID
      ? discordInstallUrl(process.env.DISCORD_APPLICATION_ID, guildId)
      : null;
  app.get(base + "/status", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    try {
      const { auth, setup } = await service(req);
      assert(discord, "WEB_CONNECTION_UNAVAILABLE", 503);
      return {
        ...(await setup.status(
          auth.scope,
          auth.actor,
          auth.snapshot.member.guildName ?? auth.scope.guildId,
        )),
        installNotice: await new InstallNotices(db, discord).status(auth.scope),
      };
    } catch (error) {
      if (!isDiscordFailure(error) || ![403, 404].includes(error.status))
        throw error;
      const identity = await publicApiIdentity(req, db, key),
        guild = await selectManagedGuild(
          identity.accessToken,
          identity.scope.guildId,
        );
      await installationAdmission(db, identity.scope);
      assert(
        !(await botIsInstalled(identity.scope.guildId)),
        "AUTHORIZATION_UNAVAILABLE",
        503,
      );
      return {
        state: "BOT_REQUIRED",
        connection: "NOT_INSTALLED",
        guild: { id: guild.id, name: guild.name },
        checkedAt: new Date().toISOString(),
        installUrl: installUrl(guild.id),
        missing: ["bot"],
      };
    }
  });
  app.post(base + "/requests", async (req) => {
    const input = z.object({ requestId: z.uuid() }).strict().parse(req.body),
      identity = await publicApiIdentity(req, db, key);
    assert(vault, "WEB_CONNECTION_UNAVAILABLE", 503);
    await installationAdmission(db, identity.scope);
    await selectManagedGuild(identity.accessToken, identity.scope.guildId);
    assert(
      !(await botIsInstalled(identity.scope.guildId)),
      "BOT_ALREADY_INSTALLED",
      409,
    );
    const actor = vault.hash(identity.scope, identity.userId),
      now = new Date();
    const result = await db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"web-install:" + identity.scope.organizationId + ":" + identity.scope.guildId + ":" + actor},0))`.execute(
        tx,
      );
      const saved = (
        await sql<{
          actor_hash: string;
          expires_at: Date;
        }>`SELECT actor_hash,expires_at FROM web_setup_install_requests WHERE ${tenant(identity.scope)} AND id=${input.requestId}::uuid FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      if (saved) {
        assert(
          saved.actor_hash === actor && saved.expires_at > now,
          "IDEMPOTENCY_CONFLICT",
          409,
        );
        return saved;
      }
      assert(
        (
          await sql`SELECT 1 FROM web_setup_install_requests WHERE ${tenant(identity.scope)} AND actor_hash=${actor} AND expires_at>clock_timestamp()`.execute(
            tx,
          )
        ).rows.length < 5,
        "SETUP_RATE_LIMIT",
        429,
      );
      return (
        await sql<{
          expires_at: Date;
        }>`INSERT INTO web_setup_install_requests(organization_id,guild_id,id,actor_hash,bot_absent_at) VALUES(${identity.scope.organizationId}::uuid,${identity.scope.guildId},${input.requestId}::uuid,${actor},${now}) RETURNING expires_at`.execute(
          tx,
        )
      ).rows[0]!;
    });
    return {
      requestId: input.requestId,
      state: "AWAITING_INSTALLATION",
      installUrl: installUrl(identity.scope.guildId),
      expiresAt: result.expires_at.toISOString(),
    };
  });
  app.post(base + "/verify", async (req) => {
    const { requestId } = z
        .object({ requestId: z.uuid() })
        .strict()
        .parse(req.body),
      { auth, setup } = await service(req);
    return setup.verify(auth, requestId);
  });
  app.get(base + "/candidates", async (req) => {
    const { auth } = await service(req);
    assert(discord?.options, "WEB_CONNECTION_UNAVAILABLE", 503);
    const options = await discord.options(auth.scope.guildId),
      administrator = (BigInt(auth.actor.permissions) & 8n) !== 0n;
    const reader = discord as DiscordPort &
      Partial<Pick<DiscordRest, "canReadAttentionChannel">>;
    const channels: { id: string; name: string; type: number }[] = [];
    for (const channel of options.surfaces ??
      options.channels.map((channel) => ({ ...channel, type: 0 }))) {
      if (
        administrator ||
        (reader.canReadAttentionChannel &&
          (await reader.canReadAttentionChannel(
            auth.scope.guildId,
            channel.id,
            auth.userId,
            auth.snapshot.member,
          )))
      )
        channels.push({
          id: channel.id,
          name: channel.label,
          type: channel.type,
        });
    }
    return {
      channels,
      roles: options.roles.map((role) => ({ id: role.id, name: role.label })),
      available: true,
      checkedAt: new Date().toISOString(),
    };
  });
  app.post(base + "/draft", async (req) => {
    const input = z
        .object({
          requestId: z.uuid(),
          draftId: z.uuid().optional(),
          expectedDraftRevision: z.number().int().positive().optional(),
          patch: webSetupPatchSchema,
        })
        .strict()
        .parse(req.body),
      { auth, setup } = await service(req);
    return setup.save(auth.scope, auth.actor, input);
  });
  app.post(base + "/apply", async (req) => {
    const input = z
        .object({
          requestId: z.uuid(),
          draftId: z.uuid(),
          expectedDraftRevision: z.number().int().positive(),
          expectedSettingsRevision: z.number().int().nonnegative(),
          confirmScopeChange: z.boolean().optional(),
        })
        .strict()
        .parse(req.body),
      { auth, setup } = await service(req);
    return setup.apply(auth.scope, auth.actor, input);
  });
  app.post(base + "/complete", async (req) => {
    const input = z
        .object({
          requestId: z.uuid(),
          settingsRevision: z.number().int().nonnegative(),
        })
        .strict()
        .parse(req.body),
      { auth, setup } = await service(req);
    return setup.complete(auth.scope, auth.actor, input);
  });
  app.get(base + "/requests/:requestId", async (req) => {
    const { auth, setup } = await service(req);
    return setup.result(
      auth.scope,
      auth.actor,
      z.uuid().parse((req.params as { requestId: string }).requestId),
    );
  });
}
