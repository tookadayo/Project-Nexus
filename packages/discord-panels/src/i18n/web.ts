import type { ResultsPresentation } from "../../../presentation/src/types";
type Locale = "en" | "ja";
export const messages = {
  en: {
    tagline: "See where newcomers drop off. Fix it. Measure what worked.",
    home: "Overview",
    journey: "New Members",
    milestones: "Newcomer milestones",
    opportunities: "Improve",
    actions: "Improvement menu",
    results: "Results",
    settings: "Settings",
    new_members: "New Members",
    activation_rate: "Members with the configured first activity",
    direct_reply_connection_rate: "Received a reply",
    d7_active_retention: "Activity on days 7–8 after joining",
    joined: "Joined",
    onboarded: "Completed joining steps",
    first_value: "Configured first activity observed",
    connected: "Received a reply",
    d7_active: "Activity on days 7–8 after joining",
    previous: "Previous period",
    data: "Data collection status",
    empty: "No verified observations yet",
    emptyDetail:
      "NEXUS will show this view after scoped production activity is observed. Missing and immature observations are never treated as zero.",
    setup: "Set up newcomer measurement",
    connect: "Connect Discord",
    activation: "Members with the configured first activity",
    onboarding: "Welcome flow (optional)",
    measuring: "Start measuring",
    complete: "Complete",
    todo: "Next step",
    communityOpportunity: "Pattern to review",
    measurementWarning: "Data collection status",
    suggested: "Suggested next action",
    range: "Range",
    retention: "By join period",
    members: "Members",
    reply: "First reply distribution",
    trendActivation: "Configured first activity trend",
    trendConnection: "First reply rate trend",
    trendRetention: "Activity one week after joining",
    noOpportunity:
      "No reliable comparison is ready yet. You can still choose an improvement below.",
    notCausal: "This change was observed; its cause is not yet known.",
    createAction: "Choose an improvement",
    template: "Improvement menu",
    destination: "Destination channel",
    event: "Scheduled event",
    recommendedChannels: "Recommended channels",
    review: "Enable",
    publish: "Enable",
    published: "Published and active.",
    when: "What starts it",
    wait: "Wait",
    if: "Check before sending",
    then: "What happens",
    safety: "Staff review",
    activeActions: "Enabled improvements",
    delivery: "Delivery health",
    noActions: "No action is active yet. Start from a guarded template.",
    learning: "What we learned",
    hypothesis: "Question",
    maturity: "Evaluated",
    noResults:
      "No results yet. Enable an improvement, then check whether it helped.",
    privacy: "Privacy & data storage",
    team: "Team & access",
    plan: "Plan & usage",
    advanced: "How this was measured",
    configureActivation: "Use this preset",
    draftReady: "Confirm your choice to start measuring.",
    language: "Language",
    unavailable: "Unavailable",
    healthy: "Healthy",
    partial: "Partial",
    provisional: "Collecting",
    mature: "Ready to evaluate",
    eligible: "Ready",
    observed: "Observed",
    control: "Usual experience",
    treatment: "Improvement enabled",
    rate: "Rate",
    triggered: "Triggered",
    approved: "Approved",
    delivered: "Delivered",
    failed: "Failed",
    unknown: "Unknown",
    suppressed: "Suppressed",
    seeEvidence: "Why this appeared",
    dismiss: "Dismiss for now",
    why: "Why this appeared",
    createFromOpportunity: "Improve this",
    viewOpportunities: "View improvements",
    testAction: "Check the result",
    viewActivity: "View Activity",
    approve: "Approve",
    approvalNeeded: "Approval needed",
    question: "Did this improvement help newcomers?",
    primaryOutcome: "What NEXUS will check",
    assignment: "How the check works",
    dailyBlocks: "Daily time blocks",
    reviewTest: "Check the result",
    startTest: "Check the result",
    pauseTest: "Pause Test",
    stopTest: "Stop Test",
    viewAction: "View improvement",
    continueCollecting: "Continue collecting",
    recommendedSetup: "Use Recommended Setup",
    optionsUnavailable:
      "Discord choices are unavailable. Refresh setup or use the Discord panel.",
    loading: "Loading verified data…",
    current: "Current",
    baseline: "Earlier period",
    difference: "Difference",
    sample: "Sample",
    coverage: "Data collection status",
    stage: "Newcomer milestone",
    guardrails: "Safety checks",
    randomization: "Comparison method",
    timeline: "Timeline",
    refresh: "Refresh",
    next: "Next",
  },
  ja: {
    tagline: "新規メンバーが離脱する場所を見つけ、改善し、効果を測定します。",
    home: "概要",
    journey: "新規メンバー",
    milestones: "新規メンバーの到達点",
    opportunities: "改善",
    actions: "改善メニュー",
    results: "結果",
    settings: "設定",
    new_members: "新規メンバー",
    activation_rate: "設定した活動を確認したメンバー",
    direct_reply_connection_rate: "返信を受けた",
    d7_active_retention: "参加後7〜8日目の活動",
    joined: "参加",
    onboarded: "参加手続きを完了",
    first_value: "設定した設定した活動を確認",
    connected: "返信を受けた",
    d7_active: "参加後7〜8日目の活動",
    previous: "前期間",
    data: "データ取得状況",
    empty: "検証済みの観測データはまだありません",
    emptyDetail:
      "対象期間の活動データが集まると表示されます。欠損した値や集計途中の値をゼロとして扱いません。",
    setup: "新規メンバーの活動を確認する",
    connect: "Discord を接続",
    activation: "設定した活動を確認したメンバー",
    onboarding: "歓迎フロー（任意）",
    measuring: "測定を開始",
    complete: "完了",
    todo: "次のステップ",
    communityOpportunity: "確認したい傾向",
    measurementWarning: "データ取得状況",
    suggested: "推奨アクション",
    range: "期間",
    retention: "参加した時期別",
    members: "メンバー",
    reply: "初回返信の分布",
    trendActivation: "設定した最初の活動の推移",
    trendConnection: "最初の交流推移",
    trendRetention: "参加後7〜8日目に活動した人の推移",
    noOpportunity:
      "まだ比較できる傾向はありません。下から改善策を選ぶこともできます。",
    notCausal: "観測された変化ですが、原因はまだ分かっていません。",
    createAction: "改善策を選ぶ",
    template: "改善メニュー",
    destination: "送信先チャンネル",
    event: "予定イベント",
    recommendedChannels: "推奨チャンネル",
    review: "有効にする",
    publish: "有効にする",
    published: "公開し、有効化しました。",
    when: "始まるきっかけ",
    wait: "待つ時間",
    if: "送信前の確認",
    then: "行うこと",
    safety: "スタッフの確認",
    activeActions: "有効な改善策",
    delivery: "配信の健全性",
    noActions:
      "有効なアクションはありません。安全設定済みテンプレートから開始できます。",
    learning: "わかったこと",
    hypothesis: "検証する問い",
    maturity: "評価済み",
    noResults: "結果はまだありません。改善策を有効にして効果を確認できます。",
    privacy: "プライバシーと保持期間",
    team: "チームとアクセス",
    plan: "プランと利用状況",
    advanced: "測定方法を見る",
    configureActivation: "このプリセットを使う",
    draftReady: "選択を確認して測定を開始してください。",
    language: "言語",
    unavailable: "利用不可",
    healthy: "良好",
    partial: "一部",
    provisional: "集計中",
    mature: "集計完了",
    eligible: "対象",
    observed: "観測",
    control: "通常運用",
    treatment: "改善あり",
    rate: "割合",
    triggered: "起動",
    approved: "承認済み",
    delivered: "配信済み",
    failed: "失敗",
    unknown: "不明",
    suppressed: "抑制",
    seeEvidence: "根拠を見る",
    dismiss: "今は非表示",
    why: "表示された理由",
    createFromOpportunity: "改善する",
    viewOpportunities: "改善を見る",
    testAction: "効果を確認",
    viewActivity: "アクティビティを見る",
    approve: "承認",
    approvalNeeded: "承認が必要",
    question: "この改善策は新規メンバーに役立ったか？",
    primaryOutcome: "NEXUS が確認すること",
    assignment: "比較方法",
    dailyBlocks: "日ごとに試す",
    reviewTest: "効果を確認",
    startTest: "改善テストを始める",
    pauseTest: "テストを一時停止",
    stopTest: "テストを停止",
    viewAction: "改善策を見る",
    continueCollecting: "データ収集を続ける",
    recommendedSetup: "推奨設定を使う",
    optionsUnavailable:
      "Discord の選択肢を取得できません。セットアップを更新するか Discord パネルを使用してください。",
    loading: "検証済みデータを読み込み中…",
    current: "現在",
    baseline: "基準値",
    difference: "差分",
    sample: "サンプル",
    coverage: "データ取得状況",
    stage: "新規メンバーの到達点",
    guardrails: "安全確認",
    randomization: "比較方法",
    timeline: "期間",
    refresh: "更新",
    next: "次へ",
  },
} as const;
export type Copy = {
  [K in keyof typeof messages.en]: K extends "nav" ? readonly string[] : string;
};
export const opportunityNames: Record<Locale, Record<string, string>> = {
  en: {
    ACTIVATION_DROP: "Fewer newcomers are reaching first value",
    TTFV_SPIKE: "Newcomers take longer to reach first value",
    CONNECTION_DROP: "Fewer newcomers receive a first reply",
    REPLY_LATENCY_SPIKE: "First replies are taking longer",
    ONBOARDING_DROP: "Onboarding completion has dropped",
    HOME_ACTION_DROP: "Home Actions completion has dropped",
    RETENTION_DROP: "Fewer members are active after a week",
    DATA_COVERAGE_DROP: "Some data could not be collected",
    ACTION_FAILURE_SPIKE: "Action delivery failures increased",
  },
  ja: {
    ACTIVATION_DROP: "初回価値に到達する新規メンバーが減少",
    TTFV_SPIKE: "初回価値までの時間が長期化",
    CONNECTION_DROP: "最初の返信を受ける新規メンバーが減少",
    REPLY_LATENCY_SPIKE: "最初の返信までの時間が長期化",
    ONBOARDING_DROP: "オンボーディング完了率が低下",
    HOME_ACTION_DROP: "ホームアクション完了率が低下",
    RETENTION_DROP: "参加後7〜8日目に活動した割合が低下",
    DATA_COVERAGE_DROP: "一部のデータを取得できていません",
    ACTION_FAILURE_SPIKE: "アクション配信失敗が増加",
  },
};

