import { afterEach, expect, it, vi } from "vitest";
import { AllowedMentionsTypes } from "discord-api-types/v10";
import {
  DiscordFailure,
  DiscordRest,
  DiscordWriteNotStartedError,
  isDiscordWriteNotStartedError,
} from "../../packages/discord/src/rest";
import { DomainError } from "../../packages/shared/src/index";

const bot = "822222222222222222",
  channel = "844444444444444444",
  message = "877777777777777777",
  nonce = "12345678-1234-5678-abcd-123456789012";
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each([null, "833333333333333333"])(
  "reads the guild's current system channel without inventing a destination: %s",
  async (systemChannelId) => {
    const guildId = "811111111111111111",
      fetcher = vi.fn(async (_url: unknown) =>
        response({ id: guildId, system_channel_id: systemChannelId }),
      );
    vi.stubGlobal("fetch", fetcher);
    expect(
      await new DiscordRest("synthetic-token", bot).installationSystemChannel(
        guildId,
      ),
    ).toBe(systemChannelId);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `https://discord.com/api/v10/guilds/${guildId}`,
    );
  },
);

it.each([
  {},
  { id: "invalid", system_channel_id: channel },
  { id: "811111111111111111", system_channel_id: "invalid" },
])(
  "rejects incomplete or mismatched installation destination metadata",
  async (data) => {
    const fetcher = vi.fn(async () => response(data));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      new DiscordRest("synthetic-token", bot).installationSystemChannel(
        "811111111111111111",
      ),
    ).rejects.toMatchObject({
      code: "INSTALL_NOTICE_SYSTEM_CHANNEL_UNVERIFIED",
    });
  },
);

