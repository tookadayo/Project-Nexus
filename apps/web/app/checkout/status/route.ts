import { NextRequest, NextResponse } from "next/server";
import { checkoutReceiptContext } from "../receipt-context";
import { billingFailure } from "../../billing/request";
export async function GET(request: NextRequest) {
  try {
    const context = await checkoutReceiptContext(
      request.nextUrl.searchParams.get("receipt") ?? undefined,
    );
    return NextResponse.json(
      {
        state: context.confirmation,
        plan: context.offering.planKey,
        guildId: context.scope.guildId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return billingFailure(error);
  }
}
