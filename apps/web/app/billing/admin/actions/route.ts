import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../../auth/origin";
import { internalBillingContext } from "../../context";
import {
  scopeSchema,
  assert,
} from "../../../../../../packages/shared/src/index";
import { billingBody, billingFailure } from "../../request";
export async function POST(request: NextRequest) {
  try {
    assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const text = await billingBody(request, 20000);
    const input = z
      .object({
        action: z.enum([
          "create_campaign",
          "activate_campaign",
          "generate_code",
          "search",
          "revoke_code",
          "revoke_campaign",
          "history",
          "issue_grant",
          "revoke_grant",
        ]),
        reason: z.string().min(8).max(500),
        id: z.uuid().optional(),
        query: z.string().max(120).optional(),
        scope: scopeSchema.optional(),
        campaign: z.unknown().optional(),
        grant: z.unknown().optional(),
      })
      .strict()
      .parse(JSON.parse(text));
    const context = await internalBillingContext(input.reason),
      service = context.promotions;
    let result: unknown;
    if (input.action === "create_campaign")
      result = await service.createCampaign(context.actor, input.campaign);
    else if (input.action === "search")
      result = await service.search(context.actor, input.query);
    else if (input.action === "issue_grant") {
      assert(input.scope, "SCOPE_REQUIRED");
      result = await service.issueGrant(
        input.scope,
        context.actor,
        input.grant as Parameters<typeof service.issueGrant>[2],
      );
    } else {
      assert(input.id, "ID_REQUIRED");
      if (input.action === "generate_code")
        result = await service.generateCode(context.actor, input.id);
      else if (input.action === "activate_campaign")
        result = await service.activateCampaign(context.actor, input.id);
      else if (input.action === "history")
        result = await service.history(context.actor, input.id);
      else if (input.action === "revoke_grant") {
        assert(input.scope, "SCOPE_REQUIRED");
        await service.revokeGrant(input.scope, context.actor, input.id);
        result = { revoked: true };
      } else {
        await service.revoke(
          context.actor,
          input.action === "revoke_code" ? "code" : "campaign",
          input.id,
        );
        result = { revoked: true };
      }
    }
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    return billingFailure(error, 400);
  }
}
