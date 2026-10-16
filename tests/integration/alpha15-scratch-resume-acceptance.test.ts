import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { connect, ensureGuild, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import type { Actor } from "../../packages/settings/src/index";
import { AutomationService } from "../../packages/automation/src/service";
import { AutomationRuntime, type AutomationRuntimeAdapter } from "../../packages/automation/src/runtime";
import { automationDispatchCheckpoint } from "../../packages/automation/src/store";
import type { AutomationAdmissionLimits } from "../../packages/automation/src/quota";
import type { FlowDefinition, JsonValue, Statement, ValueInput, ValueType } from "../../packages/automation/src/types";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
const day = 86400, channel = "886222222222222222", member = "886333333333333333", role = "886444444444444444";
const actor: Actor = { key: "synthetic-resume-admin", encryptedUserId: "synthetic-encrypted-identity", permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: "synthetic-resume-acceptance" };
// Isolated fixture capacity; this is neither a measured host limit nor pricing.
const admission: AutomationAdmissionLimits = { activeFlows: 20, monthlyRuns: 100, guildConcurrent: 2, globalConcurrent: 4, guildPending: 20, globalPending: 100, measurementId: "isolated-resume-acceptance" };
const literal = (type: ValueType, value: JsonValue): ValueInput => ({ kind: "literal", type, value });
const variable = (variableId: string, type: ValueType = "Number"): ValueInput => ({ kind: "variable", type, variableId });
const wait = (id: string, seconds: number): Statement => ({ id, kind: "wait", duration: literal("Duration", seconds) });
const send = (id: string): Statement => ({ id, kind: "action", operation: "discord.sendMessage", inputs: { channel: literal("ChannelRef", { id: channel, guildId: "placeholder" }), content: literal("PlainText", `Synthetic ${id}; no Discord connection`) } });
const endRun = (id: string): Statement => ({ id, kind: "endRun", semanticVersion: 1 });

beforeAll(async () => {
  vi.stubEnv("NEXUS_HOSTED_BETA", "off");
  infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await db?.destroy(); await infra?.stop(); vi.unstubAllEnvs(); });

async function fixture(body: Statement[], extra: Partial<FlowDefinition> = {}) {
  const scope = scopeForGuild(String(886000000000000000n + BigInt(++serial))); await ensureGuild(db, scope);
  const clock = { now: new Date() }, calls: { identity: string; operation: string }[] = [];
  const fix = (value: unknown): unknown => Array.isArray(value) ? value.map(fix) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "guildId" && item === "placeholder" ? scope.guildId : fix(item)])) : value;
  const definition = fix({ schemaVersion: 1, semanticProfile: "scratch.v1", id: `resume-acceptance-${serial}`, name: "Synthetic resume acceptance", guildId: scope.guildId, trigger: { kind: "manual", inputs: [] }, targets: { channelIds: [channel], roleIds: [role], parentCategoryIds: [] }, variables: [], body, ...extra }) as FlowDefinition;
  const service = new AutomationService(db, { admission, scratchRandomAttempts: 32, now: () => clock.now, authorize: async () => {}, adoptedActions: new Set(["discord.sendMessage", "discord.addRole"]), approvalPolicy: async () => ({ fingerprint: "a".repeat(64), changedChannelCount: 0 }) });
  const saved = await service.save(scope, actor, { definition, expectedRevision: 0, requestId: randomUUID() }); expect(saved.validation.issues).toEqual([]);
  // Only this private synthetic revision is activated directly. These tests
  // exercise durable Run boundaries, not public activation/review acceptance.
  await sql`UPDATE automation_flows SET state='ACTIVE',active_revision=1 WHERE ${tenant(scope)} AND id=${definition.id}`.execute(db);
  const adapter: AutomationRuntimeAdapter = { authorize: async () => {}, execute: async context => { calls.push({ identity: context.identity, operation: context.operation }); return { state: "SUCCEEDED" }; } };
  const restart = () => new AutomationRuntime(db, { admission, adapter, now: () => clock.now, scratchRandomAttempts: 32 });
  const runtime = restart(), run = await service.start(scope, actor, definition.id, { requestId: randomUUID() });
  return { scope, clock, calls, definition, service, adapter, runtime, restart, run };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const savedRun = async (f: Fixture) => (await f.service.store.run(f.scope, f.run.id))!;
