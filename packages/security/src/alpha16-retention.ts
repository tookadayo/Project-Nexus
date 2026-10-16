import { z } from "zod";
import { assert } from "../../shared/src/index";
import { ALPHA16_RETENTION_CONTRACT } from "../../rules/src/retention-contract";

/** These are lifecycle limits already approved for alpha15/16, not defaults
 * for Fact, Suggestion, audit, receipt or target safety data. */
export const ALPHA16_MAX_RUN_RETENTION_MS = 7 * 86400000;
export const ALPHA16_MAX_BACKUP_RETENTION_MS = 7 * 86400000;
export const ALPHA16_MAX_SOURCE_SNAPSHOT_RETENTION_MS = ALPHA16_RETENTION_CONTRACT.factSnapshot.maximumSeconds * 1000;
/** Current restore source contract. 081 adds fields to existing native sources;
 * it does not turn those native sources into new 48-hour snapshot tables. */
export const ALPHA16_RESTORE_SOURCE_SCHEMA_VERSION = 82;
export const ALPHA16_RESTORE_SOURCE_TABLES = Object.freeze([
  {table:"rule_operational_contexts",version:77,anchor:"created_at",expiry:"expires_at"},
  {table:"rule_operational_fields",version:77,parent:"rule_operational_contexts",expiry:"expires_at"},
  {table:"rule_operational_case_profiles",version:77,anchor:"created_at",expiry:"expires_at"},
  {table:"rule_operational_requests",version:77,anchor:"created_at",expiry:"expires_at"},
  {table:"rule_role_access_observations",version:79,anchor:"observed_at",expiry:"expires_at",parent:"rule_operational_contexts"},
  {table:"rule_operational_native_captures",version:80,anchor:"first_captured_at",expiry:"expires_at",parent:"rule_operational_contexts",sourceExpiry:"role_expires_at/fields[].expiresAt"},
  {table:"rule_operational_filter_configs",version:80,anchor:"first_captured_at",expiry:"expires_at",parent:"rule_operational_contexts"},
  {table:"rule_case_metric_observations",version:82,anchor:"captured_at",expiry:"expires_at",parent:"rule_operational_contexts"},
  {table:"rule_case_metric_values",version:82,parent:"rule_case_metric_observations",sourceExpiry:"source_expires_at"},
] as const);
export const retentionClassSchema = z.enum([
  "RUN_MINIMAL", "BACKUP", "FACT", "EVALUATION", "SOURCE_HEALTH",
  "SUGGESTION", "EVIDENCE", "HISTORY", "AUDIT", "LINEAGE_SUPPRESSION",
  "DELETION_RECEIPT", "DELETION_JOB", "TOMBSTONE", "TARGET_LIVE_SAFETY",
  "PUBLICATION_HISTORY", "PUBLICATION_WITHDRAWAL", "RESTORE_TOMBSTONE", "OPERATOR_PREVIEW", "OPERATOR_STEP_UP", "OPERATOR_CONTROL",
]);
export type Alpha16RetentionClass = z.infer<typeof retentionClassSchema>;
export const retentionApprovalSchema = z.object({
  class: retentionClassSchema,
  revision: z.string().min(1).max(120),
  approved: z.literal(true),
  durationMs: z.number().safe().int().positive(),
  /** A config document alone cannot prove that expiry is enforced. */
  enforcementVerified: z.literal(true),
}).strict();
export type Alpha16RetentionApproval = z.infer<typeof retentionApprovalSchema>;
export type Alpha16RetentionPolicy = readonly Alpha16RetentionApproval[];

