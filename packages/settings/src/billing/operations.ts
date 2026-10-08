import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, tenant, type Database, type Tx } from "../../../db/src/index";
import { assert, isDomainError, type Scope } from "../../../shared/src/index";
import type { IdentityVault } from "../../../identity/src/index";
import { billingScopeLock, BillingService, billingAudit } from "./service";
import {
  checkoutOffering,
  billingOffering,
  offeringFingerprint,
  type BillingOffering,
} from "./offerings";
import {
  PromotionReservationService,
  reviewBaseOffering,
} from "./reservations";
import {
  promotionCheckoutContextSchema,
  type PromotionCheckoutContext,
} from "./policy";
import type {
  TrustedProviderCustomerReference,
  TrustedProviderSubscriptionReference,
  ChangeSubscriptionResult,
} from "./providers/types";
export type SessionOperation = {
  scope: Scope;
  provider: "STRIPE" | "DISCORD";
  operation: "CHECKOUT" | "PORTAL" | "CHANGE" | "CANCEL";
  idempotencyKey: string;
  offeringId?: string;
  promotionReservationId?: string;
  promotion?: PromotionCheckoutContext;
  customer?: TrustedProviderCustomerReference;
  subscription?: TrustedProviderSubscriptionReference;
  currentOffering?: BillingOffering;
  onCustomerCreated?: (customerRef: string) => Promise<void>;
  policy?: unknown;
  checkoutUi?: "HOSTED" | "ELEMENTS";
  principalActorHash?: string;
  /** Stripe adapters mark each write after their read-only provider preflight. */
  externalBoundary?: "ADAPTER";
  /** Trusted caller rechecks live owner/session/verification inside each claim transaction. */
  revalidate?: (tx: Tx) => Promise<void>;
};
export type BillingExecutionContext = {
  operationId: string;
  idempotencyKey: string;
  offering?: BillingOffering;
  promotion?: PromotionCheckoutContext;
  customer?: TrustedProviderCustomerReference;
  subscription?: TrustedProviderSubscriptionReference;
  currentOffering?: BillingOffering;
  checkoutExpiresAt?: string;
  onCustomerCreated?: (customerRef: string) => Promise<void>;
  beforeMutation: (phase?: string) => Promise<void>;
  afterMutation: (phase: string) => Promise<void>;
};
type SessionResult = (
  | { kind?: "HOSTED"; url: string; clientSecret?: never }
  | { kind: "ELEMENTS"; clientSecret: string; url?: never }
) & {
  expiresAt?: string;
  providerCheckoutRef?: string;
  providerCustomerRef?: string;
  cacheUntil?: string;
  operationId?: string;
  confirmationToken?: string;
};
// An adapter may only label a failure definitive when it knows no external mutation happened.
export class DefinitiveBillingFailure extends Error {
  constructor(
    readonly category: string,
    cause?: unknown,
  ) {
    super(category, { cause });
  }
}
const canonicalPromotion = (value: PromotionCheckoutContext | undefined) =>
  value ? promotionCheckoutContextSchema.parse(value) : null;
