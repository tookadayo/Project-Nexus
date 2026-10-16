import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  connect,
  ensureGuild,
  migrate,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import type { Actor } from "../../packages/settings/src/index";
import { AutomationService } from "../../packages/automation/src/service";
import {
  AutomationRuntime,
  dynamicExecutionIdentity,
  type AutomationRuntimeAdapter,
} from "../../packages/automation/src/runtime";
import {
  AutomationStore,
  fingerprint,
  type OperationOutcome,
} from "../../packages/automation/src/store";
import {
  RandomTapeStore,
  type RandomTapeRecord,
  type StoredRandomTapeInput,
} from "../../packages/automation/src/random-tape-store";
import {
  planRandomTape,
  prepareRandomTape,
  type RandomTapeInput,
} from "../../packages/automation/src/scratch-random";
import * as randomModule from "../../packages/automation/src/scratch-random";
import { sweepAutomationRetention } from "../../packages/automation/src/retention";
import type { AutomationAdmissionLimits } from "../../packages/automation/src/quota";
import {
  DEFAULT_AUTOMATION_LIMITS,
  type FlowDefinition,
  type JsonValue,
  type Statement,
  type ValueInput,
  type ValueType,
} from "../../packages/automation/src/types";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database,
  infra: Awaited<ReturnType<typeof isolatedPostgres>>,
  serial = 0;
const channel = "889222222222222222",
  attempts = 4;
const admission: AutomationAdmissionLimits = {
  activeFlows: 20,
  monthlyRuns: 100,
  guildConcurrent: 2,
  globalConcurrent: 4,
  guildPending: 20,
  globalPending: 100,
  measurementId: "isolated-random-acceptance-fixtures",
};
const actor: Actor = {
  key: createHash("sha256").update("synthetic-random-acceptance-admin").digest("hex"),
  encryptedUserId: "synthetic-encrypted-identity",
  permissions: "8",
  roles: [],
  source: "WEB_DASHBOARD",
  requestId: "synthetic-random-acceptance",
};
const literal = (type: ValueType, value: JsonValue): ValueInput => ({
  kind: "literal",
  type,
  value,
});
const n = (value: number) => literal("Number", value);
const variable = (
  variableId: string,
  type: ValueType = "Number",
): ValueInput => ({ kind: "variable", variableId, type });
const expression = (
  type: ValueType,
  operator: "list.append",
  args: ValueInput[],
): ValueInput => ({ kind: "expression", type, expression: { operator, args } });
const declare = (
  id: string,
  type: ValueType,
  value: ValueInput,
): Statement => ({
  id: `declare.${id}`,
  kind: "declare",
  variable: { id, name: id, type },
  value,
});
const wait = (id: string, duration = 1): Statement => ({
  id,
  kind: "wait",
  duration: literal("Duration", duration),
});
const draw = (
  id = "draw",
  output = "picked",
  lower: ValueInput = n(0),
  upper: ValueInput = n(2),
): Statement => ({
  id,
  kind: "random",
  mode: "integer",
  min: lower,
  max: upper,
  output: { id: output, name: output, type: "Number" },
});
const send = (): Statement => ({
  id: "send",
  kind: "action",
  operation: "discord.sendMessage",
  inputs: {
    channel: literal("ChannelRef", { id: channel, guildId: "placeholder" }),
    content: literal("PlainText", "SYNTHETIC_PRIVATE_MESSAGE_BODY"),
  },
  output: {
    id: "delayed.reference",
    name: "Delayed reference",
    type: "MessageRef",
  },
});
const typedNumbers: ValueType = { kind: "List", element: "Number" };
const retention = 7 * 86400000;

beforeAll(async () => {
  vi.stubEnv("NEXUS_HOSTED_BETA", "off");
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const run of (
    await sql<{
      organization_id: string;
      guild_id: string;
      id: string;
    }>`SELECT organization_id,guild_id,id FROM automation_runs WHERE ended_at IS NULL`.execute(
      db,
    )
  ).rows)
    await new AutomationStore(db).cancel(
      { organizationId: run.organization_id, guildId: run.guild_id },
      run.id,
    );
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
  vi.unstubAllEnvs();
});

