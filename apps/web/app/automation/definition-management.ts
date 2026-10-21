import type {
  FlowDefinition,
  ProcedureDefinition,
  PureDefinition,
  ValueInput,
  ValueType,
  VariableDeclaration,
} from "../../../../packages/automation/src/types";
import { DEFAULT_AUTOMATION_LIMITS } from "../../../../packages/automation/src/types";
import { RUN_STARTED_AT_ID } from "../../../../packages/automation/src/builtins";

export type DefinitionKind = "procedure" | "pure";
export type ManagedDefinition = ProcedureDefinition | PureDefinition;
export interface DefinitionIdentity {
  kind: DefinitionKind;
  id: string;
  revision: number;
}
export interface DefinitionReference extends DefinitionIdentity {
  path: string;
  owner: string;
  nodeId?: string;
}
export interface DefinitionDifference {
  path: string;
  before: string;
  after: string;
}
export function definitionManagementSnapshot(flow: FlowDefinition): string {
  const definition = structuredClone(flow);
  delete definition.ui;
  return JSON.stringify(definition);
}
const freshId = () => crypto.randomUUID();
const equalType = (a: ValueType, b: ValueType) =>
  JSON.stringify(a) === JSON.stringify(b);
export const definitionKey = (item: DefinitionIdentity) =>
  `${item.kind}:${item.id}@${item.revision}`;
export const definitionIdentity = (
  kind: DefinitionKind,
  item: ManagedDefinition,
): DefinitionIdentity => ({ kind, id: item.id, revision: item.revision });
export function managedDefinitions(flow: FlowDefinition) {
  return [
    ...(flow.procedures ?? []).map((value) => ({
      kind: "procedure" as const,
      value,
    })),
    ...(flow.pureDefinitions ?? []).map((value) => ({
      kind: "pure" as const,
      value,
    })),
  ];
}
export function findManagedDefinition(
  flow: FlowDefinition,
  identity: DefinitionIdentity,
): ManagedDefinition | undefined {
  return managedDefinitions(flow).find(
    (item) =>
      item.kind === identity.kind &&
      item.value.id === identity.id &&
      item.value.revision === identity.revision,
  )?.value;
}

/** Only executable value/statement trees are visited; ordinary literal data cannot impersonate a call. */
function visit(
  value: unknown,
  path: string,
  callback: (value: Record<string, unknown>, path: string) => void,
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => visit(child, `${path}.${index}`, callback));
    return;
  }
  const object = value as Record<string, unknown>;
  if (
    object.kind === "literal" &&
    !["RichTextSpec", "EmbedSpec", "LegacyMessageSpec"].includes(
      String(object.type),
    )
  ) {
    callback(object, path);
    return;
  }
  for (const [key, child] of Object.entries(object))
    visit(child, `${path}.${key}`, callback);
  // Update inner calls before their parent can reorder or replace argument slots.
  callback(object, path);
}
function visitFlow(
  flow: FlowDefinition,
  callback: (
    value: Record<string, unknown>,
    path: string,
    owner: string,
  ) => void,
) {
  visit(flow.body, "body", (item, path) => callback(item, path, "main"));
  visit(flow.detached, "detached", (item, path) =>
    callback(item, path, "detached"),
  );
  flow.procedures?.forEach((item, index) =>
    visit(item.body, `procedures.${index}.body`, (value, path) =>
      callback(
        value,
        path,
        definitionKey(definitionIdentity("procedure", item)),
      ),
    ),
  );
  flow.pureDefinitions?.forEach((item, index) =>
    visit(item.value, `pureDefinitions.${index}.value`, (value, path) =>
      callback(value, path, definitionKey(definitionIdentity("pure", item))),
    ),
  );
}
export function definitionReferences(
  flow: FlowDefinition,
  target?: DefinitionIdentity,
): DefinitionReference[] {
  const result: DefinitionReference[] = [];
  visitFlow(flow, (object, path, owner) => {
    let reference: DefinitionReference | undefined;
    if (
      object.kind === "call" &&
      typeof object.procedureId === "string" &&
      typeof object.revision === "number"
    )
      reference = {
        kind: "procedure",
        id: object.procedureId,
        revision: object.revision,
        path,
        owner,
        nodeId: String(object.id),
      };
    if (object.kind === "expression") {
      const expression = object.expression as
        | {
            operator?: string;
            options?: { definitionId?: string; revision?: number };
          }
        | undefined;
      if (
        expression?.operator === "pure.call" &&
        expression.options?.definitionId &&
        expression.options.revision
      )
        reference = {
          kind: "pure",
          id: expression.options.definitionId,
          revision: expression.options.revision,
          path,
          owner,
        };
    }
    if (
      reference &&
      (!target || definitionKey(reference) === definitionKey(target))
    )
      result.push(reference);
  });
  return result;
}

