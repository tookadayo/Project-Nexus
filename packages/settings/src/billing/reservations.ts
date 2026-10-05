import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, tenant, type Database, type Tx } from "../../../db/src/index";
import { assert, type Scope } from "../../../shared/src/index";
import type { IdentityVault } from "../../../identity/src/index";
import { billingAudit, billingScopeLock } from "./service";
import { EntitlementService } from "./entitlements";
import type { Plan } from "../plan-registry";
import {
  discordBillingConfiguration,
  discordMonetizationApplicable,
} from "./providers/discord";
import {
  basePriceCompatibility,
  discountCompatibility,
  matchesPromotionCommercialEvidence,
  promotionCheckoutContextSchema,
  type PromotionCheckoutContext,
} from "./policy";
type Offer = {
  id: string;
  plan_key: Plan;
  plan_revision: number;
  provider: string;
  provider_offering_id: string | null;
  currency: string | null;
  final_price_minor: number | null;
  billing_interval: "MONTH" | "YEAR";
  billing_interval_count: number;
  tax_behavior: "UNSPECIFIED" | "EXCLUSIVE" | "INCLUSIVE";
  parity_reviewed_at: Date | null;
};
async function equivalentDiscordOffering(tx: Tx, offering: Offer) {
  const matches = (
    await sql<Offer>`SELECT * FROM billing_offerings WHERE plan_key=${offering.plan_key} AND plan_revision=${offering.plan_revision} AND provider='DISCORD' AND billing_interval=${offering.billing_interval} AND billing_interval_count=${offering.billing_interval_count} AND enabled FOR SHARE`.execute(
      tx,
    )
  ).rows;
  const sameCurrency = matches.filter(
    (row) => row.currency === offering.currency,
  );
  assert(sameCurrency.length <= 1, "OFFERING_POLICY_AMBIGUOUS");
  const discord = sameCurrency[0] ?? matches[0];
  assert(
    !discord || Boolean(discord.provider_offering_id?.trim()),
    "DISCORD_OFFERING_MAPPING_UNVERIFIED",
    409,
  );
  return discord;
}
function parityObligation(offering: Offer, discord: Offer | undefined) {
  return discord
    ? true
    : discordMonetizationApplicable(
        discordBillingConfiguration().developerCountry,
        offering.plan_key,
      );
}
// Prices are compared before tax. Inclusive prices need authoritative tax
// decomposition before they can participate in alpha.7 parity validation.
function assertPreTaxPrice(offering: Offer, discord: Offer | undefined) {
  assert(
    offering.tax_behavior === "EXCLUSIVE" &&
      (!discord || discord.tax_behavior === "EXCLUSIVE"),
    "OFFERING_PRE_TAX_PRICE_UNVERIFIED",
    409,
  );
}
export async function reviewBaseOffering(tx: Tx, offering: Offer) {
  if (offering.provider !== "STRIPE") return;
  const discord = await equivalentDiscordOffering(tx, offering);
  if (parityObligation(offering, discord)) assertPreTaxPrice(offering, discord);
  const decision = basePriceCompatibility({
    provider: "STRIPE",
    basePriceMinor: offering.final_price_minor,
    discordFinalPriceMinor: discord?.final_price_minor ?? null,
    discordOfferingSupported: Boolean(discord),
    parityReviewed: Boolean(
      offering.parity_reviewed_at && discord?.parity_reviewed_at,
    ),
    parityObligation: parityObligation(offering, discord),
    baseCurrency: offering.currency,
    discordCurrency: discord?.currency,
  });
  assert(
    decision.allowed,
    decision.reason ?? "OFFERING_POLICY_UNAVAILABLE",
    409,
  );
}
export async function reviewDiscountOffering(
  tx: Tx,
  offering: Offer,
  discountType: "PERCENT" | "FIXED",
  discountValue: number,
) {
  const discord = await equivalentDiscordOffering(tx, offering);
  if (offering.provider === "STRIPE") assertPreTaxPrice(offering, discord);
  const decision = discountCompatibility({
    provider: offering.provider as "STRIPE",
    discountType,
    discountValue,
    basePriceMinor: offering.final_price_minor,
    discordFinalPriceMinor: discord?.final_price_minor ?? null,
    discordOfferingSupported: Boolean(discord),
    parityReviewed: Boolean(
      offering.parity_reviewed_at && discord?.parity_reviewed_at,
    ),
    parityObligation: parityObligation(offering, discord),
    baseCurrency: offering.currency,
    discordCurrency: discord?.currency,
  });
  assert(decision.allowed, decision.reason ?? "DISCOUNT_PROVIDER_INCOMPATIBLE");
  return decision.finalPriceMinor!;
}
type Campaign = {
  id: string;
  benefit_type: string;
  target_plan: Plan;
  discount_type: "PERCENT" | "FIXED";
  discount_value: number;
  activated_at: Date | null;
  revoked_at: Date | null;
  valid_from: Date;
  valid_until: Date | null;
  max_redemptions: number | null;
  redeemed_count: number;
  max_redemptions_per_guild: number;
  target_guild_id: string | null;
  target_organization_id: string | null;
  allowed_plans: Plan[];
  allowed_providers: string[];
  stacking_policy: string;
};
type Code = {
  id: string;
  campaign_id: string;
  code_hmac: string;
  revoked_at: Date | null;
  expires_at: Date | null;
  max_redemptions: number;
  redeemed_count: number;
  target_guild_id: string | null;
  target_organization_id: string | null;
};
type Reservation = {
  id: string;
  code_id: string;
  campaign_id: string;
  offering_id: string;
  eligible_plan: Plan;
  expires_at: Date;
  state: "PENDING" | "FINALIZED" | "EXPIRED" | "CANCELED";
  reference_digest: string | null;
  confirmation_digest: string | null;
};
// Internal service only. The disabled checkout route does not expose reservation/finalization.
export class PromotionReservationService {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
  ) {}
  private async validate(
    tx: Tx,
    s: Scope,
    campaignId: string,
    codeId: string,
    offeringId: string,
    eligiblePlan?: Plan,
  ) {
    const c = (
      await sql<Campaign>`SELECT * FROM promotion_campaigns WHERE id=${campaignId}::uuid FOR UPDATE`.execute(
        tx,
      )
    ).rows[0];
    const code = (
      await sql<Code>`SELECT * FROM promotion_codes WHERE id=${codeId}::uuid AND campaign_id=${campaignId}::uuid FOR UPDATE`.execute(
        tx,
      )
    ).rows[0];
    const offering = (
      await sql<Offer>`SELECT * FROM billing_offerings WHERE id=${offeringId}::uuid AND provider='STRIPE' AND enabled FOR SHARE`.execute(
        tx,
      )
    ).rows[0];
    const now = new Date();
    assert(
      c &&
        code &&
        offering &&
        c.benefit_type === "DISCOUNT" &&
        c.activated_at &&
        !c.revoked_at &&
        !code.revoked_at &&
        c.valid_from <= now &&
        (!c.valid_until || c.valid_until > now) &&
        (!code.expires_at || code.expires_at > now),
      "PROMOTION_UNAVAILABLE",
    );
    for (const binding of [c, code])
      assert(
        (!binding.target_guild_id || binding.target_guild_id === s.guildId) &&
          (!binding.target_organization_id ||
            binding.target_organization_id === s.organizationId),
        "PROMOTION_UNAVAILABLE",
      );
    const state = await new EntitlementService(tx).effective(s);
    assert(
      !state.subscriptions.some(
        (subscription) => subscription.status === "TRIALING",
      ) && !state.grants.some((grant) => grant.source === "TRIAL"),
      "PROMOTION_TRIAL_COMBINATION_UNSUPPORTED",
      409,
    );
    assert(
      c.target_plan === offering.plan_key &&
        c.allowed_providers.includes("STRIPE") &&
        c.allowed_plans.includes(eligiblePlan ?? state.plan),
      "PROMOTION_UNAVAILABLE",
    );
    assert(
      c.stacking_policy === "MAX" ||
        !state.grants.some((grant) =>
          ["PROMOTION", "TRIAL", "PARTNER", "DEBUG"].includes(grant.source),
        ),
      "PROMOTION_UNAVAILABLE",
    );
    const finalPreTaxAmountMinor = await reviewDiscountOffering(
      tx,
      offering,
      c.discount_type,
      c.discount_value,
    );
    return {
      c,
      code,
      offering,
      finalPreTaxAmountMinor,
      eligiblePlan: eligiblePlan ?? state.plan,
    };
  }
  async checkoutContext(
    s: Scope,
    reservationId: string,
    offeringId: string,
    transaction?: Tx,
  ): Promise<PromotionCheckoutContext> {
    z.uuid().parse(reservationId);
    z.uuid().parse(offeringId);
    const resolve = async (tx: Tx) => {
      await billingScopeLock(tx, s);
      const reservation = (
        await sql<Reservation>`SELECT * FROM promotion_redemption_reservations WHERE ${tenant(s)} AND id=${reservationId}::uuid FOR SHARE`.execute(
          tx,
        )
      ).rows[0];
      assert(
        reservation &&
          reservation.offering_id === offeringId &&
          reservation.state === "PENDING" &&
          reservation.expires_at > new Date(),
        "PROMOTION_UNAVAILABLE",
        409,
      );
      const { c, offering, finalPreTaxAmountMinor } = await this.validate(
        tx,
        s,
        reservation.campaign_id,
        reservation.code_id,
        offeringId,
      );
      assert(reservation.expires_at > new Date(), "PROMOTION_UNAVAILABLE", 409);
      return this.context(reservationId, c, offering, finalPreTaxAmountMinor);
    };
    return transaction
      ? resolve(transaction)
      : this.db.transaction().execute(resolve);
  }
  async confirmationContexts(s: Scope): Promise<PromotionCheckoutContext[]> {
    return this.db.transaction().execute(async tx => {
      await billingScopeLock(tx, s);
      const reservations = (await sql<Reservation>`SELECT r.* FROM promotion_redemption_reservations r WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.state='PENDING' AND r.expires_at>now() AND EXISTS(SELECT 1 FROM billing_operations o WHERE o.promotion_reservation_id=r.id AND o.state IN ('FINALIZED','RECONCILE_REQUIRED') AND o.external_started_at IS NOT NULL) ORDER BY r.id`.execute(tx)).rows;
      const contexts: PromotionCheckoutContext[] = [];
      for (const r of reservations) {
        try {
          const validated = await this.validate(tx,s,r.campaign_id,r.code_id,r.offering_id,r.eligible_plan);
          contexts.push(this.context(r.id, validated.c, validated.offering, validated.finalPreTaxAmountMinor));
        } catch { /* Revoked / expired / otherwise ineligible reservations provide no evidence. */ }
      }
      return contexts;
    });
  }
  async finalizeConfirmed() {
    const rows = (await sql<{organization_id:string;guild_id:string;reservation_id:string;event_id:string;reference_ciphertext:string}>`SELECT e.organization_id,e.guild_id,r.id AS reservation_id,e.id AS event_id,e.normalized->>'referenceCiphertext' AS reference_ciphertext FROM promotion_redemption_reservations r JOIN billing_provider_events e ON e.organization_id=r.organization_id AND e.guild_id=r.guild_id AND e.normalized->'commercialEvidence'->>'reservationId'=r.id::text JOIN billing_subscriptions b ON b.provider=e.provider AND b.provider_event_key=e.normalized->>'eventDigest' WHERE r.state='PENDING' AND r.expires_at>now() AND e.provider='STRIPE' AND e.projected_at IS NOT NULL AND b.status='ACTIVE' ORDER BY e.id LIMIT 20`.execute(this.db)).rows;
    for (const row of rows) {
      const scope = {organizationId:row.organization_id,guildId:row.guild_id};
      try {
        await this.bindSubscription(scope,row.reservation_id,this.vault.open(scope,row.reference_ciphertext));
        await this.finalize(scope,row.reservation_id,row.event_id,row.reservation_id);
      } catch { /* Validity is rechecked by finalize; a late revoke never consumes quota. */ }
    }
  }
  private context(
    reservationId: string,
    campaign: Campaign,
    offering: Offer,
    finalPreTaxAmountMinor: number,
  ) {
    return promotionCheckoutContextSchema.parse({
      reservationId,
      campaignId: campaign.id,
      offeringId: offering.id,
      provider: offering.provider,
      planKey: offering.plan_key,
      planRevision: offering.plan_revision,
      billingInterval: offering.billing_interval,
      billingIntervalCount: offering.billing_interval_count,
      currency: offering.currency,
      unitAmountMinor: offering.final_price_minor,
      taxBehavior: offering.tax_behavior,
      discountType: campaign.discount_type,
      discountValue: campaign.discount_value,
      finalPreTaxAmountMinor,
      providerTrial: false,
    });
  }
  async reserve(
    s: Scope,
    actorHash: string,
    input: { code: string; offeringId: string; idempotencyKey: string },
  ) {
    z.uuid().parse(input.offeringId);
    z.uuid().parse(input.idempotencyKey);
    assert(
      input.code.length <= 128 && /^NXP-[A-F0-9]{48}$/i.test(input.code.trim()),
      "PROMOTION_UNAVAILABLE",
    );
    const attempts = await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      return (
        await sql<{
          attempts: number;
        }>`INSERT INTO promotion_attempt_limits(organization_id,guild_id,actor_hash,window_start) VALUES(${s.organizationId}::uuid,${s.guildId},${actorHash},now()) ON CONFLICT(organization_id,guild_id,actor_hash) DO UPDATE SET attempts=CASE WHEN promotion_attempt_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE promotion_attempt_limits.attempts+1 END,window_start=CASE WHEN promotion_attempt_limits.window_start<now()-interval '15 minutes' THEN now() ELSE promotion_attempt_limits.window_start END RETURNING attempts`.execute(
          tx,
        )
      ).rows[0]!.attempts;
    });
    assert(attempts <= 10, "PROMOTION_UNAVAILABLE", 429);
    const digest = this.vault.digest(
      "promotion-code:v1",
      input.code.trim().toUpperCase(),
    );
    const requestDigest = this.vault.digest(
      "promotion-reservation:" + s.organizationId + ":" + s.guildId,
      input.idempotencyKey,
    );
    return this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      const code = (
        await sql<Code>`SELECT * FROM promotion_codes WHERE code_hmac=${digest}`.execute(
          tx,
        )
      ).rows[0];
      assert(code, "PROMOTION_UNAVAILABLE");
      const prior = (
        await sql<Reservation>`SELECT * FROM promotion_redemption_reservations WHERE ${tenant(s)} AND request_digest=${requestDigest}`.execute(
          tx,
        )
      ).rows[0];
      if (prior) {
        assert(
          prior.code_id === code.id && prior.offering_id === input.offeringId,
          "IDEMPOTENCY_CONFLICT",
          409,
        );
        return { id: prior.id, state: prior.state };
      }
      const {
        c,
        code: lockedCode,
        eligiblePlan,
      } = await this.validate(
        tx,
        s,
        code.campaign_id,
        code.id,
        input.offeringId,
      );
      await sql`UPDATE promotion_redemption_reservations SET state='EXPIRED' WHERE campaign_id=${c.id}::uuid AND state='PENDING' AND expires_at<=now()`.execute(
        tx,
      );

      const counts = (
        await sql<{
          campaign: number;
          code: number;
          guild: number;
        }>`SELECT count(*)::integer AS campaign,count(*) FILTER(WHERE code_id=${code.id}::uuid)::integer AS code,count(*) FILTER(WHERE guild_id=${s.guildId})::integer AS guild FROM promotion_redemption_reservations WHERE campaign_id=${c.id}::uuid AND state='PENDING' AND expires_at>now()`.execute(
          tx,
        )
      ).rows[0]!;
      const redeemed = (
        await sql<{
          count: number;
        }>`SELECT count(*)::integer AS count FROM promotion_redemptions WHERE campaign_id=${c.id}::uuid AND guild_id=${s.guildId}`.execute(
          tx,
        )
      ).rows[0]!.count;
      assert(
        (c.max_redemptions === null ||
          c.redeemed_count + counts.campaign < c.max_redemptions) &&
          lockedCode.redeemed_count + counts.code <
            lockedCode.max_redemptions &&
          redeemed + counts.guild < c.max_redemptions_per_guild,
        "PROMOTION_UNAVAILABLE",
      );
      const id = randomUUID();
      await sql`INSERT INTO promotion_redemption_reservations(id,organization_id,guild_id,campaign_id,code_id,offering_id,eligible_plan,request_digest,expires_at) VALUES(${id}::uuid,${s.organizationId}::uuid,${s.guildId},${c.id}::uuid,${code.id}::uuid,${input.offeringId}::uuid,${eligiblePlan},${requestDigest},LEAST(now()+interval '1 hour',${c.valid_until}::timestamptz,${code.expires_at}::timestamptz))`.execute(
        tx,
      );
      await billingAudit(tx, s, actorHash, "PROMOTION_RESERVED", { id });
      return { id, state: "PENDING" as const };
    });
  }
  // Called only after verified provider financial evidence, never by a redirect/browser.
  async bindSubscription(s: Scope, id: string, subscriptionRef: string) {
    z.uuid().parse(id);
    assert(
      subscriptionRef.length > 0 && subscriptionRef.length <= 200,
      "BILLING_REFERENCE_INVALID",
    );
    const digest = this.vault.digest(
      "billing-reference:STRIPE",
      subscriptionRef,
    );
    await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      const result =
        await sql`UPDATE promotion_redemption_reservations SET reference_digest=${digest} WHERE ${tenant(s)} AND id=${id}::uuid AND state='PENDING' AND expires_at>now() AND (reference_digest IS NULL OR reference_digest=${digest}) RETURNING id`.execute(
          tx,
        );
      assert(result.rows.length, "PROMOTION_UNAVAILABLE");
    });
  }
  async finalize(
    s: Scope,
    id: string,
    confirmationId: string,
    idempotencyKey: string,
  ) {
    [id, confirmationId, idempotencyKey].forEach((value) =>
      z.uuid().parse(value),
    );
    const key = this.vault.digest("promotion-finalization", idempotencyKey);
    return this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      const r = (
        await sql<Reservation>`SELECT * FROM promotion_redemption_reservations WHERE ${tenant(s)} AND id=${id}::uuid`.execute(
          tx,
        )
      ).rows[0];
      assert(r, "PROMOTION_UNAVAILABLE");
      if (r.state === "FINALIZED") {
        assert(r.confirmation_digest === key, "IDEMPOTENCY_CONFLICT", 409);
        return { id, state: "FINALIZED" as const };
      }
      const { c, code, offering, finalPreTaxAmountMinor } = await this.validate(
        tx,
        s,
        r.campaign_id,
        r.code_id,
        r.offering_id,
        r.eligible_plan,
      );
      const locked = (
        await sql<Reservation>`SELECT * FROM promotion_redemption_reservations WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(
          tx,
        )
      ).rows[0]!;
      if (locked.state === "FINALIZED") {
        assert(locked.confirmation_digest === key, "IDEMPOTENCY_CONFLICT", 409);
        return { id, state: "FINALIZED" as const };
      }
      assert(
        locked.state === "PENDING" &&
          locked.expires_at > new Date() &&
          locked.reference_digest,
        "PROMOTION_UNAVAILABLE",
      );
      const guildCount = (
        await sql<{
          count: number;
        }>`SELECT count(*)::integer AS count FROM promotion_redemptions WHERE campaign_id=${c.id}::uuid AND guild_id=${s.guildId}`.execute(
          tx,
        )
      ).rows[0]!.count;
      assert(
        (c.max_redemptions === null || c.redeemed_count < c.max_redemptions) &&
          code.redeemed_count < code.max_redemptions &&
          guildCount < c.max_redemptions_per_guild,
        "PROMOTION_UNAVAILABLE",
      );
      const confirmed = await sql<{
        commercial_evidence: unknown;
        associated_offering_id: string | null;
      }>`SELECT e.normalized->'commercialEvidence' AS commercial_evidence,b.offering_id AS associated_offering_id FROM billing_provider_events e JOIN billing_subscriptions b ON b.provider=e.provider AND b.reference_digest=e.normalized->>'referenceDigest' JOIN billing_offerings o ON o.id=${r.offering_id}::uuid WHERE e.id=${confirmationId}::uuid AND e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.provider='STRIPE' AND e.projected_at IS NOT NULL AND e.normalized->>'status'='ACTIVE' AND b.provider_event_key=e.normalized->>'eventDigest' AND b.status='ACTIVE' AND b.plan_key=o.plan_key AND b.plan_revision=o.plan_revision AND b.reference_digest=${locked.reference_digest} AND (b.current_period_end IS NULL OR b.current_period_end>now())`.execute(
        tx,
      );
      assert(confirmed.rows.length, "BILLING_PAYMENT_NOT_CONFIRMED", 409);
      assert(
        confirmed.rows[0]!.associated_offering_id === offering.id &&
          matchesPromotionCommercialEvidence(
            this.context(id, c, offering, finalPreTaxAmountMinor),
            confirmed.rows[0]!.commercial_evidence,
          ),
        "PROMOTION_COMMERCIAL_EVIDENCE_REQUIRED",
        409,
      );
      await sql`UPDATE promotion_campaigns SET redeemed_count=redeemed_count+1 WHERE id=${r.campaign_id}::uuid`.execute(
        tx,
      );
      await sql`UPDATE promotion_codes SET redeemed_count=redeemed_count+1 WHERE id=${r.code_id}::uuid`.execute(
        tx,
      );
      await sql`UPDATE promotion_redemption_reservations SET state='FINALIZED',finalized_at=now(),confirmation_digest=${key} WHERE id=${id}::uuid`.execute(
        tx,
      );
      await sql`INSERT INTO promotion_redemptions(id,organization_id,guild_id,code_id,campaign_id,benefit_start,request_digest,result_plan) SELECT ${randomUUID()}::uuid,organization_id,guild_id,code_id,campaign_id,now(),request_digest,o.plan_key FROM promotion_redemption_reservations r JOIN billing_offerings o ON o.id=r.offering_id WHERE r.id=${id}::uuid`.execute(
        tx,
      );
      await billingAudit(tx, s, null, "PROMOTION_FINALIZED", { id });
      return { id, state: "FINALIZED" as const };
    });
  }
  async cancel(s: Scope, id: string) {
    z.uuid().parse(id);
    await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      await sql`UPDATE promotion_redemption_reservations SET state='CANCELED' WHERE ${tenant(s)} AND id=${id}::uuid AND state='PENDING'`.execute(
        tx,
      );
    });
  }
  async expire() {
    return sql`UPDATE promotion_redemption_reservations SET state='EXPIRED' WHERE state='PENDING' AND expires_at<=now()`.execute(
      this.db,
    );
  }
}
