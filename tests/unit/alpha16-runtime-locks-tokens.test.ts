import { describe, expect, it } from "vitest";
import type { Tx } from "../../packages/db/src/index";
import {
  acquireRuleScopeLocks, createRuleLockPlan, ruleScopeLockSet, scopeLockIds,
} from "../../packages/rules/src/locks";
import {
  idempotencyFingerprint, issueDeletionReceiptSecret, issueOperationToken,
  replayIdempotency, ruleCanonicalHash, validateDeletionReceiptSecret, validateOperationToken,
  type OperationTokenBinding,
} from "../../packages/rules/src/tokens";

const scope = { organizationId: "00000000-0000-4000-8000-000000000001", guildId: "123456789012345678" };
const now = new Date("2026-10-16T12:00:00.000Z");
const expiresAt = "2026-10-16T13:00:00.000Z";
function binding(): OperationTokenBinding {
  return { ...scope, intentId: "intent-1", targetType: "AUTOMATION_FLOW", targetId: "flow-1",
    liveVersion: "1", action: "SEND_MESSAGE", suggestionId: "suggestion-1", suggestionVersion: "2",
    draftId: "draft-1", immutableDraftRevisionId: "revision-2", draftContentHash: "a".repeat(64),
    approvalId: "approval-1", safetyEpoch: "4", issuedAt: "2026-10-16T11:59:00.000Z", expiresAt };
}
function authorization() { return { scope, authorized: true, tombstoned: false, intentExists: true, intentId: "intent-1", now }; }

describe("alpha16 canonical PG scope and row locks", () => {
  it("orders actual signed lock IDs independently of caller order and removes duplicates", () => {
    const scopes = ruleScopeLockSet(scope);
    const locks = scopeLockIds([...scopes, ...scopes].reverse());
    expect(locks).toEqual(scopeLockIds(scopes));
    expect(locks).toHaveLength(3);
    expect(locks.map(lock => BigInt(lock.id))).toEqual(locks.map(lock => BigInt(lock.id)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0));
    expect(scopeLockIds([...scopes, { kind: "GLOBAL", mode: "exclusive" }]).filter(lock => lock.mode === "exclusive")).toHaveLength(2);
  });
  it("shares ancestor IDs across guilds and gives global deletion the same exclusive root", () => {
    const ordinary = scopeLockIds(ruleScopeLockSet(scope));
    const deletion = scopeLockIds(ruleScopeLockSet(scope, { globalMode: "exclusive" }));
    expect(ordinary.map(lock => lock.id)).toEqual(deletion.map(lock => lock.id));
    const another = scopeLockIds(ruleScopeLockSet({ ...scope, guildId: "999999999999999999" }));
    expect(ordinary.filter(lock => another.some(other => other.id === lock.id))).toHaveLength(2);
  });
  it("canonicalizes row rank first and key second, with no outbox rank or tombstone creation", () => {
    const plan = createRuleLockPlan(ruleScopeLockSet(scope), [
      { rank: "FACT", key: "f" }, { rank: "INTENT", key: "b" },
      { rank: "TOMBSTONE", key: "missing" }, { rank: "INTENT", key: "a" },
      { rank: "TARGET", key: "root" }, { rank: "INTENT", key: "a" },
    ]);
    expect(plan.rows.map(row => row.rank + ":" + row.key)).toEqual(["TOMBSTONE:missing", "TARGET:root", "INTENT:a", "INTENT:b", "FACT:f"]);
    expect(Object.isFrozen(plan.rows)).toBe(true);
  });
  it("refuses an autocommit lock and a scope missing the global ancestor", async () => {
    await expect(acquireRuleScopeLocks({ isTransaction: false } as unknown as Tx, ruleScopeLockSet(scope))).rejects.toThrow("RULE_TRANSACTION_REQUIRED");
    expect(() => scopeLockIds([{ kind: "GUILD", ...scope, mode: "exclusive" }])).toThrow("RULE_GLOBAL_LOCK_REQUIRED");
  });
});

