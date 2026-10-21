import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import {
  cloneExpressionBindings,
  expressionBodyBindings,
  expressionCardsFor,
  EXPRESSION_CARD_LIMITS,
  instantiateExpressionCard,
  type TypedExpressionCard,
} from "../../packages/automation/src/expression-cards";
import {
  evaluateValue,
  typeEquals,
  validateValueInput,
} from "../../packages/automation/src/expression";
import {
  assertValueCanPublish,
  buildDiscordMessage,
  type MessageSpec,
} from "../../packages/automation/src/message";
import type {
  EvaluatedValue,
  ExpressionOperator,
  PureDefinition,
  ValueInput,
  ValueType,
} from "../../packages/automation/src/types";
import {
  registeredPairFields,
  registeredPairType,
} from "../../packages/automation/src/registered-pairs";

const guildId = "811111111111111111";
const requireHere = createRequire(import.meta.url);
const { buildSync } = createRequire(requireHere.resolve("tsx"))("esbuild") as {
  buildSync(input: Record<string, unknown>): {
    outputFiles: { text: string }[];
    errors: unknown[];
  };
};
const env = { guildId, variables: {} };
const number = (value: number): ValueInput => ({
  kind: "literal",
  type: "Number",
  value,
});
const numbers = (value: number[]): ValueInput => ({
  kind: "literal",
  type: { kind: "List", element: "Number" },
  value,
});
const expression = (
  operator: ExpressionOperator,
  type: ValueType,
  args: ValueInput[],
): ValueInput => ({ kind: "expression", type, expression: { operator, args } });
const card = (
  output: ValueType,
  operator: ExpressionOperator,
  firstType?: ValueType,
) => {
  const found = expressionCardsFor(output).find(
    (candidate) =>
      candidate.operator === operator &&
      (!firstType || typeEquals(firstType, candidate.inputs[0]!.type)),
  );
  if (!found) throw new Error("Expected registered typed card");
  return found;
};
function fill(
  selected: TypedExpressionCard,
  args: ValueInput[],
  id = "local_item",
) {
  const result = instantiateExpressionCard(selected, () => id);
  if (result.kind !== "expression") throw new Error("Expected expression");
  result.expression.args = args;
  return result;
}

