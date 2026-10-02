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
import { discountCompatibility } from "./policy";
type Offer = {
  id: string;
  plan_key: Plan;
  plan_revision: number;
  provider: string;
  currency: string | null;
  final_price_minor: number | null;
  billing_interval: string;
  billing_interval_count: number;
  parity_reviewed_at: Date | null;
};
export async function reviewDiscountOffering(
  tx: Tx,
  offering: Offer,
  discountType: "PERCENT" | "FIXED",
  discountValue: number,
) {
  const matches = (
    await sql<Offer>`SELECT * FROM billing_offerings WHERE plan_key=${offering.plan_key} AND plan_revision=${offering.plan_revision} AND provider='DISCORD' AND billing_interval=${offering.billing_interval} AND billing_interval_count=${offering.billing_interval_count} AND enabled`.execute(
      tx,
    )
  ).rows;
  const sameCurrency = matches.filter(
    (row) => row.currency === offering.currency,
  );
  assert(sameCurrency.length <= 1, "OFFERING_POLICY_AMBIGUOUS");
  const discord = sameCurrency[0] ?? matches[0];
  const decision = discountCompatibility({
    provider: offering.provider as "STRIPE",
    discountType,
    discountValue,
    basePriceMinor: offering.final_price_minor,
    discordFinalPriceMinor: discord?.final_price_minor ?? null,
    discordOfferingSupported: Boolean(discord),
    parityReviewed: Boolean(discord?.parity_reviewed_at),
    parityObligation: discord
      ? true
      : discordMonetizationApplicable(
          discordBillingConfiguration().developerCountry,
          offering.plan_key,
        ),
    baseCurrency: offering.currency,
    discordCurrency: discord?.currency,
  });
  assert(decision.allowed, decision.reason ?? "DISCOUNT_PROVIDER_INCOMPATIBLE");
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
    await reviewDiscountOffering(
      tx,
      offering,
      c.discount_type,
      c.discount_value,
    );
    return { c, code, eligiblePlan: eligiblePlan ?? state.plan };
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
      await sql`INSERT INTO promotion_redemption_reservations(id,organization_id,guild_id,campaign_id,code_id,offering_id,eligible_plan,request_digest,expires_at) VALUES(${id}::uuid,${s.organizationId}::uuid,${s.guildId},${c.id}::uuid,${code.id}::uuid,${input.offeringId}::uuid,${eligiblePlan},${requestDigest},LEAST(now()+interval '30 minutes',${c.valid_until}::timestamptz,${code.expires_at}::timestamptz))`.execute(
        tx,
      );
      await billingAudit(tx, s, actorHash, "promotion.reserved", { id });
      return { id, state: "PENDING" as const };
    });
  }
  // Called only by a future verified provider checkout adapter, never by a redirect/browser.
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
    const result =
      await sql`UPDATE promotion_redemption_reservations SET reference_digest=${digest} WHERE ${tenant(s)} AND id=${id}::uuid AND state='PENDING' AND expires_at>now() AND (reference_digest IS NULL OR reference_digest=${digest}) RETURNING id`.execute(
        this.db,
      );
    assert(result.rows.length, "PROMOTION_UNAVAILABLE");
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
      const { c, code } = await this.validate(
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
      const confirmed =
        await sql`SELECT e.id FROM billing_provider_events e JOIN billing_subscriptions b ON b.provider=e.provider AND b.reference_digest=e.normalized->>'referenceDigest' JOIN billing_offerings o ON o.id=${r.offering_id}::uuid WHERE e.id=${confirmationId}::uuid AND e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.provider='STRIPE' AND e.projected_at IS NOT NULL AND e.normalized->>'status'='ACTIVE' AND b.provider_event_key=e.normalized->>'eventDigest' AND b.status='ACTIVE' AND b.plan_key=o.plan_key AND b.reference_digest=${locked.reference_digest} AND (b.current_period_end IS NULL OR b.current_period_end>now())`.execute(
          tx,
        );
      assert(confirmed.rows.length, "BILLING_PAYMENT_NOT_CONFIRMED", 409);
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
      await billingAudit(tx, s, null, "promotion.finalized", { id });
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