export class BillingOperationService {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
  ) {}
  async mutation<
    T extends { scheduledAt: string | null } | ChangeSubscriptionResult | void,
  >(
    input: SessionOperation & { operation: "CHANGE" | "CANCEL" },
    execute: (context: BillingExecutionContext) => Promise<T>,
  ): Promise<T> {
    // Same durable claim/reconciliation fence; ciphertext carries a normalized mutation result.
    const result = await this.session(input, async (context) => ({
      url: JSON.stringify({ result: (await execute(context)) ?? null }),
    }));
    assert(result.url, "BILLING_MUTATION_RESULT_INVALID", 502);
    return JSON.parse(result.url).result as T;
  }
  async session(
    input: SessionOperation,
    execute: (context: BillingExecutionContext) => Promise<SessionResult>,
  ) {
    z.uuid().parse(input.idempotencyKey);
    const s = input.scope,
      token = randomUUID();
    // Preserve alpha.6 request identity and provider idempotency key. Old payload digests are never rehashed.
    const request = this.vault.digest(
      "billing-operation:" + s.organizationId + ":" + s.guildId,
      input.idempotencyKey,
    );
    const claim = await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      await input.revalidate?.(tx);
      if (input.operation === "PORTAL") {
        const abandonment =
          await sql`SELECT id FROM billing_operations WHERE organization_id=${s.organizationId}::uuid AND provider='STRIPE' AND operation='CHECKOUT' AND abandon_started_at IS NOT NULL`.execute(
            tx,
          );
        assert(
          !abandonment.rows.length,
          "BILLING_ABANDONMENT_IN_PROGRESS",
          409,
        );
      }
      const previous = (
        await sql<{
          operation: string;
          provider: string;
          state: string;
          current_offering_id: string | null;
          promotion_context_ciphertext: string | null;
        }>`SELECT operation,provider,state,current_offering_id,promotion_context_ciphertext FROM billing_operations WHERE ${tenant(s)} AND request_digest=${request}`.execute(
          tx,
        )
      ).rows;
      assert(
        previous.every(
          (row) =>
            row.operation === input.operation &&
            row.provider === input.provider,
        ),
        "IDEMPOTENCY_CONFLICT",
        409,
      );
      const billing = new BillingService(tx, this.vault);
      let customer = input.customer
        ? await billing.customerReference(s, input.provider)
        : undefined;
      if (
        !customer &&
        input.operation === "CHECKOUT" &&
        input.provider === "STRIPE"
      ) {
        try {
          customer = await billing.customerReference(s, input.provider);
        } catch (error) {
          if (
            !isDomainError(error) ||
            error.code !== "BILLING_CUSTOMER_REFERENCE_UNAVAILABLE"
          )
            throw error;
        }
      }
      const subscription = input.subscription
        ? (await billing.subscriptionReferences(s, input.provider)).find(
            (row) => row.bindingId === input.subscription!.bindingId,
          )
        : undefined;
      assert(
        input.operation !== "PORTAL" || customer,
        "BILLING_CUSTOMER_REFERENCE_UNAVAILABLE",
        409,
      );
      assert(
        (input.operation !== "CHANGE" && input.operation !== "CANCEL") ||
          subscription,
        "BILLING_SUBSCRIPTION_REFERENCE_UNAVAILABLE",
        409,
      );
      assert(
        !input.customer ||
          (customer &&
            customer.bindingId === input.customer.bindingId &&
            customer.customerRef === input.customer.customerRef &&
            input.customer.provider === input.provider),
        "BILLING_SCOPE_CONFLICT",
        409,
      );
      assert(
        !input.subscription ||
          (subscription &&
            subscription.subscriptionRef ===
              input.subscription.subscriptionRef &&
            input.subscription.provider === input.provider),
        "BILLING_SCOPE_CONFLICT",
        409,
      );
      if (input.operation === "CANCEL")
        z.enum(["IMMEDIATE", "AT_PERIOD_END"]).parse(input.policy);
      if (input.operation === "CHANGE")
        z.object({
          effective: z.enum(["IMMEDIATE", "AT_PERIOD_END"]),
          proration: z.enum(["NONE", "PROVIDER_CALCULATED"]),
        })
          .strict()
          .parse(input.policy);
      const offering = input.offeringId
        ? await checkoutOffering(tx, input.offeringId)
        : undefined;
      const current = subscription
        ? (
            await sql<{
              offering_id: string | null;
            }>`SELECT offering_id FROM billing_subscriptions WHERE id=${subscription.bindingId}::uuid`.execute(
              tx,
            )
          ).rows[0]
        : undefined;
      const currentId =
        previous[0]?.current_offering_id ?? current?.offering_id;
      const currentOffering = currentId
        ? await billingOffering(tx, currentId)
        : undefined;
      assert(
        (input.operation !== "CHECKOUT" && input.operation !== "CHANGE") ||
          offering,
        "BILLING_OFFERING_REQUIRED",
        409,
      );
      assert(
        !offering || offering.provider === input.provider,
        "BILLING_PROVIDER_MISMATCH",
        409,
      );
      let promotion: PromotionCheckoutContext | undefined;
      const reservationId =
        input.promotionReservationId ?? input.promotion?.reservationId;
      const finalizedPromotion =
        reservationId &&
        (
          await sql<{
            state: string;
          }>`SELECT state FROM promotion_redemption_reservations WHERE id=${reservationId}::uuid AND ${tenant(s)}`.execute(
            tx,
          )
        ).rows[0]?.state === "FINALIZED";
      if (
        previous[0]?.state === "FINALIZED" &&
        finalizedPromotion &&
        previous[0]?.promotion_context_ciphertext
      )
        promotion = promotionCheckoutContextSchema.parse(
          JSON.parse(
            this.vault.open(s, previous[0].promotion_context_ciphertext),
          ),
        );
      else if (reservationId && offering)
        promotion = await new PromotionReservationService(
          this.db,
          this.vault,
        ).checkoutContext(s, reservationId, offering.id, tx);
      assert(
        !input.promotion ||
          JSON.stringify(canonicalPromotion(input.promotion)) ===
            JSON.stringify(canonicalPromotion(promotion)),
        "IDEMPOTENCY_CONFLICT",
        409,
      );
      const ownerBound =
        Boolean(input.principalActorHash) || input.checkoutUi === "ELEMENTS";
      const payload =
        (ownerBound ? "v3:" : "v2:") +
        this.vault.digest(
          ownerBound
            ? "billing-operation-payload:v3"
            : "billing-operation-payload:v2",
          JSON.stringify([
            input.provider,
            offering ? offeringFingerprint(offering) : null,
            canonicalPromotion(promotion),
            reservationId ?? null,
            input.customer ? customer : null,
            subscription ?? null,
            input.operation === "CHANGE" && currentOffering
              ? offeringFingerprint(currentOffering)
              : null,
            input.policy ?? null,
            ...(ownerBound
              ? [input.checkoutUi ?? "HOSTED", input.principalActorHash ?? null]
              : []),
          ]),
        );
      await sql`INSERT INTO billing_operations(id,organization_id,guild_id,provider,operation,request_digest,input_digest,offering_id,subscription_id,promotion_reservation_id,current_offering_id,promotion_context_ciphertext,retry_until,principal_actor_hash,checkout_ui) VALUES(${randomUUID()}::uuid,${s.organizationId}::uuid,${s.guildId},${input.provider},${input.operation},${request},${payload},${offering?.id ?? null}::uuid,${subscription?.bindingId ?? null}::uuid,${reservationId ?? null}::uuid,${currentOffering?.id ?? null}::uuid,${promotion ? this.vault.seal(s, JSON.stringify(promotion)) : null},now()+interval '23 hours',${input.principalActorHash ?? null},${input.checkoutUi ?? "HOSTED"}) ON CONFLICT(organization_id,guild_id,operation,request_digest) DO NOTHING`.execute(
        tx,
      );
      const row = (
        await sql<{
          id: string;
          input_digest: string;
          state: string;
          result_ciphertext: string | null;
          result_expires_at: Date | null;
          external_started_at: Date | null;
          retry_until: Date | null;
          checkout_expires_at: Date | null;
          checkout_abandoned_at: Date | null;
          abandon_started_at: Date | null;
          error_category: string | null;
        }>`SELECT * FROM billing_operations WHERE ${tenant(s)} AND operation=${input.operation} AND request_digest=${request} FOR UPDATE`.execute(
          tx,
        )
      ).rows[0]!;
      assert(row.input_digest === payload, "IDEMPOTENCY_CONFLICT", 409);
      assert(!row.checkout_abandoned_at, "BILLING_SESSION_EXPIRED", 409);
      assert(!row.abandon_started_at, "BILLING_RECONCILE_REQUIRED", 409);
      assert(
        row.error_category !== "BILLING_PENDING_UPDATE_EXPIRED",
        "BILLING_PENDING_UPDATE_EXPIRED",
        409,
      );
      if (
        row.state === "FINALIZED" ||
        (row.state === "RECONCILE_REQUIRED" &&
          row.result_ciphertext &&
          ["CHANGE", "CANCEL"].includes(input.operation))
      ) {
        assert(
          row.result_ciphertext &&
            row.result_expires_at &&
            row.result_expires_at > new Date(),
          "BILLING_SESSION_EXPIRED",
          409,
        );
        const cached = JSON.parse(
          this.vault.open(s, row.result_ciphertext),
        ) as SessionResult;
        return {
          id: row.id,
          cached: {
            ...cached,
            cacheUntil: row.result_expires_at.toISOString(),
          },
          offering,
          promotion,
          customer,
          subscription,
          currentOffering,
        };
      }
      assert(
        row.state !== "RECONCILE_REQUIRED" &&
          !(row.state === "PENDING" && row.external_started_at),
        "BILLING_RECONCILE_REQUIRED",
        409,
      );
      assert(
        !row.retry_until || row.retry_until > new Date(),
        "BILLING_RECONCILE_REQUIRED",
        409,
      );
      if (input.operation === "CHECKOUT")
        await new BillingService(tx, this.vault).assertNewCheckout(
          s,
          input.provider,
          row.id,
        );
      if (input.operation === "CHECKOUT" && input.provider === "STRIPE") {
        const other =
          await sql`SELECT c.id FROM billing_provider_customers c JOIN billing_accounts a ON a.id=c.account_id WHERE a.organization_id=${s.organizationId}::uuid AND c.provider='STRIPE' AND c.archived_at IS NULL AND c.reference_guild_id IS DISTINCT FROM ${s.guildId}`.execute(
            tx,
          );
        assert(!other.rows.length, "BILLING_SCOPE_CONFLICT", 409);
        const otherOperation =
          await sql`SELECT id FROM billing_operations WHERE organization_id=${s.organizationId}::uuid AND guild_id<>${s.guildId} AND provider='STRIPE' AND operation='CHECKOUT' AND (state='RECONCILE_REQUIRED' OR (state='PENDING' AND (external_started_at IS NOT NULL OR lease_until>clock_timestamp())) OR (state='FINALIZED' AND checkout_completed_at IS NULL AND checkout_abandoned_at IS NULL AND checkout_expires_at>now()))`.execute(
            tx,
          );
        assert(!otherOperation.rows.length, "BILLING_SCOPE_CONFLICT", 409);
      }
      if (
        subscription &&
        (input.operation === "CHANGE" || input.operation === "CANCEL")
      ) {
        // A fresh UUID cannot make an unknown external mutation safe to retry.
        // Pre-alpha.7 unknown mutations lack a binding ID and block this scoped provider conservatively.
        const unresolved =
          await sql`SELECT id FROM billing_operations WHERE ${tenant(s)} AND id<>${row.id}::uuid AND provider=${input.provider} AND operation IN ('CHANGE','CANCEL') AND (state='RECONCILE_REQUIRED' OR (state='PENDING' AND (external_started_at IS NOT NULL OR lease_until>clock_timestamp()))) AND (subscription_id=${subscription.bindingId}::uuid OR subscription_id IS NULL)`.execute(
            tx,
          );
        assert(!unresolved.rows.length, "BILLING_RECONCILE_REQUIRED", 409);
      }
      if (offering) {
        const raw = (
          await sql<
            Parameters<typeof reviewBaseOffering>[1]
          >`SELECT * FROM billing_offerings WHERE id=${offering.id}::uuid`.execute(
            tx,
          )
        ).rows[0]!;
        await reviewBaseOffering(tx, raw);
      }
      const claimed = await sql<{
        checkout_expires_at: Date | null;
      }>`UPDATE billing_operations SET state='PENDING',lease_token=${token}::uuid,lease_until=now()+interval '2 minutes',error_category=NULL,checkout_expires_at=CASE WHEN operation='CHECKOUT' AND provider='STRIPE' THEN now()+interval '35 minutes' ELSE checkout_expires_at END WHERE id=${row.id}::uuid AND (lease_until IS NULL OR lease_until<now()) RETURNING checkout_expires_at`.execute(
        tx,
      );
      assert(claimed.rows.length, "BILLING_OPERATION_BUSY", 409);
      if (input.operation === "CHECKOUT" && input.principalActorHash) {
        assert(
          /^[a-f0-9]{64}$/.test(input.principalActorHash),
          "BILLING_PRINCIPAL_INVALID",
          403,
        );
        let principal:
          | {
              actor_hash: string;
              authority_state: string;
              checkout_operation_id: string | null;
            }
          | undefined = (
          await sql<{
            actor_hash: string;
            authority_state: string;
            checkout_operation_id: string | null;
          }>`SELECT actor_hash,authority_state,checkout_operation_id FROM billing_authorizations WHERE organization_id=${s.organizationId}::uuid AND role='PRIMARY_BILLING_PRINCIPAL' AND revoked_at IS NULL FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        if (
          principal?.authority_state === "PROVISIONAL" &&
          principal.checkout_operation_id !== row.id &&
          !customer
        ) {
          const unstarted =
            await sql`SELECT id FROM billing_operations WHERE id=${principal.checkout_operation_id}::uuid AND external_started_at IS NULL AND (lease_until IS NULL OR lease_until<=now()) AND state IN ('PENDING','FAILED')`.execute(
              tx,
            );
          if (unstarted.rows.length) {
            await sql`UPDATE billing_authorizations SET revoked_at=now(),authority_state='RELEASED' WHERE organization_id=${s.organizationId}::uuid AND actor_hash=${principal.actor_hash} AND checkout_operation_id=${principal.checkout_operation_id}::uuid`.execute(
              tx,
            );
            principal = undefined;
          }
        }
        assert(
          !principal || principal.actor_hash === input.principalActorHash,
          "BILLING_OWNERSHIP_REVIEW",
          409,
        );
        // Unclaimed historical Customer bindings require operator review.
        assert(principal || !customer, "BILLING_OWNERSHIP_REVIEW", 409);
        if (!principal) {
          await sql`INSERT INTO billing_accounts(id,organization_id) VALUES(${randomUUID()}::uuid,${s.organizationId}::uuid) ON CONFLICT(organization_id) DO NOTHING`.execute(
            tx,
          );
          await sql`INSERT INTO billing_authorizations(organization_id,account_id,actor_hash,role,checkout_operation_id,authority_state) SELECT ${s.organizationId}::uuid,id,${input.principalActorHash},'PRIMARY_BILLING_PRINCIPAL',${row.id}::uuid,'PROVISIONAL' FROM billing_accounts WHERE organization_id=${s.organizationId}::uuid AND deleted_at IS NULL ON CONFLICT(organization_id,actor_hash) DO UPDATE SET role='PRIMARY_BILLING_PRINCIPAL',revoked_at=NULL,account_id=EXCLUDED.account_id,checkout_operation_id=EXCLUDED.checkout_operation_id,authority_state='PROVISIONAL'`.execute(
            tx,
          );
        }
      }
      await billingAudit(
        tx,
        s,
        input.principalActorHash ?? null,
        {
          CHECKOUT: "CHECKOUT_REQUESTED",
          CHANGE: "PLAN_CHANGE_REQUESTED",
          CANCEL: "CANCEL_REQUESTED",
          PORTAL: "PORTAL_REQUESTED",
        }[input.operation],
        { operationId: row.id, provider: input.provider },
      );
      return {
        id: row.id,
        cached: null,
        offering,
        promotion,
        customer,
        subscription,
        currentOffering,
        checkoutExpiresAt: claimed.rows[0]?.checkout_expires_at?.toISOString(),
      };
    });
    if (claim.cached) return claim.cached;
    const beforeMutation = async (phase = "PROVIDER") => {
      assert(
        /^[A-Z_]{1,50}$/.test(phase),
        "BILLING_EXTERNAL_PHASE_INVALID",
        500,
      );
      // Marker commits before the adapter can invoke Stripe. A stale process cannot cross this fence.
      await this.db.transaction().execute(async (tx) => {
        await billingScopeLock(tx, s);
        const current =
          await sql`SELECT id FROM billing_operations WHERE id=${claim.id}::uuid AND ${tenant(s)} AND state='PENDING' AND lease_token=${token}::uuid AND lease_until>clock_timestamp() FOR UPDATE`.execute(
            tx,
          );
        assert(current.rows.length, "BILLING_OPERATION_LEASE_EXPIRED", 409);
        await input.revalidate?.(tx);
        if (input.operation === "PORTAL") {
          const abandonment =
            await sql`SELECT id FROM billing_operations WHERE organization_id=${s.organizationId}::uuid AND provider='STRIPE' AND operation='CHECKOUT' AND abandon_started_at IS NOT NULL`.execute(
              tx,
            );
          assert(
            !abandonment.rows.length,
            "BILLING_ABANDONMENT_IN_PROGRESS",
            409,
          );
        }
        if (input.operation === "CHECKOUT")
          await new BillingService(tx, this.vault).assertNewCheckout(
            s,
            input.provider,
            claim.id,
          );
        const marked =
          await sql`UPDATE billing_operations SET external_started_at=COALESCE(external_started_at,clock_timestamp()),external_phase=${phase} WHERE id=${claim.id}::uuid AND state='PENDING' AND lease_token=${token}::uuid AND lease_until>clock_timestamp() RETURNING id`.execute(
            tx,
          );
        assert(marked.rows.length, "BILLING_OPERATION_LEASE_EXPIRED", 409);
        await sql`INSERT INTO billing_operation_external_steps(operation_id,phase,lease_token) VALUES(${claim.id}::uuid,${phase},${token}::uuid) ON CONFLICT(operation_id,phase) DO UPDATE SET lease_token=EXCLUDED.lease_token,started_at=now(),completed_at=NULL`.execute(
          tx,
        );
      });
    };
    const afterMutation = async (phase: string) => {
      await this.db.transaction().execute(async (tx) => {
        await billingScopeLock(tx, s);
        const saved =
          await sql`UPDATE billing_operation_external_steps p SET completed_at=clock_timestamp() FROM billing_operations o WHERE p.operation_id=o.id AND o.id=${claim.id}::uuid AND p.phase=${phase} AND p.lease_token=${token}::uuid AND o.lease_token=${token}::uuid AND o.state='PENDING' AND o.lease_until>clock_timestamp() RETURNING o.id`.execute(
            tx,
          );
        assert(saved.rows.length, "BILLING_OPERATION_LEASE_EXPIRED", 409);
      });
    };
    try {
      // Recheck after the durable claim and immediately before the provider call.
      if (input.revalidate)
        await this.db.transaction().execute(async (tx) => {
          await billingScopeLock(tx, s);
          await input.revalidate!(tx);
        });
      if (claim.promotion && claim.offering)
        await new PromotionReservationService(
          this.db,
          this.vault,
        ).checkoutContext(s, claim.promotion.reservationId, claim.offering.id);
      if (claim.promotion) {
        const valid =
          await sql`SELECT id FROM promotion_redemption_reservations WHERE ${tenant(s)} AND id=${claim.promotion.reservationId}::uuid AND state='PENDING' AND expires_at>now()+interval '37 minutes'`.execute(
            this.db,
          );
        assert(valid.rows.length, "PROMOTION_CHECKOUT_WINDOW_TOO_SHORT", 409);
      }
      // Legacy/non-Stripe executors treat invocation as the external boundary. Stripe opts into per-write hooks.
      if (input.externalBoundary !== "ADAPTER") await beforeMutation();
      const providerResult = await execute({
        operationId: claim.id,
        idempotencyKey: input.idempotencyKey,
        offering: claim.offering,
        promotion: claim.promotion,
        customer: claim.customer,
        subscription: claim.subscription,
        currentOffering: claim.currentOffering,
        checkoutExpiresAt: claim.checkoutExpiresAt,
        beforeMutation,
        afterMutation,
        onCustomerCreated: async (ref) => {
          await new BillingService(this.db, this.vault).bindCreatedCustomer(
            s,
            claim.id,
            ref,
            token,
          );
        },
      });
      const result = { ...providerResult, operationId: claim.id };
      assert(
        result.kind === "ELEMENTS"
          ? typeof result.clientSecret === "string" &&
              result.clientSecret.length > 0
          : typeof result.url === "string" && result.url.length > 0,
        "BILLING_SESSION_INVALID",
        409,
      );
      const checkout =
        input.operation === "CHECKOUT" && input.provider === "STRIPE";
      assert(
        !checkout ||
          (result.expiresAt && Number.isFinite(Date.parse(result.expiresAt))),
        "BILLING_SESSION_EXPIRY_REQUIRED",
        409,
      );
      assert(
        !checkout || result.providerCheckoutRef,
        "BILLING_CHECKOUT_REFERENCE_REQUIRED",
        409,
      );
      // Portal cache lifetime belongs to NEXUS. It never invents provider expiry.
      const cacheUntil = new Date(
        Math.min(
          checkout ? Infinity : Date.now() + 300000,
          checkout ? Date.parse(result.expiresAt!) : Infinity,
        ),
      );
      assert(cacheUntil.getTime() > Date.now(), "BILLING_SESSION_EXPIRED", 409);
      const saved = await this.db.transaction().execute(async (tx) => {
        await billingScopeLock(tx, s);
        await input.revalidate?.(tx);
        const saved =
          await sql`UPDATE billing_operations SET state=${["CHANGE", "CANCEL"].includes(input.operation) ? "RECONCILE_REQUIRED" : "FINALIZED"},result_ciphertext=${this.vault.seal(s, JSON.stringify(result))},result_expires_at=${cacheUntil},checkout_expires_at=${checkout ? result.expiresAt! : null}::timestamptz,provider_reference_digest=${result.providerCheckoutRef ? this.vault.digest("billing-checkout-reference:" + input.provider, result.providerCheckoutRef) : null},lease_token=NULL,lease_until=NULL,error_category=NULL WHERE id=${claim.id}::uuid AND lease_token=${token}::uuid AND lease_until>clock_timestamp() RETURNING id`.execute(
            tx,
          );
        if (saved.rows.length && checkout && result.providerCustomerRef)
          await new BillingService(tx, this.vault).bindCustomerReference(
            s,
            input.provider,
            {
              operationId: claim.id,
              checkoutRef: result.providerCheckoutRef!,
              customerRef: result.providerCustomerRef,
            },
            tx,
          );
        if (saved.rows.length)
          await billingAudit(
            tx,
            s,
            null,
            {
              CHECKOUT: "CHECKOUT_CREATED",
              CHANGE: "PLAN_CHANGE_ACCEPTED",
              CANCEL: "CANCEL_ACCEPTED",
              PORTAL: "PORTAL_CREATED",
            }[input.operation],
            { operationId: claim.id, provider: input.provider },
          );
        return saved;
      });
      assert(saved.rows.length, "BILLING_OPERATION_LEASE_EXPIRED", 409);
      return { ...result, cacheUntil: cacheUntil.toISOString() };
    } catch (error) {
      await this.db.transaction().execute(async (tx) => {
        await billingScopeLock(tx, s);
        const row = (
          await sql<{
            external_started_at: Date | null;
            completed: boolean;
          }>`SELECT o.external_started_at,EXISTS(SELECT 1 FROM billing_operation_external_steps p WHERE p.operation_id=o.id AND p.completed_at IS NOT NULL) AS completed FROM billing_operations o WHERE o.id=${claim.id}::uuid AND o.lease_token=${token}::uuid FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        if (!row) return;
        const definitive =
          !row.external_started_at ||
          (!row.completed && error instanceof DefinitiveBillingFailure);
        await sql`UPDATE billing_operations SET state=${definitive ? "FAILED" : "RECONCILE_REQUIRED"},error_category=${definitive ? "BILLING_DEFINITIVE_FAILURE" : "BILLING_OUTCOME_UNKNOWN"},external_started_at=CASE WHEN ${definitive} THEN NULL ELSE external_started_at END,checkout_expires_at=CASE WHEN ${definitive} AND operation='CHECKOUT' THEN NULL ELSE checkout_expires_at END,lease_token=NULL,lease_until=NULL WHERE id=${claim.id}::uuid AND lease_token=${token}::uuid`.execute(
          tx,
        );
        if (definitive && input.principalActorHash)
          await sql`UPDATE billing_authorizations SET revoked_at=now(),authority_state='RELEASED' WHERE organization_id=${s.organizationId}::uuid AND checkout_operation_id=${claim.id}::uuid AND role='PRIMARY_BILLING_PRINCIPAL' AND authority_state='PROVISIONAL'`.execute(
            tx,
          );
      });
      // Preserve the public DomainError code/status from read-only preflight.
      throw error instanceof DefinitiveBillingFailure && error.cause
        ? error.cause
        : error;
    }
  }
}