function fixedEntropy() {
  const original = randomModule.prepareRandomTape;
  return vi
    .spyOn(randomModule, "prepareRandomTape")
    .mockImplementation((plan, reservation) =>
      original(plan, reservation, (size) => new Uint8Array(size)),
    );
}
async function fixture(body: Statement[], adapter?: AutomationRuntimeAdapter) {
  const scope = scopeForGuild(String(889000000000000000n + BigInt(++serial)));
  await ensureGuild(db, scope);
  const clock = { now: new Date() },
    calls: string[] = [];
  const fix = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(fix)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
              key,
              key === "guildId" && item === "placeholder"
                ? scope.guildId
                : fix(item),
            ]),
          )
        : value;
  const definition: FlowDefinition = {
    schemaVersion: 1,
    semanticProfile: "scratch.v1",
    id: `random-acceptance-${serial}`,
    name: "Synthetic random acceptance",
    guildId: scope.guildId,
    trigger: { kind: "manual", inputs: [] },
    variables: [],
    targets: { channelIds: [channel], roleIds: [], parentCategoryIds: [] },
    body: fix(body) as Statement[],
  };
  const actualAdapter: AutomationRuntimeAdapter = adapter ?? {
    authorize: async () => {},
    execute: async (operation) => {
      calls.push(operation.identity);
      return {
        state: "SUCCEEDED",
        value: {
          type: "MessageRef",
          value: { id: "889333333333333333", guildId: scope.guildId },
          provenance: [
            { source: "service", guildId: scope.guildId, resumable: true },
          ],
        },
      };
    },
  };
  const service = new AutomationService(db, {
    admission,
    scratchRandomAttempts: attempts,
    now: () => clock.now,
    authorize: async () => {},
    adoptedActions: new Set(["discord.sendMessage"]),
  });
  const saved = await service.save(scope, actor, {
    definition,
    expectedRevision: 0,
    requestId: randomUUID(),
  });
  expect(saved.validation).toMatchObject({ valid: true, complete: true });
  // Existing private runtime/storage fixture pattern; this suite tests dynamic
  // identity/retention, not public review. No real connector is constructed.
  await sql`UPDATE automation_flows SET state='ACTIVE',active_revision=1 WHERE ${tenant(scope)} AND id=${definition.id}`.execute(
    db,
  );
  const worker = () =>
    new AutomationRuntime(db, {
      admission,
      scratchRandomAttempts: attempts,
      adapter: actualAdapter,
      now: () => clock.now,
    });
  const run = await service.start(scope, actor, definition.id, {
    requestId: randomUUID(),
  });
  return { scope, clock, calls, definition, service, worker, run };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const current = async (f: Fixture) =>
  (await f.service.store.run(f.scope, f.run.id))!;
const tapes = async (f: Fixture) =>
  (
    await sql<
      RandomTapeRecord & { identity: string }
    >`SELECT identity,fingerprint,input,result FROM automation_random_results WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid ORDER BY identity`.execute(
      db,
    )
  ).rows;
