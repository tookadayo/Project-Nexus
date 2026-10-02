import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, tenant, json, type Database } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { IdentityVault } from "../../identity/src/index";
import type { InternalBillingActor } from "../../security/src/billing-authorization";
import {
  plans,
  canonicalFeatures,
  limitKeys,
  type Plan,
  type PlanLimits,
} from "./plan-registry";
import { providers, type BillingProviderKind } from "./billing-domain";
import { EntitlementService } from "./entitlements";
import { BillingService, billingAudit, billingScopeLock } from "./billing";
import {
  discordBillingConfiguration,
  nativeBillingCapability,
} from "./billing-provider";
import { discountCompatibility } from "./billing-policy";
export const promotionTypes = [
  "DISCOUNT",
  "TRIAL",
  "PLAN_GRANT",
  "FEATURE_GRANT",
  "PARTNER_GRANT",
  "DEBUG_GRANT",
] as const;
const guildId = z.string().regex(/^\d{17,20}$/);
export const campaignSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    benefitType: z.enum(promotionTypes),
    targetPlan: z.enum(plans).nullable().default(null),
    features: z.array(z.enum(canonicalFeatures)).max(40).default([]),
    discountType: z.enum(["PERCENT", "FIXED"]).nullable().default(null),
    discountValue: z.number().int().positive().nullable().default(null),
    durationDays: z.number().int().min(1).max(3650).nullable().default(null),
    untilRevoked: z.boolean().default(false),
    validFrom: z.iso.datetime(),
    validUntil: z.iso.datetime().nullable().default(null),
    maxRedemptions: z
      .number()
      .int()
      .min(1)
      .max(1000000)
      .nullable()
      .default(null),
    maxRedemptionsPerGuild: z.number().int().min(1).max(100).default(1),
    targetGuildId: guildId.nullable().default(null),
    targetOrganizationId: z.uuid().nullable().default(null),
    allowedPlans: z.array(z.enum(plans)).min(1).max(5),
    allowedProviders: z.array(z.enum(providers)).min(1).max(3),
    stackingPolicy: z.enum(["DENY", "MAX"]).default("DENY"),
  })
  .strict()
  .superRefine((value, ctx) => {
    const reject = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (value.validUntil && value.validUntil <= value.validFrom)
      reject("Invalid campaign window");
    if (
      value.benefitType !== "DISCOUNT" &&
      !(
        (value.durationDays !== null && !value.untilRevoked) ||
        (value.durationDays === null && value.untilRevoked)
      )
    )
      reject("Choose a duration or until revoked");
    if (
      ["TRIAL", "PLAN_GRANT", "PARTNER_GRANT", "DEBUG_GRANT"].includes(
        value.benefitType,
      ) &&
      (!value.targetPlan || value.targetPlan === "FREE")
    )
      reject("Paid target plan required");
    if (value.benefitType === "FEATURE_GRANT" && !value.features.length)
      reject("Features required");
    if (
      value.benefitType === "DEBUG_GRANT" &&
      (value.untilRevoked ||
        value.durationDays === null ||
        value.durationDays > 30)
    )
      reject("Debug expiry must be within 30 days");
    if (
      value.benefitType === "DISCOUNT" &&
      (!value.targetPlan ||
        !value.discountType ||
        !value.discountValue ||
        (value.discountType === "PERCENT" && value.discountValue > 100))
    )
      reject("Valid discount required");
  });
