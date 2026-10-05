import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
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
  BillingService,
  PromotionReservationService,
  PromotionService,
  StripeBillingProvider,
  campaignSchema,
  type BillingExecutionContext,
  type CommercialDiscountEvidence,
  type NormalizedBillingEvent,
  type ProviderReconcileRequest,
  type ProviderReconcileResult,
} from "../../packages/settings/src/billing";
import { internalBillingActor } from "../../packages/security/src/billing-authorization";
import { deleteBillingCommunity } from "../../packages/security/src/billing-privacy";

let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32));
const admin = internalBillingActor(
  "555555555555555555",
  vault,
  "Promotion contract fixture",
  {
    NEXUS_INTERNAL_ADMIN_IDS: "555555555555555555",
  },
);
let nextGuild = 821111111111110000n;
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
async function fixture() {
  const s = { organizationId: randomUUID(), guildId: String(nextGuild++) };
  await ensureGuild(db, s);
  const accountId = randomUUID(),
    customerRef = "fixture-customer-" + s.guildId;
  await sql`INSERT INTO billing_accounts(id,organization_id) VALUES(${accountId}::uuid,${s.organizationId}::uuid)`.execute(
    db,
  );
  await sql`INSERT INTO billing_provider_customers(id,account_id,provider,reference_digest,reference_ciphertext,reference_guild_id) VALUES(${randomUUID()}::uuid,${accountId}::uuid,'STRIPE',${vault.digest("billing-customer-reference:STRIPE", customerRef)},${vault.seal(s, customerRef)},${s.guildId})`.execute(
    db,
  );
  return {
    s,
    billing: new BillingService(db, vault),
    reservations: new PromotionReservationService(db, vault),
  };
}
async function offering(
  plan = "GROWTH",
  price = 4900,
  reviewed = true,
  provider = "STRIPE",
  revision = 2,
  skuMapping = true,
) {
  const id = randomUUID();
  await sql`INSERT INTO billing_offerings(id,plan_key,plan_revision,provider,provider_product_id,provider_price_id,provider_offering_id,enabled,currency,final_price_minor,tax_behavior,parity_reviewed_at) VALUES(${id}::uuid,${plan},${revision},${provider},${provider === "STRIPE" ? "fixture-product-" + id : null},${provider === "STRIPE" ? "fixture-price-" + id : null},${provider === "DISCORD" && skuMapping ? "fixture-sku-" + id : null},true,'JPY',${price},'EXCLUSIVE',${reviewed ? new Date() : null})`.execute(
    db,
  );
  return id;
}
async function promotion(revision = 2) {
  if (revision !== 2)
    await sql`INSERT INTO billing_plan_versions(plan_key,revision,features,limits) SELECT plan_key,${revision},features,limits FROM billing_plan_versions WHERE plan_key='GROWTH' AND revision=2 ON CONFLICT DO NOTHING`.execute(
      db,
    );
  const f = await fixture(),
    offeringId = await offering("GROWTH", 4900, true, "STRIPE", revision),
    promotions = new PromotionService(db, vault);
  const campaign = await promotions.createCampaign(
    admin,
    campaignSchema.parse({
      name: "Verified commercial discount",
      benefitType: "DISCOUNT",
      targetPlan: "GROWTH",
      discountType: "PERCENT",
      discountValue: 10,
      validFrom: new Date(Date.now() - 60000).toISOString(),
      allowedPlans: ["FREE", "GROWTH"],
      allowedProviders: ["STRIPE"],
      maxRedemptions: 1,
    }),
  );
  await promotions.activateCampaign(admin, campaign.id);
  const code = await promotions.generateCode(admin, campaign.id);
  const reservation = await f.reservations.reserve(f.s, "fixture-actor", {
    code: code.code,
    offeringId,
    idempotencyKey: randomUUID(),
  });
  const input = {
    scope: f.s,
    provider: "STRIPE" as const,
    operation: "CHECKOUT" as const,
    offeringId,
    promotionReservationId: reservation.id,
    idempotencyKey: randomUUID(),
  };
  return { ...f, offeringId, promotions, campaign, code, reservation, input };
}
function checkoutResult() {
  return {
    url: "https://checkout.invalid/fixture",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    providerCheckoutRef: "fixture-checkout-" + randomUUID(),
  };
}

