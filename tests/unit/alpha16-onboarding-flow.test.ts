import {describe, expect, it} from "vitest";
import {onboardingDraftMutation, onboardingDraftSave, onboardingFlowChanges, onboardingFlowTargetVersion, type CurrentOnboardingFlow} from "../../packages/onboarding/src/flow-drafts";
import {answerFlow, initialFlowState, validateFlow, type Flow} from "../../packages/onboarding/src/flow";
const definition: Flow = {start: "purpose", nodes: [{id: "purpose", question: "Where would you like to start?", options: [{id: "read", label: "Read the guide", next: null}]}]};
const save = {operation: "FLOW_DRAFT_SAVE", label: "Guide", slot: "MAIN", definition, baseFlowId: null, expectedSettingsRevision: 0};
describe("alpha16 native onboarding authoring contracts", () => {
  it("accepts only the native graph and finite authoring fields", () => {
    expect(onboardingDraftSave.parse(save)).toMatchObject({definition, expectedSettingsRevision: 0});
    for (const extra of [{actorHash: "someone"}, {guildId: "111111111111111111"}, {enabled: true}, {code: "eval()"}, {retentionDays: 90}]) expect(() => onboardingDraftSave.parse({...save, ...extra})).toThrow();
    expect(() => onboardingFlowChanges.parse({definition, activate: true})).toThrow();
    expect(() => onboardingDraftSave.parse({...save, definition: {...definition, script: "arbitrary"}})).toThrow();
  });
  it("pairs workspace identity with its exact revision and requires explicit slot/base", () => {
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(() => onboardingDraftSave.parse({...save, workspaceId: id})).toThrow();
    expect(() => onboardingDraftSave.parse({...save, expectedRevision: 1})).toThrow();
    expect(onboardingDraftSave.parse({...save, workspaceId: id, expectedRevision: 1, slot: "HYBRID"})).toMatchObject({slot: "HYBRID", expectedRevision: 1});
    for (const slot of [undefined, "BOTH", "AUTOMATIC"]) expect(() => onboardingDraftSave.parse({...save, slot})).toThrow();
  });
  it("rejects empty placeholders, cycles, unreachable questions and unknown mappings", () => {
    expect(() => onboardingDraftSave.parse({...save, definition: {...definition, nodes: [{...definition.nodes[0], question: ""}]}})).toThrow();
    expect(() => validateFlow({...definition, nodes: [{...definition.nodes[0], options: [{id: "read", label: "Read", next: "purpose"}]}]})).toThrow("FLOW_CYCLE");
    expect(() => validateFlow({...definition, nodes: [...definition.nodes, {id: "unused", question: "Unused", options: [{id: "end", label: "Done", next: null}]}]})).toThrow("UNREACHABLE_NODE");
    expect(() => validateFlow({...definition, nodes: [{...definition.nodes[0], type: "role_select"}]})).toThrow("ROLE_SELECT_REQUIRES_ALLOWLIST");
  });
  it("binds publication to an immutable snapshot, hash and both version checks", () => {
    const publish = {operation: "FLOW_DRAFT_PUBLISH", workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", draftId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", expectedRevision: 2, expectedSettingsRevision: 3, expectedFlowId: null, confirmationHash: "a".repeat(64)};
    expect(onboardingDraftMutation.parse(publish)).toEqual(publish);
    for (const extra of [{confirmationHash: ""}, {expectedRevision: 0}, {expectedSettingsRevision: -1}, {expectedFlowId: "foreign"}]) expect(() => onboardingDraftMutation.parse({...publish, ...extra})).toThrow();
  });
  it("keeps the native target token bounded and seals settings, both heads and definition", () => {
    const current: CurrentOnboardingFlow = {id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", flowVersion: 2147483647, definition, settingsRevision: 2147483647, mainFlowId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", hybridFlowId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", slots: ["MAIN"], contentHash: "f".repeat(64)};
    const token = onboardingFlowTargetVersion(current); expect(token.length).toBeLessThanOrEqual(128);
    for (const change of [{settingsRevision: 2}, {mainFlowId: null}, {hybridFlowId: null}, {definition: {...definition, start: "different"}}]) expect(onboardingFlowTargetVersion({...current, ...change})).not.toBe(token);
  });
  it("previews shared graph branches through the same pure runtime without changing the graph", () => {
    const graph = validateFlow({start: "a", nodes: [{id: "a", question: "Choose", options: [{id: "one", label: "One", next: "b"}, {id: "two", label: "Two", next: "b"}]}, {id: "b", question: "Continue", options: [{id: "end", label: "Finish", next: null}]}]});
    const before = structuredClone(graph), state = answerFlow(graph, initialFlowState(graph), "a", "two"); expect(state.nodeId).toBe("b"); expect(answerFlow(graph, state, "b", "end").complete).toBe(true); expect(graph).toEqual(before);
  });
});
