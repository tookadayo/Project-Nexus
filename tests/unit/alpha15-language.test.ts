import { describe, it, expect } from "vitest";
import {
  compileFlowDefinition,
  semanticHash,
  validateFlowDefinition,
} from "../../packages/automation/src/definition.js";
import {
  assertCount,
  assertValueMatchesType,
  combineConditions,
  evaluateValue,
  parseCountLiteral,
  validateValueInput,
} from "../../packages/automation/src/expression.js";
import { AUTOMATION_CATALOG } from "../../packages/automation/src/catalog.js";
import {
  assertValueCanPublish,
  buildAllowedMentions,
  buildDiscordMessage,
  renderRichText,
  validateMessageSpec,
} from "../../packages/automation/src/message.js";
import type {
  EvaluationContext,
  ExpressionOperator,
  FlowDefinition,
  JsonValue,
  Statement,
  ValueInput,
  ValueType,
} from "../../packages/automation/src/types.js";

const guildId = "123456789012345678",
  channelId = "223456789012345678",
  otherChannel = "323456789012345678";
const literal = (type: ValueType, value: JsonValue): ValueInput => ({
  kind: "literal",
  type,
  value,
});
const expression = (
  type: ValueType,
  operator: ExpressionOperator,
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
const context: EvaluationContext = { guildId, variables: {} };
const result = (value: ValueInput) => evaluateValue(value, context).value;
const number = (value: number) => literal("Number", value);
const list = (values: JsonValue[], element: ValueType = "Number") =>
  literal({ kind: "List", element }, values);
const flow = (body: Statement[] = []): FlowDefinition => ({
  schemaVersion: 1,
  id: "flow-test",
  guildId,
  name: "Test",
  trigger: { kind: "manual", inputs: [] },
  variables: [],
  body,
});
const send = (id = "send"): Statement => ({
  id,
  kind: "action",
  operation: "discord.sendMessage",
  inputs: {
    channel: literal("ChannelRef", { id: channelId, guildId }),
    content: literal("PlainText", "Hello"),
  },
});
function enabledFlow(body: Statement[]): FlowDefinition {
  return {
    ...flow(body),
    targets: { channelIds: [channelId], roleIds: [], parentCategoryIds: [] },
  };
}

describe("alpha15 typed values and pure evaluation", () => {
  it("keeps direct input, calculation, missing and explicit zero distinct", () => {
    expect(parseCountLiteral("5", 100)).toBe(5);
    expect(parseCountLiteral("0", 100)).toBe(0);
    for (const invalid of ["", "3.1", "-1", "１", "1e2", "1,000", "Infinity"])
      expect(() => parseCountLiteral(invalid, 100)).toThrow();
    expect(
      result(expression("Number", "number.divide", [number(30), number(10)])),
    ).toBe(3);
    expect(() =>
      assertCount(
        result(expression("Number", "number.divide", [number(31), number(10)])),
        100,
      ),
    ).toThrow();
    expect(() =>
      result(expression("Number", "number.divide", [number(1), number(0)])),
    ).toThrow();
    expect(() => result({ kind: "missing", type: "Number" })).toThrow();
    expect(result(expression("Number", "number.round", [number(-1.5)]))).toBe(
      -2,
    );
    expect(() =>
      result(
        expression("Number", "number.add", [
          number(Number.MAX_VALUE),
          number(Number.MAX_VALUE),
        ]),
      ),
    ).toThrow();
  });
  it("treats condition unknown separately with defined short circuit truth tables", () => {
    const values = ["true", "false", "unknown"] as const;
    const and = [
      ["true", "false", "unknown"],
      ["false", "false", "false"],
      ["unknown", "false", "unknown"],
    ];
    const or = [
      ["true", "true", "true"],
      ["true", "false", "unknown"],
      ["true", "unknown", "unknown"],
    ];
    values.forEach((a, i) =>
      values.forEach((b, j) => {
        expect(combineConditions("and", a, b)).toBe(and[i]![j]);
        expect(combineConditions("or", a, b)).toBe(or[i]![j]);
      }),
    );
    const division = expression("Boolean", "compare.equal", [
      expression("Number", "number.divide", [
        number(1),
        { kind: "variable", type: "Number", variableId: "zero" },
      ]),
      number(1),
    ]);
    expect(
      evaluateValue(
        expression("Boolean", "condition.and", [
          literal("Boolean", false),
          division,
        ]),
        {
          ...context,
          variables: { zero: { type: "Number", value: 0, provenance: [] } },
        },
      ).value,
    ).toBe(false);
    expect(() =>
      evaluateValue(
        expression("Boolean", "condition.or", [
          literal("Boolean", false),
          division,
        ]),
        {
          ...context,
          variables: { zero: { type: "Number", value: 0, provenance: [] } },
        },
      ),
    ).toThrow();
  });
  it("preserves optional false, zero and empty text and evaluates defaults only when unset", () => {
    for (const [type, value] of [
      ["Number", 0],
      ["Boolean", false],
      ["PlainText", ""],
    ] as const) {
      expect(
        result(
          expression(type, "optional.default", [
            literal({ kind: "Optional", value: type }, { state: "set", value }),
            literal(
              type,
              type === "Number" ? 42 : type === "Boolean" ? true : "fallback",
            ),
          ]),
        ),
      ).toBe(value);
    }
    expect(
      result(
        expression("Number", "optional.default", [
          literal({ kind: "Optional", value: "Number" }, { state: "unset" }),
          number(42),
        ]),
      ),
    ).toBe(42);
    expect(() =>
      assertValueMatchesType(
        { kind: "Optional", value: "Number" },
        { state: "unknown" },
        context,
      ),
    ).toThrow();
  });
  it("uses finite list semantics and stable set order without truncation", () => {
    expect(result(expression("Number", "list.sum", [list([])]))).toBe(0);
    expect(
      result(
        expression(
          { kind: "Record", schemaId: "AverageValue" },
          "list.average",
          [list([])],
        ),
      ),
    ).toEqual({ value: { state: "unset" }, count: 0 });
    expect(
      result(
        expression(
          { kind: "Record", schemaId: "AverageValue" },
          "list.average",
          [list([10, 20, 30])],
        ),
      ),
    ).toEqual({ value: { state: "set", value: 20 }, count: 3 });
    const a = list(["a", "b", "a", "c"], "PlainText"),
      b = list(["b", "d"], "PlainText"),
      type = { kind: "List", element: "PlainText" } as const;
    expect(result(expression(type, "list.intersection", [a, b]))).toEqual([
      "b",
    ]);
    expect(result(expression(type, "list.difference", [a, b]))).toEqual([
      "a",
      "c",
    ]);
    expect(result(expression(type, "list.union", [a, b]))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(
      result(
        expression(
          { kind: "List", element: { kind: "List", element: "Number" } },
          "list.chunk",
          [list([1, 2, 3, 4, 5]), number(2)],
        ),
      ),
    ).toEqual([[1, 2], [3, 4], [5]]);
    expect(() =>
      result(
        expression(
          { kind: "List", element: { kind: "List", element: "Number" } },
          "list.chunk",
          [list([]), number(0)],
        ),
      ),
    ).toThrow();
    expect(() =>
      result(expression("Number", "list.item", [list([]), number(1)])),
    ).toThrow();
    expect(() =>
      result(
        expression({ kind: "List", element: "Number" }, "list.range", [
          number(1),
          number(1000000),
          number(1),
        ]),
      ),
    ).toThrow();
  });
  it("uses pure list bindings without sharing or mutable external effects", () => {
    const binding = {
      kind: "variable",
      variableId: "item",
      type: "Number",
    } as const;
    expect(
      result(
        expression(
          { kind: "List", element: "Number" },
          "list.map",
          [list([1, 2, 3])],
          {
            bindingId: "item",
            body: expression("Number", "number.multiply", [binding, number(2)]),
          },
        ),
      ),
    ).toEqual([2, 4, 6]);
    expect(
      result(
        expression("Boolean", "list.any", [list([])], {
          bindingId: "item",
          body: expression("Boolean", "compare.equal", [binding, number(1)]),
        }),
      ),
    ).toBe(false);
    expect(
      result(
        expression("Boolean", "list.all", [list([])], {
          bindingId: "item",
          body: expression("Boolean", "compare.equal", [binding, number(1)]),
        }),
      ),
    ).toBe(true);
    expect(
      result(
        expression("Boolean", "list.all", [list([false, false], "Boolean")], {
          bindingId: "item",
          body: literal("Boolean", true),
        }),
      ),
    ).toBe(true);
    expect(
      result(
        expression(
          { kind: "Optional", value: "Number" },
          "list.find",
          [list([1, 2, 3])],
          {
            bindingId: "item",
            body: expression("Boolean", "compare.equal", [binding, number(4)]),
          },
        ),
      ),
    ).toEqual({ state: "unset" });
    expect(() =>
      validateValueInput(
        {
          kind: "expression",
          type: "Number",
          expression: {
            operator: "clock.read" as ExpressionOperator,
            args: [],
          },
        },
        context,
      ),
    ).toThrow();
  });
  it("carries source restrictions through text and rejects nonmatching server references", () => {
    const source = {
      type: "PlainText" as const,
      value: "private",
      provenance: [
        {
          source: "input" as const,
          guildId,
          allowedChannelIds: [channelId],
          sensitive: false,
        },
      ],
    };
    const rendered = evaluateValue(
      expression("PlainText", "text.join", [
        literal("PlainText", "Notice: "),
        { kind: "variable", type: "PlainText", variableId: "text" },
      ]),
      { ...context, variables: { text: source } },
    );
    expect(rendered.value).toBe("Notice: private");
    expect(() =>
      assertValueCanPublish(rendered, { id: otherChannel, guildId }),
    ).toThrow();
    assertValueCanPublish(rendered, { id: channelId, guildId });
    expect(() =>
      result(
        literal("ChannelRef", { id: channelId, guildId: "999999999999999999" }),
      ),
    ).toThrow();
    expect(() =>
      evaluateValue(literal("PlainText", "large"), {
        ...context,
        limits: { maxValueBytes: 3 },
      }),
    ).toThrow();
  });
  it("rejects service-only evidence even when hidden inside optional or list values", () => {
    const protectedContext = {
      ...context,
      recordSchemas: {
        Approval: {
          userConstructible: false,
          fields: { approved: { type: "Boolean" as const } },
        },
      },
    };
    for (const input of [
      literal({ kind: "Record", schemaId: "Approval" }, { approved: true }),
      literal(
        { kind: "List", element: { kind: "Record", schemaId: "Approval" } },
        [{ approved: true }],
      ),
      literal(
        { kind: "Optional", value: { kind: "Record", schemaId: "Approval" } },
        { state: "set", value: { approved: true } },
      ),
    ])
      expect(() => evaluateValue(input, protectedContext)).toThrow();
  });
  it("uses fixed pure definitions and rejects cycles and unregistered record fields", () => {
    const total = {
      id: "total",
      revision: 1,
      name: "必要数",
      inputs: [
        { id: "participants", name: "参加人数", type: "Number" as const },
        { id: "reserve", name: "予備", type: "Number" as const },
      ],
      outputType: "Number" as const,
      value: expression("Number", "number.add", [
        { kind: "variable", type: "Number", variableId: "participants" },
        { kind: "variable", type: "Number", variableId: "reserve" },
      ]),
    };
    const call = expression("Number", "pure.call", [number(80), number(20)], {
      definitionId: "total",
      revision: 1,
    });
    expect(
      evaluateValue(call, { ...context, pureDefinitions: [total] }).value,
    ).toBe(100);
    expect(() =>
      evaluateValue(call, {
        ...context,
        pureDefinitions: [{ ...total, value: call }],
      }),
    ).toThrow();
    const recordType = { kind: "Record", schemaId: "Notice" } as const,
      recordContext = {
        ...context,
        recordSchemas: {
          Notice: {
            userConstructible: true,
            fields: { title: { type: "PlainText" as const, writable: true } },
          },
        },
      };
    const original = literal(recordType, { title: "Before" }),
      updated = expression(
        recordType,
        "record.update",
        [original, literal("PlainText", "After")],
        { fields: ["title"] },
      );
    expect(evaluateValue(updated, recordContext).value).toEqual({
      title: "After",
    });
    expect(original.kind === "literal" && original.value).toEqual({
      title: "Before",
    });
    expect(() =>
      evaluateValue(
        expression(recordType, "record.build", [literal("PlainText", "Bad")], {
          fields: ["approval"],
        }),
        recordContext,
      ),
    ).toThrow();
  });
});

describe("alpha15 server compilation and stable semantics", () => {
  it("accepts missing draft input but rejects malformed values, unknown commands and cross-guild refs", () => {
    const missing = flow([
      {
        id: "declare",
        kind: "declare",
        variable: { id: "count", name: "Count", type: "Number" },
        value: { kind: "missing", type: "Number" },
      },
    ]);
    const draft = validateFlowDefinition(missing);
    expect(draft.complete).toBe(false);
    expect(draft.issues.some((issue) => issue.severity === "error")).toBe(
      false,
    );
    expect(typeof draft.semanticHash).toBe("string");
    expect(() => compileFlowDefinition(missing)).toThrow();
    expect(
      validateFlowDefinition({
        ...flow(),
        body: [{ id: "execute", kind: "eval", source: "alert(1)" }],
      }).issues.some((issue) => issue.severity === "error"),
    ).toBe(true);
    expect(
      validateFlowDefinition(
        flow([
          {
            id: "bad",
            kind: "declare",
            variable: { id: "n", name: "N", type: "Number" },
            value: literal("Number", "3"),
          },
        ]),
      ).issues.some((issue) => issue.severity === "error"),
    ).toBe(true);
    expect(
      validateFlowDefinition({ ...flow(), actor: { admin: true } }).valid,
    ).toBe(false);
  });
  it("hashes order, input names and targets while ignoring display coordinates", () => {
    const original = enabledFlow([send("a"), send("b")]);
    const cosmetic = {
      ...original,
      ui: {
        positions: { a: { x: 10, y: 20 } },
        collapsed: ["a"],
        view: "steps" as const,
      },
    };
    expect(semanticHash(original)).toBe(semanticHash(cosmetic));
    expect(
      semanticHash({ ...original, body: [...original.body].reverse() }) ===
        semanticHash(original),
    ).toBe(false);
    const create = enabledFlow([
      {
        id: "create",
        kind: "action",
        operation: "discord.createChannel",
        inputs: {
          name: literal("PlainText", "first"),
          parent: literal("ChannelRef", { id: channelId, guildId }),
        },
      },
    ]);
    const changed = structuredClone(create);
    const step = changed.body[0]!;
    if (step.kind === "action")
      step.inputs.name = literal("PlainText", "second");
    expect(semanticHash(create) === semanticHash(changed)).toBe(false);
    expect(
      semanticHash({
        ...original,
        targets: {
          channelIds: [otherChannel],
          roleIds: [],
          parentCategoryIds: [],
        },
      }) === semanticHash(original),
    ).toBe(false);
    expect(Object.isFrozen(compileFlowDefinition(original).definition)).toBe(
      true,
    );
  });
  it("requires explicit action scope and formal role-approval intent", () => {
    expect(
      validateFlowDefinition(flow([send()])).issues.some(
        (issue) => issue.code === "MISSING_TARGET_POLICY",
      ),
    ).toBe(true);
    expect(validateFlowDefinition(enabledFlow([send()])).valid).toBe(true);
    const outside = enabledFlow([send()]);
    outside.targets!.channelIds = [otherChannel];
    expect(
      validateFlowDefinition(outside).issues.some(
        (issue) => issue.code === "TARGET_POLICY",
      ),
    ).toBe(true);
    const role = enabledFlow([
      {
        id: "role",
        kind: "action",
        operation: "discord.addRole",
        inputs: {
          member: literal("MemberRef", { id: otherChannel, guildId }),
          role: literal("RoleRef", { id: channelId, guildId }),
        },
      },
    ]);
    role.targets!.roleIds = [channelId];
    expect(
      validateFlowDefinition(role).issues.some(
        (issue) => issue.code === "APPROVAL_REQUIRED",
      ),
    ).toBe(true);
  });
  it("enforces initialization and branch, parallel, loop and child procedure boundaries", () => {
    const local = { id: "local", name: "Local", type: "Number" as const };
    const branch: Statement = {
      id: "branch",
      kind: "branch",
      condition: literal("Boolean", true),
      then: [
        { id: "declared", kind: "declare", variable: local, value: number(1) },
      ],
      otherwise: [],
      unknown: [],
    };
    expect(
      validateFlowDefinition(
        flow([
          branch,
          { id: "use", kind: "assign", variableId: "local", value: number(2) },
        ]),
      ).issues.some((issue) => issue.code === "VARIABLE_SCOPE"),
    ).toBe(true);
    const shared: Statement = {
      id: "shared",
      kind: "declare",
      variable: { id: "count", name: "Count", type: "Number" },
      value: number(0),
    };
    const parallel: Statement = {
      id: "parallel",
      kind: "parallel",
      branches: [
        {
          id: "a",
          name: "A",
          body: [
            {
              id: "write",
              kind: "assign",
              variableId: "count",
              value: number(1),
            },
          ],
        },
      ],
    };
    expect(
      validateFlowDefinition(flow([shared, parallel])).issues.some(
        (issue) => issue.code === "VARIABLE_READONLY",
      ),
    ).toBe(true);
    expect(
      validateFlowDefinition(
        flow([{ id: "break", kind: "break" }]),
      ).issues.some((issue) => issue.code === "LOOP_BOUNDARY"),
    ).toBe(true);
    const nested: Statement = {
      id: "loop",
      kind: "repeat",
      count: number(1),
      itemVariable: { id: "item", name: "Item", type: "Number" },
      body: [
        {
          id: "parallel",
          kind: "parallel",
          branches: [
            {
              id: "branch",
              name: "B",
              body: [{ id: "escape", kind: "break" }],
            },
          ],
        },
      ],
    };
    expect(
      validateFlowDefinition(flow([nested])).issues.some(
        (issue) => issue.code === "LOOP_BOUNDARY",
      ),
    ).toBe(true);
    const procedureFlow = {
      ...flow(),
      procedures: [
        {
          id: "proc",
          revision: 1,
          name: "P",
          inputs: [],
          outputs: [],
          body: [
            { id: "escape", kind: "break" } as Statement,
            { id: "return", kind: "return", values: {} } as Statement,
          ],
        },
      ],
    };
    expect(
      validateFlowDefinition(procedureFlow).issues.some(
        (issue) => issue.code === "LOOP_BOUNDARY",
      ),
    ).toBe(true);
  });
  it("allows finite zero iterations, rejects fractional repetitions and preserves shared budgets", () => {
    const repeat = (count: ValueInput): Statement => ({
      id: "loop",
      kind: "repeat",
      count,
      itemVariable: { id: "i", name: "I", type: "Number" },
      body: [send()],
    });
    expect(validateFlowDefinition(enabledFlow([repeat(number(0))])).valid).toBe(
      true,
    );
    expect(
      validateFlowDefinition(enabledFlow([repeat(number(3.1))])).issues.some(
        (issue) => issue.code === "COUNT",
      ),
    ).toBe(true);
    expect(
      validateFlowDefinition(enabledFlow([repeat(number(26))])).issues.some(
        (issue) => issue.code === "ACTION_BUDGET",
      ),
    ).toBe(true);
    expect(
      validateFlowDefinition(
        flow([
          { id: "wait", kind: "wait", duration: literal("Duration", 604800) },
        ]),
      ).valid,
    ).toBe(true);
    expect(
      validateFlowDefinition(
        flow([
          { id: "wait", kind: "wait", duration: literal("Duration", 604801) },
        ]),
      ).issues.some((issue) => issue.code === "WAIT_LIMIT"),
    ).toBe(true);
  });
  it("validates stored disabled content without treating missing unused values as executable", () => {
    const disabled: Statement = {
      id: "unused",
      enabled: false,
      kind: "declare",
      variable: { id: "n", name: "N", type: "Number" },
      value: { kind: "missing", type: "Number" },
    };
    expect(validateFlowDefinition(flow([disabled])).valid).toBe(true);
    const forbidden: Statement = {
      id: "unused",
      enabled: false,
      kind: "declare",
      variable: { id: "ref", name: "Ref", type: "ChannelRef" },
      value: literal("ChannelRef", {
        id: channelId,
        guildId: "999999999999999999",
      }),
    };
    expect(validateFlowDefinition(flow([forbidden])).valid).toBe(false);
    const hidden: Statement = {
      id: "inactive",
      kind: "repeat",
      enabled: false,
      count: number(1),
      itemVariable: { id: "i", name: "I", type: "Number" },
      body: [
        { id: "same", kind: "end" },
        { id: "same", kind: "end" },
      ],
    };
    expect(
      validateFlowDefinition(flow([hidden])).issues.some(
        (issue) => issue.code === "BLOCK_ID",
      ),
    ).toBe(true);
    const recursive = {
      ...flow(),
      procedures: [
        {
          id: "a",
          revision: 1,
          name: "A",
          inputs: [],
          outputs: [],
          body: [
            {
              id: "ab",
              kind: "call",
              procedureId: "b",
              revision: 1,
              args: {},
              outputs: {},
            } as Statement,
            { id: "ra", kind: "return", values: {} } as Statement,
          ],
        },
        {
          id: "b",
          revision: 1,
          name: "B",
          inputs: [],
          outputs: [],
          body: [
            {
              id: "ba",
              kind: "call",
              procedureId: "a",
              revision: 1,
              args: {},
              outputs: {},
            } as Statement,
            { id: "rb", kind: "return", values: {} } as Statement,
          ],
        },
      ],
    };
    expect(
      validateFlowDefinition(recursive).issues.some(
        (issue) => issue.code === "PROCEDURE_CYCLE",
      ),
    ).toBe(true);
  });
  it("keeps 66 candidate families distinct from availability and forbids dangerous operations", () => {
    expect(AUTOMATION_CATALOG.length).toBe(66);
    expect(new Set(AUTOMATION_CATALOG.map((entry) => entry.id)).size).toBe(66);
    for (const operation of [
      "http.request",
      "discord.ban",
      "discord.kick",
      "discord.bulkDelete",
    ])
      expect(
        validateFlowDefinition({
          ...flow(),
          body: [{ id: "bad", kind: "action", operation, inputs: {} }],
        }).valid,
      ).toBe(false);
  });
});

describe("alpha15 message values and notification policy", () => {
  it("escapes plain text and uses no notifications by default", () => {
    expect(
      renderRichText([
        { kind: "bold", children: [{ kind: "text", text: "a*b" }] },
        { kind: "break" },
        { kind: "text", text: "@everyone" },
      ]),
    ).toBe("**a\\*b**\n@everyone");
    expect(buildAllowedMentions()).toEqual({
      parse: [],
      users: [],
      roles: [],
      replied_user: false,
    });
    expect(
      buildDiscordMessage({ kind: "legacy", content: "@everyone" })
        .allowed_mentions,
    ).toEqual({ parse: [], users: [], roles: [], replied_user: false });
    expect(() => buildAllowedMentions({ roleIds: [channelId] })).toThrow();
    expect(
      buildAllowedMentions(
        { roleIds: [channelId] },
        { userIds: [], roleIds: [channelId] },
      ).roles,
    ).toEqual([channelId]);
  });
  it("rejects unsupported/mixed payloads and expanded lengths without splitting", () => {
    expect(() =>
      validateMessageSpec({ kind: "legacy", content: "x".repeat(2001) }),
    ).toThrow();
    expect(() =>
      validateMessageSpec({
        kind: "v2",
        components: [{ type: 10, content: "Text" }],
        embeds: [{ title: "Mixed" }],
      }),
    ).toThrow();
    expect(() =>
      validateMessageSpec({
        kind: "legacy",
        embeds: [
          { description: "x".repeat(4000) },
          { description: "y".repeat(4000) },
        ],
      }),
    ).toThrow();
    expect(() =>
      renderRichText([
        { kind: "link", text: "Link", url: "javascript:alert(1)" },
      ]),
    ).toThrow();
    expect(() =>
      renderRichText([
        {
          kind: "timestamp",
          instant: "2026-10-15T00:00:00Z",
          format: "unknown" as "F",
        },
      ]),
    ).toThrow();
    expect(
      buildDiscordMessage({
        kind: "v2",
        components: [{ type: 10, content: "Text" }],
      }).flags,
    ).toBe(32768);
  });
});
