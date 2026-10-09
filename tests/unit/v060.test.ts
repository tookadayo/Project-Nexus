import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  VERSION,
  RELEASE_CHANNEL,
  shortSha,
  buildLabel,
} from "../../packages/shared/src/version.js";
import { configSchema, readConfig } from "../../packages/config/src/index.js";
import { DiscordRest } from "../../packages/discord/src/rest.js";
import {
  productGuildHash,
  productEvents,
} from "../../packages/shared/src/product-telemetry.js";
import {
  controlPanel,
  controlPages,
  settingsSections,
  type ControlData,
} from "../../packages/discord-panels/src/index.js";
import {
  discordInstallUrl,
  BASIC_BOT_PERMISSIONS,
} from "../../packages/discord/src/install.js";

afterEach(() => vi.unstubAllGlobals());
const manifest = (file: string) =>
  JSON.parse(readFileSync(file, "utf8")) as { version: string };
it("uses one SemVer source for every workspace package", () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/);
  expect(VERSION).toBe("0.6.0-alpha.14");
  expect(manifest("package.json").version).toBe(VERSION);
  expect(
    readFileSync("README.md", "utf8").match(
      /現在のリリースは \*\*([^*]+)\*\*/,
    )?.[1],
  ).toBe(VERSION);
  expect(
    readFileSync("docs/README.md", "utf8").match(
      /Current release: \*\*([^*]+)\*\*/,
    )?.[1],
  ).toBe(VERSION);
  expect(RELEASE_CHANNEL).toBe("Alpha");
  for (const area of ["apps", "packages"])
    for (const name of readdirSync(area)) {
      const file = join(area, name, "package.json");
      try {
        expect(manifest(file).version).toBe(VERSION);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          continue;
        throw error;
      }
    }
  expect(shortSha(undefined)).toBe("unknown");
  expect(shortSha("ABCDEF0123456789")).toBe("abcdef0");
  expect(buildLabel(undefined)).toBe(VERSION);
  expect(buildLabel("abcdef012345")).toBe(`${VERSION}+gabcdef0`);
});
it("validates future command scope while keeping guild default", () => {
  expect(configSchema.shape.NEXUS_COMMAND_SCOPE.parse(undefined)).toBe("guild");
  expect(configSchema.shape.NEXUS_COMMAND_SCOPE.parse("global")).toBe("global");
  expect(() =>
    configSchema.shape.NEXUS_COMMAND_SCOPE.parse("server"),
  ).toThrow();
  const env = {
    NODE_ENV: "test" as const,
    DATABASE_URL: "postgres://localhost/nexus",
    REDIS_URL: "redis://localhost:6379",
    IDENTITY_KEY: "a".repeat(64),
    LOOKUP_KEY: "b".repeat(64),
    COMPONENT_KEY: "c".repeat(64),
    DISCORD_TOKEN: "test",
    DISCORD_APPLICATION_ID: "111111111111111111",
    API_KEY: "d".repeat(32),
    NEXUS_COMMAND_SCOPE: "global",
  };
  expect(() => readConfig(env)).toThrow(
    "Global command registration is not available",
  );
});
it("generates an install link without Administrator permission", () => {
  const url = new URL(
    discordInstallUrl("123456789012345678", "222222222222222222"),
  );
  expect(url.searchParams.get("scope")).toBe("bot applications.commands");
  expect(url.searchParams.get("permissions")).toBe(
    BASIC_BOT_PERMISSIONS.toString(),
  );
  expect(BASIC_BOT_PERMISSIONS & 8n).toBe(0n);
  expect(url.searchParams.get("guild_id")).toBe("222222222222222222");
});
it("checks Discord command definitions rather than trusting a stored hash", async () => {
  const command = {
    name: "nexus",
    description: "Understand and improve",
    options: [{ type: 1, name: "panel", description: "Open panel" }],
  };
  let actual: unknown[] = [{ id: "remote", ...command }];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(actual), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
  const rest = new DiscordRest("test", "333333333333333333");
  expect(await rest.commandsMatch("111111111111111111", [command])).toBe(true);
  actual = [];
  expect(await rest.commandsMatch("111111111111111111", [command])).toBe(false);
  actual = [{ ...command, description: "Changed" }];
  expect(await rest.commandsMatch("111111111111111111", [command])).toBe(false);
});
it("classifies a staff-only channel as restricted even when a staff role has view access", async () => {
  const guild = "111111111111111111",
    staff = "222222222222222222",
    channel = "333333333333333333";
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("/channels/")
              ? {
                  guild_id: guild,
                  permission_overwrites: [
                    { id: guild, type: 0, allow: "0", deny: "1024" },
                    { id: staff, type: 0, allow: "1024", deny: "0" },
                  ],
                }
              : [
                  {
                    id: guild,
                    position: 0,
                    managed: false,
                    permissions: "1024",
                  },
                  {
                    id: staff,
                    position: 1,
                    managed: false,
                    permissions: "1024",
                  },
                ],
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  );
  const rest = new DiscordRest("test", "444444444444444444");
  expect(await rest.channelVisibility(guild, channel)).toBe("restricted");
  expect(await rest.publicChannel(guild, channel)).toBe(false);
});
it("keeps product telemetry to a fixed event vocabulary and pseudonymous guild key", () => {
  expect(productEvents).toContain("setup_completed");
  expect(productEvents).not.toContain("message_body");
  const hash = productGuildHash("111111111111111111", "secret");
  expect(hash).toMatch(/^[a-f0-9]{24}$/);
  expect(hash).not.toContain("111111111111111111");
  const sql = readFileSync("migrations/023_product_telemetry.sql", "utf8");
  expect(sql).not.toMatch(/user_id|message_body|token|username/i);
});
it("uses six top pages and offers explicit setup skips and role confirmation", async () => {
  expect(controlPages).toEqual([
    "overview",
    "newMembers",
    "attention",
    "analysis",
    "results",
    "settings",
  ]);
  expect(settingsSections).toEqual([
    "main",
    "model",
    "scope",
    "team",
    "notifications",
    "goals",
    "summary",
    "privacy",
    "panel",
    "diagnostics",
    "advanced",
    "connection",
    "other",
  ]);
  const intents: Record<string, unknown>[] = [];
  const issue = async (value: Record<string, unknown>) => {
    intents.push(value);
    return "token";
  };
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
    revision: 0,
    setupVersion: 2,
    setupSteps: {
      scope: false,
      team: false,
      notifications: false,
      goals: false,
    },
  } satisfies NonNullable<ControlData["settings"]>;
  for (const section of ["scope", "team", "notifications", "goals"] as const)
    await controlPanel(issue, "settings", { settings }, "en", section);
  for (const action of [
    "setupWizard",
    "controlSkipTeam",
    "controlSkipNotifications",
    "controlSkipGoals",
    "controlManagers",
  ])
    expect(intents.some((item) => item.action === action)).toBe(true);
  await controlPanel(
    issue,
    "settings",
    { settings: { ...settings, setupVersion: 1 } },
    "en",
    "other",
  );
  expect(intents.some((item) => item.action === "controlKeepSettings")).toBe(
    true,
  );
});
