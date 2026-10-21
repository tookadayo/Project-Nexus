import { assert, type Scope } from "../../shared/src/index";
import type { OperationTokenBinding } from "./tokens";

/** These are the only newly confirmed durations. An unrelated policy is not
 * approved merely because one of these values exists. */
export const RULE_RUN_TERMINAL_MAX_RETENTION_MS = 7 * 86_400_000;
export const RULE_BACKUP_MAX_RETENTION_MS = 7 * 86_400_000;

export interface TargetSafetyState {
  organizationId: string; guildId: string;
  targetType: string; targetId: string; liveVersion: string;
  safetyEpoch: string; stateVersion: string;
  applyGate: "OPEN" | "UNKNOWN_BLOCKED";
  expiresAt: string; policyRevision: string;
}
export interface TargetSafetyCheck {
  scope: Scope; targetType: string; targetId: string; liveVersion: string;
  safetyEpoch?: string; now: Date;
  approvedPolicyRevision: string | null;
  latestStateVerified: boolean;
}
export type SafetyGateReason =
  | "TARGET_SAFETY_POLICY_UNAPPROVED" | "TARGET_SAFETY_UNVERIFIED"
  | "TARGET_SAFETY_MISSING" | "TARGET_SAFETY_SCOPE_MISMATCH"
  | "TARGET_SAFETY_EXPIRED" | "TARGET_VERSION_MISMATCH"
  | "TARGET_SAFETY_EPOCH_MISMATCH" | "TARGET_RESULT_UNKNOWN";
export type SafetyGate = { allowed: true } | { allowed: false; reason: SafetyGateReason };
function instant(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}
function unsigned(value: string) {
  return /^[1-9][0-9]*$/.test(value) && value.length <= 19 && BigInt(value) <= 9_223_372_036_854_775_807n;
}
function nextEpoch(value: string) {
  assert(unsigned(value) && BigInt(value) < 9_223_372_036_854_775_807n, "TARGET_SAFETY_EPOCH_EXHAUSTED", 409);
  return (BigInt(value) + 1n).toString();
}

/** Read the root by org/guild/type/id, not by liveVersion. New revisions and
 * rollback therefore cannot hide an unresolved state on the same target. */
export function targetSafetyGate(state: TargetSafetyState | null, check: TargetSafetyCheck): SafetyGate {
  if (!check.approvedPolicyRevision) return { allowed: false, reason: "TARGET_SAFETY_POLICY_UNAPPROVED" };
  if (!check.latestStateVerified) return { allowed: false, reason: "TARGET_SAFETY_UNVERIFIED" };
  if (!state) return { allowed: false, reason: "TARGET_SAFETY_MISSING" };
  if (state.organizationId !== check.scope.organizationId || state.guildId !== check.scope.guildId
    || state.targetType !== check.targetType || state.targetId !== check.targetId)
    return { allowed: false, reason: "TARGET_SAFETY_SCOPE_MISMATCH" };
  if (state.policyRevision !== check.approvedPolicyRevision) return { allowed: false, reason: "TARGET_SAFETY_POLICY_UNAPPROVED" };
  if (!Number.isFinite(instant(check.now)) || !Number.isFinite(instant(state.expiresAt)) || instant(state.expiresAt) <= instant(check.now))
    return { allowed: false, reason: "TARGET_SAFETY_EXPIRED" };
  // UNKNOWN wins over a version mismatch, preserving the root's true reason.
  if (state.applyGate !== "OPEN") return { allowed: false, reason: "TARGET_RESULT_UNKNOWN" };
  if (state.liveVersion !== check.liveVersion) return { allowed: false, reason: "TARGET_VERSION_MISMATCH" };
  if (!unsigned(state.safetyEpoch) || !unsigned(state.stateVersion)
    || check.safetyEpoch !== undefined && state.safetyEpoch !== check.safetyEpoch)
    return { allowed: false, reason: "TARGET_SAFETY_EPOCH_MISMATCH" };
  return { allowed: true };
}
export function assertTargetSafety(state: TargetSafetyState | null, check: TargetSafetyCheck) {
  const gate = targetSafetyGate(state, check);
  assert(gate.allowed, gate.allowed ? "TARGET_SAFETY_INVALID" : gate.reason, 409);
}

