import { sql, tenant, type Database } from "../../../db/src/index";
import { assert, type Scope } from "../../../shared/src/index";
import type { IdentityVault } from "../../../identity/src/index";
import { billingScopeLock, billingAudit } from "./service";
import { DefinitiveBillingFailure } from "./operations";
import type { Tx } from "../../../db/src/index";
export type AbandonedCheckoutEvidence = {
  checkoutRef: string;
  customerRef: string;
  complete: true;
  unpaid: true;
  noFinancialHistory: true;
};
async function requireNoIssuedPortal(tx: Tx, scope: Scope) {
  // An issued portal remains an independent provider capability after our request finishes.
  // A census cannot prove that it will not attach a payment method a moment later.
  const portals =
    await sql`SELECT id FROM billing_operations WHERE organization_id=${scope.organizationId}::uuid AND provider='STRIPE' AND operation='PORTAL' AND (state<>'FAILED' OR external_started_at IS NOT NULL)`.execute(
      tx,
    );
  assert(
    !portals.rows.length,
    "BILLING_ABANDONMENT_PORTAL_REVIEW_REQUIRED",
    409,
  );
}

// The trusted caller proves the OAuth receipt identity. References stay sealed
// inside Core; the provider only sees the reference owned by this operation.
export async function abandonCheckout(
  db: Database,
  vault: IdentityVault,
  scope: Scope,
  operationId: string,
  principalHash: string,
  expire: (reference: string) => Promise<void | AbandonedCheckoutEvidence>,
) {
  const reference = await db.transaction().execute(async (tx) => {
    await billingScopeLock(tx, scope);
    const row = (
      await sql<{
        state: string;
        principal_actor_hash: string | null;
        result_ciphertext: string | null;
        checkout_abandoned_at: Date | null;
        checkout_completed_at: Date | null;
        abandon_started_at: Date | null;
      }>`SELECT state,principal_actor_hash,result_ciphertext,checkout_abandoned_at,checkout_completed_at,abandon_started_at FROM billing_operations WHERE ${tenant(scope)} AND id=${operationId}::uuid AND operation='CHECKOUT' AND provider='STRIPE' FOR UPDATE`.execute(
        tx,
      )
    ).rows[0];
    assert(
      row && row.principal_actor_hash === principalHash,
      "BILLING_PRINCIPAL_REQUIRED",
      403,
    );
    if (row.checkout_abandoned_at) return null;
    await requireNoIssuedPortal(tx, scope);
    assert(
      row.state === "FINALIZED" && !row.abandon_started_at,
      "BILLING_RECONCILE_REQUIRED",
      409,
    );
    assert(
      !row.checkout_completed_at && row.result_ciphertext,
      "BILLING_CHECKOUT_ALREADY_COMPLETED",
      409,
    );
    const result = JSON.parse(vault.open(scope, row.result_ciphertext)) as {
      providerCheckoutRef?: string;
    };
    assert(
      result.providerCheckoutRef,
      "BILLING_CHECKOUT_REFERENCE_UNAVAILABLE",
      409,
    );
    await sql`UPDATE billing_operations SET abandon_started_at=now(),state='RECONCILE_REQUIRED' WHERE id=${operationId}::uuid`.execute(
      tx,
    );
    return result.providerCheckoutRef;
  });
  if (!reference) return;
  let evidence: void | AbandonedCheckoutEvidence;
  try {
    evidence = await expire(reference);
  } catch (error) {
    // A read-only rejection is safe to resume. An unknown expire write stays fenced.
    if (error instanceof DefinitiveBillingFailure)
      await db.transaction().execute(async (tx) => {
        await billingScopeLock(tx, scope);
        await sql`UPDATE billing_operations SET state='FINALIZED',abandon_started_at=NULL WHERE id=${operationId}::uuid AND checkout_abandoned_at IS NULL`.execute(
          tx,
        );
      });
    throw error;
  }
  await db.transaction().execute(async (tx) => {
    await billingScopeLock(tx, scope);
    const completed =
      await sql`SELECT id FROM billing_operations WHERE id=${operationId}::uuid AND checkout_completed_at IS NOT NULL`.execute(
        tx,
      );
    assert(!completed.rows.length, "BILLING_CHECKOUT_ALREADY_COMPLETED", 409);
    if (evidence) {
      await requireNoIssuedPortal(tx, scope);
      assert(
        evidence.complete === true &&
          evidence.unpaid === true &&
          evidence.noFinancialHistory === true &&
          evidence.checkoutRef === reference,
        "BILLING_ABANDONMENT_UNCONFIRMED",
        409,
      );
      const customer = await sql<{
        id: string;
        reference_digest: string;
      }>`SELECT c.id,c.reference_digest FROM billing_provider_customers c JOIN billing_accounts b ON b.id=c.account_id WHERE b.organization_id=${scope.organizationId}::uuid AND c.provider='STRIPE' AND c.reference_guild_id=${scope.guildId} AND c.archived_at IS NULL FOR UPDATE`.execute(
        tx,
      );
      assert(
        customer.rows.length === 1 &&
          customer.rows[0]!.reference_digest ===
            vault.digest(
              "billing-customer-reference:STRIPE",
              evidence.customerRef,
            ),
        "BILLING_SCOPE_CONFLICT",
        409,
      );
      const recordedFinancialHistory =
        await sql`SELECT id FROM billing_subscriptions WHERE organization_id=${scope.organizationId}::uuid AND provider='STRIPE' UNION ALL SELECT id FROM billing_provider_events WHERE ${tenant(scope)} AND provider='STRIPE' UNION ALL SELECT id FROM billing_operations WHERE ${tenant(scope)} AND provider='STRIPE' AND checkout_completed_at IS NOT NULL`.execute(
          tx,
        );
      assert(
        !recordedFinancialHistory.rows.length,
        "BILLING_ABANDONMENT_UNCONFIRMED",
        409,
      );
      const authority =
        await sql`UPDATE billing_authorizations SET revoked_at=now(),authority_state='RELEASED' WHERE organization_id=${scope.organizationId}::uuid AND actor_hash=${principalHash} AND checkout_operation_id=${operationId}::uuid AND authority_state='PROVISIONAL' AND revoked_at IS NULL RETURNING account_id`.execute(
          tx,
        );
      assert(
        authority.rows.length === 1,
        "BILLING_ABANDONMENT_UNCONFIRMED",
        409,
      );
      await sql`UPDATE billing_provider_customers SET archived_at=now() WHERE id=${customer.rows[0]!.id}::uuid`.execute(
        tx,
      );
      await billingAudit(
        tx,
        scope,
        principalHash,
        "CHECKOUT_PROVISIONAL_AUTHORITY_RELEASED",
        { operationId },
      );
    }
    await sql`UPDATE billing_operations SET checkout_abandoned_at=now(),state='FINALIZED',abandon_started_at=NULL,result_expires_at=now() WHERE id=${operationId}::uuid`.execute(
      tx,
    );
    await billingAudit(tx, scope, principalHash, "CHECKOUT_ABANDONED", {
      operationId,
    });
  });
}
