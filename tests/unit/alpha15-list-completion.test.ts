import { describe, expect, it } from "vitest";
import {
  evaluateValue,
  typeEquals,
  validateValueInput,
} from "../../packages/automation/src/expression";
import {
  expressionCardsFor,
  instantiateExpressionCard,
  expressionBodyBindings,
  supportsFixedMappingKeyEditor,
} from "../../packages/automation/src/expression-cards";
import { registeredPairType } from "../../packages/automation/src/registered-pairs";
import { validateFlowDefinition } from "../../packages/automation/src/definition";
import {
  findMatchType,
  groupRecordType,
} from "../../packages/automation/src/structured-values";
import type {
  EvaluationContext,
  ExpressionOperator,
  JsonValue,
  ValueInput,
  ValueType,
} from "../../packages/automation/src/types";

const guildId = "811111111111111111",
  channel = "822222222222222222";
const env: EvaluationContext = { guildId, variables: {} };
const literal = (type: ValueType, value: JsonValue): ValueInput => ({
  kind: "literal",
  type,
  value,
});
const list = (type: ValueType, value: JsonValue[]): ValueInput =>
  literal({ kind: "List", element: type }, value);
const expression = (
  operator: ExpressionOperator,
  type: ValueType,
  args: ValueInput[],
  options?: Extract<
    ValueInput,
    { kind: "expression" }
  >["expression"]["options"],
): ValueInput => ({
  kind: "expression",
  type,
  expression: { operator, args, ...(options ? { options } : {}) },
});
const ticket: ValueType = {
  kind: "Record",
  schemaId: "nexus.ticket.status.v1",
};
const state: ValueType = {
  kind: "Enum",
  values: [
    "OPEN",
    "ACKNOWLEDGED",
    "IN_PROGRESS",
    "SNOOZED",
    "RESOLVED",
    "DISMISSED",
  ],
};

