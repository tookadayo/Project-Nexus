import { z } from "zod";
import type { CommunityModel, CapabilitySnapshot } from "./community-model";
export const recipePresets = [
  "SOCIAL",
  "LFG_GAMING",
  "SUPPORT_FORUM",
  "CREATOR_FAN",
  "EVENT_STAGE",
  "VOICE_FIRST",
  "LARGE_MIXED",
] as const;
export type RecipePreset = (typeof recipePresets)[number];
export const entryModes = [
  "INVITE",
  "APPLY_TO_JOIN",
  "DISCOVERY",
  "UNKNOWN",
] as const;
export const operationsContextSchema = z
  .object({
    entryMode: z.enum(entryModes).default("UNKNOWN"),
    staffCapacity: z
      .enum(["SMALL", "MEDIUM", "LARGE", "UNKNOWN"])
      .default("UNKNOWN"),
    interactionMode: z
      .enum(["TEXT", "VOICE", "EVENT", "MIXED", "UNKNOWN"])
      .default("UNKNOWN"),
    adminGoals: z
      .array(
        z.enum([
          "FIRST_RESPONSE",
          "LFG_RESPONSE",
          "VOICE_PARTICIPATION",
          "EVENT_PARTICIPATION",
          "LATER_ACTIVITY",
          "SUPPORT_RESOLUTION",
        ]),
      )
      .max(6)
      .default([]),
  })
  .strict();
export type JourneyNode =
  | "join"
  | "first_post"
  | "direct_reply"
  | "connection"
  | "later_activity"
  | "lfg_post"
  | "post_response"
  | "voice_copresence"
  | "repeat_participation"
  | "question"
  | "resolution"
  | "signup"
  | "attendance"
  | "repeat_attendance"
  | "voice_join"
  | "reaction"
  | "poll";
export type RecipeTransition = {
  from: JourneyNode;
  to: JourneyNode;
  unit: "MEMBER" | "POST" | "EVENT_MEMBER";
};
export type RecipeDefinition = {
  schemaVersion: 1;
  preset: RecipePreset;
  definitionVersion: string;
  strongSignals: string[];
  supportingSignals: string[];
  metrics: string[];
  transitions: RecipeTransition[];
  voiceThresholdSeconds: number;
  returnFromDay: number;
  returnThroughDay: number;
  channels: CommunityModel["channels"];
  forumTags: CommunityModel["forumTags"];
  scope: { mode: "all" | "include" | "exclude"; channelIds: string[] };
  operations: z.infer<typeof operationsContextSchema>;
};
const transition = (
  from: JourneyNode,
  to: JourneyNode,
  unit: RecipeTransition["unit"] = "MEMBER",
): RecipeTransition => ({ from, to, unit });
export const presetDefinitions: Record<
  RecipePreset,
  {
    version: string;
    modes: CommunityModel["modes"];
    strong: string[];
    supporting: string[];
    metrics: string[];
    transitions: RecipeTransition[];
  }
