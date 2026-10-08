import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { infrastructure } from "../fixtures/infrastructure";
import { FakeDiscord } from "../fixtures/discord";
import {
  connect,
  ensureGuild,
  migrate,
  sql,
  type Database,
} from "../../packages/db/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { SettingsService } from "../../packages/settings/src/index";
import {
  BillingService,
  BillingOperationService,
  DefinitiveBillingFailure,
  StripeBillingProvider,
} from "../../packages/settings/src/billing";
import Stripe from "../../packages/settings/node_modules/stripe/esm/stripe.esm.node.js";
import { abandonCheckout } from "../../packages/settings/src/billing/checkout-lifecycle";
import { ServerAuthorization } from "../../packages/security/src/server-authorization";
import { BillingAuthorization } from "../../packages/security/src/billing-authorization";
let db: Database, infra: Awaited<ReturnType<typeof infrastructure>>;
const vault = new IdentityVault("11".repeat(32), "22".repeat(32)),
  payer = "911111111111111111",
  newOwner = "911111111111111112";
let guild = 933333344444440000n;
beforeAll(async () => {
  vi.stubEnv("NEXUS_BILLING_DEVELOPER_COUNTRY", "JP");
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
  await sql`CREATE TABLE billing_crash_provider_acceptances(operation_id uuid NOT NULL,phase text NOT NULL)`.execute(
    db,
  );
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db?.destroy();
  await infra?.stop();
});
async function fixture() {
  const scope = { organizationId: randomUUID(), guildId: String(guild++) };
  await ensureGuild(db, scope);
  const offeringId = randomUUID();
  await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,enabled,currency,final_price_minor,provider_product_id,provider_price_id,tax_behavior) VALUES(${offeringId}::uuid,'GROWTH',2,'STRIPE',true,'USD',4900,${"prod_" + offeringId},${"price_" + offeringId},'EXCLUSIVE')`.execute(
    db,
  );
  const discord = new FakeDiscord();
  discord.members.set(payer, {
    ownerId: payer,
    permissions: "8",
    roles: [],
    bot: false,
    joinedAt: "",
  });
  discord.members.set(newOwner, {
    ownerId: payer,
    permissions: "0",
    roles: [],
    bot: false,
    joinedAt: "",
  });
  const server = new ServerAuthorization(
      discord,
      new SettingsService(db),
      vault,
    ),
    auth = new BillingAuthorization(server, db, vault),
    ops = new BillingOperationService(db, vault),
    billing = new BillingService(db, vault);
  const input = {
    scope,
    provider: "STRIPE" as const,
    operation: "CHECKOUT" as const,
    offeringId,
    idempotencyKey: randomUUID(),
    principalActorHash: auth.principalHash(scope, payer),
  };
  return { scope, input, discord, server, auth, ops, billing };
}
function nextMessage(child: ChildProcess) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("CRASH_CHECKPOINT_TIMEOUT")),
      10000,
    );
    child.once("message", (message) => {
      clearTimeout(timer);
      resolve(message as Record<string, unknown>);
    });
    child.once("error", reject);
  });
}
async function childAt(f: Awaited<ReturnType<typeof fixture>>, stage: string) {
  const child = fork(resolve("tests/fixtures/billing-crash-child.ts"), [], {
    execArgv: ["--import", "tsx"],
    env: {
      ...process.env,
      BILLING_CRASH_DATABASE_URL: infra.databaseUrl,
      BILLING_CRASH_INPUT: JSON.stringify(f.input),
      BILLING_CRASH_STAGE: stage,
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const message = await nextMessage(child);
  expect(message).toEqual({ stage });
  return child;
}
async function terminate(child: ChildProcess) {
  const exit = new Promise<string | null>((resolve) =>
    child.once("exit", (_code, signal) => resolve(signal)),
  );
  child.kill("SIGKILL");
  expect(await exit).toBe("SIGKILL");
}
async function operation(f: Awaited<ReturnType<typeof fixture>>) {
  return (
    await sql<{
      id: string;
      state: string;
      external_started_at: Date | null;
      external_phase: string | null;
      result_ciphertext: string | null;
      lease_token: string;
    }>`SELECT id,state,external_started_at,external_phase,result_ciphertext,lease_token FROM billing_operations WHERE organization_id=${f.scope.organizationId}::uuid ORDER BY created_at`.execute(
      db,
    )
  ).rows[0];
}
const result = () => ({
  url: "https://checkout.stripe.com/c/pay/cs_retry",
  expiresAt: new Date(Date.now() + 2100000).toISOString(),
  providerCheckoutRef: "cs_retry_" + randomUUID(),
});

it("process death before claim leaves no durable operation", async () => {
  const f = await fixture(),
    child = await childAt(f, "before_claim");
  await terminate(child);
  expect(await operation(f)).toBeUndefined();
  await f.ops.session(f.input, async () => result());
});
it("process death after claim preserves a retryable lease without inventing external activity and blocks another key", async () => {
  const f = await fixture(),
    child = await childAt(f, "claimed");
  await terminate(child);
  const row = (await operation(f))!;
  expect(row.external_started_at).toBeNull();
  expect(row.external_phase).toBeNull();
  await expect(
    f.ops.session({ ...f.input, idempotencyKey: randomUUID() }, async () =>
      result(),
    ),
  ).rejects.toThrow("BILLING_RECONCILE_REQUIRED");
  await sql`UPDATE billing_operations SET lease_until=now()-interval '1 second' WHERE id=${row.id}::uuid`.execute(
    db,
  );
  await f.ops.session(f.input, async () => result());
  expect((await operation(f))!.state).toBe("FINALIZED");
});
it.each([
  "marker",
  "accepted_unknown",
  "customer_created",
  "result_before_save",
])(
  "SIGKILL at %s retains external phase and requires reconciliation for same or different key",
  async (stage) => {
    const f = await fixture(),
      child = await childAt(f, stage);
    await terminate(child);
    const row = (await operation(f))!;
    expect(row.state).toBe("PENDING");
    expect(row.external_started_at).not.toBeNull();
    expect(row.external_phase).toBe(
      stage === "customer_created" ? "CUSTOMER" : "CHECKOUT",
    );
    expect(row.result_ciphertext).toBeNull();
    await sql`UPDATE billing_operations SET lease_until=now()-interval '1 second' WHERE id=${row.id}::uuid`.execute(
      db,
    );
    for (const idempotencyKey of [f.input.idempotencyKey, randomUUID()])
      await expect(
        f.ops.session({ ...f.input, idempotencyKey }, async () => result()),
      ).rejects.toThrow("BILLING_RECONCILE_REQUIRED");
    const accepted = (
      await sql`SELECT phase FROM billing_crash_provider_acceptances WHERE operation_id=${row.id}::uuid`.execute(
        db,
      )
    ).rows;
    expect(accepted).toHaveLength(stage === "marker" ? 0 : 1);
    if (stage === "customer_created")
      expect(
        (await f.billing.customerReference(f.scope, "STRIPE")).customerRef,
      ).toBe("cus_crash_" + row.id);
  },
);
it("a stale lease resuming after takeover cannot mutate, bind Customer, or overwrite the winning result", async () => {
  const f = await fixture(),
    child = await childAt(f, "stale"),
    old = (await operation(f))!;
  await sql`UPDATE billing_operations SET lease_until=now()-interval '1 second' WHERE id=${old.id}::uuid`.execute(
    db,
  );
  await f.ops.session(f.input, async () => result());
  const next = nextMessage(child);
  child.send("resume");
  expect(await next).toEqual({ error: "BILLING_OPERATION_LEASE_EXPIRED" });
  await expect(
    f.billing.bindCreatedCustomer(
      f.scope,
      old.id,
      "cus_stale",
      old.lease_token,
    ),
  ).rejects.toThrow("BILLING_CUSTOMER_BINDING_UNVERIFIED");
  expect((await operation(f))!.state).toBe("FINALIZED");
  expect(
    (
      await sql`SELECT phase FROM billing_crash_provider_acceptances WHERE operation_id=${old.id}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
});
it("Customer success followed by failed Checkout preflight remains unknown even when the adapter labels the next rejection definitive", async () => {
  const f = await fixture();
  await expect(
    f.ops.session({ ...f.input, externalBoundary: "ADAPTER" }, async (ctx) => {
      await ctx.beforeMutation("CUSTOMER");
      await ctx.afterMutation("CUSTOMER");
      await ctx.onCustomerCreated!("cus_partial");
      throw new DefinitiveBillingFailure("OWNER_CHANGED");
    }),
  ).rejects.toThrow("OWNER_CHANGED");
  expect((await operation(f))!.state).toBe("RECONCILE_REQUIRED");
  expect(
    (await f.billing.customerReference(f.scope, "STRIPE")).customerRef,
  ).toBe("cus_partial");
  expect(
    (
      await sql`SELECT actor_hash FROM billing_authorizations WHERE organization_id=${f.scope.organizationId}::uuid AND revoked_at IS NULL`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
});
it("a lease expiring during asynchronous authorization cannot commit a marker or reach the provider write", async () => {
  const f = await fixture();
  let checks = 0,
    write = false;
  await expect(
    f.ops.session(
      {
        ...f.input,
        externalBoundary: "ADAPTER",
        revalidate: async (tx) => {
          checks++;
          if (checks === 3)
            await sql`UPDATE billing_operations SET lease_until=clock_timestamp()-interval '1 microsecond' WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
              tx,
            );
        },
      },
      async (ctx) => {
        await ctx.beforeMutation("CHECKOUT");
        write = true;
        return result();
      },
    ),
  ).rejects.toThrow("BILLING_OPERATION_LEASE_EXPIRED");
  expect(write).toBe(false);
  expect((await operation(f))!.external_started_at).toBeNull();
});
async function completedCheckout(f: Awaited<ReturnType<typeof fixture>>) {
  return f.ops.session(
    { ...f.input, externalBoundary: "ADAPTER" },
    async (ctx) => {
      await ctx.beforeMutation("CUSTOMER");
      await ctx.afterMutation("CUSTOMER");
      const customerRef = "cus_" + ctx.operationId;
      await ctx.onCustomerCreated!(customerRef);
      await ctx.beforeMutation("CHECKOUT");
      await ctx.afterMutation("CHECKOUT");
      return { ...result(), providerCustomerRef: customerRef };
    },
  );
}
it("departed payer financial identity manages the exact account while guild, new Owner, revoked and mismatched-account paths fail", async () => {
  const f = await fixture();
  await completedCheckout(f);
  f.discord.members.delete(payer);
  f.discord.members.get(newOwner)!.ownerId = newOwner;
  const identity = { userId: payer, checkedAt: Date.now() },
    accounts = (await f.auth.financialAccounts(identity)).filter(
      (account) => account.scope.organizationId === f.scope.organizationId,
    );
  expect(accounts).toHaveLength(1);
  for (const action of ["PORTAL", "CANCEL"] as const)
    expect(
      (
        await f.auth.authorizeFinancial(
          accounts[0]!.accountId,
          identity,
          action,
        )
      ).scope,
    ).toEqual(f.scope);
  await expect(
    f.server.actor(f.scope, payer, "WEB_DASHBOARD", "denied"),
  ).rejects.toThrow();
  await expect(
    f.auth.authorizeFinancial(
      accounts[0]!.accountId,
      { userId: newOwner, checkedAt: Date.now() },
      "PORTAL",
    ),
  ).rejects.toThrow("BILLING_PRINCIPAL_REQUIRED");
  await expect(
    f.auth.authorizeFinancial(randomUUID(), identity, "CANCEL"),
  ).rejects.toThrow("BILLING_PRINCIPAL_REQUIRED");
  await sql`UPDATE billing_authorizations SET revoked_at=now() WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
    db,
  );
  expect(
    (
      await f.auth.financialAccounts({ userId: payer, checkedAt: Date.now() })
    ).filter(
      (account) => account.scope.organizationId === f.scope.organizationId,
    ),
  ).toEqual([]);
  await expect(
    f.auth.authorizeFinancial(
      accounts[0]!.accountId,
      { userId: payer, checkedAt: Date.now() },
      "PORTAL",
    ),
  ).rejects.toThrow("BILLING_PRINCIPAL_REQUIRED");
});
it("authoritatively unpaid abandonment releases only provisional authority, retains history and archives Customer so the new Owner gets a fresh Customer", async () => {
  const f = await fixture(),
    checkout = await completedCheckout(f),
    customer = await f.billing.customerReference(f.scope, "STRIPE");
  await abandonCheckout(
    db,
    vault,
    f.scope,
    checkout.operationId!,
    f.input.principalActorHash,
    async (ref) => ({
      checkoutRef: ref,
      customerRef: customer.customerRef,
      complete: true,
      unpaid: true,
      noFinancialHistory: true,
    }),
  );
  const authorization = (
    await sql<{
      authority_state: string;
      revoked_at: Date | null;
    }>`SELECT authority_state,revoked_at FROM billing_authorizations WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
      db,
    )
  ).rows[0]!;
  expect(authorization.authority_state).toBe("RELEASED");
  expect(authorization.revoked_at).not.toBeNull();
  expect(
    (
      await sql`SELECT id FROM billing_provider_customers WHERE id=${customer.bindingId}::uuid AND archived_at IS NOT NULL`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  await expect(f.billing.customerReference(f.scope, "STRIPE")).rejects.toThrow(
    "BILLING_CUSTOMER_REFERENCE_UNAVAILABLE",
  );
  await f.ops.session(
    {
      ...f.input,
      idempotencyKey: randomUUID(),
      principalActorHash: f.auth.principalHash(f.scope, newOwner),
      externalBoundary: "ADAPTER",
    },
    async (ctx) => {
      expect(ctx.customer).toBeUndefined();
      await ctx.beforeMutation("CUSTOMER");
      await ctx.afterMutation("CUSTOMER");
      await ctx.onCustomerCreated!("cus_new_owner");
      await ctx.beforeMutation("CHECKOUT");
      return { ...result(), providerCustomerRef: "cus_new_owner" };
    },
  );
  expect(
    (await f.billing.customerReference(f.scope, "STRIPE")).customerRef,
  ).toBe("cus_new_owner");
  expect(
    (
      await sql`SELECT id FROM billing_authorization_history WHERE organization_id=${f.scope.organizationId}::uuid AND authority_state='RELEASED'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
});
it("provider verification failure retains provisional authority and blocks fresh Checkout; active authority is never released", async () => {
  const f = await fixture(),
    checkout = await completedCheckout(f);
  await expect(
    abandonCheckout(
      db,
      vault,
      f.scope,
      checkout.operationId!,
      f.input.principalActorHash,
      async () => {
        throw new Error("provider unavailable");
      },
    ),
  ).rejects.toThrow("provider unavailable");
  expect(
    (
      await sql`SELECT actor_hash FROM billing_authorizations WHERE organization_id=${f.scope.organizationId}::uuid AND revoked_at IS NULL`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  await expect(
    f.ops.session({ ...f.input, idempotencyKey: randomUUID() }, async () =>
      result(),
    ),
  ).rejects.toThrow("BILLING_RECONCILE_REQUIRED");
  const g = await fixture(),
    active = await completedCheckout(g),
    customer = await g.billing.customerReference(g.scope, "STRIPE");
  await sql`UPDATE billing_authorizations SET authority_state='ACTIVE' WHERE organization_id=${g.scope.organizationId}::uuid`.execute(
    db,
  );
  await expect(
    abandonCheckout(
      db,
      vault,
      g.scope,
      active.operationId!,
      g.input.principalActorHash,
      async (ref) => ({
        checkoutRef: ref,
        customerRef: customer.customerRef,
        complete: true,
        unpaid: true,
        noFinancialHistory: true,
      }),
    ),
  ).rejects.toThrow("BILLING_ABANDONMENT_UNCONFIRMED");
  expect(
    (await g.billing.customerReference(g.scope, "STRIPE")).customerRef,
  ).toBe(customer.customerRef);
});
it.each(["issued", "pending"])(
  "a %s Portal prevents automatic provisional release and retains financial authority",
  async (stage) => {
    const f = await fixture(),
      checkout = await completedCheckout(f),
      customer = await f.billing.customerReference(f.scope, "STRIPE");
    if (stage === "issued")
      await f.ops.session(
        {
          scope: f.scope,
          provider: "STRIPE",
          operation: "PORTAL",
          idempotencyKey: randomUUID(),
          customer,
        },
        async () => ({ url: "https://billing.stripe.com/p/session/fixture" }),
      );
    else
      await sql`INSERT INTO billing_operations(id,organization_id,guild_id,provider,operation,request_digest,input_digest,state,lease_token,lease_until) VALUES(${randomUUID()}::uuid,${f.scope.organizationId}::uuid,${f.scope.guildId},'STRIPE','PORTAL','pending-portal','pending-payload','PENDING',${randomUUID()}::uuid,clock_timestamp()+interval '2 minutes')`.execute(
        db,
      );
    const verify = vi.fn(async (ref: string) => ({
      checkoutRef: ref,
      customerRef: customer.customerRef,
      complete: true as const,
      unpaid: true as const,
      noFinancialHistory: true as const,
    }));
    await expect(
      abandonCheckout(
        db,
        vault,
        f.scope,
        checkout.operationId!,
        f.input.principalActorHash,
        verify,
      ),
    ).rejects.toThrow("BILLING_ABANDONMENT_PORTAL_REVIEW_REQUIRED");
    expect(verify).not.toHaveBeenCalled();
    expect(
      (await f.billing.customerReference(f.scope, "STRIPE")).bindingId,
    ).toBe(customer.bindingId);
    expect(
      (
        await sql`SELECT actor_hash FROM billing_authorizations WHERE organization_id=${f.scope.organizationId}::uuid AND revoked_at IS NULL`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(1);
  },
);
it("Portal cannot start while abandonment verifies its provider census", async () => {
  const f = await fixture(),
    checkout = await completedCheckout(f),
    customer = await f.billing.customerReference(f.scope, "STRIPE");
  let release!: () => void, started!: () => void;
  const verifying = new Promise<void>((resolve) => {
      started = resolve;
    }),
    wait = new Promise<void>((resolve) => {
      release = resolve;
    });
  const abandoned = abandonCheckout(
    db,
    vault,
    f.scope,
    checkout.operationId!,
    f.input.principalActorHash,
    async (ref) => {
      started();
      await wait;
      return {
        checkoutRef: ref,
        customerRef: customer.customerRef,
        complete: true,
        unpaid: true,
        noFinancialHistory: true,
      };
    },
  );
  await verifying;
  const write = vi.fn(async () => ({
    url: "https://billing.stripe.com/p/session/fixture",
  }));
  await expect(
    f.ops.session(
      {
        scope: f.scope,
        provider: "STRIPE",
        operation: "PORTAL",
        idempotencyKey: randomUUID(),
        customer,
      },
      write,
    ),
  ).rejects.toThrow("BILLING_ABANDONMENT_IN_PROGRESS");
  expect(write).not.toHaveBeenCalled();
  release();
  await abandoned;
});
it.each(["PORTAL", "CANCEL", "CHANGE"] as const)(
  "revoked financial authority during real %s adapter preflight blocks the external write",
  async (action) => {
    const f = await fixture();
    await completedCheckout(f);
    const customer = await f.billing.customerReference(f.scope, "STRIPE");
    const account = (
      await sql<{
        id: string;
      }>`SELECT id FROM billing_accounts WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
        db,
      )
    ).rows[0]!;
    const sdk = new Stripe("sk_test_fixture_only"),
      provider = new StripeBillingProvider({
        client: sdk,
        env: {
          NODE_ENV: "development",
          NEXUS_STRIPE_ENABLED: "true",
          NEXUS_STRIPE_MODE: "SANDBOX",
          STRIPE_SECRET_KEY: "sk_test_fixture_only",
          STRIPE_PORTAL_CONFIGURATION_ID: "bpc_fixture",
          NEXUS_WEB_URL: "http://localhost:3100",
        },
      });
    const revalidate = async (
      tx: Parameters<BillingAuthorization["authorizeFinancial"]>[3],
    ) => {
      await f.auth.authorizeFinancial(
        account.id,
        { userId: payer, checkedAt: Date.now() },
        action,
        tx,
      );
    };
    const revoke = async () => {
      await sql`UPDATE billing_authorizations SET revoked_at=now() WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
        db,
      );
    };
    if (action === "PORTAL") {
      vi.spyOn(sdk.customers, "retrieve").mockResolvedValue({
        id: customer.customerRef,
        livemode: false,
      } as never);
      vi.spyOn(sdk.billingPortal.configurations, "retrieve").mockImplementation(
        async () => {
          await revoke();
          return {
            id: "bpc_fixture",
            active: true,
            livemode: false,
            features: {
              subscription_update: { enabled: false },
              subscription_cancel: { enabled: true, mode: "at_period_end" },
            },
          } as never;
        },
      );
      const write = vi.spyOn(sdk.billingPortal.sessions, "create");
      await expect(
        f.ops.session(
          {
            scope: f.scope,
            provider: "STRIPE",
            operation: "PORTAL",
            idempotencyKey: randomUUID(),
            customer,
            externalBoundary: "ADAPTER",
            revalidate,
          },
          (ctx) =>
            provider.createPortalSession({
              scope: f.scope,
              customer: ctx.customer!,
              idempotencyKey: ctx.idempotencyKey,
              beforeMutation: ctx.beforeMutation,
              afterMutation: ctx.afterMutation,
            }),
        ),
      ).rejects.toThrow("BILLING_PRINCIPAL_REQUIRED");
      expect(write).not.toHaveBeenCalled();
      return;
    }
    const subscriptionId = randomUUID(),
      ref = "sub_" + subscriptionId;
    await sql`INSERT INTO billing_subscriptions(id,account_id,organization_id,provider,reference_digest,reference_ciphertext,plan_key,status,provider_event_at,provider_event_key,offering_id) VALUES(${subscriptionId}::uuid,${account.id}::uuid,${f.scope.organizationId}::uuid,'STRIPE',${vault.digest("billing-reference:STRIPE", ref)},${vault.seal(f.scope, ref)},'GROWTH','ACTIVE',now(),'fixture',${f.input.offeringId}::uuid)`.execute(
      db,
    );
    await sql`INSERT INTO billing_subscription_assignments(organization_id,guild_id,subscription_id) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${subscriptionId}::uuid)`.execute(
      db,
    );
    const currentPrice = {
      id: "price_" + f.input.offeringId,
      product: "prod_" + f.input.offeringId,
      livemode: false,
      active: true,
      currency: "usd",
      unit_amount: 4900,
      type: "recurring",
      billing_scheme: "per_unit",
      transform_quantity: null,
      tax_behavior: "exclusive",
      recurring: {
        interval: "month",
        interval_count: 1,
        usage_type: "licensed",
        trial_period_days: null,
      },
    };
    vi.spyOn(sdk.subscriptions, "retrieve").mockImplementation(async () => {
      await revoke();
      return {
        id: ref,
        livemode: false,
        status: "active",
        cancel_at_period_end: false,
        pending_update: null,
        schedule: null,
        discounts: [],
        items: {
          has_more: false,
          data: [
            {
              id: "si_fixture",
              quantity: 1,
              price: currentPrice,
              current_period_end: Math.floor(Date.now() / 1000) + 86400,
            },
          ],
        },
      } as never;
    });
    const update = vi.spyOn(sdk.subscriptions, "update"),
      schedule = vi.spyOn(sdk.subscriptionSchedules, "create");
    if (action === "CANCEL")
      await expect(
        f.billing.cancelSubscription(
          f.scope,
          provider,
          randomUUID(),
          "AT_PERIOD_END",
          revalidate,
        ),
      ).rejects.toThrow("BILLING_PRINCIPAL_REQUIRED");
    else {
      const target = randomUUID();
      await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,enabled,currency,final_price_minor,provider_product_id,provider_price_id,tax_behavior) VALUES(${target}::uuid,'STARTER',2,'STRIPE',true,'USD',1500,${"prod_" + target},${"price_" + target},'EXCLUSIVE')`.execute(
        db,
      );
      vi.spyOn(sdk.prices, "retrieve").mockResolvedValue({
        ...currentPrice,
        id: "price_" + target,
        product: "prod_" + target,
        unit_amount: 1500,
      } as never);
      vi.spyOn(sdk.products, "retrieve").mockResolvedValue({
        id: "prod_" + target,
        livemode: false,
        active: true,
      } as never);
      await expect(
        f.billing.changeSubscription(
          f.scope,
          provider,
          target,
          randomUUID(),
          { effective: "AT_PERIOD_END", proration: "NONE" },
          revalidate,
        ),
      ).rejects.toThrow("BILLING_PRINCIPAL_REQUIRED");
    }
    expect(update).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  },
);
