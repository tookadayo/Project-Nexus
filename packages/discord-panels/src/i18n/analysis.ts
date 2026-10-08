import type { UiLocale } from "./index";
import type {
  AnalysisType,
  AnalysisQuality,
  Availability,
  AnalysisRun,
} from "../../../analysis/src/domain";
const copy = {
  basicDescription: ["投稿・返信・新しい参加者の状況を確認できます。", "View posts, replies and new participants."],
  basicVoiceDescription: ["ボイスの利用と、確認できた同席や参加状況を確認できます。", "View voice use and observed co-presence and participation."],
  basicShowcaseDescription: ["作品・資料の投稿と、確認できた反応を確認できます。", "View creative and reference posts and observed responses."],
  basicAction: ["状況を見る", "View activity"],
  reviewAction: ["要確認を見る", "View reviews"],
  reviewDescription: ["権限を確認して、運営が対応する項目を開きます。", "Open your team's review items after checking your access."],
  reviewNeeded: ["対応が必要な項目があります。", "There are items for your team to review."],
  reviewClear: ["現在、対応が必要な項目はありません。", "No items currently require action."],
  reviewUnknown: ["現在の状況を確認できません。接続状況を確認してください。", "The current situation is unavailable. Check the connection."],
  detailedDescription: ["設定した用途に合わせて、変化と確認したい点をまとめます。", "Summarise changes and points to review for your configured purposes."],
  estimateUnknown: ["完了時間はまだ見積もれません。", "Completion time cannot be estimated yet."],
  previousPage: ["前の5件", "Previous 5"],
  nextPage: ["次の5件", "Next 5"],
  details: ["詳しく見る", "View details"],
  summary: ["主な結果", "Main results"],
  correctionReview: ["計算方法の訂正を確認", "Review corrected calculation"],
  correctionFree: ["以前の計算方法を訂正します。回数は使いません。", "Correct the earlier calculation method without using an analysis allowance."],
  calculatedAt: ["計算した日時: {time}", "Calculated: {time}"],
  changes: ["前回から確認できた変化", "Observed changes since the previous result"],
  smallSample: ["確認できた件数が少ないため、参考としてご覧ください。変化だけでは原因や施策の効果は判断できません。", "Few observations are available, so treat these changes as indicative. Changes alone do not establish causes or effects."],
  previousDefinition: ["以前の計算方法による結果です。場所の記録は確認できません。", "This result uses an older calculation method. Its saved places are unavailable."],
  usageUnknown: ["残りの分析回数は確認できません。", "Remaining detailed analyses are unavailable."],
  monthlyRenewal: ["次回の月枠更新: {time}", "Next monthly allowance: {time}"],
  tagConflict: ["対応済みと未対応の両方に設定したタグがあります。対応状態は確認できません。タグの設定を確認してください。", "Tags mapped as both resolved and unresolved were observed. Resolution is unknown. Review the tag settings."],
  removedData: ["削除されたデータを含むため結果を表示できません。", "Result unavailable after data removal."],
  oldDefinition: ["以前の計算方法による結果", "Result from an earlier calculation method"],
  noConcerns: ["今回の分析から追加する要確認はありません。", "This analysis has no additional items for review."],
  unknownMetric: ["確認できた活動", "Observed activity"],
  seconds: ["{count}秒", "{count} seconds"],
  people: ["{count}人", "{count} people"],
  items: ["{count}件", "{count} items"],
  times: ["{count}回", "{count} occurrences"],
  medianNote: ["極端に長い・短いものの影響を受けにくい値です。", "A median is less affected by unusually short or long waits."],
  cancel: ["処理待ちを取り消す", "Cancel waiting analysis"],
  canceled: ["処理待ちを取り消しました。予約した回数は戻ります。", "Waiting analysis canceled. The reserved use is released."],
  cancelStarted: ["処理が始まったため、取り消せません。履歴から結果を確認できます。", "Processing has started and cannot be canceled. Check history for the result."],
  attentionConfirm: ["追加する内容を確認", "Review the item to add"],
  attentionDuplicate: ["同じ項目が既にあります。重複して追加しません。", "This item already exists and will not be duplicated."],
  attentionNew: ["この結果の根拠を付けて、運営用の要確認を1件追加します。", "Add one team review item with the evidence from this result."],
  purpose: ["用途を選ぶ", "Choose a purpose"],
  purposeLater: ["用途はあとで設定できます。基本分析は使えます。", "Purposes can be set later. Basic analysis remains available."],
  purposeApply: ["この用途を選んだ場所へ設定", "Apply purpose to selected places"],
  purposeBatch: ["今回選んだ{count}件に用途を設定します。他の場所の用途は維持します。", "Set a purpose for the {count} places just selected. Other purposes are preserved."],
  addChannels: ["チャンネルを追加（25件ずつ）", "Add channels (25 at a time)"],
  removeChannels: ["選んだ場所から取り除く", "Remove selected places"],
  chooseCategory: ["カテゴリの子チャンネルを追加", "Add a category's current channels"],
  snapshotScope: ["選んだ時点の場所だけを保存します。将来の追加は自動で含めません。", "Only the places selected now are saved. Future additions are not included automatically."],
  scopeReview: ["場所の一覧を確認", "Review selected places"],
  scopePage: ["{from}〜{through} / {count}件", "{from}–{through} / {count} places"],
  purposes: ["分析する場所と用途", "Places and purposes"],
  visibleGoals: ["見たい内容", "What to view"],
  later: ["あとで設定する", "Set up later"],
  notConfigured: ["未設定", "Not configured"],
  noReviews: [
    "分析から追加した要確認はありません。",
    "There are no saved reviews from analysis.",
  ],
  analysisConcerns: [
    "詳しい分析から追加した要確認",
    "Reviews added from detailed analysis",
  ],
  attentionPage: ["要確認の一覧を見る", "View saved reviews"],

  linkCommand: [
    "このサーバーで /nexus link を実行すると、Web画面との接続を確認できます。",
    "Run /nexus link in this server to verify its Web connection.",
  ],
  title: ["詳しい分析", "Detailed analysis"],
  basic: [
    "基本の分析は、回数を使わずいつでも確認できます。",
    "Basic analysis is always available without using an analysis run.",
  ],
  menu: ["分析メニュー", "Choose an analysis"],
  periodWindow: ["{from} 〜 {through}（UTC）", "{from}–{through} (UTC)"],
  additionalPlaces: ["ほか{count}件", "{count} more"],
  placesCount: ["指定した場所: {count}件", "Selected places: {count}"],
  period: ["期間を選ぶ", "Choose a period"],
  days: ["過去{count}日（UTCの完了済み日）", "Last {count} complete UTC days"],
  uses: [
    "詳しい分析ができる回数: {count}回",
    "Detailed analyses remaining: {count}",
  ],
  start: ["分析を始める", "Start analysis"],
  preview: ["分析する内容を確認", "Review analysis conditions"],
  quality: ["データ状況", "Data available"],
  effect: [
    "分析回数: {before}回 → {after}回\n結果を保存できたときに1回分を使います。",
    "Analysis uses: {before} → {after}\nOne use is consumed when a result is saved.",
  ],
  eta: ["完了までの目安: {range}分", "Estimated completion: {range} minutes"],
  history: ["これまでの詳しい分析", "Detailed analysis history"],
  empty: ["まだ詳しい分析はありません。", "No detailed analyses yet."],
  back: ["戻る", "Back"],
  settings: ["設定する", "Open settings"],
  view: ["結果を見る", "View result"],
  refresh: ["更新する", "Refresh"],
  compare: ["前回と比べる", "Compare with previous"],
  evidence: ["根拠を見る", "View evidence"],
  attention: ["要確認に追加", "Add for review"],
  duplicate: [
    "同じ条件の分析があります。まずは保存済みの結果を確認してください。",
    "An analysis with the same conditions exists. Open the saved result first.",
  ],
  rerun: ["もう一度分析する", "Analyse again"],
  queued: [
    "分析を受け付けました。処理待ちです。\n結果はこの画面や履歴から確認できます。",
    "Analysis accepted and waiting to be processed.\nReturn here or open history to see the result.",
  ],
  completed: ["分析が終わりました", "Analysis completed"],
  failed: [
    "分析を完了できませんでした。今回の回数は消費していません。",
    "Analysis could not be completed. This run did not consume an analysis use.",
  ],
  incompatible: [
    "条件が違うか、まだデータが足りないため、前回との比較はできません。",
    "The conditions differ or there is not enough data to compare with the previous result.",
  ],
  added: [
    "要確認に追加しました。運営の対応に使えます。",
    "Added for review by the team.",
  ],
  concerns: ["気になる点", "Concerns to review"],
  waiting: [
    "返信がまだ確認できない投稿: {count}件",
    "Posts without an observed reply: {count}",
  ],
  notes: [
    "返信は本文の意味を判断しません。ボイス同席は会話、イベント申込は参加を意味しません。",
    "Replies do not describe message meaning. Voice co-presence does not prove conversation; event signup does not prove attendance.",
  ],
  sample: ["対象 {count}件", "Sample: {count}"],
  peopleSample: ["対象 {count}人", "Sample: {count} people"],
  sampleUnknown: ["対象件数を確認できません。", "The observed sample is unavailable."],
  noUses: [
    "残りの分析回数がありません。基本の分析は引き続き使えます。",
    "No detailed analysis uses remain. Basic analysis is still available.",
  ],
  homeTitle: ["このサーバーの状況", "This server’s activity"],
  needs: ["要確認", "Needs review"],
  newMembers: ["新しい参加者", "New participants"],
  weekJoined: [
    "過去30日の参加者: {count}人",
    "Joined in the last 30 days: {count}",
  ],
  unknown: ["データを確認できません", "Data is unavailable"],
  see: ["見る", "View"],
  home: ["ホーム", "Home"],
  more: ["その他", "More"],
  scope: ["分析する場所", "Places to analyse"],
  notifications: ["通知", "Notifications"],
  team: ["運営メンバー", "Team members"],
  reasonGap: [
    "途中で記録できない時間がありました。",
    "Collection was interrupted during this period.",
  ],
  reasonStarted: [
    "この期間の途中から記録を始めています。",
    "Collection began partway through this period.",
  ],
  reasonAccess: [
    "必要な場所や機能を確認できていません。",
    "Some required places or features could not be observed.",
  ],
  reasonMembers: [
    "参加条件や運営ロールを確認できない人がいます。",
    "Some member eligibility or team roles are unobserved.",
  ],
  reasonDefinition: [
    "計測条件が変わったか、以前の記録を確認できません。",
    "Measurement conditions changed or older observations are unverified.",
  ],
  reasonOther: [
    "比較に使えるデータが一部不足しています。",
    "Some data needed for a comparison is unavailable.",
  ],
  reasonsNone: [
    "追加の不足は確認されていません。",
    "No additional data gaps were identified.",
  ],
  goals: ["見たい内容", "What to view"],
  connection: ["接続", "Connection"],
  privacy: ["プライバシー", "Privacy"],
  support: ["サポート情報", "Support information"],
  advanced: ["高度な設定", "Advanced settings"],
  setup: ["NEXUSを設定します", "Set up NEXUS"],
  next: ["次へ", "Next"],
  skip: ["任意の設定をスキップ", "Skip optional setting"],
  confirm: ["この内容で設定", "Apply these settings"],
  review: ["この設定で始めます", "Review your settings"],
  skipped: ["変更なし（スキップ）", "Unchanged (skipped)"],
  saved: ["設定しました", "Settings saved"],
  all: ["確認できるすべてのチャンネル", "All observable channels"],
  include: ["選んだチャンネル", "Selected channels"],
  exclude: ["選んだチャンネルを除く", "Exclude selected channels"],
  chooseChannels: ["チャンネルを選ぶ", "Choose channels"],
  chooseRoles: ["運営のロールを選ぶ（任意）", "Choose team roles (optional)"],
  chooseGoals: ["目標を選ぶ（任意）", "Choose goals (optional)"],
  basicTitle: ["基本の分析", "Basic analysis"],
  detailedAction: ["詳しく分析する", "Start detailed analysis"],
  recent: ["最近の詳しい分析: {time}", "Latest detailed analysis: {time}"],
  notYet: ["まだ実行していません", "Not run yet"],
  resolved: ["対応を完了する", "Mark resolved"],
  acknowledge: ["確認済みにする", "Acknowledge"],
} as const;
export const analysisCopyKeys = Object.keys(copy) as (keyof typeof copy)[];
export type AnalysisCopyKey = keyof typeof copy;
export function analysisCopy(
  locale: UiLocale,
  key: AnalysisCopyKey,
  variables: Record<string, string | number> = {},
) {
  return copy[key][locale === "en" ? 1 : 0].replaceAll(
    /\{([a-zA-Z]+)\}/g,
    (_, name: string) => String(variables[name] ?? ""),
  );
}
export const analysisNames: Record<AnalysisType, readonly [string, string]> = {
  OVERALL: ["サーバー全体を見る", "Review the whole server"],
  NEW_MEMBERS: ["新しい参加者を見る", "Review new participants"],
  SUPPORT: ["質問・相談の流れを見る", "Review questions and support"],
  EVENTS: ["イベントを振り返る", "Review events"],
  VOICE: ["ボイスの利用を見る", "Review voice use"],
  ANNOUNCEMENTS: ["お知らせへの反応", "Announcement responses"],
  SHOWCASE: ["作品・情報の投稿", "Creative and reference posts"],
};
export const analysisDescriptions: Record<AnalysisType, readonly [string,string]> = {
 OVERALL: ["投稿・返信・ボイス・イベントの状況をまとめます。", "Summarise posts, replies, voice use and events."],
 NEW_MEMBERS: ["新しい参加者の活動と、確認できた返信を調べます。", "Review new participants' activity and observed replies."],
 SUPPORT: ["質問用に設定した場所の返信と返信待ちを確認します。", "Review replies and waiting posts in configured support places."],
 EVENTS: ["申込と、確認できた参加を分けて振り返ります。", "Review event signups separately from observed attendance."],
 VOICE: ["観測できた利用と、条件を満たす同席を確認します。", "Review observed voice use and qualified co-presence."],
 ANNOUNCEMENTS: ["お知らせへのリアクションや返信を確認します。", "Review reactions and replies to announcements."],
 SHOWCASE: ["作品・資料の新しい投稿と、反応やコメントを確認します。", "Review new creative and reference posts, reactions and comments."],
};
export const metricNames: Record<string, readonly [string, string]> = {
  new_members: ["新しい参加者", "New participants"],
  observed_posts: ["確認できた投稿", "Observed posts"],
  observed_replies: ["返信・投稿への応答", "Replies and responses to posts"],
  announcement_posts: ["お知らせの投稿", "Announcement posts"],
  observed_reactions: ["確認できたリアクション", "Observed reactions"],
  bot_webhook_posts: ["Bot・連携サービスの投稿", "Bot and integration posts"],
  showcase_posts: ["作品・資料の投稿", "Creative and reference posts"],
  showcase_comments: ["作品・資料のコメント", "Creative and reference comments"],
  observed_comments: ["作品・資料のコメント", "Creative and reference comments"],
  poll_participants: ["確認できた投票人数", "Observed poll participants"],
  first_reply_seconds: [
    "初回返信まで（中央値、秒）",
    "Median first reply time (seconds)",
  ],
  waiting_response: [
    "返信をまだ確認できない投稿",
    "Posts without an observed reply",
  ],
  voice_copresence: ["条件を満たすボイス同席", "Qualified voice co-presence"],
  event_signups: ["イベントへの申込", "Event signups"],
  event_attendance: ["確認できたイベント参加", "Observed event attendance"],
};
export const qualityNames: Record<AnalysisQuality, readonly [string, string]> =
  {
    COMPLETE: ["そろっています", "Complete enough"],
    PARTIAL: ["一部のみ確認できています", "Only partial data is available"],
    NO_DATA: ["データがありません", "Data is unavailable"],
    NOT_APPLICABLE: ["対象になるデータがありません", "No applicable data"],
    INSUFFICIENT_SAMPLE: ["まだ比較できません", "Not enough data to compare"],
  };