export interface RuntimeOperatingProfile {
  purpose: "APPROVED_RUNTIME" | "FIXTURE_ONLY";
  approvalRevision: string | null;
  heartbeatMs: number; leaseMs: number; requestDeadlineMs: number;
  unknownResolutionMs: number; operationTokenTtlMs: number;
}
/** No fallback to the numeric examples in I-C3. A test fixture profile cannot
 * become a production configuration through a feature flag. */
export function assertRuntimeOperatingProfile(profile: RuntimeOperatingProfile | null): asserts profile is RuntimeOperatingProfile {
  assert(profile?.purpose === "APPROVED_RUNTIME" && typeof profile.approvalRevision === "string" && profile.approvalRevision.length > 0, "RULE_RUNTIME_POLICY_UNAPPROVED", 409);
  for (const value of [profile.heartbeatMs, profile.leaseMs, profile.requestDeadlineMs, profile.unknownResolutionMs, profile.operationTokenTtlMs])
    assert(Number.isSafeInteger(value) && value > 0, "RULE_RUNTIME_POLICY_INVALID", 409);
  assert(profile.heartbeatMs <= profile.leaseMs / 3 && profile.requestDeadlineMs <= profile.leaseMs - profile.heartbeatMs, "RULE_RUNTIME_POLICY_INVALID", 409);
}

/** This is separate from alpha15's already adopted Beta limits. Existing
 * actions are not silently reclassified as approved Rule/Apply operations. */
export interface RuleExternalEffectActivation {
  runtimeProfile: RuntimeOperatingProfile | null;
  targetSafetyRetentionApproved: boolean;
  runLifecycleRetentionBounded: boolean;
  independentRetentionEnforcementReady: boolean;
  targetWritersCompatible: boolean;
  workerContractCompatible: boolean;
}
export function assertRuleExternalEffectActivation(activation: RuleExternalEffectActivation) {
  assertRuntimeOperatingProfile(activation.runtimeProfile);
  assert(activation.targetSafetyRetentionApproved && activation.runLifecycleRetentionBounded
    && activation.independentRetentionEnforcementReady, "RULE_EXTERNAL_RETENTION_UNAPPROVED", 409);
  assert(activation.targetWritersCompatible && activation.workerContractCompatible,
    "RULE_RUNTIME_WRITER_UNVERIFIED", 409);
}

export interface WorkerLeaseState {
  resourceType: string; resourceId: string; workerId: string; fenceToken: string;
  state: "HELD" | "RELEASED"; expiresAt: string;
}
export function assertCurrentLease(lease: WorkerLeaseState | null, expected: {
  resourceType: string; resourceId: string; workerId: string; fenceToken: string; now: Date;
}) {
  assert(lease && lease.state === "HELD" && lease.resourceType === expected.resourceType
    && lease.resourceId === expected.resourceId && lease.workerId === expected.workerId
    && unsigned(lease.fenceToken) && lease.fenceToken === expected.fenceToken
    && Number.isFinite(instant(expected.now)) && Number.isFinite(instant(lease.expiresAt))
    && instant(lease.expiresAt) > instant(expected.now), "RULE_STALE_WORKER", 409);
}

export interface SendAdmissionCheck {
  scope: Scope; now: Date; expectedBinding: OperationTokenBinding;
  target: TargetSafetyState | null; targetPolicyRevision: string | null;
  latestTargetStateVerified: boolean; writerCompatibilityVerified: boolean;
  currentlyAuthorized: boolean; approvalCurrent: boolean; tombstoned: boolean;
  cancelled: boolean; inputEvidenceCurrent: boolean;
  intentState: RuleIntentState; operationGuardOpen: boolean;
  runtimeProfile: RuntimeOperatingProfile | null;
  lease: WorkerLeaseState | null;
  worker: { resourceType: string; resourceId: string; workerId: string; fenceToken: string };
}
export type RuleIntentState = "READY" | "CLAIMED" | "EXECUTING" | "CANCEL_REQUESTED"
  | "SUCCEEDED" | "FAILED_PRE_EFFECT" | "FAILED_CONFIRMED" | "CANCELLED" | "RESULT_UNKNOWN";

