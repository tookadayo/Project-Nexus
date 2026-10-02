import { expect, it } from "vitest";
import { communityModelSchema } from "../../packages/shared/src/community-model";
import {
  recipePresets,
  presetDefinitions,
  recipeDefinition,
  recipeCandidates,
} from "../../packages/shared/src/measurement-recipes";
import { representativeSource } from "../fixtures/community-profiles";
import { buildCapabilitySnapshot } from "../../packages/discord/src/discovery";
it.each(recipePresets)(
  "defines a versioned recipe with explicit transition units: %s",
  (preset) => {
    const model = communityModelSchema.parse({
      modes: presetDefinitions[preset].modes,
      confirmed: true,
      recipePreset: preset,
    });
    const recipe = recipeDefinition(
      model,
      { mode: "all", channelIds: [] },
      { retainedFromDay: 7, retainedThroughDay: 14 },
    );
    expect(recipe.definitionVersion).toMatch(/-v1$/);
    expect(recipe.transitions.length).toBeGreaterThan(0);
    expect(recipe.preset).toBe(preset);
    expect(recipe.returnFromDay).toBe(7);
    expect(recipe.strongSignals).not.toContain("reaction.added");
    expect(recipe.strongSignals).not.toContain("scheduled_event.subscribed");
  },
);
it("does not infer an administrator purpose from forum existence or observed activity", () => {
  const snapshot = buildCapabilitySnapshot(
    representativeSource(2),
    new Date("2026-10-02T00:00:00Z"),
  );
  const candidates = recipeCandidates(snapshot, "STANDARD");
  expect(candidates.find((c) => c.preset === "SUPPORT_FORUM")?.source).toBe(
    "CAPABILITY",
  );
  const profile = communityModelSchema.parse({});
  expect(profile.confirmed).toBe(false);
  expect(profile.channels).toEqual([]);
  expect(profile.forumTags).toEqual([]);
  expect(profile.modes).toEqual([]);
});
it("freezes a definition independently of mutable default objects and model edits", () => {
  const model = communityModelSchema.parse({
    modes: ["VOICE"],
    confirmed: true,
  });
  const scope = {
    mode: "include" as const,
    channelIds: ["333333333333333333"],
  };
  const recipe = recipeDefinition(model, scope, {
    retainedFromDay: 7,
    retainedThroughDay: 14,
  });
  model.voiceThresholdSeconds = 600;
  scope.channelIds.push("333333333333333334");
  expect(recipe.voiceThresholdSeconds).toBe(300);
  expect(recipe.scope.channelIds).toHaveLength(1);
});
