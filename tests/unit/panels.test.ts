import { ComponentType } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import {
  coverageLabel,
  controlPanel,
  controlPages,
  settingsSections,
  panelPlacementWarning,
  diagnosticsPanel,
  errorPanel,
  experimentsPanel,
  experimentMethodPanel,
  formatDuration,
  formatPercentage,
  guidedSetupPanel,
  improvePanel,
  lifecyclePanel,
  overviewPanel,
  resolveLocale,
  rootPanel,
  settingsPanel,
  type MetricLike,
  type Panel,
  type ControlData,
} from "../../packages/discord-panels/src/index.js";
import { en, ja } from "../../packages/discord-panels/src/i18n/index.js";
import { buildNexusCommand } from "../../scripts/commands.js";

let counter = 0;
const issue = async () => `opaque-${counter++}`;
const metric = (
  metricKey: string,
  value: number | null,
  sampleSize = 12,
  status: MetricLike["dataCoverage"]["status"] = "healthy",
): MetricLike => ({
  metricKey,
  value,
  sampleSize,
  provisional: false,
  dataCoverage: {
    status,
    expected: 100,
    observed: status === "healthy" ? 100 : 63,
  },
});
const metrics = () => ({
  new_members: metric("new_members", 12),
  activation_rate: metric("activation_rate", 0.583),
  direct_reply_connection_rate: metric("direct_reply_connection_rate", 0.67),
  d7_active_retention: metric("d7_active_retention", 0.31),
  onboarding_completion: metric("onboarding_completion", 0.74),
  ttfv_median: metric("ttfv_median", 1080),
  median_first_reply_latency: metric("median_first_reply_latency", 523),
  d1_active_retention: metric("d1_active_retention", 0.54),
  d30_active_retention: metric("d30_active_retention", null, 0),
});
const experiment = (evidenceStatus: string) => ({
  name: "Helper alert vs holdout",
  primaryMetric: "activation",
  minimumSample: 20,
  windowSeconds: 604800,
  result: {
    controlN: 24,
    treatmentN: 25,
    controlRate: 0.4,
    treatmentRate: 0.56,
    absoluteLift: 0.16,
    evidenceStatus,
    credibleInterval: evidenceStatus === "SUPPORTED" ? [0.02, 0.3] : null,
    probabilityTreatmentBetter: evidenceStatus === "SUPPORTED" ? 0.98 : null,
    dataCoverage: "healthy",
    coverageRatio: 1,
    assigned: 49,
    mature: 49,
    provisional: false,
    guardrails: { leaveRate: 0.04, deliveryFailureRate: 0.02, alertVolume: 25 },
    randomization: "time_block",
    state: "running",
  },
});
const json = (panel: Panel) => JSON.stringify(panel);

