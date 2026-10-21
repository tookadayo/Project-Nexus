import {describe, expect, it} from "vitest";
import {buildEvaluationRequest, buildNativeRequest, caseContextCatalog, contextSelectionError, emptyNativeForm, sourceKinds, type CaseContextChoice, type EvaluationChoices} from "../../apps/web/app/rules/evaluations/model";
import {nativeSourceRequest} from "../../packages/rules/src/native-source-request";
const flow = "fixture-flow", source = "11111111-1111-4111-8111-111111111111", revision = "22222222-2222-4222-8222-222222222222", now = Date.parse("2026-10-16T12:00:00Z"), start = "2026-10-15T00:00:00Z", end = "2026-10-16T00:00:00Z";
const choices: EvaluationChoices = {cohorts: [], flows: [{id: flow, name: "Fixture", activeRevision: 3, state: "ACTIVE"}], schedules: [], issues: []};
describe("alpha16 typed manual evaluation input", () => {
  it("uses the canonical closed fourteen native kinds and saved active flow version", () => {
    expect(sourceKinds).toHaveLength(14);
    const form = {...emptyNativeForm("AUTO_EXECUTION_OBSERVATION"), selected: flow, windowStart: start, windowEnd: end};
    expect(buildNativeRequest(form, choices, "333333333333333333", now)).toEqual({kind: "AUTO_EXECUTION_OBSERVATION", flowId: flow, liveRevision: 3, windowStart: start, windowEnd: end, periodRole: "CURRENT"});
    expect(buildNativeRequest(form, {...choices, flows: []}, "333333333333333333", now)).toBeNull();
    expect(nativeSourceRequest.safeParse({...buildNativeRequest(form, choices, "333333333333333333", now), approved: true, value: 1}).success).toBe(false);
  });
  it("permits native-generated health while never replacing invalid explicit references or windows", () => {
    const form = {...emptyNativeForm("AUTO_RUN_OUTCOMES"), selected: flow, windowStart: start, windowEnd: end, periodRole: "CURRENT" as const};
    expect(buildNativeRequest(form, choices, "333333333333333333", now)).not.toBeNull();
    expect(buildNativeRequest({...form, healthRefs: [{observationId: "", revision: ""}]}, choices, "333333333333333333", now)).toBeNull();
    expect(buildNativeRequest({...form, healthRefs: [{observationId: source, revision: "saved-v1"}]}, choices, "333333333333333333", now)).not.toBeNull();
    expect(buildNativeRequest({...form, windowEnd: "", healthRefs: [{observationId: source, revision: "saved-v1"}]}, choices, "333333333333333333", now)).toBeNull();
    expect(buildNativeRequest({...form, windowStart: end, windowEnd: start}, choices, "333333333333333333", now)).toBeNull();
  });
  it("binds a cohort to its exact saved source and target version", () => {
    const cohort = {sourceId: source, revisionId: revision, version: 2, baseVersion: 1, draftParentRevisionId: null, enabled: true, definition: {kind: "CHANNEL_PARTICIPATION_COHORT" as const, settingsRevision: 7, campaignClass: "fixture", timeZone: "UTC", channelId: "333333333333333333", channelTargetVersion: "a".repeat(64), populationChannelIds: ["333333333333333333"], signals: ["message.sent" as const], windowDays: 7 as const}, contentHash: "b".repeat(64), createdAt: start, expiresAt: "2026-10-17T00:00:00Z", target: {targetType: "CHANNEL", targetId: "333333333333333333", liveVersion: "a".repeat(64)}};
    const form = {...emptyNativeForm("CHANNEL_PARTICIPATION_COHORT"), selected: source, windowStart: start, windowEnd: end, periodRole: "PREVIOUS" as const};
    expect(buildNativeRequest(form, {...choices, cohorts: [cohort]}, "444444444444444444", now)).toMatchObject({channelId: cohort.target.targetId, liveVersion: cohort.target.liveVersion, sourceConfig: {sourceId: source, revisionId: revision}, periodRole: "PREVIOUS"});
    expect(buildNativeRequest(form, {...choices, cohorts: [{...cohort, expiresAt: start}]}, "444444444444444444", now)).toBeNull();
  });
  it("builds canonical explicit Case-only requests without carrying hidden native or reference fields", () => {
    expect(buildEvaluationRequest(3, [], [], [], true)).toBeNull();
    expect(buildEvaluationRequest(3, [], [{kind: "FACT", id: "unfinished", revision: ""}], ["CASE20", "CASE01"], true)).toEqual({configVersion: 3, inputs: [], requestedCaseIds: ["CASE01", "CASE20"], reason: "MANUAL"});
    expect(buildEvaluationRequest(3, [], [], ["CASE01", "CASE01"], true)).toBeNull();
    expect(buildEvaluationRequest(3, [], [], ["CASE21"], true)).toBeNull();
    expect(buildEvaluationRequest(0, [], [], ["CASE01"], true)).toBeNull();
  });
  it("accepts context-resource-only selection and preserves both canonical selectors", () => {
    expect(buildEvaluationRequest(3, [], [{kind: "FACT", id: "unfinished", revision: ""}], [], true, [revision, source])).toEqual({configVersion: 3, inputs: [], requestedContextIds: [source, revision], reason: "MANUAL"});
    expect(buildEvaluationRequest(3, [], [], ["CASE20", "CASE01"], true, [revision, source])).toEqual({configVersion: 3, inputs: [], requestedCaseIds: ["CASE01", "CASE20"], requestedContextIds: [source, revision], reason: "MANUAL"});
    expect(buildEvaluationRequest(3, [], [], [], false, [source])).toMatchObject({inputs: [], requestedContextIds: [source]});
    expect(buildEvaluationRequest(3, [], [], [], true, [source, source])).toBeNull();
    expect(buildEvaluationRequest(3, [], [], [], true, ["not-a-context-id"])).toBeNull();
    expect(buildEvaluationRequest(3, [], [], [], true, Array.from({length: 21}, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`))).toBeNull();
  });
  it("keeps exact catalog resources, expiry and one resource per Case in the UI selection", () => {
    const first: CaseContextChoice = {id: source, caseId: "CASE01", version: 2, target: {targetType: "GUILD", targetId: "333333333333333333", liveVersion: "native-v2"}, observedAt: start, expiresAt: "2026-10-17T00:00:00Z"};
    const second: CaseContextChoice = {...first, id: revision}, anotherCase: CaseContextChoice = {...second, caseId: "CASE20"};
    expect(caseContextCatalog.safeParse({items: [first], cardinality: "ONE_SELECTED_RESOURCE_PER_CASE_PER_EVALUATION"}).success).toBe(true);
    expect(caseContextCatalog.safeParse({items: [{...first, target: {...first.target, liveVersion: null}}]}).success).toBe(true);
    expect(caseContextCatalog.safeParse({resources: [first]}).success).toBe(false);
    expect(caseContextCatalog.safeParse({items: [{...first, observedFact: 1}]}).success).toBe(false);
    expect(contextSelectionError([source], [first, second], [], now)).toBeNull();
    expect(contextSelectionError([source, revision], [first, anotherCase], ["CASE01", "CASE20"], now)).toBeNull();
    expect(contextSelectionError([source, revision], [first, second], [], now)).toBe("CASE_CONTEXT_AMBIGUOUS");
    expect(contextSelectionError([source], [first], ["CASE20"], now)).toBe("CASE_CONTEXT_SELECTOR_MISMATCH");
    expect(contextSelectionError([source], [{...first, expiresAt: end}], [], now)).toBe("CASE_CONTEXT_NOT_AVAILABLE");
    expect(contextSelectionError([source], [], [], now)).toBe("CASE_CONTEXT_NOT_AVAILABLE");
    expect(contextSelectionError([source, source], [first], [], now)).toBe("CASE_CONTEXT_SELECTOR_INVALID");
    expect(contextSelectionError([], [first, second], ["CASE01"], now)).toBeNull();
  });
});
