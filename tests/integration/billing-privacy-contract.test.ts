import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import {
  connect,
  ensureGuild,
  migrate,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { PrivacyService } from "../../packages/security/src/privacy";
import { SettingsService } from "../../packages/settings/src/index";
import {
  BillingOperationService,
  BillingService,
  EntitlementService,
  StripeBillingProvider,
  type ProviderReconcileRequest,
  type ProviderReconcileResult,
} from "../../packages/settings/src/billing";
import type { Scope } from "../../packages/shared/src/index";

let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
let guild = 933111111111111110n;
const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32));
const user = "933111111111111119";
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
  vi.stubEnv("NEXUS_BILLING_DEVELOPER_COUNTRY", "JP");
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
  vi.unstubAllEnvs();
});

async function fixture() {
  const organizationId = randomUUID();
  const deleted = { organizationId, guildId: String(guild++) };
  const retained = { organizationId, guildId: String(guild++) };
  for (const scope of [deleted, retained]) await ensureGuild(db, scope);
  const accountId = randomUUID();
  await sql`INSERT INTO billing_accounts(id,organization_id) VALUES(${accountId}::uuid,${organizationId}::uuid)`.execute(
    db,
  );
  const customerIds = {
    deleted: randomUUID(),
    retained: randomUUID(),
    historical: randomUUID(),
  };
  for (const [scope, provider, id] of [
    [deleted, "STRIPE", customerIds.deleted],
    [retained, "DISCORD", customerIds.retained],
    [deleted, "EXTERNAL_LEGACY", customerIds.historical],
  ] as const) {
    const reference = "fixture-customer:" + id;
    await sql`INSERT INTO billing_provider_customers(id,account_id,provider,reference_digest,reference_ciphertext,reference_guild_id) VALUES(${id}::uuid,${accountId}::uuid,${provider},${vault.digest("billing-customer-reference:" + provider, reference)},${vault.seal(scope, reference)},${provider === "EXTERNAL_LEGACY" ? null : scope.guildId})`.execute(
      db,
    );
  }
  const subscriptionIds = { deleted: randomUUID(), retained: randomUUID() };
  for (const [scope, id] of [
    [deleted, subscriptionIds.deleted],
    [retained, subscriptionIds.retained],
  ] as const) {
    const reference = "fixture-subscription:" + id;
    await sql`INSERT INTO billing_subscriptions(id,account_id,organization_id,provider,reference_digest,reference_ciphertext,plan_key,status,current_period_end,confirmed_at,provider_event_at,provider_event_key) VALUES(${id}::uuid,${accountId}::uuid,${organizationId}::uuid,'STRIPE',${vault.digest("billing-reference:STRIPE", reference)},${vault.seal(scope, reference)},'GROWTH','ACTIVE',now()+interval '1 month',now(),now(),${"fixture-event:" + id})`.execute(
      db,
    );
    await sql`INSERT INTO billing_subscription_assignments(organization_id,guild_id,subscription_id) VALUES(${organizationId}::uuid,${scope.guildId},${id}::uuid)`.execute(
      db,
    );
  }
  return { deleted, retained, customerIds, subscriptionIds, accountId };
}

async function erase(scope: Scope) {
  return new PrivacyService(db, vault, new SettingsService(db)).delete(
    scope,
    user,
    {
      key: vault.hash(scope, user),
      permissions: "32",
      roles: [],
      source: "WEB_DASHBOARD",
      requestId: randomUUID(),
    },
    true,
  );
}

