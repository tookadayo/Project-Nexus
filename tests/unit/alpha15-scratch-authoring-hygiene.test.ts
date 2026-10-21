import { describe, expect, it } from "vitest";
import {
  compileCommonUnknownChain,
  saveCommonUnknownDraft,
  validateScratchAuthoring,
  type CommonUnknownDraft,
} from "../../packages/automation/src/scratch-authoring";
import { validateFlowDefinition } from "../../packages/automation/src/definition";
import type {
  FlowDefinition,
  ValueInput,
} from "../../packages/automation/src/types";

const list = (value: number[]): ValueInput => ({
  kind: "literal",
  type: { kind: "List", element: "Number" },
  value,
});
const variable = (variableId: string): ValueInput => ({
  kind: "variable",
  type: "Number",
  variableId,
});
const definition = (): FlowDefinition => ({
  schemaVersion: 1,
  semanticProfile: "scratch.v1",
  id: "hygiene",
  guildId: "999123456789012345",
  name: "Synthetic hygiene",
  trigger: { kind: "manual", inputs: [] },
  variables: [],
  body: [],
});
const draft = (
  body: ValueInput = variable("free.missing"),
): CommonUnknownDraft => ({
  id: "chain",
  clauses: [
    {
      id: "clause",
      condition: { kind: "literal", type: "ConditionResult", value: "unknown" },
      then: [],
    },
  ],
  otherwise: [],
  template: [
    {
      id: "template.declare",
      kind: "declare",
      variable: {
        id: "template.result",
        name: "Mapped",
        type: { kind: "List", element: "Number" },
      },
      value: {
        kind: "expression",
        type: { kind: "List", element: "Number" },
        expression: {
          operator: "list.map",
          args: [list([1])],
          options: { bindingId: "template.item", body },
        },
      },
    },
  ],
});
const sequence =
  (...values: string[]) =>
  () => {
    const value = values.shift();
    if (!value) throw Error("NO_ID");
    return value;
  };

describe("common unknown hygienic allocation audit", () => {
  it("never turns an unbound external reference into a valid expression binding", () => {
    const ordinary = saveCommonUnknownDraft(definition(), draft(), {
      createId: sequence("copy.node", "copy.result", "copy.item"),
    });
    expect(validateFlowDefinition(ordinary).valid).toBe(false);
    expect(() =>
      saveCommonUnknownDraft(definition(), draft(), {
        createId: sequence("copy.node", "copy.result", "free.missing"),
      }),
    ).toThrow("SCRATCH_COPY_ID_COLLISION");
  });

  it("reserves source logical IDs independently of generated execution IDs", () => {
    expect(() =>
      compileCommonUnknownChain(draft(variable("template.item")), {
        createId: () => "template.declare",
      }),
    ).toThrow("SCRATCH_COPY_ID_COLLISION");
    expect(() =>
      compileCommonUnknownChain(draft(variable("template.item")), {
        createId: sequence("copy.node", "copy.result", "template.item"),
      }),
    ).toThrow("SCRATCH_COPY_ID_COLLISION");
  });

  it("reserves expression binding identities elsewhere in the containing definition", () => {
    const source = definition();
    const outside = draft(variable("template.item")).template[0]!;
    if (outside.kind !== "declare" || outside.value.kind !== "expression")
      throw Error("SHAPE");
    outside.id = "outside.declare";
    outside.variable.id = "outside.result";
    outside.value.expression.options!.bindingId = "outside.item";
    outside.value.expression.options!.body = variable("outside.item");
    source.body.push(outside);
    expect(validateFlowDefinition(source).valid).toBe(true);
    expect(() =>
      saveCommonUnknownDraft(source, draft(variable("template.item")), {
        createId: sequence("copy.node", "copy.result", "outside.item"),
      }),
    ).toThrow("SCRATCH_COPY_ID_COLLISION");
  });

  it("rejects a forged coherent mapping that captures an otherwise unbound free reference", () => {
    const source = saveCommonUnknownDraft(
      definition(),
      draft(variable("template.item")),
      { createId: sequence("copy.node", "copy.result", "copy.item") },
    );
    const chain = source.scratchAuthoring!.chains[0]!;
    chain.copies[0]!.localIds["template.item"] = "free.missing";
    const template = chain.template[0]!,
      branch = source.body[0]!;
    if (
      template.kind !== "declare" ||
      template.value.kind !== "expression" ||
      branch.kind !== "branch"
    )
      throw Error("SHAPE");
    template.value.expression.options!.body = variable("free.missing");
    const copy = branch.unknown[0]!;
    if (copy.kind !== "declare" || copy.value.kind !== "expression")
      throw Error("SHAPE");
    copy.value.expression.options!.bindingId = "free.missing";
    copy.value.expression.options!.body = variable("free.missing");
    expect(validateScratchAuthoring(source)).toEqual([
      expect.objectContaining({ code: "SCRATCH_AUTHORING" }),
    ]);
    expect(validateFlowDefinition(source).valid).toBe(false);
  });

  it("never reserves literal payload IDs or display names as syntax bindings", () => {
    const source = draft(variable("template.item"));
    source.template[0] = {
      kind: "declare",
      id: "template.text",
      variable: {
        id: "template.value",
        name: "literal.collision",
        type: "PlainText",
      },
      value: { kind: "literal", type: "PlainText", value: "literal.collision" },
    };
    const compiled = compileCommonUnknownChain(source, {
      createId: sequence("literal.collision", "value.copy"),
    });
    expect(compiled.statement.unknown[0]!.id).toBe("literal.collision");
    const declaration = compiled.statement.unknown[0]!;
    if (declaration.kind !== "declare") throw Error("SHAPE");
    expect(declaration.value).toEqual({
      kind: "literal",
      type: "PlainText",
      value: "literal.collision",
    });
    expect(declaration.variable.name).toBe("literal.collision");
  });
});