// Shared product copy used by the Web dashboard.
export const webEn = {
  "web.the_selected_channel": "the selected channel",
  "web.nexus_cannot_send_messages_in_value":
    "NEXUS cannot send messages in {a}. Choose another channel or check View and Send permissions.",
  "web.that_event_is_no_longer_available":
    "That event is no longer available. Choose another event.",
  "web.this_improvement_is_not_available_on":
    "This improvement is not available on the current plan. Check your plan.",
  "web.settings_changed_refresh_the_page_and":
    "Settings changed. Refresh the page and try again.",
  "web.the_change_could_not_be_saved":
    "The change could not be saved. Check the connection and try again.",
  "web.improvement_enabled": "Improvement enabled.",
  "web.test_notification_sent_it_is_excluded":
    "Test notification sent. It is excluded from all results.",
  "web.notification_destination_saved": "Notification destination saved.",
  "web.data_retention_setting_saved": "Data storage period saved.",
  "web.weekly_summary_saved": "Weekly summary saved.",
  "web.helper_alert_settings_saved": "Helper alert settings saved.",
  "web.community_focus_saved": "Community focus saved.",
  "web.result_check_started": "Result check started.",
  "web.action_approved": "Action approved.",
  "web.collecting_normally": "Collecting normally",
  "web.some_data_could_not_be_collected": "Some data could not be collected",
  "web.not_enough_verified_data_is_available":
    "Not enough verified data is available",
  "web.collecting": "Collecting",
  "web.data_limited": "Data limited",
  "web.no_data_yet": "No data yet",
  "web.understand_community_health_and_decide_what":
    "Understand community health and decide what to do next.",
  "web.joined_value_value_value_members_have":
    "Joined {a}–{b}; {c} members have {d} days of follow-up.",
  "web.today_s_staff_check_value_posts":
    "Today’s staff check: {a} posts await a reply. Yesterday {b} joined and {c} connected.",
  "web.how_new_members_are_participating": "How new members are participating",
  "web.the_largest_observed_drop_is_between":
    "The largest observed drop is between {a} and {b}. This may be worth improving.",
  "web.there_is_not_enough_observed_data":
    "There is not enough observed data to compare yet.",
  "web.see_details": "See details",
  "web.review_each_newcomer_milestone_each_percentage":
    "Review each newcomer milestone. Each percentage uses the members with enough time to reach it.",
  "web.where_newcomers_started": "Where newcomers started",
  "web.channel": "Channel",
  "web.first_messages": "First messages",
  "web.first_replies": "First replies",
  "web.first_successes": "Configured first activities",
  "web.later_success": "Configured activity completed",
  "web.channel_no_longer_available": "Channel no longer available",
  "web.collecting_enough_activity_to_show_channels":
    "Collecting enough activity to show channels safely.",
  "web.channels_with_very_few_observations_are":
    "Channels with very few observations are hidden. Configured activity completed is an association, not proof that a channel caused it.",
  "web.activity_patterns": "ACTIVITY PATTERNS",
  "web.see_what_needs_attention_and_which":
    "See what needs attention and which improvement NEXUS suggests.",
  "web.critical": "Critical",
  "web.attention": "Attention",
  "web.value_newcomers_evaluated": "{a} newcomers evaluated",
  "web.suggested_improvement": "Suggested improvement",
  "web.the_deterministic_change_threshold_was_met":
    "The deterministic change threshold was met.",
  "web.reason_for_dismissal_optional": "Reason for dismissal (optional)",
  "web.not_relevant": "Not relevant",
  "web.already_handled": "Already handled",
  "web.later": "Later",
  "web.choose_what_would_help_your_newcomers":
    "Choose what would help your newcomers. Select a destination before enabling.",
  "web.improvement_preview": "Improvement preview",
  "web.when_enabled": "When enabled",
  "web.staff_reviews": "staff reviews",
  "web.suggestion_only": "suggestion only",
  "web.runs_automatically": "runs automatically",
  "web.change_settings": "Change settings",
  "web.how_to_run": "How to run",
  "web.suggest_only": "Suggest only",
  "web.confirm_before_running": "Confirm before running",
  "web.run_automatically": "Run automatically",
  "web.check_setup": "Check setup",
  "web.send_test_notification": "Send test notification",
  "web.ready": "Ready",
  "web.permission_needed_give_nexus_view_channel":
    "Permission needed. Give NEXUS View Channel and Send Messages in the selected channels.",
  "web.unavailable_check_the_selected_destination_or":
    "Unavailable. Check the selected destination or event.",
  "web.test_sent": "Test sent",
  "web.live": "LIVE",
  "web.view_settings": "View settings",
  "web.measure_what_worked": "MEASURE WHAT WORKED",
  "web.compare_usual_operation_with_the_improvement":
    "Compare usual operation with the improvement enabled.",
  "web.before_and_after_this_improvement": "Before and after this improvement",
  "web.before": "Before",
  "web.newcomers": "newcomers",
  "web.after": "After",
  "web.still_collecting_counts_and_trends_will":
    "Still collecting. Counts and trends will appear when enough time has passed.",
  "web.observed_difference_value": "Observed difference: {a}",
  "web.other_factors_may_have_affected_this":
    "Other factors may have affected this difference.",
  "web.check_more_accurately": "Check more accurately",
  "web.a_more_rigorous_check_can_become":
    "A more rigorous check can become available as activity grows.",
  "web.does_value_help_newcomers": "Does {a} help newcomers?",
  "web.does_the_improvement_help_value_compared":
    "Does the improvement help {a} compared with usual operation?",
  "web.still_collecting": "Still collecting",
  "web.by_member": "By member",
  "web.days": "days",
  "web.all_mature_assignments_are_analyzed_including":
    "All completed observation periods are analyzed, including failed and uncertain deliveries.",
  "web.spillover_and_carryover_across_time_blocks":
    "Spillover and carryover across time blocks may affect the estimate.",
  "web.95_interval": "95% interval",
  "web.p_value_better": "P({a} better)",
  "web.community_configuration": "COMMUNITY CONFIGURATION",
  "web.manage_language_notifications_discord_and_data":
    "Manage language, notifications, Discord and data.",
  "web.channels_to_analyze": "Channels to analyze",
  "web.the_default_is_the_whole_server":
    "The default is the whole server. Exclude staff channels where needed.",
  "web.select_likely_staff_or_log_channels":
    "Select likely staff or log channels",
  "web.whole_server": "Whole server",
  "web.selected_channels_only": "Selected channels only",
  "web.exclude_selected_channels": "Exclude selected channels",
  "web.staff_roles_excluded_from_comparison":
    "Staff roles excluded from comparison",
  "web.analysis_scope_saved": "Analysis scope saved.",
  "web.save_changes": "Save changes",
  "web.general": "General",
  "web.discord_panel_language_is_managed_from":
    "Discord panel language is managed from Settings in Discord.",
  "web.staff_notification_destination": "Staff notification destination",
  "web.connected_permissions_are_checked_again_before":
    "Connected. Permissions are checked again before enabling an improvement.",
  "web.check_the_connection": "Check the connection.",
  "web.community_focus": "Community focus",
  "web.you_can_change_these_goals_later":
    "You can change these goals later. NEXUS does not analyze message text.",
  "web.community_type": "Community type",
  "web.no_preset": "No preset",
  "web.multiplayer_co_op": "Multiplayer / Co-op",
  "web.early_access": "Early Access",
  "web.live_service": "Live service",
  "web.suggested_lfg_voice_events": "Suggested: LFG, Voice, events",
  "web.suggested_feedback_playtests_bug_reports":
    "Suggested: feedback, playtests, bug reports",
  "web.suggested_events_lfg_voice_discussion":
    "Suggested: events, LFG, Voice, discussion",
  "web.add_an_important_channel": "Add an important channel",
  "web.choose_a_channel": "Choose a channel",
  "web.lfg": "LFG",
  "web.feedback": "Feedback",
  "web.bug_reports": "Bug reports",
  "web.playtests": "Playtests",
  "web.discussion": "Discussion",
  "web.remove": "Remove",
  "web.save_focus": "Save focus",
  "web.weekly_summary": "Weekly summary",
  "web.send_to_staff_each_week": "Send to staff each week",
  "web.destination": "Destination",
  "web.save_schedule": "Save schedule",
  "web.a_short_update_with_newcomer_progress":
    "A short update with newcomer progress, one issue, and one improvement.",
  "web.helper_alerts": "Helper alerts",
  "web.alert_staff_when_no_direct_reply":
    "Alert staff when no direct reply to a new member’s post can be confirmed. NEXUS sends at most six alerts a day.",
  "web.enable_alerts": "Enable alerts",
  "web.destination_2": "Destination",
  "web.role_to_notify_optional": "Role to notify (optional)",
  "web.no_role_ping": "No role ping",
  "web.notify_after": "Notify after",
  "web.min": "min",
  "web.save_settings": "Save settings",
  "web.data": "Data",
  "web.keep_detailed_data_for": "Keep detailed data for",
  "web.7_days": "7 days",
  "web.14_days": "14 days",
  "web.30_days": "30 days",
  "web.aggregate_data_value_months": "Aggregate data: {a} months",
  "web.message_contents_attachments_dms_and_presence":
    "Message contents, attachments, DMs and presence are not stored.",
  "web.to_delete_data_open_nexus_privacy":
    "To delete data, open /nexus privacy in Discord.",
  "web.advanced": "Advanced",
  "web.view_plan_and_administration": "View plan and administration",
  "web.administration_requires_manage_guild_permission":
    "Administration requires Manage Guild permission.",
  "web.setting_changes": "Setting changes",
  "web.en_us": "en-US",
  "web.analysis_range_changed": "Analysis range changed",
  "web.weekly_summary_changed": "Weekly summary changed",
  "web.settings_changed": "Settings changed",
  "web.web_admin": "Web admin",
  "web.administrator": "Administrator",
  "web.no_setting_changes_yet": "No setting changes yet.",
  "web.community_activity": "Community activity",
  "web.continuing_members": "Continuing members",
  "web.no_recent_observed_activity": "No recent observed activity",
  "web.staff_excluded_from_comparison": "Staff excluded from comparison",
  "web.compare_participation": "Compare participation",
  "web.new_members_waited_value_minutes_on":
    "New members waited {a} minutes on average for a reply; continuing members waited {b} minutes.",
  "web.received_a_reply_new_value_continuing":
    "Received a reply: new {a}%, continuing {b}%",
  "web.active_days_new_value_continuing_value":
    "Active days: new {a}, continuing {b}",
  "web.there_is_not_enough_data_to": "There is not enough data to compare yet.",
  "web.what_happened_after_joining": "What happened after joining",
  "web.distinct_people_interacted_with_in_the":
    "Distinct people interacted with in the first three days: {a} on average among members active later, versus {b} among those without later observed activity. This comparison does not establish cause.",
  "web.observed_a_week_later_value_not":
    "Active in the configured period: {a}; not observed: {b}; measuring: {c}; unavailable observations: {d}.",
  "web.value_of_continuing_newcomers_received_a":
    "{a}% of new members with later activity received a reply, versus {b}% of those without later observed activity. This is an association, not proof of cause.",
  "web.channels_used_new_value_continuing_value":
    "Channels used: new {a}, continuing {b}. Voice: {c} vs {d}. Event actions: {e} vs {f}.",
  "web.first_three_days_those_observed_later":
    "First three days: those observed later had Voice {a} and event actions {b}; those without later observed activity had Voice {c} and event actions {d}.",
  "web.channels_used_by_new_members": "Channels used by new members",
  "web.value_new_members_value_received_a":
    "{a} new members · {b} received a reply · {c} active elsewhere · {d} active in the configured period",
  "web.no_channels_can_be_shown_yet":
    "No channels can be shown yet. Small groups are hidden.",
  "web.server": "Server",
  "web.production": "Production",
  "web.sign_out": "Sign out",
  "web.uses_only_the_activity_data_needed":
    "Uses only the activity data needed here · Missing data is not zero",
  "web.guided_setup": "GUIDED SETUP",
  "web.basic_measurement_is_already_running":
    "Basic measurement is already running.",
  "web.checking_the_connection_nexus_records_what":
    "Checking the connection. NEXUS records what it can already observe.",
  "web.what_should_a_successful_newcomer_do":
    "Which first activity should NEXUS observe?",
  "web.receive_a_reply": "First reply to a post",
  "web.send_a_first_message": "Send a first message",
  "web.join_an_event": "Sign up for an event",
  "web.save_success_goal": "Save first activity",
  "web.discord_onboarding_is_already_in_use":
    "Discord onboarding is already in use. NEXUS will observe it without changing it.",
  "web.discord_onboarding_is_not_currently_in":
    "Discord onboarding is not currently in use. You can add a welcome flow later.",
  "web.confirm_your_first_success": "Confirm your first activity",
  "web.value_contacts_week": "{a} contacts/week",
  "web.immediately": "Immediately",
  "web.value_days": "{a} days",
  "web.value_hours": "{a} hours",
  "web.stopped": "Stopped",
  "web.testPaused": "Test paused.",
  "web.testStopped": "Test stopped.",
  "web.paused": "Paused",
} as const;
export const webJa = {
  "web.the_selected_channel": "選択したチャンネル",
  "web.nexus_cannot_send_messages_in_value":
    "NEXUS は {a} に送信できません。別のチャンネルを選ぶか、表示・送信権限を確認してください。",
  "web.that_event_is_no_longer_available":
    "イベントが見つかりません。現在利用できるイベントを選び直してください。",
  "web.this_improvement_is_not_available_on":
    "この改善策は現在のプランでは使えません。プランを確認してください。",
  "web.settings_changed_refresh_the_page_and":
    "設定が更新されました。ページを再読み込みしてやり直してください。",
  "web.the_change_could_not_be_saved":
    "変更を保存できませんでした。接続を確認して再試行してください。",
  "web.improvement_enabled": "改善策を有効にしました。",
  "web.test_notification_sent_it_is_excluded":
    "テスト通知を送信しました。集計には含まれません。",
  "web.notification_destination_saved": "通知先を保存しました。",
  "web.data_retention_setting_saved": "保持期間を保存しました。",
  "web.weekly_summary_saved": "週間サマリーを保存しました。",
  "web.helper_alert_settings_saved": "返信通知の設定を保存しました。",
  "web.community_focus_saved": "重点にする参加場所を保存しました。",
  "web.result_check_started": "効果の確認を開始しました。",
  "web.action_approved": "アクションを承認しました。",
  "web.collecting_normally": "正常",
  "web.some_data_could_not_be_collected": "一部取得できていません",
  "web.not_enough_verified_data_is_available":
    "まだ利用できるデータがありません",
  "web.collecting": "正常",
  "web.data_limited": "一部欠損",
  "web.no_data_yet": "データ待ち",
  "web.understand_community_health_and_decide_what":
    "コミュニティの状態を確認し、次に対応すべきことを判断します。",
  "web.joined_value_value_value_members_have":
    "分析対象の参加期間: {a}〜{b}。その後{c}日間を確認できた人: {d}人。",
  "web.today_s_staff_check_value_posts":
    "今日見ること: 返信待ち {a} 件。昨日参加 {b} 人、交流あり {c} 人。",
  "web.how_new_members_are_participating": "新しく入った人の流れ",
  "web.the_largest_observed_drop_is_between":
    "最も多くの人が次に進んでいない段階: {a} → {b}。改善できる可能性があります。",
  "web.there_is_not_enough_observed_data":
    "まだ比較できるだけの観測データがありません。",
  "web.see_details": "詳しく見る",
  "web.review_each_newcomer_milestone_each_percentage":
    "互換性のある母集団ごとに、参加後の主要な到達点を確認します。段階間の換算率ではありません。",
  "web.where_newcomers_started": "新規メンバーが活動したチャンネル",
  "web.channel": "チャンネル",
  "web.first_messages": "最初の投稿",
  "web.first_replies": "最初の返信",
  "web.first_successes": "設定した最初の活動",
  "web.later_success": "設定した活動の達成",
  "web.channel_no_longer_available": "現在は利用できないチャンネル",
  "web.collecting_enough_activity_to_show_channels":
    "チャンネル別に表示できる件数を収集中です。",
  "web.channels_with_very_few_observations_are":
    "少数のチャンネルは非表示です。設定した活動の達成は関係を示すもので、チャンネルが原因とは限りません。",
  "web.activity_patterns": "活動の傾向",
  "web.see_what_needs_attention_and_which":
    "今見るべきことと、NEXUS が提案する改善策を確認できます。",
  "web.critical": "重大",
  "web.attention": "注意",
  "web.value_newcomers_evaluated": "{a} 人の新規メンバーを評価",
  "web.suggested_improvement": "提案する改善策",
  "web.the_deterministic_change_threshold_was_met":
    "決定論的な変化基準を満たしました。",
  "web.reason_for_dismissal_optional": "非表示にする理由（任意）",
  "web.not_relevant": "関係ない",
  "web.already_handled": "対応済み",
  "web.later": "後で",
  "web.choose_what_would_help_your_newcomers":
    "必要な改善策を選んでください。送信先は有効化する前に確認します。",
  "web.improvement_preview": "改善策の流れ",
  "web.when_enabled": "有効にすると",
  "web.staff_reviews": "スタッフが確認",
  "web.suggestion_only": "提案のみ",
  "web.runs_automatically": "自動で実行",
  "web.change_settings": "設定を変更",
  "web.how_to_run": "実行方法",
  "web.suggest_only": "提案だけ",
  "web.confirm_before_running": "確認してから実行",
  "web.run_automatically": "自動で実行",
  "web.check_setup": "設定を確認",
  "web.send_test_notification": "テスト通知を送る",
  "web.ready": "準備完了",
  "web.permission_needed_give_nexus_view_channel":
    "権限が必要です。選択したチャンネルで NEXUS に表示・送信権限を与えてください。",
  "web.unavailable_check_the_selected_destination_or":
    "利用できません。選択内容を確認してください。",
  "web.test_sent": "テスト送信済み",
  "web.live": "稼働中",
  "web.view_settings": "設定を見る",
  "web.measure_what_worked": "効果を測定",
  "web.compare_usual_operation_with_the_improvement":
    "通常運用と改善ありを比較し、次の判断につなげます。",
  "web.before_and_after_this_improvement": "改善の前後を比較",
  "web.before": "改善前",
  "web.newcomers": "人",
  "web.after": "改善後",
  "web.still_collecting_counts_and_trends_will":
    "結果を収集中です。現在の人数と変化を確認できます。",
  "web.observed_difference_value": "観測された差: {a}",
  "web.other_factors_may_have_affected_this":
    "この差には他の要因も影響した可能性があります。",
  "web.check_more_accurately": "より正確に確認",
  "web.a_more_rigorous_check_can_become":
    "より正確な確認は、活動が増えると利用できます。",
  "web.does_value_help_newcomers": "{a} は新規メンバーに役立つか？",
  "web.does_the_improvement_help_value_compared":
    "改善ありは通常運用より {a} を改善するか？",
  "web.still_collecting": "集計中",
  "web.by_member": "メンバー単位",
  "web.days": "日",
  "web.all_mature_assignments_are_analyzed_including":
    "結果を確認できる全メンバーを、配信失敗・不明を含めて集計します。",
  "web.spillover_and_carryover_across_time_blocks":
    "時間ブロック間の波及や持ち越しが推定に影響する可能性があります。",
  "web.95_interval": "95% 区間",
  "web.p_value_better": "P({a} が優位)",
  "web.community_configuration": "コミュニティ設定",
  "web.manage_language_notifications_discord_and_data":
    "言語、通知先、Discord、データを管理します。",
  "web.channels_to_analyze": "分析するチャンネル",
  "web.the_default_is_the_whole_server":
    "初期設定はサーバー全体です。スタッフ用チャンネルなどは必要に応じて除外してください。",
  "web.select_likely_staff_or_log_channels":
    "スタッフ・ログ用らしいチャンネルを選択",
  "web.whole_server": "サーバー全体",
  "web.selected_channels_only": "選んだチャンネルだけ",
  "web.exclude_selected_channels": "選んだチャンネルを除外",
  "web.staff_roles_excluded_from_comparison":
    "比較から除外するスタッフのロール",
  "web.analysis_scope_saved": "分析するチャンネルを保存しました。",
  "web.save_changes": "変更を保存",
  "web.general": "一般",
  "web.discord_panel_language_is_managed_from":
    "Discord パネルの言語は Discord 内の設定で管理します。",
  "web.staff_notification_destination": "スタッフの通知先",
  "web.connected_permissions_are_checked_again_before":
    "接続済み。改善策を有効にする前に権限を再確認します。",
  "web.check_the_connection": "接続を確認してください。",
  "web.community_focus": "コミュニティの重点",
  "web.you_can_change_these_goals_later":
    "目標は後から変更できます。メッセージ本文は解析しません。",
  "web.community_type": "運営スタイル",
  "web.no_preset": "選ばない",
  "web.multiplayer_co_op": "協力・対戦ゲーム",
  "web.early_access": "早期アクセス",
  "web.live_service": "継続運営ゲーム",
  "web.suggested_lfg_voice_events": "候補: 仲間探し、Voice、イベント",
  "web.suggested_feedback_playtests_bug_reports":
    "候補: 意見、試遊、不具合報告",
  "web.suggested_events_lfg_voice_discussion":
    "候補: イベント、仲間探し、Voice、交流",
  "web.add_an_important_channel": "重要な参加場所を追加",
  "web.choose_a_channel": "チャンネルを選ぶ",
  "web.lfg": "仲間探し",
  "web.feedback": "意見・感想",
  "web.bug_reports": "不具合報告",
  "web.playtests": "試遊",
  "web.discussion": "交流",
  "web.remove": "外す",
  "web.save_focus": "重点を保存",
  "web.weekly_summary": "週間サマリー",
  "web.send_to_staff_each_week": "毎週スタッフに送る",
  "web.destination": "送信先",
  "web.save_schedule": "送信予定を保存",
  "web.a_short_update_with_newcomer_progress":
    "新規メンバーの状況、ひとつの問題、ひとつの改善策を簡潔にお知らせします。",
  "web.helper_alerts": "返信を手伝う人への通知",
  "web.alert_staff_when_no_direct_reply":
    "新しいメンバーの投稿に直接の返信が確認できないとき、指定したチャンネルへ知らせます。1日最大6件です。",
  "web.enable_alerts": "通知を有効にする",
  "web.destination_2": "通知先",
  "web.role_to_notify_optional": "通知するロール（任意）",
  "web.no_role_ping": "ロールへの通知なし",
  "web.notify_after": "返信待ちと判断する時間",
  "web.min": "分",
  "web.save_settings": "設定を保存",
  "web.data": "データ",
  "web.keep_detailed_data_for": "詳細データを保存する期間",
  "web.7_days": "7日",
  "web.14_days": "14日",
  "web.30_days": "30日",
  "web.aggregate_data_value_months": "集計データ: {a} か月",
  "web.message_contents_attachments_dms_and_presence":
    "メッセージ本文、添付、DM、プレゼンスは保存しません。",
  "web.to_delete_data_open_nexus_privacy":
    "データを削除するには Discord で /nexus privacy を開いてください。",
  "web.advanced": "詳細設定",
  "web.view_plan_and_administration": "プランと管理情報を見る",
  "web.administration_requires_manage_guild_permission":
    "管理にはサーバー管理権限が必要です。",
  "web.setting_changes": "設定変更の記録",
  "web.en_us": "ja-JP",
  "web.analysis_range_changed": "分析するチャンネルを変更",
  "web.weekly_summary_changed": "週次まとめを変更",
  "web.settings_changed": "設定を変更",
  "web.web_admin": "Web管理者",
  "web.administrator": "管理者",
  "web.no_setting_changes_yet": "変更履歴はまだありません。",
  "web.community_activity": "最近の活動日数が基準以上のメンバーの状態",
  "web.continuing_members": "継続して参加している人",
  "web.no_recent_observed_activity": "最近の活動日数が基準未満のメンバー",
  "web.staff_excluded_from_comparison": "比較から除外したスタッフ",
  "web.compare_participation": "新しい人との違い",
  "web.new_members_waited_value_minutes_on":
    "新しいメンバーは返信まで平均 {a} 分、継続して参加している人は平均 {b} 分です。",
  "web.received_a_reply_new_value_continuing":
    "返信を受けた人: 新しい人 {a}%、継続している人 {b}%",
  "web.active_days_new_value_continuing_value":
    "活動した日数: 新しい人 {a} 日、継続している人 {b} 日",
  "web.there_is_not_enough_data_to": "まだ比較できるだけのデータがありません。",
  "web.what_happened_after_joining": "参加後の結果",
  "web.distinct_people_interacted_with_in_the":
    "最初の3日間に交流した異なる人数: その後も活動した人は平均 {a} 人、活動を確認できなかった人は平均 {b} 人。関連を示す比較であり、原因とは断定できません。",
  "web.observed_a_week_later_value_not":
    "設定した期間に活動を確認できた {a} 人、確認できなかった {b} 人、測定中 {c} 人、データ不足 {d} 人。",
  "web.value_of_continuing_newcomers_received_a":
    "継続した人は {a}% が返信を受け、継続しなかった人は {b}% でした。関連が見られますが、原因とは断定できません。",
  "web.channels_used_new_value_continuing_value":
    "活動したチャンネル: 新しい人 平均 {a}、継続している人 平均 {b}。Voice参加: {c} と {d}。イベント操作: {e} と {f}。",
  "web.first_three_days_those_observed_later":
    "継続した人の最初の3日間: Voice {a}、イベント操作 {b}。継続しなかった人: Voice {c}、イベント操作 {d}。",
  "web.channels_used_by_new_members": "チャンネルごとの役割",
  "web.value_new_members_value_received_a":
    "新しいメンバー {a} 人 · 返信を受けた {b} · 他のチャンネルでも活動 {c} · 設定した期間の活動 {d}",
  "web.no_channels_can_be_shown_yet":
    "表示できるチャンネルはまだありません。少人数の詳細は表示しません。",
  "web.server": "サーバー",
  "web.production": "本番",
  "web.sign_out": "サインアウト",
  "web.uses_only_the_activity_data_needed":
    "必要な活動データだけを使用します · 欠損データをゼロにしません",
  "web.guided_setup": "ガイド付きセットアップ",
  "web.basic_measurement_is_already_running":
    "基本的な測定はすでに始まっています。",
  "web.checking_the_connection_nexus_records_what":
    "接続を確認中です。測定できる項目から記録します。",
  "web.what_should_a_successful_newcomer_do":
    "新規メンバーのどの活動を確認しますか？",
  "web.receive_a_reply": "投稿に初めて返信がつく",
  "web.send_a_first_message": "最初のメッセージを送る",
  "web.join_an_event": "イベントへの参加を登録する",
  "web.save_success_goal": "活動の設定を保存",
  "web.discord_onboarding_is_already_in_use":
    "Discord のオンボーディングを使用中です。NEXUS は変更せずに観測します。",
  "web.discord_onboarding_is_not_currently_in":
    "Discord のオンボーディングは現在使われていません。歓迎フローは後で追加できます。",
  "web.confirm_your_first_success": "選んだ活動を確認",
  "web.value_contacts_week": "週 {a} 回まで",
  "web.immediately": "すぐに",
  "web.value_days": "{a}日",
  "web.value_hours": "{a}時間",
  "web.stopped": "停止済み",
  "web.testPaused": "テストを一時停止しました。",
  "web.testStopped": "テストを停止しました。",
  "web.paused": "一時停止",
} satisfies Record<keyof typeof webEn, string>;

