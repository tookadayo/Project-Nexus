import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../packages/db/src/index";
import type { IdentityVault } from "../../packages/identity/src/index";
import { WebhookWorker, type WebhookDispatchOptions } from "../../packages/operations/src/webhooks";

const scope = { organizationId: "00000000-0000-4000-8000-000000000001", guildId: "123456789012345678" };

function unavailableDependencies() {
  const databaseAccess = vi.fn(() => { throw new Error("Unexpected database access"); });
  const vaultAccess = vi.fn(() => { throw new Error("Unexpected vault access"); });
  const transport = vi.fn(async () => { throw new Error("Unexpected transport call"); });
  const db = new Proxy({}, { get: databaseAccess }) as Database;
  const vault = new Proxy({}, { get: vaultAccess }) as IdentityVault;
  return { db, vault, databaseAccess, vaultAccess, transport };
}

describe("webhook worker adoption boundaries", () => {
  it("leaves dependencies untouched when no dispatch profile is supplied", async () => {
    const dependencies = unavailableDependencies();
    const worker = new WebhookWorker(dependencies.db, dependencies.vault, dependencies.transport);
    await expect(worker.tick(scope)).resolves.toBe(false);
    await expect(worker.tick(scope)).resolves.toBe(false);
    expect(dependencies.databaseAccess).not.toHaveBeenCalled();
    expect(dependencies.vaultAccess).not.toHaveBeenCalled();
    expect(dependencies.transport).not.toHaveBeenCalled();
  });

  it.each(["runtime", "dispatch"] as const)("stops before database or transport access for an unapproved %s profile", async kind => {
    const dependencies = unavailableDependencies();
    const verifyCurrentSafety = vi.fn(async () => { throw new Error("Unexpected authority lookup"); });
    // Deliberately invalid fixture configuration cannot confer dispatch authority.
    const options = {
      runtime: { purpose: "APPROVED_RUNTIME", approvalRevision: kind === "runtime" ? "" : "fixture-only",
        heartbeatMs: 100, leaseMs: 5_000, requestDeadlineMs: 3_000, unknownResolutionMs: 10_000, operationTokenTtlMs: 10_000 },
      dispatchPolicy: { approved: kind !== "dispatch", policyRevision: "fixture-only", activationStartedAt: new Date(0),
        targetLiveSafetyMs: 180_000, independentRetentionEnforcementReady: true, targetWritersCompatible: true },
      verifyCurrentSafety,
    } as unknown as WebhookDispatchOptions;
    const worker = new WebhookWorker(dependencies.db, dependencies.vault, dependencies.transport, options);
    await expect(worker.tick(scope)).resolves.toBe(false);
    expect(dependencies.databaseAccess).not.toHaveBeenCalled();
    expect(dependencies.vaultAccess).not.toHaveBeenCalled();
    expect(dependencies.transport).not.toHaveBeenCalled();
    expect(verifyCurrentSafety).not.toHaveBeenCalled();
  });
});
