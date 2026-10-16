import { describe, expect, it, vi } from "vitest";
import type { Tx, Database } from "../../packages/db/src/index";
import type { Actor } from "../../packages/settings/src/index";
import { digest, type PlatformPolicy } from "../../packages/rules/src/domain";
import { RulePlatform } from "../../packages/rules/src/service";
import { RuleOperatingAdmission, assertMeasuredOperatingProfile, configActivationInput, operatingProfileIdentity, type MeasuredOperatingProfile, type OperatingProfileRequest } from "../../packages/rules/src/operating-config";
import type { RuleEngineConfig } from "../../packages/rules/src/rule-config";

const now = new Date("2026-10-16T12:00:00.000Z"), end = "2026-10-16T12:30:00.000Z";
const scope = { organizationId: "00000000-0000-4000-8000-000000000001", guildId: "123456789012345678" };
const actor: Actor = { key: "a".repeat(64), permissions: "8", roles: [], source: "DISCORD_PANEL", requestId: "fixture" };
// Synthetic explicit profile only. No fixture is imported by a runtime factory.
const policy: PlatformPolicy = { kind: "OPERATIONAL", revision: "fixture-retention", approved: true, visibilityApproved: true,
  retention: Object.fromEntries(["CONFIG", "FACT", "SOURCE_HEALTH", "EVALUATION", "SUGGESTION", "HISTORY", "REQUEST_KEY"].map(kind => [kind, { seconds: 3600, approvalReference: "synthetic-only" }])) };
const config: RuleEngineConfig = { configVersion: "2", profile: "OPERATIONAL", approval: "APPROVED", retentionApproved: true,
  budget: { maxRules: 1, maxFacts: 50, maxTargets: 10, maxDurationMs: 1000, maxSteps: 1000 }, approvedSourceTypes: ["source_health_observation_v1"], rules: {} };
const request: OperatingProfileRequest = { scope, actorHash: actor.key, config, configHash: digest(config), retentionRevision: policy.revision };
function profile(): MeasuredOperatingProfile { return { kind: "MEASURED_OPERATIONAL", scope, actorHash: actor.key, revision: "fixture-measured", configHash: request.configHash,
  measuredAt: now.toISOString(), measurementExpiresAt: end, measurementReference: "isolated-fixture-only", observedAt: now.toISOString(), expiresAt: end,
  retentionRevision: policy.revision, retentionEnforced: true, sourceRegistryRevision: "fixture-registry", workerReady: true,
  budget: { ...config.budget! }, sourceAuthorizations: [{ sourceType: "source_health_observation_v1", expiresAt: end }] }; }

describe("trusted measured operating config admission", () => {
  it("defaults disabled before DB work and accepts no browser runtime profile flags", async () => {
    const admission = new RuleOperatingAdmission();
    expect(admission.readiness()).toEqual({ enabled: false, reasonCode: "MEASURED_OPERATING_PROVIDER_UNCONFIGURED" });
    await expect(admission.observe(scope, actor, config, policy)).rejects.toThrow("MEASURED_OPERATING_PROVIDER_UNCONFIGURED");
    const transaction = vi.fn(), service = new RulePlatform({ transaction } as unknown as Database);
    await expect(service.activateConfig(scope, actor, { baseConfigVersion: 1, draftConfigVersion: 1, draftContentHash: "b".repeat(64) })).rejects.toThrow("MEASURED_OPERATING_PROVIDER_UNCONFIGURED");
    expect(transaction).not.toHaveBeenCalled();
    expect(() => configActivationInput.parse({ baseConfigVersion: 1, draftConfigVersion: 1, draftContentHash: "b".repeat(64), runtimeApproved: true })).toThrow();
  });
  it("allows evaluation admission independently of external Apply safety retention", () => {
    expect(policy.retention.TARGET_LIVE_SAFETY).toBeUndefined();
    expect(assertMeasuredOperatingProfile(profile(), request, policy, now).revision).toBe("fixture-measured");
  });
  it("rejects fixture configuration, stale measurement, wrong actor/scope/hash/retention and unauthorized or over-budget sources", () => {
    for (const changed of [
      { actorHash: "c".repeat(64) }, { scope: { ...scope, guildId: "223456789012345678" } }, { configHash: "c".repeat(64) }, { retentionRevision: "other" },
      { expiresAt: now.toISOString() }, { measuredAt: "2026-10-16T12:00:00.001Z" }, { sourceAuthorizations: [] }, { budget: { ...profile().budget, maxFacts: 49 } },
    ]) expect(() => assertMeasuredOperatingProfile({ ...profile(), ...changed }, request, policy, now)).toThrow();
    const fixture = { ...config, profile: "FIXTURE" as const };
    expect(() => assertMeasuredOperatingProfile(profile(), { ...request, config: fixture, configHash: digest(fixture) }, policy, now)).toThrow("OPERATING_CONFIG_INVALID");
    expect(() => assertMeasuredOperatingProfile(profile(), request, { ...policy, retention: { ...policy.retention, FACT: { seconds: 48 * 3600 + 1, approvalReference: "not-permitted" } } }, now)).toThrow("INVALID_RETENTION_POLICY");
  });
  it("requires its opaque proof and repeats trusted local source authorization after lock acquisition", async () => {
    const recheck = vi.fn(async () => {}), admission = new RuleOperatingAdmission({ observe: async () => profile(), recheck }, () => now);
    const proof = await admission.observe(scope, actor, config, policy), tx = { isTransaction: true } as Tx;
    await expect(admission.require(tx, scope, actor, config, policy, { ...proof }, now)).rejects.toThrow("OPERATING_PROFILE_UNVERIFIED");
    const accepted = await admission.require(tx, scope, actor, config, policy, proof, now);
    expect(accepted.profileHash).toBe(operatingProfileIdentity(profile())); expect(recheck).toHaveBeenCalledTimes(1);
    recheck.mockRejectedValueOnce(new Error("current-source-authorization-revoked"));
    await expect(admission.require(tx, scope, actor, config, policy, proof, now)).rejects.toThrow("current-source-authorization-revoked");
  });
  it("does not renew measurement or turn a new actor lease into a new stored config profile", () => {
    const same = { ...profile(), actorHash: "d".repeat(64), observedAt: "2026-10-16T12:01:00.000Z", expiresAt: "2026-10-16T12:20:00.000Z" };
    expect(operatingProfileIdentity(same)).toBe(operatingProfileIdentity(profile()));
    expect(operatingProfileIdentity({ ...same, measurementExpiresAt: "2026-10-16T13:00:00.000Z" })).not.toBe(operatingProfileIdentity(profile()));
  });
});
