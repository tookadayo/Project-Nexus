import { describe, it, expect } from "vitest";
import {
  availableVariables,
  cloneStatement,
  createDraft,
  locate,
  moveStatement,
  remember,
  undoEdit,
  redoEdit,
  type HistoryState,
} from "../../apps/web/app/automation/model";
import type { Statement } from "../../packages/automation/src/types";
describe("alpha15 editor tree and history", () => {
  it("moves the same IDs between nesting and Not used without flattening or changing values", () => {
    const flow = createDraft("321111111111111111", "en");
    const child: Statement = {
      id: "child",
      kind: "declare",
      variable: { id: "var", name: "A", type: "Number" },
      value: { kind: "literal", type: "Number", value: 0 },
    };
    flow.body = [
      {
        id: "repeat",
        kind: "repeat",
        count: { kind: "literal", type: "Number", value: 0 },
        itemVariable: { id: "item", name: "item", type: "Number" },
        body: [],
      },
      child,
    ];
    const nested = moveStatement(flow, "child", "inside");
    expect(locate(nested, "child")?.parent?.id).toBe("repeat");
    expect(flow.body).toHaveLength(2);
    const unused = moveStatement(nested, "repeat", "unused");
    expect(unused.body).toHaveLength(0);
    expect(locate(unused, "child")?.statement).toEqual(child);
    const restored = moveStatement(unused, "repeat", "restore");
    expect(locate(restored, "child")?.parent?.id).toBe("repeat");
    expect(restored.detached).toEqual([]);
  });
  it("duplicates local IDs and rewrites local references while preserving external references", () => {
    const source: Statement = {
      id: "loop",
      kind: "repeat",
      count: { kind: "variable", type: "Number", variableId: "outside" },
      itemVariable: { id: "item", name: "Item", type: "Number" },
      body: [
        {
          id: "declare",
          kind: "declare",
          variable: { id: "local", name: "Local", type: "Number" },
          value: { kind: "variable", type: "Number", variableId: "item" },
        },
      ],
    };
    const result = cloneStatement(source);
    expect(result.id).not.toBe(source.id);
    if (result.kind !== "repeat") throw new Error("Expected repeat");
    expect(result.count).toEqual(source.count);
    expect(result.itemVariable.id).not.toBe("item");
    const declared = result.body[0];
    if (declared?.kind !== "declare") throw new Error("Expected declare");
    expect(declared.value).toEqual({
      kind: "variable",
      type: "Number",
      variableId: result.itemVariable.id,
    });
  });
  it("does not offer values from a sibling branch or after the selected statement", () => {
    const flow = createDraft("321111111111111111", "en");
    flow.body = [
      {
        id: "start",
        kind: "declare",
        variable: { id: "before", name: "Before", type: "Number" },
        value: { kind: "literal", type: "Number", value: 1 },
      },
      {
        id: "branch",
        kind: "branch",
        condition: { kind: "literal", type: "Boolean", value: true },
        then: [
          {
            id: "inside",
            kind: "declare",
            variable: { id: "inside-var", name: "Inside", type: "Number" },
            value: { kind: "literal", type: "Number", value: 2 },
          },
        ],
        otherwise: [
          {
            id: "selected",
            kind: "wait",
            duration: { kind: "missing", type: "Duration" },
          },
        ],
        unknown: [],
      },
      {
        id: "after",
        kind: "declare",
        variable: { id: "after-var", name: "After", type: "Number" },
        value: { kind: "literal", type: "Number", value: 3 },
      },
    ];
    expect(availableVariables(flow, "selected").map((item) => item.id)).toEqual(
      ["run.startedAt", "before"],
    );
  });
  it("keeps a bounded memory-only edit history and restores stable IDs", () => {
    const definition = createDraft("321111111111111111", "en");
    let state: HistoryState = {
      past: [],
      present: { definition },
      future: [],
      trimmed: false,
    };
    for (let index = 0; index < 60; index++)
      state = remember(state, {
        definition: { ...definition, name: `Edit ${index}` },
        selectedId: "same",
      });
    expect(state.past).toHaveLength(50);
    expect(state.trimmed).toBe(true);
    const previous = undoEdit(state);
    expect(previous.present.definition.name).toBe("Edit 58");
    expect(redoEdit(previous).present).toEqual(state.present);
  });
});