describe("NEXUS Discord design system", () => {
  it("formats percentages for people", () => {
    expect(formatPercentage(0.583)).toBe("58%");
    expect(formatPercentage(0.583, 1)).toBe("58.3%");
  });
  it("formats durations compactly", () => {
    expect(formatDuration(523)).toBe("8m 43s");
    expect(formatDuration(3660)).toBe("1h 1m");
  });
  it("does not turn a zero sample into a zero metric", async () => {
    const panel = await lifecyclePanel(issue, {
      ...metrics(),
      activation_rate: metric("activation_rate", null, 0),
    });
    expect(json(panel)).toContain("Not available yet");
    expect(json(panel)).not.toContain("**0%**");
  });
  it("explains an unavailable one-month activity metric", async () => {
    const panel = await lifecyclePanel(issue, metrics());
    expect(json(panel)).toContain(
      "Day 30 activity appears after 31 days of observation are complete",
    );
    expect(json(panel)).not.toContain("D30");
  });
  it("formats partial data collection", () => {
    expect(coverageLabel("degraded", 0.63)).toBe(
      "Some data could not be collected · 63%",
    );
  });
  it("formats healthy data collection without redundant percentage", () => {
    expect(coverageLabel("healthy", 1)).toBe("Data collected normally");
  });
  it("renders the overview empty state without an unavailable wall", async () => {
    const panel = await overviewPanel(issue, {
      new_members: metric("new_members", 0, 0),
    });
    expect(json(panel)).toContain("COLLECTING DATA");
    expect(json(panel)).toContain("Track the first new member");
    expect(json(panel).match(/Not available/g)?.length ?? 0).toBe(0);
  });
  it("renders four populated overview KPIs", async () => {
    const panel = await overviewPanel(issue, metrics());
    for (const label of [
      "Members with the configured first activity",
      "New Members",
      "First Reply",
      "Activity on days 7–8 after joining",
    ])
      expect(json(panel)).toContain(label);
    expect(json(panel)).toContain("58%");
  });
  it("separates community attention from data collection status", async () => {
    const panel = await overviewPanel(
      issue,
      {
        ...metrics(),
        d7_active_retention: metric(
          "d7_active_retention",
          0.31,
          12,
          "degraded",
        ),
      },
      "en",
      {
        diagnosis: { type: "ACTIVATION_DROP", severity: "warning" },
        unansweredAfter24h: 3,
      },
    );
    const value = json(panel);
    expect(value).toContain("First activity dropped");
    expect(value).toContain("Data collection status");
    expect(value).toContain("Main measures with incomplete data: 1.");
  });
  it("groups lifecycle metrics by independent milestone", async () => {
    const panel = await lifecyclePanel(issue, metrics());
    for (const stage of [
      "Joined",
      "Completed joining steps",
      "Configured first activity observed",
      "Received a reply",
      "Active later",
    ])
      expect(json(panel)).toContain(`### ${stage}`);
  });
  it("translates diagnosis enums and shows comparison", async () => {
    const panel = await diagnosticsPanel(issue, [
      {
        type: "ACTIVATION_DROP",
        severity: "warning",
        comparison: { current: 0.41, baseline: 0.56 },
        facts: {},
        sampleSize: 30,
        confidenceLabel: "observational",
      },
    ]);
    expect(json(panel)).toContain("First activity dropped");
    expect(json(panel)).toContain("−15 percentage points");
    expect(json(panel)).not.toContain("ACTIVATION_DROP");
  });
  it("renders insufficient experiment evidence in plain language", async () => {
    const panel = await experimentsPanel(
      issue,
      experiment("INSUFFICIENT_DATA"),
    );
    expect(json(panel)).toContain("Not enough data");
    expect(json(panel)).not.toContain("INSUFFICIENT_DATA");
  });
  it("keeps comparison method details behind a separate view", async () => {
    const panel = await experimentsPanel(issue, experiment("SUPPORTED")),
      advanced = await experimentMethodPanel(issue, experiment("SUPPORTED"));
    expect(json(panel)).toContain("Current results support the improvement");
    expect(json(panel)).not.toContain("Randomized");
    expect(json(advanced)).toContain("People may interact across time blocks");
  });
  it("renders a guardrail breach as a stopped safety state", async () => {
    const panel = await experimentsPanel(issue, experiment("GUARDRAIL_BREACH"));
    expect(json(panel)).toContain("Stopped for safety");
    expect(json(panel)).toContain("stopped this check for safety");
  });
  it("renders a standardized safe error panel", async () => {
    const panel = await errorPanel(issue, "generic", "en", "NXS-A1B2C3");
    expect(json(panel)).toContain("Could not complete the operation");
    expect(json(panel)).toContain("result could not be confirmed");
    expect(json(panel)).toContain("NXS-A1B2C3");
    expect(json(panel)).toContain("Check current state");
    expect(json(panel)).not.toContain("No configuration change was committed");
    expect(json(panel)).not.toMatch(/stack|token|database error/i);
  });
  it("renders English Overview", async () => {
    expect(json(await overviewPanel(issue, metrics(), "en"))).toContain(
      "Community Overview",
    );
  });
  it("renders Japanese Overview and formatting", async () => {
    const value = json(await overviewPanel(issue, metrics(), "ja"));
    expect(value).toContain("コミュニティ概要");
    expect(value).toContain("新規メンバー");
    expect(formatDuration(523, "ja")).toBe("8分43秒");
  });
  it("renders bilingual Overview with compact canonical labels", async () => {
    const value = json(await overviewPanel(issue, metrics(), "bilingual"));
    expect(value).toContain("コミュニティ概要 / NEXUS · Community Overview");
    expect(value).toContain(
      "設定した活動を確認したメンバー / Members with the configured first activity",
    );
  });
  it("resolves locale fallback for user and public panels", () => {
    expect(
      resolveLocale("auto", { interactionLocale: "ja", guildLocale: "en-US" }),
    ).toBe("ja");
    expect(
      resolveLocale("auto", {
        interactionLocale: "ja",
        guildLocale: "en-US",
        publicPanel: true,
      }),
    ).toBe("en");
    expect(resolveLocale("auto", {})).toBe("en");
  });
  it.each([
    ["SETUP_REQUIRED", "Choose what a successful newcomer"],
    ["COLLECTING_DATA", "Collecting newcomer activity"],
    ["HEALTHY", "Data is being collected normally"],
    ["NEEDS_ATTENTION", "Needs attention"],
    ["EXPERIMENT_RUNNING", "Checking whether an improvement helped"],
  ] as const)(
    "renders permanent panel state %s with refresh and update time",
    async (state, label) => {
      const value = json(
        await rootPanel(issue, "en", {
          state,
          activation: metrics().activation_rate,
          connection: metrics().direct_reply_connection_rate,
          retention: metrics().d7_active_retention,
          attention: "First replies are taking longer",
          suggestedAction: "Reply Rescue",
          setupRemaining: 3,
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        }),
      );
      expect(value).toContain(label);
      expect(value).toContain("Refresh");
      expect(value).toContain("Updated");
      expect(value).toContain("1767225600");
    },
  );
  it("localizes the guided permanent panel and never renders a broken dashboard fallback", async () => {
    const value = json(
      await rootPanel(issue, "ja", {
        state: "NEEDS_ATTENTION",
        attention: "返信が遅くなっています",
        suggestedAction: "返信レスキュー",
      }),
    );
    expect(value).toContain("今見るべきこと");
    expect(value).not.toContain('dashboard"');
  });
  it("renders Japanese buttons and select placeholders", async () => {
    const value = json(
      await settingsPanel(
        issue,
        {
          enabled: false,
          onboardingEnabled: false,
          template: "Gaming",
          startChannelId: null,
          revision: 0,
          uiLanguage: "ja",
        },
        "ja",
      ),
    );
    expect(value).toContain("表示言語を選択");
    expect(value).toContain("NEXUS を有効化");
  });
  it("renders Japanese safe errors", async () => {
    const value = json(await errorPanel(issue, "generic", "ja", "NXS-ABC123"));
    expect(value).toContain("操作結果を確認できませんでした");
    expect(value).toContain("エラー参照ID");
  });
  it("renders Japanese lifecycle stages", async () => {
    const value = json(await lifecyclePanel(issue, metrics(), "ja"));
    for (const stage of [
      "参加",
      "参加手続きを完了",
      "設定した最初の活動に到達",
      "返信を受けた",
      "その後も活動",
    ])
      expect(value).toContain(`### ${stage}`);
  });
  it("renders Japanese experiment evidence", async () => {
    const value = json(
      await experimentsPanel(issue, experiment("SUPPORTED"), "ja"),
    );
    expect(value).toContain("現在の結果は改善を支持しています");
    expect(value).not.toContain("ランダム化実験");
  });
  it("keeps one main panel command, self-service checks and explicit server-link actions", () => {
    const command = buildNexusCommand().toJSON(),
      status = command.options?.find((option) => option.name === "status");
    expect(command.description_localizations?.ja).toContain("コミュニティ");
    expect(status?.name_localizations?.ja).toBe("状態");
    expect(command.options?.map((option) => option.name)).toEqual([
      "panel",
      "personalize",
      "privacy",
      "status",
      "plan",
      "link",
      "unlink",
      "overview",
      "chart",
      "compare",
      "support-health",
      "newcomer-flow",
    ]);
  });
  it("keeps English and Japanese copy complete and short in the control panel", async () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(en[key].trim(), key).not.toBe("");
      expect(ja[key].trim(), key).not.toBe("");
    }
    const banned =
      /\b(?:Activation|Retention|Cohort|Baseline|Journey|Lifecycle|Funnel|Intervention|Experiment|Friction|Maturity|Fallback|Hybrid)\b/i;
    for (const [key, value] of Object.entries(en))
      if (key.startsWith("control.") || key.startsWith("helper."))
        expect(value, key).not.toMatch(banned);
    for (const locale of ["ja", "en"] as const)
      for (const page of controlPages) {
        const panel = await controlPanel(issue, page, {}, locale);
        expect(panel.flags).toBe(32768);
        expect(panel.components?.length).toBeLessThanOrEqual(5);
        expect(json(panel)).not.toMatch(/undefined|\{(?:count|from|to)\}/);
      }
    const known = await errorPanel(issue, "permission", "en");
    expect(json(known)).not.toContain("NXS-");
    expect(json(known)).toContain("Check status");
  });
  it("navigates all staff pages inside one control panel", async () => {
    const intents: Record<string, unknown>[] = [];
    const capture = async (data: Record<string, unknown>) => {
      intents.push(data);
      return `opaque-${intents.length}`;
    };
    for (const page of controlPages)
      await controlPanel(capture, page, {}, "en");
    expect(controlPages).toEqual([
      "overview",
      "newMembers",
      "attention",
      "analysis",
      "results",
      "settings",
    ]);
    expect(
      intents.filter((intent) => intent.action === "controlNavigate"),
    ).toHaveLength(controlPages.length + 5);
    expect(
      intents.some(
        (intent) => intent.action === "settings" || intent.action === "improve",
      ),
    ).toBe(false);
  });
  it("keeps settings and setup progress in the control panel", async () => {
    const settings = {
      analysisScope: { mode: "all", channelIds: [] },
      managerRoleIds: [],
      helperRoleIds: [],
      weeklySummaryEnabled: false,
      weeklySummaryChannelId: null,
      weeklySummaryDay: 1,
      weeklySummaryHour: 9,
      timezone: "Asia/Tokyo",
      helperEnabled: false,
      helperChannelId: null,
      firstResponseMinutes: 20,
      goalPreset: null,
      newMemberGoals: ["reply"],
      importantChannels: [],
      uiLanguage: "ja",
      detailedRetentionDays: 30,
      revision: 2,
      setupSteps: {
        scope: true,
        team: false,
        notifications: true,
        goals: false,
      },
    };
    const overview = json(
      await controlPanel(issue, "overview", { settings }, "ja"),
    );
    expect(overview).toContain("2 / 4 完了");
    const panel = json(
      await controlPanel(
        issue,
        "settings",
        { settings },
        "ja",
        "notifications",
      ),
    );
    for (const section of settingsSections.filter((value) => value !== "main"))
      expect(panel).toContain(section);
    expect(panel).toContain("返信待ち通知");
    expect(panel).toContain("テスト通知");
    const summary = await controlPanel(
      issue,
      "settings",
      { settings },
      "en",
      "summary",
      0,
      "timezone",
    );
    expect(summary.components?.length).toBeLessThanOrEqual(5);
    expect(json(summary)).toContain("Asia/Tokyo");
  });
  it("pages channels without dropping later entries and preserves privacy counts", async () => {
    const channels = Array.from({ length: 12 }, (_, index) => ({
      channelId: String(900000000000000000n + BigInt(index)),
      newcomers: 10,
      receivedReplyPercent: 50,
      laterElsewherePercent: 25,
      weekLaterPercent: 20,
    }));
    const community = {
      channels,
      importantPlaces: [],
      hiddenChannelCount: 2,
      transitions: [],
    } as unknown as ControlData["community"];
    const panel = json(
      await controlPanel(issue, "channels", { community }, "en", "scope", 1),
    );
    expect(panel).toContain("Channels 6–10 / 12");
    expect(panel).toContain(channels[5]!.channelId);
    expect(panel).not.toContain(`<#${channels[0]!.channelId}>`);
    expect(panel).toContain("2 small channels");
  });
  it("warns before installing a staff panel in a public channel", async () => {
    const intents: Record<string, unknown>[] = [];
    const capture = async (data: Record<string, unknown>) => {
      intents.push(data);
      return `opaque-${intents.length}`;
    };
    const panel = await panelPlacementWarning(
      capture,
      "900000000000000000",
      "ja",
    );
    expect(json(panel)).toContain("一般メンバーも閲覧");
    expect(intents.map((intent) => intent.action)).toEqual([
      "panelConfirm",
      "panelChoose",
    ]);
  });
  it("keeps onboarding optional in guided setup", async () => {
    const setup = {
      required: false,
      recommendedMode: null,
      activationPreset: "reply",
      activationWindowDays: 7,
      steps: [
        { key: "connect", complete: true, reason: "ready" },
        { key: "activation", complete: true, reason: "ready" },
        { key: "onboarding", complete: false, reason: "fallback_not_ready" },
        { key: "measuring", complete: false, reason: "measurement_waiting" },
      ],
    } as Parameters<typeof guidedSetupPanel>[1];
    const value = json(await guidedSetupPanel(issue, setup));
    expect(value).toContain("optional");
    expect(value).toContain("View newcomers");
    expect(value).not.toContain("Configure onboarding");
  });
  it("observes Discord onboarding without changing it during first run", async () => {
    const setup = {
      required: true,
      recommendedMode: "native",
      nativeOnboardingEnabled: true,
      activationPreset: "not_configured",
      activationWindowDays: 7,
      steps: [
        { key: "connect", complete: true, reason: "ready" },
        { key: "activation", complete: false, reason: "activation_missing" },
        { key: "onboarding", complete: true, reason: "ready" },
        { key: "measuring", complete: false, reason: "measurement_waiting" },
      ],
    } as Parameters<typeof guidedSetupPanel>[1];
    const value = json(await guidedSetupPanel(issue, setup));
    expect(value).toContain("already in use");
    expect(value).toContain("without changing it");
    expect(value).toContain("Choose first activity");
  });
  it("gives a direct channel permission fix and keeps the reference", async () => {
    const value = json(
      await errorPanel(
        issue,
        "generic",
        "en",
        "NXS-ABC123",
        "CHANNEL_PERMISSION_MISSING",
      ),
    );
    expect(value).toContain("choose another notification channel");
    expect(value).toContain("View and Send permissions");
    expect(value).toContain("NXS-ABC123");
    expect(value).not.toContain("CHANNEL_PERMISSION_MISSING");
  });
  it("shows a plain improvement with one primary action", async () => {
    const value = json(
      await improvePanel(issue, {
        id: "x",
        type: "CONNECTION_DROP",
        severity: "warning",
        stage: "connected",
        current: 0.52,
        previous: 0.66,
        difference: -0.14,
        sampleSize: 23,
        dataHealth: {
          status: "healthy",
          coverageRatio: 1,
          label: "healthy",
          notes: [],
        },
        evidence: "observational",
        causality: "not_established",
        reason: "threshold_change",
        suggestedAction: "reply_rescue",
      }),
    );
    expect(value).toContain("Improve this");
    expect(value).toContain("52%");
    expect(value).not.toContain("CONNECTION_DROP");
  });
  it("keeps generated panels within Discord component limits", async () => {
    const panels = [
      await rootPanel(issue),
      await rootPanel(issue, "ja"),
      await rootPanel(issue, "bilingual"),
      await settingsPanel(
        issue,
        {
          enabled: false,
          onboardingEnabled: false,
          template: "Gaming",
          startChannelId: null,
          revision: 0,
          uiLanguage: "bilingual",
        },
        "bilingual",
      ),
      await overviewPanel(issue, metrics()),
      await overviewPanel(issue, metrics(), "ja"),
      await overviewPanel(issue, metrics(), "bilingual"),
      await lifecyclePanel(issue, metrics(), "ja"),
      await experimentsPanel(issue, experiment("SUPPORTED"), "bilingual"),
    ];
    const count = (value: unknown): number =>
      value && typeof value === "object" && "type" in value
        ? 1 +
          ("components" in value && Array.isArray(value.components)
            ? value.components.reduce(
                (n: number, c: unknown) => n + count(c),
                0,
              )
            : 0)
        : 0;
    const inspect = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const component = value as Record<string, unknown>;
      if (typeof component.label === "string")
        expect(component.label.length).toBeLessThanOrEqual(80);
      if (typeof component.placeholder === "string")
        expect(component.placeholder.length).toBeLessThanOrEqual(150);
      if (Array.isArray(component.options))
        for (const option of component.options as Array<{
          label: string;
          description?: string;
        }>) {
          expect(option.label.length).toBeLessThanOrEqual(100);
          if (option.description)
            expect(option.description.length).toBeLessThanOrEqual(100);
        }
      if (Array.isArray(component.components))
        component.components.forEach(inspect);
    };
    for (const panel of panels) {
      expect(panel.flags).toBe(32768);
      expect(panel.allowed_mentions).toEqual({ parse: [] });
      expect(
        (panel.components ?? []).reduce((n, c) => n + count(c), 0),
      ).toBeLessThanOrEqual(40);
      inspect(panel);
      for (const component of panel.components ?? [])
        if (component.type === ComponentType.Container)
          expect(component.components.length).toBeLessThanOrEqual(40);
    }
  });
});
