import { NextRequest, NextResponse } from "next/server";
import {
  BillingService,
  StripeBillingProvider,
} from "../../../../../../packages/settings/src/billing";
import { isDomainError } from "../../../../../../packages/shared/src/index";
import { serverServices } from "../../../auth/server-access";
import { billingWebhookRequest } from "../../webhook-request";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const { body, headers } = await billingWebhookRequest(request);
    const { db, vault } = serverServices();
    // Only receive() can cross the inbox boundary, after adapter verification.
    // Acknowledges the durable verified signal; workers retrieve authoritative state.
    const result = await new BillingService(db, vault).receive(
      new StripeBillingProvider(),
      body,
      headers,
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: isDomainError(error)
          ? error.code
          : "BILLING_PROVIDER_NOT_CONFIGURED",
      },
      {
        status: isDomainError(error) ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
