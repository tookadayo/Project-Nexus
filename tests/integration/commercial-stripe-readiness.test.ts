import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  type Database,
} from "../../packages/db/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import {
  BillingService,
  BillingOperationService,
  StripeBillingProvider,
  EntitlementService,
  PromotionService,
  PromotionReservationService,
  campaignSchema,
  checkoutOffering,
  type NormalizedBillingEvent,
  type ProviderReconcileRequest,
  type ProviderReconcileResult,
  type ProviderSignal,
} from "../../packages/settings/src/billing";
import { internalBillingActor } from "../../packages/security/src/billing-authorization";
import { deleteBillingCommunity } from "../../packages/security/src/billing-privacy";
let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32));
const admin = internalBillingActor(
  "555555555555555555",
  vault,
  "Stripe readiness fixture",
  { NEXUS_INTERNAL_ADMIN_IDS: "555555555555555555" },
);
let guild = 811111111111110000n;
const scope = () => ({
  organizationId: randomUUID(),
  guildId: String(guild++),
});
let legacy: ReturnType<typeof scope>;
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db, { throughVersion: 37 });
  legacy = scope();
  await ensureGuild(db, legacy);
  const account = randomUUID();
  await sql`INSERT INTO billing_accounts(id,organization_id) VALUES(${account}::uuid,${legacy.organizationId}::uuid)`.execute(
    db,
  );
  await sql`INSERT INTO billing_subscriptions(id,account_id,organization_id,provider,reference_digest,reference_ciphertext,plan_key,status,confirmed_at,provider_event_at,provider_event_key) VALUES(${randomUUID()}::uuid,${account}::uuid,${legacy.organizationId}::uuid,'EXTERNAL','preserved-digest','preserved-sealed','GROWTH','ACTIVE',now(),now(),'preserved-event')`.execute(
    db,
  );
  await sql`INSERT INTO billing_provider_events(id,provider,event_digest,organization_id,guild_id,normalized,verified_at) VALUES(${randomUUID()}::uuid,'EXTERNAL','historical-event',${legacy.organizationId}::uuid,${legacy.guildId},'{"provider":"EXTERNAL","referenceDigest":"unchanged"}',now())`.execute(
    db,
  );
  await migrate(db);
  await sql`UPDATE billing_provider_events SET projected_at=now() WHERE event_digest='historical-event'`.execute(
    db,
  );
  vi.stubEnv("NEXUS_BILLING_DEVELOPER_COUNTRY", "JP");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db?.destroy();
  await infra?.stop();
});
async function fixture() {
  const s = scope();
  await ensureGuild(db, s);
  const account = randomUUID();
  const customerRef = "fixture-customer:" + s.guildId;
  await sql`INSERT INTO billing_accounts(id,organization_id) VALUES(${account}::uuid,${s.organizationId}::uuid)`.execute(
    db,
  );
  await sql`INSERT INTO billing_provider_customers(id,account_id,provider,reference_digest,reference_ciphertext,reference_guild_id) VALUES(${randomUUID()}::uuid,${account}::uuid,'STRIPE',${vault.digest("billing-customer-reference:STRIPE", customerRef)},${vault.seal(s, customerRef)},${s.guildId})`.execute(
    db,
  );
  return {
    s,
    billing: new BillingService(db, vault),
    entitlements: new EntitlementService(db),
  };
}
function snapshot(
  s: ReturnType<typeof scope>,
  patch: Partial<NormalizedBillingEvent> = {},
): NormalizedBillingEvent {
  return {
    scope: s,
    eventId: randomUUID(),
    provider: "STRIPE",
    subscriptionRef: "fixture:" + s.guildId,
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
    private readonly latest: () => Promise<NormalizedBillingEvent[]>,
  ) {
    super();
  }
  override async reconcile(
    input: ProviderReconcileRequest,
  ): Promise<ProviderReconcileResult> {
    const events = await this.latest();
    if (input.target) {
      const subscription = events.find(
        (event) => event.subscriptionRef === input.target!.subscriptionRef,
      );
      return subscription
        ? { kind: "TARGET_FOUND", subscription }
        : {
            kind: "TARGET_ABSENT",
            subscriptionRef: input.target.subscriptionRef,
          };
    }
    return { kind: "FULL_CENSUS", complete: true, events };
  }
}
async function receiveSignal(
  billing: BillingService,
  signal: ProviderSignal & { scope: ReturnType<typeof scope> },
) {
  const customerRef = "fixture-customer:" + signal.scope.guildId;
  class VerifiedFixture extends StripeBillingProvider {
    override async verifyWebhook() {
      return [
        {
          ...signal,
          customerRef,
          bindingEvidence: {
            kind: "CUSTOMER_SUBSCRIPTION" as const,
            customerRef,
            subscriptionRef: signal.subscriptionRef,
          },
        },
      ];
    }
  }
  const before = (
    await sql`SELECT id FROM billing_provider_signals WHERE event_digest=${vault.digest("billing-signal:STRIPE", signal.eventId)}`.execute(
      db,
    )
  ).rows.length;
  await billing.receive(
    new VerifiedFixture(),
    Buffer.from("verified-fixture"),
    {},
  );
  return { duplicate: Boolean(before) };
}
it("retains durable failed session retries and rejects a changed payload under the same key", async () => {
  const f = await fixture(),
    operations = new BillingOperationService(db, vault);
  const input = {
    scope: f.s,
    provider: "STRIPE" as const,
    operation: "PORTAL" as const,
    idempotencyKey: randomUUID(),
    customer: await f.billing.customerReference(f.s, "STRIPE"),
  };
  const execute = () => new StripeBillingProvider().createPortalSession(input);
  await expect(operations.session(input, execute)).rejects.toThrow(
    "BILLING_PROVIDER_NOT_CONFIGURED",
  );
  await expect(operations.session(input, execute)).rejects.toThrow(
    "BILLING_PROVIDER_NOT_CONFIGURED",
  );
  const rows = (
    await sql<{
      state: string;
      result_ciphertext: string | null;
    }>`SELECT * FROM billing_operations WHERE organization_id=${f.s.organizationId}::uuid`.execute(
      db,
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ state: "FAILED", result_ciphertext: null });
  await expect(
    operations.session(
      { ...input, promotionReservationId: randomUUID() },
      execute,
    ),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
});
it("upgrades alpha.5 generic provider without reinterpreting or rehashing its identities", async () => {
  const row = (
    await sql<{
      provider: string;
      reference_digest: string;
      reference_ciphertext: string;
    }>`SELECT * FROM billing_subscriptions WHERE organization_id=${legacy.organizationId}::uuid`.execute(
      db,
    )
  ).rows[0]!;
  expect(row).toMatchObject({
    provider: "EXTERNAL_LEGACY",
    reference_digest: "preserved-digest",
    reference_ciphertext: "preserved-sealed",
  });
  expect(
    (
      await sql<{
        normalized: { provider: string; referenceDigest: string };
      }>`SELECT normalized FROM billing_provider_events WHERE event_digest='historical-event'`.execute(
        db,
      )
    ).rows[0]!.normalized,
  ).toEqual({ provider: "EXTERNAL_LEGACY", referenceDigest: "unchanged" });
  await new BillingService(db, vault)
    .storeVerified(snapshot(legacy, { provider: "EXTERNAL_LEGACY" }))
    .catch((error) =>
      expect(error.message).toContain("RECONCILIATION_REQUIRED"),
    );
  await migrate(db);
});
it("deduplicates out-of-order signals and projects latest snapshots independent of webhook revisions", async () => {
  const f = await fixture();
  let latest = snapshot(f.s);
  const provider = new FixtureStripe(async () => [latest]);
  const signal = {
    eventId: "late-old-webhook",
    provider: "STRIPE" as const,
    scope: f.s,
    subscriptionRef: latest.subscriptionRef,
  };
  expect(await receiveSignal(f.billing, signal)).toEqual({ duplicate: false });
  expect(await receiveSignal(f.billing, signal)).toEqual({ duplicate: true });
  expect(await f.billing.processSignal(provider)).toBe(true);
  latest = snapshot(f.s, {
    status: "SUSPENDED",
    version: 0,
    occurredAt: new Date(0).toISOString(),
  });
  await receiveSignal(f.billing, { ...signal, eventId: "even-older-webhook" });
  await f.billing.processSignal(provider);
  // Deliberately project the newer retrieval before the older retrieval.
  await sql`UPDATE billing_provider_events SET received_at=now()-interval '1 day' WHERE organization_id=${f.s.organizationId}::uuid AND (normalized->>'version')::integer=2`.execute(
    db,
  );
  await f.billing.projectOne();
  await f.billing.projectOne();
  expect(await f.entitlements.plan(f.s)).toBe("FREE");
  expect(
    (
      await sql<{
        status: string;
      }>`SELECT status FROM billing_subscriptions WHERE organization_id=${f.s.organizationId}::uuid`.execute(
        db,
      )
    ).rows[0]!.status,
  ).toBe("SUSPENDED");
  await expect(f.billing.storeVerified(snapshot(f.s))).rejects.toThrow(
    "RECONCILIATION_REQUIRED",
  );
});
it("fences overlapping retrievals and rejects expired reconciliation leases", async () => {
  const f = await fixture();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider = new FixtureStripe(async () => {
    await pending;
    return [snapshot(f.s)];
  });
  const first = f.billing.reconcileLatest(f.s, provider);
  for (let i = 0; i < 30; i++) {
    if (
      (
        await sql`SELECT * FROM billing_snapshot_sequences WHERE organization_id=${f.s.organizationId}::uuid AND lease_token IS NOT NULL`.execute(
          db,
        )
      ).rows.length
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(
    await new BillingService(db, vault).reconcileLatest(f.s, provider),
  ).toBe(false);
  await sql`UPDATE billing_snapshot_sequences SET lease_until=now()-interval '1 second' WHERE organization_id=${f.s.organizationId}::uuid`.execute(
    db,
  );
  release();
  await expect(first).rejects.toThrow("LEASE_EXPIRED");
  expect(
    (
      await sql`SELECT * FROM billing_provider_events WHERE organization_id=${f.s.organizationId}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
});
it("retains bounded retry failures without marking failed reconciliation projected", async () => {
  const f = await fixture();
  await receiveSignal(f.billing, {
    eventId: randomUUID(),
    provider: "STRIPE",
    scope: f.s,
    subscriptionRef: "fixture-failure",
  });
  for (let i = 0; i < 8; i++) {
    await sql`UPDATE billing_provider_signals SET available_at=now() WHERE organization_id=${f.s.organizationId}::uuid`.execute(
      db,
    );
    await f.billing.processSignal(new StripeBillingProvider());
  }
  const row = (
    await sql<{
      attempts: number;
      dead_lettered_at: Date;
      projected_at: Date | null;
      error_category: string;
    }>`SELECT * FROM billing_provider_signals WHERE organization_id=${f.s.organizationId}::uuid`.execute(
      db,
    )
  ).rows[0]!;
  expect(row.attempts).toBe(8);
  expect(row.dead_lettered_at).toBeInstanceOf(Date);
  expect(row.projected_at).toBeNull();
  expect(row.error_category).toBe("BILLING_RECONCILIATION_FAILED");
  expect(await f.billing.processSignal(new StripeBillingProvider())).toBe(
    false,
  );
});
it("monthly, annual and currencies coexist while capabilities use only the plan", async () => {
  const f = await fixture();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  for (const [i, [interval, currency]] of [
    ["MONTH", "JPY"],
    ["YEAR", "JPY"],
    ["MONTH", "USD"],
  ].entries()) {
    await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,provider_product_id,provider_price_id,billing_interval,currency,enabled,final_price_minor,tax_behavior) VALUES(${ids[i]!}::uuid,'GROWTH',2,'STRIPE',${"fixture-product-" + ids[i]},${"fixture-price-" + ids[i]},${interval},${currency},true,4900,'EXCLUSIVE')`.execute(
      db,
    );
    expect((await checkoutOffering(db, ids[i]!)).planKey).toBe("GROWTH");
  }
  expect(await f.entitlements.plan(f.s)).toBe("FREE");
  await f.billing.reconcileLatest(
    f.s,
    new FixtureStripe(async () => [snapshot(f.s)]),
  );
  await f.billing.projectOne();
  expect(await f.entitlements.can(f.s, "custom_recipe")).toBe(true);
  await expect(
    sql`UPDATE billing_offerings SET provider_price_id=NULL WHERE id=ANY(${ids}::uuid[])`.execute(
      db,
    ),
  ).rejects.toThrow("BILLING_OFFERING_IMMUTABLE");
  expect(await f.entitlements.can(f.s, "custom_recipe")).toBe(true);
});
async function promotion(patch: Record<string, unknown> = {}) {
  const f = await fixture(),
    offering = randomUUID(),
    promotions = new PromotionService(db, vault),
    reservations = new PromotionReservationService(db, vault);
  await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,enabled,currency,final_price_minor,provider_product_id,provider_price_id,tax_behavior) VALUES(${offering}::uuid,'GROWTH',2,'STRIPE',true,'JPY',4900,${"fixture-product-" + offering},${"fixture-price-" + offering},'EXCLUSIVE')`.execute(
    db,
  );
  const c = await promotions.createCampaign(
    admin,
    campaignSchema.parse({
      name: "Reservation fixture",
      benefitType: "DISCOUNT",
      targetPlan: "GROWTH",
      discountType: "PERCENT",
      discountValue: 10,
      validFrom: new Date(Date.now() - 60000).toISOString(),
      allowedPlans: ["FREE", "GROWTH"],
      allowedProviders: ["STRIPE"],
      maxRedemptions: 2,
      ...patch,
    }),
  );
  await promotions.activateCampaign(admin, c.id);
  const code = await promotions.generateCode(admin, c.id, {
    maxRedemptions: 3,
  });
  const request = {
    code: code.code,
    offeringId: offering,
    idempotencyKey: randomUUID(),
  };
  return { ...f, promotions, reservations, c, code, request };
}
it("reserves, cancels, expires and releases abandoned quota without consuming counters", async () => {
  const f = await promotion({ maxRedemptions: 1 });
  const reserved = await f.reservations.reserve(
    f.s,
    "fixture-actor",
    f.request,
  );
  expect(await f.reservations.reserve(f.s, "fixture-actor", f.request)).toEqual(
    reserved,
  );
  await expect(
    f.reservations.reserve(f.s, "fixture-actor", {
      ...f.request,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toThrow("PROMOTION_UNAVAILABLE");
  await f.reservations.cancel(f.s, reserved.id);
  const replacement = await f.reservations.reserve(f.s, "fixture-actor", {
    ...f.request,
    idempotencyKey: randomUUID(),
  });
  await sql`UPDATE promotion_redemption_reservations SET expires_at=now()-interval '1 second' WHERE id=${replacement.id}::uuid`.execute(
    db,
  );
  await f.reservations.expire();
  expect(
    (
      await sql<{
        state: string;
      }>`SELECT state FROM promotion_redemption_reservations WHERE id=${replacement.id}::uuid`.execute(
        db,
      )
    ).rows[0]!.state,
  ).toBe("EXPIRED");
  expect(
    (
      await sql<{
        redeemed_count: number;
      }>`SELECT redeemed_count FROM promotion_campaigns WHERE id=${f.c.id}::uuid`.execute(
        db,
      )
    ).rows[0]!.redeemed_count,
  ).toBe(0);
  expect(
    (
      await f.reservations.reserve(f.s, "fixture-actor", {
        ...f.request,
        idempotencyKey: randomUUID(),
      })
    ).state,
  ).toBe("PENDING");
});
it.each(["campaign", "guild", "code"])(
  "serializes concurrent reservation %s limits",
  async (limit) => {
    const f = await promotion({
      maxRedemptions: limit === "campaign" ? 1 : 10,
      maxRedemptionsPerGuild: limit === "guild" ? 1 : 10,
    });
    if (limit === "code")
      await sql`UPDATE promotion_codes SET max_redemptions=1 WHERE id=${f.code.id}::uuid`.execute(
        db,
      );
    const other = limit === "guild" ? f.s : (await fixture()).s;
    const result = await Promise.allSettled([
      f.reservations.reserve(f.s, "fixture-actor", f.request),
      f.reservations.reserve(other, "fixture-actor", {
        ...f.request,
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  },
);
it("finalizes only associated authoritative subscriptions once, never a success redirect", async () => {
  const f = await promotion({ maxRedemptions: 1, allowedPlans: ["FREE"] });
  const r = await f.reservations.reserve(f.s, "fixture-actor", f.request);
  const { campaignId, ...commercialTerms } =
    await f.reservations.checkoutContext(f.s, r.id, f.request.offeringId);
  expect(campaignId).toBe(f.c.id);
  const key = randomUUID();
  await expect(
    f.reservations.finalize(f.s, r.id, randomUUID(), key),
  ).rejects.toThrow("PROMOTION_UNAVAILABLE");
  const current = snapshot(f.s, {
    commercialEvidence: { ...commercialTerms, discountApplied: true },
  });
  await f.reservations.bindSubscription(f.s, r.id, current.subscriptionRef);
  await f.billing.reconcileLatest(
    f.s,
    new FixtureStripe(async () => [current]),
  );
  await f.billing.projectOne();
  const confirmation = (
    await sql<{
      id: string;
    }>`SELECT id FROM billing_provider_events WHERE organization_id=${f.s.organizationId}::uuid`.execute(
      db,
    )
  ).rows[0]!.id;
  await expect(
    f.reservations.finalize(f.s, r.id, randomUUID(), key),
  ).rejects.toThrow("PAYMENT_NOT_CONFIRMED");
  const results = await Promise.all([
    f.reservations.finalize(f.s, r.id, confirmation, key),
    f.reservations.finalize(f.s, r.id, confirmation, key),
  ]);
  expect(results.every((row) => row.state === "FINALIZED")).toBe(true);
  expect(
    (
      await sql<{
        redeemed_count: number;
      }>`SELECT redeemed_count FROM promotion_campaigns WHERE id=${f.c.id}::uuid`.execute(
        db,
      )
    ).rows[0]!.redeemed_count,
  ).toBe(1);
  await expect(
    f.reservations.reserve((await fixture()).s, "fixture-actor", {
      ...f.request,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toThrow("PROMOTION_UNAVAILABLE");
});
it("revocation blocks pending finalization and privacy deletion removes new scoped records", async () => {
  const f = await promotion();
  const r = await f.reservations.reserve(f.s, "fixture-actor", f.request);
  await sql`UPDATE promotion_campaigns SET revoked_at=now() WHERE id=${f.c.id}::uuid`.execute(
    db,
  );
  await expect(
    f.reservations.finalize(f.s, r.id, randomUUID(), randomUUID()),
  ).rejects.toThrow("PROMOTION_UNAVAILABLE");
  await receiveSignal(f.billing, {
    eventId: randomUUID(),
    provider: "STRIPE",
    scope: f.s,
    subscriptionRef: "fixture-delete",
  });
  await db.transaction().execute((tx) => deleteBillingCommunity(tx, f.s));
  expect(
    (
      await sql`SELECT * FROM promotion_redemption_reservations WHERE organization_id=${f.s.organizationId}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await sql`SELECT * FROM billing_provider_signals WHERE organization_id=${f.s.organizationId}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
});
