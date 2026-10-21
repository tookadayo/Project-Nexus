import { describe, expect, it } from "vitest";
import { evaluateValue, validateValueInput } from "../../packages/automation/src/expression";
import type { EvaluationContext, Expression, JsonValue, ValueInput, ValueType } from "../../packages/automation/src/types";

const context: EvaluationContext = { guildId: "123456789012345678", variables: {} };
const literal = (type: ValueType, value: JsonValue): ValueInput => ({ kind: "literal", type, value });
const expression = (type: ValueType, operator: Expression["operator"], args: ValueInput[], options?: Expression["options"]): ValueInput => ({ kind: "expression", type, expression: { operator, args, ...(options ? { options } : {}) } });
const run = (input: ValueInput) => evaluateValue(input, context).value;

/** Read from e37fd32 before adding the opt-in Scratch profile. These are
 * compatibility fixtures, including intentional differences from new semantics.
 */
describe("e37fd32 expression compatibility", () => {
  it("keeps legacy scalar text positions and exact scalar equality", () => {
    expect(run(expression("Number", "text.length", [literal("PlainText", "e\u0301👩‍🚀")]))).toBe(5);
    expect(run(expression("PlainText", "text.slice", [literal("PlainText", "e\u0301"), literal("Number", 2), literal("Number", 1)]))).toBe("\u0301");
    expect(run(expression("Boolean", "compare.equal", [literal("PlainText", "é"), literal("PlainText", "e\u0301")]))).toBe(false);
  });
  it("keeps legacy text ordering and JSON equality permissions", () => {
    expect(run(expression("Boolean", "compare.less", [literal("PlainText", "a"), literal("PlainText", "b")]))).toBe(true);
    const optional: ValueType = { kind: "Optional", value: "Number" };
    expect(run(expression("Boolean", "compare.equal", [literal(optional, { state: "unset" }), literal(optional, { state: "unset" })]))).toBe(true);
    const choice: ValueType = { kind: "Enum", values: ["yes", "no"] };
    expect(run(expression("Boolean", "compare.equal", [literal(choice, "yes"), literal(choice, "yes")]))).toBe(true);
  });
  it("keeps away-from-zero rounding, remainder, precision range and literal substitution", () => {
    expect(run(expression("Number", "number.round", [literal("Number", -1.5)]))).toBe(-2);
    expect(run(expression("Number", "number.round", [literal("Number", -0.5)]))).toBe(-1);
    expect(run(expression("Number", "number.remainder", [literal("Number", -7), literal("Number", 3)]))).toBe(-1);
    expect(() => validateValueInput(expression("Number", "number.round", [literal("Number", 1)], { digits: 9 }), context)).toThrow();
    expect(run(expression("PlainText", "text.replace", [literal("PlainText", "aa"), literal("PlainText", "a"), literal("PlainText", "$&")]))).toBe("$&$&");
    // Legacy validation did not reject an empty search in an unchosen pure
    // branch. Keep that historical validation boundary for old revisions.
    expect(run(expression("PlainText", "value.choose", [literal("Boolean", true), literal("PlainText", "chosen"), expression("PlainText", "text.replace", [literal("PlainText", "x"), literal("PlainText", ""), literal("PlainText", "y")])]))).toBe("chosen");
  });
  it("keeps Boolean list predicates and aggregate record shapes", () => {
    const empty = literal({ kind: "List", element: "Number" }, []);
    expect(run(expression("Boolean", "list.any", [empty], { bindingId: "item", body: literal("Boolean", true) }))).toBe(false);
    expect(run(expression("Boolean", "list.all", [empty], { bindingId: "item", body: literal("Boolean", false) }))).toBe(true);
    expect(() => validateValueInput(expression("Boolean", "list.any", [empty], { bindingId: "item", body: literal("ConditionResult", "unknown") }), context)).toThrow();
    expect(run(expression({ kind: "Record", schemaId: "AverageValue" }, "list.average", [empty]))).toEqual({ value: { state: "unset" }, count: 0 });
    expect(run(expression({ kind: "Record", schemaId: "MinMaxValue" }, "list.minMax", [empty]))).toEqual({ minimum: { state: "unset" }, maximum: { state: "unset" } });
    const matchType: ValueType = { kind: "Record", schemaId: "nexus.find-match.v1", typeArgs: ["Number"] };
    const matched = expression({ kind: "Optional", value: matchType }, "list.findResult", [literal({ kind: "List", element: "Number" }, [2, 4])], { bindingId: "item", body: expression("Boolean", "compare.equal", [{ kind: "variable", type: "Number", variableId: "item" }, literal("Number", 4)]) });
    expect(run(matched)).toEqual({ state: "set", value: { item: 4, position: 2 } });
    const unwrapped = expression(matchType, "optional.default", [matched, literal(matchType, { item: 0, position: 1 })]);
    expect(run(expression("Number", "record.field", [unwrapped], { key: "position" }))).toBe(2);
  });
});
