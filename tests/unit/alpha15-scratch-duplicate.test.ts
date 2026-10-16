import { describe, expect, it } from "vitest";
import {
  cloneStatement,
  createDraft,
} from "../../apps/web/app/automation/model";
import { validateFlowDefinition } from "../../packages/automation/src/definition";
import type {
  Statement,
  ValueInput,
} from "../../packages/automation/src/types";
const number = (value: number): ValueInput => ({
  kind: "literal",
  type: "Number",
  value,
});
const ref = (variableId: string): ValueInput => ({
  kind: "variable",
  type: "Number",
  variableId,
});
const declare = (
  id: string,
  variableId: string,
  value = number(1),
): Extract<Statement, { kind: "declare" }> => ({
  id,
  kind: "declare",
  variable: { id: variableId, name: "Keep this name", type: value.type },
  value,
});
const repeat = (body: Statement[]): Extract<Statement, { kind: "repeat" }> => ({
  id: "loop",
  kind: "repeat",
  count: number(1),
  itemVariable: { id: "item", name: "Item", type: "Number" },
  body,
});
const map = (bindingId: string, body = ref(bindingId)): ValueInput => ({
  kind: "expression",
  type: { kind: "List", element: body.type },
  expression: {
    operator: "list.map",
    args: [
      {
        kind: "literal",
        type: { kind: "List", element: "Number" },
        value: [1],
      },
    ],
    options: { bindingId, body },
  },
});
describe("Scratch Duplicate identifier hygiene", () => {
  it("keeps a valid external variable reference when its ID equals the duplicated block ID", () => {
    const flow = createDraft("321111111111111111", "en");
    flow.trigger = {
      kind: "manual",
      inputs: [{ id: "x", name: "Outside", type: "Number" }],
    };
    const source = declare("x", "inside", ref("x"));
    flow.body = [source];
    expect(validateFlowDefinition(flow)).toMatchObject({
      valid: true,
      complete: true,
    });
    const cloned = cloneStatement(source) as typeof source;
    expect(cloned.id).not.toBe("x");
    expect(cloned.variable.id).not.toBe("inside");
    expect(cloned.value).toEqual(ref("x"));
    expect(cloned.variable.name).toBe(source.variable.name);
    expect(
      validateFlowDefinition({ ...flow, body: [source, cloned] }),
    ).toMatchObject({ valid: true, complete: true });
    expect(source).toEqual(declare("x", "inside", ref("x")));
  });
  it("maps internal declarations and references through the variable namespace only", () => {
    const source = repeat([
      declare("shared", "shared"),
      {
        id: "write",
        kind: "assign",
        variableId: "shared",
        value: ref("shared"),
      },
    ]);
    source.count = ref("loop");
    const cloned = cloneStatement(source) as typeof source;
    const declaration = cloned.body[0] as Extract<
      Statement,
      { kind: "declare" }
    >;
    const assignment = cloned.body[1] as Extract<Statement, { kind: "assign" }>;
    expect(cloned.count).toEqual(ref("loop"));
    expect(declaration.id).not.toBe(declaration.variable.id);
    expect(assignment.variableId).toBe(declaration.variable.id);
    expect(assignment.value).toEqual(ref(declaration.variable.id));
  });
  it("maps an expression binding separately from an identically named node", () => {
    const cloned = cloneStatement(declare("x", "result", map("x"))) as Extract<
      Statement,
      { kind: "declare" }
    >;
    if (cloned.value.kind !== "expression") throw Error("expression expected");
    const binding = cloned.value.expression.options!.bindingId!;
    expect(binding).not.toBe("x");
    expect(binding).not.toBe(cloned.id);
    expect(cloned.value.expression.options!.body).toEqual(ref(binding));
  });
  it("supports sibling bindings and a later declaration with the same lexical name", () => {
    const cloned = cloneStatement(
      repeat([
        declare("one", "first", map("local")),
        declare("two", "second", map("local")),
        declare("three", "local"),
        {
          id: "four",
          kind: "assign",
          variableId: "local",
          value: ref("local"),
        },
      ]),
    ) as Extract<Statement, { kind: "repeat" }>;
    const a = cloned.body[0] as Extract<Statement, { kind: "declare" }>,
      b = cloned.body[1] as typeof a,
      c = cloned.body[2] as typeof a;
    if (a.value.kind !== "expression" || b.value.kind !== "expression")
      throw Error("expression expected");
    const first = a.value.expression.options!.bindingId!,
      second = b.value.expression.options!.bindingId!;
    expect(first).not.toBe(second);
    expect(first).not.toBe(c.variable.id);
    expect(a.value.expression.options!.body).toEqual(ref(first));
    expect(b.value.expression.options!.body).toEqual(ref(second));
    expect(
      (cloned.body[3] as Extract<Statement, { kind: "assign" }>).value,
    ).toEqual(ref(c.variable.id));
  });
  it("keeps parallel output names and external targets while remapping branch and local IDs", () => {
    const source: Extract<Statement, { kind: "parallel" }> = {
      id: "parallel",
      kind: "parallel",
      branches: [
        {
          id: "x",
          name: "Branch name",
          body: [declare("x", "inside", ref("x"))],
          outputs: { x: ref("inside") },
        },
      ],
      outputs: { x: { branchId: "x", outputId: "x" } },
    };
    const cloned = cloneStatement(source) as typeof source,
      branch = cloned.branches[0]!,
      child = branch.body[0] as Extract<Statement, { kind: "declare" }>;
    expect(branch.id).not.toBe(child.id);
    expect(child.value).toEqual(ref("x"));
    expect(branch.name).toBe("Branch name");
    expect(branch.outputs).toEqual({ x: ref(child.variable.id) });
    expect(cloned.outputs).toEqual({
      x: { branchId: branch.id, outputId: "x" },
    });
  });
  it("allows branch names reused by a nested parallel block", () => {
    const inner: Extract<Statement, { kind: "parallel" }> = {
      id: "inner",
      kind: "parallel",
      branches: [{ id: "same", name: "Inner", body: [] }],
    };
    const cloned = cloneStatement({
      id: "outer",
      kind: "parallel",
      branches: [{ id: "same", name: "Outer", body: [inner] }],
    }) as typeof inner;
    const nested = cloned.branches[0]!.body[0] as typeof inner;
    expect(cloned.branches[0]!.id).not.toBe(nested.branches[0]!.id);
  });
  it("keeps literal payload IDs, type IDs and names unchanged", () => {
    const value: ValueInput = {
      kind: "literal",
      type: { kind: "Record", schemaId: "x" },
      value: {
        id: "x",
        variableId: "x",
        branchId: "x",
        actionId: "x",
        bindingId: "x",
        name: "x",
      },
    };
    const cloned = cloneStatement(declare("x", "value", value)) as Extract<
      Statement,
      { kind: "declare" }
    >;
    expect(cloned.value).toEqual(value);
  });
  it("uses node references for approval actions even when a local variable has that ID", () => {
    const cloned = cloneStatement(
      repeat([
        declare("declaration", "outside-action"),
        {
          id: "approval",
          kind: "approval",
          actionId: "outside-action",
          until: { kind: "missing", type: "Instant" },
          approved: [],
          rejected: [],
          expired: [],
        },
      ]),
    ) as Extract<Statement, { kind: "repeat" }>;
    expect(
      (cloned.body[1] as Extract<Statement, { kind: "approval" }>).actionId,
    ).toBe("outside-action");
  });
  it("rejects duplicate nodes or declarations in their own namespaces", () => {
    expect(() =>
      cloneStatement(
        repeat([
          { id: "same", kind: "end" },
          { id: "same", kind: "end" },
        ]),
      ),
    ).toThrow("CLONE_DUPLICATE_NODE_ID");
    expect(() =>
      cloneStatement(repeat([declare("one", "same"), declare("two", "same")])),
    ).toThrow("CLONE_DUPLICATE_VARIABLE_ID");
    expect(() =>
      cloneStatement({
        id: "parallel",
        kind: "parallel",
        branches: [
          { id: "same", name: "One", body: [] },
          { id: "same", name: "Two", body: [] },
        ],
      }),
    ).toThrow("CLONE_DUPLICATE_BRANCH_ID");
  });
  it("rejects a nested expression binding that shadows its active binding", () => {
    expect(() =>
      cloneStatement(declare("node", "result", map("item", map("item")))),
    ).toThrow("CLONE_DUPLICATE_BINDING_ID");
  });
});
