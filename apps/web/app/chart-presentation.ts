import type { ChartSpec } from "../../../packages/analytics/src/chart-spec";
import { metricLabels } from "./analysis-labels";
export type ChartLocale = "ja" | "en";
export const chartTitle = (spec: ChartSpec, locale: ChartLocale) =>
  metricLabels[spec.metric][locale];
export const chartUnit = (locale: ChartLocale) =>
  locale === "ja" ? "件（確認できた活動）" : "observations";
export const chartValue = (value: number | null, locale: ChartLocale) =>
  value === null
    ? locale === "ja"
      ? "確認できません"
      : "Unavailable"
    : new Intl.NumberFormat(locale).format(value);
export const chartDate = (date: string, locale: ChartLocale) =>
  new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
export function evidenceLabel(code: string, locale: ChartLocale) {
  const labels: Record<string, [string, string]> = {
    COMPLETE: ["取得できた範囲", "Available data"],
    PARTIAL: ["一部のデータのみ", "Partial data"],
    LOWER_BOUND: ["確認できた下限", "Observed lower bound"],
    UNKNOWN: ["確認できません", "Unavailable"],
    OBSERVED: ["確認済み", "Observed"],
    NO_ELIGIBLE: ["集計対象のデータがありません", "No eligible data"],
    COLLECTING: ["データを収集中です", "Collecting data"],
    INSUFFICIENT_SAMPLE: [
      "集計に必要なデータが足りません",
      "Insufficient data",
    ],
    COVERAGE_PARTIAL: ["取得範囲が一部に限られます", "Coverage is partial"],
    DEFINITION_MISMATCH: [
      "指標の定義が異なります",
      "Metric definitions differ",
    ],
    WINDOW_MISMATCH: [
      "比較する期間の条件が一致しません",
      "Observation windows are incompatible",
    ],
  };
  return (
    labels[code]?.[locale === "ja" ? 0 : 1] ??
    (locale === "ja"
      ? "必要なデータまたは比較条件を確認できません"
      : "Required data or comparison conditions are unavailable")
  );
}
export function graphMaximum(spec: ChartSpec) {
  return Math.max(
    1,
    ...spec.series.flatMap((s) =>
      s.points.map((p) => (p.value === null ? 0 : p.value)),
    ),
  );
}
export const metricDescription = {
  reply: [
    "直接返信が確認できた活動の件数です。返信内容や満足度は表しません。",
    "Counts observed direct replies, not reply content or satisfaction.",
  ],
  forum: [
    "フォーラムで最初の応答が確認できた活動の件数です。解決を表しません。",
    "Counts observed first Forum responses, not resolution.",
  ],
  voice: [
    "測定条件を満たすボイス同席の件数です。会話の証明ではありません。",
    "Counts qualified voice co-presence observations, not proof of conversation.",
  ],
  event: [
    "イベントへの参加登録の件数です。出席とは別です。",
    "Counts event signup observations, not attendance.",
  ],
  reaction: [
    "リアクションへの参加が確認できた件数です。感情は推測しません。",
    "Counts reaction participation observations, without inferring sentiment.",
  ],
  poll: [
    "投票への参加が確認できた件数です。投票内容は表しません。",
    "Counts poll participation observations, not vote content.",
  ],
} as const;

export function coverageReason(code: string, locale: ChartLocale) {
  const text: Record<string, [string, string]> = {
    COLLECTION_GAP: [
      "期間内にデータ収集の中断があります。",
      "Collection was interrupted within this period.",
    ],
    COLLECTION_STARTED_IN_WINDOW: [
      "データ収集はこの期間の途中から始まりました。",
      "Collection began partway through this period.",
    ],
    OBSERVATION_SCOPE_CHANGED: [
      "期間内に取得できる場所や活動の種類が変わりました。",
      "Observable locations or activity types changed during this period.",
    ],
    MEMBER_ELIGIBILITY_UNOBSERVED: [
      "一部のメンバーの参加条件を確認できません。",
      "Some member eligibility conditions were not observed.",
    ],
    CAPABILITY_DISCOVERY_STALE_OR_UNKNOWN: [
      "Discordの設定を最近確認できていません。",
      "Recent Discord capability information is unavailable.",
    ],
    VIEW_CHANNEL_MISSING: [
      "一部のチャンネルを閲覧する権限がありません。",
      "Some channels cannot be viewed with the available permissions.",
    ],
    SELECTED_CHANNEL_NOT_OBSERVABLE: [
      "選択したチャンネルの一部を取得できません。",
      "Some selected channels cannot be observed.",
    ],
    PRIVATE_THREAD_VISIBILITY_PARTIAL: [
      "非公開スレッドの取得範囲は一部に限られます。",
      "Private-thread visibility is partial.",
    ],
  };
  if (text[code]) return text[code][locale === "ja" ? 0 : 1];
  if (code.startsWith("INTENT_"))
    return locale === "ja"
      ? "必要な種類のデータをDiscordから受信できません。"
      : "A required type of data cannot be received from Discord.";
  if (code.startsWith("GATEWAY_"))
    return locale === "ja"
      ? "Discordからのデータ受信状態を確認できません。"
      : "The Discord data connection cannot be confirmed.";
  if (code.startsWith("SERVER_CHANNEL_TOTAL_"))
    return locale === "ja"
      ? "サーバー全体のチャンネル数を確認できません。"
      : "The total number of server channels is unavailable.";
  return evidenceLabel(code, locale);
}
export const heatMix = (ratio: number) =>
  ratio > 0.7
    ? Math.max(85, Math.round(ratio * 85 + 10))
    : Math.round(ratio * 85 + 10);