export const availabilityNames: Record<
  Availability,
  readonly [string, string]
> = {
  AVAILABLE: ["分析できます", "Available"],
  PARTIAL: ["一部のデータで分析できます", "Available with partial data"],
  UNAVAILABLE: [
    "この期間・設定では利用できません",
    "Unavailable for this period or setting",
  ],
  REQUIRES_SETUP: ["先に設定が必要です", "Setup required first"],
  INSUFFICIENT_DATA: ["まだデータが足りません", "Not enough data yet"],
};
export const runStatusNames: Record<
  AnalysisRun["status"],
  readonly [string, string]
> = {
  QUEUED: ["処理待ち", "Waiting"],
  PREPARING: ["準備中", "Preparing"],
  RUNNING: ["分析中", "Analysing"],
  FINALIZING: ["結果を保存中", "Saving result"],
  COMPLETED: ["完了", "Completed"],
  FAILED: ["失敗（回数を返却）", "Failed (use restored)"],
  CANCELED: ["取り消し（回数を返却）", "Canceled (use restored)"],
};
export function localized(locale: UiLocale, pair: readonly [string, string] | undefined) {
  return pair?.[locale === "en" ? 1 : 0] ?? analysisCopy(locale,"unknown");
}

export function analysisEvidenceReason(locale: UiLocale, reason: string) {
  return analysisCopy(
    locale,
    /COLLECTION_GAP/.test(reason)
      ? "reasonGap"
      : /COLLECTION_STARTED/.test(reason)
        ? "reasonStarted"
        : /MEMBER|STAFF/.test(reason)
          ? "reasonMembers"
          : /LEGACY|RECIPE|SCOPE_CHANGED/.test(reason)
            ? "reasonDefinition"
            : /GATEWAY|INTENT|CAPABILITY|CHANNEL|PERMISSION/.test(reason)
              ? "reasonAccess"
              : "reasonOther",
  );
}
