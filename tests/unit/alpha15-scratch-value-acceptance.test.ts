import { describe, expect, it } from "vitest";
import {
  evaluateValue,
  typeEquals,
  validateValueInput,
} from "../../packages/automation/src/expression";
import { expressionCardsFor } from "../../packages/automation/src/expression-cards";
import {
  findMatchType,
  groupRecordType,
  indexResultType,
  searchResultType,
} from "../../packages/automation/src/structured-values";
import { registeredPairType } from "../../packages/automation/src/registered-pairs";
import { TEXT_CLEAN_MODE_TYPE } from "../../packages/automation/src/temporal-values";
import type {
  ConditionResult,
  EvaluatedValue,
  EvaluationContext,
  Expression,
  JsonValue,
  RecordSchema,
  ValueInput,
  ValueType,
} from "../../packages/automation/src/types";

const context: EvaluationContext = {
  guildId: "888000000000000000",
  semanticProfile: "scratch.v1",
  variables: {},
};
const literal = (type: ValueType, value: JsonValue): ValueInput => ({
  kind: "literal",
  type,
  value,
});
const n = (value: number) => literal("Number", value);
const t = (value: string) => literal("PlainText", value);
const b = (value: boolean) => literal("Boolean", value);
const c = (value: ConditionResult) => literal("ConditionResult", value);
const listType = (element: ValueType): ValueType => ({ kind: "List", element });
const items = (value: JsonValue[], element: ValueType = "Number") =>
  literal(listType(element), value);
const variable = (variableId: string, type: ValueType): ValueInput => ({
  kind: "variable",
  type,
  variableId,
});
const exp = (
  type: ValueType,
  operator: Expression["operator"],
  args: ValueInput[],
  options?: Expression["options"],
): ValueInput => ({
  kind: "expression",
  type,
  expression: { operator, args, ...(options ? { options } : {}) },
});
const run = (input: ValueInput, extra: Partial<EvaluationContext> = {}) =>
  evaluateValue(input, { ...context, ...extra }).value;
const compare = (
  operator: Expression["operator"],
  first: ValueInput,
  second: ValueInput,
) => exp("Boolean", operator, [first, second]);
const rejected = (
  input: ValueInput,
  code: string,
  extra: Partial<EvaluationContext> = {},
) =>
  expect(() => run(input, extra)).toThrowError(
    expect.objectContaining({ code }),
  );

const recordSchemas: Record<string, RecordSchema> = {
  "fixture.value-key.v1": {
    userConstructible: true,
    equality: { version: 1, fields: ["key"] },
    fields: { key: { type: "Number" }, label: { type: "PlainText" } },
  },
  "fixture.value-structure.v1": {
    userConstructible: true,
    equality: { version: 1, fields: ["numbers", "label"] },
    fields: {
      numbers: { type: listType("Number") },
      label: { type: "PlainText" },
    },
  },
  "fixture.value-unregistered.v1": {
    userConstructible: true,
    fields: { value: { type: "Number" } },
  },
};
interface MatrixRow {
  name: string;
  type: ValueType;
  equal: boolean;
  ordered: boolean;
  first?: JsonValue;
  second?: JsonValue;
}
const refTypes = [
  "ChannelRef",
  "RoleRef",
  "MemberRef",
  "ThreadRef",
  "MessageRef",
  "TicketRef",
  "EventRef",
] as const;
const matrix: MatrixRow[] = [
  {
    name: "Number",
    type: "Number",
    equal: true,
    ordered: true,
    first: 3,
    second: 4,
  },
  {
    name: "PlainText",
    type: "PlainText",
    equal: true,
    ordered: false,
    first: "A",
    second: "a",
  },
  {
    name: "Boolean",
    type: "Boolean",
    equal: true,
    ordered: false,
    first: false,
    second: true,
  },
  {
    name: "Choice with schema",
    type: {
      kind: "Enum",
      values: ["low", "high"],
      schemaId: "fixture.choice",
      schemaRevision: 1,
    },
    equal: true,
    ordered: false,
    first: "low",
    second: "high",
  },
  {
    name: "Choice without schema",
    type: { kind: "Enum", values: ["low", "high"] },
    equal: false,
    ordered: false,
  },
  ...refTypes.map((type) => ({
    name: type,
    type,
    equal: true,
    ordered: false,
    first: { id: "888111111111111111", guildId: context.guildId },
    second: { id: "888222222222222222", guildId: context.guildId },
  })),
  {
    name: "Instant",
    type: "Instant",
    equal: true,
    ordered: true,
    first: "2026-10-15T01:00:00Z",
    second: "2026-10-15T01:00:01Z",
  },
  {
    name: "DateOnly",
    type: "DateOnly",
    equal: true,
    ordered: true,
    first: "2026-10-15",
    second: "2026-10-16",
  },
  {
    name: "LocalTime",
    type: "LocalTime",
    equal: true,
    ordered: true,
    first: "12:00",
    second: "12:01",
  },
  {
    name: "Duration",
    type: "Duration",
    equal: true,
    ordered: true,
    first: 60,
    second: 61,
  },
  {
    name: "List Number",
    type: listType("Number"),
    equal: true,
    ordered: false,
    first: [1, 2],
    second: [2, 1],
  },
  {
    name: "Nested List",
    type: listType(listType("PlainText")),
    equal: true,
    ordered: false,
    first: [["a"], ["b"]],
    second: [["b"], ["a"]],
  },
  {
    name: "Record key",
    type: { kind: "Record", schemaId: "fixture.value-key.v1" },
    equal: true,
    ordered: false,
    first: { key: 1, label: "A" },
    second: { key: 2, label: "A" },
  },
  {
    name: "Record structure",
    type: { kind: "Record", schemaId: "fixture.value-structure.v1" },
    equal: true,
    ordered: false,
    first: { numbers: [1, 2], label: "A" },
    second: { numbers: [2, 1], label: "A" },
  },
  {
    name: "Record without descriptor",
    type: { kind: "Record", schemaId: "fixture.value-unregistered.v1" },
    equal: false,
    ordered: false,
  },
  {
    name: "List of unregistered Record",
    type: listType({
      kind: "Record",
      schemaId: "fixture.value-unregistered.v1",
    }),
    equal: false,
    ordered: false,
  },
  {
    name: "Optional",
    type: { kind: "Optional", value: "Number" },
    equal: false,
    ordered: false,
  },
  {
    name: "ParseResult",
    type: { kind: "ParseResult", value: "Number" },
    equal: false,
    ordered: false,
  },
  {
    name: "FindResult",
    type: searchResultType("Number"),
    equal: false,
    ordered: false,
  },
  { name: "IndexResult", type: indexResultType, equal: false, ordered: false },
  {
    name: "ConditionResult",
    type: "ConditionResult",
    equal: false,
    ordered: false,
  },
  {
    name: "OperationOutcome",
    type: { kind: "OperationOutcome", value: "Number" },
    equal: false,
    ordered: false,
  },
];
const comparisonOperators = [
  "compare.equal",
  "compare.notEqual",
  "compare.less",
  "compare.lessOrEqual",
  "compare.greater",
  "compare.greaterOrEqual",
] as const;

