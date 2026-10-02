import { NextRequest, NextResponse } from "next/server";
import { UnconfiguredBillingProvider } from "../../../../../../packages/settings/src/billing-provider";
// Disabled until a real provider adapter owns signature validation and event normalization.
export async function POST(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > 65536)
    return NextResponse.json(
      { error: "BILLING_EVENT_TOO_LARGE" },
      { status: 413 },
    );
  try {
    await new UnconfiguredBillingProvider("EXTERNAL").parseEvent(
      Buffer.alloc(0),
      {},
    );
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
