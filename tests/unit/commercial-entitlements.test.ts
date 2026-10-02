import { it, expect } from "vitest";
import {
  plans,
  planRegistry,
  canonicalFeatures,
  canonicalFeature,
  featureAvailability,
} from "../../packages/settings/src/plan-registry";
import {
  resolveEntitlements,
  featureDecision,
  planChangePreview,
  type EntitlementSubscription,
  type EntitlementGrant,
} from "../../packages/settings/src/billing-domain";
import {
  nativeBillingCapability,
  discordStoreUrl,
  discordEntitlementEvent,
  UnconfiguredBillingProvider,
  type DiscordBillingConfiguration,
} from "../../packages/settings/src/billing-provider";
import { discountCompatibility } from "../../packages/settings/src/billing-policy";
import { EntitlementType } from "discord-api-types/v10";
import {
  visibleHistoryDays,
  SYSTEM_MAX_HISTORY_DAYS,
} from "../../packages/settings/src/entitlements";
import { billingViewModel } from "../../packages/settings/src/billing-view";
import { discordMonetizationApplicable } from "../../packages/settings/src/billing-provider";
const now = new Date("2026-10-02T00:00:00Z");
const subscription = (
  plan: EntitlementSubscription["plan"] = "GROWTH",
  status: EntitlementSubscription["status"] = "ACTIVE",
): EntitlementSubscription => ({
  id: "sub-a",
  provider: "EXTERNAL",
  plan,
  status,
  periodEnd: "2026-11-01T00:00:00Z",
  scheduledPlan: null,
  scheduledAt: null,
  confirmedAt: now.toISOString(),
  lastGoodPlan: plan,
  lastGoodUntil: "2026-11-04T00:00:00Z",
});
const grant = (
  source: EntitlementGrant["source"] = "PARTNER",
): EntitlementGrant => ({
  id: "grant-a",
  source,
  plan: "GROWTH",
  features: [],
  limits: {},
  startsAt: "2026-10-01T00:00:00Z",
  endsAt: "2027-01-01T00:00:00Z",
  revokedAt: null,
});
for (const plan of plans)
  it(`${plan} retains every core community surface and correctness capability`, () => {
    const state = resolveEntitlements(
      { subscriptions: [subscription(plan)], grants: [] },
      now,
    );
    for (const key of [
      "core_observation",
      "basic_attention",
      "connection_metrics",
      "thread_forum_metrics",
      "reaction_poll_metrics",
      "voice_metrics",
      "event_metrics",
      "coverage_health",
    ] as const)
      expect(featureDecision(state, key).allowed).toBe(true);
    expect(planRegistry[plan].revision).toBe(2);
  });
it("Starter buys depth, Growth buys operation, Scale reserves five slots with planned security", () => {
  const starter = resolveEntitlements(
    { subscriptions: [subscription("STARTER")], grants: [] },
    now,
  );
  expect(featureDecision(starter, "percentile_metrics").allowed).toBe(true);
  expect(featureDecision(starter, "attention_automation").allowed).toBe(false);
  const growth = resolveEntitlements(
    { subscriptions: [subscription()], grants: [] },
    now,
  );
  expect(featureDecision(growth, "custom_recipe").allowed).toBe(true);
  expect(featureDecision(growth, "attention_automation").allowed).toBe(true);
  const scale = resolveEntitlements(
    { subscriptions: [subscription("SCALE")], grants: [] },
    now,
  );
  expect(scale.limits.guilds).toBe(5);
  expect(featureDecision(scale, "rbac")).toMatchObject({
    allowed: false,
    reason: "FEATURE_PLANNED",
  });
  expect(canonicalFeature("automation_auto")).toBe("attention_automation");
  expect(canonicalFeatures.every((key) => key in featureAvailability)).toBe(
    true,
  );
});
for (const source of ["PROMOTION", "PARTNER", "DEBUG", "TRIAL"] as const)
  it(`resolves ${source} without changing underlying subscription`, () => {
    const original = subscription("STARTER"),
      state = resolveEntitlements(
        { subscriptions: [original], grants: [grant(source)] },
        now,
      );
    expect(state.plan).toBe("GROWTH");
    expect(state.source).toBe(source);
    expect(original.plan).toBe("STARTER");
    for (const ended of [
      { ...grant(source), endsAt: now.toISOString() },
      { ...grant(source), revokedAt: now.toISOString() },
    ])
      expect(
        resolveEntitlements({ subscriptions: [original], grants: [ended] }, now)
          .plan,
      ).toBe("STARTER");
    expect(
      resolveEntitlements({ subscriptions: [], grants: [grant(source)] }, now)
        .plan,
    ).toBe("GROWTH");
    expect(
      resolveEntitlements(
        {
          subscriptions: [],
          grants: [{ ...grant(source), revokedAt: now.toISOString() }],
        },
        now,
      ).plan,
    ).toBe("FREE");
    expect(
      resolveEntitlements(
        {
          subscriptions: [],
          grants: [{ ...grant(source), endsAt: now.toISOString() }],
        },
        now,
      ).plan,
    ).toBe("FREE");
  });
