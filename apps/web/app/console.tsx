"use client";
import { useState } from "react";
import type {CommunityService} from '../../../packages/presentation/src/community';
import type {
  ActionsPresentation,
  ActionTemplateKey,
  DiscordOptions,
  HomePresentation,
  JourneyPresentation,
  OpportunitiesPresentation,
  ResultsPresentation,
} from "../../../packages/presentation/src/types";
import {
  CohortHeatmap,
  DeliveryFunnelChart,
  ExperimentComparison,
  JourneyFunnel,
  MetricCard,
  ResponseDistributionChart,
  TrendChart,
} from "./charts";

type Locale = "en" | "ja";
const stageNamesEn:Record<string,string>={joined:'joining',activated:'first activity',connected:'connecting with someone',repeated:'another day of activity',retained:'activity one week later'};
const wholePercent=(n:number|null)=>n===null?'—':`${n}%`;
type Preview = {
  before: { id: string } | null;
  after: { id: string; version: number };
  confirmationHash: string;
};
type Admin = {
  settings: Record<string, unknown>;
  usage: {
    plan: string;
    used: number;
    included: number | null;
    projected: number;
  };
  capability: Record<string, unknown> | null;
};
export type ProductData = {
  home: HomePresentation | null;
  journey: JourneyPresentation | null;
  community: Awaited<ReturnType<CommunityService['overview']>> | null;
  opportunities: OpportunitiesPresentation | null;
  actions: ActionsPresentation | null;
  results: ResultsPresentation | null;
  weeklyStatus:{state:string;status_note:string|null;attempted_at:string}|null;
  audit:{at:string;action:string;source:string;actorId:string|null;changed:string[]}[];
  options: DiscordOptions;
  admin: Admin | null;
  guilds?:{id:string;name:string}[];
  selectedGuildId?:string;
};
const messages = {
  en: {
    nav: ["Overview", "New Members", "Improve", "Results", "Settings", "Community", "Compare", "Channels"],
    tagline: "See where newcomers drop off. Fix it. Measure what worked.",
    home: "Overview",
    journey: "New Members",
    milestones: "Newcomer milestones",
    opportunities: "Improve",
    actions: "Improvement menu",
    results: "Results",
    settings: "Settings",
    new_members: "New Members",
    activation_rate: "Successful newcomers",
    direct_reply_connection_rate: "Received a reply",
    d7_active_retention: "Active after 7 days",
    joined: "Joined",
    onboarded: "Completed joining steps",
    first_value: "Reached first success",
    connected: "Received a reply",
    d7_active: "Active after 7 days",
    previous: "Previous period",
    data: "Data collection status",
    empty: "No verified observations yet",
    emptyDetail:
      "NEXUS will show this view after scoped production activity is observed. Missing and immature observations are never treated as zero.",
    setup: "Start measuring community growth",
    connect: "Connect Discord",
    activation: "Successful newcomers",
    onboarding: "Welcome flow (optional)",
    measuring: "Start measuring",
    complete: "Complete",
    todo: "Next step",
    communityOpportunity: "Needs attention",
    measurementWarning: "Data collection status",
    suggested: "Suggested next action",
    range: "Range",
    retention: "By join period",
    members: "Members",
    reply: "First reply distribution",
    trendActivation: "First success trend",
    trendConnection: "First Connection trend",
    trendRetention: "Activity one week after joining",
    noOpportunity: "Nothing needs attention right now. You can still choose an improvement below.",
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
    nav: ["概要", "新しいメンバー", "改善", "結果", "設定", "コミュニティ", "比較", "チャンネル"],
    tagline: "新規メンバーが離脱する場所を見つけ、改善し、効果を測定します。",
    home: "概要",
    journey: "新規メンバー",
    milestones: "新規メンバーの到達点",
    opportunities: "改善",
    actions: "改善メニュー",
    results: "結果",
    settings: "設定",
    new_members: "新規メンバー",
    activation_rate: "成功した新規メンバー",
    direct_reply_connection_rate: "返信を受けた",
    d7_active_retention: "7日後も活動",
    joined: "参加",
    onboarded: "参加手続きを完了",
    first_value: "最初の成功に到達",
    connected: "返信を受けた",
    d7_active: "7日後も活動",
    previous: "前期間",
    data: "データ取得状況",
    empty: "検証済みの観測データはまだありません",
    emptyDetail:
      "対象期間の活動データが集まると表示されます。欠損した値や集計途中の値をゼロとして扱いません。",
    setup: "コミュニティ成長の測定を始める",
    connect: "Discord を接続",
    activation: "成功した新規メンバー",
    onboarding: "歓迎フロー（任意）",
    measuring: "測定を開始",
    complete: "完了",
    todo: "次のステップ",
    communityOpportunity: "今見るべきこと",
    measurementWarning: "データ取得状況",
    suggested: "推奨アクション",
    range: "期間",
    retention: "参加した時期別",
    members: "メンバー",
    reply: "初回返信の分布",
    trendActivation: "最初の成功の推移",
    trendConnection: "最初のつながり推移",
    trendRetention: "1週間後も活動した人の推移",
    noOpportunity: "今すぐ対応が必要なことはありません。下から改善策を選ぶこともできます。",
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
    noResults:
      "結果はまだありません。改善策を有効にして効果を確認できます。",
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
type Copy = {
  [K in keyof typeof messages.en]: K extends "nav" ? readonly string[] : string;
};
const opportunityNames: Record<Locale, Record<string, string>> = {
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
    RETENTION_DROP: "1週間後も活動した割合が低下",
    DATA_COVERAGE_DROP: "一部のデータを取得できていません",
    ACTION_FAILURE_SPIKE: "アクション配信失敗が増加",
  },
};
const templateNames: Record<Locale, Record<ActionTemplateKey, string>> = {
  en: {
    reply_rescue: "Notify staff when someone has no reply",
    welcome_helper: "Notify staff when a newcomer may need help",
    inactive_follow_up: "Inactive Newcomer Follow-up",
    channel_recommendation: "Show recommended channels",
    event_recommendation: "Recommend an event",
  },
  ja: {
    reply_rescue: "返信がない人をスタッフに知らせる",
    welcome_helper: "参加後に困っている人をスタッフに知らせる",
    inactive_follow_up: "非アクティブ新規メンバーのフォロー",
    channel_recommendation: "おすすめチャンネルを案内する",
    event_recommendation: "イベントを案内する",
  },
};
const internalTemplateNames:Record<ActionTemplateKey,string>={reply_rescue:"Reply Rescue",welcome_helper:"Welcome Helper",inactive_follow_up:"Inactive Newcomer Follow-up",channel_recommendation:"Channel Recommendation",event_recommendation:"Event Recommendation"};
const actionName = (name: string, locale: Locale) => {
  const key = Object.entries(internalTemplateNames).find(
    ([, label]) => label === name,
  )?.[0] as ActionTemplateKey | undefined;
  return key ? templateNames[locale][key] : name;
};
const resultName = (name: string, locale: Locale) => {
  const base = name.endsWith(" Test") ? name.slice(0, -5) : name;
  const translated = actionName(base, locale);
  return translated === base ? name : translated;
};
const percent = (n: number | null) =>
  n === null ? "—" : `${(n * 100).toFixed(1)}%`;
const signed = (n: number | null, rate = true) =>
  n === null
    ? "—"
    : `${n > 0 ? "+" : n < 0 ? "−" : ""}${rate ? `${(Math.abs(n) * 100).toFixed(1)} pt` : Math.abs(n).toLocaleString()}`;

export default function Console({ data, initialLocale = "en" }: { data: ProductData; initialLocale?: Locale }) {
  const [locale, setLocale] = useState<Locale>(initialLocale),
    [page, setPage] = useState(0),
    [journey, setJourney] = useState(data.journey),
    [range, setRange] = useState<7 | 30 | 90>(data.journey?.range ?? 30),
    [journeyLoading, setJourneyLoading] = useState(false),
    [template, setTemplate] = useState<ActionTemplateKey>("reply_rescue"),
    [showImprovementSetup, setShowImprovementSetup] = useState(false),
    [preflightState, setPreflightState] = useState<"ready"|"permission_needed"|"unavailable"|null>(null),
    [preflightFix, setPreflightFix] = useState<string|null>(null),
    [testSent, setTestSent] = useState(false),
    [runMode, setRunMode] = useState<"suggest" | "approval" | "auto">("approval"),
    [channelId, setChannelId] = useState(data.options.channels.find(option=>option.id===data.admin?.settings.adminNotificationChannelId)?.id ?? data.options.channels[0]?.id ?? ""),
    [notificationRevision, setNotificationRevision] = useState(Number(data.admin?.settings.revision ?? 0)),
    [weeklyEnabled, setWeeklyEnabled] = useState(Boolean(data.admin?.settings.weeklySummaryEnabled)),
    [weeklyChannelId, setWeeklyChannelId] = useState(String(data.admin?.settings.weeklySummaryChannelId??data.options.channels[0]?.id??"")),
    [helperEnabled,setHelperEnabled]=useState(Boolean(data.admin?.settings.helperEnabled)),
    [helperChannelId,setHelperChannelId]=useState(String(data.admin?.settings.helperChannelId??data.options.channels[0]?.id??"")),
    [helperRoleId,setHelperRoleId]=useState(String(data.admin?.settings.helperRoleId??"")),
    [responseMinutes,setResponseMinutes]=useState(Number(data.admin?.settings.firstResponseMinutes??60)),
    [helperCooldown,setHelperCooldown]=useState(Number(data.admin?.settings.helperAlertCooldownMinutes??60)),
    [retentionDays, setRetentionDays] = useState(Number(data.admin?.settings.detailedRetentionDays ?? 30)),
    [scopeMode,setScopeMode]=useState<'all'|'include'|'exclude'>((data.admin?.settings.analysisScope as {mode?:'all'|'include'|'exclude'}|undefined)?.mode??'all'),
    [scopeChannels,setScopeChannels]=useState<string[]>((data.admin?.settings.analysisScope as {channelIds?:string[]}|undefined)?.channelIds??[]),
    [staffRoles,setStaffRoles]=useState<string[]>((data.admin?.settings.staffRoleIds as string[]|undefined)??[]),
    [goalPreset,setGoalPreset]=useState<'multiplayer'|'early_access'|'live_service'|''>((data.admin?.settings.goalPreset as 'multiplayer'|'early_access'|'live_service'|null)??''),
    [importantChannels,setImportantChannels]=useState<Array<{channelId:string;purpose:'lfg'|'feedback'|'bug'|'playtest'|'discussion'}>>((data.admin?.settings.importantChannels as Array<{channelId:string;purpose:'lfg'|'feedback'|'bug'|'playtest'|'discussion'}>|undefined)??[]),
    [eventId, setEventId] = useState(data.options.events[0]?.id ?? ""),
    [channels, setChannels] = useState<string[]>([]),
    [preview, setPreview] = useState<Preview | null>(null),
    [previewKind, setPreviewKind] = useState<
      "activation" | "onboarding" | "action" | "test" | null
    >(null),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [dismissed, setDismissed] = useState<string[]>([]),
    [dismissReasons, setDismissReasons] = useState<Record<string,"not_relevant"|"already_handled"|"later"|"">>({}),
    [evidence, setEvidence] = useState<string | null>(null),
    [testActionId, setTestActionId] = useState<string | null>(null),
    [actions, setActions] = useState(data.actions),
    [results, setResults] = useState(data.results);
  const c = messages[locale];
  const suggestedExcludedChannels=data.options.channels.filter(option=>/^#?(?:bot|logs?|staff|mod(?:erator)?)(?:[-_]|$)/i.test(option.label)).map(option=>option.id);
  const openImprovement=(key:ActionTemplateKey)=>{setTemplate(key);setPreflightState(null);setTestSent(false);setShowImprovementSetup(true);setPage(2);requestAnimationFrame(()=>document.querySelector('.builder-v3')?.scrollIntoView({behavior:'smooth',block:'start'}));};
  const selected = actions?.templates.find((t) => t.key === template),
    selectedAction = actions?.items.find((a) => a.id === testActionId);
  async function request(body: unknown) {
    setBusy(true);
    try {
      const response = await fetch("/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        result = await response.json();
      if (!response.ok) {
        const code = String(result.message ?? result.error ?? "");
        const channel = data.options.channels.find(item => item.id === channelId)?.label ?? (locale === "ja" ? "選択したチャンネル" : "the selected channel");
        const explanation = code.includes("CHANNEL_PERMISSION_MISSING") || code.includes("INVALID_START_CHANNEL") || code.includes("Discord HTTP 403") || code.includes("Discord HTTP 404")
          ? locale === "ja" ? `NEXUS は ${channel} に送信できません。別のチャンネルを選ぶか、表示・送信権限を確認してください。` : `NEXUS cannot send messages in ${channel}. Choose another channel or check View and Send permissions.`
          : code.includes("EVENT_NOT_AVAILABLE") ? locale === "ja" ? "イベントが見つかりません。現在利用できるイベントを選び直してください。" : "That event is no longer available. Choose another event."
          : code.includes("ENTITLEMENT_REQUIRED") ? locale === "ja" ? "この改善策は現在のプランでは使えません。プランを確認してください。" : "This improvement is not available on the current plan. Check your plan."
          : code.includes("REVISION_CONFLICT") ? locale === "ja" ? "設定が更新されました。ページを再読み込みしてやり直してください。" : "Settings changed. Refresh the page and try again."
          : locale === "ja" ? "変更を保存できませんでした。接続を確認して再試行してください。" : "The change could not be saved. Check the connection and try again.";
        throw new Error(explanation);
      }
      return result;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function prepare(body: unknown, kind: typeof previewKind) {
    const result = await request(body);
    if (result) {
      setPreview(result as Preview);
      setPreviewKind(kind);
      setStatus(c.draftReady);
    }
  }
  async function publish() {
    if (!preview) return;
    const kind = previewKind;
    const result = await request({
      action: "publish",
      id: preview.after.id,
      expectedHead: preview.before?.id ?? null,
      confirmationHash: preview.confirmationHash,
    });
    if (result) {
      setPreview(null);
      setPreviewKind(null);
      setStatus(c.published);
      if (kind === "action") {
        const response = await fetch("/data/actions", { cache: "no-store" });
        if (response.ok)
          setActions((await response.json()) as ActionsPresentation);
      } else if (kind === "test") {
        const response = await fetch("/data/results", { cache: "no-store" });
        if (response.ok)
          setResults((await response.json()) as ResultsPresentation);
      } else if (kind === "activation" || kind === "onboarding") {
        window.location.reload();
      }
    }
  }
  async function enableImprovement() {
    const check=await checkImprovement();if(check!=="ready")return;
    const draft = await request({action:"action_template",templateKey:template,channelId:channelId||undefined,eventId:eventId||undefined,recommendedChannelIds:channels,safetyMode:runMode});
    if (!draft) return;
    const saved = await request({action:"publish",id:draft.after.id,expectedHead:draft.before?.id??null,confirmationHash:draft.confirmationHash});
    if (!saved) return;
    const response = await fetch("/data/actions", {cache:"no-store"});
    if (response.ok) setActions(await response.json() as ActionsPresentation);
    const resultResponse=await fetch('/data/results',{cache:'no-store'});
    if(resultResponse.ok)setResults(await resultResponse.json() as ResultsPresentation);
    setStatus(locale === "ja" ? "改善策を有効にしました。" : "Improvement enabled.");
  }
  async function checkImprovement(){
    const result=await request({action:"action_preflight",templateKey:template,channelId:channelId||undefined,eventId:eventId||undefined,recommendedChannelIds:channels,safetyMode:runMode});
    if(!result)return null;
    setPreflightState(result.status);setPreflightFix(result.fix);return result.status as typeof preflightState;
  }
  async function sendTestNotification(){
    const check=await checkImprovement();if(check!=="ready")return;
    const result=await request({action:"action_test",templateKey:template,channelId:channelId||undefined,eventId:eventId||undefined,recommendedChannelIds:channels,safetyMode:runMode});
    if(result){setTestSent(true);setStatus(locale==="ja"?"テスト通知を送信しました。集計には含まれません。":"Test notification sent. It is excluded from all results.");}
  }
  async function dismissOpportunity(id:string,type:string){
    const result=await request({action:'feedback_dismiss',suggestionType:type,reason:dismissReasons[id]||null});
    if(result)setDismissed(current=>[...current,id]);
  }
  async function saveNotificationChannel(id:string) {
    const updated=await request({action:"notification_channel",channelId:id,revision:notificationRevision});
    if (!updated) return;
    setNotificationRevision(Number(updated.revision));
    setChannelId(id);
    setStatus(locale === "ja" ? "通知先を保存しました。" : "Notification destination saved.");
  }
  async function saveRetentionDays(days:7|14|30) {
    const updated=await request({action:"retention_days",days,revision:notificationRevision});
    if (!updated) return;
    setNotificationRevision(Number(updated.revision));
    setRetentionDays(days);
    setStatus(locale === "ja" ? "保持期間を保存しました。" : "Data retention setting saved.");
  }
  async function saveWeekly(enabled:boolean,destination=weeklyChannelId){
    const updated=await request({action:"weekly_summary",enabled,channelId:destination||null,revision:notificationRevision});
    if(!updated)return;
    setNotificationRevision(Number(updated.revision));setWeeklyEnabled(enabled);setWeeklyChannelId(destination);
    setStatus(locale==="ja"?"週間サマリーを保存しました。":"Weekly summary saved.");
  }
  async function saveHelper(enabled=helperEnabled){
    const updated=await request({action:'helper',enabled,channelId:helperChannelId||null,roleId:helperRoleId||null,responseMinutes,cooldownMinutes:helperCooldown,revision:notificationRevision});
    if(!updated)return;
    setNotificationRevision(Number(updated.revision));setHelperEnabled(enabled);
    setStatus(locale==='ja'?'返信通知の設定を保存しました。':'Helper alert settings saved.');
  }
  async function saveGoals(){
    const updated=await request({action:'goals',preset:goalPreset||null,channels:importantChannels,revision:notificationRevision});
    if(!updated)return;
    setNotificationRevision(Number(updated.revision));setStatus(locale==='ja'?'重点にする参加場所を保存しました。':'Community focus saved.');
  }
  async function startCheck() {
    if (!testActionId) return;
    const draft = await request({action:"experiment_draft",actionId:testActionId,primaryMetric:selectedAction?.name==='Reply Rescue'?"connection":"activation"});
    if (!draft) return;
    const saved = await request({action:"publish",id:draft.after.id,expectedHead:draft.before?.id??null,confirmationHash:draft.confirmationHash});
    if (!saved) return;
    const response = await fetch("/data/results", {cache:"no-store"});
    if (response.ok) setResults(await response.json() as ResultsPresentation);
    setTestActionId(null);
    setStatus(locale === "ja" ? "効果の確認を開始しました。" : "Result check started.");
  }
  async function approveAction(actionId: string, runId: string) {
    if (!(await request({ action: "approve", id: runId }))) return;
    setActions((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === actionId
                ? {
                    ...item,
                    recentState: "approved",
                    approvals: item.approvals.filter((run) => run.id !== runId),
                    delivery: {
                      ...item.delivery,
                      approved: item.delivery.approved + 1,
                    },
                  }
                : item,
            ),
          }
        : current,
    );
    setStatus(
      locale === "ja" ? "アクションを承認しました。" : "Action approved.",
    );
  }
  async function controlTest(id: string, state: "paused" | "stopped") {
    if (!(await request({ action: "experiment_control", id, state }))) return;
    setResults((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === id ? { ...item, state } : item,
            ),
          }
        : current,
    );
    setStatus(
      locale === "ja"
        ? state === "paused"
          ? "テストを一時停止しました。"
          : "テストを停止しました。"
        : state === "paused"
          ? "Test paused."
          : "Test stopped.",
    );
  }
  async function changeRange(value: 7 | 30 | 90) {
    setRange(value);
    setJourneyLoading(true);
    try {
      const response = await fetch(`/data/journey?range=${value}`, {
        cache: "no-store",
      });
      if (response.ok)
        setJourney((await response.json()) as JourneyPresentation);
      else setStatus(c.unavailable);
    } finally {
      setJourneyLoading(false);
    }
  }
  const healthText = (label: string) =>
    label === "healthy"
      ? locale === "ja" ? "正常" : "Collecting normally"
      : label === "partial"
        ? locale === "ja" ? "一部取得できていません" : "Some data could not be collected"
        : locale === "ja" ? "まだ利用できるデータがありません" : "Not enough verified data is available";
  const healthBadgeText = (label: string) =>
    label === "healthy"
      ? locale === "ja" ? "正常" : "Collecting"
      : label === "partial"
        ? locale === "ja" ? "一部欠損" : "Data limited"
        : locale === "ja" ? "データ待ち" : "No data yet";
  const go = (index: number) => () => setPage(index);
  const breadcrumb = (...parts: string[]) => (
    <p className="breadcrumb">{[c.home, ...parts].join(" / ")}</p>
  );

  const home = (
    <>
      {breadcrumb()}{" "}
      {data.home ? (
        <>
          <section className="hero">
            <div>
              <p className="eyebrow">
                NEXUS
              </p>
              <h1>{c.tagline}</h1>
              <p className="orientation">
                {locale === "ja"
                  ? "コミュニティの状態を確認し、次に対応すべきことを判断します。"
                  : "Understand community health and decide what to do next."}
              </p>
            </div>
            <div className={`coverage-card ${data.home.dataHealth.label}`}>
              <span>{c.data}</span>
              <strong>{healthText(data.home.dataHealth.label)}</strong>
              <small>
                {data.home.dataHealth.coverageRatio === null
                  ? "—"
                  : percent(data.home.dataHealth.coverageRatio)}
              </small>
            </div>
          </section>
          {data.home.setup.required && (
            <Setup
              data={data.home}
              c={c}
              locale={locale}
              busy={busy}
              preview={
                previewKind === "activation" || previewKind === "onboarding"
                  ? preview
                  : null
              }
              prepare={prepare}
              publish={publish}
            />
          )}
          {data.community && <p>{locale==='ja'?`分析対象の参加期間: ${new Date(data.community.cohortWindow.joinedFrom).toLocaleDateString('ja-JP',{timeZone:'UTC'})}〜${new Date(new Date(data.community.cohortWindow.joinedThrough).getTime()-1).toLocaleDateString('ja-JP',{timeZone:'UTC'})}。その後${data.community.cohortWindow.observedThroughDays}日間を確認できた人: ${data.community.eligibleMembers}人。`:`Joined ${new Date(data.community.cohortWindow.joinedFrom).toLocaleDateString('en-US',{timeZone:'UTC'})}–${new Date(new Date(data.community.cohortWindow.joinedThrough).getTime()-1).toLocaleDateString('en-US',{timeZone:'UTC'})}; ${data.community.eligibleMembers} members have ${data.community.cohortWindow.observedThroughDays} days of follow-up.`}</p>}
          {data.community?.daily.ready && <p>{locale==='ja'?`今日見ること: 返信待ち ${data.community.daily.attentionCount} 件。昨日参加 ${data.community.daily.yesterdayJoined} 人、交流あり ${data.community.daily.yesterdayConnected} 人。`:`Today’s staff check: ${data.community.daily.attentionCount} posts await a reply. Yesterday ${data.community.daily.yesterdayJoined} joined and ${data.community.daily.yesterdayConnected} connected.`}</p>}
          {data.community && <section className="surface"><h2>{locale==='ja'?'新しく入った人の流れ':'How new members are participating'}</h2>{data.community.dataReady?<><div className="journey-steps">{data.community.stages.map(step=><p key={step.key}><strong>{step.count.toLocaleString()}</strong> {locale==='ja'?step.label:stageNamesEn[step.key]}</p>)}</div>{data.community.largestDrop&&<p>{locale==='ja'?`最も多くの人が次に進んでいない段階: ${data.community.largestDrop.from} → ${data.community.largestDrop.to}。改善できる可能性があります。`:`The largest observed drop is between ${stageNamesEn[data.community.largestDrop.fromKey]} and ${stageNamesEn[data.community.largestDrop.toKey]}. This may be worth improving.`}</p>}</>:<p>{locale==='ja'?'まだ比較できるだけの観測データがありません。':'There is not enough observed data to compare yet.'}</p>}<button onClick={go(1)}>{locale==='ja'?'詳しく見る':'See details'} →</button></section>}
          <section className="kpi-grid">
            {data.home.kpis.filter(k=>k.key!=='activation_rate').map((k) => (
              <MetricCard
                key={k.key}
                label={c[k.key]}
                value={
                  k.key === "new_members"
                    ? k.current === null
                      ? "—"
                      : k.current.toLocaleString()
                    : percent(k.current)
                }
                previous={`${c.previous}: ${k.key === "new_members" ? (k.previous === null ? "—" : k.previous.toLocaleString()) : percent(k.previous)}`}
                delta={signed(k.delta, k.key !== "new_members")}
                sample={k.sampleSize}
                maturity={
                  k.maturity === "mature"
                    ? c.mature
                    : k.maturity === "provisional"
                      ? c.provisional
                      : c.unavailable
                }
                coverageStatus={k.coverage.label}
                coverageLabel={healthBadgeText(k.coverage.label)}
              />
            ))}
          </section>
          <section className="surface opportunity-spotlight">
              <p className="eyebrow">{c.communityOpportunity}</p>
              {data.home.communityOpportunity ? (
                <>
                  <h2>
                    {
                      opportunityNames[locale][
                        data.home.communityOpportunity.type
                      ]
                    }
                  </h2>
                  <div className="opportunity-delta">
                    {signed(data.home.communityOpportunity.difference)}
                  </div>
                  <p>{c.notCausal}</p>
                  <button onClick={go(2)}>{c.opportunities} →</button>
                </>
              ) : (
                <><p>{c.noOpportunity}</p><button onClick={go(2)}>{c.opportunities} →</button></>
              )}
          </section>
        </>
      ) : (
        <Empty c={c} />
      )}
    </>
  );

  const journeyView = (
    <>
      {breadcrumb(c.journey)}
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {c.nav[1]}
          </p>
          <h1>{c.milestones}</h1>
          <p className="orientation">
            {locale === "ja"
              ? "互換性のある母集団ごとに、参加後の主要な到達点を確認します。段階間の換算率ではありません。"
              : "Review each newcomer milestone. Each percentage uses the members with enough time to reach it."}
          </p>
        </div>
        <div className="segmented" aria-label={c.range}>
          {([7, 30, 90] as const).map((value) => (
            <button
              aria-pressed={range === value}
              onClick={() => void changeRange(value)}
              key={value}
            >
              {value}D
            </button>
          ))}
        </div>
      </div>
      {journeyLoading ? (
        <Skeleton label={c.loading} />
      ) : journey ? (
        <>
          <section className="surface">
            <JourneyFunnel stages={journey.funnel} labels={c} />
          </section>
          <section className="chart-grid">
            <TrendChart
              title={c.trendActivation}
              points={journey.trends.activation}
              emptyLabel={c.emptyDetail}
            />
            <TrendChart
              title={c.trendConnection}
              points={journey.trends.connection}
              emptyLabel={c.emptyDetail}
            />
            <TrendChart
              title={c.trendRetention}
              points={journey.trends.d7_retention}
              emptyLabel={c.emptyDetail}
            />
          </section>
          <section className="chart-grid two">
            <CohortHeatmap
              cohorts={journey.retention}
              labels={{
                cohort: c.retention,
                members: c.members,
                empty: c.emptyDetail,
              }}
            />
            <ResponseDistributionChart
              rows={journey.firstReplyDistribution}
              title={c.reply}
              labels={replyLabels(locale)}
              emptyLabel={c.emptyDetail}
            />
          </section>
          <section className="surface">
            <h2>{locale==="ja"?"新規メンバーが活動したチャンネル":"Where newcomers started"}</h2>
            {journey.channels?.length?<div className="channel-table"><table><thead><tr><th>{locale==="ja"?"チャンネル":"Channel"}</th><th>{locale==="ja"?"最初の投稿":"First messages"}</th><th>{locale==="ja"?"最初の返信":"First replies"}</th><th>{locale==="ja"?"最初の成功":"First successes"}</th><th>{locale==="ja"?"その後の成功":"Later success"}</th></tr></thead><tbody>{journey.channels.map(row=><tr key={row.channelId}><th>{data.options.channels.find(option=>option.id===row.channelId)?.label??(locale==="ja"?"現在は利用できないチャンネル":"Channel no longer available")}</th><td>{row.firstMessages}</td><td>{row.firstReplies}</td><td>{row.firstSuccesses}</td><td>{row.goalEligible?`${row.goalCompleted??0}/${row.goalEligible}`:"—"}</td></tr>)}</tbody></table></div>:<p>{locale==="ja"?"チャンネル別に表示できる件数を収集中です。":"Collecting enough activity to show channels safely."}</p>}
            <p className="inline-note">{locale==="ja"?"少数のチャンネルは非表示です。その後の成功は関係を示すもので、チャンネルが原因とは限りません。":"Channels with very few observations are hidden. Later success is an association, not proof that a channel caused it."}</p>
          </section>
          <NextStep
            prefix={c.next}
            label={c.viewOpportunities}
            onClick={go(2)}
          />
        </>
      ) : (
        <Empty c={c} />
      )}
    </>
  );

  const visibleOpportunities =
    data.opportunities?.items.filter((item) => !dismissed.includes(item.id)) ??
    [];
  const opportunityView = (
    <>
      {breadcrumb(c.opportunities)}
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {locale === "ja" ? "活動の傾向" : "ACTIVITY PATTERNS"}
          </p>
          <h1>{c.opportunities}</h1>
          <p className="orientation">
            {locale === "ja"
              ? "今見るべきことと、NEXUS が提案する改善策を確認できます。"
              : "See what needs attention and which improvement NEXUS suggests."}
          </p>
        </div>
      </div>
      {data.opportunities?.measurementWarnings.map((item) => (
        <div className="measurement-warning wide" key={item.id}>
          <strong>{c.measurementWarning}</strong>
          <span>{opportunityNames[locale][item.type]}</span>
        </div>
      ))}
      {visibleOpportunities.length ? (
        <section className="opportunity-list">
          {visibleOpportunities.map((item) => (
            <article key={item.id}>
              <div className="severity">
                {item.severity === "critical" ? "●" : "○"}{" "}
                {item.severity === "critical"
                  ? locale === "ja"
                    ? "重大"
                    : "Critical"
                  : locale === "ja"
                    ? "注意"
                    : "Attention"}
              </div>
              <div>
                <h2>{opportunityNames[locale][item.type]}</h2>
                <p>{locale === "ja" ? `${item.sampleSize.toLocaleString()} 人の新規メンバーを評価` : `${item.sampleSize.toLocaleString()} newcomers evaluated`}</p>
                <p>{c.current}: {percent(item.current)} · {c.previous}: {percent(item.previous)}</p>
                <small>{c.notCausal}</small>
                {item.suggestedAction && <p>{locale === "ja" ? "提案する改善策" : "Suggested improvement"}: <strong>{templateNames[locale][item.suggestedAction]}</strong></p>}
                {evidence === item.id && (
                  <dl className="evidence-detail">
                    <div>
                      <dt>{c.current}</dt>
                      <dd>{percent(item.current)}</dd>
                    </div>
                    <div>
                      <dt>{c.baseline}</dt>
                      <dd>{percent(item.previous)}</dd>
                    </div>
                    <div>
                      <dt>{c.difference}</dt>
                      <dd>{signed(item.difference)}</dd>
                    </div>
                    <div>
                      <dt>{c.why}</dt>
                      <dd>
                        {locale === "ja"
                          ? "決定論的な変化基準を満たしました。"
                          : "The deterministic change threshold was met."}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
              <div className="opportunity-value">
                <strong>{signed(item.difference)}</strong>
                <span>
                  {percent(item.previous)} → {percent(item.current)}
                </span>
              </div>
              <div className="button-stack">
                {item.suggestedAction && (
                  <button
                    onClick={() => openImprovement(item.suggestedAction!)}
                  >
                    {c.createFromOpportunity}
                  </button>
                )}
                <button className="quiet" onClick={() => setEvidence(evidence === item.id ? null : item.id)}>{c.why}</button>
                <details><summary>{locale==="ja"?"非表示にする理由（任意）":"Reason for dismissal (optional)"}</summary><select value={dismissReasons[item.id]??""} onChange={e=>setDismissReasons(current=>({...current,[item.id]:e.target.value as "not_relevant"|"already_handled"|"later"|""}))}><option value="">—</option><option value="not_relevant">{locale==="ja"?"関係ない":"Not relevant"}</option><option value="already_handled">{locale==="ja"?"対応済み":"Already handled"}</option><option value="later">{locale==="ja"?"後で":"Later"}</option></select></details>
                <button className="quiet" onClick={() => void dismissOpportunity(item.id,item.type)}>{c.dismiss}</button>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="surface">
          <p>{c.noOpportunity}</p>
        </section>
      )}
      <section className="surface improvement-menu">
        <h2>{c.actions}</h2>
        <p>{locale === "ja" ? "必要な改善策を選んでください。送信先は有効化する前に確認します。" : "Choose what would help your newcomers. Select a destination before enabling."}</p>
        <div className="improvement-menu-grid">
          {(["reply_rescue","welcome_helper","channel_recommendation","event_recommendation"] as const).filter(key=>key!=="event_recommendation"||data.options.events.length>0).map(key=><button key={key} onClick={()=>openImprovement(key)}>{templateNames[locale][key]}</button>)}
        </div>
      </section>
    </>
  );

  const actionView = (
    <>
      <section className="action-layout">
        {showImprovementSetup && <div className="builder-v3">
          <h2>{c.createAction}</h2>
          <label>
            {c.template}
            <select
              value={template}
              onChange={(e) => {
                setTemplate(e.target.value as ActionTemplateKey);
                setPreflightState(null);setTestSent(false);
                setPreview(null);
              }}
            >
              {actions?.templates.filter(t => t.key !== "inactive_follow_up"&&(t.key!=="event_recommendation"||data.options.events.length>0)).map((t) => (
                <option key={t.key} value={t.key}>
                  {templateNames[locale][t.key]}
                </option>
              ))}
            </select>
          </label>
          {selected && <div className="flow-preview" aria-label={locale==="ja"?"改善策の流れ":"Improvement preview"}>
            <strong>{locale==="ja"?"有効にすると":"When enabled"}</strong>
            <p>{semantic(selected.trigger,locale)} → {duration(selected.delaySeconds,locale)} → {semantic(selected.condition,locale)} → {runMode==="approval"?(locale==="ja"?"スタッフが確認":"staff reviews"):runMode==="suggest"?(locale==="ja"?"提案のみ":"suggestion only"):(locale==="ja"?"自動で実行":"runs automatically")} → {semantic(selected.action,locale)} {channelId ? (data.options.channels.find(option=>option.id===channelId)?.label??"") : ""}</p>
          </div>}
          {selected && <details><summary>{locale === "ja" ? "設定を変更" : "Change settings"}</summary><label>{locale === "ja" ? "実行方法" : "How to run"}<select value={runMode} onChange={e=>setRunMode(e.target.value as typeof runMode)}><option value="suggest">{locale === "ja" ? "提案だけ" : "Suggest only"}</option><option value="approval">{locale === "ja" ? "確認してから実行" : "Confirm before running"}</option><option value="auto">{locale === "ja" ? "自動で実行" : "Run automatically"}</option></select></label><Policy template={{...selected,safety:{...selected.safety,mode:runMode}}} c={c} locale={locale} /></details>}
          {!data.options.available && selected?.requires.length ? (
            <p className="inline-note">{c.optionsUnavailable}</p>
          ) : null}
          {selected?.requires.includes("channelId") && (
            <label>
              {c.destination}
              <select
                value={channelId}
                onChange={(e) => {setChannelId(e.target.value);setPreflightState(null);setTestSent(false);}}
              >
                <option value="">—</option>
                {data.options.channels.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected?.requires.includes("eventId") && (
            <label>
              {c.event}
              <select
                value={eventId}
                onChange={(e) => {setEventId(e.target.value);setPreflightState(null);setTestSent(false);}}
              >
                <option value="">—</option>
                {data.options.events.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected?.requires.includes("recommendedChannelIds") && (
            <label>
              {c.recommendedChannels}
              <select
                multiple
                value={channels}
                onChange={(e) =>
                  {setChannels([...e.target.selectedOptions].map((o) => o.value));setPreflightState(null);setTestSent(false);}
                }
              >
                {data.options.channels.map((option) => (
                  <option value={option.id} key={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="card-actions">
            <button disabled={busy||!channelId} onClick={()=>void checkImprovement()}>{locale==="ja"?"設定を確認":"Check setup"}</button>
            <button disabled={busy||!channelId} onClick={()=>void sendTestNotification()}>{locale==="ja"?"テスト通知を送る":"Send test notification"}</button>
          </div>
          {preflightState&&<p role="status" className="inline-note">{preflightState==="ready"?(locale==="ja"?"準備完了":"Ready"):preflightState==="permission_needed"?(locale==="ja"?"権限が必要です。選択したチャンネルで NEXUS に表示・送信権限を与えてください。":"Permission needed. Give NEXUS View Channel and Send Messages in the selected channels."):(locale==="ja"?"利用できません。選択内容を確認してください。":"Unavailable. Check the selected destination or event.")} {preflightState==="ready"&&testSent?(locale==="ja"?"テスト送信済み":"Test sent"):preflightState!=="ready"?preflightFix:""}</p>}
          <button
            disabled={
              busy ||
              Boolean(selected?.requires.includes("channelId") && !channelId) ||
              Boolean(selected?.requires.includes("eventId") && !eventId) ||
              Boolean(
                selected?.requires.includes("recommendedChannelIds") &&
                !channels.length,
              )
            }
            onClick={() => void enableImprovement()}
          >
            {c.review}
          </button>
        </div>}
        <div>
          <h2>{c.activeActions}</h2>
          {actions?.items.length ? (
            actions.items.map((item) => (
              <article className="surface action-card" key={item.id}>
                <div className="section-heading">
                  <h3>
                    {actionName(item.name, locale)} · v{item.version}
                  </h3>
                  <span className="live">
                    {locale === "ja" ? "稼働中" : "LIVE"}
                  </span>
                </div>
                <details><summary>{locale === "ja" ? "設定を見る" : "View settings"}</summary><Policy template={item} c={c} locale={locale} /></details>
                <h4>{c.delivery}</h4>
                <DeliveryFunnelChart
                  action={item}
                  labels={{
                    triggered: c.triggered,
                    eligible: c.eligible,
                    approved: c.approved,
                    delivered: c.delivered,
                  }}
                />
                <div className="delivery-issues">
                  <span>
                    {c.failed} {item.delivery.failed}
                  </span>
                  <span>
                    {c.unknown} {item.delivery.unknown}
                  </span>
                  <span>
                    {c.suppressed} {item.delivery.suppressed}
                  </span>
                </div>
                {item.approvals.length > 0 && (
                  <div className="approval-box">
                    <strong>{c.approvalNeeded}</strong>
                    {item.approvals.map((run) => (
                      <button
                        key={run.id}
                        disabled={busy}
                        onClick={() => void approveAction(item.id, run.id)}
                      >
                        {c.approve}
                      </button>
                    ))}
                  </div>
                )}
                <div className="card-actions">
                  <button
                    onClick={() =>
                      setStatus(
                        `${c.triggered}: ${item.delivery.triggered} · ${c.delivered}: ${item.delivery.delivered}`,
                      )
                    }
                  >
                    {c.viewActivity}
                  </button>
                  <button
                    onClick={() => {
                      setTestActionId(item.id);
                      setPage(3);
                    }}
                  >
                    {c.testAction}
                  </button>
                </div>
              </article>
            ))
          ) : (
            <section className="surface">
              <p>{c.noActions}</p>
            </section>
          )}
        </div>
      </section>
    </>
  );

  const resultView = (
    <>
      {breadcrumb(
        c.results,
        ...(testActionId && selectedAction
          ? [actionName(selectedAction.name, locale)]
          : []),
      )}
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {locale === "ja" ? "効果を測定" : "MEASURE WHAT WORKED"}
          </p>
          <h1>{c.results}</h1>
          <p className="orientation">
            {locale === "ja"
              ? "通常運用と改善ありを比較し、次の判断につなげます。"
              : "Compare usual operation with the improvement enabled."}
          </p>
        </div>
      </div>
      {results?.simple?.length ? <section className="results-list">{results.simple.map(item=><article className="surface result-card" key={item.actionId}>
        <h2>{actionName(item.name,locale)}</h2>
        <p>{locale==="ja"?"改善の前後を比較":"Before and after this improvement"}</p>
        <div className="test-summary"><div><span>{locale==="ja"?"改善前":"Before"}</span><strong>{percent(item.before.current)}</strong><small>{item.before.sampleSize} {locale==="ja"?"人":"newcomers"}</small></div><div><span>{locale==="ja"?"改善後":"After"}</span><strong>{percent(item.after.current)}</strong><small>{item.after.sampleSize} {locale==="ja"?"人":"newcomers"}</small></div></div>
        <p>{item.collecting?(locale==="ja"?"結果を収集中です。現在の人数と変化を確認できます。":"Still collecting. Counts and trends will appear when enough time has passed."):(locale==="ja"?`観測された差: ${signed(item.after.current!==null&&item.before.current!==null?item.after.current-item.before.current:null)}`:`Observed difference: ${signed(item.after.current!==null&&item.before.current!==null?item.after.current-item.before.current:null)}`)}</p>
        <p className="inline-note">{locale==="ja"?"この差には他の要因も影響した可能性があります。":"Other factors may have affected this difference."}</p>
        {item.controlledAvailable?<button onClick={()=>setTestActionId(item.actionId)}>{locale==="ja"?"より正確に確認":"Check more accurately"}</button>:<p className="inline-note">{locale==="ja"?"より正確な確認は、活動が増えると利用できます。":"A more rigorous check can become available as activity grows."}</p>}
      </article>)}</section>:null}
      {testActionId && selectedAction && (
        <section className="surface test-builder">
          <h2>
            {c.testAction}: {actionName(selectedAction.name, locale)}
          </h2>
          <div className="test-summary">
            <div>
              <span>{c.hypothesis}</span>
              <strong>
                {locale === "ja"
                  ? `${actionName(selectedAction.name, locale)} は新規メンバーに役立つか？`
                  : `Does ${actionName(selectedAction.name, locale)} help newcomers?`}
              </strong>
            </div>
            <div>
              <span>{c.control}</span>
              <strong>
                {c.control}
              </strong>
            </div>
            <div>
              <span>{c.treatment}</span>
              <strong>{actionName(selectedAction.name, locale)}</strong>
            </div>
            <div>
              <span>{c.primaryOutcome}</span>
              <strong>{metricLabel(selectedAction.name==='Reply Rescue'?'connection':'activation',locale)}</strong>
            </div>
          </div>
          <button disabled={busy} onClick={() => void startCheck()}>{c.reviewTest}</button>
        </section>
      )}
      {results?.items.length ? (
        <section className="results-list">
          {results.items.map((item) => (
            <article className="surface result-card" key={item.id}>
              <div className="result-head">
                <div>
                  <span className={`evidence ${item.evidence}`}>
                    {evidenceLabel(item, locale)}
                  </span>
                  <h2>{resultName(item.name, locale)}</h2>
                  <p>
                    <strong>{c.hypothesis}:</strong>{" "}
                    {locale === "ja"
                      ? `改善ありは通常運用より ${metricLabel(item.primaryMetric, locale)} を改善するか？`
                      : `Does the improvement help ${metricLabel(item.primaryMetric, locale)} compared with usual operation?`}
                  </p>
                </div>
                <div className="lift">
                  <span>{c.difference}</span>
                  <strong>{signed(item.absoluteLift)}</strong>
                </div>
              </div>
              <div className="result-grid">
                <ExperimentComparison
                  item={item}
                  labels={{
                    control: c.control,
                    treatment: c.treatment,
                    rate: c.rate,
                  }}
                />
                <div className="learning">
                  <h3>{c.learning}</h3>
                  <p>{learning(item.evidence, locale)}</p>
                  <dl>
                    <div>
                      <dt>{c.maturity}</dt>
                      <dd>{item.maturity.mature}</dd>
                    </div>
                    <div>
                      <dt>{locale === "ja" ? "集計中" : "Still collecting"}</dt>
                      <dd>{item.maturity.assigned - item.maturity.mature}</dd>
                    </div>
                  </dl>
                </div>
              </div>
              <details>
                <summary>{c.advanced}</summary>
                <p>{c.coverage}: {healthText(item.dataHealth.label)} · {c.guardrails}: {item.guardrailStatus === "healthy" ? c.healthy : c.partial}</p>
                <p>{c.randomization}: {item.randomization === "time_block" ? c.dailyBlocks : locale === "ja" ? "メンバー単位" : "By member"} · {c.timeline}: {item.timeline.windowDays} {locale === "ja" ? "日" : "days"}</p>
                <p>
                  {locale === "ja"
                    ? "結果を確認できる全メンバーを、配信失敗・不明を含めて集計します。"
                    : "All mature assignments are analyzed, including failed and uncertain deliveries."}
                </p>
                {item.spilloverRisk && (
                  <p>
                    {locale === "ja"
                      ? "時間ブロック間の波及や持ち越しが推定に影響する可能性があります。"
                      : "Spillover and carryover across time blocks may affect the estimate."}
                  </p>
                )}
                <p>
                  {locale === "ja" ? "95% 区間" : "95% interval"}:{" "}
                  {item.credibleInterval
                    ? `${signed(item.credibleInterval[0])} – ${signed(item.credibleInterval[1])}`
                    : "—"}{" "}
                  ·{" "}
                  {locale === "ja"
                    ? `P(${c.treatment} が優位)`
                    : `P(${c.treatment.toLowerCase()} better)`}
                  : {percent(item.probabilityTreatmentBetter)}
                </p>
              </details>
              <div className="card-actions">
                <button onClick={() => setPage(2)}>{c.viewAction}</button>
                {item.state === "running" && (
                  <button
                    disabled={busy}
                    onClick={() => void controlTest(item.id, "paused")}
                  >
                    {c.pauseTest}
                  </button>
                )}
                {item.state !== "stopped" && (
                  <button
                    disabled={busy}
                    className="danger"
                    onClick={() => void controlTest(item.id, "stopped")}
                  >
                    {c.stopTest}
                  </button>
                )}
              </div>
            </article>
          ))}
        </section>
      ) : !results?.simple?.length ? (
        <section className="surface">
          <p>{c.noResults}</p>
        </section>
      ) : null}
    </>
  );

  const settingsView = (
    <>
      {breadcrumb(c.settings)}
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {locale === "ja" ? "コミュニティ設定" : "COMMUNITY CONFIGURATION"}
          </p>
          <h1>{c.settings}</h1>
          <p className="orientation">
            {locale === "ja"
              ? "言語、通知先、Discord、データを管理します。"
              : "Manage language, notifications, Discord and data."}
          </p>
        </div>
      </div>
      <section className="settings-grid">
        <article className="surface"><h2>{locale==='ja'?'分析する範囲':'Channels to analyze'}</h2><p>{locale==='ja'?'初期設定はサーバー全体です。スタッフ用チャンネルなどは必要に応じて除外してください。':'The default is the whole server. Exclude staff channels where needed.'}</p><button disabled={!suggestedExcludedChannels.length} onClick={()=>{setScopeMode('exclude');setScopeChannels(suggestedExcludedChannels)}}>{locale==='ja'?'スタッフ・ログ用らしいチャンネルを選択':'Select likely staff or log channels'}</button><select aria-label={locale==='ja'?'分析する範囲':'Channels to analyze'} value={scopeMode} onChange={e=>setScopeMode(e.target.value as typeof scopeMode)}><option value="all">{locale==='ja'?'サーバー全体':'Whole server'}</option><option value="include">{locale==='ja'?'選んだチャンネルだけ':'Selected channels only'}</option><option value="exclude">{locale==='ja'?'選んだチャンネルを除外':'Exclude selected channels'}</option></select>{scopeMode!=='all'&&<div className="scope-list">{data.options.channels.map(option=><label key={option.id}><input type="checkbox" checked={scopeChannels.includes(option.id)} onChange={e=>setScopeChannels(e.target.checked?[...scopeChannels,option.id]:scopeChannels.filter(id=>id!==option.id))}/>{option.label}</label>)}</div>}<h3>{locale==='ja'?'比較から除外するスタッフのロール':'Staff roles excluded from comparison'}</h3><div className="scope-list">{data.options.roles.map(option=><label key={option.id}><input type="checkbox" checked={staffRoles.includes(option.id)} onChange={e=>setStaffRoles(e.target.checked?[...staffRoles,option.id]:staffRoles.filter(id=>id!==option.id))}/>{option.label}</label>)}</div><button disabled={busy||scopeMode==='include'&&!scopeChannels.length} onClick={async()=>{const result=await request({action:'analysis_scope',mode:scopeMode,channelIds:scopeChannels,staffRoleIds:staffRoles,revision:notificationRevision});if(result){setNotificationRevision(result.revision);setStatus(locale==='ja'?'分析する範囲を保存しました。':'Analysis scope saved.');}}}>{locale==='ja'?'変更を保存':'Save changes'}</button></article>
        <article className="surface">
          <h2>{locale === "ja" ? "一般" : "General"}</h2>
          <p>{c.language}</p>
          <div className="segmented">
            <button
              aria-pressed={locale === "en"}
              onClick={() => { setLocale("en"); document.cookie="nexus_locale=en; Path=/; Max-Age=31536000; SameSite=Lax"; }}
            >
              English
            </button>
            <button
              aria-pressed={locale === "ja"}
              onClick={() => { setLocale("ja"); document.cookie="nexus_locale=ja; Path=/; Max-Age=31536000; SameSite=Lax"; }}
            >
              日本語
            </button>
          </div>
          <p>
            {locale === "ja"
              ? "Discord パネルの言語は Discord 内の設定で管理します。"
              : "Discord panel language is managed from Settings in Discord."}
          </p>
          <label>{locale === "ja" ? "スタッフの通知先" : "Staff notification destination"}<select value={channelId} onChange={e=>void saveNotificationChannel(e.target.value)} disabled={!data.options.available}>{data.options.channels.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        </article>
        <article className="surface">
          <h2>Discord</h2>
          <p>{data.options.available ? locale === "ja" ? "接続済み。改善策を有効にする前に権限を再確認します。" : "Connected. Permissions are checked again before enabling an improvement." : locale === "ja" ? "接続を確認してください。" : "Check the connection."}</p>
        </article>
        <article className="surface">
          <h2>{locale==='ja'?'コミュニティの重点':'Community focus'}</h2>
          <p>{locale==='ja'?'重点は目安です。後から変更できます。チャンネルの本文は解析しません。':'These are suggestions you can change. NEXUS does not analyze message contents.'}</p>
          <label>{locale==='ja'?'運営スタイル':'Community type'}<select value={goalPreset} onChange={e=>setGoalPreset(e.target.value as typeof goalPreset)}><option value="">{locale==='ja'?'選ばない':'No preset'}</option><option value="multiplayer">{locale==='ja'?'協力・対戦ゲーム':'Multiplayer / Co-op'}</option><option value="early_access">{locale==='ja'?'早期アクセス':'Early Access'}</option><option value="live_service">{locale==='ja'?'継続運営ゲーム':'Live service'}</option></select></label>
          <p>{goalPreset==='multiplayer'?locale==='ja'?'候補: 仲間探し、Voice、イベント':'Suggested: LFG, Voice, events':goalPreset==='early_access'?locale==='ja'?'候補: 意見、試遊、不具合報告':'Suggested: feedback, playtests, bug reports':goalPreset==='live_service'?locale==='ja'?'候補: イベント、仲間探し、Voice、交流':'Suggested: events, LFG, Voice, discussion':''}</p>
          <label>{locale==='ja'?'重要な参加場所を追加':'Add an important channel'}<select value="" disabled={importantChannels.length>=20} onChange={e=>{if(e.target.value)setImportantChannels(current=>[...current,{channelId:e.target.value,purpose:'lfg'}]);}}><option value="">{locale==='ja'?'チャンネルを選ぶ':'Choose a channel'}</option>{data.options.channels.filter(option=>!importantChannels.some(item=>item.channelId===option.id)).map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          {importantChannels.map(item=><div key={item.channelId} className="scope-list"><span>{data.options.channels.find(option=>option.id===item.channelId)?.label??item.channelId}</span><select value={item.purpose} onChange={e=>setImportantChannels(current=>current.map(row=>row.channelId===item.channelId?{...row,purpose:e.target.value as typeof item.purpose}:row))}><option value="lfg">{locale==='ja'?'仲間探し':'LFG'}</option><option value="feedback">{locale==='ja'?'意見・感想':'Feedback'}</option><option value="bug">{locale==='ja'?'不具合報告':'Bug reports'}</option><option value="playtest">{locale==='ja'?'試遊':'Playtests'}</option><option value="discussion">{locale==='ja'?'交流':'Discussion'}</option></select><button onClick={()=>setImportantChannels(current=>current.filter(row=>row.channelId!==item.channelId))}>{locale==='ja'?'外す':'Remove'}</button></div>)}
          <button disabled={busy} onClick={()=>void saveGoals()}>{locale==='ja'?'重点を保存':'Save focus'}</button>
        </article>
        <article className="surface">
          <h2>{locale==="ja"?"週間サマリー":"Weekly summary"}</h2>
          <label><input type="checkbox" checked={weeklyEnabled} disabled={busy||!weeklyChannelId} onChange={e=>void saveWeekly(e.target.checked)}/>{locale==="ja"?"毎週スタッフに送る":"Send to staff each week"}</label>
          <label>{locale==="ja"?"送信先":"Destination"}<select value={weeklyChannelId} disabled={busy||!data.options.available} onChange={e=>{setWeeklyChannelId(e.target.value);if(weeklyEnabled)void saveWeekly(true,e.target.value);}}>{data.options.channels.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <p>{locale==="ja"?"新規メンバーの状況、ひとつの問題、ひとつの改善策を簡潔にお知らせします。":"A short update with newcomer progress, one issue, and one improvement."}</p>
          {data.weeklyStatus?.state==='unknown'&&<p role="status">{locale==='ja'?'送信結果を確認できませんでした。チャンネルを確認してください。':'The delivery result could not be confirmed. Check the channel before sending again.'}</p>}
        </article>
        <article className="surface">
          <h2>{locale==='ja'?'返信を手伝う人への通知':'Helper alerts'}</h2>
          <p>{locale==='ja'?'新しいメンバーの投稿に返信がないとき、指定したチャンネルへ知らせます。通知は設定した間隔を空け、1日最大6件です。':'Notify a helper channel when a new member’s post has no reply. Alerts follow the chosen interval and are capped at six per day.'}</p>
          <label><input type="checkbox" checked={helperEnabled} disabled={busy||!helperChannelId} onChange={e=>void saveHelper(e.target.checked)}/>{locale==='ja'?'通知を有効にする':'Enable alerts'}</label>
          <label>{locale==='ja'?'通知先':'Destination'}<select value={helperChannelId} onChange={e=>setHelperChannelId(e.target.value)}>{data.options.channels.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <label>{locale==='ja'?'通知するロール（任意）':'Role to notify (optional)'}<select value={helperRoleId} onChange={e=>setHelperRoleId(e.target.value)}><option value="">{locale==='ja'?'ロールへの通知なし':'No role ping'}</option>{data.options.roles.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          <label>{locale==='ja'?'返信待ちの時間':'Wait before alert'}<select value={responseMinutes} onChange={e=>setResponseMinutes(Number(e.target.value))}>{[15,30,60,120].map(minutes=><option key={minutes} value={minutes}>{minutes} {locale==='ja'?'分':'min'}</option>)}</select></label>
          <label>{locale==='ja'?'通知の最短間隔':'Minimum time between alerts'}<select value={helperCooldown} onChange={e=>setHelperCooldown(Number(e.target.value))}>{[30,60,120,240].map(minutes=><option key={minutes} value={minutes}>{minutes} {locale==='ja'?'分':'min'}</option>)}</select></label>
          <button disabled={busy||!helperChannelId} onClick={()=>void saveHelper()}>{locale==='ja'?'設定を保存':'Save settings'}</button>
        </article>
        <article className="surface">
          <h2>{locale === "ja" ? "データ" : "Data"}</h2>
          <label>{locale === "ja" ? "詳細データを保存する期間" : "Keep detailed data for"}<select value={retentionDays} onChange={e=>void saveRetentionDays(Number(e.target.value) as 7|14|30)}><option value={7}>{locale === "ja" ? "7日" : "7 days"}</option><option value={14}>{locale === "ja" ? "14日" : "14 days"}</option><option value={30}>{locale === "ja" ? "30日" : "30 days"}</option></select></label>
          <p>{locale === "ja" ? `集計データ: ${String(data.admin?.settings.aggregateRetentionMonths ?? "—")} か月` : `Aggregate data: ${String(data.admin?.settings.aggregateRetentionMonths ?? "—")} months`}</p>
          <p>
            {locale === "ja"
              ? "メッセージ本文、添付、DM、プレゼンスは保存しません。"
              : "Message contents, attachments, DMs and presence are not stored."}
          </p>
          <p>{locale === "ja" ? "データを削除するには Discord で /nexus privacy を開いてください。" : "To delete data, open /nexus privacy in Discord."}</p>
        </article>
        <article className="surface">
          <h2>{locale === "ja" ? "詳細設定" : "Advanced"}</h2>
          <details><summary>{locale === "ja" ? "プランと管理情報を見る" : "View plan and administration"}</summary><p>{c.plan}: {data.admin?.usage.plan ?? "—"}</p><p>{locale === "ja" ? "管理にはサーバー管理権限が必要です。" : "Administration requires Manage Guild permission."}</p></details>
        </article>
        <article className="surface">
          <h2>{locale==='ja'?'設定変更の記録':'Setting changes'}</h2>
          {data.audit.length?data.audit.slice(0,10).map((entry,index)=><p key={`${entry.at}-${index}`}>{new Date(entry.at).toLocaleString(locale==='ja'?'ja-JP':'en-US')} · {entry.changed.includes('analysisScope')?locale==='ja'?'分析する範囲を変更':'Analysis range changed':entry.changed.includes('weeklySummaryEnabled')?locale==='ja'?'週次まとめを変更':'Weekly summary changed':locale==='ja'?'設定を変更':'Settings changed'} · {entry.actorId?`@${entry.actorId}`:entry.source==='WEB_DASHBOARD'?locale==='ja'?'Web管理者':'Web admin':locale==='ja'?'管理者':'Administrator'}</p>):<p>{locale==='ja'?'変更履歴はまだありません。':'No setting changes yet.'}</p>}
        </article>
      </section>
    </>
  );

  const views = [
    home,
    journeyView,
    <section key="improve">{opportunityView}{actionView}</section>,
    resultView,
    settingsView,
    <section key="community" className="surface"><h1>{locale==='ja'?'普段参加している人の状態':'Community activity'}</h1>{data.community?<><p>{locale==='ja'?'継続して参加している人':'Continuing members'}: {data.community.classification.continuing}</p><p>{locale==='ja'?'最近活動が確認できない人':'No recent observed activity'}: {data.community.classification.inactive}</p><p>{locale==='ja'?'比較から除外したスタッフ':'Staff excluded from comparison'}: {data.community.classification.staffExcluded}</p><p>{locale==='ja'?data.community.observation:'Only activity visible to Discord is counted. Reading without interacting cannot be observed.'}</p></>:<p>{c.emptyDetail}</p>}</section>,
    <section key="compare" className="surface"><h1>{locale==='ja'?'新しい人との違い':'Compare participation'}</h1>{data.community?.compare.available?<><p>{locale==='ja'?`新しいメンバーは返信まで平均 ${data.community.compare.newcomers?.replyMinutes??'—'} 分、継続して参加している人は平均 ${data.community.compare.continuing?.replyMinutes??'—'} 分です。`:`New members waited ${data.community.compare.newcomers?.replyMinutes??'—'} minutes on average for a reply; continuing members waited ${data.community.compare.continuing?.replyMinutes??'—'} minutes.`}</p><p>{locale==='ja'?`返信を受けた人: 新しい人 ${data.community.compare.newcomers?.receivedReplyPercent}%、継続している人 ${data.community.compare.continuing?.receivedReplyPercent}%`:`Received a reply: new ${data.community.compare.newcomers?.receivedReplyPercent}%, continuing ${data.community.compare.continuing?.receivedReplyPercent}%`}</p><p>{locale==='ja'?`活動した日数: 新しい人 ${data.community.compare.newcomers?.activeDays} 日、継続している人 ${data.community.compare.continuing?.activeDays} 日`:`Active days: new ${data.community.compare.newcomers?.activeDays}, continuing ${data.community.compare.continuing?.activeDays}`}</p></>:<p>{locale==='ja'?'まだ比較できるだけのデータがありません。':'There is not enough data to compare yet.'}</p>}<h2>{locale==='ja'?'参加後の結果':'What happened after joining'}</h2>{data.community?.outcomes.patterns&&<p>{locale==='ja'?`最初の3日間に交流した異なる人数: その後も活動した人は平均 ${data.community.outcomes.patterns.retained.interactionPartners} 人、活動を確認できなかった人は平均 ${data.community.outcomes.patterns.notRetained.interactionPartners} 人。関連を示す比較であり、原因とは断定できません。`:`Distinct people interacted with in the first three days: ${data.community.outcomes.patterns.retained.interactionPartners} on average among members active later, versus ${data.community.outcomes.patterns.notRetained.interactionPartners} among those without later observed activity. This comparison does not establish cause.`}</p>}{data.community?<p>{locale==='ja'?`1週間後も活動が確認できた ${data.community.outcomes.retained} 人、確認できなかった ${data.community.outcomes.notRetained} 人、まだ判定前 ${data.community.outcomes.pending} 人、データ不足 ${data.community.outcomes.insufficient} 人。`:`Observed a week later ${data.community.outcomes.retained}; not observed ${data.community.outcomes.notRetained}; pending ${data.community.outcomes.pending}; insufficient data ${data.community.outcomes.insufficient}.`}</p>:null}{data.community?.outcomes.patterns&&<p>{locale==='ja'?`継続した人は ${data.community.outcomes.patterns.retained.receivedReplyPercent}% が返信を受け、継続しなかった人は ${data.community.outcomes.patterns.notRetained.receivedReplyPercent}% でした。関連が見られますが、原因とは断定できません。`:`${data.community.outcomes.patterns.retained.receivedReplyPercent}% of continuing newcomers received a reply, versus ${data.community.outcomes.patterns.notRetained.receivedReplyPercent}% of those without later observed activity. This is an association, not proof of cause.`}</p>}{data.community?.suggestion&&<p>{locale==='ja'?data.community.suggestion.text:'New members appear to wait longer for replies. Consider testing a staff alert for unanswered posts.'}</p>}{data.community?.compare.available&&<p>{locale==='ja'?`活動したチャンネル: 新しい人 平均 ${data.community.compare.newcomers?.channelCount}、継続している人 平均 ${data.community.compare.continuing?.channelCount}。Voice参加: ${wholePercent(data.community.compare.newcomers?.voicePercent??null)} と ${wholePercent(data.community.compare.continuing?.voicePercent??null)}。イベント操作: ${wholePercent(data.community.compare.newcomers?.eventPercent??null)} と ${wholePercent(data.community.compare.continuing?.eventPercent??null)}。`:`Channels used: new ${data.community.compare.newcomers?.channelCount}, continuing ${data.community.compare.continuing?.channelCount}. Voice: ${wholePercent(data.community.compare.newcomers?.voicePercent??null)} vs ${wholePercent(data.community.compare.continuing?.voicePercent??null)}. Event actions: ${wholePercent(data.community.compare.newcomers?.eventPercent??null)} vs ${wholePercent(data.community.compare.continuing?.eventPercent??null)}.`}</p>}{data.community?.outcomes.patterns&&<p>{locale==='ja'?`継続した人の最初の3日間: Voice ${wholePercent(data.community.outcomes.patterns.retained.voicePercent)}、イベント操作 ${wholePercent(data.community.outcomes.patterns.retained.eventPercent)}。継続しなかった人: Voice ${wholePercent(data.community.outcomes.patterns.notRetained.voicePercent)}、イベント操作 ${wholePercent(data.community.outcomes.patterns.notRetained.eventPercent)}。`:`First three days: those observed later had Voice ${wholePercent(data.community.outcomes.patterns.retained.voicePercent)} and event actions ${wholePercent(data.community.outcomes.patterns.retained.eventPercent)}; those without later observed activity had Voice ${wholePercent(data.community.outcomes.patterns.notRetained.voicePercent)} and event actions ${wholePercent(data.community.outcomes.patterns.notRetained.eventPercent)}.`}</p>}</section>,
    <section key="channels" className="surface"><h1>{locale==='ja'?'チャンネルごとの役割':'Channels used by new members'}</h1>{data.community?.channels.length?data.community.channels.map(row=><article key={row.channelId}><h2>{data.options.channels.find(option=>option.id===row.channelId)?.label??`#${row.channelId}`}</h2><p>{locale==='ja'?`新しいメンバー ${row.newcomers} 人 · 返信を受けた ${wholePercent(row.receivedReplyPercent)} · 他のチャンネルでも活動 ${wholePercent(row.laterElsewherePercent)} · 1週間後も活動 ${wholePercent(row.weekLaterPercent)}`:`${row.newcomers} new members · ${wholePercent(row.receivedReplyPercent)} received a reply · ${wholePercent(row.laterElsewherePercent)} active elsewhere · ${wholePercent(row.weekLaterPercent)} observed a week later`}</p></article>):<p>{locale==='ja'?'表示できるチャンネルはまだありません。少人数の詳細は表示しません。':'No channels can be shown yet. Small groups are hidden.'}</p>}</section>,
  ];
  return (
    <div className="product">
      <aside className="sidebar">
        <a className="brand" href="/">
          N<span>✦</span>XUS
        </a>
        <p>NEXUS</p>
        {data.guilds&&data.guilds.length>1&&<label>{locale==="ja"?"サーバー":"Server"}<select value={data.selectedGuildId} onChange={e=>{window.location.href=`/auth/select?guild=${encodeURIComponent(e.target.value)}`;}}>{data.guilds.map(guild=><option key={guild.id} value={guild.id}>{guild.name}</option>)}</select></label>}
        <nav>
          {c.nav.map((label, i) => (
            <button
              key={label}
              aria-current={page === i ? "page" : undefined}
              onClick={() => setPage(i)}
            >
              <span aria-hidden="true">
                {["⌂", "↗", "◇", "◎", "⚙", "◉", "⇄", "#"][i]}
              </span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => { const next=locale === "en" ? "ja" : "en"; setLocale(next); document.cookie=`nexus_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`; }}>
            {locale === "en" ? "日本語" : "English"}
          </button>
          <small>v0.5.2 · {locale === "ja" ? "本番" : "Production"}</small>
          {data.guilds?.[0]?.name!=="Development guild"&&<a href="/auth/logout">{locale==="ja"?"サインアウト":"Sign out"}</a>}
        </div>
      </aside>
      <main className="content">
        <div className="mobile-head">
          <a className="brand" href="/">
            N<span>✦</span>XUS
          </a>
          <select
            value={page}
            onChange={(e) => setPage(Number(e.target.value))}
          >
            {c.nav.map((label, i) => (
              <option value={i} key={label}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {views[page]}
        <p className="status" role="status">
          {status}
        </p>
        <footer className="product-footer">
          {locale === "ja"
            ? "必要な活動データだけを使用します · 欠損データをゼロにしません"
            : "Uses only the activity data needed here · Missing data is not zero"}
        </footer>
      </main>
    </div>
  );
}

function Setup({
  data,
  c,
  locale,
  busy,
  preview,
  prepare,
  publish,
}: {
  data: HomePresentation;
  c: Copy;
  locale: Locale;
  busy: boolean;
  preview: Preview | null;
  prepare: (body: unknown, kind: "activation" | "onboarding") => Promise<void>;
  publish: () => Promise<void>;
}) {
  const [goal, setGoal] = useState<"reply" | "message" | "event" | null>(null);
  const connected = data.setup.steps.find(step => step.key === "connect")?.complete ?? false;
  const defined = data.setup.steps.find(step => step.key === "activation")?.complete ?? false;
  const native = data.setup.nativeOnboardingEnabled ?? false;
  return (
    <section className="setup-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {locale === "ja" ? "ガイド付きセットアップ" : "GUIDED SETUP"}
          </p>
          <h2>{c.setup}</h2>
        </div>
      </div>
      <p className="inline-note">{connected
        ? locale === "ja" ? "基本的な測定はすでに始まっています。" : "Basic measurement is already running."
        : locale === "ja" ? "接続を確認中です。測定できる項目から記録します。" : "Checking the connection. NEXUS records what it can already observe."}</p>
      {!defined && <>
        <h3>{locale === "ja" ? "新規メンバーの最初の成功は何ですか？" : "What should a successful newcomer do first?"}</h3>
        <div className="preset-row" role="radiogroup">
          {(["reply", "message", "event"] as const).map(option => <label key={option}>
            <input type="radio" name="goal" checked={goal === option} onChange={() => setGoal(option)} />
            {option === "reply" ? locale === "ja" ? "誰かから返信を受ける" : "Receive a reply" : option === "message" ? locale === "ja" ? "最初のメッセージを送る" : "Send a first message" : locale === "ja" ? "イベントに参加する" : "Join an event"}
          </label>)}
        </div>
        <button disabled={busy || !goal} onClick={() => goal && void prepare({action:"activation_preset",preset:goal},"activation")}>{locale === "ja" ? "成功の目標を保存" : "Save success goal"}</button>
      </>}
      <p className="inline-note">{native
        ? locale === "ja" ? "Discord のオンボーディングを使用中です。NEXUS は変更せずに観測します。" : "Discord onboarding is already in use. NEXUS will observe it without changing it."
        : locale === "ja" ? "Discord のオンボーディングは現在使われていません。歓迎フローは後で追加できます。" : "Discord onboarding is not currently in use. You can add a welcome flow later."}</p>
      {preview && (
        <PreviewCard
          title={locale === "ja" ? "選択した最初の成功を確認" : "Confirm your first success"}
          c={c}
          busy={busy}
          publish={publish}
        />
      )}
    </section>
  );
}
function Policy({
  template,
  c,
  locale,
}: {
  template: {
    trigger: string;
    delaySeconds: number;
    condition: string;
    action: string;
    safety: { mode: string; contactsPerWeek: number; dmPerDay: number };
  };
  c: Copy;
  locale: Locale;
}) {
  return (
    <div className="policy-editor">
      <div>
        <span>{c.when}</span>
        <p>{semantic(template.trigger, locale)}</p>
      </div>
      <div>
        <span>{c.wait}</span>
        <p>{duration(template.delaySeconds, locale)}</p>
      </div>
      <div>
        <span>{c.if}</span>
        <p>{semantic(template.condition, locale)}</p>
      </div>
      <div>
        <span>{c.then}</span>
        <p>{semantic(template.action, locale)}</p>
      </div>
      <div>
        <span>{c.safety}</span>
        <p>
          {semantic(template.safety.mode, locale)} ·{" "}
          {locale === "ja"
            ? `週 ${template.safety.contactsPerWeek} 回まで`
            : `${template.safety.contactsPerWeek} contacts/week`}
        </p>
      </div>
    </div>
  );
}
function PreviewCard({
  title,
  c,
  busy,
  publish,
}: {
  title: string;
  c: Copy;
  busy: boolean;
  publish: () => Promise<void>;
}) {
  return (
    <div className="publish-preview">
      <strong>{title}</strong>
      <button disabled={busy} onClick={() => void publish()}>
        {c.publish}
      </button>
    </div>
  );
}
function NextStep({
  prefix,
  label,
  onClick,
}: {
  prefix: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <div className="next-step">
      <span>{prefix}</span>
      <button onClick={onClick}>{label} →</button>
    </div>
  );
}
function Skeleton({ label }: { label: string }) {
  return (
    <div className="skeleton" role="status">
      <span />
      <span />
      <span />
      <p>{label}</p>
    </div>
  );
}
function Empty({ c }: { c: Copy }) {
  return (
    <div className="empty">
      <strong>—</strong>
      <h2>{c.empty}</h2>
      <p>{c.emptyDetail}</p>
    </div>
  );
}
function semantic(value: string, locale: Locale) {
  const en: Record<string, string> = {
    "member.joined": "A newcomer joins",
    "message.sent": "A newcomer sends their first message",
    not_connected: "They have not received a direct reply",
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
    not_connected: "直接返信をまだ受けていない",
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
function duration(seconds: number, locale: Locale) {
  if (seconds === 0) return locale === "ja" ? "すぐに" : "Immediately";
  const hours = seconds / 3600;
  return hours % 24 === 0
    ? locale === "ja"
      ? `${hours / 24}日`
      : `${hours / 24} days`
    : locale === "ja"
      ? `${hours}時間`
      : `${hours} hours`;
}
function replyLabels(locale: Locale) {
  return locale === "ja"
    ? {
        under_5m: "5分未満",
        "5m_1h": "5分〜1時間",
        "1h_6h": "1〜6時間",
        "6h_24h": "6〜24時間",
        unanswered_24h: "24時間返信なし",
      }
    : {
        under_5m: "Under 5m",
        "5m_1h": "5m–1h",
        "1h_6h": "1–6h",
        "6h_24h": "6–24h",
        unanswered_24h: "Unanswered 24h",
      };
}
function metricLabel(metric: string, locale: Locale) {
  const labels = {
    en: {
      activation: "successful newcomers",
      connection: "first replies",
      retention: "7 day activity",
    },
    ja: {
      activation: "新規メンバーの成功",
      connection: "最初の返信",
      retention: "7日後の活動",
    },
  };
  return labels[locale][metric as keyof typeof labels.en] ?? metric;
}
function evidenceLabel(
  item: ResultsPresentation["items"][number],
  locale: Locale,
) {
  if (item.state === "stopped") return locale === "ja" ? "停止済み" : "Stopped";
  if (item.state === "paused") return locale === "ja" ? "一時停止" : "Paused";
  const labels = {
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
  };
  return labels[locale][item.evidence];
}
function learning(
  evidence: ResultsPresentation["items"][number]["evidence"],
  locale: Locale,
) {
  const en = {
    supported: "Current results support this improvement. Keep checking as more data arrives.",
    directional: "A positive trend is appearing. Continue collecting before deciding.",
    inconclusive: "No clear difference yet. Continue collecting.",
    insufficient: "Not enough data yet. Continue collecting.",
    guardrail: "NEXUS stopped this check for safety. Review the improvement before continuing.",
  };
  const ja = {
    supported: "現在の結果は改善を支持しています。データが増えても確認を続けてください。",
    directional: "良い傾向があります。判断まで集計を続けてください。",
    inconclusive: "はっきりした差はありません。集計を続けてください。",
    insufficient: "まだ判断できません。集計を続けてください。",
    guardrail: "安全のため停止しました。再開前に改善策を確認してください。",
  };
  return (locale === "ja" ? ja : en)[evidence];
}
