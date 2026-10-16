import { createHash, randomUUID } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
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
import { AutomationRuntime } from "../../packages/automation/src/runtime";
import type { ResumeState } from "../../packages/automation/src/store";
import { semanticHash } from "../../packages/automation/src/definition";
import type {
  FlowDefinition,
  Statement,
  ValueInput,
  ValueType,
  JsonValue,
  Expression,
} from "../../packages/automation/src/types";
import type { AutomationAdmissionLimits } from "../../packages/automation/src/quota";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database,
  infra: Awaited<ReturnType<typeof isolatedPostgres>>,
  serial = 0;
const actor: Actor = {
  key: createHash("sha256").update("synthetic-compatibility-admin").digest("hex"),
  encryptedUserId: "synthetic-encrypted-identity",
  permissions: "8",
  roles: [],
  source: "WEB_DASHBOARD",
  requestId: "synthetic-compatibility",
};
const admission: AutomationAdmissionLimits = {
  activeFlows: 30,
  monthlyRuns: 100,
  guildConcurrent: 2,
  globalConcurrent: 8,
  guildPending: 20,
  globalPending: 200,
  measurementId: "isolated-compatibility-fixtures",
};
const literal = (type: ValueType, value: JsonValue): ValueInput => ({
  kind: "literal",
  type,
  value,
});
const variable = (
  variableId: string,
  type: ValueType = "Number",
): ValueInput => ({ kind: "variable", type, variableId });
const expression = (
  type: ValueType,
  operator: Expression["operator"],
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
const wait = (id: string, seconds: number): Statement => ({
  id,
  kind: "wait",
  duration: literal("Duration", seconds),
});
const listType: ValueType = { kind: "List", element: "Number" };
const mutations = (): Statement[] => [
  declare("count", "Number", literal("Number", 0)),
  declare("items", listType, literal(listType, [])),
  {
    id: "repeat",
    kind: "repeat",
    count: literal("Number", 2),
    itemVariable: { id: "item", name: "Item", type: "Number" },
    body: [
      {
        id: "increment",
        kind: "assign",
        variableId: "count",
        value: expression("Number", "number.add", [
          variable("count"),
          literal("Number", 1),
        ]),
      },
      {
        id: "append",
        kind: "assign",
        variableId: "items",
        value: expression(listType, "list.append", [
          variable("items", listType),
          variable("item"),
        ]),
      },
      { id: "continue", kind: "continue" },
    ],
  },
  wait("tail.wait", 100),
];
beforeAll(async () => {
  vi.stubEnv("NEXUS_HOSTED_BETA", "off");
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
  vi.unstubAllEnvs();
});
async function fixture(body: Statement[], legacy = false) {
  const scope = scopeForGuild(String(886000000000000000n + BigInt(++serial)));
  await ensureGuild(db, scope);
  const clock = { now: new Date() };
  const definition: FlowDefinition = {
    schemaVersion: 1,
    ...(legacy ? {} : { semanticProfile: "scratch.v1" as const }),
    id: `compatibility-${serial}`,
    guildId: scope.guildId,
    name: "Synthetic compatibility",
    trigger: { kind: "manual", inputs: [] },
    variables: [],
    body,
  };
  const adapter = {
    authorize: async () => {},
    execute: async () => {
      throw Error("NO_EXTERNAL_OPERATIONS_EXPECTED");
    },
  };
  const service = new AutomationService(db, {
    admission,
    now: () => clock.now,
    authorize: async () => {},
  });
  const runtime = new AutomationRuntime(db, {
    admission,
    adapter,
    now: () => clock.now,
  });
  await service.save(scope, actor, {
    definition,
    expectedRevision: 0,
    requestId: randomUUID(),
  });
  await sql`UPDATE automation_flows SET state='ACTIVE',active_revision=1 WHERE ${tenant(scope)} AND id=${definition.id}`.execute(
    db,
  );
  const run = await service.start(scope, actor, definition.id, {
    requestId: randomUUID(),
  });
  return { scope, clock, definition, adapter, service, runtime, run };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const matches = (
  state: ResumeState,
  operation: "number" | "list" | "continue",
) =>
  state.frames.find(
    (frame) => frame.path === "body/2/body" && frame.loop?.iteration === 0,
  )?.index === ({ number: 1, list: 2, continue: 3 } as const)[operation];

/** A pre-save candidate carries the expected CAS version. Each committed
 * scratch.v1 checkpoint advances that storage version while preserving the
 * candidate's PC, values and logical budget as one state. */
function afterSuccessfulCommits(
  candidate: ResumeState,
  count: number,
): ResumeState {
  expect(candidate.semanticProfile).toBe("scratch.v1");
  const version = candidate.checkpointVersion ?? 0;
  expect(Number.isSafeInteger(version) && version >= 0).toBe(true);
  return { ...structuredClone(candidate), checkpointVersion: version + count };
}

async function childAt(
  f: Fixture,
  operation: "number" | "list" | "continue",
  stage: "before" | "after",
) {
  const child = fork(
    resolve("tests/fixtures/scratch-checkpoint-worker.ts"),
    [],
    {
      execArgv: ["--import", "tsx"],
      env: {
        ...process.env,
        NEXUS_HOSTED_BETA: "off",
        NEXUS_CHECKPOINT_DATABASE_URL: infra.databaseUrl,
        NEXUS_CHECKPOINT_INPUT: JSON.stringify({
          scope: f.scope,
          runId: f.run.id,
          now: f.clock.now.toISOString(),
          operation,
          stage,
          admission,
        }),
      },
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let errorText = "";
  child.stderr?.on("data", (value) => {
    errorText += String(value);
  });
  try {
    const snapshot = await new Promise<{
      stage: string;
      before: ResumeState;
      candidate: ResumeState;
    }>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("CHECKPOINT_CHILD_TIMEOUT " + errorText)),
        15000,
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(Error("CHECKPOINT_CHILD_EARLY_EXIT " + errorText));
      });
      child.once("message", (message) => {
        clearTimeout(timer);
        const value = message as {
          stage?: string;
          before: ResumeState;
          candidate: ResumeState;
        };
        if (value.stage !== stage)
          reject(
            Error("CHECKPOINT_CHILD_UNEXPECTED " + JSON.stringify(message)),
          );
        else resolve({ ...value, stage });
      });
    });
    return { child, snapshot };
  } catch (error) {
    await terminate(child);
    throw error;
  }
}
async function terminate(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<NodeJS.Signals | null>((resolve) =>
    child.once("exit", (_code, signal) => resolve(signal)),
  );
  child.kill("SIGKILL");
  expect(await closed).toBe("SIGKILL");
}
async function tickAfterCrash(f: Fixture, runtime: AutomationRuntime) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await runtime.tick(f.scope, f.run.id);
    if (result) return result;
    await delay(10);
  }
  throw Error("CRASHED_WORKER_LOCK_NOT_RELEASED");
}
async function finish(f: Fixture) {
  f.clock.now = new Date(f.clock.now.getTime() + 101000);
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({
    state: "COMPLETED",
  });
}