it("rejects a reservation from a different scope before executing the provider", async () => {
  const f = await promotion(),
    other = await fixture(),
    execute = vi.fn(async () => checkoutResult());
  await expect(
    new BillingOperationService(db, vault).session(
      { ...f.input, scope: other.s },
      execute,
    ),
  ).rejects.toThrow("PROMOTION_UNAVAILABLE");
  expect(execute).not.toHaveBeenCalled();
});
it("rejects a different Offering before executing the provider", async () => {
  const f = await promotion(),
    execute = vi.fn(async () => checkoutResult());
  await expect(
    new BillingOperationService(db, vault).session(
      { ...f.input, offeringId: await offering() },
      execute,
    ),
  ).rejects.toThrow("PROMOTION_UNAVAILABLE");
  expect(execute).not.toHaveBeenCalled();
});
it.each([
  "expired",
  "canceled",
  "campaign-revoked",
  "campaign-inactive",
  "campaign-window",
  "code-revoked",
  "code-expired",
  "target-changed",
  "plan-disallowed",
  "provider-disallowed",
  "stacked-grant",
])(
  "rechecks %s reservation eligibility before executing the provider",
  async (condition) => {
    const f = await promotion(),
      execute = vi.fn(async () => checkoutResult());
    if (condition === "expired")
      await sql`UPDATE promotion_redemption_reservations SET expires_at=now()-interval '1 second' WHERE id=${f.reservation.id}::uuid`.execute(
        db,
      );
    if (condition === "canceled")
      await f.reservations.cancel(f.s, f.reservation.id);
    if (condition === "campaign-revoked")
      await f.promotions.revoke(admin, "campaign", f.campaign.id);
    if (condition === "campaign-inactive")
      await sql`UPDATE promotion_campaigns SET activated_at=NULL WHERE id=${f.campaign.id}::uuid`.execute(
        db,
      );
    if (condition === "campaign-window")
      await sql`UPDATE promotion_campaigns SET valid_until=now()-interval '1 second' WHERE id=${f.campaign.id}::uuid`.execute(
        db,
      );
    if (condition === "code-revoked")
      await f.promotions.revoke(admin, "code", f.code.id);
    if (condition === "code-expired")
      await sql`UPDATE promotion_codes SET expires_at=now()-interval '1 second' WHERE id=${f.code.id}::uuid`.execute(
        db,
      );
    if (condition === "target-changed")
      await sql`UPDATE promotion_codes SET target_guild_id='999999999999999999' WHERE id=${f.code.id}::uuid`.execute(
        db,
      );
    if (condition === "plan-disallowed")
      await sql`UPDATE promotion_campaigns SET allowed_plans='["STARTER"]'::jsonb WHERE id=${f.campaign.id}::uuid`.execute(
        db,
      );
    if (condition === "provider-disallowed")
      await sql`UPDATE promotion_campaigns SET allowed_providers='["DISCORD"]'::jsonb WHERE id=${f.campaign.id}::uuid`.execute(
        db,
      );
    if (condition === "stacked-grant")
      await sql`INSERT INTO entitlement_grants(id,organization_id,guild_id,source,plan_key,starts_at,ends_at,reason) VALUES(${randomUUID()}::uuid,${f.s.organizationId}::uuid,${f.s.guildId},'PROMOTION','GROWTH',now(),now()+interval '1 day','Existing benefit fixture')`.execute(
        db,
      );
    await expect(
      new BillingOperationService(db, vault).session(f.input, execute),
    ).rejects.toThrow("PROMOTION_UNAVAILABLE");
    expect(execute).not.toHaveBeenCalled();
  },
);
it("passes only a Core-resolved commercial context and never the plaintext promotion code", async () => {
  const f = await promotion();
  const execute = vi.fn(async (context: BillingExecutionContext) => {
    expect(context.promotion).toMatchObject({
      reservationId: f.reservation.id,
      offeringId: f.offeringId,
      discountType: "PERCENT",
      discountValue: 10,
      finalPreTaxAmountMinor: 4410,
      providerTrial: false,
    });
    expect(JSON.stringify(context)).not.toContain(f.code.code);
    return checkoutResult();
  });
  await new BillingOperationService(db, vault).session(f.input, execute);
  expect(execute).toHaveBeenCalledOnce();
});
it("binds a stable idempotency key to revalidated promotion commercial terms", async () => {
  const f = await promotion(),
    execute = vi.fn(async () => checkoutResult());
  const operations = new BillingOperationService(db, vault);
  await operations.session(f.input, execute);
  await sql`UPDATE promotion_campaigns SET discount_value=20 WHERE id=${f.campaign.id}::uuid`.execute(
    db,
  );
  await expect(operations.session(f.input, execute)).rejects.toThrow(
    "IDEMPOTENCY_CONFLICT",
  );
  expect(execute).toHaveBeenCalledOnce();
});
it("rejects trial plus discount even when a campaign allows MAX stacking", async () => {
  const f = await promotion(),
    execute = vi.fn(async () => checkoutResult());
  await sql`UPDATE promotion_campaigns SET stacking_policy='MAX' WHERE id=${f.campaign.id}::uuid`.execute(
    db,
  );
  await sql`INSERT INTO entitlement_grants(id,organization_id,guild_id,source,plan_key,starts_at,ends_at,reason) VALUES(${randomUUID()}::uuid,${f.s.organizationId}::uuid,${f.s.guildId},'TRIAL','GROWTH',now(),now()+interval '1 day','Fixture trial')`.execute(
    db,
  );
  await expect(
    new BillingOperationService(db, vault).session(f.input, execute),
  ).rejects.toThrow("PROMOTION_TRIAL_COMBINATION_UNSUPPORTED");
  expect(execute).not.toHaveBeenCalled();
});

