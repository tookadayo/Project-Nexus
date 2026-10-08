import type { UiLocale } from "./index";
import type {
  AnalysisType,
  AnalysisQuality,
  Availability,
  AnalysisRun,
} from "../../../analysis/src/domain";
const copy = {
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
  noUses: [
    "残りの分析回数がありません。基本の分析は引き続き使えます。",
    "No detailed analysis uses remain. Basic analysis is still available.",
  ],
  homeTitle: ["NEXUSの今の状況", "Your community now"],
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
  goals: ["目標", "Goals"],
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
};
export const metricNames: Record<string, readonly [string, string]> = {
  new_members: ["新しい参加者", "New participants"],
  observed_posts: ["確認できた投稿", "Observed posts"],
  observed_replies: ["返信を確認した投稿", "Posts with observed replies"],
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
export function localized(locale: UiLocale, pair: readonly [string, string]) {
  return pair[locale === "en" ? 1 : 0];
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
