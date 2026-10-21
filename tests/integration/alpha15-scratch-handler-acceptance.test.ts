import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { connect, ensureGuild, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import type { Actor } from "../../packages/settings/src/index";
import { AutomationService } from "../../packages/automation/src/service";
import { AutomationRuntime, type AutomationRuntimeAdapter } from "../../packages/automation/src/runtime";
import { compileCommonUnknownChain, saveCommonUnknownDraft } from "../../packages/automation/src/scratch-authoring";
import { AutomationStore } from "../../packages/automation/src/store";
import type { AutomationAdmissionLimits } from "../../packages/automation/src/quota";
import type { FlowDefinition, Statement, ValueInput } from "../../packages/automation/src/types";
import { DEFAULT_AUTOMATION_LIMITS } from "../../packages/automation/src/types";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
const channel = "887222222222222222";
const actor: Actor = { key: createHash("sha256").update("synthetic-handler-admin").digest("hex"), encryptedUserId: "synthetic-encrypted-identity", permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: "synthetic-handler" };
const admission: AutomationAdmissionLimits = { activeFlows: 20, monthlyRuns: 100, guildConcurrent: 2, globalConcurrent: 4, guildPending: 20, globalPending: 200, measurementId: "isolated-handler-acceptance" };
const literal = (type: "Number" | "Boolean" | "ConditionResult" | "Duration" | "Instant", value: number | boolean | string): ValueInput => ({ kind: "literal", type, value });
// Only new definition literals use whole seconds; runtime clocks retain their precision.
const inputInstantAfter=(seconds:number)=>new Date(Math.ceil(Date.now()/1000)*1000+seconds*1000).toISOString();
const number = (value: number) => literal("Number", value);
const variable = (variableId: string): ValueInput => ({ kind: "variable", type: "Number", variableId });
const wait = (id: string, seconds: number): Statement => ({ id, kind: "wait", duration: literal("Duration", seconds) });
const declare = (id: string, value: ValueInput): Statement => ({ id: `${id}.declare`, kind: "declare", variable: { id, name: id, type: "Number" }, value });
const send = (id: string): Statement => ({ id, kind: "action", operation: "discord.sendMessage", inputs: { channel: { kind: "literal", type: "ChannelRef", value: { id: channel, guildId: "placeholder" } }, content: { kind: "literal", type: "PlainText", value: id } } });
const loop = (options: Partial<Extract<Statement, { kind: "boundedLoop" }>> = {}): Statement => ({ id: "loop", kind: "boundedLoop", semanticVersion: 1, mode: "until", maxBody: number(1), condition: literal("Boolean", false), until: literal("Instant", inputInstantAfter(86400)), body: [], handlers: {}, ...options });
function common(template: Statement[]) {
  let next = 0;
  return compileCommonUnknownChain({ id: "common", clauses: [{ id: "first", condition: literal("ConditionResult", "false"), then: [] }, { id: "second", condition: literal("ConditionResult", "unknown"), then: [] }], otherwise: [], template }, { createId: () => `hygienic.${++next}` });
}
beforeAll(async () => { vi.stubEnv("NEXUS_HOSTED_BETA", "off"); infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterEach(async () => {
  if (db) for (const run of (await sql<{ organization_id: string; guild_id: string; id: string }>`SELECT organization_id,guild_id,id FROM automation_runs WHERE ended_at IS NULL`.execute(db)).rows)
    await new AutomationStore(db).cancel({ organizationId: run.organization_id, guildId: run.guild_id }, run.id);
});
afterAll(async () => { await db?.destroy(); await infra?.stop(); vi.unstubAllEnvs(); });
async function fixture(body: Statement[], extra: Partial<FlowDefinition> = {}, unknown = false) {
  const scope = scopeForGuild(String(887000000000000000n + BigInt(++serial))); await ensureGuild(db, scope);
  const clock = { now: new Date() }, calls: { identity: string; content: string }[] = [];
  const fix = (value: unknown): unknown => Array.isArray(value) ? value.map(fix) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "guildId" && item === "placeholder" ? scope.guildId : fix(item)])) : value;
  const definition: FlowDefinition = { schemaVersion: 1, semanticProfile: "scratch.v1", id: `scratch-handler-${serial}`, guildId: scope.guildId, name: "Synthetic handler acceptance", trigger: { kind: "manual", inputs: [] }, variables: [], targets: { channelIds: [channel], roleIds: [], parentCategoryIds: [] }, body: fix(body) as Statement[], ...extra };
  const service = new AutomationService(db, { admission, scratchRandomAttempts: 32, now: () => clock.now, authorize: async () => {}, adoptedActions: new Set(["discord.sendMessage"]) });
  const saved = await service.save(scope, actor, { definition, expectedRevision: 0, requestId: randomUUID() });
  expect(saved.validation.issues).toEqual([]);
  // Isolated runtime fault fixtures. No existing database, review metadata, or
  // Discord connection is used; public enable is covered in other suites.
  await sql`UPDATE automation_flows SET state='ACTIVE',active_revision=1 WHERE ${tenant(scope)} AND id=${definition.id}`.execute(db);
  const adapter: AutomationRuntimeAdapter = { authorize: async () => {}, execute: async (context) => { calls.push({ identity: context.identity, content: String(context.inputs.content?.value) }); return unknown ? { state: "UNKNOWN", code: "SYNTHETIC_AMBIGUOUS_RESULT" } : { state: "SUCCEEDED" }; } };
  const worker = () => new AutomationRuntime(db, { admission, scratchRandomAttempts: 32, adapter, now: () => clock.now });
  const run = await service.start(scope, actor, definition.id, { requestId: randomUUID() });
  return { scope, clock, calls, service, adapter, worker, run, definition };
}
async function saved(f: Awaited<ReturnType<typeof fixture>>) { return (await f.service.store.run(f.scope, f.run.id))!; }

