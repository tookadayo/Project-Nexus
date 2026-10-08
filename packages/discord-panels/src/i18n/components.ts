import type { UiLocale } from "./index";
const copy = {
  serverOverview: ["サーバー概要", "Server overview"],
  newMembers: ["新しいメンバー", "New members"],
  analysis: ["分析", "Analysis"],
  measurementMethod: ["計測方法", "Measurement method"],
  someMeasurementsArePaused: [
    "計測を一部停止しています",
    "Some measurements are paused",
  ],
  theDiscordConnectionIsUnavailableThisPeriod: [
    "Discordとの接続を確認できません。この期間は比較に使用しません。",
    "The Discord connection is unavailable. This period is excluded from comparisons.",
  ],
  requiredMemberInformationIsUnavailableThisPeriod: [
    "必要なメンバー情報を正常に受信できていません。この期間は比較に使用しません。",
    "Required member information is unavailable. This period is excluded from comparisons.",
  ],
  attention: ["対応待ち", "Needs review"],
  newAttentionItemsCannotBeObserved: [
    "新しい対応対象を確認できません",
    "New reviews cannot be observed",
  ],
  items: ["件", "items"],
  oldest: ["最長", "Oldest"],
  min: ["分", "min"],
  joinedToday: ["今日、新しく参加", "Joined today"],
  unknown: ["確認できません", "Unknown"],
  firstConnectionObservedToday: [
    "今日、最初の交流を確認",
    "First connection observed today",
  ],
  savedOpenBacklog: ["登録済みの対応", "Saved open backlog"],
  medianResolutionTime: ["対応完了時間の中央値", "Median resolution time"],
  notReady: ["まだ比較できません", "Not ready"],
  en: ["ja", "en"],
  median: ["中央値", "Median"],
  chooseAMeasurementRecipe: [
    "計測方法を確認してください",
    "Choose a measurement recipe",
  ],
  confirmTheCommunityPurposeInWebScreen: [
    "Web画面でサーバーの目的を確認すると、参加後の変化を表示できます。",
    "Confirm the community purpose in Web screen to see participation transitions.",
  ],
  whatThisServerMeasures: [
    "このサーバーで確認すること",
    "What this server measures",
  ],
  notObserved: ["確認しないもの", "Not observed"],
  messageContentDmsVoiceAudioAndOnline: [
    "メッセージ本文・DM・ボイスの音声・オンライン状態",
    "Message content, DMs, voice audio, and online status",
  ],
  observedChannels: ["確認できるチャンネル", "Observed channels"],
  serverwideTotalUnavailable: [
    " · サーバー全体の数は確認できません",
    " · Server-wide total unavailable",
  ],
  attentionLabel: ["対応を見る", "Needs review"],
  newMembersLabel: ["新規メンバー", "New members"],
  waitingForReply: ["返信待ち", "Waiting for reply"],
  snoozed: ["再確認待ち", "Snoozed"],
  communityPurposes: ["運営目的", "Community purposes"],
  anAdministratorCanChooseMultiplePurposes: [
    "管理者が複数の目的を選べます。",
    "An administrator can choose multiple purposes.",
  ],
  coverage: ["観測範囲", "Data available"],
  unreadableChannelsAndPrivateThreadsRemainPartial: [
    "閲覧できないチャンネル・非公開スレッドを含む全体像は未確認です。",
    "Unreadable channels and private threads remain partial.",
  ],
  detectedCapabilities: ["検出された機能", "Detected capabilities"],
  purposesAndTagMeanings: ["用途とタグの意味", "Purposes and tag meanings"],
  purposesAreChosenByAnAdministratorEdit: [
    "用途は管理者が指定します。掲示板のタグの詳しい対応付けはWeb設定で編集できます。本文・投票の意味は収集しません。",
    "Purposes are chosen by an administrator. Edit full Forum tag mappings in Web Settings. No body or poll meaning is collected.",
  ],
  editPurposesAndMappings: ["目的・用途を編集", "Edit purposes and mappings"],
  rediscover: ["更新する", "Update connection"],
  connectWebDashboard: ["Web画面を接続", "Connect Web screen"],
  runNexusLinkInThisServerTo: [
    "Web接続には、このサーバーで /nexus link を実行してください。",
    "Run /nexus link in this server to verify its Web connection.",
  ],
  completeAndContinue: ["完了して次へ", "Complete and continue"],
  skipAndContinue: ["スキップして次へ", "Skip and continue"],
  operationResult: ["操作結果", "Operation result"],
  retry: ["再試行", "Retry"],
  checkCurrentState: ["最新状態を確認", "Check current state"],
  checkStatus: ["状態を確認", "Check status"],
  back: ["に戻る", " · Back"],
  promotionCode: ["プロモーションコード", "Promotion code"],
  code: ["コード", "Code"],
  communityPurposesLabel: ["コミュニティの目的と用途", "Community purposes"],
  communityPurposesMultiple: [
    "運営目的（複数選択）",
    "Community purposes (multiple)",
  ],
  channelToMapOptional: [
    "用途を設定するチャンネル（任意）",
    "Channel to map (optional)",
  ],
  purposeOfTheSelectedChannel: [
    "選んだチャンネルの用途",
    "Purpose of the selected channel",
  ],
  voiceCopresenceMinutes160: [
    "ボイス同席の基準（分、1〜60）",
    "Voice co-presence (minutes, 1–60)",
  ],
} as const;
export const componentCopyKeys = Object.keys(copy) as (keyof typeof copy)[];
export function componentCopy(locale: UiLocale, key: keyof typeof copy) {
  return copy[key][locale === "en" ? 1 : 0];
}