const operations = async (f: Fixture) => (await sql<{ identity: string; state: string; reason: string | null; fingerprint: string; finished_at: Date | null }>`SELECT identity,state,reason,fingerprint,finished_at FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid ORDER BY identity`.execute(db)).rows;
const draws = async (f: Fixture) => (await sql<{ identity: string; input: JsonValue; result: JsonValue; fingerprint: string }>`SELECT identity,input,result,fingerprint FROM automation_random_results WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid ORDER BY identity`.execute(db)).rows;
async function claim(f: Fixture, identity: string) {
  const run = await savedRun(f);
  await f.runtime.store.beginOperation(f.scope, f.run.id, identity, "discord.sendMessage", "synthetic-input-fingerprint", run.deadline_at, f.clock.now, automationDispatchCheckpoint(run.resume));
}

it("T100 rejects a two-day Wait after a six-day Wait without resetting the original seven-day Run deadline", async () => {
  const f = await fixture([wait("six-days", 6 * day), wait("two-more-days", 2 * day), send("after")]);
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" });
  const before = await savedRun(f); expect(before.wake_at!.getTime() - before.started_at.getTime()).toBe(6 * day * 1000);
  expect(before.deadline_at.getTime() - before.started_at.getTime()).toBe(7 * day * 1000);
  f.clock.now = new Date(before.wake_at!);
  expect(await f.restart().tick(f.scope, f.run.id)).toMatchObject({ state: "FAILED" });
  const after = await savedRun(f);
  expect(after.reason).toBe("AUTOMATION_DEADLINE_EXCEEDED"); expect(after.deadline_at).toEqual(before.deadline_at); expect(after.started_at).toEqual(before.started_at);
  expect(after.resume.steps).toBeGreaterThan(before.resume.steps); expect(f.calls).toEqual([]); expect(await operations(f)).toEqual([]);
});

it.each([false, true])("T101 gives %s cancellation/the Run deadline precedence when wake equals the fixed deadline", async cancelled => {
  const f = await fixture([wait("hold", 1), send("after")]); await f.runtime.tick(f.scope, f.run.id);
  const before = await savedRun(f);
  await sql`UPDATE automation_runs SET wake_at=deadline_at WHERE ${tenant(f.scope)} AND id=${f.run.id}::uuid`.execute(db);
  if (cancelled) await f.service.store.cancel(f.scope, f.run.id, f.clock.now);
  f.clock.now = new Date(before.deadline_at);
  expect(await f.restart().tick(f.scope, f.run.id)).toMatchObject({ state: cancelled ? "CANCELLED" : "EXPIRED" });
  expect(f.calls).toEqual([]); expect(await operations(f)).toEqual([]);
  expect((await savedRun(f)).deadline_at).toEqual(before.deadline_at);
});

it("T101 fences a wake worker cancelled while its current authorization check is in flight", async () => {
  const f = await fixture([wait("hold", 1), send("after")]); await f.runtime.tick(f.scope, f.run.id);
  f.clock.now = new Date((await savedRun(f)).wake_at!);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  f.adapter.authorize = async () => { enter(); await gate; };
  const waking = f.restart().tick(f.scope, f.run.id);
  await entered;
  try { await f.service.store.cancel(f.scope, f.run.id, f.clock.now); } finally { release(); }
  expect(await waking).toMatchObject({ state: "CANCELLED" });
  const terminal = await savedRun(f); expect(terminal.cancel_requested_at).not.toBeNull(); expect(terminal.ended_at).not.toBeNull();
  expect(f.calls).toEqual([]); expect(await operations(f)).toEqual([]);
  await f.restart().tick(f.scope, f.run.id); expect(await savedRun(f)).toEqual(terminal);
});

