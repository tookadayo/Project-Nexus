import { randomUUID } from "node:crypto";
import {
  sql,
  tenant,
  json,
  privacyReadLock,
  type Database,
  type Tx,
} from "../../../db/src/index";
import { assert, type Scope } from "../../../shared/src/index";
import { errorReference, logFailure } from "../../../shared/src/diagnostics";
import type { IdentityVault } from "../../../identity/src/index";
import { EntitlementService } from "./entitlements";
import { billingViewModel } from "./view";
import { BillingOperationService } from "./operations";
import { PromotionReservationService } from "./reservations";
import { commercialLaunch, paidPlanReady } from "./commerce";
import { billingOffering, offeringFingerprint } from "./offerings";
import {
  planRegistry,
  planRank,
  type Plan,
  type EntitlementFeature,
} from "../plan-registry";
import { planChangePreview, type BillingProviderKind } from "./domain";
import {
  normalizedBillingEventSchema,
  providerReconcileResultSchema,
  type BillingProvider,
  type NormalizedBillingEvent,
  type ProviderSignal,
  type ProviderReconcileRequest,
  type ProviderReconcileResult,
  type TrustedProviderCustomerReference,
  type TrustedProviderSubscriptionReference,
  type ChangeSubscriptionRequest,
  type CancelSubscriptionRequest,
} from "./providers/types";
type StoredEvent = Omit<
  NormalizedBillingEvent,
  "eventId" | "subscriptionRef"
