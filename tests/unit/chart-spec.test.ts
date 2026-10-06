import { it, expect } from "vitest";
import {
  chartQuerySchema,
  chartComparison,
  chartCsv,
  type ChartSpec,
} from "../../packages/analytics/src/chart-spec";
import { metricEvidence } from "../../packages/shared/src/metric-evidence";
import { renderChartPng } from "../../packages/analytics/src/chart-renderer";
const proof = (value: number | null, from: string, to: string) =>
  metricEvidence({
    metricKey: "aggregate.reply",
    definitionVersion: "v1",
    definition: "observed direct replies",
    value,
    numerator: value,
    denominator: null,
    sampleSize: 5,
    minimumSample: 0,
    coverageState: "COMPLETE",
    requiredSurfaces: [],
    evidenceSources: [],
    coverageReasons: [],
    windowStart: from,
    windowEnd: to,
    collectionEpochIds: ["fixture"],
  });
it("rejects person selectors and unsafe ranges/timezones", () => {
  expect(() =>
    chartQuerySchema.parse({ filter: { memberId: "123" } }),
  ).toThrow();
  expect(() => chartQuerySchema.parse({ days: 3650 })).toThrow();
  expect(() => chartQuerySchema.parse({ timezone: "unknown-zone" })).toThrow();
  expect(
    chartQuerySchema.parse({
      filter: { roleIds: ["111111111111111111", "111111111111111111"] },
    }).filter.roleIds,
  ).toHaveLength(1);
});
it("blocks noncomparable change and preserves unknown rather than manufacturing zero", () => {
  const current = proof(5, "2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z"),
    previous = proof(0, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
  expect(chartComparison(current, previous)).toMatchObject({
    absoluteChange: 5,
    relativeChange: null,
    comparable: true,
  });
  expect(
    chartComparison(
      { ...current, comparisonBlockers: ["COLLECTION_GAP"] },
      previous,
    ),
  ).toMatchObject({
    absoluteChange: null,
    relativeChange: null,
    comparable: false,
  });
});
it("renders a real PNG asynchronously and exports the exact shared aggregate values", async () => {
  const evidence = proof(2, "2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z");
  const spec: ChartSpec = {
    version: 1,
    metric: "reply",
    title: "Observed replies <safe>",
    unit: "observations",
    range: {
      from: evidence.windowStart,
      to: evidence.windowEnd,
      days: 7,
      timezone: "UTC",
    },
    filter: chartQuerySchema.parse({}).filter,
    series: [
      {
        key: "CURRENT",
        points: [
          { bucket: evidence.windowStart, value: 2, evidence },
          {
            bucket: evidence.windowEnd,
            value: null,
            evidence: { ...evidence, value: null },
          },
        ],
      },
    ],
    evidence,
    top: [],
    heatmap: [],
    recipeRevision: null,
    dataRevision: "fixture",
    cacheKey: "chart-spec-test",
    caveats: [],
  };
  const [a, b] = await Promise.all([
    renderChartPng(spec),
    renderChartPng(spec),
  ]);
  expect(a.equals(b)).toBe(true);
  expect(a.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(a.readUInt32BE(16)).toBe(1000);
  expect(a.readUInt32BE(20)).toBe(500);
  expect(chartCsv(spec)).toContain('"CURRENT","2026-10-02T00:00:00Z","2"');
  expect(chartCsv(spec)).toContain('"CURRENT","2026-10-03T00:00:00Z",""');
});
