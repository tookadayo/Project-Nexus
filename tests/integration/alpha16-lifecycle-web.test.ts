import {randomUUID} from "node:crypto";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {connect, ensureGuild, json, migrate, sql, tenant, type Database} from "../../packages/db/src/index";
import {scopeForGuild} from "../../packages/security/src/scoping";
import {type Actor} from "../../packages/settings/src/index";
import {EntitlementService} from "../../packages/settings/src/billing/index";
import {LifecycleWebWorkspace, purgeLifecycleWebActor, type LifecycleWebMutation} from "../../packages/lifecycle/src/web-workspace";
import {isolatedPostgres} from "../fixtures/postgres";
let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
beforeAll(async () => {vi.stubEnv("NEXUS_HOSTED_BETA", "off"); infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); vi.spyOn(EntitlementService.prototype, "can").mockResolvedValue(true); vi.spyOn(EntitlementService.prototype, "require").mockImplementation(async () => ({allowed: true}) as never);});
afterAll(async () => {vi.restoreAllMocks(); vi.unstubAllEnvs(); await db?.destroy(); await infra?.stop();});
const definition = {name: "Synthetic experiment", eligibility: [], randomization: "member", blockSeconds: 3600, windowSeconds: 86400, minimumSample: 20, variants: [{key: "control", weight: 50, interventionRevisionId: null}, {key: "treatment", weight: 50, interventionRevisionId: null}], primaryMetric: "activation", guardrails: {maxLeaveRate: 0.1, maxFailureRate: 0.1, maxAlerts: 10}};
const actor = (key: string): Actor => ({key, permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: randomUUID()});
async function fixture() {const scope = scopeForGuild(String(884400000000000000n + BigInt(++serial))); await ensureGuild(db, scope); const user = actor("synthetic-admin"), authorization = {scope, actorHash: user.key, expiresAt: new Date(Date.now() + 60000)}, workspace = new LifecycleWebWorkspace(db, {authorization, policy: {revision: "fixture-only", seconds: 300, purposeReference: "synthetic-only"}, authorize: vi.fn(async () => undefined)}); return {scope, user, workspace, authorization};}
const draft = (): LifecycleWebMutation => ({operation: "DRAFT", domain: "experiment", definition});
async function execute(f: Awaited<ReturnType<typeof fixture>>, input: LifecycleWebMutation) {const request = await f.workspace.prepare(f.scope, f.user, input); return {request, result: await f.workspace.mutate(f.scope, f.user, request.key, input)};}
async function published(f: Awaited<ReturnType<typeof fixture>>) {const id = await f.workspace.revisions.draft(f.scope, f.user, "experiment", definition); await sql`UPDATE guild_config_revisions SET state='published',published_at=now() WHERE ${tenant(f.scope)} AND id=${id}::uuid`.execute(db); return id;}
describe("alpha16 existing lifecycle services behind the Web workspace", () => {
  it("requires a trusted actor/scope/deadline proof for all new read surfaces", async () => {
    const f = await fixture();
    for (const authorization of [undefined, {...f.authorization, actorHash: "other"}, {...f.authorization, scope: {...f.scope, guildId: "884499999999999999"}}, {...f.authorization, expiresAt: new Date(0)}]) {
      const workspace = new LifecycleWebWorkspace(db, {...f.workspace.options, authorization});
      await expect(workspace.catalog(f.scope, f.user, "experiment")).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
    }
  });
  it("checks the proof after awaited access and inside the legacy final-write transaction", async () => {
    const f = await fixture(), delayed = new LifecycleWebWorkspace(db, {...f.workspace.options, authorize: async () => {f.authorization.expiresAt = new Date(0);}});
    await expect(delayed.catalog(f.scope, f.user, "experiment")).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
    f.authorization.expiresAt = new Date(Date.now() + 60000);
    const prepared = await f.workspace.prepare(f.scope, f.user, draft()), original = f.workspace.revisions.draft.bind(f.workspace.revisions);
    vi.spyOn(f.workspace.revisions, "draft").mockImplementationOnce(async (...args) => {f.authorization.expiresAt = new Date(0); return original(...args);});
    await expect(f.workspace.mutate(f.scope, f.user, prepared.key, draft())).rejects.toThrow("LIFECYCLE_RESULT_UNKNOWN");
    expect((await sql`SELECT 1 FROM guild_config_revisions WHERE ${tenant(f.scope)} AND domain='experiment'`.execute(db)).rows).toHaveLength(0);
  });
  it("does not deny a known committed draft or repeat it when proof expires before its receipt write", async () => {
    const f = await fixture(), prepared = await f.workspace.prepare(f.scope, f.user, draft()), original = f.workspace.revisions.draft.bind(f.workspace.revisions);
    vi.spyOn(f.workspace.revisions, "draft").mockImplementationOnce(async (...args) => {const saved = await original(...args); f.authorization.expiresAt = new Date(0); return saved;});
    expect(await f.workspace.mutate(f.scope, f.user, prepared.key, draft())).toMatchObject({state: "draft", requestRecorded: false});
    f.authorization.expiresAt = new Date(Date.now() + 60000);
    await expect(f.workspace.mutate(f.scope, f.user, prepared.key, draft())).rejects.toThrow("LIFECYCLE_RESULT_UNKNOWN");
    expect((await sql`SELECT 1 FROM guild_config_revisions WHERE ${tenant(f.scope)} AND domain='experiment'`.execute(db)).rows).toHaveLength(1);
  });
  it("keeps writes off when the request purpose is unspecified, while reading existing state", async () => {const f = await fixture(), disabled = new LifecycleWebWorkspace(db, {authorization: f.authorization, authorize: async () => undefined}); expect((await disabled.catalog(f.scope, f.user, "experiment")).readiness.enabled).toBe(false); await expect(disabled.prepare(f.scope, f.user, draft())).rejects.toThrow("LIFECYCLE_REQUEST_RETENTION_UNCONFIGURED");});
  it("reads saved result snapshots without evaluating outcomes or changing experiment control", async () => {
    const f = await fixture(), id = await published(f); await sql`INSERT INTO experiment_controls(organization_id,guild_id,revision_id,state) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${id}::uuid,'running')`.execute(db);
    const snapshot = {evidenceStatus: "GUARDRAIL_BREACH", state: "paused", controlN: 20}; await sql`INSERT INTO experiment_metric_results VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${id}::uuid,now(),${json(snapshot)})`.execute(db);
    const evaluate = vi.spyOn(f.workspace.experiments, "result"); const catalog = await f.workspace.catalog(f.scope, f.user, "experiment"), read = await f.workspace.experiments.latestResult(f.scope, id);
    expect(read?.result).toEqual(snapshot); expect(catalog.results[0]?.result).toEqual(snapshot); expect(evaluate).not.toHaveBeenCalled();
    expect((await sql<{state: string}>`SELECT state FROM experiment_controls WHERE ${tenant(f.scope)} AND revision_id=${id}::uuid`.execute(db)).rows[0]?.state).toBe("running");
    expect((await sql`SELECT 1 FROM experiment_outcomes WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  });
  it("creates one draft through the existing revision service and replays only its minimal result", async () => {
    const f = await fixture(), saved = await execute(f, draft()); expect(saved.result).toMatchObject({state: "draft"});
    expect(await f.workspace.mutate(f.scope, f.user, saved.request.key, draft())).toEqual(saved.result);
    expect((await sql`SELECT id FROM guild_config_revisions WHERE ${tenant(f.scope)} AND domain='experiment'`.execute(db)).rows).toHaveLength(1);
    expect((await sql`SELECT revision_id FROM guild_config_heads WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  });
  it("never repeats a claimed operation after an unknown commit result", async () => {
    const f = await fixture(), request = await f.workspace.prepare(f.scope, f.user, draft()), send = vi.spyOn(f.workspace.revisions, "draft").mockRejectedValueOnce(new Error("uncertain transport"));
    await expect(f.workspace.mutate(f.scope, f.user, request.key, draft())).rejects.toThrow("LIFECYCLE_RESULT_UNKNOWN"); await expect(f.workspace.mutate(f.scope, f.user, request.key, draft())).rejects.toThrow("LIFECYCLE_RESULT_UNKNOWN");
    expect(send).toHaveBeenCalledTimes(1); expect((await f.workspace.requestStatus(f.scope, f.user, "experiment", request.key)).state).toBe("UNKNOWN");
  });
  it("requires current source scope, immutable hash, actor identity, and exact request content", async () => {
    const f = await fixture(), other = await fixture(), saved = await execute(f, draft()), revisionId = String(saved.result.revisionId), revision = await f.workspace.revisions.get(f.scope, revisionId);
    // The other guild must have its own valid current proof before testing
    // whether a source revision from this guild can cross that boundary.
    await expect(other.workspace.prepare(other.scope, other.user, {operation: "DRAFT", domain: "experiment", definition, sourceRevisionId: revisionId, sourceHash: revision.hash})).rejects.toThrow("REVISION_NOT_FOUND");
    await expect(new LifecycleWebWorkspace(db, {...f.workspace.options, authorization: {...f.authorization, actorHash: "other-admin"}}).mutate(f.scope, actor("other-admin"), saved.request.key, draft())).rejects.toThrow("LIFECYCLE_REQUEST_GONE");
    await expect(f.workspace.mutate(f.scope, f.user, saved.request.key, {...draft(), definition: {...definition, name: "Changed"}})).rejects.toThrow("LIFECYCLE_REQUEST_MISMATCH");
  });
  it("keeps stopped experiments irreversible and rejects stale observed control state", async () => {
    const f = await fixture(), id = await published(f);
    await execute(f, {operation: "EXPERIMENT_CONTROL", domain: "experiment", revisionId: id, expectedState: "running", state: "stopped"});
    await expect(f.workspace.prepare(f.scope, f.user, {operation: "EXPERIMENT_CONTROL", domain: "experiment", revisionId: id, expectedState: "stopped", state: "running"})).rejects.toThrow("STOPPED_EXPERIMENT_IMMUTABLE");
    await expect(f.workspace.experiments.control(f.scope, f.user, id, "paused", "running")).rejects.toThrow("EXPERIMENT_STATE_CONFLICT");
  });
  it("removes actor request identities through the privacy hook and cannot revive a removed old key", async () => {
    const f = await fixture(), request = await f.workspace.prepare(f.scope, f.user, draft()); await db.transaction().execute((tx) => purgeLifecycleWebActor(tx, f.scope, f.user.key));
    await expect(f.workspace.mutate(f.scope, f.user, request.key, draft())).rejects.toThrow("LIFECYCLE_REQUEST_GONE");
  });
});
