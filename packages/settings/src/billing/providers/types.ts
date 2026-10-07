import { z } from "zod";
import { assert, type Scope } from "../../../../shared/src/index";
import { plans } from "../../plan-registry";
import {
  providers,
  subscriptionStates,
  type BillingProviderKind,
  type EntitlementSubscription,
  type PlanChangePreview,
} from "../domain";
import type { Plan } from "../../plan-registry";
import {
  commercialDiscountEvidenceSchema,
  type PromotionCheckoutContext,
} from "../policy";
import type { BillingOffering } from "../offerings";
export type ProviderEventOrdering = "MONOTONIC_VERSION" | "RECONCILE_LATEST";
export type CheckoutRequest = {
  scope: Scope;
  operationId: string;
  offeringId: string;
  offering: import("../offerings").BillingOffering;
  idempotencyKey: string;
  /** Core-owned fixed expiry, stable across retries of one Checkout operation. */
  checkoutExpiresAt?: string;
  customer?: TrustedProviderCustomerReference;
  promotion?: PromotionCheckoutContext;
  /** Core persists an SDK-created Customer before the next external mutation. */
  onCustomerCreated?: (customerRef: string) => Promise<void>;
  ui?: "HOSTED" | "ELEMENTS";
  confirmationToken?: string;
  beforeMutation?: () => Promise<void>;
};
export type TrustedProviderCustomerReference = {
  provider: BillingProviderKind;
  bindingId: string;
  customerRef: string;
};
export type TrustedProviderSubscriptionReference = {
  provider: BillingProviderKind;
  bindingId: string;
  subscriptionRef: string;
};
export type PortalRequest = {
  scope: Scope;
  customer: TrustedProviderCustomerReference;
  idempotencyKey: string;
};
export type CheckoutSessionResult = (
  | {
      kind?: "HOSTED";
      url: string;
      clientSecret?: never;
    }
  | {
      kind: "ELEMENTS";
      clientSecret: string;
      url?: never;
    }
) & {
  expiresAt: string;
  providerCheckoutRef: string;
  /** Present only when the authoritative Customer is already known at session creation. */
  providerCustomerRef?: string;
};
// Discord's native store URL is not an expiring Checkout Session.
export type NativeCheckoutResult = {
  url: string;
  expiresAt?: never;
  providerCheckoutRef?: never;
};
export type PortalSessionResult = { url: string; cacheUntil?: string };
export type ChangeSubscriptionResult =
  | { state: "CONFIRMING" }
  | { state: "PAYMENT_ACTION_REQUIRED"; paymentUrl: string };
