import { afterEach, expect, it, vi } from "vitest";
import { PermissionFlagsBits as P } from "discord-api-types/v10";
import {
  DiscordRest,
  DiscordWriteNotStartedError,
  isDiscordWriteNotStartedError,
  type AutomationDiscordWrite,
  type Member,
} from "../../packages/discord/src/rest";
import { DomainError } from "../../packages/shared/src/index";
const guild = "811111111111111111",
  bot = "822222222222222222",
  actor = "833333333333333333",
  channel = "844444444444444444",
  role = "855555555555555555",
  message = "877777777777777777";
const write: AutomationDiscordWrite = {
  kind: "message",
  guildId: guild,
  channelId: channel,
  content: "A safe notice",
  nonce: "a".repeat(64),
};
const response = (
  data: unknown,
  status = 200,
  headers?: Record<string, string>,
) => new Response(JSON.stringify(data), { status, headers });
const member = (
  permissions: bigint,
  isBot = false,
  roles: string[] = [],
): Member => ({
  permissions: String(permissions),
  bot: isBot,
  roles,
  joinedAt: "2026-01-01T00:00:00Z",
  ownerId: "899999999999999999",
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([
  write,
  { kind: "role", guildId: guild, memberId: actor, roleId: role, add: true },
  { kind: "role", guildId: guild, memberId: actor, roleId: role, add: false },
  { kind: "thread", guildId: guild, channelId: channel, name: "request" },
] satisfies AutomationDiscordWrite[])(
  "does not retry an ambiguous network or server write: $kind",
  async (input) => {
    for (const network of [true, false]) {
      const fetcher = vi.fn();
      if (network)
        fetcher.mockRejectedValue(
          new TypeError("Synthetic disconnected request"),
        );
      else fetcher.mockResolvedValue(response({}, 503));
      vi.stubGlobal("fetch", fetcher);
      const before = vi.fn(async () => {});
      await expect(
        new DiscordRest("synthetic-token", bot).automationWrite(input, before),
      ).rejects.toMatchObject({ status: network ? 0 : 503 });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(before).toHaveBeenCalledTimes(1);
    }
  },
);
it("rechecks authorization before each definite 429 retry and never interprets text as mentions", async () => {
  const order: string[] = [],
    before = vi.fn(async () => {
      order.push("check");
    });
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    order.push("write");
    const body = JSON.parse(String(init?.body));
    expect(body.allowed_mentions).toEqual({ parse: [], replied_user: false });
    expect(body.nonce).toHaveLength(25);
    return fetcher.mock.calls.length === 1
      ? response({ retry_after: 0 }, 429, { "x-ratelimit-bucket": "synthetic" })
      : response({ id: message });
  });
  vi.stubGlobal("fetch", fetcher);
  expect(
    await new DiscordRest("synthetic-token", bot).automationWrite(
      { ...write, content: "@everyone" },
      before,
    ),
  ).toBe(message);
  expect(order).toEqual(["check", "write", "check", "write"]);
});
it("stops a confirmed rate-limit retry when current authorization fails", async () => {
  const fetcher = vi.fn(async () => response({ retry_after: 0 }, 429));
  vi.stubGlobal("fetch", fetcher);
  const before = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new DomainError("AUTOMATION_STOPPED", 403));
  await expect(
    new DiscordRest("synthetic-token", bot).automationWrite(write, before),
  ).rejects.toMatchObject({ code: "AUTOMATION_STOPPED" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(before).toHaveBeenCalledTimes(2);
});
it("does not dispatch when the immediate preflight fails", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    new DiscordRest("synthetic-token", bot).automationWrite(write, async () => {
      throw new DomainError("ADMIN_REQUIRED", 403);
    }),
  ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
  expect(fetcher).toHaveBeenCalledTimes(0);
});
it("does not retry malformed success JSON or a success response without its object reference", async () => {
  const fetcher = vi.fn(async () => new Response("{", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(
    new DiscordRest("synthetic-token", bot).automationWrite(
      write,
      async () => {},
    ),
  ).rejects.toMatchObject({ status: 200 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockReset().mockResolvedValue(response({}));
  await expect(
    new DiscordRest("synthetic-token", bot).automationWrite(
      write,
      async () => {},
    ),
  ).rejects.toMatchObject({ code: "AUTOMATION_RESULT_INVALID" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rejects forged route identifiers and oversized values before fetching", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const rest = new DiscordRest("synthetic-token", bot),
    before = vi.fn(async () => {});
  for (const input of [
    { ...write, channelId: "../users/@me" },
    { ...write, guildId: "invalid" },
    { ...write, content: "x".repeat(2001) },
    {
      kind: "role" as const,
      guildId: guild,
      memberId: "../members",
      roleId: role,
      add: true,
    },
    { kind: "thread" as const, guildId: guild, channelId: channel, name: " " },
  ])
    await expect(rest.automationWrite(input, before)).rejects.toThrow();
  expect(before).toHaveBeenCalledTimes(0);
  expect(fetcher).toHaveBeenCalledTimes(0);
});

function preflightFixture(overwrites: unknown[] = [], channelType = 0) {
  const rest = new DiscordRest("synthetic-token", bot);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      response({
        guild_id: guild,
        type: channelType,
        permission_overwrites: overwrites,
      }),
    ),
  );
  const members = vi
    .spyOn(rest, "member")
    .mockImplementation(async (_guild, id) =>
      member(
        id === bot
          ? P.ViewChannel |
              P.SendMessages |
              P.CreatePublicThreads |
              P.ManageChannels
          : P.ViewChannel,
        id === bot,
      ),
    );
  return { rest, members };
}
it("checks channel guild, type and both current actor and Bot channel permissions", async () => {
  let f = preflightFixture([
    { id: bot, type: 1, allow: "0", deny: String(P.SendMessages) },
  ]);
  await expect(
    f.rest.automationPreflight(guild, actor, "message", channel),
  ).rejects.toMatchObject({ code: "AUTOMATION_BOT_PERMISSION" });
  f = preflightFixture([
    { id: actor, type: 1, allow: "0", deny: String(P.ViewChannel) },
  ]);
  await expect(
    f.rest.automationPreflight(guild, actor, "message", channel),
  ).rejects.toMatchObject({ code: "AUTOMATION_TARGET_PERMISSION" });
  f = preflightFixture([], 4);
  await expect(
    f.rest.automationPreflight(guild, actor, "channel", channel),
  ).rejects.toMatchObject({ code: "AUTOMATION_TARGET_PERMISSION" });
  f = preflightFixture([], 15);
  await expect(
    f.rest.automationPreflight(guild, actor, "message", channel),
  ).rejects.toMatchObject({ code: "AUTOMATION_CHANNEL_TYPE" });
  expect(f.members).toHaveBeenCalledTimes(0);
  f = preflightFixture();
  await expect(
    f.rest.automationPreflight("800000000000000000", actor, "message", channel),
  ).rejects.toMatchObject({ code: "AUTOMATION_TARGET_GUILD" });
  expect(f.members).toHaveBeenCalledTimes(0);
});
it("applies role overwrite aggregation before member overwrite and respects an existing Administrator", async () => {
  const staff = "888888888888888888";
  let f = preflightFixture([
    { id: guild, type: 0, allow: "0", deny: String(P.SendMessages) },
    { id: staff, type: 0, allow: String(P.SendMessages), deny: "0" },
  ]);
  f.members.mockImplementation(async (_guild, id) =>
    member(
      id === bot ? P.ViewChannel | P.SendMessages : P.ViewChannel,
      id === bot,
      id === bot ? [staff] : [],
    ),
  );
  await expect(
    f.rest.automationPreflight(guild, actor, "message", channel),
  ).resolves.toBeUndefined();
  f = preflightFixture([
    {
      id: bot,
      type: 1,
      allow: "0",
      deny: String(P.ViewChannel | P.SendMessages),
    },
  ]);
  f.members.mockImplementation(async (_guild, id) =>
    member(id === bot ? P.Administrator : P.ViewChannel, id === bot),
  );
  await expect(
    f.rest.automationPreflight(guild, actor, "message", channel),
  ).resolves.toBeUndefined();
});
it("does not treat missing permission metadata as an empty successful overwrite list", async () => {
  const rest = new DiscordRest("synthetic-token", bot);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response({ guild_id: guild, type: 0 })),
  );
  const members = vi
    .spyOn(rest, "member")
    .mockResolvedValue(member(P.Administrator));
  await expect(
    rest.automationPreflight(guild, actor, "message", channel),
  ).rejects.toMatchObject({ code: "AUTOMATION_PERMISSIONS_UNVERIFIED" });
  expect(members).toHaveBeenCalledTimes(0);
});

const channelWrite: AutomationDiscordWrite = {
  kind: "channel",
  guildId: guild,
  parentId: channel,
  name: "private-requests",
};
const privateCategory = () => ({
  id: channel,
  guild_id: guild,
  type: 4,
  nsfw: true,
  permission_overwrites: [
    { id: guild, type: 0, allow: "0", deny: String(P.ViewChannel) },
    {
      id: role,
      type: 0,
      allow: String(P.ViewChannel | P.SendMessages),
      deny: "0",
    },
  ],
});
function categoryWriteFixture() {
  const rest = new DiscordRest("synthetic-token", bot);
  let category: unknown = privateCategory();
  const posted: Record<string, unknown>[] = [];
  const send = vi.fn(async () => response({ id: message }));
  const fetcher = vi.fn(
    async (url: unknown, init?: RequestInit): Promise<Response> => {
      if (
        String(url) === `https://discord.com/api/v10/channels/${channel}` &&
        init?.method === "GET"
      )
        return response(category);
      if (
        String(url) ===
          `https://discord.com/api/v10/guilds/${guild}/channels` &&
        init?.method === "POST"
      ) {
        posted.push(JSON.parse(String(init.body)));
        return send();
      }
      throw new Error("Unexpected synthetic route");
    },
  );
  vi.stubGlobal("fetch", fetcher);
  const members = vi
    .spyOn(rest, "member")
    .mockImplementation(async (_guild, id) =>
      member(
        id === bot
          ? P.ViewChannel | P.SendMessages | P.ManageChannels | P.ManageRoles
          : P.ViewChannel | P.ManageChannels,
        id === bot,
        [role],
      ),
    );
  const before = vi.fn(async () =>
    rest.automationPreflight(guild, actor, "channel", channel),
  );
  return {
    rest,
    posted,
    send,
    fetcher,
    members,
    before,
    setCategory(value: unknown) {
      category = value;
    },
  };
}
it("copies a private category's exact current overwrites and age restriction before creating its child", async () => {
  const f = categoryWriteFixture();
  expect(await f.rest.automationWrite(channelWrite, f.before)).toBe(message);
  expect(f.posted).toEqual([
    {
      name: "private-requests",
      type: 0,
      parent_id: channel,
      permission_overwrites: privateCategory().permission_overwrites,
      nsfw: true,
    },
  ]);
  expect(f.before).toHaveBeenCalledTimes(1);
  expect(f.members.mock.calls.filter(([, id]) => id === actor)).toHaveLength(1);
  // Root's current authorization check and the transport's native copy check are distinct.
  expect(f.members.mock.calls.filter(([, id]) => id === bot)).toHaveLength(2);
});
it("sends an explicit empty overwrite array for a verified unrestricted category", async () => {
  const f = categoryWriteFixture();
  f.setCategory({
    id: channel,
    guild_id: guild,
    type: 4,
    permission_overwrites: [],
  });
  await f.rest.automationWrite(channelWrite, f.before);
  expect(f.posted[0]?.permission_overwrites).toEqual([]);
  expect(f.posted[0]).not.toHaveProperty("nsfw");
});
it("refuses caller-provided permissions or age restriction before reading or writing Discord", async () => {
  const f = categoryWriteFixture();
  for (const extra of [
    { permission_overwrites: [] },
    { nsfw: false },
    { type: 0 },
    { parent_id: role },
  ]) {
    await expect(
      f.rest.automationWrite({ ...channelWrite, ...extra }, f.before),
    ).rejects.toThrow();
  }
  expect(f.fetcher).not.toHaveBeenCalled();
});
it.each([
  { id: channel, guild_id: guild, type: 4 },
  { ...privateCategory(), guild_id: role },
  { ...privateCategory(), id: role },
  { ...privateCategory(), type: 0 },
  { ...privateCategory(), nsfw: "false" },
  {
    ...privateCategory(),
    permission_overwrites: [{ id: guild, type: 0, deny: "1024" }],
  },
  {
    ...privateCategory(),
    permission_overwrites: [{ id: guild, type: 0, allow: "-1", deny: "0" }],
  },
  {
    ...privateCategory(),
    permission_overwrites: [
      { id: guild, type: 0, allow: "1024", deny: "1024" },
    ],
  },
  {
    ...privateCategory(),
    permission_overwrites: [
      privateCategory().permission_overwrites[0],
      privateCategory().permission_overwrites[0],
    ],
  },
])(
  "never creates a channel with unverified parent metadata %#",
  async (category) => {
    const f = categoryWriteFixture();
    f.setCategory(category);
    await expect(
      f.rest.automationWrite(channelWrite, f.before),
    ).rejects.toThrow();
    expect(f.posted).toHaveLength(0);
    expect(f.before).not.toHaveBeenCalled();
  },
);
it.each(["overwrites", "nsfw", "guild", "unreadable"])(
  "stops before POST if category policy changes during authorization: %s",
  async (change) => {
    const f = categoryWriteFixture();
    const before = vi.fn(async () => {
      await f.before();
      f.setCategory(
        change === "overwrites"
          ? { ...privateCategory(), permission_overwrites: [] }
          : change === "nsfw"
            ? { ...privateCategory(), nsfw: false }
            : change === "guild"
              ? { ...privateCategory(), guild_id: role }
              : { id: channel, guild_id: guild, type: 4 },
      );
    });
    const error = await f.rest
      .automationWrite(channelWrite, before)
      .catch((value: unknown) => value);
    expect(isDiscordWriteNotStartedError(error)).toBe(true);
    expect(error).toBeInstanceOf(DiscordWriteNotStartedError);
    expect(f.posted).toHaveLength(0);
  },
);
it("treats overwrite ordering as the same policy without changing copied permissions", async () => {
  const f = categoryWriteFixture();
  await f.rest.automationWrite(channelWrite, async () => {
    await f.before();
    f.setCategory({
      ...privateCategory(),
      permission_overwrites: privateCategory().permission_overwrites.reverse(),
    });
  });
  expect(f.posted[0]?.permission_overwrites).toEqual(
    privateCategory().permission_overwrites,
  );
});
it.each([
  [P.ViewChannel | P.SendMessages | P.ManageRoles, "AUTOMATION_BOT_PERMISSION"],
  [
    P.ViewChannel | P.SendMessages | P.ManageChannels,
    "AUTOMATION_BOT_PERMISSION",
  ],
  [
    P.ViewChannel | P.ManageChannels | P.ManageRoles,
    "AUTOMATION_PARENT_POLICY_UNCOPYABLE",
  ],
])(
  "requires fresh native Bot permissions to reproduce every overwrite (%s)",
  async (bits, code) => {
    const f = categoryWriteFixture();
    const error = await f.rest
      .automationWrite(channelWrite, async () => {
        await f.before();
        f.members.mockResolvedValue(member(bits as bigint, true, [role]));
      })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code });
    expect(isDiscordWriteNotStartedError(error)).toBe(true);
    expect(f.posted).toHaveLength(0);
  },
);
it("copies a ManageRoles overwrite only with a current guild Administrator", async () => {
  const f = categoryWriteFixture();
  f.setCategory({
    ...privateCategory(),
    permission_overwrites: [
      { id: guild, type: 0, allow: "0", deny: String(P.ManageRoles) },
    ],
  });
  let error = await f.rest
    .automationWrite(channelWrite, async () => {})
    .catch((value: unknown) => value);
  expect(error).toMatchObject({ code: "AUTOMATION_PARENT_POLICY_UNCOPYABLE" });
  expect(f.posted).toHaveLength(0);
  f.members.mockResolvedValue(member(P.Administrator, true));
  await f.rest.automationWrite(channelWrite, async () => {});
  expect(f.posted).toHaveLength(1);
  error = new DiscordWriteNotStartedError("Synthetic secret: abc");
  expect(error).toMatchObject({ code: "AUTOMATION_PARENT_POLICY_UNVERIFIED" });
});
it("preserves a denial by the current real actor and never posts", async () => {
  const f = categoryWriteFixture();
  f.members.mockImplementation(async (_guild, id) =>
    member(id === bot ? P.Administrator : P.ViewChannel, id === bot, [role]),
  );
  const error = await f.rest
    .automationWrite(channelWrite, f.before)
    .catch((value: unknown) => value);
  expect(error).toMatchObject({ code: "AUTOMATION_TARGET_PERMISSION" });
  expect(isDiscordWriteNotStartedError(error)).toBe(false);
  expect(f.posted).toHaveLength(0);
});
it("rechecks the category after a definite 429 and stops a changed policy before another POST", async () => {
  const f = categoryWriteFixture();
  f.send.mockImplementation(async () => {
    f.setCategory({ ...privateCategory(), permission_overwrites: [] });
    return response({ retry_after: 0 }, 429);
  });
  const error = await f.rest
    .automationWrite(channelWrite, f.before)
    .catch((value: unknown) => value);
  expect(error).toMatchObject({ code: "AUTOMATION_PARENT_POLICY_CHANGED" });
  expect(isDiscordWriteNotStartedError(error)).toBe(true);
  expect(f.posted).toHaveLength(1);
  expect(f.before).toHaveBeenCalledTimes(2);
});
it.each(["network", "server", "json", "reference"])(
  "never brands or retries an ambiguous channel POST result: %s",
  async (failure) => {
    const f = categoryWriteFixture();
    f.send.mockImplementation(async () => {
      if (failure === "network")
        throw new TypeError("Synthetic disconnected request");
      if (failure === "server") return response({}, 503);
      if (failure === "json") return new Response("{", { status: 200 });
      return response({});
    });
    const error = await f.rest
      .automationWrite(channelWrite, f.before)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect(isDiscordWriteNotStartedError(error)).toBe(false);
    expect(f.posted).toHaveLength(1);
    expect(f.before).toHaveBeenCalledTimes(1);
  },
);
