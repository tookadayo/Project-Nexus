import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  checkoutLoginIntent,
  checkoutLoginOffering,
  checkoutReceipt,
  openCheckoutReceipt,
} from "../../apps/web/app/auth/checkout-intent";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("checkout OAuth intent rejects tampering, wrong state, expiry and receipt replay", () => {
  vi.stubEnv("NEXUS_SESSION_SECRET", "s".repeat(64));
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T00:00:00Z"));
  const offering = randomUUID(),
    state = "state_checkout_fixture";
  const token = checkoutLoginIntent(offering, state);
  expect(checkoutLoginOffering(token, state)).toBe(offering);
  expect(checkoutLoginOffering(token, "another_state_fixture")).toBeNull();
  const bytes = Buffer.from(token, "base64url");
  bytes[35] = bytes[35]! ^ 1;
  expect(checkoutLoginOffering(bytes.toString("base64url"), state)).toBeNull();
  expect(openCheckoutReceipt(token)).toBeNull();
  const receipt = checkoutReceipt({
    offeringId: offering,
    operationId: randomUUID(),
    guildId: "922222222222222222",
    userId: "911111111111111111",
  });
  expect(openCheckoutReceipt(receipt)?.offeringId).toBe(offering);
  expect(checkoutLoginOffering(receipt, state)).toBeNull();
  vi.advanceTimersByTime(600001);
  expect(checkoutLoginOffering(token, state)).toBeNull();
  vi.advanceTimersByTime(86400000);
  expect(openCheckoutReceipt(receipt)).toBeNull();
});
it("cannot encode arbitrary redirect or client-supplied price as an Offering", () => {
  vi.stubEnv("NEXUS_SESSION_SECRET", "s".repeat(64));
  expect(() =>
    checkoutLoginIntent("https://evil.example", "state_checkout_fixture"),
  ).toThrow();
  expect(() =>
    checkoutLoginIntent("price_fake", "state_checkout_fixture"),
  ).toThrow();
});
