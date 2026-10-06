import type { EntitlementFeature, Plan, LimitKey } from "./plan-registry";
export const limitCopy: Record<LimitKey, readonly [string, string]> = {
  guilds: ["サーバーの登録枠", "Server allowance"],
  historyDays: ["集計履歴の日数", "Aggregate history days"],
  monthlyObservedMembers: [
    "月間観測人数の目安",
    "Monthly observed member allowance",
  ],
  customRecipes: ["独自の測定ルール", "Custom recipes"],
  automationRules: ["自動化ルール", "Automation rules"],
  scheduledReports: ["定期レポート", "Scheduled reports"],
  teamSeats: ["チームの利用枠", "Team seats"],
  webhooks: ["通知連携", "Webhooks"],
  apiRequestsMonthly: [
    "サーバーごとの月間API利用枠",
    "Monthly API requests per server",
  ],
  intakePanels: ["受付パネル数", "Operations intake panels"],
};
export const featureCopy: Record<
  EntitlementFeature,
  readonly [string, string]
> = {
  core_observation: [
    "すべての主要サーフェスの基本観測",
    "Core observation across Discord surfaces",
  ],
  basic_attention: ["未返信への基本対応", "Basic unanswered Attention"],
  connection_metrics: ["最初の交流", "First connections"],
  thread_forum_metrics: [
    "Thread・Forumの最初の応答",
    "Thread and Forum responses",
  ],
  reaction_poll_metrics: [
    "Reaction・Pollの参加",
    "Reaction and Poll participation",
  ],
  voice_metrics: [
    "Voice参加と条件を満たす同席",
    "Voice participation and qualified co-presence",
  ],
  event_metrics: [
    "イベント参加登録と観測できる出席",
    "Event signup and observable attendance",
  ],
  coverage_health: [
    "測定根拠・観測範囲・接続状態",
    "Metric Evidence, Coverage and Integration Health",
  ],
  all_recipe_presets: [
    "コミュニティに合う測定プリセット",
    "Community recipe presets",
  ],
  surface_breakdowns: [
    "サーフェスごとの応答と参加",
    "Response and participation breakdowns",
  ],
  percentile_metrics: [
    "応答時間の中央値・p75・p90",
    "Median, p75 and p90 response time",
  ],
  advanced_journeys: [
    "LFG・サポート・イベントの詳しいJourney",
    "Detailed LFG, support and event Journeys",
  ],
  comparable_periods: ["条件を満たす期間の比較", "Comparable period analysis"],
  scheduled_digest: ["毎週のサマリー", "Weekly digest"],
  basic_improvement_tracking: [
    "改善前後の基本的な比較",
    "Basic before and after tracking",
  ],
  custom_recipe: ["独自の測定ルール", "Custom measurement recipes"],
  attention_automation: ["未返信の自動通知", "Automated unanswered reminders"],
  attention_escalation: ["ヘルパーへのエスカレーション", "Helper escalation"],
  improvement_tracking: [
    "改善テストと継続的な追跡",
    "Improvement tests and tracking",
  ],
  scheduled_reports: ["定期レポート", "Scheduled reports"],
  team_routing: [
    "対応先チャンネルと担当ロール",
    "Routing to staff channels and roles",
  ],
  csv_export: ["集計結果のCSV出力", "Aggregate CSV export"],
  webhooks: ["外部への通知連携", "Webhook integrations"],
  multi_guild: ["複数サーバーの一括管理", "Multi-server overview"],
  rbac: ["役割ごとのアクセス管理", "Role-based access"],
  api: ["APIによる連携", "API access"],
  audit_export: ["監査記録の出力", "Audit export"],
  ai_explanation: ["AIによる説明", "AI explanations"],
  fallback_onboarding: ["参加時の案内", "New member onboarding"],
  hybrid_onboarding: ["Discordとの併用案内", "Hybrid onboarding"],
  custom_activation: ["独自の最初の目標", "Custom first goals"],
  interventions: [
    "確認して実行する改善アクション",
    "Reviewed improvement actions",
  ],
  discord_charts: ["Discord内の集計チャート", "Aggregate charts in Discord"],
  saved_views: [
    "保存ビューとセグメント",
    "Saved views and operational segments",
  ],
  heatmaps: ["曜日・時間の集計", "Weekday and hour heatmaps"],
  event_operations: [
    "イベントテンプレートとカレンダー",
    "Event templates and calendars",
  ],
  intake_panels: ["運営の課題受付", "Operations intake panels"],
  attention_inbox: ["根拠付きの対応管理", "Attention Inbox with evidence"],
  playbooks: ["運営Playbook", "Versioned operations playbooks"],
  report_branding: [
    "レポートのタイトル・ロゴ・フッター",
    "Report title, logo and footer",
  ],
  team_assignment: ["NEXUSチームへの割当", "Assignment to NEXUS teams"],
  approval_workflow: ["Playbookの承認", "Playbook approval workflow"],
  automation_sandbox: [
    "過去データによる試行",
    "Historical automation dry runs",
  ],
  recurring_exports: ["定期的な集計出力", "Recurring aggregate exports"],
  advanced_api: [
    "サービスアカウントと限定書込API",
    "Service accounts and selected write API",
  ],
};
export const planCopy: Record<
  Plan,
  { heading: readonly [string, string]; purpose: readonly [string, string] }
> = {
  FREE: {
    heading: ["いま起きていることを知る", "See what’s happening"],
    purpose: ["観測と確認", "Observe & Check"],
  },
  STARTER: {
    heading: ["どこで起きているかを理解する", "Understand where it happens"],
    purpose: ["理解と探索", "Understand & Explore"],
  },
  GROWTH: {
    heading: ["運営し、改善する", "Operate and improve"],
    purpose: ["運営と連携", "Operate & Integrate"],
  },
  SCALE: {
    heading: ["チームで運営する", "Run it with a team"],
    purpose: ["チーム・自動化・統制", "Team, Automate & Govern"],
  },
  ENTERPRISE: {
    heading: ["組織の個別要件に合わせる", "Custom organizational requirements"],
    purpose: ["保護と連携", "Secure & Integrate"],
  },
};