it("T129/S049 keeps missing-profile legacy rounding, scalar text and text order after a new scratch revision is saved", async () => {
  const source = literal("PlainText", "A😀e\u0301");
  const f = await fixture(
    [
      wait("initial.wait", 10),
      declare(
        "round.negative",
        "Number",
        expression("Number", "number.round", [literal("Number", -1.5)]),
      ),
      declare(
        "round.small",
        "Number",
        expression("Number", "number.round", [literal("Number", -0.5)]),
      ),
      declare(
        "round.positive",
        "Number",
        expression("Number", "number.round", [literal("Number", 1.5)]),
      ),
      declare(
        "length",
        "Number",
        expression("Number", "text.length", [source]),
      ),
      declare(
        "slice",
        "PlainText",
        expression("PlainText", "text.slice", [
          source,
          literal("Number", 3),
          literal("Number", 1),
        ]),
      ),
      declare(
        "ordered",
        "Boolean",
        expression("Boolean", "compare.less", [
          literal("PlainText", "\u{10000}"),
          literal("PlainText", "\ue000"),
        ]),
      ),
      wait("tail.wait", 100),
    ],
    true,
  );
  expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({
    state: "WAITING",
  });
  const before = (await f.service.store.run(f.scope, f.run.id))!;
  const next: FlowDefinition = {
    ...f.definition,
    semanticProfile: "scratch.v1",
    body: [
      declare(
        "new.length",
        "Number",
        expression("Number", "text.length", [source]),
      ),
      wait("new.wait", 100),
    ],
  };
  await f.service.save(f.scope, actor, {
    definition: next,
    expectedRevision: 1,
    requestId: randomUUID(),
  });
  f.clock.now = new Date(f.clock.now.getTime() + 11000);
  const restarted = new AutomationRuntime(db, {
    admission,
    adapter: f.adapter,
    now: () => f.clock.now,
  });
  expect(await restarted.tick(f.scope, f.run.id)).toMatchObject({
    state: "WAITING",
  });
  const resumed = (await f.service.store.run(f.scope, f.run.id))!;
  expect(resumed.revision).toBe(1);
  expect(resumed.semantic_hash).toBe(before.semantic_hash);
  expect(resumed.semantic_hash).toBe(semanticHash(f.definition));
  expect(resumed.resume.semanticProfile).toBeUndefined();
  expect(
    Object.fromEntries(
      Object.entries(resumed.resume.variables).map(([key, value]) => [
        key,
        value.value,
      ]),
    ),
  ).toEqual({
    "round.negative": -2,
    "round.small": -1,
    "round.positive": 2,
    length: 4,
    slice: "e",
    ordered: true,
  });
  const stored = (
    await sql<{
      definition: FlowDefinition;
    }>`SELECT definition FROM automation_revisions WHERE ${tenant(f.scope)} AND flow_id=${f.definition.id} AND revision=1`.execute(
      db,
    )
  ).rows[0]!.definition;
  expect(stored).toEqual(f.definition);
  expect(stored.semanticProfile).toBeUndefined();
  await finish(f);
});

