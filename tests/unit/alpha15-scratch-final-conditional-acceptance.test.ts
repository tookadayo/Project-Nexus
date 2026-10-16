import { describe, expect, it } from "vitest";
import { validateFlowDefinition } from "../../packages/automation/src/definition";
import { evaluateValue, validateValueInput } from "../../packages/automation/src/expression";
import { simulateAutomationPlan } from "../../packages/automation/src/simulation";
import type { EvaluationContext, FlowDefinition, Statement, ValueInput } from "../../packages/automation/src/types";

const context: EvaluationContext = { guildId: "886111111111111111", semanticProfile: "scratch.v1", variables: {} };
const number = (value: number): ValueInput => ({ kind: "literal", type: "Number", value });
const boolean = (value: boolean): ValueInput => ({ kind: "literal", type: "Boolean", value });
const condition = (value: "true" | "false" | "unknown"): ValueInput => ({ kind: "literal", type: "ConditionResult", value });
const missing: ValueInput = { kind: "missing", type: "Number" };
const choose = (args: ValueInput[]): ValueInput => ({ kind: "expression", type: "Number", expression: { operator: "value.choose", args } });
const flow = (value: ValueInput): FlowDefinition => ({
  schemaVersion: 1, semanticProfile: "scratch.v1", id: "conditional-acceptance", guildId: context.guildId,
  name: "Synthetic conditional acceptance", trigger: { kind: "manual", inputs: [] }, variables: [],
  body: [{ kind: "declare", id: "declare", variable: { id: "answer", name: "Answer", type: "Number" }, value }],
});

describe("Final T037 / T040 acceptance through public conditional contracts", () => {
  it("T037: rejects Boolean value.choose without an else instead of inventing a zero", () => {
    const value = choose([boolean(false), number(7)]);
    expect(() => validateValueInput(value, context)).toThrowError(expect.objectContaining({ code: "ARGUMENTS" }));
    expect(() => evaluateValue(value, context)).toThrowError(expect.objectContaining({ code: "ARGUMENTS" }));
    const checked = validateFlowDefinition(flow(value));
    expect(checked.valid).toBe(false);
    expect(checked.plan).toBeUndefined();
    expect(checked.issues).toContainEqual(expect.objectContaining({ code: "ARGUMENTS", severity: "error" }));
  });

  it("T037: a visible missing else remains an incomplete draft and does not become an execution value", () => {
    const checked = validateFlowDefinition(flow(choose([boolean(false), number(7), missing])));
    expect(checked.valid).toBe(false);
    expect(checked.complete).toBe(false);
    expect(checked.plan).toBeUndefined();
    expect(checked.issues).toContainEqual(expect.objectContaining({ code: "MISSING_INPUT", path: "body.0.value.expression.args.2", severity: "missing" }));
    expect(evaluateValue(choose([boolean(false), number(7), number(19)]), context).value).toBe(19);
    expect(evaluateValue(choose([boolean(false), number(7), number(0)]), context).value).toBe(0);
  });

  it("T037: public output procedures require a return on the false path of a Boolean CT01", () => {
    const definition = flow(number(99));
    definition.body = [{ kind: "call", id: "call", procedureId: "select", revision: 1, args: {}, outputs: { result: { id: "answer", name: "Answer", type: "Number" } } }];
    const returned: Statement = { kind: "return", id: "return.true", values: { result: number(7) } };
    definition.procedures = [{ id: "select", revision: 1, name: "Select", inputs: [], outputs: [{ id: "result", name: "Result", type: "Number" }], body: [
      { kind: "branch", id: "branch", condition: boolean(false), then: [returned], otherwise: [], unknown: [] },
    ] }];
    const checked = validateFlowDefinition(definition);
    expect(checked.valid).toBe(false);
    expect(checked.plan).toBeUndefined();
    expect(checked.issues).toContainEqual(expect.objectContaining({ code: "RETURN_REQUIRED", path: "procedures.0.body" }));
    const branch = definition.procedures[0]!.body[0]!;
    if (branch.kind !== "branch") throw Error("EXPECTED_BRANCH");
    branch.otherwise = [{ kind: "return", id: "return.false", values: { result: number(19) } }];
    const repaired = validateFlowDefinition(definition);
    expect(repaired.issues).toEqual([]);
    const simulated = simulateAutomationPlan(repaired.plan!, { inspectVariables: ["answer"] });
    expect(simulated.status).toBe("COMPLETED");
    expect(simulated.inspection?.values).toContainEqual(expect.objectContaining({ variableId: "answer", value: 19 }));
  });

  it("T040 value-returning scope: rejects a ConditionResult value.choose without the unknown result", () => {
    const value = choose([condition("unknown"), number(7), number(19)]);
    expect(() => validateValueInput(value, context)).toThrowError(expect.objectContaining({ code: "ARGUMENTS" }));
    expect(() => evaluateValue(value, context)).toThrowError(expect.objectContaining({ code: "ARGUMENTS" }));
    const checked = validateFlowDefinition(flow(value));
    expect(checked.valid).toBe(false);
    expect(checked.plan).toBeUndefined();
    expect(checked.issues).toContainEqual(expect.objectContaining({ code: "ARGUMENTS" }));
    const draft = validateFlowDefinition(flow(choose([condition("unknown"), number(7), number(19), missing])));
    expect(draft.complete).toBe(false);
    expect(draft.plan).toBeUndefined();
    expect(draft.issues).toContainEqual(expect.objectContaining({ code: "MISSING_INPUT", path: "body.0.value.expression.args.3" }));
  });

  it("T040 value-returning scope: requires and selects explicit same-type true, false and unknown results", () => {
    for (const [input, expected] of [["true", 7], ["false", 19], ["unknown", -11]] as const) {
      const value = choose([condition(input), number(7), number(19), number(-11)]);
      expect(validateFlowDefinition(flow(value)).issues).toEqual([]);
      expect(evaluateValue(value, context).value).toBe(expected);
    }
  });

  it("R02 compatibility limits T040: ordinary CT01 with empty unknown still joins in Scratch v1", () => {
    const definition = flow(number(-1));
    definition.body.push({ kind: "branch", id: "ordinary.branch", condition: condition("unknown"),
      then: [{ kind: "assign", id: "true.assignment", variableId: "answer", value: number(7) }],
      otherwise: [{ kind: "assign", id: "false.assignment", variableId: "answer", value: number(19) }], unknown: [] },
    { kind: "assign", id: "after.branch", variableId: "answer", value: number(42) });
    const checked = validateFlowDefinition(definition);
    expect(checked.issues).toEqual([]);
    const simulated = simulateAutomationPlan(checked.plan!, { inspectVariables: ["answer"] });
    expect(simulated.status).toBe("COMPLETED");
    expect(simulated.steps.some(step => step.blockId === "true.assignment" || step.blockId === "false.assignment")).toBe(false);
    expect(simulated.inspection?.values).toContainEqual(expect.objectContaining({ variableId: "answer", value: 42 }));
  });
});
