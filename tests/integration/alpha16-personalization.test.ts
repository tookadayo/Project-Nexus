import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connect, ensureGuild, json, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import type { Actor } from "../../packages/settings/src/index";
import type { FlowDefinition } from "../../packages/automation/src/types";
import { PersonalizationService, purgePersonalizationActor, purgePersonalizationGuild, type PersonalizationMutation, type PersonalizationPolicy } from "../../packages/operations/src/alpha16-personalization";
import { isolatedPostgres } from "../fixtures/postgres";
import { z } from "zod";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
beforeAll(async () => {vi.stubEnv("NEXUS_HOSTED_BETA", "off"); infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db);});
afterAll(async () => {await db?.destroy(); await infra?.stop(); vi.unstubAllEnvs();});
const policy: PersonalizationPolicy = {revision: "synthetic-policy-only", classes: {
  TEMPLATE_DEFINITION: {seconds: 3600, approvalReference: "fixture-only"},
  PERSONAL_PREFERENCE: {seconds: 3600, approvalReference: "fixture-only"},
  PERSONALIZATION_REQUEST: {seconds: 300, approvalReference: "fixture-only"},
}};
const actor = (key: string): Actor => ({key: createHash("sha256").update(key).digest("hex"), permissions: "0", roles: [], source: "WEB_DASHBOARD", requestId: randomUUID()});
async function fixture() {
  const scope = scopeForGuild(String(883300000000000000n + BigInt(++serial))); await ensureGuild(db, scope);
  const user = actor("synthetic-alice"), other = actor("synthetic-bob"), sourceId = `source-${randomUUID()}`;
  const definition: FlowDefinition = {schemaVersion: 1, id: sourceId, name: "Source", guildId: scope.guildId, trigger: {kind: "manual", inputs: []}, variables: [], body: [{kind: "end", id: "end"}]};
  await sql`INSERT INTO automation_flows(organization_id,guild_id,id,name,draft_revision,active_revision,state) VALUES(${scope.organizationId}::uuid,${scope.guildId},${sourceId},'Source',1,1,'ACTIVE')`.execute(db);
  await sql`INSERT INTO automation_revisions(organization_id,guild_id,flow_id,revision,definition,semantic_hash,complete) VALUES(${scope.organizationId}::uuid,${scope.guildId},${sourceId},1,${json(definition)},${"a".repeat(64)},true)`.execute(db);
  const authorize = vi.fn(async () => undefined);
  const authorization = {scope, actorHash: user.key, expiresAt: new Date(Date.now() + 60000)};
  const service = new PersonalizationService(db, {policy, authorize, authorization});
  const forActor = (currentActor = user, currentScope = scope) => new PersonalizationService(db, {policy, authorize, authorization: {scope: currentScope, actorHash: currentActor.key, expiresAt: new Date(Date.now() + 60000)}});
  return {scope, user, other, sourceId, definition, authorize, authorization, service, forActor};
}
async function execute(f: Awaited<ReturnType<typeof fixture>>, input: PersonalizationMutation, user = f.user) {
  const prepared = await f.service.prepare(f.scope, user, input);
  return {prepared, result: await f.service.mutate(f.scope, user, prepared.key, input)};
}
async function create(f: Awaited<ReturnType<typeof fixture>>) {
  const created=await execute(f, {operation: "TEMPLATE_CREATE", name: "Reusable welcome", sourceFlowId: f.sourceId, sourceRevision: 1});
  return {...created,result:templateResult.parse(created.result)};
}
const templateResult=z.object({templateId:z.uuid(),version:z.number().int().positive()}).passthrough();

