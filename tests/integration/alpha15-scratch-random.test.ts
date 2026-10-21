import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { connect, ensureGuild, json, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import type { Actor } from "../../packages/settings/src/index";
import { AutomationService } from "../../packages/automation/src/service";
import { AutomationRuntime, dynamicExecutionIdentity, type AutomationRuntimeAdapter } from "../../packages/automation/src/runtime";
import { RandomTapeStore, type RandomTapeRecord, type StoredRandomTapeInput } from "../../packages/automation/src/random-tape-store";
import { AutomationStore, fingerprint, type ResumeState } from "../../packages/automation/src/store";
import { evaluateRandomTape, planRandomTape, prepareRandomTape, type RandomTapeInput } from "../../packages/automation/src/scratch-random";
import * as randomModule from "../../packages/automation/src/scratch-random";
import { sweepAutomationRetention } from "../../packages/automation/src/retention";
import type { AutomationAdmissionLimits } from "../../packages/automation/src/quota";
import type { FlowDefinition, JsonValue, Statement, ValueInput, ValueType } from "../../packages/automation/src/types";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
const channel = "881222222222222222";
const admission: AutomationAdmissionLimits = { activeFlows: 20, monthlyRuns: 100, guildConcurrent: 2, globalConcurrent: 4, guildPending: 20, globalPending: 200, measurementId: "isolated-scratch-random-tests" };
const actor: Actor = { key: createHash("sha256").update("synthetic-random-admin").digest("hex"), encryptedUserId: "synthetic-encrypted-identity", permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: "scratch-random-fixture" };
const literal = (type: ValueType, value: JsonValue): ValueInput => ({ kind: "literal", type, value });
const integer = (lower = -Number.MAX_SAFE_INTEGER, upper = Number.MAX_SAFE_INTEGER): Statement => ({ kind: "random", id: "draw", mode: "integer", min: literal("Number", lower), max: literal("Number", upper), output: { id: "picked", name: "Picked", type: "Number" } });
function send(): Statement { return { kind: "action", id: "after", operation: "discord.sendMessage", inputs: { channel: literal("ChannelRef", { id: channel, guildId: "placeholder" }), content: literal("PlainText", "Synthetic fixture only") } }; }
beforeAll(async () => { vi.stubEnv("NEXUS_HOSTED_BETA", "off"); infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterEach(async () => {
  vi.restoreAllMocks();
  // Each test owns its synthetic runs. Release their real admission reservations
  // so independent cases cannot exhaust the intentionally small global quota.
  if (db) for (const run of (await sql<{ organization_id: string; guild_id: string; id: string }>`SELECT organization_id,guild_id,id FROM automation_runs WHERE ended_at IS NULL`.execute(db)).rows) {
    await new AutomationStore(db).cancel({ organizationId: run.organization_id, guildId: run.guild_id }, run.id);
  }
});
afterAll(async () => { await db?.destroy(); await infra?.stop(); vi.unstubAllEnvs(); });

async function fixture(body: Statement[] = [integer(), { kind: "end", id: "end" }], attempts = 32, legacy = false) {
  const scope = scopeForGuild(String(881000000000000000n + BigInt(++serial))); await ensureGuild(db, scope);
  const clock = { now: new Date() }, calls: string[] = [];
  const fix = (value: unknown): unknown => Array.isArray(value) ? value.map(fix) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "guildId" && item === "placeholder" ? scope.guildId : fix(item)])) : value;
  const definition: FlowDefinition = { schemaVersion: 1, ...(legacy ? {} : { semanticProfile: "scratch.v1" as const }), id: "scratch-random-" + serial, name: "Synthetic random", guildId: scope.guildId, trigger: { kind: "manual", inputs: [] }, targets: { channelIds: [channel], roleIds: [], parentCategoryIds: [] }, variables: [], body: fix(body) as Statement[] };
  const service = new AutomationService(db, { admission, scratchRandomAttempts: attempts, now: () => clock.now, authorize: async () => {}, adoptedActions: new Set(["discord.sendMessage"]) });
  const saved = await service.save(scope, actor, { definition, expectedRevision: 0, requestId: randomUUID() }); expect(saved.validation.issues).toEqual([]);
  // Private synthetic rows isolate runtime/storage here; public review/activation
  // is covered by service tests, and no real Discord connector is constructed.
  await sql`UPDATE automation_flows SET state='ACTIVE',active_revision=1 WHERE ${tenant(scope)} AND id=${definition.id}`.execute(db);
  const adapter: AutomationRuntimeAdapter = { authorize: async () => {}, execute: async context => { calls.push(context.identity); return { state: "SUCCEEDED" }; } };
  const runtime = new AutomationRuntime(db, { admission, scratchRandomAttempts: attempts, adapter, now: () => clock.now });
  const run = await service.start(scope, actor, definition.id, { requestId: randomUUID() });
  return { scope, clock, service, runtime, run, adapter, calls, definition, attempts };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const savedRun = async (f: Fixture) => (await f.service.store.run(f.scope, f.run.id))!;
const rows = async (f: Fixture) => (await sql<RandomTapeRecord & { identity: string }>`SELECT identity,fingerprint,input,result FROM automation_random_results WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid ORDER BY identity`.execute(db)).rows;
function stored(f: Fixture, identity: string, input: RandomTapeInput, byte = 0, attempts = f.attempts, type: ValueType = "Number"): StoredRandomTapeInput {
  return { version: 1, material: prepareRandomTape(planRandomTape(input, attempts), { id: identity, maxMaterialBytes: 65536, maxCandidateTrials: 5000 }, size => new Uint8Array(size).fill(byte)), type, provenance: [{ source: "service", guildId: f.scope.guildId, resumable: true }] };
}
async function prepare(f: Fixture, input: RandomTapeInput = { mode: "integer", lower: 0, upper: 2 }, byte = 0, attempts = f.attempts) {
  const run = await savedRun(f), state = structuredClone(run.resume), frame = state.frames.at(-1)!;
  const statement = f.definition.body[frame.index]!;
  const identity = dynamicExecutionIdentity(run, state.frames, statement.id);
  state.steps++; state.chargedStepIdentity = identity; state.evaluations += attempts + 2;
  const store = new RandomTapeStore(db, () => f.clock.now);
  const record = await store.prepare(f.scope, f.run.id, identity, state, fingerprint(run.resume), 65536, () => stored(f, identity, input, byte, attempts), f.clock.now);
  return { store, record, identity, state };
}
function completedState(state: ResumeState, value: JsonValue): ResumeState {
  const next = structuredClone(state); next.frames.at(-1)!.index++; next.frames.at(-1)!.locals.push("picked");
  next.variables.picked = { type: "Number", value, provenance: [] }; delete next.chargedStepIdentity; return next;
}

it("T126/S037 runs the full safe-integer range with a 54-bit durable tape", async () => {
  const f = await fixture(); expect(await f.runtime.tick(f.scope, f.run.id, 1)).toMatchObject({ state: "RUNNING" });
  const run = await savedRun(f), draw = (await rows(f))[0]!;
  expect(draw.input.material.bitWidths).toEqual([54]); expect(draw.input.material.attemptLimit).toBe(32);
  expect(draw.result.state).toBe("SUCCEEDED"); const value = run.resume.variables.picked!.value as number;
  expect(Number.isSafeInteger(value)).toBe(true); expect(value).toBeGreaterThanOrEqual(-Number.MAX_SAFE_INTEGER); expect(value).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  expect(run.resume.evaluations).toBe(34); expect(run.resume.frames[0]!.index).toBe(1);
});
it("T104/T125/S043 runs decimal interpolation over the maximum opposite-sign endpoints", async () => {
  const f = await fixture([{ kind: "random", id: "draw", mode: "decimal", min: literal("Number", -Number.MAX_VALUE), max: literal("Number", Number.MAX_VALUE), output: { id: "picked", name: "Picked", type: "Number" } }]);
  expect(await f.runtime.tick(f.scope, f.run.id, 1)).toMatchObject({ state: "RUNNING" });
  const run = await savedRun(f), value = run.resume.variables.picked!.value as number;
  expect(Number.isFinite(value)).toBe(true); expect(value).toBeGreaterThanOrEqual(-Number.MAX_VALUE); expect(value).toBeLessThan(Number.MAX_VALUE);
  expect((await rows(f))[0]!.input.material.bitWidths).toEqual([53]); expect(run.resume.evaluations).toBe(3);
});
it("T108 fixes shuffle/sample from their input snapshot and emits no input contents in events", async () => {
  const candidates = ["private-candidate-A", "private-candidate-B", "private-candidate-C"];
  const f = await fixture([{ kind: "random", id: "draw", mode: "shuffle", list: literal({ kind: "List", element: "PlainText" }, candidates), output: { id: "picked", name: "Picked", type: { kind: "List", element: "PlainText" } } }]);
  expect(await f.runtime.tick(f.scope, f.run.id, 1)).toMatchObject({ state: "RUNNING" });
  expect([...(await savedRun(f)).resume.variables.picked!.value as string[]].sort()).toEqual(candidates);
  const logs = JSON.stringify((await sql`SELECT * FROM automation_run_events WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(db)).rows);
  expect(logs).not.toContain("private-candidate"); expect(logs).not.toContain("entropyHex");
  const empty = await fixture([{ kind: "random", id: "draw", mode: "sample", list: literal({ kind: "List", element: "Number" }, [1, 2, 3]), count: literal("Number", 0), output: { id: "picked", name: "Picked", type: { kind: "List", element: "Number" } } }]);
  await empty.runtime.tick(empty.scope, empty.run.id, 1);
  expect((await savedRun(empty)).resume.variables.picked!.value).toEqual([]); expect((await rows(empty))[0]!.input.material.entropyHex).toBe("");
});
it("S040-S042 restarts from committed material without re-evaluating bounds or charging Q twice", async () => {
  const f = await fixture([integer(0, 2), { kind: "wait", id: "wait", duration: literal("Duration", 1) }]);
  const prepared = await prepare(f), before = await savedRun(f);
  const make = vi.spyOn(RandomTapeStore.prototype, "prepare");
  expect(await f.runtime.tick(f.scope, f.run.id, 1)).toMatchObject({ state: "RUNNING" });
  expect(make).toHaveBeenCalledOnce(); const after = await savedRun(f), draw = (await rows(f))[0]!;
  expect(draw.input).toEqual(prepared.record.input); expect(draw.fingerprint).toBe(prepared.record.fingerprint);
  expect(after.resume.variables.picked!.value).toBe(0); expect(after.resume.evaluations).toBe(before.resume.evaluations); expect(after.resume.steps).toBe(before.resume.steps);
  expect(after.resume.frames[0]!.index).toBe(1); expect(draw.result).toEqual({ state: "SUCCEEDED", value: 0, consumedTrials: 1 });
});
it("S039/S041 fixes exhausted failure across restart and never increases attempts", async () => {
  const f = await fixture([integer(0, 2), send()], 2); const prepared = await prepare(f, { mode: "integer", lower: 0, upper: 2 }, 255, 2);
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "FAILED" }); expect(f.calls).toHaveLength(0);
  const first = (await rows(f))[0]!, run = await savedRun(f);
  expect(first.result).toEqual({ state: "FAILED", code: "RandomSamplingExhausted", consumedTrials: 2 });
  expect(first.input).toEqual(prepared.record.input); expect(run.resume.evaluations).toBe(4);
  await f.runtime.tick(f.scope, f.run.id); expect((await rows(f))[0]).toEqual(first); expect((await savedRun(f)).ended_at).toEqual(run.ended_at);
});
it("S040 serializes two competing preparation workers and calls the bit source once", async () => {
  const f = await fixture(), run = await savedRun(f), initial = fingerprint(run.resume); let generated = 0;
  const state = structuredClone(run.resume); state.evaluations = 32; state.steps = 1;
  const make = () => { generated++; return stored(f, "competing", { mode: "integer", lower: 0, upper: 2 }, generated === 1 ? 0 : 255); };
  const a = new RandomTapeStore(db), b = new RandomTapeStore(db);
  const [first, second] = await Promise.all([a.prepare(f.scope, f.run.id, "competing", structuredClone(state), initial, 65536, make, f.clock.now), b.prepare(f.scope, f.run.id, "competing", structuredClone(state), initial, 65536, make, f.clock.now)]);
  expect(first).toEqual(second); expect(generated).toBe(1); expect(await rows(f)).toHaveLength(1); expect((await savedRun(f)).resume.evaluations).toBe(32);
});
it("S040 resumes a lost preparation acknowledgement with the same material and original PC", async () => {
  const f = await fixture([integer(0, 2), send()]), original = RandomTapeStore.prototype.prepare;
  vi.spyOn(RandomTapeStore.prototype, "prepare").mockImplementationOnce(async function(this: RandomTapeStore, ...args) { await original.call(this, ...args); throw Error("synthetic preparation acknowledgement lost"); });
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "RUNNING" }); expect(f.calls).toHaveLength(0);
  const first = (await rows(f))[0]!, reserved = (await savedRun(f)).resume.evaluations;
  expect(first.result).toMatchObject({ state: "PREPARED", evaluationReservations: 0 }); expect((await savedRun(f)).resume.frames[0]!.index).toBe(0);
  expect(await f.runtime.tick(f.scope, f.run.id, 1)).toMatchObject({ state: "RUNNING" });
  expect((await rows(f))[0]!.input).toEqual(first.input); expect((await savedRun(f)).resume.evaluations).toBe(reserved);
});
it("S041 resumes a lost completion acknowledgement from the committed next PC", async () => {
  const f = await fixture([integer(0, 2), send()]), original = RandomTapeStore.prototype.complete;
  vi.spyOn(RandomTapeStore.prototype, "complete").mockImplementationOnce(async function(this: RandomTapeStore, ...args) { await original.call(this, ...args); throw Error("synthetic completion acknowledgement lost"); });
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "RUNNING" }); expect(f.calls).toHaveLength(0);
  const first = (await rows(f))[0]!, reserved = (await savedRun(f)).resume.evaluations;
  expect(first.result.state).toBe("SUCCEEDED"); expect((await savedRun(f)).resume.frames[0]!.index).toBe(1);
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "COMPLETED" }); expect(f.calls).toHaveLength(1);
  expect((await rows(f))[0]!.input).toEqual(first.input); expect((await savedRun(f)).resume.evaluations).toBe(reserved + 2);
});
it("S041 replays prepared material with unchanged logical Q while charging the repeated computation", async () => {
  const f = await fixture([integer(0, 2), send()]);
  vi.spyOn(RandomTapeStore.prototype, "complete").mockRejectedValueOnce(Error("synthetic completion not committed"));
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "RUNNING" }); expect(f.calls).toHaveLength(0);
  const first = (await rows(f))[0]!, reserved = (await savedRun(f)).resume.evaluations;
  expect(first.result).toMatchObject({ state: "PREPARED", evaluationReservations: 1 }); expect((await savedRun(f)).resume.frames[0]!.index).toBe(0);
  expect(await f.runtime.tick(f.scope, f.run.id, 1)).toMatchObject({ state: "RUNNING" });
  expect((await rows(f))[0]!.input).toEqual(first.input); expect((await savedRun(f)).resume.evaluations).toBe(reserved + f.attempts);
});
it("stops an uncommitted preparation failure without a new tape or later operation", async () => {
  const f = await fixture([integer(0, 2), send()]); vi.spyOn(RandomTapeStore.prototype, "prepare").mockRejectedValueOnce(Error("synthetic write unavailable"));
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "FAILED" }); expect(await rows(f)).toHaveLength(0); expect(f.calls).toHaveLength(0);
  await f.runtime.tick(f.scope, f.run.id); expect(await rows(f)).toHaveLength(0);
});
it("S041 rejects stale reservations and commits result/next PC atomically or not at all", async () => {
  const f = await fixture([integer(0, 2)]), before = await savedRun(f), initial = fingerprint(before.resume), prepared = await prepare(f); let generated = false;
  await expect(prepared.store.prepare(f.scope, f.run.id, "stale-other", structuredClone(before.resume), initial, 65536, () => { generated = true; return stored(f, "stale-other", { mode: "integer", lower: 0, upper: 2 }); }, f.clock.now)).rejects.toThrow("AUTOMATION_CHECKPOINT_CONFLICT");
  expect(generated).toBe(false); expect(await rows(f)).toHaveLength(1);
  await prepared.store.reserveEvaluation(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, prepared.state, 5000, 65536, f.clock.now);
  const outcome = evaluateRandomTape(prepared.record.input.material); expect(outcome.state).toBe("SUCCEEDED");
  const next = completedState(prepared.state, 0);
  await expect(prepared.store.complete(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, outcome, next, 1, f.clock.now)).rejects.toThrow("AUTOMATION_STATE_LIMIT");
  expect((await rows(f))[0]!.result.state).toBe("PREPARED"); expect((await savedRun(f)).resume.frames[0]!.index).toBe(0);
  await prepared.store.complete(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, outcome, next, 65536, f.clock.now);
  const frozen = await savedRun(f); expect(frozen.resume.frames[0]!.index).toBe(1); expect((await rows(f))[0]!.result.state).toBe("SUCCEEDED");
  const repeated = await prepared.store.complete(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, { state: "FAILED", code: "RandomSamplingExhausted", consumedTrials: 100 }, before.resume, 65536, f.clock.now);
  expect(repeated.result).toEqual(outcome); expect((await savedRun(f)).resume).toEqual(frozen.resume);
});
it("S042 returns the fixed result after later variables change without re-evaluation or checkpoint rollback", async () => {
  const f = await fixture([integer(0, 2)]); await f.runtime.tick(f.scope, f.run.id, 1);
  const first = (await rows(f))[0]!, run = await savedRun(f), state = structuredClone(run.resume);
  state.variables.later = { type: "Number", value: 999, provenance: [] };
  await sql`UPDATE automation_runs SET resume=${json(state)} WHERE ${tenant(f.scope)} AND id=${f.run.id}::uuid`.execute(db);
  let generated = false;
  const repeated = await new RandomTapeStore(db).prepare(f.scope, f.run.id, first.identity, state, fingerprint(run.resume), 65536, () => { generated = true; return stored(f, first.identity, { mode: "integer", lower: 999, upper: 1000 }); }, f.clock.now);
  expect(generated).toBe(false); expect(repeated.result).toEqual(first.result); expect((await savedRun(f)).resume.variables.later!.value).toBe(999);
});
it("checks remaining logical trials and material bytes before any preparation is durable", async () => {
  const f = await fixture([integer(0, 2)], 200), run = await savedRun(f); run.resume.evaluations = 4900;
  await sql`UPDATE automation_runs SET resume=${json(run.resume)},evaluations=4900 WHERE ${tenant(f.scope)} AND id=${f.run.id}::uuid`.execute(db);
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "FAILED" }); expect(await rows(f)).toHaveLength(0);
  expect((await savedRun(f)).reason).toBe("AUTOMATION_EVALUATION_LIMIT"); expect((await savedRun(f)).resume.evaluations).toBe(4902);
  const small = await fixture(), original = await savedRun(small); let generated = false;
  await expect(new RandomTapeStore(db).prepare(small.scope, small.run.id, "no-bytes", original.resume, fingerprint(original.resume), 1, () => { generated = true; return stored(small, "no-bytes", { mode: "integer", lower: 0, upper: 2 }); }, small.clock.now)).rejects.toThrow("AUTOMATION_STATE_LIMIT");
  expect(generated).toBe(false); expect(await rows(small)).toHaveLength(0);
});
it("S059 refuses completion/preparation after cancellation, terminal state or physical deletion", async () => {
  const f = await fixture(), prepared = await prepare(f), outcome = evaluateRandomTape(prepared.record.input.material);
  await f.service.store.cancel(f.scope, f.run.id, f.clock.now); const ended = (await savedRun(f)).ended_at;
  await expect(prepared.store.complete(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, outcome, prepared.state, 65536, f.clock.now)).rejects.toThrow("AUTOMATION_STOPPED");
  await expect(prepared.store.prepare(f.scope, f.run.id, "late", prepared.state, fingerprint(prepared.state), 65536, () => stored(f, "late", { mode: "integer", lower: 0, upper: 2 }), f.clock.now)).rejects.toThrow("AUTOMATION_STOPPED");
  expect((await savedRun(f)).ended_at).toEqual(ended);
  await sql`DELETE FROM automation_runs WHERE ${tenant(f.scope)} AND id=${f.run.id}::uuid`.execute(db); expect(await rows(f)).toHaveLength(0);
  await expect(prepared.store.prepare(f.scope, f.run.id, prepared.identity, prepared.state, fingerprint(prepared.state), 65536, () => stored(f, prepared.identity, { mode: "integer", lower: 0, upper: 2 }), f.clock.now)).rejects.toThrow("AUTOMATION_STOPPED");
  expect(await prepared.store.reconcile(f.scope, f.run.id, prepared.identity)).toBeNull(); expect(await rows(f)).toHaveLength(0);
});
it.each([["prepare", "local"], ["complete", "local"], ["prepare", "run"], ["complete", "run"]] as const)("S015 rechecks %s %s deadline after waiting for the run lock", async (stage, boundary) => {
  const f = await fixture([integer(0, 2)]), localDeadline = new Date(f.clock.now.getTime() + 1000);
  const prepared = stage === "complete" ? await prepare(f) : null;
  if (prepared) await prepared.store.reserveEvaluation(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, prepared.state, 5000, 65536, f.clock.now);
  if (boundary === "run") await sql`UPDATE automation_runs SET deadline_at=${localDeadline} WHERE ${tenant(f.scope)} AND id=${f.run.id}::uuid`.execute(db);
  const run = await savedRun(f);
  let entered!: () => void, release!: () => void;
  const held = new Promise<void>(resolve => { entered = resolve; }), done = new Promise<void>(resolve => { release = resolve; });
  const blocker = db.transaction().execute(async tx => { await sql`SELECT id FROM automation_runs WHERE ${tenant(f.scope)} AND id=${f.run.id}::uuid FOR UPDATE`.execute(tx); entered(); await done; });
  await held; let generated = false;
  const store = new RandomTapeStore(db, () => f.clock.now);
  const pending = prepared
    ? store.complete(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, evaluateRandomTape(prepared.record.input.material), completedState(prepared.state, 0), 65536, f.clock.now, localDeadline)
    : store.prepare(f.scope, f.run.id, "delayed", run.resume, fingerprint(run.resume), 65536, () => { generated = true; return stored(f, "delayed", { mode: "integer", lower: 0, upper: 2 }); }, f.clock.now, localDeadline);
  const result = pending.then(() => "unexpected-success", (error: Error) => error.message);
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) { waiting = (await sql<{ waiting: boolean }>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%automation_runs%') AS waiting`.execute(db)).rows[0]!.waiting; if (waiting) break; await delay(10); }
    expect(waiting).toBe(true); f.clock.now = localDeadline;
  } finally { release(); await blocker; }
  expect(await result).toBe(boundary === "local" ? "AUTOMATION_LOCAL_DEADLINE" : "AUTOMATION_STOPPED"); expect(generated).toBe(false);
  expect(await rows(f)).toHaveLength(prepared ? 1 : 0); if (prepared) expect((await rows(f))[0]!.result.state).toBe("PREPARED");
});
it("S041 charges a second prepared replay before candidate access and stops when its shared budget is insufficient", async () => {
  const f = await fixture([integer(0, 2), send()]), run = await savedRun(f); run.resume.evaluations = 4960;
  await sql`UPDATE automation_runs SET resume=${json(run.resume)},evaluations=4960 WHERE ${tenant(f.scope)} AND id=${f.run.id}::uuid`.execute(db);
  vi.spyOn(RandomTapeStore.prototype, "complete").mockRejectedValueOnce(Error("synthetic result acknowledgement interrupted"));
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "RUNNING" });
  const first = (await rows(f))[0]!, expected = evaluateRandomTape(first.input.material);
  expect(first.result).toMatchObject({ state: "PREPARED", evaluationReservations: 1 }); expect((await savedRun(f)).resume.evaluations).toBe(4994);
  const evaluation = vi.spyOn(randomModule, "evaluateRandomTape");
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "FAILED" }); expect(evaluation).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
  const stopped = await savedRun(f), after = (await rows(f))[0]!;
  expect(stopped.reason).toBe("AUTOMATION_EVALUATION_LIMIT"); expect(stopped.resume.evaluations).toBe(4994);
  expect(after.input).toEqual(first.input); expect(after.result).toEqual(first.result); expect(evaluateRandomTape(after.input.material)).toEqual(expected);
  await sweepAutomationRetention(db, new Date(stopped.ended_at!.getTime() + 7 * 86400000)); expect(await rows(f)).toHaveLength(0);
});
it("S041 refuses a stale completion checkpoint without publishing a result or rolling the current PC back", async () => {
  const f = await fixture([integer(0, 2)]), prepared = await prepare(f);
  await prepared.store.reserveEvaluation(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, prepared.state, 5000, 65536, f.clock.now);
  const state = structuredClone((await savedRun(f)).resume); state.variables.changed = { type: "Number", value: 8, provenance: [] };
  await sql`UPDATE automation_runs SET resume=${json(state)} WHERE ${tenant(f.scope)} AND id=${f.run.id}::uuid`.execute(db);
  await expect(prepared.store.complete(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, evaluateRandomTape(prepared.record.input.material), completedState(prepared.state, 0), 65536, f.clock.now)).rejects.toThrow("AUTOMATION_RANDOM_CHECKPOINT_CONFLICT");
  expect((await rows(f))[0]!.result.state).toBe("PREPARED"); expect((await savedRun(f)).resume).toEqual(state);
});
it("S041 advances the global checkpoint version once per successful random write and never on rollback or final reread", async () => {
  const f = await fixture([integer(0, 2)]), initial = (await savedRun(f)).resume.checkpointVersion ?? 0, prepared = await prepare(f);
  expect(prepared.state.checkpointVersion).toBe(initial + 1); expect((await savedRun(f)).resume.checkpointVersion).toBe(initial + 1);
  expect(prepared.record.input.preparedCheckpointFingerprint).toBe(fingerprint(prepared.state));
  const stale = structuredClone(prepared.state);
  await expect(prepared.store.reserveEvaluation(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, prepared.state, 5000, 1, f.clock.now)).rejects.toThrow("AUTOMATION_STATE_LIMIT");
  expect(prepared.state.checkpointVersion).toBe(initial + 1); expect((await savedRun(f)).resume.checkpointVersion).toBe(initial + 1);
  const reserved = await prepared.store.reserveEvaluation(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, prepared.state, 5000, 65536, f.clock.now);
  expect(prepared.state.checkpointVersion).toBe(initial + 2); expect(reserved.result).toMatchObject({ state: "PREPARED", checkpointFingerprint: fingerprint(prepared.state) });
  await expect(prepared.store.reserveEvaluation(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, stale, 5000, 65536, f.clock.now)).rejects.toThrow("AUTOMATION_CHECKPOINT_CONFLICT");
  const outcome = evaluateRandomTape(prepared.record.input.material), next = completedState(prepared.state, 0);
  await expect(prepared.store.complete(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, outcome, next, 1, f.clock.now)).rejects.toThrow("AUTOMATION_STATE_LIMIT");
  expect(next.checkpointVersion).toBe(initial + 2); expect((await savedRun(f)).resume.checkpointVersion).toBe(initial + 2);
  await prepared.store.complete(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, outcome, next, 65536, f.clock.now);
  expect(next.checkpointVersion).toBe(initial + 3); expect((await savedRun(f)).resume.checkpointVersion).toBe(initial + 3);
  expect((await rows(f))[0]!.input).toEqual(prepared.record.input);
  const reread = await prepared.store.complete(f.scope, f.run.id, prepared.identity, prepared.record.fingerprint, outcome, stale, 65536, f.clock.now);
  expect(reread.result).toEqual(outcome); expect(stale.checkpointVersion).toBe(initial + 1); expect((await savedRun(f)).resume.checkpointVersion).toBe(initial + 3);
});
it("S041 rereads a competing final result but fences the stale worker before a normal checkpoint or later operation", async () => {
  const f = await fixture([integer(0, 2), send()]); await prepare(f);
  const original = RandomTapeStore.prototype.prepare; let winner: ResumeState | undefined;
  vi.spyOn(RandomTapeStore.prototype, "prepare").mockImplementationOnce(async function(this: RandomTapeStore, ...args) {
    const record = await original.call(this, ...args), state = structuredClone((await savedRun(f)).resume);
    await this.reserveEvaluation(f.scope, f.run.id, args[2], record.fingerprint, state, 5000, 65536, f.clock.now);
    const outcome = evaluateRandomTape(record.input.material); if (outcome.state !== "SUCCEEDED") throw Error("synthetic fixture must succeed");
    winner = completedState(state, outcome.value);
    return this.complete(f.scope, f.run.id, args[2], record.fingerprint, outcome, winner, 65536, f.clock.now);
  });
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "RUNNING" }); expect(f.calls).toHaveLength(0);
  expect((await savedRun(f)).resume).toEqual(winner); expect((await savedRun(f)).ended_at).toBeNull();
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({ state: "COMPLETED" }); expect(f.calls).toHaveLength(1);
});
it("preserves missing-profile legacy random result rows without rewriting them into the tape format", async () => {
  const f = await fixture([integer(1, 100)], 32, true), run = await savedRun(f);
  const identity = dynamicExecutionIdentity(run, run.resume.frames, "draw"), input = { mode: "integer", lower: 1, upper: 100 };
  const old = await f.service.store.randomOnce(f.scope, f.run.id, identity, () => ({ input, fingerprint: fingerprint(input), result: { type: "Number", value: 23, provenance: [] } }));
  expect(await f.runtime.tick(f.scope, f.run.id, 1)).toMatchObject({ state: "RUNNING" }); expect((await savedRun(f)).resume.variables.picked!.value).toBe(23);
  expect(await f.service.store.randomResult(f.scope, f.run.id, identity)).toEqual(old);
  expect((await savedRun(f)).resume.checkpointVersion).toBeUndefined();
});
it("S059 deletes both frozen entropy and result at the seven-day terminal boundary", async () => {
  const f = await fixture([integer(0, 2), { kind: "end", id: "end" }]); await f.runtime.tick(f.scope, f.run.id);
  const run = await savedRun(f); expect(run.ended_at).not.toBeNull(); expect(await rows(f)).toHaveLength(1);
  await sweepAutomationRetention(db, new Date(run.ended_at!.getTime() + 7 * 86400000 - 1)); expect(await rows(f)).toHaveLength(1);
  await sweepAutomationRetention(db, new Date(run.ended_at!.getTime() + 7 * 86400000)); expect(await rows(f)).toHaveLength(0); expect(await f.service.store.run(f.scope, f.run.id)).toBeNull();
});