/** Call under the canonical PG scope/row locks, immediately before persisting
 * send_admitted_at with state/fence CAS. Only after transaction commit may the
 * external call occur. The token must have been validated separately. */
export function assertSendAdmission(check: SendAdmissionCheck) {
  assertRuntimeOperatingProfile(check.runtimeProfile);
  assert(!check.tombstoned, "RESOURCE_DELETED", 410);
  assert(check.currentlyAuthorized && check.approvalCurrent, "FORBIDDEN", 403);
  assert(check.writerCompatibilityVerified, "RULE_TARGET_WRITER_UNVERIFIED", 409);
  assert(!check.cancelled && check.intentState === "CLAIMED", "RULE_ADMISSION_STOPPED", 409);
  assert(check.inputEvidenceCurrent, "SUGGESTION_NOT_APPLICABLE", 409);
  assert(check.operationGuardOpen, "APPLY_RESULT_UNKNOWN", 409);
  assertCurrentLease(check.lease, { ...check.worker, now: check.now });
  assertTargetSafety(check.target, {
    scope: check.scope, targetType: check.expectedBinding.targetType,
    targetId: check.expectedBinding.targetId, liveVersion: check.expectedBinding.liveVersion,
    safetyEpoch: check.expectedBinding.safetyEpoch, now: check.now,
    approvedPolicyRevision: check.targetPolicyRevision,
    latestStateVerified: check.latestTargetStateVerified,
  });
  assert(check.expectedBinding.organizationId === check.scope.organizationId
    && check.expectedBinding.guildId === check.scope.guildId, "FORBIDDEN", 403);
  assert(Number.isFinite(instant(check.expectedBinding.expiresAt))
    && instant(check.expectedBinding.expiresAt) > instant(check.now), "IDEMPOTENCY_TOKEN_EXPIRED", 409);
}

export type ExternalResultState = "CONFIRMED_SUCCESS" | "CONFIRMED_NO_EFFECT" | "UNKNOWN";
/** Admission is the irreversible uncertainty boundary. A local timeout,
 * missing response, cancel, worker loss or DB retry cannot prove no effect. */
export function classifyExternalFailure(input: {
  sendAdmissionCommitted: boolean;
  noEffectProven: boolean;
}): "FAILED_PRE_EFFECT" | "RESULT_UNKNOWN" {
  return !input.sendAdmissionCommitted && input.noEffectProven ? "FAILED_PRE_EFFECT" : "RESULT_UNKNOWN";
}
export function canReleaseApplyReservation(input: {
  sendAdmissionCommitted: boolean; requestNeverSentProven: boolean;
  attemptExists: boolean; state: RuleIntentState;
}) {
  return input.state === "FAILED_PRE_EFFECT" && !input.sendAdmissionCommitted
    && input.requestNeverSentProven && !input.attemptExists;
}
export function cancellationResult(sendAdmissionCommitted: boolean): {
  cancelAccepted: true; externalCancellationConfirmed: false; nextState: "CANCELLED" | "CANCEL_REQUESTED";
} {
  return { cancelAccepted: true, externalCancellationConfirmed: false,
    nextState: sendAdmissionCommitted ? "CANCEL_REQUESTED" : "CANCELLED" };
}
export function suggestionConsumedBy(result: "DB_COMMIT_CONFIRMED" | ExternalResultState | "DRAFT_CREATED" | "RESERVED") {
  return result === "DB_COMMIT_CONFIRMED" || result === "CONFIRMED_SUCCESS";
}

/** Queue recovery takes IDs from committed PG state only. Unknown/admitted
 * work belongs to read-only reconciliation, never dispatch reconstruction. */
