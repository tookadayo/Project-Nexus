import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { connect, ensureGuild, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import type { Actor } from "../../packages/settings/src/index";
import { compileFlowDefinition } from "../../packages/automation/src/definition";
import { AutomationRuntime, dynamicExecutionIdentity, type AutomationRuntimeAdapter } from "../../packages/automation/src/runtime";
import { AutomationScheduler } from "../../packages/automation/src/scheduler";
import { AutomationService } from "../../packages/automation/src/service";
import { fingerprint } from "../../packages/automation/src/store";
import { currentScheduleMeaningReader } from "../../packages/automation/src/schedule-rules";
import type { FlowDefinition, Statement, TriggerDefinition } from "../../packages/automation/src/types";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
const actor: Actor = { key: "synthetic-datetime-admin", encryptedUserId: "synthetic-encrypted", permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: "synthetic" };
const admission = { activeFlows: 20, monthlyRuns: 100, guildConcurrent: 2, globalConcurrent: 20, guildPending: 20, globalPending: 200, measurementId: "isolated-datetime-v2" };
beforeAll(async () => {
  vi.stubEnv("NEXUS_HOSTED_BETA", "off"); infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db);
});
afterAll(async () => { await db?.destroy(); await infra?.stop(); vi.unstubAllEnvs(); });

const calendar = (): TriggerDefinition => ({ kind: "schedule", schedule: {
  kind: "recurring", frequency: "daily", time: "09:00:42", timePrecision: "second", timeZone: "America/New_York",
  startDate: "2026-11-01", endDate: "2026-12-31", missingTime: "skip", repeatedTime: "earlier", pastOccurrences: "skip",
} });
async function fixture(trigger: TriggerDefinition = calendar(), body: Statement[] = [{ kind: "end", id: "end" }]) {
  const s = scopeForGuild(String(889500000000000000n + BigInt(++serial))); await ensureGuild(db, s);
  const clock = { now: new Date("2026-11-01T00:00:00.123Z") }, reader = { ...currentScheduleMeaningReader() };
  const options = { admission, authorize: async () => {}, now: () => clock.now, scheduleMeaningReader: reader };
  const definition: FlowDefinition = { schemaVersion: 1, semanticProfile: "scratch.v1", id: `datetime-${serial}`, name: "Synthetic datetime", guildId: s.guildId, trigger, variables: [], body };
  const service = new AutomationService(db, options), saved = await service.save(s, actor, { definition, expectedRevision: 0, requestId: randomUUID() });
  for (const kind of ["VALIDATE", "TEST", "IMPACT"] as const) expect((await service.check(s, actor, definition.id, 1, kind)).valid).toBe(true);
  await service.enable(s, actor, definition.id, { revision: 1, semanticHash: saved.validation.semanticHash!, requestId: randomUUID() });
  const adapter: AutomationRuntimeAdapter = { authorize: async () => {}, execute: async () => { throw new Error("NO_EXTERNAL_EFFECT_EXPECTED"); } };
  const runtime = () => new AutomationRuntime(db, { admission, adapter, now: () => clock.now });
  const scheduler = () => new AutomationScheduler(db, service, () => clock.now);
  const schedule = async () => (await sql<{ generation: number; next_at: Date | null; enabled: boolean; review_required: boolean }>`SELECT * FROM automation_schedules WHERE ${tenant(s)} AND id=${definition.id}`.execute(db)).rows[0]!;
  return { s, clock, reader, service, definition, runtime, scheduler, schedule };
}