export function semantic(value: string, locale: Locale) {
  const en: Record<string, string> = {
    "member.joined": "A newcomer joins",
    "message.sent": "A newcomer sends their first message",
    not_connected: "No direct reply has been confirmed yet",
    not_activated: "They have not reached first value",
    all_eligible: "They remain eligible",
    staff_alert: "Alert the community team",
    send_dm: "Send one follow-up DM",
    recommend_channels: "Recommend selected channels",
    recommend_event: "Recommend the selected event",
    channel_message: "Post a guarded channel message",
    assign_role: "Assign a NEXUS-owned role",
    remove_role: "Remove a NEXUS-owned role",
    suggest: "Suggestion; approval required",
    approval: "Approval required",
    auto: "Automatic after safety checks",
  };
  const ja: Record<string, string> = {
    "member.joined": "新規メンバーが参加",
    "message.sent": "新規メンバーが最初のメッセージを送信",
    not_connected: "直接の返信をまだ確認できない",
    not_activated: "初回価値にまだ到達していない",
    all_eligible: "対象条件を満たしている",
    staff_alert: "コミュニティ担当へ通知",
    send_dm: "フォローアップ DM を1件送信",
    recommend_channels: "選択したチャンネルを推薦",
    recommend_event: "選択したイベントを推薦",
    channel_message: "安全確認済みのチャンネル投稿を送信",
    assign_role: "NEXUS 管理ロールを付与",
    remove_role: "NEXUS 管理ロールを解除",
    suggest: "提案のみ・承認が必要",
    approval: "承認が必要",
    auto: "安全確認後に自動実行",
  };
  return (locale === "ja" ? ja : en)[value] ?? value;
}