it("is deterministic across grant/provider order and exposes conflicts once", () => {
  const subs = [
    subscription("STARTER"),
    { ...subscription("GROWTH"), id: "sub-b", provider: "DISCORD" as const },
  ];
  const state = resolveEntitlements({ subscriptions: subs, grants: [] }, now);
  expect(state).toEqual(
    resolveEntitlements(
      { subscriptions: [...subs].reverse(), grants: [] },
      now,
    ),
  );
  expect(state.plan).toBe("GROWTH");
  expect(state.reason).toBe("BILLING_CONFLICT");
});
it("does not unlock incomplete/unknown provider state, preserves only bounded known-good grace", () => {
  for (const status of ["UNKNOWN", "INCOMPLETE", "CANCELED"] as const)
    expect(
      resolveEntitlements(
        {
          subscriptions: [
            { ...subscription("GROWTH", status), confirmedAt: null },
          ],
          grants: [],
        },
        now,
      ).plan,
    ).toBe("FREE");
  expect(
    resolveEntitlements(
      { subscriptions: [subscription("GROWTH", "UNKNOWN")], grants: [] },
      now,
    ),
  ).toMatchObject({ plan: "GROWTH", grace: true });
  expect(
    resolveEntitlements(
      { subscriptions: [subscription("GROWTH", "PAST_DUE")], grants: [] },
      new Date("2026-11-04T00:00:00Z"),
    ).plan,
  ).toBe("FREE");
});
it("keeps cancellation and scheduled downgrade through confirmed paid time", () => {
  const sub = {
    ...subscription("GROWTH", "CANCEL_AT_PERIOD_END"),
    scheduledPlan: "STARTER" as const,
    scheduledAt: "2026-11-01T00:00:00Z",
  };
  expect(
    resolveEntitlements({ subscriptions: [sub], grants: [] }, now).plan,
  ).toBe("GROWTH");
  expect(
    resolveEntitlements(
      { subscriptions: [sub], grants: [] },
      new Date("2026-11-01T00:00:00Z"),
    ).plan,
  ).toBe("FREE");
  const state = resolveEntitlements(
      { subscriptions: [subscription()], grants: [] },
      now,
    ),
    preview = planChangePreview(state, "STARTER", "DISCORD", {
      periodEnd: sub.periodEnd,
      automationIds: ["helper"],
    });
  expect(preview.automationsThatWillPause).toEqual(["helper"]);
  expect(preview.effectiveAt).toBe(sub.periodEnd);
  expect(preview.pricing).toBe("PROVIDER_OWNED");
});
it("privacy overrides subscriptions and all grants", () => {
  const state = resolveEntitlements(
    {
      subscriptions: [subscription("ENTERPRISE")],
      grants: [grant()],
      privacyDeleted: true,
    },
    now,
  );
  expect(state.plan).toBe("FREE");
  expect(featureDecision(state, "core_observation").allowed).toBe(false);
});
it("a downgrade to Starter pauses helper automation while retaining the weekly digest", () => {
  const state = resolveEntitlements(
    { subscriptions: [subscription()], grants: [] },
    now,
  );
  const preview = planChangePreview(state, "STARTER", "EXTERNAL", {
    automationRules: [
      { id: "helper", feature: "attention_automation" },
      { id: "weekly-digest", feature: "scheduled_digest" },
    ],
  });
  expect(preview.automationsThatWillPause).toEqual(["helper"]);
});
it("scoped contract limits override only their supplied scope inputs", () => {
  const custom = {
    ...grant("CONTRACT"),
    plan: "ENTERPRISE" as const,
    limits: { guilds: 8, historyDays: 500 },
  };
  expect(
    resolveEntitlements({ subscriptions: [], grants: [custom] }, now).limits
      .guilds,
  ).toBe(8);
  expect(
    resolveEntitlements({ subscriptions: [], grants: [] }, now).limits.guilds,
  ).toBe(1);
});
const config: DiscordBillingConfiguration = {
  enabled: true,
  developerCountry: "US",
  approved: true,
  applicationId: "111111111111111111",
  skus: {
    STARTER: "222222222222222222",
    GROWTH: "333333333333333333",
    SCALE: "444444444444444444",
  },
};
it("shows native purchases only with complete supported configuration", () => {
  expect(nativeBillingCapability(config)).toBe("AVAILABLE");
  expect(nativeBillingCapability({ ...config, developerCountry: "JP" })).toBe(
    "UNSUPPORTED_DEVELOPER_LOCALE",
  );
  expect(nativeBillingCapability({ ...config, approved: false })).toBe(
    "NOT_CONFIGURED",
  );
  expect(nativeBillingCapability({ ...config, enabled: false })).toBe(
    "DISABLED",
  );
  expect(discordStoreUrl({ ...config, approved: false })).toBeNull();
  expect(discordStoreUrl(config, "GROWTH")).toBe(
    "https://discord.com/application-directory/111111111111111111/store/333333333333333333",
  );
});
it("requires authoritative guild subscription entitlements, rejecting personal and test purchases", () => {
  const scope = {
      organizationId: "11111111-1111-4111-8111-111111111111",
      guildId: "555555555555555555",
    },
    entitlement = {
      id: "666666666666666666",
      application_id: config.applicationId!,
      guild_id: scope.guildId,
      sku_id: config.skus.GROWTH!,
      type: EntitlementType.ApplicationSubscription,
      starts_at: null,
      ends_at: null,
      deleted: false,
    };
  expect(discordEntitlementEvent(scope, entitlement, config, now)?.plan).toBe(
    "GROWTH",
  );
  expect(
    discordEntitlementEvent(
      scope,
      { ...entitlement, guild_id: undefined, user_id: "777777777777777777" },
      config,
      now,
    ),
  ).toBeNull();
  expect(
    discordEntitlementEvent(
      scope,
      { ...entitlement, type: EntitlementType.TestModePurchase },
      config,
      now,
    ),
  ).toBeNull();
});
it("rejects external-only equivalent discounts and unsupported Discord coupon actions", () => {
  const input = {
    provider: "EXTERNAL" as const,
    discountType: "PERCENT" as const,
    discountValue: 20,
    basePriceMinor: 4900,
    discordFinalPriceMinor: 4900,
    discordOfferingSupported: true,
    parityReviewed: true,
    baseCurrency: "USD",
    discordCurrency: "USD",
  };
  expect(discountCompatibility(input).reason).toBe(
    "DISCORD_PRICE_PARITY_REJECTED",
  );
  expect(
    discountCompatibility({ ...input, discordFinalPriceMinor: 3920 }).allowed,
  ).toBe(true);
  expect(discountCompatibility({ ...input, provider: "DISCORD" }).allowed).toBe(
    false,
  );
  expect(
    discountCompatibility({ ...input, parityReviewed: false }).allowed,
  ).toBe(false);
});
it("an unconfigured adapter never invents successful payment", async () => {
  const provider = new UnconfiguredBillingProvider("EXTERNAL");
  await expect(
    provider.createCheckout(
      {
        organizationId: "11111111-1111-4111-8111-111111111111",
        guildId: "555555555555555555",
      },
      "GROWTH",
    ),
  ).rejects.toThrow("BILLING_PROVIDER_NOT_CONFIGURED");
});