export function queueRecoveryDecision(input: {
  intentState: RuleIntentState; sendAdmittedAt: string | null;
  tombstoned: boolean; outboxCommitted: boolean;
}): "ENQUEUE_REFERENCE" | "READ_ONLY_RECONCILE" | "DO_NOT_ENQUEUE" {
  if (input.tombstoned || !input.outboxCommitted) return "DO_NOT_ENQUEUE";
  if (input.sendAdmittedAt !== null || input.intentState === "RESULT_UNKNOWN"
    || input.intentState === "EXECUTING" || input.intentState === "CANCEL_REQUESTED")
    return ["SUCCEEDED", "FAILED_PRE_EFFECT", "FAILED_CONFIRMED", "CANCELLED"].includes(input.intentState) ? "DO_NOT_ENQUEUE" : "READ_ONLY_RECONCILE";
  return input.intentState === "READY" ? "ENQUEUE_REFERENCE" : "DO_NOT_ENQUEUE";
}

export interface ReadOnlyReconciliation {
  mode: "READ_ONLY";
  operationDescriptorHash: string;
  authoritative: boolean;
  result: ExternalResultState;
}
/** There is deliberately no dispatch callback or adapter in this API. A
 * reconciliation response must match the exact original effect descriptor. */
export function reconcileReadOnly(input: {
  originalState: "RESULT_UNKNOWN";
  operationDescriptorHash: string;
  observation: ReadOnlyReconciliation;
}): ExternalResultState {
  assert(input.originalState === "RESULT_UNKNOWN", "RULE_RECONCILE_STATE_INVALID", 409);
  assert(/^[a-f0-9]{64}$/.test(input.operationDescriptorHash), "RULE_EFFECT_DESCRIPTOR_INVALID");
  const observation = input.observation;
  if (observation.mode !== "READ_ONLY" || !observation.authoritative
    || observation.operationDescriptorHash !== input.operationDescriptorHash) return "UNKNOWN";
  return ["CONFIRMED_SUCCESS", "CONFIRMED_NO_EFFECT"].includes(observation.result) ? observation.result : "UNKNOWN";
}

export interface UnknownTerminalPlan {
  target: TargetSafetyState;
  terminalState: "RESULT_UNKNOWN"; terminalAt: string; deleteBy: string;
}
/** The store must commit this root update and terminalization atomically. No
 * Run ID, result, payload or evidence is carried into the target root. Expiry
 * is inherited, not renewed to retain an unresolved operation indefinitely. */
export function unknownTerminalPlan(input: {
  target: TargetSafetyState | null; now: Date; terminalAt: string | null;
  approvedPolicyRevision: string | null;
}): UnknownTerminalPlan {
  const target = input.target;
  assert(target && input.approvedPolicyRevision && target.policyRevision === input.approvedPolicyRevision,
    "TARGET_SAFETY_PERSISTENCE_UNAVAILABLE", 503);
  assert(Number.isFinite(instant(input.now)) && Number.isFinite(instant(target.expiresAt))
    && instant(target.expiresAt) > instant(input.now), "TARGET_SAFETY_PERSISTENCE_UNAVAILABLE", 503);
  assert(unsigned(target.safetyEpoch) && unsigned(target.stateVersion), "TARGET_SAFETY_EPOCH_MISMATCH", 409);
  const terminalAt = input.terminalAt ?? input.now.toISOString();
  assert(Number.isFinite(instant(terminalAt)) && instant(terminalAt) <= instant(input.now), "RULE_TERMINAL_TIME_INVALID");
  return {
    target: { ...target, applyGate: "UNKNOWN_BLOCKED", safetyEpoch: nextEpoch(target.safetyEpoch),
      stateVersion: nextEpoch(target.stateVersion) },
    terminalState: "RESULT_UNKNOWN", terminalAt,
    deleteBy: new Date(instant(terminalAt) + RULE_RUN_TERMINAL_MAX_RETENTION_MS).toISOString(),
  };
}

/** Ordinary edits preserve root safety. An absent or expired state is never
 * initialized OPEN, and rollback is just another live revision. */
