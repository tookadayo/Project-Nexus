import { assert } from "../../../shared/src/index";
import { featureAvailability, type Plan } from "../plan-registry";

export const liveApprovalVariables = [
  "NEXUS_PUBLIC_PRICES_APPROVED", "NEXUS_DISCORD_MONETIZATION_APPROVED",
  "NEXUS_DISCORD_PARITY_APPROVED", "NEXUS_PAID_FEATURES_APPROVED",
  "NEXUS_TAX_LEGAL_APPROVED", "NEXUS_REFUND_POLICY_APPROVED", "NEXUS_SUPPORT_POLICY_APPROVED",
  "NEXUS_BILLING_MONITORING_APPROVED", "NEXUS_BILLING_INCIDENT_HANDLING_APPROVED", "NEXUS_BACKUP_RESTORE_APPROVED",
] as const;

/** Server configuration only. No credential is returned in a presentation DTO. */
export function stripeConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.NEXUS_STRIPE_ENABLED === "true";
  const mode = env.NEXUS_STRIPE_MODE ?? (env.NODE_ENV === "production" ? "LIVE" : "SANDBOX");
  assert(mode === "LIVE" || mode === "SANDBOX", "STRIPE_MODE_INVALID", 503);
  const key = env.STRIPE_SECRET_KEY ?? "";
  const testKey = /^(?:sk|rk)_test_\S+$/.test(key), liveKey = /^(?:sk|rk)_live_\S+$/.test(key);
  if (enabled) {
    assert(!(mode === "SANDBOX" && liveKey), "STRIPE_LIVE_KEY_IN_SANDBOX", 503);
    assert(!(env.NODE_ENV === "production" && testKey), "STRIPE_TEST_KEY_IN_PRODUCTION", 503);
    assert(!(mode === "LIVE" && testKey), "STRIPE_KEY_MODE_MISMATCH", 503);
  }
  const liveApproved = env.NODE_ENV === "production" && env.NEXUS_STRIPE_LIVE_ENABLED === "true" && liveKey &&
    Boolean(env.STRIPE_WEBHOOK_SECRET) && env.NEXUS_DISCORD_BILLING_ENABLED === "true" &&
    ["STARTER", "GROWTH", "SCALE"].every(plan => Boolean(env[`NEXUS_DISCORD_SKU_${plan}`])) &&
    liveApprovalVariables.every(name => env[name] === "true");
  const configured = enabled && (mode === "SANDBOX" ? testKey : liveApproved);
  return { enabled, mode, livemode: mode === "LIVE", capability: configured ? "AVAILABLE" as const : "NOT_CONFIGURED" as const,
    publicPricesApproved: env.NEXUS_PUBLIC_PRICES_APPROVED === "true", checkoutEnabled: configured, currency: "USD" as const };
}
export function commercialLaunch(env: NodeJS.ProcessEnv = process.env) {
  try {
    const config = stripeConfiguration(env);
    return { ...config, publishPrices: config.mode === "SANDBOX" ? config.checkoutEnabled : config.checkoutEnabled && config.publicPricesApproved };
  } catch {
    return { enabled: false, mode: "SANDBOX", livemode: false, capability: "NOT_CONFIGURED" as const, checkoutEnabled: false,
      publicPricesApproved: false, publishPrices: false, currency: "USD" as const };
  }
}
export function paidPlanReady(plan: Plan) {
  return (plan !== "SCALE" && plan !== "ENTERPRISE") ||
    ["multi_guild", "rbac", "api"].every(key => featureAvailability[key as keyof typeof featureAvailability] === "available");
}
