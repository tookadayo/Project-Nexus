import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../../auth/origin";
import { billingBody, billingFailure } from "../../request";
import { personalBillingContext } from "../context";
import { assert } from "../../../../../../packages/shared/src/index";
import {
  BillingOperationService,
  StripeBillingProvider,
} from "../../../../../../packages/settings/src/billing";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const input = z
      .object({
        action: z.enum(["portal", "cancel"]),
        accountId: z.uuid(),
        idempotencyKey: z.uuid(),
        confirmed: z.boolean().optional(),
      })
      .strict()
      .parse(JSON.parse(await billingBody(request)));
    assert(
      input.action !== "cancel" || input.confirmed === true,
      "BILLING_CONFIRMATION_REQUIRED",
      409,
    );
    const context = await personalBillingContext(
      input.accountId,
      input.action === "portal" ? "PORTAL" : "CANCEL",
    );
    const provider = new StripeBillingProvider();
    if (input.action === "cancel") {
      await context.billing.cancelSubscription(
        context.scope,
        provider,
        input.idempotencyKey,
        "AT_PERIOD_END",
        context.revalidate,
      );
      return NextResponse.json(
        { state: "CONFIRMING" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const customer = await context.billing.customerReference(
      context.scope,
      "STRIPE",
    );
    const result = await new BillingOperationService(
      context.services.db,
      context.services.vault,
    ).session(
      {
        scope: context.scope,
        provider: "STRIPE",
        operation: "PORTAL",
        idempotencyKey: input.idempotencyKey,
        customer,
        principalActorHash: context.principalActorHash,
        externalBoundary: "ADAPTER",
        revalidate: context.revalidate,
      },
      (execution) => {
        assert(
          execution.customer,
          "BILLING_CUSTOMER_REFERENCE_UNAVAILABLE",
          409,
        );
        return provider.createPortalSession({
          scope: context.scope,
          customer: execution.customer,
          idempotencyKey: execution.idempotencyKey,
          beforeMutation: execution.beforeMutation,
          afterMutation: execution.afterMutation,
        });
      },
    );
    // The financial route exposes only the newly authorized portal URL, never provider references.
    return NextResponse.json(
      { url: result.url },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return billingFailure(error);
  }
}
