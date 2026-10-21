import { describe, expect, it } from "vitest";
import { compileCommonUnknownChain, saveCommonUnknownDraft, validateScratchAuthoring,
  type CommonUnknownDraft } from "../../packages/automation/src/scratch-authoring";
import { canonicalDefinition, semanticHash, validateFlowDefinition } from "../../packages/automation/src/definition";
import type { FlowDefinition, Statement, ValueInput } from "../../packages/automation/src/types";
import { simulateAutomationPlan } from "../../packages/automation/src/simulation";

const number = (value: number): ValueInput => ({ kind: "literal", type: "Number", value });
const condition = (value: "true" | "false" | "unknown"): ValueInput => ({ kind: "literal", type: "ConditionResult", value });
const variable = (variableId: string): ValueInput => ({ kind: "variable", type: "Number", variableId });
const flow = (): FlowDefinition => ({ schemaVersion: 1, semanticProfile: "scratch.v1", id: "flow", guildId: "123456789012345678",
  name: "Common unknown", trigger: { kind: "manual", inputs: [] }, variables: [], body: [
    { kind: "declare", id: "root.declare", variable: { id: "root.value", name: "Result", type: "Number" }, value: number(0) },
  ] });
const draft = (): CommonUnknownDraft => ({ id: "chain", clauses: [
  { id: "first", condition: condition("false"), then: [] },
  { id: "second", condition: condition("unknown"), then: [] },
], otherwise: [], template: [
  { id: "template.declare", kind: "declare", variable: { id: "template.local", name: "Local", type: "Number" }, value: number(2) },
  { id: "template.assign", kind: "assign", variableId: "root.value", value: { kind: "expression", type: "Number",
    expression: { operator: "number.add", args: [variable("root.value"), variable("template.local")] } } },
] });
const ids = () => { let value = 0; return () => `generated.${++value}`; };

