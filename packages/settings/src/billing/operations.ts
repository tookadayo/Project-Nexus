import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, tenant, type Database } from "../../../db/src/index";
import { assert, type Scope } from "../../../shared/src/index";
import type { IdentityVault } from "../../../identity/src/index";
import { billingScopeLock } from "./service";
type SessionOperation = {
  scope: Scope;
  provider: "STRIPE" | "DISCORD";
  operation: "CHECKOUT" | "PORTAL";
  idempotencyKey: string;
  offeringId?: string;
  promotionReservationId?: string;
};
// Short-lived results stay sealed, scoped and exclusive to POST actions.
export class BillingOperationService {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
  ) {}
  async session(
    input: SessionOperation,
    execute: () => Promise<{ url: string; expiresAt?: string }>,
  ) {
    z.uuid().parse(input.idempotencyKey);
    const s = input.scope,
      token = randomUUID();
    const request = this.vault.digest(
      "billing-operation:" + s.organizationId + ":" + s.guildId,
      input.idempotencyKey,
    );
    const payload = this.vault.digest(
      "billing-operation-payload",
      JSON.stringify([
        input.provider,
        input.offeringId ?? null,
        input.promotionReservationId ?? null,
      ]),
    );
    const claim = await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      await sql`INSERT INTO billing_operations(id,organization_id,guild_id,provider,operation,request_digest,input_digest) VALUES(${randomUUID()}::uuid,${s.organizationId}::uuid,${s.guildId},${input.provider},${input.operation},${request},${payload}) ON CONFLICT(organization_id,guild_id,operation,request_digest) DO NOTHING`.execute(
        tx,
      );
      const row = (
        await sql<{
          id: string;
          input_digest: string;
          state: string;
          result_ciphertext: string | null;
          result_expires_at: Date | null;
        }>`SELECT * FROM billing_operations WHERE ${tenant(s)} AND operation=${input.operation} AND request_digest=${request} FOR UPDATE`.execute(
          tx,
        )
      ).rows[0]!;
      assert(row.input_digest === payload, "IDEMPOTENCY_CONFLICT", 409);
      if (row.state === "FINALIZED") {
        assert(
          row.result_ciphertext &&
            row.result_expires_at &&
            row.result_expires_at > new Date(),
          "BILLING_SESSION_EXPIRED",
          409,
        );
        return {
          id: row.id,
          cached: this.vault.open(s, row.result_ciphertext),
        };
      }
      const claimed =
        await sql`UPDATE billing_operations SET state='PENDING',lease_token=${token}::uuid,lease_until=now()+interval '2 minutes' WHERE id=${row.id}::uuid AND (lease_until IS NULL OR lease_until<now()) RETURNING id`.execute(
          tx,
        );
      assert(claimed.rows.length, "BILLING_OPERATION_BUSY", 409);
      return { id: row.id, cached: null };
    });
    if (claim.cached) return { url: claim.cached };
    try {
      const result = await execute();
      assert(
        input.provider !== "STRIPE" ||
          (result.expiresAt && Number.isFinite(Date.parse(result.expiresAt))),
        "BILLING_SESSION_EXPIRY_REQUIRED",
        409,
      );
      const expiresAt = new Date(
        Math.min(
          Date.now() + 300000,
          result.expiresAt ? Date.parse(result.expiresAt) : Infinity,
        ),
      );
      assert(expiresAt.getTime() > Date.now(), "BILLING_SESSION_EXPIRED", 409);
      const saved =
        await sql`UPDATE billing_operations SET state='FINALIZED',result_ciphertext=${this.vault.seal(s, result.url)},result_expires_at=${expiresAt},lease_token=NULL,lease_until=NULL,error_category=NULL WHERE id=${claim.id}::uuid AND lease_token=${token}::uuid AND lease_until>now() RETURNING id`.execute(
          this.db,
        );
      assert(saved.rows.length, "BILLING_OPERATION_LEASE_EXPIRED", 409);
      return result;
    } catch (error) {
      await sql`UPDATE billing_operations SET state='FAILED',error_category='BILLING_SESSION_FAILED',lease_token=NULL,lease_until=NULL WHERE id=${claim.id}::uuid AND lease_token=${token}::uuid`.execute(
        this.db,
      );
      throw error;
    }
  }
}
