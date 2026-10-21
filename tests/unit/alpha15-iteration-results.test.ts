import { describe, expect, it } from "vitest";
import {
  iterationList, iterationRow, iterationRunStatus, markIteration,
  noteIterationOperation, terminateIterationResults, validIterationResult, iterationResultType,
  boundedTerminalCheckpoint,
} from "../../packages/automation/src/iteration-results.js";
import type { ResumeState, RuntimeContext, RuntimeFrame } from "../../packages/automation/src/store.js";
import type { EvaluatedValue, JsonValue } from "../../packages/automation/src/types.js";

const guildId = "123456789012345678";
const success: EvaluatedValue = { type: "PlainText", value: "private output", provenance: [{ source: "service", guildId, allowedChannelIds: ["223456789012345678"], resumable: true }] };
function loop(identity: string): RuntimeContext {
  const list = iterationList("PlainText", 3, guildId);
  (list.value as JsonValue[])[0] = iterationRow(1, "SUCCEEDED", success);
  return { identity, variables: { [`${identity}-results`]: list }, frames: [{ path: "body", index: 0, locals: [], loop: {
    nodePath: "body/0", items: [1, 2, 3].map((value) => ({ type: "Number", value, provenance: [] })), iteration: 1,
    resultIds: [`${identity}-results`], resultIdentity: identity,
  } }] };
}
function resume(context: RuntimeContext): ResumeState {
  return { ...context, startedAt: "2026-10-15T00:00:00.000Z", steps: 0, evaluations: 0, externalActions: 0,
    iterations: [{ blockId: "loop", identity: context.identity!, states: ["SUCCEEDED", "NOT_STARTED", "NOT_STARTED"] }] };
}
function states(context: RuntimeContext): string[] {
  return (context.variables[`${context.identity}-results`]!.value as { state: string }[]).map((row) => row.state);
}
describe("alpha15 evidence-preserving iteration summaries", () => {
  it('keeps terminal evidence within the state budget when transient execution values no longer fit',()=>{
    const state=resume(loop('main'));
    state.variables.padding={type:'PlainText',value:'private transient'.repeat(5000),provenance:[]};
    noteIterationOperation(state,'UNKNOWN');
    const checkpoint=boundedTerminalCheckpoint(state,'UNKNOWN');
    expect(new TextEncoder().encode(JSON.stringify(checkpoint)).byteLength).toBeLessThanOrEqual(65536);
    expect(checkpoint.frames).toEqual([]);expect(checkpoint.variables).toEqual({});
    expect(iterationRunStatus(checkpoint)[0]!.states).toEqual(['SUCCEEDED','UNKNOWN','NOT_STARTED']);
    expect(JSON.stringify(checkpoint)).not.toContain('private transient');
  });
  it("marks only the uncertain parallel branch and its ancestors unknown", () => {
    const a = loop("branch-a"), b = loop("branch-b"), state = resume(loop("outer"));
    state.parallel = { identity: "parallel", nodePath: "body/0", cursor: 0, branches: [{ id: "a", context: a }, { id: "b", context: b }] };
    state.iterations!.push(...[a, b].map((context) => ({ blockId: "loop", identity: context.identity!, states: ["SUCCEEDED", "NOT_STARTED", "NOT_STARTED"] as const })).map((entry) => ({ ...entry, states: [...entry.states] })));
    noteIterationOperation(a, "UNKNOWN", state);
    terminateIterationResults(state, "UNKNOWN");
    expect(states(a)).toEqual(["SUCCEEDED", "UNKNOWN", "NOT_STARTED"]);
    expect(states(b)).toEqual(["SUCCEEDED", "CANCELLED", "NOT_STARTED"]);
    expect(states(state)).toEqual(["SUCCEEDED", "UNKNOWN", "NOT_STARTED"]);
  });
  it.each(["EXPIRED", "CANCELLED", "FAILED"])("keeps unfinished work distinct from a confirmed operation failure on run %s", (status) => {
    const state = resume(loop("main"));
    terminateIterationResults(state, status);
    expect(states(state)).toEqual(["SUCCEEDED", "CANCELLED", "NOT_STARTED"]);
    expect((state.variables["main-results"]!.value as { outcome: unknown }[])[1]!.outcome).toEqual({ state: "NOT_STARTED", reason: "ITERATION_CANCELLED" });
  });
  it("preserves confirmed failure and unknown evidence under cancellation", () => {
    for (const outcome of ["FAILED", "UNKNOWN", "NOT_STARTED"] as const) {
      const state = resume(loop("main"));
      noteIterationOperation(state, outcome);
      terminateIterationResults(state, "CANCELLED");
      expect(states(state)).toEqual(["SUCCEEDED", outcome, "NOT_STARTED"]);
    }
  });
  it("does not relabel a completed row after another checkpoint or cancellation", () => {
    const state = resume(loop("main")), frame = state.frames[0]!;
    markIteration(state, state, frame, "SUCCEEDED", { "main-results": success });
    noteIterationOperation(state, "UNKNOWN");
    terminateIterationResults(state, "UNKNOWN");
    expect(states(state)).toEqual(["SUCCEEDED", "SUCCEEDED", "NOT_STARTED"]);
    expect((state.variables["main-results"]!.value as { outcome: { value?: string } }[])[1]!.outcome.value).toBe("private output");
    expect(state.variables["main-results"]!.provenance).toContainEqual(expect.objectContaining({ allowedChannelIds: ["223456789012345678"] }));
  });
  it("finds suspended caller result storage while a child procedure is active", () => {
    const state = resume(loop("main")), parentVariables = state.variables;
    state.frames.push({ path: "procedures/0/body", index: 0, locals: [], call: { parentVariables, outputs: {} } });
    state.variables = {};
    const outer: RuntimeFrame = state.frames[0]!;
    markIteration(state, state, outer, "SUCCEEDED", { "main-results": success });
    expect((parentVariables["main-results"]!.value as { state: string }[]).map((row) => row.state)).toEqual(["SUCCEEDED", "SUCCEEDED", "NOT_STARTED"]);
  });
  it("projects only identifiers and states, without item or result payloads", () => {
    const state = resume(loop("main"));
    markIteration(state, state, state.frames[0]!, "SUCCEEDED", { "main-results": success });
    const projection = iterationRunStatus(state);
    expect(projection[0]!.counts.SUCCEEDED).toBe(2);
    expect(JSON.stringify(projection)).not.toContain("private output");
    expect(JSON.stringify(projection)).not.toContain("223456789012345678");
  });
  it("rejects contradictory result summaries and never fabricates successful output", () => {
    const type = iterationResultType("PlainText");
    expect(validIterationResult(type, iterationRow(1, "SUCCEEDED", success))).toBe(true);
    expect(validIterationResult(type, { index: 1, state: "CANCELLED", outcome: { state: "FAILED", reason: "ITERATION_CANCELLED" } })).toBe(false);
    expect(validIterationResult(type, { index: 1, state: "UNKNOWN", outcome: { state: "NOT_STARTED", reason: "ITERATION_UNKNOWN" } })).toBe(false);
    expect(() => iterationRow(1, "SUCCEEDED")).toThrow("AUTOMATION_ITERATION_OUTPUT_MISSING");
  });
});
