import { sql, tenant, type Database } from "../../../db/src/index";
import { assert, type Scope } from "../../../shared/src/index";
import type { IdentityVault } from "../../../identity/src/index";
import { billingScopeLock, billingAudit } from "./service";
import { DefinitiveBillingFailure } from "./operations";

// The trusted caller proves the OAuth receipt identity. References stay sealed
// inside Core; the provider only sees the reference owned by this operation.
export async function abandonCheckout(
  db: Database,
  vault: IdentityVault,
  scope: Scope,
  operationId: string,
  principalHash: string,
  expire: (reference: string) => Promise<void>,
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
  try {
    await expire(reference);
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
    await sql`UPDATE billing_operations SET checkout_abandoned_at=now(),state='FINALIZED',abandon_started_at=NULL,result_expires_at=now() WHERE id=${operationId}::uuid`.execute(
      tx,
    );
    await billingAudit(tx, scope, principalHash, "CHECKOUT_ABANDONED", {
      operationId,
    });
  });
}
