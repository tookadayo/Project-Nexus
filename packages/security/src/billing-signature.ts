import { createHmac, timingSafeEqual } from "node:crypto";
// Adapter helper, not a claimed Stripe/Discord webhook format. A real adapter must
// implement its provider's exact signing specification before enabling reception.
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
