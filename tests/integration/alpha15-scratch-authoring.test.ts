import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
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
  type AutomationRuntimeAdapter,
} from "../../packages/automation/src/runtime";
import {
  saveCommonUnknownDraft,
  type CommonUnknownDraft,
} from "../../packages/automation/src/scratch-authoring";
import {
  semanticHash,
  validateFlowDefinition,
} from "../../packages/automation/src/definition";
import type {
  FlowDefinition,
  Statement,
  ValueInput,
} from "../../packages/automation/src/types";
import type { AutomationAdmissionLimits } from "../../packages/automation/src/quota";
import { isolatedPostgres } from "../fixtures/postgres";

let db: Database,
  infra: Awaited<ReturnType<typeof isolatedPostgres>>,
  serial = 0;
const actor: Actor = {
  key: "synthetic-authoring-admin",
  encryptedUserId: "synthetic-encrypted-identity",
  permissions: "8",
  roles: [],
  source: "WEB_DASHBOARD",
  requestId: "synthetic-authoring",
};
const admission: AutomationAdmissionLimits = {
  activeFlows: 20,
  monthlyRuns: 100,
  guildConcurrent: 2,
  globalConcurrent: 4,
  guildPending: 20,
  globalPending: 100,
  measurementId: "isolated-authoring-fixtures",
};
const number = (value: number): ValueInput => ({
  kind: "literal",
  type: "Number",
  value,
});
const condition = (value: "true" | "false" | "unknown"): ValueInput => ({
  kind: "literal",
  type: "ConditionResult",
  value,
});
const variable = (variableId: string): ValueInput => ({
  kind: "variable",
  type: "Number",
  variableId,
});
const wait = (id: string, seconds: number): Statement => ({
  id,
  kind: "wait",
  duration: { kind: "literal", type: "Duration", value: seconds },
});
const assign = (id: string, value: number): Statement => ({
  id,
  kind: "assign",
  variableId: "root.value",
  value: number(value),
});
const draft = (value = 2): CommonUnknownDraft => ({
  id: "chain",
  clauses: [
    {
      id: "clause.first",
      condition: condition("false"),
      then: [assign("then.first", 91)],
    },
    {
      id: "clause.second",
      condition: condition("unknown"),
      then: [assign("then.second", 92)],
    },
    {
      id: "clause.third",
      condition: condition("true"),
      then: [assign("then.third", 93)],
    },
  ],
  otherwise: [assign("otherwise", 94)],
  template: [
    {
      id: "template.declare",
      kind: "declare",
      variable: { id: "template.local", name: "Local", type: "Number" },
      value: number(value),
    },
    wait("template.wait", 10),
    {
      id: "template.assign",
      kind: "assign",
      variableId: "root.value",
      value: variable("template.local"),
    },
  ],
});
const createIds = () => {
  let n = 0;
  return () => `copy.${++n}`;
};
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

async function fixture(legacy = false) {
  const scope = scopeForGuild(String(885000000000000000n + BigInt(++serial)));
  await ensureGuild(db, scope);
  const clock = { now: new Date() };
  const base: FlowDefinition = {
    schemaVersion: 1,
    ...(legacy ? {} : { semanticProfile: "scratch.v1" as const }),
    id: `authoring-${serial}`,
    guildId: scope.guildId,
    name: "Synthetic authoring",
    trigger: { kind: "manual", inputs: [] },
    variables: [],
    body: [
      {
        id: "root.declare",
        kind: "declare",
        variable: { id: "root.value", name: "Value", type: "Number" },
        value: number(0),
      },
    ],
  };
  const definition = legacy
    ? base
    : saveCommonUnknownDraft(base, draft(), { createId: createIds() });
  if (!legacy) definition.body.push(wait("tail.wait", 20));
  const service = new AutomationService(db, {
    admission,
    now: () => clock.now,
    authorize: async () => {},
  });
  const adapter: AutomationRuntimeAdapter = {
    authorize: async () => {},
    execute: async () => {
      throw Error("NO_EXTERNAL_OPERATIONS_EXPECTED");
    },
  };
  const runtime = new AutomationRuntime(db, {
    admission,
    adapter,
    now: () => clock.now,
  });
  const save = (
    value: FlowDefinition,
    expectedRevision: number,
    requestId = randomUUID(),
  ) =>
    service.save(scope, actor, {
      definition: value,
      expectedRevision,
      requestId,
    });
  const activate = async (revision = 1) => {
    await sql`UPDATE automation_flows SET state='ACTIVE',active_revision=${revision} WHERE ${tenant(scope)} AND id=${definition.id}`.execute(
      db,
    );
  };
  return {
    scope,
    clock,
    definition,
    service,
    adapter,
    runtime,
    save,
    activate,
  };
}

