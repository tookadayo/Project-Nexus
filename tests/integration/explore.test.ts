import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  json,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { scopeForGuild } from "../../packages/security/src/index";
import { ExploreService } from "../../packages/analytics/src/explore";
import { chartCsv } from "../../packages/analytics/src/chart-spec";
import { buildCapabilitySnapshot } from "../../packages/discord/src/discovery";
import { representativeSource } from "../fixtures/community-profiles";
import { SettingsService, type Actor } from "../../packages/settings/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { PrivacyService } from "../../packages/security/src/privacy";
import { recipeDefinition } from "../../packages/shared/src/measurement-recipes";
let infra: Awaited<ReturnType<typeof infrastructure>>,
  db: Database,
  guild = 931000000000000000n;
const now = new Date("2026-10-06T12:00:00Z"),
  end = new Date("2026-10-06T00:00:00Z"),
  channel = "933333333333333330",
  second = "933333333333333331",
  role = "944444444444444444",
  actor: Actor = {
    key: "explore-admin",
    permissions: "8",
    roles: [],
    source: "WEB_DASHBOARD",
    requestId: "explore-test",
  };
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
async function fixture(plan = "STARTER") {
  const s = scopeForGuild(String(guild++));
  await ensureGuild(db, s);
  const identity = randomUUID(),
    episode = randomUUID();
  const cfg = await new SettingsService(db).get(s),
    recipe = recipeDefinition(
      cfg.communityModel,
      cfg.analysisScope,
      cfg.memberStages,
    ),
    recipeId = randomUUID();
  await sql`INSERT INTO measurement_recipe_versions(organization_id,guild_id,id,revision,definition_version,preset,definition,created_at) VALUES(${s.organizationId}::uuid,${s.guildId},${recipeId}::uuid,1,${recipe.definitionVersion},${recipe.preset},${json(recipe)},'2026-01-01')`.execute(
    db,
  );
  await sql`INSERT INTO measurement_recipe_heads VALUES(${s.organizationId}::uuid,${s.guildId},${recipeId}::uuid)`.execute(
    db,
  );
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status) VALUES(${s.organizationId}::uuid,${s.guildId},${plan},'active') ON CONFLICT(organization_id,guild_id) DO UPDATE SET plan_key=EXCLUDED.plan_key,status='active'`.execute(
    db,
  );
  await sql`INSERT INTO member_identity_map(organization_id,guild_id,id,lookup_hash,encrypted_id) VALUES(${s.organizationId}::uuid,${s.guildId},${identity}::uuid,'fixture-member','fixture-sealed')`.execute(
    db,
  );
  await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context,screening_observed_at,guest_observed_at,screening_pending,is_guest) VALUES(${s.organizationId}::uuid,${s.guildId},${episode}::uuid,${identity}::uuid,'2026-01-01','PRODUCTION','2026-01-01','2026-01-01',false,false)`.execute(
    db,
  );
  await sql`INSERT INTO member_observable_state(organization_id,guild_id,episode_id,roles,roles_observed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${episode}::uuid,${[role]}::text[],${end})`.execute(
    db,
  );
  const source = representativeSource(0);
  source.channels.push({ ...source.channels[0]!, id: second });
  const snapshot = buildCapabilitySnapshot(source, end, null, {});
  await sql`INSERT INTO guild_capability_snapshots VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${json(snapshot)},${end})`.execute(
    db,
  );
  for (const id of [channel, second])
    await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,observed_at,visibility_state) VALUES(${s.organizationId}::uuid,${s.guildId},${id},0,${end},'VISIBLE')`.execute(
      db,
    );
  await sql`INSERT INTO discord_integration_health(organization_id,guild_id,gateway_state,last_gateway_at,last_refresh_at,intents,updated_at) VALUES(${s.organizationId}::uuid,${s.guildId},'CONNECTED',${end},${end},${json({ members: "AVAILABLE", messages: "AVAILABLE", reactions: "AVAILABLE", polls: "AVAILABLE", voice: "AVAILABLE", scheduledEvents: "AVAILABLE" })},${end})`.execute(
    db,
  );
  await sql`INSERT INTO collection_epochs(organization_id,guild_id,id,source,started_at,start_reason) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,'GATEWAY','2026-01-01','GATEWAY_CONNECTED')`.execute(
    db,
  );
  for (let i = 0; i < 6; i++)
    await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episode}::uuid,'reply.received',${new Date(i < 4 ? "2026-10-05T13:00:00Z" : "2026-09-25T13:00:00Z")},'PRODUCTION',${json({ channelId: i % 2 ? second : channel })})`.execute(
      db,
    );
  return s;
}
it("shares lossless daily counts, filters, cohorts, heatmap and CSV without raw/rollup duplication", async () => {
  const s = await fixture(),
    explore = new ExploreService(db),
    chart = await explore.chart(
      s,
      { metric: "reply", days: 7, compare: true },
      now,
    );
  expect(chart.evidence.value).toBe(4);
  expect(chart.series[0]!.points.reduce((n, p) => n + (p.value ?? 0), 0)).toBe(
    4,
  );
  expect(chart.comparison).toMatchObject({
    value: 2,
    absoluteChange: 2,
    relativeChange: 1,
    comparable: true,
  });
  expect(chart.evidence.coverageState).toBe("COMPLETE");
  expect(
    chart.heatmap.find((c) => c.weekday === 1 && c.hour === 13)?.value,
  ).toBe(4);
  expect(chart.top).toHaveLength(2);
  expect(chart.breakdowns?.map((d) => d.evidence.value)).toEqual([2, 2]);
  expect(chartCsv(chart)).toContain('"4","COMPLETE","OBSERVED"');
  const filtered = await explore.chart(
    s,
    {
      metric: "reply",
      filter: { channelIds: [channel, second], roleIds: [role] },
    },
    now,
  );
  expect(filtered.evidence.value).toBe(4);
  const none = await explore.chart(
    s,
    { metric: "reply", filter: { roleIds: ["944444444444444445"] } },
    now,
  );
  expect(none.evidence.value).toBe(0);
  await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) SELECT organization_id,guild_id,${randomUUID()}::uuid,id,'reply.received','2026-10-05T14:00:00Z','PRODUCTION',${json({ channelId: channel })} FROM membership_episodes WHERE ${tenant(s)}`.execute(
    db,
  );
  expect(
    (await explore.chart(s, { metric: "reply", days: 7, compare: true }, now))
      .cacheKey,
  ).not.toBe(chart.cacheKey);
});
it("keeps missing history unknown, retained hourly detail partial and Free unfiltered 7/30 charts", async () => {
  const s = await fixture("FREE"),
    explore = new ExploreService(db);
  expect((await explore.chart(s, { days: 30 }, now)).evidence.value).toBe(6);
  await expect(explore.chart(s, { days: 90 }, now)).rejects.toThrow(
    "HISTORY_PLAN_LIMIT",
  );
  await expect(explore.chart(s, { compare: true }, now)).rejects.toThrow(
    "PLAN_REQUIRED",
  );
  await sql`DELETE FROM discord_integration_health WHERE ${tenant(s)}`.execute(
    db,
  );
  const unknown = await explore.chart(s, { days: 7 }, now);
  expect(unknown.evidence.value).toBeNull();
  expect(unknown.series[0]!.points.every((p) => p.value === null)).toBe(true);
  const paid = await fixture(),
    historical = await explore.chart(paid, { days: 90 }, now);
  expect(historical.heatmap.some((c) => c.value === null)).toBe(true);
  expect(historical.caveats.join()).toContain("partial");
});
it("scopes saved views/segments, rejects stale concurrent edits and privacy deletion wins", async () => {
  const s = await fixture(),
    other = await fixture(),
    explore = new ExploreService(db),
    view = await explore.save(s, actor, {
      name: "Support",
      metric: "reply",
      shortcut: "support-health",
    });
  expect((await explore.saved(s, "support-health", now)).evidence.value).toBe(
    4,
  );
  expect(await explore.list(other)).toEqual([]);
  const updates = await Promise.allSettled([
    explore.save(s, actor, { ...view, name: "Changed" }),
    explore.save(s, actor, { ...view, name: "Changed again" }),
  ]);
  expect(updates.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const segment = await explore.saveSegment(s, actor, {
    name: "Support cohort",
    filters: { roleIds: [role] },
  });
  expect((await explore.segments(s))[0]?.id).toBe(segment.id);
  await expect(
    explore.save(s, { ...actor, permissions: "0" }, { name: "Unauthorized" }),
  ).rejects.toThrow("ADMIN_REQUIRED");
  const vault = new IdentityVault("aa".repeat(32), "bb".repeat(32));
  await new PrivacyService(db, vault, new SettingsService(db)).delete(
    s,
    "222222222222222222",
    { ...actor, key: vault.hash(s, "222222222222222222") },
    true,
  );
  await expect(explore.chart(s, {}, now)).rejects.toThrow("PRIVACY_DELETED");
  expect(
    (
      await sql`SELECT id FROM saved_metric_views WHERE ${tenant(s)}`.execute(
        db,
      )
    ).rows,
  ).toEqual([]);
});
it("old reply definitions and unobserved role/surface mappings preserve UNKNOWN", async () => {
  const legacy = await fixture(),
    explore = new ExploreService(db);
  await sql`UPDATE lifecycle_events SET definition_version='observation-v2' WHERE ${tenant(legacy)}`.execute(
    db,
  );
  const old = await explore.chart(legacy, { metric: "reply" }, now);
  expect(old.evidence.value).toBeNull();
  expect(old.evidence.coverageReasons).toContain(
    "LEGACY_REPLY_SEMANTICS_UNKNOWN",
  );
  expect(chartCsv(old)).not.toContain('"2","COMPLETE"');
  const cohort = await fixture();
  await sql`UPDATE member_observable_state SET roles_observed_at=NULL WHERE ${tenant(cohort)}`.execute(
    db,
  );
  const unknown = await explore.chart(
    cohort,
    { metric: "reply", filter: { roleIds: [role] } },
    now,
  );
  expect(unknown.evidence.value).toBeNull();
  expect(unknown.evidence.coverageReasons).toContain("ROLE_COHORT_UNOBSERVED");
  const surface = await fixture();
  await sql`DELETE FROM discord_surface_state WHERE ${tenant(surface)}`.execute(
    db,
  );
  const missing = await explore.chart(
    surface,
    { metric: "reply", filter: { surface: "TEXT" } },
    now,
  );
  expect(missing.evidence.value).toBeNull();
  expect(missing.evidence.coverageReasons).toContain(
    "HISTORICAL_SURFACE_UNOBSERVED",
  );
});
