import type { MetricEvidence } from "./metric-evidence";
export const coverageNames = {
  COMPLETE: ["完全", "Complete"],
  PARTIAL: ["一部", "Partial"],
  LOWER_BOUND: ["確認できた範囲", "Observed lower bound"],
  UNKNOWN: ["確認できません", "Unknown"],
} as const;
export function evidenceValue(
  evidence: MetricEvidence | undefined,
  locale: "ja" | "en",
  ratio = false,
) {
  const ja = locale === "ja";
  if (!evidence)
    return ja ? "計測根拠を確認できません" : "Measurement evidence unavailable";
  if (evidence.observationState === "UNKNOWN")
    return ja ? "確認できません" : "Unknown";
  if (evidence.observationState === "COLLECTING")
    return ja ? "まだ確認中" : "Still collecting";
  if (evidence.observationState === "NO_ELIGIBLE")
    return ja ? "対象者がいません" : "No eligible members";
  if (evidence.value === null)
    return ja ? "まだ比較できません" : "Not ready to compare";
  return ratio
    ? `${Math.round(evidence.value * 100)}%`
    : evidence.value.toLocaleString(locale);
}
export function evidenceNote(
  e: MetricEvidence | undefined,
  locale: "ja" | "en",
) {
  const ja = locale === "ja";
  if (!e)
    return ja ? "計測方法を確認してください" : "Review the measurement method";
  const coverage = coverageNames[e.coverageState][ja ? 0 : 1];
  return `${ja ? "対象" : "Sample"}: ${e.sampleSize} · ${ja ? "計測範囲" : "Coverage"}: ${coverage}${e.observationState === "INSUFFICIENT_SAMPLE" ? (ja ? " · 比較には人数・件数が不足しています" : " · More observations are needed for comparison") : ""}`;
}
