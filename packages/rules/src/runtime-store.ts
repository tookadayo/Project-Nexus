import { randomUUID } from "node:crypto";
import { sql, json, tenant, type Database, type Tx } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import { readOperatorDispatchGate } from "../../security/src/alpha16-operator";
import type { IndependentSafetyAuthority, TargetAdmissionProof } from "../../security/src/alpha16-safety-state";
import { acquireRuleScopeLocks, ruleScopeLockSet } from "./locks";
import {
  idempotencyFingerprint, issueOperationToken, replayIdempotency, ruleCanonicalHash,
  type OperationTokenBinding,
} from "./tokens";
import {
  assertCurrentLease, assertRuleExternalEffectActivation, assertSendAdmission,
  assertTargetSafety, classifyExternalFailure, queueRecoveryDecision, reconcileReadOnly,
  unknownTerminalPlan, RULE_RUN_TERMINAL_MAX_RETENTION_MS,
  type RuleExternalEffectActivation, type RuleIntentState, type TargetSafetyState,
  type ExternalResultState, type ReadOnlyReconciliation,
} from "./runtime-safety";

export interface RuleRuntimeAuthority {
  authorized: boolean; tombstoned: boolean; approvalCurrent: boolean;
  inputEvidenceCurrent: boolean; latestTargetStateVerified: boolean;
  writerCompatibilityVerified: boolean;
}
export interface RuleRuntimeStoreOptions {
  activation: RuleExternalEffectActivation;
  targetPolicyRevision: string | null;
  safetyAuthority?: IndependentSafetyAuthority;
  /** Non-Run operations require their own approved finite retention. */
  operationRetention: { approved: boolean; revision: string | null; milliseconds: number | null };
  /** Revalidate already verified current proof and DB state. No external
   * communication, new locks, or side effects are permitted in this callback. */
  recheck(tx: Tx, scope: Scope, binding: OperationTokenBinding, actorHash: string): Promise<RuleRuntimeAuthority>;
  now?: () => Date;
}
interface RuntimeIntentRow {
  id: string; run_id: string | null; state: RuleIntentState; state_version: string;
  target_type: string; target_id: string; live_version: string; safety_epoch: string;
  action_class: string; suggestion_id: string; suggestion_version: number;
  draft_id: string; immutable_revision_id: string; draft_content_hash: string;
  actor_hash: string; approval_id: string; effect_descriptor_hash: string;
  operation_binding: OperationTokenBinding; operation_binding_hash: string; operation_token_hash: string;
  token_expires_at: Date; send_admitted_at: Date | null; cancel_requested_at: Date | null;
  terminal_at: Date | null; unknown_resolution_deadline_at: Date; expires_at: Date;
}
interface LeaseRow { worker_id: string; fence_token: string; state: "HELD" | "RELEASED"; expires_at: Date }
interface AttemptRow { id: string; attempt_no: number; state: string; fence_token: string; send_admitted_at: Date | null }
interface TargetRow {
  organization_id: string; guild_id: string; target_type: string; target_id: string;
  live_version: string; safety_epoch: string; state_version: string;
  apply_gate: "OPEN" | "UNKNOWN_BLOCKED"; expires_at: Date; policy_revision: string;
}
function targetState(row: TargetRow | undefined): TargetSafetyState | null {
  return row ? { organizationId: row.organization_id, guildId: row.guild_id,
    targetType: row.target_type, targetId: row.target_id, liveVersion: row.live_version,
    safetyEpoch: String(row.safety_epoch), stateVersion: String(row.state_version), applyGate: row.apply_gate,
    expiresAt: row.expires_at.toISOString(), policyRevision: row.policy_revision } : null;
}
function validNow(now: Date) { assert(Number.isFinite(now.getTime()), "RULE_RUNTIME_TIME_INVALID"); return now; }
function epoch(value: string) {
  assert(/^[1-9][0-9]*$/.test(value) && BigInt(value) < 9_223_372_036_854_775_807n, "RULE_FENCE_EXHAUSTED", 409);
  return BigInt(value);
}
export interface RuleRuntimeClaim { intentId: string; attemptId: string; workerId: string; fenceToken: string }
export interface RuleRuntimeReservation {
  binding: Omit<OperationTokenBinding, "intentId" | "issuedAt" | "expiresAt">;
  actorHash: string; idempotencyKey: string; requestBody: unknown;
  effectDescriptorHash: string; runId?: string;
}

/** Dedicated alpha16 runtime. Legacy action workers cannot execute its queue
 * references. Construction performs no IO and activates no runtime policy. */
