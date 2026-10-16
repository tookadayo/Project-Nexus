import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../packages/db/src/index";
import { RuleOperationStore, type RuleRuntimeStoreOptions } from "../../packages/rules/src/runtime-store";
import type { OperationTokenBinding } from "../../packages/rules/src/tokens";

const scope = { organizationId: "00000000-0000-4000-8000-000000000001", guildId: "123456789012345678" };
const claim = { intentId: "intent", attemptId: "attempt", workerId: "worker", fenceToken: "1" };
const binding: OperationTokenBinding = { ...scope, intentId: "intent", targetType: "AUTOMATION_FLOW", targetId: "flow",
  liveVersion: "1", safetyEpoch: "1", action: "SEND_MESSAGE", suggestionId: "suggestion", suggestionVersion: "1",
  draftId: "draft", immutableDraftRevisionId: "r1", draftContentHash: "a".repeat(64), approvalId: "approval",
  issuedAt: "2026-10-16T12:00:00Z", expiresAt: "2026-10-16T13:00:00Z" };
const blocked: RuleRuntimeStoreOptions = {
  activation: { runtimeProfile: null, targetSafetyRetentionApproved: false, runLifecycleRetentionBounded: true,
    independentRetentionEnforcementReady: false, targetWritersCompatible: false, workerContractCompatible: false },
  targetPolicyRevision: null, operationRetention: { approved: false, revision: null, milliseconds: null },
  recheck: async () => { throw new Error("No authority should be evaluated while disabled"); },
};
const dispatchFixture: RuleRuntimeStoreOptions = { ...blocked,
  activation: { runtimeProfile: { purpose: "APPROVED_RUNTIME", approvalRevision: "fixture-runtime",
    heartbeatMs: 100, leaseMs: 500, requestDeadlineMs: 300, unknownResolutionMs: 1_000, operationTokenTtlMs: 5_000 },
  targetSafetyRetentionApproved: true, runLifecycleRetentionBounded: true, independentRetentionEnforcementReady: true,
  targetWritersCompatible: true, workerContractCompatible: true },
  operationRetention: { approved: true, revision: "fixture-operation", milliseconds: 10_000 } };

describe("alpha16 dedicated runtime activation and dispatch ordering", () => {
  it("unapproved configuration stops reserve/claim/admission before any database access", async () => {
    const transaction = vi.fn(() => { throw new Error("Unexpected database access"); });
    const store = new RuleOperationStore({ transaction } as unknown as Database, blocked);
    await expect(store.reserve(scope, { binding, actorHash: "actor", idempotencyKey: "key", requestBody: {}, effectDescriptorHash: "b".repeat(64) })).rejects.toThrow("RULE_RUNTIME_POLICY_UNAPPROVED");
    await expect(store.claim(scope, "intent", "worker")).rejects.toThrow("RULE_RUNTIME_POLICY_UNAPPROVED");
    await expect(store.admit(scope, claim)).rejects.toThrow("RULE_RUNTIME_POLICY_UNAPPROVED");
    expect(transaction).not.toHaveBeenCalled();
  });
  it("invokes the provider once, only after admission transaction completion", async () => {
    const order: string[] = [], store = new RuleOperationStore({} as Database, dispatchFixture);
    vi.spyOn(store, "admit").mockImplementation(async () => { order.push("admission-committed"); return binding; });
    vi.spyOn(store, "finish").mockImplementation(async () => { order.push("result-committed"); });
    const provider = vi.fn(async () => { order.push("provider"); return { result: "CONFIRMED_SUCCESS" as const }; });
    await expect(store.dispatch(scope, claim, provider)).resolves.toBe("CONFIRMED_SUCCESS");
    expect(order).toEqual(["admission-committed", "provider", "result-committed"]);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("a provider exception is persisted as UNKNOWN without retry", async () => {
    const store = new RuleOperationStore({} as Database, dispatchFixture);
    vi.spyOn(store, "admit").mockResolvedValue(binding);
    const finish = vi.spyOn(store, "finish").mockResolvedValue(undefined);
    const provider = vi.fn(async () => { throw new Error("Response lost"); });
    await expect(store.dispatch(scope, claim, provider)).resolves.toBe("UNKNOWN");
    expect(provider).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith(scope, claim, "UNKNOWN", undefined);
  });
  it("a failed result commit or rejected admission does not call the provider again", async () => {
    const store = new RuleOperationStore({} as Database, dispatchFixture);
    const admit = vi.spyOn(store, "admit").mockResolvedValue(binding);
    vi.spyOn(store, "finish").mockRejectedValue(new Error("Database commit lost"));
    const provider = vi.fn(async () => ({ result: "CONFIRMED_SUCCESS" as const }));
    await expect(store.dispatch(scope, claim, provider)).rejects.toThrow("Database commit lost");
    expect(provider).toHaveBeenCalledTimes(1);
    admit.mockRejectedValueOnce(new Error("RULE_STALE_WORKER"));
    await expect(store.dispatch(scope, claim, provider)).rejects.toThrow("RULE_STALE_WORKER");
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
