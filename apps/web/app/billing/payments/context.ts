import "server-only";
import { cookies } from "next/headers";
import { openSession, validateOAuthSession } from "../../auth/session";
import { serverServices } from "../../auth/server-access";
import { BillingAuthorization } from "../../../../../packages/security/src/billing-authorization";
import { BillingService } from "../../../../../packages/settings/src/billing";
import { assert } from "../../../../../packages/shared/src/index";
import type { Tx } from "../../../../../packages/db/src/index";

export async function personalBillingIdentity() {
  const session = openSession((await cookies()).get("nexus_session")?.value);
  assert(session, "SESSION_EXPIRED", 401);
  await validateOAuthSession(session);
  const services = serverServices();
  return {
    session,
    services,
    identity: { userId: session.userId, checkedAt: Date.now() },
    authorization: new BillingAuthorization(
      services.authority,
      services.db,
      services.vault,
    ),
  };
}
export async function personalBillingContext(
  accountId: string,
  action: "PORTAL" | "CANCEL",
) {
  const context = await personalBillingIdentity();
  const account = await context.authorization.authorizeFinancial(
    accountId,
    context.identity,
    action,
  );
  return {
    ...context,
    ...account,
    billing: new BillingService(context.services.db, context.services.vault),
    revalidate: async (tx: Tx) => {
      await validateOAuthSession(context.session);
      await context.authorization.authorizeFinancial(
        accountId,
        { userId: context.session.userId, checkedAt: Date.now() },
        action,
        tx,
      );
    },
  };
}