it.each(["number", "list", "continue"] as const)(
  "T068/T119 SIGKILL before the %s checkpoint preserves the complete prior state and replays once",
  async (operation) => {
    const f = await fixture(mutations()),
      control = await fixture(mutations());
    const { child, snapshot } = await childAt(f, operation, "before");
    try {
      expect((await f.service.store.run(f.scope, f.run.id))!.resume).toEqual(
        snapshot.before,
      );
      expect(snapshot.before).not.toEqual(snapshot.candidate);
    } finally {
      await terminate(child);
    }
    const restarted = new AutomationRuntime(db, {
      admission,
      adapter: f.adapter,
      now: () => f.clock.now,
    });
    expect(await tickAfterCrash(f, restarted)).toMatchObject({
      state: "WAITING",
    });
    expect(
      await control.runtime.tick(control.scope, control.run.id),
    ).toMatchObject({ state: "WAITING" });
    const actual = (await f.service.store.run(f.scope, f.run.id))!.resume,
      expected = (await control.service.store.run(
        control.scope,
        control.run.id,
      ))!.resume;
    expect(actual.variables.count!.value).toBe(2);
    expect(actual.variables.items!.value).toEqual([1, 2]);
    expect({
      steps: actual.steps,
      evaluations: actual.evaluations,
      externalActions: actual.externalActions,
    }).toEqual({
      steps: expected.steps,
      evaluations: expected.evaluations,
      externalActions: expected.externalActions,
    });
    await finish(f);
    await finish(control);
  },
);

