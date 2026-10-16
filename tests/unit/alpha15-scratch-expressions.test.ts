import { describe, expect, it } from "vitest";
import { assertCount, evaluateValue, validateValueInput } from "../../packages/automation/src/expression";
import { expressionCardsFor, instantiateExpressionCard } from "../../packages/automation/src/expression-cards";
import { indexResultType, searchResultType } from "../../packages/automation/src/structured-values";
import { TEXT_CLEAN_MODE_TYPE } from "../../packages/automation/src/temporal-values";
import type { EvaluationContext, Expression, JsonValue, ValueInput, ValueType } from "../../packages/automation/src/types";

const context: EvaluationContext = { guildId: "123456789012345678", semanticProfile: "scratch.v1", variables: {} };
const lit = (type: ValueType, value: JsonValue): ValueInput => ({ kind: "literal", type, value });
const n = (value: number) => lit("Number", value), t = (value: string) => lit("PlainText", value);
const list = (value: JsonValue[], element: ValueType = "Number") => lit({ kind: "List", element }, value);
const exp = (type: ValueType, operator: Expression["operator"], args: ValueInput[], options?: Expression["options"]): ValueInput => ({ kind: "expression", type, expression: { operator, args, ...(options ? { options } : {}) } });
const run = (input: ValueInput, extra: Partial<EvaluationContext> = {}) => evaluateValue(input, { ...context, ...extra }).value;
const compare = (operator: Expression["operator"], a: ValueInput, b: ValueInput) => exp("Boolean", operator, [a, b]);
const index = (items: ValueInput, item: ValueInput) => exp(indexResultType, "list.indexOf", [items, item]);

