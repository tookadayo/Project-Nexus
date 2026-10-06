import { z } from "zod";
import type { MetricEvidence } from "../../shared/src/metric-evidence";
import { comparisonEligibility } from "../../shared/src/metric-evidence";

export const chartMetrics = {
  reply: {
    kind: "reply.received",
    title: "Observed direct replies",
    surfaces: ["members", "messages", "textVisibility"],
  },
  forum: {
    kind: "thread.response_received",
    title: "Observed Forum first responses",
    surfaces: ["members", "messages", "forumVisibility"],
  },
  voice: {
    kind: "voice.connected",
    title: "Qualified Voice co-presence observations",
    surfaces: ["members", "voice", "voiceVisibility"],
  },
  event: {
    kind: "scheduled_event.subscribed",
    title: "Observed Event signups (not attendance)",
    surfaces: ["members", "scheduledEvents"],
  },
  reaction: {
    kind: "reaction.added",
    title: "Observed Reaction participation",
    surfaces: ["members", "reactions", "textVisibility"],
  },
  poll: {
    kind: "poll.participated",
    title: "Observed Poll participation",
    surfaces: ["members", "polls", "textVisibility"],
  },
} as const;
export type ChartMetric = keyof typeof chartMetrics;
const snowflakes = z
  .array(z.string().regex(/^\d{17,20}$/))
  .max(25)
  .default([])
  .transform((v) => [...new Set(v)].sort());
export const operationalFilterSchema = z
  .object({
    channelIds: snowflakes,
    categoryIds: snowflakes,
    roleIds: snowflakes,
    surface: z.enum(["ALL", "TEXT", "FORUM", "VOICE", "EVENT"]).default("ALL"),
    recipeVersionId: z.uuid().nullable().default(null),
  })
  .strict();
export type OperationalFilter = z.infer<typeof operationalFilterSchema>;
export const chartQuerySchema = z
  .object({
    metric: z
      .enum(["reply", "forum", "voice", "event", "reaction", "poll"])
      .default("reply"),
    days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(7),
    compare: z.boolean().default(false),
    timezone: z
      .string()
      .max(80)
      .default("UTC")
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "INVALID_TIMEZONE"),
    filter: operationalFilterSchema.default(operationalFilterSchema.parse({})),
  })
  .strict();
export type ChartQuery = z.infer<typeof chartQuerySchema>;
export type ChartPoint = {
  bucket: string;
  value: number | null;
  evidence: MetricEvidence;
};
export type ChartSpec = {
  version: 1;
  metric: ChartMetric;
  title: string;
  unit: "observations";
  range: { from: string; to: string; days: number; timezone: string };
  filter: OperationalFilter;
  series: { key: "CURRENT" | "PREVIOUS"; points: ChartPoint[] }[];
  evidence: MetricEvidence;
  comparison?: {
    value: number | null;
    absoluteChange: number | null;
    relativeChange: number | null;
    comparable: boolean;
    blockers: string[];
  };
  top: { channelId: string; value: number | null }[];
  breakdowns?: {
    channelId: string;
    points: ChartPoint[];
    evidence: MetricEvidence;
  }[];
  heatmap: { weekday: number; hour: number; value: number | null }[];
  recipeRevision: string | null;
  dataRevision: string;
  cacheKey: string;
  caveats: string[];
  branding?: { title: string; footer: string; logoBase64: string | null };
};
export function chartComparison(
  current: MetricEvidence,
  previous: MetricEvidence,
) {
  const { comparable, blockers } = comparisonEligibility(current, previous);
  const difference =
    comparable && current.value !== null && previous.value !== null
      ? current.value - previous.value
      : null;
  return {
    value: previous.value,
    absoluteChange: difference,
    relativeChange:
      difference !== null && previous.value !== 0
        ? difference / previous.value!
        : null,
    comparable,
    blockers,
  };
}
const csvCell = (value: unknown) =>
  '"' + String(value ?? "").replaceAll('"', '""') + '"';
export function chartCsv(spec: ChartSpec) {
  const rows = [
    [
      "metric",
      "series",
      "bucket",
      "observations",
      "coverage",
      "observation_state",
      "definition",
    ],
    ...spec.series.flatMap((series) =>
      series.points.map((p) => [
        spec.metric,
        series.key,
        p.bucket,
        p.value,
        p.evidence.coverageState,
        p.evidence.observationState,
        p.evidence.definitionVersion,
      ]),
    ),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
