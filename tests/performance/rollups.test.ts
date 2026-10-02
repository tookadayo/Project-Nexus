import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import {
  activityRollups,
  type ActivityFact,
} from "../../packages/lifecycle/src/rollups";
let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
it("reads aggregate activity from daily contributions faster than the same high-traffic raw window", async () => {
  const s = { organizationId: randomUUID(), guildId: "901000000000009999" };
  await ensureGuild(db, s);
  await sql`INSERT INTO member_identity_map(organization_id,guild_id,id,lookup_hash,encrypted_id) SELECT ${s.organizationId}::uuid,${s.guildId},gen_random_uuid(),md5(n::text),'synthetic' FROM generate_series(1,500) n`.execute(
    db,
  );
  await sql`ALTER TABLE membership_episodes DISABLE TRIGGER ALL`.execute(db);
  try {
    await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context,screening_observed_at,guest_observed_at) SELECT ${s.organizationId}::uuid,${s.guildId},gen_random_uuid(),id,'2026-09-01T00:00:00Z','PRODUCTION','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z' FROM member_identity_map WHERE ${tenant(s)}`.execute(
      db,
    );
  } finally {
    await sql`ALTER TABLE membership_episodes ENABLE TRIGGER ALL`.execute(db);
  }
  await sql`ALTER TABLE lifecycle_events DISABLE TRIGGER ALL`.execute(db);
  try {
    await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data,definition_version) SELECT e.organization_id,e.guild_id,gen_random_uuid(),e.id,'message.sent','2026-09-02T12:00:00Z'::timestamptz+d*interval '1 day'+m*interval '1 minute','PRODUCTION',jsonb_build_object('channelId','333333333333333333','messageId',(999000000000000000::bigint+row_number() OVER())::text),'observation-v3' FROM membership_episodes e CROSS JOIN generate_series(0,19) d CROSS JOIN generate_series(1,20) m WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId}`.execute(
      db,
    );
  } finally {
    await sql`ALTER TABLE lifecycle_events ENABLE TRIGGER ALL`.execute(db);
  }
  const rebuildStarted = performance.now();
  await sql`SELECT nexus_rebuild_guild_rollups(${s.organizationId}::uuid,${s.guildId})`.execute(
    db,
  );
  const rebuildMs = performance.now() - rebuildStarted;
  await sql`SELECT nexus_rebuild_message_observations(${s.organizationId}::uuid,${s.guildId})`.execute(
    db,
  );
  const from = new Date("2026-09-01T06:00:00Z"),
    to = new Date("2026-10-01T06:00:00Z");
  const raw = () =>
    sql<ActivityFact>`SELECT episode_id,kind,occurred_at,data,0::integer AS reaction_count FROM lifecycle_events WHERE ${tenant(s)} AND context='PRODUCTION' AND occurred_at>=${from} AND occurred_at<=${to} ORDER BY occurred_at`
      .execute(db)
      .then((r) => r.rows);
  const compact = () => activityRollups(db, s, from, to);
  const signature = (rows: ActivityFact[]) => {
    const out = new Map<string, Set<string>>();
    for (const row of rows) {
      const key = row.episode_id,
        days = out.get(key) ?? new Set<string>();
      days.add(
        row.kind +
          ":" +
          row.occurred_at.toISOString().slice(0, 10) +
          ":" +
          String(row.data.channelId),
      );
      out.set(key, days);
    }
    return [...out]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, days]) => [id, [...days].sort()]);
  };
  let rawRows: ActivityFact[] = [],
    compactRows: ActivityFact[] = [];
  const rawTimes: number[] = [],
    compactTimes: number[] = [];
  for (let i = 0; i < 3; i++) {
    let start = performance.now();
    rawRows = await raw();
    rawTimes.push(performance.now() - start);
    start = performance.now();
    compactRows = await compact();
    compactTimes.push(performance.now() - start);
  }
  const median = (ns: number[]) => ns.sort((a, b) => a - b)[1]!;
  expect(rawRows).toHaveLength(200000);
  expect(compactRows).toHaveLength(20000);
  expect(signature(compactRows)).toEqual(signature(rawRows));
  expect(median(compactTimes)).toBeLessThan(median(rawTimes));
  process.stdout.write(
    `Daily rollups: raw=${Math.round(median(rawTimes))} ms / compact=${Math.round(median(compactTimes))} ms / rebuild=${Math.round(rebuildMs)} ms / rows=200000→20000\n`,
  );
});
