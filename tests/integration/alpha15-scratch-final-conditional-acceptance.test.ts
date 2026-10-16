import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { connect, ensureGuild, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import type { Actor } from "../../packages/settings/src/index";
import { AutomationService } from "../../packages/automation/src/service";
import { AutomationRuntime } from "../../packages/automation/src/runtime";
import type { AutomationAdmissionLimits } from "../../packages/automation/src/quota";
import type { FlowDefinition, ValueInput } from "../../packages/automation/src/types";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
const actor: Actor = { key: "synthetic-conditional-admin", encryptedUserId: "synthetic-encrypted-identity", permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: "synthetic-conditional" };
const admission: AutomationAdmissionLimits = { activeFlows: 20, monthlyRuns: 100, guildConcurrent: 2, globalConcurrent: 4, guildPending: 20, globalPending: 100, measurementId: "isolated-conditional-fixtures" };
const number = (value: number): ValueInput => ({ kind: "literal", type: "Number", value });
const boolean = (value: boolean): ValueInput => ({ kind: "literal", type: "Boolean", value });
const condition = (value: "true" | "false" | "unknown"): ValueInput => ({ kind: "literal", type: "ConditionResult", value });
const missing: ValueInput = { kind: "missing", type: "Number" };
const choose = (args: ValueInput[]): ValueInput => ({ kind: "expression", type: "Number", expression: { operator: "value.choose", args } });

beforeAll(async () => { vi.stubEnv("NEXUS_HOSTED_BETA", "off"); infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); vi.unstubAllEnvs(); });

async function fixture(value: ValueInput) {
  const scope = scopeForGuild(String(886000000000000000n + BigInt(++serial)));
  await ensureGuild(db, scope);
  const clock = { now: new Date() };
  const definition: FlowDefinition = { schemaVersion: 1, semanticProfile: "scratch.v1", id: `conditional-${serial}`, guildId: scope.guildId,
    name: "Synthetic conditional acceptance", trigger: { kind: "manual", inputs: [] }, variables: [], body: [
      { kind: "declare", id: "declare", variable: { id: "answer", name: "Answer", type: "Number" }, value },
      { kind: "wait", id: "inspect.wait", duration: { kind: "literal", type: "Duration", value: 1 } },
    ] };
  const service = new AutomationService(db, { admission, now: () => clock.now, authorize: async () => {} });
  const runtime = new AutomationRuntime(db, { admission, now: () => clock.now, adapter: { authorize: async () => {}, execute: async () => { throw Error("NO_EXTERNAL_OPERATIONS_EXPECTED"); } } });
  const save = (expectedRevision: number) => service.save(scope, actor, { definition, expectedRevision, requestId: randomUUID() });
  return { scope, definition, clock, service, runtime, save };
}