/** Definitions have globally distinct local IDs, including across embedded revisions. */
function localIds(definition: ManagedDefinition): string[] {
  const ids = new Set<string>();
  definition.inputs.forEach((item) => ids.add(item.id));
  if ("outputs" in definition)
    definition.outputs.forEach((item) => ids.add(item.id));
  visit(
    "body" in definition ? definition.body : definition.value,
    "",
    (object) => {
      if (
        typeof object.id === "string" &&
        (typeof object.kind === "string" ||
          "type" in object ||
          Array.isArray(object.body))
      )
        ids.add(object.id);
      if (typeof object.bindingId === "string") ids.add(object.bindingId);
    },
  );
  return [...ids];
}
function remapLocals<T extends ManagedDefinition>(
  definition: T,
  mapping: Map<string, string>,
): T {
  const next = structuredClone(definition);
  const remap = (id: unknown) =>
    typeof id === "string" ? (mapping.get(id) ?? id) : id;
  const change = (object: Record<string, unknown>) => {
    for (const key of ["id", "variableId", "bindingId", "branchId", "actionId"])
      if (key in object) object[key] = remap(object[key]);
    if (object.kind === "return")
      object.values = Object.fromEntries(
        Object.entries(object.values as Record<string, ValueInput>).map(
          ([key, value]) => [remap(key), value],
        ),
      );
    if (object.kind === "parallel" && object.outputs)
      object.outputs = Object.fromEntries(
        Object.entries(object.outputs as Record<string, unknown>).map(
          ([key, value]) => [remap(key), value],
        ),
      );
  };
  next.inputs.forEach((item) => {
    item.id = mapping.get(item.id) ?? item.id;
  });
  if ("outputs" in next)
    next.outputs.forEach((item) => {
      item.id = mapping.get(item.id) ?? item.id;
    });
  visit("body" in next ? next.body : next.value, "", change);
  return next;
}
export function createManagedDefinition(
  flow: FlowDefinition,
  kind: DefinitionKind,
  allocateId = freshId,
): ManagedDefinition {
  const id = allocateId();
  if (managedDefinitions(flow).some((item) => item.value.id === id))
    throw new Error("DEFINITION_ID_CONFLICT");
  return kind === "procedure"
    ? {
        id,
        revision: 1,
        name: "New shared procedure",
        inputs: [],
        outputs: [],
        body: [{ id: allocateId(), kind: "return", values: {} }],
      }
    : {
        id,
        revision: 1,
        name: "New pure value",
        inputs: [],
        outputType: "PlainText",
        value: { kind: "missing", type: "PlainText" },
      };
}
export function editPureInputs(
  definition: PureDefinition,
  inputs: VariableDeclaration[],
): PureDefinition {
  const compatible = definition.inputs.every((old) =>
    inputs.some((next) => next.id === old.id && equalType(next.type, old.type)),
  );
  return {
    ...structuredClone(definition),
    inputs: structuredClone(inputs),
    value: compatible
      ? structuredClone(definition.value)
      : { kind: "missing", type: definition.outputType },
  };
}
export function cloneManagedDefinition(
  flow: FlowDefinition,
  source: DefinitionIdentity,
  mode: "revision" | "copy",
  allocateId = freshId,
): ManagedDefinition {
  const found = findManagedDefinition(flow, source);
  if (!found) throw new Error("DEFINITION_MISSING");
  const next = remapLocals(
    found,
    new Map(localIds(found).map((id) => [id, allocateId()])),
  );
  next.id = mode === "copy" ? allocateId() : found.id;
  next.revision =
    mode === "copy"
      ? 1
      : Math.max(
          ...managedDefinitions(flow)
            .filter(
              (item) =>
                item.kind === source.kind && item.value.id === source.id,
            )
            .map((item) => item.value.revision),
        ) + 1;
  if (mode === "copy") next.name = `${found.name} (copy)`.slice(0, 100);
  return next;
}
export function addManagedDefinition(
  flow: FlowDefinition,
  kind: DefinitionKind,
  definition: ManagedDefinition,
): FlowDefinition {
  const identity = definitionIdentity(kind, definition);
  if (findManagedDefinition(flow, identity))
    throw new Error("DEFINITION_ID_CONFLICT");
  if (!definition.name.trim() || definition.name.length > 100)
    throw new Error("DEFINITION_NAME");
  const parameters = [
    ...definition.inputs,
    ...("outputs" in definition ? definition.outputs : []),
  ];
  if (parameters.some((item) => !item.name.trim() || item.name.length > 100))
    throw new Error("DEFINITION_PARAMETER_NAME");
  if (new Set(parameters.map((item) => item.id)).size !== parameters.length)
    throw new Error("DEFINITION_PARAMETER_ID");
  const ids = localIds(definition);
  if (ids.includes(RUN_STARTED_AT_ID)) throw new Error("VARIABLE_RESERVED");
  const next = structuredClone(flow);
  if (kind === "procedure" && "body" in definition)
    (next.procedures ??= []).push(structuredClone(definition));
  else if (kind === "pure" && "value" in definition)
    (next.pureDefinitions ??= []).push(structuredClone(definition));
  else throw new Error("DEFINITION_KIND");
  assertDefinitionGraph(next);
  return next;
}
export function removeManagedDefinition(
  flow: FlowDefinition,
  identity: DefinitionIdentity,
): FlowDefinition {
  if (
    definitionReferences(flow, identity).some(
      (item) => item.owner !== definitionKey(identity),
    )
  )
    throw new Error("DEFINITION_IN_USE");
  const next = structuredClone(flow);
  if (identity.kind === "procedure")
    next.procedures = next.procedures?.filter(
      (item) => item.id !== identity.id || item.revision !== identity.revision,
    );
  else
    next.pureDefinitions = next.pureDefinitions?.filter(
      (item) => item.id !== identity.id || item.revision !== identity.revision,
    );
  return next;
}
function normalized(definition: ManagedDefinition): Record<string, unknown> {
  const copy = remapLocals(
    definition,
    new Map(localIds(definition).map((id, index) => [id, `local-${index}`])),
  ) as unknown as Record<string, unknown>;
  delete copy.id;
  delete copy.revision;
  return copy;
}
export function definitionDifferences(
  before: ManagedDefinition,
  after: ManagedDefinition,
): DefinitionDifference[] {
  const changes: DefinitionDifference[] = [];
  const label = (value: unknown) =>
    value === undefined ? "—" : (JSON.stringify(value) ?? "—").slice(0, 300);
  const compare = (a: unknown, b: unknown, path: string) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (
      a &&
      b &&
      typeof a === "object" &&
      typeof b === "object" &&
      Array.isArray(a) === Array.isArray(b)
    ) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        compare(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          path ? `${path}.${key}` : key,
        );
    } else changes.push({ path, before: label(a), after: label(b) });
  };
  compare(normalized(before), normalized(after), "");
  return changes;
}
export function assertDefinitionGraph(flow: FlowDefinition): void {
  const entries = managedDefinitions(flow),
    known = new Set(
      entries.map((item) =>
        definitionKey(definitionIdentity(item.kind, item.value)),
      ),
    );
  if (known.size !== entries.length) throw new Error("DEFINITION_ID_CONFLICT");
  const references = definitionReferences(flow);
  const walk = (key: string, ancestors: string[]) => {
    if (
      ancestors.includes(key) ||
      ancestors.length >= DEFAULT_AUTOMATION_LIMITS.maxCallDepth
    )
      throw new Error("DEFINITION_CYCLE_OR_DEPTH");
    for (const reference of references.filter(
      (item) => item.owner === key && known.has(definitionKey(item)),
    ))
      walk(definitionKey(reference), [...ancestors, key]);
  };
  for (const key of known) walk(key, []);
}

