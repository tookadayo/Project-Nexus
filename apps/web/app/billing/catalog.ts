import "server-only";
import { connect, sql, type Database } from "../../../../packages/db/src/index";
import {
  commercialLaunch,
  paidPlanReady,
} from "../../../../packages/settings/src/billing/commerce";
import type { Plan } from "../../../../packages/settings/src/plan-registry";

export type PublicOffering = {
  id: string;
  plan_key: "STARTER" | "GROWTH" | "SCALE";
  currency: "USD";
  final_price_minor: number;
  tax_behavior: "INCLUSIVE" | "EXCLUSIVE";
};
export type PublicBillingCatalog = {
  launch: ReturnType<typeof commercialLaunch>;
  status: "CLOSED" | "UNAVAILABLE" | "EMPTY" | "READY";
  offerings: PublicOffering[];
};
type CatalogRow = {
  id: string;
  plan_key: Plan;
  currency: string | null;
  final_price_minor: number | null;
  tax_behavior: string;
  provider_product_id: string | null;
  provider_price_id: string | null;
};

/** Read only the local, immutable Stripe mappings; never create a provider object on GET. */
export async function publicBillingCatalog(): Promise<PublicBillingCatalog> {
  const launch = commercialLaunch();
  if (!launch.publishPrices) return { launch, status: "CLOSED", offerings: [] };
  if (!process.env.DATABASE_URL)
    return { launch, status: "UNAVAILABLE", offerings: [] };
  let db: Database | undefined;
  try {
    db = connect(process.env.DATABASE_URL);
    const rows = (
      await sql<CatalogRow>`
      SELECT id,plan_key,currency,final_price_minor,tax_behavior,
             provider_product_id,provider_price_id
      FROM billing_offerings
      WHERE provider='STRIPE' AND product_kind='SUBSCRIPTION'
        AND currency='USD' AND enabled
        AND billing_interval='MONTH' AND billing_interval_count=1
      ORDER BY final_price_minor,id
    `.execute(db)
    ).rows;
    const offerings: PublicOffering[] = [];
    for (const row of rows) {
      // Do not select the cheapest of multiple enabled mappings, or let an
      // incomplete second mapping silently make one price look authoritative.
      if (
        rows.filter((other) => other.plan_key === row.plan_key).length !== 1 ||
        !["STARTER", "GROWTH", "SCALE"].includes(row.plan_key) ||
        row.currency !== "USD" ||
        !row.provider_product_id?.trim() ||
        !row.provider_price_id?.trim() ||
        row.final_price_minor === null ||
        !Number.isSafeInteger(row.final_price_minor) ||
        row.final_price_minor < 0 ||
        !["INCLUSIVE", "EXCLUSIVE"].includes(row.tax_behavior) ||
        (launch.livemode && !paidPlanReady(row.plan_key))
      )
        continue;
      // Explicit public DTO: provider mappings and internal metadata stay private.
      offerings.push({
        id: row.id,
        plan_key: row.plan_key as PublicOffering["plan_key"],
        currency: "USD",
        final_price_minor: row.final_price_minor,
        tax_behavior: row.tax_behavior as PublicOffering["tax_behavior"],
      });
    }
    return { launch, status: offerings.length ? "READY" : "EMPTY", offerings };
  } catch {
    // A catalog outage must not fall back to provisional registry prices.
    return { launch, status: "UNAVAILABLE", offerings: [] };
  } finally {
    await db?.destroy();
  }
}
