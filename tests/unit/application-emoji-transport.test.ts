import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RESTPostAPIChannelMessageJSONBody } from "discord-api-types/v10";
import { DiscordRest } from "../../packages/discord/src/rest";
import { fallbackRejectedApplicationEmoji } from "../../packages/discord/src/emoji-fallback";
import {
  nexusPanel,
  actionRow,
} from "../../packages/discord-panels/src/primitives";
import { workflowHome } from "../../packages/discord-panels/src/views/workflow-home";
import type { ControlData } from "../../packages/discord-panels/src/views/control";
import type { ApplicationEmojiConfig } from "../../packages/shared/src/application-emoji";

const fixture = vi.hoisted(() => ({
  applicationId: "222222222222222222",
  emojiId: "333333333333333333",
  historyId: "444444444444444444",
  mode: "custom" as "custom" | "unicode" | "text",
}));

const channelId = "555555555555555555";
const config = (): ApplicationEmojiConfig => ({
  mode: fixture.mode,
  applicationId: fixture.applicationId,
  emojis: {
    attention: { id: fixture.emojiId, name: "nx_attention", animated: false },
    history: { id: fixture.historyId, name: "nx_history", animated: false },
  },
});
const payload = (): RESTPostAPIChannelMessageJSONBody => ({
  content: "Private note <:nx_attention:333333333333333333>",
  embeds: [
    {
      description:
        "Do not rewrite user text <:nx_attention:333333333333333333>",
    },
  ],
  allowed_mentions: { parse: [] },
  flags: 64,
  components: [
    {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: "Attention",
          custom_id: "signed-existing-action",
          emoji: { id: fixture.emojiId, name: "nx_attention", animated: false },
        },
        {
          type: 2,
          style: 2,
          label: "History",
          disabled: true,
          custom_id: "signed-history",
          emoji: { id: fixture.historyId, name: "nx_history", animated: false },
        },
      ],
    },
  ],
});
const fieldError = {
  _errors: [
    {
      code: "BUTTON_COMPONENT_INVALID_EMOJI",
      message: "synthetic-private-response-never-log",
    },
  ],
};
const emojiError = () => ({
  code: 50035,
  message: "Invalid Form Body",
  errors: {
    components: { "0": { components: { "0": { emoji: fieldError } } } },
  },
});
const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });
type Captured = {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
  files: Buffer[];
};
async function capture(url: string, init: RequestInit): Promise<Captured> {
  const files: Buffer[] = [];
  let body: Record<string, unknown>;
  if (init.body instanceof FormData) {
    body = JSON.parse(String(init.body.get("payload_json")));
    for (const [key, value] of init.body.entries()) {
      if (key.startsWith("files[") && typeof value !== "string")
        files.push(Buffer.from(await value.arrayBuffer()));
    }
  } else body = JSON.parse(String(init.body));
  return {
    url,
    method: init.method!,
    headers: new Headers(init.headers),
    body,
    files,
  };
}
const button = (body: Record<string, unknown>, index = 0) =>
  (body.components as { components: Record<string, unknown>[] }[])[0]!
    .components[index]!;

