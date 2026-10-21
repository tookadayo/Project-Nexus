import { describe, expect, it } from "vitest";
import {
  compileFlowDefinition,
  validateFlowDefinition,
} from "../../packages/automation/src/definition";
import { evaluateValue } from "../../packages/automation/src/expression";
import {
  addManagedDefinition,
  cloneManagedDefinition,
  createManagedDefinition,
  definitionDifferences,
  definitionManagementSnapshot,
  definitionReferences,
  editPureInputs,
  removeManagedDefinition,
  repinDefinitionReferences,
  type DefinitionIdentity,
} from "../../apps/web/app/automation/definition-management";
import type {
  FlowDefinition,
  ProcedureDefinition,
  PureDefinition,
  ValueInput,
} from "../../packages/automation/src/types";

const flow = (): FlowDefinition => ({
  schemaVersion: 1,
  id: "managed-flow",
  guildId: "321111111111111111",
  name: "Managed definitions",
  trigger: { kind: "manual", inputs: [] },
  variables: [],
  body: [],
});
const procedure = (): ProcedureDefinition => ({
  id: "echo",
  revision: 1,
  name: "Echo",
  inputs: [{ id: "echo-input", name: "Count", type: "Number" }],
  outputs: [{ id: "echo-output", name: "Result", type: "Number" }],
  body: [
    {
      id: "echo-return",
      kind: "return",
      values: {
        "echo-output": {
          kind: "variable",
          type: "Number",
          variableId: "echo-input",
        },
      },
    },
  ],
});
const pure = (): PureDefinition => ({
  id: "double",
  revision: 1,
  name: "Double",
  inputs: [{ id: "double-input", name: "Count", type: "Number" }],
  outputType: "Number",
  value: {
    kind: "expression",
    type: "Number",
    expression: {
      operator: "number.multiply",
      args: [
        { kind: "variable", type: "Number", variableId: "double-input" },
        { kind: "literal", type: "Number", value: 2 },
      ],
    },
  },
});
const procId: DefinitionIdentity = {
  kind: "procedure",
  id: "echo",
  revision: 1,
};
const pureId: DefinitionIdentity = { kind: "pure", id: "double", revision: 1 };
const allocator = () => {
  let counter = 0;
  return () => `fresh-${++counter}`;
};
const call = (id: string) => ({
  id,
  kind: "call" as const,
  procedureId: "echo",
  revision: 1,
  args: {
    "echo-input": {
      kind: "literal" as const,
      type: "Number" as const,
      value: 4,
    },
  },
  outputs: {
    "echo-output": {
      id: `result-${id}`,
      name: "Result",
      type: "Number" as const,
    },
  },
});
const pureCall = (): ValueInput => ({
  kind: "expression",
  type: "Number",
  expression: {
    operator: "pure.call",
    args: [{ kind: "literal", type: "Number", value: 5 }],
    options: { definitionId: "double", revision: 1 },
  },
});

