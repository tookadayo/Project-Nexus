import { afterAll, beforeAll, expect, it } from "vitest";
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
import { InterventionReview } from "../../packages/operations/src/intervention-review";
import {
  chartQuerySchema,
  type ChartSpec,
} from "../../packages/analytics/src/chart-spec";
import { metricEvidence } from "../../packages/shared/src/metric-evidence";
import type { Actor } from "../../packages/settings/src/index";
let infra: Awaited<ReturnType<typeof isolatedPostgres>>,
  db: Database,
  guild = 987600000000000000n;
const actor: Actor = {
  key: "synthetic-reviewer",
  permissions: "8",
  roles: [],
  source: "WEB_DASHBOARD",
  requestId: "history-access",
};
const now = new Date(),
  end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ),
  from = new Date(+end - 7 * 86400000);
function snapshot(): ChartSpec {
  const evidence = metricEvidence({
    metricKey: "reply.received",
    definitionVersion: "1",
    definition: "Synthetic direct replies",
    value: 10,
    numerator: 10,
    denominator: 10,
    sampleSize: 10,
    coverageState: "COMPLETE",
    requiredSurfaces: [],
    evidenceSources: [],
    coverageReasons: [],
    windowStart: from.toISOString(),
    windowEnd: end.toISOString(),
    collectionEpochIds: ["synthetic"],
  });
  return {
    version: 1,
    metric: "reply",
    title: "Direct replies",
    unit: "observations",
    range: {
      from: from.toISOString(),
      to: end.toISOString(),
      days: 7,
      timezone: "UTC",
    },
    filter: chartQuerySchema.parse({}).filter,
    series: [
      {
        key: "CURRENT",
        points: [{ bucket: from.toISOString(), value: 10, evidence }],
      },
    ],
    evidence,
    top: [{ channelId: "advanced-channel", value: 10 }],
    breakdowns: [{ channelId: "advanced-channel", points: [], evidence }],
    heatmap: [{ weekday: 0, hour: 0, value: 10 }],
    recipeRevision: null,
    dataRevision: "internal-revision",
    cacheKey: "internal-cache",
    caveats: [],
  };
}
async function fixture(filtered = false) {
  const s = scopeForGuild(String(guild++));
  await ensureGuild(db, s);
  await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key,status) VALUES(${s.organizationId}::uuid,${s.guildId},'GROWTH','active')`.execute(
    db,
  );
  const query = chartQuerySchema.parse(
      filtered ? { filter: { channelIds: ["111111111111111111"] } } : {},
    ),
    baseline = { ...snapshot(), filter: query.filter };
  await sql`INSERT INTO operations_interventions(id,organization_id,guild_id,title,metric_query,started_at,review_at,baseline,actor_hash) VALUES(${randomUUID()}::uuid,${s.organizationId}::uuid,${s.guildId},'synthetic private title',${JSON.stringify(query)}::jsonb,${now},${new Date(+now + 86400000)},${JSON.stringify(baseline)}::jsonb,${actor.key})`.execute(
    db,
  );
  return s;
}
beforeAll(async () => {
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
it("reprojects unfiltered saved snapshots using current capabilities after downgrade", async () => {
  const s = await fixture(),
    reviews = new InterventionReview(db);
  expect(await reviews.list(s, actor)).toHaveLength(1);
  await sql`UPDATE guild_subscriptions SET plan_key='FREE' WHERE ${tenant(s)}`.execute(
    db,
  );
  const rows = await reviews.list(s, actor);
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain("advanced-channel");
  expect(JSON.stringify(rows)).not.toContain("internal-cache");
});
it("does not reveal a filtered record or its title after its filter entitlement is lost", async () => {
  const s = await fixture(true),
    reviews = new InterventionReview(db);
  expect(await reviews.list(s, actor)).toHaveLength(1);
  await sql`UPDATE guild_subscriptions SET plan_key='FREE' WHERE ${tenant(s)}`.execute(
    db,
  );
  expect(await reviews.list(s, actor)).toEqual([]);
});
it("retains filtered history covered by another current grant after one grant expires", async () => {
  const s = await fixture(true),
    reviews = new InterventionReview(db);
  await sql`UPDATE guild_subscriptions SET plan_key='FREE' WHERE ${tenant(s)}`.execute(
    db,
  );
  for (const end of [new Date(+now - 1000), new Date(+now + 3600000)])
    await sql`INSERT INTO entitlement_grants(id,organization_id,guild_id,source,features,limits,starts_at,ends_at,created_by,reason) VALUES(${randomUUID()}::uuid,${s.organizationId}::uuid,${s.guildId},'PARTNER','["surface_breakdowns"]'::jsonb,'{}'::jsonb,${new Date(+now - 86400000)},${end},'synthetic','test')`.execute(
      db,
    );
  expect(await reviews.list(s, actor)).toHaveLength(1);
  await sql`UPDATE entitlement_grants SET revoked_at=now() WHERE ${tenant(s)}`.execute(
    db,
  );
  expect(await reviews.list(s, actor)).toEqual([]);
});
it("enforces current actor, tenant and guild deletion before returning saved content", async () => {
  const s = await fixture(),
    reviews = new InterventionReview(db);
  await expect(reviews.list(s, { ...actor, permissions: "0" })).rejects.toThrow(
    "ADMIN_REQUIRED",
  );
  const other = scopeForGuild(String(guild++));
  await ensureGuild(db, other);
  expect(await reviews.list(other, actor)).toEqual([]);
  await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,lookup_hash,completed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,NULL,now())`.execute(
    db,
  );
  await expect(reviews.list(s, actor)).rejects.toThrow("PRIVACY_DELETED");
});
it("does not redisplay a pre-deletion aggregate without participant provenance", async () => {
  const s = await fixture(),
    reviews = new InterventionReview(db);
  await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,lookup_hash,completed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,'synthetic-deleted-member',${new Date(+now + 1)})`.execute(
    db,
  );
  expect(await reviews.list(s, actor)).toEqual([]);
});
it("honors the exact current history boundary and rejects opaque legacy snapshots", async () => {
  const s = await fixture(),
    reviews = new InterventionReview(db);
  await sql`UPDATE guild_subscriptions SET plan_key='FREE' WHERE ${tenant(s)}`.execute(
    db,
  );
  const edge = new Date(+from + 30 * 86400000);
  expect(await reviews.list(s, actor, new Date(+edge - 1))).toHaveLength(1);
  expect(await reviews.list(s, actor, edge)).toHaveLength(1);
  expect(await reviews.list(s, actor, new Date(+edge + 1))).toHaveLength(1);
  expect(
    await reviews.list(s, actor, new Date(+edge + 86400000 - 1)),
  ).toHaveLength(1);
  expect(await reviews.list(s, actor, new Date(+edge + 86400000))).toEqual([]);
  await sql`UPDATE operations_interventions SET baseline='{}'::jsonb WHERE ${tenant(s)}`.execute(
    db,
  );
  expect(await reviews.list(s, actor)).toEqual([]);
});
