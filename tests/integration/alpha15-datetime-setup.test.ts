import {afterAll, beforeAll, expect, it, vi} from "vitest";
import {randomUUID} from "node:crypto";
import {connect, ensureGuild, json, migrate, sql, tenant, type Database} from "../../packages/db/src/index";
import {WebSetupService} from "../../packages/operations/src/web-setup";
import {SettingsService, type Actor} from "../../packages/settings/src/index";
import {scopeForGuild} from "../../packages/security/src/scoping";
import {FakeDiscord} from "../fixtures/discord";
import {infrastructure} from "../fixtures/infrastructure";

let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database, sequence = 0;
beforeAll(async () => { vi.stubEnv("NEXUS_HOSTED_BETA", "off"); infra = await infrastructure(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); vi.unstubAllEnvs(); });
async function fixture() {
  const s = scopeForGuild(String(933333333333333330n + BigInt(++sequence)));
  await ensureGuild(db, s);
  const actor: Actor = {key: "datetime-setup", permissions: "8", roles: [], source: "WEB_DASHBOARD", requestId: randomUUID()};
  return {s, actor, service: new WebSetupService(db, new FakeDiscord()), settings: new SettingsService(db)};
}

it("DT10 distinguishes a new schema default from a raw saved guild region without writing settings", async () => {
  const f = await fixture();
  const initial = await f.service.status(f.s, f.actor, "Synthetic");
  expect(initial.timeZoneSource).toBe("missing"); expect(initial.settings.timezone).toBe("UTC"); expect(initial.settingsRevision).toBe(0);
  expect((await sql`SELECT 1 FROM guild_settings WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  await f.settings.mutate(f.s, f.actor, 0, async current => ({...current, timezone: "America/New_York"}));
  const saved = await f.service.status(f.s, f.actor, "Synthetic");
  expect(saved.timeZoneSource).toBe("saved"); expect(saved.settings.timezone).toBe("America/New_York");
});

it("DT10 identifies the legacy fallback while preserving SettingsService compatibility semantics", async () => {
  const f = await fixture();
  await sql`INSERT INTO guild_settings(organization_id,guild_id,revision,settings) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},3,${json({uiLanguage: "ja"})})`.execute(db);
  const status = await f.service.status(f.s, f.actor, "Synthetic");
  expect(status.timeZoneSource).toBe("legacy"); expect(status.settings.timezone).toBe("Asia/Tokyo"); expect(status.settingsRevision).toBe(3);
  await expect(f.service.save(f.s, f.actor, {requestId: randomUUID(), patch: {uiLanguage: "en"}})).rejects.toMatchObject({code: "TIMEZONE_CONFIRMATION_REQUIRED"});
  expect((await f.settings.get(f.s)).timezone).toBe("Asia/Tokyo");
  expect((await sql<{settings: Record<string, unknown>}>`SELECT settings FROM guild_settings WHERE ${tenant(f.s)}`.execute(db)).rows[0]!.settings).not.toHaveProperty("timezone");
});

it("DT10 rejects implicit UTC, then persists explicit unchanged UTC only through reviewed apply", async () => {
  const f = await fixture();
  await expect(f.service.save(f.s, f.actor, {requestId: randomUUID(), patch: {}})).rejects.toMatchObject({code: "TIMEZONE_CONFIRMATION_REQUIRED"});
  expect((await sql`SELECT 1 FROM web_setup_drafts WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  const draft = await f.service.save(f.s, f.actor, {requestId: randomUUID(), patch: {timezone: "UTC"}}) as {id: string; version: number; settingsRevision: number};
  const staged = await f.service.status(f.s, f.actor, "Synthetic");
  expect(staged.timeZoneSource).toBe("missing"); expect(staged.draft?.settings.timezone).toBe("UTC");
  await sql`INSERT INTO server_web_links(organization_id,guild_id,verified_at,verified_by_hash,verified_by_identity_ciphertext,updated_at,revision) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},clock_timestamp(),${f.actor.key},${"synthetic"},clock_timestamp(),${randomUUID()}::uuid)`.execute(db);
  const request = {requestId: randomUUID(), draftId: draft.id, expectedDraftRevision: draft.version, expectedSettingsRevision: draft.settingsRevision};
  const applied = await f.service.apply(f.s, f.actor, request);
  expect(await f.service.apply(f.s, f.actor, request)).toEqual(applied);
  const result = await f.service.status(f.s, f.actor, "Synthetic");
  expect(result.timeZoneSource).toBe("saved"); expect(result.settings.timezone).toBe("UTC"); expect(result.settingsRevision).toBe(1);
});

it("DT10 preserves a saved draft choice across reload and later edits without consulting a device", async () => {
  const f = await fixture();
  const draft = await f.service.save(f.s, f.actor, {requestId: randomUUID(), patch: {timezone: "Europe/Paris"}}) as {id: string; version: number};
  const next = await f.service.save(f.s, f.actor, {requestId: randomUUID(), draftId: draft.id, expectedDraftRevision: draft.version, patch: {uiLanguage: "en"}}) as {settings: {timezone: string}};
  expect(next.settings.timezone).toBe("Europe/Paris");
  const loaded = await new WebSetupService(db, new FakeDiscord()).status(f.s, f.actor, "Synthetic");
  expect(loaded.draft?.settings.timezone).toBe("Europe/Paris"); expect(loaded.timeZoneSource).toBe("missing");
  expect((await f.settings.get(f.s)).revision).toBe(0);
});