describe("alpha15 embedded definition management", () => {
  it("keeps stable parameter references on rename, and exposes incompatible type edits as unset", () => {
    const original = pure(),
      renamed = editPureInputs(original, [
        { ...original.inputs[0]!, name: "Renamed count" },
      ]);
    expect(renamed.value).toEqual(original.value);
    expect(renamed.inputs[0]!.id).toBe(original.inputs[0]!.id);
    expect(
      editPureInputs(original, [{ ...original.inputs[0]!, type: "PlainText" }])
        .value,
    ).toEqual({ kind: "missing", type: "Number" });
    expect(original.inputs[0]!.name).toBe("Count");
  });
  it("creates a valid empty shared procedure with an explicit normal return", () => {
    const original = flow(),
      definition = createManagedDefinition(original, "procedure", allocator());
    const next = addManagedDefinition(original, "procedure", definition);
    expect(validateFlowDefinition(next).valid).toBe(true);
    expect(original.procedures).toBeUndefined();
    expect(next.procedures?.[0]?.body[0]?.kind).toBe("return");
  });
  it("clones a fixed revision with fresh local IDs and remaps named returns", () => {
    const original = { ...flow(), procedures: [procedure()] },
      snapshot = structuredClone(original);
    const clone = cloneManagedDefinition(
      original,
      procId,
      "revision",
      allocator(),
    ) as ProcedureDefinition;
    expect(clone.id).toBe("echo");
    expect(clone.revision).toBe(2);
    expect(clone.inputs[0]!.id).not.toBe("echo-input");
    expect(clone.outputs[0]!.id).not.toBe("echo-output");
    const returned = clone.body[0];
    expect(returned?.kind).toBe("return");
    if (returned?.kind === "return")
      expect(returned.values[clone.outputs[0]!.id]).toMatchObject({
        kind: "variable",
        variableId: clone.inputs[0]!.id,
      });
    expect(
      validateFlowDefinition(addManagedDefinition(original, "procedure", clone))
        .valid,
    ).toBe(true);
    expect(original).toEqual(snapshot);
  });
  it("copies into an independent identity rather than repinning existing callers", () => {
    const original = {
      ...flow(),
      procedures: [procedure()],
      body: [call("first")],
    };
    const copy = cloneManagedDefinition(original, procId, "copy", allocator());
    const next = addManagedDefinition(original, "procedure", copy);
    expect(copy.id).not.toBe("echo");
    expect(copy.revision).toBe(1);
    expect(next.body[0]).toMatchObject({ procedureId: "echo", revision: 1 });
  });
  it("shows behavioral differences without reporting regenerated local IDs", () => {
    const original = { ...flow(), procedures: [procedure()] };
    const clone = cloneManagedDefinition(
      original,
      procId,
      "revision",
      allocator(),
    );
    expect(definitionDifferences(original.procedures[0]!, clone)).toEqual([]);
    expect(
      definitionManagementSnapshot({
        ...original,
        ui: { selectedId: "another-step", collapsed: ["echo-return"] },
      }),
    ).toBe(definitionManagementSnapshot(original));
    expect(
      definitionManagementSnapshot({
        ...original,
        name: "Changed behavior review",
      }),
    ).not.toBe(definitionManagementSnapshot(original));
    clone.name = "Edited label";
    expect(definitionDifferences(original.procedures[0]!, clone)).toEqual([
      { path: "name", before: '"Echo"', after: '"Edited label"' },
    ]);
  });
  it("updates only reviewed callers, retaining compatible arguments and consumer bindings", () => {
    let original: FlowDefinition = {
      ...flow(),
      procedures: [procedure()],
      body: [call("first"), call("second")],
    };
    const version = cloneManagedDefinition(
      original,
      procId,
      "revision",
      allocator(),
    );
    original = addManagedDefinition(original, "procedure", version);
    const refs = definitionReferences(original, procId);
    const review = repinDefinitionReferences(
      original,
      procId,
      { ...procId, revision: 2 },
      [refs[0]!.path],
    );
    expect(review.references).toHaveLength(1);
    expect(review.resetInputs).toBe(0);
    expect(review.definition.body[0]).toMatchObject({
      revision: 2,
      args: { [version.inputs[0]!.id]: { value: 4 } },
      outputs: {
        [(version as ProcedureDefinition).outputs[0]!.id]: {
          id: "result-first",
        },
      },
    });
    expect(review.definition.body[1]).toMatchObject({ revision: 1 });
    expect(original.body[0]).toMatchObject({ revision: 1 });
    expect(validateFlowDefinition(review.definition).valid).toBe(true);
  });
  it("requires explicit new arguments rather than using placeholders as values", () => {
    let original: FlowDefinition = {
      ...flow(),
      procedures: [procedure()],
      body: [call("first")],
    };
    const version = cloneManagedDefinition(
      original,
      procId,
      "revision",
      allocator(),
    );
    version.inputs.push({
      id: "new-argument",
      name: "New argument",
      type: "Duration",
    });
    original = addManagedDefinition(original, "procedure", version);
    const review = repinDefinitionReferences(
      original,
      procId,
      { ...procId, revision: 2 },
      ["body.0"],
    );
    expect(review.resetInputs).toBe(1);
    expect(review.definition.body[0]).toMatchObject({
      args: { "new-argument": { kind: "missing", type: "Duration" } },
    });
    expect(
      validateFlowDefinition(review.definition).issues.some(
        (item) => item.code === "MISSING_INPUT",
      ),
    ).toBe(true);
  });
  it("refuses incompatible existing results instead of breaking downstream bindings", () => {
    let original: FlowDefinition = {
      ...flow(),
      procedures: [procedure()],
      body: [call("first")],
    };
    const version = cloneManagedDefinition(
      original,
      procId,
      "revision",
      allocator(),
    ) as ProcedureDefinition;
    version.outputs[0]!.type = "PlainText";
    original = addManagedDefinition(original, "procedure", version);
    expect(() =>
      repinDefinitionReferences(original, procId, { ...procId, revision: 2 }, [
        "body.0",
      ]),
    ).toThrow("DEFINITION_OUTPUT_INCOMPATIBLE");
    expect(original.body[0]).toMatchObject({ revision: 1 });
  });
  it("lists pure expression dependencies and explicitly repins a compatible version", () => {
    let original: FlowDefinition = {
      ...flow(),
      pureDefinitions: [pure()],
      body: [
        {
          id: "use-pure",
          kind: "declare",
          variable: { id: "total", name: "Total", type: "Number" },
          value: pureCall(),
        },
      ],
    };
    const version = cloneManagedDefinition(
      original,
      pureId,
      "revision",
      allocator(),
    ) as PureDefinition;
    original = addManagedDefinition(original, "pure", version);
    const refs = definitionReferences(original, pureId);
    expect(refs).toMatchObject([{ path: "body.0.value", owner: "main" }]);
    const review = repinDefinitionReferences(
      original,
      pureId,
      { ...pureId, revision: 2 },
      [refs[0]!.path],
    );
    const statement = review.definition.body[0];
    if (statement?.kind !== "declare") throw new Error("Wrong fixture");
    expect(
      evaluateValue(statement.value, {
        guildId: original.guildId,
        variables: {},
        pureDefinitions: review.definition.pureDefinitions,
      }).value,
    ).toBe(10);
    expect(validateFlowDefinition(review.definition).valid).toBe(true);
  });
  it("reports callers inside both definition kinds and prevents deleting referenced versions", () => {
    const original: FlowDefinition = {
      ...flow(),
      procedures: [
        {
          ...procedure(),
          body: [
            {
              id: "return-pure",
              kind: "return",
              values: { "echo-output": pureCall() },
            },
          ],
        },
      ],
      pureDefinitions: [pure()],
    };
    expect(definitionReferences(original, pureId)[0]?.owner).toBe(
      "procedure:echo@1",
    );
    expect(() => removeManagedDefinition(original, pureId)).toThrow(
      "DEFINITION_IN_USE",
    );
    const removed = removeManagedDefinition(original, procId);
    expect(removeManagedDefinition(removed, pureId).pureDefinitions).toEqual(
      [],
    );
  });
  it("repins nested calls before a parent reorders the argument slots", () => {
    const nested = pureCall();
    if (nested.kind !== "expression") throw new Error("Wrong fixture");
    nested.expression.args[0] = pureCall();
    let original: FlowDefinition = {
      ...flow(),
      pureDefinitions: [pure()],
      body: [
        {
          id: "nested",
          kind: "declare",
          variable: {
            id: "nested-result",
            name: "Nested result",
            type: "Number",
          },
          value: nested,
        },
      ],
    };
    const version = cloneManagedDefinition(
      original,
      pureId,
      "revision",
      allocator(),
    ) as PureDefinition;
    version.inputs.unshift({ id: "additional", name: "Extra", type: "Number" });
    original = addManagedDefinition(original, "pure", version);
    const references = definitionReferences(original, pureId);
    const review = repinDefinitionReferences(
      original,
      pureId,
      { ...pureId, revision: 2 },
      references.map((item) => item.path),
    );
    expect(review.resetInputs).toBe(2);
    const root = review.definition.body[0];
    if (root?.kind !== "declare" || root.value.kind !== "expression")
      throw new Error("Wrong fixture");
    expect(root.value.expression.options?.revision).toBe(2);
    expect(root.value.expression.args[0]).toMatchObject({ kind: "missing" });
    expect(root.value.expression.args[1]).toMatchObject({
      kind: "expression",
      expression: {
        options: { revision: 2 },
        args: [{ kind: "missing" }, { kind: "literal", value: 5 }],
      },
    });
  });
  it("rejects duplicate identities, reserved variables, recursion and excessive depth", () => {
    const original: FlowDefinition = { ...flow(), procedures: [procedure()] };
    expect(() =>
      addManagedDefinition(original, "procedure", procedure()),
    ).toThrow("DEFINITION_ID_CONFLICT");
    const reserved = procedure();
    reserved.id = "reserved";
    reserved.inputs[0]!.id = "run.startedAt";
    expect(() => addManagedDefinition(flow(), "procedure", reserved)).toThrow(
      "VARIABLE_RESERVED",
    );
    const recursive = procedure();
    recursive.body.unshift(call("recursive"));
    expect(() => addManagedDefinition(flow(), "procedure", recursive)).toThrow(
      "DEFINITION_CYCLE_OR_DEPTH",
    );
  });
  it("lets a user add definitions while unrelated unfinished call slots remain", () => {
    const original: FlowDefinition = {
      ...flow(),
      body: [{ ...call("unset"), procedureId: "", args: {}, outputs: {} }],
    };
    expect(() =>
      addManagedDefinition(original, "procedure", procedure()),
    ).not.toThrow();
  });
  it("enforces the existing shared call-depth limit across fixed versions", () => {
    let current = flow();
    for (let index = 0; index < 3; index++) {
      const definition: ProcedureDefinition = {
        id: `chain-${index}`,
        revision: 1,
        name: `Chain ${index}`,
        inputs: [],
        outputs: [],
        body: [
          {
            id: `chain-call-${index}`,
            kind: "call",
            procedureId: `chain-${index + 1}`,
            revision: 1,
            args: {},
            outputs: {},
          },
          { id: `chain-return-${index}`, kind: "return", values: {} },
        ],
      };
      current = addManagedDefinition(current, "procedure", definition);
    }
    const last: ProcedureDefinition = {
      id: "chain-3",
      revision: 1,
      name: "Last",
      inputs: [],
      outputs: [],
      body: [{ id: "last-return", kind: "return", values: {} }],
    };
    expect(() => addManagedDefinition(current, "procedure", last)).toThrow(
      "DEFINITION_CYCLE_OR_DEPTH",
    );
  });
  it("does not mistake ordinary record literal data for executable references", () => {
    const original: FlowDefinition = {
      ...flow(),
      body: [
        {
          id: "literal",
          kind: "declare",
          variable: {
            id: "record",
            name: "Record",
            type: { kind: "Record", schemaId: "registered.example" },
          },
          value: {
            kind: "literal",
            type: { kind: "Record", schemaId: "registered.example" },
            value: { kind: "call", procedureId: "echo", revision: 1 },
          },
        },
      ],
    };
    expect(definitionReferences(original)).toEqual([]);
  });
  it("remaps lexical expression binders while keeping external fixed-definition identities", () => {
    const definition = pure();
    definition.outputType = { kind: "List", element: "Number" };
    definition.value = {
      kind: "expression",
      type: definition.outputType,
      expression: {
        operator: "list.map",
        args: [
          {
            kind: "literal",
            type: { kind: "List", element: "Number" },
            value: [1],
          },
        ],
        options: {
          bindingId: "map-item",
          body: { kind: "variable", type: "Number", variableId: "map-item" },
        },
      },
    };
    const original = { ...flow(), pureDefinitions: [definition] };
    const cloned = cloneManagedDefinition(
      original,
      pureId,
      "revision",
      allocator(),
    ) as PureDefinition;
    if (cloned.value.kind !== "expression") throw new Error("Wrong fixture");
    expect(cloned.value.expression.options?.bindingId).not.toBe("map-item");
    expect(cloned.value.expression.options?.body).toMatchObject({
      variableId: cloned.value.expression.options?.bindingId,
    });
    expect(() =>
      compileFlowDefinition(addManagedDefinition(original, "pure", cloned)),
    ).not.toThrow();
  });
  it("keeps explicit approval references inside the newly cloned procedure", () => {
    const original = procedure();
    original.inputs = [];
    original.outputs = [];
    original.body = [
      {
        id: "approval",
        kind: "approval",
        actionId: "role-action",
        until: {
          kind: "literal",
          type: "Instant",
          value: "2026-10-15T00:10:00Z",
        },
        approved: [
          {
            id: "role-action",
            kind: "action",
            operation: "discord.addRole",
            approvalRequired: true,
            inputs: {},
          },
          { id: "approved-return", kind: "return", values: {} },
        ],
        rejected: [{ id: "rejected-return", kind: "return", values: {} }],
        expired: [{ id: "expired-return", kind: "return", values: {} }],
      },
    ];
    const next = cloneManagedDefinition(
      { ...flow(), procedures: [original] },
      procId,
      "revision",
      allocator(),
    ) as ProcedureDefinition;
    const approval = next.body[0];
    if (approval?.kind !== "approval") throw new Error("Wrong fixture");
    expect(approval.actionId).toBe(approval.approved[0]!.id);
    expect(approval.actionId).not.toBe("role-action");
    expect(original.body[0]).toMatchObject({ actionId: "role-action" });
  });
});
