export type Locale = "en" | "ja";
export const text = <T>(locale: Locale, en: T, ja: T): T =>
  locale === "ja" ? ja : en;

// Public copy describes shipped behavior only. Availability belongs to plan-registry.
export const faqs = [
  {
    question: ["What activity can I review?", "どんな活動を確認できますか？"],
    answer: [
      "NEXUS helps you review community activity, including newcomer activity, direct replies, Thread and Forum responses, Reaction and Poll participation, qualified Voice co-presence, and Event signup and observable attendance. Event signup is separate from attendance; Voice co-presence does not prove conversation.",
      "コミュニティの活動を確認でき、新規メンバーの活動、直接返信、Thread・Forumの応答、Reaction・Pollの参加、条件を満たすVoice同席、Eventの参加登録と観測できる出席を確認できます。参加登録と出席は別で、Voice同席は会話の証明ではありません。",
    ],
  },
  {
    question: [
      "Are message contents stored?",
      "メッセージの本文は保存されますか？",
    ],
    answer: [
      "Message text, attachments, DM contents and Voice audio are not stored. NEXUS uses activity types, timestamps and the metadata needed for measurement and follow-up. Retention and deletion controls are available.",
      "メッセージ本文、添付、DM内容、Voice音声は保存しません。活動の種類、時刻、測定や対応に必要なメタデータを使います。保持期間の設定とデータ削除も行えます。",
    ],
  },
  {
    question: [
      "How do Discord and Web work together?",
      "DiscordとWebはどう使い分けますか？",
    ],
    answer: [
      "Use the Discord control panel for everyday checks and follow-up. The Web dashboard provides analysis, measurement rules, settings, and collection and connection status. Access is checked against current server permissions.",
      "日々の確認と対応にはDiscordの管理パネルを使います。Webでは分析、測定ルール、設定、収集状況や接続状態を確認できます。現在のサーバー権限に基づいてアクセスを確認します。",
    ],
  },
  {
    question: ["How can I use NEXUS?", "利用するにはどうすればよいですか？"],
    answer: [
      "NEXUS is preparing Closed Beta 1: free, invitation-only access for a limited period and within usage limits. General registration, paid checkout, Live and extra analysis packs are not open. Check the participation information on Support; developer self-host setup remains documented in the repository.",
      "無料・招待制のClosed Beta 1を準備中です。招待されたサーバーへ、期限・利用上限つきで提供する予定です。一般登録・有料決済・Live・追加回数パックは開始していません。参加案内はサポートで確認できます。開発用セルフホストの手順はリポジトリにあります。",
    ],
  },
] as const;
