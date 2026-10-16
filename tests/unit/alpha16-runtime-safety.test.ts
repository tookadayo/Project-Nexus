import { describe, expect, it } from "vitest";
import {
  assertCurrentLease, assertRuleExternalEffectActivation, assertRuntimeOperatingProfile,
  assertSendAdmission, cancellationResult, canReleaseApplyReservation,
  classifyExternalFailure, explicitNewIntentSafety, inheritTargetSafety,
  missedScheduleDecision, queueRecoveryDecision, reconcileReadOnly,
  restoredDispatchGate, suggestionConsumedBy, targetSafetyGate, unknownTerminalPlan,
  type RuntimeOperatingProfile, type SendAdmissionCheck, type TargetSafetyState,
} from "../../packages/rules/src/runtime-safety";

const scope = { organizationId: "00000000-0000-4000-8000-000000000001", guildId: "123456789012345678" };
const now = new Date("2026-10-16T12:00:00.000Z");
const expiry = "2026-10-16T13:00:00.000Z";
// Synthetic operating values serve this fixture only. The production registry
// has no approved profile or fallback to these values.
const profile: RuntimeOperatingProfile = {
  purpose: "APPROVED_RUNTIME", approvalRevision: "fixture-approval",
  heartbeatMs: 100, leaseMs: 500, requestDeadlineMs: 300,
  unknownResolutionMs: 1_000, operationTokenTtlMs: 400,
};
function target(): TargetSafetyState {
  return { ...scope, targetType: "AUTOMATION_FLOW", targetId: "flow-1", liveVersion: "1",
    safetyEpoch: "4", stateVersion: "2", applyGate: "OPEN", expiresAt: expiry, policyRevision: "fixture-retention" };
}
function targetCheck() {
  return { scope, targetType: "AUTOMATION_FLOW", targetId: "flow-1", liveVersion: "1",
    safetyEpoch: "4", now, approvedPolicyRevision: "fixture-retention", latestStateVerified: true };
}
function admission(): SendAdmissionCheck {
  return {
    scope, now, target: target(), targetPolicyRevision: "fixture-retention", latestTargetStateVerified: true,
    writerCompatibilityVerified: true, currentlyAuthorized: true, approvalCurrent: true,
    tombstoned: false, cancelled: false, inputEvidenceCurrent: true, intentState: "CLAIMED",
    operationGuardOpen: true, runtimeProfile: profile,
    expectedBinding: { ...scope, intentId: "intent-1", targetType: "AUTOMATION_FLOW", targetId: "flow-1",
      liveVersion: "1", action: "SEND_MESSAGE", suggestionId: "suggestion-1", suggestionVersion: "2",
      draftId: "draft-1", immutableDraftRevisionId: "revision-2", draftContentHash: "a".repeat(64),
      approvalId: "approval-1", safetyEpoch: "4", issuedAt: "2026-10-16T11:59:00.000Z", expiresAt: expiry },
    lease: { resourceType: "INTENT", resourceId: "intent-1", workerId: "worker-1", fenceToken: "9", state: "HELD", expiresAt: expiry },
    worker: { resourceType: "INTENT", resourceId: "intent-1", workerId: "worker-1", fenceToken: "9" },
  };
}