function material(
  f: Fixture,
  identity: string,
  input: RandomTapeInput,
): StoredRandomTapeInput {
  return {
    version: 1,
    material: prepareRandomTape(
      planRandomTape(input, attempts),
      { id: identity, maxMaterialBytes: 65536, maxCandidateTrials: 5000 },
      (size) => new Uint8Array(size),
    ),
    type: "Number",
    provenance: [
      { source: "service", guildId: f.scope.guildId, resumable: true },
    ],
  };
}
async function prepare(f: Fixture) {
  const run = await current(f),
    state = structuredClone(run.resume),
    statement = f.definition.body[state.frames.at(-1)!.index]!;
  const identity = dynamicExecutionIdentity(run, state.frames, statement.id);
  state.steps++;
  state.evaluations += attempts + 2;
  state.chargedStepIdentity = identity;
  const store = new RandomTapeStore(db, () => f.clock.now);
  const record = await store.prepare(
    f.scope,
    run.id,
    identity,
    state,
    fingerprint(run.resume),
    65536,
    () => material(f, identity, { mode: "integer", lower: 0, upper: 2 }),
    f.clock.now,
  );
  return { store, record, identity, state };
}
async function counts(f: Fixture) {
  return (
    await sql<{
      runs: number;
      tapes: number;
      operations: number;
      events: number;
    }>`SELECT
    (SELECT count(*)::integer FROM automation_runs WHERE ${tenant(f.scope)}) AS runs,
    (SELECT count(*)::integer FROM automation_random_results WHERE ${tenant(f.scope)}) AS tapes,
    (SELECT count(*)::integer FROM automation_operations WHERE ${tenant(f.scope)}) AS operations,
    (SELECT count(*)::integer FROM automation_run_events WHERE ${tenant(f.scope)}) AS events`.execute(
      db,
    )
  ).rows[0]!;
}

it("T106: the same random block has distinct per-iteration keys and worker resumes do not redraw either result", async () => {
  const entropy = fixedEntropy();
  const f = await fixture([
    declare("results", typedNumbers, literal(typedNumbers, [])),
    {
      id: "repeat",
      kind: "repeat",
      count: n(2),
      itemVariable: { id: "item", name: "Item", type: "Number" },
      body: [
        draw(),
        {
          id: "append",
          kind: "assign",
          variableId: "results",
          value: expression(typedNumbers, "list.append", [
            variable("results", typedNumbers),
            variable("picked"),
          ]),
        },
        wait("iteration.wait"),
      ],
    },
    wait("tail.wait", 100),
  ]);
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({
    state: "WAITING",
  });
  const firstRun = await current(f),
    first = (await tapes(f))[0]!;
  expect(firstRun.resume.variables.results?.value).toEqual([0]);
  expect(firstRun.resume.frames.at(-1)?.loop?.iteration).toBe(0);
  expect(first.result).toMatchObject({ state: "SUCCEEDED", value: 0 });
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({
    state: "WAITING",
  });
  expect(await tapes(f)).toEqual([first]);
  expect(entropy).toHaveBeenCalledTimes(1);
  f.clock.now = new Date(f.clock.now.getTime() + 1001);
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({
    state: "WAITING",
  });
  const secondRun = await current(f),
    both = await tapes(f);
  expect(secondRun.resume.frames.at(-1)?.loop?.iteration).toBe(1);
  expect(secondRun.resume.variables.results?.value).toEqual([0, 0]);
  expect(both).toHaveLength(2);
  expect(new Set(both.map((row) => row.identity)).size).toBe(2);
  expect(both.find((row) => row.identity === first.identity)).toEqual(first);
  expect(
    both.every(
      (row) =>
        row.input.material.reservationId === row.identity &&
        row.result.state === "SUCCEEDED" &&
        row.result.value === 0,
    ),
  ).toBe(true);
  expect(entropy).toHaveBeenCalledTimes(2);
  const secondBudget = secondRun.resume.evaluations;
  await f.worker().tick(f.scope, f.run.id);
  expect((await current(f)).resume.evaluations).toBe(secondBudget);
  expect(await tapes(f)).toEqual(both);
  f.clock.now = new Date(f.clock.now.getTime() + 1001);
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({
    state: "WAITING",
  });
  expect((await current(f)).resume.variables.results?.value).toEqual([0, 0]);
  expect(await tapes(f)).toEqual(both);
  expect(entropy).toHaveBeenCalledTimes(2);
});

