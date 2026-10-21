import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { connect, ensureGuild, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { IndependentSafetyAuthority, fenceMinimalSafetyForRestore, purgeExpiredMinimalTargetSafety, reconcileIndependentTargetSafety, type IndependentSafetyEvidence } from "../../packages/security/src/alpha16-safety-state";
import { acquireRuleScopeLocks, ruleScopeLockSet } from "../../packages/rules/src/locks";
import { purgeExpiredStaticPublicationManifests } from "../../packages/operations/src/alpha16-publication";
import { OfficialPublications } from "../../packages/operations/src/publication";
import { isolatedPostgres } from "../fixtures/postgres";

// Isolated fixture-only retention/provider, never loaded by a running service.
let db: Database, infra: Awaited<ReturnType<typeof isolatedPostgres>>, serial = 0;
const now = new Date("2026-10-16T12:00:00.000Z"), expires = new Date("2026-10-16T13:00:00.000Z");
beforeAll(async () => { infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); });
async function fixture() {
  const scope = { organizationId: randomUUID(), guildId: String(985180000000000000n + BigInt(++serial)) };
  await ensureGuild(db, scope);
  let current: Extract<IndependentSafetyEvidence, { kind: "TARGET_LIVE_SAFETY" }> = { kind: "TARGET_LIVE_SAFETY", scope, generation: "fixture-1", observedAt: now.toISOString(), expiresAt: expires.toISOString(), policyRevision: "fixture-only", independent: true, complete: true,
    targets: [{ targetType: "AUTOMATION_FLOW", targetId: "flow", liveVersion: "3", safetyEpoch: "4", stateVersion: "7", applyGate: "OPEN", expiresAt: expires.toISOString() }] };
  const safety = new IndependentSafetyAuthority(() => [{ class: "TARGET_LIVE_SAFETY", revision: "fixture-only", approved: true, enforcementVerified: true, durationMs: 3600000 }],
    async () => current, () => now, async input => {
      expect(input.expectedGeneration).toBe(current.generation);
      current = { ...current, generation: "fixture-2", targets: [{ ...input.target, applyGate: "UNKNOWN_BLOCKED", safetyEpoch: "5", stateVersion: "8" }] };
      return current;
    });
  const proof = await safety.observe("TARGET_LIVE_SAFETY", scope);
  await db.transaction().execute(tx => reconcileIndependentTargetSafety(tx, scope, safety, proof, now));
  return { scope, safety, current: () => current };
}
it("never reopens UNKNOWN or renews a root while reconciling, and physically erases its finite state", async () => {
  const f = await fixture();
  await db.transaction().execute(async tx => { await acquireRuleScopeLocks(tx, ruleScopeLockSet(f.scope)); await f.safety.assertTarget(tx, f.scope, "AUTOMATION_FLOW", "flow", now); });
  await sql`UPDATE rule_target_safety SET apply_gate='UNKNOWN_BLOCKED' WHERE ${tenant(f.scope)}`.execute(db);
  const next = await f.safety.observe("TARGET_LIVE_SAFETY", f.scope);
  await db.transaction().execute(tx => reconcileIndependentTargetSafety(tx, f.scope, f.safety, next, now));
  expect((await sql`SELECT apply_gate,expires_at FROM rule_target_safety WHERE ${tenant(f.scope)}`.execute(db)).rows[0]).toEqual({ apply_gate: "UNKNOWN_BLOCKED", expires_at: expires });
  await expect(db.transaction().execute(tx => f.safety.assertTarget(tx, f.scope, "AUTOMATION_FLOW", "flow", now))).rejects.toThrow("INDEPENDENT_TARGET_SAFETY_MISMATCH");
  await db.transaction().execute(tx => purgeExpiredMinimalTargetSafety(tx, f.scope, expires));
  expect((await sql`SELECT * FROM rule_target_safety WHERE ${tenant(f.scope)}`.execute(db)).rows).toEqual([]);
  await expect(db.transaction().execute(tx => f.safety.assertTarget(tx, f.scope, "AUTOMATION_FLOW", "flow", now))).rejects.toThrow("INDEPENDENT_TARGET_SAFETY_MISMATCH");
});
it("commits an independent fence before local admission and consumes the local permission once without deadline extension", async () => {
  const f = await fixture(), admission = await f.safety.prepareTargetAdmission(f.scope, "AUTOMATION_FLOW", "flow", now);
  expect(f.current().targets[0]!.applyGate).toBe("UNKNOWN_BLOCKED");
  await db.transaction().execute(async tx => { await acquireRuleScopeLocks(tx, ruleScopeLockSet(f.scope)); await f.safety.consumeTargetAdmission(tx, f.scope, admission, now); });
  expect((await sql`SELECT apply_gate,safety_epoch,state_version,expires_at FROM rule_target_safety WHERE ${tenant(f.scope)}`.execute(db)).rows[0]).toEqual({ apply_gate: "UNKNOWN_BLOCKED", safety_epoch: "5", state_version: "8", expires_at: expires });
  await expect(db.transaction().execute(tx => f.safety.consumeTargetAdmission(tx, f.scope, admission, now))).rejects.toThrow("INDEPENDENT_TARGET_FENCE_UNVERIFIED");
  await expect(f.safety.prepareTargetAdmission(f.scope, "AUTOMATION_FLOW", "flow", now)).rejects.toThrow("INDEPENDENT_TARGET_SAFETY_MISMATCH");
});
it("does not reuse an admission after rollback/lost commit and cannot restart from the independent old OPEN", async () => {
  const f = await fixture(), admission = await f.safety.prepareTargetAdmission(f.scope, "AUTOMATION_FLOW", "flow", now);
  await expect(db.transaction().execute(async tx => {
    await acquireRuleScopeLocks(tx, ruleScopeLockSet(f.scope)); await f.safety.consumeTargetAdmission(tx, f.scope, admission, now); throw new Error("fixture-rollback");
  })).rejects.toThrow("fixture-rollback");
  await expect(db.transaction().execute(tx => f.safety.consumeTargetAdmission(tx, f.scope, admission, now))).rejects.toThrow("INDEPENDENT_TARGET_FENCE_UNVERIFIED");
  const proof = await f.safety.observe("TARGET_LIVE_SAFETY", f.scope);
  await db.transaction().execute(tx => reconcileIndependentTargetSafety(tx, f.scope, f.safety, proof, now));
  expect((await sql`SELECT apply_gate,expires_at FROM rule_target_safety WHERE ${tenant(f.scope)}`.execute(db)).rows[0]).toEqual({ apply_gate: "UNKNOWN_BLOCKED", expires_at: expires });
});
it("fences restored target/publication authority, erases expired publication roots and preserves STATIC delivery denial", async () => {
  const f = await fixture(), id = randomUUID();
  await sql`INSERT INTO official_publications(id,revision) VALUES(${id}::uuid,1)`.execute(db);
  await sql`INSERT INTO official_publication_revisions(publication_id,revision,content) VALUES(${id}::uuid,1,'{}'::jsonb)`.execute(db);
  await sql`UPDATE official_publications SET status='PUBLISHED',published_revision=1,first_published_at=${now} WHERE id=${id}::uuid`.execute(db);
  await sql`INSERT INTO official_static_publication_heads(publication_id,generation,active_generation,withdrawn_generation,withdrawn_source_version,sync_state,expires_at,safety_expires_at,safety_policy_revision,verified_generation,verified_at,active_artifact_hash)
    VALUES(${id}::uuid,9,9,7,2,'CONFIRMED',${expires},${expires},'fixture-only','fixture-pub',${now},${"a".repeat(64)})`.execute(db);
  await db.transaction().execute(tx => fenceMinimalSafetyForRestore(tx, now));
  expect((await sql`SELECT apply_gate,expires_at,verified_generation FROM rule_target_safety WHERE ${tenant(f.scope)}`.execute(db)).rows[0]).toEqual({ apply_gate: "UNKNOWN_BLOCKED", expires_at: expires, verified_generation: null });
  await purgeExpiredStaticPublicationManifests(db, now, 100);
  expect((await sql`SELECT publication_id FROM official_static_publication_heads WHERE publication_id=${id}::uuid`.execute(db)).rows).toEqual([]);
  expect((await sql`SELECT delivery_mode FROM official_publications WHERE id=${id}::uuid`.execute(db)).rows[0]).toEqual({ delivery_mode: "STATIC" });
  await expect(sql`UPDATE official_publications SET delivery_mode='LEGACY' WHERE id=${id}::uuid`.execute(db)).rejects.toThrow("Static delivery requires an explicit migration");
  expect(await new OfficialPublications(db).publicDetail(id)).toBeNull();
});
