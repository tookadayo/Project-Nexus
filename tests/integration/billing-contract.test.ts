import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import {
  connect,
  ensureGuild,
  migrate,
  sql,
  type Database,
} from "../../packages/db/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import {
  BillingOperationService,
  DefinitiveBillingFailure,
  BillingService,
  EntitlementService,
  StripeBillingProvider,
  checkoutOffering,
  offeringFingerprint,
  type BillingOffering,
  type NormalizedBillingEvent,
  type ProviderReconcileRequest,
  type ProviderReconcileResult,
  type ProviderSignal,
  type ChangeSubscriptionRequest,
  type CancelSubscriptionRequest,
} from "../../packages/settings/src/billing";
import { deleteBillingCommunity } from "../../packages/security/src/billing-privacy";
let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
const vault = new IdentityVault("11".repeat(32), "22".repeat(32));
let guild = 922222222222220000n;
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
  vi.stubEnv("NEXUS_BILLING_DEVELOPER_COUNTRY", "JP");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db?.destroy();
  await infra?.stop();
});
async function fixture(organizationId = randomUUID()) {
  const scope = { organizationId, guildId: String(guild++) };
  await ensureGuild(db, scope);
  let account = (
    await sql<{
      id: string;
    }>`SELECT id FROM billing_accounts WHERE organization_id=${organizationId}::uuid`.execute(
      db,
    )
  ).rows[0]?.id;
  if (!account) {
    account = randomUUID();
    await sql`INSERT INTO billing_accounts(id,organization_id) VALUES(${account}::uuid,${organizationId}::uuid)`.execute(
      db,
    );
  }
  const customerRef = "fixture-customer:" + scope.guildId;
  await sql`INSERT INTO billing_provider_customers(id,account_id,provider,reference_digest,reference_ciphertext,reference_guild_id) VALUES(${randomUUID()}::uuid,${account}::uuid,'STRIPE',${vault.digest("billing-customer-reference:STRIPE", customerRef)},${vault.seal(scope, customerRef)},${scope.guildId}) ON CONFLICT(account_id,provider) DO NOTHING`.execute(
    db,
  );
  return {
    scope,
    customerRef,
    billing: new BillingService(db, vault),
    operations: new BillingOperationService(db, vault),
    entitlements: new EntitlementService(db),
  };
}
async function offer(amount = 4900) {
  const id = randomUUID();
  await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,provider_product_id,provider_price_id,billing_interval,currency,final_price_minor,tax_behavior,enabled) VALUES(${id}::uuid,'GROWTH',2,'STRIPE',${"fixture-product:" + id},${"fixture-price:" + id},'MONTH','JPY',${amount},'EXCLUSIVE',true)`.execute(
    db,
  );
  return checkoutOffering(db, id);
}
function snapshot(
  scope: Awaited<ReturnType<typeof fixture>>["scope"],
  patch: Partial<NormalizedBillingEvent> = {},
): NormalizedBillingEvent {
  return {
    scope,
    provider: "STRIPE",
    eventId: randomUUID(),
    subscriptionRef: "fixture-subscription:" + scope.guildId,
    plan: "GROWTH",
    status: "ACTIVE",
    occurredAt: new Date().toISOString(),
    version: 0,
    periodEnd: new Date(Date.now() + 86400000).toISOString(),
    scheduledPlan: null,
    scheduledAt: null,
    authoritative: true,
    ...patch,
  };
}
class FixtureStripe extends StripeBillingProvider {
  constructor(
    private readonly retrieve: (
      input: ProviderReconcileRequest,
    ) => Promise<ProviderReconcileResult>,
    private readonly signals: ProviderSignal[] = [],
  ) {
    super();
  }
  override reconcile(input: ProviderReconcileRequest) {
    return this.retrieve(input);
  }
  override async verifyWebhook() {
    return this.signals;
  }
}
const census = (events: NormalizedBillingEvent[]): ProviderReconcileResult => ({
  kind: "FULL_CENSUS",
  complete: true,
  events,
});
async function project(billing: BillingService) {
  for (let i = 0; i < 20; i++) if (!(await billing.projectOne())) return;
  throw new Error("PROJECTOR_NOT_DRAINED");
}
async function confirmed(
  f: Awaited<ReturnType<typeof fixture>>,
  patch: Partial<NormalizedBillingEvent> = {},
) {
  await f.billing.reconcileLatest(
    f.scope,
    new FixtureStripe(async () => census([snapshot(f.scope, patch)])),
  );
  await project(f.billing);
}
it("configured Checkout remains distinguishable from a purchase blocked by an existing subscription", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXUS_STRIPE_ENABLED", "true");
  vi.stubEnv("NEXUS_STRIPE_MODE", "SANDBOX");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture_presentation");
  try {
    const f = await fixture();
    await offer();
    await confirmed(f);
    const configured = (await f.billing.view(f.scope)).presentation.billingActions.purchase.find(a => a.method === "CHECKOUT");
    expect(configured).toMatchObject({configured:true, available:false});
    vi.stubEnv("NEXUS_STRIPE_ENABLED", "false");
    const disabled = (await f.billing.view(f.scope)).presentation.billingActions.purchase.find(a => a.method === "CHECKOUT");
    expect(disabled).toMatchObject({configured:false, available:false});
  } finally {
    vi.unstubAllEnvs();
    vi.stubEnv("NEXUS_BILLING_DEVELOPER_COUNTRY", "JP");
  }
});
it("immutable enabled financial identity survives disable; operational review remains editable", async () => {
  const offering = await offer();
  for (const [column, value] of [
    ["plan_key", "STARTER"],
    ["plan_revision", 3],
    ["provider", "DISCORD"],
    ["provider_product_id", "changed"],
    ["provider_price_id", "changed"],
    ["provider_offering_id", "changed"],
    ["billing_interval", "YEAR"],
    ["billing_interval_count", 2],
    ["currency", "USD"],
    ["final_price_minor", 1],
    ["tax_behavior", "INCLUSIVE"],
  ] as const) {
    await expect(
      sql`UPDATE billing_offerings SET ${sql.ref(column)}=${value} WHERE id=${offering.id}::uuid`.execute(
        db,
      ),
    ).rejects.toThrow("BILLING_OFFERING_IMMUTABLE");
  }
  await sql`UPDATE billing_offerings SET enabled=false,parity_reviewed_at=now() WHERE id=${offering.id}::uuid`.execute(
    db,
  );
  await expect(
    sql`UPDATE billing_offerings SET final_price_minor=1 WHERE id=${offering.id}::uuid`.execute(
      db,
    ),
  ).rejects.toThrow("BILLING_OFFERING_IMMUTABLE");
});
it("trusted financial Offering fingerprint binds the key and stable provider key", async () => {
  const f = await fixture(),
    first = await offer(),
    changed = await offer(5000),
    key = randomUUID();
  const execute = vi.fn(
    async (context: { idempotencyKey: string; offering?: BillingOffering }) => {
      expect(context.idempotencyKey).toBe(key);
      expect(context.offering).toEqual(first);
      return {
        url: "https://fixture.invalid/checkout",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        providerCheckoutRef: "fixture-session",
      };
    },
  );
  await f.operations.session(
    {
      scope: f.scope,
      operation: "CHECKOUT",
      provider: "STRIPE",
      idempotencyKey: key,
      offeringId: first.id,
    },
    execute,
  );
  await expect(
    f.operations.session(
      {
        scope: f.scope,
        operation: "CHECKOUT",
        provider: "STRIPE",
        idempotencyKey: key,
        offeringId: changed.id,
      },
      execute,
    ),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  expect(execute).toHaveBeenCalledTimes(1);
  for (const patch of [
    { unitAmountMinor: 1 },
    { providerPriceId: "new-price" },
    { providerProductId: "new-product" },
    { taxBehavior: "INCLUSIVE" as const },
    { billingIntervalCount: 2 },
    { currency: "USD" },
    { planRevision: 3 },
  ])
    expect(offeringFingerprint({ ...first, ...patch })).not.toBe(
      offeringFingerprint(first),
    );
});
it("portal omits provider expiry and cached checkout retains its actual authoritative expiry", async () => {
  const f = await fixture(),
    customer = await f.billing.customerReference(f.scope, "STRIPE");
  const portal = await f.operations.session(
    {
      scope: f.scope,
      operation: "PORTAL",
      provider: "STRIPE",
      idempotencyKey: randomUUID(),
      customer,
    },
    async () => ({ url: "https://fixture.invalid/portal" }),
  );
  expect(portal).toHaveProperty("cacheUntil");
  expect(portal).not.toHaveProperty("expiresAt");
  const offering = await offer(),
    input = {
      scope: f.scope,
      operation: "CHECKOUT" as const,
      provider: "STRIPE" as const,
      idempotencyKey: randomUUID(),
      offeringId: offering.id,
    };
  const expiresAt = new Date(Date.now() + 600000).toISOString(),
    execute = vi.fn(async () => ({
      url: "https://fixture.invalid/checkout",
      expiresAt,
      providerCheckoutRef: "fixture-authoritative-session",
    }));
  await f.operations.session(input, execute);
  expect(await f.operations.session(input, execute)).toMatchObject({
    expiresAt,
  });
  expect(execute).toHaveBeenCalledTimes(1);
});
it("checkout lacking authoritative expiry becomes unknown and never blindly retries", async () => {
  const f = await fixture(),
    offering = await offer(),
    input = {
      scope: f.scope,
      operation: "CHECKOUT" as const,
      provider: "STRIPE" as const,
      idempotencyKey: randomUUID(),
      offeringId: offering.id,
    };
  const execute = vi.fn(async () => ({
    url: "https://fixture.invalid/checkout",
    providerCheckoutRef: "fixture-session",
  }));
  await expect(f.operations.session(input, execute)).rejects.toThrow(
    "BILLING_SESSION_EXPIRY_REQUIRED",
  );
  await expect(f.operations.session(input, execute)).rejects.toThrow(
    "BILLING_RECONCILE_REQUIRED",
  );
  expect(execute).toHaveBeenCalledTimes(1);
});
it("one stable key cannot be reused across operation or provider contracts", async () => {
  const f = await fixture(),
    customer = await f.billing.customerReference(f.scope, "STRIPE"),
    key = randomUUID();
  await f.operations.session(
    {
      scope: f.scope,
      operation: "PORTAL",
      provider: "STRIPE",
      idempotencyKey: key,
      customer,
    },
    async () => ({ url: "https://fixture.invalid/portal" }),
  );
  const execute = vi.fn();
  await expect(
    f.operations.session(
      {
        scope: f.scope,
        operation: "CHECKOUT",
        provider: "STRIPE",
        idempotencyKey: key,
      },
      execute,
    ),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  await expect(
    f.operations.session(
      {
        scope: f.scope,
        operation: "PORTAL",
        provider: "DISCORD",
        idempotencyKey: key,
      },
      execute,
    ),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  expect(execute).not.toHaveBeenCalled();
});
it.each(["ACTIVE", "CANCEL_AT_PERIOD_END"] as const)(
  "complete empty Stripe census removes stale %s paid access",
  async (status) => {
    const f = await fixture();
    await confirmed(f, { status });
    expect(await f.entitlements.plan(f.scope)).toBe("GROWTH");
    await f.billing.reconcileLatest(
      f.scope,
      new FixtureStripe(async () => census([])),
    );
    await project(f.billing);
    expect(await f.entitlements.plan(f.scope)).toBe("FREE");
  },
);
it("authoritative cancellation ends access even with a future provider period boundary", async () => {
  const f = await fixture();
  await confirmed(f);
  expect(await f.entitlements.plan(f.scope)).toBe("GROWTH");
  await f.billing.reconcileLatest(f.scope,new FixtureStripe(async () => census([snapshot(f.scope,{status:"CANCELED"})])));
  await project(f.billing);
  expect(await f.entitlements.plan(f.scope)).toBe("FREE");
});
it("empty complete census supersedes a previously retrieved but unprojected positive snapshot", async () => {
  const f = await fixture();
  await f.billing.reconcileLatest(
    f.scope,
    new FixtureStripe(async () => census([snapshot(f.scope)])),
  );
  await f.billing.reconcileLatest(
    f.scope,
    new FixtureStripe(async () => census([])),
  );
  await sql`UPDATE billing_provider_events SET received_at=now()-interval '1 day' WHERE organization_id=${f.scope.organizationId}::uuid AND (normalized->>'version')::integer=2`.execute(
    db,
  );
  await project(f.billing);
  expect(await f.entitlements.plan(f.scope)).toBe("FREE");
});
it.each(["incomplete", "network"])(
  "%s retrieval retains only bounded last good access even without period end",
  async (kind) => {
    const f = await fixture();
    await confirmed(f, { periodEnd: null });
    const provider = new FixtureStripe(async () => {
      if (kind === "network") throw new Error("fixture-network-failure");
      return { kind: "INCOMPLETE", events: [], reason: "PARTIAL" };
    });
    await expect(
      f.billing.reconcileLatest(f.scope, provider),
    ).rejects.toThrow();
    expect(await f.entitlements.plan(f.scope)).toBe("GROWTH");
    expect(
      (
        await f.entitlements.effective(
          f.scope,
          new Date(Date.now() + 73 * 3600000),
        )
      ).plan,
    ).toBe("FREE");
    expect(
      (
        await sql<{
          status: string;
        }>`SELECT status FROM billing_subscriptions WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
          db,
        )
      ).rows[0]!.status,
    ).toBe("UNKNOWN");
  },
);
it.each(["ACTIVE", "SUSPENDED"] as const)(
  "existing %s subscription rejects new checkout before the provider",
  async (status) => {
    const f = await fixture();
    await confirmed(f, { status });
    const offering = await offer(),
      execute = vi.fn();
    await expect(
      f.operations.session(
        {
          scope: f.scope,
          operation: "CHECKOUT",
          provider: "STRIPE",
          idempotencyKey: randomUUID(),
          offeringId: offering.id,
        },
        execute,
      ),
    ).rejects.toThrow("BILLING_EXISTING_SUBSCRIPTION");
    expect(execute).not.toHaveBeenCalled();
  },
);
it("different concurrent checkout keys cannot create two sessions or retry unknown initiation", async () => {
  const f = await fixture(),
    offering = await offer();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = vi.fn(async () => {
    await wait;
    throw new Error("fixture-timeout-after-start");
  });
  const first = f.operations.session(
    {
      scope: f.scope,
      operation: "CHECKOUT",
      provider: "STRIPE",
      idempotencyKey: randomUUID(),
      offeringId: offering.id,
    },
    execute,
  );
  const firstFailure = expect(first).rejects.toThrow(
    "fixture-timeout-after-start",
  );
  for (let i = 0; i < 50 && execute.mock.calls.length === 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  await expect(
    f.operations.session(
      {
        scope: f.scope,
        operation: "CHECKOUT",
        provider: "STRIPE",
        idempotencyKey: randomUUID(),
        offeringId: offering.id,
      },
      execute,
    ),
  ).rejects.toThrow("BILLING_RECONCILE_REQUIRED");
  release();
  await firstFailure;
  expect(execute).toHaveBeenCalledTimes(1);
});
it("a provider reference cannot bind a second guild within the same organization", async () => {
  const f = await fixture();
  await confirmed(f);
  const other = await fixture(f.scope.organizationId);
  await expect(
    other.billing.reconcileLatest(
      other.scope,
      new FixtureStripe(async () =>
        census([
          snapshot(other.scope, {
            subscriptionRef: "fixture-subscription:" + f.scope.guildId,
          }),
        ]),
      ),
    ),
  ).rejects.toThrow();
  const event = snapshot(f.scope, {
    provider: "DISCORD",
    subscriptionRef: "fixture-discord-subscription",
  });
  await f.billing.storeVerified(event);
  await project(f.billing);
  await expect(
    other.billing.storeVerified({
      ...event,
      eventId: randomUUID(),
      scope: other.scope,
    }),
  ).rejects.toThrow("BILLING_SCOPE_CONFLICT");
  const assignment = (
    await sql<{
      guild_id: string;
    }>`SELECT a.guild_id FROM billing_subscription_assignments a JOIN billing_subscriptions b ON b.id=a.subscription_id WHERE b.reference_digest=${vault.digest("billing-reference:DISCORD", event.subscriptionRef)}`.execute(
      db,
    )
  ).rows;
  expect(assignment).toEqual([{ guild_id: f.scope.guildId }]);
});
it("metadata, customer IDs and operation IDs alone never establish signal scope ownership", async () => {
  const f = await fixture(),
    base: ProviderSignal = {
      provider: "STRIPE",
      eventId: randomUUID(),
      scope: f.scope,
      subscriptionRef: "fixture-unbound",
    };
  for (const signal of [
    base,
    { ...base, customerRef: f.customerRef },
    {
      ...base,
      checkoutOperationId: randomUUID(),
      checkoutRef: "fixture-session",
    },
  ])
    await expect(
      f.billing.receive(
        new FixtureStripe(async () => census([]), [signal]),
        Buffer.from("verified"),
        {},
      ),
    ).rejects.toThrow("BILLING_SCOPE_UNRESOLVED");
  expect(
    (
      await sql`SELECT id FROM billing_provider_signals WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  const signal = {
    ...base,
    customerRef: f.customerRef,
    bindingEvidence: {
      kind: "CUSTOMER_SUBSCRIPTION" as const,
      customerRef: f.customerRef,
      subscriptionRef: base.subscriptionRef,
    },
  };
  expect(
    await f.billing.receive(
      new FixtureStripe(async () => census([]), [signal]),
      Buffer.from("verified"),
      {},
    ),
  ).toEqual({ accepted: 1 });
  await expect(
    f.billing.receive(
      new FixtureStripe(
        async () => census([]),
        [
          {
            ...signal,
            eventId: randomUUID(),
            scope: { ...f.scope, guildId: String(guild++) },
          },
        ],
      ),
      Buffer.from("verified"),
      {},
    ),
  ).rejects.toThrow("BILLING_SCOPE_CONFLICT");
});
it.each(["creation", "completion"])(
  "Core binds the verified Checkout Customer at %s for subsequent Portal and privacy deletion",
  async (stage) => {
    const f = await fixture(),
      offering = await offer();
    await sql`DELETE FROM billing_provider_customers WHERE reference_guild_id=${f.scope.guildId}`.execute(
      db,
    );
    const customerRef = "fixture-created-customer:" + f.scope.guildId,
      checkoutRef = "fixture-created-session:" + f.scope.guildId;
    let operationId = "";
    await f.operations.session(
      {
        scope: f.scope,
        operation: "CHECKOUT",
        provider: "STRIPE",
        idempotencyKey: randomUUID(),
        offeringId: offering.id,
      },
      async (context) => {
        expect(context.customer).toBeUndefined();
        operationId = context.operationId;
        return {
          url: "https://fixture.invalid/checkout",
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          providerCheckoutRef: checkoutRef,
          providerCustomerRef: stage === "creation" ? customerRef : undefined,
        };
      },
    );
    if (stage === "completion") {
      await expect(
        f.billing.customerReference(f.scope, "STRIPE"),
      ).rejects.toThrow("BILLING_CUSTOMER_REFERENCE_UNAVAILABLE");
      const subscriptionRef = "fixture-created-subscription:" + f.scope.guildId;
      const signal: ProviderSignal = {
        provider: "STRIPE",
        eventId: randomUUID(),
        subscriptionRef,
        checkoutOperationId: operationId,
        checkoutRef,
        bindingEvidence: {
          kind: "CHECKOUT_SUBSCRIPTION",
          checkoutRef,
          subscriptionRef,
          customerRef,
        },
      };
      await f.billing.receive(
        new FixtureStripe(async () => census([]), [signal]),
        Buffer.from("verified"),
        {},
      );
    }
    const customer = await f.billing.customerReference(f.scope, "STRIPE");
    expect(customer.customerRef).toBe(customerRef);
    const completion=(await sql<{checkout_completed_at:Date|null}>`SELECT checkout_completed_at FROM billing_operations WHERE id=${operationId}::uuid`.execute(db)).rows[0]!.checkout_completed_at;
    expect(Boolean(completion)).toBe(stage === "completion");
    const stored = (
      await sql<{
        reference_ciphertext: string;
        reference_digest: string;
        reference_guild_id: string;
      }>`SELECT reference_ciphertext,reference_digest,reference_guild_id FROM billing_provider_customers WHERE id=${customer.bindingId}::uuid`.execute(
        db,
      )
    ).rows[0]!;
    expect(stored.reference_ciphertext).not.toContain(customerRef);
    expect(stored.reference_digest).toBe(
      vault.digest("billing-customer-reference:STRIPE", customerRef),
    );
    expect(stored.reference_guild_id).toBe(f.scope.guildId);
    const portal = await f.operations.session(
      {
        scope: f.scope,
        operation: "PORTAL",
        provider: "STRIPE",
        idempotencyKey: randomUUID(),
        customer,
      },
      async (context) => {
        expect(context.customer).toEqual(customer);
        return { url: "https://fixture.invalid/portal" };
      },
    );
    expect(portal).not.toHaveProperty("expiresAt");
    await db.transaction().execute((tx) => deleteBillingCommunity(tx, f.scope));
    expect(
      (
        await sql`SELECT id FROM billing_operations WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await sql`SELECT id FROM billing_provider_customers WHERE reference_guild_id=${f.scope.guildId}`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
  },
);
it("a Customer already encrypted for another guild cannot be reassigned by a Checkout result", async () => {
  const first = await fixture(),
    other = await fixture(),
    offering = await offer();
  await sql`DELETE FROM billing_provider_customers WHERE reference_guild_id=${other.scope.guildId}`.execute(
    db,
  );
  await expect(
    other.operations.session(
      {
        scope: other.scope,
        operation: "CHECKOUT",
        provider: "STRIPE",
        idempotencyKey: randomUUID(),
        offeringId: offering.id,
      },
      async () => ({
        url: "https://fixture.invalid/checkout",
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        providerCheckoutRef: "fixture-cross-guild-session",
        providerCustomerRef: first.customerRef,
      }),
    ),
  ).rejects.toThrow("BILLING_SCOPE_CONFLICT");
  expect(
    (await first.billing.customerReference(first.scope, "STRIPE")).customerRef,
  ).toBe(first.customerRef);
  await expect(
    other.billing.customerReference(other.scope, "STRIPE"),
  ).rejects.toThrow("BILLING_CUSTOMER_REFERENCE_UNAVAILABLE");
  expect(
    (
      await sql<{
        state: string;
      }>`SELECT state FROM billing_operations WHERE organization_id=${other.scope.organizationId}::uuid`.execute(
        db,
      )
    ).rows[0]!.state,
  ).toBe("RECONCILE_REQUIRED");
});
it("arbitrary public reconciliation targets fail before external retrieval", async () => {
  const f = await fixture(),
    retrieve = vi.fn(async () => census([]));
  await expect(
    f.billing.reconcileLatest(
      f.scope,
      new FixtureStripe(retrieve),
      "fixture-arbitrary-reference",
    ),
  ).rejects.toThrow("BILLING_SCOPE_UNRESOLVED");
  expect(retrieve).not.toHaveBeenCalled();
});
it("targeted absence is authoritative only for the requested trusted subscription", async () => {
  const f = await fixture();
  await confirmed(f);
  const reference = "fixture-subscription:" + f.scope.guildId;
  await expect(
    f.billing.reconcileLatest(
      f.scope,
      new FixtureStripe(async () => census([])),
      reference,
    ),
  ).rejects.toThrow("BILLING_RECONCILIATION_TARGET_INVALID");
  await expect(
    f.billing.reconcileLatest(
      f.scope,
      new FixtureStripe(async () => ({
        kind: "TARGET_ABSENT",
        subscriptionRef: "fixture-wrong-target",
      })),
      reference,
    ),
  ).rejects.toThrow("BILLING_RECONCILIATION_TARGET_INVALID");
  expect(await f.entitlements.plan(f.scope)).toBe("GROWTH");
  await f.billing.reconcileLatest(
    f.scope,
    new FixtureStripe(async () => ({
      kind: "TARGET_ABSENT",
      subscriptionRef: reference,
    })),
    reference,
  );
  await project(f.billing);
  expect(await f.entitlements.plan(f.scope)).toBe("FREE");
});
it("full census rejects target-only or malformed completeness claims without canceling", async () => {
  const f = await fixture();
  await confirmed(f);
  await expect(
    f.billing.reconcileLatest(
      f.scope,
      new FixtureStripe(async () => ({
        kind: "TARGET_FOUND",
        subscription: snapshot(f.scope),
      })),
    ),
  ).rejects.toThrow("BILLING_RECONCILIATION_TARGET_INVALID");
  await expect(
    f.billing.reconcileLatest(
      f.scope,
      new FixtureStripe(
        async () =>
          ({
            kind: "FULL_CENSUS",
            complete: false,
            events: [],
          }) as unknown as ProviderReconcileResult,
      ),
    ),
  ).rejects.toThrow();
  expect(await f.entitlements.plan(f.scope)).toBe("GROWTH");
});
it("Offering revision association projects revision 3 and remains immutable after disabling", async () => {
  const f = await fixture(),
    id = randomUUID();
  await sql`INSERT INTO billing_plan_versions(plan_key,revision,features,limits) SELECT plan_key,3,features,limits FROM billing_plan_versions WHERE plan_key='GROWTH' AND revision=2 ON CONFLICT DO NOTHING`.execute(
    db,
  );
  await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,provider_product_id,provider_price_id,currency,final_price_minor,tax_behavior,enabled) VALUES(${id}::uuid,'GROWTH',3,'STRIPE',${"fixture-product:" + id},${"fixture-price:" + id},'JPY',5000,'EXCLUSIVE',true)`.execute(
    db,
  );
  const offering = await checkoutOffering(db, id),
    association = {
      offeringId: id,
      fingerprint: offeringFingerprint(offering),
    };
  await f.billing.reconcileLatest(
    f.scope,
    new FixtureStripe(async (request) => {
      expect(request.offerings).toContainEqual(offering);
      return census([
        snapshot(f.scope, {
          planRevision: 3,
          offeringAssociation: association,
        }),
      ]);
    }),
  );
  await project(f.billing);
  expect(
    (
      await sql<{
        plan_revision: number;
        offering_id: string;
      }>`SELECT plan_revision,offering_id FROM billing_subscriptions WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
        db,
      )
    ).rows[0],
  ).toEqual({ plan_revision: 3, offering_id: id });
  await sql`UPDATE billing_offerings SET enabled=false WHERE id=${id}::uuid`.execute(
    db,
  );
  await f.billing.reconcileLatest(
    f.scope,
    new FixtureStripe(async () => census([])),
  );
  await project(f.billing);
  expect(await f.entitlements.plan(f.scope)).toBe("FREE");
  expect(
    (
      await sql<{
        plan_revision: number;
      }>`SELECT plan_revision FROM billing_subscriptions WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
        db,
      )
    ).rows[0]!.plan_revision,
  ).toBe(3);
});
it.each(["CHANGE", "CANCEL"] as const)(
  "unknown %s outcomes retain stable mutation identifiers and forbid blind retry",
  async (operation) => {
    const f = await fixture();
    await confirmed(f);
    const offering = await offer(),
      key = randomUUID();
    let calls = 0;
    class MutationStripe extends FixtureStripe {
      override async changeSubscription(input: ChangeSubscriptionRequest) {
        calls++;
        expect(input.subscription.subscriptionRef).toBe(
          "fixture-subscription:" + f.scope.guildId,
        );
        expect(input.offering).toEqual(offering);
        expect(input.idempotencyKey).toBe(key);
        throw new Error("fixture-outcome-unknown");
      }
      override async cancel(
        input: CancelSubscriptionRequest,
      ): Promise<{ scheduledAt: string | null }> {
        calls++;
        expect(input.policy).toBe("AT_PERIOD_END");
        expect(input.idempotencyKey).toBe(key);
        throw new Error("fixture-outcome-unknown");
      }
    }
    const provider = new MutationStripe(async () => census([]));
    const invoke = () =>
      operation === "CHANGE"
        ? f.billing.changeSubscription(f.scope, provider, offering.id, key, {
            effective: "AT_PERIOD_END",
            proration: "NONE",
          })
        : f.billing.cancelSubscription(f.scope, provider, key, "AT_PERIOD_END");
    await expect(invoke()).rejects.toThrow("fixture-outcome-unknown");
    await expect(invoke()).rejects.toThrow("BILLING_RECONCILE_REQUIRED");
    const freshKey = randomUUID();
    await expect(
      f.billing.changeSubscription(f.scope, provider, offering.id, freshKey, {
        effective: "AT_PERIOD_END",
        proration: "NONE",
      }),
    ).rejects.toThrow("BILLING_RECONCILE_REQUIRED");
    await expect(
      f.billing.cancelSubscription(
        f.scope,
        provider,
        randomUUID(),
        "AT_PERIOD_END",
      ),
    ).rejects.toThrow("BILLING_RECONCILE_REQUIRED");
    const stored = (
      await sql<{
        subscription_id: string;
      }>`SELECT subscription_id FROM billing_operations WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
        db,
      )
    ).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.subscription_id).toBe(
      (await f.billing.subscriptionReference(f.scope, "STRIPE")).bindingId,
    );
    expect(calls).toBe(1);
  },
);
it.each(["CHANGE", "CANCEL"] as const)(
  "an in-flight %s blocks cross-key mutations but keeps completed prior cache replayable",
  async (operation) => {
    const f = await fixture();
    await confirmed(f);
    const offering = await offer(),
      subscription = await f.billing.subscriptionReference(f.scope, "STRIPE");
    const completedKey = randomUUID();
    const completed = {
      scope: f.scope,
      provider: "STRIPE" as const,
      operation: "CANCEL" as const,
      idempotencyKey: completedKey,
      subscription,
      policy: "AT_PERIOD_END",
    };
    const prior = vi.fn(async () => ({
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    }));
    const completedResult = await f.operations.mutation(completed, prior);
    // An accepted mutation fences new keys until its authoritative effect is observed.
    await expect(f.operations.mutation({ ...completed, idempotencyKey: randomUUID() }, prior)).rejects.toThrow("BILLING_RECONCILE_REQUIRED");
    await confirmed(f, { status: "CANCEL_AT_PERIOD_END" });
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async () => {
      await hold;
      throw new Error("fixture-mutation-timeout");
    });
    const inFlight = {
      scope: f.scope,
      provider: "STRIPE" as const,
      operation,
      idempotencyKey: randomUUID(),
      offeringId: operation === "CHANGE" ? offering.id : undefined,
      subscription,
      policy:
        operation === "CHANGE"
          ? { effective: "AT_PERIOD_END", proration: "NONE" }
          : "AT_PERIOD_END",
    };
    const pending = f.operations.mutation(inFlight, execute),
      failure = expect(pending).rejects.toThrow("fixture-mutation-timeout");
    for (let i = 0; i < 50 && execute.mock.calls.length === 0; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(
      f.billing.cancelSubscription(
        f.scope,
        new FixtureStripe(async () => census([])),
        randomUUID(),
        "IMMEDIATE",
      ),
    ).rejects.toThrow("BILLING_RECONCILE_REQUIRED");
    expect(await f.operations.mutation(completed, prior)).toEqual(
      completedResult,
    );
    expect(prior).toHaveBeenCalledTimes(1);
    release();
    await failure;
    expect(execute).toHaveBeenCalledTimes(1);
  },
);
it.each(["CHANGE", "CANCEL"] as const)(
  "definitive %s failure retries stop at the stored 23-hour horizon",
  async (operation) => {
    const f = await fixture();
    await confirmed(f);
    const offering = await offer(),
      subscription = await f.billing.subscriptionReference(f.scope, "STRIPE");
    const key = randomUUID(),
      input = {
        scope: f.scope,
        provider: "STRIPE" as const,
        operation,
        idempotencyKey: key,
        offeringId: operation === "CHANGE" ? offering.id : undefined,
        subscription,
        policy:
          operation === "CHANGE"
            ? { effective: "IMMEDIATE", proration: "NONE" }
            : "AT_PERIOD_END",
      };
    const execute = vi.fn(async (context: { idempotencyKey: string }) => {
      expect(context.idempotencyKey).toBe(key);
      throw new DefinitiveBillingFailure("fixture-confirmed-no-mutation");
    });
    await expect(f.operations.mutation(input, execute)).rejects.toThrow(
      "fixture-confirmed-no-mutation",
    );
    await expect(f.operations.mutation(input, execute)).rejects.toThrow(
      "fixture-confirmed-no-mutation",
    );
    const row = (
      await sql<{
        created_at: Date;
        retry_until: Date;
        state: string;
      }>`SELECT created_at,retry_until,state FROM billing_operations WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
        db,
      )
    ).rows[0]!;
    expect(row.retry_until.getTime() - row.created_at.getTime()).toBe(
      23 * 3600000,
    );
    expect(row.state).toBe("FAILED");
    await sql`UPDATE billing_operations SET retry_until=now()-interval '1 second' WHERE organization_id=${f.scope.organizationId}::uuid`.execute(
      db,
    );
    await expect(f.operations.mutation(input, execute)).rejects.toThrow(
      "BILLING_RECONCILE_REQUIRED",
    );
    expect(execute).toHaveBeenCalledTimes(2);
  },
);