export class RuleOperationStore {
  private readonly now: () => Date;
  constructor(readonly db: Database, readonly options: RuleRuntimeStoreOptions) {
    this.now = options.now ?? (() => new Date());
  }
  private activation() {
    assertRuleExternalEffectActivation(this.options.activation);
    const retention = this.options.operationRetention;
    assert(retention.approved && retention.revision && retention.milliseconds
      && Number.isSafeInteger(retention.milliseconds) && retention.milliseconds > 0,
    "RULE_OPERATION_RETENTION_UNAPPROVED", 409);
    return this.options.activation.runtimeProfile!;
  }
  private async operatorGate(tx: Tx, scope: Scope, targetType: string, targetId: string, admission?: TargetAdmissionProof) {
    const gate = await readOperatorDispatchGate(tx, scope, targetType === "AUTOMATION_FLOW" ? { flowId: targetId } : {}, this.now());
    assert(gate.allowed, "OPERATOR_DISPATCH_STOPPED", 409);
    assert(this.options.safetyAuthority, "INDEPENDENT_SAFETY_UNAVAILABLE", 503);
    if (admission) await this.options.safetyAuthority.assertTargetAdmission(tx, scope, targetType, targetId, admission, this.now());
    else await this.options.safetyAuthority.assertTarget(tx, scope, targetType, targetId, this.now());
  }
  private async target(tx: Tx, scope: Scope, type: string, id: string) {
    return targetState((await sql<TargetRow>`SELECT * FROM rule_target_safety WHERE ${tenant(scope)} AND target_type=${type} AND target_id=${id} FOR UPDATE`.execute(tx)).rows[0]);
  }
  private async authority(tx: Tx, scope: Scope, binding: OperationTokenBinding, actorHash: string) {
    const result = await this.options.recheck(tx, scope, binding, actorHash);
    assert(!result.tombstoned, "RESOURCE_DELETED", 410);
    assert(result.authorized && result.approvalCurrent, "FORBIDDEN", 403);
    return result;
  }
  /** All row acquisitions follow the global rank. The unlocked metadata read
   * occurs only after scope locks; immutable identity cannot change under it. */
  private async context(tx: Tx, scope: Scope, intentId: string, mode: "FULL" | "CLAIM" = "FULL") {
    await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
    const meta = (await sql<RuntimeIntentRow>`SELECT * FROM rule_runtime_intents WHERE ${tenant(scope)} AND id=${intentId}::uuid`.execute(tx)).rows[0];
    assert(meta, "RULE_INTENT_NOT_FOUND", 404);
    const target = await this.target(tx, scope, meta.target_type, meta.target_id);
    const run = meta.run_id ? (await sql<{ ended_at: Date | null; cancel_requested_at: Date | null; deadline_at: Date }>`SELECT ended_at,cancel_requested_at,deadline_at FROM automation_runs WHERE ${tenant(scope)} AND id=${meta.run_id}::uuid FOR UPDATE`.execute(tx)).rows[0] : null;
    const intent = (await sql<RuntimeIntentRow>`SELECT * FROM rule_runtime_intents WHERE ${tenant(scope)} AND id=${intentId}::uuid FOR UPDATE`.execute(tx)).rows[0]!;
    const attempts = (await sql<AttemptRow>`SELECT id,attempt_no,state,fence_token,send_admitted_at FROM rule_runtime_attempts WHERE ${tenant(scope)} AND intent_id=${intentId}::uuid ORDER BY id FOR UPDATE`.execute(tx)).rows;
    const rowLock = mode === "FULL" ? sql`FOR UPDATE` : sql``;
    const lease = (await sql<LeaseRow>`SELECT * FROM rule_runtime_leases WHERE ${tenant(scope)} AND intent_id=${intentId}::uuid ${rowLock}`.execute(tx)).rows[0] ?? null;
    const reservation = (await sql<{ state: string }>`SELECT state FROM rule_apply_reservations WHERE ${tenant(scope)} AND operation_id=${intentId}::uuid ${rowLock}`.execute(tx)).rows[0];
    const suggestion = (await sql<{ state: string; version: number; actionable_until: Date; history_expires_at: Date; live_version: string | null }>`SELECT state,version,actionable_until,history_expires_at,live_version FROM rule_suggestions WHERE ${tenant(scope)} AND id=${intent.suggestion_id}::uuid ${rowLock}`.execute(tx)).rows[0];
    const draft = (await sql<{ content_hash: string; base_live_version: string; suggestion_version: number; expires_at: Date }>`SELECT content_hash,base_live_version,suggestion_version,expires_at FROM rule_suggestion_draft_links WHERE ${tenant(scope)} AND suggestion_id=${intent.suggestion_id}::uuid AND draft_id=${intent.draft_id} AND immutable_revision_id=${intent.immutable_revision_id} ${rowLock}`.execute(tx)).rows[0];
    return { intent, target, run, attempts, lease, reservation, suggestion, draft };
  }
  async reserve(scope: Scope, request: RuleRuntimeReservation) {
    const profile = this.activation();
    assert(request.binding.organizationId === scope.organizationId && request.binding.guildId === scope.guildId, "FORBIDDEN", 403);
    assert(/^[a-f0-9]{64}$/.test(request.effectDescriptorHash), "RULE_EFFECT_DESCRIPTOR_INVALID");
    assert(this.options.safetyAuthority, "INDEPENDENT_SAFETY_UNAVAILABLE", 503);
    await this.options.safetyAuthority.observe("TARGET_LIVE_SAFETY", scope, this.now());
    return this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
      const now = validNow(this.now());
      const fingerprint = idempotencyFingerprint(scope, "APPLY", request.idempotencyKey, {
        binding: request.binding, effectDescriptorHash: request.effectDescriptorHash,
        runId: request.runId ?? null, body: request.requestBody,
      });
      const oldKey = (await sql<{ body_hash: string; intent_id: string; expires_at: Date }>`SELECT body_hash,intent_id,expires_at FROM rule_runtime_request_keys WHERE ${tenant(scope)} AND scope_hash=${fingerprint.scopeHash} AND key_hash=${fingerprint.keyHash}`.execute(tx)).rows[0];
      if (oldKey) {
        const old = (await sql<RuntimeIntentRow>`SELECT * FROM rule_runtime_intents WHERE ${tenant(scope)} AND id=${oldKey.intent_id}::uuid`.execute(tx)).rows[0];
        const current = await this.authority(tx, scope, old?.operation_binding ?? { ...request.binding, intentId: oldKey.intent_id, issuedAt: now.toISOString(), expiresAt: oldKey.expires_at.toISOString() }, request.actorHash);
        const replay = replayIdempotency({ stored: { ...fingerprint, bodyHash: oldKey.body_hash, intentId: oldKey.intent_id, expiresAt: oldKey.expires_at.toISOString() }, fingerprint,
          authorization: { scope, authorized: current.authorized, tombstoned: current.tombstoned, intentExists: Boolean(old), intentId: oldKey.intent_id, now } });
        return { intentId: replay.intentId, replay: true as const };
      }
      const intentId = randomUUID();
      const target = await this.target(tx, scope, request.binding.targetType, request.binding.targetId);
      if (request.runId) {
        const run = (await sql<{ ended_at: Date | null; cancel_requested_at: Date | null; deadline_at: Date }>`SELECT ended_at,cancel_requested_at,deadline_at FROM automation_runs WHERE ${tenant(scope)} AND id=${request.runId}::uuid FOR UPDATE`.execute(tx)).rows[0];
        assert(run && !run.ended_at && !run.cancel_requested_at && run.deadline_at > now, "RULE_RUN_STOPPED", 409);
      }
      // All guard writers hold the same exclusive guild scope before checking
      // an absent unique row. Neither actor nor client key changes this guard.
      const guard = (await sql`SELECT id FROM rule_apply_reservations WHERE ${tenant(scope)} AND target_type=${request.binding.targetType} AND target_id=${request.binding.targetId} AND action_class=${request.binding.action} AND state IN ('RESERVED','IN_PROGRESS','UNKNOWN')`.execute(tx)).rows;
      assert(!guard.length, "APPLY_ALREADY_RESERVED", 409);
      const suggestion = (await sql<{ version: number; state: string; live_version: string | null; actionable_until: Date; history_expires_at: Date }>`SELECT version,state,live_version,actionable_until,history_expires_at FROM rule_suggestions WHERE ${tenant(scope)} AND id=${request.binding.suggestionId}::uuid`.execute(tx)).rows[0];
      assert(suggestion && suggestion.state === "ACTIVE" && String(suggestion.version) === request.binding.suggestionVersion
        && suggestion.live_version === request.binding.liveVersion && suggestion.actionable_until > now, "SUGGESTION_NOT_APPLICABLE", 409);
      const draft = (await sql<{ content_hash: string; base_live_version: string; suggestion_version: number; expires_at: Date }>`SELECT content_hash,base_live_version,suggestion_version,expires_at FROM rule_suggestion_draft_links WHERE ${tenant(scope)} AND suggestion_id=${request.binding.suggestionId}::uuid AND draft_id=${request.binding.draftId} AND immutable_revision_id=${request.binding.immutableDraftRevisionId}`.execute(tx)).rows[0];
      assert(draft && draft.content_hash === request.binding.draftContentHash && draft.base_live_version === request.binding.liveVersion
        && String(draft.suggestion_version) === request.binding.suggestionVersion && draft.expires_at > now, "APPLY_CONFLICT", 409);
      const expiresAt = new Date(Math.min(now.getTime() + this.options.operationRetention.milliseconds!, suggestion.actionable_until.getTime(), suggestion.history_expires_at.getTime(), draft.expires_at.getTime(), target ? Date.parse(target.expiresAt) : Infinity));
      const unknownDeadline = new Date(now.getTime() + profile.unknownResolutionMs);
      assert(unknownDeadline < expiresAt, "RULE_UNKNOWN_DEADLINE_UNSUPPORTED", 409);
      const binding: OperationTokenBinding = { ...request.binding, intentId, issuedAt: now.toISOString(), expiresAt: new Date(Math.min(expiresAt.getTime(), now.getTime() + profile.operationTokenTtlMs)).toISOString() };
      const current = await this.authority(tx, scope, binding, request.actorHash);
      assert(current.inputEvidenceCurrent && current.writerCompatibilityVerified, "SUGGESTION_NOT_APPLICABLE", 409);
      await this.operatorGate(tx, scope, binding.targetType, binding.targetId);
      assertTargetSafety(target, { scope, targetType: binding.targetType, targetId: binding.targetId, liveVersion: binding.liveVersion,
        safetyEpoch: binding.safetyEpoch, now, approvedPolicyRevision: this.options.targetPolicyRevision, latestStateVerified: current.latestTargetStateVerified });
      const issued = issueOperationToken(binding), approvalHash = ruleCanonicalHash({ approvalId: binding.approvalId, actorHash: request.actorHash });
      await sql`INSERT INTO rule_runtime_intents(organization_id,guild_id,id,run_id,target_type,target_id,live_version,safety_epoch,action_class,suggestion_id,suggestion_version,draft_id,immutable_revision_id,draft_content_hash,approval_id,approval_hash,effect_descriptor_hash,actor_hash,operation_token_hash,operation_binding,operation_binding_hash,token_expires_at,runtime_policy_revision,target_policy_revision,state,created_at,unknown_resolution_deadline_at,expires_at,retention_class)
        VALUES(${scope.organizationId}::uuid,${scope.guildId},${intentId}::uuid,${request.runId ?? null}::uuid,${binding.targetType},${binding.targetId},${binding.liveVersion},${binding.safetyEpoch}::bigint,${binding.action},${binding.suggestionId}::uuid,${Number(binding.suggestionVersion)},${binding.draftId},${binding.immutableDraftRevisionId},${binding.draftContentHash},${binding.approvalId},${approvalHash},${request.effectDescriptorHash},${request.actorHash},${issued.stored.tokenHash},${json(binding)},${issued.stored.bindingHash},${new Date(binding.expiresAt)},${profile.approvalRevision!},${this.options.targetPolicyRevision!},'READY',${now},${unknownDeadline},${expiresAt},${request.runId ? "RUN_TERMINAL" : "OPERATION_INTENT"})`.execute(tx);
      // New Intent precedes guard/Suggestion/Draft locks. Source reads above
      // were protected by the same exclusive guild scope used by all writers.
      await sql`SELECT id FROM rule_apply_reservations WHERE ${tenant(scope)} AND target_type=${binding.targetType} AND target_id=${binding.targetId} ORDER BY id FOR UPDATE`.execute(tx);
      await sql`INSERT INTO rule_apply_reservations(organization_id,guild_id,id,suggestion_id,immutable_revision_id,draft_id,draft_content_hash,suggestion_version,live_version,safety_epoch,target_type,target_id,action_class,approval_hash,operation_id,state,expires_at)
        VALUES(${scope.organizationId}::uuid,${scope.guildId},${randomUUID()}::uuid,${binding.suggestionId}::uuid,${binding.immutableDraftRevisionId},${binding.draftId},${binding.draftContentHash},${Number(binding.suggestionVersion)},${binding.liveVersion},${binding.safetyEpoch}::bigint,${binding.targetType},${binding.targetId},${binding.action},${approvalHash},${intentId}::uuid,'RESERVED',${expiresAt})`.execute(tx);
      await sql`SELECT id FROM rule_suggestions WHERE ${tenant(scope)} AND id=${binding.suggestionId}::uuid FOR UPDATE`.execute(tx);
      await sql`SELECT draft_id FROM rule_suggestion_draft_links WHERE ${tenant(scope)} AND suggestion_id=${binding.suggestionId}::uuid AND draft_id=${binding.draftId} AND immutable_revision_id=${binding.immutableDraftRevisionId} FOR UPDATE`.execute(tx);
      await sql`INSERT INTO rule_runtime_request_keys(organization_id,guild_id,scope_hash,key_hash,body_hash,intent_id,expires_at) VALUES(${scope.organizationId}::uuid,${scope.guildId},${fingerprint.scopeHash},${fingerprint.keyHash},${fingerprint.bodyHash},${intentId}::uuid,${expiresAt})`.execute(tx);
      await sql`INSERT INTO rule_runtime_outbox(organization_id,guild_id,intent_id,state,available_at) VALUES(${scope.organizationId}::uuid,${scope.guildId},${intentId}::uuid,'PENDING',${now})`.execute(tx);
      return { intentId, operationToken: issued.token, replay: false as const };
    });
  }
  async claim(scope: Scope, intentId: string, workerId: string): Promise<RuleRuntimeClaim> {
    const profile = this.activation();
    assert(this.options.safetyAuthority, "INDEPENDENT_SAFETY_UNAVAILABLE", 503);
    await this.options.safetyAuthority.observe("TARGET_LIVE_SAFETY", scope, this.now());
    return this.db.transaction().execute(async tx => {
      const context = await this.context(tx, scope, intentId, "CLAIM"), now = validNow(this.now());
      const { intent, lease, attempts } = context;
      assert(intent.state === "READY" && !intent.send_admitted_at && !intent.cancel_requested_at && intent.expires_at > now, "RULE_INTENT_NOT_CLAIMABLE", 409);
      assert(!lease || lease.state !== "HELD" || lease.expires_at <= now, "RULE_LEASE_HELD", 409);
      await this.authority(tx, scope, intent.operation_binding, intent.actor_hash);
      await this.operatorGate(tx, scope, intent.target_type, intent.target_id);
      const fence = lease ? (epoch(String(lease.fence_token)) + 1n).toString() : "1";
      const attemptId = randomUUID(), attemptNo = Math.max(0, ...attempts.map(attempt => attempt.attempt_no)) + 1;
      // Attempt rank precedes Lease. scope+Intent serialize the absent rows.
      await sql`INSERT INTO rule_runtime_attempts(organization_id,guild_id,intent_id,id,attempt_no,worker_id,fence_token,state,effect_descriptor_hash,claimed_at) VALUES(${scope.organizationId}::uuid,${scope.guildId},${intentId}::uuid,${attemptId}::uuid,${attemptNo},${workerId},${fence}::bigint,'CLAIMED',${intent.effect_descriptor_hash},${now})`.execute(tx);
      await sql`INSERT INTO rule_runtime_leases(organization_id,guild_id,intent_id,worker_id,fence_token,state,heartbeat_at,expires_at) VALUES(${scope.organizationId}::uuid,${scope.guildId},${intentId}::uuid,${workerId},${fence}::bigint,'HELD',${now},${new Date(now.getTime() + profile.leaseMs)}) ON CONFLICT(organization_id,guild_id,intent_id) DO UPDATE SET worker_id=EXCLUDED.worker_id,fence_token=EXCLUDED.fence_token,state='HELD',heartbeat_at=EXCLUDED.heartbeat_at,expires_at=EXCLUDED.expires_at`.execute(tx);
      const claimed = await sql`UPDATE rule_runtime_intents SET state='CLAIMED',state_version=state_version+1 WHERE ${tenant(scope)} AND id=${intentId}::uuid AND state='READY' AND state_version=${intent.state_version}::bigint RETURNING id`.execute(tx);
      assert(claimed.rows.length === 1, "RULE_STATE_CONFLICT", 409);
      return { intentId, attemptId, workerId, fenceToken: fence };
    });
  }
  async heartbeat(scope: Scope, claim: RuleRuntimeClaim) {
    const profile = this.activation();
    return this.db.transaction().execute(async tx => {
      const context = await this.context(tx, scope, claim.intentId), now = validNow(this.now());
      this.lease(context.lease, claim, now);
      assert(!context.intent.terminal_at && !context.intent.cancel_requested_at, "RULE_ADMISSION_STOPPED", 409);
      const renewed = await sql`UPDATE rule_runtime_leases SET heartbeat_at=${now},expires_at=${new Date(now.getTime() + profile.leaseMs)} WHERE ${tenant(scope)} AND intent_id=${claim.intentId}::uuid AND worker_id=${claim.workerId} AND fence_token=${claim.fenceToken}::bigint AND state='HELD' RETURNING intent_id`.execute(tx);
      assert(renewed.rows.length === 1, "RULE_STALE_WORKER", 409);
    });
  }
  private lease(lease: LeaseRow | null, claim: RuleRuntimeClaim, now: Date) {
    assertCurrentLease(lease ? { resourceType: "INTENT", resourceId: claim.intentId, workerId: lease.worker_id, fenceToken: String(lease.fence_token), state: lease.state, expiresAt: lease.expires_at.toISOString() } : null,
      { resourceType: "INTENT", resourceId: claim.intentId, workerId: claim.workerId, fenceToken: claim.fenceToken, now });
  }
  async admit(scope: Scope, claim: RuleRuntimeClaim): Promise<OperationTokenBinding> {
    const profile = this.activation();
    assert(this.options.safetyAuthority, "INDEPENDENT_SAFETY_UNAVAILABLE", 503);
    // The independent fence commits before any local send admission. A lost
    // fence response or later DB rollback only stops this target; it never
    // permits a blind retry or leaves an independent stale OPEN behind.
    const candidate = (await sql<{ target_type: string; target_id: string }>`SELECT i.target_type,i.target_id FROM rule_runtime_intents i
      JOIN rule_runtime_attempts a ON a.organization_id=i.organization_id AND a.guild_id=i.guild_id AND a.intent_id=i.id
      JOIN rule_runtime_leases l ON l.organization_id=i.organization_id AND l.guild_id=i.guild_id AND l.intent_id=i.id
      WHERE i.organization_id=${scope.organizationId}::uuid AND i.guild_id=${scope.guildId} AND i.id=${claim.intentId}::uuid AND i.state='CLAIMED' AND i.send_admitted_at IS NULL
      AND a.id=${claim.attemptId}::uuid AND a.state='CLAIMED' AND a.worker_id=${claim.workerId} AND a.fence_token=${claim.fenceToken}::bigint
      AND l.worker_id=${claim.workerId} AND l.fence_token=${claim.fenceToken}::bigint AND l.state='HELD' AND l.expires_at>${this.now()}`.execute(this.db)).rows[0];
    assert(candidate, "RULE_STALE_WORKER", 409);
    const admission = await this.options.safetyAuthority.prepareTargetAdmission(scope, candidate.target_type, candidate.target_id, this.now());
    return this.db.transaction().execute(async tx => {
      const context = await this.context(tx, scope, claim.intentId), now = validNow(this.now()), { intent } = context;
      const current = await this.authority(tx, scope, intent.operation_binding, intent.actor_hash);
      await this.operatorGate(tx, scope, intent.target_type, intent.target_id, admission);
      assert(!intent.send_admitted_at && intent.expires_at > now && intent.unknown_resolution_deadline_at > now, "RULE_ADMISSION_STOPPED", 409);
      assert(ruleCanonicalHash(intent.operation_binding) === intent.operation_binding_hash && /^[a-f0-9]{64}$/.test(intent.operation_token_hash), "RULE_TOKEN_BINDING_MISMATCH", 409);
      assert(context.suggestion?.state === "ACTIVE" && String(context.suggestion.version) === intent.operation_binding.suggestionVersion
        && context.suggestion.live_version === intent.live_version && context.suggestion.actionable_until > now
        && context.draft?.content_hash === intent.draft_content_hash && context.draft.base_live_version === intent.live_version
        && context.draft.expires_at > now, "SUGGESTION_NOT_APPLICABLE", 409);
      assert(!intent.run_id || context.run && !context.run.ended_at && !context.run.cancel_requested_at && context.run.deadline_at > now, "RULE_RUN_STOPPED", 409);
      const attempt = context.attempts.find(row => row.id === claim.attemptId);
      assert(attempt?.state === "CLAIMED" && String(attempt.fence_token) === claim.fenceToken, "RULE_STALE_WORKER", 409);
      assertSendAdmission({ scope, now, expectedBinding: intent.operation_binding, target: context.target,
        targetPolicyRevision: this.options.targetPolicyRevision, latestTargetStateVerified: current.latestTargetStateVerified,
        writerCompatibilityVerified: current.writerCompatibilityVerified, currentlyAuthorized: current.authorized,
        approvalCurrent: current.approvalCurrent, tombstoned: current.tombstoned, cancelled: Boolean(intent.cancel_requested_at),
        inputEvidenceCurrent: current.inputEvidenceCurrent, intentState: intent.state, operationGuardOpen: context.reservation?.state === "RESERVED",
        runtimeProfile: profile,
        lease: context.lease ? { resourceType: "INTENT", resourceId: claim.intentId, workerId: context.lease.worker_id, fenceToken: String(context.lease.fence_token), state: context.lease.state, expiresAt: context.lease.expires_at.toISOString() } : null,
        worker: { resourceType: "INTENT", resourceId: claim.intentId, workerId: claim.workerId, fenceToken: claim.fenceToken } });
      await this.options.safetyAuthority!.consumeTargetAdmission(tx, scope, admission, this.now());
      const admitted = await sql`UPDATE rule_runtime_intents SET state='EXECUTING',state_version=state_version+1,send_admitted_at=${now} WHERE ${tenant(scope)} AND id=${claim.intentId}::uuid AND state='CLAIMED' AND state_version=${intent.state_version}::bigint RETURNING id`.execute(tx);
      assert(admitted.rows.length === 1, "RULE_STATE_CONFLICT", 409);
      const admittedAttempt = await sql`UPDATE rule_runtime_attempts SET state='EXECUTING',send_admitted_at=${now},request_deadline_at=${new Date(now.getTime() + profile.requestDeadlineMs)} WHERE ${tenant(scope)} AND id=${claim.attemptId}::uuid AND fence_token=${claim.fenceToken}::bigint AND state='CLAIMED' RETURNING id`.execute(tx);
      assert(admittedAttempt.rows.length === 1, "RULE_STALE_WORKER", 409);
      await sql`UPDATE rule_apply_reservations SET state='IN_PROGRESS',admitted_at=${now} WHERE ${tenant(scope)} AND operation_id=${claim.intentId}::uuid AND state='RESERVED'`.execute(tx);
      await sql`UPDATE rule_runtime_outbox SET state='PUBLISHED',published_at=${now} WHERE ${tenant(scope)} AND intent_id=${claim.intentId}::uuid`.execute(tx);
      return intent.operation_binding;
    });
  }
  /** Provider invocation is intentionally outside the admission transaction.
   * Losing its response/result commit never triggers another provider call. */
  async dispatch(scope: Scope, claim: RuleRuntimeClaim, execute: (binding: Readonly<OperationTokenBinding>, request: {
    signal: AbortSignal; deadlineAt: string;
  }) => Promise<{
    result: ExternalResultState; resultDigest?: string;
  }>) {
    const binding = await this.admit(scope, claim);
    const profile = this.activation(), controller = new AbortController();
    const deadlineAt = new Date(validNow(this.now()).getTime() + profile.requestDeadlineMs).toISOString();
    let observed: { result: ExternalResultState; resultDigest?: string };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Abort is best effort, never proof that the provider did not act. The
      // losing promise cannot trigger another send or overwrite this result.
      observed = await Promise.race([
        Promise.resolve().then(() => execute(binding, { signal: controller.signal, deadlineAt }))
          .catch(() => ({ result: "UNKNOWN" as const })),
        new Promise<{ result: "UNKNOWN" }>(resolve => {
          timer = setTimeout(() => { controller.abort(); resolve({ result: "UNKNOWN" }); }, profile.requestDeadlineMs);
        }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
    await this.finish(scope, claim, observed.result, observed.resultDigest);
    return observed.result;
  }
  async finish(scope: Scope, claim: RuleRuntimeClaim, result: ExternalResultState, resultDigest?: string) {
    assert(!resultDigest || /^[a-f0-9]{64}$/.test(resultDigest), "RULE_RESULT_DIGEST_INVALID");
    return this.db.transaction().execute(async tx => {
      const context = await this.context(tx, scope, claim.intentId), now = validNow(this.now()), { intent } = context;
      this.lease(context.lease, claim, now);
      const attempt = context.attempts.find(row => row.id === claim.attemptId);
      assert(attempt && String(attempt.fence_token) === claim.fenceToken && attempt.send_admitted_at
        && intent.send_admitted_at && ["EXECUTING", "CANCEL_REQUESTED"].includes(intent.state), "RULE_RESULT_CONFLICT", 409);
      // Even an external "no effect" observation never becomes pre-admission
      // failure or releases a reservation through the retry path.
      const state = result === "CONFIRMED_SUCCESS" ? "SUCCEEDED" : result === "CONFIRMED_NO_EFFECT" ? "FAILED_CONFIRMED" : "RESULT_UNKNOWN";
      await sql`UPDATE rule_runtime_attempts SET state=${state},result_state=${result},result_digest=${resultDigest ?? null},completed_at=${now} WHERE ${tenant(scope)} AND id=${claim.attemptId}::uuid AND fence_token=${claim.fenceToken}::bigint`.execute(tx);
      if (state === "RESULT_UNKNOWN") await this.blockUnknown(tx, scope, context, now, false);
      else {
        await sql`UPDATE rule_runtime_intents SET state=${state},state_version=state_version+1,terminal_at=COALESCE(terminal_at,${now}) WHERE ${tenant(scope)} AND id=${claim.intentId}::uuid`.execute(tx);
        await sql`UPDATE rule_apply_reservations SET state=${state === "SUCCEEDED" ? "SUCCEEDED" : "FAILED_CONFIRMED"},finished_at=${now} WHERE ${tenant(scope)} AND operation_id=${claim.intentId}::uuid`.execute(tx);
        if (state === "SUCCEEDED") await sql`UPDATE rule_suggestions SET state='CONSUMED',version=version+1 WHERE ${tenant(scope)} AND id=${intent.suggestion_id}::uuid AND state='ACTIVE'`.execute(tx);
      }
      await sql`UPDATE rule_runtime_leases SET state='RELEASED' WHERE ${tenant(scope)} AND intent_id=${claim.intentId}::uuid AND fence_token=${claim.fenceToken}::bigint`.execute(tx);
    });
  }
  private async blockUnknown(tx: Tx, scope: Scope, context: Awaited<ReturnType<RuleOperationStore["context"]>>, now: Date, terminal: boolean) {
    const { intent, target } = context;
    if (target && target.policyRevision === this.options.targetPolicyRevision && Date.parse(target.expiresAt) > now.getTime()
      && BigInt(target.safetyEpoch)<9223372036854775807n && BigInt(target.stateVersion)<9223372036854775807n) {
      const plan = unknownTerminalPlan({ target, now, terminalAt: intent.terminal_at?.toISOString() ?? null, approvedPolicyRevision: this.options.targetPolicyRevision });
      await sql`UPDATE rule_target_safety SET apply_gate='UNKNOWN_BLOCKED',safety_epoch=${plan.target.safetyEpoch}::bigint,state_version=${plan.target.stateVersion}::bigint WHERE ${tenant(scope)} AND target_type=${intent.target_type} AND target_id=${intent.target_id} AND state_version=${target.stateVersion}::bigint`.execute(tx);
    } else if (target) {
      // Expiry/missing independent authority closes admission but must not keep
      // the operation nonterminal or renew a root just to retain its history.
      await sql`UPDATE rule_target_safety SET apply_gate='UNKNOWN_BLOCKED' WHERE ${tenant(scope)} AND target_type=${intent.target_type} AND target_id=${intent.target_id}`.execute(tx);
    }
    await sql`UPDATE rule_runtime_intents SET state='RESULT_UNKNOWN',state_version=state_version+1,terminal_at=CASE WHEN ${terminal} THEN COALESCE(terminal_at,${now}) ELSE terminal_at END WHERE ${tenant(scope)} AND id=${intent.id}::uuid`.execute(tx);
    await sql`UPDATE rule_apply_reservations SET state='UNKNOWN' WHERE ${tenant(scope)} AND operation_id=${intent.id}::uuid`.execute(tx);
    await sql`UPDATE rule_runtime_outbox SET state='BLOCKED' WHERE ${tenant(scope)} AND intent_id=${intent.id}::uuid`.execute(tx);
  }
  async cancel(scope: Scope, intentId: string) {
    return this.db.transaction().execute(async tx => {
      const context = await this.context(tx, scope, intentId), now = validNow(this.now()), { intent } = context;
      await this.authority(tx, scope, intent.operation_binding, intent.actor_hash);
      if (intent.terminal_at) return { accepted: true, externalCancellationConfirmed: false, state: intent.state };
      const state = intent.send_admitted_at ? "CANCEL_REQUESTED" : "CANCELLED";
      // Existing UNKNOWN cannot be converted into a cancellation.
      const next = intent.state === "RESULT_UNKNOWN" ? "RESULT_UNKNOWN" : state;
      await sql`UPDATE rule_runtime_intents SET state=${next},cancel_requested_at=COALESCE(cancel_requested_at,${now}),state_version=state_version+1,terminal_at=CASE WHEN ${next}='CANCELLED' THEN COALESCE(terminal_at,${now}) ELSE terminal_at END WHERE ${tenant(scope)} AND id=${intentId}::uuid`.execute(tx);
      if (next === "CANCELLED") {
        await sql`UPDATE rule_runtime_attempts SET state='CANCELLED',completed_at=${now} WHERE ${tenant(scope)} AND intent_id=${intentId}::uuid AND send_admitted_at IS NULL`.execute(tx);
        await sql`UPDATE rule_apply_reservations SET state='FAILED_CONFIRMED',finished_at=${now} WHERE ${tenant(scope)} AND operation_id=${intentId}::uuid`.execute(tx);
        await sql`UPDATE rule_runtime_outbox SET state='BLOCKED' WHERE ${tenant(scope)} AND intent_id=${intentId}::uuid`.execute(tx);
      }
      return { accepted: true, externalCancellationConfirmed: false, state: next };
    });
  }
  async recover(scope: Scope, intentId: string) {
    return this.db.transaction().execute(async tx => {
      const context = await this.context(tx, scope, intentId), now = validNow(this.now()), { intent } = context;
      if (intent.terminal_at) return { state: intent.state, queue: "DO_NOT_ENQUEUE" as const };
      if (intent.send_admitted_at || ["EXECUTING", "CANCEL_REQUESTED", "RESULT_UNKNOWN"].includes(intent.state)) {
        await this.blockUnknown(tx, scope, context, now, intent.unknown_resolution_deadline_at <= now);
        await sql`UPDATE rule_runtime_attempts SET state='RESULT_UNKNOWN',result_state='UNKNOWN',completed_at=COALESCE(completed_at,${now}) WHERE ${tenant(scope)} AND intent_id=${intentId}::uuid AND state IN ('CLAIMED','EXECUTING')`.execute(tx);
        return { state: "RESULT_UNKNOWN" as const, queue: "READ_ONLY_RECONCILE" as const };
      }
      if (intent.expires_at <= now || intent.unknown_resolution_deadline_at <= now) {
        await sql`UPDATE rule_runtime_intents SET state='CANCELLED',state_version=state_version+1,terminal_at=COALESCE(terminal_at,${now}) WHERE ${tenant(scope)} AND id=${intentId}::uuid AND send_admitted_at IS NULL`.execute(tx);
        await sql`UPDATE rule_runtime_outbox SET state='BLOCKED' WHERE ${tenant(scope)} AND intent_id=${intentId}::uuid`.execute(tx);
        return { state: "CANCELLED" as const, queue: "DO_NOT_ENQUEUE" as const };
      }
      if (intent.state === "CLAIMED" && context.lease && context.lease.expires_at <= now) {
        const current = await this.options.recheck(tx, scope, intent.operation_binding, intent.actor_hash);
        if (current.tombstoned || !current.authorized || !current.approvalCurrent || !current.inputEvidenceCurrent) {
          await sql`UPDATE rule_runtime_intents SET state='CANCELLED',state_version=state_version+1,terminal_at=COALESCE(terminal_at,${now}) WHERE ${tenant(scope)} AND id=${intentId}::uuid AND send_admitted_at IS NULL`.execute(tx);
          await sql`UPDATE rule_runtime_outbox SET state='BLOCKED' WHERE ${tenant(scope)} AND intent_id=${intentId}::uuid`.execute(tx);
          return { state: "CANCELLED" as const, queue: "DO_NOT_ENQUEUE" as const };
        }
        // Framework contract: calls only occur after admitted_at commit. This
        // proves a lost pre-admission claim did not send its effect.
        assert(classifyExternalFailure({ sendAdmissionCommitted: false, noEffectProven: true }) === "FAILED_PRE_EFFECT", "RULE_RESULT_CONFLICT");
        await sql`UPDATE rule_runtime_attempts SET state='FAILED_PRE_EFFECT',result_state='CONFIRMED_NO_EFFECT',completed_at=${now} WHERE ${tenant(scope)} AND intent_id=${intentId}::uuid AND send_admitted_at IS NULL AND state='CLAIMED'`.execute(tx);
        await sql`UPDATE rule_runtime_leases SET state='RELEASED' WHERE ${tenant(scope)} AND intent_id=${intentId}::uuid`.execute(tx);
        await sql`UPDATE rule_runtime_intents SET state='READY',state_version=state_version+1 WHERE ${tenant(scope)} AND id=${intentId}::uuid AND send_admitted_at IS NULL`.execute(tx);
        await sql`UPDATE rule_runtime_outbox SET state='PENDING',available_at=${now} WHERE ${tenant(scope)} AND intent_id=${intentId}::uuid`.execute(tx);
        return { state: "READY" as const, queue: "ENQUEUE_REFERENCE" as const };
      }
      const current = await this.options.recheck(tx, scope, intent.operation_binding, intent.actor_hash);
      const stopped = current.tombstoned || !current.authorized || !current.approvalCurrent || !current.inputEvidenceCurrent;
      // A committed send admission returned through the UNKNOWN branch above.
      return { state: intent.state, queue: queueRecoveryDecision({ intentState: intent.state, sendAdmittedAt: null, tombstoned: stopped, outboxCommitted: true }) };
    });
  }
  /** Observation is obtained read-only before the transaction. No provider
   * adapter is accepted here, and old UNKNOWN rows retain their identity. */
  async reconcile(scope: Scope, intentId: string, observation: ReadOnlyReconciliation) {
    return this.db.transaction().execute(async tx => {
      const context = await this.context(tx, scope, intentId), now = validNow(this.now()), { intent } = context;
      await this.authority(tx, scope, intent.operation_binding, intent.actor_hash);
      assert(intent.state === "RESULT_UNKNOWN", "RULE_RECONCILE_STATE_INVALID", 409);
      const result = reconcileReadOnly({ originalState: "RESULT_UNKNOWN", operationDescriptorHash: intent.effect_descriptor_hash, observation });
      if (result === "UNKNOWN") return { result };
      const state = result === "CONFIRMED_SUCCESS" ? "SUCCEEDED" : "FAILED_CONFIRMED";
      await sql`UPDATE rule_runtime_attempts SET state=${state},result_state=${result},reconcile_method='AUTHORITATIVE_READ_ONLY',completed_at=COALESCE(completed_at,${now}) WHERE ${tenant(scope)} AND intent_id=${intentId}::uuid AND state='RESULT_UNKNOWN'`.execute(tx);
      await sql`UPDATE rule_runtime_intents SET state=${state},state_version=state_version+1,terminal_at=COALESCE(terminal_at,${now}) WHERE ${tenant(scope)} AND id=${intentId}::uuid`.execute(tx);
      await sql`UPDATE rule_apply_reservations SET state=${state === "SUCCEEDED" ? "SUCCEEDED" : "FAILED_CONFIRMED"},finished_at=COALESCE(finished_at,${now}) WHERE ${tenant(scope)} AND operation_id=${intentId}::uuid`.execute(tx);
      if (state === "SUCCEEDED") await sql`UPDATE rule_suggestions SET state='CONSUMED',version=version+1 WHERE ${tenant(scope)} AND id=${intent.suggestion_id}::uuid AND state='ACTIVE'`.execute(tx);
      // Reconciliation records evidence but does not reopen target roots or
      // requeue the old effect. A fresh human intent has a dedicated transition.
      return { result };
    });
  }
}

/** Called inside authorized privacy/purge transactions. No IO beyond PG.
 * Before deleting lifecycle guards, persist the independent root blockade.
 * Missing/expired roots already fail closed; never recreate OPEN or renew TTL. */
async function purgeRuntime(tx: Tx, scope: Scope, actorHash?: string, intentIds?: readonly string[], now = new Date(), lockRunIds: readonly string[] = []) {
  validNow(now);
  await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
  const intents = (await sql<RuntimeIntentRow>`SELECT * FROM rule_runtime_intents WHERE ${tenant(scope)} AND (${actorHash === undefined} OR actor_hash=${actorHash ?? ""}) AND (${intentIds === undefined} OR id=ANY(${intentIds ?? []}::uuid[])) ORDER BY target_type,target_id,id`.execute(tx)).rows;
  const targets = new Map(intents.filter(intent => intent.state === "RESULT_UNKNOWN" || intent.send_admitted_at && ["EXECUTING", "CANCEL_REQUESTED"].includes(intent.state))
    .map(intent => [JSON.stringify([intent.target_type, intent.target_id]), intent]));
  for (const key of [...targets.keys()].sort()) {
    const intent = targets.get(key)!;
    await sql`SELECT target_id FROM rule_target_safety WHERE ${tenant(scope)} AND target_type=${intent.target_type} AND target_id=${intent.target_id} FOR UPDATE`.execute(tx);
    await sql`UPDATE rule_target_safety SET apply_gate='UNKNOWN_BLOCKED',safety_epoch=least(safety_epoch::numeric+1,9223372036854775807)::bigint,state_version=least(state_version::numeric+1,9223372036854775807)::bigint WHERE ${tenant(scope)} AND target_type=${intent.target_type} AND target_id=${intent.target_id}`.execute(tx);
  }
  // Canonical order: roots, Runs, Intents, Attempts/Leases/guard, Suggestions.
  for (const runId of [...new Set([...lockRunIds,...intents.flatMap(intent => intent.run_id ? [intent.run_id] : [])])].sort())
    await sql`SELECT id FROM automation_runs WHERE ${tenant(scope)} AND id=${runId}::uuid FOR UPDATE`.execute(tx);
  for (const intent of [...intents].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    await sql`SELECT id FROM rule_runtime_intents WHERE ${tenant(scope)} AND id=${intent.id}::uuid FOR UPDATE`.execute(tx);
  // Logical terminalization and root blockade are committed with physical
  // lifecycle erasure. Preserve an existing terminal time; privacy cancellation
  // cannot reinterpret an admitted effect as successful or effect-free.
  for (const intent of intents) {
    const unresolved = intent.state === "RESULT_UNKNOWN" || intent.send_admitted_at && ["EXECUTING", "CANCEL_REQUESTED"].includes(intent.state);
    if (unresolved) await sql`UPDATE rule_runtime_intents SET state='RESULT_UNKNOWN',state_version=state_version+1,terminal_at=COALESCE(terminal_at,LEAST(${now},unknown_resolution_deadline_at)) WHERE ${tenant(scope)} AND id=${intent.id}::uuid`.execute(tx);
  }
  const ids = intents.map(intent => intent.id);
  await sql`SELECT id FROM rule_runtime_attempts WHERE ${tenant(scope)} AND intent_id=ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`.execute(tx);
  await sql`SELECT intent_id FROM rule_runtime_leases WHERE ${tenant(scope)} AND intent_id=ANY(${ids}::uuid[]) ORDER BY intent_id FOR UPDATE`.execute(tx);
  await sql`SELECT id FROM rule_apply_reservations WHERE ${tenant(scope)} AND operation_id=ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`.execute(tx);
  for (const suggestionId of [...new Set(intents.map(intent => intent.suggestion_id))].sort())
    await sql`UPDATE rule_suggestions SET state='INVALIDATED',version=version+1,invalidated_reason='RUNTIME_PURGED',actionable_until=LEAST(actionable_until,${now}) WHERE ${tenant(scope)} AND id=${suggestionId}::uuid AND state='ACTIVE'`.execute(tx);
  for (const intent of intents) await sql`DELETE FROM rule_runtime_intents WHERE ${tenant(scope)} AND id=${intent.id}::uuid`.execute(tx);
  return { deletedIntents: intents.length };
}
export async function purgeRuleRuntimeGuild(tx: Tx, scope: Scope) { return purgeRuntime(tx, scope); }
export async function purgeRuleRuntimeActor(tx: Tx, scope: Scope, actorHash: string) {
  return purgeRuntime(tx, scope, actorHash);
}
/** Native Run retention uses this before any Run row lock/delete, in the
 * same complete canonical-scope transaction. It never changes a TTL or copies
 * Run evidence into a surviving safety/history table. */
export async function purgeRuleRuntimeRuns(tx: Tx, scope: Scope, runIds: readonly string[], now = new Date(), lockRunIds: readonly string[] = []) {
  assert(tx.isTransaction,"TRANSACTION_REQUIRED",500);validNow(now);
  await acquireRuleScopeLocks(tx,ruleScopeLockSet(scope));
  const ids=(await sql<{id:string}>`SELECT id FROM rule_runtime_intents WHERE ${tenant(scope)} AND run_id=ANY(${runIds}::uuid[]) ORDER BY target_type,target_id,id`.execute(tx)).rows.map(row=>row.id);
  return purgeRuntime(tx,scope,undefined,ids,now,lockRunIds);
}

/** Invoke before removing any expired Suggestion/evidence/link in this scope,
 * in the same transaction. It selects only expired lifecycle IDs; live sibling
 * operations and their reservations retain their own authority and expiry. */
export async function purgeExpiredRuleRuntime(tx: Tx, scope: Scope, now = new Date()) {
  validNow(now);
  await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
  const expired = (await sql<{ id: string }>`SELECT i.id FROM rule_runtime_intents i LEFT JOIN automation_runs r ON r.organization_id=i.organization_id AND r.guild_id=i.guild_id AND r.id=i.run_id LEFT JOIN rule_target_safety t ON t.organization_id=i.organization_id AND t.guild_id=i.guild_id AND t.target_type=i.target_type AND t.target_id=i.target_id WHERE i.organization_id=${scope.organizationId}::uuid AND i.guild_id=${scope.guildId} AND (i.expires_at<=${now} OR t.expires_at<=${now} OR t.target_id IS NULL OR r.ended_at<=${new Date(now.getTime() - RULE_RUN_TERMINAL_MAX_RETENTION_MS)}) ORDER BY i.id`.execute(tx)).rows;
  return purgeRuntime(tx, scope, undefined, expired.map(intent => intent.id), now);
}

/** Scope discovery is read-only, and every mutation reacquires its complete
 * canonical lock set. Run-derived children inherit the parent's terminal TTL.
 * A stopped PC is not claimed to have physically purged anything. */
export async function sweepRuleRuntimeRetention(db: Database, now = new Date()) {
  validNow(now);
  const scopes = (await sql<{ organization_id: string; guild_id: string }>`SELECT DISTINCT i.organization_id,i.guild_id FROM rule_runtime_intents i LEFT JOIN automation_runs r ON r.organization_id=i.organization_id AND r.guild_id=i.guild_id AND r.id=i.run_id LEFT JOIN rule_target_safety t ON t.organization_id=i.organization_id AND t.guild_id=i.guild_id AND t.target_type=i.target_type AND t.target_id=i.target_id WHERE i.expires_at<=${now} OR t.expires_at<=${now} OR t.target_id IS NULL OR r.ended_at<=${new Date(now.getTime() - RULE_RUN_TERMINAL_MAX_RETENTION_MS)}`.execute(db)).rows;
  let deletedIntents = 0;
  for (const row of scopes) deletedIntents += await db.transaction().execute(async tx => {
    const scope = { organizationId: row.organization_id, guildId: row.guild_id };
    return (await purgeExpiredRuleRuntime(tx, scope, now)).deletedIntents;
  });
  return { deletedIntents };
}