it.each(["body", "handler", "parallel"] as const)("S017 retains an unresolved external result from %s and permits no new handler or sibling operation", async (position) => {
  const handlers = { conditionUnknown: [send("must-not-unknown")], evaluationError: [send("must-not-error")], limit: [send("must-not-limit")] };
  const statement = position === "handler" ? loop({ maxBody: number(0), handlers: { ...handlers, limit: [send("ambiguous"), send("must-not-handler-tail")] } }) : position === "parallel" ? loop({ body: [{ id: "parallel", kind: "parallel", branches: [{ id: "uncertain", name: "Uncertain", body: [send("ambiguous")] }, { id: "sibling", name: "Sibling", body: [wait("sibling-wait", 1), send("must-not-sibling")] }] }], handlers }) : loop({ body: [send("ambiguous"), send("must-not-body-tail")], handlers });
  const f = await fixture([statement, send("must-not-follow")], {}, true);
  let state = await f.worker().tick(f.scope, f.run.id);
  for (let n = 0; n < 3 && state?.state === "RUNNING"; n++) state = await f.worker().tick(f.scope, f.run.id);
  expect(state).toMatchObject({ state: "UNKNOWN" });
  expect(f.calls.map(call => call.content)).toEqual(["ambiguous"]);
  const first = await saved(f);
  expect(first.ended_at).not.toBeNull();
  const operations = (await sql`SELECT identity,state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(db)).rows;
  expect(operations).toEqual([{ identity: f.calls[0]!.identity, state: "UNKNOWN" }]);
  f.clock.now = new Date(f.clock.now.getTime() + 2000);
  for (let n = 0; n < 3; n++) expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({ state: "UNKNOWN" });
  expect(f.calls.map(call => call.content)).toEqual(["ambiguous"]);
  expect((await saved(f)).ended_at).toEqual(first.ended_at);
  expect((await saved(f)).resume).toEqual(first.resume);
  expect((await sql`SELECT identity,state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(db)).rows).toEqual(operations);
});