export interface RepinReview {
  definition: FlowDefinition;
  references: DefinitionReference[];
  resetInputs: number;
  addedOutputs: number;
}
/** Repinning is an explicit draft edit. Existing bindings survive only a unique name/type match. */
export function repinDefinitionReferences(
  flow: FlowDefinition,
  from: DefinitionIdentity,
  to: DefinitionIdentity,
  paths: string[],
  allocateId = freshId,
): RepinReview {
  if (
    from.kind !== to.kind ||
    from.id !== to.id ||
    from.revision === to.revision
  )
    throw new Error("DEFINITION_REPIN_TARGET");
  const previous = findManagedDefinition(flow, from),
    target = findManagedDefinition(flow, to);
  if (!previous || !target) throw new Error("DEFINITION_MISSING");
  const references = definitionReferences(flow, from).filter((item) =>
    paths.includes(item.path),
  );
  if (references.length !== new Set(paths).size)
    throw new Error("DEFINITION_REFERENCE_CHANGED");
  if (
    "outputType" in previous &&
    "outputType" in target &&
    !equalType(previous.outputType, target.outputType)
  )
    throw new Error("DEFINITION_OUTPUT_INCOMPATIBLE");
  const next = structuredClone(flow);
  let resetInputs = 0,
    addedOutputs = 0;
  visitFlow(next, (object, path) => {
    if (!paths.includes(path)) return;
    const matchInput = (parameter: VariableDeclaration) => {
      const matches = previous.inputs
        .map((item, index) => ({ item, index }))
        .filter(
          ({ item }) =>
            item.name === parameter.name &&
            equalType(item.type, parameter.type),
        );
      return matches.length === 1 ? matches[0] : undefined;
    };
    if (
      from.kind === "procedure" &&
      "outputs" in previous &&
      "outputs" in target
    ) {
      const args = object.args as Record<string, ValueInput>,
        outputs = object.outputs as Record<string, VariableDeclaration>;
      if (
        previous.outputs.some(
          (output) =>
            target.outputs.filter(
              (item) =>
                item.name === output.name && equalType(item.type, output.type),
            ).length !== 1,
        )
      )
        throw new Error("DEFINITION_OUTPUT_INCOMPATIBLE");
      object.args = Object.fromEntries(
        target.inputs.map((parameter) => {
          const old = matchInput(parameter),
            value = old && args[old.item.id];
          if (!value) resetInputs++;
          return [
            parameter.id,
            value ?? { kind: "missing", type: parameter.type },
          ];
        }),
      );
      object.outputs = Object.fromEntries(
        target.outputs.map((output) => {
          const old = previous.outputs.find(
              (item) =>
                item.name === output.name && equalType(item.type, output.type),
            ),
            binding = old && outputs[old.id];
          if (!binding) addedOutputs++;
          return [
            output.id,
            binding ?? {
              id: allocateId(),
              name: output.name,
              type: output.type,
            },
          ];
        }),
      );
      object.revision = to.revision;
    } else if (from.kind === "pure") {
      const expression = object.expression as {
        args: ValueInput[];
        options: { revision: number };
      };
      expression.args = target.inputs.map((parameter) => {
        const old = matchInput(parameter),
          value = old && expression.args[old.index];
        if (!value) resetInputs++;
        return value ?? { kind: "missing", type: parameter.type };
      });
      expression.options.revision = to.revision;
    }
  });
  assertDefinitionGraph(next);
  return { definition: next, references, resetInputs, addedOutputs };
}