beforeEach(() => {
  fixture.mode = "custom";
  vi.stubEnv("NEXUS_EMOJI_MODE", "custom");
  vi.stubEnv("DISCORD_APPLICATION_ID", fixture.applicationId);
  vi.stubEnv(
    "NEXUS_APPLICATION_EMOJIS",
    JSON.stringify({
      applicationId: fixture.applicationId,
      emojis: {
        attention: { id: fixture.emojiId, status: "confirmed" },
        history: { id: fixture.historyId, status: "confirmed" },
      },
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("precise structured emoji rejection", () => {
  it("clones only the rejected emoji field and preserves text, custom IDs, state, other emoji and source payload", () => {
    const original = payload(),
      before = structuredClone(original);
    const fallback = fallbackRejectedApplicationEmoji(
      original,
      emojiError(),
      config(),
    );
    expect(fallback).not.toBe(original);
    expect(fallback).toEqual({
      ...original,
      components: [
        {
          ...original.components![0],
          components: [
            {
              ...button(original as Record<string, unknown>),
              emoji: { name: "🔎" },
            },
            button(original as Record<string, unknown>, 1),
          ],
        },
      ],
    });
    expect(original).toEqual(before);
  });

  it("accepts id/name validation leaves on String Select options without changing values or neighboring options", () => {
    const body = {
      components: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "signed-select",
              options: [
                {
                  label: "Attention",
                  value: "unchanged-value",
                  description: "Short description",
                  emoji: {
                    id: fixture.emojiId,
                    name: "nx_attention",
                    animated: false,
                  },
                },
                { label: "Ordinary", value: "ordinary", emoji: { name: "🕘" } },
              ],
            },
          ],
        },
      ],
    };
    const errors = {
      code: 50035,
      errors: {
        components: {
          "0": {
            components: {
              "0": {
                options: {
                  "0": { emoji: { id: fieldError, name: fieldError } },
                },
              },
            },
          },
        },
      },
    };
    const fallback = fallbackRejectedApplicationEmoji(body, errors, config());
    expect(fallback?.components[0]?.components[0]?.options).toEqual([
      {
        ...body.components[0]!.components[0]!.options[0],
        emoji: { name: "🔎" },
      },
      body.components[0]!.components[0]!.options[1],
    ]);
  });

  it.each([
    [
      "mixed label error",
      () => ({
        code: 50035,
        errors: {
          components: {
            "0": {
              components: { "0": { emoji: fieldError, label: fieldError } },
            },
          },
        },
      }),
    ],
    ["wrong error code", () => ({ ...emojiError(), code: 10014 })],
    [
      "unstructured emoji message",
      () => ({ code: 50035, message: "Invalid emoji" }),
    ],
    ["top-level request error", () => ({ code: 50035, errors: fieldError })],
    [
      "body text error",
      () => ({ code: 50035, errors: { content: fieldError } }),
    ],
    ["empty error node", () => ({ code: 50035, errors: { components: {} } })],
    [
      "unknown emoji member",
      () => ({
        code: 50035,
        errors: {
          components: {
            "0": { components: { "0": { emoji: { unexpected: fieldError } } } },
          },
        },
      }),
    ],
  ])("does not retry %s", (_name, error) => {
    expect(
      fallbackRejectedApplicationEmoji(payload(), error(), config()),
    ).toBeNull();
  });

  it("does not rewrite unknown application IDs/names, animated emoji, unlabeled or premium buttons", () => {
    for (const change of [
      {
        emoji: {
          id: "999999999999999999",
          name: "nx_attention",
          animated: false,
        },
      },
      { emoji: { id: fixture.emojiId, name: "unrelated", animated: false } },
      { emoji: { id: fixture.emojiId, name: "nx_attention", animated: true } },
      { label: "" },
      { style: 6 },
    ]) {
      const body = payload() as Record<string, unknown>;
      Object.assign(button(body), change);
      expect(
        fallbackRejectedApplicationEmoji(body, emojiError(), config()),
      ).toBeNull();
    }
  });
});

describe("message transport fallback", () => {
  it.each(["reply", "followup"] as const)(
    "does not retry a %s webhook for a different application even when bot and config match",
    async (kind) => {
      const fetchMock = vi.fn(async () => response(400, emojiError()));
      vi.stubGlobal("fetch", fetchMock);
      const rest = new DiscordRest("synthetic-token", fixture.applicationId);
      const request =
        kind === "reply"
          ? rest.editReply("999999999999999999", "private", payload())
          : rest.followup("999999999999999999", "private", payload());
      await expect(request).rejects.toMatchObject({ status: 400 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("retries the actual V2 String Select payload after a precise option rejection", async () => {
    const source = nexusPanel({
      title: "Existing choices",
      rows: [
        {
          type: 1,
          components: [
            {
              type: 3,
              custom_id: "signed-existing-select",
              options: [
                {
                  label: "Attention",
                  value: "attention",
                  emoji: config().emojis.attention,
                },
                {
                  label: "History",
                  value: "history",
                  emoji: config().emojis.history,
                },
              ],
            },
          ],
        },
      ],
    });
    source.flags = Number(source.flags) | 64;
    const error = {
      code: 50035,
      errors: {
        components: {
          "0": {
            components: {
              "1": {
                components: {
                  "0": { options: { "0": { emoji: { id: fieldError } } } },
                },
              },
            },
          },
        },
      },
    };
    const calls: Captured[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(await capture(url, init));
        return calls.length === 1 ? response(400, error) : response(200, {});
      }),
    );
    await new DiscordRest("synthetic-token", fixture.applicationId).editReply(
      fixture.applicationId,
      "private",
      source,
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual(
      fallbackRejectedApplicationEmoji(calls[0]!.body, error, config()),
    );
    expect(calls[1]!.body.flags).toBe(32768 | 64);
  });

  it("does not retry a mixed V2 validation error or a body-only rejection", async () => {
    const source = await workflowHome(
      async () => "signed-once",
      {} as ControlData,
      "en",
    );
    for (const errors of [
      {
        components: {
          "0": {
            components: {
              "2": { accessory: { emoji: fieldError } },
              "1": { components: { "0": { content: fieldError } } },
            },
          },
        },
      },
      {
        components: {
          "0": {
            components: {
              "1": { components: { "0": { content: fieldError } } },
            },
          },
        },
      },
    ]) {
      const fetchMock = vi.fn(async () =>
        response(400, { code: 50035, errors }),
      );
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        new DiscordRest("synthetic-token", fixture.applicationId).editReply(
          fixture.applicationId,
          "private",
          source,
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("captures configuration before the request so environment changes cannot rewrite arbitrary later IDs", async () => {
    const calls: Captured[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(await capture(url, init));
        vi.stubEnv("NEXUS_APPLICATION_EMOJIS", "{}");
        return calls.length === 1
          ? response(400, emojiError())
          : response(200, {});
      }),
    );
    await new DiscordRest("synthetic-token", fixture.applicationId).followup(
      fixture.applicationId,
      "private",
      payload(),
    );
    expect(calls).toHaveLength(2);
    expect(button(calls[1]!.body).emoji).toEqual({ name: "🔎" });
  });

  it("keeps existing safe nonce transport retries unchanged after an uncertain result", async () => {
    const calls: Captured[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(await capture(url, init));
        if (calls.length === 1) throw new TypeError("unknown-outcome");
        return response(200, { id: "existing-nonce-protected-message" });
      }),
    );
    await new DiscordRest("synthetic-token", fixture.applicationId).sendPanel(
      channelId,
      payload(),
      "same-nonce",
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual(calls[0]!.body);
    expect(button(calls[1]!.body).emoji).toEqual(config().emojis.attention);
  });

  it("does not retry malformed HTTP 400 JSON", async () => {
    const fetchMock = vi.fn(
      async () => new Response("not-json", { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new DiscordRest("synthetic-token", fixture.applicationId).followup(
        fixture.applicationId,
        "private",
        payload(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back in an actual nexusPanel nested V2 ActionRow without changing component flags or text", async () => {
    const source = nexusPanel({
      title: "Existing panel",
      rows: [
        await actionRow(
          async () => "unchanged-signed-id",
          [
            {
              label: "Attention",
              action: "attention",
              emojiKey: "attention",
            },
          ],
        ),
      ],
    });
    const error = {
      code: 50035,
      errors: {
        components: {
          "0": {
            components: { "1": { components: { "0": { emoji: fieldError } } } },
          },
        },
      },
    };
    const fallback = fallbackRejectedApplicationEmoji(source, error, config());
    expect(fallback).not.toBeNull();
    expect(fallback?.flags).toBe(32768);
    const next = structuredClone(source);
    const row = (
      next.components![0] as {
        components: { components?: Record<string, unknown>[] }[];
      }
    ).components[1]!;
    row.components![0]!.emoji = { name: "🔎" };
    expect(fallback).toEqual(next);
  });

  it("falls back in actual JA/EN workflowHome Section accessories and nested rows, preserving all signed operations", async () => {
    for (const locale of ["ja", "en"] as const) {
      const source = await workflowHome(
        async (action) => "signed-" + action.action,
        {} as ControlData,
        locale,
      );
      const error = {
        code: 50035,
        errors: {
          components: {
            "0": {
              components: {
                "2": { accessory: { emoji: { id: fieldError } } },
                "5": { components: { "0": { emoji: fieldError } } },
              },
            },
          },
        },
      };
      const fallback = fallbackRejectedApplicationEmoji(
        source,
        error,
        config(),
      );
      expect(fallback).not.toBeNull();
      const next = structuredClone(source);
      const components = (
        next.components![0] as unknown as {
          components: Record<string, unknown>[];
        }
      ).components;
      (components[2]!.accessory as Record<string, unknown>).emoji = {
        name: "🔎",
      };
      (components[5]!.components as Record<string, unknown>[])[0]!.emoji = {
        name: "🕘",
      };
      expect(fallback).toEqual(next);
    }
  });

  it.each(["panel", "edit", "reply", "followup"] as const)(
    "retries %s once after definitive 400 and preserves destination, auth, flags, nonce and files",
    async (kind) => {
      const calls: Captured[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit) => {
          calls.push(await capture(url, init));
          return calls.length === 1
            ? response(400, emojiError())
            : response(200, { id: "sent-once" });
        }),
      );
      const original = payload(),
        before = structuredClone(original);
      const rest = new DiscordRest("synthetic-token", fixture.applicationId);
      const file = {
        filename: "nexus-chart.png",
        data: Buffer.from([137, 80, 78, 71]),
      };
      if (kind === "panel")
        expect(
          await rest.sendPanel(channelId, original, "same-action-nonce", [
            file,
          ]),
        ).toBe("sent-once");
      if (kind === "edit")
        await rest.editPanel(channelId, "message-id", original);
      if (kind === "reply")
        await rest.editReply(
          fixture.applicationId,
          "synthetic-private-token",
          original,
          [file],
        );
      if (kind === "followup")
        await rest.followup(
          fixture.applicationId,
          "synthetic-private-token",
          original,
        );
      expect(calls).toHaveLength(2);
      expect(calls[1]!.url).toBe(calls[0]!.url);
      expect(calls[1]!.method).toBe(calls[0]!.method);
      expect(calls[1]!.headers.get("authorization")).toBe(
        calls[0]!.headers.get("authorization"),
      );
      expect(button(calls[1]!.body).emoji).toEqual({ name: "🔎" });
      expect(calls[1]!.body).toEqual({
        ...calls[0]!.body,
        components: [
          {
            type: 1,
            components: [
              { ...button(calls[0]!.body), emoji: { name: "🔎" } },
              button(calls[0]!.body, 1),
            ],
          },
        ],
      });
      expect(calls[1]!.body.flags).toBe(64);
      if (kind === "panel")
        expect(calls[1]!.body).toMatchObject({
          nonce: "sameactionnonce",
          enforce_nonce: true,
        });
      expect(calls[1]!.files).toEqual(calls[0]!.files);
      if (kind === "reply" || kind === "panel")
        expect(calls[1]!.files).toEqual([file.data]);
      expect(original).toEqual(before);
    },
  );

  it("does not repeat a business operation or more than one fallback when Unicode is also rejected", async () => {
    const fetchMock = vi.fn(async () => response(400, emojiError()));
    vi.stubGlobal("fetch", fetchMock);
    const business = vi.fn(() => payload());
    const rest = new DiscordRest("synthetic-token", fixture.applicationId);
    await expect(
      rest.followup(
        fixture.applicationId,
        "synthetic-private-token",
        business(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(business).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 429, 500])(
    "does not infer emoji rejection from HTTP %i alone",
    async (status) => {
      const fetchMock = vi.fn(async () =>
        response(
          status,
          status === 429
            ? { ...emojiError(), retry_after: 9 }
            : { code: 50035, message: "Invalid emoji" },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        new DiscordRest("synthetic-token", fixture.applicationId).followup(
          fixture.applicationId,
          "synthetic-private-token",
          payload(),
        ),
      ).rejects.toMatchObject({ status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    new DOMException("private-timeout-detail", "TimeoutError"),
    new TypeError("private-network-detail"),
  ])("never retries an uncertain followup or leaks errors", async (error) => {
    const fetchMock = vi.fn(async () => {
      throw error;
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await new DiscordRest(
      "synthetic-token",
      fixture.applicationId,
    )
      .followup(fixture.applicationId, "synthetic-private-token", payload())
      .catch((failure: unknown) => failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toMatch(/private-|synthetic-token/);
    expect(String(result)).not.toMatch(/private-|synthetic-token/);
  });

  it("retains normal 429 retries with the unchanged custom payload", async () => {
    const calls: Captured[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(await capture(url, init));
        return calls.length === 1
          ? response(429, { retry_after: 0 })
          : response(200, { id: "ok" });
      }),
    );
    await new DiscordRest("synthetic-token", fixture.applicationId).followup(
      fixture.applicationId,
      "synthetic-private-token",
      payload(),
    );
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual(calls[0]!.body);
  });

  it("does not fall back for mixed structured errors and does not retain private response data", async () => {
    const error = emojiError();
    Object.assign(error.errors, { content: fieldError });
    const fetchMock = vi.fn(async () => response(400, error));
    vi.stubGlobal("fetch", fetchMock);
    const failure = await new DiscordRest(
      "synthetic-token",
      fixture.applicationId,
    )
      .followup(fixture.applicationId, "synthetic-private-token", payload())
      .catch((value: unknown) => value);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(failure)).not.toMatch(
      /synthetic-private|errors|Invalid Form Body/,
    );
  });

  it("does not enable fallback on a different application or in text-only mode", async () => {
    for (const bot of [fixture.applicationId, "999999999999999999"]) {
      fixture.mode = bot === fixture.applicationId ? "text" : "custom";
      vi.stubEnv("NEXUS_EMOJI_MODE", fixture.mode);
      const fetchMock = vi.fn(async () => response(400, emojiError()));
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        new DiscordRest("synthetic-token", bot).followup(
          bot,
          "private",
          payload(),
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("does not activate message fallback for command registration even with a matching-looking error", async () => {
    const fetchMock = vi.fn(async () => response(400, emojiError()));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new DiscordRest(
        "synthetic-token",
        fixture.applicationId,
      ).registerCommands(channelId, [payload()]),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