it("T109 keeps one fixed draw and one UNKNOWN operation through repeated requests and worker restart", async () => {
  const draw: Statement = { id: "draw", kind: "random", mode: "integer", min: literal("Number", 1), max: literal("Number", 3), output: { id: "picked", name: "Picked", type: "Number" } };
  const f = await fixture([draw, send("ambiguous-send"), send("after")]);
  expect(await f.runtime.tick(f.scope, f.run.id, 1)).toMatchObject({ state: "RUNNING" });
  const fixedDraws = await draws(f), picked = (await savedRun(f)).resume.variables.picked!.value;
  expect(fixedDraws).toHaveLength(1); expect([1, 2, 3]).toContain(picked);
  f.adapter.execute = async context => { f.calls.push({ identity: context.identity, operation: context.operation }); return { state: "UNKNOWN", code: "SYNTHETIC_RESPONSE_LOST" }; };
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "UNKNOWN" });
  const unresolved = await savedRun(f), ledger = await operations(f);
  expect(ledger).toHaveLength(1); expect(ledger[0]).toMatchObject({ state: "UNKNOWN", reason: "SYNTHETIC_RESPONSE_LOST" });
  for (let attempt = 0; attempt < 3; attempt++) expect(await f.restart().tick(f.scope, f.run.id)).toMatchObject({ state: "UNKNOWN" });
  expect(await draws(f)).toEqual(fixedDraws); expect(await operations(f)).toEqual(ledger); expect(await savedRun(f)).toEqual(unresolved); expect(f.calls).toHaveLength(1);
});

it("T110 keeps confirmed external success when a parallel child ends the Run before further dispatch", async () => {
  const f = await fixture([send("confirmed"), { id: "parallel", kind: "parallel", branches: [{ id: "stop", name: "Stop", body: [endRun("end-run")] }, { id: "pending", name: "Pending", body: [wait("sibling-hold", 1), send("sibling")] }] }, send("after")]);
  await f.runtime.tick(f.scope, f.run.id, 1); const evidence = await operations(f); expect(evidence).toHaveLength(1); expect(evidence[0]!.state).toBe("SUCCEEDED");
  expect(await f.restart().tick(f.scope, f.run.id)).toMatchObject({ state: "COMPLETED" });
  expect(await operations(f)).toEqual(evidence); expect(f.calls).toHaveLength(1);
  await f.restart().tick(f.scope, f.run.id); expect(await operations(f)).toEqual(evidence); expect(f.calls).toHaveLength(1);
});

it("T110 preserves STARTED evidence as UNKNOWN rather than using EndRun to claim that it was unsent", async () => {
  const f = await fixture([send("confirmed"), endRun("end-run")]); await f.runtime.tick(f.scope, f.run.id, 1);
  const confirmed = (await operations(f))[0]!; await claim(f, "synthetic-already-dispatched");
  expect(await f.restart().tick(f.scope, f.run.id)).toMatchObject({ state: "UNKNOWN" });
  expect(await operations(f)).toEqual(expect.arrayContaining([confirmed, expect.objectContaining({ identity: "synthetic-already-dispatched", state: "UNKNOWN" })]));
  const evidence = await operations(f); await f.restart().tick(f.scope, f.run.id); expect(await operations(f)).toEqual(evidence); expect(f.calls).toHaveLength(1);
});

it.each(["AUTOMATION_PERMISSION_DENIED", "AUTOMATION_TARGET_DELETED", "CANCEL"] as const)("T115 stops after Wait when the current adapter reports %s", async failure => {
  const f = await fixture([wait("hold", 1), send("after")]); expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING" });
  const waiting = await savedRun(f); f.clock.now = new Date(waiting.wake_at!); let currentChecks = 0;
  f.adapter.authorize = async () => { currentChecks++; throw new Error(failure); };
  if (failure === "CANCEL") await f.service.store.cancel(f.scope, f.run.id, f.clock.now);
  expect(await f.restart().tick(f.scope, f.run.id)).toMatchObject({ state: failure === "CANCEL" ? "CANCELLED" : "FAILED" });
  const stopped = await savedRun(f); expect(stopped.deadline_at).toEqual(waiting.deadline_at); expect(f.calls).toEqual([]); expect(await operations(f)).toEqual([]);
  expect(currentChecks).toBe(failure === "CANCEL" ? 0 : 1);
  if (failure !== "CANCEL") expect(stopped.reason).toBe(failure);
  await f.restart().tick(f.scope, f.run.id); expect(await savedRun(f)).toEqual(stopped);
});

