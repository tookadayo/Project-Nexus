import { z } from "zod";
import {recipePresets,operationsContextSchema} from './measurement-recipes';
export const communityModes = [
  "SOCIAL",
  "LFG_PLAY",
  "SUPPORT_QA",
  "DEVELOPMENT_FEEDBACK",
  "EVENTS",
  "CREATOR_FAN",
  "VOICE",
  "CONTENT_SHOWCASE",
] as const;
export const channelPurposes = [
  "GENERAL_CONVERSATION",
  "LFG",
  "SUPPORT",
  "BUG_REPORT",
  "FEEDBACK",
  "SHOWCASE",
  "ANNOUNCEMENT",
  "ONBOARDING",
  "STAFF",
  "OTHER",
] as const;
export const tagMeanings = [
  "SUPPORT_REQUEST",
  "RESOLVED",
  "BUG_REPORT",
  "FEEDBACK",
  "LFG",
  "SHOWCASE",
  "OTHER",
] as const;
export const surfaces = [
  "TEXT",
  "ANNOUNCEMENT",
  "VOICE_TEXT",
  "STAGE_TEXT",
  "THREAD",
  "FORUM_POST",
  "MEDIA_POST",
  "UNKNOWN",
] as const;
export type Surface = (typeof surfaces)[number];
export const capabilityStatuses = [
  "AVAILABLE",
  "ENABLED",
  "OBSERVED",
  "CONFIGURED",
  "UNAVAILABLE",
  "PERMISSION_MISSING",
  "UNKNOWN",
] as const;
export type CapabilityStatus = (typeof capabilityStatuses)[number];
const id = z.string().regex(/^\d{17,20}$/);
export const communityModelSchema = z
  .object({
    recipePreset: z.enum(recipePresets).optional(),
    operations: operationsContextSchema.optional(),
    modes: z
      .array(z.enum(communityModes))
      .max(8)
      .refine((v) => new Set(v).size === v.length)
      .default([]),
    confirmed: z.boolean().default(false),
    channels: z
      .array(
        z.object({ channelId: id, purpose: z.enum(channelPurposes) }).strict(),
      )
      .max(100)
      .refine((v) => new Set(v.map((x) => x.channelId)).size === v.length)
      .default([]),
    forumTags: z
      .array(
        z
          .object({ channelId: id, tagId: id, meaning: z.enum(tagMeanings) })
          .strict(),
      )
      .max(100)
      .refine(
        (v) =>
          new Set(v.map((x) => x.channelId + ":" + x.tagId)).size === v.length,
      )
      .default([]),
    voiceThresholdSeconds: z.number().int().min(60).max(3600).default(300),
  })
  .strict()
  .default({
    modes: [],
    confirmed: false,
    channels: [],
    forumTags: [],
    voiceThresholdSeconds: 300,
  });
