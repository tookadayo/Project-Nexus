import type { UiLocale } from "./index";
import type {
  AnalysisType,
  AnalysisQuality,
  Availability,
  AnalysisRun,
} from "../../../analysis/src/domain";
const copy = {
  observedFacts: ["確認できたこと", "What we could confirm"],
  unknowns: ["この結果では分からないこと", "What this result cannot tell you"],
  unknownsDescription: [
    "活動や返信がなかった理由、離脱理由、満足度は分かりません。閲覧・Discordへの再訪は計測していません。変化だけで原因や対応の効果を判断できません。",
    "Reasons for inactivity, missing replies or leaving, and satisfaction are unknown. Views and returns to Discord are not measured. Changes alone do not establish causes or effects.",
  ],
  nextCheck: ["次に確認できること", "What to check next"],
  nextCheckDescription: [
    "根拠を確認し、要確認で対応を記録できます。履歴から過去の結果を開き、条件が合う期間だけ比較できます。",
    "Review the measurements and record follow-up in saved reviews. Open earlier results in history and compare compatible periods.",
  ],
  savedScope: ["保存した分析範囲", "Saved analysis scope"],
  scopeMeaning: [
    "この範囲から、分析の種類と保存した用途に合う活動を集計します。",
    "Within this scope, activity is filtered by the analysis type and saved purposes.",
  ],
  noSavedPlaces: [
    "保存された対象の場所はありません。場所を使わない指標もあります。",
    "No target places were saved. Some measures do not use places.",
  ],
  placePage: [
    "場所 {from}〜{through} / {count}件",
    "Places {from}–{through} of {count}",
  ],
  scopeDetails: ["対象の場所を見る", "View saved places"],
  measurementPeriod: ["集計期間: {period}", "Period covered: {period}"],
  measurementSources: ["根拠の記録: {sources}", "Recorded sources: {sources}"],
  sampleRecords: ["計算に使えた記録: {count}件", "Records used: {count}"],
  samplePeople: ["計算に使えた参加者: {count}人", "Participants used: {count}"],
  observedLowerBound: [
    "少なくともこの件数を確認できました。集計できていない分があり、総数は分かりません。",
    "At least this many were confirmed. Some data could not be collected, so the total is unknown.",
  ],
  collectingData: [
    "必要な期間の記録がまだそろっていません。",
    "Records for the required period are still being collected.",
  ],
  valueUnknown: ["値を確認できません。", "The value is unavailable."],
  legacyMetric: [
    "以前の計算方法の保存値です。現在の定義で説明し直すことはできません。",
    "This is a saved value from an earlier calculation method. The current definition cannot describe it.",
  ],
  cohortScope: [
    "集計期間に参加時の情報と参加条件を確認できたメンバーの活動に限定します。運営ロールは除外し、閲覧・再訪とは区別します。",
    "Activity is limited to eligible members whose join was confirmed in the period, excluding team roles. This does not measure views or returns to Discord.",
  ],
  savedVoiceThreshold: [
    "保存した同席時間の条件: {seconds}秒以上",
    "Saved minimum time together in voice: {seconds} seconds",
  ],
  comparisonConditions: [
    "指標の定義・対象範囲・集計方法が合い、必要な記録がそろう、長さが同じで重ならない期間を比較します。同じカレンダー日である必要はありません。",
    "Comparison requires matching definitions, scope and calculation methods, complete required records, and periods of equal length that do not overlap. Calendar dates need not match.",
  ],
  comparisonCurrent: ["今回の期間", "Current period"],
  comparisonPrevious: ["以前の期間", "Earlier period"],
  comparisonUnavailableMetrics: [
    "比較に含めていない指標",
    "Measures excluded from comparison",
  ],
  comparisonNoPrevious: [
    "閲覧できる範囲に、同じ種類の以前の結果がありません。",
    "No earlier result of this type is available within your accessible history.",
  ],
  reasonSample: [
    "比較に必要な件数が足りません。",
    "Too few records are available for comparison.",
  ],
  reasonNoEligible: [
    "対象条件を満たす記録がありません。",
    "No records meet the eligibility conditions.",
  ],
  reasonScope: [
    "保存した対象範囲または用途が異なります。",
    "The saved scope or purposes differ.",
  ],
  reasonWindow: [
    "計測期間の長さや種類が異なるか、期間が重なっています。",
    "The periods differ in length or type, or overlap.",
  ],
  reasonMethod: [
    "指標の定義または集計方法が異なります。",
    "The measure definition or calculation method differs.",
  ],
  reasonEpoch: [
    "この期間の収集記録を確認できません。",
    "We cannot confirm how data was collected during this period.",
  ],
  reasonIncident: [
    "この期間の障害・特別な状況があるため比較を保留します。",
    "An incident or exceptional context in this period prevents comparison.",
  ],
  sourceUnknown: [
    "記録の種類を確認できません",
    "The source type is unverified",
  ],
  noFacts: [
    "値を確認できる指標がありません。各指標の不足理由を確認してください。",
    "No measure has an available value. Check the missing-data reasons for each measure.",
  ],
  concernUnknown: [
    "データ不足のため、追加する要確認がないことを問題なしとは判断できません。",
    "Missing data means an empty review list does not establish that no issues exist.",
  ],
  responseRecords: ["対応記録を見る", "View follow-up records"],
  responseStatus: ["対応の記録", "Recorded follow-up"],
  recordOnly: [
    "この操作は運営の対応を記録します。返信の発生・問題の解決・改善効果を証明しません。保存した分析値は変わりません。",
    "These controls record team follow-up. They do not prove a reply, problem resolution or improvement. Saved analysis values stay unchanged.",
  ],
  recordCompleted: ["対応記録を完了する", "Complete follow-up record"],
  recordWithdraw: ["要確認を撤回する", "Withdraw review item"],
  recordHistory: [
    "最近の対応記録（最大5件）",
    "Recent follow-up history (up to 5)",
  ],
  recordHistoryUnknown: [
    "以前の対応履歴は確認できません。",
    "Earlier follow-up history is unavailable.",
  ],
  recordAll: ["完了・撤回も見る", "Include completed and withdrawn"],
  recordActive: ["対応中だけ見る", "View active reviews"],
  recordEmpty: [
    "保存された対応記録はありません。",
    "No follow-up records are saved.",
  ],
  recordReadOnly: [
    "閲覧のみ可能です。対応の変更には運営権限が必要です。",
    "You can view this record. Changing follow-up requires operations permission.",
  ],
  recordCreatedAt: ["追加した日時: {time}", "Added: {time}"],
  recordUpdatedAt: ["最終更新: {time}", "Last updated: {time}"],
  basicDescription: [
    "投稿・返信・新しい参加者の状況を確認できます。",
    "View posts, replies and new participants.",
  ],
  basicVoiceDescription: [
    "ボイスの利用と、確認できた同席や参加状況を確認できます。",
    "View voice use and recorded shared time and participation.",
  ],
  basicShowcaseDescription: [
    "作品・資料の投稿と、確認できた反応を確認できます。",
    "View creative and reference posts and recorded responses.",
  ],
  basicAction: ["状況を見る", "View activity"],
  reviewAction: ["要確認を見る", "View reviews"],
  reviewDescription: [
    "権限を確認して、運営が対応する項目を開きます。",
    "Open your team's review items after checking your access.",
  ],
  reviewNeeded: [
    "対応が必要な項目があります。",
    "There are items for your team to review.",
  ],
  reviewClear: [
    "現在の条件で、追加された要確認の記録はありません。",
    "No review records are listed under the current conditions.",
  ],
  reviewUnknown: [
    "現在の状態を確認できません。時間をおいて更新してください。",
    "We cannot determine the current status. Refresh again later.",
  ],
  detailedDescription: [
    "設定した用途に合わせて、変化と確認したい点をまとめます。",
    "Summarise changes and points to review for your configured purposes.",
  ],
  estimateUnknown: [
    "完了時間はまだ見積もれません。",
    "Completion time cannot be estimated yet.",
  ],
  previousPage: ["前の5件", "Previous 5"],
  nextPage: ["次の5件", "Next 5"],
  details: ["詳しく見る", "View details"],
  summary: ["主な結果", "Main results"],
  correctionReview: ["計算方法の訂正を確認", "Review corrected calculation"],
  correctionFree: [
    "以前の計算方法を訂正します。回数は使いません。",
    "Correct the earlier calculation method without using an analysis allowance.",
  ],
  calculatedAt: ["計算した日時: {time}", "Calculated: {time}"],
  changes: [
    "前回から確認できた変化",
    "Changes confirmed since the previous result",
  ],
  smallSample: [
    "確認できた件数が少ないため、参考としてご覧ください。変化だけでは原因や施策の効果は判断できません。",
    "Few records are available, so treat these changes as indicative. Changes alone do not establish causes or effects.",
  ],
  previousDefinition: [
    "以前の計算方法による結果です。場所の記録は確認できません。",
    "This result uses an older calculation method. Its saved places are unavailable.",
  ],
  usageUnknown: [
    "残りの分析回数は確認できません。",
    "Remaining detailed analyses are unavailable.",
  ],
  monthlyRenewal: ["次回の月枠更新: {time}", "Next monthly allowance: {time}"],
  tagConflict: [
    "対応済みと未対応の両方に設定したタグがあります。対応状態は確認できません。タグの設定を確認してください。",
    "Tags mapped as both resolved and unresolved were found. Resolution is unknown. Review the tag settings.",
  ],
  removedData: [
    "削除されたデータを含むため結果を表示できません。",
    "Result unavailable after data removal.",
  ],
  oldDefinition: [
    "以前の計算方法による結果",
    "Result from an earlier calculation method",
  ],
  noConcerns: [
    "今回の分析から追加する要確認はありません。",
    "This analysis has no additional items for review.",
  ],
  unknownMetric: ["確認できた活動", "Recorded activity"],
  seconds: ["{count}秒", "{count} seconds"],
  people: ["{count}人", "{count} people"],
  items: ["{count}件", "{count} items"],
  times: ["{count}回", "{count} occurrences"],
  medianNote: [
    "極端に長い・短いものの影響を受けにくい値です。",
    "A median is less affected by unusually short or long waits.",
  ],
  cancel: ["処理待ちを取り消す", "Cancel waiting analysis"],
  canceled: [
    "処理待ちを取り消しました。予約した回数は戻ります。",
    "Waiting analysis canceled. The reserved use is released.",
  ],
  cancelStarted: [
    "処理が始まったため、取り消せません。履歴から結果を確認できます。",
    "Processing has started and cannot be canceled. Check history for the result.",
  ],
  attentionConfirm: ["追加する内容を確認", "Review the item to add"],
  attentionDuplicate: [
    "同じ項目が既にあります。重複して追加しません。",
    "This item already exists and will not be duplicated.",
  ],
  attentionNew: [
    "この結果の根拠を付けて、運営用の要確認を1件追加します。",
    "Add one team review item with the evidence from this result.",
  ],
  purpose: ["用途を選ぶ", "Choose a purpose"],
  purposeLater: [
    "用途はあとで設定できます。基本分析は使えます。",
    "Purposes can be set later. Basic analysis remains available.",
  ],
  purposeApply: [
    "この用途を選んだ場所へ設定",
    "Apply purpose to selected places",
  ],
  purposeBatch: [
    "今回選んだ{count}件に用途を設定します。他の場所の用途は維持します。",
    "Set a purpose for the {count} places just selected. Other purposes are preserved.",
  ],
  addChannels: ["チャンネルを追加（25件ずつ）", "Add channels (25 at a time)"],
  removeChannels: ["選んだ場所から取り除く", "Remove selected places"],
  chooseCategory: [
    "カテゴリの子チャンネルを追加",
    "Add a category's current channels",
  ],
  snapshotScope: [
    "選んだ時点の場所だけを保存します。将来の追加は自動で含めません。",
    "Only the places selected now are saved. Future additions are not included automatically.",
  ],
  scopeReview: ["場所の一覧を確認", "Review selected places"],
  scopePage: [
    "{from}〜{through} / {count}件",
    "{from}–{through} / {count} places",
  ],
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
  evidence: ["根拠とデータ状況", "Measurements and data available"],
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
    "Posts without a recorded response: {count}",
  ],
  notes: [
    "返信は本文の意味を判断しません。ボイス同席は会話、イベント申込は参加を意味しません。",
    "Replies do not describe message meaning. Time together in voice does not prove conversation; event signup does not prove attendance.",
  ],
  sample: ["対象 {count}件", "Sample: {count}"],
  peopleSample: ["対象 {count}人", "Sample: {count} people"],
  sampleUnknown: [
    "対象件数を確認できません。",
    "The number of records used is unavailable.",
  ],
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
  historicalPostsTitle: ["過去の投稿データ", "Older post data"],
  reasonHistoricalPosts: [
    "過去の投稿の記録は一部の参加者に限られます。運営メンバーやBotを含む投稿の総数と、Botの投稿が0件だったかどうかは確認できません。",
    "Older post records include only some participants. Total posts including team members and bots, and whether there were zero bot posts, are unavailable.",
  ],
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
    "Some required places or features could not be checked.",
  ],
  reasonMembers: [
    "参加条件や運営ロールを確認できない人がいます。",
    "Some member eligibility or team roles could not be confirmed.",
  ],
  reasonDefinition: [
    "計測条件が変わったか、以前の記録を確認できません。",
    "Measurement conditions changed or older records could not be verified.",
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
  resolved: ["対応済みとして記録", "Mark as handled"],
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
export const analysisDescriptions: Record<
  AnalysisType,
  readonly [string, string]
> = {
  OVERALL: [
    "投稿・返信・ボイス・イベントの状況をまとめます。",
    "Summarise posts, replies, voice use and events.",
  ],
  NEW_MEMBERS: [
    "新しい参加者の活動と、確認できた返信を調べます。",
    "Review new participants' activity and recorded replies.",
  ],
  SUPPORT: [
    "質問用に設定した場所の返信と返信待ちを確認します。",
    "Review replies and waiting posts in configured support places.",
  ],
  EVENTS: [
    "申込と、確認できた参加を分けて振り返ります。",
    "Review event signups separately from recorded attendance.",
  ],
  VOICE: [
    "確認できたボイス利用と、時間条件を満たす同席を確認します。",
    "Review recorded voice use and shared time meeting the saved duration.",
  ],
  ANNOUNCEMENTS: [
    "お知らせへのリアクションや返信を確認します。",
    "Review reactions and replies to announcements.",
  ],
  SHOWCASE: [
    "作品・資料の新しい投稿と、反応やコメントを確認します。",
    "Review new creative and reference posts, reactions and comments.",
  ],
};
export const metricNames: Record<string, readonly [string, string]> = {
  new_members: ["新しい参加者", "New participants"],
  observed_posts: ["確認できた投稿", "Recorded posts"],
  observed_replies: ["応答を確認できた投稿", "Posts with a recorded response"],
  announcement_posts: ["お知らせの投稿", "Announcement posts"],
  observed_reactions: ["確認できたリアクション", "Recorded reactions"],
  bot_webhook_posts: ["Bot・連携サービスの投稿", "Bot and integration posts"],
  showcase_posts: ["作品・資料の投稿", "Creative and reference posts"],
  showcase_comments: [
    "作品・資料のコメント",
    "Creative and reference comments",
  ],
  observed_comments: [
    "作品・資料のコメント",
    "Creative and reference comments",
  ],
  poll_participants: ["確認できた投票人数", "Recorded poll participants"],
  first_reply_seconds: [
    "初回返信まで（中央値、秒）",
    "Median first reply time (seconds)",
  ],
  waiting_response: [
    "返信をまだ確認できない投稿",
    "Posts without a recorded response",
  ],
  voice_copresence: [
    "条件を満たすボイス同席人数",
    "Participants together in voice",
  ],
  event_signups: ["イベント申込の記録", "Recorded event signup records"],
  event_attendance: ["イベント参加の記録", "Recorded event attendance records"],
};
export const qualityNames: Record<AnalysisQuality, readonly [string, string]> =
  {
    COMPLETE: [
      "この範囲と期間で確認できています",
      "Confirmed within the stated scope and period",
    ],
    PARTIAL: ["一部のみ確認できています", "Only partial data is available"],
    NO_DATA: ["値を確認できません", "The value is unavailable"],
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
export function localized(
  locale: UiLocale,
  pair: readonly [string, string] | undefined,
) {
  return pair?.[locale === "en" ? 1 : 0] ?? analysisCopy(locale, "unknown");
}

export function analysisEvidenceReason(locale: UiLocale, reason: string) {
  if (reason === "LEGACY_PARTICIPANT_ONLY_COVERAGE")
    return analysisCopy(locale, "reasonHistoricalPosts");
  const exact: Record<string, AnalysisCopyKey> = {
    NO_PREVIOUS_RESULT: "comparisonNoPrevious",
    INSUFFICIENT_SAMPLE: "reasonSample",
    NO_ELIGIBLE: "reasonNoEligible",
    COLLECTING: "collectingData",
    UNKNOWN: "valueUnknown",
    VALUE_UNKNOWN: "valueUnknown",
    SCOPE_MISMATCH: "reasonScope",
    WINDOW_MISMATCH: "reasonWindow",
    DEFINITION_MISMATCH: "reasonMethod",
    METHOD_MISMATCH: "reasonMethod",
    METRIC_MISSING: "reasonMethod",
    TYPE_MISMATCH: "reasonMethod",
    RECIPE_MISMATCH: "reasonDefinition",
    EPOCH_UNKNOWN: "reasonEpoch",
    EPOCH_LIMIT: "reasonEpoch",
    SAFETY_CONTEXT: "reasonIncident",
    COVERAGE_LOWER_BOUND: "observedLowerBound",
    COVERAGE_PARTIAL: "reasonOther",
    COVERAGE_UNKNOWN: "reasonAccess",
  };
  if (exact[reason]) return analysisCopy(locale, exact[reason]);
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

export function hasHistoricalPostCoverage(
  metrics: readonly { evidence: { coverageReasons: readonly string[] } }[],
) {
  return metrics.some((metric) =>
    metric.evidence.coverageReasons.includes(
      "LEGACY_PARTICIPANT_ONLY_COVERAGE",
    ),
  );
}
