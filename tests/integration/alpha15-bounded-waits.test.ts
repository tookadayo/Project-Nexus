import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { connect, migrate, ensureGuild, sql, tenant, type Database } from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import { AutomationService } from "../../packages/automation/src/service";
import { AutomationRuntime, type AutomationRuntimeAdapter } from "../../packages/automation/src/runtime";
import type { Actor } from "../../packages/settings/src/index";
import type { FlowDefinition, Statement, ValueInput, ValueType } from "../../packages/automation/src/types";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
const channel = "885333333333333333", role = "885444444444444444", member = "885555555555555555";
const recordType: ValueType = { kind: "Record", schemaId: "nexus.ticket.status.v1" };
const states: ValueType = { kind: "Enum", values: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "SNOOZED", "RESOLVED", "DISMISSED"] };
const admission = { activeFlows: 20, monthlyRuns: 100, guildConcurrent: 2, globalConcurrent: 20, guildPending: 20, globalPending: 100, measurementId: "isolated-bounded-read-tests" };
const actor: Actor = { key: createHash("sha256").update("synthetic").digest("hex"), encryptedUserId: "synthetic-encrypted-identity", permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: "synthetic" };
beforeAll(async () => { vi.stubEnv("NEXUS_HOSTED_BETA", "off"); infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); vi.unstubAllEnvs(); });

