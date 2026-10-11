import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applicationEmojiDefinitions,
  applicationEmojiKeys,
  componentEmoji,
  emojiText,
  readApplicationEmojiConfig,
  withEmojiText,
} from "../../packages/shared/src/application-emoji";

const applicationId = "123456789012345678";
const emojiId = "234567890123456789";
const otherEmojiId = "345678901234567890";
const confirmed = (id = emojiId) => ({ id, status: "confirmed" });
function config(
  emojis: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return readApplicationEmojiConfig({
    DISCORD_APPLICATION_ID: applicationId,
    NEXUS_APPLICATION_EMOJIS: JSON.stringify({
      applicationId,
      emojis,
      ...extra,
    }),
  });
}
afterEach(() => vi.unstubAllEnvs());

describe("application-owned emoji registry", () => {
  it("has exactly the eight fixed static mappings", () => {
    expect(applicationEmojiKeys).toEqual([
      "overview",
      "analysis",
      "attention",
      "history",
      "settings",
      "help",
      "done",
      "news",
    ]);
    expect(
      applicationEmojiKeys.map(
        (key) => applicationEmojiDefinitions[key].unicode,
      ),
    ).toEqual(["🧭", "📊", "🔎", "🕘", "⚙️", "❔", "✅", "📣"]);
    for (const key of applicationEmojiKeys)
      expect(applicationEmojiDefinitions[key].name).toBe(`nx_${key}`);
  });
  it.each(applicationEmojiKeys)(
    "converts owner-confirmed %s without network verification",
    (key) => {
      const current = config({ [key]: confirmed() });
      expect(current.applicationId).toBe(applicationId);
      expect(componentEmoji(key, { config: current })).toEqual({
        id: emojiId,
        name: `nx_${key}`,
        animated: false,
      });
      expect(emojiText(key, { config: current })).toBe(
        `<:nx_${key}:${emojiId}>`,
      );
      expect(componentEmoji(key, { config: current, mode: "unicode" })).toEqual(
        { name: applicationEmojiDefinitions[key].unicode },
      );
    },
  );
  it("allows startup with no optional configuration or application ID", () => {
    const current = readApplicationEmojiConfig({});
    expect(current.mode).toBe("custom");
    expect(current.emojis).toEqual({});
    for (const key of applicationEmojiKeys) {
      expect(componentEmoji(key, { config: current })).toEqual({
        name: applicationEmojiDefinitions[key].unicode,
      });
      expect(emojiText(key, { config: current })).toBe(
        applicationEmojiDefinitions[key].unicode,
      );
    }
  });
  it.each([
    undefined,
    "",
    "{",
    "null",
    "[]",
    "true",
    "1",
    '"text"',
    '{"applicationId":"123456789012345678","emojis":null}',
    '{"applicationId":"123456789012345678","emojis":[]}',
    "x".repeat(8193),
  ])("never throws for malformed or missing configuration", (value) => {
    const current = readApplicationEmojiConfig({
      DISCORD_APPLICATION_ID: applicationId,
      NEXUS_APPLICATION_EMOJIS: value,
    });
    expect(current.emojis).toEqual({});
    expect(componentEmoji("overview", { config: current })).toEqual({
      name: "🧭",
    });
  });
  it.each([
    undefined,
    null,
    Number("234567890123456789"),
    "",
    "0",
    "000000000000000000",
    "123",
    "1234567890123456",
    "234567890123456789012",
    "18446744073709551616",
    "-234567890123456789",
    "234567890123456789 ",
    "2.34567890123456789e17",
    "23456789012345678x",
    "<:fake:234567890123456789>",
  ])("rejects invalid IDs independently", (id) => {
    const current = config({
      overview: { id, status: "confirmed" },
      analysis: confirmed(otherEmojiId),
    });
    expect(emojiText("overview", { config: current })).toBe("🧭");
    expect(emojiText("analysis", { config: current })).toBe(
      `<:nx_analysis:${otherEmojiId}>`,
    );
  });
  it.each([
    "unverified",
    "deleted",
    "registered",
    "CONFIRMED",
    undefined,
    true,
  ])("falls back without explicit owner declaration: %s", (status) => {
    expect(
      emojiText("overview", {
        config: config({ overview: { id: emojiId, status } }),
      }),
    ).toBe("🧭");
  });
  it("rejects foreign or missing application even for confirmed entries", () => {
    for (const supplied of [
      undefined,
      null,
      Number("123456789012345678"),
      otherEmojiId,
    ])
      expect(
        config({ overview: confirmed() }, { applicationId: supplied }).emojis,
      ).toEqual({});
    expect(
      readApplicationEmojiConfig({
        NEXUS_APPLICATION_EMOJIS: JSON.stringify({
          applicationId,
          emojis: { overview: confirmed() },
        }),
      }).emojis,
    ).toEqual({});
  });
  it("permits fixed names only and refuses animated or foreign per-entry metadata", () => {
    expect(
      emojiText("overview", {
        config: config({ overview: { ...confirmed(), name: "nx_overview" } }),
      }),
    ).toBe(`<:nx_overview:${emojiId}>`);
    for (const extra of [
      { name: "nx_analysis" },
      { name: "nx_overview:evil" },
      { name: null },
      { animated: true },
      { applicationId: otherEmojiId },
      { verified: true },
    ])
      expect(
        emojiText("overview", {
          config: config({ overview: { ...confirmed(), ...extra } }),
        }),
      ).toBe("🧭");
  });
  it("ignores unknown emoji keys and never inherits prototype settings", () => {
    const current = readApplicationEmojiConfig({
      DISCORD_APPLICATION_ID: applicationId,
      NEXUS_APPLICATION_EMOJIS: `{"applicationId":"${applicationId}","emojis":{"__proto__":{"overview":{"id":"${emojiId}","status":"confirmed"}},"constructor":{"id":"${emojiId}","status":"confirmed"},"unknown":{"id":"${emojiId}","status":"confirmed"},"analysis":{"id":"${otherEmojiId}","status":"confirmed"}}}`,
    });
    expect(Object.keys(current.emojis)).toEqual(["analysis"]);
    expect(emojiText("overview", { config: current })).toBe("🧭");
    expect({}).not.toHaveProperty("overview");
    expect(config({ overview: confirmed() }, { unknown: true }).emojis).toEqual(
      {},
    );
  });
  it("leaves raw settings unchanged and freezes validated configuration", () => {
    const input = { overview: confirmed() };
    const current = config(input);
    expect(input).toEqual({ overview: confirmed() });
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(current.emojis)).toBe(true);
    expect(Object.isFrozen(current.emojis.overview)).toBe(true);
  });
});

