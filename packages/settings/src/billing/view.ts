import type { BillingService } from "./service";
import { canonicalFeatures } from "../plan-registry";
import { featureDecision } from "./domain";
import {
  discordBillingConfiguration,
  nativeBillingCapability,
  discordStoreUrl,
  type DiscordBillingConfiguration,
} from "./providers/discord";
import { SYSTEM_MAX_HISTORY_DAYS } from "./entitlements";

// Shared server presentation contract. No provider references, codes, campaign internals or actor identities.
export function billingViewModel(
  status: Awaited<ReturnType<BillingService["status"]>>,
  config: DiscordBillingConfiguration = discordBillingConfiguration(),
) {
  const decisions = Object.fromEntries(
    canonicalFeatures.map((key) => [key, featureDecision(status, key)]),
  ) as Record<
    (typeof canonicalFeatures)[number],
    ReturnType<typeof featureDecision>
  >;
  return {
    ...status,
    presentation: {
      revision: 1,
      featureDecisions: decisions,
      availableFeatures: canonicalFeatures.filter(
        (key) => decisions[key].allowed,
      ),
      plannedFeatures: canonicalFeatures.filter(
        (key) =>
          status.features.includes(key) &&
          decisions[key].availability === "planned",
      ),
      // Canonical provider-neutral actions for all new clients.
      billingActions: {
        purchase: [
          {
            provider: "STRIPE",
            configured: false,
            available: false,
            method: "CHECKOUT",
            requiresOffering: true,
          },
          {
            provider: "DISCORD",
            configured: nativeBillingCapability(config) === "AVAILABLE",
            available:
              !status.privacyDeleted &&
              nativeBillingCapability(config) === "AVAILABLE",
            method: "STORE",
            requiresOffering: true,
            url: status.privacyDeleted ? null : discordStoreUrl(config),
          },
        ],
        manage: [
          { provider: "STRIPE", available: false, method: "CUSTOMER_PORTAL" },
        ],
      },
      /** @deprecated Use presentation.billingActions. Kept for alpha.5 clients. */
      nativeCapability: nativeBillingCapability(config),
      /** @deprecated Use presentation.billingActions.purchase[].url. */
      nativePurchaseUrl: status.privacyDeleted ? null : discordStoreUrl(config),
      historyRequestMaxDays: SYSTEM_MAX_HISTORY_DAYS,
      // These are current scoped benefits; public campaigns and codes are never enumerated.
      promotions: {
        activeBenefits: status.grants,
        redemptionAvailable: !status.privacyDeleted,
        paymentDiscountAvailable: false,
      },
    },
  };
}
