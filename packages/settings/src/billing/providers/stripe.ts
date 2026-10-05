import { createHash } from "node:crypto";
import Stripe from "stripe";
import { assert, type Scope } from "../../../../shared/src/index";
import { trustedWebOrigin } from "../../../../config/src/trusted-web-origin";
import { planRank } from "../../plan-registry";
import { stripeConfiguration, paidPlanReady } from "../commerce";
import { offeringFingerprint, type BillingOffering } from "../offerings";
import { DefinitiveBillingFailure } from "../operations";
import { promotionCheckoutContextSchema, type PromotionCheckoutContext } from "../policy";
import { UnconfiguredBillingProvider, type CheckoutRequest, type PortalRequest, type ChangeSubscriptionRequest, type CancelSubscriptionRequest, type ProviderReconcileRequest, type ProviderReconcileResult, type ProviderSignal, type NormalizedBillingEvent } from "./types";
import type { SubscriptionState } from "../domain";
export { stripeConfiguration } from "../commerce";
export type StripeClient = Stripe;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function stripeIdempotencyKey(operation: string, scope: Scope, key: string) {
  return `nexus:${operation}:${hash(JSON.stringify([scope.organizationId, scope.guildId, key]))}`;
}
const objectId = (value: string | { id: string } | null | undefined) => typeof value === "string" ? value : value?.id;
const couponId = (context: PromotionCheckoutContext) => `nexus_${hash(context.reservationId).slice(0,40)}`;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
export const stripeWebhookEvents = [
  "checkout.session.completed", "checkout.session.async_payment_succeeded",
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
  "customer.subscription.pending_update_applied", "customer.subscription.pending_update_expired",
  "invoice.paid", "invoice.payment_failed",
] as const;

