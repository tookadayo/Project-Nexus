import type { AdaptiveMetric } from "../../presentation/src/adaptive";
export const modeNames = {
  SOCIAL: ["会話・交流", "Social conversation"],
  LFG_PLAY: ["仲間募集・一緒に遊ぶ", "LFG / play"],
  SUPPORT_QA: ["サポート・質問", "Support / Q&A"],
  DEVELOPMENT_FEEDBACK: ["開発・フィードバック", "Development / feedback"],
  EVENTS: ["イベント", "Events"],
  CREATOR_FAN: ["クリエイター・ファン", "Creator / fan"],
  VOICE: ["ボイス中心", "Voice"],
  CONTENT_SHOWCASE: ["作品・コンテンツ共有", "Content showcase"],
} as const;
export const purposeNames = {
  GENERAL_CONVERSATION: ["会話・交流", "General conversation"],
  LFG: ["仲間募集", "LFG"],
  SUPPORT: ["サポート・質問", "Support"],
  BUG_REPORT: ["不具合報告", "Bug reports"],
  FEEDBACK: ["フィードバック", "Feedback"],
  SHOWCASE: ["作品共有", "Showcase"],
  ANNOUNCEMENT: ["お知らせ", "Announcements"],
  ONBOARDING: ["参加案内", "Onboarding"],
  STAFF: ["運営用", "Staff"],
  OTHER: ["その他・未指定", "Other"],
} as const;
export const statusNames = {
  AVAILABLE: ["利用できる", "Available"],
  ENABLED: ["有効", "Enabled"],
  OBSERVED: ["観測済み", "Observed"],
  CONFIGURED: ["設定済み", "Configured"],
  UNAVAILABLE: ["利用できない", "Unavailable"],
  PERMISSION_MISSING: ["権限が必要", "Permission missing"],
  UNKNOWN: ["未確認", "Unknown"],
} as const;
export const featureNames: Record<string, readonly [string, string]> = {
  text: ["テキスト", "Text"],
  announcement: ["お知らせ", "Announcements"],
  voice: ["ボイス", "Voice"],
  stage: ["Stage", "Stage"],
  forum: ["Forum", "Forum"],
  media: ["Media", "Media"],
  category: ["カテゴリー", "Categories"],
  threads: ["Thread", "Threads"],
  community: ["Community", "Community"],
  screening: ["ルール確認", "Rules Screening"],
  guests: ["Guest", "Guests"],
  discovery: ["Discovery", "Discovery"],
  onboarding: ["参加時の案内", "Onboarding"],
  serverGuide: ["サーバーガイド", "Server Guide"],
  legacyWelcome: ["旧Welcome Screen", "Legacy Welcome Screen"],
  autoMod: ["AutoMod", "AutoMod"],
  events: ["イベント", "Scheduled events"],
  reaction: ["リアクション", "Reactions"],
  poll: ["投票", "Polls"],
  voiceText: ["ボイス内のテキスト", "Voice text"],
  stageText: ["Stage内のテキスト", "Stage text"],
  incidents: ["安全性に関する状況", "Safety context"],
};
const metrics: Record<string, readonly [string, string, string, string]> = {
  directReplies: [
    "直接返信",
    "Direct replies",
    "他の人からの明示的な返信。時間は中央値です。",
    "Explicit replies from another human. Time is the median.",
  ],
  postResponse: [
    "投稿への最初の応答",
    "First post response",
    "同じ投稿への他の人からの最初のメッセージ。直接返信とは別に計測します。",
    "First other-human message in a post; distinct from a direct reply.",
  ],
  resolvedPosts: [
    "解決済みの投稿",
    "Resolved posts",
    "管理者が「解決」と対応付けたタグ付きの現在の投稿。アーカイブやロックは含みません。",
    "Current posts with an admin-mapped resolved tag; archive/lock excluded.",
  ],
  voiceCopresence: [
    "一定時間のボイス同席",
    "Sustained voice co-presence",
    "設定した時間以上、他の人と同席した人数。会話したことを証明するものではありません。",
    "Human co-presence reaching the configured threshold; conversation is not proven.",
  ],
  lfgThenVoice: [
    "募集後のボイス同席",
    "Voice after LFG",
    "募集活動の後、1日以内に同席を観測した人数。成立や同じ相手との参加は未確認です。",
    "Voice co-presence within one day after LFG activity; successful matching and same partner unknown.",
  ],
  eventSubscriptions: [
    "イベント参加登録",
    "Event subscriptions",
    "参加登録を観測した回数。実際の出席とは別です。",
    "Observed subscriptions, separate from attendance.",
  ],
  eventAttendance: [
    "観測できた出席",
    "Observed attendance",
    "実際に開始を観測したイベント中のVoice・Stage参加。外部イベントの出席は未確認です。",
    "Voice/Stage presence during an observed ACTIVE event; external attendance unknown.",
  ],
  stageAudience: [
    "Stageの聴衆",
    "Stage audience",
    "聴衆としての入場。会話・発言を意味しません。",
    "Audience entry, not conversation or speech.",
  ],
  stageSpeakers: [
    "Stageのスピーカー",
    "Stage speakers",
    "スピーカー状態への変更。実際の発言は観測しません。",
    "Speaker state; actual speech is not observed.",
  ],
  activeReactions: [
    "現在のリアクション参加",
    "Current reaction participation",
    "観測開始後の解除を反映した、人と投稿の組み合わせ。自己・Botを除きます。",
    "Current user/message participation since collection began; self/bots excluded.",
  ],
  pollParticipants: [
    "現在の投票参加",
    "Current poll participation",
    "複数回答でも1人・1投票につき1参加。質問・選択肢の意味は収集しません。",
    "One user/poll participation across multiple answers; no answer meaning collected.",
  ],
};
export function metricCopy(metric: AdaptiveMetric, locale: "ja" | "en") {
  const row = metrics[metric.key];
  return {
    label: row?.[locale === "ja" ? 0 : 1] ?? metric.key,
    definition: row?.[locale === "ja" ? 2 : 3] ?? metric.definition,
  };
}
