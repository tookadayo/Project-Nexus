import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { isolatedPostgres } from "../fixtures/postgres";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/index";
import { operationsPresentation } from "../../packages/operations/src/access-presentation";
import { BetaOperator } from "../../packages/security/src/beta-operator";
import { betaInvitation } from "../../packages/security/src/hosted-beta";
import { ExploreService } from "../../packages/analytics/src/explore";
import type { Actor } from "../../packages/settings/src/index";
let infra: Awaited<ReturnType<typeof isolatedPostgres>>,
  db: Database,
  guild = 986000000000000000n;
const actor: Actor = {
  key: "synthetic-actor",
  permissions: "8",
  roles: [],
  source: "WEB_DASHBOARD",
  requestId: "access-presentation",
};
beforeAll(async () => {
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
afterEach(() => vi.unstubAllEnvs());
async function fixture(plan = "GROWTH", role = "ADMIN") {
  const s = scopeForGuild(String(guild++)),
    member = randomUUID();
  await ensureGuild(db, s);
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status) VALUES(${s.organizationId}::uuid,${s.guildId},${plan},'active')`.execute(
    db,
  );
  await sql`INSERT INTO operations_organizations(id,name,home_guild_id) VALUES(${s.organizationId}::uuid,'Synthetic',${s.guildId})`.execute(
    db,
  );
  await sql`INSERT INTO operations_org_guilds(root_organization_id,organization_id,guild_id) VALUES(${s.organizationId}::uuid,${s.organizationId}::uuid,${s.guildId})`.execute(
    db,
  );
  await sql`INSERT INTO operations_org_members(organization_id,id,user_digest,user_ciphertext,name,role) VALUES(${s.organizationId}::uuid,${member}::uuid,'synthetic-digest','synthetic-unused','Synthetic',${role})`.execute(
    db,
  );
  await sql`INSERT INTO operations_role_bindings VALUES(${s.organizationId}::uuid,${s.guildId},${s.organizationId}::uuid,${member}::uuid,${actor.key})`.execute(
    db,
  );
  return s;
}
const current = (s: ReturnType<typeof scopeForGuild>) =>
  db.transaction().execute((tx) => operationsPresentation(tx, s, actor));
it("matches real saved-view authorization for ADMIN, ANALYST, OPERATOR and VIEWER", async () => {
  for (const role of ["ADMIN", "ANALYST", "OPERATOR", "VIEWER"]) {
    const s = await fixture("GROWTH", role),
      access = await current(s),
      allowed = ["ADMIN", "ANALYST"].includes(role),
      service = new ExploreService(db);
    expect(access.canSave).toBe(allowed);
    expect(access.saveReason).toBe(allowed ? null : "NEXUS_ROLE_REQUIRED");
    const save = service.save(s, actor, { name: "Synthetic view" });
    if (allowed) await expect(save).resolves.toHaveProperty("id");
    else await expect(save).rejects.toThrow("NEXUS_ROLE_REQUIRED");
    expect(access.access.usage === null).toBe(!allowed);
  }
});
it("distinguishes a plan restriction and honors a current feature grant", async () => {
  const s = await fixture("FREE"),
    service = new ExploreService(db);
  expect((await current(s)).saveReason).toBe("PLAN_REQUIRED");
  await expect(service.save(s, actor, { name: "Synthetic" })).rejects.toThrow(
    "PLAN_REQUIRED",
  );
  await sql`INSERT INTO entitlement_grants(id,organization_id,guild_id,source,features,limits,ends_at,created_by,reason) VALUES(${randomUUID()}::uuid,${s.organizationId}::uuid,${s.guildId},'PARTNER','["surface_breakdowns"]'::jsonb,'{}'::jsonb,clock_timestamp()+interval '1 hour','synthetic','test')`.execute(
    db,
  );
  expect((await current(s)).canSave).toBe(true);
  await expect(
    service.save(s, actor, { name: "Synthetic" }),
  ).resolves.toHaveProperty("id");
});
it("reading current conditions repeatedly never reserves or consumes a run", async () => {
  const s = await fixture();
  const before = await current(s);
  for (let i = 0; i < 3; i++)
    expect((await current(s)).access.usage).toEqual(before.access.usage);
  for (const table of [
    "analysis_reservations",
    "analysis_usage_ledger",
    "analysis_runs",
  ]) {
    const rows = (
      await sql`SELECT * FROM ${sql.table(table)} WHERE ${tenant(s)}`.execute(
        db,
      )
    ).rows;
    expect(rows).toEqual([]);
  }
});
it("separates Beta from its base plan, applies pause/expiry and never turns unknown quota into zero", async () => {
  const s = await fixture("FREE");
  vi.stubEnv("NEXUS_HOSTED_BETA", "on");
  const operator = new BetaOperator(db, async () => ({
    name: "Synthetic",
    present: true,
    canObserve: true,
    checkedAt: Date.now(),
  }));
  const change = async (action: "register" | "activate" | "pause") =>
    operator.change({
      guildId: s.guildId,
      action,
      generation: (await betaInvitation(db, s))?.generation ?? null,
      requestId: randomUUID(),
      reason: "Synthetic test",
    });
  await change("register");
  await change("activate");
  let result = await current(s);
  expect(result.access.plan).toBe("FREE");
  expect(result.access.benefits.some((b) => b.kind === "BETA")).toBe(true);
  expect(result.access.beta?.limits.daily).toBe(3);
  expect(result.canSave).toBe(true);
  const explore = new ExploreService(db);
  await expect(explore.chart(s, { days: 30, compare: true })).rejects.toThrow(
    "HISTORY_PLAN_LIMIT",
  );
  await expect(
    explore.chart(s, { days: 30, compare: false }),
  ).resolves.toHaveProperty("range.days", 30);
  await expect(
    explore.chart(s, { days: 7, compare: true }),
  ).resolves.toHaveProperty("range.days", 7);
  expect((await current(s)).access.usage).toEqual(result.access.usage);
  await change("pause");
  result = await current(s);
  expect(result.canSave).toBe(false);
  expect(result.saveReason).toBe("BETA_UNAVAILABLE");
  expect(result.access.usage).toBeNull();
  await expect(
    new ExploreService(db).save(s, actor, { name: "No paused save" }),
  ).rejects.toThrow("BETA_UNAVAILABLE");
  await sql`UPDATE beta_guild_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE ${tenant(s)}`.execute(
    db,
  );
  expect((await current(s)).access.beta?.state).toBe("EXPIRED");
});