describe("S031/S034 comparison matrix for the provided schema", () => {
  // Choice ordinal registration and alternate calendar/precision schemas are not
  // provided. Their absence remains an applicability limitation, not a pass.
  it.each(matrix)(
    "$name: server/UI candidate decisions and runtime values",
    (row) => {
      const source = variable("matrix.value", row.type);
      const variables = {
        "matrix.value": {
          type: row.type,
          value: row.first ?? null,
          provenance: [],
        },
      };
      const cards = expressionCardsFor("Boolean", {
        semanticProfile: "scratch.v1",
        variables: [
          { id: "matrix.value", name: "Matrix value", type: row.type },
        ],
        recordSchemas,
      });
      for (const operator of comparisonOperators) {
        const allowed =
          operator === "compare.equal" || operator === "compare.notEqual"
            ? row.equal
            : row.ordered;
        const input = compare(operator, source, source);
        const validate = () =>
          validateValueInput(input, { ...context, variables, recordSchemas });
        if (allowed) expect(validate, operator).not.toThrow();
        else expect(validate, operator).toThrow();
        expect(
          cards.some(
            (card) =>
              card.operator === operator &&
              card.inputs.every((input) => typeEquals(input.type, row.type)),
          ),
          operator,
        ).toBe(allowed);
        if (allowed) {
          expect(run(input, { variables, recordSchemas }), operator).toBe(
            !["compare.notEqual", "compare.less", "compare.greater"].includes(
              operator,
            ),
          );
          const other = literal(row.type, row.second!);
          expect(
            run(compare(operator, source, other), { variables, recordSchemas }),
            operator,
          ).toBe(
            [
              "compare.notEqual",
              "compare.less",
              "compare.lessOrEqual",
            ].includes(operator),
          );
        }
      }
    },
  );
  it("S031: every distinct represented matrix type rejects all six mixed-type operators", () => {
    const allowed = matrix.filter((row) => row.equal);
    for (const left of allowed)
      for (const right of allowed) {
        if (typeEquals(left.type, right.type)) continue;
        for (const operator of comparisonOperators) {
          const input = compare(
            operator,
            { kind: "missing", type: left.type },
            { kind: "missing", type: right.type },
          );
          expect(() =>
            validateValueInput(input, { ...context, recordSchemas }),
          ).toThrowError(expect.objectContaining({ code: "TYPE" }));
        }
      }
  });
  it("S032: refs with a shared synthetic display label retain stable identity and scope", () => {
    const displayNames = {
      "888111111111111111": "Same name",
      "888222222222222222": "Same name",
    };
    expect(new Set(Object.values(displayNames)).size).toBe(1);
    for (const type of refTypes) {
      const first = literal(type, {
        id: "888111111111111111",
        guildId: context.guildId,
      });
      const second = literal(type, {
        id: "888222222222222222",
        guildId: context.guildId,
      });
      expect(run(compare("compare.equal", first, second))).toBe(false);
      rejected(
        compare(
          "compare.equal",
          first,
          literal(type, {
            id: "888111111111111111",
            guildId: "999000000000000000",
          }),
        ),
        "REFERENCE_SCOPE",
      );
    }
  });
  it("S033: structural Record equality uses listed nested fields and list order", () => {
    const type: ValueType = {
      kind: "Record",
      schemaId: "fixture.value-structure.v1",
    };
    const first = literal(type, { numbers: [1, 2], label: "A" });
    expect(
      run(
        compare(
          "compare.equal",
          first,
          literal(type, { label: "A", numbers: [1, 2] }),
        ),
        { recordSchemas },
      ),
    ).toBe(true);
    expect(
      run(
        compare(
          "compare.equal",
          first,
          literal(type, { numbers: [1, 2], label: "B" }),
        ),
        { recordSchemas },
      ),
    ).toBe(false);
    const keyType: ValueType = {
      kind: "Record",
      schemaId: "fixture.value-key.v1",
    };
    expect(
      run(
        compare(
          "compare.equal",
          literal(keyType, { key: 1, label: "A" }),
          literal(keyType, { key: 1, label: "B" }),
        ),
        { recordSchemas },
      ),
    ).toBe(true);
  });
});

