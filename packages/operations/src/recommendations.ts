import {
  comparisonEligibility,
  type MetricEvidence,
} from "../../shared/src/metric-evidence";
import { sql, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { Settings } from "../../settings/src/index";
import type { CapabilitySnapshot } from "../../shared/src/community-model";
import {
  evidenceContext,
  buildMetricEvidence,
  type EvidenceContext,
} from "../../analytics/src/evidence";
export type Recommendation = {
  id: string;
  whatHappened: string;
  evidence: MetricEvidence[];
  whyItMatters: string;
  proposedAction: {
    kind: "REVIEW_RESPONSE_THRESHOLD";
    channelId: string;
    minutes: number;
  };
  expectedMeasurement: {
    metricKey: string;
    definitionVersion: string;
    reviewAfterDays: number;
  };
  causality: "NOT_ESTABLISHED";
};
export function recommendationReadiness(
  current: MetricEvidence,
  previous?: MetricEvidence,
  context: { severeIntegration?: boolean; safetyCaveat?: boolean } = {},
) {
  const blockers = [...current.comparisonBlockers];
  if (previous)
    blockers.push(...comparisonEligibility(current, previous).blockers);
  if (context.severeIntegration) blockers.push("INTEGRATION_FAILURE");
  if (context.safetyCaveat) blockers.push("SAFETY_CONTEXT");
  return { ready: blockers.length === 0, blockers: [...new Set(blockers)] };
}
export function responseRecommendation(input: {
  channelId: string;
  current: MetricEvidence;
  previous: MetricEvidence;
  severeIntegration: boolean;
  safetyCaveat: boolean;
}): Recommendation | null {
  if (
    !recommendationReadiness(input.current, input.previous, input).ready ||
    input.current.value === null ||
    input.previous.value === null ||
    input.current.value <= input.previous.value * 1.5 ||
    input.current.value - input.previous.value < 10
  )
    return null;
  return {
    id: "response-delay:" + input.channelId,
    whatHappened:
      "The observed median first human response took longer than in the previous comparable period.",
    evidence: [input.current, input.previous],
    whyItMatters:
      "A longer response delay can leave questions or LFG posts waiting for staff review. The cause has not been established.",
    proposedAction: {
      kind: "REVIEW_RESPONSE_THRESHOLD",
      channelId: input.channelId,
      minutes: Math.max(1, Math.round(input.previous.value)),
    },
    expectedMeasurement: {
      metricKey: input.current.metricKey,
      definitionVersion: input.current.definitionVersion,
      reviewAfterDays: 7,
    },
    causality: "NOT_ESTABLISHED",
  };
}
export async function responseRecommendations(
  tx: Tx,
  s: Scope,
  cfg: Settings,
  snapshot: CapabilitySnapshot | null,
  current: EvidenceContext,
): Promise<Recommendation[]> {
  if (current.health.severe || current.safety || !current.recipe?.definition)
    return [];
  const previousFrom = new Date(
      current.from.getTime() - (current.to.getTime() - current.from.getTime()),
    ),
    rows = (
      await sql<{
        channel_id: string;
        purpose: string;
        current_n: number;
        previous_n: number;
        current_median: number | null;
        previous_median: number | null;
      }>`SELECT COALESCE(f.data->>'parentId',f.data->>'channelId') AS channel_id,f.data->>'purpose' AS purpose,count(*) FILTER(WHERE f.occurred_at>=${current.from})::integer AS current_n,count(*) FILTER(WHERE f.occurred_at<${current.from})::integer AS previous_n,percentile_cont(.5) WITHIN GROUP(ORDER BY (f.data->>'latencySeconds')::numeric/60) FILTER(WHERE f.occurred_at>=${current.from}) AS current_median,percentile_cont(.5) WITHIN GROUP(ORDER BY (f.data->>'latencySeconds')::numeric/60) FILTER(WHERE f.occurred_at<${current.from}) AS previous_median FROM adaptive_facts f WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.kind='thread.response_received' AND f.data->>'purpose' IN ('SUPPORT','LFG') AND f.occurred_at>=${previousFrom} AND f.occurred_at<${current.to} AND (${cfg.analysisScope.mode}='all' OR (${cfg.analysisScope.mode}='include')=(COALESCE(f.data->>'parentId',f.data->>'channelId')=ANY(${cfg.analysisScope.channelIds}::text[]))) GROUP BY COALESCE(f.data->>'parentId',f.data->>'channelId'),f.data->>'purpose' HAVING count(*) FILTER(WHERE f.occurred_at>=${current.from})>=5 AND count(*) FILTER(WHERE f.occurred_at<${current.from})>=5`.execute(
        tx,
      )
    ).rows;
  if (!rows.length) return [];
  const previous = await evidenceContext(tx, s, previousFrom, current.from),
    result: Recommendation[] = [];
  for (const row of rows) {
    const required = [
        "members",
        "messages",
        row.purpose === "LFG" ? "threadVisibility" : "forumVisibility",
      ],
      key = "firstHumanResponseMinutes:" + row.channel_id;
    const proof = (context: EvidenceContext, value: number | null, n: number) =>
      buildMetricEvidence(
        key,
        {
          value,
          numerator: n,
          denominator: n,
          sample: n,
          definition:
            "Median elapsed minutes from an observed post creation to the first other human response",
          requiredSurfaces: required,
          definitionVersion: "first-human-response-v1",
        },
        snapshot,
        cfg,
        context,
      );
    const recommendation = responseRecommendation({
      channelId: row.channel_id,
      current: proof(current, row.current_median, row.current_n),
      previous: proof(previous, row.previous_median, row.previous_n),
      severeIntegration: current.health.severe,
      safetyCaveat: current.safety || previous.safety,
    });
    if (recommendation) result.push(recommendation);
  }
  return result.slice(0, 5);
}
