export type ObservationState =
  "OBSERVED" | "NO_ELIGIBLE" | "COLLECTING" | "INSUFFICIENT_SAMPLE" | "UNKNOWN";
export type CoverageState = "COMPLETE" | "PARTIAL" | "LOWER_BOUND" | "UNKNOWN";
export type MetricEvidence = {
  metricKey: string;
  definitionVersion: string;
  definition: string;
  definitionVersions?: string[];
  recipeVersionIds?: string[];
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  sampleSize: number;
  observationState: ObservationState;
  coverageState: CoverageState;
  requiredSurfaces: string[];
  evidenceSources: string[];
  coverageReasons: string[];
  windowStart: string;
  windowEnd: string;
  windowKind?: "OBSERVATION" | "COHORT_JOIN";
  collectionEpochIds: string[];
  comparable: boolean;
  comparisonBlockers: string[];
};
export type EvidenceInput = Omit<
  MetricEvidence,
  "observationState" | "comparable" | "comparisonBlockers"
> & {
  available?: boolean;
  collecting?: boolean;
  minimumSample?: number;
  comparisonBlockers?: string[];
};
export function metricEvidence(input: EvidenceInput): MetricEvidence {
  const {
    available = true,
    collecting = false,
    minimumSample = 5,
    comparisonBlockers = [],
    ...data
  } = input;
  const observationState: ObservationState =
    !available || data.coverageState === "UNKNOWN"
      ? "UNKNOWN"
      : collecting
        ? "COLLECTING"
        : data.denominator === 0
          ? "NO_ELIGIBLE"
          : data.sampleSize < minimumSample
            ? "INSUFFICIENT_SAMPLE"
            : "OBSERVED";
  const blockers = [
    ...new Set([
      ...comparisonBlockers,
      ...(observationState !== "OBSERVED" ? [observationState] : []),
      ...(data.coverageState !== "COMPLETE"
        ? ["COVERAGE_" + data.coverageState]
        : []),
      ...(data.collectionEpochIds.length ? [] : ["EPOCH_UNKNOWN"]),
    ]),
  ];
  // A small observed count remains useful; unknown/maturing ratios do not become zero.
  const value =
    observationState === "UNKNOWN" ||
    observationState === "COLLECTING" ||
    observationState === "NO_ELIGIBLE"
      ? null
      : data.value;
  return {
    ...data,
    value,
    numerator: observationState === "UNKNOWN" ? null : data.numerator,
    denominator: observationState === "UNKNOWN" ? null : data.denominator,
    observationState,
    comparable: blockers.length === 0,
    comparisonBlockers: blockers,
  };
}
export function comparisonEligibility(
  current: MetricEvidence,
  previous: MetricEvidence,
) {
  const blockers = [
    ...current.comparisonBlockers,
    ...previous.comparisonBlockers,
  ];
  if (
    current.metricKey !== previous.metricKey ||
    current.definitionVersion !== previous.definitionVersion
  )
    blockers.push("DEFINITION_MISMATCH");
  const length = (m: MetricEvidence) =>
    Date.parse(m.windowEnd) - Date.parse(m.windowStart);
  if (
    length(current) !== length(previous) ||
    Date.parse(previous.windowEnd) > Date.parse(current.windowStart)
  )
    blockers.push("WINDOW_MISMATCH");
  return { comparable: !blockers.length, blockers: [...new Set(blockers)] };
}