describe("alpha15 browser-safe typed expression cards", () => {
  it("builds a real typed five-at-a-time expression without entering example values", () => {
    const output: ValueType = {
      kind: "List",
      element: { kind: "List", element: "Number" },
    };
    const selected = card(output, "list.chunk", {
      kind: "List",
      element: "Number",
    });
    const initial = instantiateExpressionCard(selected);
    expect(
      initial.kind === "expression" &&
        initial.expression.args.map((arg) => arg.kind),
    ).toEqual(["missing", "missing"]);
    expect(selected.inputs[1]).toMatchObject({
      type: "Number",
      integer: true,
      minimum: 1,
    });
    const value = fill(selected, [numbers([1, 2, 3, 4, 5, 6]), number(5)]);
    expect(evaluateValue(value, env).value).toEqual([[1, 2, 3, 4, 5], [6]]);
    expect(() =>
      evaluateValue(fill(selected, [numbers([1]), number(0)]), env),
    ).toThrowError(expect.objectContaining({ code: "COUNT" }));
  });
  it("specializes lists for typed references rather than treating every list as Number", () => {
    const type: ValueType = { kind: "List", element: "MemberRef" };
    const selected = card(type, "list.concat", type);
    expect(selected.inputs.map((input) => input.type)).toEqual([type, type]);
    const selectedItem = card("MemberRef", "list.item", type);
    expect(selectedItem.outputType).toBe("MemberRef");
    expect(selectedItem.inputs[1]).toMatchObject({
      integer: true,
      minimum: 1,
      label: { en: "Position (starts at 1)" },
    });
    const members: ValueInput = {
      kind: "literal",
      type,
      value: [{ id: "822222222222222222", guildId }],
    };
    expect(
      evaluateValue(fill(selectedItem, [members, number(1)]), env).value,
    ).toEqual({ id: "822222222222222222", guildId });
  });
  it("zips registered mixed atomic lists without defaults, truncation or scope loss", () => {
    const pair = registeredPairType("Number", "MemberRef")!;
    const output: ValueType = { kind: "List", element: pair };
    const selected = card(output, "list.zip");
    expect(selected.inputs.map((input) => input.type)).toEqual([
      { kind: "List", element: "Number" },
      { kind: "List", element: "MemberRef" },
    ]);
    expect(instantiateExpressionCard(selected)).toMatchObject({
      expression: { args: [{ kind: "missing" }, { kind: "missing" }] },
    });
    const members: ValueType = { kind: "List", element: "MemberRef" };
    const member = { id: "822222222222222222", guildId };
    const scope = {
      source: "service" as const,
      guildId,
      allowedChannelIds: ["833333333333333333"],
    };
    const value = fill(selected, [
      numbers([2, 1]),
      { kind: "variable", type: members, variableId: "members" },
    ]);
    const context = {
      ...env,
      variables: {
        members: {
          type: members,
          value: [member, member],
          provenance: [scope],
        },
      },
    };
    const zipped = evaluateValue(value, context);
    expect(zipped.value).toEqual([
      { first: 2, second: member },
      { first: 1, second: member },
    ]);
    expect(zipped.provenance).toEqual(expect.arrayContaining([scope]));
    expect(() =>
      assertValueCanPublish(zipped, { id: "844444444444444444", guildId }),
    ).toThrowError(expect.objectContaining({ code: "PUBLICATION_SCOPE" }));
    expect(() =>
      evaluateValue(
        fill(selected, [numbers([1]), value.expression.args[1]!]),
        context,
      ),
    ).toThrowError(expect.objectContaining({ code: "ZIP_LENGTH" }));
    expect(
      evaluateValue(
        fill(selected, [
          numbers([]),
          { kind: "literal", type: members, value: [] },
        ]),
        env,
      ).value,
    ).toEqual([]);
    expect(() =>
      evaluateValue(
        fill(selected, [
          numbers([1]),
          {
            kind: "literal",
            type: members,
            value: [{ ...member, guildId: "855555555555555555" }],
          },
        ]),
        env,
      ),
    ).toThrowError(expect.objectContaining({ code: "REFERENCE_SCOPE" }));
  });
  it("keeps registered pairs finite, typed and readable without forging service records", () => {
    const pair = registeredPairType("Number", "PlainText")!;
    expect(registeredPairFields(pair)).toEqual({
      first: "Number",
      second: "PlainText",
    });
    expect(
      registeredPairType(
        { kind: "Record", schemaId: "nexus.ticket.status.v1" },
        "Number",
      ),
    ).toMatchObject({
      kind: "Record",
      schemaId: "nexus.pair.v1",
      typeArgs: [
        { kind: "Record", schemaId: "nexus.ticket.status.v1" },
        "Number",
      ],
    });
    expect(
      registeredPairType({ kind: "List", element: "Number" }, "Number"),
    ).toMatchObject({ kind: "Record", schemaId: "nexus.pair.v1" });
    const context = {
      variables: [
        {
          id: "pairs",
          name: "Pairs",
          type: { kind: "List" as const, element: pair },
        },
      ],
    };
    const first = expressionCardsFor("Number", context).find(
      (item) =>
        item.operator === "record.field" &&
        typeEquals(item.inputs[0]!.type, pair) &&
        item.options?.key === "first",
    )!;
    expect(first).toBeDefined();
    expect(
      evaluateValue(
        fill(first, [
          { kind: "literal", type: pair, value: { first: 0, second: "ok" } },
        ]),
        env,
      ).value,
    ).toBe(0);
    expect(
      expressionCardsFor({
        kind: "List",
        element: { kind: "Record", schemaId: "nexus.pair.Record.Number.v1" },
      }).some((item) => item.operator === "list.zip"),
    ).toBe(false);
    const unsupported = expression(
      "list.zip",
      { kind: "List", element: pair },
      [
        {
          kind: "missing",
          type: {
            kind: "List",
            element: { kind: "Record", schemaId: "nexus.ticket.status.v1" },
          },
        },
        numbers([]),
      ],
    );
    expect(() => validateValueInput(unsupported, env)).toThrowError(
      expect.objectContaining({ code: "TYPE" }),
    );
    expect(() =>
      evaluateValue(
        {
          kind: "literal",
          type: pair,
          value: { first: "coerced", second: "ok" },
        },
        env,
      ),
    ).toThrow();
  });
  it("charges zip results to shared evaluation, list and byte budgets", () => {
    const pair = registeredPairType("Number", "Number")!;
    const selected = card({ kind: "List", element: pair }, "list.zip");
    const input = fill(selected, [numbers([1, 2]), numbers([3, 4])]);
    const budget = { evaluations: 0 };
    expect(() =>
      evaluateValue(input, { ...env, budget, limits: { maxEvaluations: 4 } }),
    ).toThrowError(expect.objectContaining({ code: "EVALUATION_BUDGET" }));
    expect(budget.evaluations).toBe(5);
    expect(() =>
      evaluateValue(input, { ...env, limits: { maxListItems: 1 } }),
    ).toThrowError(expect.objectContaining({ code: "LIST_SIZE" }));
    const larger = fill(selected, [
      numbers(Array.from({ length: 100 }, (_, i) => i)),
      numbers(Array.from({ length: 100 }, (_, i) => i)),
    ]);
    expect(() =>
      evaluateValue(larger, { ...env, limits: { maxValueBytes: 1000 } }),
    ).toThrowError(expect.objectContaining({ code: "VALUE_BYTES" }));
  });
  it("keeps filter bindings readonly and scoped to the body, with inherited provenance", () => {
    const type: ValueType = { kind: "List", element: "Number" };
    const selected = card(type, "list.filter", type);
    expect(() => instantiateExpressionCard(selected)).toThrow(
      "EXPRESSION_BINDING_ID_REQUIRED",
    );
    const value = fill(selected, [
      { kind: "variable", type, variableId: "source" },
    ]);
    const local = expressionBodyBindings(value)[0]!;
    expect(local).toMatchObject({
      id: "local_item",
      type: "Number",
      readOnly: true,
    });
    expect(value.expression.options?.body).toEqual({
      kind: "missing",
      type: "Boolean",
    });
    value.expression.options!.body = expression("compare.greater", "Boolean", [
      { kind: "variable", type: "Number", variableId: local.id },
      number(1),
    ]);
    const source: EvaluatedValue = {
      type,
      value: [0, 1, 2, 3],
      provenance: [
        {
          source: "service",
          guildId,
          allowedChannelIds: ["833333333333333333"],
          sensitive: true,
        },
      ],
    };
    const context = { guildId, variables: { source } };
    const filtered = evaluateValue(value, context);
    expect(filtered.value).toEqual([2, 3]);
    expect(filtered.provenance).toEqual(
      expect.arrayContaining(source.provenance),
    );
    expect(() =>
      evaluateValue(
        { kind: "variable", type: "Number", variableId: local.id },
        context,
      ),
    ).toThrowError(expect.objectContaining({ code: "VARIABLE_SCOPE" }));
    expect(expressionBodyBindings(value.expression.args[0]!)).toEqual([]);
  });
  it("supports a map body with a distinct output type and bounded evaluation", () => {
    const selected = card({ kind: "List", element: "PlainText" }, "list.map", {
      kind: "List",
      element: "Number",
    });
    const value = fill(selected, [numbers([1, 2])]);
    value.expression.options!.body = {
      kind: "literal",
      type: "PlainText",
      value: "ok",
    };
    expect(evaluateValue(value, env).value).toEqual(["ok", "ok"]);
    expect(() =>
      evaluateValue(value, { ...env, limits: { maxEvaluations: 2 } }),
    ).toThrowError(expect.objectContaining({ code: "EVALUATION_BUDGET" }));
  });
  it("uses Optional fallback and preserves explicit zero", () => {
    const selected = card("Number", "optional.default");
    const unset: ValueInput = {
      kind: "literal",
      type: { kind: "Optional", value: "Number" },
      value: { state: "unset" },
    };
    const set: ValueInput = {
      kind: "literal",
      type: { kind: "Optional", value: "Number" },
      value: { state: "set", value: 0 },
    };
    expect(evaluateValue(fill(selected, [unset, number(7)]), env).value).toBe(
      7,
    );
    expect(evaluateValue(fill(selected, [set, number(7)]), env).value).toBe(0);
    const minimum = fill(
      card({ kind: "Optional", value: "Number" }, "list.min"),
      [numbers([])],
    );
    expect(evaluateValue(minimum, env).value).toEqual({ state: "unset" });
  });
  it("composes registered rich text and embeds from typed variables with one escape and no mention grants", () => {
    const richText = fill(card("RichTextSpec", "rich.text"), [
      { kind: "variable", type: "PlainText", variableId: "name" },
    ]);
    const bold = expressionCardsFor("RichTextSpec").find(
      (candidate) =>
        candidate.operator === "rich.wrap" &&
        candidate.options?.format === "bold",
    )!;
    expect(bold).toBeDefined();
    const decorated = fill(bold, [richText]);
    const joined = fill(card("RichTextSpec", "rich.join"), [
      decorated,
      fill(card("RichTextSpec", "rich.text"), [
        { kind: "literal", type: "PlainText", value: "\nNext line" },
      ]),
    ]);
    const embed = fill(card("EmbedSpec", "embed.build"), [
      { kind: "literal", type: "PlainText", value: "*Team*" },
      { kind: "variable", type: "PlainText", variableId: "detail" },
    ]);
    const embeds = fill(
      card({ kind: "List", element: "EmbedSpec" }, "list.build"),
      [embed],
    );
    const message = fill(card("LegacyMessageSpec", "message.legacy"), [
      joined,
      embeds,
    ]);
    const target = "833333333333333333";
    const context = {
      guildId,
      variables: {
        name: {
          type: "PlainText" as const,
          value: "*member* @everyone",
          provenance: [
            {
              source: "service" as const,
              guildId,
              allowedChannelIds: [target],
            },
          ],
        },
        detail: {
          type: "PlainText" as const,
          value: "Member _notice_",
          provenance: [
            {
              source: "service" as const,
              guildId,
              allowedChannelIds: [target],
            },
          ],
        },
      },
    };
    const result = evaluateValue(message, context);
    const payload = buildDiscordMessage(result.value as unknown as MessageSpec);
    expect(payload).toMatchObject({
      content: "**\\*member\\* @everyone**\nNext line",
      embeds: [{ title: "\\*Team\\*", description: "Member \\_notice\\_" }],
      allowed_mentions: {
        parse: [],
        users: [],
        roles: [],
        replied_user: false,
      },
    });
    expect(() =>
      assertValueCanPublish(result, { id: target, guildId }),
    ).not.toThrow();
    expect(() =>
      assertValueCanPublish(result, { id: "844444444444444444", guildId }),
    ).toThrowError(expect.objectContaining({ code: "PUBLICATION_SCOPE" }));
    expect(() =>
      evaluateValue(
        fill(bold, [{ kind: "literal", type: "PlainText", value: "raw" }]),
        env,
      ),
    ).toThrow();
  });
  it("offers only registered formatting variants and an explicit bounded rich join", () => {
    const cards = expressionCardsFor("RichTextSpec"),
      wraps = cards.filter((candidate) => candidate.operator === "rich.wrap");
    expect(wraps.map((candidate) => candidate.options?.format).sort()).toEqual(
      [
        "bold",
        "italic",
        "underline",
        "strike",
        "spoiler",
        "quote",
        "heading1",
        "heading2",
        "heading3",
      ].sort(),
    );
    const join = cards.find((candidate) => candidate.operator === "rich.join")!;
    expect(join.variadic).toEqual({
      type: "RichTextSpec",
      minimum: 0,
      maximum: 100,
    });
    expect(instantiateExpressionCard(join)).toMatchObject({
      expression: {
        args: [
          { kind: "missing", type: "RichTextSpec" },
          { kind: "missing", type: "RichTextSpec" },
        ],
      },
    });
    expect(evaluateValue(fill(join, []), env).value).toEqual([]);
    for (const selected of wraps)
      expect(() =>
        validateValueInput(instantiateExpressionCard(selected), env),
      ).not.toThrow();
    expect(
      expressionCardsFor("LegacyMessageSpec").some(
        (candidate) =>
          candidate.operator === ("message.v2" as ExpressionOperator),
      ),
    ).toBe(false);
  });
  it("offers registered records while never building service-owned evidence", () => {
    const recordType: ValueType = { kind: "Record", schemaId: "AverageValue" };
    const average = fill(card(recordType, "list.average"), [numbers([])]);
    expect(evaluateValue(average, env).value).toEqual({
      value: { state: "unset" },
      count: 0,
    });
    const countField = expressionCardsFor("Number").find(
      (candidate) =>
        candidate.operator === "record.field" &&
        candidate.options?.key === "count",
    )!;
    expect(evaluateValue(fill(countField, [average]), env).value).toBe(0);
    const serviceType: ValueType = {
      kind: "Record",
      schemaId: "ServiceEvidence",
    };
    const context = {
      variables: [{ id: "result", name: "Existing result", type: serviceType }],
      recordSchemas: {
        ServiceEvidence: {
          userConstructible: false,
          fields: { count: { type: "Number" as const, writable: false } },
        },
      },
    };
    expect(
      expressionCardsFor(serviceType, context).filter((candidate) =>
        ["record.build", "record.update"].includes(candidate.operator),
      ),
    ).toEqual([]);
    const field = expressionCardsFor("Number", context).find(
      (candidate) =>
        candidate.operator === "record.field" &&
        candidate.options?.key === "count" &&
        typeEquals(candidate.inputs[0]!.type, serviceType),
    );
    expect(field).toBeDefined();
    expect(() =>
      evaluateValue(
        { kind: "literal", type: serviceType, value: { count: 2 } },
        { ...env, recordSchemas: context.recordSchemas },
      ),
    ).toThrowError(expect.objectContaining({ code: "SERVICE_VALUE" }));
  });
  it("reads the registered namespaced ticket state/version without offering result constructors", () => {
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
    const stateCard = expressionCardsFor(state).find(
      (candidate) =>
        candidate.operator === "record.field" &&
        candidate.options?.key === "state" &&
        typeEquals(candidate.inputs[0]!.type, ticket),
    );
    const versionCard = expressionCardsFor("Number").find(
      (candidate) =>
        candidate.operator === "record.field" &&
        candidate.options?.key === "version" &&
        typeEquals(candidate.inputs[0]!.type, ticket),
    );
    expect(stateCard).toBeDefined();
    expect(versionCard).toBeDefined();
    expect(
      expressionCardsFor(ticket).some(
        (candidate) =>
          candidate.operator === "record.build" ||
          candidate.operator === "record.update",
      ),
    ).toBe(false);
    const context = {
      guildId,
      variables: {
        ticket: {
          type: ticket,
          value: { state: "IN_PROGRESS", version: 3 },
          provenance: [
            { source: "service" as const, guildId, allowedChannelIds: [] },
          ],
        },
      },
    };
    const input: ValueInput = {
      kind: "variable",
      type: ticket,
      variableId: "ticket",
    };
    expect(evaluateValue(fill(stateCard!, [input]), context).value).toBe(
      "IN_PROGRESS",
    );
    expect(evaluateValue(fill(versionCard!, [input]), context).value).toBe(3);
    expect(() =>
      evaluateValue(
        {
          kind: "literal",
          type: ticket,
          value: { state: "RESOLVED", version: 3 },
        },
        env,
      ),
    ).toThrowError(expect.objectContaining({ code: "SERVICE_VALUE" }));
    const definition: PureDefinition = {
      id: "9project:format.v1",
      revision: 1,
      name: "Namespaced value",
      inputs: [],
      outputType: "Number",
      value: number(1),
    };
    expect(
      expressionCardsFor("Number", { pureDefinitions: [definition] }).find(
        (candidate) => candidate.operator === "pure.call",
      )?.options,
    ).toEqual({ definitionId: definition.id, revision: 1 });
  });
  it("calls a fixed pure-definition revision with typed parameter slots, excluding ambient reads", () => {
    const definition: PureDefinition = {
      id: "increment",
      revision: 2,
      name: "Increment",
      inputs: [{ id: "input", name: "Input", type: "Number" }],
      outputType: "Number",
      value: expression("number.add", "Number", [
        { kind: "variable", type: "Number", variableId: "input" },
        number(1),
      ]),
    };
    const context = { pureDefinitions: [definition] };
    const selected = expressionCardsFor("Number", context).find(
      (candidate) => candidate.operator === "pure.call",
    )!;
    expect(selected.options).toEqual({
      definitionId: "increment",
      revision: 2,
    });
    expect(instantiateExpressionCard(selected)).toMatchObject({
      expression: { args: [{ kind: "missing", type: "Number" }] },
    });
    expect(
      evaluateValue(fill(selected, [number(4)]), {
        ...env,
        pureDefinitions: [definition],
      }).value,
    ).toBe(5);
    const ambient: PureDefinition = {
      ...definition,
      value: { kind: "variable", type: "Number", variableId: "outer" },
    };
    expect(
      expressionCardsFor("Number", {
        variables: [{ id: "outer", name: "Outer", type: "Number" }],
        pureDefinitions: [ambient],
      }).some((candidate) => candidate.operator === "pure.call"),
    ).toBe(false);
  });
  it("only emits structurally valid cards and unique stable identities", () => {
    const outputs: ValueType[] = [
      "Number",
      "PlainText",
      "Boolean",
      "ConditionResult",
      "Duration",
      "Instant",
      "DateOnly",
      { kind: "List", element: "Number" },
      { kind: "List", element: { kind: "List", element: "Number" } },
      { kind: "Optional", value: "Number" },
      { kind: "Record", schemaId: "AverageValue" },
    ];
    for (const output of outputs) {
      const cards = expressionCardsFor(output);
      expect(new Set(cards.map((item) => item.id)).size).toBe(cards.length);
      for (const item of cards) {
        expect(typeEquals(item.outputType, output)).toBe(true);
        expect(() =>
          validateValueInput(
            instantiateExpressionCard(item, () => "local"),
            env,
          ),
        ).not.toThrow();
      }
    }
    const before = expressionCardsFor("Boolean", {
      variables: [{ id: "source", name: "First name", type: "Number" }],
    });
    const after = expressionCardsFor("Boolean", {
      variables: [{ id: "source", name: "Renamed", type: "Number" }],
    });
    expect(before.map((item) => item.id)).toEqual(after.map((item) => item.id));
  });
  it("bounds type combinations and rejects excessive nested type structure", () => {
    let deep: ValueType = "Number";
    for (let index = 0; index < 10; index++)
      deep = { kind: "List", element: deep };
    expect(expressionCardsFor(deep)).toEqual([]);
    const variables = Array.from({ length: 300 }, (_, index) => ({
      id: `var_${index}`,
      name: "Choice",
      type: { kind: "Enum" as const, values: [`value_${index}`] },
    }));
    const cards = expressionCardsFor("Boolean", { variables });
    expect(cards.length).toBeLessThanOrEqual(EXPRESSION_CARD_LIMITS.cards);
    expect(
      cards.some(
        (item) =>
          item.operator.startsWith("discord.") ||
          item.operator === ("readClock" as ExpressionOperator),
      ),
    ).toBe(false);
  });
  it("clones local nested bindings and their body reads without changing outer references", () => {
    const selected = card({ kind: "List", element: "Number" }, "list.map", {
      kind: "List",
      element: "Number",
    });
    const value = fill(
      selected,
      [
        {
          kind: "variable",
          type: { kind: "List", element: "Number" },
          variableId: "outer_list",
        },
      ],
      "outer_item",
    );
    const nested = fill(
      card({ kind: "List", element: "Number" }, "list.filter", {
        kind: "List",
        element: "Number",
      }),
      [numbers([1, 2, 3])],
      "inner_item",
    );
    nested.expression.options!.body = expression("compare.greater", "Boolean", [
      { kind: "variable", type: "Number", variableId: "inner_item" },
      { kind: "variable", type: "Number", variableId: "outer_item" },
    ]);
    value.expression.options!.body = expression("list.length", "Number", [
      nested,
    ]);
    let next = 0;
    const copied = cloneExpressionBindings(value, () => `fresh_${++next}`);
    expect(
      copied.kind === "expression" && copied.expression.args[0],
    ).toMatchObject({ variableId: "outer_list" });
    expect(JSON.stringify(copied)).not.toContain('"variableId":"outer_item"');
    expect(JSON.stringify(copied)).not.toContain('"variableId":"inner_item"');
    expect(expressionBodyBindings(copied)[0]?.id).toBe("fresh_1");
    const context = {
      guildId,
      variables: {
        outer_list: {
          type: { kind: "List" as const, element: "Number" as const },
          value: [0, 2],
          provenance: [],
        },
      },
    };
    expect(evaluateValue(copied, context).value).toEqual([3, 1]);
    expect(evaluateValue(value, context).value).toEqual([3, 1]);
    expect(() => cloneExpressionBindings(value, () => "outer_item")).toThrow(
      "EXPRESSION_BINDING_ID",
    );
    expect(() => cloneExpressionBindings(value, () => "reused")).toThrow(
      "EXPRESSION_BINDING_ID",
    );
  });
  it("does not mutate caller types, card options or pure revisions during editing", () => {
    const selected = card({ kind: "List", element: "Number" }, "list.sort", {
      kind: "List",
      element: "Number",
    });
    const value = instantiateExpressionCard(selected);
    if (value.kind !== "expression") throw new Error("Expected expression");
    value.expression.options!.descending = !selected.options?.descending;
    expect(value.expression.options?.descending).not.toBe(
      selected.options?.descending,
    );
    expect(expressionBodyBindings(number(1))).toEqual([]);
    expect(() =>
      instantiateExpressionCard(
        card({ kind: "List", element: "Number" }, "list.filter"),
        () => "bad/id",
      ),
    ).toThrow("EXPRESSION_BINDING_ID");
  });
  it("bundles for browsers without pulling server compilation or Node builtins into the client", () => {
    const result = buildSync({
      entryPoints: ["packages/automation/src/expression-cards.ts"],
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      logLevel: "silent",
    });
    expect(result.outputFiles).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(result.outputFiles[0]!.text).not.toContain('from "node:');
  });
});
