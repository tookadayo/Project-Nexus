import { createHmac, timingSafeEqual } from "node:crypto";
// Test fixture helper only. This is not Stripe or Discord signature verification
// and must never be imported by runtime code. Stripe requires its official SDK.
export function verifyBillingHmac(
  body: Buffer,
  signature: string,
  timestamp: string,
  secret: string,
  now = Date.now(),
) {
  if (
    body.length > 65536 ||
    secret.length < 32 ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 300000 ||
    !/^[a-f0-9]{64}$/i.test(signature)
  )
    return false;
  const expected = createHmac("sha256", secret)
      .update(timestamp + ".")
      .update(body)
      .digest(),
    actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
