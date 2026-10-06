import "server-only";
import { cookies } from "next/headers";
import { openSession, validateOAuthSession } from "../auth/session";
import { serverServices } from "../auth/server-access";
import { scopeForGuild } from "../../../../packages/security/src/scoping";
import { assert } from "../../../../packages/shared/src/index";
import { operationsAccess } from "../../../../packages/operations/src/policy";
export async function operationsContext() {
  const cookie = await cookies(),
    session = openSession(cookie.get("nexus_session")?.value),
    guildId = cookie.get("nexus_guild")?.value;
  assert(session, "SESSION_EXPIRED", 401);
  assert(guildId && /^\d{17,20}$/.test(guildId), "GUILD_REQUIRED", 403);
  await validateOAuthSession(session);
  const services = serverServices(),
    scope = scopeForGuild(guildId),
    snapshot = await services.authority.snapshot(
      scope,
      session.userId,
      "WEB_DASHBOARD",
      "operations-web",
    );
  assert(
    !snapshot.member.bot &&
      Date.now() - snapshot.checkedAt >= 0 &&
      Date.now() - snapshot.checkedAt <= 10000,
    "AUTHORIZATION_EXPIRED",
    403,
  );
  await services.db
    .transaction()
    .execute((tx) => operationsAccess(tx, scope, snapshot.actor, "READ"));
  assert(
    (await services.verification.connection(scope, session.userId)).state ===
      "VERIFIED",
    "SERVER_VERIFICATION_REQUIRED",
    403,
  );
  return {
    services,
    scope,
    snapshot,
    actor: snapshot.actor,
    userId: session.userId,
    locale:
      cookie.get("nexus_locale")?.value === "ja"
        ? ("ja" as const)
        : ("en" as const),
  };
}
