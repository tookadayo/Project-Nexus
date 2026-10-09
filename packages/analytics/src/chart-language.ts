import type { ChartPoint, ChartSpec } from "./chart-spec";
export type ChartLocale = "ja" | "en";
export const chartLocale = (locale: string): ChartLocale =>
  locale === "en" ? "en" : "ja";
export const metricLabels = {
  reply: { ja: "直接の返信", en: "Direct replies" },
  forum: { ja: "フォーラムの初回返信", en: "Forum first responses" },
  voice: { ja: "条件を満たすボイス同席", en: "Qualified voice co-presence" },
  event: {
    ja: "イベント参加登録（出席ではありません）",
    en: "Event signups (not attendance)",
  },
  reaction: { ja: "リアクションへの参加", en: "Reaction participation" },
  poll: { ja: "投票への参加", en: "Poll participation" },
} as const;
export const chartTitle = (spec: ChartSpec, locale: ChartLocale) =>
  metricLabels[spec.metric][locale];
export const chartUnit = (locale: ChartLocale) =>
  locale === "ja" ? "件（確認できた活動）" : "recorded activities";
export const chartValue = (value: number | null, locale: ChartLocale) =>
  value === null
    ? locale === "ja"
      ? "確認できません"
      : "Unavailable"
    : new Intl.NumberFormat(locale).format(value);
export function chartCoverage(spec: ChartSpec, locale: ChartLocale) {
  const labels: Record<string, readonly [string, string]> = {
    COMPLETE: ["対象範囲のデータあり", "Data available within scope"],
    PARTIAL: ["一部のデータのみ", "Partial data"],
    LOWER_BOUND: ["確認できた下限", "Confirmed lower bound"],
    UNKNOWN: ["取得範囲を確認できません", "Coverage unavailable"],
    COLLECTING: ["データを収集中", "Collecting data"],
    NO_ELIGIBLE: ["対象条件を満たす記録なし", "No eligible records"],
  };
  const state = ["COLLECTING", "NO_ELIGIBLE", "UNKNOWN"].includes(
    spec.evidence.observationState,
  )
    ? spec.evidence.observationState
    : spec.evidence.coverageState;
  return (labels[state] ?? labels.UNKNOWN)![locale === "ja" ? 0 : 1];
}
export const chartCaveat = (locale: ChartLocale) =>
  locale === "ja"
    ? "欠測は0件と異なります。変化の原因や対応の効果は断定できません。"
    : "Missing values are not zero. Changes do not establish causes or effects.";
export function chartPeriod(spec: ChartSpec, locale: ChartLocale) {
  const last = new Date(new Date(spec.range.to).getTime() - 1)
    .toISOString()
    .slice(0, 10);
  return `${spec.range.from.slice(0, 10)} — ${last} · ${spec.range.days}${locale === "ja" ? "日間" : " days"} · UTC`;
}
/** Plain-text fallback for shared Discord images. Uses only the same authorized aggregate. */
export function chartSummary(spec: ChartSpec, locale: ChartLocale) {
  const previous = spec.comparison;
  return [
    `${chartTitle(spec, locale)} · ${chartPeriod(spec, locale)}`,
    `${locale === "ja" ? "合計" : "Total"}: ${chartValue(spec.evidence.value, locale)}${spec.evidence.value === null ? "" : " " + chartUnit(locale)} · ${chartCoverage(spec, locale)}`,
    ...(previous
      ? [
          previous.comparable
            ? `${locale === "ja" ? "比較期間" : "Previous period"}: ${chartValue(previous.value, locale)} · ${locale === "ja" ? "差" : "Difference"}: ${chartValue(previous.absoluteChange, locale)}`
            : locale === "ja"
              ? "データまたは条件がそろわないため比較できません。"
              : "Data or conditions are not sufficient for comparison.",
        ]
      : []),
  ].join("\n");
}
/** Linear segments stop at missing buckets; a known zero remains a real point. */
export function chartLinePath(
  points: readonly ChartPoint[],
  x: (index: number) => number,
  y: (value: number) => number,
) {
  let continued = false;
  return points
    .map((point, index) => {
      if (point.value === null) {
        continued = false;
        return "";
      }
      const command = continued ? "L" : "M";
      continued = true;
      return `${command}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`;
    })
    .filter(Boolean)
    .join(" ");
}