it("rejects a forged guild reference before fetching installation metadata", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    new DiscordRest("synthetic-token", bot).installationSystemChannel(
      "../channels",
    ),
  ).rejects.toMatchObject({ code: "INVALID_INSTALL_NOTICE_GUILD" });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["network", "server", "rateLimit"])(
  "never retries an installation notice after a %s failure",
  async (failure) => {
    const fetcher = vi.fn(async () => {
      if (failure === "network")
        throw new TypeError("Synthetic disconnected request");
      return failure === "server"
        ? response({}, 503)
        : response({ retry_after: 0 }, 429);
    });
    vi.stubGlobal("fetch", fetcher);
    const before = vi.fn(async () => {});
    const error = await new DiscordRest("synthetic-token", bot)
      .sendInstallNotice(channel, { content: "Setup" }, nonce, before)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(DiscordFailure);
    expect(error).toMatchObject({
      status: failure === "network" ? 0 : failure === "server" ? 503 : 429,
    });
    expect(isDiscordWriteNotStartedError(error)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(before).toHaveBeenCalledTimes(1);
  },
);

it.each([
  "malformedJSON",
  "missing",
  "null",
  "numeric",
  "short",
  "long",
  "nondecimal",
])(
  "keeps a successful HTTP response with %s message reference ambiguous",
  async (failure) => {
    const data: Record<string, unknown> = {
      missing: {},
      null: null,
      numeric: { id: 12345 },
      short: { id: "7".repeat(16) },
      long: { id: "7".repeat(21) },
      nondecimal: { id: "../../messages/123" },
    };
    const fetcher = vi.fn(async () =>
      failure === "malformedJSON"
        ? new Response("{", { status: 200 })
        : response(data[failure]),
    );
    vi.stubGlobal("fetch", fetcher);
    const error = await new DiscordRest("synthetic-token", bot)
      .sendInstallNotice(channel, { content: "Setup" }, nonce)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(DiscordFailure);
    expect(error).toMatchObject({ status: 200 });
    expect(isDiscordWriteNotStartedError(error)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it.each([17, 18, 19, 20])(
  "accepts %i digit channel and returned message identifiers",
  async (digits) => {
    const channelId = "4".repeat(digits),
      messageId = "7".repeat(digits);
    const fetcher = vi.fn(async (_url: unknown) => response({ id: messageId }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      await new DiscordRest("synthetic-token", bot).sendInstallNotice(
        channelId,
        { content: "Setup" },
        nonce,
      ),
    ).toBe(messageId);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
    );
  },
);

it("overrides mentions and nonce fields and keeps the same normalized nonce across caller attempts", async () => {
  const payloads: Record<string, unknown>[] = [];
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.method).toBe("POST");
    payloads.push(JSON.parse(String(init?.body)));
    return response({ id: message });
  });
  vi.stubGlobal("fetch", fetcher);
  const rest = new DiscordRest("synthetic-token", bot);
  for (let attempt = 0; attempt < 2; attempt++)
    await rest.sendInstallNotice(
      channel,
      {
        content: "@everyone <@833333333333333333>",
        allowed_mentions: {
          parse: [
            AllowedMentionsTypes.Everyone,
            AllowedMentionsTypes.User,
            AllowedMentionsTypes.Role,
          ],
        },
        nonce: "caller-body-must-not-win",
        enforce_nonce: false,
      },
      nonce,
    );
  expect(payloads).toHaveLength(2);
  for (const body of payloads) {
    expect(body.allowed_mentions).toEqual({ parse: [], replied_user: false });
    expect(body.nonce).toBe("1234567812345678abcd12345");
    expect(String(body.nonce)).toHaveLength(25);
    expect(body.enforce_nonce).toBe(true);
    expect(body.content).toBe("@everyone <@833333333333333333>");
  }
});

it("runs the immediate dispatch guard before the single request", async () => {
  const order: string[] = [];
  const fetcher = vi.fn(async () => {
    order.push("fetch");
    return response({ id: message });
  });
  vi.stubGlobal("fetch", fetcher);
  const before = vi.fn(async () => {
    order.push("guard");
  });
  await new DiscordRest("synthetic-token", bot).sendInstallNotice(
    channel,
    { content: "Setup" },
    nonce,
    before,
  );
  expect(order).toEqual(["guard", "fetch"]);
  expect(before).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["domain", "ordinary", "branded"])(
  "brands a %s guard rejection as a write that never started",
  async (failure) => {
    const rejected =
      failure === "domain"
        ? new DomainError("INSTALL_NOTICE_REVOKED", 403)
        : failure === "branded"
          ? new DiscordWriteNotStartedError("INSTALL_NOTICE_EXPIRED")
          : new Error("Synthetic sensitive detail must not be retained");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const before = vi.fn(async () => {
      throw rejected;
    });
    const error = await new DiscordRest("synthetic-token", bot)
      .sendInstallNotice(channel, { content: "Setup" }, nonce, before)
      .catch((value: unknown) => value);
    expect(isDiscordWriteNotStartedError(error)).toBe(true);
    expect(error).toMatchObject({
      code:
        failure === "domain"
          ? "INSTALL_NOTICE_REVOKED"
          : failure === "branded"
            ? "INSTALL_NOTICE_EXPIRED"
            : "INSTALL_NOTICE_UNVERIFIED",
    });
    if (failure === "branded") expect(error).toBe(rejected);
    expect(String(error)).not.toContain("sensitive detail");
    expect(before).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(0);
  },
);

it("rejects malformed channel identifiers before checking or dispatching", async () => {
  const fetcher = vi.fn(),
    before = vi.fn(async () => {}),
    rest = new DiscordRest("synthetic-token", bot);
  vi.stubGlobal("fetch", fetcher);
  for (const channelId of [
    "4".repeat(16),
    "4".repeat(21),
    "../users/@me",
    `${channel}?other=1`,
    "a".repeat(18),
  ])
    await expect(
      rest.sendInstallNotice(channelId, { content: "Setup" }, nonce, before),
    ).rejects.toMatchObject({ code: "INVALID_INSTALL_NOTICE_TARGET" });
  expect(before).toHaveBeenCalledTimes(0);
  expect(fetcher).toHaveBeenCalledTimes(0);
});

it("rejects empty or oversized nonce values before checking or dispatching", async () => {
  const fetcher = vi.fn(),
    before = vi.fn(async () => {}),
    rest = new DiscordRest("synthetic-token", bot);
  vi.stubGlobal("fetch", fetcher);
  for (const invalid of ["", "a".repeat(129)])
    await expect(
      rest.sendInstallNotice(channel, { content: "Setup" }, invalid, before),
    ).rejects.toMatchObject({ code: "INVALID_INSTALL_NOTICE_NONCE" });
  expect(before).toHaveBeenCalledTimes(0);
  expect(fetcher).toHaveBeenCalledTimes(0);
});
