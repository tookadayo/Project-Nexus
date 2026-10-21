import { describe, expect, it } from "vitest";
import { AutomationValueError, evaluateValue, validateValueInput } from "../../packages/automation/src/expression";
import { expressionCardsFor, instantiateExpressionCard } from "../../packages/automation/src/expression-cards";
import { compileFlowDefinition, validateFlowDefinition } from "../../packages/automation/src/definition";
import { simulateAutomationPlan } from "../../packages/automation/src/simulation";
import type { EvaluationContext, FlowDefinition, JsonValue, Statement, ValueInput, ValueType } from "../../packages/automation/src/types";

const guildId = "885111111111111111";
const context: EvaluationContext = { guildId, variables: {}, semanticProfile: "scratch.v1" };
const listOf = (element: ValueType): ValueType => ({ kind: "List", element });
const optionalOf = (value: ValueType): ValueType => ({ kind: "Optional", value });
const list = (values: JsonValue[], element: ValueType = "Number"): ValueInput => ({ kind: "literal", type: listOf(element), value: values });
const last = (strict: boolean, source: ValueInput): ValueInput => {
  if (typeof source.type === "string" || source.type.kind !== "List") throw new Error("FixtureListRequired");
  return { kind: "expression", type: strict ? source.type.element : optionalOf(source.type.element), expression: { operator: strict ? "list.lastStrict" : "list.lastOptional", args: [source] } };
};
const run = (input: ValueInput, overrides: Partial<EvaluationContext> = {}) => evaluateValue(input, { ...context, ...overrides });
const flow = (body: Statement[]): FlowDefinition => ({ schemaVersion: 1, semanticProfile: "scratch.v1", id: "last-items", name: "Last item forms", guildId, trigger: { kind: "manual", inputs: [] }, variables: [], body });

