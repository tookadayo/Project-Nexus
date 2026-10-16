import { createHash } from "node:crypto";
import { z } from "zod";
import { sql, tenant, type Tx } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import { acquireRuleScopeLocks, ruleScopeLockSet } from "../../rules/src/locks";
import { approvedRetention, alpha16RestoreReadiness, type Alpha16RetentionPolicy, type Alpha16RestoreEvidence } from "./alpha16-retention";

export const independentSafetyKinds = ["TARGET_LIVE_SAFETY", "RESTORE_TOMBSTONE", "PUBLICATION_WITHDRAWAL"] as const;
export type IndependentSafetyKind = typeof independentSafetyKinds[number];
const label = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/), hash = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.string().regex(/^[1-9][0-9]{0,18}$/).refine(value => BigInt(value) <= 9223372036854775807n);
const scopeSchema = z.object({ organizationId: z.uuid(), guildId: z.string().regex(/^\d{17,20}$/) }).strict();
const common = { generation: label, observedAt: z.iso.datetime(), expiresAt: z.iso.datetime(), independent: z.literal(true), complete: z.literal(true), policyRevision: label };
export const independentSafetyEvidenceSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("TARGET_LIVE_SAFETY"), scope: scopeSchema,
    targets: z.array(z.object({ targetType: label, targetId: label, liveVersion: label, safetyEpoch: counter, stateVersion: counter,
      applyGate: z.enum(["OPEN", "UNKNOWN_BLOCKED"]), expiresAt: z.iso.datetime() }).strict()).max(10000) }).strict(),
  z.object({ ...common, kind: z.literal("RESTORE_TOMBSTONE"), scope: z.null(), contentHash: hash }).strict(),
  z.object({ ...common, kind: z.literal("PUBLICATION_WITHDRAWAL"), scope: z.null(),
    publications: z.array(z.object({ publicationId: z.uuid(), generation: z.number().safe().int().nonnegative(), withdrawnGeneration: z.number().safe().int().nonnegative(),
      withdrawnSourceVersion: z.number().safe().int().nonnegative(), activeGeneration: z.number().safe().int().positive().nullable(),
      activeArtifactHash: hash.nullable(),
      pendingGeneration: z.number().safe().int().positive().nullable(), state: z.enum(["CONFIRMED", "UNKNOWN"]), expiresAt: z.iso.datetime() }).strict()).max(10000) }).strict(),
]);
export type IndependentSafetyEvidence = z.infer<typeof independentSafetyEvidenceSchema>;
/** A trusted server adapter must fetch the independent *current* authority.
 * A backup, ordinary live-target snapshot or browser flags are not adapters. */
export type IndependentSafetyProvider = (kind: IndependentSafetyKind, scope: Scope | null) => Promise<unknown>;
export type SafetyEvidenceProof = Readonly<{ kind: IndependentSafetyKind; generation: string; expiresAt: string }>;
type TargetEvidence = Extract<IndependentSafetyEvidence, { kind: "TARGET_LIVE_SAFETY" }>;
type TargetEntry = TargetEvidence["targets"][number];
/** New provider contract, not an installed service. Before a target side
 * effect the independent authority atomically compares this current root and
 * writes UNKNOWN_BLOCKED with higher epoch/version and the SAME or earlier
 * expiry. It must never infer OPEN/zero from an absent or expired root. The
 * response is complete current TARGET_LIVE_SAFETY evidence. No Run/attempt,
 * actor, payload, operation token or result is sent or retained here. */
export type IndependentTargetFenceWriter = (input: Readonly<{ scope: Scope; expectedGeneration: string; target: TargetEntry }>) => Promise<unknown>;
export type TargetAdmissionProof = Readonly<{ targetType: string; targetId: string }>;
const key = (kind: IndependentSafetyKind, scope: Scope | null) => `${kind}:${scope ? `${scope.organizationId}:${scope.guildId}` : "GLOBAL"}`;
const sameScope = (a: Scope | null, b: Scope | null) => a === null ? b === null : b !== null && a.organizationId === b.organizationId && a.guildId === b.guildId;
export function safetyContentHash(value: unknown): string {
  const sorted = (item: unknown): unknown => Array.isArray(item) ? item.map(sorted) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, child]) => [name, sorted(child)])) : item;
  return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
}
/** Proofs are process-local capabilities, not persisted credentials/history.
 * A deserialized proof or restored OPEN row cannot pass this instance's check. */
