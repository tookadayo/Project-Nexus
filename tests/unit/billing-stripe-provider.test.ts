import Stripe from "../../packages/settings/node_modules/stripe/esm/stripe.esm.node.js";
import { randomUUID, createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  StripeBillingProvider,
  stripeIdempotencyKey,
  stripeSubscriptionState,
} from "../../packages/settings/src/billing/providers/stripe";
import {
  stripeConfiguration,
  liveApprovalVariables,
  commercialLaunch,
} from "../../packages/settings/src/billing/commerce";
import {
  type BillingOffering,
  offeringFingerprint,
} from "../../packages/settings/src/billing/offerings";
import type { ProviderReconcileRequest } from "../../packages/settings/src/billing/providers/types";
const scope = { organizationId: randomUUID(), guildId: "922222222222222222" };
const env = {
  NODE_ENV: "development" as const,
  NEXUS_STRIPE_ENABLED: "true",
  NEXUS_STRIPE_MODE: "SANDBOX",
  STRIPE_SECRET_KEY: "sk_test_fixture_only",
  STRIPE_WEBHOOK_SECRET: "whsec_fixture_only",
  STRIPE_PORTAL_CONFIGURATION_ID: "bpc_fixture",
  NEXUS_WEB_URL: "http://localhost:3100",
};
const offering = (plan: "STARTER" | "GROWTH" = "STARTER"): BillingOffering => ({
  id: randomUUID(),
  planKey: plan,
  planRevision: 2,
  provider: "STRIPE",
  providerProductId: `prod_fixture_${plan}`,
  providerPriceId: `price_fixture_${plan}`,
  providerNeutralOfferingId: null,
  billingInterval: "MONTH",
  billingIntervalCount: 1,
  currency: "USD",
  unitAmountMinor: plan === "STARTER" ? 1500 : 4900,
  taxBehavior: "EXCLUSIVE",
  enabled: true,
});
const price = (o: BillingOffering) => ({
  id: o.providerPriceId,
  product: o.providerProductId,
  active: true,
  livemode: false,
  currency: "usd",
  unit_amount: o.unitAmountMinor,
  type: "recurring",
  billing_scheme: "per_unit",
  transform_quantity: null,
  tax_behavior: "exclusive",
  recurring: {
    interval: "month",
    interval_count: 1,
    usage_type: "licensed",
    trial_period_days: null,
  },
});
function fixture() {
  const current = offering(),
    target = offering("GROWTH"),
    now = Math.floor(Date.now() / 1000);
  const subscription = {
    id: "sub_fixture",
    livemode: false,
    customer: "cus_fixture",
    metadata: {},
    status: "active",
    cancel_at_period_end: false,
    pending_update: null,
    schedule: null,
    discounts: [],
    latest_invoice: null,
    trial_start: null,
    items: {
      has_more: false,
      data: [
        {
          id: "si_fixture",
          price: price(current),
          quantity: 1,
          current_period_start: now,
          current_period_end: now + 86400,
        },
      ],
    },
  };
  const client = new Stripe(env.STRIPE_SECRET_KEY);
  const prices = new Map(
    [current, target].map((o) => [o.providerPriceId, price(o)]),
  );
  const mocks = {
    price: vi
      .spyOn(client.prices, "retrieve")
      .mockImplementation(async (id) => prices.get(id) as never),
    product: vi
      .spyOn(client.products, "retrieve")
      .mockImplementation(
        async (id) => ({ id, active: true, livemode: false }) as never,
      ),
    customer: vi
      .spyOn(client.customers, "retrieve")
      .mockResolvedValue({ id: "cus_fixture", livemode: false } as never),
    customerCreate: vi
      .spyOn(client.customers, "create")
      .mockResolvedValue({ id: "cus_fixture", livemode: false } as never),
    checkout: vi
      .spyOn(client.checkout.sessions, "create")
      .mockResolvedValue({
        id: "cs_fixture",
        livemode: false,
        url: "https://checkout.stripe.com/c/pay/cs_fixture",
        expires_at: now + 1800,
      } as never),
    list: vi
      .spyOn(client.subscriptions, "list")
      .mockResolvedValue({ data: [], has_more: false } as never),
    subscription: vi
      .spyOn(client.subscriptions, "retrieve")
      .mockImplementation(async () => structuredClone(subscription) as never),
    update: vi
      .spyOn(client.subscriptions, "update")
      .mockResolvedValue(subscription as never),
    scheduleCreate: vi
      .spyOn(client.subscriptionSchedules, "create")
      .mockResolvedValue({
        id: "sub_sched_fixture",
        livemode: false,
        current_phase: { start_date: now },
      } as never),
    scheduleUpdate: vi
      .spyOn(client.subscriptionSchedules, "update")
      .mockResolvedValue({ id: "sub_sched_fixture", livemode: false } as never),
    schedule: vi.spyOn(client.subscriptionSchedules, "retrieve"),
    config: vi
      .spyOn(client.billingPortal.configurations, "retrieve")
      .mockResolvedValue({
        id: "bpc_fixture",
        active: true,
        livemode: false,
        features: {
          subscription_update: { enabled: false },
          subscription_cancel: { enabled: true, mode: "at_period_end" },
        },
      } as never),
    portal: vi
      .spyOn(client.billingPortal.sessions, "create")
      .mockResolvedValue({
        url: "https://billing.stripe.com/p/session/fixture",
      } as never),
  };
  const provider = new StripeBillingProvider({ env, client });
  const input = {
    scope,
    operationId: randomUUID(),
    offeringId: current.id,
    offering: current,
    idempotencyKey: randomUUID(),
    customer: {
      provider: "STRIPE" as const,
      bindingId: randomUUID(),
      customerRef: "cus_fixture",
    },
  };
  const request: ProviderReconcileRequest = {
    scope,
    customer: input.customer,
    subscriptions: [
      {
        provider: "STRIPE",
        bindingId: randomUUID(),
        subscriptionRef: subscription.id,
      },
    ],
    offerings: [current, target],
  };
  return {
    current,
    target,
    subscription,
    provider,
    client,
    mocks,
    input,
    request,
  };
}
describe("Stripe SDK boundary", () => {
  it("sales closure leaves runtime, management, signed signals and cancellation available", async () => {
    const config = stripeConfiguration({
      ...env,
      NEXUS_STRIPE_CHECKOUT_ENABLED: "false",
      NEXUS_STRIPE_PUBLIC_SALES_ENABLED: "false",
    });
    expect(config.capabilities).toEqual({
      runtime: "AVAILABLE",
      management: "AVAILABLE",
      checkout: "NOT_CONFIGURED",
      publicSales: "NOT_CONFIGURED",
    });
    const f = fixture(),
      provider = new StripeBillingProvider({
        env: { ...env, NEXUS_STRIPE_CHECKOUT_ENABLED: "false" },
        client: f.client,
      });
    await expect(provider.createCheckout(f.input)).rejects.toThrow(
      "BILLING_CHECKOUT_DISABLED",
    );
    expect(f.mocks.customerCreate).not.toHaveBeenCalled();
    expect(f.mocks.checkout).not.toHaveBeenCalled();
    expect((await provider.reconcile(f.request)).kind).toBe("FULL_CENSUS");
    await provider.createPortalSession({
      scope,
      customer: f.input.customer,
      idempotencyKey: randomUUID(),
    });
    await provider.cancel({
      scope,
      subscription: f.request.subscriptions[0]!,
      policy: "AT_PERIOD_END",
      idempotencyKey: randomUUID(),
    });
  });
  it("trusted developer applicability gates Live sales, never Live runtime", () => {
    const live: NodeJS.ProcessEnv = {
      ...env,
      NODE_ENV: "production",
      NEXUS_STRIPE_MODE: "LIVE",
      STRIPE_SECRET_KEY: "sk_live_fixture_only",
      NEXUS_STRIPE_LIVE_ENABLED: "true",
      ...Object.fromEntries(liveApprovalVariables.map((key) => [key, "true"])),
    };
    expect(stripeConfiguration(live).runtimeEnabled).toBe(true);
    expect(stripeConfiguration(live).checkoutEnabled).toBe(false);
    expect(
      stripeConfiguration({ ...live, NEXUS_BILLING_DEVELOPER_COUNTRY: "US" })
        .checkoutEnabled,
    ).toBe(false);
    expect(
      stripeConfiguration({
        ...live,
        NEXUS_BILLING_DEVELOPER_COUNTRY: "JP",
        NEXUS_DISCORD_MONETIZATION_APPROVED: "false",
        NEXUS_DISCORD_PARITY_APPROVED: "false",
      }).checkoutEnabled,
    ).toBe(true);
    expect(
      stripeConfiguration({
        ...live,
        NEXUS_BILLING_DEVELOPER_COUNTRY: "US",
        NEXUS_DISCORD_BILLING_ENABLED: "true",
        NEXUS_DISCORD_SKU_STARTER: "111111111111111111",
        NEXUS_DISCORD_SKU_GROWTH: "222222222222222222",
        NEXUS_DISCORD_SKU_SCALE: "333333333333333333",
      }).checkoutEnabled,
    ).toBe(true);
    expect(
      commercialLaunch({ ...env, NEXUS_STRIPE_PUBLIC_SALES_ENABLED: "false" })
        .publishPrices,
    ).toBe(false);
  });
  it("returns only a bound Stripe hosted invoice for an unpaid pending upgrade", async () => {
    const f = fixture(),
      invoice = {
        id: "in_fixture",
        livemode: false,
        status: "open",
        customer: "cus_fixture",
        parent: { subscription_details: { subscription: "sub_fixture" } },
        hosted_invoice_url: "https://invoice.stripe.com/i/fixture",
      };
    f.mocks.update.mockResolvedValue({
      ...f.subscription,
      pending_update: { expires_at: 123 },
      latest_invoice: invoice,
    } as never);
    const input = {
      scope,
      subscription: f.request.subscriptions[0]!,
      currentOffering: f.current,
      offering: f.target,
      idempotencyKey: randomUUID(),
      policy: {
        effective: "IMMEDIATE" as const,
        proration: "PROVIDER_CALCULATED" as const,
      },
    };
    expect(await f.provider.changeSubscription(input)).toEqual({
      state: "PAYMENT_ACTION_REQUIRED",
      paymentUrl: invoice.hosted_invoice_url,
    });
    expect(
      await f.provider.reconcile({
        ...f.request,
        target: f.request.subscriptions[0],
      }),
    ).toMatchObject({ subscription: { plan: "STARTER" } });
    f.mocks.update.mockResolvedValue({
      ...f.subscription,
      pending_update: {},
      latest_invoice: { ...invoice, customer: "cus_unknown" },
    } as never);
    await expect(f.provider.changeSubscription(input)).rejects.toThrow(
      "STRIPE_UPGRADE_INVOICE_BINDING_INVALID",
    );
    f.mocks.update.mockResolvedValue({
      ...f.subscription,
      pending_update: {},
      latest_invoice: {
        ...invoice,
        hosted_invoice_url: "https://evil.example/pay",
      },
    } as never);
    await expect(f.provider.changeSubscription(input)).rejects.toThrow(
      "STRIPE_UPGRADE_PAYMENT_URL_UNAVAILABLE",
    );
  });
  it("revisits a pending payment from fresh authoritative subscription state", async () => {
    const f = fixture(),
      invoice = {
        id: "in_fixture",
        livemode: false,
        status: "open",
        customer: "cus_fixture",
        parent: { subscription_details: { subscription: "sub_fixture" } },
        hosted_invoice_url: "https://invoice.stripe.com/i/current",
      };
    f.mocks.subscription.mockResolvedValue({
      ...f.subscription,
      pending_update: { expires_at: 123 },
      latest_invoice: invoice,
    } as never);
    const input = { subscription: f.request.subscriptions[0]! };
    expect(await f.provider.pendingPayment(input)).toEqual({
      state: "PAYMENT_ACTION_REQUIRED",
      paymentUrl: invoice.hosted_invoice_url,
    });
    expect(f.mocks.subscription).toHaveBeenLastCalledWith("sub_fixture", {
      expand: ["latest_invoice"],
    });
    f.mocks.subscription.mockResolvedValue({
      ...f.subscription,
      pending_update: null,
      latest_invoice: invoice,
    } as never);
    expect(await f.provider.pendingPayment(input)).toEqual({
      state: "CONFIRMING",
    });
    f.mocks.subscription.mockResolvedValue({
      ...f.subscription,
      livemode: true,
    } as never);
    await expect(f.provider.pendingPayment(input)).rejects.toThrow(
      "STRIPE_OBJECT_MODE_MISMATCH",
    );
  });
  it("rejects live keys in Sandbox and test keys in production", () => {
    expect(() =>
      stripeConfiguration({
        ...env,
        STRIPE_SECRET_KEY: "sk_live_fixture_only",
      }),
    ).toThrow("STRIPE_LIVE_KEY_IN_SANDBOX");
    expect(() =>
      stripeConfiguration({ ...env, NODE_ENV: "production" }),
    ).toThrow("STRIPE_TEST_KEY_IN_PRODUCTION");
    expect(
      stripeConfiguration({
        ...env,
        NEXUS_STRIPE_MODE: "LIVE",
        STRIPE_SECRET_KEY: "sk_live_fixture_only",
      }).checkoutEnabled,
    ).toBe(false);
  });
  it("namespaces provider keys by operation and scope", () => {
    const key = randomUUID(),
      a = stripeIdempotencyKey("checkout", scope, key);
    expect(a).toMatch(/^nexus:checkout:[a-f0-9]{64}$/);
    expect(a).not.toContain(key);
    expect(a).toBe(stripeIdempotencyKey("checkout", scope, key));
    expect(a).not.toBe(stripeIdempotencyKey("cancel", scope, key));
    expect(a).not.toBe(
      stripeIdempotencyKey(
        "checkout",
        { ...scope, guildId: "933333333333333333" },
        key,
      ),
    );
  });
  it("creates hosted subscription Checkout from the trusted Offering and origin", async () => {
    const f = fixture();
    await f.provider.createCheckout(f.input);
    const [params, options] = f.mocks.checkout.mock.calls[0]!;
    expect(params).toMatchObject({
      mode: "subscription",
      customer: "cus_fixture",
      line_items: [{ price: f.current.providerPriceId, quantity: 1 }],
      success_url: "http://localhost:3100/billing/success",
      cancel_url: "http://localhost:3100/billing/manage",
      automatic_tax: { enabled: false },
      managed_payments: { enabled: false },
      allow_promotion_codes: false,
    });
    expect(params).not.toHaveProperty("payment_method_types");
    expect(params!.integration_identifier).toMatch(/-[a-z]{8}$/);
    expect(options!.idempotencyKey).toMatch(/^nexus:checkout:/);
  });
  it("persists a created Customer through Core before creating Checkout", async () => {
    const f = fixture(),
      bound = vi.fn(async () => {});
    await f.provider.createCheckout({
      ...f.input,
      customer: undefined,
      onCustomerCreated: bound,
    });
    expect(bound).toHaveBeenCalledWith("cus_fixture");
    expect(bound.mock.invocationCallOrder[0]).toBeLessThan(
      f.mocks.checkout.mock.invocationCallOrder[0]!,
    );
    expect(f.mocks.customerCreate.mock.calls[0]![0]).not.toHaveProperty(
      "email",
    );
  });
  it.each(["disabled", "amount", "live"])(
    "rejects %s Offering before any mutation",
    async (condition) => {
      const f = fixture();
      if (condition === "disabled") f.current.enabled = false;
      if (condition === "amount") f.current.unitAmountMinor = 1;
      if (condition === "live")
        f.mocks.price.mockResolvedValue({
          ...price(f.current),
          livemode: true,
        } as never);
      await expect(f.provider.createCheckout(f.input)).rejects.toThrow();
      expect(f.mocks.checkout).not.toHaveBeenCalled();
      expect(f.mocks.customerCreate).not.toHaveBeenCalled();
    },
  );
  it("rejects a second Checkout for an existing nonterminal subscription", async () => {
    const f = fixture();
    f.mocks.list.mockResolvedValue({
      data: [f.subscription],
      has_more: false,
    } as never);
    await expect(f.provider.createCheckout(f.input)).rejects.toThrow(
      "BILLING_EXISTING_SUBSCRIPTION",
    );
    expect(f.mocks.checkout).not.toHaveBeenCalled();
  });
  it("reuses an exact product-scoped coupon and excludes mutually exclusive Checkout parameters", async () => {
    const f = fixture(),
      reservationId = randomUUID();
    const promotion = {
      reservationId,
      campaignId: randomUUID(),
      offeringId: f.current.id,
      provider: "STRIPE" as const,
      planKey: "STARTER" as const,
      planRevision: 2,
      billingInterval: "MONTH" as const,
      billingIntervalCount: 1,
      currency: "USD",
      unitAmountMinor: 1500,
      taxBehavior: "EXCLUSIVE" as const,
      discountType: "PERCENT" as const,
      discountValue: 10,
      finalPreTaxAmountMinor: 1350,
      providerTrial: false as const,
    };
    const coupon = {
      id:
        "nexus_" +
        createHash("sha256").update(reservationId).digest("hex").slice(0, 40),
      livemode: false,
      valid: true,
      duration: "once",
      max_redemptions: 1,
      times_redeemed: 0,
      percent_off: 10,
      amount_off: null,
      metadata: {
        nexus_reservation: reservationId,
        nexus_offering: f.current.id,
      },
      applies_to: { products: [f.current.providerProductId] },
    };
    const retrieve = vi
        .spyOn(f.client.coupons, "retrieve")
        .mockResolvedValue(coupon as never),
      create = vi.spyOn(f.client.coupons, "create");
    await f.provider.createCheckout({ ...f.input, promotion });
    expect(retrieve).toHaveBeenCalledWith(coupon.id, {
      expand: ["applies_to"],
    });
    expect(create).not.toHaveBeenCalled();
    expect(f.mocks.checkout.mock.calls[0]![0]).toMatchObject({
      discounts: [{ coupon: coupon.id }],
    });
    expect(f.mocks.checkout.mock.calls[0]![0]).not.toHaveProperty(
      "allow_promotion_codes",
    );
    retrieve.mockResolvedValue({ ...coupon, percent_off: 20 } as never);
    await expect(
      f.provider.createCheckout({ ...f.input, promotion }),
    ).rejects.toThrow("STRIPE_PROMOTION_COUPON_MISMATCH");
    expect(f.mocks.checkout).toHaveBeenCalledOnce();
  });
  it("Portal has no invented expiry and rejects free Price changes", async () => {
    const f = fixture();
    expect(
      await f.provider.createPortalSession({
        scope,
        customer: f.input.customer,
        idempotencyKey: randomUUID(),
      }),
    ).toEqual({ url: "https://billing.stripe.com/p/session/fixture" });
    f.mocks.config.mockResolvedValue({
      active: true,
      livemode: false,
      features: {
        subscription_update: { enabled: true },
        subscription_cancel: { enabled: false },
      },
    } as never);
    await expect(
      f.provider.createPortalSession({
        scope,
        customer: f.input.customer,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toThrow("STRIPE_PORTAL_POLICY_UNSAFE");
    expect(f.mocks.portal).toHaveBeenCalledOnce();
  });
  it("upgrade explicitly invoices proration with pending payment semantics", async () => {
    const f = fixture();
    await f.provider.changeSubscription({
      scope,
      subscription: f.request.subscriptions[0]!,
      currentOffering: f.current,
      offering: f.target,
      idempotencyKey: randomUUID(),
      policy: { effective: "IMMEDIATE", proration: "PROVIDER_CALCULATED" },
    });
    expect(f.mocks.update.mock.calls[0]![1]).toMatchObject({
      items: [
        { id: "si_fixture", price: f.target.providerPriceId, quantity: 1 },
      ],
      payment_behavior: "pending_if_incomplete",
      proration_behavior: "always_invoice",
    });
  });
  it("downgrade schedules next-period Price while preserving the paid current phase", async () => {
    const f = fixture();
    f.subscription.items.data[0]!.price = price(f.target);
    await f.provider.changeSubscription({
      scope,
      subscription: f.request.subscriptions[0]!,
      currentOffering: f.target,
      offering: f.current,
      idempotencyKey: randomUUID(),
      policy: { effective: "AT_PERIOD_END", proration: "NONE" },
    });
    const params = f.mocks.scheduleUpdate.mock.calls[0]![1]!;
    expect(params).toMatchObject({
      end_behavior: "release",
      proration_behavior: "none",
      phases: [
        {
          items: [{ price: f.target.providerPriceId, quantity: 1 }],
          end_date: f.subscription.items.data[0]!.current_period_end,
        },
        {
          items: [{ price: f.current.providerPriceId, quantity: 1 }],
          start_date: f.subscription.items.data[0]!.current_period_end,
          discounts: [],
        },
      ],
    });
    expect(f.mocks.update).not.toHaveBeenCalled();
  });
  it("cancel keeps paid-through time and only uses period-end policy", async () => {
    const f = fixture(),
      input = {
        scope,
        subscription: f.request.subscriptions[0]!,
        policy: "AT_PERIOD_END" as const,
        idempotencyKey: randomUUID(),
      };
    expect(await f.provider.cancel(input)).toEqual({
      scheduledAt: new Date(
        f.subscription.items.data[0]!.current_period_end * 1000,
      ).toISOString(),
    });
    expect(f.mocks.update.mock.calls[0]![1]).toEqual({
      cancel_at_period_end: true,
    });
    await expect(
      f.provider.cancel({ ...input, policy: "IMMEDIATE" }),
    ).rejects.toThrow("BILLING_IMMEDIATE_CANCEL_UNAVAILABLE");
  });
  it("complete empty census differs from API failure and partial pagination", async () => {
    const f = fixture();
    expect(await f.provider.reconcile(f.request)).toEqual({
      kind: "FULL_CENSUS",
      complete: true,
      events: [],
    });
    f.mocks.list.mockRejectedValue(new Error("timeout"));
    expect((await f.provider.reconcile(f.request)).kind).toBe("INCOMPLETE");
    f.mocks.list.mockResolvedValue({ data: [], has_more: true } as never);
    expect((await f.provider.reconcile(f.request)).kind).toBe("INCOMPLETE");
  });
  it("only subscription retrieval absence is authoritative; dependent API absence is incomplete", async () => {
    const f = fixture(),
      missing = new Stripe.errors.StripeInvalidRequestError({
        code: "resource_missing",
        message: "Fixture missing",
      });
    f.mocks.subscription.mockRejectedValue(missing);
    expect(
      await f.provider.reconcile({
        ...f.request,
        target: f.request.subscriptions[0],
      }),
    ).toEqual({ kind: "TARGET_ABSENT", subscriptionRef: "sub_fixture" });
    f.mocks.subscription.mockResolvedValue({
      ...f.subscription,
      schedule: "sub_sched_fixture",
    } as never);
    f.mocks.schedule.mockRejectedValue(missing);
    expect(
      (
        await f.provider.reconcile({
          ...f.request,
          target: f.request.subscriptions[0],
        })
      ).kind,
    ).toBe("INCOMPLETE");
  });
  it("snapshot Price maps to immutable Offering, with no promotion evidence from ACTIVE alone", async () => {
    const f = fixture();
    const result = await f.provider.reconcile({
      ...f.request,
      target: f.request.subscriptions[0],
    });
    expect(result).toMatchObject({
      kind: "TARGET_FOUND",
      subscription: {
        plan: "STARTER",
        status: "ACTIVE",
        offeringAssociation: {
          offeringId: f.current.id,
          fingerprint: offeringFingerprint(f.current),
        },
        version: 0,
        ordering: "RECONCILE_LATEST",
      },
    });
    if (result.kind === "TARGET_FOUND")
      expect(result.subscription.commercialEvidence).toBeUndefined();
  });
  it("unknown status stays UNKNOWN; cancellation and failure mappings are explicit", () => {
    for (const [status, expected] of [
      ["future", "UNKNOWN"],
      ["active", "ACTIVE"],
      ["trialing", "TRIALING"],
      ["past_due", "PAST_DUE"],
      ["unpaid", "SUSPENDED"],
      ["paused", "SUSPENDED"],
      ["incomplete", "INCOMPLETE"],
      ["incomplete_expired", "EXPIRED"],
      ["canceled", "CANCELED"],
    ])
      expect(stripeSubscriptionState(status!)).toBe(expected);
    expect(stripeSubscriptionState("active", true)).toBe(
      "CANCEL_AT_PERIOD_END",
    );
  });
  it("official SDK verifies exact bytes, ignores forged scope metadata, and rejects live objects", async () => {
    const f = fixture(),
      raw = Buffer.from(
        JSON.stringify({
          id: "evt_fixture",
          type: "customer.subscription.updated",
          livemode: false,
          data: {
            object: {
              ...f.subscription,
              metadata: { guildId: "999999999999999999" },
            },
          },
        }),
      );
    const signature = f.client.webhooks.generateTestHeaderString({
      payload: raw.toString(),
      secret: env.STRIPE_WEBHOOK_SECRET,
    });
    expect(
      await f.provider.verifyWebhook(raw, { "Stripe-Signature": signature }),
    ).toEqual([
      {
        eventId: "evt_fixture",
        provider: "STRIPE",
        subscriptionRef: "sub_fixture",
        customerRef: "cus_fixture",
        bindingEvidence: {
          kind: "CUSTOMER_SUBSCRIPTION",
          customerRef: "cus_fixture",
          subscriptionRef: "sub_fixture",
        },
      },
    ]);
    await expect(f.provider.verifyWebhook(raw, {})).rejects.toThrow(
      "STRIPE_SIGNATURE_REQUIRED",
    );
    await expect(
      f.provider.verifyWebhook(raw, { "Stripe-Signature": "invalid" }),
    ).rejects.toThrow("STRIPE_SIGNATURE_INVALID");
    const changed = Buffer.from(raw);
    changed[0] = 32;
    await expect(
      f.provider.verifyWebhook(changed, { "Stripe-Signature": signature }),
    ).rejects.toThrow("STRIPE_SIGNATURE_INVALID");
    await expect(
      f.provider.verifyWebhook(Buffer.alloc(65537), {
        "Stripe-Signature": signature,
      }),
    ).rejects.toThrow("BILLING_EVENT_TOO_LARGE");
    const live = raw
        .toString()
        .replaceAll('"livemode":false', '"livemode":true'),
      liveSig = f.client.webhooks.generateTestHeaderString({
        payload: live,
        secret: env.STRIPE_WEBHOOK_SECRET,
      });
    await expect(
      f.provider.verifyWebhook(Buffer.from(live), {
        "Stripe-Signature": liveSig,
      }),
    ).rejects.toThrow("STRIPE_OBJECT_MODE_MISMATCH");
  });
});