/** The only runtime module that knows the Stripe SDK. Never queries NEXUS DB. */
export class StripeBillingProvider extends UnconfiguredBillingProvider {
  private sdk?: Stripe;
  private readonly env: NodeJS.ProcessEnv;
  constructor(options: { env?: NodeJS.ProcessEnv; client?: Stripe } = {}) {
    super("STRIPE");
    assert(typeof window === "undefined", "STRIPE_SERVER_ONLY", 500);
    this.env = options.env ?? process.env;
    this.sdk = options.client;
  }
  private client() {
    assert(stripeConfiguration(this.env).capability === "AVAILABLE", "BILLING_PROVIDER_NOT_CONFIGURED", 503);
    return this.sdk ??= new Stripe(this.env.STRIPE_SECRET_KEY!, { maxNetworkRetries: 0, timeout: 15000 });
  }
  private mode(object: { livemode: boolean }) {
    assert(object.livemode === stripeConfiguration(this.env).livemode, "STRIPE_OBJECT_MODE_MISMATCH", 409);
  }
  /** Administrative Sandbox bootstrap. The caller owns all NEXUS persistence. */
  async syncSandboxCatalog(expectedAccountId: string, dryRun = true) {
    const client = this.client();
    assert(!stripeConfiguration(this.env).livemode, "STRIPE_SANDBOX_REQUIRED", 409);
    const account = await client.accounts.retrieve(null), balance = await client.balance.retrieve();
    this.mode(balance);
    assert(account.id === expectedAccountId && /^acct_/.test(expectedAccountId), "STRIPE_ACCOUNT_MISMATCH", 409);
    const products: Stripe.Product[] = [];
    for await (const product of client.products.list({ limit: 100 })) { this.mode(product); products.push(product); }
    const catalog: { plan: "STARTER" | "GROWTH" | "SCALE"; amount: number; productId: string | null; priceId: string | null }[] = [];
    for (const [plan, amount] of [["STARTER",1500],["GROWTH",4900],["SCALE",14900]] as const) {
      const matching = products.filter(p => p.active && p.metadata.nexus_app === "project-nexus" && p.metadata.nexus_plan === plan && p.metadata.nexus_revision === "2");
      assert(matching.length <= 1, "STRIPE_CATALOG_AMBIGUOUS", 409);
      let product = matching[0];
      if (!product && !dryRun) {
        // Reconfirm the account immediately before the first write.
        assert((await client.accounts.retrieve(null)).id === expectedAccountId, "STRIPE_ACCOUNT_MISMATCH",409);
        product = await client.products.create({ name: `NEXUS ${plan[0]}${plan.slice(1).toLowerCase()}`, metadata: { nexus_app:"project-nexus",nexus_plan:plan,nexus_revision:"2",nexus_pricing:"internal-provisional" } }, {idempotencyKey:`nexus:catalog:product:${plan.toLowerCase()}:r2`});
        this.mode(product);
      }
      const prices: Stripe.Price[] = [];
      if (product) for await (const price of client.prices.list({product:product.id,limit:100})) {this.mode(price);prices.push(price);}
      const matches = prices.filter(p => p.active && p.currency === "usd" && p.unit_amount === amount && p.type === "recurring" && p.recurring?.interval === "month" && p.recurring.interval_count === 1 && p.recurring.usage_type === "licensed" && !p.recurring.trial_period_days && p.tax_behavior === "exclusive" && p.billing_scheme === "per_unit" && !p.transform_quantity);
      assert(matches.length <= 1,"STRIPE_CATALOG_AMBIGUOUS",409);
      let price = matches[0];
      if (!price && product && !dryRun) {
        price = await client.prices.create({product:product.id,currency:"usd",unit_amount:amount,recurring:{interval:"month",interval_count:1},tax_behavior:"exclusive",lookup_key:`nexus-${plan.toLowerCase()}-r2-usd-month-alpha7`,metadata:{nexus_app:"project-nexus",nexus_plan:plan,nexus_revision:"2",nexus_pricing:"internal-provisional"}},{idempotencyKey:`nexus:catalog:price:${plan.toLowerCase()}:r2:usd:month:${amount}:exclusive`});
        this.mode(price);
      }
      catalog.push({plan,amount,productId:product?.id??null,priceId:price?.id??null});
    }
    return catalog;
  }
  async configureSandboxPortal(expectedAccountId: string, dryRun = true) {
    // Inventory validates account/mode before any administrative mutation.
    await this.syncSandboxCatalog(expectedAccountId,true);
    const client=this.client(), configurations: Stripe.BillingPortal.Configuration[]=[];
    for await(const config of client.billingPortal.configurations.list({limit:100})) {this.mode(config);configurations.push(config);}
    const safe=configurations.filter(c=>c.active && c.metadata?.nexus_app==="project-nexus" && !c.features.subscription_update.enabled && c.features.payment_method_update.enabled && c.features.invoice_history.enabled && c.features.subscription_cancel.enabled && c.features.subscription_cancel.mode==="at_period_end");
    assert(safe.length<=1,"STRIPE_PORTAL_AMBIGUOUS",409);
    if(safe[0]||dryRun) return safe[0]?.id??null;
    const config=await client.billingPortal.configurations.create({business_profile:{headline:"Manage your NEXUS billing"},metadata:{nexus_app:"project-nexus"},features:{customer_update:{enabled:true,allowed_updates:["address","email","tax_id"]},payment_method_update:{enabled:true},invoice_history:{enabled:true},subscription_update:{enabled:false},subscription_cancel:{enabled:true,mode:"at_period_end",proration_behavior:"none"}}},{idempotencyKey:"nexus:portal:configuration:alpha7:restricted"});
    this.mode(config);return config.id;
  }
  private async mutation<T>(execute: () => Promise<T>, partial = false): Promise<T> {
    try { return await execute(); }
    catch (error) {
      if (!partial && (error instanceof Stripe.errors.StripeInvalidRequestError || error instanceof Stripe.errors.StripeCardError || error instanceof Stripe.errors.StripeAuthenticationError || error instanceof Stripe.errors.StripePermissionError))
        throw new DefinitiveBillingFailure("STRIPE_REQUEST_REJECTED",error);
      throw error;
    }
  }
  private matches(price: Stripe.Price, offering: BillingOffering) {
    this.mode(price);
    return price.id === offering.providerPriceId && objectId(price.product) === offering.providerProductId &&
      price.currency.toUpperCase() === offering.currency && price.unit_amount === offering.unitAmountMinor &&
      price.type === "recurring" && price.billing_scheme === "per_unit" && !price.transform_quantity &&
      price.recurring?.usage_type === "licensed" && price.recurring.interval === offering.billingInterval.toLowerCase() &&
      price.recurring.interval_count === offering.billingIntervalCount && price.tax_behavior?.toUpperCase() === offering.taxBehavior;
  }
  private async validateOffering(offering: BillingOffering) {
    const client = this.client();
    assert(offering?.enabled && offering.provider === "STRIPE" && offering.providerPriceId && offering.providerProductId,
      "BILLING_OFFERING_UNAVAILABLE", 409);
    assert(!stripeConfiguration(this.env).livemode || paidPlanReady(offering.planKey), "BILLING_PAID_FEATURES_NOT_READY", 409);
    const price = await client.prices.retrieve(offering.providerPriceId), product = await client.products.retrieve(offering.providerProductId);
    assert(!product.deleted, "BILLING_OFFERING_UNAVAILABLE", 409);
    this.mode(product);
    assert(price.active && product.active && this.matches(price, offering) && !price.recurring?.trial_period_days, "STRIPE_OFFERING_MISMATCH", 409);
  }
  override async createCheckout(input: CheckoutRequest) {
    const client = this.client();
    await this.validateOffering(input.offering);
    assert(input.offeringId === input.offering.id, "STRIPE_OFFERING_MISMATCH", 409);
    const promotion = input.promotion ? promotionCheckoutContextSchema.parse(input.promotion) : undefined;
    if (promotion) assert(promotion.offeringId === input.offering.id && promotion.planKey === input.offering.planKey &&
      promotion.planRevision === input.offering.planRevision && promotion.currency === input.offering.currency &&
      promotion.unitAmountMinor === input.offering.unitAmountMinor && promotion.taxBehavior === input.offering.taxBehavior &&
      promotion.billingInterval === input.offering.billingInterval && promotion.billingIntervalCount === input.offering.billingIntervalCount,
      "PROMOTION_COMMERCIAL_CONTEXT_INVALID", 409);
    const origin = trustedWebOrigin(this.env);
    const expiresAt=input.checkoutExpiresAt?Math.floor(Date.parse(input.checkoutExpiresAt)/1000):Math.floor(Date.now()/1000)+2100;
    assert(Number.isFinite(expiresAt) && expiresAt>Math.floor(Date.now()/1000)+1800 && expiresAt<=Math.floor(Date.now()/1000)+86400,"BILLING_SESSION_EXPIRED",409);
    let customerRef = input.customer?.customerRef;
    if (customerRef) {
      const customer = await client.customers.retrieve(customerRef);
      assert(!customer.deleted, "BILLING_CUSTOMER_REFERENCE_UNAVAILABLE", 409);
      this.mode(customer);
      const existing = await client.subscriptions.list({ customer: customerRef, status: "all", limit: 100 });
      existing.data.forEach(s => this.mode(s));
      assert(!existing.has_more && !existing.data.some(s => !["canceled", "incomplete_expired"].includes(s.status)), "BILLING_EXISTING_SUBSCRIPTION", 409);
    } else {
      const customer = await this.mutation(() => client.customers.create({ metadata: {
        nexus_operation: input.operationId, nexus_scope_digest: hash(JSON.stringify(input.scope)),
      } }, { idempotencyKey: stripeIdempotencyKey("customer", input.scope, input.idempotencyKey) }));
      this.mode(customer);
      customerRef = customer.id;
      await input.onCustomerCreated?.(customerRef);
    }
    if (promotion) {
      let coupon: Stripe.Coupon | undefined;
      try { coupon=await client.coupons.retrieve(couponId(promotion),{expand:["applies_to"]}); }
      catch(error) { if(!(error instanceof Stripe.errors.StripeInvalidRequestError && error.code==="resource_missing"))throw error; }
      coupon ??= await this.mutation(() => client.coupons.create({
        id: couponId(promotion), duration: "once", max_redemptions: 1, applies_to: { products: [input.offering.providerProductId!] },expand:["applies_to"],
        ...(promotion.discountType === "PERCENT" ? { percent_off: promotion.discountValue } : { amount_off: promotion.discountValue, currency: promotion.currency.toLowerCase() }),
        metadata: { nexus_reservation: promotion.reservationId, nexus_offering: promotion.offeringId },
      }, { idempotencyKey: stripeIdempotencyKey("coupon", input.scope, promotion.reservationId) }));
      this.mode(coupon);
      assert(coupon.valid && coupon.duration==="once" && coupon.max_redemptions===1 && coupon.times_redeemed===0 &&
        coupon.metadata?.nexus_reservation===promotion.reservationId && coupon.metadata.nexus_offering===promotion.offeringId &&
        coupon.applies_to?.products.length===1 && coupon.applies_to.products[0]===input.offering.providerProductId &&
        (promotion.discountType==="PERCENT" ? coupon.percent_off===promotion.discountValue && coupon.amount_off===null :
          coupon.amount_off===promotion.discountValue && coupon.percent_off===null && coupon.currency?.toUpperCase()===promotion.currency),
      "STRIPE_PROMOTION_COUPON_MISMATCH",409);
    }
    const metadata = { nexus_operation: input.operationId, nexus_offering: input.offering.id, ...(promotion ? { nexus_reservation: promotion.reservationId } : {}) };
    const session = await this.mutation(() => client.checkout.sessions.create({
      mode: "subscription", customer: customerRef,
      line_items: [{ price: input.offering.providerPriceId!, quantity: 1 }], client_reference_id: input.operationId, metadata,
      subscription_data: { metadata, billing_mode: { type: "flexible" } },
      success_url: `${origin}/billing/success`, cancel_url: `${origin}/billing/manage`,
      automatic_tax: { enabled: false }, managed_payments: {enabled:false}, adaptive_pricing: { enabled: false },
      integration_identifier: "nexus-hosted-checkout-" + hash(input.operationId).slice(0,8).replace(/[0-9]/g,n => String.fromCharCode(97 + Number(n))),
      expires_at: expiresAt,
      ...(promotion ? { discounts: [{ coupon: couponId(promotion) }] } : {allow_promotion_codes:false}),
    }, { idempotencyKey: stripeIdempotencyKey("checkout", input.scope, input.idempotencyKey) }));
    this.mode(session);
    assert(session.url && new URL(session.url).origin === "https://checkout.stripe.com", "STRIPE_CHECKOUT_URL_INVALID", 502);
    return { url: session.url, expiresAt: iso(session.expires_at), providerCheckoutRef: session.id, providerCustomerRef: customerRef };
  }
  override async createPortalSession(input: PortalRequest) {
    const client = this.client(), customer = await client.customers.retrieve(input.customer.customerRef);
    assert(!customer.deleted, "BILLING_CUSTOMER_REFERENCE_UNAVAILABLE", 409);
    this.mode(customer);
    assert(this.env.STRIPE_PORTAL_CONFIGURATION_ID, "STRIPE_PORTAL_NOT_CONFIGURED", 503);
    const config = await client.billingPortal.configurations.retrieve(this.env.STRIPE_PORTAL_CONFIGURATION_ID);
    this.mode(config);
    assert(config.active && !config.features.subscription_update.enabled &&
      (!config.features.subscription_cancel.enabled || config.features.subscription_cancel.mode === "at_period_end"), "STRIPE_PORTAL_POLICY_UNSAFE", 409);
    const session = await this.mutation(() => client.billingPortal.sessions.create({
      customer: customer.id, configuration: config.id, return_url: `${trustedWebOrigin(this.env)}/billing/manage`,
    }, { idempotencyKey: stripeIdempotencyKey("portal", input.scope, input.idempotencyKey) }));
    assert(new URL(session.url).origin === "https://billing.stripe.com", "STRIPE_PORTAL_URL_INVALID", 502);
    return { url: session.url };
  }
  private async current(input: ChangeSubscriptionRequest | CancelSubscriptionRequest) {
    const sub = await this.client().subscriptions.retrieve(input.subscription.subscriptionRef);
    this.mode(sub);
    assert(sub.items.data.length === 1 && !sub.items.has_more && sub.items.data[0]?.quantity === 1, "STRIPE_SUBSCRIPTION_SHAPE_UNSUPPORTED", 409);
    assert(["active", "trialing", "past_due"].includes(sub.status), "BILLING_SUBSCRIPTION_NOT_MUTABLE", 409);
    return sub;
  }
  override async changeSubscription(input: ChangeSubscriptionRequest) {
    const client = this.client();
    await this.validateOffering(input.offering);
    const sub = await this.current(input), item = sub.items.data[0]!;
    assert(input.currentOffering && this.matches(item.price, input.currentOffering), "BILLING_CURRENT_OFFERING_MISMATCH", 409);
    assert(!sub.cancel_at_period_end && !sub.pending_update && !sub.schedule && sub.status === "active", "BILLING_CHANGE_PENDING", 409);
    const upgrade = planRank(input.offering.planKey) > planRank(input.currentOffering.planKey);
    assert(input.offering.planKey !== input.currentOffering.planKey, "BILLING_PLAN_UNCHANGED", 409);
    assert(upgrade ? input.policy.effective === "IMMEDIATE" && input.policy.proration === "PROVIDER_CALCULATED" : input.policy.effective === "AT_PERIOD_END" && input.policy.proration === "NONE", "BILLING_CHANGE_POLICY_INVALID", 409);
    if (upgrade) {
      const updated = await this.mutation(() => client.subscriptions.update(sub.id, {
        items: [{ id: item.id, price: input.offering.providerPriceId!, quantity: 1 }], payment_behavior: "pending_if_incomplete", proration_behavior: "always_invoice",
      }, { idempotencyKey: stripeIdempotencyKey("change", input.scope, input.idempotencyKey) }));
      this.mode(updated);
    } else {
      const schedule = await this.mutation(() => client.subscriptionSchedules.create({ from_subscription: sub.id }, { idempotencyKey: stripeIdempotencyKey("schedule-create", input.scope, input.idempotencyKey) }));
      this.mode(schedule);
      const updated = await this.mutation(() => client.subscriptionSchedules.update(schedule.id, {
        end_behavior: "release", proration_behavior: "none", metadata: { nexus_managed: "true" },
        phases: [
          { start_date: schedule.current_phase!.start_date, end_date: item.current_period_end, items: [{ price: item.price.id, quantity: 1 }], proration_behavior: "none", discounts: sub.discounts.map(d => ({ discount: objectId(d)! })) },
          { start_date: item.current_period_end, duration: { interval: input.offering.billingInterval.toLowerCase() as "month" | "year", interval_count: input.offering.billingIntervalCount }, items: [{ price: input.offering.providerPriceId!, quantity: 1 }], proration_behavior: "none", discounts: [] },
        ],
      }, { idempotencyKey: stripeIdempotencyKey("schedule-update", input.scope, input.idempotencyKey) }), true);
      this.mode(updated);
    }
  }
  override async cancel(input: CancelSubscriptionRequest): Promise<{ scheduledAt: string | null }> {
    const client = this.client(), sub = await this.current(input);
    assert(input.policy === "AT_PERIOD_END", "BILLING_IMMEDIATE_CANCEL_UNAVAILABLE", 409);
    assert(!sub.pending_update, "BILLING_CHANGE_PENDING", 409);
    if (sub.schedule) {
      const schedule = await client.subscriptionSchedules.retrieve(objectId(sub.schedule)!);
      this.mode(schedule);
      assert(schedule.metadata?.nexus_managed === "true", "STRIPE_SCHEDULE_REVIEW_REQUIRED", 409);
      await this.mutation(() => client.subscriptionSchedules.release(schedule.id, {}, { idempotencyKey: stripeIdempotencyKey("schedule-release", input.scope, input.idempotencyKey) }));
    }
    const result = await this.mutation(() => client.subscriptions.update(sub.id, { cancel_at_period_end: true }, { idempotencyKey: stripeIdempotencyKey("cancel", input.scope, input.idempotencyKey) }),Boolean(sub.schedule));
    this.mode(result);
    return { scheduledAt: iso(result.items.data[0]!.current_period_end) };
  }
  override async verifyWebhook(body: Buffer, headers: Record<string,string>): Promise<ProviderSignal[]> {
    const client = this.client();
    assert(body.length <= 65536, "BILLING_EVENT_TOO_LARGE", 413);
    assert(this.env.STRIPE_WEBHOOK_SECRET, "STRIPE_WEBHOOK_NOT_CONFIGURED", 503);
    const signature = headers["Stripe-Signature"] ?? headers["stripe-signature"];
    assert(signature, "STRIPE_SIGNATURE_REQUIRED", 400);
    let event: Stripe.Event;
    try { event = client.webhooks.constructEvent(body, signature, this.env.STRIPE_WEBHOOK_SECRET); } catch { assert(false, "STRIPE_SIGNATURE_INVALID", 400); }
    this.mode(event);
    if (!stripeWebhookEvents.includes(event.type as typeof stripeWebhookEvents[number])) return [];
    if (event.type.startsWith("customer.subscription.")) {
      const sub = event.data.object as Stripe.Subscription;
      this.mode(sub);
      const customerRef = objectId(sub.customer)!;
      return [{ eventId: event.id, provider: "STRIPE", subscriptionRef: sub.id, customerRef, bindingEvidence: { kind: "CUSTOMER_SUBSCRIPTION", customerRef, subscriptionRef: sub.id } }];
    }
    if (event.type.startsWith("checkout.session.")) {
      const session = event.data.object as Stripe.Checkout.Session;
      this.mode(session);
      const subscriptionRef = objectId(session.subscription), customerRef = objectId(session.customer);
      if (session.mode !== "subscription" || !subscriptionRef || !customerRef) return [];
      const operation = session.client_reference_id;
      return [{ eventId: event.id, provider: "STRIPE", subscriptionRef, customerRef, checkoutRef: session.id,
        ...(/^[a-f0-9-]{36}$/.test(operation ?? "") ? { checkoutOperationId: operation! } : {}),
        bindingEvidence: { kind: "CHECKOUT_SUBSCRIPTION", checkoutRef: session.id, subscriptionRef, customerRef } }];
    }
    const invoice = event.data.object as Stripe.Invoice;
    this.mode(invoice);
    const subscriptionRef = objectId(invoice.parent?.subscription_details?.subscription), customerRef = objectId(invoice.customer);
    return subscriptionRef && customerRef ? [{ eventId: event.id, provider: "STRIPE", subscriptionRef, customerRef, bindingEvidence: { kind: "CUSTOMER_SUBSCRIPTION", subscriptionRef, customerRef } }] : [];
  }
  private offering(price: Stripe.Price, offerings: BillingOffering[]) {
    const matches = offerings.filter(o => this.matches(price, o));
    assert(matches.length === 1, "STRIPE_OFFERING_MAPPING_UNRESOLVED", 409);
    return matches[0]!;
  }
  private async snapshot(sub: Stripe.Subscription, request: ProviderReconcileRequest): Promise<NormalizedBillingEvent> {
    this.mode(sub);
    assert(!request.customer || objectId(sub.customer) === request.customer.customerRef, "BILLING_SCOPE_CONFLICT", 409);
    assert(sub.items.data.length === 1 && !sub.items.has_more && sub.items.data[0]?.quantity === 1, "STRIPE_SUBSCRIPTION_SHAPE_UNSUPPORTED", 409);
    const item = sub.items.data[0]!, offering = this.offering(item.price, request.offerings);
    let scheduledPlan: NormalizedBillingEvent["scheduledPlan"] = null, scheduledAt: string | null = null;
    let scheduledOfferingAssociation: NormalizedBillingEvent["scheduledOfferingAssociation"];
    if (sub.schedule) {
      const schedule = await this.client().subscriptionSchedules.retrieve(objectId(sub.schedule)!);
      this.mode(schedule);
      const phase = schedule.phases.find(p => p.start_date > item.current_period_start);
      if (phase) {
        assert(phase.items.length === 1 && phase.items[0]?.quantity === 1, "STRIPE_SCHEDULE_UNSUPPORTED", 409);
        const price = await this.client().prices.retrieve(objectId(phase.items[0]!.price)!);
        const scheduledOffering = this.offering(price, request.offerings);
        scheduledPlan = scheduledOffering.planKey;
        scheduledOfferingAssociation = {offeringId:scheduledOffering.id,fingerprint:offeringFingerprint(scheduledOffering)};
        scheduledAt = iso(phase.start_date);
      }
    }
    const snapshot: NormalizedBillingEvent = { eventId: "retrieval:" + sub.id, provider: "STRIPE", scope: request.scope, subscriptionRef: sub.id,
      plan: offering.planKey, planRevision: offering.planRevision, offeringAssociation: { offeringId: offering.id, fingerprint: offeringFingerprint(offering) },
      status: stripeSubscriptionState(sub.status, sub.cancel_at_period_end), periodEnd: iso(item.current_period_end), scheduledPlan, scheduledAt, scheduledOfferingAssociation,
      authoritative: true, ordering: "RECONCILE_LATEST", version: 0, occurredAt: new Date().toISOString() };
    if (sub.status === "canceled") snapshot.periodEnd = iso(sub.ended_at ?? Math.floor(Date.now()/1000));
    if (sub.status === "active" && !sub.trial_start && sub.latest_invoice && request.promotions?.length) {
      const invoice = await this.client().invoices.retrieve(objectId(sub.latest_invoice)!, { expand: ["discounts", "lines.data.discount_amounts.discount"] });
      this.mode(invoice);
      const context = request.promotions.find(p => p.offeringId === offering.id && sub.metadata.nexus_reservation === p.reservationId), line = invoice.lines.data[0], discount = invoice.discounts[0];
      if (context && invoice.status === "paid" && objectId(invoice.customer) === objectId(sub.customer) &&
        objectId(invoice.parent?.subscription_details?.subscription) === sub.id && invoice.currency.toUpperCase() === context.currency &&
        !invoice.lines.has_more && invoice.lines.data.length === 1 && line && line.pricing?.price_details?.price === offering.providerPriceId && line.quantity === 1 &&
        !line.parent?.subscription_item_details?.proration && line.amount === context.unitAmountMinor && invoice.discounts.length === 1 &&
        typeof discount === "object" && objectId(discount.source.coupon) === couponId(context) &&
        (line.discount_amounts ?? []).reduce((sum,d) => sum + d.amount, 0) === context.unitAmountMinor - context.finalPreTaxAmountMinor && invoice.total_excluding_tax === context.finalPreTaxAmountMinor) {
        const evidence = { ...context } as Partial<PromotionCheckoutContext>;
        delete evidence.campaignId;
        snapshot.commercialEvidence = { ...evidence, discountApplied: true } as NormalizedBillingEvent["commercialEvidence"];
      }
    }
    return snapshot;
  }
  override async reconcile(input: ProviderReconcileRequest): Promise<ProviderReconcileResult> {
    const client = this.client();
    if (input.target) {
      let sub: Stripe.Subscription;
      try { sub = await client.subscriptions.retrieve(input.target.subscriptionRef); }
      catch (error) {
        if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === "resource_missing") return { kind: "TARGET_ABSENT", subscriptionRef: input.target.subscriptionRef };
        return { kind: "INCOMPLETE", events: [], reason: "NETWORK_FAILURE" };
      }
      try { return {kind:"TARGET_FOUND",subscription:await this.snapshot(sub,input)}; }
      catch { return {kind:"INCOMPLETE",events:[],reason:"AMBIGUOUS"}; }
    }
    assert(input.customer, "BILLING_CUSTOMER_REFERENCE_UNAVAILABLE", 409);
    try {
      const events: NormalizedBillingEvent[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 100; page++) {
        const result = await client.subscriptions.list({ customer: input.customer.customerRef, status: "all", limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
        for (const sub of result.data) events.push(await this.snapshot(sub, input));
        if (!result.has_more) return { kind: "FULL_CENSUS", complete: true, events };
        const next = result.data.at(-1)?.id;
        if (!next || next === cursor) break;
        cursor = next;
      }
      return { kind: "INCOMPLETE", events: [], reason: "PARTIAL" };
    } catch { return { kind: "INCOMPLETE", events: [], reason: "NETWORK_FAILURE" }; }
  }
}
export function stripeSubscriptionState(
  status: string,
  cancelAtPeriodEnd = false,
): SubscriptionState {
  if (status === "trialing") return "TRIALING";
  if (status === "active")
    return cancelAtPeriodEnd ? "CANCEL_AT_PERIOD_END" : "ACTIVE";
  const states: Record<string, SubscriptionState> = {
    past_due: "PAST_DUE",
    paused: "SUSPENDED",
    unpaid: "SUSPENDED",
    incomplete: "INCOMPLETE",
    incomplete_expired: "EXPIRED",
    canceled: "CANCELED",
  };
  return states[status] ?? "UNKNOWN";
}