export class IndependentSafetyAuthority {
  private readonly issued = new WeakMap<SafetyEvidenceProof, IndependentSafetyEvidence>();
  private readonly current = new Map<string, SafetyEvidenceProof>();
  private readonly admissions = new WeakMap<TargetAdmissionProof, { scope: Scope; before: TargetEntry; after: TargetEntry; proof: SafetyEvidenceProof; consumed: boolean }>();
  constructor(private readonly policy: () => Alpha16RetentionPolicy, private readonly provider?: IndependentSafetyProvider,
    private readonly clock: () => Date = () => new Date(), private readonly targetFenceWriter?: IndependentTargetFenceWriter) {}
  readiness(kind: IndependentSafetyKind) {
    const blockers = [!approvedRetention(this.policy(), kind) ? "SAFETY_LIFETIME_UNCONFIGURED" : null, !this.provider ? "INDEPENDENT_SAFETY_SOURCE_UNCONFIGURED" : null].filter((value): value is string => value !== null);
    return { enabled: blockers.length === 0, blockers };
  }
  async observe(kind: IndependentSafetyKind, scope: Scope | null, now = this.clock()): Promise<SafetyEvidenceProof> {
    assert(this.readiness(kind).enabled && this.provider, "INDEPENDENT_SAFETY_UNAVAILABLE", 503);
    return this.accept(kind, scope, await this.provider(kind, scope), now);
  }
  externalTargetReadiness() {
    const base = this.readiness("TARGET_LIVE_SAFETY"), blockers = [...base.blockers, ...(!this.targetFenceWriter ? ["INDEPENDENT_TARGET_FENCE_WRITER_UNCONFIGURED"] : [])];
    return { enabled: blockers.length === 0, blockers };
  }
  private accept(kind: IndependentSafetyKind, scope: Scope | null, value: unknown, now: Date): SafetyEvidenceProof {
    this.purgeExpired(now);
    assert(kind === "TARGET_LIVE_SAFETY" ? scope !== null : scope === null, "SAFETY_SCOPE_MISMATCH", 403);
    const evidence = independentSafetyEvidenceSchema.parse(value);
    const approval = approvedRetention(this.policy(), kind);
    assert(approval, "SAFETY_LIFETIME_UNCONFIGURED", 503);
    assert(evidence.kind === kind && sameScope(evidence.scope, scope) && evidence.policyRevision === approval.revision, "SAFETY_SCOPE_MISMATCH", 403);
    const observed = Date.parse(evidence.observedAt), expires = Date.parse(evidence.expiresAt);
    assert(Number.isFinite(now.getTime()) && observed <= now.getTime() && expires > now.getTime() && expires <= observed + approval.durationMs, "SAFETY_EVIDENCE_EXPIRED", 409);
    if (evidence.kind === "TARGET_LIVE_SAFETY") {
      assert(new Set(evidence.targets.map(target => `${target.targetType}:${target.targetId}`)).size === evidence.targets.length, "SAFETY_EVIDENCE_INVALID", 409);
      assert(evidence.targets.every(target => Date.parse(target.expiresAt) <= expires && Date.parse(target.expiresAt) > now.getTime()), "SAFETY_EVIDENCE_INVALID", 409);
    }
    if (evidence.kind === "PUBLICATION_WITHDRAWAL") {
      assert(new Set(evidence.publications.map(publication => publication.publicationId)).size === evidence.publications.length, "SAFETY_EVIDENCE_INVALID", 409);
      assert(evidence.publications.every(publication => Date.parse(publication.expiresAt) <= expires && Date.parse(publication.expiresAt) > now.getTime() && publication.withdrawnGeneration <= publication.generation
        && (publication.activeGeneration === null) === (publication.activeArtifactHash === null)
        && (publication.activeGeneration === null || publication.activeGeneration <= publication.generation)
        && (publication.pendingGeneration === null || publication.pendingGeneration > publication.generation)), "SAFETY_EVIDENCE_INVALID", 409);
    }
    const childEnds=evidence.kind==="TARGET_LIVE_SAFETY"?evidence.targets.map(target=>Date.parse(target.expiresAt)):evidence.kind==="PUBLICATION_WITHDRAWAL"?evidence.publications.map(publication=>Date.parse(publication.expiresAt)):[];
    const proof = Object.freeze({ kind, generation: evidence.generation, expiresAt: new Date(Math.min(expires,...childEnds)).toISOString() });
    const previous=this.current.get(key(kind,scope));if(previous)this.issued.delete(previous);
    this.issued.set(proof, evidence); this.current.set(key(kind, scope), proof); return proof;
  }
  async prepareTargetAdmission(scope: Scope, targetType: string, targetId: string, now = this.clock()): Promise<TargetAdmissionProof> {
    assert(this.externalTargetReadiness().enabled && this.targetFenceWriter, "INDEPENDENT_TARGET_FENCE_UNAVAILABLE", 503);
    await this.observe("TARGET_LIVE_SAFETY", scope, now);
    const beforeEvidence = this.require("TARGET_LIVE_SAFETY", scope, undefined, this.clock());
    assert(beforeEvidence.kind === "TARGET_LIVE_SAFETY", "INDEPENDENT_SAFETY_UNVERIFIED", 409);
    const before = beforeEvidence.targets.find(target => target.targetType === targetType && target.targetId === targetId);
    assert(before && before.applyGate === "OPEN" && Date.parse(before.expiresAt) > this.clock().getTime(), "INDEPENDENT_TARGET_SAFETY_MISMATCH", 409);
    const value = await this.targetFenceWriter({ scope: { ...scope }, expectedGeneration: beforeEvidence.generation, target: structuredClone(before) });
    const proof = this.accept("TARGET_LIVE_SAFETY", scope, value, this.clock()), afterEvidence = this.require("TARGET_LIVE_SAFETY", scope, proof);
    assert(afterEvidence.kind === "TARGET_LIVE_SAFETY" && afterEvidence.generation !== beforeEvidence.generation, "INDEPENDENT_TARGET_FENCE_UNVERIFIED", 409);
    const after = afterEvidence.targets.find(target => target.targetType === targetType && target.targetId === targetId);
    assert(after && after.applyGate === "UNKNOWN_BLOCKED" && after.liveVersion === before.liveVersion
      && BigInt(after.safetyEpoch) > BigInt(before.safetyEpoch) && BigInt(after.stateVersion) > BigInt(before.stateVersion)
      && Date.parse(after.expiresAt) <= Date.parse(before.expiresAt), "INDEPENDENT_TARGET_FENCE_UNVERIFIED", 409);
    const admission = Object.freeze({ targetType, targetId });
    this.admissions.set(admission, { scope: { ...scope }, before, after, proof, consumed: false }); return admission;
  }
  async assertTargetAdmission(tx: Tx, scope: Scope, targetType: string, targetId: string, admission: TargetAdmissionProof, now = this.clock()) {
    assert(tx.isTransaction, "TRANSACTION_REQUIRED", 500);
    const record = this.admissions.get(admission);
    assert(record && !record.consumed && sameScope(record.scope, scope) && admission.targetType === targetType && admission.targetId === targetId, "INDEPENDENT_TARGET_FENCE_UNVERIFIED", 409);
    const evidence = this.require("TARGET_LIVE_SAFETY", scope, record.proof, now);
    assert(evidence.kind === "TARGET_LIVE_SAFETY" && Date.parse(record.after.expiresAt) > now.getTime(), "INDEPENDENT_TARGET_FENCE_UNVERIFIED", 409);
    const local = (await sql<{ live_version: string; safety_epoch: string; state_version: string; apply_gate: string; expires_at: Date; policy_revision: string }>`SELECT live_version,safety_epoch,state_version,apply_gate,expires_at,policy_revision FROM rule_target_safety WHERE ${tenant(scope)} AND target_type=${targetType} AND target_id=${targetId} FOR UPDATE`.execute(tx)).rows[0];
    assert(local && local.apply_gate === "OPEN" && local.expires_at > now && local.policy_revision === evidence.policyRevision
      && local.live_version === record.before.liveVersion && String(local.safety_epoch) === record.before.safetyEpoch && String(local.state_version) === record.before.stateVersion,
    "INDEPENDENT_TARGET_SAFETY_MISMATCH", 409);
  }
  async consumeTargetAdmission(tx: Tx, scope: Scope, admission: TargetAdmissionProof, now = this.clock()) {
    await this.assertTargetAdmission(tx, scope, admission.targetType, admission.targetId, admission, now);
    const record = this.admissions.get(admission)!;
    const evidence = this.require("TARGET_LIVE_SAFETY", scope, record.proof, now);
    // Mark consumed before commit: rollback/lost response cannot reuse a grant.
    record.consumed = true;this.admissions.delete(admission);
    await sql`UPDATE rule_target_safety SET apply_gate='UNKNOWN_BLOCKED',safety_epoch=${record.after.safetyEpoch}::bigint,state_version=${record.after.stateVersion}::bigint,
      expires_at=least(expires_at,${new Date(record.after.expiresAt)}),verified_generation=${evidence.generation},verified_at=${new Date(evidence.observedAt)}
      WHERE ${tenant(scope)} AND target_type=${admission.targetType} AND target_id=${admission.targetId}`.execute(tx);
  }
  require(kind: IndependentSafetyKind, scope: Scope | null, proof?: SafetyEvidenceProof, now = this.clock()): IndependentSafetyEvidence {
    this.purgeExpired(now);
    const selected = proof ?? this.current.get(key(kind, scope)), evidence = selected && this.issued.get(selected), approval = approvedRetention(this.policy(), kind);
    assert(selected && evidence && approval && evidence.kind === kind && sameScope(evidence.scope, scope)
      && evidence.policyRevision === approval.revision && this.current.get(key(kind, scope)) === selected
      && Date.parse(evidence.observedAt) <= now.getTime() && Date.parse(evidence.expiresAt) > now.getTime()
      && Date.parse(evidence.expiresAt) <= Date.parse(evidence.observedAt) + approval.durationMs, "INDEPENDENT_SAFETY_UNVERIFIED", 409);
    return structuredClone(evidence);
  }
  purgeExpired(now=this.clock()) {
    for(const [entryKey,proof] of this.current){
      const evidence=this.issued.get(proof),approval=evidence&&approvedRetention(this.policy(),evidence.kind);
      const childDeadline=evidence?.kind==="TARGET_LIVE_SAFETY"?Math.min(...evidence.targets.map(target=>Date.parse(target.expiresAt))):evidence?.kind==="PUBLICATION_WITHDRAWAL"?Math.min(...evidence.publications.map(publication=>Date.parse(publication.expiresAt))):Infinity;
      if(!evidence||!approval||evidence.policyRevision!==approval.revision||Date.parse(evidence.expiresAt)<=now.getTime()
        ||childDeadline<=now.getTime()
        ||Date.parse(evidence.expiresAt)>Date.parse(evidence.observedAt)+approval.durationMs){
        this.issued.delete(proof);this.current.delete(entryKey);
      }
    }
  }
  forget() { for(const proof of this.current.values())this.issued.delete(proof);this.current.clear(); }
  async assertTarget(tx: Tx, scope: Scope, targetType: string, targetId: string, now = this.clock()) {
    const evidence = this.require("TARGET_LIVE_SAFETY", scope, undefined, now); assert(evidence.kind === "TARGET_LIVE_SAFETY", "INDEPENDENT_SAFETY_UNVERIFIED", 409);
    const target = evidence.targets.find(entry => entry.targetType === targetType && entry.targetId === targetId);
    const row = (await sql<{ live_version: string; safety_epoch: string; state_version: string; apply_gate: string; expires_at: Date; policy_revision: string; verified_generation: string | null }>`SELECT live_version,safety_epoch,state_version,apply_gate,expires_at,policy_revision,verified_generation FROM rule_target_safety WHERE ${tenant(scope)} AND target_type=${targetType} AND target_id=${targetId} FOR SHARE`.execute(tx)).rows[0];
    assert(target && row && target.applyGate === "OPEN" && row.apply_gate === "OPEN" && row.expires_at > now && Date.parse(target.expiresAt) > now.getTime()
      && row.live_version === target.liveVersion && String(row.safety_epoch) === target.safetyEpoch && String(row.state_version) === target.stateVersion
      && row.policy_revision === evidence.policyRevision && row.verified_generation === evidence.generation, "INDEPENDENT_TARGET_SAFETY_MISMATCH", 409);
  }
  assertTombstones(content: unknown, proof: SafetyEvidenceProof, now = this.clock()) {
    const evidence = this.require("RESTORE_TOMBSTONE", null, proof, now);
    assert(evidence.kind === "RESTORE_TOMBSTONE" && evidence.contentHash === safetyContentHash(content), "LATEST_TOMBSTONES_REQUIRED", 409);
    return evidence;
  }
  publication(id: string, proof?: SafetyEvidenceProof, now = this.clock()) {
    const evidence = this.require("PUBLICATION_WITHDRAWAL", null, proof, now); assert(evidence.kind === "PUBLICATION_WITHDRAWAL", "INDEPENDENT_SAFETY_UNVERIFIED", 409);
    const entry = evidence.publications.find(publication => publication.publicationId === id);
    assert(entry && Date.parse(entry.expiresAt) > now.getTime(), "PUBLICATION_SAFETY_MISSING", 409);
    return { entry, evidence };
  }
}

