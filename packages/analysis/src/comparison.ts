import { comparisonEligibility } from "../../shared/src/metric-evidence";
import type { AnalysisMetric, AnalysisResult, AnalysisRun } from "./domain";

export type ComparisonRun = Pick<
  AnalysisRun,
  | "id"
  | "analysis_type"
  | "period_start"
  | "period_end"
  | "period_days"
  | "scope_identity"
  | "recipe_version"
>;
export type AnalysisComparison = {
  comparable: boolean;
  changes: NonNullable<AnalysisResult["baseline"]>["changes"];
  // Optional metadata keeps older presentation callers compatible.
  reasons?: string[];
  current?: { runId: string; from: string; to: string };
  previous?: { runId: string; from: string; to: string };
  unavailableMetrics?: { key: string; reasons: string[] }[];
};
export function metricComparisonReasons(metric: AnalysisMetric) {
  const e = metric.evidence;
  const reasons = [
    ...new Set([
      ...e.comparisonBlockers,
      ...(e.observationState !== "OBSERVED" ? [e.observationState] : []),
      ...(e.coverageState !== "COMPLETE"
        ? ["COVERAGE_" + e.coverageState]
        : []),
      ...(e.collectionEpochIds.length ? [] : ["EPOCH_UNKNOWN"]),
      ...(e.value !== null && Number.isFinite(e.value)
        ? []
        : ["VALUE_UNKNOWN"]),
      ...(!Number.isFinite(Date.parse(e.windowStart)) ||
      !Number.isFinite(Date.parse(e.windowEnd)) ||
      Date.parse(e.windowEnd) <= Date.parse(e.windowStart)
        ? ["WINDOW_MISMATCH"]
        : []),
    ]),
  ];
  return !e.comparable && !reasons.length
    ? ["COMPARISON_UNAVAILABLE"]
    : reasons;
}
export function metricPairReasons(
  current: AnalysisMetric,
  previous?: AnalysisMetric,
) {
  if (!previous) return ["METRIC_MISSING"];
  return [
    ...new Set([
      ...metricComparisonReasons(current),
      ...metricComparisonReasons(previous),
      ...comparisonEligibility(current.evidence, previous.evidence).blockers,
      ...(current.unit !== previous.unit ? ["METHOD_MISMATCH"] : []),
      ...(current.evidence.windowKind !== previous.evidence.windowKind
        ? ["WINDOW_MISMATCH"]
        : []),
      ...(!Number.isFinite(Date.parse(current.evidence.windowStart)) ||
      !Number.isFinite(Date.parse(current.evidence.windowEnd)) ||
      !Number.isFinite(Date.parse(previous.evidence.windowStart)) ||
      !Number.isFinite(Date.parse(previous.evidence.windowEnd))
        ? ["WINDOW_MISMATCH"]
        : []),
    ]),
  ];
}
export function observedChanges(
  current: AnalysisResult,
  previous: AnalysisResult,
) {
  return current.metrics.flatMap((metric) => {
    const before = previous.metrics.find((m) => m.key === metric.key);
    return before && !metricPairReasons(metric, before).length
      ? [
          {
            key: metric.key,
            before: before.evidence.value!,
            after: metric.evidence.value!,
            unit: metric.unit,
          },
        ]
      : [];
  });
}
export function compareAnalyses(
  run: ComparisonRun,
  result: AnalysisResult,
  previous: { run: ComparisonRun; result: AnalysisResult } | null,
): AnalysisComparison {
  const window = (r: ComparisonRun) => ({
    runId: r.id,
    from: r.period_start.toISOString(),
    to: r.period_end.toISOString(),
  });
  const metadata = {
    current: window(run),
    ...(previous ? { previous: window(previous.run) } : {}),
  };
  if (!previous)
    return {
      ...metadata,
      comparable: false,
      changes: [],
      reasons: [
        ...new Set([
          "NO_PREVIOUS_RESULT",
          ...result.metrics.flatMap(metricComparisonReasons),
        ]),
      ],
    };
  const before = previous.run;
  const reasons = [
    ...(run.analysis_type !== before.analysis_type ? ["TYPE_MISMATCH"] : []),
    ...(run.scope_identity !== before.scope_identity ? ["SCOPE_MISMATCH"] : []),
    ...(run.recipe_version !== before.recipe_version
      ? ["RECIPE_MISMATCH"]
      : []),
    ...(result.schemaVersion !== previous.result.schemaVersion
      ? ["METHOD_MISMATCH"]
      : []),
    ...(run.period_days !== before.period_days ||
    run.period_end.getTime() - run.period_start.getTime() !==
      before.period_end.getTime() - before.period_start.getTime() ||
    before.period_end > run.period_start
      ? ["WINDOW_MISMATCH"]
      : []),
  ];
  const unavailableMetrics = result.metrics.flatMap((metric) => {
    const blockers = metricPairReasons(
      metric,
      previous.result.metrics.find((m) => m.key === metric.key),
    );
    return blockers.length ? [{ key: metric.key, reasons: blockers }] : [];
  });
  const changes = reasons.length
    ? []
    : observedChanges(result, previous.result);
  return {
    ...metadata,
    comparable: changes.length > 0,
    changes,
    unavailableMetrics,
    reasons: changes.length
      ? []
      : [
          ...new Set([
            ...reasons,
            ...unavailableMetrics.flatMap((m) => m.reasons),
          ]),
        ],
  };
}
