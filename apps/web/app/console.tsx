"use client";
import {
  OperationsView,
  JourneysView,
  TeamQueue,
  type IntegrationData,
} from "./operations-ui";
import { Attention } from "./attention";
import { useState, useEffect, useRef } from "react";
import { BrandAsset } from "./brand-asset";
import { ProductMenu, NavIcon } from "./product-navigation";
import { dashboardLocation, dashboardView } from "./navigation-model";
import { AccessNotice, type AccessState } from "./access-notice";
import { HomeSummary } from "./home-summary";
import { Measurements, AnalysisSummary } from "./measurements";
import { ServerConnection } from "./link/connection";
import { FailureNotice } from "./failure-ui";
import type { UserFailure } from "../../../packages/shared/src/error-types";
import { failureCopy } from "../../../packages/discord-panels/src/i18n/errors";
import { activityWindow } from "../../../packages/discord-panels/src/i18n/terminology";
import type { CommunityService } from "../../../packages/presentation/src/community";
import { t } from "../../../packages/discord-panels/src/i18n/index";
import { VERSION, RELEASE_CHANNEL } from "../../../packages/shared/src/version";
import { AdaptiveCommunity, CommunityModelEditor } from "./community-model";
import { communityModelSchema } from "../../../packages/shared/src/community-model";
import {
  messages,
  opportunityNames,
  semantic,
  replyLabels,
  metricLabel,
  learning,
  evidenceNames,
  type Copy,
} from "../../../packages/discord-panels/src/i18n/web";
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
  ResponseDistributionChart,
  TrendChart,
} from "./charts";

type Locale = "en" | "ja";
const navPages = [
  { label: "control.overview", view: 0, icon: "▦" },
  { label: "control.newMembers", view: 1, icon: "◉" },
  { label: "control.attention", view: 8, icon: "⌁" },
  { label: "operations.journeys", view: 10, icon: "⇢" },
  { label: "experience.insights", view: 5, icon: "◎" },
  { label: "experience.improvements", view: 2, icon: "✦" },
  { label: "control.results", view: 3, icon: "◫" },
  { label: "experience.goalsRules", view: 9, icon: "≡" },
  { label: "operations.model", view: 11, icon: "◈" },
  { label: "operations.integration", view: 12, icon: "↔" },
  { label: "operations.coverage", view: 13, icon: "◷" },
  { label: "operations.collection", view: 14, icon: "⇥" },
  { label: "control.settings", view: 4, icon: "⚙" },
] as const;
const goalChoices = [
  "reply",
  "lfg",
  "voice",
  "event",
  "feedback",
  "bug",
  "playtest",
] as const;
const wholePercent = (n: number | null) => (n === null ? "—" : `${n}%`);
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
  hostedBeta?: boolean;
  betaState?: AccessState;
  integration?: IntegrationData | null;
  failures?: Record<string, UserFailure>;
  home: HomePresentation | null;
  journey: JourneyPresentation | null;
  community: Awaited<ReturnType<CommunityService["overview"]>> | null;
  opportunities: OpportunitiesPresentation | null;
  actions: ActionsPresentation | null;
  results: ResultsPresentation | null;
  weeklyStatus: {
    state: string;
    status_note: string | null;
    attempted_at: string;
  } | null;
  audit: {
    at: string;
    action: string;
    source: string;
    actorId: string | null;
    changed: string[];
  }[];
  options: DiscordOptions;
  admin: Admin | null;
  guilds?: {
    id: string;
    name: string;
    installed: boolean;
    installUrl: string | null;
  }[];
  developmentAuth?: boolean;
  selectedGuildId?: string;
  runtime?: {
    version: string;
    buildSha: string;
    releaseChannel: string;
    guildHash: string;
    gatewayConnected: boolean;
    commandsRegistered: boolean;
    interactionTransport: string;
    lastInteractionResult: string;
  };
};
const templateNameKeys: Record<
  ActionTemplateKey,
  | "testAction.reply_rescue"
  | "testAction.welcome_helper"
  | "testAction.inactive_follow_up"
  | "testAction.channel_recommendation"
  | "testAction.event_recommendation"
