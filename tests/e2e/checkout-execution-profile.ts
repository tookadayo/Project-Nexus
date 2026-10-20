import { checkoutOrigin } from "./checkout-transport.js";

// Synthetic Sandbox contracts run against the built Next server, not live sales.
// A test key is intentionally rejected by the product in a production runtime.
export const checkoutExecutionProfile = Object.freeze({
  NODE_ENV: "test",
  NEXUS_WEB_AUTH_MODE: "oauth",
  NEXUS_WEB_URL: checkoutOrigin,
  NEXUS_STRIPE_ENABLED: "true",
  NEXUS_STRIPE_MODE: "SANDBOX",
  STRIPE_SECRET_KEY: "sk_test_fixture_checkout",
});