export function approvedRetention(
  policy: Alpha16RetentionPolicy,
  kind: Alpha16RetentionClass,
) {
  const matches = policy.filter((entry) => entry.class === kind);
  if (matches.length !== 1) return null;
  const parsed = retentionApprovalSchema.safeParse(matches[0]);
  if (!parsed.success) return null;
  const cap = kind === "RUN_MINIMAL" ? ALPHA16_MAX_RUN_RETENTION_MS
    : kind === "BACKUP" ? ALPHA16_MAX_BACKUP_RETENTION_MS
    : ["FACT", "EVALUATION", "SOURCE_HEALTH", "EVIDENCE"].includes(kind) ? ALPHA16_MAX_SOURCE_SNAPSHOT_RETENTION_MS
    : ["SUGGESTION", "HISTORY", "AUDIT", "LINEAGE_SUPPRESSION", "DELETION_RECEIPT"].includes(kind) ? ALPHA16_RETENTION_CONTRACT.minimalOperationAudit.maximumSeconds * 1000 : null;
  if (cap !== null && parsed.data.durationMs > cap) return null;
  return parsed.data;
}

export function retentionExpiry(
  policy: Alpha16RetentionPolicy,
  kind: Alpha16RetentionClass,
  from: Date,
) {
  const approval = approvedRetention(policy, kind);
  assert(approval && Number.isFinite(from.getTime()), "RETENTION_POLICY_REQUIRED", 503);
  const expiry = new Date(from.getTime() + approval.durationMs);
  assert(Number.isFinite(expiry.getTime()), "RETENTION_POLICY_REQUIRED", 503);
  return expiry;
}

export function runDeleteBy(terminalAt: Date, requestedDeleteBy?: Date) {
  assert(Number.isFinite(terminalAt.getTime()), "INVALID_TERMINAL_AT", 400);
  const latest = terminalAt.getTime() + ALPHA16_MAX_RUN_RETENTION_MS;
  assert(Number.isFinite(new Date(latest).getTime()), "INVALID_TERMINAL_AT", 400);
  assert(!requestedDeleteBy || (Number.isFinite(requestedDeleteBy.getTime()) &&
    requestedDeleteBy.getTime() >= terminalAt.getTime() && requestedDeleteBy.getTime() <= latest),
  "RUN_RETENTION_LIMIT", 422);
  return requestedDeleteBy ?? new Date(latest);
}

export type Alpha16RestoreEvidence = {
  backupCreatedAt: string | null;
  backupExpiresAt: string | null;
  isolatedDestination: boolean;
  latestTombstones: { independentlyFetched: boolean; generation: string | null; appliedBeforeRestore: boolean; appliedAfterRestore: boolean };
  latestTargetSafety: { independentlyFetched: boolean; reconciled: boolean; unresolvedTargetsBlocked: boolean };
  expiredDataPurged: boolean;
  sessionsRevoked: boolean;
  cacheAndQueueRebuilt: boolean;
  liveRetentionEnforcementVerified: boolean;
  backupRetentionEnforcementVerified: boolean;
  /** Server-derived inspection of the current schema and all original child
   * deadlines. Missing legacy evidence does not certify new source storage. */
  finiteSourceRetention?: {schemaVersion:number|null;tableInventoryVerified:boolean;originalExpiryPurged:boolean;checkedAt:string|null;nextExpiry:string|null};
};
export type RestoreBlocker =
  | "BACKUP_UNKNOWN" | "BACKUP_EXPIRED" | "BACKUP_RETENTION_LIMIT"
  | "ISOLATED_DESTINATION_REQUIRED" | "LATEST_TOMBSTONES_REQUIRED"
  | "TOMBSTONES_NOT_APPLIED" | "LATEST_TARGET_SAFETY_REQUIRED"
  | "PURGE_REQUIRED" | "SESSION_REVOCATION_REQUIRED" | "QUEUE_REBUILD_REQUIRED"
  | "RETENTION_ENFORCEMENT_UNVERIFIED" | "SOURCE_RETENTION_SCHEMA_REQUIRED" | "SOURCE_EXPIRY_PURGE_REQUIRED";