describe("approved alpha15 finite list completion", () => {
  it("rejects excessive generic type depth even when the value is still missing", () => {
    let type: ValueType = "Number";
    for (let depth = 0; depth < 10; depth++)
      type = registeredPairType(type, "Number")!;
    const result = validateFlowDefinition({
      schemaVersion: 1,
      id: "deep-pair",
      guildId,
      name: "Deep pair",
      trigger: { kind: "manual", inputs: [] },
      variables: [],
      body: [
        {
          id: "value",
          kind: "declare",
          variable: { id: "value", name: "Value", type },
          value: { kind: "missing", type },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.code === "TYPE_DEPTH")).toBe(
      true,
    );
    expect(expressionCardsFor(type)).toEqual([]);
  });
  it("groups by a registered key in first-key order while keeping source order and provenance", () => {
    const type = { kind: "List" as const, element: ticket };
    const source = {
      type,
      value: [
        { state: "OPEN", version: 3 },
        { state: "RESOLVED", version: 4 },
        { state: "OPEN", version: 1 },
      ],
      provenance: [
        { source: "service" as const, guildId, allowedChannelIds: [channel] },
      ],
    };
    const input = expression(
      "list.group",
      { kind: "List", element: groupRecordType(state, ticket) },
      [{ kind: "variable", type, variableId: "tickets" }],
      { key: "state" },
    );
    const result = evaluateValue(input, {
      ...env,
      variables: { tickets: source },
    });
    expect(result.value).toEqual([
      { key: "OPEN", items: [source.value[0], source.value[2]] },
      { key: "RESOLVED", items: [source.value[1]] },
    ]);
    expect(result.provenance).toEqual(
      expect.arrayContaining(source.provenance),
    );
    expect(() =>
      evaluateValue(
        {
          ...input,
          expression: {
            ...(input as Extract<ValueInput, { kind: "expression" }>)
              .expression,
            options: { key: "__proto__" },
          },
        } as ValueInput,
        { ...env, variables: { tickets: source } },
      ),
    ).toThrowError(expect.objectContaining({ code: "COMPARISON_KEY" }));
  });

  it("fails on a missing grouping key rather than merging it with an empty value", () => {
    const item: ValueType = { kind: "Record", schemaId: "OptionalKey" };
    const context: EvaluationContext = {
      ...env,
      recordSchemas: {
        OptionalKey: {
          userConstructible: true,
          fields: {
            key: { type: "PlainText", optional: true },
            value: { type: "Number" },
          },
        },
      },
    };
    const input = expression(
      "list.group",
      { kind: "List", element: groupRecordType("PlainText", item) },
      [list(item, [{ value: 1 }])],
      { key: "key" },
    );
    expect(() => evaluateValue(input, context)).toThrowError(
      expect.objectContaining({ code: "COMPARISON_KEY" }),
    );
    expect(
      evaluateValue(
        expression(
          "list.group",
          { kind: "List", element: groupRecordType("PlainText", "PlainText") },
          [list("PlainText", ["q", "b", "q"])],
        ),
        env,
      ).value,
    ).toEqual([
      { key: "q", items: ["q", "q"] },
      { key: "b", items: ["b"] },
    ]);
  });

  it("returns an explicit first-match item and one-based position or not-found state", () => {
    const type: ValueType = {
      kind: "Optional",
      value: findMatchType("Number"),
    };
    const input = expression(
      "list.findResult",
      type,
      [list("Number", [1, 3, 3])],
      {
        bindingId: "item",
        body: expression("compare.greater", "Boolean", [
          { kind: "variable", type: "Number", variableId: "item" },
          literal("Number", 2),
        ]),
      },
    );
    expect(evaluateValue(input, env).value).toEqual({
      state: "set",
      value: { item: 3, position: 2 },
    });
    expect(
      evaluateValue(
        expression(
          "list.findResult",
          type,
          [list("Number", [])],
          (input as Extract<ValueInput, { kind: "expression" }>).expression
            .options,
        ),
        env,
      ).value,
    ).toEqual({ state: "unset" });
    expect(() =>
      evaluateValue(
        literal(findMatchType("Number"), { item: 3, position: 0 }),
        env,
      ),
    ).toThrowError(expect.objectContaining({ code: "RECORD_VALUE" }));
  });

  it("returns both numerical extremes with explicit empty Optional values", () => {
    const type: ValueType = { kind: "Record", schemaId: "MinMaxValue" };
    expect(
      evaluateValue(
        expression("list.minMax", type, [list("Number", [10, 30, 20])]),
        env,
      ).value,
    ).toEqual({
      minimum: { state: "set", value: 10 },
      maximum: { state: "set", value: 30 },
    });
    expect(
      evaluateValue(expression("list.minMax", type, [list("Number", [])]), env)
        .value,
    ).toEqual({ minimum: { state: "unset" }, maximum: { state: "unset" } });
  });

  it("zips nested lists, Optional, registered records and message specifications without type erasure", () => {
    const cases: [ValueType, JsonValue][] = [
      [{ kind: "List", element: "Number" }, [1, 2]],
      [{ kind: "Optional", value: "Number" }, { state: "unset" }],
      [
        { kind: "Record", schemaId: "AverageValue" },
        { value: { state: "set", value: 2 }, count: 1 },
      ],
      [
        "DateRange",
        {
          start: "2026-10-15",
          end: "2026-10-16",
          timeZone: "UTC",
          boundaryRule: "firstValidEarlier",
        },
      ],
      [
        "InstantRange",
        { start: "2026-10-15T00:00:00Z", end: "2026-10-16T00:00:00Z" },
      ],
      [
        "ZonedDateTimeSpec",
        {
          date: "2026-10-15",
          time: "09:00",
          timeZone: "UTC",
          instant: "2026-10-15T09:00:00.000Z",
          offset: "+00:00",
        },
      ],
      [
        "LegacyMessageSpec",
        {
          kind: "legacy",
          richText: [{ kind: "text", text: "hello" }],
          embeds: [],
        },
      ],
    ];
    for (const [first, value] of cases) {
      const pair = registeredPairType(first, "PlainText")!;
      expect(
        evaluateValue(
          expression("list.zip", { kind: "List", element: pair }, [
            list(first, [value]),
            list("PlainText", ["next"]),
          ]),
          env,
        ).value,
      ).toEqual([{ first: value, second: "next" }]);
      expect(typeEquals(pair, registeredPairType("Number", "PlainText")!)).toBe(
        false,
      );
    }
  });

  it("allows derived pairs and groups of service records while denying counterfeit literal proofs", () => {
    const sourceType: ValueType = { kind: "List", element: ticket },
      pair = registeredPairType(ticket, "Number")!;
    const context: EvaluationContext = {
      ...env,
      variables: {
        tickets: {
          type: sourceType,
          value: [{ state: "OPEN", version: 1 }],
          provenance: [{ source: "service", guildId, resumable: true }],
        },
      },
      recordSchemas: {
        "nexus.pair.v1": {
          userConstructible: true,
          fields: { forged: { type: "Boolean" } },
        },
        "nexus.ticket.status.v1": {
          userConstructible: true,
          fields: { state: { type: "PlainText" }, version: { type: "Number" } },
        },
      },
    };
    const result = evaluateValue(
      expression("list.zip", { kind: "List", element: pair }, [
        { kind: "variable", type: sourceType, variableId: "tickets" },
        list("Number", [1]),
      ]),
      context,
    );
    expect(result.value).toEqual([
      { first: { state: "OPEN", version: 1 }, second: 1 },
    ]);
    expect(() =>
      evaluateValue(
        literal(pair, { first: { state: "OPEN", version: 1 }, second: 1 }),
        context,
      ),
    ).toThrowError(expect.objectContaining({ code: "SERVICE_VALUE" }));
    expect(() =>
      evaluateValue(literal(ticket, { state: "OPEN", version: 1 }), context),
    ).toThrowError(expect.objectContaining({ code: "SERVICE_VALUE" }));
    expect(() =>
      evaluateValue(
        literal(registeredPairType("MemberRef", "Number")!, {
          first: { id: channel, guildId: "833333333333333333" },
          second: 1,
        }),
        env,
      ),
    ).toThrowError(expect.objectContaining({ code: "REFERENCE_SCOPE" }));
  });

  it("uses a fixed unique mapping with an explicit no-match value and evaluates only the selected row", () => {
    const zero: EvaluationContext = {
      ...env,
      variables: { divisor: { type: "Number", value: 0, provenance: [] } },
    };
    const broken = expression("number.divide", "Number", [
      literal("Number", 1),
      { kind: "variable", type: "Number", variableId: "divisor" },
    ]);
    const selected = expression("value.lookup", "Number", [
      literal("PlainText", "a"),
      list("PlainText", ["a"]),
      broken,
      literal("Number", 7),
    ]);
    expect(evaluateValue(selected, zero).value).toBe(7);
    expect(
      evaluateValue(
        expression("value.lookup", "Number", [
          literal("PlainText", "none"),
          list("PlainText", ["a"]),
          literal("Number", 0),
          broken,
        ]),
        zero,
      ).value,
    ).toBe(0);
    expect(() =>
      evaluateValue(
        expression("value.lookup", "Number", [
          literal("PlainText", "a"),
          list("PlainText", ["a", "a"]),
          literal("Number", 0),
          literal("Number", 1),
          literal("Number", 2),
        ]),
        env,
      ),
    ).toThrowError(expect.objectContaining({ code: "LOOKUP_DUPLICATE" }));
    expect(() =>
      validateValueInput(
        expression("value.lookup", "Number", [
          literal("PlainText", "a"),
          {
            kind: "expression",
            type: { kind: "List", element: "PlainText" },
            expression: {
              operator: "list.build",
              args: [literal("PlainText", "a")],
            },
          },
          literal("Number", 0),
          literal("Number", 1),
        ]),
        env,
      ),
    ).toThrowError(expect.objectContaining({ code: "LOOKUP_FIXED_KEYS" }));
    expect(() =>
      validateValueInput(
        expression("value.lookup", "Number", [
          literal("PlainText", "a"),
          list("PlainText", ["a"]),
          literal("Number", 0),
        ]),
        env,
      ),
    ).toThrowError(expect.objectContaining({ code: "LOOKUP_ROWS" }));
  });

  it("keeps service-only operation evidence through compound pairs and rejects both literal and unissued counterfeit outcomes", () => {
    const outcome: ValueType = { kind: "OperationOutcome", value: "Number" };
    const sourceType: ValueType = { kind: "List", element: outcome };
    const pair = registeredPairType(outcome, "PlainText")!;
    const input = expression("list.zip", { kind: "List", element: pair }, [
      { kind: "variable", type: sourceType, variableId: "results" },
      list("PlainText", ["kept"]),
    ]);
    const source = {
      type: sourceType,
      value: [{ state: "SUCCEEDED", value: 7 }],
      provenance: [
        {
          source: "service" as const,
          guildId,
          evidence: "operation" as const,
          resumable: true,
        },
      ],
    };
    expect(
      evaluateValue(input, { ...env, variables: { results: source } })
        .provenance,
    ).toEqual(expect.arrayContaining(source.provenance));
    expect(() =>
      evaluateValue(
        literal(pair, {
          first: { state: "SUCCEEDED", value: 7 },
          second: "forged",
        }),
        env,
      ),
    ).toThrowError(expect.objectContaining({ code: "RESULT_LITERAL" }));
    expect(() =>
      evaluateValue(input, {
        ...env,
        variables: {
          results: { ...source, provenance: [{ source: "input", guildId }] },
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "RESULT_PROVENANCE" }));
  });

  it("offers typed group/find/minmax/keyed-unique cards and retains lexical readonly bindings", () => {
    const variables = [
      {
        id: "tickets",
        name: "Tickets",
        type: { kind: "List" as const, element: ticket },
      },
    ];
    const output: ValueType = {
      kind: "List",
      element: groupRecordType(state, ticket),
    };
    expect(
      expressionCardsFor(output, { variables }).some(
        (card) =>
          card.operator === "list.group" && card.options?.key === "state",
      ),
    ).toBe(true);
    expect(
      expressionCardsFor({ kind: "List", element: ticket }, { variables }).some(
        (card) =>
          card.operator === "list.unique" && card.options?.key === "state",
      ),
    ).toBe(true);
    const card = expressionCardsFor({
      kind: "Optional",
      value: findMatchType("Number"),
    }).find((card) => card.operator === "list.findResult")!;
    expect(card).toBeDefined();
    expect(
      expressionBodyBindings(instantiateExpressionCard(card, () => "item")),
    ).toMatchObject([{ id: "item", readOnly: true, type: "Number" }]);
    expect(
      expressionCardsFor({ kind: "Record", schemaId: "MinMaxValue" }).some(
        (card) => card.operator === "list.minMax",
      ),
    ).toBe(true);
  });

  it("advertises only authorable fixed keys while preserving the registered Ref wire contract", () => {
    const unsupported: ValueType[] = [
      "MemberRef",
      "ThreadRef",
      "MessageRef",
      "TicketRef",
      "EventRef",
    ];
    const supported: ValueType[] = [
      "Number",
      "PlainText",
      "ChannelRef",
      "RoleRef",
      { kind: "Enum", values: ["first", "second"] },
    ];
    const cards = expressionCardsFor("Number", {
      variables: [...supported, ...unsupported].map((type, index) => ({
        id: `key-${index}`,
        name: `Key ${index}`,
        type,
      })),
    }).filter((card) => card.operator === "value.lookup");
    for (const type of supported) {
      expect(supportsFixedMappingKeyEditor(type)).toBe(true);
      expect(cards.some((card) => typeEquals(card.inputs[0]!.type, type))).toBe(
        true,
      );
    }
    for (const type of unsupported) {
      expect(supportsFixedMappingKeyEditor(type)).toBe(false);
      expect(cards.some((card) => typeEquals(card.inputs[0]!.type, type))).toBe(
        false,
      );
    }
    const member = { guildId, id: channel };
    expect(
      evaluateValue(
        expression("value.lookup", "Number", [
          literal("MemberRef", member),
          list("MemberRef", [member]),
          literal("Number", 0),
          literal("Number", 7),
        ]),
        env,
      ).value,
    ).toBe(7);
  });

  it("charges derived grouping, zip and mapping to the existing shared evaluation budget", () => {
    const grouped = expression(
      "list.group",
      { kind: "List", element: groupRecordType("Number", "Number") },
      [list("Number", [1, 2, 1])],
    );
    expect(() =>
      evaluateValue(grouped, { ...env, limits: { maxEvaluations: 4 } }),
    ).toThrowError(expect.objectContaining({ code: "EVALUATION_BUDGET" }));
    const mapped = expression("value.lookup", "Number", [
      literal("PlainText", "x"),
      list("PlainText", ["a", "b"]),
      literal("Number", 0),
      literal("Number", 1),
      literal("Number", 2),
    ]);
    expect(() =>
      evaluateValue(mapped, { ...env, limits: { maxEvaluations: 4 } }),
    ).toThrowError(expect.objectContaining({ code: "EVALUATION_BUDGET" }));
  });
});