it("S026 stores canonical template, hygienic maps, compiled copies and semantic hash in one revision", async () => {
  const f = await fixture(),
    requestId = randomUUID();
  const first = await f.save(f.definition, 0, requestId);
  const row = (
    await sql<{
      definition: FlowDefinition;
      semantic_hash: string;
    }>`SELECT definition,semantic_hash FROM automation_revisions WHERE ${tenant(f.scope)} AND flow_id=${f.definition.id} AND revision=1`.execute(
      db,
    )
  ).rows[0]!;
  expect(row.definition).toEqual(first.definition);
  expect(row.definition).toEqual(f.definition);
  expect(row.semantic_hash).toBe(semanticHash(f.definition));
  expect(validateFlowDefinition(row.definition).valid).toBe(true);
  const edited = saveCommonUnknownDraft(first.definition, draft(5));
  await f.save(edited, 1);
  const replay = await f.save(f.definition, 0, requestId);
  expect(replay.draftRevision).toBe(1);
  expect(replay.definition).toEqual(first.definition);
  expect(
    (await f.service.get(f.scope, actor, f.definition.id)).draftRevision,
  ).toBe(2);
});

it("S028 permits exactly one same-revision save and never combines the competing template versions", async () => {
  const f = await fixture();
  await f.save(f.definition, 0);
  const candidates = [
    saveCommonUnknownDraft(f.definition, draft(5)),
    saveCommonUnknownDraft(f.definition, draft(9)),
  ];
  const result = await Promise.allSettled(
    candidates.map((value) => f.save(value, 1)),
  );
  expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(1);
  const rejected = result.find(
    (item) => item.status === "rejected",
  ) as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({
    code: "AUTOMATION_REVISION_CONFLICT",
  });
  const winner = result.find(
    (item) => item.status === "fulfilled",
  ) as PromiseFulfilledResult<Awaited<ReturnType<typeof f.save>>>;
  const current = await f.service.get(f.scope, actor, f.definition.id);
  expect(current.definition).toEqual(winner.value.definition);
  expect(current.validation.valid).toBe(true);
  expect(
    candidates.some(
      (value) => semanticHash(value) === semanticHash(current.definition),
    ),
  ).toBe(true);
  const count = (
    await sql<{
      revisions: number;
      requests: number;
    }>`SELECT (SELECT count(*)::integer FROM automation_revisions WHERE ${tenant(f.scope)} AND flow_id=${f.definition.id}) AS revisions,(SELECT count(*)::integer FROM automation_requests WHERE ${tenant(f.scope)} AND flow_id=${f.definition.id} AND kind='SAVE') AS requests`.execute(
      db,
    )
  ).rows[0]!;
  expect(count).toEqual({ revisions: 2, requests: 2 });
});

