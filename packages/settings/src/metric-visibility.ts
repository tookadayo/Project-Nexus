import { featureDecision, type EffectiveEntitlement } from "./billing/domain";

// Presentation boundary only: computation and coverage remain independent of billing.
// Keep sample counts, definitions and UNKNOWN/PARTIAL evidence when hiding a value.
export function visibleMetrics<
  T extends Record<
    string,
    { value: number | null; evidence?: { value: number | null } }
  >,
>(metrics: T, state: EffectiveEntitlement): T {
  const copy = structuredClone(metrics);
  if (featureDecision(state, "percentile_metrics").allowed) return copy;
  for (const [key, metric] of Object.entries(copy))
    if (/median|p75|p90|percentile/i.test(key)) {
      metric.value = null;
      if (metric.evidence) metric.evidence.value = null;
      Object.assign(metric, { visibility: "PLAN_RESTRICTED" });
    }
  return copy;
}