describe("alpha16 purpose separation and replay authorization", () => {
  it("operation tokens bind exact immutable approval and draft content", () => {
    const expected = binding(), issued = issueOperationToken(expected);
    expect(issued.token).toMatch(/^n16op\.[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(issued.stored)).not.toContain(issued.token);
    expect(validateOperationToken({ token: issued.token, stored: issued.stored, expected, authorization: authorization() })).toEqual(expected);
    for (const field of ["targetId", "liveVersion", "action", "suggestionVersion", "immutableDraftRevisionId", "approvalId", "safetyEpoch"] as const) {
      const value = field === "safetyEpoch" ? "5" : "changed";
      expect(() => validateOperationToken({ token: issued.token, stored: issued.stored, expected: { ...expected, [field]: value }, authorization: authorization() })).toThrow("RULE_TOKEN_BINDING_MISMATCH");
    }
  });
  it("rechecks current authorization and tombstone before disclosing operation state", () => {
    const expected = binding(), issued = issueOperationToken(expected);
    const input = { token: issued.token, stored: issued.stored, expected, authorization: authorization() };
    expect(() => validateOperationToken({ ...input, authorization: { ...authorization(), authorized: false } })).toThrow("FORBIDDEN");
    expect(() => validateOperationToken({ ...input, authorization: { ...authorization(), tombstoned: true } })).toThrow("RESOURCE_DELETED");
    expect(() => validateOperationToken({ ...input, stored: null })).toThrow("IDEMPOTENCY_INTENT_GONE");
    expect(() => validateOperationToken({ ...input, authorization: { ...authorization(), intentExists: false } })).toThrow("IDEMPOTENCY_INTENT_GONE");
    expect(() => validateOperationToken({ ...input, authorization: { ...authorization(), now: new Date(expiresAt) } })).toThrow("IDEMPOTENCY_TOKEN_EXPIRED");
  });
  it("the deletion receipt has status-only purpose and cannot substitute for an operation token", () => {
    const receipt = issueDeletionReceiptSecret(), issued = issueOperationToken(binding());
    expect(() => validateDeletionReceiptSecret(receipt.secret, receipt.secretHash)).not.toThrow();
    expect(() => validateOperationToken({ token: receipt.secret, stored: issued.stored, expected: binding(), authorization: authorization() })).toThrow("RULE_TOKEN_INVALID");
    expect(() => validateDeletionReceiptSecret(issued.token, receipt.secretHash)).toThrow("RULE_TOKEN_INVALID");
  });
  it("same-key retries reconstruct only the same existing intent and never create a new one", () => {
    const fingerprint = idempotencyFingerprint(scope, "APPLY", "client-key", { draft: "r1", fields: { b: 2, a: 1 } });
    expect(fingerprint).toEqual(idempotencyFingerprint(scope, "APPLY", "client-key", { fields: { a: 1, b: 2 }, draft: "r1" }));
    const stored = { ...fingerprint, intentId: "intent-1", expiresAt };
    expect(replayIdempotency({ stored, fingerprint, authorization: authorization() })).toEqual({ intentId: "intent-1", replay: true });
    expect(() => replayIdempotency({ stored: null, fingerprint, authorization: authorization() })).toThrow("IDEMPOTENCY_INTENT_GONE");
    expect(() => replayIdempotency({ stored, fingerprint: { ...fingerprint, bodyHash: ruleCanonicalHash({ draft: "r2" }) }, authorization: authorization() })).toThrow("IDEMPOTENCY_BODY_MISMATCH");
    expect(() => replayIdempotency({ stored, fingerprint, authorization: { ...authorization(), tombstoned: true } })).toThrow("RESOURCE_DELETED");
    expect(() => replayIdempotency({ stored, fingerprint, authorization: { ...authorization(), now: new Date(expiresAt) } })).toThrow("IDEMPOTENCY_TOKEN_EXPIRED");
  });
});
