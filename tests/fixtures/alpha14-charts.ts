import {
  chartQuerySchema,
  type ChartSpec,
} from "../../packages/analytics/src/chart-spec";
import { metricEvidence } from "../../packages/shared/src/metric-evidence";
export function alpha14ChartFixture(unknown = false): ChartSpec {
  const from = "2026-10-01T00:00:00Z",
    to = "2026-10-08T00:00:00Z";
  const evidence = metricEvidence({
    metricKey: "aggregate.reply",
    definitionVersion: "v1",
    definition: "Direct reply records",
    value: unknown ? null : 91,
    numerator: unknown ? null : 91,
    denominator: null,
    sampleSize: 91,
    minimumSample: 0,
    coverageState: unknown ? "UNKNOWN" : "PARTIAL",
    requiredSurfaces: [],
    evidenceSources: [],
    coverageReasons: ["COLLECTION_GAP"],
    windowStart: from,
    windowEnd: to,
    collectionEpochIds: ["synthetic-fixture"],
  });
  const points = (values: (number | null)[], start: string) =>
    values.map((value, index) => ({
      bucket: new Date(
        new Date(start).getTime() + index * 86400000,
      ).toISOString(),
      value: unknown ? null : value,
      evidence: { ...evidence, value: unknown ? null : value },
    }));
  return {
    version: 1,
    metric: "reply",
    title: "Direct reply records",
    unit: "observations",
    range: { from, to, days: 7, timezone: "Asia/Tokyo" },
    filter: chartQuerySchema.parse({}).filter,
    series: [
      { key: "CURRENT", points: points([12, 18, null, 0, 24, 16, 21], from) },
      {
        key: "PREVIOUS",
        points: points([10, 11, 13, null, 19, 15, 18], "2026-09-24T00:00:00Z"),
      },
    ],
    evidence,
    comparison: {
      value: unknown ? null : 86,
      absoluteChange: null,
      relativeChange: null,
      comparable: false,
      blockers: ["COVERAGE_PARTIAL"],
    },
    top: [],
    heatmap: [],
    recipeRevision: null,
    dataRevision: "synthetic-fixture",
    cacheKey: `alpha14-chart-fixture-${unknown}`,
    caveats: [],
  };
}
