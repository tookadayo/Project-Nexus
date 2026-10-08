export const plans = [
  "FREE",
  "STARTER",
  "GROWTH",
  "SCALE",
  "ENTERPRISE",
] as const;
export type Plan = (typeof plans)[number];
export const canonicalFeatures = [
  "core_observation",
  "basic_attention",
  "connection_metrics",
  "thread_forum_metrics",
  "reaction_poll_metrics",
  "voice_metrics",
  "event_metrics",
  "coverage_health",
  "all_recipe_presets",
  "surface_breakdowns",
  "percentile_metrics",
  "advanced_journeys",
  "comparable_periods",
  "scheduled_digest",
  "basic_improvement_tracking",
  "custom_recipe",
  "attention_automation",
  "attention_escalation",
  "improvement_tracking",
  "scheduled_reports",
  "team_routing",
  "csv_export",
  "webhooks",
  "multi_guild",
  "rbac",
  "api",
  "audit_export",
  "ai_explanation",
  "fallback_onboarding",
  "hybrid_onboarding",
  "custom_activation",
  "interventions",
  "discord_charts",
  "saved_views",
  "heatmaps",
  "event_operations",
  "intake_panels",
  "attention_inbox",
  "playbooks",
  "report_branding",
  "team_assignment",
  "approval_workflow",
  "automation_sandbox",
  "recurring_exports",
  "advanced_api",
] as const;
export type EntitlementFeature = (typeof canonicalFeatures)[number];
// Explicit compatibility map; no existing capability is silently removed.
export const legacyFeatureAliases = {
  advanced_cohorts: "surface_breakdowns",
  diagnosis: "comparable_periods",
  automation_auto: "attention_automation",
  experiments: "improvement_tracking",
  advanced_filters: "surface_breakdowns",
  drilldowns: "surface_breakdowns",
  saved_segments: "saved_views",
} as const satisfies Record<string, EntitlementFeature>;
export type Feature = EntitlementFeature | keyof typeof legacyFeatureAliases;
export const features: readonly Feature[] = [
  ...canonicalFeatures,
  ...(Object.keys(
    legacyFeatureAliases,
  ) as (keyof typeof legacyFeatureAliases)[]),
];
export function canonicalFeature(feature: Feature): EntitlementFeature {
  return feature in legacyFeatureAliases
    ? legacyFeatureAliases[feature as keyof typeof legacyFeatureAliases]
    : (feature as EntitlementFeature);
}
export const limitKeys = [
  "guilds",
  "historyDays",
  "monthlyObservedMembers",
  "customRecipes",
  "automationRules",
  "scheduledReports",
  "teamSeats",
  "webhooks",
  "apiRequestsMonthly",
  "intakePanels",
  "analysisRunsMonthly",
  "analysisConcurrency",
] as const;
export type LimitKey = (typeof limitKeys)[number];
export type PlanLimits = Record<LimitKey, number | null>;
export type PlanDefinition = {
  id: Plan;
  revision: 4;
  features: readonly Feature[];
  limits: PlanLimits;
  availability: "AVAILABLE" | "CONTRACT";
  // Deprecated read aliases retained for alpha.5 callers and accounting.
  price: number | null;
  included: number | null;
  guilds: number;
};
const free: EntitlementFeature[] = [
  "core_observation",
  "basic_attention",
  "connection_metrics",
  "thread_forum_metrics",
  "reaction_poll_metrics",
  "voice_metrics",
  "event_metrics",
  "coverage_health",
  "fallback_onboarding",
  "hybrid_onboarding",
  "interventions",
  "discord_charts",
  "intake_panels",
];
const starter: EntitlementFeature[] = [
  ...free,
  "all_recipe_presets",
  "surface_breakdowns",
  "percentile_metrics",
  "advanced_journeys",
  "comparable_periods",
  "scheduled_digest",
  "basic_improvement_tracking",
  "custom_activation",
  "saved_views",
  "heatmaps",
  "csv_export",
  "event_operations",
];
const growth: EntitlementFeature[] = [
  ...starter,
  "custom_recipe",
  "attention_automation",
  "attention_escalation",
  "improvement_tracking",
  "scheduled_reports",
  "team_routing",
  "webhooks",
  "ai_explanation",
  "api",
  "attention_inbox",
  "playbooks",
  "report_branding",
];
const scale: EntitlementFeature[] = [
  ...growth,
  "multi_guild",
  "rbac",
  "audit_export",
  "team_assignment",
  "approval_workflow",
  "automation_sandbox",
  "recurring_exports",
  "advanced_api",
];
function definition(
  id: Plan,
  price: number | null,
  keys: EntitlementFeature[],
  limits: PlanLimits,
): PlanDefinition {
  return {
    id,
    revision: 4,
    features: [
      ...keys,
      ...Object.entries(legacyFeatureAliases)
        .filter(([, key]) => keys.includes(key))
        .map(([key]) => key as Feature),
    ],
    limits,
    availability: id === "ENTERPRISE" ? "CONTRACT" : "AVAILABLE",
    price,
    included: limits.monthlyObservedMembers,
    guilds: limits.guilds ?? 100,
  };
}
export const planCurrency = "USD" as const;
export const pricingMetadata = {
  currency: planCurrency,
  classification: "INTERNAL_PROVISIONAL",
  // Publication and checkout enablement are server-owned commercialLaunch state.
} as const;
export const planRegistry: Record<Plan, PlanDefinition> = {
  FREE: definition("FREE", 0, free, {
    guilds: 1,
    historyDays: 30,
    monthlyObservedMembers: 250,
    customRecipes: 0,
    automationRules: 0,
    scheduledReports: 0,
    teamSeats: 1,
    webhooks: 0,
    apiRequestsMonthly: 0,
    intakePanels: 1,
    analysisRunsMonthly: 1,
    analysisConcurrency: 1,
  }),
  STARTER: definition("STARTER", 15, starter, {
    guilds: 1,
    historyDays: 90,
    monthlyObservedMembers: 1000,
    customRecipes: 0,
    automationRules: 0,
    scheduledReports: 1,
    teamSeats: 1,
    webhooks: 0,
    apiRequestsMonthly: 0,
    intakePanels: 5,
    analysisRunsMonthly: 3,
    analysisConcurrency: 1,
  }),
  GROWTH: definition("GROWTH", 49, growth, {
    guilds: 1,
    historyDays: 365,
    monthlyObservedMembers: 5000,
    customRecipes: 5,
    automationRules: 10,
    scheduledReports: 10,
    teamSeats: 5,
    webhooks: 5,
    apiRequestsMonthly: 10000,
    intakePanels: 25,
    analysisRunsMonthly: 5,
    analysisConcurrency: 2,
  }),
  SCALE: definition("SCALE", 149, scale, {
    guilds: 5,
    historyDays: 730,
    monthlyObservedMembers: 25000,
    customRecipes: 25,
    automationRules: 50,
    scheduledReports: 50,
    teamSeats: 20,
    webhooks: 20,
    apiRequestsMonthly: 100000,
    intakePanels: 100,
    analysisRunsMonthly: 10,
    analysisConcurrency: 4,
  }),
  ENTERPRISE: definition("ENTERPRISE", null, scale, {
    guilds: null,
    historyDays: null,
    monthlyObservedMembers: null,
    customRecipes: null,
    automationRules: null,
    scheduledReports: null,
    teamSeats: null,
    webhooks: null,
    apiRequestsMonthly: null,
    intakePanels: null,
    analysisRunsMonthly: null,
    analysisConcurrency: 4,
  }),
};
const planned: EntitlementFeature[] = ["ai_explanation"];
export const featureAvailability = Object.fromEntries(
  features.map((key) => [
    key,
    planned.includes(canonicalFeature(key)) ? "planned" : "available",
  ]),
) as Record<Feature, "available" | "planned">;
export function requiredPlan(feature: Feature): Plan {
  return (
    plans.find((plan) =>
      planRegistry[plan].features.includes(canonicalFeature(feature)),
    ) ?? "ENTERPRISE"
  );
}
export function planRank(plan: Plan) {
  return plans.indexOf(plan);
}
