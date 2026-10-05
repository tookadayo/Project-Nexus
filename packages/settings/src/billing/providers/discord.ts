import { EntitlementType, type APIEntitlement } from "discord-api-types/v10";
import { assert, type Scope } from "../../../../shared/src/index";
import type { DiscordPort } from "../../../../discord/src/rest";
import type { Plan } from "../../plan-registry";
import {
  normalizedBillingEventSchema,
  UnconfiguredBillingProvider,
  type NormalizedBillingEvent,
  type CheckoutRequest,
  type ProviderReconcileRequest,
  type ProviderReconcileResult,
} from "./types";
export type NativeBillingCapability =
  "AVAILABLE" | "UNSUPPORTED_DEVELOPER_LOCALE" | "NOT_CONFIGURED" | "DISABLED";
export type DiscordBillingConfiguration = {
  enabled: boolean;
  developerCountry: string | null;
  applicationId: string | null;
  approved: boolean;
  skus: Partial<Record<"STARTER" | "GROWTH" | "SCALE", string>>;
};
// Official developer support locales reviewed 2026-10-03. This is developer location, not UI language.
const supportedCountries = new Set([
  "US",
  "GB",
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "GR",
  "ES",
  "FI",
  "FR",
  "HR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);
export function discordBillingConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): DiscordBillingConfiguration {
  const skus: DiscordBillingConfiguration["skus"] = {};
  for (const plan of ["STARTER", "GROWTH", "SCALE"] as const) {
    const id = env[`NEXUS_DISCORD_SKU_${plan}`];
    if (id && /^\d{17,20}$/.test(id)) skus[plan] = id;
  }
  return {
    enabled: env.NEXUS_DISCORD_BILLING_ENABLED === "true",
    approved: env.NEXUS_DISCORD_MONETIZATION_APPROVED === "true",
    developerCountry:
      env.NEXUS_BILLING_DEVELOPER_COUNTRY?.toUpperCase() ?? null,
    applicationId: env.DISCORD_APPLICATION_ID ?? null,
    skus,
  };
}
// Policy applicability is independent of checkout visibility and approval configuration.
export function discordMonetizationApplicable(
  country: string | null,
  plan: Plan,
): boolean | null {
  if (!country) return null;
  if (!supportedCountries.has(country.toUpperCase())) return false;
  return ["STARTER", "GROWTH", "SCALE"].includes(plan) ? true : null;
}
export function nativeBillingCapability(
  config: DiscordBillingConfiguration,
): NativeBillingCapability {
  if (!config.enabled) return "DISABLED";
  if (
    config.developerCountry &&
    !supportedCountries.has(config.developerCountry)
  )
    return "UNSUPPORTED_DEVELOPER_LOCALE";
  if (
    !config.developerCountry ||
    !config.approved ||
    !config.applicationId ||
    !/^\d{17,20}$/.test(config.applicationId) ||
    !["STARTER", "GROWTH", "SCALE"].every((plan) =>
      /^\d{17,20}$/.test(config.skus[plan as keyof typeof config.skus] ?? ""),
    )
  )
    return "NOT_CONFIGURED";
  if (new Set(Object.values(config.skus)).size !== 3) return "NOT_CONFIGURED";
  return "AVAILABLE";
}
export function discordStoreUrl(
  config: DiscordBillingConfiguration,
  plan?: Plan,
) {
  if (nativeBillingCapability(config) !== "AVAILABLE") return null;
  const sku =
    plan && plan in config.skus
      ? config.skus[plan as keyof typeof config.skus]
      : null;
  return `https://discord.com/application-directory/${config.applicationId}/store${sku ? "/" + sku : ""}`;
}
export function discordEntitlementEvent(
  scope: Scope,
  entitlement: APIEntitlement,
  config: DiscordBillingConfiguration,
  now = new Date(),
): NormalizedBillingEvent | null {
  if (
    entitlement.application_id !== config.applicationId ||
    entitlement.guild_id !== scope.guildId ||
    entitlement.type !== EntitlementType.ApplicationSubscription
  )
    return null;
  const plan = Object.entries(config.skus).find(
    ([, sku]) => sku === entitlement.sku_id,
  )?.[0] as Plan | undefined;
  if (!plan) return null;
  const active =
    !entitlement.deleted &&
    (!entitlement.starts_at || new Date(entitlement.starts_at) <= now) &&
    (!entitlement.ends_at || new Date(entitlement.ends_at) > now);
  return normalizedBillingEventSchema.parse({
    eventId: `reconcile:${entitlement.id}:${now.toISOString()}`,
    provider: "DISCORD",
    scope,
    subscriptionRef: entitlement.id,
    plan,
    status: active
      ? "ACTIVE"
      : !entitlement.deleted &&
          entitlement.starts_at &&
          new Date(entitlement.starts_at) > now
        ? "INCOMPLETE"
        : "CANCELED",
    occurredAt: now.toISOString(),
    version: now.getTime(),
    periodEnd: entitlement.ends_at,
    authoritative: true,
  });
}
export class DiscordBillingProvider extends UnconfiguredBillingProvider {
  constructor(
    private readonly discord: DiscordPort,
    private readonly config = discordBillingConfiguration(),
  ) {
    super("DISCORD");
  }
  override async createCheckout(input: CheckoutRequest) {
    const plan = input.offering.planKey;
    assert(
      input.offering.provider === "DISCORD" && input.offering.enabled,
      "BILLING_OFFERING_UNAVAILABLE",
    );
    assert(
      ["STARTER", "GROWTH", "SCALE"].includes(plan),
      "BILLING_OFFERING_UNAVAILABLE",
    );
    assert(
      input.offering.id === input.offeringId &&
        input.offering.providerNeutralOfferingId ===
          this.config.skus[plan as keyof typeof this.config.skus],
      "BILLING_OFFERING_MAPPING_MISMATCH",
      409,
    );
    assert(!input.promotion, "PROMOTION_PROVIDER_UNSUPPORTED", 409);
    const url = discordStoreUrl(this.config, plan);
    assert(url, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
    return { url };
  }
  override async reconcile(
    input: ProviderReconcileRequest,
  ): Promise<ProviderReconcileResult> {
    const scope = input.scope;
    assert(
      nativeBillingCapability(this.config) === "AVAILABLE" &&
        this.discord.billingEntitlements,
      "BILLING_PROVIDER_NOT_CONFIGURED",
      503,
    );
    const now = new Date();
    const events = (
      await this.discord.billingEntitlements(scope.guildId)
    ).flatMap((entitlement) => {
      const event = discordEntitlementEvent(
        scope,
        entitlement,
        this.config,
        now,
      );
      return event ? [event] : [];
    });
    if (input.target) {
      const subscription = events.find(
        (event) => event.subscriptionRef === input.target!.subscriptionRef,
      );
      return subscription
        ? { kind: "TARGET_FOUND", subscription }
        : {
            kind: "TARGET_ABSENT",
            subscriptionRef: input.target.subscriptionRef,
          };
    }
    return { kind: "FULL_CENSUS", complete: true, events };
  }
}