export type PromotionCampaign = z.infer<typeof campaignSchema>;
type CampaignRow = {
  id: string;
  name: string;
  benefit_type: PromotionCampaign["benefitType"];
  target_plan: Plan | null;
  features: PromotionCampaign["features"];
  discount_type: PromotionCampaign["discountType"];
  discount_value: number | null;
  duration_days: number | null;
  until_revoked: boolean;
  valid_from: Date;
  valid_until: Date | null;
  max_redemptions: number | null;
  redeemed_count: number;
  max_redemptions_per_guild: number;
  target_guild_id: string | null;
  target_organization_id: string | null;
  allowed_plans: Plan[];
  allowed_providers: BillingProviderKind[];
  stacking_policy: "DENY" | "MAX";
  revoked_at: Date | null;
  activated_at: Date | null;
};
export class PromotionService {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
  ) {}
  private requireInternal(actor: InternalBillingActor) {
    assert(
      actor.internal && actor.hash.length === 64 && actor.reason.length >= 8,
      "NEXUS_INTERNAL_ADMIN_REQUIRED",
      403,
    );
  }
  async createCampaign(actor: InternalBillingActor, input: unknown) {
    this.requireInternal(actor);
    const c = campaignSchema.parse(input),
      id = randomUUID();
    await this.db.transaction().execute(async (tx) => {
      await sql`INSERT INTO promotion_campaigns(id,name,benefit_type,target_plan,features,discount_type,discount_value,duration_days,until_revoked,valid_from,valid_until,max_redemptions,max_redemptions_per_guild,target_guild_id,target_organization_id,allowed_plans,allowed_providers,stacking_policy,created_by,activated_at)
   VALUES(${id}::uuid,${c.name},${c.benefitType},${c.targetPlan},${json(c.features)},${c.discountType},${c.discountValue},${c.durationDays},${c.untilRevoked},${c.validFrom}::timestamptz,${c.validUntil}::timestamptz,${c.maxRedemptions},${c.maxRedemptionsPerGuild},${c.targetGuildId},${c.targetOrganizationId}::uuid,${json(c.allowedPlans)},${json(c.allowedProviders)},${c.stackingPolicy},${actor.hash},${c.benefitType === "DISCOUNT" ? null : new Date()})`.execute(
        tx,
      );
      await billingAudit(tx, null, actor.hash, "promotion.campaign_created", {
        id,
        benefitType: c.benefitType,
        reason: actor.reason,
      });
    });
    return { id };
  }
  async activateCampaign(actor: InternalBillingActor, id: string) {
    this.requireInternal(actor);
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      const c = (
        await sql<CampaignRow>`SELECT * FROM promotion_campaigns WHERE id=${id}::uuid FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(c && !c.revoked_at, "CAMPAIGN_UNAVAILABLE");
      if (c.benefit_type === "DISCOUNT") {
        const capability = nativeBillingCapability(
          discordBillingConfiguration(),
        );
        assert(
          capability !== "DISABLED" && capability !== "NOT_CONFIGURED",
          "DISCOUNT_POLICY_REVIEW_REQUIRED",
        );
        for (const provider of c.allowed_providers) {
          const offers = (
            await sql<{
              provider: BillingProviderKind;
              final_price_minor: number | null;
              currency: string | null;
              parity_reviewed_at: Date | null;
            }>`SELECT provider,final_price_minor,currency,parity_reviewed_at FROM billing_offerings WHERE plan_key=${c.target_plan} AND enabled`.execute(
              tx,
            )
          ).rows;
          const external = offers.find((offer) => offer.provider === provider),
            discord = offers.find((offer) => offer.provider === "DISCORD");
          const decision = discountCompatibility({
            provider,
            discountType: c.discount_type!,
            discountValue: c.discount_value!,
            basePriceMinor: external?.final_price_minor ?? null,
            discordFinalPriceMinor: discord?.final_price_minor ?? null,
            discordOfferingSupported: capability === "AVAILABLE",
            parityReviewed: Boolean(discord?.parity_reviewed_at),
            baseCurrency: external?.currency,
            discordCurrency: discord?.currency,
          });
          assert(
            decision.allowed,
            decision.reason ?? "DISCOUNT_PROVIDER_INCOMPATIBLE",
          );
        }
      }
      await sql`UPDATE promotion_campaigns SET activated_at=now() WHERE id=${id}::uuid`.execute(
        tx,
      );
      await billingAudit(tx, null, actor.hash, "promotion.campaign_activated", {
        id,
        reason: actor.reason,
      });
      return { id };
    });
  }
  async generateCode(
    actor: InternalBillingActor,
    campaignId: string,
    input: {
      expiresAt?: string | null;
      maxRedemptions?: number;
      targetGuildId?: string | null;
      targetOrganizationId?: string | null;
    } = {},
  ) {
    this.requireInternal(actor);
    z.uuid().parse(campaignId);
    const options = z
      .object({
        expiresAt: z.iso.datetime().nullable().optional(),
        maxRedemptions: z.number().int().min(1).max(1000000).optional(),
        targetGuildId: guildId.nullable().optional(),
        targetOrganizationId: z.uuid().nullable().optional(),
      })
      .strict()
      .parse(input);
    const code = "NXP-" + randomBytes(24).toString("hex").toUpperCase(),
      id = randomUUID(),
      prefix = code.slice(0, 10),
      hmac = this.vault.digest("promotion-code:v1", code);
    await this.db.transaction().execute(async (tx) => {
      const campaign = (
        await sql<CampaignRow>`SELECT * FROM promotion_campaigns WHERE id=${campaignId}::uuid AND revoked_at IS NULL FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(campaign, "CAMPAIGN_UNAVAILABLE");
      assert(
        !["DEBUG_GRANT", "PARTNER_GRANT"].includes(campaign.benefit_type),
        "INTERNAL_GRANT_ONLY",
      );
      await sql`INSERT INTO promotion_codes(id,campaign_id,code_prefix,code_hmac,expires_at,max_redemptions,target_guild_id,target_organization_id) VALUES(${id}::uuid,${campaignId}::uuid,${prefix},${hmac},${options.expiresAt ?? campaign.valid_until?.toISOString() ?? null}::timestamptz,${options.maxRedemptions ?? 1},${options.targetGuildId ?? null},${options.targetOrganizationId ?? null}::uuid)`.execute(
        tx,
      );
      await billingAudit(tx, null, actor.hash, "promotion.code_generated", {
        id,
        campaignId,
        prefix,
        reason: actor.reason,
      });
    });
    return { id, codePrefix: prefix, code };
  }
  async redeem(
    s: Scope,
    actorHash: string,
    input: string,
    provider: BillingProviderKind = "MANUAL",
    now = new Date(),
    requestId?: string,
  ) {
    // Persistent throttling is committed even when the redemption transaction fails.
    const attempt = await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      return (
        await sql<{
          attempts: number;
        }>`INSERT INTO promotion_attempt_limits(organization_id,guild_id,actor_hash,window_start) VALUES(${s.organizationId}::uuid,${s.guildId},${actorHash},${now}) ON CONFLICT(organization_id,guild_id,actor_hash) DO UPDATE SET attempts=CASE WHEN promotion_attempt_limits.window_start<${new Date(now.getTime() - 900000)} THEN 1 ELSE promotion_attempt_limits.attempts+1 END,window_start=CASE WHEN promotion_attempt_limits.window_start<${new Date(now.getTime() - 900000)} THEN EXCLUDED.window_start ELSE promotion_attempt_limits.window_start END RETURNING attempts`.execute(
          tx,
        )
      ).rows[0]!;
    });
    assert(attempt.attempts <= 10, "PROMOTION_UNAVAILABLE", 429);
    assert(
      input.length <= 128 && /^NXP-[A-F0-9]{48}$/i.test(input.trim()),
      "PROMOTION_UNAVAILABLE",
    );
    const digest = this.vault.digest(
      "promotion-code:v1",
      input.trim().toUpperCase(),
    );
    assert(!requestId || requestId.length <= 100, "PROMOTION_UNAVAILABLE");
    const requestDigest = requestId
      ? this.vault.digest(
          "promotion-request:" + s.organizationId + ":" + s.guildId,
          requestId,
        )
      : null;
    return this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      if (requestDigest) {
        const prior = (
          await sql<{
            result_plan: Plan;
            benefit_end: Date | null;
            created_grant: string;
            actor_hash: string;
            code_hmac: string;
          }>`SELECT r.result_plan,r.benefit_end,r.created_grant,r.actor_hash,c.code_hmac FROM promotion_redemptions r JOIN promotion_codes c ON c.id=r.code_id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.request_digest=${requestDigest}`.execute(
            tx,
          )
        ).rows[0];
        if (prior) {
          assert(
            prior.actor_hash === actorHash && prior.code_hmac === digest,
            "PROMOTION_UNAVAILABLE",
          );
          return {
            plan: prior.result_plan,
            benefitEnd: prior.benefit_end?.toISOString() ?? null,
            grantId: prior.created_grant,
          };
        }
      }
      const found = (
        await sql<{
          campaign_id: string;
        }>`SELECT campaign_id FROM promotion_codes WHERE code_hmac=${digest}`.execute(
          tx,
        )
      ).rows[0];
      assert(found, "PROMOTION_UNAVAILABLE");
      const c = (
        await sql<CampaignRow>`SELECT * FROM promotion_campaigns WHERE id=${found.campaign_id}::uuid FOR UPDATE`.execute(
          tx,
        )
      ).rows[0]!;
      const code = (
        await sql<{
          id: string;
          revoked_at: Date | null;
          expires_at: Date | null;
          max_redemptions: number;
          redeemed_count: number;
          target_guild_id: string | null;
          target_organization_id: string | null;
        }>`SELECT * FROM promotion_codes WHERE code_hmac=${digest} FOR UPDATE`.execute(
          tx,
        )
      ).rows[0]!;
      const valid =
        !c.revoked_at &&
        !code.revoked_at &&
        c.activated_at &&
        c.valid_from <= now &&
        (!c.valid_until || c.valid_until > now) &&
        (!code.expires_at || code.expires_at > now);
      assert(
        valid &&
          (!c.target_guild_id || c.target_guild_id === s.guildId) &&
          (!code.target_guild_id || code.target_guild_id === s.guildId) &&
          (!c.target_organization_id ||
            c.target_organization_id === s.organizationId) &&
          (!code.target_organization_id ||
            code.target_organization_id === s.organizationId),
        "PROMOTION_UNAVAILABLE",
      );
      const entitlements = await new EntitlementService(tx).effective(s, now);
      assert(
        c.allowed_plans.includes(entitlements.plan) &&
          c.allowed_providers.includes(provider),
        "PROMOTION_UNAVAILABLE",
      );
      assert(
        !["DEBUG_GRANT", "PARTNER_GRANT"].includes(c.benefit_type),
        "PROMOTION_UNAVAILABLE",
      );
      const counts = (
        await sql<{
          guild: number;
        }>`SELECT count(*)::integer AS guild FROM promotion_redemptions WHERE campaign_id=${c.id}::uuid AND guild_id=${s.guildId}`.execute(
          tx,
        )
      ).rows[0]!;
      assert(
        (c.max_redemptions === null || c.redeemed_count < c.max_redemptions) &&
          counts.guild < c.max_redemptions_per_guild &&
          code.redeemed_count < code.max_redemptions,
        "PROMOTION_UNAVAILABLE",
      );
      assert(
        c.stacking_policy === "MAX" ||
          !entitlements.grants.some((grant) =>
            ["PROMOTION", "TRIAL", "PARTNER", "DEBUG"].includes(grant.source),
          ),
        "PROMOTION_UNAVAILABLE",
      );
      // A payment discount needs an implemented provider action. Never fabricate a coupon or payment.
      assert(
        c.benefit_type !== "DISCOUNT",
        "DISCOUNT_PROVIDER_NOT_CONFIGURED",
        503,
      );
      const grantId = randomUUID(),
        ends = c.duration_days
          ? new Date(now.getTime() + c.duration_days * 86400000)
          : null;
      await sql`INSERT INTO entitlement_grants(id,organization_id,guild_id,source,plan_key,features,starts_at,ends_at,created_by,reason) VALUES(${grantId}::uuid,${s.organizationId}::uuid,${s.guildId},${c.benefit_type === "TRIAL" ? "TRIAL" : "PROMOTION"},${c.target_plan},${json(c.features)},${now},${ends},${actorHash},'Promotion redemption')`.execute(
        tx,
      );
      const state = await new BillingService(this.db, this.vault).refreshState(
        s,
        tx,
        entitlements.plan,
        now,
      );
      const id = randomUUID();
      // Anonymous lifetime counters survive removal of community-linked history.
      await sql`UPDATE promotion_campaigns SET redeemed_count=redeemed_count+1 WHERE id=${c.id}::uuid`.execute(
        tx,
      );
      await sql`UPDATE promotion_codes SET redeemed_count=redeemed_count+1 WHERE id=${code.id}::uuid`.execute(
        tx,
      );
      await sql`INSERT INTO promotion_redemptions(id,organization_id,guild_id,actor_hash,code_id,campaign_id,benefit_start,benefit_end,created_grant,request_digest,result_plan) VALUES(${id}::uuid,${s.organizationId}::uuid,${s.guildId},${actorHash},${code.id}::uuid,${c.id}::uuid,${now},${ends},${grantId}::uuid,${requestDigest},${state.plan})`.execute(
        tx,
      );
      await billingAudit(tx, s, actorHash, "promotion.redeemed", {
        id,
        grantId,
      });
      return {
        plan: state.plan,
        benefitEnd: ends?.toISOString() ?? null,
        grantId,
      };
    });
  }
  async issueGrant(
    s: Scope,
    actor: InternalBillingActor,
    input: {
      source: "PARTNER" | "DEBUG" | "CONTRACT";
      plan: Plan;
      durationDays?: number;
      untilRevoked?: boolean;
      features?: PromotionCampaign["features"];
      limits?: Partial<PlanLimits>;
    },
  ) {
    this.requireInternal(actor);
    const data = z
      .object({
        source: z.enum(["PARTNER", "DEBUG", "CONTRACT"]),
        plan: z.enum(plans),
        durationDays: z.number().int().min(1).max(3650).optional(),
        untilRevoked: z.boolean().optional(),
        features: z.array(z.enum(canonicalFeatures)).optional(),
        limits: z
          .partialRecord(
            z.enum(limitKeys),
            z.number().int().nonnegative().max(100000000).nullable(),
          )
          .optional(),
      })
      .strict()
      .parse(input);
    assert(!(data.untilRevoked && data.durationDays), "INVALID_GRANT_DURATION");
    const days = data.durationDays ?? (data.source === "DEBUG" ? 7 : undefined);
    assert(
      data.source !== "DEBUG" || (!data.untilRevoked && days! <= 30),
      "DEBUG_EXPIRY_REQUIRED",
    );
    assert(
      data.source === "CONTRACT" || !data.limits,
      "CONTRACT_LIMITS_REQUIRED",
    );
    assert(
      data.source === "DEBUG" || days || data.untilRevoked,
      "GRANT_DURATION_REQUIRED",
    );
    const id = randomUUID(),
      now = new Date(),
      ends = days ? new Date(now.getTime() + days * 86400000) : null;
    await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      const before = await new EntitlementService(tx).effective(s);
      await sql`INSERT INTO entitlement_grants(id,organization_id,guild_id,source,plan_key,features,limits,starts_at,ends_at,created_by,reason) VALUES(${id}::uuid,${s.organizationId}::uuid,${s.guildId},${data.source},${data.plan},${json(data.features ?? [])},${json(data.limits ?? {})},${now},${ends},${actor.hash},${actor.reason})`.execute(
        tx,
      );
      await billingAudit(
        tx,
        s,
        actor.hash,
        data.source.toLowerCase() + ".grant_issued",
        {
          id,
          plan: data.plan,
          endsAt: ends?.toISOString() ?? null,
          reason: actor.reason,
        },
      );
      await new BillingService(this.db, this.vault).refreshState(
        s,
        tx,
        before.plan,
      );
    });
    return { id, endsAt: ends?.toISOString() ?? null };
  }
  async revokeGrant(s: Scope, actor: InternalBillingActor, id: string) {
    this.requireInternal(actor);
    z.uuid().parse(id);
    await this.db.transaction().execute(async (tx) => {
      await billingScopeLock(tx, s);
      const before = await new EntitlementService(tx).effective(s);
      const changed =
        await sql`UPDATE entitlement_grants SET revoked_at=COALESCE(revoked_at,now()) WHERE ${tenant(s)} AND id=${id}::uuid RETURNING id`.execute(
          tx,
        );
      assert(changed.rows.length, "GRANT_NOT_FOUND", 404);
      await billingAudit(tx, s, actor.hash, "grant.revoked", {
        id,
        reason: actor.reason,
      });
      await new BillingService(this.db, this.vault).refreshState(
        s,
        tx,
        before.plan,
      );
    });
  }
  async revoke(
    actor: InternalBillingActor,
    kind: "code" | "campaign",
    id: string,
  ) {
    this.requireInternal(actor);
    z.uuid().parse(id);
    await this.db.transaction().execute(async (tx) => {
      const changed =
        await sql`UPDATE ${sql.table(kind === "code" ? "promotion_codes" : "promotion_campaigns")} SET revoked_at=COALESCE(revoked_at,now()) WHERE id=${id}::uuid RETURNING id`.execute(
          tx,
        );
      assert(changed.rows.length, "PROMOTION_NOT_FOUND", 404);
      await billingAudit(
        tx,
        null,
        actor.hash,
        "promotion." + kind + "_revoked",
        { id, reason: actor.reason },
      );
    });
  }
  async search(actor: InternalBillingActor, query = "") {
    this.requireInternal(actor);
    assert(query.length <= 120, "INVALID_SEARCH");
    return this.db.transaction().execute(async (tx) => {
      const rows = (
        await sql`SELECT id,name,benefit_type,target_plan,valid_until,revoked_at,activated_at FROM promotion_campaigns WHERE name ILIKE ${"%" + query + "%"} ORDER BY created_at DESC LIMIT 100`.execute(
          tx,
        )
      ).rows;
      await billingAudit(tx, null, actor.hash, "promotion.campaign_search", {
        count: rows.length,
      });
      return rows;
    });
  }
  async history(actor: InternalBillingActor, id: string) {
    this.requireInternal(actor);
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      const rows = (
        await sql`SELECT id,guild_id,redeemed_at,benefit_start,benefit_end,created_grant FROM promotion_redemptions WHERE campaign_id=${id}::uuid ORDER BY redeemed_at DESC LIMIT 100`.execute(
          tx,
        )
      ).rows;
      await billingAudit(tx, null, actor.hash, "promotion.redemption_viewed", {
        campaignId: id,
        count: rows.length,
      });
      return rows;
    });
  }
}