it("fixes a second-precision calendar occurrence into one Run across concurrent dispatch and scheduler restart", async () => {
  const f = await fixture(), planned = await f.schedule(); f.clock.now = planned.next_at!;
  const attempts = await Promise.all([f.scheduler().dispatch(f.s, f.definition.id, planned.generation, planned.next_at!.toISOString()), f.scheduler().dispatch(f.s, f.definition.id, planned.generation, planned.next_at!.toISOString())]);
  expect(attempts.filter(result => result.state === "STARTED")).toHaveLength(1);
  const rows = (await sql<{ id: string }>`SELECT id FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows; expect(rows).toHaveLength(1);
  const run = (await f.service.store.run(f.s, rows[0]!.id))!;
  const snapshot = { scheduleId: f.definition.id, occurrenceKey: fingerprint({ id: f.definition.id, generation: planned.generation, at: planned.next_at!.toISOString() }), generation: planned.generation, revision: 1, timeZone: "America/New_York", localDate: "2026-11-01", localTime: "09:00:42", instant: "2026-11-01T14:00:42.000Z", offset: "-05:00" };
  expect(run.resume.scheduleOccurrence).toEqual(snapshot);
  expect(await f.scheduler().dispatch(f.s, f.definition.id, planned.generation, planned.next_at!.toISOString())).toMatchObject({ state: "STALE" });
  expect((await f.service.store.run(f.s, run.id))!.resume.scheduleOccurrence).toEqual(snapshot);
  expect((await sql`SELECT occurrence_key FROM automation_occurrences WHERE ${tenant(f.s)} AND state='STARTED'`.execute(db)).rows).toHaveLength(1);
  expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(1);
});

it("retains elapsed millisecond anchors and does not invent regional fields in the Run snapshot", async () => {
  const f = await fixture({ kind: "schedule", schedule: { kind: "elapsed", anchor: "2026-11-01T00:01:00.000Z", intervalSeconds: 60, end: "2026-11-01T00:10:00.000Z", pastOccurrences: "skip" } });
  // Existing saved anchors can have milliseconds. Represent that historical
  // definition directly, rather than claiming authoring accepts a new ms input.
  const legacyDefinition: FlowDefinition = { ...f.definition, trigger: { kind: "schedule", schedule: { kind: "elapsed", anchor: "2026-11-01T00:01:00.123Z", intervalSeconds: 60, end: "2026-11-01T00:10:00.123Z", pastOccurrences: "skip" } } };
  const legacyPlan = compileFlowDefinition(legacyDefinition, { temporalResolution: "fixed" });
  await sql`UPDATE automation_revisions SET definition=${JSON.stringify(legacyDefinition)}::jsonb,semantic_hash=${legacyPlan.semanticHash} WHERE ${tenant(f.s)} AND flow_id=${f.definition.id} AND revision=1`.execute(db);
  await sql`UPDATE automation_schedules SET rule_hash=${legacyPlan.semanticHash},next_at=${new Date("2026-11-01T00:01:00.123Z")} WHERE ${tenant(f.s)} AND id=${f.definition.id}`.execute(db);
  const planned = await f.schedule(); f.clock.now = planned.next_at!;
  const started = await f.scheduler().dispatch(f.s, f.definition.id, planned.generation, planned.next_at!.toISOString());
  expect(started.state).toBe("STARTED");
  const run = (await f.service.store.run(f.s, (started as { id: string }).id))!;
  expect(run.resume.scheduleOccurrence).toEqual({ scheduleId: f.definition.id, occurrenceKey: fingerprint({ id: f.definition.id, generation: planned.generation, at: planned.next_at!.toISOString() }), generation: planned.generation, revision: 1, instant: "2026-11-01T00:01:00.123Z" });
  expect((await f.schedule()).next_at!.toISOString()).toBe("2026-11-01T00:02:00.123Z");
});

it("serializes a schedule cancellation against start and fences the old generation after a replacement revision", async () => {
  const f = await fixture(), old = await f.schedule(); f.clock.now = old.next_at!;
  await Promise.all([f.scheduler().dispatch(f.s, f.definition.id, old.generation, old.next_at!.toISOString()), f.service.disable(f.s, actor, f.definition.id, randomUUID())]);
  const accepted = (await sql<{ cancel_requested_at: Date | null }>`SELECT cancel_requested_at FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows;
  expect(accepted.length).toBeLessThanOrEqual(1); expect(accepted.every(run => run.cancel_requested_at !== null)).toBe(true);
  const replacement: FlowDefinition = { ...f.definition, trigger: { kind: "schedule", schedule: { ...(f.definition.trigger as Extract<TriggerDefinition, { kind: "schedule" }>).schedule as Extract<Extract<TriggerDefinition, { kind: "schedule" }>["schedule"], { kind: "recurring" }>, time: "10:00:43" } } };
  const saved = await f.service.save(f.s, actor, { definition: replacement, expectedRevision: 1, requestId: randomUUID() });
  for (const kind of ["VALIDATE", "TEST", "IMPACT"] as const) await f.service.check(f.s, actor, f.definition.id, 2, kind);
  await f.service.enable(f.s, actor, f.definition.id, { revision: 2, semanticHash: saved.validation.semanticHash!, requestId: randomUUID() });
  expect(await f.scheduler().dispatch(f.s, f.definition.id, old.generation, old.next_at!.toISOString())).toMatchObject({ state: "STALE" });
  const next = await f.schedule(); f.clock.now = next.next_at!;
  const started = await f.scheduler().dispatch(f.s, f.definition.id, next.generation, next.next_at!.toISOString());
  expect(started.state).toBe("STARTED");
  expect((await f.service.store.run(f.s, (started as { id: string }).id))!.resume.scheduleOccurrence).toMatchObject({ generation: next.generation, revision: 2, localTime: "10:00:43", instant: "2026-11-01T15:00:43.000Z" });
});

it("reuses an already committed dynamic clock result after restart and preserves fractional Wait timing", async () => {
  const f = await fixture({ kind: "manual", inputs: [] }, [
    { kind: "readClock", id: "clock", output: { id: "clock-value", name: "Clock", type: "Instant" } },
    { kind: "wait", id: "wait", duration: { kind: "literal", type: "Duration", value: 0.125 } },
    { kind: "end", id: "end" },
  ]);
  const startRequest = randomUUID(), started = await f.service.start(f.s, actor, f.definition.id, { requestId: startRequest }), initial = (await f.service.store.run(f.s, started.id))!;
  const identity = dynamicExecutionIdentity(initial, initial.resume.frames, "clock"), fixedClock = f.clock.now.toISOString();
  // A clock commit can survive a process exit before its statement checkpoint.
  await f.service.store.randomOnce(f.s, started.id, identity, () => ({ input: { clock: true }, fingerprint: fingerprint({ clock: true }), result: { type: "Instant", value: fixedClock, provenance: [{ source: "service", guildId: f.s.guildId, resumable: true }] } }));
  f.clock.now = new Date("2026-11-01T01:00:00.123Z");
  expect(await f.runtime().tick(f.s, started.id, 1)).toMatchObject({ state: "RUNNING" });
  expect((await f.service.store.run(f.s, started.id))!.resume.variables["clock-value"]!.value).toBe(fixedClock);
  expect(await f.runtime().tick(f.s, started.id)).toMatchObject({ state: "WAITING" });
  const paused = (await f.service.store.run(f.s, started.id))!;
  expect(paused.wake_at!.toISOString()).toBe("2026-11-01T01:00:00.248Z");
  expect(paused.started_at.toISOString()).toBe(initial.started_at.toISOString()); expect(paused.deadline_at.toISOString()).toBe(initial.deadline_at.toISOString());
  expect((await f.service.start(f.s, actor, f.definition.id, { requestId: startRequest })).id).toBe(started.id);
  f.clock.now = paused.wake_at!; expect(await f.runtime().tick(f.s, started.id)).toMatchObject({ state: "COMPLETED" });
  const clocks = (await sql<{ result: { value: string } }>`SELECT result FROM automation_random_results WHERE ${tenant(f.s)} AND run_id=${started.id}::uuid`.execute(db)).rows;
  expect(clocks).toEqual([{ result: { type: "Instant", value: fixedClock, provenance: [{ source: "service", guildId: f.s.guildId, resumable: true }] } }]);
});

it("keeps the accepted occurrence and a paused Run unchanged when timezone rules require future-start review", async () => {
  const f = await fixture(calendar(), [{ kind: "wait", id: "wait", duration: { kind: "literal", type: "Duration", value: 10.125 } }, { kind: "end", id: "end" }]);
  const planned = await f.schedule(); f.clock.now = planned.next_at!;
  const started = await f.scheduler().dispatch(f.s, f.definition.id, planned.generation, planned.next_at!.toISOString()), id = (started as { id: string }).id;
  expect(await f.runtime().tick(f.s, id)).toMatchObject({ state: "WAITING" }); const before = (await f.service.store.run(f.s, id))!;
  f.reader.version = "synthetic-updated-timezone-rules";
  const next = await f.schedule(); expect(await f.scheduler().dispatch(f.s, f.definition.id, next.generation, next.next_at!.toISOString())).toMatchObject({ state: "REVIEW_REQUIRED" });
  expect(await f.schedule()).toMatchObject({ enabled: false, review_required: true, next_at: null });
  const after = (await f.service.store.run(f.s, id))!;
  expect(after.resume.scheduleOccurrence).toEqual(before.resume.scheduleOccurrence); expect(after.wake_at).toEqual(before.wake_at);
  expect(after.started_at).toEqual(before.started_at); expect(after.deadline_at).toEqual(before.deadline_at); expect(after.cancel_requested_at).toBeNull();
  f.clock.now = after.wake_at!; expect(await f.runtime().tick(f.s, id)).toMatchObject({ state: "COMPLETED" });
});

it("resumes a trusted fixed zoned value without re-resolving its stored instant through today's timezone rules", async () => {
  const currentValue = { date: "2027-07-01", time: "09:00", timeZone: "America/New_York", instant: "2027-07-01T13:00:00.000Z", offset: "-04:00" };
  const f = await fixture({ kind: "manual", inputs: [] }, [
    { kind: "wait", id: "wait", duration: { kind: "literal", type: "Duration", value: 0.125 } },
    { kind: "declare", id: "fixed", variable: { id: "fixed-value", name: "Fixed", type: "ZonedDateTimeSpec" }, value: { kind: "literal", type: "ZonedDateTimeSpec", value: currentValue } },
    { kind: "end", id: "end" },
  ]);
  const started = await f.service.start(f.s, actor, f.definition.id, { requestId: randomUUID() }); expect(await f.runtime().tick(f.s, started.id)).toMatchObject({ state: "WAITING" });
  const before = (await f.service.store.run(f.s, started.id))!;
  // Isolated fixture represents a previously confirmed region rule. It is
  // inserted as a trusted saved revision, never through the user-edit boundary.
  const oldValue = { ...currentValue, instant: "2027-07-01T14:00:00.123Z", offset: "-05:00" }, oldDefinition = structuredClone(f.definition);
  // The previously accepted single occurrence can itself become a gap under
  // today's database; resuming its Run must not re-admit or resolve the trigger.
  oldDefinition.trigger = { kind: "schedule", schedule: { kind: "once", at: { date: "2027-03-14", time: "02:30", timeZone: "America/New_York" } } };
  (oldDefinition.body[1] as Extract<Statement, { kind: "declare" }>).value = { kind: "literal", type: "ZonedDateTimeSpec", value: oldValue };
  const oldPlan = compileFlowDefinition(oldDefinition, { temporalResolution: "fixed" });
  await sql`UPDATE automation_revisions SET definition=${JSON.stringify(oldDefinition)}::jsonb,semantic_hash=${oldPlan.semanticHash} WHERE ${tenant(f.s)} AND flow_id=${f.definition.id} AND revision=1`.execute(db);
  await sql`UPDATE automation_runs SET semantic_hash=${oldPlan.semanticHash} WHERE ${tenant(f.s)} AND id=${started.id}::uuid`.execute(db);
  f.clock.now = before.wake_at!; expect(await f.runtime().tick(f.s, started.id, 1)).toMatchObject({ state: "RUNNING" });
  const resumed = (await f.service.store.run(f.s, started.id))!;
  expect(resumed.resume.variables["fixed-value"]!.value).toEqual(oldValue); expect(resumed.started_at).toEqual(before.started_at); expect(resumed.deadline_at).toEqual(before.deadline_at);
  expect(await f.runtime().tick(f.s, started.id)).toMatchObject({ state: "COMPLETED" });
});