/** Explicit trusted safety reconciliation. It neither resolves local UNKNOWN
 * nor renews an existing deadline; an absent row needs an independent root. */
export async function reconcileIndependentTargetSafety(tx: Tx, scope: Scope, authority: IndependentSafetyAuthority, proof: SafetyEvidenceProof, now = new Date()) {
  assert(tx.isTransaction, "TRANSACTION_REQUIRED", 500); await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
  const evidence = authority.require("TARGET_LIVE_SAFETY", scope, proof, now); assert(evidence.kind === "TARGET_LIVE_SAFETY", "INDEPENDENT_SAFETY_UNVERIFIED", 409);
  const current = (await sql<{ target_type: string; target_id: string }>`SELECT target_type,target_id FROM rule_target_safety WHERE ${tenant(scope)} ORDER BY target_type,target_id FOR UPDATE`.execute(tx)).rows;
  for (const row of current) if (!evidence.targets.some(target => target.targetType === row.target_type && target.targetId === row.target_id))
    await sql`UPDATE rule_target_safety SET apply_gate='UNKNOWN_BLOCKED',safety_epoch=least(safety_epoch::numeric+1,9223372036854775807)::bigint,state_version=least(state_version::numeric+1,9223372036854775807)::bigint,verified_generation=NULL,verified_at=NULL WHERE ${tenant(scope)} AND target_type=${row.target_type} AND target_id=${row.target_id}`.execute(tx);
  for (const target of [...evidence.targets].sort((a, b) => `${a.targetType}:${a.targetId}`.localeCompare(`${b.targetType}:${b.targetId}`))) {
    assert(Date.parse(target.expiresAt) > now.getTime(), "SAFETY_EVIDENCE_EXPIRED", 409);
    await sql`INSERT INTO rule_target_safety(organization_id,guild_id,target_type,target_id,live_version,safety_epoch,state_version,apply_gate,expires_at,policy_revision,verified_generation,verified_at)
      VALUES(${scope.organizationId}::uuid,${scope.guildId},${target.targetType},${target.targetId},${target.liveVersion},${target.safetyEpoch}::bigint,${target.stateVersion}::bigint,${target.applyGate},${new Date(target.expiresAt)},${evidence.policyRevision},${evidence.generation},${new Date(evidence.observedAt)})
      ON CONFLICT(organization_id,guild_id,target_type,target_id) DO UPDATE SET apply_gate=CASE WHEN rule_target_safety.apply_gate='UNKNOWN_BLOCKED' OR EXCLUDED.apply_gate='UNKNOWN_BLOCKED' OR rule_target_safety.live_version<>EXCLUDED.live_version OR rule_target_safety.safety_epoch<>EXCLUDED.safety_epoch OR rule_target_safety.state_version<>EXCLUDED.state_version THEN 'UNKNOWN_BLOCKED' ELSE rule_target_safety.apply_gate END,
      safety_epoch=greatest(rule_target_safety.safety_epoch,EXCLUDED.safety_epoch),state_version=greatest(rule_target_safety.state_version,EXCLUDED.state_version),expires_at=least(rule_target_safety.expires_at,EXCLUDED.expires_at),verified_generation=EXCLUDED.verified_generation,verified_at=EXCLUDED.verified_at`.execute(tx);
  }
  authority.require("TARGET_LIVE_SAFETY", scope, proof);
  return { reconciled: true, unresolvedTargetsBlocked: true, generation: evidence.generation };
}

