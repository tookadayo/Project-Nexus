import { it, expect } from "vitest";
import { MessageFlags, ComponentType } from "discord-api-types/v10";
import { controlPanel } from "../../packages/discord-panels/src/views/control";
import { alpha5Visual } from "../fixtures/alpha5-visual";
import {
  evidenceValue,
  evidenceFraction,
} from "../../packages/shared/src/measurement-view";
import { errorPanel } from "../../packages/discord-panels/src/views/errors";
const scenarios = [
  ["small", 0, "HEALTHY"],
  ["large", 4, "ATTENTION"],
  ["text", 0, "ATTENTION"],
  ["support", 2, "ATTENTION"],
  ["lfg", 1, "ATTENTION"],
  ["no-data", 0, "NO_DATA"],
  ["partial", 1, "PARTIAL"],
  ["integration", 0, "INTENT_UNAVAILABLE"],
  ["discord-unavailable", 0, "DISCORD_UNAVAILABLE"],
] as const;
for (const [name, index, state] of scenarios)
  it(`Discord Components V2 alpha.5 ${name}`, async () => {
    const { community, model } = alpha5Visual(index, state);
    let counter = 0;
    const panel = await controlPanel(
      async () => `nxs:fixture:${++counter}`,
      ["text", "support", "lfg"].includes(name) ? "attention" : "overview",
      {
        community,
        model: {
          profile: model.profile,
          capabilities: model.capabilities,
          revision: 1,
        },
        dashboardUrl: "https://nexus.example/dashboard",
        updatedAt: new Date(model.window.through),
      },
      "ja",
    );
    expect(Number(panel.flags) & MessageFlags.IsComponentsV2).toBeTruthy();
    let count = 0;
    const texts: string[] = [];
    function walk(node: unknown) {
      if (!node || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.type === "number") count++;
      if (typeof obj.content === "string") texts.push(obj.content);
      if (typeof obj.custom_id === "string")
        expect(obj.custom_id.length).toBeLessThanOrEqual(100);
      if (obj.type === ComponentType.ActionRow && Array.isArray(obj.components))
        expect(obj.components.length).toBeLessThanOrEqual(5);
      for (const value of Object.values(obj))
        if (Array.isArray(value)) value.forEach(walk);
    }
    walk(panel);
    expect(count).toBeLessThanOrEqual(40);
    expect(texts.join("").length).toBeLessThanOrEqual(4000);
    expect(panel).toMatchSnapshot();
    if (state === "INTENT_UNAVAILABLE")
      expect(texts.join("\n")).toContain("メンバー情報");
    if (state === "NO_DATA") expect(texts.join("\n")).not.toContain("0%");
  });
it("error payload describes only the known failure and returns to its context", async () => {
  const panel = await errorPanel(
    async () => "nxs:fixture:error",
    {
      category: "DISCORD_TIMEOUT",
      effect: "UNKNOWN",
      reference: "NXS-000000000001",
    },
    "ja",
    undefined,
    undefined,
    { page: "attention", retryRead: true },
  );
  expect(panel).toMatchSnapshot();
  expect(JSON.stringify(panel)).not.toContain("権限が変更された可能性");
});
it("does not format absent or unknown metric evidence as a count or percentage", () => {
  expect(evidenceValue(undefined, "ja", true)).not.toBe("0%");
  for (const state of [
    "NO_DATA",
    "COLLECTING",
    "UNKNOWN",
    "INTENT_UNAVAILABLE",
  ] as const) {
    const metric = alpha5Visual(0, state).model.metrics[0]!;
    expect(evidenceValue(metric.evidence, "en", true)).not.toBe("0%");
  }
});
it("shows a fraction only for a sufficient observed denominator", () => {
  const e = alpha5Visual(4, "HEALTHY").model.metrics[0]!.evidence!;
  expect(evidenceFraction(e, "ja")).toBe("24 / 37 · 65%");
  expect(evidenceFraction({ ...e, numerator: 0 }, "en")).toBe("0 / 37 · 0%");
  for (const state of [
    "NO_DATA",
    "COLLECTING",
    "UNKNOWN",
    "INTENT_UNAVAILABLE",
  ] as const)
    expect(
      evidenceFraction(alpha5Visual(4, state).model.metrics[0]!.evidence, "en"),
    ).toBeUndefined();
  expect(evidenceFraction({ ...e, denominator: null }, "ja")).toBeUndefined();
});
