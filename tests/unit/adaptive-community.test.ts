import { expect, it } from "vitest";
import {
  normalizeMany,
  eventSchema,
  dedupeKey,
} from "../../packages/events/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import {
  communityModelSchema,
  purposeFor,
  strongResponseAllowed,
  surfaceFor,
  volumeMode,
  quantiles,
} from "../../packages/shared/src/community-model";
import {
  buildCapabilitySnapshot,
  observableChannel,
  type DiscoverySource,
} from "../../packages/discord/src/discovery";
import {
  communityModal,
  modalFields,
} from "../../apps/interaction/src/community-modal";
const guild = "111111111111111111",
  user = "222222222222222222",
  other = "222222222222222223",
  channel = "333333333333333333",
  message = "444444444444444444",
  thread = "555555555555555555",
  vault = new IdentityVault("aa".repeat(32), "bb".repeat(32)),
  now = new Date("2026-10-02T00:00:00Z");
const normalize = (t: string, d: Record<string, unknown>) =>
  normalizeMany(
    { t, s: 2, d: { guild_id: guild, ...d } },
    0,
    "adaptive",
    vault,
    now,
  );
it.each([
  [
    "GUILD_MEMBER_ADD",
    {
      user: { id: user },
      joined_at: now.toISOString(),
      flags: 42,
      pending: true,
    },
    "member.joined",
  ],
  [
    "GUILD_MEMBER_UPDATE",
    { user: { id: user }, flags: 66, pending: false },
    "member.roles_updated",
  ],
  ["GUILD_MEMBER_REMOVE", { user: { id: user } }, "member.left"],
  [
    "MESSAGE_CREATE",
    {
      id: message,
      channel_id: channel,
      author: { id: user },
      timestamp: now.toISOString(),
      type: 19,
      message_reference: { message_id: thread },
      content: "secret",
      attachments: [{ url: "secret" }],
      poll: { question: { text: "secret" } },
    },
    "message.sent",
  ],
  [
    "MESSAGE_REACTION_ADD",
    {
      user_id: user,
      channel_id: channel,
      message_id: message,
      message_author_id: other,
      emoji: { id: null, name: "secret" },
      member: { user: { bot: false } },
    },
    "reaction.added",
  ],
  [
    "MESSAGE_REACTION_REMOVE",
    {
      user_id: user,
      channel_id: channel,
      message_id: message,
      emoji: { id: null, name: "secret" },
    },
    "reaction.removed",
  ],
  [
    "MESSAGE_REACTION_REMOVE_ALL",
    { channel_id: channel, message_id: message },
    "reaction.removed_all",
  ],
  [
    "MESSAGE_REACTION_REMOVE_EMOJI",
    {
      channel_id: channel,
      message_id: message,
      emoji: { id: null, name: "secret" },
    },
    "reaction.removed_emoji",
  ],
  [
    "MESSAGE_POLL_VOTE_ADD",
    { user_id: user, channel_id: channel, message_id: message, answer_id: 1 },
    "poll.vote_added",
  ],
  [
    "MESSAGE_POLL_VOTE_REMOVE",
    { user_id: user, channel_id: channel, message_id: message, answer_id: 1 },
    "poll.vote_removed",
  ],
  [
    "THREAD_CREATE",
    {
      id: thread,
      type: 11,
      parent_id: channel,
      owner_id: user,
      newly_created: true,
      name: "secret",
      applied_tags: [message],
      thread_metadata: { archived: false, locked: false },
    },
    "thread.created",
  ],
  [
    "THREAD_UPDATE",
    {
      id: thread,
      type: 11,
      parent_id: channel,
      thread_metadata: { archived: true, locked: true },
    },
    "thread.updated",
  ],
  [
    "THREAD_DELETE",
    { id: thread, type: 11, parent_id: channel },
    "thread.deleted",
  ],
  [
    "THREAD_LIST_SYNC",
    { threads: [{ id: thread, type: 12, parent_id: channel }] },
    "thread.list_synced",
  ],
  ["CHANNEL_CREATE", { id: channel, type: 16 }, "channel.changed"],
  ["CHANNEL_DELETE", { id: channel, type: 0 }, "channel.deleted"],
  [
    "VOICE_STATE_UPDATE",
    {
      user_id: user,
      channel_id: channel,
      suppress: true,
      member: { joined_at: null, flags: 16, user: { bot: false } },
    },
    "voice.state",
  ],
  [
    "GUILD_SCHEDULED_EVENT_CREATE",
    {
      id: message,
      channel_id: null,
      entity_type: 3,
      status: 1,
      description: "secret",
    },
    "scheduled_event.created",
  ],
  [
    "GUILD_SCHEDULED_EVENT_UPDATE",
    { id: message, channel_id: channel, entity_type: 1, status: 2 },
    "scheduled_event.updated",
  ],
  [
    "GUILD_SCHEDULED_EVENT_DELETE",
    { id: message, channel_id: channel, entity_type: 1, status: 4 },
    "scheduled_event.deleted",
  ],
  [
    "GUILD_SCHEDULED_EVENT_USER_ADD",
    { user_id: user, guild_scheduled_event_id: message },
    "scheduled_event.subscribed",
  ],
  [
    "GUILD_SCHEDULED_EVENT_USER_REMOVE",
    { user_id: user, guild_scheduled_event_id: message },
    "scheduled_event.unsubscribed",
  ],
  [
    "STAGE_INSTANCE_CREATE",
    { channel_id: channel, topic: "secret" },
    "stage.created",
  ],
  ["STAGE_INSTANCE_UPDATE", { channel_id: channel }, "stage.updated"],
  ["STAGE_INSTANCE_DELETE", { channel_id: channel }, "stage.deleted"],
  [
    "AUTO_MODERATION_ACTION_EXECUTION",
    {
      user_id: user,
      channel_id: channel,
      rule_id: message,
      action: { type: 1 },
      content: "secret",
      matched_content: "secret",
      matched_keyword: "secret",
    },
    "auto_moderation.executed",
  ],
] as const)("normalizes %s using only metadata", (type, data, kind) => {
  const events = normalize(type, data);
  expect(events).toHaveLength(1);
  expect(events[0]?.kind).toBe(kind);
  expect(JSON.stringify(events)).not.toContain("secret");
  expect(eventSchema.safeParse(events[0]).success).toBe(true);
});
it("emits 0..N thread membership changes with stable distinct ordinals", () => {
  const events = normalize("THREAD_MEMBERS_UPDATE", {
    id: thread,
    member_count: 50,
    added_members: [
      { user_id: user, member: { user: { id: user, bot: false } } },
      { user_id: other, member: { user: { id: other, bot: false } } },
      { user_id: message, member: { user: { id: message, bot: true } } },
    ],
    removed_member_ids: [message],
  });
  expect(events.map((e) => e.kind)).toEqual([
    "thread.member_added",
    "thread.member_added",
    "thread.member_removed",
  ]);
  expect(new Set(events.map(dedupeKey)).size).toBe(3);
  expect(dedupeKey(events[0]!)).toBe(
    dedupeKey({ ...events[0]!, ordinal: undefined, schemaVersion: undefined }),
  );
});
it("hydrates all supplied guild channel/thread metadata without storing raw objects", () => {
  const events = normalizeMany(
    {
      t: "GUILD_CREATE",
      s: 3,
      d: {
        id: guild,
        channels: [{ id: channel, type: 15, name: "secret" }],
        threads: [{ id: thread, type: 11, parent_id: channel, name: "secret" }],
      },
    },
    0,
    "session",
    vault,
    now,
  );
  expect(events.map((e) => e.kind)).toEqual([
    "guild.updated",
    "channel.changed",
    "thread.list_synced",
  ]);
  expect(JSON.stringify(events)).not.toContain("secret");
});
it.each(["MESSAGE_CREATE", "VOICE_STATE_UPDATE", "GUILD_MEMBER_ADD"])(
  "rejects bots for %s",
  (t) => {
    expect(
      normalize(t, {
        id: message,
        type: 0,
        timestamp: now.toISOString(),
        user_id: user,
        channel_id: channel,
        author: { id: user, bot: true },
        user: { id: user, bot: true },
        member: { user: { bot: true } },
      }),
    ).toEqual([]);
  },
);
it("does not derive poll opinions; answer hashes differ but no raw answer id persists", () => {
  const a = normalize("MESSAGE_POLL_VOTE_ADD", {
      user_id: user,
      channel_id: channel,
      message_id: message,
      answer_id: 1,
    })[0]!,
    b = normalize("MESSAGE_POLL_VOTE_ADD", {
      user_id: user,
      channel_id: channel,
      message_id: message,
      answer_id: 2,
    })[0]!;
  expect(a.answerHash).toMatch(/^[a-f\d]{64}$/);
  expect(a.answerHash).not.toBe(b.answerHash);
  expect(a).not.toHaveProperty("answer_id");
});
const source: DiscoverySource = {
  features: ["COMMUNITY"],
  memberCount: 100,
  afkChannelId: null,
  incidents: {},
  channels: [
    { id: channel, type: 15, parentId: null, observable: false, tagIds: [] },
  ],
  threads: [],
  onboarding: null,
  endpointStatus: {
    channels: "AVAILABLE",
    threads: "PERMISSION_MISSING",
    onboarding: "UNKNOWN",
    autoMod: "PERMISSION_MISSING",
    welcome: "AVAILABLE",
    events: "AVAILABLE",
  },
  ruleCount: null,
  welcomeCount: 1,
  scheduledEvents: [],
};
it("separates absent, permission missing, unknown, enabled, observed and available", () => {
  const snapshot = buildCapabilitySnapshot(source, now, null, { poll: 3 });
  expect(snapshot.capabilities.forum?.status).toBe("ENABLED");
  expect(snapshot.capabilities.media?.status).toBe("UNAVAILABLE");
  expect(snapshot.capabilities.autoMod?.status).toBe("PERMISSION_MISSING");
  expect(snapshot.capabilities.serverGuide?.status).toBe("UNKNOWN");
  expect(snapshot.capabilities.poll?.status).toBe("OBSERVED");
  expect(snapshot.capabilities.legacyWelcome?.status).toBe("AVAILABLE");
  expect(snapshot.coverage).toMatchObject({
    ratio: 0,
    observableChannels: 0,
    totalRelevantChannels: 1,
    privateThreads: "PARTIAL",
  });
});
it("preserves collection start and never assigns suggested profiles automatically", () => {
  const a = buildCapabilitySnapshot(source, now),
    b = buildCapabilitySnapshot(source, new Date(now.getTime() + 60000), a);
  expect(b.capabilities.forum?.availableSince).toBe(a.checkedAt);
  expect(b.suggestions).toContain("SUPPORT_QA");
  expect(communityModelSchema.parse({}).modes).toEqual([]);
});
it("uses administrator purposes and tags, with multiple modes and no names as authority", () => {
  const model = communityModelSchema.parse({
    modes: ["SOCIAL", "SUPPORT_QA"],
    confirmed: true,
    channels: [{ channelId: channel, purpose: "SUPPORT" }],
    forumTags: [{ channelId: channel, tagId: message, meaning: "RESOLVED" }],
  });
  expect(purposeFor(model, thread, channel)).toBe("SUPPORT");
  expect(strongResponseAllowed(model, "SUPPORT")).toBe(true);
  expect(strongResponseAllowed(model, "LFG")).toBe(false);
  expect(
    communityModelSchema.safeParse({ ...model, modes: ["SOCIAL", "SOCIAL"] })
      .success,
  ).toBe(false);
  expect(
    communityModelSchema.safeParse({
      ...model,
      channels: [{ channelId: channel, purpose: "SUPPORT", name: "lfg" }],
    }).success,
  ).toBe(false);
});
it.each([
  [0, undefined, "TEXT"],
  [5, undefined, "ANNOUNCEMENT"],
  [2, undefined, "VOICE_TEXT"],
  [13, undefined, "STAGE_TEXT"],
  [11, 15, "FORUM_POST"],
  [11, 16, "MEDIA_POST"],
  [12, 0, "THREAD"],
  [undefined, undefined, "UNKNOWN"],
] as const)("resolves surface %s/%s", (type, parent, expected) =>
  expect(surfaceFor(type, parent)).toBe(expected),
);
it("applies effective permission overwrite precedence", () => {
  const roles = [
    { id: guild, permissions: "1024" },
    { id: other, permissions: "0" },
  ];
  expect(
    observableChannel(
      {
        id: channel,
        type: 0,
        permission_overwrites: [
          { id: guild, type: 0, deny: "1024", allow: "0" },
          { id: other, type: 0, deny: "0", allow: "1024" },
        ],
      },
      guild,
      user,
      roles,
      [other],
    ),
  ).toBe(true);
  expect(
    observableChannel(
      {
        id: channel,
        type: 0,
        permission_overwrites: [
          { id: user, type: 1, deny: "1024", allow: "0" },
        ],
      },
      guild,
      user,
      roles,
      [],
    ),
  ).toBe(false);
});
it("uses counts for low volume and workload for high volume", () => {
  const small = {
    members: 30,
    joined30d: 3,
    eligible: 3,
    eventsPerDay: 20,
    attention: 1,
  };
  expect(volumeMode(small)).toBe("LOW_VOLUME");
  expect(volumeMode({ ...small, members: 50000 })).toBe("HIGH_VOLUME");
  expect(volumeMode({ ...small, attention: 100 })).toBe("HIGH_VOLUME");
  expect(volumeMode({ ...small, joined30d: 40 })).toBe("STANDARD");
  expect(quantiles([1, 2, 3, 100])).toEqual({
    sample: 4,
    median: 2.5,
    p75: 27.25,
    p90: 70.90000000000002,
  });
});
it("uses checkbox/radio only in modal Labels, and parses new and legacy modal submissions", () => {
  const modal = communityModal(
    "signed-modal",
    "ja",
    communityModelSchema.parse({ modes: ["VOICE"] }),
  );
  expect(modal.components.every((c) => c.type === 18)).toBe(true);
  expect(modal.components[0]).toMatchObject({
    component: { type: 22, custom_id: "modes" },
  });
  expect(modal.components[2]).toMatchObject({
    component: { type: 21, custom_id: "purpose" },
  });
  expect(
    modalFields([
      {
        custom_id: "",
        component: { custom_id: "modes", values: ["VOICE", "LFG_PLAY"] },
      },
      { custom_id: "", components: [{ custom_id: "threshold", value: "5" }] },
    ]),
  ).toEqual({ modes: '["VOICE","LFG_PLAY"]', threshold: "5" });
});
