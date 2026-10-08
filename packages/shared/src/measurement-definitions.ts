// Required observation surfaces, independent of the community's available features.
export const measurementDefinitions: Record<
  string,
  { version: string; surfaces: string[]; sources: string[] }
> = {
  analysisPosts: {version:"eligible-observed-post-count-v1",surfaces:["members","messages","textVisibility"],sources:["MESSAGE_CREATE"]},
  analysisReplies: {version:"eligible-observed-post-reply-count-v1",surfaces:["members","messages","textVisibility"],sources:["MESSAGE_CREATE:REPLY"]},
  analysisReplyLatency: {version:"eligible-observed-post-reply-median-v1",surfaces:["members","messages","textVisibility"],sources:["MESSAGE_CREATE:REPLY"]},
  analysisWaiting: {version:"eligible-posts-no-observed-reply-after-one-day-v1",surfaces:["members","messages","textVisibility"],sources:["MESSAGE_CREATE","MESSAGE_CREATE:REPLY"]},
  new_members: {
    version: "eligible-members-v3",
    surfaces: ["members"],
    sources: ["GUILD_MEMBER_ADD"],
  },
  directReplies: {
    version: "newcomer-first-post-reply-v3",
    surfaces: ["members", "messages", "textVisibility"],
    sources: ["GUILD_MEMBER_ADD", "MESSAGE_CREATE:REPLY"],
  },
  postResponse: {
    version: "post-response-v1",
    surfaces: ["members", "messages", "forumVisibility"],
    sources: ["THREAD_CREATE", "MESSAGE_CREATE"],
  },
  supportPosts: {
    version: "observed-posts-v1",
    surfaces: ["members", "messages", "forumVisibility"],
    sources: ["THREAD_CREATE"],
  },
  lfgPosts: {
    version: "observed-lfg-v1",
    surfaces: ["members", "messages", "threadVisibility"],
    sources: ["THREAD_CREATE"],
  },
  feedbackPosts: {
    version: "observed-feedback-v1",
    surfaces: ["members", "messages", "forumVisibility"],
    sources: ["THREAD_CREATE"],
  },
  showcasePosts: {
    version: "observed-media-v1",
    surfaces: ["members", "messages", "mediaVisibility"],
    sources: ["THREAD_CREATE"],
  },
  postsAwaitingResponse: {
    version: "observed-post-queue-v1",
    surfaces: ["members", "messages", "forumVisibility"],
    sources: ["THREAD_CREATE", "MESSAGE_CREATE"],
  },
  resolvedPosts: {
    version: "mapped-resolution-v1",
    surfaces: ["forumVisibility"],
    sources: ["ADMIN_TAG_MAPPING", "THREAD_UPDATE"],
  },
  voiceParticipants: {
    version: "voice-presence-v1",
    surfaces: ["members", "voice", "voiceVisibility"],
    sources: ["VOICE_STATE_UPDATE"],
  },
  voiceCopresence: {
    version: "qualified-copresence-v1",
    surfaces: ["members", "voice", "voiceVisibility"],
    sources: ["VOICE_STATE_UPDATE", "VOICE_CLOCK"],
  },
  lfgThenVoice: {
    version: "lfg-then-voice-v1",
    surfaces: [
      "members",
      "messages",
      "threadVisibility",
      "voice",
      "voiceVisibility",
    ],
    sources: ["MESSAGE_CREATE", "VOICE_CLOCK"],
  },
  eventSubscriptions: {
    version: "event-signup-v1",
    surfaces: ["members", "scheduledEvents"],
    sources: ["GUILD_SCHEDULED_EVENT_USER_ADD"],
  },
  eventAttendance: {
    version: "observed-event-attendance-v1",
    surfaces: ["members", "scheduledEvents", "voice", "voiceVisibility"],
    sources: ["GUILD_SCHEDULED_EVENT_UPDATE", "VOICE_STATE_UPDATE"],
  },
  stageAudience: {
    version: "stage-audience-state-v1",
    surfaces: ["members", "voice", "stageVisibility"],
    sources: ["VOICE_STATE_UPDATE:suppress"],
  },
  stageSpeakers: {
    version: "stage-speaker-state-v1",
    surfaces: ["members", "voice", "stageVisibility"],
    sources: ["VOICE_STATE_UPDATE:suppress"],
  },
  activeReactions: {
    version: "active-reaction-state-v1",
    surfaces: ["members", "reactions", "textVisibility"],
    sources: ["MESSAGE_REACTION_ADD", "MESSAGE_REACTION_REMOVE"],
  },
  pollParticipants: {
    version: "active-poll-state-v1",
    surfaces: ["members", "polls", "textVisibility"],
    sources: ["MESSAGE_POLL_VOTE_ADD", "MESSAGE_POLL_VOTE_REMOVE"],
  },
};
export function measurementDefinition(key: string) {
  return (
    measurementDefinitions[key] ?? {
      version: key + "-v3",
      surfaces: ["members", "messages", "textVisibility"],
      sources: ["LIFECYCLE_PROJECTION"],
    }
  );
}
export function visibilityChannelTypes(surface: string): readonly number[] {
  switch (surface) {
    case "voiceVisibility":
      return [2, 13];
    case "stageVisibility":
      return [13];
    case "forumVisibility":
      return [15];
    case "mediaVisibility":
      return [16];
    case "textVisibility":
    case "threadVisibility":
      return [0, 5, 15, 16];
    default:
      return [];
  }
}
