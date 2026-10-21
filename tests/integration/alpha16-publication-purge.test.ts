import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { connect, migrate, sql, type Database } from "../../packages/db/src/index";
import { purgeExpiredStaticPublicationManifests, StaticPublications } from "../../packages/operations/src/alpha16-publication";
import { OfficialPublications } from "../../packages/operations/src/publication";
import { isolatedPostgres } from "../fixtures/postgres";
let infra: Awaited<ReturnType<typeof isolatedPostgres>>, db: Database;
const now = new Date("2026-10-16T12:00:00Z"), created = new Date("2026-10-16T10:00:00Z"), expired = new Date("2026-10-16T11:00:00Z"), future = new Date("2026-10-16T13:00:00Z");
beforeAll(async () => { infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); });
async function source() {
  const id = randomUUID();
  await sql`INSERT INTO official_publications(id,revision) VALUES(${id}::uuid,1)`.execute(db);
  await sql`INSERT INTO official_publication_revisions(publication_id,revision,content) VALUES(${id}::uuid,1,'{}'::jsonb)`.execute(db);
  return id;
}
async function seedHead(id: string, generation: number, active: number | null, pending: number | null, expiry = future) {
  await sql`INSERT INTO official_static_publication_heads(publication_id,generation,active_generation,pending_generation,withdrawn_generation,withdrawn_source_version,sync_state,expires_at,safety_expires_at,safety_policy_revision,verified_generation,verified_at)
    VALUES(${id}::uuid,${generation},${active},${pending},0,0,'CONFIRMED',${expiry},${future},'synthetic-only','isolated-generation',${created})`.execute(db);
}
async function manifest(id: string, generation: number, state: "ACTIVE" | "STAGED" | "RETIRED", effect: "CONFIRMED" | "ADMITTED" | "UNKNOWN" | "PREPARED" | "NOT_STARTED", expiry = expired) {
  await sql`INSERT INTO official_static_publication_manifests(publication_id,generation,source_version,source_row_revision,previous_generation,operation,schema_version,artifact_hash,state,effect_state,created_at,expires_at)
    VALUES(${id}::uuid,${generation},1,1,0,'PUBLISH',1,${"a".repeat(64)},${state},${effect},${created},${expiry})`.execute(db);
}
it("purges expired manifests while keeping closed pointers only until their independent safety deadline and never sends remotely", async () => {
  const id = await source(); await seedHead(id, 1, 1, 2);
  await manifest(id, 1, "ACTIVE", "CONFIRMED"); await manifest(id, 2, "STAGED", "ADMITTED");
  const result = await purgeExpiredStaticPublicationManifests(db, now, 10);
  expect(result.deletedManifests).toBe(2);
  expect(result.ready).toBe(false);
  expect(result.reasonCode).toBe("PUBLICATION_WITHDRAWAL_OR_SAFETY_UNRESOLVED");
  expect(result.withdrawalRequirements).toContainEqual({ publicationId: id, activeGeneration: 1, pendingGeneration: 2, action: "WITHDRAW_OR_CONFIRM_ABSENCE" });
  const head = (await sql<{ generation: string; active_generation: string; pending_generation: string; sync_state: string; expires_at: Date }>`SELECT * FROM official_static_publication_heads WHERE publication_id=${id}::uuid`.execute(db)).rows[0]!;
  expect(head).toMatchObject({ generation: "1", active_generation: "1", pending_generation: "2", sync_state: "UNKNOWN" });
  expect(head.expires_at.getTime()).toBe(now.getTime());
  expect((await sql`SELECT generation FROM official_static_publication_manifests WHERE publication_id=${id}::uuid`.execute(db)).rows).toEqual([]);
  const send = vi.fn(), publisher = { capability: { atomicSwitch: true, conditionalGeneration: true, readBackHash: true, routeWithdrawal: true, cacheBehaviorVerified: true }, switchGeneration: send, readGeneration: vi.fn() };
  const service = new StaticPublications(db, { enabled: true, canonicalOriginsVerified: true, authorize: async () => {}, publisher,
    retention: [{ class: "PUBLICATION_HISTORY", revision: "synthetic-only", approved: true, durationMs: 60000, enforcementVerified: true }] });
  // History approval alone cannot configure independent withdrawal safety.
  await expect(service.stage({ publicationId: id, expectedSourceRevision: 1, expectedGeneration: 1, operation: "PUBLISH", confirmed: true, translationsReviewed: true, target: "public-site" }, now)).rejects.toThrow("PUBLIC_PUBLISH_UNAVAILABLE");
  expect(send).not.toHaveBeenCalled();
  const nextTick = await purgeExpiredStaticPublicationManifests(db, now, 10);
  expect(nextTick.ready).toBe(false);
  expect(nextTick.deletedManifests).toBe(0);
  expect(nextTick.withdrawalRequirements).toContainEqual(result.withdrawalRequirements.find(row => row.publicationId === id));
});
it("removes only obsolete history, retains newer active rows and preserves withdrawal barriers", async () => {
  const id = await source(); await seedHead(id, 2, 2, null);
  await sql`UPDATE official_static_publication_heads SET withdrawn_generation=1,withdrawn_source_version=1 WHERE publication_id=${id}::uuid`.execute(db);
  await manifest(id, 1, "RETIRED", "CONFIRMED"); await manifest(id, 2, "ACTIVE", "CONFIRMED", future);
  await purgeExpiredStaticPublicationManifests(db, now, 10);
  expect((await sql`SELECT generation FROM official_static_publication_manifests WHERE publication_id=${id}::uuid`.execute(db)).rows).toEqual([{ generation: "2" }]);
  const head = (await sql`SELECT generation,withdrawn_generation,withdrawn_source_version,sync_state,expires_at FROM official_static_publication_heads WHERE publication_id=${id}::uuid`.execute(db)).rows[0]!;
  expect(head).toMatchObject({ generation: "2", withdrawn_generation: "1", withdrawn_source_version: 1, sync_state: "CONFIRMED", expires_at: future });
});
it("keeps expiry work bounded and reports another batch without extending any deadlines", async () => {
  const id = await source(); await seedHead(id, 3, 3, null);
  await manifest(id, 1, "RETIRED", "NOT_STARTED"); await manifest(id, 2, "RETIRED", "CONFIRMED");
  const first = await purgeExpiredStaticPublicationManifests(db, now, 1);
  expect(first.deletedManifests).toBe(1); expect(first.moreExpired).toBe(true);
  const second = await purgeExpiredStaticPublicationManifests(db, now, 1);
  expect(second.deletedManifests).toBe(1); expect(second.moreExpired).toBe(false);
  expect((await sql`SELECT expires_at FROM official_static_publication_heads WHERE publication_id=${id}::uuid`.execute(db)).rows[0]).toEqual({ expires_at: future });
});
it("blocks expired history before later manifest expiry and erases expired orphan roots without reopening them", async () => {
  const id = await source(); await seedHead(id, 1, 1, null, expired); await manifest(id, 1, "ACTIVE", "CONFIRMED", future);
  const orphan = await source(); await manifest(orphan, 1, "STAGED", "UNKNOWN");
  const result = await purgeExpiredStaticPublicationManifests(db, now, 10);
  expect(result.ready).toBe(false);
  expect(result.withdrawalRequirements.some(row => row.publicationId === id)).toBe(true);
  expect((await sql`SELECT generation FROM official_static_publication_manifests WHERE publication_id=${id}::uuid`.execute(db)).rows).toHaveLength(1);
  expect((await sql`SELECT generation FROM official_static_publication_heads WHERE publication_id=${orphan}::uuid`.execute(db)).rows).toEqual([]);
  expect("deletedSafetyRoots" in result && result.deletedSafetyRoots).toBeGreaterThanOrEqual(1);
  expect((await new StaticPublications(db).status(orphan)).generation).toBeNull();
  expect((await sql`SELECT revision FROM official_publication_revisions WHERE publication_id=${orphan}::uuid`.execute(db)).rows).toEqual([{ revision: 1 }]);
});
it("does not expose an expired static publication through the legacy PC public-news reader", async () => {
  const id = await source(); await seedHead(id, 1, 1, null, new Date("2000-01-01T00:00:00Z")); await manifest(id, 1, "ACTIVE", "CONFIRMED", expired);
  await sql`UPDATE official_publications SET status='PUBLISHED',published_revision=1,first_published_at=${created},delivery_mode='STATIC' WHERE id=${id}::uuid`.execute(db);
  const reader = new OfficialPublications(db);
  expect(await reader.publicDetail(id)).toBeNull();
  expect((await reader.publicList()).items.some(row => row.id === id)).toBe(false);
  await purgeExpiredStaticPublicationManifests(db, now, 10);
  expect(await reader.publicDetail(id)).toBeNull();
  const final = await purgeExpiredStaticPublicationManifests(db, future, 200);
  expect(final.ready).toBe(false);
  expect("externalPublicationReady" in final && final.externalPublicationReady).toBe(false);
  expect((await sql`SELECT generation FROM official_static_publication_heads WHERE publication_id=${id}::uuid`.execute(db)).rows).toEqual([]);
  // delivery_mode remains a source-level classification, not a copied root.
  expect(await reader.publicDetail(id)).toBeNull();
});