export function replyLabels(locale: Locale) {
  return locale === "ja"
    ? {
        under_5m: "5分未満",
        "5m_1h": "5分〜1時間",
        "1h_6h": "1〜6時間",
        "6h_24h": "6〜24時間",
        unanswered_24h: "24時間以内の直接返信を確認できない",
      }
    : {
        under_5m: "Under 5m",
        "5m_1h": "5m–1h",
        "1h_6h": "1–6h",
        "6h_24h": "6–24h",
        unanswered_24h: "No confirmed direct reply in 24h",
      };
}

export function metricLabel(metric: string, locale: Locale) {
  const labels = {
    en: {
      activation: "members with the configured first activity",
      connection: "first replies",
      retention: "Activity after the configured window",
    },
    ja: {
      activation: "設定した活動",
      connection: "最初の返信",
      retention: "設定期間後の活動",
    },
  };
  return labels[locale][metric as keyof typeof labels.en] ?? metric;
}

export function learning(
  evidence: ResultsPresentation["items"][number]["evidence"],
  locale: Locale,
) {
  const en = {
    supported:
      "Current results support this improvement. Keep checking as more data arrives.",
    directional:
      "A positive trend is appearing. Continue collecting before deciding.",
    inconclusive: "No clear difference yet. Continue collecting.",
    insufficient: "Not enough data yet. Continue collecting.",
    guardrail:
      "NEXUS stopped this check for safety. Review the improvement before continuing.",
  };
  const ja = {
    supported:
      "現在の結果は改善を支持しています。データが増えても確認を続けてください。",
    directional: "良い傾向があります。判断まで集計を続けてください。",
    inconclusive: "はっきりした差はありません。集計を続けてください。",
    insufficient: "まだ判断できません。集計を続けてください。",
    guardrail: "安全のため停止しました。再開前に改善策を確認してください。",
  };
  return (locale === "ja" ? ja : en)[evidence];
}

export const evidenceNames = {
  en: {
    supported: "Current results support the improvement",
    directional: "A positive trend is appearing",
    inconclusive: "No clear difference yet",
    insufficient: "Not enough data yet",
    guardrail: "Stopped for safety",
  },
  ja: {
    supported: "現在の結果は改善を支持しています",
    directional: "良い傾向が見えています",
    inconclusive: "はっきりした差はありません",
    insufficient: "まだ判断できません",
    guardrail: "安全のため停止しました",
  },
} as const;
