import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../packages/db/src/index";
import type { OperatorAuth } from "../../packages/security/src/operator-auth";
import {
  Alpha16Operator, OPERATOR_COMPONENTS, authorizeOperator, operatorHealth,
  operatorMutationBlockers, operatorPreviewHash, operatorDeletionInputSchema,
  operatorControlInputSchema, type OperatorGrant, type Alpha16OperatorPolicy,
} from "../../packages/security/src/alpha16-operator";
import { Alpha16OperatorMaintenance, operatorMaintenanceReadiness, unconfiguredOperatorMaintenance } from "../../apps/worker/src/alpha16-operator-maintenance";
const scope = { organizationId: "11111111-1111-4111-8111-111111111111", guildId: "123456789012345678" };
const now = new Date("2026-10-16T12:00:00.000Z");
describe("A16-DEL / Operator authorization contracts", () => {
  it("requires exact Discord IDs and rejects names/extra data", () => {
    const input = { targetType: "DISCORD_USER", targetDiscordId: "987654321098765432", scopeKind: "GUILD", guildId: scope.guildId };
    expect(operatorDeletionInputSchema.safeParse(input).success).toBe(true);
    for (const targetDiscordId of ["@member", "987654321098765432 ", "98765432109876543O", "12"])
      expect(operatorDeletionInputSchema.safeParse({ ...input, targetDiscordId }).success).toBe(false);
    expect(operatorDeletionInputSchema.safeParse({ ...input, displayName: "a name" }).success).toBe(false);
    expect(operatorDeletionInputSchema.safeParse({ ...input, scopeKind: "GLOBAL" }).success).toBe(false);
  });
  it("does not derive GLOBAL deletion permission from a guild grant", () => {
    const grant: OperatorGrant = { permissions: ["OPERATOR_PRIVACY_DELETE_GUILD"], guildIds: [scope.guildId], global: false };
    expect(() => authorizeOperator(grant, "OPERATOR_PRIVACY_DELETE_GUILD", scope.guildId)).not.toThrow();
    expect(() => authorizeOperator(grant, "OPERATOR_PRIVACY_DELETE_GLOBAL", undefined, true)).toThrow("PERMISSION_DENIED");
    expect(() => authorizeOperator(grant, "OPERATOR_PRIVACY_DELETE_GUILD", "987654321098765432")).toThrow("SCOPE_MISMATCH");
  });
  it("binds previews to scope, target, plan and policy with canonical order", () => {
    const a = operatorPreviewHash({ target: "A", scope: { guild: "G", kind: "GUILD" }, plan: "v1" }, "policy-1");
    expect(operatorPreviewHash({ plan: "v1", scope: { kind: "GUILD", guild: "G" }, target: "A" }, "policy-1")).toBe(a);
    expect(operatorPreviewHash({ target: "B", scope: { guild: "G", kind: "GUILD" }, plan: "v1" }, "policy-1")).not.toBe(a);
    expect(operatorPreviewHash({ target: "A", scope: { guild: "G", kind: "GUILD" }, plan: "v1" }, "policy-2")).not.toBe(a);
  });
  it("does not accept a wildcard revision or a mismatched control scope", () => {
    const input = { scopeKind: "GUILD", scope, targetId: null, action: "STOP", ifMatch: 0, reason: "MAINTENANCE" };
    expect(operatorControlInputSchema.safeParse(input).success).toBe(true);
    expect(operatorControlInputSchema.safeParse({ ...input, ifMatch: "*" }).success).toBe(false);
    expect(operatorControlInputSchema.safeParse({ ...input, scopeKind: "GLOBAL" }).success).toBe(false);
    expect(operatorControlInputSchema.safeParse({ ...input, scopeKind: "FLOW", targetId: null }).success).toBe(false);
  });
  it("starts dangerous actions disabled instead of using candidate TTLs", () => {
    const policy: Alpha16OperatorPolicy = { revision: "test-unapproved", retention: [] };
    expect(operatorMutationBlockers(policy, true)).toEqual(expect.arrayContaining(["RETENTION_DELETION_RECEIPT_UNAPPROVED", "RETENTION_TOMBSTONE_UNAPPROVED", "STEP_UP_POLICY_REQUIRED", "DELETION_WRITER_COVERAGE_UNVERIFIED"]));
  });
  it("rejects unconfigured confirm before opening a DB transaction", async () => {
    const transaction = vi.fn(() => { throw new Error("DB_MUST_NOT_BE_USED"); });
    const service = new Alpha16Operator({ transaction } as unknown as Database, {} as OperatorAuth);
    await expect(service.confirm("session", { previewId: scope.organizationId, previewHash: "a".repeat(64), stepUpToken: "browser-made-value", confirmation: true }, "test-key")).rejects.toThrow("OPERATOR_POLICY_REQUIRED");
    expect(transaction).not.toHaveBeenCalled();
  });
  it("does not turn admission management into a guild privacy erasure", async () => {
    const service = new Alpha16Operator({} as Database, {} as OperatorAuth);
    await expect(service.previewAdmission("session", { guildId: scope.guildId, action: "delete", generation: 1,
      requestId: scope.organizationId, reason: "OPERATOR_REQUEST" })).rejects.toThrow("ADMISSION_PRIVACY_COMMAND_SEPARATE");
  });
  it("uses a separate whole-guild permission and leaves lifecycle scope unconfigured", async () => {
    const input = { guildId: scope.guildId, action: "retryDeletion", generation: 1, requestId: scope.organizationId, reason: "OPERATOR_REQUEST" };
    const individual = new Alpha16Operator({} as Database, {} as OperatorAuth, { grant: async () => ({ global: true, guildIds: [], permissions: ["OPERATOR_BETA_LIFECYCLE_MANAGE", "OPERATOR_PRIVACY_DELETE_GUILD"] }) });
    await expect(individual.previewBetaLifecycle("session", input)).rejects.toThrow("PERMISSION_DENIED");
    const dedicated = new Alpha16Operator({} as Database, {} as OperatorAuth, { grant: async () => ({ global: true, guildIds: [], permissions: ["OPERATOR_BETA_LIFECYCLE_MANAGE", "OPERATOR_PRIVACY_ERASE_GUILD"] }) });
    await expect(dedicated.previewBetaLifecycle("session", input)).rejects.toThrow("GUILD_ERASURE_CODE_SCOPE_UNVERIFIED");
  });
});
describe("A16-OP-UI-01 six independent health observations", () => {
  it("does not infer other components from Tunnel or process state", () => {
    const observation = { component: "TUNNEL_REACHABILITY" as const, state: "DOWN" as const, lastObservedAt: "2026-10-16T11:59:59.000Z", validUntil: "2026-10-16T12:01:00.000Z", errorCode: "UNREACHABLE" };
    const states = OPERATOR_COMPONENTS.map(component => operatorHealth(observation, component, now));
    expect(states.find(row => row.component === "TUNNEL_REACHABILITY")?.state).toBe("DOWN");
    expect(states.filter(row => row.component !== "TUNNEL_REACHABILITY").every(row => row.state === "UNKNOWN")).toBe(true);
  });
  it.each([null, "invalid", "2026-10-16T12:00:00.000Z"])("treats invalid or expired TTL %s as UNKNOWN", (validUntil) => {
    expect(operatorHealth({ component: "WORKER", state: "UP", lastObservedAt: "2026-10-16T11:59:00.000Z", validUntil, errorCode: null }, "WORKER", now).state).toBe("UNKNOWN");
  });
  it("does not accept a future observation or arbitrary provider error text", () => {
    const base = { component: "DB" as const, state: "UP" as const, lastObservedAt: "2026-10-16T12:00:01.000Z", validUntil: "2026-10-16T12:01:00.000Z", errorCode: "password=not-public" };
    expect(operatorHealth(base, "DB", now).state).toBe("UNKNOWN");
    expect(operatorHealth({ ...base, lastObservedAt: "2026-10-16T11:59:59.000Z" }, "DB", now).errorCode).toBeNull();
  });
});
describe("Operator maintenance boot gate", () => {
  it("has no implicit activation or batch size", () => {
    expect(operatorMaintenanceReadiness(unconfiguredOperatorMaintenance())).toMatchObject({ enabled: false });
    expect(operatorMaintenanceReadiness(unconfiguredOperatorMaintenance()).blockers).toContain("MAINTENANCE_BATCH_POLICY_REQUIRED");
  });
  it("does not touch DB or purge with unapproved startup configuration", async () => {
    const purgeEphemeral = vi.fn(async () => ({ ready: true, blockingReason: null }));
    const maintenance = new Alpha16OperatorMaintenance({} as Database, { purgeEphemeral } as unknown as Alpha16Operator);
    expect(await maintenance.startupPass()).toMatchObject({ ready: false, processed: 0 });
    expect(purgeEphemeral).not.toHaveBeenCalled();
  });
});