class CensusStripe extends StripeBillingProvider {
  constructor(private readonly event: NormalizedBillingEvent) {
    super();
  }
  override async reconcile(
    _input: ProviderReconcileRequest,
  ): Promise<ProviderReconcileResult> {
    return { kind: "FULL_CENSUS", complete: true, events: [this.event] };
  }
}
async function confirmation(
  f: Awaited<ReturnType<typeof promotion>>,
  evidence?: CommercialDiscountEvidence,
) {
  const event: NormalizedBillingEvent = {
    eventId: randomUUID(),
    provider: "STRIPE",
    scope: f.s,
    subscriptionRef: "fixture-subscription-" + f.reservation.id,
    plan: "GROWTH",
    planRevision: evidence?.planRevision ?? 2,
    status: "ACTIVE",
    occurredAt: new Date().toISOString(),
    version: 0,
    periodEnd: new Date(Date.now() + 86400000).toISOString(),
    scheduledPlan: null,
    scheduledAt: null,
    authoritative: true,
    ...(evidence ? { commercialEvidence: evidence } : {}),
  };
  await f.reservations.bindSubscription(
    f.s,
    f.reservation.id,
    event.subscriptionRef,
  );
  await f.billing.reconcileLatest(f.s, new CensusStripe(event));
  await f.billing.projectOne();
  return (
    await sql<{
      id: string;
    }>`SELECT id FROM billing_provider_events WHERE organization_id=${f.s.organizationId}::uuid ORDER BY received_at DESC LIMIT 1`.execute(
      db,
    )
  ).rows[0]!.id;
}
it("an ACTIVE subscription without actual discount evidence never finalizes a promotion", async () => {
  const f = await promotion(),
    id = await confirmation(f);
  await expect(
    f.reservations.finalize(f.s, f.reservation.id, id, randomUUID()),
  ).rejects.toThrow("PROMOTION_COMMERCIAL_EVIDENCE_REQUIRED");
  expect(
    (
      await sql<{
        state: string;
      }>`SELECT state FROM promotion_redemption_reservations WHERE id=${f.reservation.id}::uuid`.execute(
        db,
      )
    ).rows[0]!.state,
  ).toBe("PENDING");
});
it.each(["reservation", "offering", "final-price", "discount"])(
  "mismatched %s commercial evidence never finalizes a promotion",
  async (mismatch) => {
    const f = await promotion();
    const { campaignId, ...terms } = await f.reservations.checkoutContext(
      f.s,
      f.reservation.id,
      f.offeringId,
    );
    expect(campaignId).toBe(f.campaign.id);
    const evidence: CommercialDiscountEvidence = {
      ...terms,
      discountApplied: true,
    };
    if (mismatch === "reservation") evidence.reservationId = randomUUID();
    if (mismatch === "offering") evidence.offeringId = await offering();
    if (mismatch === "final-price") evidence.finalPreTaxAmountMinor++;
    if (mismatch === "discount") evidence.discountValue++;
    const id = await confirmation(f, evidence);
    await expect(
      f.reservations.finalize(f.s, f.reservation.id, id, randomUUID()),
    ).rejects.toThrow("PROMOTION_COMMERCIAL_EVIDENCE_REQUIRED");
  },
);
it("matching provider commercial evidence finalizes once under concurrent confirmation", async () => {
  const f = await promotion();
  const { campaignId, ...terms } = await f.reservations.checkoutContext(
    f.s,
    f.reservation.id,
    f.offeringId,
  );
  expect(campaignId).toBe(f.campaign.id);
  const id = await confirmation(f, { ...terms, discountApplied: true }),
    key = randomUUID();
  const result = await Promise.all([
    f.reservations.finalize(f.s, f.reservation.id, id, key),
    f.reservations.finalize(f.s, f.reservation.id, id, key),
  ]);
  expect(result.every((row) => row.state === "FINALIZED")).toBe(true);
  expect(
    (
      await sql<{
        redeemed_count: number;
      }>`SELECT redeemed_count FROM promotion_campaigns WHERE id=${f.campaign.id}::uuid`.execute(
        db,
      )
    ).rows[0]!.redeemed_count,
  ).toBe(1);
});
it("preserves a new catalog revision through subscription projection and finalization", async () => {
  const f = await promotion(3);
  const { campaignId, ...terms } = await f.reservations.checkoutContext(
    f.s,
    f.reservation.id,
    f.offeringId,
  );
  expect(campaignId).toBe(f.campaign.id);
  expect(terms.planRevision).toBe(3);
  const id = await confirmation(f, { ...terms, discountApplied: true });
  expect(
    (
      await sql<{
        plan_revision: number;
        offering_id: string;
      }>`SELECT plan_revision,offering_id FROM billing_subscriptions WHERE organization_id=${f.s.organizationId}::uuid`.execute(
        db,
      )
    ).rows[0],
  ).toMatchObject({ plan_revision: 3, offering_id: f.offeringId });
  await expect(
    f.reservations.finalize(f.s, f.reservation.id, id, randomUUID()),
  ).resolves.toMatchObject({ state: "FINALIZED" });
});