describe("T045-T049/S035 evaluator truth tables", () => {
  const rows: [
    ConditionResult,
    ConditionResult,
    ConditionResult,
    ConditionResult,
  ][] = [
    ["true", "true", "true", "true"],
    ["true", "false", "false", "true"],
    ["true", "unknown", "unknown", "true"],
    ["false", "true", "false", "true"],
    ["false", "false", "false", "false"],
    ["false", "unknown", "false", "unknown"],
    ["unknown", "true", "unknown", "true"],
    ["unknown", "false", "false", "unknown"],
    ["unknown", "unknown", "unknown", "unknown"],
  ];
  it.each(rows)(
    "T047-T049: C(%s,%s) has explicit AND=%s OR=%s",
    (left, right, and, or) => {
      expect(
        run(exp("ConditionResult", "condition.and", [c(left), c(right)])),
      ).toBe(and);
      expect(
        run(exp("ConditionResult", "condition.or", [c(left), c(right)])),
      ).toBe(or);
    },
  );
  it("T045/T046/T049: runtime divisor zero is skipped only by the specified short circuit", () => {
    const risky = compare(
      "compare.greater",
      exp("Number", "number.divide", [n(1), variable("d", "Number")]),
      n(0),
    );
    const extra = {
      variables: { d: { type: "Number" as const, value: 0, provenance: [] } },
    };
    expect(run(exp("Boolean", "condition.and", [b(false), risky]), extra)).toBe(
      false,
    );
    expect(run(exp("Boolean", "condition.or", [b(true), risky]), extra)).toBe(
      true,
    );
    rejected(
      exp("Boolean", "condition.and", [b(true), risky]),
      "DIVIDE_BY_ZERO",
      extra,
    );
    rejected(
      exp("ConditionResult", "condition.and", [
        c("unknown"),
        exp("ConditionResult", "condition.fromBoolean", [risky]),
      ]),
      "DIVIDE_BY_ZERO",
      extra,
    );
    expect(run(exp("ConditionResult", "condition.not", [c("unknown")]))).toBe(
      "unknown",
    );
  });
  it.each([
    "list.filter",
    "list.any",
    "list.all",
    "list.find",
    "list.findResult",
    "list.search",
  ] as const)(
    "S035: %s rejects ConditionResult even for empty input",
    (operator) => {
      const type =
        operator === "list.filter"
          ? listType("Number")
          : operator === "list.any" || operator === "list.all"
            ? "Boolean"
            : operator === "list.search"
              ? searchResultType("Number")
              : {
                  kind: "Optional" as const,
                  value:
                    operator === "list.findResult"
                      ? findMatchType("Number")
                      : ("Number" as const),
                };
      rejected(
        exp(type, operator, [items([])], {
          bindingId: "item",
          body: c("unknown"),
        }),
        "TYPE",
      );
    },
  );
});

