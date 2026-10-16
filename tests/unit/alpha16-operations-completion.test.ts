import { describe, expect, it } from "vitest";
import { assertMaintenanceAuthorization } from "../../packages/operations/src/maintenance-authorization";
import { manualReportReadiness, manualReportRequestInput, manualReportSnapshotSchema, type ManualReportProfile } from "../../packages/operations/src/reports";
import { organizationMaintenanceReadiness, organizationRenameInput, organizationUnlinkInput, teamUpdateInput } from "../../packages/operations/src/organization";
import type { Actor } from "../../packages/settings/src/index";

const scope = { organizationId: "11111111-1111-4111-8111-111111111111", guildId: "123456789012345678" };
const actor: Actor = { key: "scoped-owner-hash", permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: "fixture" };
const now = new Date("2026-10-16T12:00:00Z");
// Explicit test-only contract. These numbers grant no operating approval.
const profile: ManualReportProfile = { enabled: true, artifactRetentionApproved: true, artifactRetentionSeconds: 3600,
  policyRevision: "fixture-only", leaseSeconds: 60, privacyCoverageVerified: true, sourceVisibilityVerified: true, maxPendingRuns: 2, maxResultBytes: 1048576 };

describe("N16-07 operations domain completion", () => {
  it("requires a current proof for the exact actor and scope", () => {
    const proof = { scope, actorHash: actor.key, expiresAt: new Date(now.getTime() + 1000) };
    expect(() => assertMaintenanceAuthorization(proof, scope, actor, now)).not.toThrow();
    for (const value of [undefined, { ...proof, actorHash: "another-actor" }, { ...proof, scope: { ...scope, guildId: "987654321098765432" } },
      { ...proof, expiresAt: now }, { ...proof, expiresAt: new Date("invalid") }])
      expect(() => assertMaintenanceAuthorization(value, scope, actor, now)).toThrow("CURRENT_AUTHORIZATION_REQUIRED");
  });
  it("does not invent a report artifact retention, quota, lease or visibility policy", () => {
    expect(manualReportReadiness().enabled).toBe(false);
    expect(manualReportReadiness(profile)).toEqual({ enabled: true, blockers: [] });
    expect(manualReportReadiness({ ...profile, artifactRetentionApproved: false }).blockers).toContain("REPORT_ARTIFACT_RETENTION_REQUIRED");
    expect(manualReportReadiness({ ...profile, sourceVisibilityVerified: false }).blockers).toContain("REPORT_SOURCE_VISIBILITY_UNVERIFIED");
    for (const bad of [0, -1, NaN, Infinity, 1.5]) {
      expect(manualReportReadiness({ ...profile, artifactRetentionSeconds: bad }).enabled).toBe(false);
      expect(manualReportReadiness({ ...profile, leaseSeconds: bad }).enabled).toBe(false);
    }
    expect(manualReportReadiness({ ...profile, maxResultBytes: 1048577 }).enabled).toBe(false);
    expect(manualReportReadiness({ ...profile, maxPendingRuns: null }).enabled).toBe(false);
  });
  it("binds manual generation to one revision and rejects delivery/backfill parameters", () => {
    const request = { templateId: "22222222-2222-4222-8222-222222222222", templateRevision: 1, requestId: "33333333-3333-4333-8333-333333333333" };
    expect(manualReportRequestInput.safeParse(request).success).toBe(true);
    for (const extra of [{ deliveryMode: "DISCORD" }, { scheduleId: request.templateId }, { backfill: true }, { asOf: now.toISOString() }])
      expect(manualReportRequestInput.safeParse({ ...request, ...extra }).success).toBe(false);
    const snapshot = { version: 1, asOf: now.toISOString(), templateId: request.templateId, templateRevision: 1, sourceFence: "a".repeat(64),
      title: "固定した入力", footer: "", queries: [{ metric: "reply" }], includeAttention: true, includeInterventions: false, savedViews: [] };
    expect(manualReportSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(manualReportSnapshotSchema.safeParse({ ...snapshot, sourceFence: undefined }).success).toBe(false);
  });
  it("keeps close/unlink disabled until their existing authority and writer scope are verified", () => {
    const readiness = organizationMaintenanceReadiness();
    expect(readiness.rename.enabled).toBe(true);
    expect(readiness.close.enabled).toBe(false);
    expect(readiness.unlink.blockers).toContain("ORGANIZATION_MAINTENANCE_SCOPE_UNVERIFIED");
    expect(organizationMaintenanceReadiness({ scopeVerified: false, allowClose: true, allowUnlink: true }).close.enabled).toBe(false);
    expect(organizationMaintenanceReadiness({ scopeVerified: true, allowClose: true, allowUnlink: true }).unlink.enabled).toBe(true);
    expect(organizationRenameInput.safeParse({ name: "運営チーム", revision: 1 }).success).toBe(true);
    expect(organizationUnlinkInput.safeParse({ guildId: "guild-name", revision: 1 }).success).toBe(false);
    expect(teamUpdateInput.safeParse({ id: "22222222-2222-4222-8222-222222222222", name: "Team", revision: 0, memberIds: [] }).success).toBe(false);
  });
});
