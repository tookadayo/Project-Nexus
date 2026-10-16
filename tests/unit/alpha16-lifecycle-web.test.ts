import {describe, expect, it} from "vitest";
import {boundedLifecycleStructure, lifecycleRequestExpiry, lifecycleRequestFingerprint, lifecycleWebMutation, LIFECYCLE_WEB_REQUEST_POLICY} from "../../packages/lifecycle/src/web-workspace";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const experiment = {name: "Synthetic comparison", eligibility: [], randomization: "member", blockSeconds: 3600, windowSeconds: 86400, minimumSample: 20, variants: [{key: "control", weight: 50, interventionRevisionId: null}, {key: "treatment", weight: 50, interventionRevisionId: null}], primaryMetric: "activation", guardrails: {maxLeaveRate: 0.1, maxFailureRate: 0.1, maxAlerts: 10}};
describe("alpha16 lifecycle Web mutation boundaries", () => {
  it("does not infer a request lifetime from Fact or suggestion retention", () => {
    expect(LIFECYCLE_WEB_REQUEST_POLICY).toBeUndefined(); const now = new Date("2026-10-16T00:00:00Z");
    expect(() => lifecycleRequestExpiry(undefined, now)).toThrow("LIFECYCLE_REQUEST_RETENTION_UNCONFIGURED");
    expect(lifecycleRequestExpiry({revision: "fixture-only", seconds: 90, purposeReference: "synthetic"}, now).toISOString()).toBe("2026-10-16T00:01:30.000Z");
  });
  it("accepts structured immutable drafts and rejects caller identity, raw code, unknown fields and half source references", () => {
    const draft = {operation: "DRAFT", domain: "experiment", definition: experiment}; expect(lifecycleWebMutation.safeParse(draft).success).toBe(true);
    for (const change of [{actorId: "other"}, {guildId: "other"}, {sourceRevisionId: id}, {code: "run()"}, {activate: true}]) expect(lifecycleWebMutation.safeParse({...draft, ...change}).success).toBe(false);
    expect(lifecycleWebMutation.safeParse({...draft, definition: {...experiment, externalHttp: true}}).success).toBe(false);
  });
  it("binds publication to a preview hash/current head and controls to the observed state", () => {
    expect(lifecycleWebMutation.safeParse({operation: "PUBLISH", domain: "experiment", revisionId: id, expectedHead: null, confirmationHash: "a".repeat(64)}).success).toBe(true);
    expect(lifecycleWebMutation.safeParse({operation: "PUBLISH", domain: "experiment", revisionId: id}).success).toBe(false);
    expect(lifecycleWebMutation.safeParse({operation: "EXPERIMENT_CONTROL", domain: "experiment", revisionId: id, state: "running"}).success).toBe(false);
    expect(lifecycleWebMutation.safeParse({operation: "INTERVENTION_APPROVE", domain: "intervention", runId: id, expectedState: "unknown"}).success).toBe(false);
  });
  it("accepts only explicit pre-admission cancellation and no arbitrary sending or assignment endpoints", () => {
    expect(lifecycleWebMutation.safeParse({operation:'INTERVENTION_CANCEL',domain:'intervention',runId:id,expectedState:'queued'}).success).toBe(true);
    expect(lifecycleWebMutation.safeParse({operation:'INTERVENTION_CANCEL',domain:'intervention',runId:id,expectedState:'unknown'}).success).toBe(false);
    expect(lifecycleWebMutation.safeParse({operation:'INTERVENTION_CANCEL',domain:'experiment',runId:id,expectedState:'queued'}).success).toBe(false);
    for (const operation of ["CANCEL_RUN", "SEND", "ASSIGN", "DELIVER", "RUN_CODE"]) expect(lifecycleWebMutation.safeParse({operation, domain: "intervention", runId: id}).success).toBe(false);
  });
  it("bounds nested input before recursively parsing the legacy definition schema", () => {
    let value: unknown = {}; for (let n = 0; n < 30; ++n) value = {rule: value};
    expect(boundedLifecycleStructure(value)).toBe(false); expect(boundedLifecycleStructure(Array.from({length: 2001}, () => 1))).toBe(false);
    expect(lifecycleWebMutation.safeParse({operation: "DRAFT", domain: "experiment", definition: {...experiment, eligibility: [value]}}).success).toBe(false);
  });
  it("fingerprints canonical content and changes the identity when the state or definition changes", () => {
    const operation = {operation: "EXPERIMENT_CONTROL", domain: "experiment", revisionId: id, expectedState: "running", state: "stopped"};
    expect(lifecycleRequestFingerprint(operation)).toBe(lifecycleRequestFingerprint(Object.fromEntries(Object.entries(operation).reverse())));
    expect(lifecycleRequestFingerprint(operation)).not.toBe(lifecycleRequestFingerprint({...operation, state: "paused"}));
  });
});
