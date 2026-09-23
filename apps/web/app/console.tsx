"use client";
import { useState } from "react";
import type {
  ActionsPresentation,
  ActionTemplateKey,
  DiscordOptions,
  HomePresentation,
  JourneyPresentation,
  OpportunitiesPresentation,
  ResultsPresentation,
  SetupReason,
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
  opportunities: OpportunitiesPresentation | null;
  actions: ActionsPresentation | null;
  results: ResultsPresentation | null;
  options: DiscordOptions;
  admin: Admin | null;
};
const messages = {
  en: {
    nav: ["Home", "Journey", "Opportunities", "Actions", "Results", "Settings"],
    tagline: "See where newcomers drop off. Fix it. Measure what worked.",
    home: "Home",
    journey: "Journey",
    milestones: "New Member Journey Milestones",
    opportunities: "Opportunities",
    actions: "Actions",
    results: "Results",
    settings: "Settings",
    new_members: "New Members",
    activation_rate: "Activation",
    direct_reply_connection_rate: "First Connection",
    d7_active_retention: "D7 Retention",
    joined: "Joined",
    onboarded: "Onboarded",
    first_value: "First Value",
    connected: "Connected",
    d7_active: "D7 Active",
    previous: "Previous period",
    data: "Data health",
    empty: "No verified observations yet",
    emptyDetail:
      "NEXUS will show this view after scoped production activity is observed. Missing and immature observations are never treated as zero.",
    setup: "Start measuring community growth",
    connect: "Connect Discord",
    activation: "Define success",
    onboarding: "Configure onboarding",
    measuring: "Start measuring",
    complete: "Complete",
    todo: "Next step",
    communityOpportunity: "Community opportunity",
    measurementWarning: "Measurement warning",
    suggested: "Suggested next action",
    range: "Range",
    retention: "Retention cohorts",
    members: "Members",
    reply: "First reply distribution",
    trendActivation: "Activation trend",
    trendConnection: "First Connection trend",
    trendRetention: "D7 Retention trend",
    noOpportunity:
      "No evidence-backed community opportunity meets the threshold yet.",
    notCausal: "Observational signal — causality is not established.",
    createAction: "Create Action",
    template: "Template",
    destination: "Destination channel",
    event: "Scheduled event",
    recommendedChannels: "Recommended channels",
    review: "Review Action",
    publish: "Publish",
    published: "Published and active.",
    when: "WHEN",
    wait: "WAIT",
    if: "IF",
    then: "THEN",
    safety: "SAFETY",
    activeActions: "Active Actions",
    delivery: "Delivery health",
    noActions: "No action is active yet. Start from a guarded template.",
    learning: "What we learned",
    hypothesis: "Question",
    maturity: "Maturity",
    noResults:
      "No test result yet. Publish an Action, then compare it with a no-action control.",
    privacy: "Privacy & retention",
    team: "Team & access",
    plan: "Plan & usage",
    advanced: "Advanced methodology",
    configureActivation: "Use this preset",
    draftReady: "Draft is ready. Review and publish it.",
    language: "Language",
    unavailable: "Unavailable",
    healthy: "Healthy",
    partial: "Partial",
    provisional: "Maturing",
    mature: "Mature",
    eligible: "Eligible",
    observed: "Observed",
    control: "Control",
    treatment: "Treatment",
    rate: "Rate",
    triggered: "Triggered",
    approved: "Approved",
    delivered: "Delivered",
    failed: "Failed",
    unknown: "Unknown",
    suppressed: "Suppressed",
    seeEvidence: "See Evidence",
    dismiss: "Dismiss for now",
    why: "Why this appeared",
    createFromOpportunity: "Create Action",
    viewOpportunities: "View Opportunities",
    testAction: "Test this Action",
    viewActivity: "View Activity",
    approve: "Approve",
    approvalNeeded: "Approval needed",
    question: "Does this Action improve Activation?",
    primaryOutcome: "Primary outcome",
    assignment: "Assignment",
    dailyBlocks: "Daily time blocks",
    reviewTest: "Review Test",
    startTest: "Start Test",
    pauseTest: "Pause Test",
    stopTest: "Stop Test",
    viewAction: "View Action",
    continueCollecting: "Continue collecting",
    recommendedSetup: "Use Recommended Setup",
    optionsUnavailable:
      "Discord choices are unavailable. Refresh setup or use the Discord panel.",
    loading: "Loading verified data…",
    current: "Current",
    baseline: "Baseline",
    difference: "Difference",
    sample: "Sample",
    coverage: "Coverage",
    stage: "Journey stage",
    guardrails: "Guardrails",
    randomization: "Randomization",
    timeline: "Timeline",
    refresh: "Refresh",
    next: "Next",
  },
  ja: {
    nav: ["ホーム", "ジャーニー", "機会", "アクション", "結果", "設定"],
    tagline: "新規メンバーが離脱する場所を見つけ、改善し、効果を測定します。",
    home: "ホーム",
    journey: "ジャーニー",
    milestones: "新規メンバーのジャーニー・マイルストーン",
    opportunities: "改善機会",
    actions: "アクション",
    results: "結果",
    settings: "設定",
    new_members: "新規メンバー",
    activation_rate: "アクティベーション",
    direct_reply_connection_rate: "最初のつながり",
    d7_active_retention: "D7 継続率",
    joined: "参加",
    onboarded: "オンボード完了",
    first_value: "初回価値",
    connected: "つながり",
    d7_active: "D7 アクティブ",
    previous: "前期間",
    data: "データ健全性",
    empty: "検証済みの観測データはまだありません",
    emptyDetail:
      "対象範囲の本番アクティビティを観測すると表示されます。欠損・未成熟な値をゼロとして扱いません。",
    setup: "コミュニティ成長の測定を始める",
    connect: "Discord を接続",
    activation: "成功を定義",
    onboarding: "オンボーディングを設定",
    measuring: "測定を開始",
    complete: "完了",
    todo: "次のステップ",
    communityOpportunity: "コミュニティの改善機会",
    measurementWarning: "測定上の警告",
    suggested: "推奨アクション",
    range: "期間",
    retention: "継続率コホート",
    members: "メンバー",
    reply: "初回返信の分布",
    trendActivation: "アクティベーション推移",
    trendConnection: "最初のつながり推移",
    trendRetention: "D7 継続率推移",
    noOpportunity: "基準を満たす、根拠のある改善機会はまだありません。",
    notCausal: "観察シグナルです。因果関係は確立されていません。",
    createAction: "アクションを作成",
    template: "テンプレート",
    destination: "送信先チャンネル",
    event: "予定イベント",
    recommendedChannels: "推奨チャンネル",
    review: "アクションを確認",
    publish: "公開",
    published: "公開し、有効化しました。",
    when: "いつ",
    wait: "待機",
    if: "条件",
    then: "実行",
    safety: "安全性",
    activeActions: "有効なアクション",
    delivery: "配信の健全性",
    noActions:
      "有効なアクションはありません。安全設定済みテンプレートから開始できます。",
    learning: "わかったこと",
    hypothesis: "検証する問い",
    maturity: "成熟度",
    noResults:
      "テスト結果はまだありません。アクションを公開し、何もしない対照群と比較してください。",
    privacy: "プライバシーと保持期間",
    team: "チームとアクセス",
    plan: "プランと利用状況",
    advanced: "高度な測定方法",
    configureActivation: "このプリセットを使う",
    draftReady: "下書きを作成しました。確認して公開してください。",
    language: "言語",
    unavailable: "利用不可",
    healthy: "良好",
    partial: "一部",
    provisional: "成熟待ち",
    mature: "成熟済み",
    eligible: "対象",
    observed: "観測",
    control: "対照群",
    treatment: "施策群",
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
    createFromOpportunity: "アクションを作成",
    viewOpportunities: "改善機会を見る",
    testAction: "このアクションをテスト",
    viewActivity: "アクティビティを見る",
    approve: "承認",
    approvalNeeded: "承認が必要",
    question: "このアクションはアクティベーションを改善するか？",
    primaryOutcome: "主要成果",
    assignment: "割付方法",
    dailyBlocks: "日次タイムブロック",
    reviewTest: "テストを確認",
    startTest: "テストを開始",
    pauseTest: "テストを一時停止",
    stopTest: "テストを停止",
    viewAction: "アクションを見る",
    continueCollecting: "データ収集を続ける",
    recommendedSetup: "推奨設定を使う",
    optionsUnavailable:
      "Discord の選択肢を取得できません。セットアップを更新するか Discord パネルを使用してください。",
    loading: "検証済みデータを読み込み中…",
    current: "現在",
    baseline: "基準値",
    difference: "差分",
    sample: "サンプル",
    coverage: "カバレッジ",
    stage: "ジャーニー段階",
    guardrails: "ガードレール",
    randomization: "割付",
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
    RETENTION_DROP: "D7 retention has dropped",
    DATA_COVERAGE_DROP: "Measurement coverage needs attention",
    ACTION_FAILURE_SPIKE: "Action delivery failures increased",
  },
  ja: {
    ACTIVATION_DROP: "初回価値に到達する新規メンバーが減少",
    TTFV_SPIKE: "初回価値までの時間が長期化",
    CONNECTION_DROP: "最初の返信を受ける新規メンバーが減少",
    REPLY_LATENCY_SPIKE: "最初の返信までの時間が長期化",
    ONBOARDING_DROP: "オンボーディング完了率が低下",
    HOME_ACTION_DROP: "ホームアクション完了率が低下",
    RETENTION_DROP: "D7 継続率が低下",
    DATA_COVERAGE_DROP: "測定カバレッジの確認が必要",
    ACTION_FAILURE_SPIKE: "アクション配信失敗が増加",
  },
};
const templateNames: Record<Locale, Record<ActionTemplateKey, string>> = {
  en: {
    reply_rescue: "Reply Rescue",
    welcome_helper: "Welcome Helper",
    inactive_follow_up: "Inactive Newcomer Follow-up",
    channel_recommendation: "Channel Recommendation",
    event_recommendation: "Event Recommendation",
  },
  ja: {
    reply_rescue: "返信レスキュー",
    welcome_helper: "ウェルカム・ヘルパー",
    inactive_follow_up: "非アクティブ新規メンバーのフォロー",
    channel_recommendation: "チャンネル推薦",
    event_recommendation: "イベント推薦",
  },
};
const actionName = (name: string, locale: Locale) => {
  const key = Object.entries(templateNames.en).find(
    ([, label]) => label === name,
  )?.[0] as ActionTemplateKey | undefined;
  return key ? templateNames[locale][key] : name;
};
const resultName = (name: string, locale: Locale) => {
  const base = name.endsWith(" Test") ? name.slice(0, -5) : name;
  const translated = actionName(base, locale);
  return translated === base
    ? name
    : locale === "ja"
      ? `${translated} テスト`
      : `${translated} Test`;
};
const percent = (n: number | null) =>
  n === null ? "—" : `${(n * 100).toFixed(1)}%`;
