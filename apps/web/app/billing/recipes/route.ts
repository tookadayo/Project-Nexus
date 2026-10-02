import { NextRequest, NextResponse } from "next/server";
import { billingContext } from "../context";
import { sameOrigin } from "../../auth/origin";
import { saveCustomRecipe } from "../../../../../packages/settings/src/recipes";
import { assert } from "../../../../../packages/shared/src/index";
import { billingBody, billingFailure } from "../request";
export async function POST(request: NextRequest) {
  try {
    assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const text = await billingBody(request),
      context = await billingContext("VIEW");
    const result = await context.services.db
      .transaction()
      .execute(async (tx) => {
        const actor = await context.services.authority.revalidate(
          context.scope,
          context.snapshot.userId,
          context.snapshot,
          tx,
        );
        return saveCustomRecipe(tx, context.scope, actor.key, JSON.parse(text));
      });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return billingFailure(error, 400);
  }
}