function until(seconds: number): ValueInput { return { kind: "expression", type: "Instant", expression: { operator: "instant.add", args: [{ kind: "variable", type: "Instant", variableId: "run.startedAt" }, { kind: "literal", type: "Duration", value: seconds }] } }; }
function polling(id = "poll"): Extract<Statement, { kind: "poll" }> {
  return { id, kind: "poll", ticket: { kind: "literal", type: "TicketRef", value: { id: "TICKET", guildId: "GUILD" } }, maxAttempts: { kind: "literal", type: "Number", value: 3 }, interval: { kind: "literal", type: "Duration", value: 10 }, until: until(60), output: { id: id + "-result", name: "Latest ticket state", type: recordType },
    condition: { kind: "expression", type: "Boolean", expression: { operator: "compare.equal", args: [{ kind: "expression", type: states, expression: { operator: "record.field", args: [{ kind: "variable", type: recordType, variableId: id + "-result" }], options: { key: "state" } } }, { kind: "literal", type: states, value: "RESOLVED" }] } },
    matched: [{ kind: "wait", id: id + "-matched", duration: { kind: "literal", type: "Duration", value: 1 } }], exhausted: [{ kind: "wait", id: id + "-exhausted", duration: { kind: "literal", type: "Duration", value: 1 } }], timedOut: [{ kind: "wait", id: id + "-timeout", duration: { kind: "literal", type: "Duration", value: 1 } }] };
}
function awaiting(id = "await"): Extract<Statement, { kind: "awaitEvent" }> { return { id, kind: "awaitEvent", ticket: { kind: "literal", type: "TicketRef", value: { id: "TICKET", guildId: "GUILD" } }, event: "ticketUpdated", states: ["RESOLVED"], until: until(60), output: { id: id + "-result", name: "Matched state", type: recordType }, matched: [{ kind: "wait", id: id + "-matched", duration: { kind: "literal", type: "Duration", value: 30 } }], timedOut: [] }; }
async function fixture(body: Statement[] = [polling()]) {
  const scope = scopeForGuild(String(888000000000000000n + BigInt(++serial))), ticket = "intake:" + randomUUID(), panel = randomUUID(), clock = { now: new Date() }; await ensureGuild(db, scope);
  await db.transaction().execute(async tx => {
    await sql`INSERT INTO operations_intake_panels(organization_id,guild_id,id,title,category,state,actor_hash) VALUES(${scope.organizationId}::uuid,${scope.guildId},${panel}::uuid,'Synthetic','support','PUBLISHED',${actor.key})`.execute(tx);
    await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,evidence) VALUES(${scope.organizationId}::uuid,${scope.guildId},${channel},${ticket},now(),'OPEN','OPERATIONS_REQUEST','{}'::jsonb)`.execute(tx);
    await sql`INSERT INTO operations_requests(organization_id,guild_id,id,panel_id,interaction_digest,actor_hash,category,fields_ciphertext,attention_key) VALUES(${scope.organizationId}::uuid,${scope.guildId},${ticket.slice(7)}::uuid,${panel}::uuid,${randomUUID()},${actor.key},'support','synthetic-encrypted-fields',${ticket})`.execute(tx);
  });
  const fix = (value: unknown): unknown => value === "GUILD" ? scope.guildId : value === "TICKET" ? ticket : Array.isArray(value) ? value.map(fix) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fix(item)])) : value;
  const definition: FlowDefinition = { schemaVersion: 1, id: "bounded-" + serial, name: "Synthetic bounded waits", guildId: scope.guildId, trigger: { kind: "manual", inputs: [] }, variables: [], targets: { channelIds: [channel], roleIds: [role], parentCategoryIds: [] }, body: fix(body) as Statement[] };
  const service = new AutomationService(db, { admission, now: () => clock.now, authorize: async () => {}, approvalPolicy: async () => ({ fingerprint: "a".repeat(64), changedChannelCount: 0 }), adoptedActions: new Set(["nexus.readTicket", "discord.addRole"]) });
  const saved = await service.save(scope, actor, { definition, expectedRevision: 0, requestId: randomUUID() }); expect(saved.validation.issues).toEqual([]);
  const mock = { outcomes: { poll: "SUCCEEDED" as const, role: "SUCCEEDED" as const, source: "SUCCEEDED" as const }, outputs: { poll: { type: recordType, value: { state: "RESOLVED", version: 1 } }, source: { type: recordType, value: { state: "RESOLVED", version: 1 } } }, awaitEvents: { await: { state: "TIMED_OUT" as const } } };
  for (const check of ["VALIDATE", "TEST", "IMPACT"] as const) { const result = await service.check(scope, actor, definition.id, 1, check, mock); if (check === "TEST") expect(result).toMatchObject({ status: "COMPLETED" }); }
  await service.enable(scope, actor, definition.id, { revision: 1, semanticHash: saved.validation.semanticHash!, requestId: randomUUID() });
  const result = (state = "OPEN", version = 1) => ({ type: recordType, value: { state, version }, provenance: [{ source: "service" as const, guildId: scope.guildId, allowedChannelIds: [channel], resumable: true }] });
  const adapter: AutomationRuntimeAdapter = { authorize: vi.fn(async () => {}), authorizeAwait: vi.fn(async () => ({ allowedChannelIds: [channel] })), execute: vi.fn(async context => context.operation === "nexus.readTicket" ? { state: "SUCCEEDED" as const, value: result() } : { state: "SUCCEEDED" as const }) };
  const runtime = new AutomationRuntime(db, { admission, adapter, now: () => clock.now });
  const run = await service.start(scope, actor, definition.id, { requestId: randomUUID() });
  return { scope, ticket, clock, definition, service, adapter, runtime, run, result };
}
async function checkpoint(f: Awaited<ReturnType<typeof fixture>>) { return (await f.service.store.run(f.scope, f.run.id))!; }
async function updated(f: Awaited<ReturnType<typeof fixture>>, state = "RESOLVED", version = 1) { await sql`UPDATE attention_items SET status=${state},version=${version} WHERE ${tenant(f.scope)} AND message_id=${f.ticket}`.execute(db); }

it("fixes bounded read inputs and resumes the next attempt after restart without consuming an external-action budget", async () => {
  const f = await fixture(); expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" });
  const first = await checkpoint(f); expect(first.resume.frames[0]!.poll).toMatchObject({ attempts: 1, maxAttempts: 3, intervalSeconds: 10 }); expect(first.resume.externalActions).toBe(0);
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" }); expect(f.adapter.execute).toHaveBeenCalledTimes(1);
  f.clock.now = new Date(f.clock.now.getTime() + 11000); f.adapter.execute = vi.fn(async () => ({ state: "SUCCEEDED" as const, value: f.result("RESOLVED", 2) }));
  const restarted = new AutomationRuntime(db, { admission, adapter: f.adapter, now: () => f.clock.now }); expect(await restarted.tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" });
  const resumed = await checkpoint(f); expect(resumed.resume.frames.at(-1)!.path).toContain("/matched"); expect(resumed.resume.variables["poll-result"]!.value).toEqual({ state: "RESOLVED", version: 2 }); expect(resumed.resume.externalActions).toBe(0); expect(resumed.resume.steps).toBe(3); expect(resumed.deadline_at).toEqual(first.deadline_at);
});

it("uses exhaustion and timeout separately without an extra read or a fabricated timeout value", async () => {
  const poll = polling(); poll.maxAttempts = { kind: "literal", type: "Number", value: 2 }; const f = await fixture([poll]);
  await f.runtime.tick(f.scope, f.run.id); f.clock.now = new Date(f.clock.now.getTime() + 11000); await f.runtime.tick(f.scope, f.run.id);
  expect((await checkpoint(f)).resume.frames.at(-1)!.path).toContain("/exhausted"); expect(f.adapter.execute).toHaveBeenCalledTimes(2);
  const early = polling(); early.until = until(5); const t = await fixture([early]); await t.runtime.tick(t.scope, t.run.id); t.clock.now = new Date(t.clock.now.getTime() + 6000); await t.runtime.tick(t.scope, t.run.id);
  expect((await checkpoint(t)).resume.frames.at(-1)!.path).toContain("/timedOut"); expect((await checkpoint(t)).resume.variables["poll-result"]).toBeUndefined(); expect(t.adapter.execute).toHaveBeenCalledTimes(1);
});

it.each(["FAILED", "NOT_STARTED", "UNKNOWN"] as const)("stops on a %s read instead of polling it again", async state => {
  const f = await fixture(); f.adapter.execute = vi.fn(async () => ({ state, code: "SYNTHETIC_UNAVAILABLE" }));
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: state === "UNKNOWN" ? "UNKNOWN" : "FAILED" }); await f.runtime.tick(f.scope, f.run.id); expect(f.adapter.execute).toHaveBeenCalledTimes(1);
});

it("cancels waiting reads and rejects an overlong fixed deadline before attempting a read", async () => {
  const f = await fixture(); await f.runtime.tick(f.scope, f.run.id); await f.service.cancel(f.scope, actor, f.run.id, randomUUID()); f.clock.now = new Date(f.clock.now.getTime() + 11000); expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "CANCELLED" }); expect(f.adapter.execute).toHaveBeenCalledTimes(1);
  const poll = polling(); poll.until = until(604801);
  // The literal definition is valid, but the same dynamic bound cannot exceed the Run deadline.
  const scope = scopeForGuild(String(889000000000000000n + BigInt(++serial))); await ensureGuild(db, scope);
  const definition = { ...f.definition, id: "overlong-" + serial, guildId: scope.guildId, body: [JSON.parse(JSON.stringify(poll).replaceAll("GUILD", scope.guildId).replaceAll("TICKET", f.ticket)) as Statement] };
  const saved = await f.service.save(scope, actor, { definition, expectedRevision: 0, requestId: randomUUID() }); expect(saved.validation.valid).toBe(true);
  const checked = await f.service.check(scope, actor, definition.id, 1, "TEST", { outcomes: { poll: "SUCCEEDED" }, outputs: { poll: { type: recordType, value: { state: "RESOLVED", version: 1 } } } }); expect(checked).toMatchObject({ status: "FAILED" });
});

it("reuses a durably confirmed read once after a lost checkpoint and rechecks current ticket access", async () => {
  const f = await fixture(), original = f.runtime.store.save.bind(f.runtime.store);
  const spy = vi.spyOn(f.runtime.store, "save").mockImplementation(async (...args) => { if (args[2].frames[0]?.poll?.attempts === 1) return; return original(...args); });
  await f.runtime.tick(f.scope, f.run.id, 1); spy.mockRestore(); expect(f.adapter.execute).toHaveBeenCalledTimes(1); expect((await checkpoint(f)).resume.frames[0]?.poll?.attempts).toBe(0);
  const restarted = new AutomationRuntime(db, { admission, adapter: f.adapter, now: () => f.clock.now }); await restarted.tick(f.scope, f.run.id, 1);
  expect(f.adapter.execute).toHaveBeenCalledTimes(1); expect(f.adapter.authorizeAwait).toHaveBeenCalledTimes(1); expect((await checkpoint(f)).resume.frames[0]?.poll?.attempts).toBe(1);
  const revoked = await fixture(), save = revoked.runtime.store.save.bind(revoked.runtime.store);
  const lost = vi.spyOn(revoked.runtime.store, "save").mockImplementation(async (...args) => args[2].frames[0]?.poll?.attempts === 1 ? undefined : save(...args));
  await revoked.runtime.tick(revoked.scope, revoked.run.id, 1); lost.mockRestore(); revoked.adapter.authorizeAwait = vi.fn(async () => { throw new Error("AUTOMATION_TICKET_NOT_VISIBLE"); });
  const denied = new AutomationRuntime(db, { admission, adapter: revoked.adapter, now: () => revoked.clock.now }); expect(await denied.tick(revoked.scope, revoked.run.id)).toMatchObject({ state: "FAILED" }); expect(revoked.adapter.execute).toHaveBeenCalledTimes(1);
});

it("keeps a bounded read independent of another parallel branch's formal approval", async () => {
  const f = await fixture([{ kind: "parallel", id: "parallel", branches: [{ id: "reads", name: "Reads", body: [polling()] }, { id: "roles", name: "Roles", body: [{ kind: "action", id: "role", operation: "discord.addRole", approvalRequired: true, inputs: { member: { kind: "literal", type: "MemberRef", value: { id: member, guildId: "GUILD" } }, role: { kind: "literal", type: "RoleRef", value: { id: role, guildId: "GUILD" } } } }] }] }]);
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING_APPROVAL" }); expect(f.adapter.execute).toHaveBeenCalledTimes(1);
  f.clock.now = new Date(f.clock.now.getTime() + 11000); f.adapter.execute = vi.fn(async () => ({ state: "SUCCEEDED" as const, value: f.result("RESOLVED", 2) })); await f.runtime.tick(f.scope, f.run.id);
  const saved = await checkpoint(f); expect(saved.status).toBe("WAITING_APPROVAL"); expect(saved.resume.parallel!.branches[0]!.context.frames.at(-1)!.path).toContain("/matched"); expect(saved.resume.parallel!.branches[1]!.context.approvalIdentity).toBeTruthy(); expect(saved.resume.externalActions).toBe(0);
});

it("resumes the same Run on its matching event and acknowledges it before a later ordinary wait", async () => {
  const f = await fixture([awaiting()]); expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" }); const before = await checkpoint(f);
  await updated(f, "IN_PROGRESS", 1); expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" });
  await updated(f, "RESOLVED", 2); f.clock.now = new Date(Date.now() + 1000);
  const restarted = new AutomationRuntime(db, { admission, adapter: f.adapter, now: () => f.clock.now }); expect(await restarted.tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" });
  const after = await checkpoint(f); expect(after.id).toBe(before.id); expect(after.deadline_at).toEqual(before.deadline_at); expect(after.resume.frames.at(-1)!.path).toContain("/matched"); expect(after.resume.variables["await-result"]!.value).toEqual({ state: "RESOLVED", version: 2 }); expect(after.resume.variables["await-result"]!.provenance[0]?.allowedChannelIds).toEqual([channel]);
  expect(after.wake_at!.getTime()).toBe(f.clock.now.getTime() + 30000); expect((await sql<{consumed_at:Date|null}>`SELECT consumed_at FROM automation_event_waits WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(db)).rows[0]!.consumed_at).not.toBeNull(); expect(f.adapter.execute).not.toHaveBeenCalled();
});

