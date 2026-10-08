import {
  analysisMenuPanel,
  analysisPreviewPanel,
  analysisResultPanel,
  analysisHistoryPanel,
  analysisComparisonPanel,
} from "../../packages/discord-panels/src/views/analysis";
import { setupWizardPanel } from "../../packages/discord-panels/src/views/setup-wizard";
import { analysisTypes } from "../../packages/analysis/src/index";
import { run, result } from "../fixtures/analysis-panels";
import { componentCount } from "../../packages/discord-panels/src/primitives";
import { errorPanel } from "../../packages/discord-panels/src/views/errors.js";
import { guidedSetupPanel } from "../../packages/discord-panels/src/views/setup.js";
import {
  connectionCodePanel,
  disconnectPanel,
} from "../../packages/discord-panels/src/views/connection.js";
// Visual QA approximation from actual Components V2 payloads; no Discord client is emulated.
import {
  controlPanel,
  type ControlData,
} from "../../packages/discord-panels/src/views/control.js";
import { ComponentType } from "discord-api-types/v10";
const now = new Date("2026-09-30T09:00:00Z");
const weekly = {
  reply: {
    state: "READY",
    value: 18,
    previous: 24,
    numerator: 17,
    eligible: 25,
    responded: 17,
    activityFromDay: 0,
    sample: 17,
    needed: 0,
    from: "2026-09-20T00:00:00Z",
    through: "2026-09-27T00:00:00Z",
    observationDays: 3,
  },
  connection: {
    state: "READY",
    value: 72,
    previous: 64,
    numerator: 18,
    eligible: 25,
    responded: 17,
    activityFromDay: 0,
    sample: 25,
    needed: 0,
    from: "2026-09-20T00:00:00Z",
    through: "2026-09-27T00:00:00Z",
    observationDays: 3,
  },
  retention: {
    state: "READY",
    value: 48,
    previous: 44,
    numerator: 12,
    eligible: 25,
    responded: 17,
    activityFromDay: 7,
    sample: 25,
    needed: 0,
    from: "2026-09-15T00:00:00Z",
    through: "2026-09-22T00:00:00Z",
    observationDays: 14,
  },
};
const settings = {
  analysisScope: { mode: "all", channelIds: [] },
  managerRoleIds: ["111111111111111111"],
  helperRoleIds: ["111111111111111112"],
  weeklySummaryEnabled: true,
  weeklySummaryChannelId: "111111111111111113",
  weeklySummaryDay: 1,
  weeklySummaryHour: 9,
  timezone: "Asia/Tokyo",
  helperEnabled: true,
  helperChannelId: "111111111111111113",
  firstResponseMinutes: 20,
  goalPreset: null,
  newMemberGoals: ["reply", "voice", "event"],
  importantChannels: [],
  uiLanguage: "ja",
  detailedRetentionDays: 30,
  revision: 2,
  setupVersion: 2,
  setupSteps: { scope: true, team: true, notifications: true, goals: true },
} satisfies NonNullable<ControlData["settings"]>;
const community = {
  weekly,
  analysis: {
    retention: weekly.retention,
    joined: 38,
    exited: 5,
    rules: {
      newDays: 7,
      startingDays: 30,
      recentDays: 30,
      activeDays: 2,
      retainedFromDay: 7,
      retainedThroughDay: 14,
      repeatDays: 2,
    },
  },
  daily: {
    ready: true,
    todayJoined: 4,
    todayConnected: 3,
    attentionCount: 2,
    timezone: "Asia/Tokyo",
  },
  attention: [
    {
      channelId: "111111111111111114",
      messageId: "111111111111111115",
      waitingMinutes: 42,
      status: "OPEN",
      url: "https://discord.com/channels/111111111111111116/111111111111111114/111111111111111115",
    },
  ],
  suggestion: {
    key: "reply_rescue",
    basis: { newcomerMinutes: 32, continuingMinutes: 18 },
  },
  compare: {
    available: true,
    newcomers: { members: 17, replyMinutes: 32 },
    continuing: { members: 17, replyMinutes: 18 },
  },
  outcomes: { retained: 12, notRetained: 13, pending: 4 },
  arrivalCount: 29,
  eligibleMembers: 25,
  stages: [
    { key: "joined", count: 25 },
    { key: "activated", count: 22 },
    { key: "connected", count: 18 },
    { key: "retained", count: 12 },
  ],
  dataReady: true,
  channels: [],
  cohortWindow: {
    joinedFrom: "2026-08-23T00:00:00Z",
    joinedThrough: "2026-09-22T00:00:00Z",
    observedThroughDays: 14,
  },
  classification: { continuing: 40, inactive: 12, exited: 3, staffExcluded: 4 },
  reactionsReceived: 4,
  range: 30,
} as unknown as ControlData["community"];
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function markdown(value: string) {
  return escape(
    value
      .replace(/<#111111111111111114>/g, "#general")
      .replace(/<#111111111111111113>/g, "#staff-alerts")
      .replace(/<@&111111111111111111>/g, "@Managers")
      .replace(/<@&111111111111111112>/g, "@Helpers")
      .replace(/<t:\d+:R>/g, "3 seconds ago"),
  )
    .split("\n")
    .map((line) =>
      line.startsWith("### ")
        ? `<h3>${line.slice(4)}</h3>`
        : line.startsWith("## ")
          ? `<h2>${line.slice(3)}</h2>`
          : line.startsWith("-# ")
            ? `<small>${line.slice(3)}</small>`
            : line.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"),
    )
    .join("<br/>");
}
function component(node: Record<string, unknown>): string {
  if (node.type === ComponentType.Container)
    return `<article class="panel">${(node.components as Record<string, unknown>[]).map(component).join("")}</article>`;
  if (node.type === ComponentType.Section)
    return `<div class="section"><div class="section-text">${(node.components as Record<string, unknown>[]).map(component).join("")}</div><div class="accessory">${component(node.accessory as Record<string, unknown>)}</div></div>`;
  if (node.type === ComponentType.TextDisplay)
    return `<div class="text">${markdown(String(node.content))}</div>`;
  if (node.type === ComponentType.Separator) return "<hr/>";
  if (node.type === ComponentType.ActionRow)
    return `<div class="row">${(node.components as Record<string, unknown>[]).map(component).join("")}</div>`;
  if (node.type === ComponentType.Button)
    return `<button class="style-${node.style}" ${node.disabled ? "disabled" : ""}>${(node.emoji as { name?: string } | undefined)?.name ?? ""} ${escape(String(node.label))}${node.style === 5 ? " ↗" : ""}</button>`;
  return `<div class="select">${escape(String(node.placeholder ?? "Select"))}<span>⌄</span></div>`;
}
const output: Record<
  string,
  { html: string; count: number; characters: number }
> = {};
for (const locale of ["ja", "en"] as const)
  for (const name of [
    "home",
    "no-data",
    "attention",
    "new-members",
    "analysis",
    "results",
    "settings",
    "notifications",
    "setup",
    "error",
    "link",
    "unlink",
  ] as const) {
    const page = [
      "home",
      "no-data",
      "setup",
      "error",
      "link",
      "unlink",
    ].includes(name)
      ? "overview"
      : name === "new-members"
        ? "newMembers"
        : name === "notifications"
          ? "settings"
          : name;
    const data: ControlData = {
      community:
        name === "no-data"
          ? ({
              ...community,
              daily: {
                ready: true,
                todayJoined: 0,
                todayConnected: 0,
                attentionCount: 0,
                timezone: "Asia/Tokyo",
              },
              attention: [],
              suggestion: null,
              weekly: Object.fromEntries(
                Object.entries(weekly).map(([key, item]) => [
                  key,
                  {
                    ...item,
                    value: null,
                    previous: null,
                    state: "NO_ELIGIBLE_MEMBERS",
                    sample: 0,
                    eligible: 0,
                    responded: 0,
                    numerator: 0,
                    needed: 5,
                  },
                ]),
              ),
            } as unknown as ControlData["community"])
          : community,
      settings,
      dashboardUrl: "https://nexus.example/dashboard/111111111111111116",
      updatedAt: now,
    };
    const panel =
      name === "error"
        ? await errorPanel(
            async () => "preview",
            {
              category: "DATABASE_FAILURE",
              effect: "UNKNOWN",
              reference: "NXS-123456ABCDEF",
            },
            locale,
            undefined,
            undefined,
            { page: "analysis" },
          )
        : name === "link"
          ? connectionCodePanel(
              "[code hidden]",
              now,
              "https://nexus.example/link",
              locale,
            )
          : name === "unlink"
            ? await disconnectPanel(
                async () => "preview",
                "fixture-version",
                locale,
              )
            : name === "setup"
              ? await guidedSetupPanel(
                  async () => "preview",
                  {
                    required: true,
                    recommendedMode: "fallback",
                    nativeOnboardingEnabled: false,
                    steps: [
                      { key: "connect", complete: true, reason: "ready" },
                      {
                        key: "activation",
                        complete: false,
                        reason: "activation_missing",
                      },
                    ],
                    activationPreset: "not_configured",
                    activationWindowDays: 7,
                  },
                  locale,
                )
              : await controlPanel(
                  async () => "preview",
                  page as Parameters<typeof controlPanel>[1],
                  data,
                  locale,
                  name === "notifications" ? "notifications" : "main",
                );
    output[`${locale}-${name}`] = {
      html: (panel.components ?? [])
        .map((node) => component(node as unknown as Record<string, unknown>))
        .join(""),
      count: componentCount({ components: panel.components }),
      characters: JSON.stringify(panel).length,
    };
  }
for (const locale of ["ja", "en"] as const) {
  const issue = async () => "preview",
    panels = {
      "detailed-menu": await analysisMenuPanel(
        issue,
        {
          items: analysisTypes.map((type) => ({
            type,
            availability: "PARTIAL" as const,
          })),
          usage: { remaining: 1, reserved: 0, consumed: 0 },
          days: 30,
        },
        locale,
      ),
      "detailed-preview": await analysisPreviewPanel(
        issue,
        {
          request: { type: "OVERALL", days: 30 },
          scope: { mode: "all", channelIds: [] },
          availability: "INSUFFICIENT_DATA",
          quality: "NO_DATA",
          metrics: result.metrics,
          periodStart: run.period_start,
          periodEnd: run.period_end,
          usage: { remaining: 0, reserved: 0, consumed: 1 },
          duplicate: null,
          configRevision: 1,
          inputFingerprint: run.input_fingerprint,
          estimate: "1–3",
        },
        locale,
      ),
      "detailed-result": await analysisResultPanel(
        issue,
        { run, result },
        locale,
      ),
      "detailed-history": await analysisHistoryPanel(
        issue,
        [run, run, run, run, run],
        locale,
      ),
      "detailed-compare": await analysisComparisonPanel(
        issue,
        run.id,
        { comparable: false, changes: [] },
        locale,
      ),
    };
  for (let step = 0; step <= 4; step++)
    Object.assign(panels, {
      ["wizard-" + step]: await setupWizardPanel(
        issue,
        {
          id: run.id,
          settings_revision: 0,
          version: step,
          step,
          applied_at: null,
          draft: {
            analysisScope: { mode: "all", channelIds: [] },
            helperEnabled: false,
            helperChannelId: null,
            managerRoleIds: [],
            newMemberGoals: [],
            skipped: ["notifications", "team", "goals"],
          },
        },
        locale,
      ),
    });
  for (const [name, panel] of Object.entries(panels))
    output[`${locale}-${name}`] = {
      html: (panel.components ?? [])
        .map((node) => component(node as unknown as Record<string, unknown>))
        .join(""),
      count: componentCount({ components: panel.components }),
      characters: JSON.stringify(panel).length,
    };
}
process.stdout.write(JSON.stringify(output));
