export type Locale = "en" | "ja";
export const text = <T>(locale: Locale, en: T, ja: T): T =>
  locale === "ja" ? ja : en;

// Public copy describes shipped behavior only. Availability belongs to plan-registry.
export const faqs = [
  {
    question: ["What does NEXUS observe?", "何を観測できますか？"],
    answer: [
      "NEXUS observes newcomer activity, direct replies, Thread and Forum responses, Reaction and Poll participation, qualified Voice co-presence, and Event signup and observable attendance. Event signup is separate from attendance; Voice co-presence does not prove conversation.",
      "新規メンバーの活動、直接返信、Thread・Forumの応答、Reaction・Pollの参加、条件を満たすVoice同席、Eventの参加登録と観測できる出席を確認できます。参加登録と出席は別で、Voice同席は会話の証明ではありません。",
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
      "NEXUS is currently an alpha release. Development self-host setup is documented in the repository. Ask support about availability for your server. Paid checkout is not configured and paid prices are not published.",
      "現在はアルファ版です。開発用セルフホストの手順をリポジトリで公開しています。サーバーでの利用についてはサポートにお問い合わせください。有料決済は未設定で、有料価格は公開していません。",
    ],
  },
] as const;
