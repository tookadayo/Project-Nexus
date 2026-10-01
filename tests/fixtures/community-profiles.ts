import {
  communityModelSchema,
  type CommunityModel,
} from "../../packages/shared/src/community-model";
import {
  buildCapabilitySnapshot,
  type DiscoverySource,
} from "../../packages/discord/src/discovery";
import type {
  AdaptivePresentation,
  AdaptiveMetric,
} from "../../packages/presentation/src/adaptive";
export const representativeProfiles = [
  {
    name: "small-text",
    modes: ["SOCIAL"],
    types: [0],
    members: 12,
    eligible: 3,
    metricKeys: ["directReplies"],
  },
  {
    name: "lfg-voice",
    modes: ["LFG_PLAY", "VOICE"],
    types: [0, 2],
    members: 300,
    eligible: 40,
    metricKeys: ["directReplies", "voiceCopresence", "lfgThenVoice"],
  },
  {
    name: "forum-support",
    modes: ["SUPPORT_QA"],
    types: [0, 15],
    members: 800,
    eligible: 70,
    metricKeys: ["directReplies", "postResponse", "resolvedPosts"],
  },
  {
    name: "event-stage",
    modes: ["EVENTS"],
    types: [13],
    members: 1200,
    eligible: 100,
    metricKeys: [
      "eventSubscriptions",
      "eventAttendance",
      "stageAudience",
      "stageSpeakers",
    ],
  },
  {
    name: "large-mixed",
    modes: ["SOCIAL", "SUPPORT_QA", "EVENTS", "CREATOR_FAN", "VOICE"],
    types: [0, 2, 5, 13, 15, 16],
    members: 50000,
    eligible: 4000,
    metricKeys: [
      "directReplies",
      "postResponse",
      "voiceCopresence",
      "eventAttendance",
      "activeReactions",
      "pollParticipants",
    ],
  },
  {
    name: "voice-first",
    modes: ["VOICE"],
    types: [2],
    members: 70,
    eligible: 14,
    metricKeys: ["voiceCopresence"],
  },
  {
    name: "non-community",
    modes: ["SOCIAL"],
    types: [0],
    members: 80,
    eligible: 15,
    metricKeys: ["directReplies"],
  },
] as const;
export function representativeSource(index: number): DiscoverySource {
  const fixture = representativeProfiles[index]!,
    types = fixture.types as readonly number[];
  return {
    features: fixture.name === "non-community" ? [] : ["COMMUNITY"],
    memberCount: fixture.members,
    afkChannelId: null,
    incidents: {},
    channels: types.map((type, i) => ({
      id: String(933333333333333330n + BigInt(i)),
      type,
      parentId: null,
      observable: fixture.name !== "large-mixed" || i !== 5,
      tagIds: type === 15 ? ["944444444444444444"] : [],
    })),
    threads: [],
    onboarding: null,
    endpointStatus: {
      channels: "AVAILABLE",
      threads: "AVAILABLE",
      onboarding:
        fixture.name === "non-community" ? "UNAVAILABLE" : "AVAILABLE",
      autoMod: "PERMISSION_MISSING",
      events: "AVAILABLE",
    },
    ruleCount: null,
    welcomeCount: null,
    scheduledEvents: fixture.modes.some((m) => m === "EVENTS")
      ? [
          {
            id: "955555555555555555",
            channelId: types.includes(13)
              ? String(933333333333333330n + BigInt(types.indexOf(13)))
              : null,
            entityType: types.includes(13) ? 1 : 3,
            status: 1,
          },
        ]
      : [],
  };
}
export function representativeUi(index: number): AdaptivePresentation {
  const fixture = representativeProfiles[index]!,
    snapshot = buildCapabilitySnapshot(
      representativeSource(index),
      new Date("2026-10-02T00:00:00Z"),
      null,
      fixture.name === "large-mixed" ? { reaction: 3, poll: 2 } : {},
    ),
    profile: CommunityModel = communityModelSchema.parse({
      modes: fixture.modes,
      confirmed: true,
      channels: snapshot.channels.map((c) => ({
        channelId: c.id,
        purpose:
          c.type === 15
            ? "SUPPORT"
            : c.type === 0
              ? "GENERAL_CONVERSATION"
              : "OTHER",
      })),
    });
  const metrics: AdaptiveMetric[] = fixture.metricKeys.map((key) => ({
    key,
    count: key === "resolvedPosts" ? 2 : 3,
    sample: 3,
    denominator: fixture.eligible,
    definition: "Synthetic fixture observations, not live Discord data.",
    state: "PARTIAL",
    ...(["directReplies", "postResponse"].includes(key)
      ? { medianMinutes: 12, p75Minutes: 20, p90Minutes: 35 }
      : {}),
    ...(key === "postResponse"
      ? { surface: "FORUM_POST", purpose: "SUPPORT" }
      : {}),
  }));
  return {
    profile,
    capabilities: snapshot,
    volume:
      fixture.members >= 10000
        ? "HIGH_VOLUME"
        : fixture.eligible < 20
          ? "LOW_VOLUME"
          : "STANDARD",
    window: { from: "2026-09-02T00:00:00Z", through: "2026-10-02T00:00:00Z" },
    coverage: { ...snapshot.coverage, partial: true },
    eligible: fixture.eligible,
    pending: 1,
    guests: 0,
    journey: {
      onboardingStarted: 3,
      onboardingCompleted: 2,
      guideStarted: 2,
      guideCompleted: 1,
      screeningPassed: 2,
    },
    metrics,
    caveats: [
      "Synthetic fixture; private/archived thread coverage is partial.",
    ],
    collectionSince: snapshot.checkedAt,
  };
}