export type CommunityModel = z.infer<typeof communityModelSchema>;
export type CapabilityEntry = {
  status: CapabilityStatus;
  availableSince: string | null;
  reason?: string;
};
export type ChannelMetadata = {
  id: string;
  type: number;
  parentId: string | null;
  observable: boolean;
  tagIds: string[];
};
export type ThreadMetadata = {
  id: string;
  parentId: string;
  type: number;
  ownerHash: string | null;
  archived: boolean;
  locked: boolean;
  createdAt: string | null;
  tagIds: string[];
};
export type CapabilitySnapshot = {
  schemaVersion: 2;
  checkedAt: string;
  features: string[];
  memberCount: number | null;
  afkChannelId: string | null;
  channelTypeCounts: Record<string, number>;
  threadCounts?: {
    active: number | null;
    public: number | null;
    private: number | null;
    announcement: number | null;
  };
  botPermissions?: {
    manageGuild: boolean;
    manageRoles: boolean;
    sendMessages: boolean;
    highestRolePosition: number | null;
  } | null;
  capabilities: Record<string, CapabilityEntry>;
  channels: ChannelMetadata[];
  coverage: {
    totalState?: "KNOWN" | "LOWER_BOUND" | "UNKNOWN";
    knownTotalChannels?: number | null;
    coverageState?: "COMPLETE" | "PARTIAL" | "LOWER_BOUND" | "UNKNOWN";
    reasons?: string[];
    observableChannels: number;
    totalRelevantChannels: number;
    ratio: number | null;
    blindSpots: { channelId: string; reason: string }[];
    privateThreads: "PARTIAL";
  };
  onboarding: {
    enabled: boolean;
    mode: number;
    defaultChannelIds: string[];
    prompts: {
      id: string;
      required: boolean;
      inOnboarding: boolean;
      options: { id: string; channelIds: string[]; roleIds: string[] }[];
    }[];
  } | null;
  suggestions: (typeof communityModes)[number][];
  incidents: Record<string, string | null>;
  observedUsage: Record<string, number>;
};
export function surfaceFor(
  channelType: number | undefined,
  parentType?: number,
): Surface {
  if (channelType === 15 || parentType === 15) return "FORUM_POST";
  if (channelType === 16 || parentType === 16) return "MEDIA_POST";
  if ([10, 11, 12].includes(channelType ?? -1)) return "THREAD";
  return channelType === 0
    ? "TEXT"
    : channelType === 5
      ? "ANNOUNCEMENT"
      : channelType === 2
        ? "VOICE_TEXT"
        : channelType === 13
          ? "STAGE_TEXT"
          : "UNKNOWN";
}
export function purposeFor(
  model: CommunityModel,
  channelId: string,
  parentId?: string | null,
) {
  return (
    model.channels.find((c) => c.channelId === (parentId ?? channelId))
      ?.purpose ?? "OTHER"
  );
}
export function strongResponseAllowed(
  model: CommunityModel,
  purpose: (typeof channelPurposes)[number],
) {
  return (
    purpose === "GENERAL_CONVERSATION" ||
    (purpose === "LFG" && model.modes.includes("LFG_PLAY")) ||
    (purpose === "SUPPORT" && model.modes.includes("SUPPORT_QA")) ||
    (["BUG_REPORT", "FEEDBACK"].includes(purpose) &&
      model.modes.includes("DEVELOPMENT_FEEDBACK"))
  );
}
export function volumeMode(input: {
  members: number;
  joined30d: number;
  eligible: number;
  eventsPerDay: number;
  attention: number;
}) {
  return input.members >= 10000 ||
    input.joined30d >= 1000 ||
    input.eventsPerDay >= 10000 ||
    input.attention >= 100
    ? "HIGH_VOLUME"
    : input.eligible < 20 && input.joined30d < 20 && input.eventsPerDay < 100
      ? "LOW_VOLUME"
      : "STANDARD";
}
export function quantiles(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (p: number) => {
    if (!sorted.length) return null;
    const i = (sorted.length - 1) * p,
      lo = Math.floor(i);
    return sorted[lo]! + (sorted[Math.ceil(i)]! - sorted[lo]!) * (i - lo);
  };
  return {
    sample: sorted.length,
    median: at(0.5),
    p75: at(0.75),
    p90: at(0.9),
  };
}
export function meaningfulActivityKinds(model: CommunityModel): Set<string> {
  const kinds = new Set(["interaction.used", "activation.completed"]);
  if (!model.confirmed)
    return new Set([
      ...kinds,
      "message.sent",
      "reaction.added",
      "voice.started",
      "voice.duration",
      "scheduled_event.subscribed",
      "fallback.answer",
    ]);
  if (
    model.modes.some((m) =>
      [
        "SOCIAL",
        "LFG_PLAY",
        "SUPPORT_QA",
        "DEVELOPMENT_FEEDBACK",
        "CONTENT_SHOWCASE",
        "CREATOR_FAN",
      ].includes(m),
    )
  ) {
    kinds.add("message.sent");
    kinds.add("thread.member_added");
  }
  if (model.modes.includes("VOICE") || model.modes.includes("LFG_PLAY")) {
    kinds.add("voice.started");
    kinds.add("voice.duration");
  }
  if (model.modes.includes("EVENTS")) {
    kinds.add("scheduled_event.subscribed");
    kinds.add("scheduled_event.attended");
    kinds.add("stage.participated");
  }
  if (
    model.modes.includes("CREATOR_FAN") ||
    model.modes.includes("CONTENT_SHOWCASE")
  ) {
    kinds.add("reaction.added");
    kinds.add("poll.participated");
  }
  return kinds;
}