it("S030 common unknown Wait and random copies keep lexical locals, stable resumed draw and distinct iteration identities", async () => {
  const compiled = common([{ id: "template.draw", kind: "random", mode: "integer", min: number(1), max: number(3), output: { id: "template.local", name: "Local draw", type: "Number" } }, wait("template.wait", 1), { id: "template.assign", kind: "assign", variableId: "count", value: { kind: "expression", type: "Number", expression: { operator: "number.add", args: [variable("count"), number(1)] } } }]);
  const f = await fixture([declare("count", number(0)), { id: "repeat", kind: "repeat", count: number(2), itemVariable: { id: "iteration", name: "Iteration", type: "Number" }, body: [compiled.statement] }, wait("inspect", 20)], { scratchAuthoring: { version: 1, chains: [compiled.metadata] } });
  const selected = compiled.metadata.copies[1]!, local = selected.localIds["template.local"]!, drawId = selected.nodeIds["template.draw"]!;
  const draws = async () => (await sql<{ identity: string; result: { state: string; value: number } }>`SELECT identity,result FROM automation_random_results WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid ORDER BY identity`.execute(db)).rows;
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" });
  const first = await saved(f), originalDraws = await draws();
  expect(first.resume.frames.at(-1)!.path).toContain("unknown");
  expect(first.resume.variables[local]!.value).toBeGreaterThanOrEqual(1); expect(first.resume.variables[local]!.value).toBeLessThanOrEqual(3);
  expect(first.resume.variables["template.local"]).toBeUndefined(); expect(first.resume.variables.count!.value).toBe(0);
  expect(originalDraws).toHaveLength(1); expect(originalDraws[0]!.result).toMatchObject({ state: "SUCCEEDED", value: first.resume.variables[local]!.value });
  expect(drawId).not.toBe("template.draw");
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" }); expect(await draws()).toEqual(originalDraws);
  f.clock.now = new Date(f.clock.now.getTime() + 1100);
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" });
  expect((await saved(f)).resume.variables.count!.value).toBe(1);
  const secondDraws = await draws(); expect(secondDraws).toHaveLength(2); expect(new Set(secondDraws.map(row => row.identity)).size).toBe(2); expect(secondDraws).toContainEqual(originalDraws[0]);
  f.clock.now = new Date(f.clock.now.getTime() + 1100);
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" });
  const after = await saved(f); expect(after.resume.variables.count!.value).toBe(2); expect(after.resume.variables[local]).toBeUndefined(); expect(await draws()).toEqual(secondDraws);
  expect(f.calls).toEqual([]);
});

it("S030 a compiled common unknown break exits the containing repeat and never its following body", async () => {
  const compiled = common([{ id: "template.break", kind: "break" }]);
  const f = await fixture([{ id: "repeat", kind: "repeat", count: number(3), itemVariable: { id: "iteration", name: "Iteration", type: "Number" }, body: [compiled.statement, send("must-not-loop-tail")] }, send("after-repeat")], { scratchAuthoring: { version: 1, chains: [compiled.metadata] } });
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({ state: "COMPLETED" }); expect(f.calls.map(call => call.content)).toEqual(["after-repeat"]);
  expect(compiled.metadata.copies[0]!.nodeIds["template.break"]).not.toBe(compiled.metadata.copies[1]!.nodeIds["template.break"]);
  expect((await saved(f)).resume.frames.some(frame => frame.loop)).toBe(false);
});

it("S030 a compiled common unknown Return resolves the procedure output and unwinds copied local scope", async () => {
  const compiled = common([declare("template.local", number(7)), { id: "template.return", kind: "return", values: { answer: variable("template.local") } }]);
  const f = await fixture([{ id: "call", kind: "call", procedureId: "child", revision: 1, args: {}, outputs: { answer: { id: "answer", name: "Answer", type: "Number" } } }, wait("inspect", 20)], { scratchAuthoring: { version: 1, chains: [compiled.metadata] }, procedures: [{ id: "child", revision: 1, name: "Child", inputs: [], outputs: [{ id: "answer", name: "Answer", type: "Number" }], body: [compiled.statement, { id: "fallback", kind: "return", values: { answer: number(9) } }] }] });
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" });
  const result = await saved(f); expect(result.resume.variables.answer!.value).toBe(7); expect(result.resume.frames.some(frame => frame.call)).toBe(false);
  for (const copy of compiled.metadata.copies) for (const local of Object.values(copy.localIds)) expect(result.resume.variables[local]).toBeUndefined();
  expect(f.calls).toEqual([]);
});