> = {
  SOCIAL: {
    version: "social-v1",
    modes: ["SOCIAL"],
    strong: ["reply.received", "thread.response_received", "voice.connected"],
    supporting: ["reaction.added", "poll.participated"],
    metrics: [
      "directReplies",
      "postResponse",
      "voiceCopresence",
      "laterActivity",
    ],
    transitions: [
      transition("join", "first_post"),
      transition("first_post", "direct_reply"),
      transition("first_post", "connection"),
      transition("connection", "later_activity"),
    ],
  },
  LFG_GAMING: {
    version: "lfg-play-v1",
    modes: ["LFG_PLAY", "VOICE"],
    strong: ["thread.response_received", "voice.connected", "reply.received"],
    supporting: ["thread.member_added", "reaction.added", "poll.participated"],
    metrics: [
      "lfgPosts",
      "postResponse",
      "voiceCopresence",
      "lfgThenVoice",
      "laterActivity",
    ],
    transitions: [
      transition("join", "lfg_post"),
      transition("lfg_post", "post_response", "POST"),
      transition("post_response", "voice_copresence"),
      transition("voice_copresence", "repeat_participation"),
    ],
  },
  SUPPORT_FORUM: {
    version: "support-forum-v1",
    modes: ["SUPPORT_QA"],
    strong: ["thread.response_received"],
    supporting: [],
    metrics: ["supportPosts", "postResponse", "resolvedPosts"],
    transitions: [
      transition("question", "post_response", "POST"),
      transition("post_response", "resolution", "POST"),
    ],
  },
  CREATOR_FAN: {
    version: "creator-fan-v1",
    modes: ["CREATOR_FAN", "EVENTS"],
    strong: [],
    supporting: [
      "reaction.added",
      "poll.participated",
      "scheduled_event.subscribed",
      "scheduled_event.attended",
    ],
    metrics: [
      "activeReactions",
      "pollParticipants",
      "eventSubscriptions",
      "eventAttendance",
      "laterActivity",
    ],
    transitions: [
      transition("join", "reaction"),
      transition("join", "poll"),
      transition("signup", "attendance", "EVENT_MEMBER"),
    ],
  },
  EVENT_STAGE: {
    version: "event-stage-v1",
    modes: ["EVENTS"],
    strong: [],
    supporting: ["scheduled_event.subscribed", "scheduled_event.attended"],
    metrics: [
      "eventSubscriptions",
      "eventAttendance",
      "stageAudience",
      "stageSpeakers",
    ],
    transitions: [
      transition("signup", "attendance", "EVENT_MEMBER"),
      transition("attendance", "repeat_attendance"),
    ],
  },
  VOICE_FIRST: {
    version: "voice-first-v1",
    modes: ["VOICE"],
    strong: ["voice.connected"],
    supporting: ["voice.started", "voice.duration"],
    metrics: ["voiceParticipants", "voiceCopresence", "laterActivity"],
    transitions: [
      transition("join", "voice_join"),
      transition("voice_join", "voice_copresence"),
      transition("voice_copresence", "repeat_participation"),
    ],
  },
  LARGE_MIXED: {
    version: "large-mixed-v1",
    modes: [
      "SOCIAL",
      "LFG_PLAY",
      "SUPPORT_QA",
      "CREATOR_FAN",
      "VOICE",
      "EVENTS",
    ],
    strong: ["reply.received", "thread.response_received", "voice.connected"],
    supporting: [
      "reaction.added",
      "poll.participated",
      "scheduled_event.subscribed",
    ],
    metrics: [
      "directReplies",
      "postResponse",
      "voiceCopresence",
      "eventSubscriptions",
      "eventAttendance",
      "activeReactions",
      "pollParticipants",
      "laterActivity",
    ],
    transitions: [
      transition("join", "first_post"),
      transition("first_post", "direct_reply"),
      transition("question", "post_response", "POST"),
      transition("signup", "attendance", "EVENT_MEMBER"),
      transition("connection", "later_activity"),
    ],
  },
};
export function presetForProfile(model: CommunityModel): RecipePreset {
  if (model.recipePreset) return model.recipePreset;
  if (model.modes.length > 3) return "LARGE_MIXED";
  if (model.modes.includes("LFG_PLAY")) return "LFG_GAMING";
  if (
    model.modes.includes("SUPPORT_QA") ||
    model.modes.includes("DEVELOPMENT_FEEDBACK")
  )
    return "SUPPORT_FORUM";
  if (
    model.modes.includes("CREATOR_FAN") ||
    model.modes.includes("CONTENT_SHOWCASE")
  )
    return "CREATOR_FAN";
  if (model.modes.includes("EVENTS")) return "EVENT_STAGE";
  return model.modes.includes("VOICE") ? "VOICE_FIRST" : "SOCIAL";
}
export function recipeDefinition(
  model: CommunityModel,
  scope: RecipeDefinition["scope"],
  stages: { retainedFromDay: number; retainedThroughDay: number },
): RecipeDefinition {
  const preset = presetForProfile(model),
    base = presetDefinitions[preset];
  return {
    schemaVersion: 1,
    preset,
    definitionVersion: base.version,
    strongSignals: [...base.strong],
    supportingSignals: [...base.supporting],
    metrics: [...base.metrics],
    transitions: base.transitions.map((t) => ({ ...t })),
    voiceThresholdSeconds: model.voiceThresholdSeconds,
    returnFromDay: stages.retainedFromDay,
    returnThroughDay: stages.retainedThroughDay,
    channels: model.channels.map((c) => ({ ...c })),
    forumTags: model.forumTags.map((t) => ({ ...t })),
    scope: { ...scope, channelIds: [...scope.channelIds] },
    operations: operationsContextSchema.parse(model.operations ?? {}),
  };
}
export type ModelCandidate = {
  preset: RecipePreset;
  source: "CAPABILITY" | "OBSERVED_USAGE" | "INFERRED_PATTERN";
  reasons: string[];
};
export function recipeCandidates(
  snapshot: CapabilitySnapshot | null,
  scale: string,
): ModelCandidate[] {
  const result: ModelCandidate[] = [
    {
      preset: "SOCIAL",
      source: "CAPABILITY",
      reasons: ["Administrator confirmation required"],
    },
  ];
  if (!snapshot) return result;
  const present = (key: string) =>
    ["AVAILABLE", "ENABLED", "OBSERVED", "CONFIGURED"].includes(
      snapshot.capabilities[key]?.status ?? "UNKNOWN",
    );
  if (present("forum"))
    result.push({
      preset: "SUPPORT_FORUM",
      source: "CAPABILITY",
      reasons: ["Forum available; purpose unconfirmed"],
    });
  if (present("voice"))
    for (const preset of ["LFG_GAMING", "VOICE_FIRST"] as const)
      result.push({
        preset,
        source: snapshot.observedUsage.voice ? "OBSERVED_USAGE" : "CAPABILITY",
        reasons: [
          snapshot.observedUsage.voice
            ? "Voice presence observed"
            : "Voice available; purpose unconfirmed",
        ],
      });
  if (present("scheduledEvents") || present("stage"))
    result.push({
      preset: "EVENT_STAGE",
      source: "CAPABILITY",
      reasons: ["Event or Stage available; purpose unconfirmed"],
    });
  if (snapshot.observedUsage.reaction || snapshot.observedUsage.poll)
    result.push({
      preset: "CREATOR_FAN",
      source: "OBSERVED_USAGE",
      reasons: ["Reaction or poll participation observed; purpose unconfirmed"],
    });
  if (scale === "HIGH_VOLUME")
    result.push({
      preset: "LARGE_MIXED",
      source: "INFERRED_PATTERN",
      reasons: ["High observed volume; purpose unconfirmed"],
    });
  return result;
}
