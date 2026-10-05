import { assert } from "../../../../packages/shared/src/index";

const MAX_WEBHOOK_BYTES = 65536;

// Read bytes once, before any JSON parser or provider signature verification.
// Declared length is untrusted; the stream limit is enforced independently.
export async function billingWebhookRequest(request: Request) {
  const declaredContentLength = request.headers.get("content-length");
  if (declaredContentLength !== null) {
    assert(
      /^\d+$/.test(declaredContentLength),
      "BILLING_CONTENT_LENGTH_INVALID",
      400,
    );
    assert(
      Number(declaredContentLength) <= MAX_WEBHOOK_BYTES,
      "BILLING_EVENT_TOO_LARGE",
      413,
    );
  }
  const chunks: Uint8Array[] = [];
  let actualBodyLength = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        actualBodyLength += part.value.byteLength;
        if (actualBodyLength > MAX_WEBHOOK_BYTES) {
          await reader.cancel();
          assert(false, "BILLING_EVENT_TOO_LARGE", 413);
        }
        chunks.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const headers: Record<string, string> = {
    "Nexus-Actual-Body-Length": String(actualBodyLength),
  };
  const signature = request.headers.get("stripe-signature");
  if (signature !== null) headers["Stripe-Signature"] = signature;
  if (declaredContentLength !== null)
    headers["Content-Length"] = declaredContentLength;
  return {
    body: Buffer.concat(chunks, actualBodyLength),
    headers,
    actualBodyLength,
    declaredContentLength,
  };
}
