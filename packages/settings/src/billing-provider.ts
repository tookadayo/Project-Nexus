import { z } from "zod";
import { EntitlementType, type APIEntitlement } from "discord-api-types/v10";
import { assert, type Scope } from "../../shared/src/index";
import type { DiscordPort } from "../../discord/src/rest";
import { plans } from "./plan-registry";
import {
  providers,
  subscriptionStates,
  type BillingProviderKind,
  type EntitlementSubscription,
  type PlanChangePreview,
} from "./billing-domain";
import type { Plan } from "./plan-registry";
const providerTime = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
export const normalizedBillingEventSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    provider: z.enum(providers),
    scope: z
      .object({
        organizationId: z.uuid(),
        guildId: z.string().regex(/^\d{17,20}$/),
      })
      .strict(),
    subscriptionRef: z.string().min(1).max(200),
    plan: z.enum(plans),
    status: z.enum(subscriptionStates),
    occurredAt: providerTime,
    version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    periodEnd: providerTime.nullable(),
    scheduledPlan: z.enum(plans).nullable().default(null),
    scheduledAt: providerTime.nullable().default(null),
    authoritative: z.boolean(),
  })
  .strict();
export type NormalizedBillingEvent = z.infer<
  typeof normalizedBillingEventSchema
>;
export interface BillingProvider {
  readonly kind: BillingProviderKind;
  createCheckout(
    scope: Scope,
    plan: Plan,
    idempotencyKey: string,
  ): Promise<{ url: string }>;
  previewPlanChange(
    scope: Scope,
    preview: PlanChangePreview,
  ): Promise<PlanChangePreview>;
  cancel(
    scope: Scope,
    idempotencyKey: string,
  ): Promise<{ scheduledAt: string | null }>;
  reconcile(scope: Scope): Promise<NormalizedBillingEvent[]>;
  parseEvent(
    body: Buffer,
    headers: Record<string, string>,
  ): Promise<NormalizedBillingEvent[]>;
  currentSubscription(scope: Scope): Promise<EntitlementSubscription | null>;
}
export class UnconfiguredBillingProvider implements BillingProvider {
  readonly kind: BillingProviderKind;
  constructor(
    readonly name:
      BillingProviderKind | "stripe" | "discord-premium-apps" = "EXTERNAL",
  ) {
    this.kind =
      name === "discord-premium-apps"
        ? "DISCORD"
        : name === "stripe"
          ? "EXTERNAL"
          : name;
  }
  async createCheckout(
    _scope: Scope,
    _plan: Plan,
    _idempotencyKey = "",
  ): Promise<{ url: string }> {
    throw new Error("BILLING_PROVIDER_NOT_CONFIGURED");
  }
  async previewPlanChange(_scope: Scope, preview: PlanChangePreview) {
    return preview;
  }
  async cancel(
    _scope: Scope,
    _idempotencyKey = "",
  ): Promise<{ scheduledAt: string | null }> {
    throw new Error("BILLING_PROVIDER_NOT_CONFIGURED");
  }
  async reconcile(_scope: Scope): Promise<NormalizedBillingEvent[]> {
    throw new Error("BILLING_PROVIDER_NOT_CONFIGURED");
  }
  async parseEvent(
    _body: Buffer,
    _headers: Record<string, string>,
  ): Promise<NormalizedBillingEvent[]> {
    throw new Error("BILLING_PROVIDER_NOT_CONFIGURED");
  }
  async currentSubscription(
    _scope: Scope,
  ): Promise<EntitlementSubscription | null> {
    throw new Error("BILLING_PROVIDER_NOT_CONFIGURED");
  }
  // Compatibility names for alpha.5 callers; still fail closed.
  async getSubscription(scope: Scope) {
    return this.currentSubscription(scope);
  }
  async cancelSubscription(scope: Scope) {
    await this.cancel(scope);
  }
  async verifyEntitlement(scope: Scope) {
    return this.currentSubscription(scope);
  }
}
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
  override async createCheckout(_scope: Scope, plan: Plan, _key = "") {
    assert(
      ["STARTER", "GROWTH", "SCALE"].includes(plan),
      "BILLING_OFFERING_UNAVAILABLE",
    );
    const url = discordStoreUrl(this.config, plan);
    assert(url, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
    return { url };
  }
  override async reconcile(scope: Scope) {
    assert(
      nativeBillingCapability(this.config) === "AVAILABLE" &&
        this.discord.billingEntitlements,
      "BILLING_PROVIDER_NOT_CONFIGURED",
      503,
    );
    const now = new Date();
    return (await this.discord.billingEntitlements(scope.guildId)).flatMap(
      (entitlement) => {
        const event = discordEntitlementEvent(
          scope,
          entitlement,
          this.config,
          now,
        );
        return event ? [event] : [];
      },
    );
  }
}