describe("alpha16 target-root safety, including VI F06", () => {
  it("admits an exact, current, approved root", () => expect(targetSafetyGate(target(), targetCheck())).toEqual({ allowed: true }));
  it.each([
    [null, "TARGET_SAFETY_MISSING"],
    [{ ...target(), expiresAt: now.toISOString() }, "TARGET_SAFETY_EXPIRED"],
    [{ ...target(), applyGate: "UNKNOWN_BLOCKED" as const, liveVersion: "old" }, "TARGET_RESULT_UNKNOWN"],
    [{ ...target(), guildId: "999999999999999999" }, "TARGET_SAFETY_SCOPE_MISMATCH"],
    [{ ...target(), policyRevision: "unapproved" }, "TARGET_SAFETY_POLICY_UNAPPROVED"],
    [{ ...target(), safetyEpoch: "3" }, "TARGET_SAFETY_EPOCH_MISMATCH"],
  ] as const)("fails closed for unavailable or incompatible state", (state, reason) => {
    expect(targetSafetyGate(state, targetCheck())).toEqual({ allowed: false, reason });
  });
  it("does not adopt a candidate retention or trust restored OPEN", () => {
    expect(targetSafetyGate(target(), { ...targetCheck(), approvedPolicyRevision: null }).allowed).toBe(false);
    expect(targetSafetyGate(target(), { ...targetCheck(), latestStateVerified: false }).allowed).toBe(false);
  });
  it("ordinary live revisions and rollback inherit UNKNOWN, even after Run purge", () => {
    const unknown = { ...target(), applyGate: "UNKNOWN_BLOCKED" as const };
    const next = inheritTargetSafety(unknown, "2");
    expect(next?.applyGate).toBe("UNKNOWN_BLOCKED");
    expect(targetSafetyGate(next, { ...targetCheck(), liveVersion: "2" }).allowed).toBe(false);
    expect(inheritTargetSafety(null, "2")).toBeNull();
  });
  it("terminal UNKNOWN preserves terminalAt and carries no Run/payload/result/evidence", () => {
    const originalTerminal = "2026-10-16T11:00:00.000Z";
    const plan = unknownTerminalPlan({ target: target(), now, terminalAt: originalTerminal, approvedPolicyRevision: "fixture-retention" });
    expect(plan.terminalState).toBe("RESULT_UNKNOWN");
    expect(plan.terminalAt).toBe(originalTerminal);
    expect(plan.deleteBy).toBe("2026-10-23T11:00:00.000Z");
    expect(plan.target).toEqual({ ...target(), applyGate: "UNKNOWN_BLOCKED", safetyEpoch: "5", stateVersion: "3" });
    expect(Object.keys(plan.target).sort()).toEqual(Object.keys(target()).sort());
  });
  it("cannot turn a safety storage failure into successful terminalization", () => {
    expect(() => unknownTerminalPlan({ target: null, now, terminalAt: null, approvedPolicyRevision: null })).toThrow("TARGET_SAFETY_PERSISTENCE_UNAVAILABLE");
  });
  it("requires all dedicated new-intent proofs to reopen a root", () => {
    const input = { target: { ...target(), applyGate: "UNKNOWN_BLOCKED" as const }, now, nextLiveVersion: "2",
      authoritativeReconcile: true, currentlyAuthorized: true, riskReviewed: true,
      freshApprovalId: "approval-new", newIntentId: "intent-new", approvedPolicyRevision: "fixture-retention", latestStateVerified: true };
    expect(explicitNewIntentSafety(input)).toMatchObject({ applyGate: "OPEN", safetyEpoch: "5", liveVersion: "2" });
    for (const field of ["authoritativeReconcile", "currentlyAuthorized", "riskReviewed"] as const)
      expect(() => explicitNewIntentSafety({ ...input, [field]: false })).toThrow("RULE_NEW_INTENT_APPROVAL_REQUIRED");
    expect(() => explicitNewIntentSafety({ ...input, freshApprovalId: null })).toThrow("RULE_NEW_INTENT_APPROVAL_REQUIRED");
    expect(() => explicitNewIntentSafety({ ...input, nextLiveVersion: "1" })).toThrow("TARGET_VERSION_MISMATCH");
    expect(input.target.applyGate).toBe("UNKNOWN_BLOCKED");
  });
});

describe("alpha16 fence and admission boundary, including VI F05", () => {
  it("requires the current PG lease and all current admission checks", () => {
    expect(() => assertSendAdmission(admission())).not.toThrow();
    const input = admission();
    expect(() => assertCurrentLease(input.lease, { ...input.worker, fenceToken: "8", now })).toThrow("RULE_STALE_WORKER");
    expect(() => assertCurrentLease({ ...input.lease!, expiresAt: now.toISOString() }, { ...input.worker, now })).toThrow("RULE_STALE_WORKER");
  });
  it.each([
    ["currentlyAuthorized", false, "FORBIDDEN"], ["approvalCurrent", false, "FORBIDDEN"],
    ["tombstoned", true, "RESOURCE_DELETED"], ["cancelled", true, "RULE_ADMISSION_STOPPED"],
    ["writerCompatibilityVerified", false, "RULE_TARGET_WRITER_UNVERIFIED"],
    ["inputEvidenceCurrent", false, "SUGGESTION_NOT_APPLICABLE"],
    ["operationGuardOpen", false, "APPLY_RESULT_UNKNOWN"],
  ] as const)("denies changed %s", (field, value, error) => {
    expect(() => assertSendAdmission({ ...admission(), [field]: value })).toThrow(error);
  });
  it("does not promote fixture-only runtime values into operating config", () => {
    expect(() => assertRuntimeOperatingProfile({ ...profile, purpose: "FIXTURE_ONLY" })).toThrow("RULE_RUNTIME_POLICY_UNAPPROVED");
    expect(() => assertRuntimeOperatingProfile(null)).toThrow("RULE_RUNTIME_POLICY_UNAPPROVED");
    expect(() => assertRuntimeOperatingProfile({ ...profile, leaseMs: 100 })).toThrow("RULE_RUNTIME_POLICY_INVALID");
  });
  it("requires retention enforcement and compatible writers/workers before queueing", () => {
    const activation = { runtimeProfile: profile, targetSafetyRetentionApproved: true,
      runLifecycleRetentionBounded: true, independentRetentionEnforcementReady: true,
      targetWritersCompatible: true, workerContractCompatible: true };
    expect(() => assertRuleExternalEffectActivation(activation)).not.toThrow();
    expect(() => assertRuleExternalEffectActivation({ ...activation, targetSafetyRetentionApproved: false })).toThrow("RULE_EXTERNAL_RETENTION_UNAPPROVED");
    expect(() => assertRuleExternalEffectActivation({ ...activation, workerContractCompatible: false })).toThrow("RULE_RUNTIME_WRITER_UNVERIFIED");
  });
  it("admission loss remains UNKNOWN regardless of local no-effect assumption", () => {
    expect(classifyExternalFailure({ sendAdmissionCommitted: false, noEffectProven: true })).toBe("FAILED_PRE_EFFECT");
    expect(classifyExternalFailure({ sendAdmissionCommitted: false, noEffectProven: false })).toBe("RESULT_UNKNOWN");
    expect(classifyExternalFailure({ sendAdmissionCommitted: true, noEffectProven: true })).toBe("RESULT_UNKNOWN");
    expect(cancellationResult(true)).toEqual({ cancelAccepted: true, externalCancellationConfirmed: false, nextState: "CANCEL_REQUESTED" });
    expect(cancellationResult(false).nextState).toBe("CANCELLED");
  });
  it("releases a reservation only with exact pre-effect and no-attempt proof", () => {
    const input = { state: "FAILED_PRE_EFFECT" as const, sendAdmissionCommitted: false, requestNeverSentProven: true, attemptExists: false };
    expect(canReleaseApplyReservation(input)).toBe(true);
    expect(canReleaseApplyReservation({ ...input, attemptExists: true })).toBe(false);
    expect(canReleaseApplyReservation({ ...input, sendAdmissionCommitted: true })).toBe(false);
    expect(canReleaseApplyReservation({ ...input, state: "RESULT_UNKNOWN" })).toBe(false);
  });
  it.each(["DRAFT_CREATED", "RESERVED", "UNKNOWN", "CONFIRMED_NO_EFFECT"] as const)("%s never consumes a Suggestion", value => expect(suggestionConsumedBy(value)).toBe(false));
  it("consumes only confirmed DB or external success", () => {
    expect(suggestionConsumedBy("DB_COMMIT_CONFIRMED")).toBe(true);
    expect(suggestionConsumedBy("CONFIRMED_SUCCESS")).toBe(true);
  });
});