describe("Scratch v1 typed expression contracts", () => {
  it("T004/T008–T011/S031/S032: compares typed values without coercion or permission claims", () => {
    for (const [operator, result] of [["number.add", 7], ["number.subtract", -1], ["number.multiply", 12], ["number.divide", .75]] as const)
      expect(run(exp("Number", operator, [n(3), n(4)]))).toBe(result);
    expect(run(compare("compare.equal", exp("Number", "number.add", [n(.1), n(.2)]), n(.3)))).toBe(false);
    expect(() => run(compare("compare.equal", n(3), t("3")))).toThrow();
    expect(() => run(compare("compare.less", t("a"), t("b")))).toThrow();
    expect(() => run(compare("compare.less", lit("Boolean", false), lit("Boolean", true)))).toThrow();
    const ref = (id: string) => lit("ChannelRef", { guildId: context.guildId, id });
    expect(run(compare("compare.equal", ref("223456789012345678"), ref("323456789012345678")))).toBe(false);
    expect(() => run(compare("compare.equal", ref("223456789012345678"), lit("RoleRef", { guildId: context.guildId, id: "223456789012345678" })))).toThrow();
    expect(() => run(compare("compare.equal", ref("223456789012345678"), lit("ChannelRef", { guildId: "923456789012345678", id: "223456789012345678" })))).toThrow();
    expect(run(compare("compare.equal", lit("Instant", "2026-10-15T12:00:00Z"), lit("Instant", "2026-10-15T12:00:00.000Z")))).toBe(true);
    expect(run(compare("compare.less", lit("Instant", "2026-10-15T12:00:00Z"), lit("Instant", "2026-10-15T12:00:00.1Z")))).toBe(true);
    const choice = (schemaId: string, schemaRevision = 1): ValueType => ({ kind: "Enum", values: ["yes", "no"], schemaId, schemaRevision });
    expect(run(compare("compare.equal", lit(choice("fixture.choice.a"), "yes"), lit(choice("fixture.choice.a"), "yes")))).toBe(true);
    expect(() => run(compare("compare.equal", lit(choice("fixture.choice.a"), "yes"), lit(choice("fixture.choice.b"), "yes")))).toThrow();
    expect(() => run(compare("compare.equal", lit(choice("fixture.choice.a"), "yes"), lit(choice("fixture.choice.a", 2), "yes")))).toThrow();
    expect(() => run(compare("compare.equal", lit({ kind: "Enum", values: ["yes", "no"] }, "yes"), lit({ kind: "Enum", values: ["yes", "no"] }, "yes")))).toThrow();
  });
  it("S033/S034: uses explicit record descriptors recursively and rejects result equality", () => {
    const type: ValueType = { kind: "Record", schemaId: "fixture.member.v1" };
    const recordSchemas = { "fixture.member.v1": { userConstructible: true, equality: { version: 1 as const, fields: ["key"] }, fields: { key: { type: "Number" as const }, label: { type: "PlainText" as const } } } };
    expect(run(compare("compare.equal", lit(type, { key: 1, label: "A" }), lit(type, { key: 1, label: "B" })), { recordSchemas })).toBe(true);
    expect(run(exp({ kind: "List", element: type }, "list.unique", [list([{ key: 1, label: "A" }, { key: 1, label: "B" }, { key: 2, label: "C" }], type)]), { recordSchemas })).toEqual([{ key: 1, label: "A" }, { key: 2, label: "C" }]);
    const unregistered = { ...recordSchemas, "fixture.member.v1": { ...recordSchemas["fixture.member.v1"], equality: undefined } };
    const structural = { "fixture.member.v1": { ...recordSchemas["fixture.member.v1"], equality: { version: 1 as const, fields: ["key", "label"] } } };
    expect(run(compare("compare.equal", lit(type, { key: 1, label: "A" }), lit(type, { key: 1, label: "B" })), { recordSchemas: structural })).toBe(false);
    expect(() => run(compare("compare.equal", lit(type, { key: 1, label: "A" }), lit(type, { key: 1, label: "A" })), { recordSchemas: unregistered })).toThrow();
    expect(() => run(compare("compare.equal", list([{ key: 1, label: "A" }], type), list([{ key: 1, label: "A" }], type)), { recordSchemas: unregistered })).toThrow();
    for (const input of [lit({ kind: "Optional", value: "Number" }, { state: "unset" }), lit("ConditionResult", "unknown")])
      expect(() => run(compare("compare.equal", input, input))).toThrow();
    expect(() => validateValueInput(compare("compare.equal", { kind: "missing", type: { kind: "OperationOutcome", value: "Number" } }, { kind: "missing", type: { kind: "OperationOutcome", value: "Number" } }), context)).toThrow();
  });
  it("T012–T018/T121/T127/T130–T132/S050/S053/S055: exposes explicit deterministic numeric modes", () => {
    expect(run(exp("Number", "number.modulo", [n(-7), n(3)]))).toBe(2);
    expect(run(exp("Number", "number.modulo", [n(7), n(-3)]))).toBe(-2);
    expect(Object.is(run(exp("Number", "number.modulo", [n(-6), n(3)])), -0)).toBe(false);
    for (const [roundingMode, expected] of [["tiesAwayFromZero", -2], ["tiesTowardPositiveInfinity", -1]] as const)
      expect(run(exp("Number", "number.roundInteger", [n(-1.5)], { roundingMode }))).toBe(expected);
    expect(() => run(exp("Number", "number.roundInteger", [n(1.5)]))).toThrow();
    expect(run(exp("Number", "number.roundDecimal", [n(1.005), n(2)], { roundingMode: "tiesTowardPositiveInfinity" }))).toBe(1.01);
    expect(run(exp("Number", "number.roundDecimal", [n(-1.005), n(2)], { roundingMode: "tiesAwayFromZero" }))).toBe(-1.01);
    expect(run(exp("Number", "number.roundDecimal", [n(-1250), n(-2)], { roundingMode: "tiesTowardPositiveInfinity" }))).toBe(-1200);
    expect(() => run(exp("Number", "number.roundDecimal", [n(1), n(309)], { roundingMode: "tiesAwayFromZero" }))).toThrow();
    expect(run(exp("Number", "number.math", [n(9)], { mathFunction: "sqrt" }))).toBe(3);
    expect(() => run(exp("Number", "number.math", [n(-1)], { mathFunction: "sqrt" }))).toThrow();
    expect(run(exp("Number", "number.truncate", [n(-1.2)]))).toBe(-1);
    expect(run(exp("Number", "number.multiply", [n(Number.MIN_VALUE), n(1)]))).toBe(Number.MIN_VALUE);
    expect(() => run(exp("Number", "number.multiply", [n(Number.MIN_VALUE), n(.5)]))).toThrowError(expect.objectContaining({ code: "NumericUnderflow" }));
    expect(() => run(exp("Number", "number.multiply", [n(Number.MAX_VALUE), n(2)]))).toThrowError(expect.objectContaining({ code: "NumericOverflow" }));
  });
  it("T019–T028/T123/S051–S054: keeps uncertified mathematics gated instead of changing precision", () => {
    for (const mathFunction of ["sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "exp", "exp10"] as const) {
      const input = exp("Number", "number.math", [n(0)], { mathFunction });
      expect(() => validateValueInput(input, context)).not.toThrow();
      expect(() => run(input)).toThrowError(expect.objectContaining({ code: "NumericEngineUnavailable" }));
    }
  });
  it("T045–T049/S035: keeps short circuit truth tables and explicit Boolean promotion", () => {
    expect(run(exp("ConditionResult", "condition.and", [lit("ConditionResult", "unknown"), lit("ConditionResult", "false")]))).toBe("false");
    expect(run(exp("ConditionResult", "condition.or", [lit("ConditionResult", "unknown"), lit("ConditionResult", "true")]))).toBe("true");
    expect(run(exp("ConditionResult", "condition.fromBoolean", [lit("Boolean", true)]))).toBe("true");
    expect(() => run(exp("ConditionResult", "condition.and", [lit("Boolean", true), lit("ConditionResult", "unknown")]))).toThrow();
    for (const operator of ["list.filter", "list.any", "list.all", "list.find", "list.findResult", "list.search"] as const) {
      const output: ValueType = operator === "list.any" || operator === "list.all" ? "Boolean" : operator === "list.filter" ? { kind: "List", element: "Number" } : operator === "list.search" ? searchResultType("Number") : { kind: "Optional", value: "Number" };
      expect(() => run(exp(output, operator, [list([])], { bindingId: "item", body: lit("ConditionResult", "unknown") }))).toThrow();
    }
  });
  it("T053–T060/T065/T128/S044–S046/S049: separates pinned grapheme positions from scalar matching", () => {
    expect(run(exp("Number", "text.length", [t("A😀e\u0301")]))).toBe(3);
    expect(run(exp("Number", "text.length", [t("👩‍👩‍👧‍👦")]))).toBe(1);
    expect(run(exp("PlainText", "text.letter", [t("A😀B"), n(2)]))).toBe("😀");
    for (const position of [0, 4, 1.5]) expect(() => run(exp("PlainText", "text.letter", [t("abc"), n(position)]))).toThrow();
    expect(run(exp("PlainText", "text.slice", [t(""), n(1), n(0)]))).toBe("");
    expect(run(exp("PlainText", "text.slice", [t("abc"), n(4), n(0)]))).toBe("");
    expect(() => run(exp("PlainText", "text.slice", [t("abc"), n(3), n(2)]))).toThrow();
    expect(run(exp("Boolean", "text.contains", [t("e\u0301"), t("\u0301")]))).toBe(true);
    expect(run(exp(indexResultType, "text.find", [t("e\u0301"), t("e")]))).toEqual({ state: "not_found" });
    expect(run(exp(indexResultType, "text.find", [t("e\u0301"), t("e\u0301")]))).toEqual({ state: "found", index: 1 });
    expect(run(exp(indexResultType, "text.find", [t(""), t("")]))).toEqual({ state: "found", index: 1 });
    expect(run(exp("Number", "text.length", [t("e\u0301")]), { semanticProfile: undefined })).toBe(2);
    expect(() => run(t("\ud800"))).toThrowError(expect.objectContaining({ code: "InvalidUnicodeScalarText" }));
    expect(() => run(exp("PlainText", "text.join", [n(3), t("x")]))).toThrow();
  });
  it("T061–T064/S044/S045/S047/S048: never evaluates replacement templates and preserves explicit modes", () => {
    expect(run(exp("PlainText", "text.replace", [t("aaaa"), t("aa"), t("b")], { replaceMode: "all" }))).toBe("bb");
    expect(run(exp("PlainText", "text.replace", [t("aaaa"), t("aa"), t("$&\\")], { replaceMode: "first" }))).toBe("$&\\aa");
    expect(() => run(exp("PlainText", "text.replace", [t("a"), t(""), t("x")], { replaceMode: "all" }))).toThrow();
    expect(run(exp({ kind: "List", element: "PlainText" }, "text.split", [t("a,,b,"), t(",")], { keepEmpty: true }))).toEqual(["a", "", "b", ""]);
    expect(run(exp({ kind: "List", element: "PlainText" }, "text.split", [t(""), t(",")], { keepEmpty: false }))).toEqual([]);
    expect(run(exp("Number", "text.length", [exp("PlainText", "text.join", [t("e"), t("\u0301")])]))).toBe(1);
    expect(run(exp("PlainText", "text.normalize", [t("e\u0301")], { normalization: "NFC" }))).toBe("é");
    expect(run(exp("PlainText", "text.caseFold", [t("Straße")]))).toBe("strasse");
    expect(run(exp("PlainText", "text.lineEndings", [t("a\r\nb\rc\n")], { lineEnding: "LF" }))).toBe("a\nb\nc\n");
    expect(run(exp("PlainText", "text.trim", [t("\u0085 A \u0085")]))).toBe("A");
    expect(run(exp("PlainText", "text.trim", [t("\ufeffA\ufeff")]))).toBe("\ufeffA\ufeff");
    expect(run(exp("PlainText", "text.clean", [t("\u0085 A \u0085"), lit(TEXT_CLEAN_MODE_TYPE, "trim")]))).toBe("A");
    expect(() => run(exp("PlainText", "text.repeat", [t("abcd"), n(4)]), { limits: { maxTextLength: 10 } })).toThrow();
  });
  it("T031/T032/T073–T079/T081–T083/S036/S056: keeps immutable lists, exact integer inputs and result states", () => {
    const source = list([1, 2]);
    expect(run(exp({ kind: "List", element: "Number" }, "list.append", [source, n(3)]))).toEqual([1, 2, 3]);
    expect(run(source)).toEqual([1, 2]);
    expect(run(exp({ kind: "List", element: "Number" }, "list.clear", [source]))).toEqual([]);
    expect(run(exp({ kind: "List", element: "Number" }, "list.intersection", [list([3, 1, 3, 2]), list([1, 3])]))).toEqual([3, 1]);
    expect(run(exp({ kind: "List", element: "Number" }, "list.difference", [list([3, 1, 3, 2]), list([1, 3])]))).toEqual([2]);
    expect(run(exp({ kind: "List", element: "Number" }, "list.union", [list([3, 1, 3]), list([1, 2])]))).toEqual([3, 1, 2]);
    expect(run(exp({ kind: "List", element: "PlainText" }, "list.sort", [list(["😀", "\ue000"], "PlainText")], { orderVersion: "unicode-scalar.v1" }))).toEqual(["\ue000", "😀"]);
    expect(() => run(exp({ kind: "List", element: "PlainText" }, "list.sort", [list(["b", "a"], "PlainText")]))).toThrow();
    expect(run(index(list([1, 2, 1]), n(1)))).toEqual({ state: "found", index: 1 });
    expect(run(index(list([1, 2]), n(3)))).toEqual({ state: "not_found" });
    expect(run(exp("Boolean", "list.contains", [list([]), n(1)]))).toBe(false);
    expect(run(exp(searchResultType("Number"), "list.search", [source], { bindingId: "item", body: compare("compare.greater", { kind: "variable", type: "Number", variableId: "item" }, n(1)) }))).toEqual({ state: "found", value: 2, index: 2 });
    expect(run(exp({ kind: "Record", schemaId: "AverageValue" }, "list.average", [list([])]))).toEqual({ value: { state: "unset" }, count: 0 });
    expect(run(exp({ kind: "Record", schemaId: "MinMaxValue" }, "list.minMax", [list([])]))).toEqual({ minimum: { state: "unset" }, maximum: { state: "unset" } });
    expect(() => run(exp({ kind: "Record", schemaId: "AverageValue" }, "list.average", [list([Number.MIN_VALUE, 0])]))).toThrowError(expect.objectContaining({ code: "NumericUnderflow" }));
    expect(() => run(exp("Number", "list.sum", [list([Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE])]))).toThrowError(expect.objectContaining({ code: "NumericOverflow" }));
    expect(run(exp({ kind: "List", element: "Number" }, "list.range", [n(Number.MAX_SAFE_INTEGER - 2), n(Number.MAX_SAFE_INTEGER), n(1)]))).toEqual([Number.MAX_SAFE_INTEGER - 2, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]);
    expect(() => run(exp({ kind: "List", element: "Number" }, "list.range", [n(-Number.MAX_SAFE_INTEGER), n(Number.MAX_SAFE_INTEGER), n(1)]))).toThrow();
    for (const value of [n(1.5), exp("Number", "number.divide", [n(3), n(2)])]) expect(() => assertCount(run(value), 10)).toThrow();
  });
  it("S031/S056/S057: editor cards share server restrictions and require explicit modes", () => {
    const booleanCards = expressionCardsFor("Boolean", { semanticProfile: "scratch.v1", variables: [{ id: "result", name: "Result", type: { kind: "Optional", value: "Number" } }] });
    expect(booleanCards.some(card => card.operator === "compare.less" && card.inputs[0]?.type === "PlainText")).toBe(false);
    expect(booleanCards.some(card => card.operator === "compare.equal" && typeof card.inputs[0]?.type === "object" && card.inputs[0].type.kind === "Optional")).toBe(false);
    const numbers = expressionCardsFor("Number", { semanticProfile: "scratch.v1" });
    expect(numbers.filter(card => card.operator === "number.roundInteger").map(card => card.options?.roundingMode).sort()).toEqual(["tiesAwayFromZero", "tiesTowardPositiveInfinity"]);
    expect(numbers.filter(card => card.operator === "number.math").map(card => card.options?.mathFunction).sort()).toEqual(["abs", "acos", "asin", "atan", "ceiling", "cos", "exp", "exp10", "floor", "ln", "log", "sin", "sqrt", "tan"]);
    for (const card of expressionCardsFor("PlainText", { semanticProfile: "scratch.v1" }))
      expect(() => validateValueInput(instantiateExpressionCard(card, () => "local_item"), context)).not.toThrow();
    expect(() => run(exp("Number", "number.roundInteger", [n(1)], { roundingMode: "tiesAwayFromZero" }), { semanticProfile: undefined })).toThrow();
  });
  it("T084–T088/S036: pure value definitions isolate parameters and reject hidden dependencies and cycles", () => {
    const parameter = { kind: "variable" as const, type: "Number" as const, variableId: "amount" };
    const definition = { id: "add-reserve", revision: 1, name: "Add reserve", inputs: [{ id: "amount", name: "Amount", type: "Number" as const }, { id: "reserve", name: "Reserve", type: "Number" as const }], outputType: "Number" as const, value: exp("Number", "number.add", [parameter, { kind: "variable", type: "Number", variableId: "reserve" }]) };
    const call = exp("Number", "pure.call", [n(80), n(20)], { definitionId: definition.id, revision: 1 });
    expect(run(call, { pureDefinitions: [definition] })).toBe(100);
    expect(() => run(call, { pureDefinitions: [{ ...definition, value: { kind: "variable", type: "Number", variableId: "outside" } }], variables: { outside: { type: "Number", value: 5, provenance: [] } } })).toThrow();
    expect(() => run(call, { pureDefinitions: [{ ...definition, value: call }] })).toThrow();
    expect(() => run(exp("Number", "pure.call", [n(80)], { definitionId: definition.id, revision: 1 }), { pureDefinitions: [definition] })).toThrow();
    expect(() => assertCount(run(exp("Number", "pure.call", [n(1.5), n(0)], { definitionId: definition.id, revision: 1 }), { pureDefinitions: [definition] }), 10)).toThrow();
  });
  it("T120: result positions cannot be extracted through an unguarded record field", () => {
    const result = exp(indexResultType, "text.find", [t("abc"), t("b")]);
    expect(() => run(exp("Number", "record.field", [result], { key: "index" }))).toThrowError(expect.objectContaining({ code: "SEARCH_RESULT_SCOPE" }));
    expect(run(exp({ kind: "Enum", values: ["found", "not_found"] }, "record.field", [result], { key: "state" }))).toBe("found");
    expect(() => run(lit(indexResultType, { state: "found", index: 1 }))).toThrow();
    const match = exp(searchResultType("Number"), "list.search", [list([3])], { bindingId: "item", body: lit("Boolean", true) });
    expect(() => run(exp("Number", "record.field", [match], { key: "value" }))).toThrowError(expect.objectContaining({ code: "SEARCH_RESULT_SCOPE" }));
  });
});
