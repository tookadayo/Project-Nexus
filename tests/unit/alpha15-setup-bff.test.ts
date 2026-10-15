import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {NextRequest} from "../../apps/web/node_modules/next/server.js";
const mocks = vi.hoisted(() => ({context: vi.fn(), proof: vi.fn()}));
vi.mock("../../apps/web/app/auth/session", () => ({setupContext: mocks.context}));
vi.mock("../../packages/security/src/public-api", () => ({createPublicApiProof: mocks.proof}));
import {GET, POST} from "../../apps/web/app/data/setup/[...operation]/route";

const guild = "321111111111111111";
const organizationId = "8aa23f75-a30d-4bea-9b8c-b9f0223c2eef";
const identity = {base: "http://127.0.0.1:4191", guildId: guild, organizationId, userId: "821111111111111111", sessionReference: "synthetic-session-reference", token: "synthetic-service-hop"};
const request = (method: "GET" | "POST", headers: Record<string, string> = {}, body?: string) => new NextRequest(`http://127.0.0.1:4190/data/setup/status?guild=${guild}`, {method, headers: {"X-Nexus-Guild": guild, Host: "127.0.0.1:4190", ...headers}, ...(body ? {body} : {})});
beforeEach(() => { vi.stubEnv("NEXUS_WEB_URL", "http://127.0.0.1:4190"); mocks.context.mockResolvedValue(identity); mocks.proof.mockReturnValue("synthetic-signed-user-proof"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("alpha15 setup BFF keeps the public session boundary", () => {
  it("rejects a mismatched displayed guild and never issues authority proof", async () => {
    const response = await GET(request("GET", {"X-Nexus-Guild": "999111111111111111"}), {params: Promise.resolve({operation: ["status"]})});
    expect(response.status).toBe(409);
    expect(mocks.proof.mock.calls.length).toBe(0);
  });
  it("rejects a cross-origin mutation before reading session authority", async () => {
    const response = await POST(request("POST", {Origin: "https://attacker.invalid", "Sec-Fetch-Site": "cross-site"}, "{}"), {params: Promise.resolve({operation: ["draft"]})});
    expect(response.status).toBe(403);
    expect(mocks.context.mock.calls.length).toBe(0);
  });
  it("requires the actual setup session and limits the endpoint surface", async () => {
    mocks.context.mockResolvedValue(null);
    const response = await GET(request("GET"), {params: Promise.resolve({operation: ["status"]})});
    expect(response.status).toBe(401);
    const outside = await GET(request("GET"), {params: Promise.resolve({operation: ["operator", "secrets"]})});
    expect(outside.status).toBe(404);
    expect(mocks.proof.mock.calls.length).toBe(0);
  });
  it("binds server identity, session, exact method and path in the upstream proof", async () => {
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify({state: "SETUP_REQUIRED"}), {status: 200}));
    vi.stubGlobal("fetch", fetcher);
    const body = JSON.stringify({requestId: organizationId, patch: {timezone: "UTC"}});
    const response = await POST(request("POST", {Origin: "http://127.0.0.1:4190", "Sec-Fetch-Site": "same-origin", Authorization: "Bearer browser-supplied-ignored"}, body), {params: Promise.resolve({operation: ["draft"]})});
    expect(response.status).toBe(200);
    expect(mocks.proof.mock.calls[0]?.[0]).toEqual({scope: {organizationId, guildId: guild}, userId: identity.userId, sessionReference: identity.sessionReference, method: "POST", path: `/v3/organizations/${organizationId}/guilds/${guild}/web-setup/draft`, origin: "http://127.0.0.1:4190"});
    const options = fetcher.mock.calls[0]?.[1] as unknown as RequestInit;
    expect(options.body).toBe(body);
    expect(options.headers).toEqual({Authorization: "Bearer synthetic-service-hop", "x-nexus-user-proof": "synthetic-signed-user-proof", "Content-Type": "application/json", Origin: "http://127.0.0.1:4190"});
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