describe("alpha16 queue, reconciliation, schedule and restore", () => {
  it("reconstructs only committed READY references, never unknown effects", () => {
    const input = { intentState: "READY" as const, sendAdmittedAt: null, tombstoned: false, outboxCommitted: true };
    expect(queueRecoveryDecision(input)).toBe("ENQUEUE_REFERENCE");
    expect(queueRecoveryDecision({ ...input, outboxCommitted: false })).toBe("DO_NOT_ENQUEUE");
    expect(queueRecoveryDecision({ ...input, tombstoned: true })).toBe("DO_NOT_ENQUEUE");
    expect(queueRecoveryDecision({ ...input, intentState: "RESULT_UNKNOWN" })).toBe("READ_ONLY_RECONCILE");
    expect(queueRecoveryDecision({ ...input, sendAdmittedAt: now.toISOString() })).toBe("READ_ONLY_RECONCILE");
  });
  it("requires authoritative read-only matching evidence without a resend adapter", () => {
    const input = { originalState: "RESULT_UNKNOWN" as const, operationDescriptorHash: "a".repeat(64),
      observation: { mode: "READ_ONLY" as const, operationDescriptorHash: "a".repeat(64), authoritative: true, result: "CONFIRMED_SUCCESS" as const } };
    expect(reconcileReadOnly(input)).toBe("CONFIRMED_SUCCESS");
    expect(reconcileReadOnly({ ...input, observation: { ...input.observation, authoritative: false } })).toBe("UNKNOWN");
    expect(reconcileReadOnly({ ...input, observation: { ...input.observation, operationDescriptorHash: "b".repeat(64) } })).toBe("UNKNOWN");
  });
  it("missed schedules have no implicit backfill or candidate lateness default", () => {
    const input = { dueAt: new Date(now.getTime() - 1_000), now, scheduleRevisionMatches: true, latenessMs: null };
    expect(missedScheduleDecision(input)).toBe("SKIP");
    expect(missedScheduleDecision({ ...input, latenessMs: 1_000 })).toBe("ADMIT_CURRENT");
    expect(missedScheduleDecision({ ...input, latenessMs: 999 })).toBe("SKIP");
    expect(missedScheduleDecision({ ...input, dueAt: new Date(now.getTime() + 1) })).toBe("NOT_DUE");
    expect(missedScheduleDecision({ ...input, latenessMs: 1_000, scheduleRevisionMatches: false })).toBe("SKIP");
  });
  it("rejects expired backups and requires current root safety independent of backup OPEN", () => {
    const input = { backupCreatedAt: new Date(now.getTime() - 1_000), now,
      latestTombstonesVerified: true, latestTargetSafetyVerified: true, retentionEnforcementReady: true };
    expect(restoredDispatchGate(input)).toBe("READY_FOR_CURRENT_REAUTHORIZATION");
    expect(restoredDispatchGate({ ...input, latestTargetSafetyVerified: false })).toBe("DISPATCH_BLOCKED");
    expect(restoredDispatchGate({ ...input, latestTombstonesVerified: false })).toBe("DISPATCH_BLOCKED");
    expect(restoredDispatchGate({ ...input, retentionEnforcementReady: false })).toBe("DISPATCH_BLOCKED");
    expect(restoredDispatchGate({ ...input, backupCreatedAt: new Date(now.getTime() - 7 * 86_400_000) })).toBe("RESTORE_REJECTED");
  });
});
