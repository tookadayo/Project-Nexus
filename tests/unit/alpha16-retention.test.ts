import { describe, expect, it } from "vitest";
import {
  ALPHA16_MAX_RUN_RETENTION_MS, approvedRetention, retentionExpiry, runDeleteBy,
  alpha16RestoreReadiness, unknownRestoreEvidence,
  type Alpha16RetentionApproval, type Alpha16RestoreEvidence,
  ALPHA16_RESTORE_SOURCE_SCHEMA_VERSION,ALPHA16_RESTORE_SOURCE_TABLES,
} from "../../packages/security/src/alpha16-retention";

// These values describe isolated test inputs; they are not operating policy.
const asOf = new Date("2026-10-16T12:00:00.000Z");
const approval: Alpha16RetentionApproval = { class: "FACT", revision: "test-profile", approved: true, durationMs: 1234, enforcementVerified: true };
function readyEvidence(): Alpha16RestoreEvidence {
  return {
    backupCreatedAt: "2026-10-15T12:00:00.000Z", backupExpiresAt: "2026-10-20T12:00:00.000Z", isolatedDestination: true,
    latestTombstones: { independentlyFetched: true, generation: "current-test-generation", appliedBeforeRestore: true, appliedAfterRestore: true },
    latestTargetSafety: { independentlyFetched: true, reconciled: true, unresolvedTargetsBlocked: true },
    expiredDataPurged: true, sessionsRevoked: true, cacheAndQueueRebuilt: true,
    liveRetentionEnforcementVerified: true, backupRetentionEnforcementVerified: true,
    finiteSourceRetention:{schemaVersion:ALPHA16_RESTORE_SOURCE_SCHEMA_VERSION,tableInventoryVerified:true,originalExpiryPurged:true,checkedAt:asOf.toISOString(),nextExpiry:"2026-10-16T13:00:00.000Z"},
  };
}
describe("alpha16 purpose-specific retention", () => {
  it("does not install candidate periods for other classes", () => {
    expect(approvedRetention([], "FACT")).toBeNull();
    expect(approvedRetention([approval], "SUGGESTION")).toBeNull();
    expect(() => retentionExpiry([], "DELETION_RECEIPT", asOf)).toThrow("RETENTION_POLICY_REQUIRED");
  });
  it("requires exactly one finite approved/enforced class revision", () => {
    expect(approvedRetention([approval, approval], "FACT")).toBeNull();
    expect(approvedRetention([{ ...approval, durationMs: Infinity }], "FACT")).toBeNull();
    expect(approvedRetention([{ ...approval, enforcementVerified: false } as unknown as Alpha16RetentionApproval], "FACT")).toBeNull();
    expect(retentionExpiry([approval], "FACT", asOf).getTime()).toBe(asOf.getTime() + 1234);
  });
  it("uses terminalAt for the Run limit and rejects an extension", () => {
    expect(runDeleteBy(asOf).getTime()).toBe(asOf.getTime() + ALPHA16_MAX_RUN_RETENTION_MS);
    expect(() => runDeleteBy(asOf, new Date(asOf.getTime() + ALPHA16_MAX_RUN_RETENTION_MS + 1))).toThrow("RUN_RETENTION_LIMIT");
    expect(() => runDeleteBy(asOf, new Date(asOf.getTime() - 1))).toThrow("RUN_RETENTION_LIMIT");
  });
  it.each(["RUN_MINIMAL", "BACKUP"] as const)("does not approve %s beyond seven days", (kind) => {
    expect(approvedRetention([{ ...approval, class: kind, durationMs: ALPHA16_MAX_RUN_RETENTION_MS + 1 }], kind)).toBeNull();
  });
  it("caps new snapshot classes at 48 hours and minimal receipt/audit at 14 days", () => {
    expect(approvedRetention([{ ...approval, class: "FACT", durationMs: 48 * 3600000 + 1 }], "FACT")).toBeNull();
    for (const kind of ["AUDIT", "DELETION_RECEIPT"] as const)
      expect(approvedRetention([{ ...approval, class: kind, durationMs: 14 * 86400000 + 1 }], kind)).toBeNull();
  });
});
describe("alpha16 restore readiness is fail-closed", () => {
  it("starts unknown and never treats a status read as a restore", () => {
    expect(alpha16RestoreReadiness(unknownRestoreEvidence(), asOf).state).toBe("NOT_READY");
    expect(alpha16RestoreReadiness(readyEvidence(), asOf)).toMatchObject({ state: "READY", blockers: [], generatedAt: asOf.toISOString() });
  });
  it("refuses an expired backup even when tombstones can be applied", () => {
    expect(alpha16RestoreReadiness({ ...readyEvidence(), backupExpiresAt: asOf.toISOString() }, asOf).blockers).toContain("BACKUP_EXPIRED");
  });
  it("refuses future/overlong backup metadata", () => {
    expect(alpha16RestoreReadiness({ ...readyEvidence(), backupCreatedAt: "2026-10-17T12:00:00.000Z" }, asOf).blockers).toContain("BACKUP_UNKNOWN");
    expect(alpha16RestoreReadiness({ ...readyEvidence(), backupExpiresAt: "2026-10-23T12:00:00.000Z" }, asOf).blockers).toContain("BACKUP_RETENTION_LIMIT");
  });
  it("does not reuse OPEN from a backup when latest target safety is unknown", () => {
    const evidence = readyEvidence(); evidence.latestTargetSafety.reconciled = false;
    expect(alpha16RestoreReadiness(evidence, asOf).blockers).toContain("LATEST_TARGET_SAFETY_REQUIRED");
  });
  it.each([
    ["isolatedDestination", "ISOLATED_DESTINATION_REQUIRED"], ["expiredDataPurged", "PURGE_REQUIRED"],
    ["sessionsRevoked", "SESSION_REVOCATION_REQUIRED"], ["cacheAndQueueRebuilt", "QUEUE_REBUILD_REQUIRED"],
    ["liveRetentionEnforcementVerified", "RETENTION_ENFORCEMENT_UNVERIFIED"],
    ["backupRetentionEnforcementVerified", "RETENTION_ENFORCEMENT_UNVERIFIED"],
  ] as const)("requires %s", (key, reason) => {
    expect(alpha16RestoreReadiness({ ...readyEvidence(), [key]: false }, asOf).blockers).toContain(reason);
  });
  it("requires latest independent tombstones both before and after restore", () => {
    const evidence = readyEvidence(); evidence.latestTombstones = { independentlyFetched: false, generation: null, appliedBeforeRestore: false, appliedAfterRestore: false };
    expect(alpha16RestoreReadiness(evidence, asOf).blockers).toEqual(expect.arrayContaining(["LATEST_TOMBSTONES_REQUIRED", "TOMBSTONES_NOT_APPLIED"]));
  });
  it("requires the current finite source inventory and rejects a crossed original child deadline",()=>{
    const value=readyEvidence();delete value.finiteSourceRetention;
    expect(alpha16RestoreReadiness(value,asOf).blockers).toEqual(expect.arrayContaining(["SOURCE_RETENTION_SCHEMA_REQUIRED","SOURCE_EXPIRY_PURGE_REQUIRED"]));
    for(const change of [{schemaVersion:78},{tableInventoryVerified:false}])expect(alpha16RestoreReadiness({...readyEvidence(),finiteSourceRetention:{...readyEvidence().finiteSourceRetention!,...change}},asOf).blockers).toContain("SOURCE_RETENTION_SCHEMA_REQUIRED");
    for(const change of [{originalExpiryPurged:false},{checkedAt:"2026-10-17T00:00:00Z"},{nextExpiry:asOf.toISOString()}])expect(alpha16RestoreReadiness({...readyEvidence(),finiteSourceRetention:{...readyEvidence().finiteSourceRetention!,...change}},asOf).blockers).toContain("SOURCE_EXPIRY_PURGE_REQUIRED");
    expect(ALPHA16_RESTORE_SOURCE_TABLES.filter(value=>value.version>=80).map(value=>value.table)).toEqual(["rule_operational_native_captures","rule_operational_filter_configs","rule_case_metric_observations","rule_case_metric_values"]);
  });
});
