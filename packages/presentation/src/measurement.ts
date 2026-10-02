export type MeasurementState =
  | "ZERO"
  | "READY"
  | "COLLECTING"
  | "INSUFFICIENT_SAMPLE"
  | "NO_ELIGIBLE_MEMBERS"
  | "UNAVAILABLE";
import type { MetricEvidence } from "../../shared/src/metric-evidence";
import { percentile } from "../../analytics/src/registry";
export type Measurement = {
  visibility?: "PLAN_RESTRICTED";
  state: MeasurementState;
  value: number | null;
  numerator: number;
  sample: number;
  eligible: number;
  responded: number;
  needed: number;
  from: string;
  through: string;
  observationDays: number;
  activityFromDay: number;
  previous: number | null;
  evidence?: MetricEvidence;
  previousEvidence?: MetricEvidence;
  previousMeasurement?: Measurement;
};
export function measurementState(
  available: boolean,
  total: number,
  complete: number,
  minimum = 5,
): MeasurementState {
  if (!available) return "UNAVAILABLE";
  if (!total) return "NO_ELIGIBLE_MEMBERS";
  if (!complete) return "COLLECTING";
  return complete < minimum ? "INSUFFICIENT_SAMPLE" : "READY";
}
type Observation = {
  joinedAt: Date;
  firstReplyMinutes: number | null;
  connected: boolean;
  retained: boolean;
};
export function weeklyMeasurements(
  members: Observation[],
  now: Date,
  retentionDays: number,
  detailedDays: number,
  observed: (from: Date, through: Date) => boolean,
  available = true,
  retainedFromDay = 7,
  rangeDays = 7,
) {
  const day = 86400000;
  function period(key: "reply" | "connection" | "retention", offset = 0) {
    const observationDays = key === "retention" ? retentionDays : 3;
    const through = new Date(
        now.getTime() - (observationDays + offset * rangeDays) * day,
      ),
      from = new Date(through.getTime() - rangeDays * day);
    const group = members.filter(
        (m) => m.joinedAt >= from && m.joinedAt < through,
      ),
      complete = group.filter(
        (m) =>
          m.joinedAt.getTime() >= now.getTime() - detailedDays * day &&
          observed(
            m.joinedAt,
            new Date(m.joinedAt.getTime() + observationDays * day),
          ),
      );
    const replies = complete
      .map((m) => m.firstReplyMinutes)
      .filter((n): n is number => n !== null);
    const sample = key === "reply" ? replies.length : complete.length;
    const coverage = available;
    let state = measurementState(coverage, group.length, complete.length);
    if (
      state === "NO_ELIGIBLE_MEMBERS" &&
      members.some((m) => m.joinedAt >= through && m.joinedAt <= now)
    )
      state = "COLLECTING";
    if (state === "COLLECTING" && group.length && !complete.length)
      state = "UNAVAILABLE";
    if (state === "READY" && sample < 5) state = "INSUFFICIENT_SAMPLE";
    const numerator =
      key === "reply"
        ? replies.length
        : complete.filter((m) =>
            key === "connection" ? m.connected : m.retained,
          ).length;
    const value =
      state === "READY"
        ? key === "reply"
          ? Math.round(percentile(replies, 0.5)!)
          : Math.round((numerator / sample) * 100)
        : null;
    if (value === 0) state = "ZERO";
    return {
      state,
      value,
      numerator,
      sample,
      eligible: complete.length,
      responded: replies.length,
      needed: Math.max(0, 5 - sample),
      from: from.toISOString(),
      through: through.toISOString(),
      observationDays,
      activityFromDay: key === "retention" ? retainedFromDay : 0,
      previous: null,
    } satisfies Measurement;
  }
  const result = {} as Record<
    "reply" | "connection" | "retention",
    Measurement
  >;
  for (const key of ["reply", "connection", "retention"] as const) {
    const current = period(key),
      previous = period(key, 1);
    result[key] = {
      ...current,
      previous: previous.value,
      previousMeasurement: previous,
    };
  }
  return result;
}
