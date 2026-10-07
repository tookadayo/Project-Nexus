import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { openCheckoutReceipt } from "../auth/checkout-intent";
import { openSession, validateOAuthSession } from "../auth/session";
import { serverServices } from "../auth/server-access";
import { scopeForGuild } from "../../../../packages/security/src/scoping";
import {
  BillingService,
  billingOffering,
} from "../../../../packages/settings/src/billing";
import { BillingAuthorization } from "../../../../packages/security/src/billing-authorization";
import { sql, tenant } from "../../../../packages/db/src/index";
import type { ConfirmationState } from "./confirmation/state";
import { assert } from "../../../../packages/shared/src/index";
import { planRank } from "../../../../packages/settings/src/plan-registry";
export async function checkoutReceiptContext(value: string | undefined) {
  const receipt = openCheckoutReceipt(value),
    session = openSession((await cookies()).get("nexus_session")?.value);
  assert(session, "SESSION_EXPIRED", 401);
  assert(
    receipt && receipt.userId === session.userId,
    "BILLING_RECEIPT_INVALID",
    403,
  );
  await validateOAuthSession(session);
  const scope = scopeForGuild(receipt.guildId),
    services = serverServices();
  const operation = (
    await sql<{
      id: string;
      offering_id: string;
      principal_actor_hash: string | null;
      state: string;
      checkout_expires_at: Date | null;
      checkout_completed_at: Date | null;
      checkout_abandoned_at: Date | null;
      result_ciphertext: string | null;
    }>`SELECT id,offering_id,principal_actor_hash,state,checkout_expires_at,checkout_completed_at,checkout_abandoned_at,result_ciphertext FROM billing_operations WHERE ${tenant(scope)} AND id=${receipt.operationId}::uuid AND operation='CHECKOUT' AND provider='STRIPE'`.execute(
      services.db,
    )
  ).rows[0];
  assert(
    operation &&
      operation.offering_id === receipt.offeringId &&
      operation.principal_actor_hash ===
        new BillingAuthorization(
          services.authority,
          services.db,
          services.vault,
        ).principalHash(scope, session.userId),
    "BILLING_RECEIPT_INVALID",
    403,
  );
  const billing = new BillingService(services.db, services.vault),
    state = await billing.status(scope);
  assert(!state.privacyDeleted, "PRIVACY_DELETED", 403);
  const offering = await billingOffering(services.db, receipt.offeringId);
  assert(
    offering.currency === "USD" &&
      offering.unitAmountMinor !== null &&
      Number.isSafeInteger(offering.unitAmountMinor),
    "BILLING_OFFERING_INCOMPLETE",
    409,
  );
  // Never return provider references or internal binding identities.
  const result = operation.result_ciphertext
    ? z
        .object({
          kind: z.enum(["HOSTED", "ELEMENTS"]).optional(),
          clientSecret: z.string().optional(),
          url: z.string().optional(),
          expiresAt: z.string().optional(),
          guildName: z.string().optional(),
        })
        .parse(
          JSON.parse(services.vault.open(scope, operation.result_ciphertext)),
        )
    : null;
  const paid = state.subscriptions.find(
    (sub) =>
      sub.provider === "STRIPE" &&
      sub.plan === offering.planKey &&
      ["ACTIVE", "CANCEL_AT_PERIOD_END"].includes(sub.status),
  );
  const confirmation: ConfirmationState =
    paid &&
    operation.checkout_completed_at &&
    planRank(state.plan) >= planRank(offering.planKey) &&
    !state.grace &&
    !state.conflict
      ? "ACTIVE"
      : state.subscriptions.some(
            (sub) =>
              sub.provider === "STRIPE" &&
              ["PAST_DUE", "INCOMPLETE"].includes(sub.status),
          )
        ? "ACTION_REQUIRED"
        : operation.state === "FAILED"
          ? "FAILED"
          : operation.checkout_abandoned_at ||
              (operation.checkout_expires_at &&
                operation.checkout_expires_at <= new Date() &&
                !operation.checkout_completed_at)
            ? "EXPIRED"
            : "CONFIRMING";
  return { receipt, scope, offering, result, confirmation, operation };
}
