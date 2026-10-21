import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { infrastructure } from "../fixtures/infrastructure";
import { connect, ensureGuild, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/scoping";
import { ServerAuthorization } from "../../packages/security/src/server-authorization";
import { IdentityVault } from "../../packages/identity/src/index";
import { SettingsService, type Actor } from "../../packages/settings/src/index";
import { OperationsOrganization } from "../../packages/operations/src/organization";
import { Reports, purgeExpiredManualReports, purgeManualReportsActor, type ManualReportProfile } from "../../packages/operations/src/reports";
import { Destinations } from "../../packages/operations/src/destinations";
import { ReportWorker } from "../../apps/worker/src/reports";
import { FakeDiscord } from "../fixtures/discord";

let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database, guild = 967000000000000000n;
const owner = "967000000000000001", viewer = "967000000000000002", channel = "967000000000000003";
const vault = new IdentityVault("ac".repeat(32), "be".repeat(32));
// Synthetic policy for isolated fixtures only; production stays unconfigured.
const profile: ManualReportProfile = { enabled: true, artifactRetentionApproved: true, artifactRetentionSeconds: 3600,
  policyRevision: "fixture-not-approval", leaseSeconds: 60, privacyCoverageVerified: true, sourceVisibilityVerified: true,
  maxPendingRuns: 2, maxResultBytes: 1048576 };
beforeAll(async () => { infra = await infrastructure(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); });
async function fixture() {
  const s = scopeForGuild(String(guild++)); await ensureGuild(db, s);
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status) VALUES(${s.organizationId}::uuid,${s.guildId},'SCALE','active')`.execute(db);
  const discord = new FakeDiscord();
  for (const id of [owner, viewer]) discord.members.set(id, { permissions: "8", roles: [], joinedAt: "2026-01-01T00:00:00Z", bot: false, pending: false });
  const authority = new ServerAuthorization(discord, new SettingsService(db), vault), actor: Actor = {
    key: vault.hash(s, owner), encryptedUserId: vault.seal(s, owner), permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: "isolated-fixture",
    organizationMemberDigest: root => vault.digest("operations-staff", root + ":" + owner),
  };
  const proof = (a = actor) => ({ scope: s, actorHash: a.key, expiresAt: new Date(Date.now() + 10000) });
  const reports = (a = actor) => new Reports(db, { manual: profile, authorization: proof(a) });
  const organization = (a = actor, enabled = false) => new OperationsOrganization(db, vault, discord, authority, { authorization: proof(a),
    maintenance: enabled ? { scopeVerified: true, allowClose: true, allowUnlink: true } : undefined });
  return { s, actor, discord, authority, proof, reports, organization };
}
async function template(f: Awaited<ReturnType<typeof fixture>>) {
  return f.reports().template(f.s, f.actor, { title: "運営の状況 / Operations", queries: [{ metric: "reply" }], footer: "Observed evidence only" });
}
it("queues one frozen manual request without a schedule, delivery or automatic backfill", async () => {
  const f = await fixture(), t = await template(f), request = { templateId: t.id, templateRevision: t.revision, requestId: randomUUID() };
  await expect(new Reports(db).requestGeneration(f.s, f.actor, request)).rejects.toThrow("REPORT_ARTIFACT_RETENTION_REQUIRED");
  await expect(new Reports(db, { manual: profile }).requestGeneration(f.s, f.actor, request)).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
  const first = await f.reports().requestGeneration(f.s, f.actor, request);
  const repeat = await f.reports().requestGeneration(f.s, f.actor, request, new Date(Date.now() + 1000));
  expect(repeat).toEqual(first); expect(first.deliveryMode).toBe("NONE");
  await expect(f.reports().requestGeneration(f.s, f.actor, { ...request, templateRevision: 2 })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  expect((await sql`SELECT id FROM report_schedules WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  expect((await sql`SELECT id FROM action_outbox WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  expect(await new ReportWorker(db).tick(f.s)).toBe(false);
  expect((await sql<{ state: string }>`SELECT state FROM report_runs WHERE ${tenant(f.s)} AND id=${request.requestId}::uuid`.execute(db)).rows[0]!.state).toBe("PENDING");
  const worker = new ReportWorker(db, { manual: { profile, vault, discord: f.discord } });
  expect(await worker.tickManual(f.s)).toBe(true);
  const result = await f.reports().resultDetail(f.s, f.actor, request.requestId);
  expect(result.available).toBe(true); expect(result.artifact?.asOf).toBe(first.asOf); expect(result.artifact?.deliveryMode).toBe("NONE");
  expect(f.discord.calls).not.toContain("sendPanel");
  expect((await sql`SELECT id FROM action_outbox WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  await expect(f.reports().deleteResult(f.s, f.actor, { id: request.requestId, revision: 1 })).rejects.toThrow("REVISION_CONFLICT");
  expect(await f.reports().deleteResult(f.s, f.actor, { id: request.requestId, revision: result.revision })).toMatchObject({ deleted: true });
});
it("hides expired or newly restricted artifacts and never uses expiration to restore a permission", async () => {
  const f = await fixture(), t = await template(f), requestId = randomUUID();
  await f.reports().requestGeneration(f.s, f.actor, { templateId: t.id, templateRevision: 1, requestId });
  await new ReportWorker(db, { manual: { profile, vault, discord: f.discord } }).tickManual(f.s);
  await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,parent_id,visibility_state,collection_forbidden,observed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${channel},0,NULL,'HIDDEN',true,now())`.execute(db);
  const hidden = await f.reports().resultDetail(f.s, f.actor, requestId);
  expect(hidden.available).toBe(false); expect(hidden.artifact).toBeNull(); expect(hidden.unavailableReason).toBe("REPORT_SOURCE_VISIBILITY_CHANGED");
  await sql`UPDATE report_runs SET result_expires_at=now()-interval '1 second' WHERE ${tenant(f.s)} AND id=${requestId}::uuid`.execute(db);
  const expired = await f.reports().resultDetail(f.s, f.actor, requestId);
  expect(expired.artifact).toBeNull(); expect(expired.unavailableReason).toBe("REPORT_RESULT_EXPIRED");
  await db.transaction().execute(tx => purgeExpiredManualReports(tx, f.s));
  await expect(f.reports().resultDetail(f.s, f.actor, requestId)).rejects.toThrow("REPORT_RESULT_NOT_FOUND");
});
it("rechecks current worker authority and conservatively deletes participant-derived manual artifacts", async () => {
  const f = await fixture(), t = await template(f), requestId = randomUUID();
  await f.reports().requestGeneration(f.s, f.actor, { templateId: t.id, templateRevision: 1, requestId });
  f.discord.members.get(owner)!.permissions = "0";
  await expect(new ReportWorker(db, { manual: { profile, vault, discord: f.discord } }).tickManual(f.s)).rejects.toThrow("ADMIN_REQUIRED");
  expect((await sql<{ state: string }>`SELECT state FROM report_runs WHERE ${tenant(f.s)} AND id=${requestId}::uuid`.execute(db)).rows[0]!.state).toBe("PENDING");
  await db.transaction().execute(tx => purgeManualReportsActor(tx, f.s, vault.hash(f.s, viewer)));
  expect((await sql`SELECT id FROM report_runs WHERE ${tenant(f.s)} AND run_kind='MANUAL'`.execute(db)).rows).toHaveLength(0);
});
it("uses CAS and rejects referenced template/schedule removal without clearing history", async () => {
  const f = await fixture(), t = await template(f), destination = await new Destinations(db, f.discord).create(f.s, f.actor, { name: "Fixture", kind: "DISCORD", channelId: channel });
  const schedule = await f.reports().schedule(f.s, f.actor, { templateId: t.id, destinationId: destination.id, clock: { cadence: "WEEKLY", timezone: "UTC", day: 1, hour: 8, minute: 0 } });
  await expect(f.reports().removeTemplate(f.s, f.actor, { id: t.id, revision: 1 })).rejects.toThrow("REPORT_TEMPLATE_IN_USE");
  await expect(f.reports().removeSchedule(f.s, f.actor, { id: schedule.id, revision: 2 })).rejects.toThrow("REVISION_CONFLICT");
  await f.reports().removeSchedule(f.s, f.actor, { id: schedule.id, revision: 1 });
  await f.reports().removeTemplate(f.s, f.actor, { id: t.id, revision: 1 });
  expect((await f.reports().list(f.s, f.actor)).templates).toHaveLength(0);
});
it("updates/deletes unused teams with CAS while preserving destinations and revoked-member constraints", async () => {
  const f = await fixture(); await f.organization().create(f.s, f.actor, owner, "Fixture organization");
  const member = await f.organization().member(f.s, f.actor, { userId: viewer, name: "Viewer", role: "VIEWER" });
  const team = await f.organization().team(f.s, f.actor, { name: "Review", memberIds: [member.id] });
  const changed = await f.organization().updateTeam(f.s, f.actor, { id: team.id, revision: 1, name: "Review renamed", memberIds: [member.id] });
  expect(changed.revision).toBe(2);
  await expect(f.organization().deleteTeam(f.s, f.actor, { id: team.id, revision: 1 })).rejects.toThrow("REVISION_CONFLICT");
  const destination = await new Destinations(db, f.discord).create(f.s, f.actor, { name: "Review destination", kind: "TEAM", teamId: team.id });
  await expect(f.organization().deleteTeam(f.s, f.actor, { id: team.id, revision: 2 })).rejects.toThrow("TEAM_IN_USE");
  const own = ((await f.organization().detail(f.s, f.actor)).members as { id: string; role: string }[]).find(row => row.role === "OWNER")!;
  await expect(f.organization().updateTeam(f.s, f.actor, { id: team.id, revision: 2, name: "Dangerous replacement", memberIds: [own.id] })).rejects.toThrow("TEAM_IN_USE");
  expect((await sql<{ team_id: string }>`SELECT team_id FROM integration_destinations WHERE ${tenant(f.s)} AND id=${destination.id}::uuid`.execute(db)).rows[0]!.team_id).toBe(team.id);
  await expect(db.transaction().execute(tx => sql`DELETE FROM operations_teams WHERE organization_id=${f.s.organizationId}::uuid AND id=${team.id}::uuid`.execute(tx))).rejects.toMatchObject({ code: "23503" });
  const viewerActor = { ...f.actor, key: vault.hash(f.s, viewer), encryptedUserId: vault.seal(f.s, viewer) };
  await expect(f.organization(viewerActor).deleteTeam(f.s, viewerActor, { id: team.id, revision: 2 })).rejects.toThrow("NEXUS_ROLE_REQUIRED");
  await sql`DELETE FROM integration_destinations WHERE ${tenant(f.s)} AND id=${destination.id}::uuid`.execute(db);
  await f.organization().deleteTeam(f.s, f.actor, { id: team.id, revision: 2 });
  expect((await f.organization().detail(f.s, f.actor)).teams).toHaveLength(0);
});
it("renames a current organization but keeps close/unlink explicitly gated and reference-safe", async () => {
  const f = await fixture(); await f.organization().create(f.s, f.actor, owner, "Before");
  expect(await f.organization().renameOrganization(f.s, f.actor, { revision: 1, name: "After" })).toMatchObject({ revision: 2 });
  await expect(f.organization().renameOrganization(f.s, f.actor, { revision: 1, name: "Stale" })).rejects.toThrow("REVISION_CONFLICT");
  await expect(f.organization().closeOrganization(f.s, f.actor, { revision: 2 })).rejects.toThrow("ORGANIZATION_CLOSE_SCOPE_UNVERIFIED");
  await expect(f.organization().unlinkGuild(f.s, f.actor, owner, { guildId: f.s.guildId, revision: 1 })).rejects.toThrow("ORGANIZATION_UNLINK_SCOPE_UNVERIFIED");
  await f.organization().member(f.s, f.actor, { userId: viewer, name: "Must preserve", role: "VIEWER" });
  await expect(f.organization(f.actor, true).closeOrganization(f.s, f.actor, { revision: 2 })).rejects.toThrow("ORGANIZATION_MEMBERS_REMAIN");
  const target = await fixture(); await f.organization().link(f.s, f.actor, owner, target.s.guildId);
  expect(await f.organization(f.actor, true).unlinkGuild(f.s, f.actor, owner, { guildId: target.s.guildId, revision: 1 })).toMatchObject({ state: "DETACHED", revision: 2, authorizationBindingsPreserved: true });
  expect((await sql`SELECT actor_hash FROM operations_role_bindings WHERE ${tenant(target.s)}`.execute(db)).rows.length).toBeGreaterThan(0);
  await expect(f.organization().link(f.s, f.actor, owner, target.s.guildId, true)).rejects.toThrow("ORGANIZATION_REATTACH_REQUIRED");
  expect(await f.organization(f.actor, true).relinkGuild(f.s, f.actor, owner, { guildId: target.s.guildId, revision: 2 })).toMatchObject({ state: "ACTIVE", revision: 3, reauthorized: true });
  expect((await f.organization().detail(f.s, f.actor)).guilds).toHaveLength(2);
});