describe("T053/T054/T059/T060/T063-T066/S044/S045/S047 text examples", () => {
  it("T054: numeric and Ref inputs cannot be joined without explicit formatting", () => {
    for (const input of [
      n(3),
      literal("ChannelRef", {
        id: "888111111111111111",
        guildId: context.guildId,
      }),
    ])
      rejected(exp("PlainText", "text.join", [input, t("x")]), "TYPE");
  });
  it("T059/T060: strict case and normalization differ only after explicit transforms", () => {
    expect(run(exp("Boolean", "text.contains", [t("ABC"), t("a")]))).toBe(
      false,
    );
    expect(run(exp("Boolean", "text.contains", [t("ABC"), t("")]))).toBe(true);
    expect(
      run(
        exp("Boolean", "text.contains", [
          exp("PlainText", "text.caseFold", [t("ABC")]),
          t("a"),
        ]),
      ),
    ).toBe(true);
    expect(run(compare("compare.equal", t("é"), t("e\u0301")))).toBe(false);
    const normalized = (value: string) =>
      exp("PlainText", "text.normalize", [t(value)], { normalization: "NFC" });
    expect(
      run(compare("compare.equal", normalized("é"), normalized("e\u0301"))),
    ).toBe(true);
  });
  it.each([true, false])(
    "T063/T064: explicit keepEmpty=%s covers consecutive, leading/trailing and empty input",
    (keepEmpty) => {
      const split = (value: string, separator = ",") =>
        exp(listType("PlainText"), "text.split", [t(value), t(separator)], {
          keepEmpty,
        });
      expect(run(split("a,,b"))).toEqual(
        keepEmpty ? ["a", "", "b"] : ["a", "b"],
      );
      expect(run(split(",a,,b,"))).toEqual(
        keepEmpty ? ["", "a", "", "b", ""] : ["a", "b"],
      );
      expect(run(split(""))).toEqual(keepEmpty ? [""] : []);
      rejected(split("abc", ""), "EMPTY_SEPARATOR");
    },
  );
  it("S044: combining mark uses scalar Contains/Replace/Split but EGC-bounded Find", () => {
    const source = t("e\u0301");
    expect(run(exp("Number", "text.length", [source]))).toBe(1);
    expect(run(exp("Boolean", "text.contains", [source, t("\u0301")]))).toBe(
      true,
    );
    expect(
      run(exp(indexResultType, "text.find", [source, t("\u0301")])),
    ).toEqual({ state: "not_found" });
    expect(
      run(
        exp("PlainText", "text.replace", [source, t("\u0301"), t("")], {
          replaceMode: "all",
        }),
      ),
    ).toBe("e");
    expect(
      run(
        exp(listType("PlainText"), "text.split", [source, t("\u0301")], {
          keepEmpty: true,
        }),
      ),
    ).toEqual(["e", ""]);
    expect(run(exp("Boolean", "text.startsWith", [source, t("e")]))).toBe(true);
    expect(run(exp("Boolean", "text.endsWith", [source, t("\u0301")]))).toBe(
      true,
    );
  });
  it("S045: joining and repeating resegment combining/ZWJ boundaries", () => {
    for (const input of [
      exp("PlainText", "text.join", [t("e"), t("\u0301")]),
      exp("PlainText", "text.joinList", [
        items(["👨", "👩", "👧", "👦"], "PlainText"),
        t("\u200d"),
      ]),
    ])
      expect(run(exp("Number", "text.length", [input]))).toBe(1);
    const repeated = exp("PlainText", "text.repeat", [t("\u0301e"), n(2)]);
    expect(run(repeated)).toBe("\u0301e\u0301e");
    expect(run(exp("Number", "text.length", [repeated]))).toBe(3);
    expect(
      run(
        exp("Number", "text.length", [
          exp("PlainText", "text.repeat", [t("👩\u200d"), n(2)]),
        ]),
      ),
    ).toBe(1);
  });
  it("S047: replacement is literal, left-to-right, non-overlapping, and does not rescan results", () => {
    const replace = (
      source: string,
      sought: string,
      replacement: string,
      replaceMode: "first" | "all",
    ) =>
      exp("PlainText", "text.replace", [t(source), t(sought), t(replacement)], {
        replaceMode,
      });
    expect(run(replace("aaaa", "aa", "b", "all"))).toBe("bb");
    expect(run(replace("aaaa", "aa", "b", "first"))).toBe("baa");
    expect(run(replace("aa", "a", "$&\\$1", "all"))).toBe("$&\\$1$&\\$1");
    expect(run(replace("a", "a", "aa", "all"))).toBe("aa");
    rejected(replace("abc", "", "x", "all"), "EMPTY_SEARCH");
  });
  it("T065 PARTIAL value-reader boundary: JSON round-trip preserves invalid scalars for rejection", () => {
    for (const value of ["\ud800", "\udfff", "\udc00\ud800", "a\ud800b"])
      rejected(
        JSON.parse(JSON.stringify(t(value))) as ValueInput,
        "InvalidUnicodeScalarText",
      );
  });
  it("T066 PARTIAL value-byte boundary: one EGC does not bypass the independent byte limit", () => {
    const source = "e" + "\u0301".repeat(40);
    expect(run(exp("Number", "text.length", [t(source)]))).toBe(1);
    rejected(t(source), "VALUE_BYTES", {
      limits: { maxTextLength: 100, maxValueBytes: 64 },
    });
  });
});