describe("emoji modes and adjacent labels", () => {
  it.each(["unicode", "text", "custom", "invalid", ""])(
    "uses safe mode selection: %s",
    (mode) => {
      const current = readApplicationEmojiConfig({
        DISCORD_APPLICATION_ID: applicationId,
        NEXUS_EMOJI_MODE: mode,
        NEXUS_APPLICATION_EMOJIS: JSON.stringify({
          applicationId,
          emojis: { overview: confirmed() },
        }),
      });
      expect(emojiText("overview", { config: current })).toBe(
        mode === "text"
          ? ""
          : mode === "custom" || mode === ""
            ? `<:nx_overview:${emojiId}>`
            : "🧭",
      );
    },
  );
  it.each(applicationEmojiKeys)(
    "text-only %s preserves Japanese and English text",
    (key) => {
      const options = {
        config: config({ [key]: confirmed() }),
        mode: "text" as const,
      };
      expect(componentEmoji(key, options)).toBeUndefined();
      expect(emojiText(key, options)).toBe("");
      expect(withEmojiText(key, "対応済みにする", options)).toBe(
        "対応済みにする",
      );
      expect(withEmojiText(key, "Mark handled", options)).toBe("Mark handled");
    },
  );
  it.each([
    "対応済みにする",
    "Mark handled",
    "Overview",
    "概要",
    "A <:user:123> label",
  ])("leaves label content unchanged: %s", (label) => {
    const current = config({ done: confirmed() });
    expect(withEmojiText("done", label, { config: current })).toBe(
      `<:nx_done:${emojiId}> ${label}`,
    );
    expect(
      withEmojiText("done", label, { config: current, mode: "unicode" }),
    ).toBe(`✅ ${label}`);
    expect(
      withEmojiText("done", label, { config: current, mode: "text" }),
    ).toBe(label);
  });
  it("reads current optional decoration fields on the default helper path", () => {
    vi.stubEnv("DISCORD_APPLICATION_ID", applicationId);
    vi.stubEnv(
      "NEXUS_APPLICATION_EMOJIS",
      JSON.stringify({ applicationId, emojis: { help: confirmed() } }),
    );
    vi.stubEnv("NEXUS_EMOJI_MODE", "custom");
    expect(componentEmoji("help")).toEqual({
      id: emojiId,
      name: "nx_help",
      animated: false,
    });
    expect(emojiText("help")).toBe(`<:nx_help:${emojiId}>`);
    expect(withEmojiText("help", "Help")).toBe(`<:nx_help:${emojiId}> Help`);
    vi.stubEnv("NEXUS_EMOJI_MODE", "text");
    expect(componentEmoji("help")).toBeUndefined();
    expect(withEmojiText("help", "Help")).toBe("Help");
  });
});