/** Readiness is evidence only. This function never starts a restore or worker. */
export function alpha16RestoreReadiness(evidence: Alpha16RestoreEvidence, now = new Date()) {
  const blockers: RestoreBlocker[] = [];
  const created = evidence.backupCreatedAt === null ? NaN : Date.parse(evidence.backupCreatedAt);
  const expires = evidence.backupExpiresAt === null ? NaN : Date.parse(evidence.backupExpiresAt);
  const clock = now.getTime();
  if (!Number.isFinite(created) || !Number.isFinite(expires) || !Number.isFinite(clock) || created > clock || expires <= created)
    blockers.push("BACKUP_UNKNOWN");
  else {
    if (expires <= clock) blockers.push("BACKUP_EXPIRED");
    if (expires - created > ALPHA16_MAX_BACKUP_RETENTION_MS) blockers.push("BACKUP_RETENTION_LIMIT");
  }
  if (!evidence.isolatedDestination) blockers.push("ISOLATED_DESTINATION_REQUIRED");
  if (!evidence.latestTombstones.independentlyFetched || !evidence.latestTombstones.generation)
    blockers.push("LATEST_TOMBSTONES_REQUIRED");
  if (!evidence.latestTombstones.appliedBeforeRestore || !evidence.latestTombstones.appliedAfterRestore)
    blockers.push("TOMBSTONES_NOT_APPLIED");
  if (!evidence.latestTargetSafety.independentlyFetched || !evidence.latestTargetSafety.reconciled || !evidence.latestTargetSafety.unresolvedTargetsBlocked)
    blockers.push("LATEST_TARGET_SAFETY_REQUIRED");
  if (!evidence.expiredDataPurged) blockers.push("PURGE_REQUIRED");
  if (!evidence.sessionsRevoked) blockers.push("SESSION_REVOCATION_REQUIRED");
  if (!evidence.cacheAndQueueRebuilt) blockers.push("QUEUE_REBUILD_REQUIRED");
  if (!evidence.liveRetentionEnforcementVerified || !evidence.backupRetentionEnforcementVerified)
    blockers.push("RETENTION_ENFORCEMENT_UNVERIFIED");
  if (evidence.finiteSourceRetention?.schemaVersion !== ALPHA16_RESTORE_SOURCE_SCHEMA_VERSION || !evidence.finiteSourceRetention?.tableInventoryVerified)
    blockers.push("SOURCE_RETENTION_SCHEMA_REQUIRED");
  const sourceChecked=Date.parse(evidence.finiteSourceRetention?.checkedAt??""),nextSourceExpiry=evidence.finiteSourceRetention?.nextExpiry;
  if (!evidence.finiteSourceRetention?.originalExpiryPurged || !Number.isFinite(sourceChecked) || sourceChecked>clock
    || nextSourceExpiry!==null&&(nextSourceExpiry===undefined||!Number.isFinite(Date.parse(nextSourceExpiry))||Date.parse(nextSourceExpiry)<=clock))
    blockers.push("SOURCE_EXPIRY_PURGE_REQUIRED");
  return { state: blockers.length ? "NOT_READY" as const : "READY" as const, blockers,
    generatedAt: now.toISOString(), backupExpiresAt: evidence.backupExpiresAt,
    restoreTombstoneGeneration: evidence.latestTombstones.generation };
}

export function unknownRestoreEvidence(): Alpha16RestoreEvidence {
  return {
    backupCreatedAt: null, backupExpiresAt: null, isolatedDestination: false,
    latestTombstones: { independentlyFetched: false, generation: null, appliedBeforeRestore: false, appliedAfterRestore: false },
    latestTargetSafety: { independentlyFetched: false, reconciled: false, unresolvedTargetsBlocked: false },
    expiredDataPurged: false, sessionsRevoked: false, cacheAndQueueRebuilt: false,
    liveRetentionEnforcementVerified: false, backupRetentionEnforcementVerified: false,
    finiteSourceRetention: {schemaVersion:null,tableInventoryVerified:false,originalExpiryPurged:false,checkedAt:null,nextExpiry:null},
  };
}
