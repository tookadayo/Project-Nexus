import type { ChartSpec } from "../../../../packages/analytics/src/chart-spec";
import type { MetricEvidence } from "../../../../packages/shared/src/metric-evidence";
export const demoPeriods = [7, 30] as const;
export function demoChart(days: 7 | 30): ChartSpec {
  const end = new Date("2026-09-01T00:00:00Z"),
    start = new Date(+end - days * 86400000),
    previousStart = new Date(+start - days * 86400000);
  const evidence = (
    value: number | null,
    from: string,
    to: string,
  ): MetricEvidence => ({
    metricKey: "reply.received",
    definitionVersion: "1",
    definition: "Observed direct replies",
    value,
    numerator: value,
    denominator: null,
    sampleSize: value ?? 0,
    observationState: value === null ? "UNKNOWN" : "OBSERVED",
    coverageState: value === null ? "UNKNOWN" : "COMPLETE",
    requiredSurfaces: ["messages"],
    evidenceSources: ["synthetic-demo"],
    coverageReasons: value === null ? ["MISSING_DATA"] : [],
    windowStart: from,
    windowEnd: to,
    collectionEpochIds: ["synthetic-demo"],
    comparable: false,
    comparisonBlockers: ["DEMO"],
  });
  const points = (offset: Date, previous: boolean) =>
    Array.from({ length: days }, (_, i) => {
      const from = new Date(+offset + i * 86400000).toISOString(),
        to = new Date(+offset + (i + 1) * 86400000).toISOString(),
        value =
          !previous && i === 2
            ? null
            : !previous && i === 3
              ? 0
              : (i * 3 + (previous ? 2 : 5)) % 13;
      return { bucket: from, value, evidence: evidence(value, from, to) };
    });
  const current = points(start, false),
    previous = points(previousStart, true);
  return {
    version: 1,
    metric: "reply",
    title: "Observed direct replies",
    unit: "observations",
    range: {
      from: start.toISOString(),
      to: end.toISOString(),
      days,
      timezone: "UTC",
    },
    filter: {
      channelIds: [],
      categoryIds: [],
      roleIds: [],
      surface: "ALL",
      recipeVersionId: null,
    },
    series: [
      { key: "CURRENT", points: current },
      { key: "PREVIOUS", points: previous },
    ],
    evidence: {
      ...evidence(
        current.reduce((sum, p) => sum + (p.value ?? 0), 0),
        start.toISOString(),
        end.toISOString(),
      ),
      coverageState: "PARTIAL",
      coverageReasons: ["MISSING_DATA"],
    },
    top: [],
    heatmap: [],
    recipeRevision: null,
    dataRevision: "synthetic-demo",
    cacheKey: "synthetic-demo",
    caveats: [],
  };
}
