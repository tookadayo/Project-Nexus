import "server-only";
import { connect, sql } from "../../../../packages/db/src/index";
import { commercialLaunch, paidPlanReady } from "../../../../packages/settings/src/billing/commerce";
import type { Plan } from "../../../../packages/settings/src/plan-registry";
export async function publicBillingCatalog() {
  const launch = commercialLaunch();
  if (!launch.publishPrices || !process.env.DATABASE_URL) return {launch,offerings:[]};
  const db = connect(process.env.DATABASE_URL);
  try {
    const rows = (await sql<{id:string;plan_key:Plan;currency:string;final_price_minor:number}>`SELECT id,plan_key,currency,final_price_minor FROM billing_offerings WHERE provider='STRIPE' AND enabled AND billing_interval='MONTH' AND billing_interval_count=1 ORDER BY final_price_minor,id`.execute(db)).rows;
    // Ambiguous commercial configurations require operator review.
    const offerings = rows.filter(row => rows.filter(other=>other.plan_key===row.plan_key).length===1 && (!launch.livemode || paidPlanReady(row.plan_key)));
    return {launch,offerings};
  } finally { await db.destroy(); }
}