it("T107: an explicit conflicting fixed-input fingerprint for the same dynamic key rejects and stops its runtime caller", async () => {
  const f = await fixture([draw(), send()]),
    prepared = await prepare(f);
  const conflicting = {
    ...material(f, prepared.identity, {
      mode: "integer",
      lower: 99,
      upper: 100,
    }),
    preparedCheckpointFingerprint:
      prepared.record.input.preparedCheckpointFingerprint,
  };
  const requestedHash = fingerprint(conflicting);
  expect(requestedHash).not.toBe(prepared.record.fingerprint);
  const reserve = RandomTapeStore.prototype.reserveEvaluation;
  // Explicit internal request fault, not a new author-facing input API and not
  // a changed current variable masquerading as a fixed-input overwrite.
  const request = vi
    .spyOn(RandomTapeStore.prototype, "reserveEvaluation")
    .mockImplementationOnce(function (
      this: RandomTapeStore,
      scope,
      runId,
      identity,
      _hash,
      ...rest
    ) {
      expect(identity).toBe(prepared.identity);
      return reserve.call(this, scope, runId, identity, requestedHash, ...rest);
    });
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({
    state: "FAILED",
  });
  expect(request).toHaveBeenCalledOnce();
  expect((await current(f)).reason).toBe("AUTOMATION_RANDOM_INPUT_MISMATCH");
  expect(f.calls).toEqual([]);
  expect(await tapes(f)).toEqual([
    { identity: prepared.identity, ...prepared.record },
  ]);
  const stopped = await current(f);
  await f.worker().tick(f.scope, f.run.id);
  expect((await current(f)).ended_at).toEqual(stopped.ended_at);
  expect(f.calls).toEqual([]);
});