it("wakes the matching parallel await branch while leaving an unrelated branch wait fixed", async () => {
  const f = await fixture([{ kind: "parallel", id: "parallel", branches: [{ id: "event", name: "Event", body: [awaiting()] }, { id: "other", name: "Other", body: [{ kind: "wait", id: "ordinary", duration: { kind: "literal", type: "Duration", value: 40 } }] }] }]);
  await f.runtime.tick(f.scope, f.run.id); const initial = (await checkpoint(f)).resume.parallel!.branches[1]!.context.waitUntil;
  await updated(f, "RESOLVED", 1); f.clock.now = new Date(Date.now() + 1000); await f.runtime.tick(f.scope, f.run.id);
  const saved = await checkpoint(f); expect(saved.resume.parallel!.branches[0]!.context.frames.at(-1)!.path).toContain("/matched"); expect(saved.resume.parallel!.branches[1]!.context.waitUntil).toBe(initial);
});

it("stops a matched event if current ticket visibility was revoked before resumption", async () => {
  const f = await fixture([awaiting()]); await f.runtime.tick(f.scope, f.run.id); await updated(f); f.clock.now = new Date(Date.now() + 1000); f.adapter.authorizeAwait = vi.fn(async () => { throw new Error("AUTOMATION_TICKET_NOT_VISIBLE"); });
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "FAILED" }); expect((await checkpoint(f)).resume.variables["await-result"]).toBeUndefined();
});
it("rechecks cached ordinary ticket outputs after a lost checkpoint before exposing a success binding", async () => {
  const f = await fixture([{ kind: "action", id: "source", operation: "nexus.readTicket", inputs: { ticket: { kind: "literal", type: "TicketRef", value: { id: "TICKET", guildId: "GUILD" } } }, output: { id: "cached-result", name: "Cached result", type: recordType } }, { kind: "wait", id: "after-source", duration: { kind: "literal", type: "Duration", value: 1 } }]);
  const save = f.runtime.store.save.bind(f.runtime.store), lost = vi.spyOn(f.runtime.store, "save").mockImplementation(async (...args) => args[2].variables["cached-result"] ? undefined : save(...args));
  await f.runtime.tick(f.scope, f.run.id, 1); lost.mockRestore(); expect(f.adapter.execute).toHaveBeenCalledTimes(1);
  f.adapter.authorizeAwait = vi.fn(async () => { throw new Error("AUTOMATION_TICKET_NOT_VISIBLE"); });
  const resumed = new AutomationRuntime(db, { admission, adapter: f.adapter, now: () => f.clock.now }); expect(await resumed.tick(f.scope, f.run.id)).toMatchObject({ state: "FAILED" }); expect(f.adapter.execute).toHaveBeenCalledTimes(1); expect((await checkpoint(f)).resume.variables["cached-result"]).toBeUndefined();
});
