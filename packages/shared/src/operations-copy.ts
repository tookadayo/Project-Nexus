import type { JourneyNode, RecipePreset } from "./measurement-recipes";
import type { MetricEvidence } from "./metric-evidence";
export const recipeNames: Record<RecipePreset, readonly [string, string]> = {
  SOCIAL: ["会話・交流", "Social"],
  LFG_GAMING: ["仲間募集・ゲーム", "LFG / gaming"],
  SUPPORT_FORUM: ["質問・サポート", "Support / forum"],
  CREATOR_FAN: ["クリエイター・ファン", "Creator / fan"],
  EVENT_STAGE: ["イベント・Stage", "Event / Stage"],
  VOICE_FIRST: ["Voice中心", "Voice first"],
  LARGE_MIXED: ["複数の用途・大きな運営queue", "Large / mixed"],
};
export const journeyNames: Record<JourneyNode, readonly [string, string]> = {
  join: ["新しく参加", "Joined"],
  first_post: ["最初の投稿", "First post"],
  direct_reply: ["返信あり", "Direct reply received"],
  connection: ["最初の交流", "First response or qualified co-presence"],
  later_activity: [
    "参加後7〜14日目にも活動",
    "Activity on days 7–14 after joining",
  ],
  lfg_post: ["仲間募集の投稿", "LFG post"],
  post_response: ["他のメンバーから応答", "First human response"],
  voice_copresence: [
    "他のメンバーと一定時間Voice参加",
    "Qualified voice co-presence",
  ],
  repeat_participation: ["別の日にも参加", "Participation on another day"],
  question: ["質問の投稿", "Question posted"],
  resolution: ["解決を確認", "Confirmed resolution"],
  signup: ["イベント登録", "Event signup"],
  attendance: ["Voice・Stage出席を確認", "Observed Voice / Stage attendance"],
  repeat_attendance: ["別のイベントにも出席", "Attendance at another event"],
  voice_join: ["Voice参加", "Voice joined"],
  reaction: ["反応を付けた", "Reaction participation"],
  poll: ["投票した", "Poll participation"],
};
export function evidenceLabel(
  e: MetricEvidence | undefined,
  locale: "ja" | "en",
) {
  const ja = locale === "ja";
  if (!e) return ja ? "計測方法を確認中" : "Measurement unconfirmed";
  const observations = {
    OBSERVED: ja ? "観測済み" : "Observed",
    NO_ELIGIBLE: ja ? "対象なし" : "No eligible sample",
    COLLECTING: ja ? "確認中" : "Collecting",
    INSUFFICIENT_SAMPLE: ja
      ? "比較には対象が不足"
      : "Insufficient sample for comparison",
    UNKNOWN: ja ? "確認できません" : "Unknown",
  };
  const coverage = {
    COMPLETE: ja ? "計測範囲: 完全" : "Coverage: complete",
    PARTIAL: ja ? "計測範囲: 一部" : "Coverage: partial",
    LOWER_BOUND: ja ? "確認できた範囲のみ" : "Observed lower bound",
    UNKNOWN: ja ? "計測範囲: 不明" : "Coverage: unknown",
  };
  return observations[e.observationState] + " · " + coverage[e.coverageState];
}
