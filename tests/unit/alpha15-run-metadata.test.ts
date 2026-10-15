import { expect, it } from "vitest";
import { RUN_STARTED_AT_ID, runBuiltinDeclarations, runBuiltinValues } from "../../packages/automation/src/builtins";
import { compileFlowDefinition, validateFlowDefinition } from "../../packages/automation/src/definition";
import { simulateAutomationPlan } from "../../packages/automation/src/simulation";
import { availableVariables, createDraft } from "../../apps/web/app/automation/model";
import type { FlowDefinition, ValueInput } from "../../packages/automation/src/types";

const started: ValueInput = { kind: "variable", type: "Instant", variableId: RUN_STARTED_AT_ID };
const flow = (): FlowDefinition => ({ schemaVersion: 1, id: "metadata", guildId: "884000000000000001", name: "Metadata", trigger: { kind: "manual", inputs: [] }, variables: [], body: [] });

it("registers a typed, localized Run start reference without adding it to user inputs", () => {
  const definition = createDraft("884000000000000001", "en");
  expect(availableVariables(definition, undefined, "en")).toContainEqual(runBuiltinDeclarations("en")[0]);
  expect(availableVariables(definition, undefined, "ja")[0]?.name).toBe("この実行の開始時刻");
  expect(definition.trigger).toEqual({ kind: "manual", inputs: [] });
  const value = runBuiltinValues(definition.guildId, "2026-10-15T08:00:00.000Z")[RUN_STARTED_AT_ID]!;
  expect(value).toEqual({ type: "Instant", value: "2026-10-15T08:00:00.000Z", provenance: [{ source: "service", guildId: definition.guildId, resumable: true }] });
});

it("rejects assignment and every declaration that could shadow the service identifier", () => {
  const assignment = flow();
  assignment.body = [{ id: "assign", kind: "assign", variableId: RUN_STARTED_AT_ID, value: { kind: "literal", type: "Instant", value: "2000-01-01T00:00:00Z" } }];
  expect(validateFlowDefinition(assignment).issues.some(issue => issue.code === "VARIABLE_READONLY")).toBe(true);
  for (const location of ["trigger", "variables", "local", "procedure", "pure"] as const) {
    const definition = flow(), variable = { id: RUN_STARTED_AT_ID, name: "Spoof", type: "Instant" as const };
    if (location === "trigger" && definition.trigger.kind === "manual") definition.trigger.inputs = [variable];
    if (location === "variables") definition.variables = [variable];
    if (location === "local") definition.body = [{ id: "shadow", kind: "declare", variable, value: started }];
    if (location === "procedure") definition.procedures = [{ id: "procedure", revision: 1, name: "Procedure", inputs: [variable], outputs: [], body: [{ id: "return", kind: "return", values: {} }] }];
    if (location === "pure") definition.pureDefinitions = [{ id: "pure", revision: 1, name: "Pure", inputs: [variable], outputType: "Instant", value: started }];
    expect(validateFlowDefinition(definition).issues.some(issue => issue.code === "VARIABLE_RESERVED"), location).toBe(true);
  }
});

it("requires procedures and pure values to receive fixed metadata explicitly as an argument", () => {
  const definition = flow();
  definition.procedures = [{ id: "procedure", revision: 1, name: "Procedure", inputs: [], outputs: [{ id: "out", name: "Out", type: "Instant" }], body: [{ id: "return", kind: "return", values: { out: started } }] }];
  expect(validateFlowDefinition(definition).valid).toBe(false);
  definition.procedures = [];
  definition.pureDefinitions = [{ id: "pure", revision: 1, name: "Pure", inputs: [], outputType: "Instant", value: started }];
  expect(validateFlowDefinition(definition).valid).toBe(false);
});

it("keeps the mock Run start separate from explicit current-clock reads and caller mock values", () => {
  const definition = flow();
  definition.body = [
    { id: "clock", kind: "readClock", output: { id: "now", name: "Now", type: "Instant" } },
    { id: "branch", kind: "branch", condition: { kind: "expression", type: "Boolean", expression: { operator: "compare.less", args: [started, { kind: "variable", type: "Instant", variableId: "now" }] } }, then: [{ id: "yes", kind: "end" }], otherwise: [{ id: "no", kind: "end" }], unknown: [{ id: "unknown", kind: "end" }] },
  ];
  const result = simulateAutomationPlan(compileFlowDefinition(definition), { clock: "2026-10-15T10:00:00.000Z", values: { [RUN_STARTED_AT_ID]: { type: "Instant", value: "2099-01-01T00:00:00.000Z" } } }, "2026-10-15T08:00:00.000Z");
  expect(result.status).toBe("COMPLETED");
  expect(result.steps.find(step => step.blockId === "branch")?.code).toBe("CONDITION_TRUE");
  expect(result).toMatchObject({ productionRuns: 0, externalChanges: 0, mocked: true });
});