export function inheritTargetSafety(state: TargetSafetyState | null, nextLiveVersion: string): TargetSafetyState | null {
  assert(typeof nextLiveVersion === "string" && nextLiveVersion.length > 0, "TARGET_VERSION_INVALID");
  return state ? { ...state, liveVersion: nextLiveVersion, stateVersion: nextEpoch(state.stateVersion) } : null;
}
/** This creates a new human intent's safety state. It never changes the old
 * UNKNOWN result, and only a dedicated, currently authorized DB transaction
 * may commit it alongside the new intent/version/approval. */
export function explicitNewIntentSafety(input: {
  target: TargetSafetyState | null; now: Date; nextLiveVersion: string;
  authoritativeReconcile: boolean; currentlyAuthorized: boolean; riskReviewed: boolean;
  freshApprovalId: string | null; newIntentId: string | null;
  approvedPolicyRevision: string | null; latestStateVerified: boolean;
}): TargetSafetyState {
  const target = input.target;
  assert(target && input.latestStateVerified && input.approvedPolicyRevision === target.policyRevision,
    "TARGET_SAFETY_UNVERIFIED", 409);
  assert(input.authoritativeReconcile && input.currentlyAuthorized && input.riskReviewed
    && input.freshApprovalId && input.newIntentId, "RULE_NEW_INTENT_APPROVAL_REQUIRED", 409);
  assert(unsigned(target.safetyEpoch) && unsigned(target.stateVersion)
    && Number.isFinite(instant(input.now)) && Number.isFinite(instant(target.expiresAt))
    && instant(target.expiresAt) > instant(input.now), "TARGET_SAFETY_EXPIRED", 409);
  assert(input.nextLiveVersion.length > 0 && input.nextLiveVersion !== target.liveVersion, "TARGET_VERSION_MISMATCH", 409);
  return { ...target, liveVersion: input.nextLiveVersion, applyGate: "OPEN",
    safetyEpoch: nextEpoch(target.safetyEpoch), stateVersion: nextEpoch(target.stateVersion) };
}

/** Missed occurrences remain skipped; explicit new scheduling is a distinct
 * operation. Tunnel health is intentionally absent from this decision. */
export function missedScheduleDecision(input: {
  dueAt: Date; now: Date; scheduleRevisionMatches: boolean; latenessMs: number | null;
}): "NOT_DUE" | "SKIP" | "ADMIT_CURRENT" {
  assert(Number.isFinite(input.dueAt.getTime()) && Number.isFinite(input.now.getTime()), "RULE_SCHEDULE_TIME_INVALID");
  if (!input.scheduleRevisionMatches) return "SKIP";
  if (input.dueAt > input.now) return "NOT_DUE";
  if (input.latenessMs === null) return "SKIP";
  assert(Number.isSafeInteger(input.latenessMs) && input.latenessMs >= 0, "RULE_RUNTIME_POLICY_INVALID");
  return input.now.getTime() - input.dueAt.getTime() <= input.latenessMs ? "ADMIT_CURRENT" : "SKIP";
}

/** A restored OPEN is not a fresh observation. Both latest tombstones and
 * current root epochs must be verified outside the old backup. */
export function restoredDispatchGate(input: {
  backupCreatedAt: Date; now: Date; latestTombstonesVerified: boolean;
  latestTargetSafetyVerified: boolean; retentionEnforcementReady: boolean;
}): "RESTORE_REJECTED" | "DISPATCH_BLOCKED" | "READY_FOR_CURRENT_REAUTHORIZATION" {
  const age = input.now.getTime() - input.backupCreatedAt.getTime();
  if (!Number.isFinite(age) || age < 0 || age >= RULE_BACKUP_MAX_RETENTION_MS) return "RESTORE_REJECTED";
  return input.latestTombstonesVerified && input.latestTargetSafetyVerified && input.retentionEnforcementReady
    ? "READY_FOR_CURRENT_REAUTHORIZATION" : "DISPATCH_BLOCKED";
}
