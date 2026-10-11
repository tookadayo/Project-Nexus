import { it, expect } from "vitest";
import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from "discord-api-types/v10";
import { controlPanel } from "../../packages/discord-panels/src/views/control";
import {
  componentCount,
  actionRow,
  nexusPanel,
  sectionWithAccessory,
  thumbnail,
} from "../../packages/discord-panels/src/primitives";
import {
  analysisMenuPanel,
  analysisPreviewPanel,
  analysisResultPanel,
  analysisHistoryPanel,
  analysisComparisonPanel,
  analysisAttentionListPanel,
} from "../../packages/discord-panels/src/views/analysis";
import { setupWizardPanel } from "../../packages/discord-panels/src/views/setup-wizard";
import {
  componentCopy,
  componentCopyKeys,
} from "../../packages/discord-panels/src/i18n/components";
import {
  analysisCopy,
  analysisCopyKeys,
} from "../../packages/discord-panels/src/i18n/analysis";
import { ja, en } from "../../packages/discord-panels/src/i18n";
import {
  analysisPriority,
  analysisTypes,
} from "../../packages/analysis/src/index";
import { run, result } from "../fixtures/analysis-panels";
import { notificationModal } from "../../apps/interaction/src/settings-modal";
import { promotionModal } from "../../apps/interaction/src/billing-modal";
import { questionModal } from "../../apps/interaction/src/question-modal";
import { communityModal } from "../../apps/interaction/src/community-modal";
import { communityModelSchema } from "../../packages/shared/src/community-model";
import {
  nexusModal,
  modalTextInput,
} from "../../packages/discord-panels/src/modal-primitives";
import { Components } from "../../packages/security/src/index";
const issue = async () => `private:${"a".repeat(60)}`,
  now = new Date("2026-10-08T00:00:00Z");
