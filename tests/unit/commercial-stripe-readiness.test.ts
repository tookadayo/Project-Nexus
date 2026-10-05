import { it, expect } from "vitest";
import {
  StripeBillingProvider,
  stripeConfiguration,
  stripeSubscriptionState,
  providers,
  subscriptionPlan,
  resolveEntitlements,
  featureDecision,
  billingViewModel,
  type EntitlementSubscription,
  type BillingOffering,
} from "../../packages/settings/src/billing";
const scope = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  guildId: "555555555555555555",
};
const now = new Date("2026-10-03T00:00:00Z");
const sub = (
  status: EntitlementSubscription["status"],
): EntitlementSubscription => ({
  id: "fixture",
  provider: "STRIPE",
  plan: "GROWTH",
  status,
  periodEnd: "2026-11-03T00:00:00Z",
  confirmedAt: now.toISOString(),
  scheduledPlan: null,
  scheduledAt: null,
  lastGoodPlan: "GROWTH",
  lastGoodUntil: "2026-10-04T00:00:00Z",
});
it.each([
  ["trialing", "TRIALING"],
  ["active", "ACTIVE"],
  ["past_due", "PAST_DUE"],
  ["paused", "SUSPENDED"],
  ["unpaid", "SUSPENDED"],
  ["incomplete", "INCOMPLETE"],
  ["incomplete_expired", "EXPIRED"],
  ["canceled", "CANCELED"],
  ["future_status", "UNKNOWN"],
] as const)("maps Stripe %s explicitly to %s", (input, expected) =>
  expect(stripeSubscriptionState(input)).toBe(expected),
);
it("recognizes Stripe separately from quarantined generic historical references", () => {
  expect(providers).toContain("STRIPE");
  expect(providers).toContain("EXTERNAL_LEGACY");
  expect(providers).not.toContain("EXTERNAL");
  expect(new StripeBillingProvider().ordering).toBe("RECONCILE_LATEST");
});
it("trial policy, suspensions, expiration and paid cancellation periods bound access", () => {
  expect(subscriptionPlan(sub("ACTIVE"), now)?.plan).toBe("GROWTH");
  expect(subscriptionPlan(sub("TRIALING"), now)?.plan).toBe("GROWTH");
  expect(
    subscriptionPlan({ ...sub("TRIALING"), trialAllowed: false }, now),
  ).toBeNull();
  for (const status of ["INCOMPLETE", "SUSPENDED", "EXPIRED"] as const)
    expect(subscriptionPlan(sub(status), now)).toBeNull();
  for (const status of ["PAST_DUE", "UNKNOWN", "CONFLICT"] as const) {
    expect(subscriptionPlan(sub(status), now)?.grace).toBe(true);
    expect(
      subscriptionPlan(sub(status), new Date("2026-10-05T00:00:00Z")),
    ).toBeNull();
  }
  expect(subscriptionPlan(sub("CANCEL_AT_PERIOD_END"), now)?.plan).toBe("GROWTH");
  expect(subscriptionPlan(sub("CANCELED"), now)).toBeNull();
  expect(
    subscriptionPlan({ ...sub("CANCELED"), periodEnd: null }, now),
  ).toBeNull();
  expect(
    subscriptionPlan(sub("CANCELED"), new Date("2026-12-03T00:00:00Z")),
  ).toBeNull();
  expect(stripeSubscriptionState("active", true)).toBe("CANCEL_AT_PERIOD_END");
  expect(stripeSubscriptionState("trialing", true)).toBe("TRIALING");
});
it("credentials and success redirects never activate Stripe or grant access", async () => {
  expect(
    stripeConfiguration({
      NODE_ENV: "test",
      NEXUS_STRIPE_ENABLED: "true",
      STRIPE_SECRET_KEY: "fixture-not-a-secret",
    }).capability,
  ).toBe("NOT_CONFIGURED");
  const provider = new StripeBillingProvider();
  const offering: BillingOffering = {
    id: scope.organizationId,
    planKey: "GROWTH",
    planRevision: 2,
    provider: "STRIPE",
    providerProductId: "fixture-product",
    providerPriceId: "fixture-price",
    providerNeutralOfferingId: null,
    taxBehavior: "EXCLUSIVE",
    billingInterval: "MONTH",
    billingIntervalCount: 1,
    currency: "JPY",
    unitAmountMinor: 4900,
    enabled: true,
  };
  const request = {
    scope,
    operationId: scope.organizationId,
    offeringId: offering.id,
    offering,
    idempotencyKey: scope.organizationId,
  };
  await expect(provider.createCheckout(request)).rejects.toThrow(
    "BILLING_PROVIDER_NOT_CONFIGURED",
  );
  const subscription = { provider: "STRIPE" as const, bindingId: scope.organizationId, subscriptionRef: "fixture-subscription" };
  await expect(provider.createPortalSession({scope, idempotencyKey: request.idempotencyKey, customer: {provider: "STRIPE", bindingId: scope.organizationId, customerRef: "fixture-customer"}})).rejects.toThrow(
    "BILLING_PROVIDER_NOT_CONFIGURED",
  );
  await expect(provider.cancel({scope, subscription, idempotencyKey: request.idempotencyKey, policy: "AT_PERIOD_END"})).rejects.toThrow(
    "BILLING_PROVIDER_NOT_CONFIGURED",
  );
  await expect(provider.changeSubscription({...request, subscription, policy: {effective: "IMMEDIATE", proration: "PROVIDER_CALCULATED"}})).rejects.toThrow(
    "BILLING_PROVIDER_NOT_CONFIGURED",
  );
  await expect(provider.reconcile({scope, subscriptions: [], offerings: []})).rejects.toThrow(
    "BILLING_PROVIDER_NOT_CONFIGURED",
  );
  await expect(
    provider.verifyWebhook(Buffer.from('{"success_url":true}'), {
      "Stripe-Signature": "unverified",
    }),
  ).rejects.toThrow("BILLING_PROVIDER_NOT_CONFIGURED");
  await expect(provider.currentSubscription(scope)).rejects.toThrow(
    "BILLING_PROVIDER_NOT_CONFIGURED",
  );
  const free = resolveEntitlements({ subscriptions: [], grants: [] });
  expect(free.plan).toBe("FREE");
  expect(featureDecision(free, "custom_recipe").allowed).toBe(false);
  const view = billingViewModel({
    ...free,
    usage: {
      plan: "FREE",
      used: 0,
      included: 100,
      softLimit: 120,
      projected: 0,
      automaticOverageCharge: false,
    },
    recoveryUntil: null,
    pausedRules: [],
  });
  expect(view.presentation.billingActions.purchase[0]).toMatchObject({
    provider: "STRIPE",
    configured: false,
    available: false,
    requiresOffering: true,
  });
  expect(JSON.stringify(view)).not.toContain("stripe.com");
});
