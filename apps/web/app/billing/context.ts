import "server-only";
import { cookies } from "next/headers";
import { openSession, validateOAuthSession } from "../auth/session";
import { serverServices } from "../auth/server-access";
import { scopeForGuild } from "../../../../packages/security/src/scoping";
import {
  BillingAuthorization,
  internalBillingActor,
  type BillingAction,
} from "../../../../packages/security/src/billing-authorization";
import { BillingService } from "../../../../packages/settings/src/billing";
import { PromotionService } from "../../../../packages/settings/src/promotions";
import { assert } from "../../../../packages/shared/src/index";
export async function billingContext(action: BillingAction = "VIEW") {
  const cookie = await cookies(),
    session = openSession(cookie.get("nexus_session")?.value),
    guildId = cookie.get("nexus_guild")?.value;
  assert(session, "SESSION_EXPIRED", 401);
  assert(guildId && /^\d{17,20}$/.test(guildId), "BILLING_GUILD_REQUIRED", 403);
  await validateOAuthSession(session);
  const services = serverServices(),
    scope = scopeForGuild(guildId);
  const snapshot = await new BillingAuthorization(
    services.authority,
    services.db,
    services.vault,
  ).authorize(scope, session.userId, action, "WEB_DASHBOARD", "billing-web");
  assert(
    (await services.verification.connection(scope, session.userId)).state ===
      "VERIFIED",
    "SERVER_VERIFICATION_REQUIRED",
    403,
  );
  return {
    scope,
    snapshot,
    services,
    billing: new BillingService(services.db, services.vault),
    promotions: new PromotionService(services.db, services.vault),
  };
}
export async function internalBillingContext(reason: string) {
  const session = openSession((await cookies()).get("nexus_session")?.value);
  assert(session, "SESSION_EXPIRED", 401);
  await validateOAuthSession(session);
  const services = serverServices(),
    actor = internalBillingActor(session.userId, services.vault, reason);
  return {
    services,
    actor,
    promotions: new PromotionService(services.db, services.vault),
  };
}
