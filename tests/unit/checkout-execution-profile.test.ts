import { describe, expect, it } from "vitest";
import { checkoutExecutionProfile } from "../e2e/checkout-execution-profile";
import { stripeConfiguration, commercialLaunch } from "../../packages/settings/src/billing/commerce";
import { webAuthMode } from "../../packages/config/src/web-auth";
import { webOrigin } from "../../packages/config/src/web-origin";
import { canonicalWebHost } from "../../apps/web/app/auth/public-boundary";

describe("synthetic checkout execution profile", () => {
  it("makes the actual Sandbox catalog available without live sales approval", () => {
    expect(stripeConfiguration(checkoutExecutionProfile)).toMatchObject({
      mode: "SANDBOX", livemode: false, runtimeEnabled: true, checkoutEnabled: true,
      publicSalesEnabled: true, publicPricesApproved: false,
    });
    expect(commercialLaunch(checkoutExecutionProfile).publishPrices).toBe(true);
  });
  it("retains the production test-key rejection and closed catalog", () => {
    const production = { ...checkoutExecutionProfile, NODE_ENV: "production" as const };
    expect(() => stripeConfiguration(production)).toThrow("STRIPE_TEST_KEY_IN_PRODUCTION");
    expect(commercialLaunch(production)).toMatchObject({
      checkoutEnabled: false, publicSalesEnabled: false, publishPrices: false,
    });
  });
  it("retains Sandbox/live key and mode mismatch refusals", () => {
    expect(() => stripeConfiguration({ ...checkoutExecutionProfile, STRIPE_SECRET_KEY: "sk_live_fixture_negative_control" })).toThrow("STRIPE_LIVE_KEY_IN_SANDBOX");
    expect(() => stripeConfiguration({ ...checkoutExecutionProfile, NEXUS_STRIPE_MODE: "LIVE" })).toThrow("STRIPE_KEY_MODE_MISMATCH");
  });
  it("uses OAuth and a fixed HTTPS origin while retaining Host and production TLS refusal", () => {
    const origin = webOrigin({ url: "http://foreign.invalid" }, checkoutExecutionProfile);
    expect(webAuthMode(checkoutExecutionProfile)).toBe("oauth");
    expect(origin).toBe("https://checkout.nexus.test:3160");
    const request = (host: string) => new Request(origin, { headers: { host } });
    expect(canonicalWebHost(request("checkout.nexus.test:3160"), origin, true)).toBe(true);
    expect(canonicalWebHost(request("foreign.invalid"), origin, true)).toBe(false);
    expect(canonicalWebHost(request("checkout.nexus.test:3160"), "http://checkout.nexus.test:3160", true)).toBe(false);
  });
});
