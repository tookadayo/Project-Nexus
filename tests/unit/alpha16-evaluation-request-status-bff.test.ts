import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {NextRequest} from "../../apps/web/node_modules/next/server.js";
import {DomainError} from "../../packages/shared/src/index";
import {webRouteBoundary} from "../../apps/web/app/auth/public-boundary";
const mocks = vi.hoisted(() => ({context: vi.fn(), status: vi.fn(), enqueue: vi.fn()}));
vi.mock("../../apps/web/app/operations/context", () => ({operationsContext: mocks.context}));
vi.mock("../../packages/rules/src/service", () => ({RulePlatform: class {evaluationRequestStatus = mocks.status; enqueue = mocks.enqueue;}}));
vi.mock("../../packages/rules/src/typed-drafts", () => ({createTargetDraftAdapters: () => []}));
vi.mock("../../packages/rules/src/operational-context", () => ({createOperationalCaseRuntime: async () => undefined}));
import {POST} from "../../apps/web/app/api/rules/[...path]/route";
const scope = {organizationId: "a1680000-0000-4000-8000-000000000002", guildId: "333333333333333333"}, actor = {key: "fixture", source: "WEB_DASHBOARD"};
const key = `rk1.abc.${"a".repeat(32)}.${"b".repeat(64)}`, route = {params: Promise.resolve({path: ["evaluation-request-status"]})};
const request = (body: unknown = {key}, headers: Record<string, string> = {}, query = "") => new NextRequest(`http://localhost:3100/api/rules/evaluation-request-status${query}`, {method: "POST", headers: {host: "localhost:3100", origin: "http://localhost:3100", "sec-fetch-site": "same-origin", "X-Nexus-Guild": scope.guildId, "Content-Type": "application/json", ...headers}, body: JSON.stringify(body)});
beforeEach(() => {vi.resetAllMocks(); vi.stubEnv("NEXUS_WEB_URL", "http://localhost:3100"); mocks.context.mockResolvedValue({scope, actor, snapshot: {checkedAt: Date.now()}, services: {db: {}}}); mocks.status.mockResolvedValue({status: "PREPARED", acceptance: "UNKNOWN", job: null});});
afterEach(() => vi.unstubAllEnvs());
describe("alpha16 narrow read-only original acceptance BFF", () => {
  it("allows only exact POST and reads with the body key, never an enqueue or new communication key", async () => {
    expect(webRouteBoundary("/api/rules/evaluation-request-status")).toEqual({kind: "BROWSER", methods: ["POST"]}); expect(webRouteBoundary("/api/rules/evaluation-request-status/extra")).toBeNull();
    const result = await POST(request(), route); expect(result.status).toBe(200); expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.status).toHaveBeenCalledWith(scope, actor, {key}); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("rejects origin, displayed-guild, query and authority injection before domain lookup", async () => {
    expect((await POST(request({key}, {origin: "https://attacker.invalid", "sec-fetch-site": "cross-site"}), route)).status).toBe(403);
    expect((await POST(request({key}, {"X-Nexus-Guild": "444444444444444444"}), route)).status).toBe(409);
    expect((await POST(request({key}, {}, "?actor=other"), route)).status).toBe(400);
    for (const body of [{key, actorHash: "other"}, {key, approved: true}, {key, guildId: scope.guildId}, {key: "invalid"}]) expect((await POST(request(body), route)).status).toBe(400);
    expect(mocks.status).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it("keeps loss of current Analyze authority visible without permitting a replacement request", async () => {
    mocks.status.mockRejectedValue(new DomainError("NEXUS_ROLE_REQUIRED", 403)); expect((await POST(request(), route)).status).toBe(403); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
