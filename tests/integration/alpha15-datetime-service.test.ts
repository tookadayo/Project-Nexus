import {createHash,randomUUID} from "node:crypto";
import Fastify from "fastify";
import {afterAll, beforeAll, expect, it, vi} from "vitest";
import {connect, ensureGuild, json, migrate, sql, tenant, type Database} from "../../packages/db/src/index";
import {IdentityVault} from "../../packages/identity/src/index";
import {apiToken, scopeForGuild} from "../../packages/security/src/scoping";
import {createPublicApiProof} from "../../packages/security/src/public-api";
import {PublicSessions} from "../../packages/security/src/public-sessions";
import {isDomainError} from "../../packages/shared/src/index";
import {semanticHash} from "../../packages/automation/src/definition";
import {AutomationService} from "../../packages/automation/src/service";
import {AutomationRuntime} from "../../packages/automation/src/runtime";
import type {Actor} from "../../packages/settings/src/index";
import {registerAlpha15Automation} from "../../apps/api/src/alpha15-automation";
import type {FlowDefinition, JsonValue, ValueType} from "../../packages/automation/src/types";
import {FakeDiscord} from "../fixtures/discord";
import {isolatedPostgres} from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
const key = "synthetic-datetime-api", secret = "t".repeat(64), user = "884111111111111111";
const vault = new IdentityVault("ab".repeat(32), "cd".repeat(32));
const precise = "2026-10-16T08:15:42.123Z";
beforeAll(async () => {
  vi.stubEnv("NEXUS_HOSTED_BETA", "off"); vi.stubEnv("NEXUS_SESSION_SECRET", secret); vi.stubEnv("NEXUS_WEB_URL", "https://nexus.example");
  infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db);
});
afterAll(async () => {await db?.destroy(); await infra?.stop(); vi.unstubAllEnvs();});

async function fixture(clock?: {now: Date}) {
  const s = scopeForGuild(String(885700000000000000n + BigInt(++serial))); await ensureGuild(db, s);
  await sql`INSERT INTO server_web_links(organization_id,guild_id,verified_at,updated_at,revision) VALUES(${s.organizationId}::uuid,${s.guildId},now(),now(),${randomUUID()}::uuid)`.execute(db);
  const discord = new FakeDiscord(); discord.members.set(user, {permissions: "32", roles: [], joinedAt: "2026-01-01T00:00:00Z", bot: false});
  const sessions = new PublicSessions(db, secret, async () => {throw new Error("Unexpected refresh");});
  const reference = await sessions.create(user, {accessToken: "synthetic"}, 3600), app = Fastify();
  app.setErrorHandler((error, _req, reply) => reply.code(isDomainError(error) ? error.status : 400).send({error: isDomainError(error) ? error.code : "VALIDATION"}));
  const service = registerAlpha15Automation(app, db, key, discord, vault, {...(clock ? {now: () => clock.now} : {}), admission: {activeFlows: 3, monthlyRuns: 20, guildConcurrent: 1, globalConcurrent: 2, guildPending: 10, globalPending: 100, measurementId: "isolated-datetime-contract"}});
  const base = `/v3/organizations/${s.organizationId}/guilds/${s.guildId}/automation`;
  const definition: FlowDefinition = {schemaVersion: 1, id: "datetime", guildId: s.guildId, name: "Date/time service", trigger: {kind: "manual", inputs: []}, variables: [], body: [{kind: "end", id: "end"}]};
  async function call(method: "GET" | "PUT" | "POST", suffix: string, body?: unknown, headers: Record<string, string> = {}) {
    const path = base + suffix;
    return app.inject({method, url: path, headers: {authorization: `Bearer ${apiToken(key, s)}`, "x-nexus-user-proof": createPublicApiProof({scope: s, userId: user, sessionReference: reference, method, path, body, ...(method !== "GET" ? {origin: "https://nexus.example"} : {})}), ...(method !== "GET" ? {origin: "https://nexus.example", "content-type": "application/json"} : {}), ...headers}, ...(body === undefined ? {} : {payload: JSON.stringify(body)})});
  }
  const save = (value: FlowDefinition, expectedRevision = 0) => call("PUT", `/flows/${value.id}/draft`, {definition: value, expectedRevision, requestId: randomUUID()});
  return {s, app, discord, service, definition, call, save};
}
function withValue(base: FlowDefinition, type: ValueType, value: JsonValue): FlowDefinition {
  return {...structuredClone(base), body: [{kind: "declare", id: "saved-value", variable: {id: "saved-value", name: "Saved value", type}, value: {kind: "literal", type, value}}]};
}
async function seedRetainedRevision(f: Awaited<ReturnType<typeof fixture>>, saved: FlowDefinition) {
  // Model an already retained revision without passing old precision through the new edit gate.
  expect((await f.save(f.definition)).statusCode).toBe(200);
  await sql`UPDATE automation_revisions SET definition=${json(saved)},semantic_hash=${semanticHash(saved)},complete=true WHERE ${tenant(f.s)} AND flow_id=${saved.id} AND revision=1`.execute(db);
}

