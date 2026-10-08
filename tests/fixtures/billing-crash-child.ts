// A real child process can be killed without running BillingOperationService's catch.
import { connect, sql } from "../../packages/db/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import {
  BillingOperationService,
  type SessionOperation,
} from "../../packages/settings/src/billing/operations";
const db = connect(process.env.BILLING_CRASH_DATABASE_URL!);
const input = JSON.parse(process.env.BILLING_CRASH_INPUT!) as SessionOperation;
const stage = process.env.BILLING_CRASH_STAGE!;
const vault = new IdentityVault("11".repeat(32), "22".repeat(32));
async function checkpoint(name: string) {
  process.send?.({ stage: name });
  await new Promise<void>((resolve) =>
    process.once("message", () => resolve()),
  );
}
try {
  if (stage === "before_claim") await checkpoint(stage);
  const result = await new BillingOperationService(db, vault).session(
    { ...input, externalBoundary: "ADAPTER" },
    async (ctx) => {
      if (stage === "claimed" || stage === "stale") await checkpoint(stage);
      if (stage === "customer_created") {
        await ctx.beforeMutation("CUSTOMER");
        await sql`INSERT INTO billing_crash_provider_acceptances(operation_id,phase) VALUES(${ctx.operationId}::uuid,'CUSTOMER')`.execute(
          db,
        );
        await ctx.afterMutation("CUSTOMER");
        await ctx.onCustomerCreated!("cus_crash_" + ctx.operationId);
        await checkpoint(stage);
      }
      await ctx.beforeMutation("CHECKOUT");
      if (stage === "marker") await checkpoint(stage);
      await sql`INSERT INTO billing_crash_provider_acceptances(operation_id,phase) VALUES(${ctx.operationId}::uuid,'CHECKOUT')`.execute(
        db,
      );
      if (stage === "accepted_unknown") await checkpoint(stage);
      await ctx.afterMutation("CHECKOUT");
      if (stage === "result_before_save") await checkpoint(stage);
      return {
        url: "https://checkout.stripe.com/c/pay/cs_crash",
        expiresAt: new Date(Date.now() + 2100000).toISOString(),
        providerCheckoutRef: "cs_crash_" + ctx.operationId,
      };
    },
  );
  process.send?.({ result });
} catch (error) {
  process.send?.({ error: error instanceof Error ? error.message : "unknown" });
} finally {
  await db.destroy();
  process.disconnect?.();
}
