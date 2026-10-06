import "server-only";
import { connect } from "../../../../packages/db/src/index";
import { IdentityVault } from "../../../../packages/identity/src/index";
import {
  DiscordRest,
  isDiscordFailure,
} from "../../../../packages/discord/src/rest";
import { SettingsService } from "../../../../packages/settings/src/index";
import { Components } from "../../../../packages/security/src/index";
import {
  ServerAuthorization,
  type GuildAuthorizationSnapshot,
} from "../../../../packages/security/src/server-authorization";
import { ServerVerification } from "../../../../packages/security/src/server-verification";
import { scopeForGuild } from "../../../../packages/security/src/scoping";
import {
  operationsAccess,
  nexusRole,
  actorPermissions,
} from "../../../../packages/operations/src/policy";

// This module is reached exclusively from server pages and route handlers.
type Services = {
  discord: DiscordRest;
  verification: ServerVerification;
  authority: ServerAuthorization;
  tokens: Components;
  vault: IdentityVault;
  db: ReturnType<typeof connect>;
};
const shared = globalThis as typeof globalThis & {
  nexusWebServices?: Services;
};
export function serverServices(): Services {
  if (typeof window !== "undefined") throw new Error("SERVER_ONLY");
  if (shared.nexusWebServices) return shared.nexusWebServices;
  const {
    DATABASE_URL,
    IDENTITY_KEY,
    LOOKUP_KEY,
    COMPONENT_KEY,
    DISCORD_TOKEN,
    DISCORD_APPLICATION_ID,
  } = process.env;
  if (
    !DATABASE_URL ||
    !IDENTITY_KEY ||
    !LOOKUP_KEY ||
    !COMPONENT_KEY ||
    !DISCORD_TOKEN ||
    !DISCORD_APPLICATION_ID
  )
    throw new Error("SERVER_AUTHORIZATION_UNAVAILABLE");
  const db = connect(DATABASE_URL),
    vault = new IdentityVault(IDENTITY_KEY, LOOKUP_KEY),
    discord = new DiscordRest(DISCORD_TOKEN, DISCORD_APPLICATION_ID),
    authority = new ServerAuthorization(
      discord,
      new SettingsService(db),
      vault,
    );
  return (shared.nexusWebServices = {
    db,
    vault,
    authority,
    discord,
    tokens: new Components(COMPONENT_KEY),
    verification: new ServerVerification(db, vault, authority),
  });
}
export async function manageableConnection(guildId: string, userId: string) {
  const s = scopeForGuild(guildId),
    services = serverServices();
  let snapshot: GuildAuthorizationSnapshot;
  let access;
  try {
    snapshot = await services.authority.snapshot(
      s,
      userId,
      "WEB_DASHBOARD",
      "access-check",
    );
    access = await services.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, snapshot.actor, "READ");
      return {
        operationsRole: await nexusRole(tx, s, snapshot.actor.key),
        operationsCanConfigure: (
          await actorPermissions(tx, s, snapshot.actor)
        ).includes("CONFIGURE"),
      };
    });
  } catch (error) {
    if (
      (isDiscordFailure(error) && [403, 404].includes(error.status)) ||
      (error instanceof Error &&
        ["ADMIN_REQUIRED", "NEXUS_ROLE_REQUIRED", "PRIVACY_DELETED"].includes(
          error.message,
        ))
    )
      return null;
    throw error;
  }
  return {
    ...(await services.verification.connection(s, userId)),
    name: snapshot.member.guildName ?? guildId,
    ...access,
  };
}