it("S028 rolls back both AST and metadata if persistence fails after the revision insert", async () => {
  const f = await fixture(),
    rejectedRequest = randomUUID();
  await f.save(f.definition, 0);
  await sql`CREATE FUNCTION synthetic_authoring_reject_save() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_SAVE_INTERRUPTION'; END $$`.execute(
    db,
  );
  await sql`CREATE TRIGGER synthetic_authoring_reject_save BEFORE INSERT ON automation_requests FOR EACH ROW WHEN (NEW.kind = 'SAVE') EXECUTE FUNCTION synthetic_authoring_reject_save()`.execute(
    db,
  );
  try {
    await expect(
      f.save(
        saveCommonUnknownDraft(f.definition, draft(7)),
        1,
        rejectedRequest,
      ),
    ).rejects.toThrow("SYNTHETIC_SAVE_INTERRUPTION");
  } finally {
    await sql`DROP TRIGGER synthetic_authoring_reject_save ON automation_requests`.execute(
      db,
    );
    await sql`DROP FUNCTION synthetic_authoring_reject_save()`.execute(db);
  }
  const current = await f.service.get(f.scope, actor, f.definition.id);
  expect(current.draftRevision).toBe(1);
  expect(current.definition).toEqual(f.definition);
  const rows = (
    await sql<{
      revision: number;
    }>`SELECT revision FROM automation_revisions WHERE ${tenant(f.scope)} AND flow_id=${f.definition.id}`.execute(
      db,
    )
  ).rows;
  expect(rows).toEqual([{ revision: 1 }]);
  expect(
    (
      await sql`SELECT id FROM automation_requests WHERE ${tenant(f.scope)} AND id=${rejectedRequest}::uuid`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
});

it("S027 rejects a clause-only local capture before persisting a new revision", async () => {
  const f = await fixture();
  await f.save(f.definition, 0);
  const changed = draft();
  changed.clauses[0]!.then = [
    {
      kind: "declare",
      id: "clause.private.declare",
      variable: { id: "clause.private", name: "Private", type: "Number" },
      value: number(7),
    },
  ];
  changed.template = [
    {
      kind: "assign",
      id: "template.capture",
      variableId: "root.value",
      value: variable("clause.private"),
    },
  ];
  const invalid = saveCommonUnknownDraft(f.definition, changed);
  expect(validateFlowDefinition(invalid).valid).toBe(false);
  await expect(f.save(invalid, 1)).rejects.toMatchObject({
    code: "AUTOMATION_DEFINITION_INVALID",
  });
  const current = await f.service.get(f.scope, actor, f.definition.id);
  expect(current.draftRevision).toBe(1);
  expect(current.definition).toEqual(f.definition);
  expect(
    (
      await sql`SELECT revision FROM automation_revisions WHERE ${tenant(f.scope)} AND flow_id=${f.definition.id}`.execute(
        db,
      )
    ).rows,
  ).toEqual([{ revision: 1 }]);
});

it("S025/S029 resumes the selected old unknown PC after template replacement and clause reordering", async () => {
  const f = await fixture();
  await f.save(f.definition, 0);
  await f.activate();
  const old = await f.service.start(f.scope, actor, f.definition.id, {
    requestId: randomUUID(),
  });
  expect(await f.runtime.tick(f.scope, old.id)).toMatchObject({
    state: "WAITING",
  });
  const before = (await f.service.store.run(f.scope, old.id))!;
  expect(before.resume.frames.at(-1)!.path).toContain("otherwise/0/unknown");
  const oldCopies = f.definition.scratchAuthoring!.chains[0]!.copies;
  const chosenLocal = oldCopies[1]!.localIds["template.local"]!;
  expect(before.resume.variables[chosenLocal]!.value).toBe(2);
  const changed = draft(7);
  changed.clauses.reverse();
  const next = saveCommonUnknownDraft(f.definition, changed);
  await f.save(next, 1);
  await f.activate(2);
  expect(next.scratchAuthoring!.chains[0]!.copies[1]).toEqual(oldCopies[1]);
  f.clock.now = new Date(f.clock.now.getTime() + 11000);
  const restarted = new AutomationRuntime(db, {
    admission,
    adapter: f.adapter,
    now: () => f.clock.now,
  });
  expect(await restarted.tick(f.scope, old.id)).toMatchObject({
    state: "WAITING",
  });
  const resumed = (await f.service.store.run(f.scope, old.id))!;
  expect(resumed.revision).toBe(1);
  expect(resumed.semantic_hash).toBe(before.semantic_hash);
  expect(resumed.resume.variables["root.value"]!.value).toBe(2);
  expect(resumed.resume.variables[chosenLocal]).toBeUndefined();
  const fresh = await f.service.start(f.scope, actor, f.definition.id, {
    requestId: randomUUID(),
  });
  expect(fresh.revision).toBe(2);
  expect(await restarted.tick(f.scope, fresh.id)).toMatchObject({
    state: "WAITING",
  });
  expect(
    (await f.service.store.run(f.scope, fresh.id))!.resume.variables[
      "root.value"
    ]!.value,
  ).toBe(93);
  f.clock.now = new Date(f.clock.now.getTime() + 21000);
  expect(await restarted.tick(f.scope, old.id)).toMatchObject({
    state: "COMPLETED",
  });
  expect(await restarted.tick(f.scope, fresh.id)).toMatchObject({
    state: "COMPLETED",
  });
});

it("S022/S024 preserves an existing legacy unknown-plus-following-X run when the new revision adds authoring", async () => {
  const f = await fixture(true);
  f.definition.body.push(
    {
      id: "legacy.A",
      kind: "branch",
      condition: condition("false"),
      then: [],
      unknown: [],
      otherwise: [
        {
          id: "legacy.B",
          kind: "branch",
          condition: condition("unknown"),
          then: [],
          otherwise: [],
          unknown: [wait("legacy.wait", 10), assign("legacy.unknown", 7)],
        },
        assign("legacy.X", 8),
      ],
    },
    wait("tail.wait", 20),
  );
  await f.save(f.definition, 0);
  await f.activate();
  const old = await f.service.start(f.scope, actor, f.definition.id, {
    requestId: randomUUID(),
  });
  expect(await f.runtime.tick(f.scope, old.id)).toMatchObject({
    state: "WAITING",
  });
  const before = (await f.service.store.run(f.scope, old.id))!;
  const next = saveCommonUnknownDraft(
    {
      ...f.definition,
      semanticProfile: "scratch.v1",
      body: [f.definition.body[0]!],
    },
    draft(),
  );
  next.body.push(wait("tail.wait", 20));
  await f.save(next, 1);
  f.clock.now = new Date(f.clock.now.getTime() + 11000);
  const restarted = new AutomationRuntime(db, {
    admission,
    adapter: f.adapter,
    now: () => f.clock.now,
  });
  expect(await restarted.tick(f.scope, old.id)).toMatchObject({
    state: "WAITING",
  });
  const resumed = (await f.service.store.run(f.scope, old.id))!;
  expect(resumed.revision).toBe(1);
  expect(resumed.semantic_hash).toBe(before.semantic_hash);
  expect(resumed.resume.semanticProfile).toBeUndefined();
  expect(resumed.resume.variables["root.value"]!.value).toBe(8);
  const legacy = (
    await sql<{
      definition: FlowDefinition;
    }>`SELECT definition FROM automation_revisions WHERE ${tenant(f.scope)} AND flow_id=${f.definition.id} AND revision=1`.execute(
      db,
    )
  ).rows[0]!.definition;
  expect(legacy).toEqual(f.definition);
  expect(legacy.scratchAuthoring).toBeUndefined();
  f.clock.now = new Date(f.clock.now.getTime() + 21000);
  expect(await restarted.tick(f.scope, old.id)).toMatchObject({
    state: "COMPLETED",
  });
});
