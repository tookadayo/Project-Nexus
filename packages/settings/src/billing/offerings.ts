import { createHash } from "node:crypto";
import { sql, type Database, type Tx } from "../../../db/src/index";
import { assert } from "../../../shared/src/index";
import type { Plan } from "../plan-registry";
import type { BillingProviderKind } from "./domain";
export type BillingOffering = {
  id: string;
  planKey: Plan;
  planRevision: number;
  provider: BillingProviderKind;
  providerProductId: string | null;
  providerPriceId: string | null;
  /** Provider-neutral identity; Discord uses this as its exact SKU mapping. */
  providerNeutralOfferingId: string | null;
  billingInterval: "MONTH" | "YEAR";
  billingIntervalCount: number;
  currency: string | null;
  unitAmountMinor: number | null;
  taxBehavior: "UNSPECIFIED" | "INCLUSIVE" | "EXCLUSIVE";
  enabled: boolean;
};
export async function billingOffering(
  db: Database | Tx,
  id: string,
  checkout = false,
): Promise<BillingOffering> {
  const row = (
    await sql<{
      id: string;
      plan_key: Plan;
      plan_revision: number;
      provider: BillingProviderKind;
      provider_product_id: string | null;
      provider_price_id: string | null;
      provider_offering_id: string | null;
      billing_interval: "MONTH" | "YEAR";
      billing_interval_count: number;
      currency: string | null;
      final_price_minor: number | null;
      tax_behavior: BillingOffering["taxBehavior"];
      enabled: boolean;
    }>`SELECT id,plan_key,plan_revision,provider,provider_product_id,provider_price_id,provider_offering_id,billing_interval,billing_interval_count,currency,final_price_minor,tax_behavior,enabled FROM billing_offerings WHERE id=${id}::uuid FOR SHARE`.execute(
      db,
    )
  ).rows[0];
  assert(row, "BILLING_OFFERING_UNAVAILABLE", 409);
  assert(
    !checkout ||
      (row.enabled &&
        (row.provider === "STRIPE" || row.provider === "DISCORD")),
    "BILLING_OFFERING_UNAVAILABLE",
    409,
  );
  assert(
    !checkout ||
      row.provider !== "STRIPE" ||
      (row.provider_product_id?.trim() &&
        row.provider_price_id?.trim() &&
        /^[A-Z]{3}$/.test(row.currency ?? "") &&
        Number.isSafeInteger(row.final_price_minor) &&
        row.final_price_minor !== null &&
        row.final_price_minor >= 0 &&
        ["EXCLUSIVE", "INCLUSIVE"].includes(row.tax_behavior) &&
        Number.isSafeInteger(row.billing_interval_count) &&
        row.billing_interval_count > 0),
    "BILLING_OFFERING_INCOMPLETE",
    409,
  );
  return {
    id: row.id,
    planKey: row.plan_key,
    planRevision: row.plan_revision,
    provider: row.provider,
    providerProductId: row.provider_product_id,
    providerPriceId: row.provider_price_id,
    providerNeutralOfferingId: row.provider_offering_id,
    billingInterval: row.billing_interval,
    billingIntervalCount: row.billing_interval_count,
    currency: row.currency,
    unitAmountMinor: row.final_price_minor,
    taxBehavior: row.tax_behavior,
    enabled: row.enabled,
  };
}
export async function checkoutOffering(db: Database | Tx, id: string) {
  return billingOffering(db, id, true);
}

/** Canonical commercial identity, never a caller-supplied price or provider mapping. */
export function offeringFingerprint(offering: BillingOffering): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "nexus-offering-v1",
        offering.id,
        offering.planKey,
        offering.planRevision,
        offering.provider,
        offering.providerProductId,
        offering.providerPriceId,
        offering.providerNeutralOfferingId,
        offering.billingInterval,
        offering.billingIntervalCount,
        offering.currency,
        offering.unitAmountMinor,
        offering.taxBehavior,
      ]),
    )
    .digest("hex");
}