interface ConcreteCase {
  id: string;
  operator: Expression["operator"];
  input: ValueInput;
  expected: JsonValue;
}
const texts = listType("PlainText"),
  numbers = listType("Number");
const item = variable("item", "Number");
const positive = compare("compare.greater", item, n(1));
const predicate = { bindingId: "item", body: positive };
const concrete: ConcreteCase[] = [
  {
    id: "D6.T01/T053",
    operator: "text.join",
    input: exp("PlainText", "text.join", [t(""), t("abc")]),
    expected: "abc",
  },
  {
    id: "D6.T02",
    operator: "text.length",
    input: exp("Number", "text.length", [t("A😀e\u0301")]),
    expected: 3,
  },
  {
    id: "D6.T03",
    operator: "text.contains",
    input: exp("Boolean", "text.contains", [t("abc"), t("b")]),
    expected: true,
  },
  {
    id: "D6.T04.prefix",
    operator: "text.startsWith",
    input: exp("Boolean", "text.startsWith", [t("abc"), t("ab")]),
    expected: true,
  },
  {
    id: "D6.T04.suffix",
    operator: "text.endsWith",
    input: exp("Boolean", "text.endsWith", [t("abc"), t("bc")]),
    expected: true,
  },
  {
    id: "D6.T05",
    operator: "text.slice",
    input: exp("PlainText", "text.slice", [t("A😀e\u0301"), n(2), n(2)]),
    expected: "😀e\u0301",
  },
  {
    id: "D6.T06",
    operator: "text.replace",
    input: exp("PlainText", "text.replace", [t("ab-ab"), t("ab"), t("x")], {
      replaceMode: "all",
    }),
    expected: "x-x",
  },
  {
    id: "D6.T07",
    operator: "text.split",
    input: exp(texts, "text.split", [t("a,b"), t(",")], { keepEmpty: true }),
    expected: ["a", "b"],
  },
  {
    id: "D6.T08",
    operator: "text.joinList",
    input: exp("PlainText", "text.joinList", [
      items(["a", "b"], "PlainText"),
      t(" / "),
    ]),
    expected: "a / b",
  },
  {
    id: "D6.T08.empty/T053",
    operator: "text.joinList",
    input: exp("PlainText", "text.joinList", [items([], "PlainText"), t(",")]),
    expected: "",
  },
  {
    id: "D6.T09.trim",
    operator: "text.clean",
    input: exp("PlainText", "text.clean", [
      t("\u0085 A \u0085"),
      literal(TEXT_CLEAN_MODE_TYPE, "trim"),
    ]),
    expected: "A",
  },
  {
    id: "D6.T09.lineFeed",
    operator: "text.clean",
    input: exp("PlainText", "text.clean", [
      t("a\r\nb\rc\n"),
      literal(TEXT_CLEAN_MODE_TYPE, "lineFeed"),
    ]),
    expected: "a\nb\nc\n",
  },
  {
    id: "D6.T09.horizontalSpaces",
    operator: "text.clean",
    input: exp("PlainText", "text.clean", [
      t("a\t \u00a0\u3000b"),
      literal(TEXT_CLEAN_MODE_TYPE, "horizontalSpaces"),
    ]),
    expected: "a b",
  },
  {
    id: "D6.T09.blankLines",
    operator: "text.clean",
    input: exp("PlainText", "text.clean", [
      t("a\n\n \n\n\nb"),
      literal(TEXT_CLEAN_MODE_TYPE, "blankLines"),
    ]),
    expected: "a\n\nb",
  },
  {
    id: "D6.T10",
    operator: "text.repeat",
    input: exp("PlainText", "text.repeat", [t("ab"), n(3)]),
    expected: "ababab",
  },
  {
    id: "D6.L01",
    operator: "list.build",
    input: exp(numbers, "list.build", [n(1), n(2)]),
    expected: [1, 2],
  },
  {
    id: "D6.L02/T074",
    operator: "list.append",
    input: exp(numbers, "list.append", [items([1, 2]), n(3)]),
    expected: [1, 2, 3],
  },
  {
    id: "D6.L03/T076",
    operator: "list.remove",
    input: exp(texts, "list.remove", [items(["a", "b"], "PlainText"), n(1)]),
    expected: ["b"],
  },
  {
    id: "D6.L04/T075",
    operator: "list.insert",
    input: exp(texts, "list.insert", [
      items(["a", "b"], "PlainText"),
      n(3),
      t("c"),
    ]),
    expected: ["a", "b", "c"],
  },
  {
    id: "D6.L05/T076",
    operator: "list.replace",
    input: exp(texts, "list.replace", [
      items(["a", "b"], "PlainText"),
      n(2),
      t("c"),
    ]),
    expected: ["a", "c"],
  },
  {
    id: "D6.L06",
    operator: "list.item",
    input: exp("PlainText", "list.item", [
      items(["a", "b"], "PlainText"),
      n(2),
    ]),
    expected: "b",
  },
  {
    id: "D6.L07",
    operator: "list.length",
    input: exp("Number", "list.length", [items([1, 2])]),
    expected: 2,
  },
  {
    id: "D6.L08",
    operator: "list.findResult",
    input: exp(
      { kind: "Optional", value: findMatchType("Number") },
      "list.findResult",
      [items([1, 3, 2, 4])],
      predicate,
    ),
    expected: { state: "set", value: { item: 3, position: 2 } },
  },
  {
    id: "D6.L09",
    operator: "list.slice",
    input: exp(numbers, "list.slice", [items([1, 2, 3, 4]), n(2), n(2)]),
    expected: [2, 3],
  },
  {
    id: "D6.L10",
    operator: "list.concat",
    input: exp(numbers, "list.concat", [items([1, 2]), items([3, 4])]),
    expected: [1, 2, 3, 4],
  },
  {
    id: "D6.L11",
    operator: "list.unique",
    input: exp(numbers, "list.unique", [items([3, 1, 3, 2, 1])]),
    expected: [3, 1, 2],
  },
  {
    id: "D6.L12",
    operator: "list.sort",
    input: exp(numbers, "list.sort", [items([3, 1, 2])]),
    expected: [1, 2, 3],
  },
  {
    id: "D6.L13",
    operator: "list.filter",
    input: exp(numbers, "list.filter", [items([1, 3, 2, 0])], predicate),
    expected: [3, 2],
  },
  {
    id: "D6.L14",
    operator: "list.map",
    input: exp(numbers, "list.map", [items([1, 2, 3])], {
      bindingId: "item",
      body: exp("Number", "number.multiply", [item, n(2)]),
    }),
    expected: [2, 4, 6],
  },
  {
    id: "D6.L15",
    operator: "list.sum",
    input: exp("Number", "list.sum", [items([3, 1, 2])]),
    expected: 6,
  },
  {
    id: "D6.L16",
    operator: "list.average",
    input: exp({ kind: "Record", schemaId: "AverageValue" }, "list.average", [
      items([3, 1, 2]),
    ]),
    expected: { value: { state: "set", value: 2 }, count: 3 },
  },
  {
    id: "D6.L17",
    operator: "list.minMax",
    input: exp({ kind: "Record", schemaId: "MinMaxValue" }, "list.minMax", [
      items([3, 1, 2]),
    ]),
    expected: {
      minimum: { state: "set", value: 1 },
      maximum: { state: "set", value: 3 },
    },
  },
  {
    id: "D6.L18",
    operator: "list.group",
    input: exp(
      listType(groupRecordType("PlainText", "PlainText")),
      "list.group",
      [items(["b", "a", "b", "c", "a"], "PlainText")],
    ),
    expected: [
      { key: "b", items: ["b", "b"] },
      { key: "a", items: ["a", "a"] },
      { key: "c", items: ["c"] },
    ],
  },
  {
    id: "D6.L19",
    operator: "list.intersection",
    input: exp(numbers, "list.intersection", [
      items([3, 1, 3, 2]),
      items([1, 3]),
    ]),
    expected: [3, 1],
  },
  {
    id: "D6.L20",
    operator: "list.difference",
    input: exp(numbers, "list.difference", [
      items([3, 1, 3, 2]),
      items([1, 3]),
    ]),
    expected: [2],
  },
  {
    id: "D6.L21",
    operator: "list.union",
    input: exp(numbers, "list.union", [items([3, 1, 3]), items([1, 2])]),
    expected: [3, 1, 2],
  },
  {
    id: "D6.L22",
    operator: "list.zip",
    input: exp(
      listType(registeredPairType("Number", "PlainText")!),
      "list.zip",
      [items([1, 2]), items(["a", "b"], "PlainText")],
    ),
    expected: [
      { first: 1, second: "a" },
      { first: 2, second: "b" },
    ],
  },
  {
    id: "D6.L23",
    operator: "list.chunk",
    input: exp(listType(numbers), "list.chunk", [items([1, 2, 3, 4, 5]), n(2)]),
    expected: [[1, 2], [3, 4], [5]],
  },
  {
    id: "D6.L24",
    operator: "list.any",
    input: exp("Boolean", "list.any", [items([0, 2, 1])], predicate),
    expected: true,
  },
  {
    id: "D6.L25",
    operator: "list.all",
    input: exp("Boolean", "list.all", [items([2, 3, 4])], predicate),
    expected: true,
  },
];

