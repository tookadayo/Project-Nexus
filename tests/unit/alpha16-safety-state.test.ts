import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../packages/db/src/index";
import { IndependentSafetyAuthority, safetyContentHash, type IndependentSafetyEvidence, type IndependentTargetFenceWriter } from "../../packages/security/src/alpha16-safety-state";
import type { Alpha16RetentionPolicy } from "../../packages/security/src/alpha16-retention";
import { Alpha16SafetyRestore } from "../../apps/worker/src/alpha16-safety-restore";
import type { IdentityVault } from "../../packages/identity/src/index";
import type { PrivacyService } from "../../packages/security/src/privacy";

// Deliberately synthetic, isolated values; none are an operating approval.
const now = new Date("2026-10-16T12:00:00.000Z"), later = "2026-10-16T13:00:00.000Z";
const scope = { organizationId: "00000000-0000-4000-8000-000000000001", guildId: "123456789012345678" };
const policy: Alpha16RetentionPolicy = (["TARGET_LIVE_SAFETY", "RESTORE_TOMBSTONE", "PUBLICATION_WITHDRAWAL"] as const).map(kind => ({ class: kind, revision: "fixture-only", approved: true as const, enforcementVerified: true as const, durationMs: 3600000 }));
function target(): Extract<IndependentSafetyEvidence, { kind: "TARGET_LIVE_SAFETY" }> {
  return { kind: "TARGET_LIVE_SAFETY", scope, generation: "fixture-generation-1", observedAt: now.toISOString(), expiresAt: later, policyRevision: "fixture-only", independent: true, complete: true,
    targets: [{ targetType: "AUTOMATION_FLOW", targetId: "flow", liveVersion: "1", safetyEpoch: "4", stateVersion: "7", applyGate: "OPEN", expiresAt: later }] };
}
describe("independent alpha16 safety authority", () => {
  it("has no default safety lifetime or independent service and cannot turn reader availability into external admission", async () => {
    const provider = vi.fn(async () => target()), authority = new IndependentSafetyAuthority(() => [], provider, () => now);
    expect(authority.readiness("TARGET_LIVE_SAFETY").blockers).toContain("SAFETY_LIFETIME_UNCONFIGURED");
    await expect(authority.observe("TARGET_LIVE_SAFETY", scope)).rejects.toThrow("INDEPENDENT_SAFETY_UNAVAILABLE");
    expect(provider).not.toHaveBeenCalled();
    const readOnly = new IndependentSafetyAuthority(() => policy, provider, () => now);
    expect(readOnly.readiness("TARGET_LIVE_SAFETY").enabled).toBe(true);
    expect(readOnly.externalTargetReadiness()).toEqual({ enabled: false, blockers: ["INDEPENDENT_TARGET_FENCE_WRITER_UNCONFIGURED"] });
    await expect(readOnly.prepareTargetAdmission(scope, "AUTOMATION_FLOW", "flow")).rejects.toThrow("INDEPENDENT_TARGET_FENCE_UNAVAILABLE");
  });
  it("rejects backup-shaped, wrong-scope, overlong and duplicate roots", async () => {
    const invalid = [
      { ...target(), independent: false }, { ...target(), scope: { ...scope, guildId: "223456789012345678" } },
      { ...target(), expiresAt: "2026-10-16T13:00:00.001Z" }, { ...target(), targets: [...target().targets, ...target().targets] },
    ];
    for (const value of invalid) {
      const authority = new IndependentSafetyAuthority(() => policy, async () => value, () => now);
      await expect(authority.observe("TARGET_LIVE_SAFETY", scope)).rejects.toThrow();
    }
  });
  it("does not accept a serialized proof, mutate private evidence, or reuse proof after refresh/expiry", async () => {
    const clock = { now }, authority = new IndependentSafetyAuthority(() => policy, async () => target(), () => clock.now);
    const first = await authority.observe("TARGET_LIVE_SAFETY", scope);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => authority.require("TARGET_LIVE_SAFETY", scope, { ...first })).toThrow("INDEPENDENT_SAFETY_UNVERIFIED");
    const copy = authority.require("TARGET_LIVE_SAFETY", scope, first);
    if (copy.kind === "TARGET_LIVE_SAFETY") copy.targets[0]!.applyGate = "UNKNOWN_BLOCKED";
    expect(authority.require("TARGET_LIVE_SAFETY", scope, first)).toMatchObject({ targets: [{ applyGate: "OPEN" }] });
    await authority.observe("TARGET_LIVE_SAFETY", scope);
    expect(() => authority.require("TARGET_LIVE_SAFETY", scope, first)).toThrow("INDEPENDENT_SAFETY_UNVERIFIED");
    clock.now = new Date(later);
    expect(() => authority.require("TARGET_LIVE_SAFETY", scope)).toThrow("INDEPENDENT_SAFETY_UNVERIFIED");
  });
  it("requires a conditional independent UNKNOWN fence without TTL extension before issuing any one-use admission", async () => {
    const observed = target(), writer = vi.fn<IndependentTargetFenceWriter>(async input => ({ ...observed, generation: "fixture-generation-2",
      targets: [{ ...input.target, applyGate: "UNKNOWN_BLOCKED", safetyEpoch: "5", stateVersion: "8" }] }));
    const authority = new IndependentSafetyAuthority(() => policy, async () => observed, () => now, writer);
    const admission = await authority.prepareTargetAdmission(scope, "AUTOMATION_FLOW", "flow");
    expect(Object.isFrozen(admission)).toBe(true);
    expect(writer).toHaveBeenCalledWith({ scope, expectedGeneration: observed.generation, target: observed.targets[0] });
    expect(authority.require("TARGET_LIVE_SAFETY", scope)).toMatchObject({ targets: [{ applyGate: "UNKNOWN_BLOCKED", expiresAt: later }] });
    for (const changed of [
      { applyGate: "OPEN", safetyEpoch: "5", stateVersion: "8" },
      { applyGate: "UNKNOWN_BLOCKED", safetyEpoch: "4", stateVersion: "8" },
      { applyGate: "UNKNOWN_BLOCKED", safetyEpoch: "5", stateVersion: "8", expiresAt: "2026-10-16T13:00:00.001Z" },
    ]) {
      const bad = new IndependentSafetyAuthority(() => policy, async () => observed, () => now,
        async input => ({ ...observed, generation: "fixture-generation-2", targets: [{ ...input.target, ...changed }] }));
      await expect(bad.prepareTargetAdmission(scope, "AUTOMATION_FLOW", "flow")).rejects.toThrow();
    }
  });
  it("drops cached complete evidence at its earliest original target deadline, without keeping a longer wrapper lifetime",async()=>{
    const clock={now},value=target();value.targets[0]!.expiresAt="2026-10-16T12:00:01.000Z";
    const authority=new IndependentSafetyAuthority(()=>policy,async()=>value,()=>clock.now),proof=await authority.observe("TARGET_LIVE_SAFETY",scope);
    clock.now=new Date("2026-10-16T12:00:02.000Z");authority.purgeExpired();
    expect(()=>authority.require("TARGET_LIVE_SAFETY",scope,proof)).toThrow("INDEPENDENT_SAFETY_UNVERIFIED");
  });
  it("binds restore evidence to the exact latest content and leaves offline utility outside this new gate", async () => {
    const content = { version: 2, guilds: [], members: [] }, authority = new IndependentSafetyAuthority(() => policy,
      async () => ({ kind: "RESTORE_TOMBSTONE", scope: null, generation: "latest-1", observedAt: now.toISOString(), expiresAt: later, policyRevision: "fixture-only", independent: true, complete: true, contentHash: safetyContentHash(content) }), () => now);
    const proof = await authority.observe("RESTORE_TOMBSTONE", null);
    expect(authority.assertTombstones(content, proof).generation).toBe("latest-1");
    expect(() => authority.assertTombstones({ ...content, version: 1 }, proof)).toThrow("LATEST_TOMBSTONES_REQUIRED");
  });
  it("keeps an unconfigured restore coordinator from touching DB/storage and rejects a copied completion receipt", async () => {
    const transaction = vi.fn(), authority = new IndependentSafetyAuthority(() => policy, async () => target(), () => now);
    const recovery = new Alpha16SafetyRestore({ transaction } as unknown as Database, {} as IdentityVault, {} as PrivacyService, authority, undefined, () => now);
    expect(recovery.readiness().blockers).toContain("ISOLATED_RESTORE_ADAPTER_UNCONFIGURED");
    await expect(recovery.restore("fixture-backup")).rejects.toThrow("SAFETY_RESTORE_UNAVAILABLE");
    expect(transaction).not.toHaveBeenCalled();
    expect(() => recovery.assertRecoveryReceipt({ destinationId: "copy", backupHash: "a".repeat(64), reconciledAt: now.toISOString(), validUntil: later, recoveryComplete: true, externalApplyReady: false, externalPublicationReady: false })).toThrow("RESTORE_RECEIPT_UNVERIFIED");
  });
});
