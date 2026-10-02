import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../auth/origin";
import { billingContext } from "../context";
import { plans } from "../../../../../packages/settings/src/plan-registry";
import { providers } from "../../../../../packages/settings/src/billing";
import {
  UnconfiguredBillingProvider,
  DiscordBillingProvider,
} from "../../../../../packages/settings/src/billing";
import { checkoutOffering } from "../../../../../packages/settings/src/billing";
import {
  StripeBillingProvider,
  BillingOperationService,
} from "../../../../../packages/settings/src/billing";
import { DiscordRest } from "../../../../../packages/discord/src/rest";
import { assert } from "../../../../../packages/shared/src/index";
import { billingBody, billingFailure } from "../request";
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
      ])
      .parse(JSON.parse(text));
    const context = await billingContext(
      input.action === "redeem"
        ? "REDEEM"
        : ["checkout", "portal"].includes(input.action)
          ? "UPGRADE"
          : "VIEW",
    );
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
          },
          () =>
            new StripeBillingProvider().createPortalSession({
              scope: context.scope,
              idempotencyKey: input.idempotencyKey,
            }),
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
    const provider =
      offering.provider === "DISCORD"
        ? new DiscordBillingProvider(
            new DiscordRest(
              process.env.DISCORD_TOKEN!,
              process.env.DISCORD_APPLICATION_ID!,
            ),
          )
        : offering.provider === "STRIPE"
          ? new StripeBillingProvider()
          : new UnconfiguredBillingProvider(offering.provider);
    assert(
      offering.provider === "STRIPE" || offering.provider === "DISCORD",
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
      },
      () =>
        provider.createCheckout({
          scope: context.scope,
          offeringId: offering.id,
          offering,
          idempotencyKey: input.idempotencyKey,
          promotionReservationId: input.promotionReservationId,
        }),
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return billingFailure(error);
  }
}
