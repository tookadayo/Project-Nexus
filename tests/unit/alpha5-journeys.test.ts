import { expect, it } from "vitest";
import {
  transitionCounts,
  type JourneyObservation,
} from "../../packages/analytics/src/journeys";
import {
  recipeDefinition,
  presetDefinitions,
  type RecipePreset,
} from "../../packages/shared/src/measurement-recipes";
import { communityModelSchema } from "../../packages/shared/src/community-model";
const at = Date.parse("2026-10-01T00:00:00Z");
const observation = (
  kind: string,
  offset = 0,
  extra: Partial<JourneyObservation> = {},
): JourneyObservation => ({
  member: "scoped-hash",
  kind,
  at: at + offset,
  joinedAt: at,
  ...extra,
});
const recipe = (preset: RecipePreset) =>
  recipeDefinition(
    communityModelSchema.parse({
      modes: presetDefinitions[preset].modes,
      confirmed: true,
      recipePreset: preset,
    }),
    { mode: "all", channelIds: [] },
    { retainedFromDay: 7, retainedThroughDay: 14 },
  );
it("never substitutes reaction for connection or signup for attendance", () => {
  expect(
    transitionCounts(
      recipe("SOCIAL"),
      [observation("member.joined"), observation("reaction.added", 1000)],
      { from: "join", to: "connection", unit: "MEMBER" },
    ),
  ).toEqual({ numerator: 0, denominator: 1 });
  expect(
    transitionCounts(
      recipe("EVENT_STAGE"),
      [observation("scheduled_event.subscribed", 0, { eventId: "event" })],
      { from: "signup", to: "attendance", unit: "EVENT_MEMBER" },
    ),
  ).toEqual({ numerator: 0, denominator: 1 });
});
it("requires response and resolution for the same question and an explicit resolution observation", () => {
  const r = recipe("SUPPORT_FORUM"),
    observations = [
      observation("thread.created", 0, {
        purpose: "SUPPORT",
        channelId: "question",
      }),
      observation("thread.response_received", 1000, {
        channelId: "other-question",
      }),
      observation("thread.updated", 2000, {
        channelId: "question",
        resolved: false,
      }),
    ];
  expect(transitionCounts(r, observations, r.transitions[0]!)).toEqual({
    numerator: 0,
    denominator: 1,
  });
  observations.push(
    observation("thread.response_received", 1000, { channelId: "question" }),
    observation("forum.tags_changed", 2000, {
      channelId: "question",
      resolved: true,
    }),
  );
  expect(transitionCounts(r, observations, r.transitions[0]!)).toEqual({
    numerator: 1,
    denominator: 1,
  });
  expect(transitionCounts(r, observations, r.transitions[1]!)).toEqual({
    numerator: 1,
    denominator: 2,
  });
});
it("does not treat an earlier observation as a later transition, including repeated days", () => {
  const r = recipe("VOICE_FIRST"),
    observations = [
      observation("voice.started", 0),
      observation("voice.connected", 86400000),
      observation("voice.started", 1000),
      observation("voice.started", 2 * 86400000),
    ];
  expect(
    transitionCounts(r, observations, {
      from: "voice_copresence",
      to: "repeat_participation",
      unit: "MEMBER",
    }),
  ).toEqual({ numerator: 1, denominator: 1 });
  expect(
    transitionCounts(
      r,
      [
        observation("voice.connected", 86400000),
        observation("voice.started", 0),
      ],
      { from: "voice_copresence", to: "repeat_participation", unit: "MEMBER" },
    ),
  ).toEqual({ numerator: 0, denominator: 1 });
});
it("keeps member transitions stable under deterministic reorder and replay", () => {
  const r = recipe("SOCIAL"),
    events = [
      observation("member.joined"),
      observation("message.sent", 1),
      observation("reply.received", 2),
      observation("message.sent", 8 * 86400000),
    ];
  for (let shift = 0; shift < events.length; shift++) {
    const shuffled = [
      ...events.slice(shift),
      ...events.slice(0, shift),
      ...events,
    ];
    for (const t of r.transitions)
      expect(transitionCounts(r, shuffled, t)).toEqual(
        transitionCounts(r, events, t),
      );
  }
});
it("uses actual different event IDs for repeat attendance, without inferred recurring series", () => {
  const r = recipe("EVENT_STAGE"),
    t = {
      from: "attendance",
      to: "repeat_attendance",
      unit: "MEMBER",
    } as const,
    events = [
      observation("scheduled_event.attended", 0, { eventId: "a" }),
      observation("scheduled_event.attended", 1000, { eventId: "a" }),
    ];
  expect(transitionCounts(r, events, t).numerator).toBe(0);
  events.push(observation("scheduled_event.attended", 2000, { eventId: "b" }));
  expect(transitionCounts(r, events, t).numerator).toBe(1);
});
