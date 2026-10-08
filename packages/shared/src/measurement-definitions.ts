// Required observation surfaces, independent of the community's available features.
export const measurementDefinitions: Record<
  string,
  { version: string; surfaces: string[]; sources: string[] }
> = {
  analysisPosts: {version:"location-observed-post-count-v2",surfaces:["messages","textVisibility"],sources:["MESSAGE_CREATE:HUMAN_BOT_WEBHOOK"]},
  analysisReplies: {version:"location-observed-direct-or-forum-response-count-v2",surfaces:["messages","textVisibility"],sources:["MESSAGE_CREATE:REPLY","MESSAGE_CREATE:FORUM_HUMAN_RESPONSE"]},
  analysisReplyLatency: {version:"location-observed-first-human-response-median-v2",surfaces:["messages","textVisibility"],sources:["MESSAGE_CREATE:REPLY","MESSAGE_CREATE:FORUM_HUMAN_RESPONSE"]},
  analysisWaiting: {version:"confirmed-support-posts-no-human-response-after-one-day-v2",surfaces:["messages","textVisibility"],sources:["ADMIN_PURPOSE_MAPPING","MESSAGE_CREATE","MESSAGE_CREATE:REPLY","MESSAGE_CREATE:FORUM_HUMAN_RESPONSE"]},
  analysisComments: {version:"observed-forum-media-comment-count-v2",surfaces:["messages","forumVisibility"],sources:["MESSAGE_CREATE:NON_STARTER"]},
  new_members: {
    version: "eligible-members-v3",
    surfaces: ["members"],
    sources: ["GUILD_MEMBER_ADD"],
  },
  directReplies: {
    version: "newcomer-first-post-reply-v4",
    surfaces: ["members", "messages", "textVisibility"],
    sources: ["GUILD_MEMBER_ADD", "MESSAGE_CREATE:REPLY"],
  },
  postResponse: {
    version: "post-response-v2",
    surfaces: ["members", "messages", "forumVisibility"],
    sources: ["THREAD_CREATE", "MESSAGE_CREATE"],
  },
  supportPosts: {
    version: "observed-posts-v2",
    surfaces: ["members", "messages", "forumVisibility"],
    sources: ["THREAD_CREATE"],
  },
  lfgPosts: {
    version: "observed-lfg-v2",
    surfaces: ["members", "messages", "threadVisibility"],
    sources: ["THREAD_CREATE"],
  },
  feedbackPosts: {
    version: "observed-feedback-v2",
    surfaces: ["members", "messages", "forumVisibility"],
    sources: ["THREAD_CREATE"],
  },
  showcasePosts: {
    version: "observed-media-v2",
    surfaces: ["members", "messages", "mediaVisibility"],
    sources: ["THREAD_CREATE"],
  },
  postsAwaitingResponse: {
    version: "confirmed-purpose-post-queue-v2",
    surfaces: ["members", "messages", "forumVisibility"],
    sources: ["THREAD_CREATE", "MESSAGE_CREATE"],
  },
  resolvedPosts: {
    version: "mapped-resolution-v2",
    surfaces: ["forumVisibility"],
    sources: ["ADMIN_TAG_MAPPING", "THREAD_UPDATE"],
  },
  voiceParticipants: {
    version: "voice-presence-v1",
    surfaces: ["members", "voice", "voiceVisibility"],
    sources: ["VOICE_STATE_UPDATE"],
  },
  voiceCopresence: {
    version: "qualified-copresence-unique-participants-v2",
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