export type ChangeSubscriptionRequest = {
  scope: Scope;
  subscription: TrustedProviderSubscriptionReference;
  offering: BillingOffering;
  /** Core-resolved current identity; optional only for legacy adapters. */
  currentOffering?: BillingOffering;
  idempotencyKey: string;
  policy: {
    effective: "IMMEDIATE" | "AT_PERIOD_END";
    proration: "NONE" | "PROVIDER_CALCULATED";
  };
};
export type CancelSubscriptionRequest = {
  scope: Scope;
  subscription: TrustedProviderSubscriptionReference;
  policy: "IMMEDIATE" | "AT_PERIOD_END";
  idempotencyKey: string;
};
export type ProviderSignal = {
  eventId: string;
  provider: BillingProviderKind;
  /** Untrusted metadata claim; Core must resolve ownership from a stored binding. */
  scope?: Scope;
  subscriptionRef: string;
  customerRef?: string;
  checkoutOperationId?: string;
  checkoutRef?: string;
  /** Verified provider object relationship, never copied from metadata. */
  bindingEvidence?:
    | {
        kind: "CUSTOMER_SUBSCRIPTION";
        customerRef: string;
        subscriptionRef: string;
      }
    | {
        kind: "CHECKOUT_SUBSCRIPTION";
        checkoutRef: string;
        subscriptionRef: string;
        customerRef?: string;
      };
};
export type ReconcileTarget = { subscriptionRef?: string; signalId?: string };
export type ProviderReconcileRequest = {
  scope: Scope;
  customer?: TrustedProviderCustomerReference;
  subscriptions: TrustedProviderSubscriptionReference[];
  offerings: BillingOffering[];
  target?: TrustedProviderSubscriptionReference;
  promotions?: PromotionCheckoutContext[];
};
export type ProviderReconcileResult =
  | { kind: "TARGET_FOUND"; subscription: NormalizedBillingEvent }
  | { kind: "TARGET_ABSENT"; subscriptionRef: string }
  | { kind: "FULL_CENSUS"; complete: true; events: NormalizedBillingEvent[] }
  | {
      kind: "INCOMPLETE";
      events: NormalizedBillingEvent[];
      reason: "NETWORK_FAILURE" | "PARTIAL" | "AMBIGUOUS";
    };
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
    // Alpha.5 snapshots omit this; Core canonically projects those as revision 2.
    planRevision: z.number().int().positive().optional(),
    offeringAssociation: z
      .object({
        offeringId: z.uuid(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
    scheduledOfferingAssociation: z
      .object({
        offeringId: z.uuid(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
    status: z.enum(subscriptionStates),
    occurredAt: providerTime,
    ordering: z.enum(["MONOTONIC_VERSION", "RECONCILE_LATEST"]).optional(),
    version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    periodEnd: providerTime.nullable(),
    scheduledPlan: z.enum(plans).nullable().default(null),
    scheduledAt: providerTime.nullable().default(null),
    authoritative: z.boolean(),
    // Only an authoritative retrieval may affirm absence of a pending update.
    pendingUpdate: z.boolean().optional(),
    commercialEvidence: commercialDiscountEvidenceSchema.optional(),
  })
  .strict();
export type NormalizedBillingEvent = z.infer<
  typeof normalizedBillingEventSchema
>;
export const providerReconcileResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("TARGET_FOUND"),
      subscription: normalizedBillingEventSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("TARGET_ABSENT"),
      subscriptionRef: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal("FULL_CENSUS"),
      complete: z.literal(true),
      events: z.array(normalizedBillingEventSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal("INCOMPLETE"),
      events: z.array(normalizedBillingEventSchema),
      reason: z.enum(["NETWORK_FAILURE", "PARTIAL", "AMBIGUOUS"]),
    })
    .strict(),
]);
export interface BillingProvider {
  readonly kind: BillingProviderKind;
  readonly ordering: ProviderEventOrdering;
  createPortalSession(input: PortalRequest): Promise<PortalSessionResult>;
  verifyWebhook(
    body: Buffer,
    headers: Record<string, string>,
  ): Promise<ProviderSignal[]>;
  createCheckout(
    input: CheckoutRequest,
  ): Promise<CheckoutSessionResult | NativeCheckoutResult>;
  previewPlanChange(
    scope: Scope,
    preview: PlanChangePreview,
  ): Promise<PlanChangePreview>;
  changeSubscription(
    input: ChangeSubscriptionRequest,
  ): Promise<ChangeSubscriptionResult | void>;
  pendingPayment(input: {
    subscription: TrustedProviderSubscriptionReference;
  }): Promise<ChangeSubscriptionResult>;
  cancel(
    input: CancelSubscriptionRequest,
  ): Promise<{ scheduledAt: string | null }>;
  reconcile(input: ProviderReconcileRequest): Promise<ProviderReconcileResult>;
  parseEvent(
    body: Buffer,
    headers: Record<string, string>,
  ): Promise<NormalizedBillingEvent[]>;
  currentSubscription(
    input: TrustedProviderSubscriptionReference,
  ): Promise<EntitlementSubscription | null>;
}
export class UnconfiguredBillingProvider implements BillingProvider {
  readonly kind: BillingProviderKind;
  constructor(
    readonly name:
      BillingProviderKind | "stripe" | "discord-premium-apps" = "STRIPE",
  ) {
    this.kind =
      name === "discord-premium-apps"
        ? "DISCORD"
        : name === "stripe"
          ? "STRIPE"
          : name;
  }
  get ordering(): ProviderEventOrdering {
    return this.kind === "STRIPE" ? "RECONCILE_LATEST" : "MONOTONIC_VERSION";
  }
  async createPortalSession(
    _input: PortalRequest | { scope: Scope; idempotencyKey: string },
  ): Promise<PortalSessionResult> {
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  async verifyWebhook(
    _body: Buffer,
    _headers: Record<string, string>,
  ): Promise<ProviderSignal[]> {
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  async createCheckout(
    _input: CheckoutRequest | Scope,
    _plan?: Plan,
    _idempotencyKey?: string,
  ): Promise<CheckoutSessionResult | NativeCheckoutResult> {
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  async previewPlanChange(
    _scope: Scope,
    preview: PlanChangePreview,
  ): Promise<PlanChangePreview> {
    void preview;
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  async cancel(
    _input: CancelSubscriptionRequest | Scope,
    _idempotencyKey?: string,
  ): Promise<{ scheduledAt: string | null }> {
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  async changeSubscription(
    _input:
      | ChangeSubscriptionRequest
      | { scope: Scope; offeringId: string; idempotencyKey: string },
  ): Promise<ChangeSubscriptionResult | void> {
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  async pendingPayment(_input: {
    subscription: TrustedProviderSubscriptionReference;
  }): Promise<ChangeSubscriptionResult> {
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  async reconcile(
    _input: ProviderReconcileRequest | Scope,
    _legacyTarget?: ReconcileTarget,
  ): Promise<ProviderReconcileResult> {
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  async parseEvent(
    _body: Buffer,
    _headers: Record<string, string>,
  ): Promise<NormalizedBillingEvent[]> {
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  async currentSubscription(
    _input: TrustedProviderSubscriptionReference | Scope,
  ): Promise<EntitlementSubscription | null> {
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  // Compatibility names for alpha.5 callers; still fail closed.
  async getSubscription(scope: Scope) {
    return this.currentSubscription(scope);
  }
  async cancelSubscription(scope: Scope, idempotencyKey: string) {
    await this.cancel(scope, idempotencyKey);
  }
  async verifyEntitlement(scope: Scope) {
    return this.currentSubscription(scope);
  }
}
