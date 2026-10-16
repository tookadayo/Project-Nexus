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
import { validateFlowDefinition } from "../../packages/automation/src/definition";
import {
  INTERNAL_EVENT_FIELDS,
  INTERACTION_EVENT_FIELDS,
  validateEventTriggerInputs,
} from "../../packages/automation/src/event-contract";
import type { AutomationSimulationInput } from "../../packages/automation/src/simulation";
import type { AutomationAdmissionLimits } from "../../packages/automation/src/quota";
import {
  MAX_WAIT_SECONDS,
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
const actor: Actor = {
  key: "synthetic-final-safety-admin",
  encryptedUserId: "synthetic-encrypted-identity",
  permissions: "8",
  roles: [],
  source: "WEB_DASHBOARD",
  requestId: "synthetic-final-safety",
};
// Synthetic fixture capacity, not measured production capacity or plan pricing.
const admission: AutomationAdmissionLimits = {
  activeFlows: 20,
  monthlyRuns: 100,
  guildConcurrent: 2,
  globalConcurrent: 4,
  guildPending: 20,
  globalPending: 100,
  measurementId: "isolated-final-safety-fixtures",
};
const literal = (type: ValueType, value: JsonValue): ValueInput => ({
  kind: "literal",
  type,
  value,
});
const variable = (variableId: string, type: ValueType): ValueInput => ({
  kind: "variable",
  type,
  variableId,
});
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

async function fixture(body: Statement[], adapter?: AutomationRuntimeAdapter) {
  const scope = scopeForGuild(String(887000000000000000n + BigInt(++serial)));
  await ensureGuild(db, scope);
  const clock = { now: new Date() };
  const definition: FlowDefinition = {
    schemaVersion: 1,
    semanticProfile: "scratch.v1",
    id: `final-safety-${serial}`,
    guildId: scope.guildId,
    name: "Synthetic final safety",
    trigger: { kind: "manual", inputs: [] },
    variables: [],
    body,
  };
  const service = new AutomationService(db, {
    admission,
    now: () => clock.now,
    authorize: async () => {},
    adoptedActions: new Set(["discord.sendMessage"]),
  });
  const runtime = new AutomationRuntime(db, {
    admission,
    now: () => clock.now,
    adapter: adapter ?? {
      authorize: async () => {},
      execute: async () => {
        throw Error("NO_EXTERNAL_OPERATIONS_EXPECTED");
      },
    },
  });
  return { scope, clock, definition, service, runtime };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Exercise the same review and activation methods as the management API.
 * No UPDATE-to-ACTIVE fixture shortcut is used in this acceptance suite. */
async function enable(f: Fixture, mock: AutomationSimulationInput = {}) {
  const saved = await f.service.save(f.scope, actor, {
    definition: f.definition,
    expectedRevision: 0,
    requestId: randomUUID(),
  });
  expect(saved.validation).toMatchObject({ valid: true, complete: true });
  for (const kind of ["VALIDATE", "TEST", "IMPACT"] as const) {
    const checked = await f.service.check(
      f.scope,
      actor,
      f.definition.id,
      1,
      kind,
      mock,
    );
    expect(checked).toMatchObject({ valid: true, complete: true });
    if (kind === "TEST") expect(checked).toMatchObject({ status: "COMPLETED" });
  }
  const enabled = await f.service.enable(f.scope, actor, f.definition.id, {
    revision: 1,
    semanticHash: saved.validation.semanticHash!,
    requestId: randomUUID(),
  });
  expect(enabled).toMatchObject({ state: "ACTIVE", activeRevision: 1 });
  return saved;
}

async function assertNoSavedAutomation(f: Fixture) {
  const row = (
    await sql<{
      flows: number;
      revisions: number;
      checks: number;
      runs: number;
    }>`SELECT
    (SELECT count(*)::integer FROM automation_flows WHERE ${tenant(f.scope)}) AS flows,
    (SELECT count(*)::integer FROM automation_revisions WHERE ${tenant(f.scope)}) AS revisions,
    (SELECT count(*)::integer FROM automation_checks WHERE ${tenant(f.scope)}) AS checks,
    (SELECT count(*)::integer FROM automation_runs WHERE ${tenant(f.scope)}) AS runs`.execute(
      db,
    )
  ).rows[0];
  expect(row).toEqual({ flows: 0, revisions: 0, checks: 0, runs: 0 });
}
async function rejectedAtSave(f: Fixture, definition: unknown, issue: string) {
  const checked = validateFlowDefinition(definition);
  expect(checked.valid).toBe(false);
  expect(checked.issues.map(({ code }) => code)).toContain(issue);
  await expect(
    f.service.save(f.scope, actor, {
      definition,
      expectedRevision: 0,
      requestId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "AUTOMATION_DEFINITION_INVALID" });
  await assertNoSavedAutomation(f);
}

it("T099: wait=0 reaches the following statement without WAITING through normal save/review/enable/start", async () => {
  const f = await fixture([
    wait("zero.wait", 0),
    declare("afterZero", "Number", literal("Number", 42)),
    wait("tail.wait", 1),
  ]);
  await enable(f);
  const run = await f.service.start(f.scope, actor, f.definition.id, {
    requestId: randomUUID(),
  });
  expect(await f.runtime.tick(f.scope, run.id, 2)).toMatchObject({
    state: "RUNNING",
  });
  const afterZero = await f.runtime.store.run(f.scope, run.id);
  expect(afterZero?.resume.variables.afterZero?.value).toBe(42);
  expect(afterZero?.resume.frames[0]?.index).toBe(2);
  expect(afterZero?.resume.waitUntil).toBeUndefined();
  expect(afterZero?.wake_at).toBeNull();
  expect(await f.runtime.tick(f.scope, run.id)).toMatchObject({
    state: "WAITING",
  });
  f.clock.now = new Date(f.clock.now.getTime() + 2000);
  expect(await f.runtime.tick(f.scope, run.id)).toMatchObject({
    state: "COMPLETED",
  });
});

it.each([
  { label: "negative", seconds: -1 },
  { label: "more than seven days", seconds: MAX_WAIT_SECONDS + 1 },
])(
  "T099: $label literal duration is rejected before activation with no saved state",
  async ({ seconds }) => {
    const f = await fixture([wait("invalid.wait", seconds)]);
    await rejectedAtSave(f, f.definition, "WAIT_LIMIT");
  },
);

it("T099 additional boundary: exactly seven days is a valid duration but whole-Run deadline blocks activation", async () => {
  const f = await fixture([wait("maximum.wait", MAX_WAIT_SECONDS)]);
  const saved = await f.service.save(f.scope, actor, {
    definition: f.definition,
    expectedRevision: 0,
    requestId: randomUUID(),
  });
  expect(saved.validation).toMatchObject({ valid: true, complete: true });
  const tested = await f.service.check(
    f.scope,
    actor,
    f.definition.id,
    1,
    "TEST",
  );
  expect(tested).toMatchObject({
    valid: true,
    complete: true,
    status: "FAILED",
    terminalReason: "deadline_expired",
  });
  for (const kind of ["VALIDATE", "IMPACT"] as const)
    await f.service.check(f.scope, actor, f.definition.id, 1, kind);
  // A seven-day wait exhausts the independently capped Run lifetime.
  // No successful TEST check is fabricated to make this activation pass.
  await expect(
    f.service.enable(f.scope, actor, f.definition.id, {
      revision: 1,
      semanticHash: saved.validation.semanticHash!,
      requestId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "AUTOMATION_REVIEW_REQUIRED" });
  await expect(
    f.service.start(f.scope, actor, f.definition.id, {
      requestId: randomUUID(),
    }),
  ).rejects.toMatchObject({ code: "AUTOMATION_NOT_ACTIVE" });
  const runs = (
    await sql<{
      count: number;
    }>`SELECT count(*)::integer AS count FROM automation_runs WHERE ${tenant(f.scope)}`.execute(
      db,
    )
  ).rows[0];
  expect(runs?.count).toBe(0);
});

/** T114 exact temporary-message-body -> post-Wait fixture remains NOT EXECUTED:
 * no registered body source or authored non-retainable type is exposed. These
 * three adjacent guards must never be reported as that pre-enable taint test. */
it("T114 PARTIAL source boundary: an unregistered event.body source needed after Wait is refused at save", async () => {
  const f = await fixture([
    wait("before.body.use", 1),
    declare("body.copy", "PlainText", variable("event.body", "PlainText")),
  ]);
  f.definition.trigger = {
    kind: "internal",
    event: "ticketUpdated",
    inputs: [
      {
        id: "event.body",
        name: "Unregistered temporary body",
        type: "PlainText",
      },
    ],
  };
  expect(
    [...INTERNAL_EVENT_FIELDS, ...INTERACTION_EVENT_FIELDS].every(
      ({ type }) => type !== "PlainText",
    ),
  ).toBe(true);
  expect(validateEventTriggerInputs(f.definition.trigger)).toBe(false);
  await rejectedAtSave(f, f.definition, "EVENT_INPUT");
});

it("T114 PARTIAL schema boundary: forged non-retainable provenance cannot be authored into a literal", async () => {
  const f = await fixture([
    declare(
      "temporary",
      "PlainText",
      literal("PlainText", "SYNTHETIC_LITERAL_ONLY"),
    ),
    wait("before.copy", 1),
    declare("copy", "PlainText", variable("temporary", "PlainText")),
  ]);
  const forged = structuredClone(f.definition);
  const first = forged.body[0];
  expect(first?.kind).toBe("declare");
  if (first?.kind !== "declare") throw Error("FIXTURE_DECLARATION_MISSING");
  // Raw JSON represents an untrusted author attempt, not an accepted source.
  Object.assign(first.value, {
    provenance: [{ source: "service", resumable: false }],
  });
  await rejectedAtSave(f, forged, "SCHEMA");
});

it("T114 PARTIAL runtime boundary: a synthetic non-retainable registered result stops before Wait and is never persisted", async () => {
  const resultId = "887333333333333333";
  const execute = vi.fn<AutomationRuntimeAdapter["execute"]>(
    async ({ scope }) => ({
      state: "SUCCEEDED",
      value: {
        type: "MessageRef",
        value: { id: resultId, guildId: scope.guildId },
        provenance: [
          { source: "service", guildId: scope.guildId, resumable: false },
        ],
      },
    }),
  );
  const f = await fixture([], { authorize: async () => {}, execute });
  const channelId = "887222222222222222";
  f.definition.targets = {
    channelIds: [channelId],
    roleIds: [],
    parentCategoryIds: [],
  };
  f.definition.body = [
    {
      id: "synthetic.source",
      kind: "action",
      operation: "discord.sendMessage",
      inputs: {
        channel: literal("ChannelRef", {
          id: channelId,
          guildId: f.scope.guildId,
        }),
        content: literal("PlainText", "SYNTHETIC_NO_DISCORD_CALL"),
      },
      output: {
        id: "transient.ref",
        name: "Synthetic transient reference",
        type: "MessageRef",
      },
    },
    wait("forbidden.wait", 1),
    declare(
      "reference.copy",
      "MessageRef",
      variable("transient.ref", "MessageRef"),
    ),
  ];
  await enable(f, {
    outcomes: { "synthetic.source": "SUCCEEDED" },
    outputs: {
      "synthetic.source": {
        type: "MessageRef",
        value: { id: "887444444444444444", guildId: f.scope.guildId },
      },
    },
  });
  const run = await f.service.start(f.scope, actor, f.definition.id, {
    requestId: randomUUID(),
  });
  const finishOperation = vi.spyOn(f.runtime.store, "finishOperation");
  expect(await f.runtime.tick(f.scope, run.id)).toMatchObject({
    state: "UNKNOWN",
  });
  expect(execute).toHaveBeenCalledTimes(1);
  const attemptedFinish = finishOperation.mock.results[0];
  expect(attemptedFinish?.type).toBe("return");
  await expect(attemptedFinish?.value).rejects.toMatchObject({
    code: "AUTOMATION_RESULT_NOT_RESUMABLE",
  });
  const stopped = await f.runtime.store.run(f.scope, run.id);
  expect(stopped).toMatchObject({
    status: "UNKNOWN",
    reason: "AUTOMATION_RESULT_NOT_RESUMABLE",
    wake_at: null,
  });
  expect(stopped?.resume.variables["transient.ref"]).toBeUndefined();
  expect(stopped?.resume.variables["reference.copy"]).toBeUndefined();
  expect(stopped?.resume.waitUntil).toBeUndefined();
  expect(stopped?.resume.frames[0]?.index).toBe(0);
  const ledger = (
    await sql<{
      state: string;
      result: unknown;
    }>`SELECT state,result FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${run.id}::uuid`.execute(
      db,
    )
  ).rows;
  expect(ledger).toEqual([{ state: "STARTED", result: null }]);
  const persisted = (
    await sql<{ text: string }>`SELECT jsonb_build_object(
    'resume',resume,
    'events',(SELECT COALESCE(jsonb_agg(to_jsonb(e)),'[]'::jsonb) FROM automation_run_events e WHERE e.organization_id=${f.scope.organizationId}::uuid AND e.guild_id=${f.scope.guildId} AND e.run_id=${run.id}::uuid),
    'operations',(SELECT COALESCE(jsonb_agg(to_jsonb(o)),'[]'::jsonb) FROM automation_operations o WHERE o.organization_id=${f.scope.organizationId}::uuid AND o.guild_id=${f.scope.guildId} AND o.run_id=${run.id}::uuid)
  )::text AS text FROM automation_runs WHERE ${tenant(f.scope)} AND id=${run.id}::uuid`.execute(
      db,
    )
  ).rows[0]?.text;
  expect(persisted).toBeDefined();
  expect(persisted).not.toContain(resultId);
  // The terminal UNKNOWN Run has no automatic connector retry.
  expect(await f.runtime.tick(f.scope, run.id)).toMatchObject({
    state: "UNKNOWN",
  });
  expect(execute).toHaveBeenCalledTimes(1);
});
