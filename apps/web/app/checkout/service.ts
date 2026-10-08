import "server-only";
import {
  BillingOperationService,
  checkoutOffering,
  StripeBillingProvider,
} from "../../../../packages/settings/src/billing";
import { assert } from "../../../../packages/shared/src/index";
import { checkoutReceipt } from "../auth/checkout-intent";
import { publicBillingCatalog } from "../billing/catalog";
import { pendingCheckout } from "./pending";
import type { billingContext } from "../billing/context";

export async function startCheckout(
  context: Awaited<ReturnType<typeof billingContext>>,
  input: {
    offeringId: string;
    idempotencyKey: string;
    promotionReservationId?: string;
  },
  ui: "HOSTED" | "ELEMENTS" = process.env.NEXUS_STRIPE_CHECKOUT_UI === "HOSTED"
    ? "HOSTED"
    : "ELEMENTS",
) {
  const pending = await pendingCheckout();
  assert(
    !pending ||
      (pending.context.scope.guildId === context.scope.guildId &&
        pending.context.offering.id === input.offeringId),
    "BILLING_CHECKOUT_IN_PROGRESS",
    409,
  );
  const catalog = await publicBillingCatalog();
  assert(
    catalog.launch.checkoutEnabled &&
      catalog.offerings.some((row) => row.id === input.offeringId),
    "BILLING_OFFERING_UNAVAILABLE",
    409,
  );
  const offering = await checkoutOffering(
    context.services.db,
    input.offeringId,
  );
  assert(
    offering.provider === "STRIPE" &&
      offering.currency === "USD" &&
      offering.billingInterval === "MONTH" &&
      offering.billingIntervalCount === 1,
    "BILLING_OFFERING_UNAVAILABLE",
    409,
  );
  const result = await new BillingOperationService(
    context.services.db,
    context.services.vault,
  ).session(
    {
      scope: context.scope,
      provider: "STRIPE",
      operation: "CHECKOUT",
      offeringId: offering.id,
      idempotencyKey: input.idempotencyKey,
      promotionReservationId: input.promotionReservationId,
      checkoutUi: ui,
      principalActorHash: context.principalActorHash,
      externalBoundary: "ADAPTER",
      revalidate: context.revalidateCheckout,
    },
    async (execution) => {
      assert(execution.offering, "BILLING_OFFERING_REQUIRED", 409);
      const confirmationToken = checkoutReceipt({
        operationId: execution.operationId,
        offeringId: offering.id,
        guildId: context.scope.guildId,
        userId: context.session.userId,
      });
      const providerResult = await new StripeBillingProvider().createCheckout({
        scope: context.scope,
        operationId: execution.operationId,
        offeringId: offering.id,
        offering: execution.offering,
        idempotencyKey: execution.idempotencyKey,
        customer: execution.customer,
        promotion: execution.promotion,
        onCustomerCreated: execution.onCustomerCreated,
        beforeMutation: execution.beforeMutation,
        afterMutation: execution.afterMutation,
        checkoutExpiresAt: execution.checkoutExpiresAt,
        ui,
        confirmationToken,
      });
      return {
        ...providerResult,
        confirmationToken,
        guildName: context.snapshot.member.guildName ?? context.scope.guildId,
      };
    },
  );
  assert(result.confirmationToken, "BILLING_CONFIRMATION_UNAVAILABLE", 502);
  const confirmationUrl = `/checkout/confirmation?receipt=${encodeURIComponent(result.confirmationToken)}`;
  return {
    kind: result.kind ?? "HOSTED",
    ...(result.kind === "ELEMENTS"
      ? {
          clientSecret: result.clientSecret,
          publishableKey: process.env.STRIPE_PUBLISHABLE_KEY!,
        }
      : { url: result.url }),
    expiresAt: result.expiresAt,
    confirmationUrl,
  };
}
