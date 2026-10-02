import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../auth/origin";
import { billingContext } from "../context";
import { plans } from "../../../../../packages/settings/src/plan-registry";
import { providers } from "../../../../../packages/settings/src/billing-domain";
import {
  UnconfiguredBillingProvider,
  DiscordBillingProvider,
} from "../../../../../packages/settings/src/billing-provider";
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
            targetPlan: z.enum(plans),
            provider: z.enum(providers),
          })
          .strict(),
      ])
      .parse(JSON.parse(text));
    const context = await billingContext(
      input.action === "redeem"
        ? "REDEEM"
        : input.action === "checkout"
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
    const preview = await context.billing.preview(
      context.scope,
      input.targetPlan,
      input.provider,
    );
    if (input.action === "preview")
      return NextResponse.json(preview, {
        headers: { "Cache-Control": "no-store" },
      });
    const provider =
      input.provider === "DISCORD"
        ? new DiscordBillingProvider(
            new DiscordRest(
              process.env.DISCORD_TOKEN!,
              process.env.DISCORD_APPLICATION_ID!,
            ),
          )
        : new UnconfiguredBillingProvider(input.provider);
    const result = await provider.createCheckout(
      context.scope,
      input.targetPlan,
      context.snapshot.actor.requestId,
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return billingFailure(error);
  }
}
