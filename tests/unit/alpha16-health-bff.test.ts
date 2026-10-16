import {beforeEach, describe, expect, it, vi} from "vitest";
import {NextRequest} from "../../apps/web/node_modules/next/server.js";
import {DomainError} from "../../packages/shared/src/index";
import {healthFixture, healthGuild, healthRevision, healthPreviewFixture} from "../fixtures/alpha16-health";
import {webRouteBoundary} from "../../apps/web/app/auth/public-boundary";
const mocks = vi.hoisted(() => ({context: vi.fn(), overview: vi.fn(), preview: vi.fn()}));
vi.mock("../../apps/web/app/operations/context", () => ({operationsContext: mocks.context}));
vi.mock("../../packages/presentation/src/health-workspace", () => ({HealthWorkspaceService: class {overview = mocks.overview; lifecyclePreview = mocks.preview;}}));
import {GET} from "../../apps/web/app/api/health/[...path]/route";
const scope = {organizationId: "a1680000-0000-4000-8000-000000000002", guildId: healthGuild}, actor = {key: "fixture", source: "WEB_DASHBOARD"};
const authority = {checkedAt: 1000, scope};
const req = (path: string, guild = healthGuild) => new NextRequest(`http://localhost/api/health/${path}${path.includes("?") ? "&" : "?"}guild=${guild}`);
const route = (path: string) => ({params: Promise.resolve({path: path.split("/")})});
beforeEach(() => {vi.resetAllMocks(); mocks.context.mockResolvedValue({scope, actor, snapshot: authority, services: {db: {}}}); mocks.overview.mockResolvedValue(healthFixture()); mocks.preview.mockResolvedValue(healthPreviewFixture);});
describe("alpha16 read-only health BFF", () => {
  it("registers only the page and two exact read-only health handlers", () => {
    for (const path of ["/health", "/api/health/overview", "/api/health/lifecycle-preview"]) expect(webRouteBoundary(path)).toEqual({kind: "BROWSER", methods: ["GET", "HEAD"]});
    for (const path of ["/api/health/refresh", "/api/health/source/correct", "/api/health/permission/grant"]) expect(webRouteBoundary(path)).toBeNull();
  });
  it("forwards current authority and serves no-store observations", async () => {
    const response = await GET(req("overview"), route("overview"));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.overview).toHaveBeenCalledWith(scope, actor, authority); expect((await response.json()).data.lastSuccessfulRefresh).toBeNull();
  });
  it("denies a stale displayed guild before reading scoped sources", async () => {
    expect((await GET(req("overview", "884222222222222222"), route("overview"))).status).toBe(409);
    expect(mocks.overview).not.toHaveBeenCalled();
  });
  it("validates legacy preview identity and never starts an execution", async () => {
    expect((await GET(req("lifecycle-preview?revision=bad"), route("lifecycle-preview"))).status).toBe(400); expect(mocks.preview).not.toHaveBeenCalled();
    const response = await GET(req(`lifecycle-preview?revision=${healthRevision}`), route("lifecycle-preview"));
    expect(await response.json()).toMatchObject({kind: "CONFIGURATION_COMPARISON", externalEffects: false, executionSimulation: {available: false}});
    expect(mocks.preview).toHaveBeenCalledWith(scope, actor, healthRevision, undefined, authority);
  });
  it("keeps authorization, missing revision and communication failures visible", async () => {
    mocks.context.mockRejectedValueOnce(new DomainError("NEXUS_ROLE_REQUIRED", 403));
    expect((await GET(req("overview"), route("overview"))).status).toBe(403);
    mocks.preview.mockRejectedValue(new DomainError("REVISION_NOT_FOUND", 404));
    expect((await GET(req(`lifecycle-preview?revision=${healthRevision}`), route("lifecycle-preview"))).status).toBe(404);
    mocks.overview.mockRejectedValue(new Error("PRIVATE_DATABASE_ERROR"));
    const response = await GET(req("overview"), route("overview")); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("PRIVATE_DATABASE_ERROR");
  });
  it("does not widen the read registry to refresh or correction routes", async () => {
    for (const path of ["refresh", "source/correct", "permission/grant", "lifecycle-preview/execute"]) expect((await GET(req(path), route(path))).status).toBe(404);
    expect(mocks.context).not.toHaveBeenCalled();
  });
});