describe("Scratch common unknown compiler and revision evidence", () => {
  it("uses hygienic stable copies while keeping external bindings shared", () => {
    const compiled = compileCommonUnknownChain(draft(), { createId: ids() });
    const first = compiled.statement, second = first.otherwise[0]!;
    if (second.kind !== "branch") throw Error("BRANCH");
    expect(first.unknown[0]!.id).not.toBe(second.unknown[0]!.id);
    const declaration = first.unknown[0]!, assignment = first.unknown[1]!;
    if (declaration.kind !== "declare" || assignment.kind !== "assign" || assignment.value.kind !== "expression") throw Error("SHAPE");
    expect(assignment.variableId).toBe("root.value");
    expect(assignment.value.expression.args[1]).toEqual(variable(declaration.variable.id));
    expect(declaration.variable.id).not.toBe("template.local");
  });
  it("saves the tree and mapping as one strictly validated revision snapshot", () => {
    const original = flow(), next = saveCommonUnknownDraft(original, draft(), { createId: ids() });
    expect(original.scratchAuthoring).toBeUndefined();
    expect(original.body).toHaveLength(1);
    expect(validateScratchAuthoring(next)).toEqual([]);
    expect(validateFlowDefinition(next).issues).toEqual([]);
    const roundTrip = JSON.parse(JSON.stringify(next)) as FlowDefinition;
    expect(canonicalDefinition(roundTrip)).toEqual(canonicalDefinition(next));
    expect(semanticHash(roundTrip)).toBe(semanticHash(next));
  });
  it("executes only the selected unknown copy and keeps ordinary CT01 joining", () => {
    const next = saveCommonUnknownDraft(flow(), draft(), { createId: ids() });
    next.body.push({ kind: "assign", id: "after", variableId: "root.value", value: number(9) });
    const checked = validateFlowDefinition(next);
    expect(checked.plan).toBeDefined();
    const result = simulateAutomationPlan(checked.plan!);
    expect(result.status).toBe("COMPLETED");
    const copies = next.scratchAuthoring!.chains[0]!.copies;
    expect(result.steps.some((step) => step.blockId === copies[0]!.nodeIds["template.assign"])).toBe(false);
    expect(result.steps.filter((step) => step.blockId === copies[1]!.nodeIds["template.assign"])).toHaveLength(1);
    expect(result.steps.at(-1)?.blockId).toBe("after");
  });
  it("updates all template copies together without replacing surviving IDs", () => {
    const first = saveCommonUnknownDraft(flow(), draft(), { createId: ids() });
    const change = draft(); const declaration = change.template[0]!;
    if (declaration.kind !== "declare") throw Error("DECLARE"); declaration.value = number(5);
    const next = saveCommonUnknownDraft(first, change, { createId: () => { throw Error("UNEXPECTED_NEW_ID"); } });
    expect(next.scratchAuthoring!.chains[0]!.copies).toEqual(first.scratchAuthoring!.chains[0]!.copies);
    expect(semanticHash(next)).not.toBe(semanticHash(first));
    expect(validateFlowDefinition(next).valid).toBe(true);
  });
  it("can reorder clauses while preserving node identities and replacing the prior entry", () => {
    const first = saveCommonUnknownDraft(flow(), draft(), { createId: ids() });
    const changed = draft(); changed.clauses.reverse();
    const next = saveCommonUnknownDraft(first, changed);
    expect(next.body[1]?.id).toBe("second");
    expect(next.scratchAuthoring!.chains[0]!.entryId).toBe("second");
    expect(next.scratchAuthoring!.chains[0]!.copies[0]).toEqual(first.scratchAuthoring!.chains[0]!.copies[1]);
    expect(validateFlowDefinition(next).valid).toBe(true);
  });
  it("rejects stale metadata or a directly changed executable copy", () => {
    const next = saveCommonUnknownDraft(flow(), draft(), { createId: ids() });
    const node = next.body[1]!;
    if (node.kind !== "branch") throw Error("BRANCH"); node.unknown = [];
    expect(validateScratchAuthoring(next)[0]?.code).toBe("SCRATCH_AUTHORING");
    expect(validateFlowDefinition(next).valid).toBe(false);
  });
  it("does not adopt an existing tree or upgrade its missing semantic profile", () => {
    const original = flow(); delete original.semanticProfile;
    expect(() => saveCommonUnknownDraft(original, draft())).toThrow("SCRATCH_AUTHORING_INVALID");
    const existing = flow(); existing.body.push({ id: "first", kind: "branch", condition: condition("true"), then: [], otherwise: [], unknown: [] });
    expect(() => saveCommonUnknownDraft(existing, draft())).toThrow("SCRATCH_EXISTING_TREE_CONVERSION");
  });
  it("rejects template capture of locals declared only inside a clause", () => {
    const source = draft(); source.clauses[0]!.then = [{ id: "then.declare", kind: "declare", variable: { id: "hidden", name: "Hidden", type: "Number" }, value: number(4) }];
    source.template = [{ id: "capture", kind: "assign", variableId: "root.value", value: variable("hidden") }];
    const next = saveCommonUnknownDraft(flow(), source, { createId: ids() });
    expect(validateFlowDefinition(next).valid).toBe(false);
  });
  it("remaps internal approval targets but never literal Ref IDs or text", () => {
    const source = draft(); source.template = [
      { kind: "approval", id: "approval", actionId: "123456789012345678", until: { kind: "literal", type: "Instant", value: "2026-10-15T20:00:00Z" }, approved: [], rejected: [], expired: [] },
      { kind: "action", id: "123456789012345678", operation: "discord.sendMessage", inputs: {
        channel: { kind: "literal", type: "ChannelRef", value: { id: "123456789012345678", guildId: "123456789012345678" } },
        content: { kind: "literal", type: "PlainText", value: "123456789012345678" },
      } },
    ];
    const compiled = compileCommonUnknownChain(source, { createId: ids() });
    const approval = compiled.statement.unknown[0]!, action = compiled.statement.unknown[1]!;
    if (approval.kind !== "approval" || action.kind !== "action") throw Error("SHAPE");
    expect(approval.actionId).toBe(action.id);
    expect(action.inputs).toEqual((source.template[1] as Extract<Statement, { kind: "action" }>).inputs);
  });
  it("rejects duplicate generated IDs rather than sharing execution nodes", () => {
    expect(() => compileCommonUnknownChain(draft(), { createId: () => "same" })).toThrow("SCRATCH_COPY_ID_COLLISION");
  });
});