> = {
  reply_rescue: "testAction.reply_rescue",
  welcome_helper: "testAction.welcome_helper",
  inactive_follow_up: "testAction.inactive_follow_up",
  channel_recommendation: "testAction.channel_recommendation",
  event_recommendation: "testAction.event_recommendation",
};
const internalTemplateNames: Record<ActionTemplateKey, string> = {
  reply_rescue: "Reply Rescue",
  welcome_helper: "Welcome Helper",
  inactive_follow_up: "Inactive Newcomer Follow-up",
  channel_recommendation: "Channel Recommendation",
  event_recommendation: "Event Recommendation",
};
const actionName = (name: string, locale: Locale) => {
  const key = Object.entries(internalTemplateNames).find(
    ([, label]) => label === name,
  )?.[0] as ActionTemplateKey | undefined;
  return key ? t(locale, templateNameKeys[key]) : name;
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

export default function Console({
  data,
  initialLocale = "en",
  initialView = 0,
}: {
  data: ProductData;
  initialLocale?: Locale;
  initialView?: number;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale),
    [page, setPageState] = useState(initialView),
    [showHomeDetail, setShowHomeDetail] = useState(false),
    [switchingGuild, setSwitchingGuild] = useState(false),
    [analysisTab, setAnalysisTab] = useState<
      "overall" | "channels" | "behavior"
    >("overall"),
    [journey, setJourney] = useState(data.journey),
    [range, setRange] = useState<7 | 30 | 90>(data.journey?.range ?? 30),
    [journeyLoading, setJourneyLoading] = useState(false),
    [template, setTemplate] = useState<ActionTemplateKey>("reply_rescue"),
    [showImprovementSetup, setShowImprovementSetup] = useState(false),
    [adaptiveData, setAdaptiveData] = useState(data.community?.adaptive),
    [preflightState, setPreflightState] = useState<
      "ready" | "permission_needed" | "unavailable" | null
    >(null),
    [preflightFix, setPreflightFix] = useState<string | null>(null),
    [testSent, setTestSent] = useState(false),
    [runMode, setRunMode] = useState<"suggest" | "approval" | "auto">(
      "approval",
    ),
    [channelId, setChannelId] = useState(
      data.options.channels.find(
        (option) =>
          option.id === data.admin?.settings.adminNotificationChannelId,
      )?.id ??
        data.options.channels[0]?.id ??
        "",
    ),
    [notificationRevision, setNotificationRevision] = useState(
      Number(data.admin?.settings.revision ?? 0),
    ),
    [weeklyEnabled, setWeeklyEnabled] = useState(
      Boolean(data.admin?.settings.weeklySummaryEnabled),
    ),
    [weeklyChannelId, setWeeklyChannelId] = useState(
      String(
        data.admin?.settings.weeklySummaryChannelId ??
          data.options.channels[0]?.id ??
          "",
      ),
    ),
    [weeklyDay, setWeeklyDay] = useState(
      Number(data.admin?.settings.weeklySummaryDay ?? 1),
    ),
    [weeklyHour, setWeeklyHour] = useState(
      Number(data.admin?.settings.weeklySummaryHour ?? 9),
    ),
    [timezone, setTimezone] = useState(
      String(data.admin?.settings.timezone ?? "UTC"),
    ),
    [helperEnabled, setHelperEnabled] = useState(
      Boolean(data.admin?.settings.helperEnabled),
    ),
    [helperChannelId, setHelperChannelId] = useState(
      String(
        data.admin?.settings.helperChannelId ??
          data.options.channels[0]?.id ??
          "",
      ),
    ),
    [helperRoleId, setHelperRoleId] = useState(
      String(data.admin?.settings.helperRoleId ?? ""),
    ),
    [responseMinutes, setResponseMinutes] = useState(
      Number(data.admin?.settings.firstResponseMinutes ?? 20),
    ),
    [savedResponseMinutes, setSavedResponseMinutes] = useState(
      Number(data.admin?.settings.firstResponseMinutes ?? 20),
    ),
    helperCooldown = Number(
      data.admin?.settings.helperAlertCooldownMinutes ?? 60,
    ),
    [retentionDays, setRetentionDays] = useState(
      Number(data.admin?.settings.detailedRetentionDays ?? 30),
    ),
    [scopeMode, setScopeMode] = useState<"all" | "include" | "exclude">(
      (
        data.admin?.settings.analysisScope as
          { mode?: "all" | "include" | "exclude" } | undefined
      )?.mode ?? "all",
    ),
    [savedScopeMode, setSavedScopeMode] = useState<
      "all" | "include" | "exclude"
    >(
      (
        data.admin?.settings.analysisScope as
          { mode?: "all" | "include" | "exclude" } | undefined
      )?.mode ?? "all",
    ),
    [scopeChannels, setScopeChannels] = useState<string[]>(
      (
        data.admin?.settings.analysisScope as
          { channelIds?: string[] } | undefined
      )?.channelIds ?? [],
    ),
    [staffRoles, setStaffRoles] = useState<string[]>(
      (data.admin?.settings.staffRoleIds as string[] | undefined) ?? [],
    ),
    [goalPreset, setGoalPreset] = useState<
      "multiplayer" | "early_access" | "live_service" | ""
    >(
      (data.admin?.settings.goalPreset as
        "multiplayer" | "early_access" | "live_service" | null) ?? "",
    ),
    [newMemberGoals, setNewMemberGoals] = useState<string[]>(
      (data.admin?.settings.newMemberGoals as string[] | undefined) ?? [],
    ),
    [importantChannels, setImportantChannels] = useState<
      Array<{
        channelId: string;
        purpose: "lfg" | "feedback" | "bug" | "playtest" | "discussion";
      }>
    >(
      (data.admin?.settings.importantChannels as
        | Array<{
            channelId: string;
            purpose: "lfg" | "feedback" | "bug" | "playtest" | "discussion";
          }>
        | undefined) ?? [],
    ),
    [eventId, setEventId] = useState(data.options.events[0]?.id ?? ""),
    [channels, setChannels] = useState<string[]>([]),
    [preview, setPreview] = useState<Preview | null>(null),
    [previewKind, setPreviewKind] = useState<
      "activation" | "onboarding" | "action" | "test" | null
    >(null),
    [status, setStatus] = useState(""),
    [operationFailure, setOperationFailure] = useState<UserFailure | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [dismissed, setDismissed] = useState<string[]>([]),
    [dismissReasons, setDismissReasons] = useState<
      Record<string, "not_relevant" | "already_handled" | "later" | "">
    >({}),
    [evidence, setEvidence] = useState<string | null>(null),
    [testActionId, setTestActionId] = useState<string | null>(null),
    [actions, setActions] = useState(data.actions),
    [results, setResults] = useState(data.results),
    [attentionItems, setAttentionItems] = useState(
      data.community?.attention ?? [],
    ),
    [attentionRemoved, setAttentionRemoved] = useState(0),
    [attentionSnooze, setAttentionSnooze] = useState<
      Record<string, "30" | "60" | "today">
    >({});
  const c = messages[locale];
  const requestInFlight = useRef(false);
  const setPage = (view: number) => {
    const next = dashboardView(String(view));
    if (next !== page)
      window.history.pushState(
        null,
        "",
        dashboardLocation(window.location.href, next),
      );
    setPageState(next);
    setShowHomeDetail(false);
  };
  useEffect(() => {
    const restore = () => {
      setPageState(
        dashboardView(new URL(window.location.href).searchParams.get("view")),
      );
      setShowHomeDetail(false);
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const suggestedExcludedChannels = data.options.channels
    .filter((option) =>
      /^#?(?:bot|logs?|staff|mod(?:erator)?)(?:[-_]|$)/i.test(option.label),
    )
    .map((option) => option.id);
  const openImprovement = (key: ActionTemplateKey) => {
    setTemplate(key);
    setPreflightState(null);
    setTestSent(false);
    setShowImprovementSetup(true);
    setPage(2);
    requestAnimationFrame(() =>
      document
        .querySelector(".builder-v3")
        ?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  const selected = actions?.templates.find((t) => t.key === template),
    selectedAction = actions?.items.find((a) => a.id === testActionId);
  async function request(body: unknown) {
    if (requestInFlight.current) return null;
    if (data.betaState && data.betaState !== "ACTIVE") {
      setOperationFailure({ category: "BETA_ACCESS", effect: "NOT_STARTED" });
      return null;
    }
    requestInFlight.current = true;
    setBusy(true);
    setOperationFailure(null);
    let knownFailure: UserFailure | undefined;
    try {
      const response = await fetch("/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        result = await response.json();
      if (!response.ok) {
        if (response.status === 401 && result.error === "SESSION_EXPIRED") {
          window.location.href = "/auth/expired";
          throw new Error(
            locale === "ja"
              ? "Discordでもう一度ログインしてください"
              : "Sign in with Discord again.",
          );
        }
        const failure: UserFailure = result.failure ?? {
            category: "INTERNAL",
            effect: "UNKNOWN",
          },
          copy = failureCopy(locale, failure);
        knownFailure = failure;
        throw new Error(
          `${copy.title} ${copy.detail} ${copy.effect}${failure.reference ? ` (${failure.reference})` : ""}`,
        );
      }
      return result;
    } catch (error) {
      void error;
      setOperationFailure(
        knownFailure ?? {
          category: "INTERNAL",
          effect: "UNKNOWN",
          reference:
            "NXS-" +
            crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
        },
      );
      setStatus("");
      return null;
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  }
  async function readData<T>(url: string): Promise<T | null> {
    try {
      const response = await fetch(url, { cache: "no-store" }),
        body = await response.json();
      if (!response.ok) {
        setOperationFailure(
          body.failure ?? {
            category: "INTERNAL",
            effect: "NOT_STARTED",
            reference:
              "NXS-" +
              crypto
                .randomUUID()
                .replaceAll("-", "")
                .slice(0, 12)
                .toUpperCase(),
          },
        );
        return null;
      }
      return body as T;
    } catch {
      setOperationFailure({
        category: "INTERNAL",
        effect: "NOT_STARTED",
        reference:
          "NXS-" +
          crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
      });
      return null;
    }
  }
  async function changeAttention(
    item: { channelId: string; messageId: string },
    status: "ACKNOWLEDGED" | "SNOOZED" | "RESOLVED",
  ) {
    const choice = attentionSnooze[item.messageId] ?? "30";
    const result = await request({
      action: "attention_action",
      channelId: item.channelId,
      messageId: item.messageId,
      status,
      ...(status === "SNOOZED"
        ? choice === "today"
          ? { untilToday: true }
          : { minutes: Number(choice) }
        : {}),
    });
    if (result) {
      setAttentionItems((current) =>
        status === "ACKNOWLEDGED"
          ? current.map((row) =>
              row.messageId === item.messageId ? { ...row, status } : row,
            )
          : current.filter((row) => row.messageId !== item.messageId),
      );
      if (status !== "ACKNOWLEDGED") setAttentionRemoved((count) => count + 1);
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
        const current = await readData<ActionsPresentation>("/data/actions");
        if (current) setActions(current);
      } else if (kind === "test") {
        const current = await readData<ResultsPresentation>("/data/results");
        if (current) setResults(current);
      } else if (kind === "activation" || kind === "onboarding") {
        window.location.reload();
      }
    }
  }
  async function enableImprovement() {
    const check = await checkImprovement();
    if (check !== "ready") return;
    const draft = await request({
      action: "action_template",
      templateKey: template,
      channelId: channelId || undefined,
      eventId: eventId || undefined,
      recommendedChannelIds: channels,
      safetyMode: runMode,
    });
    if (!draft) return;
    const saved = await request({
      action: "publish",
      id: draft.after.id,
      expectedHead: draft.before?.id ?? null,
      confirmationHash: draft.confirmationHash,
    });
    if (!saved) return;
    const current = await readData<ActionsPresentation>("/data/actions");
    if (current) setActions(current);
    const resultResponse = await fetch("/data/results", { cache: "no-store" });
    if (resultResponse.ok)
      setResults((await resultResponse.json()) as ResultsPresentation);
    setStatus(t(locale, "web.improvement_enabled"));
  }
  async function checkImprovement() {
    const result = await request({
      action: "action_preflight",
      templateKey: template,
      channelId: channelId || undefined,
      eventId: eventId || undefined,
      recommendedChannelIds: channels,
      safetyMode: runMode,
    });
    if (!result) return null;
    setPreflightState(result.status);
    setPreflightFix(result.fix);
    if (result.failure) setOperationFailure(result.failure);
    return result.status as typeof preflightState;
  }
  async function sendTestNotification() {
    const check = await checkImprovement();
    if (check !== "ready") return;
    const result = await request({
      action: "action_test",
      templateKey: template,
      channelId: channelId || undefined,
      eventId: eventId || undefined,
      recommendedChannelIds: channels,
      safetyMode: runMode,
    });
    if (result) {
      setTestSent(true);
      setStatus(t(locale, "web.test_notification_sent_it_is_excluded"));
    }
  }
  async function dismissOpportunity(id: string, type: string) {
    const result = await request({
      action: "feedback_dismiss",
      suggestionType: type,
      reason: dismissReasons[id] || null,
    });
    if (result) setDismissed((current) => [...current, id]);
  }
  async function saveNotificationChannel(id: string) {
    const updated = await request({
      action: "notification_channel",
      channelId: id,
      revision: notificationRevision,
    });
    if (!updated) return;
    setNotificationRevision(Number(updated.revision));
    setChannelId(id);
    setStatus(t(locale, "web.notification_destination_saved"));
  }
  async function saveRetentionDays(days: 7 | 14 | 30) {
    const updated = await request({
      action: "retention_days",
      days,
      revision: notificationRevision,
    });
    if (!updated) return;
    setNotificationRevision(Number(updated.revision));
    setRetentionDays(days);
    setStatus(t(locale, "web.data_retention_setting_saved"));
  }
  async function saveWeekly(
    enabled: boolean,
    destination = weeklyChannelId,
    day = weeklyDay,
    hour = weeklyHour,
    zone = timezone,
  ) {
    const updated = await request({
      action: "weekly_summary",
      enabled,
      channelId: destination || null,
      day,
      hour,
      timezone: zone,
      revision: notificationRevision,
    });
    if (!updated) return;
    setNotificationRevision(Number(updated.revision));
    setWeeklyEnabled(enabled);
    setWeeklyChannelId(destination);
    setStatus(t(locale, "web.weekly_summary_saved"));
  }
  async function saveHelper(enabled = helperEnabled) {
    const updated = await request({
      action: "helper",
      enabled,
      channelId: helperChannelId || null,
      roleId: helperRoleId || null,
      responseMinutes,
      cooldownMinutes: helperCooldown,
      revision: notificationRevision,
    });
    if (!updated) return;
    setNotificationRevision(Number(updated.revision));
    setHelperEnabled(enabled);
    setSavedResponseMinutes(responseMinutes);
    setStatus(t(locale, "web.helper_alert_settings_saved"));
  }
  async function saveGoals() {
    const updated = await request({
      action: "goals",
      preset: goalPreset || null,
      goals: newMemberGoals,
      channels: importantChannels,
      revision: notificationRevision,
    });
    if (!updated) return;
    setNotificationRevision(Number(updated.revision));
    setStatus(t(locale, "web.community_focus_saved"));
  }
  async function startCheck() {
    if (!testActionId) return;
    const draft = await request({
      action: "experiment_draft",
      actionId: testActionId,
      primaryMetric:
        selectedAction?.name === "Reply Rescue" ? "connection" : "activation",
    });
    if (!draft) return;
    const saved = await request({
      action: "publish",
      id: draft.after.id,
      expectedHead: draft.before?.id ?? null,
      confirmationHash: draft.confirmationHash,
    });
    if (!saved) return;
    const current = await readData<ResultsPresentation>("/data/results");
    if (current) setResults(current);
    setTestActionId(null);
    setStatus(t(locale, "web.result_check_started"));
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
    setStatus(t(locale, "web.action_approved"));
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
      t(locale, state === "paused" ? "web.testPaused" : "web.testStopped"),
    );
  }
  async function changeRange(value: 7 | 30 | 90) {
    setRange(value);
    setJourneyLoading(true);
    try {
      const current = await readData<JourneyPresentation>(
        `/data/journey?range=${value}`,
      );
      if (current) setJourney(current);
      const measured = await readData<NonNullable<ProductData["community"]>>(
        `/data/community?range=${value}`,
      );
      if (measured?.adaptive) setAdaptiveData(measured.adaptive);
    } finally {
      setJourneyLoading(false);
    }
  }
  const healthText = (label: string) =>
    label === "healthy"
      ? t(locale, "web.collecting_normally")
      : label === "partial"
        ? t(locale, "web.some_data_could_not_be_collected")
        : t(locale, "web.not_enough_verified_data_is_available");
  const go = (index: number) => () => setPage(index);
  const breadcrumb = (...parts: string[]) => (
    <p className="breadcrumb">{[c.home, ...parts].join(" / ")}</p>
  );

  const home = (
    <>
      {breadcrumb()}{" "}
      <section className="operation-banner" role="status">
        <div>
          <p className="eyebrow">{t(locale, "control.attention")}</p>
          <h2>
            {!data.community?.daily.ready ||
            data.community.daily.attentionCount === null
              ? t(locale, "control.queueUnavailable")
              : Math.max(
                    0,
                    (data.community.daily.attentionCount ?? 0) -
                      attentionRemoved,
                  ) > 0
                ? t(locale, "experience.needsReply", {
                    count: Math.max(
                      0,
                      (data.community.daily.attentionCount ?? 0) -
                        attentionRemoved,
                    ),
                  })
                : t(locale, "experience.allClear")}
          </h2>
          <p>
            {t(locale, "experience.queueRule", { count: savedResponseMinutes })}
          </p>
        </div>
        <button onClick={go(8)}>{t(locale, "control.attention")} →</button>
      </section>
      {data.home ? (
        <>
          <section className="hero">
            <div>
              <p className="eyebrow">NEXUS</p>
              <h1>{t(locale, "experience.homeTitle")}</h1>
              <p className="orientation">{t(locale, "experience.homeLead")}</p>
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
          {data.community && (
            <p className="inline-note">
              <button onClick={() => setPage(9)}>
                {t(locale, "experience.howMeasured")} →
              </button>
            </p>
          )}
          {data.community && (
            <section className="surface">
              <h2>{t(locale, "web.how_new_members_are_participating")}</h2>
              {data.community.dataReady ? (
                <>
                  <div className="journey-steps">
                    {data.community.stages.map((step) => (
                      <p key={step.key}>
                        <strong>{step.count.toLocaleString()}</strong>{" "}
                        {t(locale, `control.${step.key as "joined"}`)}
                      </p>
                    ))}
                  </div>
                  {data.community.largestDrop && (
                    <p>
                      {t(locale, "web.the_largest_observed_drop_is_between", {
                        a: String(
                          t(
                            locale,
                            `control.${data.community.largestDrop.fromKey as "joined"}`,
                          ),
                        ),
                        b: String(
                          t(
                            locale,
                            `control.${data.community.largestDrop.toKey as "joined"}`,
                          ),
                        ),
                      })}
                    </p>
                  )}
                </>
              ) : (
                <p>{t(locale, "web.there_is_not_enough_observed_data")}</p>
              )}
              <button onClick={go(1)}>{t(locale, "web.see_details")} →</button>
            </section>
          )}
          {data.community && (
            <>
              <section className="surface">
                <h2>{t(locale, "polish.today")}</h2>
                <div className="kpi-grid">
                  <article className="metric-card">
                    <h3>{t(locale, "control.joined")}</h3>
                    <strong
                      className={
                        data.community.daily.todayJoined === null ||
                        data.community.daily.todayJoined === 0
                          ? "measurement-state"
                          : ""
                      }
                    >
                      {data.community.daily.todayJoined === null
                        ? t(locale, "polish.unavailable")
                        : data.community.daily.todayJoined === 0
                          ? t(locale, "polish.noneJoined")
                          : t(locale, "polish.people", {
                              count: data.community.daily.todayJoined,
                            })}
                    </strong>
                  </article>
                  <article className="metric-card">
                    <h3>{t(locale, "control.connected")}</h3>
                    <strong
                      className={
                        data.community.daily.todayConnected === null ||
                        data.community.daily.todayJoined === 0
                          ? "measurement-state"
                          : ""
                      }
                    >
                      {data.community.daily.todayConnected === null
                        ? t(locale, "polish.unavailable")
                        : data.community.daily.todayJoined === 0
                          ? t(locale, "polish.noneEligible")
                          : t(locale, "polish.people", {
                              count: data.community.daily.todayConnected,
                            })}
                    </strong>
                  </article>
                  <article className="metric-card">
                    <h3>{t(locale, "polish.waiting")}</h3>
                    <strong>
                      {data.community.daily.attentionCount === null
                        ? t(locale, "polish.unavailable")
                        : t(locale, "polish.count", {
                            count: Math.max(
                              0,
                              data.community.daily.attentionCount -
                                attentionRemoved,
                            ),
                          })}
                    </strong>
                  </article>
                </div>
              </section>
              <Measurements community={data.community} locale={locale} />
            </>
          )}
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
              <>
                <p>{c.noOpportunity}</p>
                <button onClick={go(2)}>{c.opportunities} →</button>
              </>
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
          <p className="eyebrow">{t(locale, "control.newMembers")}</p>
          <h1>{c.milestones}</h1>
          <p className="orientation">
            {t(locale, "web.review_each_newcomer_milestone_each_percentage")}
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
      {data.community && (
        <section className="surface">
          <h2>{t(locale, "polish.receivedTotal")}</h2>
          <p>
            {data.community.reactionsReceived} ·{" "}
            {t(locale, "control.days", { count: data.community.range })}
          </p>
          <p>{t(locale, "polish.receivedRule")}</p>
        </section>
      )}
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
            <h2>{t(locale, "web.where_newcomers_started")}</h2>
            {journey.channels?.length ? (
              <div className="channel-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t(locale, "web.channel")}</th>
                      <th>{t(locale, "web.first_messages")}</th>
                      <th>{t(locale, "web.first_replies")}</th>
                      <th>{t(locale, "web.first_successes")}</th>
                      <th>{t(locale, "web.later_success")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journey.channels.map((row) => (
                      <tr key={row.channelId}>
                        <th>
                          {data.options.channels.find(
                            (option) => option.id === row.channelId,
                          )?.label ??
                            t(locale, "web.channel_no_longer_available")}
                        </th>
                        <td>{row.firstMessages}</td>
                        <td>{row.firstReplies}</td>
                        <td>{row.firstSuccesses}</td>
                        <td>
                          {row.goalEligible
                            ? `${row.goalCompleted ?? 0}/${row.goalEligible}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                {t(locale, "web.collecting_enough_activity_to_show_channels")}
              </p>
            )}
            <p className="inline-note">
              {t(locale, "web.channels_with_very_few_observations_are")}
            </p>
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
          <p className="eyebrow">{t(locale, "web.activity_patterns")}</p>
          <h1>{c.opportunities}</h1>
          <p className="orientation">
            {t(locale, "web.see_what_needs_attention_and_which")}
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
                  ? t(locale, "web.critical")
                  : t(locale, "web.attention")}
              </div>
              <div>
                <h2>{opportunityNames[locale][item.type]}</h2>
                <p>
                  {t(locale, "web.value_newcomers_evaluated", {
                    a: String(item.sampleSize.toLocaleString()),
                  })}
                </p>
                <p>
                  {c.current}: {percent(item.current)} · {c.previous}:{" "}
                  {percent(item.previous)}
                </p>
                <small>{c.notCausal}</small>
                {item.suggestedAction && (
                  <p>
                    {t(locale, "web.suggested_improvement")}:{" "}
                    <strong>
                      {t(locale, templateNameKeys[item.suggestedAction])}
                    </strong>
                  </p>
                )}
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
                        {t(
                          locale,
                          "web.the_deterministic_change_threshold_was_met",
                        )}
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
                <button
                  className="quiet"
                  onClick={() =>
                    setEvidence(evidence === item.id ? null : item.id)
                  }
                >
                  {c.why}
                </button>
                <details>
                  <summary>
                    {t(locale, "web.reason_for_dismissal_optional")}
                  </summary>
                  <select
                    value={dismissReasons[item.id] ?? ""}
                    onChange={(e) =>
                      setDismissReasons((current) => ({
                        ...current,
                        [item.id]: e.target.value as
                          "not_relevant" | "already_handled" | "later" | "",
                      }))
                    }
                  >
                    <option value="">—</option>
                    <option value="not_relevant">
                      {t(locale, "web.not_relevant")}
                    </option>
                    <option value="already_handled">
                      {t(locale, "web.already_handled")}
                    </option>
                    <option value="later">{t(locale, "web.later")}</option>
                  </select>
                </details>
                <button
                  className="quiet"
                  onClick={() => void dismissOpportunity(item.id, item.type)}
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
      <section className="surface improvement-menu">
        <h2>{c.actions}</h2>
        <p>{t(locale, "web.choose_what_would_help_your_newcomers")}</p>
        <div className="improvement-menu-grid">
          {(
            [
              "reply_rescue",
              "welcome_helper",
              "channel_recommendation",
              "event_recommendation",
            ] as const
          )
            .filter(
              (key) =>
                key !== "event_recommendation" ||
                data.options.events.length > 0,
            )
            .map((key) => (
              <button key={key} onClick={() => openImprovement(key)}>
                {t(locale, templateNameKeys[key])}
              </button>
            ))}
        </div>
      </section>
    </>
  );

  const actionView = (
    <>
      <section className="action-layout">
        {showImprovementSetup && (
          <div className="builder-v3">
            <h2>{c.createAction}</h2>
            <label>
              {c.template}
              <select
                value={template}
                onChange={(e) => {
                  setTemplate(e.target.value as ActionTemplateKey);
                  setPreflightState(null);
                  setTestSent(false);
                  setPreview(null);
                }}
              >
                {actions?.templates
                  .filter(
                    (template) =>
                      template.key !== "inactive_follow_up" &&
                      (template.key !== "event_recommendation" ||
                        data.options.events.length > 0),
                  )
                  .map((template) => (
                    <option key={template.key} value={template.key}>
                      {t(locale, templateNameKeys[template.key])}
                    </option>
                  ))}
              </select>
            </label>
            {selected && (
              <div
                className="flow-preview"
                aria-label={t(locale, "web.improvement_preview")}
              >
                <strong>{t(locale, "web.when_enabled")}</strong>
                <p>
                  {semantic(selected.trigger, locale)} →{" "}
                  {duration(selected.delaySeconds, locale)} →{" "}
                  {semantic(selected.condition, locale)} →{" "}
                  {runMode === "approval"
                    ? t(locale, "web.staff_reviews")
                    : runMode === "suggest"
                      ? t(locale, "web.suggestion_only")
                      : t(locale, "web.runs_automatically")}{" "}
                  → {semantic(selected.action, locale)}{" "}
                  {channelId
                    ? (data.options.channels.find(
                        (option) => option.id === channelId,
                      )?.label ?? "")
                    : ""}
                </p>
              </div>
            )}
            {selected && (
              <details>
                <summary>{t(locale, "web.change_settings")}</summary>
                <label>
                  {t(locale, "web.how_to_run")}
                  <select
                    value={runMode}
                    onChange={(e) =>
                      setRunMode(e.target.value as typeof runMode)
                    }
                  >
                    <option value="suggest">
                      {t(locale, "web.suggest_only")}
                    </option>
                    <option value="approval">
                      {t(locale, "web.confirm_before_running")}
                    </option>
                    <option value="auto">
                      {t(locale, "web.run_automatically")}
                    </option>
                  </select>
                </label>
                <Policy
                  template={{
                    ...selected,
                    safety: { ...selected.safety, mode: runMode },
                  }}
                  c={c}
                  locale={locale}
                />
              </details>
            )}
            {!data.options.available && selected?.requires.length ? (
              <p className="inline-note">{c.optionsUnavailable}</p>
            ) : null}
            {selected?.requires.includes("channelId") && (
              <label>
                {c.destination}
                <select
                  value={channelId}
                  onChange={(e) => {
                    setChannelId(e.target.value);
                    setPreflightState(null);
                    setTestSent(false);
                  }}
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
                  onChange={(e) => {
                    setEventId(e.target.value);
                    setPreflightState(null);
                    setTestSent(false);
                  }}
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
                  onChange={(e) => {
                    setChannels(
                      [...e.target.selectedOptions].map((o) => o.value),
                    );
                    setPreflightState(null);
                    setTestSent(false);
                  }}
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
              <button
                disabled={busy || !channelId}
                onClick={() => void checkImprovement()}
              >
                {t(locale, "web.check_setup")}
              </button>
              <button
                disabled={busy || !channelId}
                onClick={() => void sendTestNotification()}
              >
                {t(locale, "web.send_test_notification")}
              </button>
            </div>
            {preflightState && (
              <p role="status" className="inline-note">
                {preflightState === "ready"
                  ? t(locale, "web.ready")
                  : preflightState === "permission_needed"
                    ? t(locale, "web.permission_needed_give_nexus_view_channel")
                    : t(
                        locale,
                        "web.unavailable_check_the_selected_destination_or",
                      )}{" "}
                {preflightState === "ready" && testSent
                  ? t(locale, "web.test_sent")
                  : preflightState !== "ready"
                    ? preflightFix
                    : ""}
              </p>
            )}
            <button
              disabled={
                busy ||
                Boolean(
                  selected?.requires.includes("channelId") && !channelId,
                ) ||
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
          </div>
        )}
        <div>
          <h2>{c.activeActions}</h2>
          {actions?.items.length ? (
            actions.items.map((item) => (
              <article className="surface action-card" key={item.id}>
                <div className="section-heading">
                  <h3>
                    {actionName(item.name, locale)} · v{item.version}
                  </h3>
                  <span className="live">{t(locale, "web.live")}</span>
                </div>
                <details>
                  <summary>{t(locale, "web.view_settings")}</summary>
                  <Policy template={item} c={c} locale={locale} />
                </details>
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
          <p className="eyebrow">{t(locale, "web.measure_what_worked")}</p>
          <h1>{c.results}</h1>
          <p className="orientation">
            {t(locale, "web.compare_usual_operation_with_the_improvement")}
          </p>
        </div>
      </div>
      {results?.simple?.length ? (
        <section className="results-list">
          {results.simple.map((item) => (
            <article className="surface result-card" key={item.actionId}>
              <h2>{actionName(item.name, locale)}</h2>
              <p>{t(locale, "web.before_and_after_this_improvement")}</p>
              <div className="test-summary">
                <div>
                  <span>{t(locale, "web.before")}</span>
                  <strong>{percent(item.before.current)}</strong>
                  <small>
                    {item.before.sampleSize} {t(locale, "web.newcomers")}
                  </small>
                </div>
                <div>
                  <span>{t(locale, "web.after")}</span>
                  <strong>{percent(item.after.current)}</strong>
                  <small>
                    {item.after.sampleSize} {t(locale, "web.newcomers")}
                  </small>
                </div>
              </div>
              <p>
                {item.collecting
                  ? t(locale, "web.still_collecting_counts_and_trends_will")
                  : t(locale, "web.observed_difference_value", {
                      a: String(
                        signed(
                          item.after.current !== null &&
                            item.before.current !== null
                            ? item.after.current - item.before.current
                            : null,
                        ),
                      ),
                    })}
              </p>
              <p className="inline-note">
                {t(locale, "web.other_factors_may_have_affected_this")}
              </p>
              {item.controlledAvailable ? (
                <button onClick={() => setTestActionId(item.actionId)}>
                  {t(locale, "web.check_more_accurately")}
                </button>
              ) : (
                <p className="inline-note">
                  {t(locale, "web.a_more_rigorous_check_can_become")}
                </p>
              )}
            </article>
          ))}
        </section>
      ) : null}
      {testActionId && selectedAction && (
        <section className="surface test-builder">
          <h2>
            {c.testAction}: {actionName(selectedAction.name, locale)}
          </h2>
          <div className="test-summary">
            <div>
              <span>{c.hypothesis}</span>
              <strong>
                {t(locale, "web.does_value_help_newcomers", {
                  a: String(actionName(selectedAction.name, locale)),
                })}
              </strong>
            </div>
            <div>
              <span>{c.control}</span>
              <strong>{c.control}</strong>
            </div>
            <div>
              <span>{c.treatment}</span>
              <strong>{actionName(selectedAction.name, locale)}</strong>
            </div>
            <div>
              <span>{c.primaryOutcome}</span>
              <strong>
                {metricLabel(
                  selectedAction.name === "Reply Rescue"
                    ? "connection"
                    : "activation",
                  locale,
                )}
              </strong>
            </div>
          </div>
          <button disabled={busy} onClick={() => void startCheck()}>
            {c.reviewTest}
          </button>
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
                    {t(locale, "web.does_the_improvement_help_value_compared", {
                      a: String(metricLabel(item.primaryMetric, locale)),
                    })}
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
                      <dt>{t(locale, "web.still_collecting")}</dt>
                      <dd>{item.maturity.assigned - item.maturity.mature}</dd>
                    </div>
                  </dl>
                </div>
              </div>
              <details>
                <summary>{c.advanced}</summary>
                <p>
                  {c.coverage}: {healthText(item.dataHealth.label)} ·{" "}
                  {c.guardrails}:{" "}
                  {item.guardrailStatus === "healthy" ? c.healthy : c.partial}
                </p>
                <p>
                  {c.randomization}:{" "}
                  {item.randomization === "time_block"
                    ? c.dailyBlocks
                    : t(locale, "web.by_member")}{" "}
                  · {c.timeline}: {item.timeline.windowDays}{" "}
                  {t(locale, "web.days")}
                </p>
                <p>
                  {t(
                    locale,
                    "web.all_mature_assignments_are_analyzed_including",
                  )}
                </p>
                {item.spilloverRisk && (
                  <p>
                    {t(
                      locale,
                      "web.spillover_and_carryover_across_time_blocks",
                    )}
                  </p>
                )}
                <p>
                  {t(locale, "web.95_interval")}:{" "}
                  {item.credibleInterval
                    ? `${signed(item.credibleInterval[0])} – ${signed(item.credibleInterval[1])}`
                    : "—"}{" "}
                  ·{" "}
                  {t(
                    locale,
                    "web.p_value_better",
                    locale === "ja"
                      ? { a: String(c.treatment) }
                      : { a: String(c.treatment.toLowerCase()) },
                  )}
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
          <p className="eyebrow">{t(locale, "web.community_configuration")}</p>
          <h1>{c.settings}</h1>
          <p className="orientation">
            {t(locale, "web.manage_language_notifications_discord_and_data")}
          </p>
        </div>
      </div>
      <section className="settings-grid">
        {data.selectedGuildId && (
          <ServerConnection
            guildId={data.selectedGuildId}
            locale={locale}
            development={data.developmentAuth === true}
            beta={data.hostedBeta === true}
          />
        )}
        <article className="surface">
          <h2>{t(locale, "web.channels_to_analyze")}</h2>
          <p>{t(locale, "web.the_default_is_the_whole_server")}</p>
          <button
            disabled={!suggestedExcludedChannels.length}
            onClick={() => {
              setScopeMode("exclude");
              setScopeChannels(suggestedExcludedChannels);
            }}
          >
            {t(locale, "web.select_likely_staff_or_log_channels")}
          </button>
          <select
            aria-label={t(locale, "web.channels_to_analyze")}
            value={scopeMode}
            onChange={(e) => setScopeMode(e.target.value as typeof scopeMode)}
          >
            <option value="all">{t(locale, "web.whole_server")}</option>
            <option value="include">
              {t(locale, "web.selected_channels_only")}
            </option>
            <option value="exclude">
              {t(locale, "web.exclude_selected_channels")}
            </option>
          </select>
          {scopeMode !== "all" && (
            <div className="scope-list">
              {data.options.channels.map((option) => (
                <label key={option.id}>
                  <input
                    type="checkbox"
                    checked={scopeChannels.includes(option.id)}
                    onChange={(e) =>
                      setScopeChannels(
                        e.target.checked
                          ? [...scopeChannels, option.id]
                          : scopeChannels.filter((id) => id !== option.id),
                      )
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
          )}
          <h3>{t(locale, "web.staff_roles_excluded_from_comparison")}</h3>
          <div className="scope-list">
            {data.options.roles.map((option) => (
              <label key={option.id}>
                <input
                  type="checkbox"
                  checked={staffRoles.includes(option.id)}
                  onChange={(e) =>
                    setStaffRoles(
                      e.target.checked
                        ? [...staffRoles, option.id]
                        : staffRoles.filter((id) => id !== option.id),
                    )
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
          <button
            disabled={
              busy || (scopeMode === "include" && !scopeChannels.length)
            }
            onClick={async () => {
              const result = await request({
                action: "analysis_scope",
                mode: scopeMode,
                channelIds: scopeChannels,
                staffRoleIds: staffRoles,
                revision: notificationRevision,
              });
              if (result) {
                setNotificationRevision(result.revision);
                setSavedScopeMode(scopeMode);
                setStatus(t(locale, "web.analysis_scope_saved"));
              }
            }}
          >
            {t(locale, "web.save_changes")}
          </button>
        </article>
        <article className="surface">
          <h2>{t(locale, "web.general")}</h2>
          <p>{c.language}</p>
          <div className="segmented">
            <button
              aria-pressed={locale === "en"}
              onClick={() => {
                setLocale("en");
                document.cookie =
                  "nexus_locale=en; Path=/; Max-Age=31536000; SameSite=Lax";
              }}
            >
              {t("ja", "settings.english")}
            </button>
            <button
              aria-pressed={locale === "ja"}
              onClick={() => {
                setLocale("ja");
                document.cookie =
                  "nexus_locale=ja; Path=/; Max-Age=31536000; SameSite=Lax";
              }}
            >
              {t("ja", "settings.japanese")}
            </button>
          </div>
          <p>{t(locale, "web.discord_panel_language_is_managed_from")}</p>
          <label>
            {t(locale, "web.staff_notification_destination")}
            <select
              value={channelId}
              onChange={(e) => void saveNotificationChannel(e.target.value)}
              disabled={!data.options.available}
            >
              {data.options.channels.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </article>
        <article className="surface">
          <h2>Discord</h2>
          <p>
            {data.options.available
              ? t(locale, "web.connected_permissions_are_checked_again_before")
              : t(locale, "web.check_the_connection")}
          </p>
        </article>
        <article className="surface">
          <h2>{t(locale, "web.community_focus")}</h2>
          <p>{t(locale, "web.you_can_change_these_goals_later")}</p>
          <h3>{t(locale, "control.goals")}</h3>
          <div className="scope-list">
            {goalChoices.map((goal) => (
              <label key={goal}>
                <input
                  type="checkbox"
                  checked={newMemberGoals.includes(goal)}
                  onChange={(e) =>
                    setNewMemberGoals((current) =>
                      e.target.checked
                        ? [...current, goal]
                        : current.filter((value) => value !== goal),
                    )
                  }
                />
                {t(
                  locale,
                  `control.goal${goal[0]!.toUpperCase() + goal.slice(1)}` as "control.goalReply",
                )}
              </label>
            ))}
          </div>
          <label>
            {t(locale, "web.community_type")}
            <select
              value={goalPreset}
              onChange={(e) =>
                setGoalPreset(e.target.value as typeof goalPreset)
              }
            >
              <option value="">{t(locale, "web.no_preset")}</option>
              <option value="multiplayer">
                {t(locale, "web.multiplayer_co_op")}
              </option>
              <option value="early_access">
                {t(locale, "web.early_access")}
              </option>
              <option value="live_service">
                {t(locale, "web.live_service")}
              </option>
            </select>
          </label>
          <p>
            {goalPreset === "multiplayer"
              ? t(locale, "web.suggested_lfg_voice_events")
              : goalPreset === "early_access"
                ? t(locale, "web.suggested_feedback_playtests_bug_reports")
                : goalPreset === "live_service"
                  ? t(locale, "web.suggested_events_lfg_voice_discussion")
                  : ""}
          </p>
          <label>
            {t(locale, "web.add_an_important_channel")}
            <select
              value=""
              disabled={importantChannels.length >= 20}
              onChange={(e) => {
                if (e.target.value)
                  setImportantChannels((current) => [
                    ...current,
                    { channelId: e.target.value, purpose: "lfg" },
                  ]);
              }}
            >
              <option value="">{t(locale, "web.choose_a_channel")}</option>
              {data.options.channels
                .filter(
                  (option) =>
                    !importantChannels.some(
                      (item) => item.channelId === option.id,
                    ),
                )
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
            </select>
          </label>
          {importantChannels.map((item) => (
            <div key={item.channelId} className="scope-list">
              <span>
                {data.options.channels.find(
                  (option) => option.id === item.channelId,
                )?.label ?? item.channelId}
              </span>
              <select
                value={item.purpose}
                onChange={(e) =>
                  setImportantChannels((current) =>
                    current.map((row) =>
                      row.channelId === item.channelId
                        ? {
                            ...row,
                            purpose: e.target.value as typeof item.purpose,
                          }
                        : row,
                    ),
                  )
                }
              >
                <option value="lfg">{t(locale, "web.lfg")}</option>
                <option value="feedback">{t(locale, "web.feedback")}</option>
                <option value="bug">{t(locale, "web.bug_reports")}</option>
                <option value="playtest">{t(locale, "web.playtests")}</option>
                <option value="discussion">
                  {t(locale, "web.discussion")}
                </option>
              </select>
              <button
                onClick={() =>
                  setImportantChannels((current) =>
                    current.filter((row) => row.channelId !== item.channelId),
                  )
                }
              >
                {t(locale, "web.remove")}
              </button>
            </div>
          ))}
          <button disabled={busy} onClick={() => void saveGoals()}>
            {t(locale, "web.save_focus")}
          </button>
        </article>
        <article className="surface">
          <h2>{t(locale, "web.weekly_summary")}</h2>
          <label>
            <input
              type="checkbox"
              checked={weeklyEnabled}
              disabled={busy || !weeklyChannelId}
              onChange={(e) => void saveWeekly(e.target.checked)}
            />
            {t(locale, "web.send_to_staff_each_week")}
          </label>
          <label>
            {t(locale, "web.destination")}
            <select
              value={weeklyChannelId}
              disabled={busy || !data.options.available}
              onChange={(e) => setWeeklyChannelId(e.target.value)}
            >
              {data.options.channels.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t(locale, "control.day")}
            <select
              value={weeklyDay}
              onChange={(e) => setWeeklyDay(Number(e.target.value))}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                <option key={day} value={day}>
                  {t(locale, `control.day${day}` as "control.day0")}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t(locale, "control.time")}
            <select
              value={weeklyHour}
              onChange={(e) => setWeeklyHour(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
          <label>
            {t(locale, "control.timezone")}
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {[
                "UTC",
                "America/Los_Angeles",
                "America/Denver",
                "America/Chicago",
                "America/New_York",
                "Europe/London",
                "Europe/Paris",
                "Europe/Berlin",
                "Asia/Tokyo",
                "Asia/Seoul",
                "Asia/Singapore",
                "Asia/Kolkata",
                "Australia/Sydney",
              ].map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !weeklyChannelId}
            onClick={() => void saveWeekly(weeklyEnabled)}
          >
            {t(locale, "web.save_schedule")}
          </button>
          <p>{t(locale, "web.a_short_update_with_newcomer_progress")}</p>
          {data.weeklyStatus?.state === "unknown" && (
            <p role="status">{t(locale, "weekly.deliveryUnknown")}</p>
          )}
        </article>
        <article className="surface">
          <h2>{t(locale, "web.helper_alerts")}</h2>
          <p>{t(locale, "web.alert_staff_when_no_direct_reply")}</p>
          <label>
            <input
              type="checkbox"
              checked={helperEnabled}
              disabled={busy || !helperChannelId}
              onChange={(e) => void saveHelper(e.target.checked)}
            />
            {t(locale, "web.enable_alerts")}
          </label>
          <label>
            {t(locale, "web.destination_2")}
            <select
              value={helperChannelId}
              onChange={(e) => setHelperChannelId(e.target.value)}
            >
              {data.options.channels.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t(locale, "web.role_to_notify_optional")}
            <select
              value={helperRoleId}
              onChange={(e) => setHelperRoleId(e.target.value)}
            >
              <option value="">{t(locale, "web.no_role_ping")}</option>
              {data.options.roles.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t(locale, "web.notify_after")}
            <select
              value={responseMinutes}
              onChange={(e) => setResponseMinutes(Number(e.target.value))}
            >
              {[10, 20, 30, 60].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} {t(locale, "web.min")}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={busy || !helperChannelId}
            onClick={() => void saveHelper()}
          >
            {t(locale, "web.save_settings")}
          </button>
        </article>
        <article className="surface">
          <h2>{t(locale, "web.data")}</h2>
          <label>
            {t(locale, "web.keep_detailed_data_for")}
            <select
              value={retentionDays}
              onChange={(e) =>
                void saveRetentionDays(Number(e.target.value) as 7 | 14 | 30)
              }
            >
              <option value={7}>{t(locale, "web.7_days")}</option>
              <option value={14}>{t(locale, "web.14_days")}</option>
              <option value={30}>{t(locale, "web.30_days")}</option>
            </select>
          </label>
          <p>
            {t(locale, "web.aggregate_data_value_months", {
              a: String(
                String(data.admin?.settings.aggregateRetentionMonths ?? "—"),
              ),
            })}
          </p>
          <p>
            {t(locale, "web.message_contents_attachments_dms_and_presence")}
          </p>
          <p>{t(locale, "web.to_delete_data_open_nexus_privacy")}</p>
        </article>
        <article className="surface">
          <h2>{t(locale, "web.advanced")}</h2>
          <details>
            <summary>{t(locale, "web.view_plan_and_administration")}</summary>
            <p>
              {c.plan}: {data.admin?.usage.plan ?? "—"}
            </p>
            <p>
              {t(locale, "web.administration_requires_manage_guild_permission")}
            </p>
          </details>
        </article>
        <article className="surface">
          <h2>{t(locale, "web.setting_changes")}</h2>
          {data.audit.length ? (
            data.audit.slice(0, 10).map((entry, index) => (
              <p key={`${entry.at}-${index}`}>
                {new Date(entry.at).toLocaleString(t(locale, "web.en_us"))} ·{" "}
                {entry.changed.includes("analysisScope")
                  ? t(locale, "web.analysis_range_changed")
                  : entry.changed.includes("weeklySummaryEnabled")
                    ? t(locale, "web.weekly_summary_changed")
                    : t(locale, "web.settings_changed")}{" "}
                ·{" "}
                {entry.actorId
                  ? `@${entry.actorId}`
                  : entry.source === "WEB_DASHBOARD"
                    ? t(locale, "web.web_admin")
                    : t(locale, "web.administrator")}
              </p>
            ))
          ) : (
            <p>{t(locale, "web.no_setting_changes_yet")}</p>
          )}
        </article>
        <article className="surface">
          <h2>NEXUS Alpha · {VERSION}</h2>
          <p>
            {locale === "ja"
              ? "問題や意見をお寄せください。"
              : "Report a problem or send feedback."}
          </p>
          <a href="/support">
            {locale === "ja" ? "問題を報告" : "Report a problem"}
          </a>{" "}
          ·{" "}
          <a href="/support">
            {locale === "ja" ? "意見を送る" : "Send feedback"}
          </a>
          <p>
            <button
              onClick={() => {
                if (data.runtime)
                  void navigator.clipboard.writeText(
                    JSON.stringify(data.runtime, null, 2),
                  );
              }}
            >
              {locale === "ja" ? "診断情報をコピー" : "Copy diagnostics"}
            </button>
          </p>
        </article>
      </section>
    </>
  );

  const attentionView = (
    <Attention
      ready={Boolean(data.community?.daily.ready)}
      items={attentionItems}
      locale={locale}
      channels={data.options.surfaces ?? data.options.channels}
      minutes={savedResponseMinutes}
      busy={busy}
      snooze={attentionSnooze}
      onRefresh={() => window.location.reload()}
      onRules={() => setPage(9)}
      onSnooze={(id, value) =>
        setAttentionSnooze((current) => ({ ...current, [id]: value }))
      }
      onChange={(item, status) => void changeAttention(item, status)}
    />
  );
  const ruleValue = (
    value: number,
    total: number,
    pending: number,
    unavailable = false,
  ) =>
    !data.community || unavailable
      ? t(locale, "polish.unavailable")
      : total >= 5
        ? `${value} / ${total}`
        : total > 0
          ? t(locale, "polish.moreSample", { count: 5 - total })
          : pending > 0
            ? t(locale, "experience.pending")
            : t(locale, "polish.noMembers");
  const rulesView = (
    <section className="rules-view">
      <div className="page-head">
        <div>
          <p className="eyebrow">MEASUREMENT</p>
          <h1>{t(locale, "experience.goalsRules")}</h1>
          <p className="orientation">{t(locale, "polish.rulesIntro")}</p>
        </div>
      </div>
      <div className="rules-grid">
        <article className="surface">
          <h2>{t(locale, "control.connected")}</h2>
          <p>{t(locale, "experience.connectionRule")}</p>
          <dl>
            <div>
              <dt>
                {t(locale, "experience.observed", {
                  count: data.community?.eligibleMembers ?? 0,
                })}
              </dt>
              <dd>
                {ruleValue(
                  data.community?.stages[2]?.count ?? 0,
                  data.community?.eligibleMembers ?? 0,
                  data.community?.arrivalCount ?? 0,
                  !data.community ||
                    data.community?.weekly?.connection.state === "UNAVAILABLE",
                )}
              </dd>
            </div>
            <div>
              <dt>{t(locale, "control.scope")}</dt>
              <dd>
                {savedScopeMode === "all"
                  ? t(locale, "control.scopeAll")
                  : savedScopeMode === "include"
                    ? t(locale, "control.scopeInclude")
                    : t(locale, "control.scopeExclude")}
              </dd>
            </div>
          </dl>
          <details>
            <summary>{t(locale, "experience.howMeasured")}</summary>
            <p>{t(locale, "experience.replyRule")}</p>
            <p>{t(locale, "experience.voiceRule")}</p>
            <p>{t(locale, "experience.reactionWeak")}</p>
          </details>
        </article>
        <article className="surface">
          <h2>
            {activityWindow(
              locale,
              data.community?.analysis?.rules.retainedFromDay,
              data.community?.analysis?.rules.retainedThroughDay,
            )}
          </h2>
          <p>{t(locale, "experience.retentionRule")}</p>
          <p>
            {ruleValue(
              data.community?.outcomes.retained ?? 0,
              (data.community?.outcomes.retained ?? 0) +
                (data.community?.outcomes.notRetained ?? 0),
              data.community?.outcomes.pending ?? 0,
              !data.community ||
                (Boolean(data.community?.outcomes.insufficient) &&
                  !data.community?.outcomes.pending &&
                  !(
                    (data.community?.outcomes.retained ?? 0) +
                    (data.community?.outcomes.notRetained ?? 0)
                  )),
            )}
          </p>
          <details>
            <summary>{t(locale, "experience.howMeasured")}</summary>
            <p>{t(locale, "control.observation")}</p>
          </details>
        </article>
        <article className="surface">
          <h2>{t(locale, "control.replyAlert")}</h2>
          <p>
            {t(locale, "experience.queueRule", { count: savedResponseMinutes })}
          </p>
          <p>
            {helperEnabled ? t(locale, "control.on") : t(locale, "control.off")}
          </p>
          <button onClick={() => setPage(4)}>
            {t(locale, "experience.settingsLink")}
          </button>
        </article>
        <article className="surface">
          <h2>{t(locale, "control.goals")}</h2>
          <p>{t(locale, "experience.goalFocus")}</p>
          <ul>
            {goalChoices
              .filter((goal) => newMemberGoals.includes(goal))
              .map((goal) => (
                <li key={goal}>
                  {t(
                    locale,
                    `control.goal${goal[0]!.toUpperCase() + goal.slice(1)}` as "control.goalReply",
                  )}
                </li>
              ))}
          </ul>
          <details>
            <summary>{t(locale, "experience.howMeasured")}</summary>
            <p>{t(locale, "experience.eventRule")}</p>
            <p>{t(locale, "experience.channelRule")}</p>
          </details>
          <button onClick={() => setPage(4)}>
            {t(locale, "experience.settingsLink")}
          </button>
        </article>
      </div>
    </section>
  );
  const views = [
    home,
    journeyView,
    <section key="improve">
      {opportunityView}
      {actionView}
    </section>,
    resultView,
    settingsView,
    data.community ? (
      <AnalysisSummary
        key="community"
        community={data.community}
        locale={locale}
      />
    ) : (
      <section key="community" className="surface">
        <h1>{t(locale, "control.analysis")}</h1>
        <p>{t(locale, "polish.unavailable")}</p>
      </section>
    ),
    <section key="compare" className="surface">
      <h1>{t(locale, "web.compare_participation")}</h1>
      {data.community?.compare.available ? (
        <>
          <p>
            {t(locale, "web.new_members_waited_value_minutes_on", {
              a: String(data.community.compare.newcomers?.replyMinutes ?? "—"),
              b: String(data.community.compare.continuing?.replyMinutes ?? "—"),
            })}
          </p>
          <p>
            {t(locale, "web.received_a_reply_new_value_continuing", {
              a: String(data.community.compare.newcomers?.receivedReplyPercent),
              b: String(
                data.community.compare.continuing?.receivedReplyPercent,
              ),
            })}
          </p>
          <p>
            {t(locale, "web.active_days_new_value_continuing_value", {
              a: String(data.community.compare.newcomers?.activeDays),
              b: String(data.community.compare.continuing?.activeDays),
            })}
          </p>
        </>
      ) : (
        <p>{t(locale, "web.there_is_not_enough_data_to")}</p>
      )}
      <h2>
        {data.community
          ? activityWindow(
              locale,
              data.community.analysis.rules.retainedFromDay,
              data.community.analysis.rules.retainedThroughDay,
            )
          : t(locale, "web.what_happened_after_joining")}
      </h2>
      {data.community?.outcomes.patterns && (
        <p>
          {t(locale, "web.distinct_people_interacted_with_in_the", {
            a: String(
              data.community.outcomes.patterns.retained.interactionPartners,
            ),
            b: String(
              data.community.outcomes.patterns.notRetained.interactionPartners,
            ),
          })}
        </p>
      )}
      {data.community ? (
        <p>
          {t(locale, "web.observed_a_week_later_value_not", {
            a: String(data.community.outcomes.retained),
            b: String(data.community.outcomes.notRetained),
            c: String(data.community.outcomes.pending),
            d: String(data.community.outcomes.insufficient),
          })}
        </p>
      ) : null}
      {data.community?.outcomes.patterns && (
        <p>
          {t(locale, "web.value_of_continuing_newcomers_received_a", {
            a: String(
              data.community.outcomes.patterns.retained.receivedReplyPercent,
            ),
            b: String(
              data.community.outcomes.patterns.notRetained.receivedReplyPercent,
            ),
          })}
        </p>
      )}
      {data.community?.suggestion && (
        <p>{t(locale, "control.replySuggestion")}</p>
      )}
      {data.community?.compare.available && (
        <p>
          {t(locale, "web.channels_used_new_value_continuing_value", {
            a: String(data.community.compare.newcomers?.channelCount),
            b: String(data.community.compare.continuing?.channelCount),
            c: String(
              wholePercent(
                data.community.compare.newcomers?.voicePercent ?? null,
              ),
            ),
            d: String(
              wholePercent(
                data.community.compare.continuing?.voicePercent ?? null,
              ),
            ),
            e: String(
              wholePercent(
                data.community.compare.newcomers?.eventPercent ?? null,
              ),
            ),
            f: String(
              wholePercent(
                data.community.compare.continuing?.eventPercent ?? null,
              ),
            ),
          })}
        </p>
      )}
      {data.community?.outcomes.patterns && (
        <p>
          {t(locale, "web.first_three_days_those_observed_later", {
            a: String(
              wholePercent(
                data.community.outcomes.patterns.retained.voicePercent,
              ),
            ),
            b: String(
              wholePercent(
                data.community.outcomes.patterns.retained.eventPercent,
              ),
            ),
            c: String(
              wholePercent(
                data.community.outcomes.patterns.notRetained.voicePercent,
              ),
            ),
            d: String(
              wholePercent(
                data.community.outcomes.patterns.notRetained.eventPercent,
              ),
            ),
          })}
        </p>
      )}
    </section>,
    <section key="channels" className="surface">
      <h1>{t(locale, "web.channels_used_by_new_members")}</h1>
      {data.community && (
        <p>
          {activityWindow(
            locale,
            data.community.analysis.rules.retainedFromDay,
            data.community.analysis.rules.retainedThroughDay,
          )}
        </p>
      )}
      {data.community?.channels.length ? (
        data.community.channels.map((row) => (
          <article key={row.channelId}>
            <h2>
              {data.options.channels.find(
                (option) => option.id === row.channelId,
              )?.label ?? `#${row.channelId}`}
            </h2>
            <p>
              {t(locale, "web.value_new_members_value_received_a", {
                a: String(row.newcomers),
                b: String(wholePercent(row.receivedReplyPercent)),
                c: String(wholePercent(row.laterElsewherePercent)),
                d: String(wholePercent(row.weekLaterPercent)),
              })}
            </p>
          </article>
        ))
      ) : (
        <p>{t(locale, "web.no_channels_can_be_shown_yet")}</p>
      )}
    </section>,
  ];
  const navItem = (view: number) =>
    navPages.find((item) => item.view === view)!;
  const group = (views: number[]) =>
    views.map((view) => (
      <button
        key={view}
        aria-current={page === view ? "page" : undefined}
        onClick={() => setPage(view)}
      >
        {t(locale, navItem(view).label)}
      </button>
    ));
  const navigation = (
    <>
      <nav aria-label={locale === "ja" ? "主要メニュー" : "Main navigation"}>
        {(
          [
            [0, "home", "ホーム", "Home"],
            [5, "analysis", "分析", "Analysis"],
            [8, "attention", "要確認", "Needs attention"],
            [3, "history", "履歴", "History"],
          ] as const
        ).map(([view, kind, ja, en]) => (
          <button
            key={view}
            aria-current={page === view ? "page" : undefined}
            onClick={() => setPage(view)}
          >
            <NavIcon kind={kind} />
            {locale === "ja" ? ja : en}
          </button>
        ))}
      </nav>
      <details className="nav-group">
        <summary>{locale === "ja" ? "分析の詳細" : "Analysis details"}</summary>
        <nav>
          {group([1, 10])}
          <a href="/explore">
            {locale === "ja" ? "分析と保存ビュー" : "Explore & saved views"}
          </a>
        </nav>
      </details>
      <details className="nav-group">
        <summary>
          {locale === "ja" ? "対応とレポート" : "Responses & reports"}
        </summary>
        <nav>
          {group([2])}
          <a href="/operations?view=attention">
            {locale === "ja"
              ? "対応・自動化・レポート"
              : "Attention, automation & reports"}
          </a>
        </nav>
      </details>
      <details className="nav-group">
        <summary>
          <NavIcon kind="settings" />
          {locale === "ja" ? "設定" : "Settings"}
        </summary>
        <nav>
          {group([4, 9, 11, 12, 13, 14])}
          <a href="/operations?view=organization">
            {locale === "ja" ? "組織とチーム" : "Organization & teams"}
          </a>
          <a href="/operations?view=integrations">
            {locale === "ja"
              ? "API・Webhook連携"
              : "API & webhook integrations"}
          </a>
        </nav>
      </details>
      <div className="sidebar-bottom">
        <a href="/auth/disconnect">
          {locale === "ja" ? "個人の接続を解除" : "Disconnect my account"}
        </a>
        <a href="/support">
          <NavIcon kind="help" />
          {locale === "ja" ? "ヘルプ・サポート" : "Help & support"}
        </a>
        <a href="/privacy">{locale === "ja" ? "プライバシー" : "Privacy"}</a>
        <a href="/terms">{locale === "ja" ? "利用条件" : "Terms"}</a>
        <button
          data-keep-menu
          onClick={() => {
            const next = locale === "en" ? "ja" : "en";
            setLocale(next);
            document.documentElement.lang = next;
            document.cookie = `nexus_locale=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
          }}
        >
          {locale === "en" ? "日本語" : "English"}
        </button>
        {data.guilds?.[0]?.name !== "Development guild" && (
          <a href="/auth/logout">{t(locale, "web.sign_out")}</a>
        )}
      </div>
    </>
  );
  if (switchingGuild)
    return (
      <main className="servers-content" aria-busy="true">
        <p role="status">
          {locale === "ja"
            ? "サーバーの権限と利用状態を確認しています。"
            : "Checking server permissions and access."}
        </p>
      </main>
    );
  return (
    <div className="product">
      <aside className="sidebar">
        <a className="brand" href="/">
          <BrandAsset />
        </a>
        {navigation}
      </aside>
      <main className="content">
        <div className="mobile-head">
          <a className="brand" href="/">
            <BrandAsset variant="blue" />
          </a>
          <ProductMenu locale={locale}>{navigation}</ProductMenu>
        </div>
        {data.developmentAuth && (
          <div className="development-auth" role="status">
            DEVELOPMENT AUTH MODE ·{" "}
            {locale === "ja"
              ? "ローカル開発用・サーバー未検証"
              : "Local development · server verification bypassed"}
          </div>
        )}
        <div className="dashboard-topbar">
          <div>
            <span>
              {data.guilds?.find((guild) => guild.id === data.selectedGuildId)
                ?.name ?? "NEXUS"}
            </span>
            <small>
              {data.admin?.usage.plan ??
                (locale === "ja"
                  ? "利用情報未確認"
                  : "Access information unavailable")}{" "}
              ·{" "}
              {data.runtime === undefined
                ? locale === "ja"
                  ? "接続状態未確認"
                  : "Connection status unknown"
                : data.runtime.gatewayConnected
                  ? t(locale, "control.on")
                  : t(locale, "common.needsAttention")}
            </small>
          </div>
          <div className="server-picker">
            <label>
              {t(locale, "web.server")}
              <select
                value={data.selectedGuildId ?? ""}
                onChange={(e) => {
                  setSwitchingGuild(true);
                  window.location.assign(
                    `/auth/select?guild=${encodeURIComponent(e.target.value)}`,
                  );
                }}
              >
                {data.guilds
                  ?.filter((guild) => guild.installed)
                  .map((guild) => (
                    <option key={guild.id} value={guild.id}>
                      {guild.name}
                    </option>
                  ))}
              </select>
            </label>
            <a href="/servers">
              {locale === "ja" ? "サーバー一覧" : "Server list"}
            </a>
          </div>
        </div>
        {data.betaState && (
          <AccessNotice
            state={data.betaState}
            locale={locale}
            onSettings={() => setPage(4)}
          />
        )}
        {page === 0 && (
          <HomeSummary
            data={data}
            locale={locale}
            removed={attentionRemoved}
            onNavigate={setPage}
            detailsOpen={showHomeDetail}
            onDetails={() => {
              setShowHomeDetail(true);
              requestAnimationFrame(() =>
                document.getElementById("home-overview-detail")?.focus(),
              );
            }}
          />
        )}
        {page === 3 && (
          <section className="surface">
            <h1>{locale === "ja" ? "履歴" : "History"}</h1>
            <p>
              {locale === "ja"
                ? "ここでは保存された対応結果を確認できます。詳細分析の履歴・比較はDiscordのNEXUSパネルの「履歴を見る」から開けます。"
                : "Review saved response results here. For detailed analysis history and comparisons, choose View history in the NEXUS panel in Discord."}
            </p>
          </section>
        )}
        <div
          id="home-overview-detail"
          tabIndex={-1}
          hidden={page === 0 && !showHomeDetail}
        >
          {page >= 12 && page <= 14 ? (
            <OperationsView
              data={data.integration}
              model={data.community?.adaptive}
              locale={locale}
              view={page}
              channels={data.options.surfaces ?? data.options.channels}
            />
          ) : page === 10 && data.community?.adaptive ? (
            <JourneysView model={data.community.adaptive} locale={locale} />
          ) : page === 11 ? (
            <CommunityModelEditor
              initial={communityModelSchema.parse(
                data.admin?.settings.communityModel ?? {},
              )}
              snapshot={data.community?.adaptive?.capabilities ?? null}
              locale={locale}
              channels={data.options.surfaces ?? data.options.channels}
              tags={data.options.forumTags}
              onSave={async (profile) => {
                const updated = await request({
                  action: "community_model",
                  profile,
                  revision: notificationRevision,
                });
                if (!updated) return false;
                setNotificationRevision(Number(updated.revision));
                return true;
              }}
              onRefresh={async () =>
                Boolean(await request({ action: "capability_refresh" }))
              }
            />
          ) : data.failures?.[
              page === 0
                ? "home"
                : page === 1
                  ? "journey"
                  : page === 5 || page === 8 || page === 9
                    ? "community"
                    : page === 2
                      ? "actions"
                      : page === 3
                        ? "results"
                        : "dashboard"
            ] ? (
            <FailureNotice
              locale={locale}
              failure={
                data.failures[
                  page === 0
                    ? "home"
                    : page === 1
                      ? "journey"
                      : page === 5 || page === 8 || page === 9
                        ? "community"
                        : page === 2
                          ? "actions"
                          : page === 3
                            ? "results"
                            : "dashboard"
                ]!
              }
              onCheck={() => window.location.reload()}
            />
          ) : data.community?.adaptive && [0, 1, 5, 9].includes(page) ? (
            <>
              {page === 1 && (
                <div className="segmented">
                  {([7, 30, 90] as const).map((value) => (
                    <button
                      key={value}
                      aria-pressed={range === value}
                      onClick={() => void changeRange(value)}
                    >
                      {value}D
                    </button>
                  ))}
                </div>
              )}
              {page === 5 && (
                <div className="surface" role="tablist">
                  {(["overall", "channels", "behavior"] as const).map((tab) => (
                    <button
                      key={tab}
                      role="tab"
                      aria-selected={analysisTab === tab}
                      onClick={() => setAnalysisTab(tab)}
                    >
                      {t(locale, `control.${tab}`)}
                    </button>
                  ))}
                </div>
              )}
              <AdaptiveCommunity
                model={adaptiveData ?? data.community.adaptive}
                locale={locale}
                view={page}
                analysisView={analysisTab}
                operations={data.community.operations}
                onSettings={() => setPage(4)}
                channels={data.options.surfaces ?? data.options.channels}
                attention={{
                  ready: data.community.daily.ready,
                  total: data.community.daily.attentionCount,
                  items: data.community.attention,
                }}
              />
              {page === 0 && data.home?.setup.required && (
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
            </>
          ) : page === 4 ? (
            <>
              <CommunityModelEditor
                initial={communityModelSchema.parse(
                  data.admin?.settings.communityModel ?? {},
                )}
                snapshot={data.community?.adaptive?.capabilities ?? null}
                locale={locale}
                channels={data.options.surfaces ?? data.options.channels}
                tags={data.options.forumTags}
                onSave={async (profile) => {
                  const updated = await request({
                    action: "community_model",
                    profile,
                    revision: notificationRevision,
                  });
                  if (!updated) return false;
                  setNotificationRevision(Number(updated.revision));
                  return true;
                }}
                onRefresh={async () =>
                  Boolean(await request({ action: "capability_refresh" }))
                }
              />
              {views[4]}
            </>
          ) : page === 9 ? (
            rulesView
          ) : page === 8 ? (
            <>
              <TeamQueue
                operations={data.community?.operations}
                locale={locale}
              />
              {attentionView}
            </>
          ) : page === 5 ? (
            <>
              <div
                className="surface"
                role="tablist"
                aria-label={t(locale, "control.analysis")}
              >
                {(["overall", "channels", "behavior"] as const).map((tab) => (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={analysisTab === tab}
                    onClick={() => setAnalysisTab(tab)}
                  >
                    {t(locale, `control.${tab}`)}
                  </button>
                ))}
              </div>
              {analysisTab === "overall" ? (
                <>
                  {views[5]}
                  {views[6]}
                  {opportunityView}
                </>
              ) : analysisTab === "channels" ? (
                views[7]
              ) : (
                <section className="surface">
                  <h1>{t(locale, "control.behavior")}</h1>
                  {data.community?.compare.available ? (
                    <>
                      <p>
                        {t(locale, "control.replyAlert")}:{" "}
                        {wholePercent(
                          data.community.compare.newcomers
                            ?.receivedReplyPercent ?? null,
                        )}
                      </p>
                      <p>
                        {t(locale, "control.voice")}:{" "}
                        {wholePercent(
                          data.community.compare.newcomers?.voicePercent ??
                            null,
                        )}
                      </p>
                      <p>
                        {t(locale, "control.goalEvent")}:{" "}
                        {wholePercent(
                          data.community.compare.newcomers?.eventPercent ??
                            null,
                        )}
                      </p>
                    </>
                  ) : (
                    <p>{t(locale, "control.noComparison")}</p>
                  )}
                  {data.community?.transitions.length ? (
                    <>
                      <h2>{t(locale, "control.moves")}</h2>
                      {data.community.transitions
                        .slice(0, 5)
                        .map((move, index) => (
                          <p key={index}>
                            {move.from === "voice"
                              ? t(locale, "control.voice")
                              : (data.options.channels.find(
                                  (item) => item.id === move.from,
                                )?.label ?? `#${move.from}`)}{" "}
                            →{" "}
                            {move.to === "voice"
                              ? t(locale, "control.voice")
                              : (data.options.channels.find(
                                  (item) => item.id === move.to,
                                )?.label ?? `#${move.to}`)}
                          </p>
                        ))}
                    </>
                  ) : null}
                </section>
              )}
            </>
          ) : (
            views[page]
          )}
        </div>
        {operationFailure && (
          <FailureNotice
            failure={operationFailure}
            locale={locale}
            onCheck={() => window.location.reload()}
          />
        )}
        <p className="status" role="status">
          {status}
        </p>
        <footer className="product-footer">
          <BrandAsset variant="navy" />
          {t(locale, "web.uses_only_the_activity_data_needed")} · NEXUS{" "}
          {VERSION} · {data.runtime?.buildSha ?? "unknown"} · {RELEASE_CHANNEL}{" "}
          ·{" "}
          <a href="/privacy">{locale === "ja" ? "プライバシー" : "Privacy"}</a>{" "}
          · <a href="/terms">{locale === "ja" ? "利用条件" : "Terms"}</a> ·{" "}
          <a href="/support">{locale === "ja" ? "サポート" : "Support"}</a>
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
  const connected =
    data.setup.steps.find((step) => step.key === "connect")?.complete ?? false;
  const defined =
    data.setup.steps.find((step) => step.key === "activation")?.complete ??
    false;
  const native = data.setup.nativeOnboardingEnabled ?? false;
  return (
    <section className="setup-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t(locale, "web.guided_setup")}</p>
          <h2>{c.setup}</h2>
        </div>
      </div>
      <p className="inline-note">
        {connected
          ? t(locale, "web.basic_measurement_is_already_running")
          : t(locale, "web.checking_the_connection_nexus_records_what")}
      </p>
      {!defined && (
        <>
          <h3>{t(locale, "web.what_should_a_successful_newcomer_do")}</h3>
          <div className="preset-row" role="radiogroup">
            {(["reply", "message", "event"] as const).map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name="goal"
                  checked={goal === option}
                  onChange={() => setGoal(option)}
                />
                {option === "reply"
                  ? t(locale, "web.receive_a_reply")
                  : option === "message"
                    ? t(locale, "web.send_a_first_message")
                    : t(locale, "web.join_an_event")}
              </label>
            ))}
          </div>
          <button
            disabled={busy || !goal}
            onClick={() =>
              goal &&
              void prepare(
                { action: "activation_preset", preset: goal },
                "activation",
              )
            }
          >
            {t(locale, "web.save_success_goal")}
          </button>
        </>
      )}
      <p className="inline-note">
        {native
          ? t(locale, "web.discord_onboarding_is_already_in_use")
          : t(locale, "web.discord_onboarding_is_not_currently_in")}
      </p>
      {preview && (
        <PreviewCard
          title={t(locale, "web.confirm_your_first_success")}
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
          {t(locale, "web.value_contacts_week", {
            a: String(template.safety.contactsPerWeek),
          })}
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

function duration(seconds: number, locale: Locale) {
  if (seconds === 0) return t(locale, "web.immediately");
  const hours = seconds / 3600;
  return hours % 24 === 0
    ? t(locale, "web.value_days", { a: String(hours / 24) })
    : t(locale, "web.value_hours", { a: String(hours) });
}

function evidenceLabel(
  item: ResultsPresentation["items"][number],
  locale: Locale,
) {
  if (item.state === "stopped") return t(locale, "web.stopped");
  if (item.state === "paused") return t(locale, "web.paused");
  return evidenceNames[locale][item.evidence];
}
