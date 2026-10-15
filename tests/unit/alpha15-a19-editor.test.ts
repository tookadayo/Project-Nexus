import { describe, it, expect } from "vitest";
import {
  availableVariables,
  writableVariables,
  cloneStatement,
  createDraft,
  captureActionOutcome,
  childList,
  procedureArea,
  typeName,
} from "../../apps/web/app/automation/model";
import type { Statement, ValueType } from "../../packages/automation/src/types";
import { registeredPairType } from "../../packages/automation/src/registered-pairs";
const step = (id: string): Statement => ({ id, kind: "end" });
describe("alpha15 approved editor result contracts", () => {
  it("keeps literal target IDs and record keys unchanged when they match editor IDs", () => {
    const action: Statement = {
      id: "621111111111111111",
      kind: "action",
      operation: "discord.sendMessage",
      inputs: {
        channel: {
          kind: "literal",
          type: "ChannelRef",
          value: { id: "621111111111111111", guildId: "321111111111111111" },
        },
        content: {
          kind: "literal",
          type: "PlainText",
          value: "Same ID remains data",
        },
      },
    };
    const cloned = cloneStatement(action);
    if (cloned.kind !== "action") throw Error("KIND");
    expect(cloned.id).not.toBe(action.id);
    expect(cloned.inputs.channel).toEqual(action.inputs.channel);
  });
  it("scopes success payload and safe reason into separate readonly result branches", () => {
    const node: Statement = {
      id: "result",
      kind: "resultBranch",
      value: {
        kind: "missing",
        type: { kind: "OperationOutcome", value: "Number" },
      },
      output: { id: "payload", name: "Success", type: "Number" },
      reason: { id: "reason", name: "Reason", type: "PlainText" },
      succeeded: [step("success")],
      failed: [step("failure")],
      notStarted: [step("unstarted")],
      unknown: [step("unknown")],
    };
    const flow = createDraft("321111111111111111", "en");
    flow.body = [node, step("after")];
    const ids = (id: string) =>
      availableVariables(flow, id).map((item) => item.id);
    expect(ids("success")).toContain("payload");
    expect(ids("success")).not.toContain("reason");
    for (const id of ["failure", "unstarted", "unknown"]) {
      expect(ids(id)).toContain("reason");
      expect(ids(id)).not.toContain("payload");
    }
    expect(ids("after")).not.toContain("payload");
    expect(ids("after")).not.toContain("reason");
    expect(writableVariables(flow, "success")).toEqual([]);
    const clone = cloneStatement(node);
    if (clone.kind !== "resultBranch") throw Error("KIND");
    expect(clone.output.id).not.toBe("payload");
    expect(clone.reason?.id).not.toBe("reason");
  });
  it("keeps optional payload only in the present branch and remaps captured action outcome references", () => {
    const optional: Statement = {
      id: "optional",
      kind: "optionalBranch",
      value: {
        kind: "literal",
        type: { kind: "Optional", value: "Number" },
        value: { state: "set", value: 0 },
      },
      output: { id: "present", name: "Present", type: "Number" },
      present: [step("has")],
      unset: [step("none")],
    };
    const flow = createDraft("321111111111111111", "en");
    flow.body = [
      optional,
      {
        id: "send",
        kind: "action",
        operation: "discord.sendMessage",
        inputs: {
          channel: { kind: "missing", type: "ChannelRef" },
          content: { kind: "missing", type: "PlainText" },
        },
        output: { id: "owned-message", name: "Owned", type: "MessageRef" },
      },
    ];
    expect(availableVariables(flow, "has").map((item) => item.id)).toContain(
      "present",
    );
    expect(
      availableVariables(flow, "none").map((item) => item.id),
    ).not.toContain("present");
    const captured = captureActionOutcome(flow, "send", "en");
    const action = captured.body[1],
      result = captured.body[2];
    if (action?.kind !== "action" || result?.kind !== "resultBranch")
      throw Error("KIND");
    expect(action.output).toBeUndefined();
    expect(action.outcome?.type).toEqual({
      kind: "OperationOutcome",
      value: "MessageRef",
    });
    expect(result.output.id).toBe("owned-message");
    expect(result.value).toMatchObject({
      kind: "variable",
      variableId: action.outcome?.id,
    });
    const containing: Statement = {
      id: "whole",
      kind: "repeat",
      count: { kind: "literal", type: "Number", value: 1 },
      itemVariable: { id: "item", name: "Item", type: "Number" },
      body: [action, result],
    };
    const clone = cloneStatement(containing);
    if (clone.kind !== "repeat") throw Error("KIND");
    const clonedAction = clone.body[0],
      clonedBranch = clone.body[1];
    if (
      clonedAction?.kind !== "action" ||
      clonedBranch?.kind !== "resultBranch"
    )
      throw Error("KIND");
    expect(clonedBranch.value).toMatchObject({
      kind: "variable",
      variableId: clonedAction.outcome?.id,
    });
    expect(clonedAction.outcome?.id).not.toBe(action.outcome?.id);
  });
  it("keeps named iteration results readonly after the loop without introducing a back-reference inside it", () => {
    const type: ValueType = {
      kind: "List",
      element: {
        kind: "Record",
        schemaId: "nexus.iteration-result.v1",
        typeArgs: ["Number"],
      },
    };
    const flow = createDraft("321111111111111111", "en");
    flow.body = [
      {
        id: "repeat",
        kind: "repeat",
        count: { kind: "literal", type: "Number", value: 2 },
        itemVariable: { id: "item", name: "Item", type: "Number" },
        body: [step("inside")],
        results: [
          {
            output: { id: "results", name: "Results", type },
            value: { kind: "variable", type: "Number", variableId: "item" },
          },
        ],
      },
      step("after"),
    ];
    expect(
      availableVariables(flow, "inside").map((item) => item.id),
    ).not.toContain("results");
    expect(availableVariables(flow, "after").map((item) => item.id)).toContain(
      "results",
    );
    expect(
      writableVariables(flow, "after").map((item) => item.id),
    ).not.toContain("results");
    const clone = cloneStatement(flow.body[0]!);
    if (clone.kind !== "repeat") throw Error("KIND");
    expect(clone.results?.[0]?.output.id).not.toBe("results");
    expect(clone.results?.[0]?.value).toMatchObject({
      kind: "variable",
      variableId: clone.itemVariable.id,
    });
  });
  it("addresses procedure revisions independently and displays composite Pair types recursively", () => {
    const flow = createDraft("321111111111111111", "en");
    flow.procedures = [
      {
        id: "p",
        revision: 1,
        name: "One",
        inputs: [],
        outputs: [],
        body: [step("v1")],
      },
      {
        id: "p",
        revision: 2,
        name: "Two",
        inputs: [],
        outputs: [],
        body: [step("v2")],
      },
    ];
    expect(childList(flow, undefined, procedureArea("p", 1))?.[0]?.id).toBe(
      "v1",
    );
    expect(childList(flow, undefined, procedureArea("p", 2))?.[0]?.id).toBe(
      "v2",
    );
    const pair = registeredPairType(
      { kind: "Optional", value: "Number" },
      { kind: "List", element: "PlainText" },
    )!;
    expect(typeName(pair)).toBe("Pair<Optional<Number>,List<PlainText>>");
  });
});
