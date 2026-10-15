import { expect, it } from "vitest";
import { ComponentType, ButtonStyle } from "discord-api-types/v10";
import { discordSetupUrl } from "../../packages/discord/src/install";
import {
  setupHandoff,
  legacySetupAction,
} from "../../packages/discord/src/setup-handoff";
import { freshInstallation } from "../../apps/gateway/src/install-notices";

const guild = "811111111111111111";
it("uses canonical public destinations without state, tokens or a connection code", () => {
  expect(discordSetupUrl("https://nexus.example", guild)).toBe(
    `https://nexus.example/setup?guild=${guild}`,
  );
  expect(discordSetupUrl("https://nexus.example", guild, true)).toBe(
    `https://nexus.example/dashboard/${guild}`,
  );
  for (const origin of [
    "http://example.com",
    "https://user:secret@example.com",
    "https://example.com/hidden",
    "https://example.com?state=secret",
    "javascript:alert(1)",
  ])
    expect(() => discordSetupUrl(origin, guild)).toThrow();
  expect(discordSetupUrl("http://localhost:3100", guild)).toContain(
    "/setup?guild=",
  );
});
it("presents a bilingual safe link button instead of a Discord configuration action", () => {
  const body = setupHandoff(guild, false, "https://nexus.example");
  expect(body.allowed_mentions).toEqual({ parse: [], replied_user: false });
  expect(body.content).toContain("既存の設定は保持");
  expect(body.content).toContain("Existing settings are preserved");
  expect(body.components).toEqual([
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Link,
          label: "Webで設定する / Open Web Setup",
          url: `https://nexus.example/setup?guild=${guild}`,
        },
      ],
    },
  ]);
});
it("does not infer an installation generation from readiness, stale time or a re-addition", () => {
  const now = Date.now(),
    evidence = {
      source: "created" as const,
      firstRegistration: true,
      botJoinedAt: now,
    };
  expect(freshInstallation(evidence, now)).toBe(true);
  expect(freshInstallation({ ...evidence, source: "ready" }, now)).toBe(false);
  expect(
    freshInstallation({ ...evidence, firstRegistration: false }, now),
  ).toBe(false);
  expect(
    freshInstallation({ ...evidence, botJoinedAt: now - 60001 }, now),
  ).toBe(false);
  expect(freshInstallation({ ...evidence, botJoinedAt: now + 1 }, now)).toBe(
    false,
  );
});
it("retires old settings mutations while preserving independent safety actions", () => {
  for (const action of [
    "setup",
    "setupWizardConfirm",
    "setupNext",
    "controlScope",
    "controlManagersConfirm",
    "editNodeSave",
    "configPublish",
  ])
    expect(legacySetupAction(action)).toBe(true);
  for (const action of [
    "unlinkConfirm",
    "deleteGuild",
    "deleteMember",
    "privacy",
    "analysisCancel",
    "controlCancelImprove",
  ])
    expect(legacySetupAction(action)).toBe(false);
  for (const action of [
    "enabled",
    "onboardingEnabled",
    "helperEnabled",
    "controlHelperToggle",
    "controlWeeklyToggle",
  ])
    expect(legacySetupAction(action, false)).toBe(false);
  expect(legacySetupAction("enabled", true)).toBe(true);
});
