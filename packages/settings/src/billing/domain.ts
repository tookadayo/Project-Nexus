import {
  canonicalFeature,
  planRank,
  planRegistry,
  canonicalFeatures,
  featureAvailability,
  requiredPlan,
  plans,
  type Plan,
  type Feature,
  type EntitlementFeature,
  type PlanLimits,
  type LimitKey,
} from "../plan-registry";
export const providers = [
  "STRIPE",
  "EXTERNAL_LEGACY",
  "DISCORD",
  "MANUAL",
] as const;
export type BillingProviderKind = (typeof providers)[number];
export const subscriptionStates = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE",
  "CANCEL_AT_PERIOD_END",
  "CANCELED",
  "INCOMPLETE",
  "SUSPENDED",
  "EXPIRED",
  "UNKNOWN",
  "CONFLICT",
] as const;
export type SubscriptionState = (typeof subscriptionStates)[number];
export type EntitlementSubscription = {
  id: string;
  provider: BillingProviderKind;
  plan: Plan;
  status: SubscriptionState;
  trialAllowed?: boolean;
  periodEnd: string | null;
  scheduledPlan: Plan | null;
  scheduledAt: string | null;
  confirmedAt: string | null;
  lastGoodPlan: Plan | null;
  lastGoodUntil: string | null;
};
export type EntitlementGrant = {
  id: string;
  source: "PROMOTION" | "TRIAL" | "PARTNER" | "DEBUG" | "CONTRACT" | "LEGACY";
  plan: Plan | null;
  features: EntitlementFeature[];
  limits: Partial<PlanLimits>;
  startsAt: string;
  endsAt: string | null;
  revokedAt: string | null;
};
export type EffectiveEntitlement = {
  plan: Plan;
  source: string;
  features: EntitlementFeature[];
  limits: PlanLimits;
  grants: EntitlementGrant[];
  subscriptions: EntitlementSubscription[];
  conflict: boolean;
  grace: boolean;
  reason: string | null;
  privacyDeleted: boolean;
};
const date = (value: string | null) =>
  value === null ? null : new Date(value).getTime();