it("DT10 returns only an actually saved guild region, preserving the missing/legacy distinction", async () => {
  const f = await fixture(), other = await fixture(); try {
    const missing = await f.call("GET", "/time-zone");
    expect(missing.statusCode).toBe(200); expect(missing.headers["cache-control"]).toBe("no-store");
    expect(missing.json()).toEqual({timeZone: null, source: "missing", revision: 0});
    expect((await sql`SELECT 1 FROM guild_settings WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
    await sql`INSERT INTO guild_settings(organization_id,guild_id,revision,settings) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},3,${json({uiLanguage: "ja"})})`.execute(db);
    expect((await f.call("GET", "/time-zone")).json()).toEqual({timeZone: null, source: "legacy", revision: 3});
    await sql`UPDATE guild_settings SET settings=${json({timezone: "America/New_York"})},revision=4 WHERE ${tenant(f.s)}`.execute(db);
    expect((await f.call("GET", "/time-zone")).json()).toEqual({timeZone: "America/New_York", source: "saved", revision: 4});
    expect((await other.call("GET", "/time-zone")).json()).toEqual({timeZone: null, source: "missing", revision: 0});
    await sql`UPDATE guild_settings SET settings=${json({timezone: "UTC"})},revision=5 WHERE ${tenant(f.s)}`.execute(db);
    expect((await f.call("GET", "/time-zone")).json()).toEqual({timeZone: "UTC", source: "saved", revision: 5});
  } finally {await f.app.close(); await other.app.close();}
});

it("DT10 requires current real-user READ authorization for the time-zone endpoint", async () => {
  const f = await fixture(); try {
    expect((await f.call("GET", "/time-zone", undefined, {"x-nexus-user-proof": ""})).statusCode).toBe(401);
    f.discord.members.get(user)!.permissions = "0";
    expect((await f.call("GET", "/time-zone")).statusCode).toBe(403);
    expect((await sql`SELECT 1 FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  } finally {await f.app.close();}
});

it("DT10 reports malformed raw guild regions as unconfirmed after the service READ gate", async () => {
  const f = await fixture(); try {
    const authorize = vi.fn(async () => {}), service = new AutomationService(db, {authorize});
    const actor: Actor = {key: createHash("sha256").update("synthetic-zone-reader").digest("hex"), permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: randomUUID()};
    await sql`INSERT INTO guild_settings(organization_id,guild_id,revision,settings) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},6,${json({timezone: "No/Such_Zone"})})`.execute(db);
    expect(await service.timeZonePreference(f.s, actor)).toEqual({timeZone: null, source: "invalid", revision: 6});
    expect(authorize).toHaveBeenCalledWith(db, f.s, actor, "READ");
    expect((await sql<{settings: {timezone: string}}>`SELECT settings FROM guild_settings WHERE ${tenant(f.s)}`.execute(db)).rows[0]!.settings.timezone).toBe("No/Such_Zone");
  } finally {await f.app.close();}
});

