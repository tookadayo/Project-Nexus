import { expect, it } from "vitest";
import {
  metricEvidence,
  type EvidenceInput,
} from "../../packages/shared/src/metric-evidence";
import {
  recommendationReadiness,
  responseRecommendation,
} from "../../packages/operations/src/recommendations";
const base: EvidenceInput = {
  metricKey: "firstHumanResponseMinutes",
  definitionVersion: "support-v1",
  definition: "Observed first human response minutes",
  value: 41,
  numerator: 37,
  denominator: 37,
  sampleSize: 37,
  coverageState: "COMPLETE",
  requiredSurfaces: ["messages"],
  evidenceSources: ["MESSAGE_CREATE"],
  coverageReasons: [],
  windowStart: "2026-09-09T00:00:00Z",
  windowEnd: "2026-09-16T00:00:00Z",
  collectionEpochIds: ["epoch"],
};
const previous = metricEvidence({
  ...base,
  value: 18,
  windowStart: "2026-09-02T00:00:00Z",
  windowEnd: "2026-09-09T00:00:00Z",
});
it("provides facts, action and the follow-up measurement only when ready", () => {
  const recommendation = responseRecommendation({
    channelId: "333333333333333333",
    current: metricEvidence(base),
    previous,
    severeIntegration: false,
    safetyCaveat: false,
  });
  expect(recommendation?.evidence).toHaveLength(2);
  expect(recommendation?.expectedMeasurement.metricKey).toBe(base.metricKey);
  expect(recommendation?.causality).toBe("NOT_ESTABLISHED");
});
it.each([
  { coverageState: "PARTIAL" as const },
  { sampleSize: 2 },
  { comparisonBlockers: ["COLLECTION_GAP"] },
  { definitionVersion: "changed-v2" },
  { windowStart: "2026-09-08T00:00:00Z" },
])("blocks advice when readiness is not established: %j", (fields) => {
  expect(
    recommendationReadiness(metricEvidence({ ...base, ...fields }), previous)
      .ready,
  ).toBe(false);
});
it("blocks advice during severe integration failure or safety context", () => {
  expect(
    recommendationReadiness(metricEvidence(base), previous, {
      severeIntegration: true,
    }).ready,
  ).toBe(false);
  expect(
    recommendationReadiness(metricEvidence(base), previous, {
      safetyCaveat: true,
    }).ready,
  ).toBe(false);
});