it("T116 shares the remaining evaluation budget across parent, child and both parallel branches after restart", async () => {
  const declare = (id: string, value: ValueInput): Statement => ({ id: `declare-${id}`, kind: "declare", variable: { id, name: id, type: "Number" }, value });
  const plus = (): ValueInput => ({ kind: "expression", type: "Number", expression: { operator: "number.add", args: [variable("input"), literal("Number", 1)] } });
  const f = await fixture([declare("parent", literal("Number", 1)), { id: "call", kind: "call", procedureId: "child", revision: 1, args: { input: variable("parent") }, outputs: {} }, send("after")], { procedures: [{ id: "child", revision: 1, name: "Child", inputs: [{ id: "input", name: "Input", type: "Number" }], outputs: [], body: [declare("child-local", variable("input")), { id: "parallel", kind: "parallel", branches: [{ id: "left", name: "Left", body: [declare("left-value", plus()), wait("left-wait", 1), send("left-send")] }, { id: "right", name: "Right", body: [declare("right-value", plus()), wait("right-wait", 1), send("right-send")] }] }, { id: "return", kind: "return", values: {} }] }] });
  const initial = await savedRun(f); initial.resume.evaluations = 4990;
  // A fault-boundary fixture reserves the preceding work in the real checkpoint;
  // the tested parent/call/fork paths must consume its remaining shared budget.
  await f.service.store.save(f.scope, f.run.id, initial.resume, "RUNNING");
  await f.runtime.tick(f.scope, f.run.id, 4); const entered = await savedRun(f);
  expect(entered.resume.evaluations).toBe(4993); expect(entered.resume.frames.some(frame => frame.call)).toBe(true); expect(entered.resume.parallel).toBeDefined();
  expect(await f.restart().tick(f.scope, f.run.id)).toMatchObject({ state: "FAILED" });
  const stopped = await savedRun(f); expect(stopped.reason).toMatch(/EVALUATION_LIMIT|BUDGET/); expect(stopped.resume.evaluations).toBe(5001);
  expect(f.calls).toEqual([]); expect(await operations(f)).toEqual([]);
  await f.restart().tick(f.scope, f.run.id); expect((await savedRun(f)).resume.evaluations).toBe(5001);
});

it.each([false, true])("T118 applies the parent loop deadline during child approval wait; in-flight=%s keeps UNKNOWN precedence", async inFlight => {
  const deadline = new Date(Date.now() + 60000).toISOString();
  const f = await fixture([{ id: "loop", kind: "boundedLoop", semanticVersion: 1, mode: "until", maxBody: literal("Number", 1), condition: literal("Boolean", false), until: literal("Instant", deadline), body: [{ id: "call", kind: "call", procedureId: "child", revision: 1, args: {}, outputs: {} }], handlers: { localDeadline: [{ id: "deadline-end", kind: "end" }] } }, send("after")], { procedures: [{ id: "child", revision: 1, name: "Approval child", inputs: [], outputs: [], body: [{ id: "approval", kind: "approval", actionId: "role", until: literal("Instant", deadline), approved: [], rejected: [], expired: [] }, { id: "role", kind: "action", operation: "discord.addRole", approvalRequired: true, inputs: { member: literal("MemberRef", { id: member, guildId: "placeholder" }), role: literal("RoleRef", { id: role, guildId: "placeholder" }) } }, { id: "return", kind: "return", values: {} }] }] });
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "WAITING_APPROVAL" });
  const pending = (await f.service.approvals(f.scope, actor)).items; expect(pending).toHaveLength(1); expect(pending[0]!.expiresAt).toBe(deadline);
  if (inFlight) await claim(f, "synthetic-before-loop-expiry");
  f.clock.now = new Date(deadline);
  expect(await f.restart().tick(f.scope, f.run.id)).toMatchObject({ state: inFlight ? "UNKNOWN" : "FAILED" });
  const stopped = await savedRun(f), handlers = (await sql<{ block_id: string; code: string }>`SELECT block_id,code FROM automation_run_events WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid AND state='LOOP_HANDLER'`.execute(db)).rows;
  expect(f.calls).toEqual([]);
  if (inFlight) { expect(stopped.resume.loopTermination).toBeUndefined(); expect(handlers).toEqual([]); expect((await operations(f))[0]!.state).toBe("UNKNOWN"); }
  else { expect(stopped.reason).toBe("LOOP_LOCAL_DEADLINE"); expect(stopped.resume.loopTermination?.reason).toBe("local_deadline"); expect(handlers).toEqual([{ block_id: "loop", code: "LOCAL_DEADLINE" }]); expect(await operations(f)).toEqual([]); }
  const evidence = await operations(f); await f.restart().tick(f.scope, f.run.id); expect(await operations(f)).toEqual(evidence); expect(f.calls).toEqual([]);
});
