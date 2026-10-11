import { z } from "zod";
import {
  chartQuerySchema,
  operationalFilterSchema,
} from "../../analytics/src/chart-spec";
import {
  featureDecision,
  type EffectiveEntitlement,
} from "../../settings/src/billing/domain";
const time = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const evidence = z.object({
  metricKey: z.string(),
  definitionVersion: z.string(),
  definition: z.string(),
  value: z.number().nullable(),
  numerator: z.number().nullable(),
  denominator: z.number().nullable(),
  sampleSize: z.number(),
  observationState: z.enum([
    "OBSERVED",
    "NO_ELIGIBLE",
    "COLLECTING",
    "INSUFFICIENT_SAMPLE",
    "UNKNOWN",
  ]),
  coverageState: z.enum(["COMPLETE", "PARTIAL", "LOWER_BOUND", "UNKNOWN"]),
  requiredSurfaces: z.array(z.string()),
  evidenceSources: z.array(z.string()),
  coverageReasons: z.array(z.string()),
  windowStart: time,
  windowEnd: time,
  windowKind: z.enum(["OBSERVATION", "COHORT_JOIN"]).optional(),
  collectionEpochIds: z.array(z.string()),
  comparable: z.boolean(),
  comparisonBlockers: z.array(z.string()),
});
const point = z.object({
  bucket: time,
  value: z.number().nullable(),
  evidence,
});
const snapshot = z.object({
  version: z.literal(1),
  metric: chartQuerySchema.shape.metric,
  title: z.string(),
  unit: z.literal("observations"),
  range: z.object({
    from: time,
    to: time,
    days: z.number().positive(),
    timezone: z.string(),
  }),
  filter: operationalFilterSchema,
  series: z.array(
    z.object({ key: z.enum(["CURRENT", "PREVIOUS"]), points: z.array(point) }),
  ),
  evidence,
  top: z.array(
    z.object({ channelId: z.string(), value: z.number().nullable() }),
  ),
  breakdowns: z
    .array(
      z.object({ channelId: z.string(), points: z.array(point), evidence }),
    )
    .optional(),
  heatmap: z.array(
    z.object({
      weekday: z.number(),
      hour: z.number(),
      value: z.number().nullable(),
    }),
  ),
  caveats: z.array(z.string()),
});
export const filteredHistory = (
  filter: z.infer<typeof operationalFilterSchema>,
) =>
  Boolean(
    filter.channelIds.length ||
    filter.categoryIds.length ||
    filter.roleIds.length ||
    filter.surface !== "ALL" ||
    filter.recipeVersionId,
  );
/** Whitelist the stored shape, then project using current access. Never return opaque snapshots. */
export function historySnapshot(
  input: unknown,
  state: EffectiveEntitlement,
  cutoff: Date,
) {
  const parsed = snapshot.safeParse(input);
  if (!parsed.success || state.privacyDeleted) return null;
  const value = parsed.data,
    advanced = featureDecision(state, "surface_breakdowns").allowed;
  const within = (a: string, b: string) =>
    Date.parse(a) >= +cutoff && Date.parse(b) >= Date.parse(a);
  if (
    !within(value.range.from, value.range.to) ||
    !within(value.evidence.windowStart, value.evidence.windowEnd) ||
    (!advanced && filteredHistory(value.filter))
  )
    return null;
  if (
    value.series.some((s) =>
      s.points.some(
        (p) =>
          Date.parse(p.bucket) < +cutoff ||
          !within(p.evidence.windowStart, p.evidence.windowEnd),
      ),
    )
  )
    return null;
  // Comparison and breakdowns cannot be reconstructed from a restricted subset.
  return {
    ...value,
    series: value.series.filter(
      (s) =>
        s.key === "CURRENT" ||
        featureDecision(state, "comparable_periods").allowed,
    ),
    top: advanced ? value.top : [],
    breakdowns: advanced
      ? value.breakdowns?.filter(
          (b) =>
            within(b.evidence.windowStart, b.evidence.windowEnd) &&
            b.points.every(
              (p) =>
                Date.parse(p.bucket) >= +cutoff &&
                within(p.evidence.windowStart, p.evidence.windowEnd),
            ),
        )
      : undefined,
    heatmap: featureDecision(state, "heatmaps").allowed ? value.heatmap : [],
  };
}
