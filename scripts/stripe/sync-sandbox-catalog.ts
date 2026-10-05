import { randomUUID, createHash } from "node:crypto";
import { connect, migrate, sql } from "../../packages/db/src/index";
import { StripeBillingProvider } from "../../packages/settings/src/billing/providers/stripe";
import { checkoutOffering } from "../../packages/settings/src/billing/offerings";
import { assert } from "../../packages/shared/src/index";
import { pathToFileURL } from "node:url";

/** Creates only missing Sandbox resources and persists exact immutable Offering mappings. */
export async function syncSandboxCatalog(databaseUrl: string, accountId: string, dryRun=true) {
  const provider=new StripeBillingProvider(),catalog=await provider.syncSandboxCatalog(accountId,dryRun);
  const db=connect(databaseUrl);
  try {
    if(!dryRun) await migrate(db);
    const results=[];
    for(const entry of catalog) {
      if(!entry.productId||!entry.priceId) {results.push({plan:entry.plan,status:"MISSING"});continue;}
      const id=await db.transaction().execute(async tx=>{
        await sql`SELECT pg_advisory_xact_lock(hashtextextended('stripe-catalog-sync',0))`.execute(tx);
        const existing=(await sql<{id:string}>`SELECT id FROM billing_offerings WHERE provider='STRIPE' AND provider_price_id=${entry.priceId} FOR UPDATE`.execute(tx)).rows;
        assert(existing.length<=1,"BILLING_OFFERING_MAPPING_AMBIGUOUS",409);
        if(existing[0]) {
          const offering=await checkoutOffering(tx,existing[0].id);
          assert(offering.planKey===entry.plan && offering.planRevision===2 && offering.providerProductId===entry.productId && offering.unitAmountMinor===entry.amount && offering.currency==="USD" && offering.taxBehavior==="EXCLUSIVE" && offering.billingInterval==="MONTH" && offering.billingIntervalCount===1,"BILLING_CATALOG_MAPPING_MISMATCH",409);
          return offering.id;
        }
        if(dryRun) return null;
        const id=randomUUID();
        await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,provider_product_id,provider_price_id,billing_interval,billing_interval_count,currency,final_price_minor,tax_behavior,enabled) VALUES(${id}::uuid,${entry.plan},2,'STRIPE',${entry.productId},${entry.priceId},'MONTH',1,'USD',${entry.amount},'EXCLUSIVE',true)`.execute(tx);
        return id;
      });
      results.push({plan:entry.plan,status:id?"MAPPED":"UNMAPPED",offeringId:id,priceDigest:createHash("sha256").update(entry.priceId).digest("hex").slice(0,12)});
    }
    return results;
  } finally {await db.destroy();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    process.loadEnvFile();
    const accountId=process.argv.find(a=>a.startsWith("--account="))?.slice(10);
    assert(accountId && process.env.DATABASE_URL,"STRIPE_CATALOG_ARGUMENTS_REQUIRED",400);
    console.log(JSON.stringify(await syncSandboxCatalog(process.env.DATABASE_URL,accountId,!process.argv.includes("--apply")),null,2));
  } catch {console.error("Sandbox catalog sync failed. Check account, mode, API permissions and database configuration.");process.exitCode=1;}
}
