import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { ComponentType } from "discord-api-types/v10";
import { analysisTypes } from "../../packages/analysis/src/index";
import {
  analysisAttentionItemPanel,
  analysisMenuPanel,
} from "../../packages/discord-panels/src/views/analysis";
import {
  controlPanel,
  type ControlData,
} from "../../packages/discord-panels/src/views/control";
import { errorPanel } from "../../packages/discord-panels/src/views/errors";
import {
  componentCount,
  validatePanel,
  type Panel,
} from "../../packages/discord-panels/src/primitives";
import type { Issue } from "../../packages/discord-panels/src/types";
import { run, result } from "../fixtures/analysis-panels";
import {
  applicationEmojiKeys,
  componentEmoji,
  readApplicationEmojiConfig,
} from "../../packages/shared/src/application-emoji";

// Local payload/HTML approximation only. No Discord client, network, or server.
const out = resolve(".local/alpha14-evidence/application-emojis");
const envKeys = [
  "DISCORD_APPLICATION_ID",
  "NEXUS_APPLICATION_EMOJIS",
  "NEXUS_EMOJI_MODE",
] as const;
const applicationId = "123456789012345678";
// Synthetic snowflakes for local fixtures; not registered assets.
const suppliedIds = {
  news: "123456789012345680",
  help: "123456789012345681",
  overview: "123456789012345682",
  done: "123456789012345683",
  settings: "123456789012345684",
  attention: "123456789012345685",
  history: "123456789012345686",
  analysis: "123456789012345687",
};
async function checkUnconfiguredExample() {
  const encoded = await readFile(
    resolve("docs/application-emojis.example.json"),
    "utf8",
  );
  const config = readApplicationEmojiConfig({
    DISCORD_APPLICATION_ID: applicationId,
    NEXUS_APPLICATION_EMOJIS: encoded,
    NEXUS_EMOJI_MODE: "custom",
  });
  for (const key of applicationEmojiKeys) {
    expect(componentEmoji(key, { config })).not.toHaveProperty("id");
    expect(componentEmoji(key, { config, mode: "text" })).toBeUndefined();
  }
  return {
    configurationFile: "docs/application-emojis.example.json",
    checked: applicationEmojiKeys.length,
    configured: false,
    externalRequests: 0,
  };
}
if (process.argv.includes("--example-only")) {
  const report = await checkUnconfiguredExample();
  await mkdir(out, { recursive: true });
  await writeFile(
    resolve(out, "unconfigured-example.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
  process.exit(0);
}
const savedEnv = Object.fromEntries(
  envKeys.map((key) => [key, process.env[key]]),
);
const configured = JSON.stringify({
  applicationId,
  emojis: Object.fromEntries(
    Object.entries(suppliedIds).map(([key, id]) => [
      key,
      { id, status: "confirmed" },
    ]),
  ),
});
const modes = ["unset", "unicode", "text", "custom"] as const;
type Mode = (typeof modes)[number];
type Locale = "ja" | "en";
type Node = Record<string, unknown>;
type Capture = {
  name: string;
  locale: Locale;
  mode: Mode;
  payload: Panel;
  intents: Array<{ intent: Record<string, unknown>; publicEntry: boolean }>;
};
const captures: Capture[] = [];
const now = new Date("2026-10-09T12:00:00Z");
const longChannel = {
  ja: "新しい参加者からの質問と共同作業について確認するための長いチャンネル名",
  en: "new-community-members-questions-and-collaborative-work-with-a-deliberately-long-channel-name",
};
const settings: NonNullable<ControlData["settings"]> = {
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
  uiLanguage: "ja",
  detailedRetentionDays: 30,
  revision: 1,
  setupVersion: 2,
  setupSteps: { scope: true, team: true, notifications: true, goals: true },
};
function data(status = "OPEN", ready = true): ControlData {
  return {
    settings,
    analysis: { remaining: 1, latest: now, attentionCount: 1 },
    updatedAt: now,
    community: {
      range: 30,
      daily: { ready, attentionCount: 1, timezone: "UTC" },
      attention: [
        {
          channelId: "111111111111111114",
          messageId: "111111111111111115",
          waitingMinutes: 42,
          status,
          url: "https://discord.com/channels/111111111111111116/111111111111111114/111111111111111115",
          surface: "TEXT",
          purpose: "SUPPORT",
        },
      ],
    } as unknown as ControlData["community"],
  };
}
async function fixture(
  mode: Mode,
  locale: Locale,
  name: string,
  build: (issue: Issue) => Promise<Panel>,
) {
  const intents: Capture["intents"] = [];
  const issue: Issue = async (intent, publicEntry) => {
    intents.push({ intent, publicEntry: Boolean(publicEntry) });
    return "fixture:" + String(intents.length).padStart(3, "0");
  };
  const payload = await build(issue);
  validatePanel(payload);
  expect(
    componentCount({ components: payload.components }),
  ).toBeLessThanOrEqual(40);
  expect(payload.allowed_mentions).toEqual({ parse: [] });
  captures.push({ mode, locale, name, payload, intents });
}
function visit(value: unknown, fn: (node: Node) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) visit(item, fn);
    return;
  }
  const node = value as Node;
  fn(node);
  for (const child of Object.values(node)) visit(child, fn);
}
function actionContract(capture: Capture) {
  const nodes: Node[] = [];
  visit(capture.payload.components, (node) => {
    if (
      node.type !== ComponentType.Button &&
      node.type !== ComponentType.StringSelect &&
      node.type !== ComponentType.ChannelSelect &&
      node.type !== ComponentType.RoleSelect &&
      node.type !== ComponentType.UserSelect &&
      node.type !== ComponentType.MentionableSelect
    )
      return;
    nodes.push({
      type: node.type,
      custom_id: node.custom_id,
      label: node.label,
      style: node.style,
      disabled: node.disabled,
      url: node.url,
      placeholder: node.placeholder,
      options: (node.options as Node[] | undefined)?.map((option) => ({
        label: option.label,
        description: option.description,
        value: option.value,
        default: option.default,
      })),
    });
  });
  return {
    nodes,
    intents: capture.intents,
    allowed_mentions: capture.payload.allowed_mentions,
    flags: capture.payload.flags,
  };
}
function assertLabels(capture: Capture) {
  let customFields = 0;
  visit(capture.payload.components, (node) => {
    if (node.label !== undefined) {
      expect(typeof node.label).toBe("string");
      expect(String(node.label).trim().length).toBeGreaterThan(0);
      expect(String(node.label)).not.toMatch(/<a?:[^:>]+:\d+>/);
    }
    const emoji = node.emoji as Node | undefined;
    if (emoji?.id) {
      customFields++;
      expect(capture.mode).toBe("custom");
      expect(Object.values(suppliedIds)).toContain(emoji.id);
      expect(emoji.name).toMatch(
        /^nx_(overview|analysis|attention|history|settings|help|done|news)$/,
      );
      expect(emoji.animated ?? false).toBe(false);
    }
  });
  if (
    capture.mode === "custom" &&
    [
      "home",
      "settings",
      "analysis-menu",
      "attention-open",
      "record-open",
    ].includes(capture.name)
  ) {
    expect(customFields).toBeGreaterThan(0);
  }
  expect(
    capture.intents.some(({ intent }) => /news/i.test(String(intent.action))),
  ).toBe(false);
}
const esc = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function emoji(node: Node | undefined): string {
  if (!node) return "";
  if (node.id)
    return (
      '<span class="custom-placeholder" aria-hidden="true" title="Asset unavailable; placeholder only" data-custom-id="' +
      esc(node.id) +
      '"></span>'
    );
  return (
    '<span class="unicode" aria-hidden="true">' + esc(node.name) + "</span>"
  );
}
function markdown(value: string, locale: Locale): string {
  const raw = esc(
    value
      .replace(/<#111111111111111114>/g, "#" + longChannel[locale])
      .replace(/<t:\d+:[a-zA-Z]>/g, "2026-10-09 12:00 UTC"),
  );
  return raw
    .replace(/&lt;:([^:]+):(\d+)&gt;/g, (_whole, name, id) =>
      emoji({ name, id }),
    )
    .split("\n")
    .map((line) =>
      line.startsWith("### ")
        ? "<h3>" + line.slice(4) + "</h3>"
        : line.startsWith("## ")
          ? "<h2>" + line.slice(3) + "</h2>"
          : line.startsWith("-# ")
            ? "<small>" + line.slice(3) + "</small>"
            : line.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>"),
    )
    .join("<br>");
}
function component(node: Node, locale: Locale): string {
  const children = () =>
    ((node.components ?? []) as Node[])
      .map((child) => component(child, locale))
      .join("");
  switch (node.type) {
    case ComponentType.Container:
      return '<article class="panel">' + children() + "</article>";
    case ComponentType.Section:
      return (
        '<div class="section"><div class="section-text">' +
        children() +
        '</div><div class="accessory">' +
        component(node.accessory as Node, locale) +
        "</div></div>"
      );
    case ComponentType.TextDisplay:
      return (
        '<div class="text">' + markdown(String(node.content), locale) + "</div>"
      );
    case ComponentType.Separator:
      return "<hr>";
    case ComponentType.ActionRow:
      return '<div class="row">' + children() + "</div>";
    case ComponentType.Button:
      return (
        '<button class="style-' +
        esc(node.style) +
        '" ' +
        (node.disabled ? "disabled" : "") +
        ">" +
        emoji(node.emoji as Node | undefined) +
        '<span class="label">' +
        esc(node.label) +
        "</span></button>"
      );
    case ComponentType.StringSelect:
      return (
        '<div class="select" tabindex="0" role="group" aria-label="' +
        esc(node.placeholder) +
        '"><div class="placeholder">' +
        esc(node.placeholder) +
        '</div><ul class="options">' +
        ((node.options ?? []) as Node[])
          .map(
            (option) =>
              "<li>" +
              emoji(option.emoji as Node | undefined) +
              '<span class="option-text"><span class="label">' +
              esc(option.label) +
              "</span>" +
              (option.description
                ? "<small>" + esc(option.description) + "</small>"
                : "") +
              "</span></li>",
          )
          .join("") +
        "</ul></div>"
      );
    default:
      return (
        '<div class="select" tabindex="0">' +
        esc(node.placeholder ?? "Discord-generated selection") +
        "</div>"
      );
  }
}
const css = String.raw`
*{box-sizing:border-box}
body{margin:0;padding:16px;background:var(--background);color:var(--text);font:var(--font-size)/1.5 system-ui,sans-serif}
body.dark{--background:#313338;--panel:#2b2d31;--text:#f2f3f5;--muted:#c4c9ce;--border:#62666f;--button:#4e5058;--select:#1e1f22}
body.light{--background:#f2f3f5;--panel:#fff;--text:#23262b;--muted:#4b5059;--border:#81868f;--button:#e3e5e8;--select:#f2f3f5}
.note{font-size:12px;color:var(--muted);max-width:820px}
.panel{max-width:820px;background:var(--panel);border:1px solid var(--border);border-left:4px solid #2758ca;border-radius:8px;padding:16px}
.section{display:flex;align-items:center;flex-wrap:wrap;gap:12px}
.section-text{flex:1 1 220px;min-width:0}
.accessory{max-width:100%}
.text{margin:8px 0;overflow-wrap:anywhere}
h2{font-size:1.4em;line-height:1.3;margin:0}
h3{font-size:1.15em;line-height:1.4;margin:0}
small{font-size:.86em;color:var(--muted);overflow-wrap:anywhere}
hr{border:0;border-top:1px solid var(--border);margin:14px 0}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
button{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--border);border-radius:4px;padding:8px 12px;max-width:100%;min-width:0;min-height:36px;color:var(--text);background:var(--button);font:500 1em/1.4 system-ui}
button .label{min-width:0;overflow-wrap:anywhere;text-align:start}
.style-1{background:#2758ca;color:#fff}
button:disabled{opacity:.55}
button:focus-visible,.select:focus-visible{outline:3px solid #f0b232;outline-offset:3px}
.select{max-width:100%;width:100%;background:var(--select);border:1px solid var(--border);padding:10px;border-radius:4px;overflow-wrap:anywhere}
.placeholder{font-weight:600}
.options{padding:0;margin:8px 0 0;list-style:none}
.options li{display:flex;align-items:start;gap:8px;padding:6px 0}
.option-text{min-width:0}
.option-text small{display:block}
.unicode,.custom-placeholder{display:inline-block;width:22px;height:24px;line-height:24px;font-size:22px;flex:0 0 22px;vertical-align:middle}
.custom-placeholder{border:1px dashed var(--muted);height:22px;background:transparent}
`;
const screenshots: string[] = [];
let renderChecks = 0;
let blockedRequests = 0;
const browserErrors: string[] = [];
await mkdir(resolve(out, "payloads"), { recursive: true });
try {
  for (const mode of modes) {
    process.env.DISCORD_APPLICATION_ID = applicationId;
    if (mode === "unset") {
      delete process.env.NEXUS_APPLICATION_EMOJIS;
      delete process.env.NEXUS_EMOJI_MODE;
    } else {
      process.env.NEXUS_APPLICATION_EMOJIS = configured;
      process.env.NEXUS_EMOJI_MODE = mode;
    }
    for (const locale of ["ja", "en"] as const) {
      await fixture(mode, locale, "home", (issue) =>
        controlPanel(issue, "overview", data(), locale),
      );
      await fixture(mode, locale, "settings", (issue) =>
        controlPanel(issue, "settings", data(), locale),
      );
      for (const status of ["OPEN", "SNOOZED", "RESOLVED"]) {
        await fixture(
          mode,
          locale,
          "attention-" + status.toLowerCase(),
          (issue) => controlPanel(issue, "attention", data(status), locale),
        );
      }
      await fixture(mode, locale, "attention-unavailable", (issue) =>
        controlPanel(issue, "attention", data("OPEN", false), locale),
      );
      for (const status of ["OPEN", "RESOLVED", "READ_ONLY"]) {
        const recordStatus = status === "READ_ONLY" ? "OPEN" : status;
        await fixture(mode, locale, "record-" + status.toLowerCase(), (issue) =>
          analysisAttentionItemPanel(
            issue,
            {
              message_id: "analysis:" + run.id + ":waiting_response",
              version: 2,
              status: recordStatus,
              evidence: {
                ...result.metrics[0]!.evidence,
                value: 2,
                sampleSize: 5,
              },
              detected_at: now,
              opened_at: now,
              updated_at: now,
              acknowledged_at: null,
              resolved_at: recordStatus === "RESOLVED" ? now : null,
              canOperate: status !== "READ_ONLY",
              events: [{ state: recordStatus, version: 2, occurred_at: now }],
            },
            locale,
          ),
        );
      }
      await fixture(mode, locale, "analysis-menu", (issue) =>
        analysisMenuPanel(
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
      );
      await fixture(mode, locale, "permission", (issue) =>
        errorPanel(issue, "permission", locale),
      );
      await fixture(mode, locale, "result-unknown", (issue) =>
        errorPanel(
          issue,
          {
            category: "DATABASE_FAILURE",
            effect: "UNKNOWN",
            reference: "NXS-SYNTHETIC",
          },
          locale,
          undefined,
          undefined,
          { page: "attention" },
        ),
      );
      await fixture(mode, locale, "expired", (issue) =>
        errorPanel(issue, "generic", locale, undefined, "COMPONENT_EXPIRED"),
      );
    }
  }
  for (const capture of captures) {
    assertLabels(capture);
    const baseline = captures.find(
      (item) =>
        item.mode === "unset" &&
        item.locale === capture.locale &&
        item.name === capture.name,
    )!;
    expect(actionContract(capture)).toEqual(actionContract(baseline));
    if (capture.name === "record-read_only") {
      const mutations = capture.intents.filter(
        ({ intent }) => intent.action === "analysisAttentionUpdate",
      );
      expect(mutations).toHaveLength(3);
      const contract = actionContract(capture);
      expect(
        contract.nodes
          .filter((node) =>
            mutations.some(
              (_mutation, index) =>
                node.custom_id ===
                "fixture:" + String(index + 1).padStart(3, "0"),
            ),
          )
          .every((node) => node.disabled === true),
      ).toBe(true);
    }
    await writeFile(
      resolve(
        out,
        "payloads",
        capture.mode + "-" + capture.locale + "-" + capture.name + ".json",
      ),
      JSON.stringify(capture, null, 2) + "\n",
    );
  }
  console.log(
    JSON.stringify({
      stage: "payloads",
      passed: captures.length,
      actionContractsPreserved: true,
    }),
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.route("**/*", (route) => {
      blockedRequests++;
      return route.abort();
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    for (const capture of captures) {
      const fullMatrix = [
        "home",
        "attention-open",
        "record-resolved",
        "analysis-menu",
        "settings",
      ].includes(capture.name);
      const cases = fullMatrix
        ? [320, 375, 1280].flatMap((width) =>
            ["light", "dark"].flatMap((theme) =>
              [1, 2].map((scale) => ({ width, theme, scale })),
            ),
          )
        : [{ width: 375, theme: "dark", scale: 1 }];
      for (const { width, theme, scale } of cases) {
        await page.setViewportSize({ width, height: 950 });
        const name = capture.mode + "-" + capture.locale + "-" + capture.name;
        const html = (capture.payload.components ?? [])
          .map((node) => component(node as unknown as Node, capture.locale))
          .join("");
        await page.setContent(
          '<!doctype html><html lang="' +
            capture.locale +
            '"><head><meta charset="utf-8"><style>' +
            css +
            '</style></head><body class="' +
            theme +
            '" style="--font-size:' +
            14 * scale +
            'px"><p class="note">Synthetic local payload · HTML layout approximation · ' +
            name +
            " · supplied IDs + synthetic application ID. Dashed boxes reserve icon space; image assets unavailable. String Select options are expanded for label review, not a Discord menu emulation.</p>" +
            html +
            "</body></html>",
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(
          await page.locator("button:not([disabled])").count(),
        ).toBeGreaterThan(0);
        const labels = await page.locator("button .label").allTextContents();
        expect(labels.every((label) => label.trim().length > 0)).toBe(true);
        const clipped = await page
          .locator("button .label, .option-text")
          .evaluateAll((nodes) =>
            nodes.some(
              (node) =>
                node.scrollWidth > node.clientWidth + 1 ||
                node.scrollHeight > node.clientHeight + 1,
            ),
          );
        expect(clipped).toBe(false);
        await page.locator("body").click({ position: { x: 1, y: 1 } });
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(
            () =>
              document.activeElement?.matches(
                "button:not(:disabled),.select",
              ) ?? false,
          ),
        ).toBe(true);
        renderChecks++;
        if (
          width === 320 &&
          scale === 2 &&
          ["home", "attention-open", "analysis-menu"].includes(capture.name) &&
          ((capture.mode === "custom" && theme === "dark") ||
            (capture.mode === "text" && theme === "light"))
        ) {
          const filename = name + "-" + width + "-" + theme + "-text200.png";
          await page.screenshot({
            path: resolve(out, filename),
            fullPage: true,
          });
          screenshots.push(filename);
        }
      }
      if (renderChecks % 48 === 0)
        console.log(JSON.stringify({ stage: "layout", passed: renderChecks }));
    }
    expect(browserErrors).toEqual([]);
    expect(blockedRequests).toBe(0);
  } finally {
    await browser.close();
  }
  const manifest = {
    checkedAt: new Date().toISOString(),
    synthetic: true,
    actualDiscord: "NOT RUN",
    actualApplicationOwnership: "NOT VERIFIED",
    suppliedEmojiIds: suppliedIds,
    fixtureApplicationId: applicationId,
    assetsReceived: false,
    customImageQuality:
      "NOT RUN — raw assets unavailable; empty 22px placeholder only",
    configurationModes: modes,
    payloadsValidated: captures.length,
    actionContractsPreserved: true,
    layoutChecks: renderChecks,
    widths: [320, 375, 1280],
    themes: ["light", "dark"],
    textScale: ["100%", "200% CSS font-size approximation"],
    unicodeSize: "22px",
    stringSelect: "Expanded local option-label approximation",
    externalRequests: blockedRequests,
    browserErrors,
    screenshots,
  };
  await writeFile(
    resolve(out, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(JSON.stringify({ out, ...manifest }));
} finally {
  for (const key of envKeys) {
    const saved = savedEnv[key];
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
}