for (const scenario of [
  { name: "T037 Boolean missing else", prefix: [boolean(false), number(7)], repaired: 19 },
  { name: "T040 value-returning C missing unknown (R02 does not reject ordinary CT01)", prefix: [condition("unknown"), number(7), number(19)], repaired: -11 },
]) {
  it(`${scenario.name}: rejects absent inputs; blocks draft activation; only executes the explicit repaired value`, async () => {
    const f = await fixture(choose(scenario.prefix));
    await expect(f.save(0)).rejects.toMatchObject({ code: "AUTOMATION_DEFINITION_INVALID" });
    const absent = (await sql<{ count: number }>`SELECT count(*)::integer AS count FROM automation_revisions WHERE ${tenant(f.scope)} AND flow_id=${f.definition.id}`.execute(db)).rows[0]!;
    expect(absent.count).toBe(0);

    const declaration = f.definition.body[0]!;
    if (declaration.kind !== "declare") throw Error("EXPECTED_DECLARATION");
    declaration.value = choose([...scenario.prefix, missing]);
    const saved = await f.save(0);
    expect(saved.validation.complete).toBe(false);
    expect(saved.validation.plan).toBeUndefined();
    expect(saved.definition).toEqual(f.definition);
    for (const kind of ["VALIDATE", "TEST", "IMPACT"] as const) {
      const checked = await f.service.check(f.scope, actor, f.definition.id, 1, kind);
      expect(checked.valid).toBe(false);
      expect(checked.complete).toBe(false);
    }
    await expect(f.service.enable(f.scope, actor, f.definition.id, { revision: 1, semanticHash: saved.validation.semanticHash!, requestId: randomUUID() })).rejects.toMatchObject({ code: "AUTOMATION_DEFINITION_INCOMPLETE" });
    const blocked = (await sql<{ state: string; active_revision: number | null; checks: number; runs: number }>`SELECT state,active_revision,(SELECT count(*)::integer FROM automation_checks WHERE ${tenant(f.scope)} AND flow_id=${f.definition.id}) AS checks,(SELECT count(*)::integer FROM automation_runs WHERE ${tenant(f.scope)} AND flow_id=${f.definition.id}) AS runs FROM automation_flows WHERE ${tenant(f.scope)} AND id=${f.definition.id}`.execute(db)).rows[0]!;
    expect(blocked).toEqual({ state: "DRAFT", active_revision: null, checks: 0, runs: 0 });

    declaration.value = choose([...scenario.prefix, number(scenario.repaired)]);
    const repaired = await f.save(1);
    expect(repaired.validation.issues).toEqual([]);
    for (const kind of ["VALIDATE", "TEST", "IMPACT"] as const) {
      const checked = await f.service.check(f.scope, actor, f.definition.id, 2, kind);
      expect(checked.valid).toBe(true);
      expect(checked.complete).toBe(true);
    }
    await expect(f.service.enable(f.scope, actor, f.definition.id, { revision: 2, semanticHash: repaired.validation.semanticHash!, requestId: randomUUID() })).resolves.toMatchObject({ state: "ACTIVE", activeRevision: 2 });
    const run = await f.service.start(f.scope, actor, f.definition.id, { requestId: randomUUID() });
    expect(await f.runtime.tick(f.scope, run.id)).toMatchObject({ state: "WAITING" });
    const waiting = (await f.service.store.run(f.scope, run.id))!;
    expect(waiting.resume.variables.answer!.value).toBe(scenario.repaired);
    expect(waiting.resume.variables.answer!.value).not.toBe(0);
    f.clock.now = new Date(f.clock.now.getTime() + 1100);
    expect(await f.runtime.tick(f.scope, run.id)).toMatchObject({ state: "COMPLETED" });
  });
}

it("R02 priority limits T040: public activation and DB runtime preserve an ordinary empty-unknown CT01 join", async () => {
  const f = await fixture(number(-1));
  f.definition.body.splice(1, 0, { kind: "branch", id: "ordinary.branch", condition: condition("unknown"),
    then: [{ kind: "assign", id: "true.assignment", variableId: "answer", value: number(7) }],
    otherwise: [{ kind: "assign", id: "false.assignment", variableId: "answer", value: number(19) }], unknown: [] },
  { kind: "assign", id: "after.branch", variableId: "answer", value: number(42) });
  const saved = await f.save(0);
  expect(saved.validation.issues).toEqual([]);
  for (const kind of ["VALIDATE", "TEST", "IMPACT"] as const) {
    expect((await f.service.check(f.scope, actor, f.definition.id, 1, kind)).valid).toBe(true);
  }
  await f.service.enable(f.scope, actor, f.definition.id, { revision: 1, semanticHash: saved.validation.semanticHash!, requestId: randomUUID() });
  const run = await f.service.start(f.scope, actor, f.definition.id, { requestId: randomUUID() });
  expect(await f.runtime.tick(f.scope, run.id)).toMatchObject({ state: "WAITING" });
  expect((await f.service.store.run(f.scope, run.id))!.resume.variables.answer!.value).toBe(42);
  f.clock.now = new Date(f.clock.now.getTime() + 1100);
  expect(await f.runtime.tick(f.scope, run.id)).toMatchObject({ state: "COMPLETED" });
});