describe("S056: D6 T01-T10/L01-L25 concrete expression forms", () => {
  it.each(concrete)("$id via $operator", ({ input, expected }) => {
    const before = structuredClone(input);
    expect(run(input)).toEqual(expected);
    expect(input).toEqual(before);
  });
});

describe("T073-T079/T081-T083 list edge expectations", () => {
  it("T073/T074: append is typed and immutable until an explicit assignment", () => {
    const value: EvaluatedValue = {
      type: numbers,
      value: [1, 2],
      provenance: [],
    };
    const extra = { variables: { source: value } };
    const source = variable("source", numbers);
    rejected(exp(numbers, "list.append", [source, t("3")]), "TYPE", extra);
    const appended = evaluateValue(
      exp(numbers, "list.append", [source, n(3)]),
      { ...context, ...extra },
    );
    expect(appended.value).toEqual([1, 2, 3]);
    expect(run(source, extra)).toEqual([1, 2]);
    // Model the evaluator's explicit caller-owned assignment boundary only;
    // transactional Run assignment/restart is covered by the DB suite.
    extra.variables.source = appended;
    expect(run(source, extra)).toEqual([1, 2, 3]);
  });
  it("T075/T076: empty insert and typed clear retain the declared element type", () => {
    expect(
      run(exp(texts, "list.insert", [items([], "PlainText"), n(1), t("x")])),
    ).toEqual(["x"]);
    rejected(
      exp(texts, "list.insert", [items(["a", "b"], "PlainText"), n(4), t("c")]),
      "COUNT",
    );
    const cleared = evaluateValue(
      exp(texts, "list.clear", [items(["a", "b"], "PlainText")]),
      context,
    );
    expect(cleared).toMatchObject({ type: texts, value: [] });
  });
  it("T077: no clamping, empty fallback, or fractional indices", () => {
    for (const input of [
      exp(texts, "list.remove", [items([], "PlainText"), n(1)]),
      exp(texts, "list.replace", [items(["a"], "PlainText"), n(0), t("b")]),
      exp("PlainText", "list.item", [items(["a"], "PlainText"), n(2)]),
      exp("PlainText", "list.item", [items(["a", "b"], "PlainText"), n(1.5)]),
    ])
      rejected(input, "COUNT");
  });
  it("T078: exact requested first index, not-found, and empty membership results", () => {
    expect(
      run(
        exp(indexResultType, "list.indexOf", [
          items(["a", "b", "a"], "PlainText"),
          t("a"),
        ]),
      ),
    ).toEqual({ state: "found", index: 1 });
    expect(
      run(
        exp(indexResultType, "list.indexOf", [
          items(["a", "b"], "PlainText"),
          t("c"),
        ]),
      ),
    ).toEqual({ state: "not_found" });
    expect(
      run(exp("Boolean", "list.contains", [items([], "PlainText"), t("a")])),
    ).toBe(false);
  });
  it.each(["random", "last", "all"])(
    "T079: %s text is refused in a numeric index socket",
    (index) => {
      rejected(
        exp("PlainText", "list.item", [items(["a"], "PlainText"), t(index)]),
        "TYPE",
      );
    },
  );
  it("T081: empty aggregations preserve typed absence and vacuous truth", () => {
    expect(run(exp("Number", "list.sum", [items([])]))).toBe(0);
    expect(
      run(
        exp({ kind: "Record", schemaId: "AverageValue" }, "list.average", [
          items([]),
        ]),
      ),
    ).toEqual({ value: { state: "unset" }, count: 0 });
    for (const operator of ["list.min", "list.max"] as const)
      expect(
        run(exp({ kind: "Optional", value: "Number" }, operator, [items([])])),
      ).toEqual({ state: "unset" });
    expect(
      run(
        exp({ kind: "Record", schemaId: "MinMaxValue" }, "list.minMax", [
          items([]),
        ]),
      ),
    ).toEqual({ minimum: { state: "unset" }, maximum: { state: "unset" } });
    expect(run(exp("Boolean", "list.any", [items([])], predicate))).toBe(false);
    expect(run(exp("Boolean", "list.all", [items([])], predicate))).toBe(true);
    expect(
      run(
        exp(searchResultType("Number"), "list.search", [items([])], predicate),
      ),
    ).toEqual({ state: "not_found" });
  });
  it("T082: zip mismatch/chunk zero reject, and equal sort keys keep input order", () => {
    rejected(
      exp(listType(registeredPairType("Number", "PlainText")!), "list.zip", [
        items([1, 2]),
        items(["a"], "PlainText"),
      ]),
      "ZIP_LENGTH",
    );
    rejected(
      exp(listType(numbers), "list.chunk", [items([1, 2]), n(0)]),
      "COUNT",
    );
    const type: ValueType = {
      kind: "Record",
      schemaId: "fixture.value-key.v1",
    };
    const values = [
      { key: 2, label: "A" },
      { key: 1, label: "B" },
      { key: 2, label: "C" },
      { key: 1, label: "D" },
    ];
    expect(
      run(
        exp(listType(type), "list.sort", [items(values, type)], { key: "key" }),
        { recordSchemas },
      ),
    ).toEqual([values[1], values[3], values[0], values[2]]);
    expect(
      run(
        exp(listType(type), "list.sort", [items(values, type)], {
          key: "key",
          descending: true,
        }),
        { recordSchemas },
      ),
    ).toEqual([values[0], values[2], values[1], values[3]]);
  });
  it("T083: dedupe keeps distinct MemberRef IDs despite a shared display label", () => {
    const first = { id: "888111111111111111", guildId: context.guildId },
      second = { id: "888222222222222222", guildId: context.guildId };
    const labels = { [first.id]: "Member", [second.id]: "Member" };
    expect(labels[first.id]).toBe(labels[second.id]);
    expect(
      run(
        exp(listType("MemberRef"), "list.unique", [
          items([first, second, first], "MemberRef"),
        ]),
      ),
    ).toEqual([first, second]);
  });
  it("S056: slice/concat retain type and provenance, including empty boundaries", () => {
    expect(run(exp(numbers, "list.slice", [items([]), n(1), n(0)]))).toEqual(
      [],
    );
    expect(
      run(exp(numbers, "list.slice", [items([1, 2]), n(3), n(0)])),
    ).toEqual([]);
    rejected(
      exp(numbers, "list.slice", [items([1, 2]), n(2), n(2)]),
      "LIST_RANGE",
    );
    rejected(
      exp(numbers, "list.concat", [items([]), items([], "PlainText")]),
      "TYPE",
    );
    const provenance = [
      {
        source: "input" as const,
        guildId: context.guildId,
        allowedChannelIds: ["888111111111111111"],
        resumable: true,
      },
    ];
    const source: EvaluatedValue = { type: numbers, value: [], provenance };
    const result = evaluateValue(
      exp(numbers, "list.concat", [variable("source", numbers), items([1])]),
      { ...context, variables: { source } },
    );
    expect(result.type).toEqual(numbers);
    expect(result.value).toEqual([1]);
    expect(result.provenance).toContainEqual(provenance[0]);
    expect(source.value).toEqual([]);
  });
  it("S056: keyed grouping keeps first-key order, member order, and a trailing chunk", () => {
    const type: ValueType = {
      kind: "Record",
      schemaId: "fixture.value-key.v1",
    };
    const first = { key: 2, label: "A" },
      second = { key: 1, label: "B" },
      third = { key: 2, label: "C" };
    expect(
      run(
        exp(
          listType(groupRecordType("Number", type)),
          "list.group",
          [items([first, second, third], type)],
          { key: "key" },
        ),
        { recordSchemas },
      ),
    ).toEqual([
      { key: 2, items: [first, third] },
      { key: 1, items: [second] },
    ]);
    expect(
      run(exp(listType(numbers), "list.chunk", [items([]), n(2)])),
    ).toEqual([]);
    expect(
      run(exp(listType(numbers), "list.chunk", [items([1, 2]), n(3)])),
    ).toEqual([[1, 2]]);
    expect(
      run(
        exp(listType(registeredPairType("Number", "PlainText")!), "list.zip", [
          items([]),
          items([], "PlainText"),
        ]),
      ),
    ).toEqual([]);
  });
  it("S056: first-match search short-circuits and predicate failure is never not_found", () => {
    const risky = compare(
      "compare.greater",
      exp("Number", "number.divide", [
        n(1),
        exp("Number", "number.subtract", [item, n(1)]),
      ]),
      n(0),
    );
    expect(
      run(
        exp(searchResultType("Number"), "list.search", [items([2, 1])], {
          bindingId: "item",
          body: risky,
        }),
      ),
    ).toEqual({ state: "found", value: 2, index: 1 });
    rejected(
      exp(searchResultType("Number"), "list.search", [items([1, 2])], {
        bindingId: "item",
        body: risky,
      }),
      "DIVIDE_BY_ZERO",
    );
  });
  it("S036: counts reject fractional/negative/unsafe values from literals, variables, expressions, and pure calls", () => {
    for (const value of [2.5, -1, 2 ** 53]) {
      const extra: Partial<EvaluationContext> = {
        variables: { count: { type: "Number", value, provenance: [] } },
        pureDefinitions: [
          {
            id: "count.identity",
            name: "Identity",
            revision: 1,
            inputs: [{ id: "parameter", name: "Parameter", type: "Number" }],
            outputType: "Number",
            value: variable("parameter", "Number"),
          },
        ],
      };
      const sources = [
        n(value),
        variable("count", "Number"),
        exp("Number", "number.add", [n(value), n(0)]),
        exp("Number", "pure.call", [n(value)], {
          definitionId: "count.identity",
          revision: 1,
        }),
      ];
      for (const count of sources) {
        rejected(
          exp("PlainText", "text.repeat", [t("x"), count]),
          "COUNT",
          extra,
        );
        rejected(
          exp(listType(numbers), "list.chunk", [items([1, 2]), count]),
          "COUNT",
          extra,
        );
        rejected(
          exp("Number", "list.item", [items([1, 2, 3]), count]),
          "COUNT",
          extra,
        );
      }
    }
  });
});
