import {randomUUID} from "node:crypto";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {connect, ensureGuild, migrate, sql, tenant, type Database} from "../../packages/db/src/index";
import {scopeForGuild} from "../../packages/security/src/scoping";
import {IdentityVault} from "../../packages/identity/src/index";
import {SettingsService, type Actor} from "../../packages/settings/src/index";
import {EntitlementService} from "../../packages/settings/src/billing/index";
import {OnboardingService} from "../../packages/onboarding/src/index";
import {OnboardingFlowDrafts, createOnboardingFlowDraftAdapter, onboardingFlowTargetVersion, purgeOnboardingFlowDrafts, type OnboardingDraftMutation} from "../../packages/onboarding/src/flow-drafts";
import {OnboardingFlowAuthoring} from "../../packages/onboarding/src/flow-authoring";
import {type Flow} from "../../packages/onboarding/src/flow";
import {ruleScopeLockSet, scopeLockIds} from "../../packages/rules/src/locks";
import {FakeDiscord} from "../fixtures/discord";
import {isolatedPostgres} from "../fixtures/postgres";
let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
const vault = new IdentityVault("ab".repeat(32), "cd".repeat(32));
const definition: Flow = {start: "guide", nodes: [{id: "guide", question: "Choose a first step", options: [{id: "read", label: "Read the guide", next: null}]}]};
beforeAll(async () => {vi.stubEnv("NEXUS_HOSTED_BETA", "off"); infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); vi.spyOn(EntitlementService.prototype, "require").mockImplementation(async () => ({allowed: true}) as never); vi.spyOn(EntitlementService.prototype, "can").mockResolvedValue(true);});
afterAll(async () => {vi.restoreAllMocks(); vi.unstubAllEnvs(); await db?.destroy(); await infra?.stop();});
async function fixture() {
  const scope = scopeForGuild(String(878800000000000000n + BigInt(++serial))); await ensureGuild(db, scope);
  const actor: Actor = {key: "synthetic-admin", permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: randomUUID()}, authorization = {scope, actorHash: actor.key, expiresAt: new Date(Date.now() + 60000)}, settings = new SettingsService(db), onboarding = new OnboardingService(db, settings, vault), discord = new FakeDiscord();
  const initial = await settings.get(scope), published = await onboarding.publish(scope, actor, initial.revision, definition), authoring = new OnboardingFlowAuthoring(db, {authorization, requestPolicy: {revision: "fixture-only", purposeReference: "synthetic-only", seconds: 300}, discord, authorize: async () => undefined});
  const save: OnboardingDraftMutation = {operation: "FLOW_DRAFT_SAVE", label: "Synthetic guide", slot: "MAIN", definition, baseFlowId: published.flowVersionId, expectedSettingsRevision: published.revision};
  return {scope, actor, authorization, settings, onboarding, published, authoring, discord, save};
}
async function execute(f: Awaited<ReturnType<typeof fixture>>, input: OnboardingDraftMutation) {const request = await f.authoring.prepare(f.scope, f.actor, input); return {request, result: await f.authoring.mutate(f.scope, f.actor, request.key, input)};}
async function publication(f: Awaited<ReturnType<typeof fixture>>, workspaceId: string): Promise<OnboardingDraftMutation> {const p = await f.authoring.native.transaction(f.scope, f.actor, "READ", (tx) => f.authoring.native.previewInTransaction(tx, f.scope, f.actor, workspaceId)); return {operation: "FLOW_DRAFT_PUBLISH", workspaceId, expectedRevision: p.workspace.revision, draftId: p.after.id, confirmationHash: p.confirmationHash, expectedFlowId: p.before.id, expectedSettingsRevision: p.before.settingsRevision};}
describe("alpha16 native onboarding configuration drafts", () => {
  it("saves and edits immutable snapshots without touching native settings, flows or pinned sessions", async () => {
    const f = await fixture(), session = await f.onboarding.start(f.scope, "878811111111111111", new Date(), "TEST"), before = await f.settings.get(f.scope), first = await execute(f, f.save);
    const next = {...f.save, workspaceId: String(first.result.workspaceId), expectedRevision: 1, label: "Edited", definition: {...definition, nodes: [{...definition.nodes[0]!, question: "Edited question"}]}};
    const second = await execute(f, next); expect(second.result.revision).toBe(2); expect(await f.settings.get(f.scope)).toEqual(before);
    expect((await sql`SELECT id FROM flow_versions WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(1);
    const detail = await f.authoring.native.detail(f.scope, f.actor, String(first.result.workspaceId)); expect(detail.revisions.map((r) => r.revision)).toEqual([2, 1]); expect(detail.revisions[1]?.definition).toEqual(definition);
    expect((await f.onboarding.session(f.scope, session.id)).flow_version_id).toBe(session.flow_version_id);
    await expect(sql`UPDATE onboarding_flow_drafts SET content_hash=content_hash WHERE ${tenant(f.scope)}`.execute(db)).rejects.toThrow("immutable");
  });
  it("joins the caller transaction and rolls both draft header and revision back", async () => {
    const f = await fixture(); await expect(db.transaction().execute(async (tx) => {await f.authoring.native.saveInTransaction(tx, f.scope, f.actor, f.save); throw new Error("caller rollback");})).rejects.toThrow("caller rollback");
    expect((await sql`SELECT id FROM onboarding_flow_workspaces WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
    expect((await sql`SELECT id FROM onboarding_flow_drafts WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  });
  it("publishes exactly once through the native allocator while keeping active sessions and enablement", async () => {
    const f = await fixture(), session = await f.onboarding.start(f.scope, "878822222222222222", new Date(), "TEST"), saved = await execute(f, f.save), input = await publication(f, String(saved.result.workspaceId)), prepared = await f.authoring.prepare(f.scope, f.actor, input), result = await f.authoring.mutate(f.scope, f.actor, prepared.key, input);
    expect(await f.authoring.mutate(f.scope, f.actor, prepared.key, input)).toEqual(result); expect(result.state).toBe("PUBLISHED");
    const current = await f.settings.get(f.scope); expect(current.flowVersionId).toBe(result.flowVersionId); expect(current.enabled).toBe(f.published.enabled); expect(current.onboardingEnabled).toBe(f.published.onboardingEnabled); expect(current.hybrid).toEqual(f.published.hybrid);
    expect((await f.onboarding.session(f.scope, session.id)).flow_version_id).toBe(session.flow_version_id);
    const rollback = await f.onboarding.rollback(f.scope, f.actor, current.revision, f.published.flowVersionId!); expect(rollback.revision).toBe(current.revision + 1);
    expect((await sql<{version: number}>`SELECT version FROM flow_versions WHERE ${tenant(f.scope)} ORDER BY version`.execute(db)).rows.map((r) => r.version)).toEqual([1, 2, 3]);
  });
  it("publishes hybrid only without enabling hybrid or replacing the main head", async () => {
    const f = await fixture(), saved = await execute(f, {...f.save, slot: "HYBRID", baseFlowId: null}), input = await publication(f, String(saved.result.workspaceId)), result = await execute(f, input), current = await f.settings.get(f.scope);
    expect(current.flowVersionId).toBe(f.published.flowVersionId); expect(current.hybrid.flowVersionId).toBe(result.result.flowVersionId); expect(current.hybrid.enabled).toBe(f.published.hybrid.enabled); expect(current.onboardingMode).toBe(f.published.onboardingMode);
  });
  it("rejects stale base settings, stale workspace CAS and foreign guild access", async () => {
    const f = await fixture(), other = await fixture(), saved = await execute(f, f.save), input = await publication(f, String(saved.result.workspaceId));
    await expect(f.authoring.prepare(f.scope, f.actor, {...f.save, workspaceId: String(saved.result.workspaceId), expectedRevision: 2})).rejects.toThrow("ONBOARDING_DRAFT_VERSION_MISMATCH");
    await expect(other.authoring.native.detail(other.scope, other.actor, String(saved.result.workspaceId))).rejects.toThrow("ONBOARDING_DRAFT_NOT_FOUND");
    await f.settings.update(f.scope, f.actor, f.published.revision, {helperEnabled: false}); await expect(f.authoring.prepare(f.scope, f.actor, input)).rejects.toThrow("ONBOARDING_FLOW_BASE_CONFLICT"); expect((await sql`SELECT id FROM flow_versions WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(1);
  });
  it("checks trusted current scope/actor/proof again after awaited access", async () => {
    const f = await fixture(); for (const authorization of [undefined, {...f.authorization, actorHash: "other"}, {...f.authorization, scope: {...f.scope, guildId: "878899999999999999"}}, {...f.authorization, expiresAt: new Date(0)}]) await expect(new OnboardingFlowDrafts(db, {authorization, authorize: async () => undefined}).list(f.scope, f.actor)).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
    const delayed = new OnboardingFlowDrafts(db, {authorization: f.authorization, authorize: async () => {f.authorization.expiresAt = new Date(0);}}); await expect(delayed.list(f.scope, f.actor)).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
  });
  it("rolls native publication and audit back if final authorization expires", async () => {
    const f = await fixture(), saved = await execute(f, f.save), input = await publication(f, String(saved.result.workspaceId)); let writes = 0;
    await expect(f.authoring.native.transaction(f.scope, f.actor, "CONFIGURE", (tx) => f.authoring.native.commitInTransaction(tx, f.scope, f.actor, input, async () => {if (++writes === 2) f.authorization.expiresAt = new Date(0);}))).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
    expect((await sql`SELECT id FROM flow_versions WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(1); expect(await f.settings.get(f.scope)).toEqual(f.published);
  });
  it("keeps Discord target probes outside the canonical transaction and skips all probes on completed replay", async () => {
    const f = await fixture(), role = "878833333333333333", withRole = {...f.save, definition: {...definition, nodes: [{...definition.nodes[0]!, options: [{...definition.nodes[0]!.options[0]!, roleId: role}]}]}};
    const probe = vi.spyOn(f.discord, "validateRole").mockImplementation(async () => {await db.transaction().execute(async (tx) => {for (const item of scopeLockIds(ruleScopeLockSet(f.scope))) expect((await sql<{ok: boolean}>`SELECT pg_try_advisory_xact_lock(${item.id}::bigint) AS ok`.execute(tx)).rows[0]?.ok).toBe(true);});});
    const saved = await execute(f, withRole), input = await publication(f, String(saved.result.workspaceId)), prepared = await f.authoring.prepare(f.scope, f.actor, input); await f.authoring.mutate(f.scope, f.actor, prepared.key, input); const count = probe.mock.calls.length; expect(count).toBe(2); await f.authoring.mutate(f.scope, f.actor, prepared.key, input); expect(probe).toHaveBeenCalledTimes(count);
  });
  it("does not re-probe claimed unknown requests or resurrect erased request identities", async () => {
    const f = await fixture(), request = await f.authoring.prepare(f.scope, f.actor, f.save); await sql`UPDATE lifecycle_web_requests SET state='CLAIMED' WHERE ${tenant(f.scope)} AND id=${request.key}::uuid`.execute(db);
    const probe = vi.spyOn(f.discord, "validateRole"); await expect(f.authoring.mutate(f.scope, f.actor, request.key, f.save)).rejects.toThrow("LIFECYCLE_RESULT_UNKNOWN"); expect(probe).not.toHaveBeenCalled(); await sql`DELETE FROM lifecycle_web_requests WHERE ${tenant(f.scope)} AND id=${request.key}::uuid`.execute(db); await expect(f.authoring.mutate(f.scope, f.actor, request.key, f.save)).rejects.toThrow("LIFECYCLE_REQUEST_GONE");
  });
  it("native typed adapter creates only an immutable draft and rejects a changed target token", async () => {
    const f = await fixture(), adapter = createOnboardingFlowDraftAdapter(db, f.authorization), current = await f.authoring.native.transaction(f.scope, f.actor, "READ", (tx) => f.authoring.native.current(tx, f.scope, f.published.flowVersionId));
    await db.transaction().execute(async (tx) => {await adapter.lockCurrent(tx, f.scope, current.id!); expect(await adapter.createDraft(tx, f.scope, f.actor, current.id!, onboardingFlowTargetVersion(current), {definition})).toMatchObject({immutableRevisionId: expect.any(String)});});
    await expect(db.transaction().execute(async (tx) => {await adapter.lockCurrent(tx, f.scope, current.id!); return adapter.createDraft(tx, f.scope, f.actor, current.id!, "stale", {definition});})).rejects.toThrow("TARGET_VERSION_MISMATCH"); expect(await f.settings.get(f.scope)).toEqual(f.published);
  });
  it("removes configuration copies while leaving published native versions and sessions intact", async () => {
    const f = await fixture(), userId = "878844444444444444", first = await execute(f, {...f.save, definition: {...definition, nodes: [{...definition.nodes[0]!, question: `Synthetic reference <@${userId}>`}]}}), second = await execute(f, f.save); await db.transaction().execute((tx) => purgeOnboardingFlowDrafts(tx, f.scope, userId));
    await expect(f.authoring.native.detail(f.scope, f.actor, String(first.result.workspaceId))).rejects.toThrow("ONBOARDING_DRAFT_NOT_FOUND"); expect((await f.authoring.native.list(f.scope, f.actor)).items).toHaveLength(1);
    await execute(f, {operation: "FLOW_DRAFT_DELETE", workspaceId: String(second.result.workspaceId), expectedRevision: 1}); expect((await sql`SELECT id FROM flow_versions WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(1);
  });
});