it.each([
  ["FREE", 90, 30],
  ["STARTER", 120, 90],
  ["GROWTH", 365, 365],
  ["SCALE", 730, 730],
  ["ENTERPRISE", 1095, 1095],
] as const)(
  "%s history visibility respects plan depth independently of query safety",
  (plan, requested, expected) => {
    const state = resolveEntitlements(
      { subscriptions: [subscription(plan)], grants: [] },
      now,
    );
    expect(visibleHistoryDays(state, requested)).toBe(expected);
    expect(() =>
      visibleHistoryDays(state, SYSTEM_MAX_HISTORY_DAYS + 1),
    ).toThrow("INVALID_HISTORY_RANGE");
  },
);
it("contract history is scoped, bounded and never overrides privacy", () => {
  const contract = {
    ...grant("CONTRACT"),
    plan: "ENTERPRISE" as const,
    limits: { historyDays: 1460 },
  };
  const state = resolveEntitlements(
    { subscriptions: [], grants: [contract] },
    now,
  );
  expect(visibleHistoryDays(state, 1800)).toBe(1460);
  expect(
    visibleHistoryDays(
      resolveEntitlements({ subscriptions: [], grants: [] }, now),
      1800,
    ),
  ).toBe(30);
  expect(() =>
    visibleHistoryDays({ ...state, privacyDeleted: true }, 30),
  ).toThrow("PRIVACY_DELETED");
  for (const invalid of [0, -1, 1.5, NaN, Infinity])
    expect(() => visibleHistoryDays(state, invalid)).toThrow(
      "INVALID_HISTORY_RANGE",
    );
});
it("discount policy is independent of native checkout capability and fails closed on unknown applicability", () => {
  const input = {
    provider: "EXTERNAL" as const,
    discountType: "PERCENT" as const,
    discountValue: 20,
    basePriceMinor: 4900,
    discordFinalPriceMinor: null,
    discordOfferingSupported: false,
    parityReviewed: false,
  };
  expect(
    discountCompatibility({ ...input, parityObligation: false }).allowed,
  ).toBe(true);
  expect(
    discountCompatibility({
      ...input,
      discordOfferingSupported: true,
      parityObligation: false,
    }).reason,
  ).toBe("DISCORD_PRICE_PARITY_UNVERIFIED");
  expect(
    discountCompatibility({ ...input, parityObligation: null }).reason,
  ).toBe("DISCOUNT_POLICY_REVIEW_REQUIRED");
  expect(
    discountCompatibility({ ...input, parityObligation: true }).reason,
  ).toBe("DISCORD_PRICE_PARITY_UNVERIFIED");
  expect(
    discountCompatibility({
      ...input,
      parityObligation: true,
      parityReviewed: true,
      discordFinalPriceMinor: 3920,
      baseCurrency: "USD",
      discordCurrency: "JPY",
    }).reason,
  ).toBe("DISCORD_PRICE_CURRENCY_UNVERIFIED");
  expect(discordMonetizationApplicable("JP", "GROWTH")).toBe(false);
  expect(discordMonetizationApplicable("US", "GROWTH")).toBe(true);
  expect(discordMonetizationApplicable(null, "GROWTH")).toBeNull();
  expect(discordMonetizationApplicable("US", "ENTERPRISE")).toBeNull();
});
it.each(["UNKNOWN", "PAST_DUE", "GRACE", "CONFLICT"] as const)(
  "%s retains only bounded confirmed access",
  (status) => {
    const sub = subscription("GROWTH", status);
    expect(
      resolveEntitlements({ subscriptions: [sub], grants: [] }, now).plan,
    ).toBe("GROWTH");
    expect(
      resolveEntitlements(
        {
          subscriptions: [{ ...sub, lastGoodUntil: now.toISOString() }],
          grants: [],
        },
        now,
      ).plan,
    ).toBe("FREE");
    expect(
      resolveEntitlements(
        { subscriptions: [{ ...sub, confirmedAt: null }], grants: [] },
        now,
      ).plan,
    ).toBe("FREE");
  },
);
it("shared billing presentation denies planned workflows and exposes only scoped benefits", () => {
  const state = resolveEntitlements(
    { subscriptions: [subscription("SCALE")], grants: [grant()] },
    now,
  );
  const model = billingViewModel(
    {
      ...state,
      usage: {
        plan: state.plan,
        used: 2,
        included: 25000,
        softLimit: 30000,
        projected: 2,
        automaticOverageCharge: false,
      },
      recoveryUntil: null,
      pausedRules: [],
    },
    {
      enabled: false,
      approved: false,
      developerCountry: null,
      applicationId: null,
      skus: {},
    },
  );
  expect(model.plan).toBe("SCALE");
  expect(model.presentation.nativeCapability).toBe("DISABLED");
  expect(model.presentation.nativePurchaseUrl).toBeNull();
  for (const key of [
    "scheduled_reports",
    "webhooks",
    "multi_guild",
    "rbac",
    "api",
    "audit_export",
    "ai_explanation",
  ] as const) {
    expect(model.presentation.featureDecisions[key].allowed).toBe(false);
    expect(model.presentation.availableFeatures).not.toContain(key);
    expect(model.presentation.plannedFeatures).toContain(key);
  }
  expect(model.presentation.promotions.activeBenefits).toEqual(state.grants);
  expect(model.presentation.promotions.paymentDiscountAvailable).toBe(false);
});