it("S029 reordered common clauses affect only a new revision while an old waiting Run retains its PC and random key", async () => {
  const template: Statement[] = [{ id: "template.draw", kind: "random", mode: "integer", min: number(1), max: number(3), output: { id: "template.local", name: "Local draw", type: "Number" } }, wait("template.wait", 1), { id: "template.assign", kind: "assign", variableId: "result", value: variable("template.local") }];
  const compiled = common(template);
  const f = await fixture([declare("result", number(0)), compiled.statement, wait("tail", 20)], { scratchAuthoring: { version: 1, chains: [compiled.metadata] } });
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" });
  const old = await saved(f);
  const draws = async (runId: string) => (await sql<{ identity: string; input: unknown; result: unknown }>`SELECT identity,input,result FROM automation_random_results WHERE ${tenant(f.scope)} AND run_id=${runId}::uuid ORDER BY identity`.execute(db)).rows;
  const oldDraw = await draws(f.run.id); expect(oldDraw).toHaveLength(1);
  const selected = compiled.metadata.copies[1]!.localIds["template.local"]!;
  const chosen = old.resume.variables[selected]!.value;
  expect(old.resume.frames.at(-1)!.path).toBe("body/1/otherwise/0/unknown");
  const next = saveCommonUnknownDraft(f.definition, { id: "common", clauses: [{ id: "second", condition: literal("ConditionResult", "unknown"), then: [] }, { id: "first", condition: literal("ConditionResult", "false"), then: [] }], otherwise: [], template });
  expect(next.scratchAuthoring!.chains[0]!.clauseIds).toEqual(["second", "first"]);
  expect(next.scratchAuthoring!.chains[0]!.copies).toEqual([...compiled.metadata.copies].reverse());
  const stored = await f.service.save(f.scope, actor, { definition: next, expectedRevision: 1, requestId: randomUUID() });
  expect(stored.draftRevision).toBe(2);
  await sql`UPDATE automation_flows SET active_revision=2 WHERE ${tenant(f.scope)} AND id=${f.definition.id}`.execute(db);
  expect((await saved(f)).resume).toEqual(old.resume); expect(await draws(f.run.id)).toEqual(oldDraw);
  const fresh = await f.service.start(f.scope, actor, f.definition.id, { requestId: randomUUID() });
  expect(fresh.revision).toBe(2); expect(await f.worker().tick(f.scope, fresh.id)).toMatchObject({ state: "WAITING" });
  const freshSaved = (await f.service.store.run(f.scope, fresh.id))!;
  expect(freshSaved.resume.frames.at(-1)!.path).toBe("body/1/unknown");
  expect(await draws(fresh.id)).toHaveLength(1); expect((await draws(fresh.id))[0]!.identity).not.toBe(oldDraw[0]!.identity);
  f.clock.now = new Date(f.clock.now.getTime() + 1100);
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" });
  const resumed = await saved(f);
  expect(resumed).toMatchObject({ revision: 1, semantic_hash: old.semantic_hash, started_at: old.started_at, deadline_at: old.deadline_at });
  expect(resumed.resume.variables.result!.value).toBe(chosen); expect(resumed.resume.variables[selected]).toBeUndefined();
  expect(await draws(f.run.id)).toEqual(oldDraw); expect(f.calls).toEqual([]);
});

it("S011 authorizes one explicit limit notification only after confirmed body success with remaining deadline and budget", async () => {
  const f = await fixture([loop({ body: [send("confirmed-body")], handlers: { limit: [send("limit-notification")] } }), send("must-not-follow")]);
  let authorizedLimitSnapshots = 0;
  f.adapter.authorize = async (_scope, run) => {
    if (run.resume.loopTermination?.reason === "limit_reached" && f.calls.length === 1) {
      authorizedLimitSnapshots++;
      expect(run.deadline_at.getTime()).toBeGreaterThan(f.clock.now.getTime());
      expect(run.resume.evaluations).toBeLessThan(DEFAULT_AUTOMATION_LIMITS.maxEvaluations);
      expect(run.resume.steps).toBeLessThan(DEFAULT_AUTOMATION_LIMITS.maxExpandedSteps);
      expect((await sql`SELECT identity,state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(db)).rows).toEqual([{ identity: f.calls[0]!.identity, state: "SUCCEEDED" }]);
    }
  };
  f.adapter.execute = async (context) => {
    const content = String(context.inputs.content?.value);
    if (content === "limit-notification") {
      expect(authorizedLimitSnapshots).toBeGreaterThan(0);
      const prior = (await sql<{ identity: string; state: string }>`SELECT identity,state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(db)).rows;
      expect(prior.filter(row => row.identity !== context.identity)).toEqual([{ identity: f.calls[0]!.identity, state: "SUCCEEDED" }]);
      expect(prior.find(row => row.identity === context.identity)?.state).toBe("STARTED");
    }
    f.calls.push({ identity: context.identity, content });
    return { state: "SUCCEEDED" };
  };
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({ state: "FAILED" });
  expect(f.calls.map(call => call.content)).toEqual(["confirmed-body", "limit-notification"]);
  const terminal = await saved(f); expect(terminal.reason).toBe("LOOP_LIMIT_REACHED");
  expect((await sql<{ state: string }>`SELECT state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(db)).rows).toEqual([{ state: "SUCCEEDED" }, { state: "SUCCEEDED" }]);
  for (let n = 0; n < 3; n++) expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({ state: "FAILED" });
  expect(f.calls.map(call => call.content)).toEqual(["confirmed-body", "limit-notification"]);
  expect((await saved(f)).ended_at).toEqual(terminal.ended_at); expect((await saved(f)).resume).toEqual(terminal.resume);
});