/** Restore boundary: close old authority before touching restored execution
 * rows. Existing deadlines/generation identity are never extended or reset. */
export async function fenceMinimalSafetyForRestore(tx: Tx, now = new Date()) {
  assert(tx.isTransaction, "TRANSACTION_REQUIRED", 500);
  await acquireRuleScopeLocks(tx, [{ kind: "GLOBAL", mode: "exclusive" }]);
  await sql`UPDATE rule_target_safety SET apply_gate='UNKNOWN_BLOCKED',safety_epoch=least(safety_epoch::numeric+1,9223372036854775807)::bigint,state_version=least(state_version::numeric+1,9223372036854775807)::bigint,verified_generation=NULL,verified_at=NULL`.execute(tx);
  await sql`SELECT pg_advisory_xact_lock(763214)`.execute(tx);
  await sql`UPDATE official_static_publication_heads SET sync_state='UNKNOWN',verified_generation=NULL,verified_at=NULL,safety_expires_at=NULL,safety_policy_revision=NULL,expires_at=least(expires_at,${now}),updated_at=${now}`.execute(tx);
}

/** Finite retention erases the minimal root; missing root requires independent
 * evidence again. No Run ID, result or payload is copied into safety state. */
export async function purgeExpiredMinimalTargetSafety(tx: Tx, scope: Scope, now = new Date()) {
  assert(tx.isTransaction, "TRANSACTION_REQUIRED", 500); await acquireRuleScopeLocks(tx, ruleScopeLockSet(scope));
  return (await sql`DELETE FROM rule_target_safety WHERE ${tenant(scope)} AND expires_at<=${now} RETURNING target_type`.execute(tx)).rows.length;
}
export function restoreSafetyReadiness(authority: IndependentSafetyAuthority, evidence: Alpha16RestoreEvidence,
  proofs: { tombstones: SafetyEvidenceProof; targets: readonly { scope: Scope; proof: SafetyEvidenceProof }[]; publications: SafetyEvidenceProof }, tombstoneContent: unknown, now = new Date()) {
  const tombstones = authority.assertTombstones(tombstoneContent, proofs.tombstones, now);
  for (const target of proofs.targets) authority.require("TARGET_LIVE_SAFETY", target.scope, target.proof, now);
  authority.require("PUBLICATION_WITHDRAWAL", null, proofs.publications, now);
  return alpha16RestoreReadiness({ ...evidence, latestTombstones: { ...evidence.latestTombstones, independentlyFetched: true, generation: tombstones.generation } }, now);
}