> & {
  eventDigest: string;
  referenceDigest: string;
  referenceCiphertext: string;
};
export async function billingAudit(
  tx: Tx,
  scope: Scope | null,
  actor: string | null,
  action: string,
  metadata: Record<string, unknown> = {},
) {
  // Callers pass allowlisted categories/counts/internal UUIDs, never payment identifiers or codes.
  await sql`INSERT INTO billing_audit_log(id,organization_id,guild_id,actor_hash,action,metadata) VALUES(${randomUUID()}::uuid,${scope?.organizationId ?? null}::uuid,${scope?.guildId ?? null},${actor},${action},${json(metadata)})`.execute(
    tx,
  );
}
export async function billingScopeLock(tx: Tx, scope: Scope) {
  await privacyReadLock(tx, scope);
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"billing-org:" + scope.organizationId},0))`.execute(tx);
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"billing:" + scope.organizationId + ":" + scope.guildId},0))`.execute(
    tx,
  );
  assert(
    !(
      await sql`SELECT id FROM deletion_requests WHERE ${tenant(scope)} AND lookup_hash IS NULL AND completed_at IS NOT NULL`.execute(
        tx,
      )
    ).rows.length,
    "PRIVACY_DELETED",
    403,
  );
}
export class BillingService {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
  ) {}
  async customerReference(
    s: Scope,
    provider: BillingProviderKind,
  ): Promise<TrustedProviderCustomerReference> {
    const row = (
      await sql<{
        id: string;
        reference_ciphertext: string;
      }>`SELECT c.id,c.reference_ciphertext FROM billing_provider_customers c JOIN billing_accounts a ON a.id=c.account_id WHERE a.organization_id=${s.organizationId}::uuid AND a.deleted_at IS NULL AND c.archived_at IS NULL AND c.provider=${provider} AND c.reference_guild_id=${s.guildId}`.execute(
        this.db,
      )
    ).rows[0];
    assert(row, "BILLING_CUSTOMER_REFERENCE_UNAVAILABLE", 409);
    return {
      provider,
      bindingId: row.id,
      customerRef: this.vault.open(s, row.reference_ciphertext),
    };
  }
  /** Core writes only a Customer relationship confirmed by a bound Checkout result or verified provider object. */
  async bindCustomerReference(
    s: Scope,
    provider: BillingProviderKind,
    evidence: { operationId: string; checkoutRef: string; customerRef: string },
    transaction?: Tx,
  ): Promise<TrustedProviderCustomerReference> {
    assert(
      provider === "STRIPE" &&
        evidence.customerRef.length > 0 &&
        evidence.customerRef.length <= 200 &&
        evidence.checkoutRef.length > 0 &&
        evidence.checkoutRef.length <= 200,
      "BILLING_CUSTOMER_BINDING_INVALID",
      409,
    );
    const bind = async (tx: Tx) => {
      await billingScopeLock(tx, s);
      const checkoutDigest = this.vault.digest(
        "billing-checkout-reference:" + provider,
        evidence.checkoutRef,
      );
      const operation = (
        await sql`SELECT id FROM billing_operations WHERE ${tenant(s)} AND id=${evidence.operationId}::uuid AND provider=${provider} AND operation='CHECKOUT' AND state='FINALIZED' AND provider_reference_digest=${checkoutDigest} AND external_started_at IS NOT NULL`.execute(
          tx,
        )
      ).rows[0];
      assert(operation, "BILLING_CUSTOMER_BINDING_UNVERIFIED", 409);
      return this.persistCustomerReference(
        tx,
        s,
        provider,
        evidence.customerRef,
      );
    };
    return transaction
      ? bind(transaction)
      : this.db.transaction().execute(bind);
  }
  async bindCreatedCustomer(
    s: Scope,
    operationId: string,
    customerRef: string,
    leaseToken: string,
  ) {
    return this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      const operation =
        await sql`SELECT id FROM billing_operations WHERE ${tenant(s)} AND id=${operationId}::uuid AND provider='STRIPE' AND operation='CHECKOUT' AND state='PENDING' AND external_started_at IS NOT NULL AND lease_token=${leaseToken}::uuid AND lease_until>clock_timestamp()`.execute(
          tx,
        );
      assert(operation.rows.length, "BILLING_CUSTOMER_BINDING_UNVERIFIED", 409);
      return this.persistCustomerReference(tx, s, "STRIPE", customerRef);
    });
  }
  private async persistCustomerReference(
    tx: Tx,
    s: Scope,
    provider: BillingProviderKind,
    customerRef: string,
  ): Promise<TrustedProviderCustomerReference> {
    assert(
      customerRef.length > 0 && customerRef.length <= 200,
      "BILLING_CUSTOMER_BINDING_INVALID",
      409,
    );
    const digest = this.vault.digest(
      "billing-customer-reference:" + provider,
      customerRef,
    );
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"billing-customer:" + provider + ":" + digest},0))`.execute(
      tx,
    );
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"billing-account:" + s.organizationId},0))`.execute(
      tx,
    );
    await sql`INSERT INTO billing_accounts(id,organization_id) VALUES(${randomUUID()}::uuid,${s.organizationId}::uuid) ON CONFLICT(organization_id) DO NOTHING`.execute(
      tx,
    );
    const account = (
      await sql<{
        id: string;
      }>`SELECT id FROM billing_accounts WHERE organization_id=${s.organizationId}::uuid AND deleted_at IS NULL FOR UPDATE`.execute(
        tx,
      )
    ).rows[0];
    assert(account, "BILLING_ACCOUNT_UNAVAILABLE", 409);
    const existing = (
      await sql<{
        id: string;
        account_id: string;
        reference_digest: string;
        reference_guild_id: string | null;
        archived_at: Date | null;
      }>`SELECT id,account_id,reference_digest,reference_guild_id,archived_at FROM billing_provider_customers WHERE provider=${provider} AND (reference_digest=${digest} OR (account_id=${account.id}::uuid AND archived_at IS NULL)) FOR UPDATE`.execute(
        tx,
      )
    ).rows;
    assert(
      existing.every(
        (row) =>
          row.account_id === account.id &&
          !row.archived_at &&
          row.reference_digest === digest &&
          row.reference_guild_id === s.guildId,
      ),
      "BILLING_SCOPE_CONFLICT",
      409,
    );
    const id = existing[0]?.id ?? randomUUID();
    if (!existing.length)
      await sql`INSERT INTO billing_provider_customers(id,account_id,provider,reference_digest,reference_ciphertext,reference_guild_id) VALUES(${id}::uuid,${account.id}::uuid,${provider},${digest},${this.vault.seal(s, customerRef)},${s.guildId})`.execute(
        tx,
      );
    return { provider, bindingId: id, customerRef };
  }
  async subscriptionReferences(
    s: Scope,
    provider: BillingProviderKind,
  ): Promise<TrustedProviderSubscriptionReference[]> {
    const rows = (
      await sql<{
        id: string;
        reference_ciphertext: string | null;
      }>`SELECT b.id,b.reference_ciphertext FROM billing_subscriptions b JOIN billing_subscription_assignments a ON a.subscription_id=b.id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND b.provider=${provider}`.execute(
        this.db,
      )
    ).rows;
    return rows.map((row) => {
      assert(
        row.reference_ciphertext,
        "BILLING_SUBSCRIPTION_REFERENCE_UNAVAILABLE",
        409,
      );
      return {
        provider,
        bindingId: row.id,
        subscriptionRef: this.vault.open(s, row.reference_ciphertext),
      };
    });
  }
  async subscriptionReference(s: Scope, provider: BillingProviderKind) {
    const references = await this.subscriptionReferences(s, provider);
    const mutable = (
      await sql<{
        id: string;
      }>`SELECT b.id FROM billing_subscriptions b JOIN billing_subscription_assignments a ON a.subscription_id=b.id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND b.provider=${provider} AND b.status NOT IN ('CANCELED','EXPIRED')`.execute(
        this.db,
      )
    ).rows;
    const current = references.filter((ref) =>
      mutable.some((row) => row.id === ref.bindingId),
    );
    assert(
      current.length === 1,
      "BILLING_SUBSCRIPTION_REFERENCE_AMBIGUOUS",
      409,
    );
    return current[0]!;
  }
  async assertNewCheckout(s: Scope, provider: BillingProviderKind, currentOperationId?:string) {
    const state = await new EntitlementService(this.db).effective(s);
    assert(!state.privacyDeleted,"PRIVACY_DELETED",403);
    assert(!state.conflict,"BILLING_CONFLICT",409);
    assert(
      !state.grants.some((grant) =>
        grant.id.startsWith("organization-license:"),
      ),
      "BILLING_ORGANIZATION_LICENSE_EXISTS",
      409,
    );
    const paid = state.subscriptions.filter(
      (row) =>
        row.plan !== "FREE" &&
        row.status !== "EXPIRED" &&
        row.status !== "CANCELED",
    );
    assert(
      !paid.some((row) => row.provider === provider),
      "BILLING_EXISTING_SUBSCRIPTION",
      409,
    );
    assert(!paid.length, "BILLING_PROVIDER_MIGRATION_REQUIRED", 409);
    const unknown =
      await sql`SELECT id FROM billing_operations WHERE ${tenant(s)} AND id IS DISTINCT FROM ${currentOperationId ?? null}::uuid AND operation IN ('CHECKOUT','CHANGE','CANCEL') AND (state='RECONCILE_REQUIRED' OR (state='PENDING' AND (external_started_at IS NOT NULL OR lease_until>now())))`.execute(
        this.db,
      );
    assert(!unknown.rows.length, "BILLING_RECONCILE_REQUIRED", 409);
    const open =
      await sql`SELECT id FROM billing_operations WHERE ${tenant(s)} AND id IS DISTINCT FROM ${currentOperationId ?? null}::uuid AND operation='CHECKOUT' AND state='FINALIZED' AND checkout_completed_at IS NULL AND checkout_abandoned_at IS NULL AND checkout_expires_at>now()`.execute(
        this.db,
      );
    assert(!open.rows.length, "BILLING_CHECKOUT_IN_PROGRESS", 409);
  }
  async changeSubscription(
    s: Scope,
    provider: BillingProvider,
    offeringId: string,
    idempotencyKey: string,
    policy: ChangeSubscriptionRequest["policy"],
    revalidate?: (tx: Tx) => Promise<void>,
  ) {
    assert(
      provider.kind === "STRIPE" || provider.kind === "DISCORD",
      "BILLING_PROVIDER_MISMATCH",
      409,
    );
    const subscription = await this.subscriptionReference(s, provider.kind);
    return new BillingOperationService(this.db, this.vault).mutation(
      {
        scope: s,
        provider: provider.kind,
        operation: "CHANGE",
        revalidate,
        offeringId,
        idempotencyKey,
        subscription,
        policy,
        externalBoundary: provider.durableExternalBoundary ? "ADAPTER" : undefined,
      },
      async (context) => {
        assert(context.offering, "BILLING_OFFERING_REQUIRED", 409);
        return provider.changeSubscription({
          scope: s,
          subscription,
          offering: context.offering,
          currentOffering: context.currentOffering,
          idempotencyKey: context.idempotencyKey,
          policy,
          beforeMutation: context.beforeMutation,
          afterMutation: context.afterMutation,
        });
      },
    );
  }
  async cancelSubscription(
    s: Scope,
    provider: BillingProvider,
    idempotencyKey: string,
    policy: CancelSubscriptionRequest["policy"],
    revalidate?: (tx: Tx) => Promise<void>,
  ) {
    assert(
      provider.kind === "STRIPE" || provider.kind === "DISCORD",
      "BILLING_PROVIDER_MISMATCH",
      409,
    );
    const subscription = await this.subscriptionReference(s, provider.kind);
    return new BillingOperationService(this.db, this.vault).mutation(
      {
        scope: s,
        provider: provider.kind,
        operation: "CANCEL",
        idempotencyKey,
        subscription,
        policy,
        revalidate,
        externalBoundary: provider.durableExternalBoundary ? "ADAPTER" : undefined,
      },
      (context) =>
        provider.cancel({
          scope: s,
          subscription,
          idempotencyKey: context.idempotencyKey,
          policy,
          beforeMutation: context.beforeMutation,
          afterMutation: context.afterMutation,
        }),
    );
  }
  async pendingPayment(s: Scope, provider: BillingProvider) {
    const subscription = await this.subscriptionReference(s, provider.kind);
    return provider.pendingPayment({ subscription });
  }
  async receive(
    provider: BillingProvider,
    body: Buffer,
    headers: Record<string, string>,
  ) {
    assert(body.length <= 65536, "BILLING_EVENT_TOO_LARGE", 413);
    // Only the provider adapter's verified parser may cross the HTTP inbox boundary.
    if (provider.ordering === "RECONCILE_LATEST") {
      const signals = await provider.verifyWebhook(body, headers);
      for (const signal of signals) {
        assert(signal.provider === provider.kind, "BILLING_PROVIDER_MISMATCH");
        await this.storeSignal(signal);
      }
      return { accepted: signals.length };
    }
    const events = await provider.parseEvent(body, headers);
    for (const event of events) {
      assert(event.provider === provider.kind, "BILLING_PROVIDER_MISMATCH");
      await this.storeVerified(event);
    }
    return { accepted: events.length };
  }
  async storeVerified(input: NormalizedBillingEvent) {
    assert(
      input.provider !== "STRIPE" && input.provider !== "EXTERNAL_LEGACY",
      "BILLING_SNAPSHOT_RECONCILIATION_REQUIRED",
      403,
    );
    return this.persistSnapshot(input);
  }
  private async persistSnapshot(
    input: NormalizedBillingEvent,
    transaction?: Tx,
  ) {
    const event = normalizedBillingEventSchema.parse({
      ...input,
      planRevision: input.planRevision ?? 2,
    });
    assert(event.authoritative, "BILLING_EVENT_UNVERIFIED", 403);
    assert(
      new Date(event.occurredAt).getTime() <= Date.now() + 300000,
      "BILLING_EVENT_CLOCK_INVALID",
    );
    const { eventId, subscriptionRef, ...safe } = event;
    const stored: StoredEvent = {
      ...safe,
      eventDigest: this.vault.digest(
        "billing-event:" + event.provider,
        eventId,
      ),
      referenceDigest: this.vault.digest(
        "billing-reference:" + event.provider,
        subscriptionRef,
      ),
      referenceCiphertext: this.vault.seal(event.scope, subscriptionRef),
    };
    const persist = async (tx: Tx) => {
      await billingScopeLock(tx, event.scope);
      const offeringId =
        event.offeringAssociation?.offeringId ??
        event.commercialEvidence?.offeringId;
      if (offeringId) {
        const offering = await billingOffering(tx, offeringId);
        assert(
          offering.provider === event.provider &&
            offering.planKey === event.plan &&
            offering.planRevision === event.planRevision &&
            (!event.offeringAssociation ||
              offeringFingerprint(offering) ===
                event.offeringAssociation.fingerprint),
          "BILLING_OFFERING_ASSOCIATION_INVALID",
          409,
        );
      }
      if (event.scheduledOfferingAssociation) {
        const scheduled = await billingOffering(
          tx,
          event.scheduledOfferingAssociation.offeringId,
        );
        assert(
          scheduled.provider === event.provider &&
            scheduled.planKey === event.scheduledPlan &&
            offeringFingerprint(scheduled) ===
              event.scheduledOfferingAssociation.fingerprint,
          "BILLING_OFFERING_ASSOCIATION_INVALID",
          409,
        );
      }
      const ownership = (
        await sql<{
          organization_id: string;
          guild_id: string;
        }>`SELECT a.organization_id,a.guild_id FROM billing_subscriptions b JOIN billing_subscription_assignments a ON a.subscription_id=b.id WHERE b.provider=${event.provider} AND b.reference_digest=${stored.referenceDigest}`.execute(
          tx,
        )
      ).rows;
      assert(
        ownership.every(
          (row) =>
            row.organization_id === event.scope.organizationId &&
            row.guild_id === event.scope.guildId,
        ),
        "BILLING_SCOPE_CONFLICT",
        409,
      );
      const row = (
        await sql<{
          id: string;
        }>`INSERT INTO billing_provider_events(id,provider,event_digest,organization_id,guild_id,normalized,verified_at) VALUES(${randomUUID()}::uuid,${event.provider},${stored.eventDigest},${event.scope.organizationId}::uuid,${event.scope.guildId},${json(stored)},now()) ON CONFLICT(provider,event_digest) DO NOTHING RETURNING id`.execute(
          tx,
        )
      ).rows[0];
      return { duplicate: !row, id: row?.id ?? null };
    };
    return transaction
      ? persist(transaction)
      : this.db.transaction().execute(persist);
  }
  private async storeSignal(signal: ProviderSignal) {
    assert(signal.provider === "STRIPE", "BILLING_PROVIDER_MISMATCH");
    assert(
      signal.eventId.length > 0 &&
        signal.eventId.length <= 200 &&
        signal.subscriptionRef.length > 0 &&
        signal.subscriptionRef.length <= 200,
      "BILLING_SIGNAL_INVALID",
    );
    return this.db.transaction().execute(async (tx) => {
      const referenceDigest = this.vault.digest(
        "billing-reference:STRIPE",
        signal.subscriptionRef,
      );
      let resolved = (
        await sql<Scope>`SELECT a.organization_id AS "organizationId",a.guild_id AS "guildId" FROM billing_subscriptions b JOIN billing_subscription_assignments a ON a.subscription_id=b.id WHERE b.provider='STRIPE' AND b.reference_digest=${referenceDigest}`.execute(
          tx,
        )
      ).rows[0];
      if (
        !resolved &&
        signal.customerRef &&
        signal.bindingEvidence?.kind === "CUSTOMER_SUBSCRIPTION" &&
        signal.bindingEvidence.customerRef === signal.customerRef &&
        signal.bindingEvidence.subscriptionRef === signal.subscriptionRef
      ) {
        const digest = this.vault.digest(
          "billing-customer-reference:STRIPE",
          signal.customerRef,
        );
        resolved = (
          await sql<Scope>`SELECT a.organization_id AS "organizationId",c.reference_guild_id AS "guildId" FROM billing_provider_customers c JOIN billing_accounts a ON a.id=c.account_id WHERE c.provider='STRIPE' AND c.reference_digest=${digest} AND c.reference_guild_id IS NOT NULL AND c.archived_at IS NULL AND a.deleted_at IS NULL`.execute(
            tx,
          )
        ).rows[0];
      }
      if (
        !resolved &&
        signal.checkoutOperationId &&
        signal.checkoutRef &&
        signal.bindingEvidence?.kind === "CHECKOUT_SUBSCRIPTION" &&
        signal.bindingEvidence.checkoutRef === signal.checkoutRef &&
        signal.bindingEvidence.subscriptionRef === signal.subscriptionRef
      ) {
        const digest = this.vault.digest(
          "billing-checkout-reference:STRIPE",
          signal.checkoutRef,
        );
        resolved = (
          await sql<Scope>`SELECT organization_id AS "organizationId",guild_id AS "guildId" FROM billing_operations WHERE id=${signal.checkoutOperationId}::uuid AND provider='STRIPE' AND operation='CHECKOUT' AND state='FINALIZED' AND external_started_at IS NOT NULL AND provider_reference_digest=${digest}`.execute(
            tx,
          )
        ).rows[0];
      }
      assert(resolved, "BILLING_SCOPE_UNRESOLVED", 409);
      assert(
        !signal.scope ||
          (signal.scope.organizationId === resolved.organizationId &&
            signal.scope.guildId === resolved.guildId),
        "BILLING_SCOPE_CONFLICT",
        409,
      );
      const s = resolved;
      await billingScopeLock(tx, s);
      if (
        signal.checkoutOperationId &&
        signal.checkoutRef &&
        signal.bindingEvidence?.kind === "CHECKOUT_SUBSCRIPTION" &&
        signal.bindingEvidence.checkoutRef === signal.checkoutRef &&
        signal.bindingEvidence.subscriptionRef === signal.subscriptionRef &&
        signal.bindingEvidence.customerRef
      ) {
        assert(
          !signal.customerRef ||
            signal.customerRef === signal.bindingEvidence.customerRef,
          "BILLING_SCOPE_CONFLICT",
          409,
        );
        await this.bindCustomerReference(
          s,
          signal.provider,
          {
            operationId: signal.checkoutOperationId,
            checkoutRef: signal.checkoutRef,
            customerRef: signal.bindingEvidence.customerRef,
          },
          tx,
        );
        await sql`UPDATE billing_operations SET checkout_completed_at=COALESCE(checkout_completed_at,now()) WHERE ${tenant(s)} AND id=${signal.checkoutOperationId}::uuid AND provider='STRIPE' AND operation='CHECKOUT' AND state='FINALIZED' AND provider_reference_digest=${this.vault.digest("billing-checkout-reference:STRIPE", signal.checkoutRef)}`.execute(
          tx,
        );
      }
      const digest = this.vault.digest("billing-signal:STRIPE", signal.eventId);
      const result =
        await sql`INSERT INTO billing_provider_signals(id,provider,event_digest,organization_id,guild_id,reference_ciphertext) VALUES(${randomUUID()}::uuid,'STRIPE',${digest},${s.organizationId}::uuid,${s.guildId},${this.vault.seal(s, signal.subscriptionRef)}) ON CONFLICT(provider,event_digest) DO NOTHING RETURNING id`.execute(
          tx,
        );
      return { duplicate: result.rows.length === 0 };
    });
  }
  async reconcileLatest(
    s: Scope,
    provider: BillingProvider,
    subscriptionRef?: string,
  ) {
    assert(
      provider.kind === "STRIPE" && provider.ordering === "RECONCILE_LATEST",
      "BILLING_ORDERING_INVALID",
    );
    const token = randomUUID();
    const claim = await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      await sql`INSERT INTO billing_snapshot_sequences(organization_id,provider) VALUES(${s.organizationId}::uuid,'STRIPE') ON CONFLICT DO NOTHING`.execute(
        tx,
      );
      return (
        await sql<{
          revision: string;
        }>`UPDATE billing_snapshot_sequences SET revision=revision+1,lease_token=${token}::uuid,lease_until=now()+interval '2 minutes' WHERE organization_id=${s.organizationId}::uuid AND provider='STRIPE' AND (lease_until IS NULL OR lease_until<now()) RETURNING revision`.execute(
          tx,
        )
      ).rows[0];
    });
    if (!claim) return false;
    try {
      // Network retrieval takes place outside all PostgreSQL transactions.
      const request = await this.reconcileRequest(
        s,
        provider.kind,
        subscriptionRef,
      );
      let result: ProviderReconcileResult;
      try {
        result = providerReconcileResultSchema.parse(
          await provider.reconcile(request),
        );
      } catch (error) {
        await this.markProviderUnavailable(s, provider.kind);
        throw error;
      }
      if (result.kind === "INCOMPLETE") {
        await this.markProviderUnavailable(s, provider.kind);
        assert(false, "BILLING_RECONCILIATION_INCOMPLETE", 503);
      }
      const snapshots =
        result.kind === "TARGET_FOUND"
          ? [result.subscription]
          : result.kind === "FULL_CENSUS"
            ? result.events
            : [];
      assert(
        subscriptionRef
          ? result.kind === "TARGET_FOUND" || result.kind === "TARGET_ABSENT"
          : result.kind === "FULL_CENSUS",
        "BILLING_RECONCILIATION_TARGET_INVALID",
        409,
      );
      assert(
        result.kind !== "TARGET_ABSENT" ||
          result.subscriptionRef === subscriptionRef,
        "BILLING_RECONCILIATION_TARGET_INVALID",
        409,
      );
      return await this.db.transaction().execute(async (tx) => {
        await billingScopeLock(tx, s);
        const valid =
          await sql`SELECT revision FROM billing_snapshot_sequences WHERE organization_id=${s.organizationId}::uuid AND provider='STRIPE' AND lease_token=${token}::uuid AND lease_until>now() FOR UPDATE`.execute(
            tx,
          );
        assert(valid.rows.length, "BILLING_RECONCILIATION_LEASE_EXPIRED", 409);
        const absent = await this.absentSnapshots(
          tx,
          s,
          provider.kind,
          result,
          snapshots,
        );
        for (const snapshot of [...snapshots, ...absent]) {
          assert(
            snapshot.provider === "STRIPE" &&
              snapshot.scope.organizationId === s.organizationId &&
              snapshot.scope.guildId === s.guildId &&
              (!subscriptionRef ||
                snapshot.subscriptionRef === subscriptionRef),
            "BILLING_PROVIDER_MISMATCH",
          );
          await this.persistSnapshot(
            {
              ...snapshot,
              eventId: "snapshot:" + token + ":" + snapshot.subscriptionRef,
              ordering: "RECONCILE_LATEST",
              version: Number(claim.revision),
              occurredAt: new Date().toISOString(),
            },
            tx,
          );
        }
        return true;
      });
    } finally {
      await sql`UPDATE billing_snapshot_sequences SET lease_token=NULL,lease_until=NULL WHERE organization_id=${s.organizationId}::uuid AND provider='STRIPE' AND lease_token=${token}::uuid`.execute(
        this.db,
      );
    }
  }
  private async reconcileRequest(
    s: Scope,
    provider: BillingProviderKind,
    subscriptionRef?: string,
  ): Promise<ProviderReconcileRequest> {
    const subscriptions = await this.subscriptionReferences(s, provider);
    let customer: TrustedProviderCustomerReference | undefined;
    if (provider === "STRIPE") {
      try {
        customer = await this.customerReference(s, provider);
      } catch {
        /* A targeted trusted subscription can reconcile without a Customer. */
      }
      assert(
        subscriptionRef || customer,
        "BILLING_CUSTOMER_REFERENCE_UNAVAILABLE",
        409,
      );
    }
    let target = subscriptionRef
      ? subscriptions.find((row) => row.subscriptionRef === subscriptionRef)
      : undefined;
    if (subscriptionRef && !target) {
      const signals = (
        await sql<{
          id: string;
          reference_ciphertext: string;
        }>`SELECT id,reference_ciphertext FROM billing_provider_signals WHERE ${tenant(s)} AND provider=${provider}`.execute(
          this.db,
        )
      ).rows;
      const binding = signals.find(
        (signal) =>
          this.vault.open(s, signal.reference_ciphertext) === subscriptionRef,
      );
      assert(binding, "BILLING_SCOPE_UNRESOLVED", 409);
      target = { provider, bindingId: binding.id, subscriptionRef };
    }
    const rows = (
      await sql<{
        id: string;
      }>`SELECT id FROM billing_offerings WHERE provider=${provider} AND commercial_locked`.execute(
        this.db,
      )
    ).rows;
    const offerings = await Promise.all(
      rows.map((row) => billingOffering(this.db, row.id)),
    );
    return {
      scope: s,
      customer,
      subscriptions,
      target,
      offerings,
      promotions: await new PromotionReservationService(
        this.db,
        this.vault,
      ).confirmationContexts(s),
    };
  }
  private async absentSnapshots(
    tx: Tx,
    s: Scope,
    provider: BillingProviderKind,
    result: ProviderReconcileResult,
    snapshots: NormalizedBillingEvent[],
  ): Promise<NormalizedBillingEvent[]> {
    if (result.kind !== "FULL_CENSUS" && result.kind !== "TARGET_ABSENT")
      return [];
    assert(
      result.kind !== "FULL_CENSUS" || result.complete === true,
      "BILLING_RECONCILIATION_INCOMPLETE",
      503,
    );
    const existing = (
      await sql<{
        reference_ciphertext: string;
        plan_key: Plan;
        plan_revision: number;
        offering_id: string | null;
      }>`SELECT b.reference_ciphertext,b.plan_key,b.plan_revision,b.offering_id FROM billing_subscriptions b JOIN billing_subscription_assignments a ON a.subscription_id=b.id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND b.provider=${provider} UNION SELECT normalized->>'referenceCiphertext' AS reference_ciphertext,normalized->>'plan' AS plan_key,COALESCE((normalized->>'planRevision')::integer,2) AS plan_revision,COALESCE(normalized->'offeringAssociation'->>'offeringId',normalized->'commercialEvidence'->>'offeringId')::uuid AS offering_id FROM billing_provider_events WHERE ${tenant(s)} AND provider=${provider} AND projected_at IS NULL AND normalized->>'referenceCiphertext' IS NOT NULL`.execute(
        tx,
      )
    ).rows;
    const events: NormalizedBillingEvent[] = [];
    for (const row of existing) {
      const ref = this.vault.open(s, row.reference_ciphertext);
      const absent =
        result.kind === "TARGET_ABSENT"
          ? result.subscriptionRef === ref
          : !snapshots.some((snapshot) => snapshot.subscriptionRef === ref);
      if (!absent) continue;
      const at = new Date().toISOString();
      const offering = row.offering_id
        ? await billingOffering(tx, row.offering_id)
        : undefined;
      events.push({
        eventId: "absent:" + randomUUID(),
        subscriptionRef: ref,
        provider,
        scope: s,
        plan: row.plan_key,
        planRevision: row.plan_revision,
        offeringAssociation: offering
          ? {
              offeringId: offering.id,
              fingerprint: offeringFingerprint(offering),
            }
          : undefined,
        status: "CANCELED",
        occurredAt: at,
        version: Date.now(),
        periodEnd: at,
        scheduledPlan: null,
        scheduledAt: null,
        authoritative: true,
      });
    }
    return events;
  }
  async processSignal(provider: BillingProvider) {
    const token = randomUUID();
    const row = (
      await sql<{
        id: string;
        organization_id: string;
        guild_id: string;
        reference_ciphertext: string;
      }>`UPDATE billing_provider_signals SET lease_token=${token}::uuid,lease_until=now()+interval '3 minutes' WHERE id=(SELECT id FROM billing_provider_signals WHERE provider=${provider.kind} AND projected_at IS NULL AND dead_lettered_at IS NULL AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY received_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`.execute(
        this.db,
      )
    ).rows[0];
    if (!row) return false;
    const scope = {
      organizationId: row.organization_id,
      guildId: row.guild_id,
    };
    try {
      const completed = await this.reconcileLatest(
        scope,
        provider,
        this.vault.open(scope, row.reference_ciphertext),
      );
      assert(completed, "BILLING_RECONCILIATION_BUSY", 409);
      await sql`UPDATE billing_provider_signals SET projected_at=now(),error_category=NULL,lease_token=NULL,lease_until=NULL WHERE id=${row.id}::uuid AND lease_token=${token}::uuid`.execute(
        this.db,
      );
    } catch {
      await sql`UPDATE billing_provider_signals SET attempts=attempts+1,error_category='BILLING_RECONCILIATION_FAILED',available_at=now()+make_interval(secs=>LEAST(3600,30*power(2,LEAST(attempts,7))::integer)),dead_lettered_at=CASE WHEN attempts>=7 THEN now() ELSE NULL END,lease_token=NULL,lease_until=NULL WHERE id=${row.id}::uuid AND lease_token=${token}::uuid`.execute(
        this.db,
      );
    }
    return true;
  }
  async projectOne() {
    const candidate = (
      await sql<{
        id: string;
        normalized: StoredEvent;
      }>`SELECT id,normalized FROM billing_provider_events WHERE projected_at IS NULL AND dead_lettered_at IS NULL AND available_at<=now() ORDER BY received_at,id LIMIT 1`.execute(
        this.db,
      )
    ).rows[0];
    if (!candidate) return false;
    try {
      return await this.db.transaction().execute(async (tx) => {
        // Privacy deletion takes the exclusive fence before touching inbox rows.
        // Match that order so a projector cannot deadlock with deletion.
        await billingScopeLock(tx, candidate.normalized.scope);
        const row = (
          await sql<{
            id: string;
            normalized: StoredEvent;
          }>`SELECT id,normalized FROM billing_provider_events WHERE id=${candidate.id}::uuid AND projected_at IS NULL AND dead_lettered_at IS NULL AND available_at<=now() FOR UPDATE SKIP LOCKED`.execute(
            tx,
          )
        ).rows[0];
        if (!row) return false;
        const event = row.normalized,
          s = event.scope;
        // Account lock serializes assignments across guilds/instances.
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"billing-account:" + s.organizationId},0))`.execute(
          tx,
        );
        await sql`INSERT INTO billing_accounts(id,organization_id) VALUES(${randomUUID()}::uuid,${s.organizationId}::uuid) ON CONFLICT(organization_id) DO NOTHING`.execute(
          tx,
        );
        const account = (
          await sql<{
            id: string;
            provider_grace_hours: number;
            trial_allowed: boolean;
          }>`SELECT id,provider_grace_hours,trial_allowed FROM billing_accounts WHERE organization_id=${s.organizationId}::uuid AND deleted_at IS NULL FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        assert(account, "BILLING_ACCOUNT_UNAVAILABLE");
        const before = await new EntitlementService(tx).effective(s);
        if (event.provider === "STRIPE" && ["ACTIVE", "TRIALING", "CANCEL_AT_PERIOD_END"].includes(event.status))
          await sql`UPDATE billing_authorizations SET authority_state='ACTIVE',account_id=${account.id}::uuid WHERE organization_id=${s.organizationId}::uuid AND authority_state='PROVISIONAL' AND revoked_at IS NULL AND checkout_operation_id IN(SELECT id FROM billing_operations WHERE ${tenant(s)} AND operation='CHECKOUT' AND checkout_abandoned_at IS NULL)`.execute(tx);
        const existing = (
          await sql<{
            id: string;
            organization_id: string;
            plan_key: Plan;
            status: string;
            current_period_end: Date | null;
            scheduled_plan: Plan | null;
            scheduled_at: Date | null;
            provider_event_at: Date;
            provider_event_version: string;
            provider_event_key: string;
          }>`SELECT * FROM billing_subscriptions WHERE provider=${event.provider} AND reference_digest=${event.referenceDigest} FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        assert(
          !existing || existing.organization_id === s.organizationId,
          "BILLING_SCOPE_CONFLICT",
          409,
        );
        if (existing) {
          const assignments = (
            await sql<{
              guild_id: string;
            }>`SELECT guild_id FROM billing_subscription_assignments WHERE subscription_id=${existing.id}::uuid`.execute(
              tx,
            )
          ).rows;
          assert(
            assignments.length === 1 && assignments[0]!.guild_id === s.guildId,
            "BILLING_SCOPE_CONFLICT",
            409,
          );
        }
        const older =
          existing &&
          (event.version < Number(existing.provider_event_version) ||
            (event.version === Number(existing.provider_event_version) &&
              new Date(event.occurredAt) <= existing.provider_event_at));
        const sameOrder =
          existing &&
          event.version === Number(existing.provider_event_version) &&
          new Date(event.occurredAt).getTime() ===
            existing.provider_event_at.getTime();
        const contradictory =
          sameOrder &&
          existing.provider_event_key !== event.eventDigest &&
          (existing.plan_key !== event.plan ||
            existing.status !== event.status ||
            (existing.current_period_end?.toISOString() !== event.periodEnd &&
              !(
                existing.current_period_end === null && event.periodEnd === null
              )) ||
            existing.scheduled_plan !== event.scheduledPlan ||
            (existing.scheduled_at?.toISOString() !== event.scheduledAt &&
              !(existing.scheduled_at === null && event.scheduledAt === null)));
        if (contradictory) {
          const confirmed =
            ["ACTIVE", "TRIALING", "CANCEL_AT_PERIOD_END"].includes(
              event.status,
            ) &&
            (event.status !== "TRIALING" || account.trial_allowed);
          const goodUntil = confirmed
            ? new Date(
                Math.max(
                  new Date(event.occurredAt).getTime(),
                  event.periodEnd ? new Date(event.periodEnd).getTime() : 0,
                ) +
                  account.provider_grace_hours * 3600000,
              )
            : null;
          await sql`UPDATE billing_subscriptions SET status='CONFLICT',last_good_plan=CASE WHEN ${confirmed} AND (last_good_plan IS NULL OR array_position(ARRAY['FREE','STARTER','GROWTH','SCALE','ENTERPRISE'],last_good_plan)<array_position(ARRAY['FREE','STARTER','GROWTH','SCALE','ENTERPRISE'],${event.plan}::text)) THEN ${event.plan} ELSE last_good_plan END,last_good_until=GREATEST(last_good_until,${goodUntil}::timestamptz),confirmed_at=COALESCE(confirmed_at,${confirmed ? event.occurredAt : null}::timestamptz),provider_event_key=LEAST(provider_event_key,${event.eventDigest}) WHERE id=${existing.id}::uuid`.execute(
            tx,
          );
          await billingAudit(tx, s, null, "billing.provider_order_conflict", {
            provider: event.provider,
          });
        } else if (!older) {
          const confirmed =
            ["ACTIVE", "TRIALING", "CANCEL_AT_PERIOD_END"].includes(
              event.status,
            ) &&
            (event.status !== "TRIALING" || account.trial_allowed);
          const goodUntil = confirmed
            ? new Date(
                Math.max(
                  new Date(event.occurredAt).getTime(),
                  event.periodEnd ? new Date(event.periodEnd).getTime() : 0,
                ) +
                  account.provider_grace_hours * 3600000,
              )
            : null;
          const id = existing?.id ?? randomUUID();
          await sql`INSERT INTO billing_subscriptions(id,account_id,organization_id,provider,reference_digest,reference_ciphertext,plan_key,plan_revision,offering_id,status,current_period_end,scheduled_plan,scheduled_at,confirmed_at,last_good_plan,last_good_until,provider_event_at,provider_event_version,provider_event_key)
    VALUES(${id}::uuid,${account.id}::uuid,${s.organizationId}::uuid,${event.provider},${event.referenceDigest},${event.referenceCiphertext},${event.plan},${event.planRevision ?? 2},${event.offeringAssociation?.offeringId ?? event.commercialEvidence?.offeringId ?? null}::uuid,${event.status},${event.periodEnd}::timestamptz,${event.scheduledPlan},${event.scheduledAt}::timestamptz,${confirmed || (event.provider === "STRIPE" && event.status === "CANCELED" && event.periodEnd && new Date(event.periodEnd) > new Date()) ? event.occurredAt : null}::timestamptz,${confirmed ? event.plan : null},${goodUntil},${event.occurredAt}::timestamptz,${event.version},${event.eventDigest})
    ON CONFLICT(provider,reference_digest) DO UPDATE SET plan_key=CASE WHEN ${confirmed || event.status === "CANCELED"} THEN EXCLUDED.plan_key ELSE billing_subscriptions.plan_key END,plan_revision=CASE WHEN ${confirmed} THEN EXCLUDED.plan_revision ELSE billing_subscriptions.plan_revision END,offering_id=COALESCE(EXCLUDED.offering_id,billing_subscriptions.offering_id),status=EXCLUDED.status,current_period_end=EXCLUDED.current_period_end,scheduled_plan=EXCLUDED.scheduled_plan,scheduled_at=EXCLUDED.scheduled_at,confirmed_at=COALESCE(EXCLUDED.confirmed_at,billing_subscriptions.confirmed_at),last_good_plan=COALESCE(EXCLUDED.last_good_plan,billing_subscriptions.last_good_plan),last_good_until=COALESCE(EXCLUDED.last_good_until,billing_subscriptions.last_good_until),provider_event_at=EXCLUDED.provider_event_at,provider_event_version=EXCLUDED.provider_event_version,provider_event_key=EXCLUDED.provider_event_key`.execute(
            tx,
          );
          await sql`INSERT INTO billing_subscription_assignments(organization_id,guild_id,subscription_id) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid) ON CONFLICT DO NOTHING`.execute(
            tx,
          );
          const action = !existing
            ? "subscription.created"
            : event.scheduledPlan
              ? "downgrade.scheduled"
              : event.status === "CANCELED" ||
                  event.status === "CANCEL_AT_PERIOD_END"
                ? "subscription.cancel"
                : confirmed &&
                    planRank(event.plan) > planRank(existing.plan_key)
                  ? "subscription.upgrade"
                  : "payment.state_changed";
          await billingAudit(tx, s, null, action, {
            provider: event.provider,
            plan: event.plan,
            status: event.status,
          });
          await billingAudit(tx, s, null, "SUBSCRIPTION_RECONCILED", {
            provider: event.provider,
            plan: event.plan,
            status: event.status,
          });
          if (existing && existing.plan_key !== event.plan)
            await billingAudit(tx, s, null, "PLAN_CHANGE_RECONCILED", {
              plan: event.plan,
            });
        }
        await this.refreshState(s, tx, before.plan);
        if (!older && !contradictory && event.provider === "STRIPE") {
          await sql`UPDATE billing_operations o SET state='FINALIZED',error_category=NULL WHERE o.organization_id=${s.organizationId}::uuid AND o.guild_id=${s.guildId} AND o.provider='STRIPE' AND o.state='RECONCILE_REQUIRED' AND o.subscription_id IN(SELECT b.id FROM billing_subscriptions b WHERE b.provider='STRIPE' AND b.reference_digest=${event.referenceDigest}) AND ((o.operation='CHANGE' AND o.offering_id=${event.offeringAssociation?.offeringId ?? null}::uuid AND ${["ACTIVE", "CANCEL_AT_PERIOD_END"].includes(event.status)}) OR (o.operation='CHANGE' AND o.offering_id=${event.scheduledOfferingAssociation?.offeringId ?? null}::uuid) OR (o.operation='CANCEL' AND ${["CANCEL_AT_PERIOD_END", "CANCELED"].includes(event.status)}))`.execute(
            tx,
          );
          if (event.pendingUpdate === false) {
            const uncompleted = (
              await sql<{
                id: string;
                result_ciphertext: string;
              }>`SELECT id,result_ciphertext FROM billing_operations WHERE ${tenant(s)} AND provider='STRIPE' AND operation='CHANGE' AND state='RECONCILE_REQUIRED' AND subscription_id IN(SELECT id FROM billing_subscriptions WHERE provider='STRIPE' AND reference_digest=${event.referenceDigest}) AND result_ciphertext IS NOT NULL FOR UPDATE`.execute(
                tx,
              )
            ).rows;
            for (const operation of uncompleted) {
              const envelope = JSON.parse(
                this.vault.open(s, operation.result_ciphertext),
              ) as { url: string };
              const result = JSON.parse(envelope.url).result;
              // A known pending payment that disappeared without applying the target
              // has expired/been voided. Unknown transport outcomes remain fenced.
              if (result?.state === "PAYMENT_ACTION_REQUIRED")
                await sql`UPDATE billing_operations SET state='FAILED',error_category='BILLING_PENDING_UPDATE_EXPIRED' WHERE id=${operation.id}::uuid`.execute(
                  tx,
                );
            }
          }
        }
        await sql`UPDATE billing_provider_events SET projected_at=now(),error_category=NULL WHERE id=${row.id}::uuid`.execute(
          tx,
        );
        await billingAudit(tx, s, null, "provider.sync", {
          provider: event.provider,
          ignoredOlder: Boolean(older),
        });
        return true;
      });
    } catch {
      // Persist retry scheduling outside the rolled-back projection transaction.
      // Poison events must not monopolize the queue after a worker restart.
      const reference = errorReference();
      await sql`UPDATE billing_provider_events SET attempts=attempts+1,dead_lettered_at=CASE WHEN attempts>=7 THEN now() ELSE NULL END,available_at=now()+make_interval(secs=>LEAST(3600,30*power(2,LEAST(attempts,7))::integer)),error_category=${"BILLING_PROJECTION_FAILED:" + reference} WHERE id=${candidate.id}::uuid AND projected_at IS NULL`.execute(
        this.db,
      );
      logFailure({
        reference,
        action: "billing.project",
        stage: "provider_projection",
        error: new Error("BILLING_PROJECTION_FAILED"),
      });
      return true;
    }
  }
  async refreshState(
    s: Scope,
    tx: Tx = this.db,
    previousPlan?: Plan,
    now = new Date(),
  ) {
    const state = await new EntitlementService(tx).effective(s, now);
    const saved = (
      await sql<{
        effective_plan: Plan;
        conflict: boolean;
      }>`SELECT effective_plan,conflict FROM billing_guild_state WHERE ${tenant(s)}`.execute(
        tx,
      )
    ).rows[0];
    const old = previousPlan ?? saved?.effective_plan ?? state.plan,
      downgrade = planRank(old) > planRank(state.plan);
    const recovery =
      (
        await sql<{
          downgrade_recovery_days: number;
        }>`SELECT downgrade_recovery_days FROM billing_accounts WHERE organization_id=${s.organizationId}::uuid`.execute(
          tx,
        )
      ).rows[0]?.downgrade_recovery_days ?? 30;
    await sql`INSERT INTO billing_guild_state(organization_id,guild_id,effective_plan,conflict,recovery_until,recovery_history_days) VALUES(${s.organizationId}::uuid,${s.guildId},${state.plan},${state.conflict},${downgrade ? new Date(now.getTime() + recovery * 86400000) : null},${downgrade ? planRegistry[old].limits.historyDays : null}) ON CONFLICT(organization_id,guild_id) DO UPDATE SET effective_plan=EXCLUDED.effective_plan,conflict=EXCLUDED.conflict,recovery_until=CASE WHEN ${downgrade} THEN EXCLUDED.recovery_until ELSE billing_guild_state.recovery_until END,recovery_history_days=CASE WHEN ${downgrade} THEN EXCLUDED.recovery_history_days ELSE billing_guild_state.recovery_history_days END,updated_at=${now}`.execute(
      tx,
    );
    if (state.conflict && !saved?.conflict)
      await billingAudit(tx, s, null, "BILLING_CONFLICT", {
        providers: state.subscriptions.map((row) => row.provider),
      });
    const config = (
      await sql<{
        settings: { helperEnabled?: boolean; weeklySummaryEnabled?: boolean };
      }>`SELECT settings FROM guild_settings WHERE ${tenant(s)}`.execute(tx)
    ).rows[0]?.settings;
    const rules: (readonly [string, EntitlementFeature, boolean])[] = [
      ["helper", "attention_automation", config?.helperEnabled ?? false],
      [
        "weekly-digest",
        "scheduled_digest",
        config?.weeklySummaryEnabled ?? false,
      ],
    ];
    for (const [key, feature, configured] of rules) {
      if (configured)
        await sql`INSERT INTO billing_rule_states(organization_id,guild_id,rule_key,feature,state) VALUES(${s.organizationId}::uuid,${s.guildId},${key},${feature},${state.features.includes(feature) ? "ACTIVE" : "PAUSED_PLAN_LIMIT"}) ON CONFLICT(organization_id,guild_id,rule_key) DO UPDATE SET state=EXCLUDED.state,updated_at=${now}`.execute(
          tx,
        );
      else
        await sql`DELETE FROM billing_rule_states WHERE ${tenant(s)} AND rule_key=${key}`.execute(
          tx,
        );
    }
    await sql`DELETE FROM billing_rule_states WHERE ${tenant(s)} AND rule_key NOT IN ('helper','weekly-digest') AND rule_key NOT IN (SELECT revision_id::text FROM guild_config_heads WHERE ${tenant(s)} AND domain='intervention')`.execute(
      tx,
    );
    await sql`INSERT INTO billing_rule_states(organization_id,guild_id,rule_key,feature,state) SELECT r.organization_id,r.guild_id,r.id::text,'attention_automation',${state.features.includes("attention_automation") ? "ACTIVE" : "PAUSED_PLAN_LIMIT"} FROM guild_config_revisions r JOIN guild_config_heads h ON h.organization_id=r.organization_id AND h.guild_id=r.guild_id AND h.revision_id=r.id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND h.domain='intervention' AND r.definition->>'safetyMode'='auto' ON CONFLICT(organization_id,guild_id,rule_key) DO UPDATE SET state=EXCLUDED.state,updated_at=${now}`.execute(
      tx,
    );
    return state;
  }
  async preview(s: Scope, target: Plan, provider: BillingProviderKind) {
    const state = await new EntitlementService(this.db).effective(s),
      automationRules = (
        await sql<{
          rule_key: string;
          feature: "attention_automation" | "scheduled_digest";
        }>`SELECT rule_key,feature FROM billing_rule_states WHERE ${tenant(s)} AND feature IN ('attention_automation','scheduled_digest') AND state='ACTIVE'`.execute(
          this.db,
        )
      ).rows.map((row) => ({ id: row.rule_key, feature: row.feature }));
    const assignedGuilds =
      (
        await sql<{
          count: number;
        }>`SELECT count(DISTINCT guild_id)::integer AS count FROM billing_subscription_assignments WHERE organization_id=${s.organizationId}::uuid`.execute(
          this.db,
        )
      ).rows[0]?.count ?? 1;
    const recoveryDays =
      (
        await sql<{
          downgrade_recovery_days: number;
        }>`SELECT downgrade_recovery_days FROM billing_accounts WHERE organization_id=${s.organizationId}::uuid`.execute(
          this.db,
        )
      ).rows[0]?.downgrade_recovery_days ?? 30;
    return planChangePreview(state, target, provider, {
      periodEnd: state.subscriptions.find((row) => row.provider === provider)
        ?.periodEnd,
      automationRules,
      assignedGuilds: Math.max(1, assignedGuilds),
      recoveryDays,
    });
  }
  async status(s: Scope) {
    const state = await new EntitlementService(this.db).effective(s);
    const recovery = (
      await sql<{
        recovery_until: Date | null;
      }>`SELECT recovery_until FROM billing_guild_state WHERE ${tenant(s)}`.execute(
        this.db,
      )
    ).rows[0];
    const pausedRules = (
      await sql<{
        rule_key: string;
        state: string;
      }>`SELECT rule_key,state FROM billing_rule_states WHERE ${tenant(s)} AND state='PAUSED_PLAN_LIMIT'`.execute(
        this.db,
      )
    ).rows;
    return {
      ...state,
      usage: await new EntitlementService(this.db).usage(s),
      recoveryUntil: recovery?.recovery_until?.toISOString() ?? null,
      pausedRules,
    };
  }
  async view(s: Scope) {
    const view = billingViewModel(await this.status(s)),
      launch = commercialLaunch();
    const offerings = (
      await sql<{
        id: string;
        plan_key: Plan;
        currency: string;
        final_price_minor: number;
        billing_interval: "MONTH" | "YEAR";
      }>`SELECT id,plan_key,currency,final_price_minor,billing_interval FROM billing_offerings WHERE provider='STRIPE' AND enabled ORDER BY final_price_minor,id`.execute(
        this.db,
      )
    ).rows
      .filter((o) => !launch.livemode || paidPlanReady(o.plan_key))
      .map((o) => ({
        id: o.id,
        plan: o.plan_key,
        currency: o.currency,
        unitAmountMinor: o.final_price_minor,
        interval: o.billing_interval,
      }));
    const stripe = view.subscriptions.find(
      (row) =>
        row.provider === "STRIPE" &&
        !["CANCELED", "EXPIRED"].includes(row.status),
    );
    const bound =
      (
        await sql`SELECT c.id FROM billing_provider_customers c JOIN billing_accounts a ON a.id=c.account_id WHERE a.organization_id=${s.organizationId}::uuid AND a.deleted_at IS NULL AND c.provider='STRIPE' AND c.reference_guild_id=${s.guildId}`.execute(
          this.db,
        )
      ).rows.length > 0;
    const pending =
      (
        await sql`SELECT id FROM billing_operations WHERE ${tenant(s)} AND provider='STRIPE' AND (state='RECONCILE_REQUIRED' OR (state='PENDING' AND (external_started_at IS NOT NULL OR lease_until>now())) OR (operation='CHECKOUT' AND state='FINALIZED' AND checkout_completed_at IS NULL AND checkout_abandoned_at IS NULL AND checkout_expires_at>now() AND NOT EXISTS(SELECT 1 FROM billing_subscriptions b WHERE b.organization_id=${s.organizationId}::uuid AND b.provider='STRIPE' AND b.status NOT IN ('CANCELED','EXPIRED'))))`.execute(
          this.db,
        )
      ).rows.length > 0;
    return {
      ...view,
      presentation: {
        ...view.presentation,
        billingActions: {
          purchase: view.presentation.billingActions.purchase.map((action) =>
            action.provider === "STRIPE"
              ? {
                  ...action,
                  configured: launch.checkoutEnabled,
                  available:
                    launch.checkoutEnabled &&
                    !view.grants.some((grant) =>
                      grant.id.startsWith("organization-license:"),
                    ) &&
                    !view.privacyDeleted &&
                    !stripe &&
                    !view.conflict &&
                    !pending &&
                    offerings.length > 0,
                  offerings,
                }
              : { ...action, offerings: [] },
          ),
          manage: [
            {
              provider: "STRIPE",
              method: "PAYMENT",
              available:
                launch.managementEnabled &&
                pending &&
                Boolean(stripe) &&
                !view.privacyDeleted,
            },
            {
              provider: "STRIPE",
              method: "PORTAL",
              available:
                launch.managementEnabled &&
                bound &&
                Boolean(process.env.STRIPE_PORTAL_CONFIGURATION_ID) &&
                !view.privacyDeleted,
            },
            {
              provider: "STRIPE",
              method: "CHANGE",
              available:
                launch.managementEnabled &&
                !pending &&
                !view.conflict &&
                stripe?.status === "ACTIVE" &&
                !stripe.scheduledPlan &&
                !view.privacyDeleted,
              offerings,
            },
            {
              provider: "STRIPE",
              method: "CANCEL",
              available:
                launch.managementEnabled &&
                !pending &&
                !view.conflict &&
                Boolean(stripe) &&
                !["CANCEL_AT_PERIOD_END", "INCOMPLETE"].includes(
                  stripe?.status ?? "",
                ) &&
                !view.privacyDeleted,
            },
          ],
        },
      },
    };
  }
  async reconcile(s: Scope, provider: BillingProvider) {
    if (provider.kind === "STRIPE") return this.reconcileLatest(s, provider);
    let result: ProviderReconcileResult;
    try {
      result = providerReconcileResultSchema.parse(
        await provider.reconcile(await this.reconcileRequest(s, provider.kind)),
      );
    } catch (error) {
      await this.markProviderUnavailable(s, provider.kind);
      throw error;
    }
    if (result.kind === "INCOMPLETE") {
      await this.markProviderUnavailable(s, provider.kind);
      assert(false, "BILLING_RECONCILIATION_INCOMPLETE", 503);
    }
    const events =
      result.kind === "TARGET_FOUND"
        ? [result.subscription]
        : result.kind === "FULL_CENSUS"
          ? result.events
          : [];
    assert(
      result.kind === "FULL_CENSUS",
      "BILLING_RECONCILIATION_TARGET_INVALID",
      409,
    );
    await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      const absent = await this.absentSnapshots(
        tx,
        s,
        provider.kind,
        result,
        events,
      );
      for (const event of [...events, ...absent]) {
        assert(
          event.provider === provider.kind &&
            event.scope.organizationId === s.organizationId &&
            event.scope.guildId === s.guildId,
          "BILLING_PROVIDER_MISMATCH",
          409,
        );
        await this.persistSnapshot(event, tx);
      }
    });
  }
  async markProviderUnavailable(s: Scope, provider: BillingProviderKind) {
    await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      await sql`UPDATE billing_subscriptions b SET status='UNKNOWN' FROM billing_subscription_assignments a WHERE a.subscription_id=b.id AND a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND b.provider=${provider} AND b.status IN ('ACTIVE','TRIALING','PAST_DUE','GRACE')`.execute(
        tx,
      );
      await billingAudit(tx, s, null, "provider.unavailable", { provider });
      await this.refreshState(s, tx);
    });
  }
}
