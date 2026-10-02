import { NextResponse } from "next/server";
import { billingContext } from "../context";
import { billingFailure } from "../request";

export async function GET() {
  try {
    const context = await billingContext();
    return NextResponse.json(
      {
        ...(await context.billing.view(context.scope)),
        canManage: context.canManage,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return billingFailure(error);
  }
}