it("removes a guild-scoped customer while preserving another guild's distinct subscription and customer", async () => {
  const f = await fixture();
  const before = (
    await sql`SELECT id,reference_digest,reference_ciphertext FROM billing_provider_customers WHERE id IN (${f.customerIds.retained}::uuid,${f.customerIds.historical}::uuid) ORDER BY id`.execute(
      db,
    )
  ).rows;
  const subscription = (
    await sql<{
      reference_ciphertext: string;
    }>`SELECT reference_ciphertext FROM billing_subscriptions WHERE id=${f.subscriptionIds.retained}::uuid`.execute(
      db,
    )
  ).rows[0]!;
  await erase(f.deleted);
  expect(
    (
      await sql`SELECT id FROM billing_provider_customers WHERE id=${f.customerIds.deleted}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await sql`SELECT id FROM billing_subscriptions WHERE id=${f.subscriptionIds.deleted}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await sql`SELECT id,reference_digest,reference_ciphertext FROM billing_provider_customers WHERE id IN (${f.customerIds.retained}::uuid,${f.customerIds.historical}::uuid) ORDER BY id`.execute(
        db,
      )
    ).rows,
  ).toEqual(before);
  const after = (
    await sql<{
      reference_ciphertext: string;
    }>`SELECT reference_ciphertext FROM billing_subscriptions WHERE id=${f.subscriptionIds.retained}::uuid`.execute(
      db,
    )
  ).rows[0]!;
  expect(after.reference_ciphertext).toBe(subscription.reference_ciphertext);
  expect(vault.open(f.retained, after.reference_ciphertext)).toBe(
    "fixture-subscription:" + f.subscriptionIds.retained,
  );
  expect(
    (
      await sql`SELECT id FROM billing_accounts WHERE id=${f.accountId}::uuid AND deleted_at IS NULL`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  await erase(f.retained);
  expect(
    (
      await sql`SELECT id FROM billing_provider_customers WHERE account_id=${f.accountId}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
});

it("a Portal completion racing guild deletion cannot recreate its customer or durable operation", async () => {
  const f = await fixture();
  let started!: () => void, release!: () => void;
  const executing = new Promise<void>((resolve) => {
    started = resolve;
  });
  const resume = new Promise<void>((resolve) => {
    release = resolve;
  });
  const billing = new BillingService(db, vault);
  const operation = new BillingOperationService(db, vault).session(
    {
      scope: f.deleted,
      provider: "STRIPE",
      operation: "PORTAL",
      idempotencyKey: randomUUID(),
      customer: await billing.customerReference(f.deleted, "STRIPE"),
    },
    async () => {
      started();
      await resume;
      return { url: "https://provider.example/fixture-portal" };
    },
  );
  const outcome = operation.then(
    () => ({ completed: true, error: null }),
    (error: unknown) => ({ completed: false, error }),
  );
  await executing;
  await erase(f.deleted);
  release();
  const result = await outcome;
  expect(result.completed).toBe(false);
  expect(result.error).toBeInstanceOf(Error);
  expect((result.error as Error).message).toContain("PRIVACY_DELETED");
  expect(
    (
      await sql`SELECT id FROM billing_operations WHERE ${tenant(f.deleted)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await sql`SELECT id FROM billing_provider_customers WHERE id=${f.customerIds.deleted}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await sql`SELECT id FROM billing_subscriptions WHERE id=${f.subscriptionIds.retained}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  await expect(billing.customerReference(f.deleted, "STRIPE")).rejects.toThrow(
    "BILLING_CUSTOMER_REFERENCE_UNAVAILABLE",
  );
});

it("deleting one guild preserves another guild's completed Checkout Customer before subscription projection", async () => {
  const organizationId = randomUUID();
  const deleted = { organizationId, guildId: String(guild++) };
  const retained = { organizationId, guildId: String(guild++) };
  for (const scope of [deleted, retained]) await ensureGuild(db, scope);
  const accountId = randomUUID(),
    offeringId = randomUUID();
  await sql`INSERT INTO billing_accounts(id,organization_id) VALUES(${accountId}::uuid,${organizationId}::uuid)`.execute(
    db,
  );
  const deletedCustomerId = randomUUID(),
    historicalCustomerId = randomUUID();
  for (const [id, provider, binding] of [
    [deletedCustomerId, "DISCORD", deleted.guildId],
    [historicalCustomerId, "EXTERNAL_LEGACY", null],
  ] as const)
    await sql`INSERT INTO billing_provider_customers(id,account_id,provider,reference_digest,reference_ciphertext,reference_guild_id) VALUES(${id}::uuid,${accountId}::uuid,${provider},${"fixture-customer-digest:" + id},${vault.seal(deleted, "fixture-customer:" + id)},${binding})`.execute(
      db,
    );
  await sql`INSERT INTO billing_operations(id,organization_id,guild_id,provider,operation,request_digest,input_digest,state,external_started_at) VALUES(${randomUUID()}::uuid,${organizationId}::uuid,${deleted.guildId},'DISCORD','CHECKOUT',${"fixture-request:" + randomUUID()},'fixture-input','FINALIZED',now())`.execute(
    db,
  );
  await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,enabled,currency,final_price_minor,provider_product_id,provider_price_id,tax_behavior) VALUES(${offeringId}::uuid,'GROWTH',2,'STRIPE',true,'JPY',4900,${"fixture-product:" + offeringId},${"fixture-price:" + offeringId},'EXCLUSIVE')`.execute(
    db,
  );

  const billing = new BillingService(db, vault);
  const customerRef = "fixture-preprojection-customer:" + retained.guildId;
  const checkoutRef = "fixture-preprojection-checkout:" + retained.guildId;
  await new BillingOperationService(db, vault).session(
    {
      scope: retained,
      provider: "STRIPE",
      operation: "CHECKOUT",
      offeringId,
      idempotencyKey: randomUUID(),
    },
    async () => ({
      url: "https://provider.example/fixture-checkout",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      providerCheckoutRef: checkoutRef,
      providerCustomerRef: customerRef,
    }),
  );
  const before = (
    await sql<{
      reference_ciphertext: string;
    }>`SELECT reference_ciphertext FROM billing_provider_customers WHERE account_id=${accountId}::uuid AND provider='STRIPE'`.execute(
      db,
    )
  ).rows[0]!;
  expect(
    (
      await sql`SELECT id FROM billing_subscriptions WHERE account_id=${accountId}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  await erase(deleted);
  expect(
    (
      await sql`SELECT id FROM billing_provider_customers WHERE id IN (${deletedCustomerId}::uuid,${historicalCustomerId}::uuid)`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await sql`SELECT id FROM billing_operations WHERE ${tenant(deleted)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await sql`SELECT id FROM billing_operations WHERE ${tenant(retained)} AND state='FINALIZED'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await sql`SELECT id FROM billing_accounts WHERE id=${accountId}::uuid AND deleted_at IS NULL`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  const after = (
    await sql<{
      reference_ciphertext: string;
    }>`SELECT reference_ciphertext FROM billing_provider_customers WHERE account_id=${accountId}::uuid AND provider='STRIPE'`.execute(
      db,
    )
  ).rows[0]!;
  expect(after.reference_ciphertext).toBe(before.reference_ciphertext);
  expect(
    (await billing.customerReference(retained, "STRIPE")).customerRef,
  ).toBe(customerRef);
  class CompletedCheckoutStripe extends StripeBillingProvider {
    override async reconcile(
      input: ProviderReconcileRequest,
    ): Promise<ProviderReconcileResult> {
      expect(input.customer?.customerRef).toBe(customerRef);
      return {
        kind: "FULL_CENSUS",
        complete: true,
        events: [
          {
            eventId: randomUUID(),
            provider: "STRIPE",
            scope: retained,
            subscriptionRef:
              "fixture-preprojection-subscription:" + retained.guildId,
            plan: "GROWTH",
            status: "ACTIVE",
            authoritative: true,
            occurredAt: new Date().toISOString(),
            version: 0,
            periodEnd: new Date(Date.now() + 86400000).toISOString(),
            scheduledPlan: null,
            scheduledAt: null,
          },
        ],
      };
    }
  }
  await billing.reconcileLatest(retained, new CompletedCheckoutStripe());
  expect(await billing.projectOne()).toBe(true);
  expect(await new EntitlementService(db).plan(retained)).toBe("GROWTH");
  await expect(
    billing.reconcileLatest(deleted, new CompletedCheckoutStripe()),
  ).rejects.toThrow("PRIVACY_DELETED");
  await expect(
    new BillingOperationService(db, vault).session(
      {
        scope: deleted,
        provider: "STRIPE",
        operation: "CHECKOUT",
        offeringId,
        idempotencyKey: randomUUID(),
      },
      async () => {
        throw new Error("DELETED_SCOPE_PROVIDER_CALLED");
      },
    ),
  ).rejects.toThrow("PRIVACY_DELETED");
});
