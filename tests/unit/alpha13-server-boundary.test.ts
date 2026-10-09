import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "../../apps/web/node_modules/next/server.js";
const context = vi.hoisted(() => vi.fn());
const operationsContext = vi.hoisted(() => vi.fn());
vi.mock("../../apps/web/app/operations/context", () => ({ operationsContext }));
vi.mock("../../apps/web/app/auth/session", () => ({
  dashboardContext: context,
  openSession: async () => ({ userId: "synthetic-user" }),
  authMode: () => "oauth",
}));
import {
  GET as exploreRead,
  POST as exploreWrite,
} from "../../apps/web/app/explore/data/route";
import {
  GET as operationsRead,
  POST as operationsWrite,
} from "../../apps/web/app/operations/data/route";
import { POST } from "../../apps/web/app/control/route";
import { GET as journey } from "../../apps/web/app/data/journey/route";
const a = "111111111111111111",
  b = "222222222222222222";
const fetcher = vi.fn(
  async (_url: string, _init?: RequestInit) =>
    new Response('{"revision":2}', { status: 200 }),
);
beforeEach(() => {
  vi.stubEnv("NEXUS_WEB_URL", "http://localhost:3100");
  vi.stubGlobal("fetch", fetcher);
  operationsContext.mockReset();
  operationsContext.mockResolvedValue({
    scope: { organizationId: "synthetic-org", guildId: b },
    services: {},
  });
  context.mockReset();
  context.mockImplementation(async (_session, guildId) => ({
    guildId,
    organizationId: "synthetic-org",
    base: "http://127.0.0.1:3001",
    token: "synthetic-internal-token",
    operationsCanConfigure: true,
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function request(
  displayed: string | null,
  selected: string,
  path = "/control",
) {
  return new NextRequest("http://localhost:3100" + path, {
    method: path === "/control" ? "POST" : "GET",
    headers: {
      host: "localhost:3100",
      "sec-fetch-site": "same-origin",
      origin: "http://localhost:3100",
      cookie: `nexus_session=synthetic;nexus_guild=${selected}`,
      ...(displayed ? { "X-Nexus-Guild": displayed } : {}),
    },
    ...(path === "/control"
      ? {
          body: JSON.stringify({
            action: "retention_days",
            days: 7,
            revision: 1,
          }),
        }
      : {}),
  });
}
it.each(["another tab", "Back", "restored page"])(
  "rejects stale displayed scope after %s, even with matching revision and authority in both guilds",
  async () => {
    const response = await POST(request(a, b));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "SERVER_SELECTION_CHANGED",
      failure: { effect: "NOT_STARTED" },
    });
    expect(context).toHaveBeenCalledWith("synthetic", b);
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it("requires the display assertion and forwards only after current authorization agrees", async () => {
  expect((await POST(request(null, a))).status).toBe(409);
  expect(fetcher).not.toHaveBeenCalled();
  expect((await POST(request(b, b))).status).toBe(200);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `http://127.0.0.1:3001/v3/organizations/synthetic-org/guilds/${b}/settings/retention`,
  );
});
it("never treats the client assertion as permission", async () => {
  context.mockResolvedValueOnce(null);
  expect((await POST(request(b, b))).status).toBe(403);
  context.mockResolvedValueOnce({ guildId: b, operationsCanConfigure: false });
  expect((await POST(request(b, b))).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects a stale range read without rendering another server under the old heading", async () => {
  expect((await journey(request(a, b, "/data/journey?range=7"))).status).toBe(
    409,
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["explore", "operations"])(
  "binds %s reads, exports and writes to the displayed guild before accessing services",
  async (surface) => {
    const read = surface === "explore" ? exploreRead : operationsRead;
    const write = surface === "explore" ? exploreWrite : operationsWrite;
    for (const headers of [
      new Headers({ "X-Nexus-Guild": a }),
      new Headers(),
    ]) {
      const response = await read(
        new NextRequest(`http://localhost:3100/${surface}/data?guild=${a}`, {
          headers,
        }),
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: "SERVER_SELECTION_CHANGED",
        failure: { effect: "NOT_STARTED" },
      });
    }
    const response = await write(
      new NextRequest(`http://localhost:3100/${surface}/data`, {
        method: "POST",
        headers: {
          host: "localhost:3100",
          origin: "http://localhost:3100",
          "sec-fetch-site": "same-origin",
          "X-Nexus-Guild": a,
        },
        body: JSON.stringify(
          surface === "explore"
            ? { action: "saveSegment", segment: {} }
            : { action: "attention", input: {} },
        ),
      }),
    );
    expect(response.status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it("rejects a stale pre-pagination Attention write instead of forwarding without current row and channel checks", async () => {
  const response = await POST(
    new NextRequest("http://localhost:3100/control", {
      method: "POST",
      headers: {
        host: "localhost:3100",
        origin: "http://localhost:3100",
        "sec-fetch-site": "same-origin",
        cookie: `nexus_session=synthetic;nexus_guild=${b}`,
        "X-Nexus-Guild": b,
      },
      body: JSON.stringify({
        action: "attention_action",
        channelId: "333333333333333333",
        messageId: "444444444444444444",
        status: "RESOLVED",
      }),
    }),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    error: "REVISION_CONFLICT",
    failure: { effect: "NOT_STARTED" },
  });
  expect(fetcher).not.toHaveBeenCalled();
});
