import {
  buildMetricEvidence,
  evidenceWindow,
  type EvidenceContext,
} from "../../analytics/src/evidence";
import { comparisonEligibility } from "../../shared/src/metric-evidence";
import type { CapabilitySnapshot } from "../../shared/src/community-model";
import type { Settings } from "../../settings/src/index";
import type { Measurement } from "./measurement";
export function measurementEvidence(
  metric: Measurement,
  key: "reply" | "connection" | "retention",
  snapshot: CapabilitySnapshot | null,
  cfg: Settings,
  context: EvidenceContext,
) {
  const voice = cfg.communityModel.modes.includes("VOICE"),
    text = cfg.communityModel.modes.some(
      (m) => m !== "VOICE" && m !== "EVENTS",
    );
  const required =
    key === "reply"
      ? ["members", "messages", "textVisibility"]
      : [
          "members",
          ...(text ? ["messages", "textVisibility"] : []),
          ...(voice ? ["voice", "voiceVisibility"] : []),
          ...(cfg.communityModel.modes.includes("EVENTS")
            ? ["scheduledEvents"]
            : []),
        ];
  function proof(m: Measurement) {
    const from = new Date(m.from),
      through = new Date(Date.parse(m.through) + m.observationDays * 86400000);
    const ctx = evidenceWindow(context, from, through);
    const e = buildMetricEvidence(
      `cohort.${key}`,
      {
        value: m.value,
        numerator: m.numerator,
        denominator: m.eligible,
        sample: m.sample,
        definition:
          key === "reply"
            ? "Median first direct reply time among eligible members receiving a reply within three days."
            : key === "connection"
              ? "Eligible members with a strong observed connection within three days."
              : `Activity observed on days ${m.activityFromDay}–${m.observationDays} after eligible membership begins.`,
        requiredSurfaces: required,
        collecting: m.state === "COLLECTING",
        definitionVersion:
          key === "reply"
            ? "cohort-first-reply-median-v2"
            : `cohort-${key}-v3:${m.activityFromDay}:${m.observationDays}`,
      },
      snapshot,
      cfg,
      ctx,
    );
    e.windowKind = "COHORT_JOIN";
    e.windowStart = m.from;
    e.windowEnd = m.through;
    if (m.state === "UNAVAILABLE") {
      e.value = null;
      e.observationState = "UNKNOWN";
      e.comparable = false;
      e.comparisonBlockers.push("COHORT_OBSERVATION_UNAVAILABLE");
    }
    return e;
  }
  metric.evidence = proof(metric);
  if (metric.previousMeasurement) {
    metric.previousEvidence = proof(metric.previousMeasurement);
    if (
      !comparisonEligibility(metric.evidence, metric.previousEvidence)
        .comparable
    )
      metric.previous = null;
  }
  metric.value = metric.evidence.value;
  if (metric.evidence.observationState === "UNKNOWN")
    metric.state = "UNAVAILABLE";
  return metric;
}
