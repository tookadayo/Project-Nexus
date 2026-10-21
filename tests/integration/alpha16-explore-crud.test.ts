import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { isolatedPostgres } from "../fixtures/postgres";
import { connect, ensureGuild, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import { ExploreService } from "../../packages/analytics/src/explore";
import type { Actor } from "../../packages/settings/src/index";

let infra: Awaited<ReturnType<typeof isolatedPostgres>>, db: Database, serial = 984100000000000000n;
const actor: Actor = { key: "alpha16-explore-admin", permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: "fixture" };
beforeAll(async () => { infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); });
async function fixture(plan = "STARTER") {
  const scope = scopeForGuild(String(serial++)); await ensureGuild(db, scope);
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status) VALUES(${scope.organizationId}::uuid,${scope.guildId},${plan},'active') ON CONFLICT(organization_id,guild_id) DO UPDATE SET plan_key=EXCLUDED.plan_key,status='active'`.execute(db);
  return scope;
}
it("updates and deletes standalone filters under the current revision and scope only", async () => {
  const s = await fixture(), other = await fixture(), service = new ExploreService(db);
  const segment = await service.saveSegment(s, actor, { name: "Initial", filters: {} });
  const updated = await service.saveSegment(s, actor, { id: segment.id, revision: segment.revision, name: "Updated", filters: { surface: "VOICE" } });
  await expect(service.removeSegment(s, actor, segment)).rejects.toThrow("REVISION_CONFLICT");
  await expect(service.removeSegment(other, actor, updated)).rejects.toThrow("SEGMENT_NOT_FOUND");
  expect((await service.segments(s))[0]).toMatchObject({ id: segment.id, name: "Updated", filters: { surface: "VOICE" }, revision: 2 });
  expect(await service.removeSegment(s, actor, updated)).toEqual({ id: segment.id, deleted: true });
  expect(await service.segments(s)).toEqual([]);
});
it("prevents stale view deletion and keeps report references until explicitly removed", async () => {
  const s = await fixture(), service = new ExploreService(db);
  const view = await service.save(s, actor, { name: "View" });
  const updated = await service.save(s, actor, { id: view.id, revision: view.revision, name: "Renamed", days: 30 });
  await expect(service.removeView(s, actor, view)).rejects.toThrow("REVISION_CONFLICT");
  const report = randomUUID();
  await sql`INSERT INTO report_templates(organization_id,guild_id,id,title,queries,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${report}::uuid,'Fixture','[]'::jsonb,${actor.key})`.execute(db);
  await sql`INSERT INTO report_template_views VALUES(${s.organizationId}::uuid,${s.guildId},${report}::uuid,${view.id}::uuid)`.execute(db);
  await expect(service.removeView(s, actor, updated)).rejects.toThrow("SAVED_VIEW_IN_USE");
  expect(await service.list(s)).toHaveLength(1);
  await sql`DELETE FROM report_template_views WHERE ${tenant(s)} AND template_id=${report}::uuid`.execute(db);
  expect(await service.removeView(s, actor, updated)).toEqual({ id: view.id, deleted: true });
  expect(await service.list(s)).toEqual([]);
  expect((await sql`SELECT id FROM operational_segments WHERE ${tenant(s)}`.execute(db)).rows).toEqual([]);
  expect((await sql`SELECT id FROM report_templates WHERE ${tenant(s)}`.execute(db)).rows).toHaveLength(1);
});
it("does not let standalone-filter CRUD rewrite or cascade a view-owned filter", async () => {
  const s = await fixture(), service = new ExploreService(db), view = await service.save(s, actor, { name: "Owned" });
  const hidden = (await sql<{ id: string; revision: number }>`SELECT id,revision FROM operational_segments WHERE ${tenant(s)} AND name=${"view:" + view.id}`.execute(db)).rows[0]!;
  await expect(service.saveSegment(s, actor, { ...hidden, name: "Hijacked", filters: {} })).rejects.toThrow("SEGMENT_IN_USE");
  await expect(service.removeSegment(s, actor, hidden)).rejects.toThrow("SEGMENT_IN_USE");
  expect(await service.list(s)).toHaveLength(1);
});
it("rechecks write permission and current plan for deletion", async () => {
  const s = await fixture(), service = new ExploreService(db), view = await service.save(s, actor, { name: "Protected" });
  await expect(service.removeView(s, { ...actor, key: "viewer", permissions: "0" }, view)).rejects.toThrow("ADMIN_REQUIRED");
  await sql`UPDATE guild_subscriptions SET plan_key='FREE' WHERE ${tenant(s)}`.execute(db);
  await expect(service.removeView(s, actor, view)).rejects.toThrow("PLAN_REQUIRED");
  expect((await sql`SELECT id FROM saved_metric_views WHERE ${tenant(s)}`.execute(db)).rows).toHaveLength(1);
});
