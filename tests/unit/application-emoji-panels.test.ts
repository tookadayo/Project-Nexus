import { afterEach, describe, expect, it, vi } from "vitest";
import { ButtonStyle, ComponentType } from "discord-api-types/v10";
import {
  actionButton,
  actionRow,
  componentCount,
  validatePanel,
  type Panel,
} from "../../packages/discord-panels/src/primitives";
import {
  controlPanel,
  type ControlData,
} from "../../packages/discord-panels/src/views/control";
import {
  analysisMenuPanel,
  analysisHistoryPanel,
  analysisAttentionItemPanel,
} from "../../packages/discord-panels/src/views/analysis";
import { recordState } from "../../packages/discord-panels/src/views/analysis-evidence";
import { errorPanel } from "../../packages/discord-panels/src/views/errors";
import type { Issue } from "../../packages/discord-panels/src/types";
import { run, result } from "../fixtures/analysis-panels";

const keys = [
  "overview",
  "analysis",
  "attention",
  "history",
  "settings",
  "help",
  "done",
  "news",
] as const;
const appId = "123456789012345678";
function configure(mode: "custom" | "unicode" | "text", configured = true) {
  vi.stubEnv("NEXUS_EMOJI_MODE", mode);
  vi.stubEnv("DISCORD_APPLICATION_ID", appId);
  vi.stubEnv(
    "NEXUS_APPLICATION_EMOJIS",
    configured
      ? JSON.stringify({
          applicationId: appId,
          emojis: Object.fromEntries(
            keys.map((key, index) => [
              key,
              {
                id: String(234567890123456789n + BigInt(index)),
                status: "confirmed",
              },
            ]),
          ),
        })
      : "",
  );
}
afterEach(() => vi.unstubAllEnvs());
function capture() {
  const calls: {
    intent: Record<string, unknown>;
    publicEntry: boolean | undefined;
  }[] = [];
  const issue: Issue = async (intent, publicEntry) => {
    calls.push({ intent, publicEntry });
    return `existing-private-nonce-${calls.length}`;
  };
  return { issue, calls };
}
function allNodes(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  return [
    node,
    ...Object.values(node).flatMap((item) =>
      Array.isArray(item) ? item.flatMap(allNodes) : allNodes(item),
    ),
  ];
}
const item = {
  message_id: `analysis:${run.id}:waiting_response`,
  version: 2,
  status: "RESOLVED",
  evidence: result.metrics[0]!.evidence,
  detected_at: run.requested_at,
  opened_at: run.requested_at,
  updated_at: run.requested_at,
  acknowledged_at: run.requested_at,
  resolved_at: run.requested_at,
  canOperate: false,
  events: [{ state: "RESOLVED", version: 2, occurred_at: run.requested_at }],
};
const attentionData = {
  community: {
    daily: { ready: true, attentionCount: 1 },
    attention: [
      {
        channelId: "111111111111111111",
        messageId: "222222222222222222",
        waitingMinutes: 12,
        status: "RESOLVED",
        surface: "message",
        purpose: "SUPPORT",
        url: "https://discord.com/channels/333333333333333333/111111111111111111/222222222222222222",
      },
    ],
  },
} as unknown as ControlData;
async function surfaces(issue: Issue, locale: "ja" | "en"): Promise<Panel[]> {
  return [
    await controlPanel(issue, "overview", {}, locale),
    await controlPanel(issue, "settings", {}, locale),
    await controlPanel(issue, "analysis", {}, locale),
    await controlPanel(issue, "attention", attentionData, locale),
    await analysisMenuPanel(
      issue,
      {
        days: 30,
        usage: { remaining: 1 },
        items: [{ type: "OVERALL" }, { type: "POSTS_REPLIES" }],
      } as Parameters<typeof analysisMenuPanel>[1],
      locale,
    ),
    await analysisHistoryPanel(issue, [run], locale),
    await analysisAttentionItemPanel(issue, item, locale),
  ];
}
describe("application emoji panel compatibility", () => {
  it.each(["ja", "en"] as const)(
    "keeps labels, actions, nonces, authorization markers and component limits identical across modes (%s)",
    async (locale) => {
      const snapshots = [];
      for (const mode of ["text", "unicode", "custom"] as const) {
        configure(mode);
        const { issue, calls } = capture(),
          panels = await surfaces(issue, locale);
        const nodes = allNodes(panels),
          buttons = nodes.filter((n) => n.type === ComponentType.Button),
          options = nodes.filter(
            (n) => typeof n.value === "string" && typeof n.label === "string",
          );
        for (const panel of panels) {
          validatePanel(panel);
          expect(componentCount(panel)).toBeLessThanOrEqual(40);
          expect(panel.allowed_mentions).toEqual({ parse: [] });
          expect(panel.flags).toBe(32768);
        }
        for (const node of [...buttons, ...options]) {
          expect(node.label).toBeTruthy();
          expect(String(node.label)).not.toMatch(/<a?:/);
        }
        for (const button of buttons)
          expect(String(button.label).length).toBeLessThanOrEqual(80);
        for (const row of nodes.filter(
          (n) => n.type === ComponentType.ActionRow,
        ))
          expect((row.components as unknown[]).length).toBeLessThanOrEqual(5);
        if (mode === "text")
          expect(nodes.filter((n) => n.emoji !== undefined)).toHaveLength(0);
        else expect(nodes.some((n) => n.emoji !== undefined)).toBe(true);
        if (mode === "custom") {
          expect(JSON.stringify(panels)).toContain("nx_done");
          expect(JSON.stringify(panels)).not.toContain("nx_news");
        }
        snapshots.push({
          calls,
          buttons: buttons.map(({ label, custom_id, disabled, style }) => ({
            label,
            custom_id,
            disabled,
            style,
          })),
          options: options.map(({ label, value, description }) => ({
            label,
            value,
            description,
          })),
        });
      }
      expect(snapshots[1]).toEqual(snapshots[0]);
      expect(snapshots[2]).toEqual(snapshots[0]);
    },
  );
  it.each(["ja", "en"] as const)(
    "runs without an emoji map and retains explicit handled operation versus saved state (%s)",
    async (locale) => {
      configure("custom", false);
      const { issue, calls } = capture(),
        panel = await controlPanel(issue, "attention", attentionData, locale),
        nodes = allNodes(panel);
      const resolveIndex = calls.findIndex(
        (c) => c.intent.action === "controlResolve",
      );
      expect(resolveIndex).toBeGreaterThanOrEqual(0);
      const action = nodes.find(
        (n) => n.custom_id === `existing-private-nonce-${resolveIndex + 1}`,
      )!;
      expect(action.label).toBe(
        locale === "ja" ? "対応済みにする" : "Mark handled",
      );
      expect(action.emoji).toEqual({ name: "✅" });
      expect(JSON.stringify(panel)).toContain(
        locale === "ja" ? "対応済み" : "Handled",
      );
      expect(JSON.stringify(panel)).not.toContain("<:nx_");
      expect(calls[resolveIndex]).toEqual({
        intent: {
          action: "controlResolve",
          channelId: "111111111111111111",
          messageId: "222222222222222222",
        },
        publicEntry: true,
      });
    },
  );
  it("decorates only completed records and never adds a success check to an uncertain outcome", async () => {
    configure("custom");
    expect(recordState("en", "RESOLVED")).toBe("✅ Follow-up record completed");
    for (const state of [
      "OPEN",
      "ACKNOWLEDGED",
      "IN_PROGRESS",
      "SNOOZED",
      "DISMISSED",
    ]) {
      expect(recordState("en", state)).not.toContain("nx_done");
    }
    const { issue } = capture();
    const failed = await errorPanel(issue, "generic", "en");
    expect(JSON.stringify(failed)).toContain("result could not be confirmed");
    expect(JSON.stringify(failed)).not.toContain("nx_done");
    const readOnly = await analysisAttentionItemPanel(issue, item, "en");
    const updates = allNodes(readOnly)
      .filter((n) => n.type === ComponentType.Button)
      .slice(0, 3);
    expect(updates).toHaveLength(3);
    expect(updates.every((n) => n.disabled === true)).toBe(true);
  });
  it("does not alter unknown actions, and keeps boundary validation for long labels, 40 components and 4000 text characters", async () => {
    configure("custom");
    const { issue, calls } = capture();
    const unchanged = await actionButton(issue, {
      label: "Existing custom action",
      action: "legacy-unknown",
      data: { version: 9 },
    });
    expect("emoji" in unchanged ? unchanged.emoji : undefined).toBeUndefined();
    expect(calls[0]?.intent).toEqual({ action: "legacy-unknown", version: 9 });
    const boundary = await actionButton(issue, {
      label: "A".repeat(80),
      action: "legacy",
      emojiKey: "overview",
    });
    expect("label" in boundary ? boundary.label : undefined).toHaveLength(80);
    await expect(
      actionButton(issue, {
        label: "A".repeat(81),
        action: "legacy",
        emojiKey: "overview",
      }),
    ).rejects.toThrow("DISCORD_BUTTON_LIMIT");
    await expect(
      actionRow(
        issue,
        Array.from({ length: 6 }, () => ({
          label: "Old action",
          action: "legacy",
        })),
      ),
    ).rejects.toThrow("DISCORD_ACTION_GROUP_LIMIT");
    expect(() =>
      validatePanel({
        components: Array.from({ length: 40 }, () => ({
          type: ComponentType.TextDisplay,
          content: "x",
        })),
      }),
    ).not.toThrow();
    expect(() =>
      validatePanel({
        components: Array.from({ length: 41 }, () => ({
          type: ComponentType.TextDisplay,
          content: "x",
        })),
      }),
    ).toThrow("DISCORD_COMPONENT_LIMIT");
    expect(() =>
      validatePanel({
        components: [
          { type: ComponentType.TextDisplay, content: "x".repeat(4000) },
        ],
      }),
    ).not.toThrow();
    expect(() =>
      validatePanel({
        components: [
          { type: ComponentType.TextDisplay, content: "x".repeat(4001) },
        ],
      }),
    ).toThrow("DISCORD_TEXT_LIMIT");
    await expect(
      actionRow(issue, [
        {
          label: "First",
          action: "a",
          emojiKey: "analysis",
          style: ButtonStyle.Primary,
        },
        {
          label: "Second",
          action: "b",
          emojiKey: "overview",
          style: ButtonStyle.Primary,
        },
      ]),
    ).rejects.toThrow("DISCORD_ACTION_GROUP_LIMIT");
  });
  it("keeps Discord-owned role/channel selects and text-only legacy icons unchanged in structure", async () => {
    configure("custom");
    const settings = {
      analysisScope: { mode: "all", channelIds: [] },
      managerRoleIds: [],
      helperRoleIds: [],
      weeklySummaryEnabled: false,
      weeklySummaryChannelId: null,
      weeklySummaryDay: 1,
      weeklySummaryHour: 9,
      timezone: "UTC",
      helperEnabled: false,
      helperChannelId: null,
      firstResponseMinutes: 20,
      goalPreset: null,
      newMemberGoals: [],
      importantChannels: [],
      uiLanguage: "en",
      detailedRetentionDays: 30,
      revision: 2,
      setupSteps: { scope: true, team: true, notifications: true, goals: true },
    } as const;
    const { issue } = capture();
    const data = { settings } as unknown as ControlData;
    const panels = [
      await controlPanel(issue, "settings", data, "en", "team"),
      await controlPanel(issue, "settings", data, "en", "notifications"),
    ];
    for (const panel of panels) validatePanel(panel);
    const platformSelects = allNodes(panels).filter(
      (n) =>
        n.type === ComponentType.RoleSelect ||
        n.type === ComponentType.ChannelSelect,
    );
    expect(platformSelects).toHaveLength(3);
    for (const select of platformSelects) {
      expect(select).not.toHaveProperty("options");
      expect(select).not.toHaveProperty("emoji");
      expect(select.custom_id).toMatch(/^existing-private-nonce-/);
    }
    configure("text");
    const legacy = await actionButton(issue, {
      label: "Remind later",
      action: "controlSnoozeMenu",
      emoji: "🕒",
    });
    expect("emoji" in legacy ? legacy.emoji : undefined).toBeUndefined();
    expect("label" in legacy ? legacy.label : undefined).toBe("Remind later");
  });
});
