import { panelIconText } from "../primitives";
import type {
  AnalysisMetric,
  AnalysisRun,
  AnalysisType,
} from "../../../analysis/src/domain";
import { analysisRecipeVersion } from "../../../analysis/src/domain";
import { measurementDefinition } from "../../../shared/src/measurement-definitions";
import type { MetricEvidence } from "../../../shared/src/metric-evidence";
import {
  analysisCopy as c,
  analysisEvidenceReason,
  localized,
  qualityNames,
} from "../i18n/analysis";
import type { UiLocale } from "../i18n";

export const detailPageSize = 2;
export const placePageSize = 5;
const definitions: Record<
  string,
  { key: string; description: readonly [string, string] }
> = {
  new_members: {
    key: "new_members",
    description: [
      "参加時の情報と参加条件を確認できたメンバーです。運営ロールは除外します。",
      "Members whose join and eligibility were confirmed, excluding team roles.",
    ],
  },
  observed_posts: {
    key: "analysisPosts",
    description: [
      "対象の場所と集計期間に確認できたメッセージです。返信・コメント、運営メンバー、Bot・連携サービスの投稿も含みます。",
      "Messages recorded in the selected places and period, including replies, comments, team, bot and integration posts.",
    ],
  },
  observed_replies: {
    key: "analysisReplies",
    description: [
      "期間終了までに他の人の直接返信、またはForum・Mediaでの応答を確認できた投稿数です。返信メッセージ数や問題解決の件数ではありません。",
      "Posts with a direct reply or Forum/Media response from another person recorded by the period end. This is not a count of reply messages or resolved problems.",
    ],
  },
  first_reply_seconds: {
    key: "analysisReplyLatency",
    description: [
      "応答を確認できた投稿で、最初の人間の応答までの秒数の中央値です。未応答の投稿の待ち時間は含みません。",
      "Median seconds to the first recorded human response, among posts with a response. Unanswered posts are excluded.",
    ],
  },
  waiting_response: {
    key: "analysisWaiting",
    description: [
      "質問・不具合用の場所で、期間終了の1日以上前の投稿に他の人の応答を確認できない件数です。返信やForum・Mediaのコメントは対象外です。",
      "Top-level posts in support/bug-report places, at least one day old at the period end, without a recorded response from another person. Replies and Forum/Media comments are excluded.",
    ],
  },
  announcement_posts: {
    key: "analysisPosts",
    description: [
      "お知らせ用の場所で確認できたメッセージです。返信・コメントやBot・連携サービスの投稿も含みます。",
      "Messages in announcement places, including replies, comments, bot and integration posts.",
    ],
  },
  bot_webhook_posts: {
    key: "analysisPosts",
    description: [
      "Botまたは連携サービスによるメッセージとして確認できた記録です。本文は読みません。",
      "Messages identified as bot or integration posts. Message content is not read.",
    ],
  },
  showcase_posts: {
    key: "showcasePosts",
    description: [
      "作品・資料用の場所のメッセージとForum・Mediaの新規投稿です。Bot・連携サービスも含みます。",
      "Messages and Forum/Media starter posts in creative/reference places, including bots and integrations.",
    ],
  },
  observed_comments: {
    key: "analysisComments",
    description: [
      "Forum・Mediaの新規投稿に続くメッセージの件数です。Bot・連携サービスも含み、内容への評価は分かりません。",
      "Non-starter messages in Forum/Media posts, including bots and integrations. They do not establish approval of the content.",
    ],
  },
  observed_reactions: {
    key: "activeReactions",
    description: [
      "集計期間に追加・解除を確認した、現在有効な他の人の反応です。同じ人・投稿の複数絵文字は1件です。期間終了時点の履歴や満足度ではありません。",
      "Currently active reactions from other people, updated in the period, counted once per person and post across emojis. This does not reconstruct the period-end state or measure satisfaction.",
    ],
  },
  poll_participants: {
    key: "pollParticipants",
    description: [
      "集計期間に回答の追加・解除を確認し、現在有効な回答がある人数です。複数回答を重複させず、期間終了時点の履歴は再現しません。",
      "People with currently active poll answers updated in the period. Multiple answers are not counted twice; the period-end state is not reconstructed.",
    ],
  },
  voice_copresence: {
    key: "voiceCopresence",
    description: [
      "保存した時間条件を満たすボイス同席を確認できた対象メンバーの人数です。期間内の同じ参加記録は1人にまとめ、会話や再訪を証明しません。",
      "Eligible participants confirmed together in voice for the saved minimum duration. Each membership record is counted once in the period; this does not prove conversation or returns to Discord.",
    ],
  },
  event_signups: {
    key: "eventSubscriptions",
    description: [
      "確認できたイベント申込の記録数です。別のイベントや再申込を含む場合があり、重複のない人数や実際の出席ではありません。",
      "Recorded event signups. These may include different events or repeat signups; they are not unique people or actual attendance.",
    ],
  },
  event_attendance: {
    key: "eventAttendance",
    description: [
      "開催中のボイス・Stageで参加を確認できた記録の件数です。複数イベントや複数日にまたがる記録を含み、外部イベントの出席や重複のない人数は確認できません。",
      "Attendance records from a live voice/Stage event. They can span events or observation days; external attendance and unique-person totals are unknown.",
    ],
  },
};
const sources: Record<string, readonly [string, string]> = {
  GUILD_MEMBER_ADD: ["参加時の情報", "join information"],
  MESSAGE_CREATE: ["投稿・返信の作成", "message and reply creation"],
  THREAD_CREATE: ["投稿の新規作成", "post creation"],
  MESSAGE_REACTION_ADD: [
    "リアクションの追加・解除",
    "reaction additions/removals",
  ],
  MESSAGE_REACTION_REMOVE: [
    "リアクションの追加・解除",
    "reaction additions/removals",
  ],
  MESSAGE_POLL_VOTE_ADD: ["投票の追加・解除", "poll answer additions/removals"],
  MESSAGE_POLL_VOTE_REMOVE: [
    "投票の追加・解除",
    "poll answer additions/removals",
  ],
  VOICE_STATE_UPDATE: [
    "ボイス接続状態・同席時間",
    "voice connection states and time together",
  ],
  VOICE_CLOCK: [
    "ボイス接続状態・同席時間",
    "voice connection states and time together",
  ],
  GUILD_SCHEDULED_EVENT_USER_ADD: ["イベント申込", "event signups"],
  GUILD_SCHEDULED_EVENT_UPDATE: ["イベント開催状態", "event status"],
  ADMIN_PURPOSE_MAPPING: ["保存した場所の用途", "saved place purposes"],
};
export function evidencePeriod(locale: UiLocale, start: string, end: string) {
  const from = new Date(start),
    to = new Date(end);
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    to <= from
  )
    return c(locale, "valueUnknown");
  const midnight = (d: Date) => d.toISOString().endsWith("T00:00:00.000Z");
  return midnight(from) && midnight(to)
    ? c(locale, "periodWindow", {
        from: from.toISOString().slice(0, 10),
        through: new Date(to.getTime() - 1).toISOString().slice(0, 10),
      })
    : `${from.toISOString()} – ${to.toISOString()} ${locale === "ja" ? "（終了時刻を含まない）" : "(end exclusive)"}`;
}
export function evidenceState(locale: UiLocale, e: MetricEvidence) {
  if (e.observationState === "COLLECTING") return c(locale, "collectingData");
  if (e.observationState === "NO_ELIGIBLE")
    return c(locale, "reasonNoEligible");
  if (e.observationState === "UNKNOWN" || e.value === null)
    return c(locale, "valueUnknown");
  if (e.coverageState === "LOWER_BOUND") return c(locale, "observedLowerBound");
  if (e.coverageState === "UNKNOWN") return c(locale, "valueUnknown");
  if (e.coverageState === "PARTIAL")
    return localized(locale, qualityNames.PARTIAL);
  return localized(
    locale,
    qualityNames[
      e.observationState === "INSUFFICIENT_SAMPLE"
        ? "INSUFFICIENT_SAMPLE"
        : "COMPLETE"
    ],
  );
}
export function hasObservedValue(e: MetricEvidence) {
  return (
    e.value !== null &&
    Number.isFinite(e.value) &&
    ["OBSERVED", "INSUFFICIENT_SAMPLE"].includes(e.observationState) &&
    e.coverageState !== "UNKNOWN"
  );
}
export function evidenceReasons(locale: UiLocale, e: MetricEvidence) {
  return [
    ...new Set(
      [...e.coverageReasons, ...e.comparisonBlockers].map((reason) =>
        analysisEvidenceReason(locale, reason),
      ),
    ),
  ];
}
export function metricDescription(
  locale: UiLocale,
  metric: AnalysisMetric,
  type: AnalysisType,
) {
  const def = definitions[metric.key];
  if (
    !def ||
    metric.evidence.definitionVersion !==
      `${analysisRecipeVersion}:${measurementDefinition(def.key).version}:${type}`
  )
    return c(locale, "legacyMetric");
  if (type === "NEW_MEMBERS" && metric.key === "observed_posts")
    return locale === "ja"
      ? "対象となる新しい参加者のメッセージです。返信・コメントを含み、Bot・連携サービスや運営ロールは除外します。"
      : "Messages from eligible new participants, including replies and comments, excluding bots, integrations and team roles.";
  return localized(locale, def.description);
}
export function evidenceDetails(locale: UiLocale, metric: AnalysisMetric) {
  const e = metric.evidence;
  const sourceNames = [
    ...new Set(
      e.evidenceSources.map((source) =>
        localized(
          locale,
          sources[source.split(":")[0]!] ?? [
            c(locale, "sourceUnknown"),
            c(locale, "sourceUnknown"),
          ],
        ),
      ),
    ),
  ];
  return [
    c(locale, "measurementPeriod", {
      period: evidencePeriod(locale, e.windowStart, e.windowEnd),
    }),
    c(locale, "measurementSources", {
      sources:
        sourceNames.join(locale === "ja" ? "、" : ", ") ||
        c(locale, "sourceUnknown"),
    }),
    ...evidenceReasons(locale, e),
  ].join("\n");
}
export function savedPlaces(locale: UiLocale, run: AnalysisRun, page = 0) {
  const ids = run.target_channel_ids;
  if (!ids) return c(locale, "previousDefinition");
  const from = page * placePageSize,
    visible = ids.slice(from, from + placePageSize);
  return [
    c(locale, "placesCount", { count: ids.length }),
    visible
      .map((id) =>
        /^\d{17,20}$/.test(id) ? `<#${id}>` : c(locale, "valueUnknown"),
      )
      .join(" · ") || c(locale, "noSavedPlaces"),
    ...(ids.length > placePageSize
      ? [
          c(locale, "placePage", {
            from: from + 1,
            through: Math.min(from + placePageSize, ids.length),
            count: ids.length,
          }),
        ]
      : []),
    c(locale, "scopeMeaning"),
  ].join("\n");
}
export function recordState(locale: UiLocale, status: string) {
  const states: Record<string, readonly [string, string]> = {
    OPEN: ["要確認", "Needs review"],
    ACKNOWLEDGED: ["確認済み", "Acknowledged"],
    IN_PROGRESS: ["対応中", "In progress"],
    SNOOZED: ["再確認待ち", "Waiting for review"],
    RESOLVED: ["対応記録を完了", "Follow-up record completed"],
    DISMISSED: ["撤回済み", "Withdrawn"],
  };
  const label = localized(locale, states[status]);
  return status === "RESOLVED" ? panelIconText("done", label) : label;
}
