import { afterAll, beforeAll, expect, it } from "vitest";
import { infrastructure } from "../fixtures/infrastructure";
import { FakeDiscord } from "../fixtures/discord";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { SettingsService, type Actor } from "../../packages/settings/src/index";
import { LifecycleService } from "../../packages/lifecycle/src/index";
import { normalizeMany, dedupeKey } from "../../packages/events/src/index";
import { tickVoice } from "../../packages/lifecycle/src/adaptive-projector";
import {
  DiscoveryWorker,
  latestCapability,
  requestCapabilityRefresh,
} from "../../packages/lifecycle/src/discovery";
import { CommunityService } from "../../packages/presentation/src/community";
import { PrivacyService } from "../../packages/security/src/privacy";
let infra: Awaited<ReturnType<typeof infrastructure>>,
  db: Database,
  counter = 0;
const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32)),
  user = "222222222222222222",
  other = "222222222222222223",
  guest = "222222222222222224",
  channel = "333333333333333333",
  voice = "333333333333333334",
  stage = "333333333333333335",
  afk = "333333333333333336",
  thread = "555555555555555555",
  message = "444444444444444444",
  tag = "666666666666666666",
  event = "777777777777777777";
const actor: Actor = {
  key: "admin",
  permissions: "8",
  roles: [],
  source: "WEB_DASHBOARD",
  requestId: "adaptive-test",
};
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
async function fixture() {
  const s = scopeForGuild(String(111111111111110000n + BigInt(++counter))),
    settings = new SettingsService(db),
    discord = new FakeDiscord(),
    now = new Date(Date.now() - 3600000);
  await ensureGuild(db, s);
  await settings.update(s, actor, 0, {
    communityModel: {
      modes: ["SUPPORT_QA", "LFG_PLAY", "VOICE", "EVENTS", "CREATOR_FAN"],
      confirmed: true,
      channels: [{ channelId: channel, purpose: "SUPPORT" }],
      forumTags: [{ channelId: channel, tagId: tag, meaning: "RESOLVED" }],
      voiceThresholdSeconds: 300,
    },
  });
  for (const id of [user, other])
    discord.members.set(id, {
      roles: [],
      joinedAt: new Date(now.getTime() - 3600000).toISOString(),
      permissions: "0",
      bot: false,
    });
  discord.members.set(guest, {
    roles: [],
    joinedAt: "",
    permissions: "0",
    bot: false,
    flags: "16",
  });
  let service = new LifecycleService(db, vault, settings, discord),
    sequence = 0;
  const send = async (t: string, d: Record<string, unknown>, at = now) => {
    const events = normalizeMany(
      { t, s: ++sequence, d: { guild_id: s.guildId, ...d } },
      0,
      "adaptive",
      vault,
      at,
    );
    for (const e of events) await service.process(e);
    return events;
  };
  await send("GUILD_UPDATE", { id: s.guildId, afk_channel_id: afk });
  for (const [id, type] of [
    [channel, 15],
    [voice, 2],
    [stage, 13],
    [afk, 2],
  ] as const)
    await send("CHANNEL_CREATE", { id, type });
  for (const id of [user, other])
    await send("GUILD_MEMBER_ADD", {
      user: { id, bot: false },
      joined_at: new Date(now.getTime() - 3600000).toISOString(),
      roles: [],
      flags: 0,
      pending: false,
    });
  return {
    s,
    settings,
    discord,
    now,
    send,
    restart: () => {
      service = new LifecycleService(db, vault, settings, discord);
    },
    cfg: await settings.get(s),
  };
}
const messageData = (author = user, id = message, channelId = channel) => ({
  id,
  channel_id: channelId,
  author: { id: author },
  timestamp: new Date(Date.now() - 3600000).toISOString(),
  type: 0,
  content: "TOP SECRET CONTENT",
});
it("tracks active reaction edges, unique humans, self/bot exclusion and all removal forms", async () => {
  const f = await fixture();
  await f.send("MESSAGE_CREATE", messageData());
  const data = {
    user_id: other,
    message_id: message,
    channel_id: channel,
    message_author_id: user,
    emoji: { id: null, name: "hidden" },
    member: { user: { bot: false } },
  };
  const [e] = await f.send("MESSAGE_REACTION_ADD", data);
  await new LifecycleService(db, vault, f.settings, f.discord).process(e!);
  await f.send("MESSAGE_REACTION_ADD", { ...data, user_id: user });
  await f.send("MESSAGE_REACTION_ADD", {
    ...data,
    member: { user: { bot: true } },
  });
  expect(
    (
      await sql`SELECT * FROM adaptive_states WHERE ${tenant(f.s)} AND domain='reaction' AND data->>'active'='true'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  await f.send("MESSAGE_REACTION_REMOVE", data);
  await f.send("MESSAGE_REACTION_ADD", data);
  await f.send("MESSAGE_REACTION_REMOVE_EMOJI", data);
  expect(
    (
      await sql`SELECT * FROM adaptive_states WHERE ${tenant(f.s)} AND domain='reaction' AND data->>'active'='true'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  await f.send("MESSAGE_REACTION_ADD", data);
  await f.send("MESSAGE_REACTION_REMOVE_ALL", {
    message_id: message,
    channel_id: channel,
  });
  expect(
    (
      await sql`SELECT * FROM adaptive_states WHERE ${tenant(f.s)} AND domain='reaction' AND data->>'active'='true'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (
      await sql`SELECT * FROM member_interaction_pairs WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  expect(dedupeKey(e!)).not.toContain("hidden");
});
it("keeps one poll participation after multiple answers, removal and re-add", async () => {
  const f = await fixture(),
    data = { user_id: user, message_id: message, channel_id: channel };
  await f.send("MESSAGE_POLL_VOTE_ADD", { ...data, answer_id: 1 });
  await f.send("MESSAGE_POLL_VOTE_ADD", { ...data, answer_id: 2 });
  await f.send("MESSAGE_POLL_VOTE_REMOVE", { ...data, answer_id: 1 });
  const row = (
    await sql<{
      data: { answers: string[]; active: boolean };
    }>`SELECT data FROM adaptive_states WHERE ${tenant(f.s)} AND domain='poll'`.execute(
      db,
    )
  ).rows[0]!;
  expect(row.data.answers).toHaveLength(1);
  expect(row.data.active).toBe(true);
  await f.send("MESSAGE_POLL_VOTE_REMOVE", { ...data, answer_id: 2 });
  await f.send("MESSAGE_POLL_VOTE_ADD", { ...data, answer_id: 2 });
  expect(
    (
      await sql`SELECT * FROM adaptive_facts WHERE ${tenant(f.s)} AND kind='poll.participated'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
});
it("restores parent/surface mapping, measures a first human forum response and requires mapped resolution", async () => {
  const f = await fixture();
  await f.send("THREAD_CREATE", {
    id: thread,
    type: 11,
    parent_id: channel,
    owner_id: user,
    thread_metadata: {
      archived: false,
      locked: false,
      create_timestamp: f.now.toISOString(),
    },
    applied_tags: [],
  });
  await f.send("MESSAGE_CREATE", messageData(user, message, thread));
  f.restart();
  const at = new Date(f.now.getTime() + 60000);
  await f.send(
    "MESSAGE_CREATE",
    {
      ...messageData(other, "444444444444444445", thread),
      timestamp: at.toISOString(),
    },
    at,
  );
  await f.send(
    "MESSAGE_CREATE",
    {
      ...messageData(other, "444444444444444446", thread),
      timestamp: at.toISOString(),
    },
    at,
  );
  const replies = (
    await sql<{
      data: Record<string, unknown>;
    }>`SELECT data FROM adaptive_facts WHERE ${tenant(f.s)} AND kind='thread.response_received'`.execute(
      db,
    )
  ).rows;
  expect(replies).toHaveLength(1);
  expect(replies[0]?.data).toMatchObject({
    surface: "FORUM_POST",
    purpose: "SUPPORT",
    latencySeconds: 60,
  });
  await f.send(
    "THREAD_UPDATE",
    {
      id: thread,
      type: 11,
      parent_id: channel,
      owner_id: user,
      thread_metadata: { archived: true, locked: true },
      applied_tags: [],
    },
    at,
  );
  expect(
    (
      await sql<{
        data: { resolved: boolean };
      }>`SELECT data FROM adaptive_facts WHERE ${tenant(f.s)} AND kind='thread.updated'`.execute(
        db,
      )
    ).rows.at(-1)?.data.resolved,
  ).toBe(false);
  await f.send(
    "THREAD_UPDATE",
    {
      id: thread,
      type: 11,
      parent_id: channel,
      owner_id: user,
      thread_metadata: { archived: true, locked: true },
      applied_tags: [tag],
    },
    at,
  );
  expect(
    (
      await sql<{
        data: { resolved: boolean };
      }>`SELECT data FROM adaptive_facts WHERE ${tenant(f.s)} AND kind='thread.updated'`.execute(
        db,
      )
    ).rows.at(-1)?.data.resolved,
  ).toBe(true);
});
it("starts engagement after Screening and observes all onboarding/guide flags without completion gating", async () => {
  const f = await fixture(),
    id = "222222222222222225";
  await f.send("GUILD_MEMBER_ADD", {
    user: { id, bot: false },
    joined_at: f.now.toISOString(),
    roles: [],
    flags: 8,
    pending: true,
  });
  await f.send("MESSAGE_CREATE", {
    ...messageData(id, "444444444444444447"),
    timestamp: f.now.toISOString(),
  });
  expect(
    (
      await sql`SELECT * FROM lifecycle_events l JOIN membership_episodes e ON e.organization_id=l.organization_id AND e.guild_id=l.guild_id AND e.id=l.episode_id WHERE l.organization_id=${f.s.organizationId}::uuid AND l.guild_id=${f.s.guildId} AND e.screening_pending AND l.kind='message.sent'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  const cleared = new Date(f.now.getTime() + 60000);
  await f.send(
    "GUILD_MEMBER_UPDATE",
    { user: { id }, roles: [], flags: 8, pending: false },
    cleared,
  );
  await f.send(
    "GUILD_MEMBER_UPDATE",
    { user: { id }, roles: [], flags: 106, pending: false },
    cleared,
  );
  const episode = (
    await sql<{
      engagement_started_at: Date;
      screening_pending: boolean;
    }>`SELECT engagement_started_at,screening_pending FROM membership_episodes WHERE ${tenant(f.s)} AND joined_at=${f.now}`.execute(
      db,
    )
  ).rows[0]!;
  expect(episode.engagement_started_at.toISOString()).toBe(
    cleared.toISOString(),
  );
  expect(episode.screening_pending).toBe(false);
  expect(
    (
      await sql`SELECT kind FROM adaptive_facts WHERE ${tenant(f.s)} AND kind IN ('native_onboarding.started','native_onboarding.completed','server_guide.started','server_guide.completed','screening.passed')`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(5);
});
it("qualifies sustained human voice co-presence without pairs, excludes AFK/guests/bots and separates Stage", async () => {
  const f = await fixture(),
    data = (id: string, ch: string | null, extra = {}) => ({
      user_id: id,
      channel_id: ch,
      member: { user: { bot: false } },
      ...extra,
    });
  await f.send("VOICE_STATE_UPDATE", data(user, voice));
  await f.send("VOICE_STATE_UPDATE", data(other, voice));
  await f.send(
    "VOICE_STATE_UPDATE",
    data(guest, voice, {
      member: { flags: 16, joined_at: null, user: { bot: false } },
    }),
  );
  await f.send(
    "VOICE_STATE_UPDATE",
    data("222222222222222226", voice, { member: { user: { bot: true } } }),
  );
  expect(
    (
      await sql`SELECT * FROM adaptive_facts WHERE ${tenant(f.s)} AND kind='voice.copresence'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  await db
    .transaction()
    .execute((tx) =>
      tickVoice(tx, f.s, f.cfg, new Date(f.now.getTime() + 301000)),
    );
  expect(
    (
      await sql`SELECT * FROM adaptive_facts WHERE ${tenant(f.s)} AND kind='voice.copresence'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(2);
  expect(
    (
      await sql`SELECT * FROM member_interaction_pairs WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  await f.send(
    "VOICE_STATE_UPDATE",
    data(user, afk),
    new Date(f.now.getTime() + 600000),
  );
  await f.send(
    "VOICE_STATE_UPDATE",
    data(other, stage, { suppress: true }),
    new Date(f.now.getTime() + 600000),
  );
  expect(
    (
      await sql`SELECT * FROM adaptive_facts WHERE ${tenant(f.s)} AND kind='stage.audience_joined'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await sql`SELECT * FROM membership_episodes WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(2);
});
it("separates event subscription from known-active Voice/Stage attendance and external unknown", async () => {
  const f = await fixture();
  await f.send("GUILD_SCHEDULED_EVENT_USER_ADD", {
    user_id: user,
    guild_scheduled_event_id: event,
  });
  await f.send("VOICE_STATE_UPDATE", {
    user_id: user,
    channel_id: stage,
    suppress: true,
    member: { user: { bot: false } },
  });
  await f.send("GUILD_SCHEDULED_EVENT_UPDATE", {
    id: event,
    channel_id: stage,
    entity_type: 1,
    status: 1,
  });
  expect(
    (
      await sql`SELECT * FROM adaptive_facts WHERE ${tenant(f.s)} AND kind='scheduled_event.attended'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
  await f.send("GUILD_SCHEDULED_EVENT_UPDATE", {
    id: event,
    channel_id: stage,
    entity_type: 1,
    status: 2,
  });
  await f.send("GUILD_SCHEDULED_EVENT_UPDATE", {
    id: "777777777777777778",
    channel_id: null,
    entity_type: 3,
    status: 2,
  });
  expect(
    (
      await sql`SELECT * FROM adaptive_facts WHERE ${tenant(f.s)} AND kind='scheduled_event.attended'`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
});
it("persists partial capability detection, manual refresh and truthful adaptive definitions without content", async () => {
  const f = await fixture();
  f.discord.capabilityState = async () => ({
    features: [],
    memberCount: 3,
    afkChannelId: afk,
    incidents: {},
    channels: [
      {
        id: channel,
        type: 15,
        parentId: null,
        observable: false,
        tagIds: [tag],
      },
    ],
    threads: [],
    onboarding: null,
    endpointStatus: {
      channels: "AVAILABLE",
      threads: "PERMISSION_MISSING",
      onboarding: "UNAVAILABLE",
      autoMod: "PERMISSION_MISSING",
      events: "AVAILABLE",
    },
    ruleCount: null,
    welcomeCount: null,
    scheduledEvents: [],
  });
  await requestCapabilityRefresh(db, f.s, "manual");
  const worker = new DiscoveryWorker(db, f.discord, vault);
  for (let i = 0; i < 10 && !(await latestCapability(db, f.s)); i++)
    await worker.tick();
  expect((await latestCapability(db, f.s))?.coverage.ratio).toBe(0);
  const view = await new CommunityService(db).overview(f.s);
  expect(view.adaptive?.volume).toBe("LOW_VOLUME");
  expect(view.adaptive?.metrics.some((m) => m.key === "voiceCopresence")).toBe(
    false,
  );
  expect(
    view.adaptive?.metrics.every((m) => m.definition && m.state === "PARTIAL"),
  ).toBe(true);
  const encoded = JSON.stringify(
    (
      await sql`SELECT data FROM adaptive_facts WHERE ${tenant(f.s)}`.execute(
        db,
      )
    ).rows,
  );
  expect(encoded).not.toContain("TOP SECRET");
});
it("removes new member hashes, target edges, durable payloads, guild snapshots and retention details", async () => {
  const f = await fixture();
  await f.send("MESSAGE_POLL_VOTE_ADD", {
    user_id: user,
    message_id: message,
    channel_id: channel,
    answer_id: 1,
  });
  await f.send("MESSAGE_REACTION_ADD", {
    user_id: other,
    message_id: message,
    channel_id: channel,
    message_author_id: user,
    emoji: { id: null, name: "hidden" },
  });
  const privacy = new PrivacyService(db, vault, f.settings),
    hash = vault.hash(f.s, user);
  await privacy.delete(f.s, user, { ...actor, key: hash });
  for (const table of ["adaptive_states", "adaptive_facts"])
    expect(
      (
        await sql`SELECT * FROM ${sql.table(table)} WHERE ${tenant(f.s)} AND (subject_hash=${hash} OR target_hash=${hash})`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
  await privacy.delete(
    f.s,
    other,
    { ...actor, key: vault.hash(f.s, other) },
    true,
  );
  for (const table of [
    "adaptive_states",
    "adaptive_facts",
    "discord_surface_state",
    "guild_capability_snapshots",
    "capability_refresh_jobs",
  ])
    expect(
      (
        await sql`SELECT * FROM ${sql.table(table)} WHERE ${tenant(f.s)}`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(0);
});