describe("alpha16 Templates and private Preference Center", () => {
  it("requires a trusted current proof for reads and rejects wrong actor, guild and elapsed deadlines", async () => {
    const f = await fixture();
    for (const authorization of [undefined, {...f.authorization, actorHash: f.other.key}, {...f.authorization, scope: {...f.scope, guildId: "883399999999999999"}}, {...f.authorization, expiresAt: new Date(0)}]) {
      const service = new PersonalizationService(db, {policy, authorize: f.authorize, authorization});
      await expect(service.preferences(f.scope, f.user)).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
    }
  });
  it("rechecks proof after awaited authorization and before the final template write", async () => {
    const f = await fixture(), expiredDuringAccess = new PersonalizationService(db, {policy, authorization: f.authorization, authorize: async () => {f.authorization.expiresAt = new Date(0);}});
    await expect(expiredDuringAccess.preferences(f.scope, f.user)).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
    f.authorization.expiresAt = new Date(Date.now() + 60000);
    const input: PersonalizationMutation = {operation: "TEMPLATE_CREATE", name: "Deadline test", sourceFlowId: f.sourceId, sourceRevision: 1}, prepared = await f.service.prepare(f.scope, f.user, input);
    const source = f.service as unknown as {definition: (...args: unknown[]) => Promise<FlowDefinition>}, original = source.definition.bind(source);
    vi.spyOn(source, "definition").mockImplementationOnce(async (...args) => {const validated = await original(...args); f.authorization.expiresAt = new Date(0); return validated;});
    await expect(f.service.mutate(f.scope, f.user, prepared.key, input)).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
    expect((await sql`SELECT 1 FROM automation_template_definitions WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  });
  it("keeps new persistence disabled without purpose-specific policies", async () => {
    const f = await fixture(), disabled = new PersonalizationService(db, {authorize: f.authorize, authorization: f.authorization});
    expect((await disabled.templates(f.scope, f.user)).readiness.enabled).toBe(false);
    expect((await disabled.preferences(f.scope, f.user)).settings).toEqual({suggestionDisplay: "SHOW", personalNotifications: "UNCHANGED"});
    await expect(disabled.prepare(f.scope, f.user, {operation: "PREFERENCE_SAVE", expectedVersion: 0, settings: {suggestionDisplay: "HIDE", personalNotifications: "MUTED"}})).rejects.toThrow("PERSONALIZATION_RETENTION_UNCONFIGURED");
    expect((await sql`SELECT 1 FROM personal_preferences WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  });
  it("stores immutable template versions, edits, copies and deletes without changing source live revision", async () => {
    const f = await fixture(), first = await create(f), id = String(first.result.templateId);
    expect(first.result).toMatchObject({version: 1, state: "ACTIVE"});
    const viewed = await f.service.templates(f.scope, f.user, id); expect(viewed.definition).toEqual(f.definition);
    await execute(f, {operation: "TEMPLATE_UPDATE", templateId: id, expectedVersion: 1, name: "Renamed"});
    expect((await f.service.templates(f.scope, f.user, id)).items[0]).toMatchObject({name: "Renamed", version: 2});
    const revisions = (await sql<{version: number}>`SELECT version FROM automation_template_revisions WHERE ${tenant(f.scope)} AND template_id=${id}::uuid ORDER BY version`.execute(db)).rows;
    expect(revisions.map((row) => row.version)).toEqual([1, 2]);
    const copy = await execute(f, {operation: "TEMPLATE_COPY", templateId: id, expectedVersion: 2, name: "Independent copy"});
    const copied=templateResult.parse(copy.result);expect(copied.templateId).not.toBe(id); expect(copied.version).toBe(1);
    const removed = await execute(f, {operation: "TEMPLATE_DELETE", templateId: id, expectedVersion: 2});
    await expect(f.service.templates(f.scope, f.user, id)).rejects.toThrow("TEMPLATE_NOT_FOUND");
    expect((await sql`SELECT 1 FROM automation_template_revisions WHERE ${tenant(f.scope)} AND template_id=${id}::uuid`.execute(db)).rows).toHaveLength(0);
    expect(await f.service.mutate(f.scope, f.user, removed.prepared.key, {operation: "TEMPLATE_DELETE", templateId: id, expectedVersion: 2})).toEqual(removed.result);
    expect((await sql<{active_revision: number; state: string}>`SELECT active_revision,state FROM automation_flows WHERE ${tenant(f.scope)} AND id=${f.sourceId}`.execute(db)).rows[0]).toEqual({active_revision: 1, state: "ACTIVE"});
  });
  it("uses AutomationService.save for one new draft and never activates or starts a run", async () => {
    const f = await fixture(), created = await create(f), input: PersonalizationMutation = {operation: "TEMPLATE_DRAFT", templateId: String(created.result.templateId), expectedVersion: 1, draftName: "My new draft"};
    const applied = await execute(f, input); expect(applied.result).toMatchObject({draftRevision: 1, state: "DRAFT", activated: false});
    expect(await f.service.mutate(f.scope, f.user, applied.prepared.key, input)).toEqual(applied.result);
    const row = (await sql<{active_revision: number | null; state: string; draft_revision: number}>`SELECT active_revision,state,draft_revision FROM automation_flows WHERE ${tenant(f.scope)} AND id=${String(applied.result.flowId)}`.execute(db)).rows[0];
    expect(row).toEqual({active_revision: null, state: "DRAFT", draft_revision: 1});
    expect((await sql`SELECT 1 FROM automation_runs WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  });
  it("keeps preferences private to actor and guild with versioned save/reset", async () => {
    const f = await fixture();
    await execute(f, {operation: "PREFERENCE_SAVE", expectedVersion: 0, settings: {suggestionDisplay: "HIDE", personalNotifications: "MUTED"}});
    expect((await f.service.preferences(f.scope, f.user)).settings.suggestionDisplay).toBe("HIDE");
    expect((await f.forActor(f.other).preferences(f.scope, f.other)).settings.suggestionDisplay).toBe("SHOW");
    const otherScope = (await fixture()).scope;
    expect((await f.forActor(f.user, otherScope).preferences(otherScope, f.user)).version).toBe(0);
    await execute(f, {operation: "PREFERENCE_RESET", expectedVersion: 1});
    expect(await f.service.preferences(f.scope, f.user)).toMatchObject({version: 2, source: "DEFAULT", settings: {suggestionDisplay: "SHOW", personalNotifications: "UNCHANGED"}});
  });
  it("rejects other actors, other guilds, stale versions, disappeared keys and altered payloads", async () => {
    const f = await fixture(), created = await create(f), id = String(created.result.templateId);
    const input: PersonalizationMutation = {operation: "TEMPLATE_UPDATE", templateId: id, expectedVersion: 1, name: "Updated"};
    const prepared = await f.service.prepare(f.scope, f.user, input);
    await expect(f.forActor(f.other).mutate(f.scope, f.other, prepared.key, input)).rejects.toThrow("PERSONALIZATION_REQUEST_GONE");
    const foreignScope = (await fixture()).scope;
    await expect(f.forActor(f.user, foreignScope).mutate(foreignScope, f.user, prepared.key, input)).rejects.toThrow("PERSONALIZATION_REQUEST_GONE");
    await expect(f.service.mutate(f.scope, f.user, prepared.key, {...input, name: "Changed body"})).rejects.toThrow("PERSONALIZATION_REQUEST_MISMATCH");
    await execute(f, input);
    await expect(f.service.mutate(f.scope, f.user, prepared.key, input)).rejects.toThrow("TEMPLATE_VERSION_MISMATCH");
    const pref: PersonalizationMutation = {operation: "PREFERENCE_SAVE", expectedVersion: 0, settings: {suggestionDisplay: "HIDE", personalNotifications: "UNCHANGED"}};
    const gone = await f.service.prepare(f.scope, f.user, pref);
    await sql`DELETE FROM personalization_requests WHERE ${tenant(f.scope)} AND id=${gone.key}::uuid`.execute(db);
    await expect(f.service.mutate(f.scope, f.user, gone.key, pref)).rejects.toThrow("PERSONALIZATION_REQUEST_GONE");
  });
  it("serializes version competition and removes personal state through privacy hooks", async () => {
    const f = await fixture(), input: PersonalizationMutation = {operation: "PREFERENCE_SAVE", expectedVersion: 0, settings: {suggestionDisplay: "HIDE", personalNotifications: "MUTED"}};
    const [a, b] = await Promise.all([f.service.prepare(f.scope, f.user, input), f.service.prepare(f.scope, f.user, input)]);
    const outcomes = await Promise.allSettled([f.service.mutate(f.scope, f.user, a.key, input), f.service.mutate(f.scope, f.user, b.key, input)]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await db.transaction().execute((tx) => purgePersonalizationActor(tx, f.scope, f.user.key));
    expect((await f.service.preferences(f.scope, f.user)).version).toBe(0);
    expect((await sql`SELECT 1 FROM personalization_requests WHERE ${tenant(f.scope)} AND actor_hash=${f.user.key}`.execute(db)).rows).toHaveLength(0);
    await db.transaction().execute((tx) => purgePersonalizationGuild(tx, f.scope));
  });
});