describe("T079 last-item dedicated forms", () => {
  it("returns unset for an empty list and preserves false/zero/empty-string present payloads", () => {
    expect(run(last(false, list([]))).value).toEqual({ state: "unset" });
    for (const [type, value] of [["Boolean", false], ["Number", 0], ["PlainText", ""]] as const)
      expect(run(last(false, list([value], type))).value).toEqual({ state: "set", value });
  });
  it("selects the actual final position in duplicate lists and throws exact IndexError for strict empty", () => {
    expect(run(last(true, list([1]))).value).toBe(1);
    expect(run(last(true, list([7, 2, 7, 2]))).value).toBe(2);
    expect(run(last(false, list([7, 2, 7, 2]))).value).toEqual({ state: "set", value: 2 });
    expect(() => run(last(true, list([])))).toThrowError(expect.objectContaining({ code: "IndexError" }));
    try { run(last(true, list([]))); } catch (error) { expect(error).toBeInstanceOf(AutomationValueError); }
  });
  it("clones nested selected values and keeps the input immutable in both forms", () => {
    const values: JsonValue[] = [[1], [2, 2]], source = list(values, listOf("Number"));
    const strict = run(last(true, source));
    (strict.value as JsonValue[]).push(3);
    const optional = run(last(false, source));
    ((optional.value as { value: JsonValue[] }).value).push(4);
    expect(values).toEqual([[1], [2, 2]]);
    expect(run(source).value).toEqual([[1], [2, 2]]);
    expect(strict.provenance.some(value => value.source === "literal")).toBe(true);
    expect(optional.provenance.some(value => value.source === "expression")).toBe(true);
  });
  it("keeps one typed List argument, declared output types and Scratch-only semantics", () => {
    const optional = last(false, list([1])), strict = last(true, list([1]));
    expect(() => validateValueInput({ ...optional, type: "Number" }, context)).toThrow();
    expect(() => validateValueInput({ ...strict, type: "PlainText" }, context)).toThrow();
    for (const input of [optional, strict]) {
      expect(() => run(input, { semanticProfile: undefined })).toThrowError(expect.objectContaining({ code: "SEMANTIC_PROFILE" }));
      if (input.kind !== "expression") throw new Error("FixtureExpressionRequired");
      expect(() => validateValueInput({ ...input, expression: { ...input.expression, args: [list([1]), { kind: "literal", type: "Number", value: 1 }] } }, context)).toThrow();
      expect(() => validateValueInput({ ...input, expression: { ...input.expression, args: [{ kind: "literal", type: "Number", value: 1 }] } }, context)).toThrow();
    }
    const legacyItem: ValueInput = { kind: "expression", type: "Number", expression: { operator: "list.item", args: [list([3, 9]), { kind: "literal", type: "Number", value: 2 }] } };
    expect(run(legacyItem, { semanticProfile: undefined }).value).toBe(9);
  });
  it("round trips both opcodes through the shared JSON definition enum", () => {
    const definition = flow([
      { kind: "declare", id: "optional", variable: { id: "optional", name: "Optional last", type: optionalOf("Number") }, value: last(false, list([])) },
      { kind: "declare", id: "strict", variable: { id: "strict", name: "Strict last", type: "Number" }, value: last(true, list([9])) },
    ]);
    const restored = JSON.parse(JSON.stringify(definition)) as FlowDefinition;
    expect(validateFlowDefinition(restored).valid).toBe(true);
    expect(compileFlowDefinition(restored).definition.body).toEqual(definition.body);
  });
  it("exposes an Optional payload only in its correctly typed present branch", () => {
    const branch: Extract<Statement, { kind: "optionalBranch" }> = { kind: "optionalBranch", id: "branch", value: last(false, list([0])), output: { id: "present", name: "Present", type: "Number" }, present: [{ kind: "declare", id: "copy", variable: { id: "copy", name: "Copy", type: "Number" }, value: { kind: "variable", type: "Number", variableId: "present" } }, { kind: "end", id: "present-end" }], unset: [{ kind: "end", id: "unset-end" }] };
    expect(validateFlowDefinition(flow([branch])).valid).toBe(true);
    expect(simulateAutomationPlan(compileFlowDefinition(flow([branch]))).steps.some(step => step.blockId === "present-end")).toBe(true);
    branch.value = last(false, list([]));
    expect(simulateAutomationPlan(compileFlowDefinition(flow([branch]))).steps.some(step => step.blockId === "unset-end")).toBe(true);
    const wrongType = structuredClone(branch); wrongType.output.type = "PlainText";
    expect(validateFlowDefinition(flow([wrongType])).valid).toBe(false);
    const leak = structuredClone(branch); leak.unset = [structuredClone(branch.present[0]!)];
    expect(validateFlowDefinition(flow([leak])).valid).toBe(false);
  });
  it("uses the shared evaluation, list-size and value-size budgets", () => {
    const input = last(false, list([1]));
    expect(() => run(input, { limits: { maxEvaluations: 1 } })).toThrowError(expect.objectContaining({ code: "EVALUATION_BUDGET" }));
    expect(() => run(last(true, list([1, 2])), { limits: { maxListItems: 1 } })).toThrow();
    expect(() => run(input, { limits: { maxValueBytes: 20 } })).toThrowError(expect.objectContaining({ code: "VALUE_BYTES" }));
    const budget = { evaluations: 0 };
    expect(run(last(true, list([1])), { budget }).value).toBe(1);
    expect(budget.evaluations).toBe(2);
  });
  it("offers distinct Japanese/English shape candidates with one missing List input", () => {
    for (const [operator, type] of [["list.lastOptional", optionalOf("Number")], ["list.lastStrict", "Number"]] as const) {
      const cards = expressionCardsFor(type, { semanticProfile: "scratch.v1" }).filter(card => card.operator === operator);
      expect(cards.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.inputs).toHaveLength(1);
        expect(card.inputs[0]!.type).toEqual(listOf("Number"));
        expect(card.label.ja).toContain("最後");
        expect(card.label.en).toContain("Last item");
        const input = instantiateExpressionCard(card, () => "local");
        expect(input.kind === "expression" && input.expression.args[0]!.kind).toBe("missing");
        expect(() => validateValueInput(input, context)).not.toThrow();
      }
      expect(expressionCardsFor(type).some(card => card.operator === operator)).toBe(false);
    }
  });
});
