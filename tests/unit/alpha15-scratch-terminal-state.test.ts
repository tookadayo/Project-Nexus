import { expect, it } from "vitest";
import { boundedTerminalCheckpoint } from "../../packages/automation/src/iteration-results";
import type { ResumeState } from "../../packages/automation/src/store";
import { fenceIterationResults } from "../../packages/automation/src/retention";

it("preserves the original loop failure, later hard-stop diagnosis and semantic profile when dropping a terminal payload", () => {
  const state: ResumeState = { semanticProfile: "scratch.v1", checkpointVersion: 9, startedAt: "2026-10-15T12:00:00Z", steps: 4, evaluations: 8, externalActions: 0,
    frames: [], variables: { private: { type: "PlainText", value: "Private transient input".repeat(200), provenance: [] } },
    loopTermination: { version: 1, reason: "condition_unknown", handlerPath: "body/0/handlers/conditionUnknown", pure: false, diagnostics: ["RUN_DEADLINE"] },
    uncertainty: { operationIdentity: "a".repeat(64), handlerPath: "body/0", reason: "UNRESOLVED_EXTERNAL_RESULT", phase: "CAPTURED" } };
  const terminal = boundedTerminalCheckpoint(state, "UNKNOWN", 1500);
  expect(terminal.variables).toEqual({});
  expect(terminal.semanticProfile).toBe("scratch.v1");
  expect(terminal.checkpointVersion).toBe(9);
  expect(terminal.loopTermination).toEqual(state.loopTermination);
  expect(terminal.uncertainty).toEqual(state.uncertainty);
  expect(JSON.stringify(terminal)).not.toContain("Private transient input");
});

it("advances the version at maintenance terminal fences while keeping legacy snapshots unchanged", () => {
  const resume: ResumeState = { semanticProfile: "scratch.v1", checkpointVersion: 7, startedAt: "2026-10-15T12:00:00Z", steps: 2, evaluations: 3, externalActions: 0, frames: [], variables: {} };
  const result=fenceIterationResults({id:'run',revision:1,semantic_hash:'a'.repeat(64),resume},null,[],'EXPIRED');
  expect(result.checkpointVersion).toBe(8);
  const legacy:ResumeState={startedAt:resume.startedAt,steps:2,evaluations:3,externalActions:0,frames:[],variables:{}};
  expect(fenceIterationResults({id:'old',revision:1,semantic_hash:'b'.repeat(64),resume:legacy},null,[],'CANCELLED')).toEqual(legacy);
  expect(legacy.checkpointVersion).toBeUndefined();
});