it.each([
  { normal: 4900, discord: 4901, reason: "DISCORD_PRICE_PARITY_REJECTED" },
  { normal: 4900, discord: 4900, reason: "DISCOUNT_PRICE" },
  {
    normal: 4900,
    discord: 4900,
    reason: "DISCORD_OFFERING_MAPPING_UNVERIFIED",
  },
])(
  "rejects noncompliant normal/discounted Discord parity: %j",
  async ({ normal, discord, reason }) => {
    const f = await fixture(),
      externalId = await offering("STARTER", normal),
      discordId = await offering(
        "STARTER",
        discord,
        true,
        "DISCORD",
        2,
        reason !== "DISCORD_OFFERING_MAPPING_UNVERIFIED",
      ),
      execute = vi.fn(async () => checkoutResult());
    vi.stubEnv("NEXUS_BILLING_DEVELOPER_COUNTRY", "US");
    try {
      if (reason === "DISCOUNT_PRICE") {
        const promotions = new PromotionService(db, vault),
          campaign = await promotions.createCampaign(
            admin,
            campaignSchema.parse({
              name: "Parity fixture",
              benefitType: "DISCOUNT",
              targetPlan: "STARTER",
              discountType: "PERCENT",
              discountValue: 10,
              validFrom: new Date(Date.now() - 60000).toISOString(),
              allowedPlans: ["FREE"],
              allowedProviders: ["STRIPE"],
            }),
          );
        await expect(
          promotions.activateCampaign(admin, campaign.id),
        ).rejects.toThrow("DISCORD_PRICE_PARITY_REJECTED");
      } else {
        await expect(
          new BillingOperationService(db, vault).session(
            {
              scope: f.s,
              provider: "STRIPE",
              operation: "CHECKOUT",
              idempotencyKey: randomUUID(),
              offeringId: externalId,
            },
            execute,
          ),
        ).rejects.toThrow(reason);
        expect(execute).not.toHaveBeenCalled();
      }
    } finally {
      await sql`UPDATE billing_offerings SET enabled=false WHERE id IN (${externalId}::uuid,${discordId}::uuid)`.execute(
        db,
      );
      vi.stubEnv("NEXUS_BILLING_DEVELOPER_COUNTRY", "JP");
    }
  },
);
it("privacy deletion serializes against reservation reference binding and cannot resurrect commerce", async () => {
  const f = await promotion();
  const deletion = db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"privacy:" + f.s.organizationId + ":" + f.s.guildId},0))`.execute(
      tx,
    );
    await deleteBillingCommunity(tx, f.s);
    await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,completed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,now())`.execute(
      tx,
    );
  });
  const result = await Promise.allSettled([
    deletion,
    f.reservations.bindSubscription(
      f.s,
      f.reservation.id,
      "fixture-private-subscription",
    ),
  ]);
  expect(result[0]!.status).toBe("fulfilled");
  expect(
    (
      await sql`SELECT id FROM promotion_redemption_reservations WHERE organization_id=${f.s.organizationId}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  await expect(
    f.reservations.checkoutContext(f.s, f.reservation.id, f.offeringId),
  ).rejects.toThrow("PRIVACY_DELETED");
});
