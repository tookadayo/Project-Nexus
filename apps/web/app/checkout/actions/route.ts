import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../auth/origin";
import { assert } from "../../../../../packages/shared/src/index";
import { billingBody, billingFailure } from "../../billing/request";
import { billingContext } from "../../billing/context";
import { PromotionReservationService } from "../../../../../packages/settings/src/billing";
import { pendingCheckout } from "../pending";
import { startCheckout } from "../service";
export const runtime = "nodejs";
const inputSchema = z
  .object({
    action: z.enum(["start", "reserve"]),
    guildId: z.string().regex(/^\d{17,20}$/),
    offeringId: z.uuid(),
    idempotencyKey: z.uuid(),
    promotionReservationId: z.uuid().optional(),
    code: z.string().max(128).optional(),
  })
  .strict();
export async function POST(request: NextRequest) {
  try {
    assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const input = inputSchema.parse(JSON.parse(await billingBody(request)));
    const pending = await pendingCheckout();
    assert(
      !pending ||
        (pending.context.scope.guildId === input.guildId &&
          pending.context.offering.id === input.offeringId),
      "BILLING_CHECKOUT_IN_PROGRESS",
      409,
    );
    const context = await billingContext("CHECKOUT", input.guildId);
    const result =
      input.action === "reserve"
        ? await new PromotionReservationService(
            context.services.db,
            context.services.vault,
          ).reserve(context.scope, context.snapshot.actor.key, {
            offeringId: input.offeringId,
            idempotencyKey: input.idempotencyKey,
            code: input.code ?? "",
          })
        : await startCheckout(context, input);
    const response = NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
    response.cookies.set("nexus_guild", context.scope.guildId, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
    });
    if (input.action === "start" && "confirmationUrl" in result) {
      const receipt = new URL(
        result.confirmationUrl as string,
        "https://nexus.invalid",
      ).searchParams.get("receipt")!;
      response.cookies.set("nexus_checkout_receipt", receipt, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 86400,
      });
    }
    return response;
  } catch (error) {
    return billingFailure(error);
  }
}