it.each(["number", "list", "continue"] as const)(
  "T068/T119 SIGKILL after the %s commit keeps the complete new checkpoint without duplicate mutation",
  async (operation) => {
    const f = await fixture(mutations()),
      control = await fixture(mutations());
    const { child, snapshot } = await childAt(f, operation, "after");
    try {
      expect(snapshot.candidate.checkpointVersion ?? 0).toBe(
        snapshot.before.checkpointVersion ?? 0,
      );
      expect((await f.service.store.run(f.scope, f.run.id))!.resume).toEqual(
        afterSuccessfulCommits(snapshot.candidate, 1),
      );
    } finally {
      await terminate(child);
    }
    const restarted = new AutomationRuntime(db, {
      admission,
      adapter: f.adapter,
      now: () => f.clock.now,
    });
    expect(await tickAfterCrash(f, restarted)).toMatchObject({
      state: "WAITING",
    });
    expect(
      await control.runtime.tick(control.scope, control.run.id),
    ).toMatchObject({ state: "WAITING" });
    const actual = (await f.service.store.run(f.scope, f.run.id))!.resume,
      expected = (await control.service.store.run(
        control.scope,
        control.run.id,
      ))!.resume;
    expect(actual.variables.count!.value).toBe(2);
    expect(actual.variables.items!.value).toEqual([1, 2]);
    expect({
      steps: actual.steps,
      evaluations: actual.evaluations,
      externalActions: actual.externalActions,
    }).toEqual({
      steps: expected.steps,
      evaluations: expected.evaluations,
      externalActions: expected.externalActions,
    });
    await finish(f);
    await finish(control);
  },
);

it.each(["number", "list", "continue"] as const)(
  "T068/T119 caught save-acknowledgement loss after %s commit records FAILED and does not automatically retry",
  async (operation) => {
    const f = await fixture(mutations()),
      save = f.runtime.store.save.bind(f.runtime.store);
    let injected = false;
    let committed: ResumeState | undefined;
    f.runtime.store.save = async (...args) => {
      if (!injected && matches(args[2], operation)) {
        injected = true;
        committed = structuredClone(args[2]);
        await save(...args);
        // Model an acknowledgement error after a successful commit. This is a
        // caught exception and intentionally does not stand in for process death.
        throw Error("SYNTHETIC_SAVE_ACKNOWLEDGEMENT_LOST");
      }
      await save(...args);
    };
    expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({
      state: "FAILED",
    });
    expect(injected).toBe(true);
    const failed = (await f.service.store.run(f.scope, f.run.id))!;
    expect(failed.reason).toBe("AUTOMATION_EXECUTION_FAILED");
    // One commit applies the candidate; the subsequent caught-error commit
    // records FAILED. Both must advance CAS without replaying the mutation.
    const expected = afterSuccessfulCommits(committed!, 2);
    expected.frames.find(
      (frame) => frame.path === "body/2/body",
    )!.loop!.outcome = "FAILED";
    // The failure marker is added; committed values, PC and all budget counters
    // remain intact. A caught save error terminates rather than resuming the Run.
    expect(failed.resume).toEqual(expected);
    expect(await f.runtime.tick(f.scope, f.run.id)).toMatchObject({
      state: "FAILED",
    });
    expect((await f.service.store.run(f.scope, f.run.id))!.resume).toEqual(
      failed.resume,
    );
  },
);

it("T068 retains exactly 5 + 3 = 8 after the committed worker is killed, rather than adding again to 11", async () => {
  const body = mutations();
  const initial = body[0]!,
    repeat = body[2]!;
  if (initial.kind !== "declare" || repeat.kind !== "repeat")
    throw Error("SHAPE");
  initial.value = literal("Number", 5);
  repeat.count = literal("Number", 1);
  const increment = repeat.body[0]!;
  if (increment.kind !== "assign") throw Error("SHAPE");
  increment.value = expression("Number", "number.add", [
    variable("count"),
    literal("Number", 3),
  ]);
  const f = await fixture(body);
  const { child, snapshot } = await childAt(f, "number", "after");
  try {
    expect(snapshot.candidate.variables.count!.value).toBe(8);
    expect(snapshot.candidate.checkpointVersion ?? 0).toBe(
      snapshot.before.checkpointVersion ?? 0,
    );
    expect((await f.service.store.run(f.scope, f.run.id))!.resume).toEqual(
      afterSuccessfulCommits(snapshot.candidate, 1),
    );
  } finally {
    await terminate(child);
  }
  const restarted = new AutomationRuntime(db, {
    admission,
    adapter: f.adapter,
    now: () => f.clock.now,
  });
  expect(await tickAfterCrash(f, restarted)).toMatchObject({
    state: "WAITING",
  });
  expect(
    (await f.service.store.run(f.scope, f.run.id))!.resume.variables.count!
      .value,
  ).toBe(8);
  await finish(f);
});
