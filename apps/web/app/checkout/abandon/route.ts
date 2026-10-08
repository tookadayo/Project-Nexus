import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "../../auth/origin";
import { billingBody, billingFailure } from "../../billing/request";
import { assert } from "../../../../../packages/shared/src/index";
import { checkoutReceiptContext } from "../receipt-context";
import { serverServices } from "../../auth/server-access";
import { abandonCheckout } from "../../../../../packages/settings/src/billing/checkout-lifecycle";
import { StripeBillingProvider } from "../../../../../packages/settings/src/billing";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    assert(sameOrigin(request), "ORIGIN_REJECTED", 403);
    const { receipt } = z
      .object({ receipt: z.string().max(4096) })
      .strict()
      .parse(JSON.parse(await billingBody(request)));
    const context = await checkoutReceiptContext(receipt),
      services = serverServices();
    await abandonCheckout(
      services.db,
      services.vault,
      context.scope,
      context.operation.id,
      context.operation.principal_actor_hash!,
      (ref) =>
        new StripeBillingProvider().verifyAbandonedCheckout(
          context.scope,
          ref,
          context.operation.id,
        ),
    );
    const response = NextResponse.json(
      { state: "EXPIRED" },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.delete("nexus_checkout_receipt");
    return response;
  } catch (error) {
    return billingFailure(error);
  }
}
