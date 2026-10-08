import {betaMaintenanceAction,betaReadAction} from '../../../packages/security/src/beta-interactions';
import {betaAccess} from '../../../packages/security/src/hosted-beta';
import {hostedBetaEnabled} from '../../../packages/config/src/hosted-beta';
import { setupInteraction } from "./setup-interactions";
import { analysisInteraction } from "./analysis-interactions";
import {analysisUsage} from "../../../packages/analysis/src/index";
import { AttentionOperations } from "../../../packages/operations/src/attention.js";
import { OperationsIntake } from "../../../packages/operations/src/intake";
import { operationsAccess } from "../../../packages/operations/src/policy";
import { ExploreService } from "../../../packages/analytics/src/explore";
import { chartQuerySchema } from "../../../packages/analytics/src/chart-spec";
import { renderChartPng } from "../../../packages/analytics/src/chart-renderer";
import {
  connectionCodePanel,
  disconnectPanel,
} from "../../../packages/discord-panels/src/views/connection.js";
import { z } from "zod";
import { userFailure } from "../../../packages/shared/src/errors.js";
import { nextZonedDayStart } from "../../../packages/shared/src/timezones.js";
import { discordDashboardLink } from "../../../packages/shared/src/web-link.js";
import { advanceSetup } from "../../../packages/shared/src/setup-flow.js";
import { PermissionFlagsBits } from "discord-api-types/v10";
import {
  sql,
  tenant,
  privacyReadLock,
  type Database,
} from "../../../packages/db/src/index.js";
import type { IdentityVault } from "../../../packages/identity/src/index.js";
import {
  Components,
  canOperatePanel,
} from "../../../packages/security/src/index.js";
import { ServerAuthorization } from "../../../packages/security/src/server-authorization.js";
import { ServerVerification } from "../../../packages/security/src/server-verification.js";
import {
  SettingsService,
  templates,
  type Actor,
  type SettingsView,
} from "../../../packages/settings/src/index.js";
import {
  OnboardingService,
  type Session,
} from "../../../packages/onboarding/src/index.js";
import {
  controlPanel,
  controlPages,
  settingsSections,
  analysisViews,
  panelPlacementWarning,
  settingsPanel,
  basicSettingsPanel,
  improvePanel,
  privacyPanel,
  questionPanel,
  confirmation,
  errorPanel,
  activationPanel,
  activationPreviewPanel,
  billingPanel,
  lifecyclePanel,
  diagnosticsPanel,
  interventionsPanel,
  interventionPreviewPanel,
  experimentsPanel,
  experimentMethodPanel,
  cohortsPanel,
  reportsPanel,
  overviewPanel,
  publishedPanel,
  successPanel,
  panelInstalledPanel,
  rolloutPreviewPanel,
  onboardingModePreviewPanel,
  onboardingNotConfiguredPanel,
  onboardingFlowPanel,
  editQuestionPanel,
  roleMappingPanel,
  sessionCompletePanel,
  activationReadinessPanel,
  guidedSetupPanel,
  resolveLocale,
  t,
  nexusPanel,
  callout,
  divider,
  actionRow,
  type Panel,
  type Issue,
  type ReadinessCheck,
  type UiLocale,
  type ControlPage,
  type SettingsSection,
  type AnalysisView,
} from "../../../packages/discord-panels/src/index.js";
import { enqueue } from "../../../packages/discord/src/outbox.js";
import type { DiscordPort } from "../../../packages/discord/src/rest.js";
import {
  assert,
  DomainError,
  type Scope,
} from "../../../packages/shared/src/index.js";
import type { InteractionJob } from "../../interaction/src/server.js";
import { CapabilityService } from "../../../packages/lifecycle/src/capabilities.js";
import { AnalyticsService } from "../../../packages/analytics/src/index.js";
import {analysisMetrics} from "../../../packages/analytics/src/analysis";
import {completedWindow,fingerprint} from "../../../packages/analysis/src/domain";
import { EntitlementService } from "../../../packages/settings/src/billing/index.js";
import { visibleMetrics } from "../../../packages/settings/src/metric-visibility";
import { BillingService } from "../../../packages/settings/src/billing";
import { PromotionService } from "../../../packages/settings/src/billing";
import { BillingAuthorization } from "../../../packages/security/src/billing-authorization";
import type { EntitlementFeature } from "../../../packages/settings/src/plan-registry";
import {
  promotionResultPanel,
  lockedFeaturePanel,
} from "../../../packages/discord-panels/src/views/billing";
import { domainRevisions } from "../../../packages/settings/src/domain-config.js";
import {
  InterventionService,
  interventionSchema,
} from "../../../packages/lifecycle/src/interventions.js";
import {
  ExperimentService,
  experimentSchema,
} from "../../../packages/lifecycle/src/experiments.js";
import { diagnose } from "../../../packages/analytics/src/diagnoses.js";
import {
  PresentationService,
  compileActionTemplate,
} from "../../../packages/presentation/src/index.js";
import { CommunityService } from "../../../packages/presentation/src/community.js";
import { communityModelSchema } from "../../../packages/shared/src/community-model.js";
import {
  latestCapability,
  requestCapabilityRefresh,
  analysisChannelScope,
} from "../../../packages/lifecycle/src/discovery.js";
import type { InteractionHealthSnapshot } from "../../interaction/src/health.js";
import { releaseInfo } from "../../../packages/shared/src/runtime-info.js";
import { recordProductEvent } from "../../../packages/shared/src/product-telemetry.js";
type DeleteData = (
  s: Scope,
  userId: string,
  actor: Actor,
  guild: boolean,
) => Promise<void>;
export class InteractionWorker {
  private get verification() {
    return new ServerVerification(
      this.db,
      this.vault,
      new ServerAuthorization(this.discord, this.settings, this.vault),
    );
  }
  private async webLink(s: Scope) {
    const verified =
      (await this.verification.connection(s)).state === "VERIFIED";
    return {
      verified,
      url: discordDashboardLink(
        process.env.NEXUS_WEB_URL,
        s.guildId,
        process.env.NEXUS_WEB_AUTH_MODE === "development",
        verified,
      ),
    };
  }
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
    private readonly tokens: Components,
    private readonly discord: DiscordPort,
    private readonly settings: SettingsService,
    private readonly onboarding: OnboardingService,
    private readonly deletion: DeleteData,
    private readonly runtime?: () => {
      gatewayConnected: boolean;
      redisConnected: boolean;
      interaction: InteractionHealthSnapshot;
      commandHash: string;
    },
  ) {}
  async tick(s: Scope) {
    const started = Date.now();
    const job = await this.db.transaction().execute(async (tx) => {
      const row = (
        await sql<{
          id: string;
          encrypted_payload: string;
        }>`SELECT id,encrypted_payload FROM interaction_jobs WHERE ${tenant(s)}
    AND created_at>now()-interval '14 minutes' AND attempts<5 AND (state='PENDING' OR state='RUNNING' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`.execute(
          tx,
        )
      ).rows[0];
      if (row)
        await sql`UPDATE interaction_jobs SET state='RUNNING',lease_until=now()+interval '60 seconds',attempts=attempts+1 WHERE ${tenant(s)} AND id=${row.id}`.execute(
          tx,
        );
      return row;
    });
    if (!job) return false;
    const input = JSON.parse(
      this.vault.open(s, job.encrypted_payload),
    ) as InteractionJob;
    let body: Panel,
      privateError = false,
      stage = "dispatch",
      action = input.command ?? "unknown",
      challengeId: string | undefined,
      returnPage:
        | "overview"
        | "newMembers"
        | "attention"
        | "analysis"
        | "settings"
        | "improve"
        | "results" = "overview";
    try {
      body = await this.dispatch(
        s,
        input,
        (value) => {
          if (value.startsWith("action:")) action = value.slice(7);
          else if (value.startsWith("return:"))
            returnPage = value.slice(7) as typeof returnPage;
          else stage = value;
        },
        (id) => {
          challengeId = id;
        },
      );
      if (challengeId) {
        stage = "verification_reply";
        // Verification codes live only in memory and the ephemeral Discord reply.
        // Ordinary outbox bodies are plaintext, so this reply must bypass that queue.
        try {
          await this.discord.editReply(input.applicationId, input.token, body);
        } catch {
          await this.verification.revokeChallenge(s, challengeId);
          throw new DomainError("VERIFICATION_DELIVERY_FAILED");
        }
        await this.db.transaction().execute(async (tx) => {
          await sql`UPDATE interaction_diagnostics SET result='completed',completed_at=now() WHERE ${tenant(s)} AND interaction_hash=${this.vault.hash(s, input.id)}`.execute(
            tx,
          );
          await sql`UPDATE interaction_jobs SET state='SUCCEEDED',lease_until=NULL WHERE ${tenant(s)} AND id=${input.id}`.execute(
            tx,
          );
        });
        return true;
      }
      void recordProductEvent(
        this.db,
        s,
        "interaction_latency",
        Date.now() - started,
      ).catch(() => {});
      if (input.messageId && input.customId) {
        const installed = (
          await sql<{
            message_id: string;
          }>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(
            this.db,
          )
        ).rows[0];
        if (installed?.message_id === input.messageId) {
          const intent = await this.tokens.read(
            this.db,
            s,
            input.customId,
            this.vault.hash(s, input.userId),
          );
          privateError =
            intent.action === "advanced" ||
            intent.action === "privacy" ||
            (intent.privateSettings === true && !input.privateResponse);
        }
      }
    } catch (error) {
      void recordProductEvent(this.db, s, "interaction_failed").catch(() => {});
      const actorHash = this.vault.hash(s, input.userId),
        issue: Issue = (data, publicEntry = false) =>
          this.tokens.issue(
            this.db,
            s,
            data,
            publicEntry ? null : actorHash,
            publicEntry ? 31536000 : 900,
          );
      let language: "auto" | "ja" | "en" | "bilingual" = "auto";
      try {
        language = (await this.settings.get(s)).uiLanguage;
      } catch {
        /* Error response still has interaction locale. */
      }
      const locale = resolveLocale(language, {
        interactionLocale: input.locale,
        guildLocale: input.guildLocale,
      });
      const readOnly = [
        "controlNavigate",
        "controlRefresh",
        "controlAnalysis",
        "controlChannelPage",
        "controlAttentionPage",
        "controlSettings",
        "controlRules",
        "contextExplain",
        "contextMember",
        "overview",
        "lifecycle",
        "diagnose",
        "experiments",
        "status",
        "settings",
        "billing",
        "cohorts",
        "reports",
      ].includes(action);
      const failure = userFailure(
        error,
        readOnly ||
          [
            "dispatch",
            "member_lookup",
            "settings_load",
            "intent_read",
            "authorization",
          ].includes(stage)
          ? "NOT_STARTED"
          : "UNKNOWN",
        { action, command: input.command, stage, secrets: [input.token] },
      );
      privateError = Boolean(input.messageId) && !input.privateResponse;
      body = await errorPanel(
        issue,
        failure,
        locale,
        undefined,
        error instanceof DomainError ? error.code : undefined,
        { page: returnPage, retryRead: readOnly },
      );
    }
    await this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      const { nexusFiles, ...replyBody } = body as Panel & {
        nexusFiles?: { filename: string; dataBase64: string }[];
      };
      const interactionHash = this.vault.hash(s, input.id);
      await enqueue(
        tx,
        s,
        `reply:${input.id}`,
        privateError ? "REPLY_FOLLOWUP" : "REPLY_EDIT",
        {
          applicationId: input.applicationId,
          encryptedToken: this.vault.seal(s, input.token),
          body: replyBody,
          ...(nexusFiles ? { files: nexusFiles } : {}),
          interactionHash,
        },
      );
      await sql`UPDATE interaction_diagnostics SET result='queued' WHERE ${tenant(s)} AND interaction_hash=${interactionHash}`.execute(
        tx,
      );
      await sql`UPDATE interaction_jobs SET state='SUCCEEDED',lease_until=NULL,encrypted_payload=${this.vault.seal(s, JSON.stringify({ ...input, fields: undefined }))} WHERE ${tenant(s)} AND id=${input.id}`.execute(
        tx,
      );
    });
    return true;
  }
  async dispatch(
    s: Scope,
    input: InteractionJob,
    onStage: (stage: string) => void = () => {},
    onSensitiveReply: (challengeId: string) => void = () => {},
  ): Promise<Panel> {
    onStage("member_lookup");
    const authority = new ServerAuthorization(
        this.discord,
        this.settings,
        this.vault,
      ),
      authorization = await authority.snapshot(
        s,
        input.userId,
        "DISCORD_PANEL",
        input.id,
      );
    const member = authorization.member,
      actorHash = this.vault.hash(s, input.userId),
      actor = authorization.actor;
    onStage("settings_load");
    const current = authorization.settings;
    const admin = canOperatePanel(member.permissions, member.roles, [
      current.adminRoleId,
      ...current.managerRoleIds,
    ]);
    const locale = resolveLocale(current.uiLanguage, {
      interactionLocale: input.locale,
      guildLocale: input.guildLocale,
    });
    const publicLocale = resolveLocale(current.uiLanguage, {
      interactionLocale: input.locale,
      guildLocale: input.guildLocale,
      publicPanel: true,
    });
    onStage("intent_read");
    const intent = input.customId
      ? await this.tokens.read(this.db, s, input.customId, actorHash)
      : { action: input.command };
    const action = String(intent.action ?? "");
    if(!betaMaintenanceAction(action))await this.db.transaction().execute(tx=>betaAccess(tx,s,betaReadAction(action)?'read':'work',betaReadAction(action)?undefined:input.betaGeneration??null));
    if (action === "intakeSubmit") {
      const result = await new OperationsIntake(
        this.db,
        this.vault,
        this.discord,
        this.tokens,
      ).submit(s, actor, input.userId, input.id, intent, input.fields ?? {});
      return {
        content:
          locale === "ja"
            ? `運営へのリクエストを受け付けました。受付番号: ${result.id}`
            : `Your operations request was received. Reference: ${result.id}`,
        allowed_mentions: { parse: [] },
      };
    }
    if (action === "overview") {
      assert(
        !member.bot && Date.now() - authorization.checkedAt <= 10000,
        "GUILD_MEMBER_REQUIRED",
        403,
      );
      await this.db
        .transaction()
        .execute((tx) => operationsAccess(tx, s, actor, "READ"));
      return this.communityPanel((intent,publicEntry=false)=>this.tokens.issue(this.db,s,intent,publicEntry?null:actorHash,publicEntry?31536000:900),s,locale,'overview');
    }

    if (
      [
        "chart",
        "compare",
        "chartPeriod",
        "support-health",
        "newcomer-flow",
      ].includes(action)
    ) {
      assert(
        !member.bot && Date.now() - authorization.checkedAt <= 10000,
        "GUILD_MEMBER_REQUIRED",
        403,
      );
      await this.db
        .transaction()
        .execute((tx) =>
          operationsAccess(tx, s, actor, "READ", "discord_charts"),
        );
      const options = input.commandOptions ?? intent;
      const query = chartQuerySchema.parse({
        metric: options.metric ?? "reply",
        days: Number(options.days ?? 7),
        compare: action === "compare" || options.compare === true,
        timezone: current.timezone,
      });
      const explore = new ExploreService(this.db),
        spec =
          action === "support-health" || action === "newcomer-flow"
            ? await explore.saved(s, action)
            : await explore.chart(s, query);
      const image = await renderChartPng(spec),
        files = [
          { filename: "nexus-chart.png", dataBase64: image.toString("base64") },
        ];
      const issueChart: Issue = (data) =>
        this.tokens.issue(
          this.db,
          s,
          { ...data, privateSettings: true },
          actorHash,
          900,
        );
      const web = await this.webLink(s);
      const entitlement = await new EntitlementService(this.db).effective(s),
        comparable = await new EntitlementService(this.db).can(
          s,
          "comparable_periods",
        );
      const buttons = await actionRow(issueChart, [
        ...[7, 30, 90].map((days) => ({
          label: `${days} days`,
          action: "chartPeriod",
          data: { metric: spec.metric, days, compare: query.compare },
          disabled:
            entitlement.limits.historyDays !== null &&
            days * (query.compare ? 2 : 1) > entitlement.limits.historyDays,
        })),
        {
          label: locale === "ja" ? "比較" : "Compare",
          action: "chartPeriod",
          data: { metric: spec.metric, days: spec.range.days, compare: true },
          disabled:
            !comparable ||
            (entitlement.limits.historyDays !== null &&
              spec.range.days * 2 > entitlement.limits.historyDays),
        },
      ]);
      const body: Panel & { nexusFiles?: typeof files } = {
        content: `**${spec.title}**\n${spec.range.from.slice(0, 10)} — ${spec.range.to.slice(0, 10)} · ${spec.evidence.coverageState}\n${locale === "ja" ? "観測された集計です。欠測を0や原因に置き換えません。" : "Aggregate observations. Missing data is not zero; changes are not causal claims."}`,
        allowed_mentions: { parse: [] },
        embeds: [{ image: { url: "attachment://nexus-chart.png" } }],
        components: [
          buttons,
          ...(web.url
            ? [
                {
                  type: 1 as const,
                  components: [
                    {
                      type: 2 as const,
                      style: 5 as const,
                      label:
                        locale === "ja" ? "Dashboardを開く" : "Open Dashboard",
                      url: web.url,
                    },
                  ],
                },
              ]
            : []),
        ],
      };
      if (options.visibility === "channel") {
        assert(input.channelId, "CHANNEL_REQUIRED", 400);
        await this.discord.checkChannel(s.guildId, input.channelId);
        await this.db.transaction().execute(async (tx) => {
          await operationsAccess(tx, s, actor, "OPERATE", "discord_charts");
          assert(
            Date.now() - authorization.checkedAt <= 10000,
            "AUTHORIZATION_EXPIRED",
            403,
          );
          await enqueue(tx, s, `chart-publish:${input.id}`, "CHART_PUBLISH", {
            channelId: input.channelId,
            body,
            files,
          });
        });
        return {
          content:
            locale === "ja"
              ? "権限を確認したチャンネルへのレポート送信を受け付けました。"
              : "Chart publication queued for the authorized channel.",
          allowed_mentions: { parse: [] },
        };
      }
      body.nexusFiles = files;
      return body;
    }
    onStage(`action:${action}`);
    const requested = String(intent.page ?? input.values?.[0] ?? "");
    const returnPage = [
      "overview",
      "newMembers",
      "attention",
      "analysis",
      "settings",
      "improve",
      "results",
    ].includes(requested)
      ? requested
      : action.startsWith("context") ||
          /Attention|Acknowledge|Snooze|Resolve/.test(action)
        ? "attention"
        : /Analysis|ChannelPage/.test(action) || action === "diagnose"
          ? "analysis"
          : /Improve|intervention/.test(action) || action === "improve"
            ? "improve"
            : /experiment/.test(action)
              ? "results"
              : action.startsWith("control") || action === "settings"
                ? "settings"
                : "overview";
    onStage(`return:${returnPage}`);
    if (action === "panel" || action === "controlNavigate") {
      const page =
        action === "panel" ? "overview" : String(input.values?.[0] ?? "");
      const event =
        page === "attention"
          ? "attention_opened"
          : page === "analysis"
            ? "analysis_opened"
            : page === "settings"
              ? "settings_opened"
              : "discord_panel_opened";
      void recordProductEvent(this.db, s, event).catch(() => {});
    }
    const setupFlow = action === "setup" || intent.setupFlow === true;
    const privateSettings = intent.privateSettings === true;
    let panelMessageId = privateSettings
      ? String(intent.panelMessageId ?? "")
      : undefined;
    if (privateSettings) {
      const saved = (
        await sql<{
          message_id: string;
        }>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(
          this.db,
        )
      ).rows[0];
      assert(saved && (!panelMessageId || saved.message_id === panelMessageId), "COMPONENT_EXPIRED");
      panelMessageId = saved.message_id;
    }

    const issue: Issue = (data, publicEntry = false) =>
      this.tokens.issue(
        this.db,
        s,
        privateSettings
          ? { ...data, privateSettings: true, panelMessageId }
          : setupFlow
            ? { ...data, setupFlow: true }
            : data,
        publicEntry && !setupFlow && !privateSettings ? null : actorHash,
        publicEntry && !setupFlow && !privateSettings ? 31536000 : 900,
      );
    if(action==='setup'||action==='controlReviewSetup'||action.startsWith('setupWizard')||action.startsWith('analysis')) {
      assert(!member.bot && Date.now()-authorization.checkedAt<=10000,"GUILD_MEMBER_REQUIRED",403);
    }
    if(action==='setup'||action==='controlReviewSetup')return setupInteraction(this.db,this.discord,s,actor,issue,locale,{action:'setupWizard'});
    if (['analysisMenu','analysisPreview','analysisStart','analysisRerun','analysisHistory','analysisResult','analysisEvidence','analysisCompare','analysisAttention','analysisAttentionConfirm','analysisCancel','analysisAttentionList','analysisAttentionItem','analysisAttentionUpdate'].includes(action)) {
      return analysisInteraction(this.db,s,actor,issue,locale,intent,input.values,input.customId??input.id);
    }
    if (action.startsWith('setupWizard'))return setupInteraction(this.db,this.discord,s,actor,issue,locale,intent,input.values);
    const adminActions = [
      "controlRules",
      "controlNotificationSave",
      "contextAdd",
      "contextResolve",
      "contextExplain",
      "contextMember",
      "panel",
      "panelConfirm",
      "panelChoose",
      "panelRefresh",
      "panelMoveConfirm",
      "controlNavigate",
      "controlRefresh",
      "controlAnalysis",
      "controlChannelPage",
      "controlAttentionPage",
      "controlSettings",
      "controlSummaryField",
      "controlGoalPurpose",
      "controlScope",
      "controlScopeChannels",
      "controlManagers",
      "controlManagersConfirm",
      "controlCancelManagers",
      "controlClearManagers",
      "controlClearHelpers",
      "controlSkipTeam",
      "controlSkipNotifications",
      "controlSkipGoals",
      "controlScopeDefault",
      "controlKeepSettings",
      "controlReviewSetup",
      "controlMovePanel",
      "controlOpenAttention",
      "controlOpenDiagnostics",
      "controlResolve",
      "controlAcknowledge",
      "controlSnoozeMenu",
      "controlSnooze",
      "controlApplyImprove",
      "controlCancelImprove",
      "controlHelpers",
      "controlHelperChannel",
      "controlAlertDelay",
      "controlHelperToggle",
      "controlGoal",
      "controlGoalPreset",
      "controlGoalChannel",
      "controlWeeklyChannel",
      "controlWeeklyDay",
      "controlWeeklyHour",
      "controlTimezone",
      "controlWeeklyToggle",
      "controlTryImprove",
      "controlTestAlert",
      "controlTestAlertPreview",
      "controlTestSummary",
      "setup",
      "setupNext",
      "setupHome",
      "recommendedSetup",
      "rolloutPreview",
      "rolloutConfirm",
      "modePreview",
      "modeConfirm",
      "lifecycle",
      "activation",
      "activationDraft",
      "activationPublish",
      "cohorts",
      "diagnose",
      "improve",
      "interventions",
      "interventionDraft",
      "interventionApprove",
      "experiments",
      "experimentMethod",
      "experimentDraft",
      "configPublish",
      "reports",
      "billing",
      "advanced",
      "settings",
      "status",
      "flows",
      "template",
      "startChannel",
      "adminNotificationChannel",
      "helperChannel",
      "helperEnabled",
      "uiLanguage",
      "enabled",
      "onboardingEnabled",
      "mapOption",
      "mapRole",
      "editNode",
      "editNodeOpen",
      "editNodeSave",
      "rollback",
      "preview",
      "deleteGuildConfirm",
      "deleteGuild",
      "overview",
      "dashboard",
    ];
    onStage("authorization");
    if (
      adminActions.includes(action) ||
      ["link", "unlink", "unlinkConfirm", "unlinkCancel"].includes(action)
    )
      await this.db.transaction().execute(tx=>operationsAccess(tx,s,actor,['controlNavigate','controlRefresh','controlAnalysis','controlChannelPage','controlAttentionPage','controlSettings','controlRules','overview','lifecycle','cohorts','diagnose','experiments','reports','status','settings','billing','panel'].includes(action)?'READ':['contextAdd','contextResolve','controlResolve','controlAcknowledge','controlSnoozeMenu','controlSnooze'].includes(action)?'OPERATE':'CONFIGURE',undefined,betaMaintenanceAction(action)));
    onStage("operation");
    if(action==="controlTestAlertPreview"){
      assert(current.helperChannelId,"CHANNEL_REQUIRED");
      return nexusPanel({title:t(locale,"control.testAlert"),children:[callout(t(locale,"control.destination"),`<#${current.helperChannelId}>`),callout(locale==="ja"?"送信する内容":"What will be sent",locale==="ja"?"このチャンネルへテスト通知を1件送信します。全員へのメンションは行いません。":"Send one test notification to this channel without mentioning everyone.")],rows:[await actionRow(issue,[{label:locale==="ja"?"テスト通知を送る":"Send test notification",action:"controlTestAlert",data:{revision:current.revision,channelId:current.helperChannelId},style:1},{label:t(locale,"common.back"),action:"controlSettings",data:{section:"notifications"}}])]});
    }
    if (["controlModelSave", "controlModelRefresh"].includes(action)) {
      await this.db.transaction().execute(tx=>operationsAccess(tx,s,actor,'CONFIGURE'));
      if (action === "controlModelRefresh")
        await requestCapabilityRefresh(this.db, s, "manual");
      else {
        const modes = JSON.parse(input.fields?.modes ?? "[]") as unknown,
          channels = JSON.parse(input.fields?.channel ?? "[]") as string[],
          channel = channels[0],
          profile = communityModelSchema.parse({
            ...current.communityModel,
            modes,
            confirmed: true,
            voiceThresholdSeconds:
              z.coerce
                .number()
                .int()
                .min(1)
                .max(60)
                .parse(input.fields?.threshold) * 60,
            ...(channel
              ? {
                  channels: [
                    ...current.communityModel.channels.filter(
                      (c) => c.channelId !== channel,
                    ),
                    {
                      channelId: channel,
                      purpose: input.fields?.purpose ?? "OTHER",
                    },
                  ],
                }
              : {}),
          });
        await this.settings.update(
          s,
          actor,
          z.number().parse(intent.revision),
          { communityModel: profile },
        );
      }
      return this.communityPanel(issue, s, locale, "settings", "model");
    }
    if (action === "link") {
      assert(
        input.command === "link" && !input.customId && !input.messageId,
        "VERIFICATION_PRIVATE_REQUIRED",
      );
      const url = discordDashboardLink(
        process.env.NEXUS_WEB_URL,
        s.guildId,
        process.env.NEXUS_WEB_AUTH_MODE === "development",
        false,
      );
      assert(url, "WEB_CONNECTION_UNAVAILABLE");
      const challenge = await this.verification.issue(
        s,
        input.userId,
        "DISCORD_PANEL",
        authorization,
      );
      onSensitiveReply(challenge.id);
      return connectionCodePanel(
        challenge.code,
        challenge.expiresAt,
        url,
        locale,
      );
    }
    if (action === "unlink") {
      const connection = await this.verification.connection(s);
      return disconnectPanel(issue, connection.version, locale,hostedBetaEnabled());
    }
    if (action === "unlinkConfirm") {
      assert(input.customId, "CONFIRMATION_REQUIRED");
      assert(
        intent.version === null || typeof intent.version === "string",
        "INVALID_COMPONENT",
      );
      await this.verification.disconnect(
        s,
        input.userId,
        intent.version,
        "DISCORD_PANEL",
        authorization,
      );
      return nexusPanel({
        title:
          locale === "ja"
            ? "Web接続を解除しました"
            : "Web Dashboard disconnected",
        children: [
          callout(
            "NEXUS",
            locale === "ja"
              ? hostedBetaEnabled()?"新しい収集を停止し、このサーバーのデータ削除を受け付けました。":"データは保持されています。再接続には /nexus link を実行してください。"
              : hostedBetaEnabled()?"New collection is stopped. Data deletion for this server has been requested.":"Your data is preserved. Run /nexus link to reconnect.",
          ),
        ],
      });
    }
    if (action === "unlinkCancel")
      return nexusPanel({
        title: locale === "ja" ? "キャンセルしました" : "Cancelled",
        children: [],
      });
    if (action === "contextMember") {
      const target = z
          .string()
          .regex(/^\d{17,20}$/)
          .parse(input.targetUserId),
        hash = this.vault.hash(s, target);
      const episode = (
        await sql<{
          id: string;
          joined_at: Date;
        }>`SELECT e.id,e.joined_at FROM membership_episodes e JOIN member_identity_map m ON m.organization_id=e.organization_id AND m.guild_id=e.guild_id AND m.id=e.identity_id WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND m.lookup_hash=${hash} AND e.context='PRODUCTION' ORDER BY e.joined_at DESC LIMIT 1`.execute(
          this.db,
        )
      ).rows[0];
      if (!episode)
        return nexusPanel({
          title:
            locale === "ja" ? "👋 新規メンバー状態" : "👋 New member status",
          children: [
            divider(),
            callout(
              `<@${target}>`,
              locale === "ja"
                ? "観測できる活動がありません。"
                : "No observable activity is available.",
            ),
          ],
        });
      const allowed=await analysisChannelScope(this.db,s,current);
      const scopeFilter = sql`(data->>'channelId' IS NULL OR data->>'channelId'=ANY(${allowed.actualChannelIds}::text[]))`;
      const facts = (
        await sql<{
          kind: string;
        }>`SELECT DISTINCT kind FROM lifecycle_events WHERE ${tenant(s)} AND episode_id=${episode.id}::uuid AND context='PRODUCTION' AND ${scopeFilter} AND occurred_at>=${episode.joined_at} AND occurred_at<${new Date(episode.joined_at.getTime() + 72 * 3600000)} AND kind IN ('message.sent','reaction.received','reaction.added','reply.received','reply.established','voice.connected','voice.started','scheduled_event.subscribed')`.execute(
          this.db,
        )
      ).rows.map((row) => row.kind);
      const reactionCount =
        (
          await sql<{
            count: number;
          }>`SELECT count(*)::integer AS count FROM lifecycle_events WHERE ${tenant(s)} AND episode_id=${episode.id}::uuid AND context='PRODUCTION' AND ${scopeFilter} AND kind='reaction.received' AND occurred_at>=${episode.joined_at} AND occurred_at<${new Date(episode.joined_at.getTime() + 72 * 3600000)}`.execute(
            this.db,
          )
        ).rows[0]?.count ?? 0;
      const connected =
          facts.includes("reply.received") ||
          facts.includes("reply.established") ||
          facts.includes("voice.connected"),
        link = (await this.webLink(s)).url;
      return nexusPanel({
        title: locale === "ja" ? "👋 新規メンバー状態" : "👋 New member status",
        children: [
          divider(),
          callout(
            `<@${target}>`,
            `${locale === "ja" ? "参加" : "Joined"}: <t:${Math.floor(episode.joined_at.getTime() / 1000)}:R>\n${connected ? (locale === "ja" ? "✅ 最初の交流を確認" : "✅ First connection observed") : locale === "ja" ? "🟡 最初の交流を確認中" : "🟡 Waiting for first connection"}`,
          ),
          callout(
            t(locale, "experience.rules"),
            `${facts.includes("message.sent") ? "✓" : "–"} ${locale === "ja" ? "投稿" : "Post"}\n${reactionCount ? "✓" : "–"} ${t(locale, "polish.received", { count: reactionCount })}\n${facts.includes("reply.received") ? "✓" : "–"} ${locale === "ja" ? "直接返信を受けた" : "Received a direct reply"}\n${facts.includes("voice.connected") ? "✓" : "–"} ${locale === "ja" ? "他の人と同じボイスに一定時間参加" : "Observed voice co-presence"}`,
          ),
          callout(
            t(locale, "polish.receivedTotal"),
            t(locale, "experience.reactionWeak"),
          ),
          ...(link ? [callout("Web Dashboard", link)] : []),
        ],
      });
    }
    if (
      action === "contextAdd" ||
      action === "contextResolve" ||
      action === "contextExplain"
    ) {
      const messageId = z
          .string()
          .regex(/^\d{17,20}$/)
          .parse(input.targetMessageId),
        channelId = z
          .string()
          .regex(/^\d{17,20}$/)
          .parse(input.channelId);
      const source = (
        await sql<{
          occurred_at: Date;
          joined_at: Date;
          data: Record<string, unknown>;
        }>`SELECT f.occurred_at,e.joined_at,f.data FROM lifecycle_events f JOIN membership_episodes e ON e.organization_id=f.organization_id AND e.guild_id=f.guild_id AND e.id=f.episode_id WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.context='PRODUCTION' AND f.kind='message.sent' AND f.data->>'messageId'=${messageId} AND f.data->>'channelId'=${channelId} AND f.occurred_at<e.joined_at+interval '72 hours' LIMIT 1`.execute(
          this.db,
        )
      ).rows[0];
      if (!source)
        return nexusPanel({
          title: locale === "ja" ? "投稿の判定" : "Message detection",
          children: [
            divider(),
            callout(
              t(locale, "control.attention"),
              locale === "ja"
                ? "この投稿は新規メンバーの観測対象として確認できません。"
                : "This post is not an observed newcomer candidate.",
            ),
          ],
        });
      const prior = (
          await sql<{
            status: string;
          }>`SELECT status FROM attention_items WHERE ${tenant(s)} AND message_id=${messageId}`.execute(
            this.db,
          )
        ).rows[0],
        waiting = Math.max(
          0,
          Math.floor((Date.now() - source.occurred_at.getTime()) / 60000),
        ),
        alreadyReplied = source.data.receivedExplicitReply === true;
      if (action === "contextExplain")
        return nexusPanel({
          title: locale === "ja" ? "投稿の判定" : "Message detection",
          children: [
            divider(),
            callout(
              t(locale, "control.queueTitle", { channel: channelId }),
              prior?.status === "ACKNOWLEDGED"
                ? t(locale, "experience.staffAcknowledged")
                : prior?.status === "RESOLVED"
                  ? t(locale, "control.resolve")
                  : alreadyReplied
                    ? locale === "ja"
                      ? "直接返信を確認しました。"
                      : "A direct reply was observed."
                    : waiting >= current.firstResponseMinutes
                      ? t(locale, "experience.needsAttention")
                      : locale === "ja"
                        ? "まだ基準時間に達していません。"
                        : "The delay threshold has not been reached.",
            ),
            callout(
              t(locale, "experience.rules"),
              `${t(locale, "control.minutes", { count: waiting })} / ${t(locale, "control.minutes", { count: current.firstResponseMinutes })}\n${t(locale, "experience.waitReason")}`,
            ),
          ],
        });
      assert(!alreadyReplied, "ATTENTION_NOT_ACTIVE");
      if (action === "contextResolve")
        assert(prior && prior.status !== "RESOLVED", "ATTENTION_NOT_ACTIVE");
      const status = action === "contextAdd" ? "OPEN" : "RESOLVED";
      const operations = new AttentionOperations(this.db);
      if (status === "OPEN")
        await operations.addObserved(
          s,
          channelId,
          messageId,
          new Date(),
          source.occurred_at,
        );
      else await operations.action(s, messageId, channelId, status);
      return nexusPanel({
        title: locale === "ja" ? "投稿の判定" : "Message detection",
        children: [
          divider(),
          callout(
            t(locale, "control.queueTitle", { channel: channelId }),
            action === "contextAdd"
              ? locale === "ja"
                ? "対応対象に追加しました。"
                : "Added to Attention."
              : locale === "ja"
                ? "解決済みにしました。"
                : "Marked resolved.",
          ),
        ],
      });
    }
    const followupControlActions = new Set([
      "controlManagersConfirm",
      "controlCancelManagers",
      "controlApplyImprove",
      "controlSnooze",
      "controlCancelImprove",
    ]);
    if (
      action.startsWith("control") &&
      input.messageId &&
      !setupFlow &&
      !privateSettings &&
      !followupControlActions.has(action)
    ) {
      const active = (
        await sql<{
          message_id: string;
        }>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(
          this.db,
        )
      ).rows[0];
      assert(active?.message_id === input.messageId, "COMPONENT_EXPIRED");
    }
    if (action === "setupHome")
      return this.communityPanel(issue, s, locale, "overview");
    if (action === "setupNext") {
      if (input.messageId && !setupFlow) {
        const active = (
          await sql<{
            message_id: string;
          }>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(
            this.db,
          )
        ).rows[0];
        assert(active?.message_id === input.messageId, "COMPONENT_EXPIRED");
      }
      const step = z
          .enum(["scope", "team", "notifications", "goals"])
          .parse(intent.step),
        revision = z.number().parse(intent.revision),
        mode = z
          .enum(["complete", "skip"])
          .default("complete")
          .parse(intent.mode);
      assert(
        !(
          current.setupVersion === 1 &&
          Object.values(current.setupSteps).every(Boolean)
        ),
        "SETUP_REVIEW_REQUIRED",
      );
      let progress: ReturnType<typeof advanceSetup>;
      try {
        progress = advanceSetup(current, step);
      } catch {
        throw new DomainError("SETUP_STEP_OUT_OF_ORDER");
      }
      const defaults =
        mode === "skip"
          ? step === "scope"
            ? { analysisScope: { mode: "all" as const, channelIds: [] } }
            : step === "team"
              ? { managerRoleIds: [], helperRoleIds: [] }
              : step === "notifications"
                ? {
                    helperEnabled: false,
                    helperChannelId: null,
                    weeklySummaryEnabled: false,
                    weeklySummaryChannelId: null,
                  }
                : {
                    goalPreset: null,
                    newMemberGoals: [],
                    importantChannels: [],
                  }
          : {};
      await this.settings.update(s, actor, revision, {
        ...defaults,
        setupSteps: progress.setupSteps,
        setupVersion: progress.setupVersion,
      });
      if (!progress.next) {
        if (
          current.setupVersion < 2 ||
          !Object.values(current.setupSteps).every(Boolean)
        )
          void recordProductEvent(this.db, s, "setup_completed").catch(
            () => {},
          );
        return successPanel(
          issue,
          locale === "ja" ? "セットアップ完了" : "Setup complete",
          locale === "ja" ? "ホームへ戻れます。" : "Return to Home.",
          { label: locale === "ja" ? "ホーム" : "Home", action: "setupHome" },
          locale,
        );
      }
      return this.communityPanel(issue, s, locale, "settings", progress.next);
    }
    if (action === "recommendedSetup") {
      const capability = await new CapabilityService(
        this.db,
        this.discord,
      ).latest(s);
      assert(capability, "CAPABILITY_CHECK_REQUIRED");
      assert(
        capability.recommendedMode === "native"
          ? capability.nativeOnboardingEnabled
          : Boolean(current.startChannelId && current.flowVersionId),
        "RECOMMENDED_SETUP_REQUIRES_CONFIGURATION",
      );
      const revisions = domainRevisions(this.db),
        id = await revisions.draft(s, actor, "onboarding", {
          onboardingMode: capability.recommendedMode,
          hybrid: current.hybrid,
        }),
        preview = await revisions.preview(s, id);
      return onboardingModePreviewPanel(
        issue,
        {
          from: current.onboardingMode,
          to: capability.recommendedMode,
          publishData: {
            id,
            hash: preview.confirmationHash,
            expectedHead: preview.before?.id ?? null,
          },
        },
        locale,
      );
    }
    if (action === "rolloutPreview")
      return rolloutPreviewPanel(issue, current.revision, locale);
    if (action === "rolloutConfirm") {
      await this.settings.update(s, actor, z.number().parse(intent.revision), {
        flags: {
          ...current.flags,
          native_capability_v2: true,
          native_snapshot_v2: true,
          activation_dsl_v2: true,
          interventions_v2: true,
          experiments_v2: true,
        },
      });
      return successPanel(
        issue,
        t(locale, "success.rollout"),
        t(locale, "success.rolloutDetail"),
        { label: t(locale, "common.activation"), action: "activation" },
        locale,
      );
    }
    if (action === "modePreview") {
      const mode = z
        .enum(["auto", "native", "fallback", "hybrid"])
        .parse(input.values?.[0]);
      const revisions = domainRevisions(this.db),
        id = await revisions.draft(s, actor, "onboarding", {
          onboardingMode: mode,
          hybrid: current.hybrid,
        }),
        preview = await revisions.preview(s, id);
      return onboardingModePreviewPanel(
        issue,
        {
          from: current.onboardingMode,
          to: mode,
          publishData: {
            id,
            hash: preview.confirmationHash,
            expectedHead: preview.before?.id ?? null,
          },
        },
        locale,
      );
    }
    if (action === "activation") return activationPanel(issue, locale);
    if (action === "activationDraft") {
      const signal = z
          .enum([
            "reply.received",
            "scheduled_event.subscribed",
            "message.sent",
          ])
          .parse(input.values?.[0]),
        revisions = domainRevisions(this.db);
      assert(
        await new EntitlementService(this.db).canDefineActivation(s, {
          windowSeconds: 604800,
          rule: { op: "event", event: signal, withinSeconds: 604800 },
        }),
        "ENTITLEMENT_REQUIRED",
      );
      const id = await revisions.draft(s, actor, "activation", {
          name: `${signal} within 7d`,
          windowSeconds: 604800,
          rule: { op: "event", event: signal, withinSeconds: 604800 },
        }),
        preview = await revisions.preview(s, id);
      return activationPreviewPanel(
        issue,
        {
          signal,
          publishData: {
            id,
            hash: preview.confirmationHash,
            expectedHead: preview.before?.id ?? null,
          },
        },
        locale,
      );
    }
    if (action === "configPublish") {
      const revisions = domainRevisions(this.db),
        revision = await revisions.get(s, z.uuid().parse(intent.id));
      const feature =
        revision.domain === "activation"
          ? "custom_activation"
          : revision.domain === "intervention"
            ? "interventions"
            : revision.domain === "experiment"
              ? "experiments"
              : null;
      if (feature)
        assert(
          feature === "custom_activation"
            ? await new EntitlementService(this.db).canDefineActivation(
                s,
                revision.definition,
              )
            : await new EntitlementService(this.db).can(s, feature),
          "ENTITLEMENT_REQUIRED",
        );
      if (revision.domain === "intervention")
        for (const step of interventionSchema.parse(revision.definition)
          .actions) {
          if ("channelId" in step)
            await this.discord.checkChannel(s.guildId, step.channelId);
          if (step.type === "recommend_channels")
            for (const id of step.channels)
              await this.discord.checkChannel(s.guildId, id);
          if (step.type === "recommend_event") {
            assert(this.discord.options, "DISCORD_UNAVAILABLE");
            const choices = await this.discord.options(s.guildId);
            assert(
              choices.events.some((event) => event.id === step.eventId),
              "EVENT_NOT_AVAILABLE",
            );
          }
          if ("roleId" in step)
            await this.discord.validateRole(s.guildId, step.roleId);
        }
      await revisions.publish(
        s,
        actor,
        revision.id,
        z.uuid().nullable().parse(intent.expectedHead),
        z.string().parse(intent.hash),
      );
      if (revision.domain === "activation")
        return guidedSetupPanel(
          issue,
          (await new PresentationService(this.db).home(s)).setup,
          locale,
        );
      if (revision.domain === "intervention")
        return successPanel(
          issue,
          t(locale, "improvement.enabledTitle"),
          t(locale, "improvement.enabledDetail"),
          {
            label: t(locale, "improvement.checkResult"),
            action: "experimentDraft",
          },
          locale,
        );
      const names = {
        activation: t(locale, "common.activation"),
        intervention: t(locale, "common.interventions"),
        experiment: t(locale, "common.experiments"),
        onboarding: t(locale, "settings.onboarding"),
        privacy: t(locale, "common.privacy"),
        cohort: t(locale, "root.cohorts"),
      };
      return publishedPanel(
        issue,
        { name: names[revision.domain], version: revision.version },
        locale,
      );
    }
    const billingAuthority = new BillingAuthorization(
      authority,
      this.db,
      this.vault,
    );
    if (action === "billing" || action === "plan") {
      await billingAuthority.require(authorization, "VIEW");
      const status = await new BillingService(this.db, this.vault).view(s);
      let canManage = true;
      try {
        await billingAuthority.require(authorization, "UPGRADE");
      } catch {
        canManage = false;
      }
      const web = process.env.NEXUS_WEB_URL;
      let webUrl: string | null = null;
      try {
        if (web) {
          const url = new URL(web);
          if (
            url.protocol === "https:" ||
            (process.env.NODE_ENV === "development" && url.protocol === "http:")
          )
            webUrl = url.toString();
        }
      } catch {
        /* No unsafe purchase URL. */
      }
      return billingPanel(
        issue,
        {
          ...status.usage,
          source: status.source,
          grants: status.grants,
          features: status.presentation.availableFeatures,
          subscriptions: status.subscriptions,
          conflict: status.conflict,
          grace: status.grace,
          periodEnd: status.subscriptions[0]?.periodEnd ?? null,
          native: status.presentation.nativeCapability,
          nativeUrl: status.presentation.nativePurchaseUrl,
          webUrl,
          canManage,
        },
        locale,
      );
    }
    if (action === "billingPromotionRedeem") {
      try {
        await billingAuthority.require(authorization, "REDEEM");
        const code = z.string().max(128).parse(input.fields?.promotionCode),
          state = await new EntitlementService(this.db).effective(s);
        return promotionResultPanel(
          issue,
          await new PromotionService(this.db, this.vault).redeem(
            s,
            actorHash,
            code,
            state.subscriptions.find((row) => row.status === "ACTIVE")
              ?.provider ?? "MANUAL",
            new Date(),
            input.id,
          ),
          locale,
        );
      } catch {
        return promotionResultPanel(issue, null, locale);
      }
    }
    const paidAction: EntitlementFeature | null =
      ["controlApplyImprove", "controlTestAlert"].includes(action) ||
      (["controlHelperToggle", "helperEnabled"].includes(action) &&
        intent.value === true)
        ? "attention_automation"
        : ["controlTestSummary"].includes(action) ||
            (action === "controlWeeklyToggle" && intent.value === true)
          ? "scheduled_digest"
          : action === "diagnose"
            ? "comparable_periods"
            : action === "experiments" || action === "experimentMethod"
              ? "improvement_tracking"
              : null;
    if (paidAction) {
      const decision = await new EntitlementService(this.db).check(
        s,
        paidAction,
      );
      if (!decision.allowed) {
        try {
          await billingAuthority.require(authorization, "UPGRADE");
          return lockedFeaturePanel(issue, decision, paidAction, locale);
        } catch {
          return nexusPanel({
            title: "NEXUS",
            children: [
              callout(
                locale === "ja"
                  ? "利用条件の確認が必要です"
                  : "Feature access needs review",
                locale === "ja"
                  ? "サーバーの支払い権限を持つ管理者に確認してください。"
                  : "Ask an administrator with billing authority to review this feature.",
              ),
            ],
          });
        }
      }
    }
    if (action === "lifecycle") {
      const metrics = await new AnalyticsService(
          this.db,
          this.settings,
        ).canonical(s),
        state = await new EntitlementService(this.db).effective(s);
      return lifecyclePanel(issue, visibleMetrics(metrics, state), locale);
    }
    if (action === "improve") {
      const home = await new PresentationService(this.db).home(s);
      return improvePanel(issue, home.communityOpportunity, locale);
    }
    if (action === "diagnose") {
      const analytics = new AnalyticsService(this.db, this.settings),
        now = Date.now(),
        day = 86400000;
      const findings = diagnose(
        await analytics.canonical(s, new Date(now - 15 * day)),
        await analytics.canonical(
          s,
          new Date(now - 30 * day),
          new Date(now - 15 * day),
        ),
      );
      return diagnosticsPanel(issue, findings, locale);
    }
    if (action === "interventions") {
      const runs = (
        await sql<{
          id: string;
          state: string;
        }>`SELECT id,state FROM intervention_runs WHERE ${tenant(s)} ORDER BY created_at DESC LIMIT 10`.execute(
          this.db,
        )
      ).rows;
      return interventionsPanel(issue, runs, locale);
    }
    if (action === "interventionDraft") {
      assert(
        await new EntitlementService(this.db).can(s, "interventions"),
        "ENTITLEMENT_REQUIRED",
      );
      const channelId = z
        .string()
        .regex(/^\d{17,20}$/)
        .parse(input.values?.[0]);
      await this.discord.checkChannel(s.guildId, channelId);
      const revisions = domainRevisions(this.db),
        id = await revisions.draft(
          s,
          actor,
          "intervention",
          compileActionTemplate("reply_rescue", {
            channelId,
            safetyMode: "approval",
          }),
        ),
        p = await revisions.preview(s, id);
      return interventionPreviewPanel(
        issue,
        { id, hash: p.confirmationHash, expectedHead: p.before?.id ?? null },
        locale,
      );
    }
    if (action === "interventionApprove") {
      await new InterventionService(this.db).approve(
        s,
        actor,
        z.uuid().parse(input.values?.[0]),
      );
      return successPanel(
        issue,
        t(locale, "success.intervention"),
        t(locale, "success.interventionDetail"),
        { label: t(locale, "common.interventions"), action: "interventions" },
        locale,
      );
    }
    if (action === "experiments") {
      const revisions = domainRevisions(this.db),
        active = await revisions.current(s, "experiment");
      if (!active) return experimentsPanel(issue, null, locale);
      const definition = experimentSchema.parse(active.definition),
        result = await new ExperimentService(this.db).result(s, active.id);
      return experimentsPanel(
        issue,
        {
          name: definition.name,
          primaryMetric: definition.primaryMetric,
          minimumSample: definition.minimumSample,
          windowSeconds: definition.windowSeconds,
          result,
        },
        locale,
      );
    }
    if (action === "experimentMethod") {
      const active = await domainRevisions(this.db).current(s, "experiment");
      assert(active, "EXPERIMENT_NOT_FOUND");
      const definition = experimentSchema.parse(active.definition),
        result = await new ExperimentService(this.db).result(s, active.id);
      return experimentMethodPanel(
        issue,
        {
          name: definition.name,
          primaryMetric: definition.primaryMetric,
          minimumSample: definition.minimumSample,
          windowSeconds: definition.windowSeconds,
          result,
        },
        locale,
      );
    }
    if (action === "experimentDraft") {
      assert(
        await new EntitlementService(this.db).can(s, "experiments"),
        "ENTITLEMENT_REQUIRED",
      );
      const revisions = domainRevisions(this.db),
        intervention = await revisions.current(s, "intervention");
      assert(intervention, "PUBLISH_INTERVENTION_FIRST");
      const primaryMetric =
        interventionSchema.parse(intervention.definition).name ===
        "Reply Rescue"
          ? "connection"
          : "activation";
      const id = await revisions.draft(s, actor, "experiment", {
          name: "Improvement result check",
          eligibility: [],
          randomization: "time_block",
          blockSeconds: 86400,
          variants: [
            { key: "control", weight: 50, interventionRevisionId: null },
            {
              key: "treatment",
              weight: 50,
              interventionRevisionId: intervention.id,
            },
          ],
          primaryMetric,
          windowSeconds: 604800,
          minimumSample: 20,
          guardrails: {
            maxLeaveRate: 0.3,
            maxFailureRate: 0.1,
            maxAlerts: 100,
          },
        }),
        p = await revisions.preview(s, id);
      await revisions.publish(
        s,
        actor,
        id,
        p.before?.id ?? null,
        p.confirmationHash,
      );
      return successPanel(
        issue,
        t(locale, "improvement.resultStartedTitle"),
        t(locale, "improvement.resultStartedDetail"),
        { label: t(locale, "improvement.viewResults"), action: "experiments" },
        locale,
      );
    }
    if (action === "cohorts") return cohortsPanel(issue, locale);
    if (action === "reports") return reportsPanel(issue, locale);
    if (action === "advanced") return settingsPanel(issue, current, locale);
    if (
      action === "panel" ||
      action === "panelConfirm" ||
      action === "panelMoveConfirm" ||
      action === "controlMovePanel"
    ) {
      onStage("panel_channel_validation");
      assert(input.channelId, "CHANNEL_REQUIRED");
      const installed = (
        await sql<{
          channel_id: string;
        }>`SELECT channel_id FROM settings_panels WHERE ${tenant(s)}`.execute(
          this.db,
        )
      ).rows[0];
      const targetChannel =
        action === "panelConfirm" || action === "panelMoveConfirm"
          ? z
              .string()
              .regex(/^\d{17,20}$/)
              .parse(intent.channelId)
          : action === "controlMovePanel"
            ? z
                .string()
                .regex(/^\d{17,20}$/)
                .parse(input.values?.[0])
            : input.channelId;
      await this.discord.checkChannel(s.guildId, targetChannel);
      if (
        action === "controlMovePanel" &&
        installed?.channel_id === targetChannel
      )
        return this.communityPanel(issue, s, publicLocale, "settings", "panel");
      if (
        (action === "panel" &&
          installed &&
          installed.channel_id !== targetChannel) ||
        action === "controlMovePanel"
      )
        return nexusPanel({
          title: t(locale, "control.panel"),
          children: [
            divider(),
            callout(t(locale, "control.moveHere"), `<#${targetChannel}>`),
          ],
          rows: [
            await actionRow(issue, [
              {
                label: t(locale, "control.moveHere"),
                action: "panelMoveConfirm",
                data: { channelId: targetChannel },
                style: 1,
              },
              { label: t(locale, "control.cancel"), action: "panelChoose" },
            ]),
          ],
        });
      onStage("panel_visibility");
      if (
        (action === "panel" || action === "panelMoveConfirm") &&
        (await this.discord.publicChannel?.(s.guildId, targetChannel))
      )
        return panelPlacementWarning(issue, targetChannel, locale);
      if (!current.enabled)
        await this.settings.update(s, actor, current.revision, {
          enabled: true,
        });
      onStage("panel_render");
      const root = await controlPanel(issue,"overview",{sharedEntry:true},publicLocale);
      onStage("panel_upsert_enqueue");
      await enqueue(this.db, s, `panel:${input.id}`, "PANEL_UPSERT", {
        channelId: targetChannel,
        body: root,
      });
      return panelInstalledPanel(issue, locale);
    }
    if (action === "panelChoose")
      return successPanel(
        issue,
        t(locale, "control.chooseAnother"),
        t(locale, "control.chooseAnotherDetail"),
        undefined,
        locale,
      );
    if (action === "panelRefresh") {
      const saved = (
        await sql<{
          channel_id: string;
        }>`SELECT channel_id FROM settings_panels WHERE ${tenant(s)}`.execute(
          this.db,
        )
      ).rows[0];
      assert(saved, "PANEL_NOT_CONFIGURED");
      const root = await controlPanel(issue,"overview",{sharedEntry:true},publicLocale);
      await enqueue(this.db, s, `panel-refresh:${input.id}`, "PANEL_UPSERT", {
        channelId: saved.channel_id,
        body: root,
      });
      return successPanel(
        issue,
        t(locale, "success.panelRefreshed"),
        t(locale, "success.panelRefreshedDetail"),
        { label: t(locale, "common.settings"), action: "advanced" },
        locale,
      );
    }
    if (
      action === "controlNavigate" ||
      action === "controlRefresh" ||
      action === "controlAnalysis" ||
      action === "controlChannelPage" ||
      action === "controlSettings" ||
      action === "controlSummaryField" ||
      action === "controlGoalPurpose"
    ) {
      const saved = (
        await sql<{
          channel_id: string;
          message_id: string;
        }>`SELECT channel_id,message_id FROM settings_panels WHERE ${tenant(s)}`.execute(
          this.db,
        )
      ).rows[0];
      assert(input.privateResponse || saved, "PANEL_NOT_CONFIGURED");
      assert(
        privateSettings ||
          input.privateResponse || !input.messageId ||
          input.messageId === saved?.message_id,
        "COMPONENT_EXPIRED",
      );
      const page = z
        .enum(controlPages)
        .parse(
          action === "controlNavigate"
            ? (intent.page ?? input.values?.[0])
            : action === "controlSettings" ||
                action === "controlSummaryField" ||
                action === "controlGoalPurpose"
              ? "settings"
              : action === "controlChannelPage" || action === "controlAnalysis"
                ? "analysis"
                : intent.page,
        );
      const section =
        action === "controlSettings"
          ? z.enum(settingsSections).parse(intent.section ?? input.values?.[0])
          : action === "controlSummaryField"
            ? "summary"
            : action === "controlGoalPurpose"
              ? "goals"
              : intent.section
                ? z.enum(settingsSections).parse(intent.section)
                : "main";
      const channelPage =
        action === "controlChannelPage"
          ? z.number().int().min(0).parse(intent.index)
          : intent.channelPage
            ? z.number().int().min(0).parse(intent.channelPage)
            : 0;
      const summaryField =
        action === "controlSummaryField"
          ? z
              .enum(["channel", "day", "hour", "timezone"])
              .parse(input.values?.[0])
          : "none";
      const goalPurpose =
        action === "controlGoalPurpose"
          ? z
              .enum(["lfg", "feedback", "bug", "playtest"])
              .parse(input.values?.[0])
          : "none";
      const analysisView: AnalysisView =
        action === "controlAnalysis"
          ? z.enum(analysisViews).parse(intent.analysisView ?? input.values?.[0])
          : action === "controlChannelPage"
            ? "channels"
            : intent.analysisView
              ? z.enum(analysisViews).parse(intent.analysisView)
              : "overall";
      return this.communityPanel(
        issue,
        s,
        locale,
        analysisView==="newMembers"?"newMembers":page,
        section,
        channelPage,
        summaryField,
        goalPurpose,
        analysisView,
        0,
        z.number().int().nonnegative().max(1000).parse(intent.detailPage??0),
      );
    }
    if (action === "controlRules")
      return this.communityPanel(issue, s, locale, "community");
    if (action === "controlNotificationSave") {
      const minutes = z.coerce
        .number()
        .int()
        .min(1)
        .max(1440)
        .parse(input.fields?.minutes);
      await this.settings.update(s, actor, z.number().parse(intent.revision), {
        firstResponseMinutes: minutes,
      });
      if (setupFlow && !Object.values(current.setupSteps).every(Boolean))
        return this.continueSetup(
          issue,
          s,
          locale,
          actor,
          current,
          await this.settings.get(s),
          "notifications",
        );
      return this.communityPanel(issue, s, locale, "settings", "notifications");
    }
    if (action === "controlTryImprove") {
      if (!current.helperChannelId)
        return this.communityPanel(
          issue,
          s,
          publicLocale,
          "settings",
          "notifications",
        );
      return nexusPanel({
        title: t(locale, "control.improve"),
        children: [
          divider(),
          callout(
            t(locale, "control.replyAlert"),
            t(locale, "control.improvementPreview"),
          ),
        ],
        rows: [
          await actionRow(issue, [
            {
              label: t(locale, "control.applyImprovement"),
              action: "controlApplyImprove",
              data: {
                revision: current.revision,
                panelMessageId: input.messageId,
              },
              style: 1,
            },
            {
              label: t(locale, "control.cancel"),
              action: "controlCancelImprove",
            },
          ]),
        ],
      });
    }
    if (action === "controlCancelImprove")
      return this.communityPanel(issue, s, publicLocale, "analysis");
    if (action === "controlApplyImprove") {
      assert(input.customId, "CONFIRMATION_REQUIRED");
      if (intent.panelMessageId) {
        const active = (
          await sql<{
            message_id: string;
          }>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(
            this.db,
          )
        ).rows[0];
        assert(
          active?.message_id === intent.panelMessageId,
          "COMPONENT_EXPIRED",
        );
      }
      await this.settings.update(s, actor, z.number().parse(intent.revision), {
        helperEnabled: true,
        firstResponseMinutes: 20,
      });
      return this.communityPanel(
        issue,
        s,
        publicLocale,
        "settings",
        "notifications",
      );
    }
    if (action === "controlManagers" || action === "controlClearManagers") {
      const ids =
          action === "controlClearManagers"
            ? []
            : z
                .array(z.string().regex(/^\d{17,20}$/))
                .max(20)
                .parse(input.values ?? []),
        roles = await this.discord.roles(s.guildId);
      assert(
        ids.every((id) => {
          const role = roles.find((item) => item.id === id);
          return (
            role &&
            role.id !== s.guildId &&
            !role.managed &&
            (BigInt(role.permissions) & PermissionFlagsBits.Administrator) ===
              0n
          );
        }),
        "INVALID_ROLE",
      );
      return nexusPanel({
        title: t(locale, "control.managers"),
        children: [
          divider(),
          callout(
            ids.map((id) => `<@&${id}>`).join(" ") ||
              t(locale, "control.ownerAdmins"),
            t(locale, "control.roleConfirm"),
          ),
        ],
        rows: [
          await actionRow(issue, [
            {
              label: t(locale, "control.confirmRoles"),
              action: "controlManagersConfirm",
              data: {
                ids,
                revision: current.revision,
                panelMessageId: input.messageId,
              },
              style: 1,
            },
            {
              label: t(locale, "control.cancel"),
              action: "controlCancelManagers",
            },
          ]),
        ],
      });
    }
    if (action === "controlCancelManagers")
      return this.communityPanel(issue, s, publicLocale, "settings", "team");
    if (action === "controlManagersConfirm") {
      if (intent.panelMessageId && !setupFlow && !privateSettings) {
        const active = (
          await sql<{
            message_id: string;
          }>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(
            this.db,
          )
        ).rows[0];
        assert(
          active?.message_id === intent.panelMessageId,
          "COMPONENT_EXPIRED",
        );
      }
      assert(input.customId, "CONFIRMATION_REQUIRED");
      const ids = z
          .array(z.string().regex(/^\d{17,20}$/))
          .max(20)
          .parse(intent.ids),
        roles = await this.discord.roles(s.guildId);
      assert(
        ids.every((id) => {
          const role = roles.find((item) => item.id === id);
          return (
            role &&
            role.id !== s.guildId &&
            !role.managed &&
            (BigInt(role.permissions) & PermissionFlagsBits.Administrator) ===
              0n
          );
        }),
        "INVALID_ROLE",
      );
      if (!Object.values(current.setupSteps).every(Boolean))
        try {
          advanceSetup(current, "team");
        } catch {
          throw new DomainError("SETUP_STEP_OUT_OF_ORDER");
        }
      await this.settings.update(s, actor, z.number().parse(intent.revision), {
        managerRoleIds: ids,
        setupSteps: { ...current.setupSteps, team: true },
      });
      void recordProductEvent(this.db, s, "setup_team_completed").catch(
        () => {},
      );
      const updated = await this.settings.get(s);
      if (!Object.values(current.setupSteps).every(Boolean))
        return this.continueSetup(
          issue,
          s,
          publicLocale,
          actor,
          current,
          updated,
          "team",
        );
      return this.communityPanel(issue, s, publicLocale, "settings", "team");
    }
    if (action === "controlSnoozeMenu") {
      const channelId = z
          .string()
          .regex(/^\d{17,20}$/)
          .parse(intent.channelId),
        messageId = z
          .string()
          .regex(/^\d{17,20}$/)
          .parse(intent.messageId);
      return nexusPanel({
        title: t(locale, "control.snooze"),
        children: [
          divider(),
          callout(
            t(locale, "control.queueTitle", { channel: channelId }),
            t(locale, "control.queueUnconfirmed"),
          ),
        ],
        rows: [
          await actionRow(issue, [
            {
              label: t(locale, "control.snooze30"),
              action: "controlSnooze",
              data: {
                channelId,
                messageId,
                minutes: 30,
                panelMessageId: input.messageId,
              },
            },
            {
              label: t(locale, "control.snooze60"),
              action: "controlSnooze",
              data: {
                channelId,
                messageId,
                minutes: 60,
                panelMessageId: input.messageId,
              },
            },
            {
              label: t(locale, "control.snoozeToday"),
              action: "controlSnooze",
              data: {
                channelId,
                messageId,
                until: "today",
                panelMessageId: input.messageId,
              },
            },
          ]),
        ],
      });
    }
    if (
      action === "controlResolve" ||
      action === "controlAcknowledge" ||
      action === "controlSnooze"
    ) {
      if (intent.panelMessageId) {
        const active = (
          await sql<{
            message_id: string;
          }>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(
            this.db,
          )
        ).rows[0];
        assert(
          active?.message_id === intent.panelMessageId,
          "COMPONENT_EXPIRED",
        );
      }
      const channelId = z
          .string()
          .regex(/^\d{17,20}$/)
          .parse(intent.channelId),
        messageId = z
          .string()
          .regex(/^\d{17,20}$/)
          .parse(intent.messageId);
      const source = (
        await sql<{
          occurred_at: Date;
        }>`SELECT occurred_at FROM lifecycle_events WHERE ${tenant(s)} AND context='PRODUCTION' AND kind='message.sent' AND data->>'messageId'=${messageId} AND data->>'channelId'=${channelId} LIMIT 1`.execute(
          this.db,
        )
      ).rows[0];
      assert(source, "ATTENTION_NOT_FOUND");
      const prior = (
        await sql<{
          status: string;
          snooze_until: Date | null;
        }>`SELECT status,snooze_until FROM attention_items WHERE ${tenant(s)} AND message_id=${messageId}`.execute(
          this.db,
        )
      ).rows[0];
      assert(
        prior?.status !== "RESOLVED" &&
          !(
            prior?.status === "SNOOZED" &&
            (!prior.snooze_until || prior.snooze_until > new Date())
          ),
        "ATTENTION_NOT_ACTIVE",
      );
      const status =
        action === "controlResolve"
          ? "RESOLVED"
          : action === "controlAcknowledge"
            ? "ACKNOWLEDGED"
            : "SNOOZED";
      let snoozeUntil: Date | null = null;
      if (status === "SNOOZED") {
        snoozeUntil =
          intent.until === "today"
            ? nextZonedDayStart(new Date(), current.timezone)
            : new Date(
                Date.now() +
                  z.number().int().min(1).max(1440).parse(intent.minutes) *
                    60000,
              );
      }
      const operations = new AttentionOperations(this.db);
      await operations.observe(s, current);
      await operations.action(
        s,
        messageId,
        channelId,
        status,
        new Date(),
        snoozeUntil,
      );
      return this.communityPanel(issue, s, publicLocale, "attention");
    }
    if (action === "controlOpenDiagnostics")
      return this.communityPanel(issue, s, publicLocale, "diagnostics");
    if (action === "controlOpenAttention")
      return this.communityPanel(issue, s, publicLocale, "attention");
    if (action === "controlAttentionPage")
      return this.communityPanel(
        issue,
        s,
        publicLocale,
        "attention",
        "scope",
        0,
        "none",
        "none",
        "overall",
        z.number().int().min(0).max(1000).parse(intent.index),
      );
    if (action.startsWith("control")) {
      if (!setupFlow && !privateSettings && !input.privateResponse) {
        const saved = (
          await sql<{
            message_id: string;
          }>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(
            this.db,
          )
        ).rows[0];
        assert(
          saved && input.messageId === saved.message_id,
          "COMPONENT_EXPIRED",
        );
      }
      const revision =
          intent.revision === undefined
            ? current.revision
            : z.number().parse(intent.revision),
        value = input.values?.[0];
      const wizardStep = (
        [
          "controlScopeDefault",
          "controlScope",
          "controlScopeChannels",
        ].includes(action)
          ? "scope"
          : [
                "controlSkipTeam",
                "controlHelpers",
                "controlClearHelpers",
              ].includes(action)
            ? "team"
            : [
                  "controlSkipNotifications",
                  "controlHelperChannel",
                  "controlHelperToggle",
                  "controlAlertDelay",
                ].includes(action)
              ? "notifications"
              : [
                    "controlSkipGoals",
                    "controlGoal",
                    "controlGoalPreset",
                    "controlGoalChannel",
                  ].includes(action)
                ? "goals"
                : null
      ) as "scope" | "team" | "notifications" | "goals" | null;
      const wizardActive = !Object.values(current.setupSteps).every(Boolean);
      if (wizardActive && wizardStep)
        try {
          advanceSetup(current, wizardStep);
        } catch {
          throw new DomainError("SETUP_STEP_OUT_OF_ORDER");
        }
      if (action === "controlScopeDefault")
        await this.settings.update(s, actor, revision, {
          analysisScope: { mode: "all", channelIds: [] },
          setupSteps: { ...current.setupSteps, scope: true },
        });
      else if (action === "controlSkipTeam")
        await this.settings.update(s, actor, revision, {
          managerRoleIds: [],
          helperRoleIds: [],
          setupSteps: { ...current.setupSteps, team: true },
        });
      else if (action === "controlSkipNotifications")
        await this.settings.update(s, actor, revision, {
          helperEnabled: false,
          helperChannelId: null,
          weeklySummaryEnabled: false,
          weeklySummaryChannelId: null,
          setupSteps: { ...current.setupSteps, notifications: true },
        });
      else if (action === "controlSkipGoals")
        await this.settings.update(s, actor, revision, {
          goalPreset: null,
          newMemberGoals: [],
          importantChannels: [],
          setupSteps: { ...current.setupSteps, goals: true },
        });
      else if (action === "controlKeepSettings") {
        await this.settings.update(s, actor, revision, {
          setupVersion: 2,
          setupSteps: {
            scope: true,
            team: true,
            notifications: true,
            goals: true,
          },
        });
        if (current.setupVersion < 2)
          void recordProductEvent(this.db, s, "setup_completed").catch(
            () => {},
          );
        return successPanel(
          issue,
          locale === "ja" ? "セットアップ完了" : "Setup complete",
          locale === "ja" ? "ホームへ戻れます。" : "Return to Home.",
          { label: locale === "ja" ? "ホーム" : "Home", action: "setupHome" },
          locale,
        );
      } else if (action === "controlClearHelpers")
        await this.settings.update(s, actor, revision, { helperRoleIds: [] });
      else if (action === "controlScope")
        await this.settings.update(s, actor, revision, {
          analysisScope: {
            ...current.analysisScope,
            mode: z.enum(["all", "include", "exclude"]).parse(value),
          },
          setupSteps: { ...current.setupSteps, scope: true },
        });
      else if (action === "controlScopeChannels")
        await this.settings.update(s, actor, revision, {
          analysisScope: {
            ...current.analysisScope,
            channelIds: z
              .array(z.string().regex(/^\d{17,20}$/))
              .min(1)
              .max(25)
              .parse(input.values),
          },
          setupSteps: { ...current.setupSteps, scope: true },
        });
      else if (action === "controlHelpers") {
        const ids = z
            .array(z.string().regex(/^\d{17,20}$/))
            .max(20)
            .parse(input.values ?? []),
          roles = await this.discord.roles(s.guildId);
        assert(
          ids.every((id) => {
            const role = roles.find((item) => item.id === id);
            return (
              role &&
              role.id !== s.guildId &&
              !role.managed &&
              (BigInt(role.permissions) & PermissionFlagsBits.Administrator) ===
                0n
            );
          }),
          "INVALID_ROLE",
        );
        await this.settings.update(s, actor, revision, { helperRoleIds: ids });
      } else if (action === "controlHelperChannel") {
        const channel = z
          .string()
          .regex(/^\d{17,20}$/)
          .parse(value);
        await this.discord.checkChannel(s.guildId, channel);
        await this.settings.update(s, actor, revision, {
          helperChannelId: channel,
          setupSteps: { ...current.setupSteps, notifications: true },
        });
      } else if (action === "controlAlertDelay")
        await this.settings.update(s, actor, revision, {
          firstResponseMinutes: z.coerce
            .number()
            .int()
            .min(1)
            .max(1440)
            .parse(value),
        });
      else if (action === "controlHelperToggle") {
        const enabled = z.boolean().parse(intent.value);
        assert(!enabled || current.helperChannelId, "HELPER_CHANNEL_REQUIRED");
        await this.settings.update(s, actor, revision, {
          helperEnabled: enabled,
        });
      } else if (action === "controlGoal")
        await this.settings.update(s, actor, revision, {
          newMemberGoals: z
            .array(
              z.enum([
                "reply",
                "lfg",
                "voice",
                "event",
                "feedback",
                "bug",
                "playtest",
              ]),
            )
            .max(7)
            .parse(input.values ?? []),
          setupSteps: { ...current.setupSteps, goals: true },
        });
      else if (action === "controlGoalPreset")
        await this.settings.update(s, actor, revision, {
          goalPreset: z
            .enum(["multiplayer", "early_access", "live_service"])
            .parse(value),
        });
      else if (action === "controlGoalChannel") {
        const channel = z
            .string()
            .regex(/^\d{17,20}$/)
            .parse(value),
          purpose = z
            .enum(["lfg", "feedback", "bug", "playtest"])
            .parse(intent.purpose);
        await this.discord.checkChannel(s.guildId, channel);
        const channels = [
          ...current.importantChannels.filter(
            (item) => item.purpose !== purpose,
          ),
          { channelId: channel, purpose },
        ];
        await this.settings.update(s, actor, revision, {
          importantChannels: channels,
        });
      } else if (action === "controlWeeklyChannel") {
        const channel = z
          .string()
          .regex(/^\d{17,20}$/)
          .parse(value);
        await this.discord.checkChannel(s.guildId, channel);
        await this.settings.update(s, actor, revision, {
          weeklySummaryChannelId: channel,
        });
      } else if (action === "controlWeeklyDay")
        await this.settings.update(s, actor, revision, {
          weeklySummaryDay: z.coerce.number().int().min(0).max(6).parse(value),
        });
      else if (action === "controlWeeklyHour")
        await this.settings.update(s, actor, revision, {
          weeklySummaryHour: z.coerce
            .number()
            .int()
            .min(0)
            .max(23)
            .parse(value),
        });
      else if (action === "controlTimezone")
        await this.settings.update(s, actor, revision, {
          timezone: z
            .enum([
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
            ])
            .parse(value),
        });
      else if (action === "controlWeeklyToggle") {
        const enabled = z.boolean().parse(intent.value);
        assert(!enabled || current.weeklySummaryChannelId, "CHANNEL_REQUIRED");
        await this.settings.update(s, actor, revision, {
          weeklySummaryEnabled: enabled,
        });
      } else if (
        action === "controlTestAlert" ||
        action === "controlTestSummary"
      ) {
        const channel =
          action === "controlTestAlert"
            ? current.helperChannelId
            : current.weeklySummaryChannelId;
        assert(channel, "CHANNEL_REQUIRED");
        if(action==="controlTestAlert"&&intent.channelId)assert(intent.channelId===channel&&intent.revision===current.revision,"REVISION_CONFLICT",409);
        await this.discord.checkChannel(s.guildId, channel);
        await enqueue(this.db, s, `test:${input.id}`, "TEST_MESSAGE", {
          channelId: channel,
          body: {
            content: t(
              publicLocale,
              action === "controlTestAlert"
                ? "control.testAlertMessage"
                : "control.testSummaryMessage",
            ),
            allowed_mentions: { parse: [] },
          },
        });
        if (action === "controlTestAlert")
          void recordProductEvent(this.db, s, "test_notification_sent").catch(
            () => {},
          );
      } else throw new DomainError("UNKNOWN_ACTION");
      const setupEvent =
        action === "controlScope" ||
        action === "controlScopeDefault" ||
        action === "controlScopeChannels"
          ? "setup_scope_completed"
          : action === "controlSkipTeam"
            ? "setup_team_completed"
            : action === "controlSkipNotifications" ||
                action === "controlHelperChannel"
              ? "setup_notification_completed"
              : action === "controlSkipGoals" || action === "controlGoal"
                ? "setup_goal_completed"
                : null;
      if (setupEvent)
        void recordProductEvent(this.db, s, setupEvent).catch(() => {});
      if (action !== "controlTestAlert" && action !== "controlTestSummary")
        void recordProductEvent(this.db, s, "setting_saved").catch(() => {});
      const updated = await this.settings.get(s);
      if (wizardActive && wizardStep)
        return this.continueSetup(
          issue,
          s,
          publicLocale,
          actor,
          current,
          updated,
          wizardStep,
        );
      const section: SettingsSection =
        action === "controlScope" ||
        action === "controlScopeDefault" ||
        action === "controlScopeChannels"
          ? "scope"
          : action === "controlHelpers" ||
              action === "controlClearHelpers" ||
              action === "controlSkipTeam"
            ? "team"
            : action.startsWith("controlGoal") || action === "controlSkipGoals"
              ? "goals"
              : action.startsWith("controlWeekly") ||
                  action === "controlTimezone" ||
                  action === "controlTestSummary"
                ? "summary"
                : "notifications";
      return this.communityPanel(issue, s, publicLocale, "settings", section);
    }
    if (action === "settings")
      return basicSettingsPanel(issue, current, locale);
    if (action === "template")
      await this.onboarding.chooseTemplate(
        s,
        actor,
        z.number().parse(intent.revision),
        z.enum(templates).parse(input.values?.[0]),
      );
    else if (action === "startChannel") {
      const channel = z
        .string()
        .regex(/^\d{17,20}$/)
        .parse(input.values?.[0]);
      await this.discord.checkChannel(s.guildId, channel);
      await this.settings.update(s, actor, z.number().parse(intent.revision), {
        startChannelId: channel,
      });
    } else if (action === "uiLanguage")
      await this.settings.update(s, actor, z.number().parse(intent.revision), {
        uiLanguage: z
          .enum(["auto", "ja", "en", "bilingual"])
          .parse(input.values?.[0]),
      });
    else if (action === "adminNotificationChannel") {
      const channel = z
        .string()
        .regex(/^\d{17,20}$/)
        .parse(input.values?.[0]);
      await this.discord.checkChannel(s.guildId, channel);
      await this.settings.update(s, actor, z.number().parse(intent.revision), {
        adminNotificationChannelId: channel,
      });
    } else if (action === "helperChannel") {
      const channel = z
        .string()
        .regex(/^\d{17,20}$/)
        .parse(input.values?.[0]);
      await this.discord.checkChannel(s.guildId, channel);
      await this.settings.update(s, actor, z.number().parse(intent.revision), {
        helperChannelId: channel,
      });
    } else if (action === "helperEnabled") {
      const value = z.boolean().parse(intent.value);
      assert(!value || current.helperChannelId, "HELPER_CHANNEL_REQUIRED");
      await this.settings.update(s, actor, z.number().parse(intent.revision), {
        helperEnabled: value,
      });
    } else if (action === "enabled" || action === "onboardingEnabled")
      await this.settings.update(s, actor, z.number().parse(intent.revision), {
        [action]: z.boolean().parse(intent.value),
      });
    else if (action === "flows") {
      if (!current.flowVersionId)
        return onboardingNotConfiguredPanel(issue, locale);
      const flow = await this.onboarding.flow(s, current.flowVersionId);
      const versions = (
        await sql<{
          id: string;
          version: number;
        }>`SELECT id,version FROM flow_versions WHERE ${tenant(s)} ORDER BY version DESC LIMIT 25`.execute(
          this.db,
        )
      ).rows;
      return onboardingFlowPanel(
        issue,
        { revision: current.revision, nodes: flow.nodes, versions },
        locale,
        z.number().int().nonnegative().max(1000).parse(intent.optionPage??0),
      );
    } else if (action === "editNode") {
      assert(current.flowVersionId, "FLOW_NOT_CONFIGURED");
      assert(intent.revision === current.revision, "REVISION_CONFLICT", 409);
      const flow = await this.onboarding.flow(s, current.flowVersionId);
      const node = flow.nodes.find((n) => n.id === input.values?.[0]);
      assert(node, "INVALID_NODE");
      return editQuestionPanel(
        issue,
        {
          revision: current.revision,
          nodeId: node.id,
          question: node.question,
          options: node.options
            .map((o) => `${o.id} | ${o.label} | ${o.next ?? "end"}`)
            .join("\n"),
        },
        locale,
      );
    } else if (action === "editNodeSave") {
      assert(current.flowVersionId, "FLOW_NOT_CONFIGURED");
      const flow = await this.onboarding.flow(s, current.flowVersionId);
      const node = flow.nodes.find((n) => n.id === intent.nodeId);
      assert(node, "INVALID_NODE");
      node.question = z.string().min(1).max(500).parse(input.fields?.question);
      node.options = z
        .string()
        .parse(input.fields?.options)
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parts = line.split("|").map((v) => v.trim());
          assert(parts.length === 3, "INVALID_OPTION_FORMAT");
          const [id, label, next] = parts;
          return {
            ...node.options.find((o) => o.id === id),
            id: id!,
            label: label!,
            next: next === "end" ? null : next!,
          };
        });
      await this.onboarding.publish(
        s,
        actor,
        z.number().parse(intent.revision),
        flow,
      );
    } else if (action === "mapOption") {
      const option = z.string().parse(input.values?.[0]);
      assert(intent.revision === current.revision, "REVISION_CONFLICT", 409);
      return roleMappingPanel(
        issue,
        { revision: current.revision, option },
        locale,
      );
    } else if (action === "mapRole") {
      assert(current.flowVersionId, "FLOW_NOT_CONFIGURED");
      const flow = await this.onboarding.flow(s, current.flowVersionId);
      const [nodeId, optionId] = String(intent.option).split(":");
      const option = flow.nodes
        .find((n) => n.id === nodeId)
        ?.options.find((o) => o.id === optionId);
      assert(option, "INVALID_OPTION");
      const roleId = input.values?.[0];
      if (roleId) {
        await this.discord.validateRole(s.guildId, roleId);
        option.roleId = roleId;
      } else delete option.roleId;
      await this.onboarding.publish(
        s,
        actor,
        z.number().parse(intent.revision),
        flow,
      );
    } else if (action === "rollback")
      await this.onboarding.rollback(
        s,
        actor,
        z.number().parse(intent.revision),
        z.uuid().parse(input.values?.[0]),
      );
    else if (
      action === "personalize" ||
      action === "restart" ||
      action === "preview"
    ) {
      const session = await this.onboarding.start(
        s,
        input.userId,
        new Date(member.joinedAt),
        action === "preview" ? "PREVIEW" : "PRODUCTION",
        action === "restart" || action === "preview",
      );
      return this.sessionPanel(issue, session, locale);
    } else if (action === "answer") {
      const session = await this.onboarding.answer(
        s,
        input.userId,
        z.uuid().parse(intent.sessionId),
        z.number().parse(intent.revision),
        z.string().parse(intent.nodeId),
        z.array(z.string()).min(1).parse(input.values),
      );
      return this.sessionPanel(issue, session, locale);
    } else if (action === "privacy") return privacyPanel(issue, admin, locale);
    else if (
      action === "deleteMemberConfirm" ||
      action === "deleteGuildConfirm"
    )
      return confirmation(
        issue,
        action === "deleteGuildConfirm" ? "deleteGuild" : "deleteMember",
        locale,
      );
    else if (action === "deleteMember" || action === "deleteGuild") {
      assert(input.customId, "CONFIRMATION_REQUIRED");
      await this.deletion(s, input.userId, actor, action === "deleteGuild");
      return successPanel(
        issue,
        t(locale, "success.deletion"),
        t(locale, "success.deletionDetail"),
        { label: t(locale, "common.privacy"), action: "privacy" },
        locale,
      );
    } else if (action === "overview" || action === "dashboard") {
      const analytics = new AnalyticsService(this.db, this.settings),
        metrics = await analytics.canonical(s),
        now = Date.now(),
        day = 86400000;
      const findings = diagnose(
        await analytics.canonical(s, new Date(now - 15 * day)),
        await analytics.canonical(
          s,
          new Date(now - 30 * day),
          new Date(now - 15 * day),
        ),
      );
      const diagnosis = findings
        .filter((f) => f.type !== "DATA_COVERAGE_DROP")
        .sort(
          (a, b) =>
            (a.severity === "critical" ? 0 : 1) -
            (b.severity === "critical" ? 0 : 1),
        )[0];
      const summary = await analytics.overview(s);
      return overviewPanel(issue, metrics, locale, {
        diagnosis,
        unansweredAfter24h: summary.unansweredAfter24h?.value ?? null,
      });
    } else if (action === "status") {
      const runtime = this.runtime?.(),
        registered = (
          await sql<{
            definition_hash: string;
          }>`SELECT definition_hash FROM guild_command_sync WHERE ${tenant(s)}`.execute(
            this.db,
          )
        ).rows[0],
        panel = (
          await sql<{
            channel_id: string;
          }>`SELECT channel_id FROM settings_panels WHERE ${tenant(s)}`.execute(
            this.db,
          )
        ).rows[0],
        web = Boolean(process.env.NEXUS_WEB_URL);
      const checks: ReadinessCheck[] = [
        {
          label: "Discord Gateway",
          status: runtime?.gatewayConnected ? "Ready" : "Needs attention",
        },
        {
          label: locale === "ja" ? "コマンド登録" : "Commands",
          status:
            registered &&
            runtime &&
            registered.definition_hash === runtime.commandHash
              ? "Ready"
              : "Needs attention",
        },
        {
          label: locale === "ja" ? "操作受付" : "Interaction handler",
          status: runtime?.interaction.handlerRegistered
            ? "Ready"
            : "Needs attention",
        },
        {
          label: locale === "ja" ? "サーバー設定" : "Server enabled",
          status: current.enabled ? "Ready" : "Needs attention",
        },
        {
          label: locale === "ja" ? "パネル" : "Panel",
          status: panel ? "Ready" : "Not configured",
        },
        {
          label: locale === "ja" ? "初期設定" : "Setup",
          status:
            current.setupVersion >= 2 &&
            Object.values(current.setupSteps).every(Boolean)
              ? "Ready"
              : "Not configured",
        },
        {
          label: locale === "ja" ? "分析範囲" : "Analysis",
          status: "Ready",
          detail: `${current.analysisScope.mode} · ${current.timezone}`,
        },
        {
          label: locale === "ja" ? "Web ダッシュボード" : "Web Dashboard",
          status: web ? "Ready" : "Not configured",
        },
      ];
      return activationReadinessPanel(issue, checks, locale, releaseInfo());
    } else throw new DomainError("UNKNOWN_ACTION");
    const updated = await this.settings.get(s),
      updatedLocale = resolveLocale(updated.uiLanguage, {
        interactionLocale: input.locale,
        guildLocale: input.guildLocale,
      });
    return [
      "uiLanguage",
      "adminNotificationChannel",
      "helperChannel",
      "helperEnabled",
    ].includes(action)
      ? basicSettingsPanel(issue, updated, updatedLocale)
      : settingsPanel(issue, updated, updatedLocale);
  }
  private async continueSetup(
    issue: Issue,
    s: Scope,
    locale: UiLocale,
    actor: Actor,
    before: SettingsView,
    updated: SettingsView,
    step: "scope" | "team" | "notifications" | "goals",
  ) {
    const progress = advanceSetup(updated, step);
    if (
      progress.setupVersion !== updated.setupVersion ||
      !updated.setupSteps[step]
    )
      await this.settings.update(s, actor, updated.revision, {
        setupSteps: progress.setupSteps,
        setupVersion: progress.setupVersion,
      });
    if (!progress.next) {
      if (
        before.setupVersion < 2 ||
        !Object.values(before.setupSteps).every(Boolean)
      )
        void recordProductEvent(this.db, s, "setup_completed").catch(() => {});
      return successPanel(
        issue,
        locale === "ja" ? "セットアップ完了" : "Setup complete",
        locale === "ja" ? "ホームへ戻れます。" : "Return to Home.",
        { label: locale === "ja" ? "ホーム" : "Home", action: "setupHome" },
        locale,
      );
    }
    return this.communityPanel(issue, s, locale, "settings", progress.next);
  }
  async refreshHome(s: Scope) {
    const cfg = await this.settings.get(s),
      issue: Issue = (data) =>
        this.tokens.issue(this.db, s, data, null, 31536000);
    return this.communityPanel(issue, s, resolveLocale(cfg.uiLanguage));
  }
  private async communityPanel(
    issue: Issue,
    s: Scope,
    locale: UiLocale,
    page: ControlPage = "overview",
    section: SettingsSection = "main",
    channelPage = 0,
    summaryField: "none" | "channel" | "day" | "hour" | "timezone" = "none",
    goalPurpose: "none" | "lfg" | "feedback" | "bug" | "playtest" = "none",
    analysisView: AnalysisView = "overall",
    attentionIndex = 0,
    detailPage = 0,
  ) {
    const web = await this.webLink(s);
    const data: Parameters<typeof controlPanel>[2] = {
      dashboardUrl: web.url,
      webVerified: web.verified,
      updatedAt: new Date(),
    };
    if(page==="analysis"){
      const cfg=await this.settings.get(s),window=completedWindow(30),selected=await analysisChannelScope(this.db,s,cfg);
      data.basicAnalysis={result:await this.db.transaction().execute(async tx=>{
        await privacyReadLock(tx,s);
        return analysisMetrics(tx,s,cfg,"OVERALL",window.start,window.end,fingerprint([selected.actualChannelIds]),30);
      }),from:window.start,to:window.end,channelCount:selected.actualChannelIds.length};
    }
    if (
      [
        "overview",
        "newMembers",
        "attention",
        "analysis",
        "community",
        "channels",
        "improve",
      ].includes(page)
    ) {
      const community = new CommunityService(this.db, this.settings);
      data.community = await community.overview(
        s,
        30,
        new Date(),
        [],
        page === "attention" ? attentionIndex : 0,
      );
      if (
        page === "attention" &&
        attentionIndex > 0 &&
        data.community.attention.length === 0
      ) {
        attentionIndex = 0;
        data.community = await community.overview(s, 30);
      }
    }
    if (page === "settings" || page === "overview" || page === "attention") {
      const current = await this.settings.get(s),
        installed = (
          await sql<{
            channel_id: string;
          }>`SELECT channel_id FROM settings_panels WHERE ${tenant(s)}`.execute(
            this.db,
          )
        ).rows[0];
      data.settings = {
        analysisScope: current.analysisScope,
        managerRoleIds: current.managerRoleIds,
        helperRoleIds: current.helperRoleIds,
        weeklySummaryEnabled: current.weeklySummaryEnabled,
        weeklySummaryChannelId: current.weeklySummaryChannelId,
        weeklySummaryDay: current.weeklySummaryDay,
        weeklySummaryHour: current.weeklySummaryHour,
        timezone: current.timezone,
        helperEnabled: current.helperEnabled,
        helperChannelId: current.helperChannelId,
        firstResponseMinutes: current.firstResponseMinutes,
        goalPreset: current.goalPreset,
        newMemberGoals: current.newMemberGoals,
        importantChannels: current.importantChannels,
        uiLanguage: current.uiLanguage,
        detailedRetentionDays: current.detailedRetentionDays,
        revision: current.revision,
        setupVersion: current.setupVersion,
        panelChannelId: installed?.channel_id ?? null,
        setupSteps: current.setupSteps,
      };
    }
    if (page === 'overview') {
      data.analysis=await this.db.transaction().execute(async tx=>{
        await privacyReadLock(tx,s);
        const usage=await analysisUsage(tx,s),latest=(await sql<{completed_at:Date}>`SELECT completed_at FROM analysis_runs WHERE ${tenant(s)} AND status='COMPLETED' AND retention_until>now() ORDER BY completed_at DESC LIMIT 1`.execute(tx)).rows[0]?.completed_at??null;
        const count=(await sql<{n:number}>`SELECT count(*)::int AS n FROM attention_items WHERE ${tenant(s)} AND item_type='ANALYSIS_CONCERN' AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`.execute(tx)).rows[0]!.n;
        return {remaining:usage.remaining,latest,attentionCount:count};
      });
    }
    if (page === "settings") {
      const current = await this.settings.get(s);
      data.model = {
        profile: current.communityModel,
        revision: current.revision,
        capabilities: await latestCapability(this.db, s),
      };
    }
    if (page === "results") {
      const active = await domainRevisions(this.db).current(s, "experiment");
      if (active) {
        const result = await new ExperimentService(this.db).result(
          s,
          active.id,
        );
        data.results = {
          controlRate: result.controlRate,
          treatmentRate: result.treatmentRate,
          controlN: result.controlN,
          treatmentN: result.treatmentN,
          state: result.state,
        };
      }
    }
    if (page === "diagnostics") {
      const command = (
          await sql<{
            definition_hash: string;
          }>`SELECT definition_hash FROM guild_command_sync WHERE ${tenant(s)}`.execute(
            this.db,
          )
        ).rows[0],
        last = (
          await sql<{
            received_at: Date;
            acknowledged_at: Date;
            completed_at: Date | null;
            result: string;
          }>`SELECT received_at,acknowledged_at,completed_at,result FROM interaction_diagnostics WHERE ${tenant(s)} ORDER BY received_at DESC LIMIT 1`.execute(
            this.db,
          )
        ).rows[0],
        activity = (
          await sql<{
            last_seen: Date;
          }>`SELECT last_seen FROM telemetry_cursor WHERE ${tenant(s)}`.execute(
            this.db,
          )
        ).rows[0],
        runtime = this.runtime?.();
      data.diagnostics = {
        ...releaseInfo(),
        gatewayConnected: runtime?.gatewayConnected ?? false,
        transport: runtime?.interaction.transport ?? "gateway",
        commandsRegistered: Boolean(
          command && runtime && command.definition_hash === runtime.commandHash,
        ),
        lastReceivedAt:
          runtime?.interaction.lastReceivedAt ??
          last?.received_at.toISOString() ??
          null,
        lastAcknowledgedAt:
          runtime?.interaction.lastAcknowledgedAt ??
          last?.acknowledged_at.toISOString() ??
          null,
        lastCompletedAt:
          runtime?.interaction.lastCompletedAt ??
          last?.completed_at?.toISOString() ??
          null,
        lastResult: runtime?.interaction.lastResult ?? last?.result ?? null,
        lastActivityAt: activity?.last_seen.toISOString() ?? null,
        databaseConnected: true,
        redisConnected: runtime?.redisConnected ?? false,
      };
    }
    return controlPanel(
      issue,
      page,
      data,
      locale,
      section,
      channelPage,
      summaryField,
      goalPurpose,
      analysisView,
      attentionIndex,
      detailPage,
    );
  }
  private async sessionPanel(
    issue: Issue,
    session: Session,
    locale: ReturnType<typeof resolveLocale>,
  ) {
    if (session.state.complete) return sessionCompletePanel(issue, locale);
    const node = session.definition.nodes.find(
      (n) => n.id === session.state.nodeId,
    )!;
    return questionPanel(
      issue,
      {
        sessionId: session.id,
        revision: session.revision,
        nodeId: node.id,
        question: node.question,
        options: node.options,
        context: session.context,
        type: node.type,
      },
      locale,
    );
  }
}
