import "server-only";
import { cookies } from "next/headers";
import { openSession, validateOAuthSession } from "../auth/session";
import { manageableConnection, serverServices } from "../auth/server-access";
import { scopeForGuild } from "../../../../packages/security/src/scoping";
import {
  BillingAuthorization,
  internalBillingActor,
  type BillingAction,
} from "../../../../packages/security/src/billing-authorization";
import { BillingService } from "../../../../packages/settings/src/billing";
import { PromotionService } from "../../../../packages/settings/src/billing";
import { assert } from "../../../../packages/shared/src/index";
import { sql, type Tx } from "../../../../packages/db/src/index";
export async function billingContext(
  action: BillingAction = "VIEW",
  selectedGuildId?: string,
  requireVerification = true,
) {
  const cookie = await cookies(),
    session = openSession(cookie.get("nexus_session")?.value),
    guildId = selectedGuildId ?? cookie.get("nexus_guild")?.value;
  assert(session, "SESSION_EXPIRED", 401);
  assert(guildId && /^\d{17,20}$/.test(guildId), "BILLING_GUILD_REQUIRED", 403);
  await validateOAuthSession(session);
  const services = serverServices(),
    scope = scopeForGuild(guildId);
  const authority = new BillingAuthorization(
    services.authority,
    services.db,
    services.vault,
  );
  const snapshot = await authority.authorize(
    scope,
    session.userId,
    action,
    "WEB_DASHBOARD",
    "billing-web",
  );
  assert(
    !requireVerification ||
      (await services.verification.connection(scope, session.userId)).state ===
        "VERIFIED",
    "SERVER_VERIFICATION_REQUIRED",
    403,
  );
  let canManage = true;
  try {
    await new BillingAuthorization(
      services.authority,
      services.db,
      services.vault,
    ).require(snapshot, "UPGRADE");
  } catch {
    canManage = false;
  }
  let canPortal = true;
  try {
    await authority.require(snapshot, "PORTAL");
  } catch {
    canPortal = false;
  }
  return {
    scope,
    canManage,
    canPortal,
    canCommunity: Boolean(
      await manageableConnection(scope.guildId, session.userId),
    ),
    snapshot,
    services,
    session,
    principalActorHash: authority.principalHash(scope, session.userId),
    ownership: await authority.ownership(scope, snapshot.member.ownerId),
    revalidateManagement: async (tx: Tx) => {
      await validateOAuthSession(session);
      const currentAuthorization = new BillingAuthorization(
        services.authority,
        tx,
        services.vault,
      );
      await currentAuthorization.authorize(
        scope,
        session.userId,
        action,
        "WEB_DASHBOARD",
        "billing-web-revalidate",
      );
      assert(
        !requireVerification ||
          (await services.verification.connection(scope, session.userId, tx))
            .state === "VERIFIED",
        "SERVER_VERIFICATION_REQUIRED",
        403,
      );
      if (["PORTAL", "CANCEL", "CHANGE"].includes(action)) {
        const account = (
          await sql<{
            id: string;
          }>`SELECT id FROM billing_accounts WHERE organization_id=${scope.organizationId}::uuid AND deleted_at IS NULL`.execute(
            tx,
          )
        ).rows[0];
        assert(account, "BILLING_ACCOUNT_UNAVAILABLE", 403);
        const financial = await currentAuthorization.authorizeFinancial(
          account.id,
          { userId: session.userId, checkedAt: Date.now() },
          action as "PORTAL" | "CANCEL" | "CHANGE",
          tx,
        );
        assert(
          financial.scope.guildId === scope.guildId,
          "BILLING_SCOPE_CONFLICT",
          403,
        );
      }
    },
    revalidateCheckout: async (tx: Tx) => {
      await validateOAuthSession(session);
      await services.authority.revalidateOwner(
        scope,
        session.userId,
        snapshot,
        tx,
      );
      assert(
        (await services.verification.connection(scope, session.userId, tx))
          .state === "VERIFIED",
        "SERVER_VERIFICATION_REQUIRED",
        403,
      );
    },
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