const signed = (n: number | null, rate = true) =>
  n === null
    ? "—"
    : `${n > 0 ? "+" : n < 0 ? "−" : ""}${rate ? `${(Math.abs(n) * 100).toFixed(1)} pt` : Math.abs(n).toLocaleString()}`;

export default function Console({ data }: { data: ProductData }) {
  const [locale, setLocale] = useState<Locale>("en"),
    [page, setPage] = useState(0),
    [journey, setJourney] = useState(data.journey),
    [range, setRange] = useState<7 | 30 | 90>(data.journey?.range ?? 30),
    [journeyLoading, setJourneyLoading] = useState(false),
    [template, setTemplate] = useState<ActionTemplateKey>("reply_rescue"),
    [channelId, setChannelId] = useState(data.options.channels[0]?.id ?? ""),
    [eventId, setEventId] = useState(data.options.events[0]?.id ?? ""),
    [channels, setChannels] = useState<string[]>([]),
    [preview, setPreview] = useState<Preview | null>(null),
    [previewKind, setPreviewKind] = useState<
      "activation" | "onboarding" | "action" | "test" | null
    >(null),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [dismissed, setDismissed] = useState<string[]>([]),
    [evidence, setEvidence] = useState<string | null>(null),
    [testActionId, setTestActionId] = useState<string | null>(null),
    [actions, setActions] = useState(data.actions),
    [results, setResults] = useState(data.results);
  const c = messages[locale];
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
      if (!response.ok) throw new Error(result.error ?? "Request failed");
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
      ? c.healthy
      : label === "partial"
        ? c.partial
        : c.unavailable;
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
                {locale === "ja"
                  ? "コミュニティ成長 OS"
                  : "COMMUNITY GROWTH OS"}
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
          <section className="kpi-grid">
            {data.home.kpis.map((k) => (
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
                coverageLabel={healthText(k.coverage.label)}
              />
            ))}
          </section>
          <section className="split">
            <div className="surface">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {locale === "ja" ? "マイルストーン" : "MILESTONES"}
                  </p>
                  <h2>{c.milestones}</h2>
                </div>
                <button className="text-button" onClick={go(1)}>
                  {c.journey} →
                </button>
              </div>
              <JourneyFunnel stages={data.home.journey} labels={c} />
            </div>
            <div className="surface opportunity-spotlight">
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
                  <button onClick={go(2)}>{c.suggested} →</button>
                </>
              ) : (
                <p>{c.noOpportunity}</p>
              )}
              {data.home.measurementWarning && (
                <div className="measurement-warning">
                  <strong>{c.measurementWarning}</strong>
                  <span>
                    {
                      opportunityNames[locale][
                        data.home.measurementWarning.type
                      ]
                    }
                  </span>
                </div>
              )}
            </div>
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
            {locale === "ja" ? "参加後の歩み" : "LIFECYCLE"}
          </p>
          <h1>{c.milestones}</h1>
          <p className="orientation">
            {locale === "ja"
              ? "互換性のある母集団ごとに、参加後の主要な到達点を確認します。段階間の換算率ではありません。"
              : "Review lifecycle milestones using each metric’s valid eligible population. These are not sequential conversion rates."}
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
            {locale === "ja" ? "観察シグナル" : "OBSERVATIONAL SIGNALS"}
          </p>
          <h1>{c.opportunities}</h1>
          <p className="orientation">
            {locale === "ja"
              ? "比較可能な期間の変化を確認し、安全なアクションへ進みます。"
              : "Understand evidence-backed changes and move into a safe Action."}
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
                <p>
                  {c.stage}: {c[item.stage as keyof Copy]} · n=
                  {item.sampleSize.toLocaleString()} ·{" "}
                  {healthText(item.dataHealth.label)}
                </p>
                <small>{c.notCausal}</small>
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
                <button
                  onClick={() =>
                    setEvidence(evidence === item.id ? null : item.id)
                  }
                >
                  {c.seeEvidence}
                </button>
                {item.suggestedAction && (
                  <button
                    onClick={() => {
                      setTemplate(item.suggestedAction!);
                      setPage(3);
                    }}
                  >
                    {c.createFromOpportunity}
                  </button>
                )}
                <button
                  className="quiet"
                  onClick={() => setDismissed([...dismissed, item.id])}
                >
                  {c.dismiss}
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="surface">
          <p>{c.noOpportunity}</p>
        </section>
      )}
    </>
  );

  const actionView = (
    <>
      {breadcrumb(c.actions, templateNames[locale][template])}
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {locale === "ja" ? "安全な自動化" : "SAFE AUTOMATION"}
          </p>
          <h1>{c.actions}</h1>
          <p className="orientation">
            {locale === "ja"
              ? "条件・待機時間・実行内容・安全上限を確認して公開します。"
              : "Draft, review, publish, approve and monitor guarded community Actions."}
          </p>
        </div>
      </div>
      <section className="action-layout">
        <div className="builder-v3">
          <h2>{c.createAction}</h2>
          <label>
            {c.template}
            <select
              value={template}
              onChange={(e) => {
                setTemplate(e.target.value as ActionTemplateKey);
                setPreview(null);
              }}
            >
              {actions?.templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {templateNames[locale][t.key]}
                </option>
              ))}
            </select>
          </label>
          {selected && <Policy template={selected} c={c} locale={locale} />}{" "}
          {!data.options.available && selected?.requires.length ? (
            <p className="inline-note">{c.optionsUnavailable}</p>
          ) : null}
          {selected?.requires.includes("channelId") && (
            <label>
              {c.destination}
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
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
                onChange={(e) => setEventId(e.target.value)}
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
                  setChannels([...e.target.selectedOptions].map((o) => o.value))
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
            onClick={() =>
              void prepare(
                {
                  action: "action_template",
                  templateKey: template,
                  channelId: channelId || undefined,
                  eventId: eventId || undefined,
                  recommendedChannelIds: channels,
                },
                "action",
              )
            }
          >
            {c.review}
          </button>
          {preview && previewKind === "action" && (
            <PreviewCard
              title={`${templateNames[locale][template]} · v${preview.after.version}`}
              c={c}
              busy={busy}
              publish={publish}
            />
          )}
        </div>
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
                <Policy template={item} c={c} locale={locale} />
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
                      setPage(4);
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
              ? "何もしない対照群とアクション群を比較し、次の判断につなげます。"
              : "Compare no action with the treatment and decide what to do next."}
          </p>
        </div>
      </div>
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
                  ? `${actionName(selectedAction.name, locale)} はアクティベーションを改善するか？`
                  : `Does ${actionName(selectedAction.name, locale)} improve Activation?`}
              </strong>
            </div>
            <div>
              <span>{c.control}</span>
              <strong>
                {locale === "ja" ? "アクションなし" : "No action"}
              </strong>
            </div>
            <div>
              <span>{c.treatment}</span>
              <strong>{actionName(selectedAction.name, locale)}</strong>
            </div>
            <div>
              <span>{c.primaryOutcome}</span>
              <strong>{c.activation}</strong>
            </div>
            <div>
              <span>{c.assignment}</span>
              <strong>{c.dailyBlocks}</strong>
            </div>
          </div>
          {previewKind !== "test" ? (
            <button
              disabled={busy}
              onClick={() =>
                void prepare(
                  {
                    action: "experiment_draft",
                    actionId: testActionId,
                    primaryMetric: "activation",
                  },
                  "test",
                )
              }
            >
              {c.reviewTest}
            </button>
          ) : (
            preview && (
              <PreviewCard
                title={`${actionName(selectedAction.name, locale)} · ${c.startTest}`}
                c={{ ...c, publish: c.startTest }}
                busy={busy}
                publish={publish}
              />
            )
          )}
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
                      ? `施策群は対照群より ${metricLabel(item.primaryMetric, locale)} を改善するか？`
                      : `Does treatment improve ${metricLabel(item.primaryMetric, locale)} versus control?`}
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
                      <dd>
                        {item.maturity.mature} / {item.maturity.assigned}
                      </dd>
                    </div>
                    <div>
                      <dt>{c.coverage}</dt>
                      <dd>{healthText(item.dataHealth.label)}</dd>
                    </div>
                    <div>
                      <dt>{c.guardrails}</dt>
                      <dd>
                        {item.guardrailStatus === "healthy"
                          ? c.healthy
                          : c.partial}
                      </dd>
                    </div>
                    <div>
                      <dt>{c.randomization}</dt>
                      <dd>
                        {item.randomization === "time_block"
                          ? c.dailyBlocks
                          : locale === "ja"
                            ? "メンバー単位"
                            : "Member"}
                      </dd>
                    </div>
                    <div>
                      <dt>{c.timeline}</dt>
                      <dd>
                        {item.timeline.windowDays}
                        {locale === "ja" ? "日" : " days"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
              <details>
                <summary>{c.advanced}</summary>
                <p>
                  {locale === "ja"
                    ? "成熟済みの全割付を、配信失敗・不明を含めて分析します。"
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
                <button onClick={() => setPage(3)}>{c.viewAction}</button>
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
      ) : (
        <section className="surface">
          <p>{c.noResults}</p>
        </section>
      )}
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
              ? "言語、プライバシー、アクセス、プランを管理します。"
              : "Manage language, privacy, access and plan information."}
          </p>
        </div>
      </div>
      <section className="settings-grid">
        <article className="surface">
          <h2>{c.language}</h2>
          <div className="segmented">
            <button
              aria-pressed={locale === "en"}
              onClick={() => setLocale("en")}
            >
              English
            </button>
            <button
              aria-pressed={locale === "ja"}
              onClick={() => setLocale("ja")}
            >
              日本語
            </button>
          </div>
          <p>
            {locale === "ja"
              ? "Discord パネルの言語は Discord 内の設定で管理します。"
              : "Discord panel language is managed from Settings in Discord."}
          </p>
        </article>
        <article className="surface">
          <h2>{c.plan}</h2>
          <strong className="big-setting">
            {data.admin?.usage.plan ?? "—"}
          </strong>
          <p>
            {data.admin
              ? locale === "ja"
                ? `${data.admin.usage.used} / ${data.admin.usage.included ?? "個別設定"} MTM · 予測 ${data.admin.usage.projected}`
                : `${data.admin.usage.used} / ${data.admin.usage.included ?? "Custom"} MTM · projected ${data.admin.usage.projected}`
              : c.unavailable}
          </p>
        </article>
        <article className="surface">
          <h2>{c.privacy}</h2>
          <p>
            {locale === "ja"
              ? `詳細データ: ${String(data.admin?.settings.detailedRetentionDays ?? "—")} 日 · 集計データ: ${String(data.admin?.settings.aggregateRetentionMonths ?? "—")} か月`
              : `Detailed data: ${String(data.admin?.settings.detailedRetentionDays ?? "—")} days · Aggregate data: ${String(data.admin?.settings.aggregateRetentionMonths ?? "—")} months`}
          </p>
          <p>
            {locale === "ja"
              ? "メッセージ本文、添付、DM、プレゼンスは保存しません。"
              : "Message contents, attachments, DMs and presence are not stored."}
          </p>
        </article>
        <article className="surface">
          <h2>{c.team}</h2>
          <p>
            {locale === "ja"
              ? "管理には「サーバー管理」権限または設定済み管理ロールが必要です。"
              : "Administration requires Manage Guild or the configured NEXUS admin role."}
          </p>
        </article>
      </section>
    </>
  );

  const views = [
    home,
    journeyView,
    opportunityView,
    actionView,
    resultView,
    settingsView,
  ];
  return (
    <div className="product">
      <aside className="sidebar">
        <a className="brand" href="/">
          N<span>✦</span>XUS
        </a>
        <p>{locale === "ja" ? "コミュニティ成長" : "COMMUNITY GROWTH"}</p>
        <nav>
          {c.nav.map((label, i) => (
            <button
              key={label}
              aria-current={page === i ? "page" : undefined}
              onClick={() => setPage(i)}
            >
              <span aria-hidden="true">
                {["⌂", "↗", "◇", "⚡", "◎", "⚙"][i]}
              </span>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setLocale(locale === "en" ? "ja" : "en")}>
            {locale === "en" ? "日本語" : "English"}
          </button>
          <small>v0.3.1 · {locale === "ja" ? "本番" : "Production"}</small>
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
            ? "メタデータのみ · サーバー単位の識別 · 欠損データをゼロにしません"
            : "Metadata only · Guild-scoped identity · Missing data is not zero"}
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
      <div className="setup-steps">
        {data.setup.steps.map((step, i) => (
          <article key={step.key} className={step.complete ? "done" : ""}>
            <span>{i + 1}</span>
            <div>
              <strong>{c[step.key]}</strong>
              <small>
                {step.complete ? c.complete : setupReason(step.reason, locale)}
              </small>
            </div>
          </article>
        ))}
      </div>
      {!data.setup.steps[1]?.complete && (
        <div className="preset-row">
          <button
            onClick={() =>
              void prepare(
                { action: "activation_preset", preset: "reply" },
                "activation",
              )
            }
            disabled={busy}
          >
            {c.configureActivation}:{" "}
            {locale === "ja" ? "直接返信" : "Direct reply"}
          </button>
          <button
            onClick={() =>
              void prepare(
                { action: "activation_preset", preset: "event" },
                "activation",
              )
            }
            disabled={busy}
          >
            {locale === "ja" ? "イベント参加" : "Event RSVP"}
          </button>
          <button
            onClick={() =>
              void prepare(
                { action: "activation_preset", preset: "message" },
                "activation",
              )
            }
            disabled={busy}
          >
            {locale === "ja" ? "最初の投稿" : "First message"}
          </button>
        </div>
      )}
      {!data.setup.steps[2]?.complete && data.setup.recommendedMode && (
        <button
          disabled={busy}
          onClick={() =>
            void prepare({ action: "onboarding_recommended" }, "onboarding")
          }
        >
          {c.recommendedSetup} ·{" "}
          {data.setup.recommendedMode === "native"
            ? locale === "ja"
              ? "Discord ネイティブ"
              : "Discord Native"
            : locale === "ja"
              ? "NEXUS フォールバック"
              : "NEXUS Fallback"}
        </button>
      )}
      {!data.setup.steps[2]?.complete && !data.setup.recommendedMode && (
        <p className="inline-note">
          {locale === "ja"
            ? "Discord で /nexus setup を開き、開始チャンネルとオンボーディング内容を選択してください。"
            : "Open /nexus setup in Discord to choose a start channel and onboarding content."}
        </p>
      )}
      {preview && (
        <PreviewCard
          title={`v${preview.after.version}`}
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
      <p>
        {c.safety}: {c.approvalNeeded}
      </p>
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
function setupReason(reason: SetupReason, locale: Locale) {
  const en: Record<SetupReason, string> = {
    ready: "Ready",
    capability_unknown: "Run Discord capability check",
    permissions_missing: "Required permissions are missing",
    ingestion_unavailable: "Data ingestion is not healthy",
    activation_missing: "Choose a success signal",
    native_not_ready: "Discord Native Onboarding is not ready",
    fallback_not_ready: "Configure a start channel and flow",
    hybrid_not_ready: "Complete Native and fallback setup",
    measurement_waiting: "Waiting for the first newcomer",
  };
  const ja: Record<SetupReason, string> = {
    ready: "準備完了",
    capability_unknown: "Discord 機能チェックを実行",
    permissions_missing: "必要な権限がありません",
    ingestion_unavailable: "データ取り込みを確認してください",
    activation_missing: "成功シグナルを選択",
    native_not_ready: "Discord Native Onboarding の準備が未完了",
    fallback_not_ready: "開始チャンネルとフローを設定",
    hybrid_not_ready: "Native とフォールバックの設定を完了",
    measurement_waiting: "最初の新規メンバーを待っています",
  };
  return (locale === "ja" ? ja : en)[reason];
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
      activation: "Activation",
      connection: "First Connection",
      retention: "Retention",
    },
    ja: {
      activation: "アクティベーション",
      connection: "最初のつながり",
      retention: "継続率",
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
      supported: "Evidence available",
      directional: "Early signal",
      inconclusive: "No clear difference",
      insufficient: item.maturity.mature ? "Collecting data" : "Preparing",
      guardrail: "Paused by guardrail",
    },
    ja: {
      supported: "エビデンスあり",
      directional: "初期シグナル",
      inconclusive: "明確な差なし",
      insufficient: item.maturity.mature ? "データ収集中" : "準備中",
      guardrail: "安全基準により一時停止",
    },
  };
  return labels[locale][item.evidence];
}
function learning(
  evidence: ResultsPresentation["items"][number]["evidence"],
  locale: Locale,
) {
  const en = {
    supported:
      "The treatment is outperforming control in the current mature sample.",
    directional:
      "Treatment is trending higher, but the evidence is not conclusive yet.",
    inconclusive: "The mature sample does not show a reliable difference.",
    insufficient:
      "More mature observations are needed before drawing a conclusion.",
    guardrail: "The test paused because a safety guardrail was crossed.",
  };
  const ja = {
    supported: "現在の成熟済みサンプルでは施策群が対照群を上回っています。",
    directional: "施策群が上回る傾向ですが、まだ結論には至りません。",
    inconclusive: "成熟済みサンプルでは信頼できる差を確認できません。",
    insufficient: "結論を出すには、より多くの観測値の成熟が必要です。",
    guardrail: "安全基準を超えたためテストを一時停止しました。",
  };
  return (locale === "ja" ? ja : en)[evidence];
}
