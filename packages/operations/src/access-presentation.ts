import type { Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import { isDomainError } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import { canonicalFeatures } from "../../settings/src/plan-registry";
import {
  featureDecision,
  resolveEntitlements,
} from "../../settings/src/billing/domain";
import { betaAccess } from "../../security/src/hosted-beta";
import { analysisUsage } from "../../analysis/src/index";
import { operationsAccess, actorPermissions } from "./policy";

/** Current, authorized, provider-neutral read model. Does not reserve or consume a run. */
export async function operationsPresentation(tx: Tx, s: Scope, actor: Actor) {
  const state = await operationsAccess(tx, s, actor, "READ"),
    permissions = await actorPermissions(tx, s, actor);
  const invitation = await betaAccess(tx, s, "read");
  let workAllowed = true;
  try {
    await betaAccess(tx, s, "work");
  } catch (error) {
    if (isDomainError(error) && error.code === "BETA_UNAVAILABLE")
      workAllowed = false;
    else throw error;
  }
  const now = new Date(),
    features = canonicalFeatures.filter(
      (key) => featureDecision(state, key).allowed,
    );
  const reason = !permissions.includes("ANALYZE")
    ? "NEXUS_ROLE_REQUIRED"
    : !workAllowed
      ? "BETA_UNAVAILABLE"
      : !features.includes("surface_breakdowns")
        ? "PLAN_REQUIRED"
        : null;
  // Existing monthly allocation/read contract, only for an actor permitted to analyse during active access.
  const usage =
    permissions.includes("ANALYZE") && workAllowed
      ? await analysisUsage(tx, s)
      : null;
  return {
    permissions,
    workAllowed,
    canSave: reason === null,
    saveReason: reason,
    compare: features.includes("comparable_periods"),
    advanced: features.includes("surface_breakdowns"),
    csv: features.includes("csv_export"),
    historyDays: state.limits.historyDays,
    access: {
      plan: state.plan,
      basePlan: resolveEntitlements(
        {
          subscriptions: state.subscriptions,
          grants: [],
          privacyDeleted: state.privacyDeleted,
        },
        now,
      ).plan,
      features,
      historyDays: state.limits.historyDays,
      monthlyRuns: state.limits.analysisRunsMonthly,
      concurrency: state.limits.analysisConcurrency,
      benefits: state.grants.map((g) => ({
        kind: g.id === invitation?.grant_id ? "BETA" : g.source,
        endsAt: g.endsAt,
      })),
      beta: invitation
        ? {
            state:
              invitation.expires_at && invitation.expires_at <= now
                ? "EXPIRED"
                : invitation.status,
            endsAt: invitation.expires_at?.toISOString() ?? null,
            limits: invitation.limits,
          }
        : null,
      workAllowed,
      usage,
      asOf: now.toISOString(),
      nextMonthlyGrantAt: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
      ).toISOString(),
    },
  };
}
export type CurrentAccess = Awaited<
  ReturnType<typeof operationsPresentation>
>["access"];