export function activeGrant(grant: EntitlementGrant, now: Date) {
  return (
    !grant.revokedAt &&
    date(grant.startsAt)! <= now.getTime() &&
    (grant.endsAt === null || date(grant.endsAt)! > now.getTime())
  );
}
export function subscriptionPlan(
  subscription: EntitlementSubscription,
  now: Date,
): { plan: Plan; grace: boolean } | null {
  const at = now.getTime(),
    end = date(subscription.periodEnd);
  if (
    !subscription.confirmedAt ||
    subscription.status === "INCOMPLETE" ||
    subscription.status === "SUSPENDED" ||
    subscription.status === "EXPIRED" ||
    (subscription.status === "TRIALING" && subscription.trialAllowed === false)
  )
    return null;
  if (subscription.status === "CANCELED")
    return subscription.provider === "STRIPE" && end !== null && end > at
      ? { plan: subscription.plan, grace: false }
      : null;
  if (
    ["UNKNOWN", "PAST_DUE", "GRACE", "CONFLICT"].includes(subscription.status)
  ) {
    if (subscription.lastGoodPlan && date(subscription.lastGoodUntil)! > at)
      return { plan: subscription.lastGoodPlan, grace: true };
    return null;
  }
  if (end !== null && end <= at) {
    if (
      subscription.status !== "CANCEL_AT_PERIOD_END" &&
      subscription.lastGoodPlan &&
      date(subscription.lastGoodUntil)! > at
    )
      return { plan: subscription.lastGoodPlan, grace: true };
    return null;
  }
  // A scheduled target only becomes active after authoritative confirmation.
  return { plan: subscription.plan, grace: false };
}
export function resolveEntitlements(
  input: {
    subscriptions: EntitlementSubscription[];
    grants: EntitlementGrant[];
    privacyDeleted?: boolean;
  },
  now = new Date(),
): EffectiveEntitlement {
  const valid = input.privacyDeleted
    ? []
    : input.subscriptions
        .map((subscription) => ({
          subscription,
          value: subscriptionPlan(subscription, now),
        }))
        .filter((row) => row.value !== null)
        .sort(
          (a, b) =>
            planRank(b.value!.plan) - planRank(a.value!.plan) ||
            a.subscription.id.localeCompare(b.subscription.id),
        );
  const grants = input.privacyDeleted
    ? []
    : input.grants
        .filter((grant) => activeGrant(grant, now))
        .sort((a, b) => a.id.localeCompare(b.id));
  let plan: Plan = valid[0]?.value?.plan ?? "FREE",
    source = valid[0]
      ? `SUBSCRIPTION:${valid[0].subscription.provider}`
      : "FREE";
  for (const grant of grants)
    if (grant.plan && planRank(grant.plan) > planRank(plan)) {
      plan = grant.plan;
      source = grant.source;
    }
  const keys = new Set(planRegistry[plan].features.map(canonicalFeature));
  const limits = { ...planRegistry[plan].limits };
  for (const grant of grants) {
    for (const feature of grant.features) keys.add(canonicalFeature(feature));
    for (const [key, value] of Object.entries(grant.limits) as [
      LimitKey,
      number | null,
    ][]) {
      // Contract overrides apply only to the explicitly scoped grant.
      if (grant.source === "CONTRACT") limits[key] = value;
      else if (value === null || (limits[key] !== null && value > limits[key]!))
        limits[key] = value;
    }
  }
  const paid = valid.filter((row) => row.value!.plan !== "FREE");
  const conflict =
      paid.length > 1 ||
      input.subscriptions.some((row) => row.status === "CONFLICT"),
    grace = valid.some((row) => row.value!.grace);
  return {
    plan,
    source,
    features: canonicalFeatures.filter((key) => keys.has(key)),
    limits,
    grants,
    subscriptions: [...input.subscriptions].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    conflict,
    grace,
    reason: input.privacyDeleted
      ? "PRIVACY_DELETED"
      : conflict
        ? "BILLING_CONFLICT"
        : grace
          ? "LAST_KNOWN_GOOD_GRACE"
          : null,
    privacyDeleted: input.privacyDeleted ?? false,
  };
}
export type EntitlementDecision = {
  allowed: boolean;
  effectivePlan: Plan;
  source: string;
  requiredPlan: Plan;
  limit: number | null;
  usage: number | null;
  resetAt: string | null;
  upgradeOptions: Plan[];
  reason: string | null;
  availability: "available" | "planned";
};
export function featureDecision(
  state: EffectiveEntitlement,
  feature: Feature,
): EntitlementDecision {
  const key = canonicalFeature(feature),
    availability = featureAvailability[key];
  const allowed =
    !state.privacyDeleted &&
    availability === "available" &&
    state.features.includes(key);
  return {
    allowed,
    effectivePlan: state.plan,
    source: state.source,
    requiredPlan: requiredPlan(key),
    limit: null,
    usage: null,
    resetAt: null,
    upgradeOptions:
      allowed || availability === "planned"
        ? []
        : plans.filter(
            (plan) =>
              planRank(plan) > planRank(state.plan) &&
              planRegistry[plan].features.includes(key),
          ),
    reason: state.privacyDeleted
      ? "PRIVACY_DELETED"
      : availability === "planned"
        ? "FEATURE_PLANNED"
        : allowed
          ? state.reason
          : "PLAN_REQUIRED",
    availability,
  };
}
export type PlanChangePreview = {
  currentPlan: Plan;
  targetPlan: Plan;
  effectiveAt: string | null;
  provider: BillingProviderKind;
  featuresGained: EntitlementFeature[];
  featuresLost: EntitlementFeature[];
  limitsChanged: { key: LimitKey; from: number | null; to: number | null }[];
  historyVisibilityChange: {
    fromDays: number | null;
    toDays: number | null;
    recoveryDays: number;
  };
  automationsThatWillPause: string[];
  guildAssignmentImpact: {
    current: number;
    allowance: number | null;
    requiresReview: boolean;
  };
  confirmationRequired: true;
  pricing: "PROVIDER_OWNED" | "UNCONFIGURED";
};
export function planChangePreview(
  state: EffectiveEntitlement,
  targetPlan: Plan,
  provider: BillingProviderKind,
  input: {
    periodEnd?: string | null;
    automationIds?: string[];
    automationRules?: { id: string; feature: Feature }[];
    assignedGuilds?: number;
    recoveryDays?: number;
  } = {},
): PlanChangePreview {
  const target = resolveEntitlements({
    subscriptions: [
      {
        id: "preview",
        provider,
        plan: targetPlan,
        status: "ACTIVE",
        periodEnd: null,
        scheduledPlan: null,
        scheduledAt: null,
        confirmedAt: new Date(0).toISOString(),
        lastGoodPlan: null,
        lastGoodUntil: null,
      },
    ],
    grants: state.grants,
  });
  const downgrade = planRank(target.plan) < planRank(state.plan),
    assigned = input.assignedGuilds ?? 1;
  const paused = input.automationRules
    ? input.automationRules
        .filter((rule) => !featureDecision(target, rule.feature).allowed)
        .map((rule) => rule.id)
    : target.features.includes("attention_automation")
      ? []
      : (input.automationIds ?? []);
  return {
    currentPlan: state.plan,
    targetPlan,
    effectiveAt: downgrade ? (input.periodEnd ?? null) : null,
    provider,
    featuresGained: target.features.filter(
      (key) =>
        !state.features.includes(key) &&
        featureAvailability[key] === "available",
    ),
    featuresLost: state.features.filter(
      (key) =>
        !target.features.includes(key) &&
        featureAvailability[key] === "available",
    ),
    limitsChanged: (Object.keys(state.limits) as LimitKey[])
      .filter((key) => state.limits[key] !== target.limits[key])
      .map((key) => ({ key, from: state.limits[key], to: target.limits[key] })),
    historyVisibilityChange: {
      fromDays: state.limits.historyDays,
      toDays: target.limits.historyDays,
      recoveryDays: input.recoveryDays ?? 30,
    },
    automationsThatWillPause: paused,
    guildAssignmentImpact: {
      current: assigned,
      allowance: target.limits.guilds,
      requiresReview:
        target.limits.guilds !== null && assigned > target.limits.guilds,
    },
    confirmationRequired: true,
    pricing: provider === "DISCORD" ? "PROVIDER_OWNED" : "UNCONFIGURED",
  };
}
