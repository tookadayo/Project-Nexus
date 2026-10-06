import { sql, tenant, type Tx } from "../../../db/src/index";
import { assert, type Scope } from "../../../shared/src/index";
import {
  planRegistry,
  type Feature,
  type Plan,
  type LimitKey,
} from "../plan-registry";
import {
  resolveEntitlements,
  featureDecision,
  type EntitlementGrant,
  type EntitlementSubscription,
  type EffectiveEntitlement,
} from "./domain";
export {
  features,
  featureAvailability,
  planCurrency,
  planRegistry,
} from "../plan-registry";
export type { Feature, Plan } from "../plan-registry";
// Query/export safety bound, independent of plan visibility and physical retention.
export const SYSTEM_MAX_HISTORY_DAYS = 3650;
export function visibleHistoryDays(
  state: Awaited<ReturnType<EntitlementService["effective"]>>,
  requested: number,
) {
  assert(
    Number.isInteger(requested) &&
      requested > 0 &&
      requested <= SYSTEM_MAX_HISTORY_DAYS,
    "INVALID_HISTORY_RANGE",
  );
  assert(!state.privacyDeleted, "PRIVACY_DELETED", 403);
  return state.limits.historyDays === null
    ? requested
    : Math.min(requested, state.limits.historyDays);
}
export class EntitlementService {
  constructor(private readonly db: Tx) {}
  async effective(
    s: Scope,
    now = new Date(),
    organizationLicense = true,
  ): Promise<EffectiveEntitlement> {
    const subscriptions = (
      await sql<EntitlementSubscription>`SELECT b.id,b.provider,b.plan_key AS plan,b.status,account.trial_allowed AS "trialAllowed",b.current_period_end::text AS "periodEnd",b.scheduled_plan AS "scheduledPlan",b.scheduled_at::text AS "scheduledAt",b.confirmed_at::text AS "confirmedAt",b.last_good_plan AS "lastGoodPlan",b.last_good_until::text AS "lastGoodUntil" FROM billing_subscriptions b JOIN billing_subscription_assignments a ON a.subscription_id=b.id AND a.organization_id=b.organization_id JOIN billing_accounts account ON account.id=b.account_id AND account.deleted_at IS NULL WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId}`.execute(
        this.db,
      )
    ).rows;
    if (!subscriptions.length) {
      const legacy = (
        await sql<{
          plan_key: Plan;
          status: string;
          valid_until: Date | null;
        }>`SELECT plan_key,status,valid_until FROM guild_subscriptions WHERE ${tenant(s)}`.execute(
          this.db,
        )
      ).rows[0];
      if (legacy?.status === "active")
        subscriptions.push({
          id: "legacy",
          provider: "MANUAL",
          plan: legacy.plan_key,
          status: "ACTIVE",
          periodEnd: legacy.valid_until?.toISOString() ?? null,
          scheduledPlan: null,
          scheduledAt: null,
          confirmedAt: new Date(0).toISOString(),
          lastGoodPlan: null,
          lastGoodUntil: null,
        });
    }
    const override =
      process.env.NODE_ENV === "development"
        ? process.env.NEXUS_DEV_PLAN
        : undefined;
    if (override && Object.hasOwn(planRegistry, override))
      subscriptions.splice(0, subscriptions.length, {
        id: "development",
        provider: "MANUAL",
        plan: override as Plan,
        status: "ACTIVE",
        periodEnd: null,
        scheduledPlan: null,
        scheduledAt: null,
        confirmedAt: now.toISOString(),
        lastGoodPlan: null,
        lastGoodUntil: null,
      });
    const grants = (
      await sql<EntitlementGrant>`SELECT id,source,plan_key AS plan,features,limits,starts_at::text AS "startsAt",ends_at::text AS "endsAt",revoked_at::text AS "revokedAt" FROM entitlement_grants WHERE organization_id=${s.organizationId}::uuid AND (guild_id=${s.guildId} OR guild_id IS NULL) AND revoked_at IS NULL`.execute(
        this.db,
      )
    ).rows;
    const privacyDeleted =
      (
        await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NULL AND completed_at IS NOT NULL`.execute(
          this.db,
        )
      ).rows.length > 0;
    const local = resolveEntitlements(
      { subscriptions, grants, privacyDeleted },
      now,
    );
    if (
      organizationLicense &&
      !privacyDeleted &&
      !local.features.includes("multi_guild")
    ) {
      const link = (
        await sql<{
          root_organization_id: string;
          home_guild_id: string;
          position: number;
        }>`SELECT g.root_organization_id,o.home_guild_id,g.position FROM (SELECT *,row_number() OVER(PARTITION BY root_organization_id ORDER BY CASE WHEN organization_id=root_organization_id THEN 0 ELSE 1 END,linked_at,guild_id)::integer AS position FROM operations_org_guilds WHERE state='ACTIVE' AND root_organization_id=(SELECT root_organization_id FROM operations_org_guilds WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId} AND state='ACTIVE')) g JOIN operations_organizations o ON o.id=g.root_organization_id WHERE g.organization_id=${s.organizationId}::uuid AND g.guild_id=${s.guildId} AND (o.id<>${s.organizationId}::uuid OR o.home_guild_id<>${s.guildId})`.execute(
          this.db,
        )
      ).rows[0];
      if (link) {
        const owner = await this.effective(
          {
            organizationId: link.root_organization_id,
            guildId: link.home_guild_id,
          },
          now,
          false,
        );
        if (
          !owner.privacyDeleted &&
          owner.features.includes("multi_guild") &&
          (owner.limits.guilds === null || link.position <= owner.limits.guilds)
        )
          return resolveEntitlements(
            {
              subscriptions,
              privacyDeleted,
              grants: [
                ...grants,
                {
                  id: "organization-license:" + link.root_organization_id,
                  source: "CONTRACT",
                  plan: owner.plan,
                  features: [],
                  limits: owner.limits,
                  startsAt: new Date(0).toISOString(),
                  endsAt: null,
                  revokedAt: null,
                },
              ],
            },
            now,
          );
      }
    }
    return local;
  }
  async plan(s: Scope): Promise<Plan> {
    return (await this.effective(s)).plan;
  }
  async check(s: Scope, feature: Feature, now = new Date()) {
    return featureDecision(await this.effective(s, now), feature);
  }
  async can(s: Scope, feature: Feature) {
    return (await this.check(s, feature)).allowed;
  }
  async require(s: Scope, feature: Feature) {
    const decision = await this.check(s, feature);
    assert(decision.allowed, decision.reason ?? "ENTITLEMENT_REQUIRED", 403);
    return decision;
  }
  async limit(s: Scope, key: LimitKey, used = 0, now = new Date()) {
    const state = await this.effective(s, now),
      limit = state.limits[key],
      soft = key === "monthlyObservedMembers",
      reached = limit !== null && used >= limit;
    return {
      allowed: !state.privacyDeleted && (soft || !reached),
      effectivePlan: state.plan,
      source: state.source,
      requiredPlan: state.plan,
      limit,
      usage: used,
      resetAt: ["monthlyObservedMembers", "apiRequestsMonthly"].includes(key)
        ? new Date(
            Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
          ).toISOString()
        : null,
      upgradeOptions: [],
      reason: state.privacyDeleted
        ? "PRIVACY_DELETED"
        : reached
          ? soft
            ? "USAGE_SOFT_LIMIT"
            : "BILLING_LIMIT_REACHED"
          : state.reason,
    };
  }
  async visibleHistoryDays(s: Scope, requested: number) {
    return visibleHistoryDays(await this.effective(s), requested);
  }
  async canDefineActivation(s: Scope, definition: unknown) {
    if (await this.can(s, "custom_activation")) return true;
    const d = definition as {
      windowSeconds?: unknown;
      rule?: { op?: unknown; event?: unknown; withinSeconds?: unknown };
    };
    return (
      d?.windowSeconds === 604800 &&
      d.rule?.op === "event" &&
      ["message.sent", "reply.received", "scheduled_event.subscribed"].includes(
        String(d.rule.event),
      ) &&
      d.rule.withinSeconds === 604800
    );
  }
  async usage(s: Scope, now = new Date()) {
    const month = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      ),
      end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const used = (
      await sql<{
        n: number;
      }>`SELECT count(*)::integer AS n FROM usage_counters WHERE ${tenant(s)} AND month=${month.toISOString().slice(0, 10)}::date`.execute(
        this.db,
      )
    ).rows[0]!.n;
    const state = await this.effective(s, now),
      plan = state.plan,
      included = state.limits.monthlyObservedMembers;
    return {
      plan,
      used,
      included,
      softLimit: included === null ? null : Math.ceil(included * 1.2),
      projected: Math.ceil(
        (used * (end.getTime() - month.getTime())) /
          Math.max(86400000, now.getTime() - month.getTime()),
      ),
      automaticOverageCharge: false,
    };
  }
}
export async function recordUsage(
  tx: Tx,
  s: Scope,
  memberHash: string,
  at: Date,
) {
  const month = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  await sql`INSERT INTO usage_counters VALUES(${s.organizationId}::uuid,${s.guildId},${month}::date,${memberHash},${at}) ON CONFLICT DO NOTHING`.execute(
    tx,
  );
}
export { UnconfiguredBillingProvider } from "./providers/types";
export type { BillingProvider } from "./providers/types";
