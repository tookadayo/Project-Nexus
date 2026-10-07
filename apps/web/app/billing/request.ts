import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DomainError } from "../../../../packages/shared/src/index";
import { assert, isDomainError } from "../../../../packages/shared/src/index";
import {
  errorCategory,
  userFailure,
} from "../../../../packages/shared/src/errors";
export async function billingBody(request: NextRequest, maximum = 4096) {
  const declared = request.headers.get("content-length");
  if (declared)
    assert(
      Number.isInteger(Number(declared)) && Number(declared) <= maximum,
      "BILLING_BODY_TOO_LARGE",
      413,
    );
  if (!request.body) return "";
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maximum) {
        await reader.cancel();
        assert(false, "BILLING_BODY_TOO_LARGE", 413);
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function billingFailure(error: unknown, fallback = 503) {
  if(error instanceof z.ZodError || error instanceof SyntaxError) error=new DomainError("BILLING_INPUT_INVALID",400);
  const category = errorCategory(error),
    safe = ["INTERNAL", "DATABASE_FAILURE"].includes(category)
      ? new Error("BILLING_REQUEST_FAILED")
      : error;
  return NextResponse.json(
    {
      error: isDomainError(error) ? error.code : "BILLING_UNAVAILABLE",
      failure: userFailure(safe, "UNKNOWN", {
        action: "billing",
        stage: "request",
      }),
    },
    {
      status: isDomainError(error) ? error.status : fallback,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
