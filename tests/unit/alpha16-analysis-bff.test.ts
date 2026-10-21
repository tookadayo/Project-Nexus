import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "../../apps/web/node_modules/next/server.js";
import { DomainError } from "../../packages/shared/src/index";
import { run, result } from "../fixtures/analysis-panels";
import { analysisRunDto, analysisStartSchema } from "../../apps/web/app/analysis/model";
import { webRouteBoundary } from "../../apps/web/app/auth/public-boundary";
const mocks = vi.hoisted(() => ({ context: vi.fn(), permissions: vi.fn(), menu: vi.fn(), preview: vi.fn(), request: vi.fn(), history: vi.fn(), result: vi.fn(), compare: vi.fn(), cancel: vi.fn() }));
vi.mock("../../apps/web/app/operations/context", () => ({ operationsContext: mocks.context }));
vi.mock("../../packages/operations/src/policy", () => ({ actorPermissions: mocks.permissions }));
vi.mock("../../packages/analysis/src/index", () => ({ AnalysisService: class {
  menu = mocks.menu; preview = mocks.preview; request = mocks.request; historyPage = mocks.history;
  result = mocks.result; compare = mocks.compare; cancel = mocks.cancel;
} }));
import { GET, POST } from "../../apps/web/app/api/analysis/[...path]/route";
const guild = run.guild_id, id = run.id;
const scope = { organizationId: run.organization_id, guildId: guild };
const actor = { key: "actor", permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: "fixture" };
function req(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3100/api/analysis/${path}?guild=${guild}`, { method: body === undefined ? "GET" : "POST",
    headers: { host: "localhost:3100", origin: "http://localhost:3100", "sec-fetch-site": "same-origin", "X-Nexus-Guild": guild, "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
const route = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NEXUS_WEB_URL", "http://localhost:3100");
  mocks.context.mockResolvedValue({ scope, actor, services: { db: { transaction: () => ({ execute: (f: (tx: unknown) => unknown) => f({}) }) } } });
  mocks.permissions.mockResolvedValue(["READ", "ANALYZE"]);
  mocks.result.mockResolvedValue({ run, result, reviews: [] });
  mocks.request.mockResolvedValue({ run, reused: false });
  mocks.cancel.mockResolvedValue({ run: { ...run, status: "CANCELED" }, canceled: true });
});
afterEach(() => vi.unstubAllEnvs());
describe("alpha16 Detailed Analysis same-origin PC BFF", () => {
  it("registers bounded routes and request-key issuance without widening the API namespace", () => {
    for (const path of ["/analysis", "/templates", "/preferences", "/templates/data", "/preferences/data", "/operations/maintenance", "/api/operations-maintenance/readiness", "/api/analysis/menu", `/api/analysis/runs/${id}`, `/api/analysis/runs/${id}/compare`]) expect(webRouteBoundary(path)).not.toBeNull();
    expect(webRouteBoundary("/api/rules/evaluation-request-key")?.methods).toEqual(["POST"]);
    expect(webRouteBoundary("/api/rules/mutation-request-key")?.methods).toEqual(["POST"]);
    for (const path of ["/health", "/api/health/overview", "/api/health/lifecycle-preview"]) expect(webRouteBoundary(path)?.methods).toEqual(["GET", "HEAD"]);
    expect(webRouteBoundary("/api/health/anything")).toBeNull();
    expect(webRouteBoundary(`/api/analysis/runs/${id}/cancel`)?.methods).toEqual(["POST"]);
    expect(webRouteBoundary(`/api/analysis/runs/${id}/apply`)).toBeNull();
  });
  it("projects immutable run status without identifiers, ciphertext, request intent or lease state", () => {
    const dto = analysisRunDto({ ...run, requested_by_user_ciphertext: "fixture-ciphertext", lease_token: id, target_channel_ids: [guild] });
    expect(dto).toMatchObject({ id, status: "COMPLETED", periodDays: 30, invalidated: false });
    for (const key of ["organization_id", "guild_id", "scheduler_organization_id", "requested_by_user_ciphertext", "requested_by_actor_hash", "request_key", "lease_token", "target_channel_ids", "conditions"]) expect(dto).not.toHaveProperty(key);
    expect(analysisRunDto({ ...run, invalidated_at: new Date() }).invalidated).toBe(true);
  });
  it("rejects cross-origin mutations before acquiring authority or requesting work", async () => {
    const response = await POST(req("preview", { type: "OVERALL", days: 30 }, { origin: "https://attacker.invalid", "sec-fetch-site": "cross-site" }), route("preview"));
    expect(response.status).toBe(403); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.request).not.toHaveBeenCalled();
  });
  it("rejects stale displayed-guild reads and writes before invoking a domain operation", async () => {
    const headers = { "X-Nexus-Guild": "222222222222222222" };
    expect((await GET(req("history", undefined, headers), route("history"))).status).toBe(409);
    expect((await POST(req("preview", { type: "OVERALL", days: 30 }, headers), route("preview"))).status).toBe(409);
    expect(mocks.preview).not.toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled();
  });
  it("keeps a READ-only preview separate from generation and excludes configured private scope", async () => {
    mocks.preview.mockResolvedValue({ request: { type: "OVERALL", days: 30 }, scope: { channelIds: [guild] }, targetChannelCount: 1, availability: "PARTIAL", quality: "NO_DATA", metrics: result.metrics,
      periodStart: run.period_start, periodEnd: run.period_end, usage: { remaining: 0 }, duplicate: null, configRevision: 2, inputFingerprint: "a".repeat(64), consumeCount: 1, correctionOf: null });
    const response = await POST(req("preview", { type: "OVERALL", days: 30 }), route("preview"));
    expect(response.status).toBe(200); const dto = await response.json();
    expect(dto).not.toHaveProperty("scope"); expect(dto.metrics[0].evidence.value).toBeNull(); expect(mocks.request).not.toHaveBeenCalled();
  });
  it("requires a complete preview binding and caller intent key, leaving deduplication with the existing domain", async () => {
    const body = { request: { type: "OVERALL", days: 30 }, expected: { revision: 1, fingerprint: "a".repeat(64) } };
    expect(analysisStartSchema.safeParse({ ...body, rerun: true }).success).toBe(false);
    expect((await POST(req("runs", body), route("runs"))).status).toBe(400);
    expect(mocks.request).not.toHaveBeenCalled();
    expect((await POST(req("runs", body, { "Idempotency-Key": "stable-fixture-intent" }), route("runs"))).status).toBe(202);
    expect(mocks.request).toHaveBeenCalledWith(scope, actor, body.request, "stable-fixture-intent", body.expected);
    mocks.request.mockResolvedValue({ run, reused: true });
    expect((await POST(req("runs", body, { "Idempotency-Key": "stable-fixture-intent" }), route("runs"))).status).toBe(200);
  });
  it("preserves authorization and expiry failures before cancellation or result exposure", async () => {
    mocks.result.mockRejectedValue(new DomainError("ANALYSIS_NOT_FOUND", 404));
    expect((await POST(req(`runs/${id}/cancel`, {}), route(`runs/${id}/cancel`))).status).toBe(404);
    expect(mocks.cancel).not.toHaveBeenCalled();
    mocks.context.mockRejectedValue(new DomainError("AUTHORIZATION_EXPIRED", 403));
    expect((await GET(req(`runs/${id}`), route(`runs/${id}`))).status).toBe(403);
  });
  it("keeps absent or restricted results null and returns comparison eligibility from the canonical domain", async () => {
    mocks.result.mockResolvedValue({ run, result: null, reviews: [] });
    const response = await GET(req(`runs/${id}`), route(`runs/${id}`));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ result: null, canCancel: false });
    mocks.compare.mockResolvedValue({ comparable: false, changes: [], reasons: ["WINDOW_MISMATCH"] });
    expect(await (await GET(req(`runs/${id}/compare`), route(`runs/${id}/compare`))).json()).toMatchObject({ comparable: false, changes: [], reasons: ["WINDOW_MISMATCH"] });
  });
});
