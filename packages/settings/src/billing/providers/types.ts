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
export type ProviderEventOrdering = "MONOTONIC_VERSION" | "RECONCILE_LATEST";
export type CheckoutRequest = {
  scope: Scope;
  offeringId: string;
  offering: import("../offerings").BillingOffering;
  idempotencyKey: string;
  promotionReservationId?: string;
};
export type PortalRequest = { scope: Scope; idempotencyKey: string };
export type ProviderSignal = {
  eventId: string;
  provider: BillingProviderKind;
  scope: Scope;
  subscriptionRef: string;
};
export type ReconcileTarget = { subscriptionRef?: string; signalId?: string };
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
    ordering: z.enum(["MONOTONIC_VERSION", "RECONCILE_LATEST"]).optional(),
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
  readonly ordering: ProviderEventOrdering;
  createPortalSession(
    input: PortalRequest,
  ): Promise<{ url: string; expiresAt?: string }>;
  verifyWebhook(
    body: Buffer,
    headers: Record<string, string>,
  ): Promise<ProviderSignal[]>;
  createCheckout(
    input: CheckoutRequest,
  ): Promise<{ url: string; expiresAt?: string }>;
  previewPlanChange(
    scope: Scope,
    preview: PlanChangePreview,
  ): Promise<PlanChangePreview>;
  changeSubscription(input: {
    scope: Scope;
    offeringId: string;
    idempotencyKey: string;
  }): Promise<void>;
  cancel(
    scope: Scope,
    idempotencyKey: string,
  ): Promise<{ scheduledAt: string | null }>;
  reconcile(
    scope: Scope,
    target?: ReconcileTarget,
  ): Promise<NormalizedBillingEvent[]>;
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
    _input: PortalRequest,
  ): Promise<{ url: string; expiresAt?: string }> {
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
  ): Promise<{ url: string; expiresAt?: string }> {
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
    _scope: Scope,
    _idempotencyKey: string,
  ): Promise<{ scheduledAt: string | null }> {
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  async changeSubscription(_input: {
    scope: Scope;
    offeringId: string;
    idempotencyKey: string;
  }): Promise<void> {
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  async reconcile(_scope: Scope): Promise<NormalizedBillingEvent[]> {
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  async parseEvent(
    _body: Buffer,
    _headers: Record<string, string>,
  ): Promise<NormalizedBillingEvent[]> {
    assert(false, "BILLING_PROVIDER_NOT_CONFIGURED", 503);
  }
  async currentSubscription(
    _scope: Scope,
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