it("DT03 preserves an existing exact millisecond literal but rejects a newly introduced or changed fraction", async () => {
  const f = await fixture(); try {
    const retained = withValue(f.definition, "Instant", precise);
    expect((await f.save(retained)).statusCode).toBe(400);
    expect((await sql`SELECT 1 FROM automation_flows WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
    await seedRetainedRevision(f, retained);
    const renamed = {...retained, name: "Renamed retained value"}, saved = await f.save(renamed, 1);
    expect(saved.statusCode).toBe(200); expect(saved.json().definition).toEqual(renamed);
    const loaded = await f.call("GET", "/flows/datetime");
    expect(loaded.statusCode).toBe(200); expect(loaded.json().definition).toEqual(renamed); expect(loaded.json().validation.valid).toBe(true);
    expect((await f.save(withValue(renamed, "Instant", "2026-10-16T08:15:42.124Z"), 2)).statusCode).toBe(400);
    expect((await f.save(withValue(renamed, "Instant", "2026-10-16T08:15:42.000Z"), 2)).statusCode).toBe(200);
  } finally {await f.app.close();}
});

it("DT03 cannot borrow fixed-value authority from another flow, another guild, or a client capability", async () => {
  const f = await fixture(), other = await fixture(); try {
    const retained = withValue(f.definition, "Instant", precise); await seedRetainedRevision(f, retained);
    expect((await f.save({...retained, id: "copied"})).statusCode).toBe(400);
    expect((await other.save({...retained, guildId: other.s.guildId})).statusCode).toBe(400);
    const forged = {...retained, id: "forged", temporalResolution: "fixed", fixedTemporalValues: [precise]};
    expect((await f.call("PUT", "/flows/forged/draft", {definition: forged, expectedRevision: 0, requestId: randomUUID()})).statusCode).toBe(400);
    f.discord.members.get(user)!.permissions = "0";
    expect((await f.save({...retained, name: "Unauthorized edit"}, 1)).statusCode).toBe(403);
    expect((await sql<{draft_revision: number}>`SELECT draft_revision FROM automation_flows WHERE ${tenant(f.s)} AND id='datetime'`.execute(db)).rows[0]!.draft_revision).toBe(1);
  } finally {await f.app.close(); await other.app.close();}
});

it("DT11 validates trusted saved zoned meaning internally without re-resolving it through current tzdb", async () => {
  const f = await fixture(); try {
    // The retained snapshot is internally consistent; current New York July rules use -04:00.
    const historical = withValue(f.definition, "ZonedDateTimeSpec", {date: "2027-07-01", time: "01:30", timeZone: "America/New_York", instant: "2027-07-01T06:30:00.000Z", offset: "-05:00"});
    expect((await f.save(historical)).statusCode).toBe(400);
    await seedRetainedRevision(f, historical);
    const loaded = await f.call("GET", "/flows/datetime");
    expect(loaded.statusCode).toBe(200); expect(loaded.json().definition).toEqual(historical); expect(loaded.json().validation.valid).toBe(true);
    expect((await f.save({...historical, name: "Retained under changed rules"}, 1)).statusCode).toBe(200);
    const checked = await f.call("POST", "/flows/datetime/validate", {revision: 2});
    expect(checked.statusCode).toBe(200); expect(checked.json().valid).toBe(true);
    const simulation = await f.call("POST", "/flows/datetime/test", {revision: 2});
    expect(simulation.statusCode).toBe(200); expect(simulation.json().status).toBe("COMPLETED");
  } finally {await f.app.close();}
});

it("DT11 does not apply a stored definition's fixed-value capability to a fresh simulation input", async () => {
  const f = await fixture(); try {
    const definition = structuredClone(f.definition);
    definition.trigger = {kind: "manual", inputs: [{id: "at", name: "At", type: "ZonedDateTimeSpec"}]};
    expect((await f.save(definition)).statusCode).toBe(200);
    const forged = {type: "ZonedDateTimeSpec", value: {date: "2027-07-01", time: "01:30", timeZone: "America/New_York", instant: "2027-07-01T06:30:00.000Z", offset: "-05:00"}};
    const result = await f.call("POST", "/flows/datetime/test", {revision: 1, simulation: {values: {at: forged}}});
    expect(result.statusCode).toBe(200); expect(result.json()).toMatchObject({valid: true, status: "FAILED", externalChanges: 0, productionRuns: 0});
    expect(result.json().steps).toContainEqual(expect.objectContaining({kind: "error", code: "ZONED_MEANING"}));
    expect((await sql`SELECT 1 FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  } finally {await f.app.close();}
});

it.each([
  ["input", {values: {at: {type: "Instant", value: precise}}}],
  ["output", {outputs: {out: {type: "Instant", value: precise}}}],
  ["poll output", {pollReads: {poll: [{output: {type: "Instant", value: precise}}]}}],
  ["clock", {clock: precise}],
  ["event occurrence", {awaitEvents: {event: {state: "MATCHED", value: {state: "OPEN", version: 1}, occurredAt: precise}}}],
])("DT03 rejects newly supplied millisecond precision in a simulation %s at the API boundary", async (_label, simulation) => {
  const f = await fixture(); try {
    expect((await f.save(f.definition)).statusCode).toBe(200);
    const response = await f.call("POST", "/flows/datetime/test", {revision: 1, simulation});
    expect(response.statusCode).toBe(400); expect(response.json().error).toBe("AUTOMATION_TEMPORAL_INPUT_PRECISION");
    expect((await sql`SELECT 1 FROM automation_checks WHERE ${tenant(f.s)} AND kind='TEST'`.execute(db)).rows).toHaveLength(0);
    expect((await sql`SELECT 1 FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  } finally {await f.app.close();}
});

it("DT03 rejects a new fractional manual input while retaining internal clock and Wait milliseconds across restart", async () => {
  const clock = {now: new Date("2026-10-16T08:15:42.123Z")}, f = await fixture(clock); try {
    const definition: FlowDefinition = {...f.definition, trigger: {kind: "manual", inputs: [{id: "at", name: "At", type: "Instant"}]}, body: [
      {kind: "readClock", id: "clock", output: {id: "clock-value", name: "Clock", type: "Instant"}},
      {kind: "wait", id: "wait", duration: {kind: "literal", type: "Duration", value: 0.125}},
      {kind: "end", id: "end"},
    ]};
    const saved = await f.save(definition); expect(saved.statusCode).toBe(200);
    expect((await f.call("POST", "/flows/datetime/validate", {revision: 1})).statusCode).toBe(200);
    const mock = await f.call("POST", "/flows/datetime/test", {revision: 1, simulation: {values: {at: {type: "Instant", value: "2026-10-16T08:15:42.000Z"}}}});
    expect(mock.statusCode).toBe(200); expect(mock.json().status).toBe("COMPLETED");
    expect((await f.call("POST", "/flows/datetime/impact", {revision: 1})).statusCode).toBe(200);
    expect((await f.call("POST", "/flows/datetime/enable", {revision: 1, semanticHash: saved.json().validation.semanticHash, requestId: randomUUID()})).statusCode).toBe(200);
    const rejected = await f.call("POST", "/flows/datetime/runs", {requestId: randomUUID(), values: {at: {type: "Instant", value: precise, provenance: []}}});
    expect(rejected.statusCode).toBe(400); expect(rejected.json().error).toBe("AUTOMATION_TEMPORAL_INPUT_PRECISION");
    expect((await sql`SELECT 1 FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
    const request = {requestId: randomUUID(), values: {at: {type: "Instant", value: "2026-10-16T08:15:42.000Z", provenance: []}}};
    const started = await f.call("POST", "/flows/datetime/runs", request); expect(started.statusCode).toBe(200);
    const runId = started.json().id as string;
    const options = {admission: f.service.limits, adapter: {authorize: async () => {}, execute: async () => {throw new Error("Unexpected external effect");}}, now: () => clock.now};
    expect(await new AutomationRuntime(db, options).tick(f.s, runId)).toMatchObject({state: "WAITING"});
    const waiting = (await f.service.store.run(f.s, runId))!;
    expect(waiting.started_at.toISOString()).toBe(precise); expect(waiting.resume.startedAt).toBe(precise);
    expect(waiting.resume.variables["clock-value"]?.value).toBe(precise);
    expect(waiting.wake_at?.toISOString()).toBe("2026-10-16T08:15:42.248Z");
    clock.now = new Date("2026-10-16T08:15:42.248Z");
    expect(await new AutomationRuntime(db, options).tick(f.s, runId)).toMatchObject({state: "COMPLETED"});
    expect((await f.call("POST", "/flows/datetime/runs", request)).json()).toMatchObject({id: runId, state: "EXISTING"});
    expect((await sql`SELECT 1 FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(1);
  } finally {await f.app.close();}
});

it("DT11 preserves a trusted calendar-range snapshot while requiring fresh nonexistent dates to be corrected", async () => {
  const f = await fixture(); try {
    const historical = withValue(f.definition, "DateRange", {start: "2011-12-30", end: "2011-12-30", timeZone: "Pacific/Apia", boundaryRule: "firstValidEarlier"});
    expect((await f.save(historical)).statusCode).toBe(400);
    await seedRetainedRevision(f, historical);
    const saved = await f.save({...historical, name: "Preserved calendar meaning"}, 1);
    expect(saved.statusCode).toBe(200); expect(saved.json().validation.valid).toBe(true);
    const read = await f.call("GET", "/flows/datetime");
    expect(read.statusCode).toBe(200); expect(read.json().definition.body).toEqual(historical.body);
    expect((await f.call("POST", "/flows/datetime/validate", {revision: 2})).json().valid).toBe(true);
  } finally {await f.app.close();}
});