function walk(node: unknown, visit: (o: Record<string, unknown>) => void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const o = node as Record<string, unknown>;
  visit(o);
  for (const value of Object.values(o))
    if (value && typeof value === "object") walk(value, visit);
}
it.each(["ja", "en"] as const)(
  "keeps all alpha.10 panel payloads inside Discord and mobile limits (%s)",
  async (locale) => {
    const panels = [
      await controlPanel(issue, "overview", {}, locale),
      await controlPanel(issue, "settings", {}, locale),
      await analysisMenuPanel(
        issue,
        {
          items: analysisTypes.map((type) => ({
            type,
            availability: "PARTIAL",
          })),
          usage: { remaining: 1, reserved: 0, consumed: 0 },
          days: 30,
        },
        locale,
      ),
      await analysisPreviewPanel(
        issue,
        {
          request: { type: "OVERALL", days: 30, periodStart: run.period_start.toISOString(), periodEnd: run.period_end.toISOString() },
          scope: { mode: "all", channelIds: [] },
          availability: "INSUFFICIENT_DATA",
          quality: "NO_DATA",
          metrics: result.metrics,
          periodStart: run.period_start,
          periodEnd: now,
          usage: { remaining: 0, reserved: 0, consumed: 1 },
          duplicate: null,
          configRevision: 1,
          inputFingerprint: run.input_fingerprint,
          estimate: null,consumeCount:1,correctionOf:null,
          targetChannelCount: 1,
        },
        locale,
      ),
      await analysisResultPanel(issue, { run, result }, locale),
      await analysisResultPanel(
        issue,
        { run, result },
        locale,
        undefined,
        true,
      ),
      await analysisHistoryPanel(issue, [run, run, run, run, run], locale),
      await analysisComparisonPanel(
        issue,
        run.id,
        { comparable: false, changes: [] },
        locale,
      ),
      await analysisAttentionListPanel(issue, [], 0, locale),
    ];
    for (let step = 0; step <= 4; step++)
      panels.push(
        await setupWizardPanel(
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
      );
    for (const panel of panels) {
      expect(Number(panel.flags) & MessageFlags.IsComponentsV2).toBeTruthy();
      expect(
        componentCount({ components: panel.components }),
      ).toBeLessThanOrEqual(40);
      walk(panel, (o) => {
        if (typeof o.custom_id === "string")
          expect(o.custom_id.length).toBeLessThanOrEqual(100);
        if (typeof o.label === "string")
          expect(o.label.length).toBeLessThanOrEqual(45);
        if (o.type === ComponentType.ActionRow) {
          const rows = o.components as Record<string, unknown>[];
          expect(rows.length).toBeLessThanOrEqual(5);
          expect(
            rows.filter((c) => c.style === ButtonStyle.Primary),
          ).toHaveLength(
            rows.some((c) => c.style === ButtonStyle.Primary) ? 1 : 0,
          );
        }
      });
    }
    const home = panels[0]!;
    let buttons = 0;
    walk(home, (o) => {
      if (o.type === ComponentType.Button) buttons++;
    });
    expect(buttons).toBe(6);
    expect(JSON.stringify(panels[1])).not.toMatch(
      /Redis|Gateway|Transport|BullMQ|Build SHA|worker|queue|database/i,
    );
  },
);
it("enforces ordinary Japanese copy at the localized text boundary with explicit support exceptions", () => {
  const prohibited =
    /\b(?:Coverage|Attention|Insight|Entitlement|Queue|Worker|Job|Scope|Surface|Cohort|Intervention|Billing Principal|Reconcile|Redis|BullMQ|canonical|projection|snapshot|operation digest)\b/i;
  const supportKeys = new Set(["control.redis"]);
  for (const [key, value] of Object.entries(ja))
    if (!key.startsWith("web.") && !supportKeys.has(key))
      expect(value, `${key}: ${value}`).not.toMatch(prohibited);
  for (const key of componentCopyKeys)
    expect(componentCopy("ja", key)).not.toMatch(prohibited);
  for (const key of analysisCopyKeys)
    expect(analysisCopy("ja", key)).not.toMatch(prohibited);
  expect(en["control.analysis"]).toBeTruthy();
});
it("renders missing measurements without numeric zero or claiming completeness", async () => {
  const panel = await analysisResultPanel(issue, { run, result }, "ja");
  expect(JSON.stringify(panel)).toContain("値を確認できません");
  expect(JSON.stringify(panel)).not.toContain("この範囲と期間で確認できています");
  const values: string[] = [];
  walk(panel, (o) => {
    if (typeof o.content === "string") values.push(o.content);
  });
  expect(values.find((v) => v.includes("確認できた投稿"))).not.toMatch(/\n0(?:件)?\n/);
});
it("validates shared primitives and traverses Section accessories", async () => {
  await expect(
    actionRow(issue, [
      { label: "a", action: "a", style: ButtonStyle.Primary },
      { label: "b", action: "b", style: ButtonStyle.Primary },
    ]),
  ).rejects.toThrow("DISCORD_ACTION_GROUP_LIMIT");
  await expect(
    actionRow(async () => "x".repeat(101), [{ label: "a", action: "a" }]),
  ).rejects.toThrow("DISCORD_BUTTON_LIMIT");
  const section = sectionWithAccessory(
    "Title",
    "Description",
    thumbnail("https://example.com/image.png", "Accessible description"),
  );
  expect(componentCount(section)).toBe(3);
  expect(() =>
    nexusPanel({
      title: "x",
      children: Array.from({ length: 14 }, () => section),
    }),
  ).toThrow("DISCORD_COMPONENT_LIMIT");
});
it.each(["ja", "en"] as const)(
  "uses Label based structures for every migrated ordinary modal (%s)",
  (locale) => {
    const modals = [
      notificationModal("id", locale, 20, true),
      promotionModal("id", locale),
      questionModal("id", locale, {
        type: "choice",
        question: "q",
        options: ["a", "b"],
      }),
      communityModal("id", locale, communityModelSchema.parse({})),
      nexusModal("id", "Title", [
        modalTextInput("Text", "field", { maxLength: 100 }),
      ]),
    ];
    for (const modal of modals) {
      expect(modal.custom_id.length).toBeLessThanOrEqual(100);
      expect(modal.components.length).toBeLessThanOrEqual(5);
      for (const component of modal.components) {
        expect(component.type).toBe(ComponentType.Label);
        expect(component).not.toHaveProperty("components");
      }
    }
  },
);
it("uses nonzero, bounded aging without permanently outranking new Scale jobs", () => {
  for (const plan of [
    "FREE",
    "STARTER",
    "GROWTH",
    "SCALE",
    "ENTERPRISE",
    "PACK_ONLY",
  ] as const)
    expect(analysisPriority(plan, now, now)).toBeGreaterThan(0);
  expect(analysisPriority("SCALE", now, now)).toBeLessThan(
    analysisPriority("STARTER", now, now),
  );
  expect(analysisPriority("FREE", new Date("2026-01-01"), now)).toBe(
    analysisPriority("SCALE", now, now),
  );
  expect(Components.kind("private:id")).toBe("ephemeral");
});

it("bounds the confirmation preview for a historical 200-channel configuration", async () => {
  const panel = await setupWizardPanel(
    issue,
    {
      id: run.id,
      settings_revision: 0,
      version: 4,
      step: 4,
      applied_at: null,
      draft: {
        analysisScope: {
          mode: "include",
          channelIds: Array.from({ length: 200 }, (_, i) =>
            String(555555555555555550n + BigInt(i)),
          ),
        },
        helperEnabled: false,
        helperChannelId: null,
        managerRoleIds: [],
        newMemberGoals: [],
        skipped: [],
      },
    },
    "ja",
  );
  let characters = 0;
  walk(panel, (o) => {
    if (typeof o.content === "string") characters += o.content.length;
  });
  expect(characters).toBeLessThanOrEqual(4000);
  expect(JSON.stringify(panel)).toContain("指定した場所: 200件");
  expect(JSON.stringify(panel)).toContain("ほか195件");
});
