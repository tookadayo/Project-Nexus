import { assert } from "../../../shared/src/index";
import { featureAvailability, type Plan } from "../plan-registry";
import {
  discordBillingConfiguration,
  discordMonetizationApplicable,
} from "./providers/discord";

export const liveApprovalVariables = [
  "NEXUS_PUBLIC_PRICES_APPROVED",
  "NEXUS_DISCORD_MONETIZATION_APPROVED",
  "NEXUS_DISCORD_PARITY_APPROVED",
  "NEXUS_PAID_FEATURES_APPROVED",
  "NEXUS_TAX_LEGAL_APPROVED",
  "NEXUS_REFUND_POLICY_APPROVED",
  "NEXUS_SUPPORT_POLICY_APPROVED",
  "NEXUS_BILLING_MONITORING_APPROVED",
  "NEXUS_BILLING_INCIDENT_HANDLING_APPROVED",
  "NEXUS_BACKUP_RESTORE_APPROVED",
] as const;

/** Server configuration only. No credential is returned in a presentation DTO. */
export function stripeConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.NEXUS_STRIPE_ENABLED === "true";
  const mode =
    env.NEXUS_STRIPE_MODE ??
    (env.NODE_ENV === "production" ? "LIVE" : "SANDBOX");
  assert(mode === "LIVE" || mode === "SANDBOX", "STRIPE_MODE_INVALID", 503);
  const key = env.STRIPE_SECRET_KEY ?? "";
  const testKey = /^(?:sk|rk)_test_\S+$/.test(key),
    liveKey = /^(?:sk|rk)_live_\S+$/.test(key);
  if (enabled) {
    assert(!(mode === "SANDBOX" && liveKey), "STRIPE_LIVE_KEY_IN_SANDBOX", 503);
    assert(
      !(env.NODE_ENV === "production" && testKey),
      "STRIPE_TEST_KEY_IN_PRODUCTION",
      503,
    );
    assert(!(mode === "LIVE" && testKey), "STRIPE_KEY_MODE_MISMATCH", 503);
  }
  // Runtime is a credential boundary. Sales approval must never disable receipt,
  // reconciliation or recovery of an existing contract.
  const runtimeEnabled =
    enabled &&
    (mode === "SANDBOX" ? testKey : env.NODE_ENV === "production" && liveKey);
  const managementEnabled =
    runtimeEnabled && env.NEXUS_STRIPE_MANAGEMENT_ENABLED !== "false";
  const discord = discordBillingConfiguration(env);
  const applicable = discordMonetizationApplicable(
    discord.developerCountry,
    "STARTER",
  );
  const discordSalesApproved =
    applicable === false ||
    (applicable === true &&
      discord.enabled &&
      discord.approved &&
      env.NEXUS_DISCORD_PARITY_APPROVED === "true" &&
      ["STARTER", "GROWTH", "SCALE"].every((plan) =>
        Boolean(discord.skus[plan as keyof typeof discord.skus]),
      ));
  const liveSalesApproved =
    env.NEXUS_STRIPE_LIVE_ENABLED === "true" &&
    Boolean(env.STRIPE_WEBHOOK_SECRET) &&
    discordSalesApproved &&
    liveApprovalVariables
      .filter(
        (name) =>
          ![
            "NEXUS_DISCORD_MONETIZATION_APPROVED",
            "NEXUS_DISCORD_PARITY_APPROVED",
          ].includes(name),
      )
      .every((name) => env[name] === "true");
  const checkoutEnabled =
    runtimeEnabled &&
    env.NEXUS_STRIPE_CHECKOUT_ENABLED !== "false" &&
    (mode === "SANDBOX" || liveSalesApproved);
  const publicPricesApproved = env.NEXUS_PUBLIC_PRICES_APPROVED === "true";
  const publicSalesEnabled =
    checkoutEnabled &&
    env.NEXUS_STRIPE_PUBLIC_SALES_ENABLED !== "false" &&
    (mode === "SANDBOX" || publicPricesApproved);
  const capability = (available: boolean) =>
    available ? ("AVAILABLE" as const) : ("NOT_CONFIGURED" as const);
  return {
    enabled,
    mode,
    livemode: mode === "LIVE",
    capability: capability(runtimeEnabled),
    capabilities: {
      runtime: capability(runtimeEnabled),
      management: capability(managementEnabled),
      checkout: capability(checkoutEnabled),
      publicSales: capability(publicSalesEnabled),
    },
    runtimeEnabled,
    managementEnabled,
    publicPricesApproved,
    checkoutEnabled,
    publicSalesEnabled,
    currency: "USD" as const,
  };
}
export function commercialLaunch(env: NodeJS.ProcessEnv = process.env) {
  try {
    const config = stripeConfiguration(env);
    return { ...config, publishPrices: config.publicSalesEnabled };
  } catch {
    return {
      enabled: false,
      mode: "SANDBOX",
      livemode: false,
      capability: "NOT_CONFIGURED" as const,
      capabilities: {
        runtime: "NOT_CONFIGURED" as const,
        management: "NOT_CONFIGURED" as const,
        checkout: "NOT_CONFIGURED" as const,
        publicSales: "NOT_CONFIGURED" as const,
      },
      runtimeEnabled: false,
      managementEnabled: false,
      publicSalesEnabled: false,
      checkoutEnabled: false,
      publicPricesApproved: false,
      publishPrices: false,
      currency: "USD" as const,
    };
  }
}
export function paidPlanReady(plan: Plan) {
  return (
    (plan !== "SCALE" && plan !== "ENTERPRISE") ||
    ["multi_guild", "rbac", "api"].every(
      (key) =>
        featureAvailability[key as keyof typeof featureAvailability] ===
        "available",
    )
  );
}
