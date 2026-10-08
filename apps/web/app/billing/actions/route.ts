import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../auth/origin";
import { billingContext } from "../context";
import { plans } from "../../../../../packages/settings/src/plan-registry";
import { providers } from "../../../../../packages/settings/src/billing";
import { planRank } from "../../../../../packages/settings/src/plan-registry";
import { PromotionReservationService } from "../../../../../packages/settings/src/billing";
import {
  UnconfiguredBillingProvider,
  DiscordBillingProvider,
} from "../../../../../packages/settings/src/billing";
import { checkoutOffering } from "../../../../../packages/settings/src/billing";
import {
  StripeBillingProvider,
  BillingOperationService,
  stripeConfiguration,
} from "../../../../../packages/settings/src/billing";
import { DiscordRest } from "../../../../../packages/discord/src/rest";
import { assert } from "../../../../../packages/shared/src/index";
import { billingBody, billingFailure } from "../request";
import { startCheckout } from "../../checkout/service";
export async function POST(request: NextRequest) {
  try {
    assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const text = await billingBody(request);
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("preview"),
            targetPlan: z.enum(plans),
            provider: z.enum(providers),
          })
          .strict(),
        z
          .object({ action: z.literal("redeem"), code: z.string().max(128) })
          .strict(),
        z
          .object({
            action: z.literal("checkout"),
            offeringId: z.uuid(),
            idempotencyKey: z.uuid(),
            promotionReservationId: z.uuid().optional(),
          })
          .strict(),
        z
          .object({ action: z.literal("portal"), idempotencyKey: z.uuid() })
          .strict(),
        z
          .object({
            action: z.literal("change"),
            offeringId: z.uuid(),
            idempotencyKey: z.uuid(),
          })
          .strict(),
        z
          .object({ action: z.literal("cancel"), idempotencyKey: z.uuid() })
          .strict(),
        z
          .object({ action: z.literal("payment"), idempotencyKey: z.uuid() })
          .strict(),
        z
          .object({
            action: z.literal("reserve"),
            offeringId: z.uuid(),
            code: z.string().max(128),
            idempotencyKey: z.uuid(),
          })
          .strict(),
      ])
      .parse(JSON.parse(text));
    const context = await billingContext(
      input.action === "redeem" || input.action === "reserve"
        ? "REDEEM"
        : input.action === "checkout"
          ? "CHECKOUT"
          : input.action === "portal"
            ? "PORTAL"
            : input.action === "change" || input.action === "payment"
              ? "CHANGE"
              : input.action === "cancel"
                ? "CANCEL"
                : "VIEW",
    );
    if (input.action === "payment") {
      const payment = await context.billing.pendingPayment(
        context.scope,
        new StripeBillingProvider(),
      );
      await context.services.db
        .transaction()
        .execute(context.revalidateManagement);
      return NextResponse.json(payment, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (input.action === "reserve")
      return NextResponse.json(
        await new PromotionReservationService(
          context.services.db,
          context.services.vault,
        ).reserve(context.scope, context.snapshot.actor.key, input),
        { headers: { "Cache-Control": "no-store" } },
      );
    if (input.action === "change" || input.action === "cancel") {
      const state = await context.billing.status(context.scope),
        current = state.subscriptions.find(
          (s) =>
            s.provider === "STRIPE" &&
            !["CANCELED", "EXPIRED"].includes(s.status),
        );
      assert(current, "BILLING_SUBSCRIPTION_REFERENCE_UNAVAILABLE", 409);
      const provider = new StripeBillingProvider();
      let changeResult;
      if (input.action === "cancel")
        await context.billing.cancelSubscription(
          context.scope,
          provider,
          input.idempotencyKey,
          "AT_PERIOD_END",
          context.revalidateManagement,
        );
      else {
        const target = await checkoutOffering(
          context.services.db,
          input.offeringId,
        );
        assert(
          target.provider === current.provider,
          "BILLING_PROVIDER_MISMATCH",
          409,
        );
        const upgrade = planRank(target.planKey) > planRank(current.plan);
        changeResult = await context.billing.changeSubscription(
          context.scope,
          provider,
          input.offeringId,
          input.idempotencyKey,
          {
            effective: upgrade ? "IMMEDIATE" : "AT_PERIOD_END",
            proration: upgrade ? "PROVIDER_CALCULATED" : "NONE",
          },
          context.revalidateManagement,
        );
      }
      await context.billing.reconcileLatest(context.scope, provider);
      return NextResponse.json(changeResult ?? { state: "CONFIRMING" }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (input.action === "redeem") {
      const state = await context.billing.status(context.scope),
        provider =
          state.subscriptions.find((row) => row.status === "ACTIVE")
            ?.provider ?? "MANUAL";
      return NextResponse.json(
        await context.promotions.redeem(
          context.scope,
          context.snapshot.actor.key,
          input.code,
          provider,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (input.action === "portal") {
      assert(
        stripeConfiguration().capability !== "NOT_CONFIGURED",
        "BILLING_PROVIDER_NOT_CONFIGURED",
        503,
      );
      const customer = await context.billing.customerReference(
        context.scope,
        "STRIPE",
      );
      return NextResponse.json(
        await new BillingOperationService(
          context.services.db,
          context.services.vault,
        ).session(
          {
            scope: context.scope,
            provider: "STRIPE",
            operation: "PORTAL",
            idempotencyKey: input.idempotencyKey,
            customer,
            externalBoundary: "ADAPTER",
            revalidate: context.revalidateManagement,
          },
          ({
            idempotencyKey,
            customer: trustedCustomer,
            beforeMutation,
            afterMutation,
          }) => {
            assert(
              trustedCustomer,
              "BILLING_CUSTOMER_REFERENCE_UNAVAILABLE",
              409,
            );
            return new StripeBillingProvider().createPortalSession({
              scope: context.scope,
              customer: trustedCustomer,
              idempotencyKey,
              beforeMutation,
              afterMutation,
            });
          },
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (input.action === "preview") {
      const preview = await context.billing.preview(
        context.scope,
        input.targetPlan,
        input.provider,
      );
      return NextResponse.json(preview, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const offering = await checkoutOffering(
      context.services.db,
      input.offeringId,
    );
    if (offering.provider === "STRIPE") {
      const result = await startCheckout(context, input, "HOSTED"),
        response = NextResponse.json(result, {
          headers: { "Cache-Control": "no-store" },
        });
      response.cookies.set(
        "nexus_checkout_receipt",
        new URL(
          result.confirmationUrl,
          "https://nexus.invalid",
        ).searchParams.get("receipt")!,
        {
          httpOnly: true,
          sameSite: "lax",
          secure: request.nextUrl.protocol === "https:",
          path: "/",
          maxAge: 86400,
        },
      );
      return response;
    }
    const provider =
      offering.provider === "DISCORD"
        ? new DiscordBillingProvider(
            new DiscordRest(
              process.env.DISCORD_TOKEN!,
              process.env.DISCORD_APPLICATION_ID!,
            ),
          )
        : new UnconfiguredBillingProvider(offering.provider);
    assert(
      offering.provider === "DISCORD",
      "BILLING_OFFERING_UNAVAILABLE",
      409,
    );
    const result = await new BillingOperationService(
      context.services.db,
      context.services.vault,
    ).session(
      {
        scope: context.scope,
        provider: offering.provider,
        operation: "CHECKOUT",
        idempotencyKey: input.idempotencyKey,
        offeringId: offering.id,
        promotionReservationId: input.promotionReservationId,
        principalActorHash: context.principalActorHash,
        revalidate: context.revalidateCheckout,
      },
      ({
        operationId,
        idempotencyKey,
        offering: trustedOffering,
        promotion,
        customer,
        onCustomerCreated,
        checkoutExpiresAt,
      }) => {
        assert(trustedOffering, "BILLING_OFFERING_REQUIRED", 409);
        return provider.createCheckout({
          scope: context.scope,
          operationId,
          offeringId: trustedOffering.id,
          offering: trustedOffering,
          idempotencyKey,
          promotion,
          customer,
          onCustomerCreated,
          checkoutExpiresAt,
        });
      },
    );
    // Provider session identifiers remain internal operation bindings.
    return NextResponse.json(
      {
        url: result.url,
        ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
        cacheUntil: result.cacheUntil,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return billingFailure(error);
  }
}