it("T107/S042: changed actual bound variables do not re-evaluate a completed key or roll back the current checkpoint", async () => {
  fixedEntropy();
  const f = await fixture([
    declare("lower", "Number", n(0)),
    declare("upper", "Number", n(2)),
    draw("draw", "picked", variable("lower"), variable("upper")),
    wait("tail.wait", 100),
  ]);
  await f.worker().tick(f.scope, f.run.id, 3);
  const original = (await tapes(f))[0]!,
    run = await current(f),
    changed = structuredClone(run.resume);
  expect(run.resume.variables.picked?.value).toBe(0);
  changed.variables.lower!.value = 99;
  changed.variables.upper!.value = 100;
  await f.service.store.save(f.scope, f.run.id, changed, "RUNNING");
  const before = await current(f),
    make = vi.fn(() => {
      throw Error("CURRENT_BOUNDS_MUST_NOT_BE_REEVALUATED");
    });
  const returned = await new RandomTapeStore(db, () => f.clock.now).prepare(
    f.scope,
    f.run.id,
    original.identity,
    structuredClone(before.resume),
    fingerprint(before.resume),
    65536,
    make,
    f.clock.now,
  );
  expect(make).not.toHaveBeenCalled();
  expect(returned).toEqual({
    fingerprint: original.fingerprint,
    input: original.input,
    result: original.result,
  });
  expect((await current(f)).resume).toEqual(before.resume);
  expect(original.input.material.input).toEqual({
    mode: "integer",
    lower: 0,
    upper: 2,
  });
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({
    state: "WAITING",
  });
  expect((await current(f)).resume.variables.lower?.value).toBe(99);
  expect((await current(f)).resume.variables.upper?.value).toBe(100);
  expect((await current(f)).resume.variables.picked?.value).toBe(0);
  expect(await tapes(f)).toEqual([original]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function inFlightFixture() {
  const entered = deferred<void>(),
    answer = deferred<OperationOutcome>();
  const execute = vi.fn<AutomationRuntimeAdapter["execute"]>(async () => {
    entered.resolve();
    return answer.promise;
  });
  fixedEntropy();
  const f = await fixture(
    [
      declare(
        "private.variable",
        "PlainText",
        literal("PlainText", "SYNTHETIC_PRIVATE_VARIABLE_VALUE"),
      ),
      draw(),
      send(),
      wait("never.wait", 1),
    ],
    { authorize: async () => {}, execute },
  );
  const worker = f.worker(),
    pending = worker.tick(f.scope, f.run.id);
  await entered.promise;
  await f.service.store.event(
    f.scope,
    f.run.id,
    "draw",
    "OBSERVED",
    "SYNTHETIC_METADATA_ONLY",
  );
  const stale = structuredClone((await current(f)).resume);
  f.clock.now = new Date((await current(f)).deadline_at.getTime() + 1);
  await sweepAutomationRetention(db, f.clock.now);
  const terminal = await current(f);
  expect(terminal).toMatchObject({
    status: "UNKNOWN",
    reason: "RUN_DEADLINE",
    wake_at: null,
  });
  expect(terminal.ended_at).toEqual(f.clock.now);
  const result: OperationOutcome = {
    state: "SUCCEEDED",
    value: {
      type: "MessageRef",
      value: { id: "889444444444444444", guildId: f.scope.guildId },
      provenance: [
        { source: "service", guildId: f.scope.guildId, resumable: true },
      ],
    },
  };
  return { ...f, entered, answer, execute, pending, terminal, stale, result };
}

it("T124/S059: an existing adapter callback after terminalAt records evidence without reviving the Run or extending deletion", async () => {
  const f = await inFlightFixture();
  try {
    const before = {
      resume: f.terminal.resume,
      status: f.terminal.status,
      ended_at: f.terminal.ended_at,
      reason: f.terminal.reason,
    };
    f.clock.now = new Date(f.clock.now.getTime() + 12345);
    f.answer.resolve(f.result);
    expect(await f.pending).toMatchObject({ state: "UNKNOWN" });
    const after = await current(f);
    expect({
      resume: after.resume,
      status: after.status,
      ended_at: after.ended_at,
      reason: after.reason,
    }).toEqual(before);
    expect(after.resume.variables["delayed.reference"]).toBeUndefined();
    expect(after.resume.waitUntil).toBeUndefined();
    expect(f.execute).toHaveBeenCalledOnce();
    const operations = (
      await sql<{
        state: string;
      }>`SELECT state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(
        db,
      )
    ).rows;
    expect(operations).toEqual([{ state: "SUCCEEDED" }]);
    const logs = JSON.stringify(
      (
        await sql`SELECT * FROM automation_run_events WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(
          db,
        )
      ).rows,
    );
    expect(logs).toContain("SYNTHETIC_METADATA_ONLY");
    for (const content of [
      "SYNTHETIC_PRIVATE_MESSAGE_BODY",
      "SYNTHETIC_PRIVATE_VARIABLE_VALUE",
      "889444444444444444",
      "entropyHex",
    ])
      expect(logs).not.toContain(content);
    await f.service.store.save(
      f.scope,
      f.run.id,
      f.stale,
      "RUNNING",
      null,
      null,
    );
    expect((await current(f)).ended_at).toEqual(before.ended_at);
    const due = before.ended_at!.getTime() + retention;
    await sweepAutomationRetention(db, new Date(due - 1));
    expect(await f.service.store.run(f.scope, f.run.id)).not.toBeNull();
    await sweepAutomationRetention(db, new Date(due));
    expect(await f.service.store.run(f.scope, f.run.id)).toBeNull();
    expect(await counts(f)).toEqual({
      runs: 0,
      tapes: 0,
      operations: 0,
      events: 0,
    });
  } finally {
    f.answer.resolve(f.result);
    await f.pending.catch(() => {});
  }
});

it("T112/T124/S059: exact seven-day physical deletion fences late callback, stale worker/checkpoint and random writes without a new Run", async () => {
  const f = await inFlightFixture();
  try {
    const ended = f.terminal.ended_at!.getTime(),
      originalCounts = await counts(f);
    const frozenDraw = (await tapes(f))[0]!;
    expect(originalCounts).toEqual({
      runs: 1,
      tapes: 1,
      operations: 1,
      events: 1,
    });
    await sweepAutomationRetention(db, new Date(ended + retention - 1));
    expect(await counts(f)).toEqual(originalCounts);
    f.clock.now = new Date(ended + retention);
    await sweepAutomationRetention(db, f.clock.now);
    expect(await counts(f)).toEqual({
      runs: 0,
      tapes: 0,
      operations: 0,
      events: 0,
    });
    // The original pending worker still owns the run advisory lock. A second
    // worker is refused admission before it can inspect the deleted row.
    expect(await f.worker().tick(f.scope, f.run.id)).toBeNull();
    await expect(
      f.service.store.save(f.scope, f.run.id, f.stale, "RUNNING"),
    ).rejects.toThrow("AUTOMATION_RUN_NOT_FOUND");
    const make = vi.fn(() =>
      material(f, frozenDraw.identity, { mode: "integer", lower: 0, upper: 2 }),
    );
    await expect(
      new RandomTapeStore(db, () => f.clock.now).prepare(
        f.scope,
        f.run.id,
        frozenDraw.identity,
        f.stale,
        fingerprint(f.stale),
        65536,
        make,
        f.clock.now,
      ),
    ).rejects.toThrow("AUTOMATION_STOPPED");
    expect(make).not.toHaveBeenCalled();
    f.answer.resolve(f.result);
    expect(await f.pending).toMatchObject({ state: "DELETED" });
    await expect(f.worker().tick(f.scope, f.run.id)).rejects.toThrow(
      "AUTOMATION_RUN_NOT_FOUND",
    );
    expect(f.execute).toHaveBeenCalledOnce();
    await sweepAutomationRetention(db, new Date(f.clock.now.getTime() + 1000));
    expect(await counts(f)).toEqual({
      runs: 0,
      tapes: 0,
      operations: 0,
      events: 0,
    });
    expect(
      (
        await sql`SELECT id FROM automation_flows WHERE ${tenant(f.scope)}`.execute(
          db,
        )
      ).rows,
    ).toHaveLength(1);
    // The still-enabled definition is not an instruction to recreate an old Run.
  } finally {
    f.answer.resolve(f.result);
    await f.pending.catch(() => {});
  }
});

it("T116 PARTIAL: splitting two for-each random consumers does not issue a fresh shared evaluation budget", async () => {
  const entropy = fixedEntropy();
  const repeat = (id: string, picked: string): Statement => ({
    id,
    kind: "repeat",
    list: literal(typedNumbers, [1]),
    itemVariable: { id: `${id}.item`, name: "Item", type: "Number" },
    body: [draw(`${id}.draw`, picked)],
  });
  const f = await fixture([
    repeat("first", "first.picked"),
    repeat("second", "second.picked"),
    send(),
  ]);
  // As in the existing random-store budget fixtures, model work already charged
  // to the common Run counter. There is no per-definition limits wire field.
  const initial = structuredClone((await current(f)).resume);
  initial.evaluations = DEFAULT_AUTOMATION_LIMITS.maxEvaluations - 12;
  await f.service.store.save(f.scope, f.run.id, initial, "QUEUED");
  expect(await f.worker().tick(f.scope, f.run.id)).toMatchObject({
    state: "FAILED",
  });
  const run = await current(f);
  expect(run.reason).toBe("AUTOMATION_EVALUATION_LIMIT");
  expect(run.resume.evaluations).toBe(
    DEFAULT_AUTOMATION_LIMITS.maxEvaluations - 2,
  );
  expect(await tapes(f)).toHaveLength(1);
  expect(entropy).toHaveBeenCalledTimes(1);
  expect(f.calls).toEqual([]);
  const before = run.resume.evaluations;
  await f.worker().tick(f.scope, f.run.id);
  expect((await current(f)).resume.evaluations).toBe(before);
  expect(await tapes(f)).toHaveLength(1);
});
