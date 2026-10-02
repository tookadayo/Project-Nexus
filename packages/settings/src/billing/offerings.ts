import { sql, type Database } from "../../../db/src/index";
import { assert } from "../../../shared/src/index";
import type { Plan } from "../plan-registry";
import type { BillingProviderKind } from "./domain";
export type BillingOffering = {
  id: string;
  planKey: Plan;
  planRevision: number;
  provider: BillingProviderKind;
  billingInterval: "MONTH" | "YEAR";
  billingIntervalCount: number;
  currency: string | null;
  unitAmountMinor: number | null;
  enabled: boolean;
};
export async function checkoutOffering(
  db: Database,
  id: string,
): Promise<BillingOffering> {
  const row = (
    await sql<{
      id: string;
      plan_key: Plan;
      plan_revision: number;
      provider: BillingProviderKind;
      billing_interval: "MONTH" | "YEAR";
      billing_interval_count: number;
      currency: string | null;
      final_price_minor: number | null;
      enabled: boolean;
    }>`SELECT id,plan_key,plan_revision,provider,billing_interval,billing_interval_count,currency,final_price_minor,enabled FROM billing_offerings WHERE id=${id}::uuid AND enabled AND provider IN ('STRIPE','DISCORD')`.execute(
      db,
    )
  ).rows[0];
  assert(row, "BILLING_OFFERING_UNAVAILABLE", 409);
  return {
    id: row.id,
    planKey: row.plan_key,
    planRevision: row.plan_revision,
    provider: row.provider,
    billingInterval: row.billing_interval,
    billingIntervalCount: row.billing_interval_count,
    currency: row.currency,
    unitAmountMinor: row.final_price_minor,
    enabled: row.enabled,
  };
}
