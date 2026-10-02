import { NextRequest, NextResponse } from "next/server";
import { StripeBillingProvider } from "../../../../../../packages/settings/src/billing";
// Fail closed without reading/parsing JSON. Future adapter receives exact raw bytes
// and Stripe-Signature; only verified signals may enter the inbox.
export async function POST(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 65536)
    return NextResponse.json(
      { error: "BILLING_EVENT_TOO_LARGE" },
      { status: 413 },
    );
  try {
    await new StripeBillingProvider().verifyWebhook(Buffer.alloc(0), {});
  } catch {
    return NextResponse.json(
      { error: "BILLING_PROVIDER_NOT_CONFIGURED" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { error: "BILLING_PROVIDER_NOT_CONFIGURED" },
    { status: 503 },
  );
}
