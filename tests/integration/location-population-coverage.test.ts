import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { connect, ensureGuild, json, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { analysisMetrics } from "../../packages/analytics/src/analysis";
import { locationPopulationIntroduction } from "../../packages/analytics/src/evidence";
import { analysisDataIdentity } from "../../packages/analysis/src/identity";
import { analysisRecipeVersion, type AnalysisType } from "../../packages/analysis/src/domain";
import { openCollectionEpoch, projectObservation } from "../../packages/lifecycle/src/observation";
import { projectLocationPost } from "../../packages/lifecycle/src/adaptive-projector";
import { PrivacyService } from "../../packages/security/src/privacy";
import { analysisFixture, analysisVault } from "../fixtures/analysis";
import { infrastructure } from "../fixtures/infrastructure";
import type { Envelope } from "../../packages/events/src/index";
let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
beforeAll(async () => { infra = await infrastructure(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); });
type Fixture = Awaited<ReturnType<typeof analysisFixture>>;
async function result(f: Fixture, type: AnalysisType = "OVERALL") {
  return analysisMetrics(db, f.s, await f.settings.get(f.s), type, f.start, f.end, "population", 30);
}
const evidence = (r: Awaited<ReturnType<typeof result>>, key: string) => r.metrics.find(m => m.key === key)!.evidence;
const reason = "LEGACY_PARTICIPANT_ONLY_COVERAGE";

it("flags v3 participant-only fallback counts as lower bounds, keeping reply semantics separate", async () => {
  const f = await analysisFixture(db, "FREE", true, undefined, false), r = await result(f);
  expect((await sql<{versions:string[]}>`SELECT array_agg(DISTINCT definition_version) AS versions FROM message_observations WHERE ${tenant(f.s)}`.execute(db)).rows[0]!.versions).toEqual(["observation-v3"]);
  for (const [key, value] of [["observed_posts", 7], ["observed_replies", 5]] as const) {
    const e = evidence(r, key);
    expect(e.value).toBe(value); expect(e.coverageState).toBe("LOWER_BOUND"); expect(e.comparable).toBe(false); expect(e.coverageReasons).toContain(reason);
    expect(e.coverageReasons).not.toContain("LEGACY_REPLY_SEMANTICS_UNKNOWN");
  }
  expect(evidence(r, "first_reply_seconds")).toMatchObject({value:122, coverageState:"PARTIAL", comparable:false});
  expect(evidence(r, "waiting_response")).toMatchObject({value:2, coverageState:"PARTIAL", comparable:false});
  expect(evidence(r, "bot_webhook_posts")).toMatchObject({value:null, observationState:"UNKNOWN", coverageState:"UNKNOWN"});
  const cohort = await result(f, "NEW_MEMBERS");
  expect(evidence(cohort, "observed_posts")).toMatchObject({value:7, coverageState:"COMPLETE"});
  expect(evidence(cohort, "observed_posts").coverageReasons).not.toContain(reason);
});

it("does not turn unknown coverage or missing historical waiting occurrences into zero", async () => {
  const f = await analysisFixture(db, "FREE", true, undefined, false);
  await sql`UPDATE message_observations SET first_reply_seconds=120 WHERE ${tenant(f.s)}`.execute(db);
  expect(evidence(await result(f), "waiting_response")).toMatchObject({value:null, coverageState:"UNKNOWN"});
  await sql`UPDATE discord_integration_health SET gateway_state='UNKNOWN' WHERE ${tenant(f.s)}`.execute(db);
  expect(evidence(await result(f), "observed_posts")).toMatchObject({value:null, coverageState:"UNKNOWN"});
});

it("requires durable collector and complete epochs for row-free zero, including the exact boundary", async () => {
  const f = await analysisFixture(db, "FREE", false, undefined, false), historical = await result(f);
  expect(evidence(historical, "observed_posts")).toMatchObject({value:null, coverageState:"UNKNOWN"});
  expect(evidence(historical, "bot_webhook_posts").coverageReasons).toContain(reason);
  await sql`UPDATE location_population_collection SET introduced_at=${f.start} WHERE ${tenant(f.s)}`.execute(db);
  for (const key of ["observed_posts", "bot_webhook_posts", "observed_replies", "waiting_response"])
    expect(evidence(await result(f), key)).toMatchObject({value:0, coverageState:"COMPLETE", comparable:true});
  await sql`UPDATE location_population_collection SET introduced_at=${new Date(f.start.getTime()+1)} WHERE ${tenant(f.s)}`.execute(db);
  expect(evidence(await result(f), "observed_posts")).toMatchObject({value:null, coverageState:"UNKNOWN"});
  await sql`UPDATE location_population_collection SET introduced_at=${f.start} WHERE ${tenant(f.s)}`.execute(db);
  await sql`UPDATE collection_epochs SET ended_at=${new Date(f.end.getTime()-1000)} WHERE ${tenant(f.s)}`.execute(db);
  expect(evidence(await result(f), "observed_posts")).toMatchObject({value:null, coverageState:"UNKNOWN"});
});

it("keeps old v3 provenance incomplete beside new Bot/Webhook observations", async () => {
  const f = await analysisFixture(db), cfg = await f.settings.get(f.s);
  await sql`UPDATE location_post_observations SET population_source='LEGACY_PARTICIPANT_ONLY' WHERE ${tenant(f.s)}`.execute(db);
  await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,visibility_state,observed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${f.channel},0,'VISIBLE',${f.start})`.execute(db);
  for (const [i, authorKind] of ["BOT", "WEBHOOK"].entries()) {
    const e: Envelope = {...f.s, shardId:0, gatewaySessionId:"population", sequence:i+1, context:"PRODUCTION", kind:"channel.post_observed", at:new Date(f.end.getTime()-86400000).toISOString(), messageId:String(944444444444444440n+BigInt(i)), channelId:f.channel, messageType:0, authorKind:authorKind as "BOT"|"WEBHOOK"};
    await projectLocationPost(db, f.s, e, cfg, null);
  }
  const r = await result(f);
  expect(evidence(r, "observed_posts")).toMatchObject({value:9, coverageState:"LOWER_BOUND", comparable:false});
  expect(evidence(r, "bot_webhook_posts")).toMatchObject({value:2, coverageState:"LOWER_BOUND", comparable:false});
  expect((await sql<{n:number}>`SELECT count(*)::int AS n FROM location_post_observations WHERE ${tenant(f.s)} AND population_source='LOCATION_STREAM_V1'`.execute(db)).rows[0]!.n).toBe(2);
});

it("treats new-only positive records as lower bounds when the window crosses collector introduction", async () => {
  const f = await analysisFixture(db);
  await sql`UPDATE location_population_collection SET introduced_at=${new Date(f.start.getTime()+15*86400000)} WHERE ${tenant(f.s)}`.execute(db);
  const r = await result(f);
  expect(evidence(r,"observed_posts")).toMatchObject({value:7,coverageState:"LOWER_BOUND",comparable:false});
  expect(evidence(r,"observed_replies")).toMatchObject({value:5,coverageState:"LOWER_BOUND"});
  expect(evidence(r,"first_reply_seconds")).toMatchObject({value:122,coverageState:"PARTIAL"});
  expect(evidence(r,"observed_posts").coverageReasons).toContain(reason);
});

it("compares sub-millisecond collector introduction in SQL before accepting an epoch or complete zero", async () => {
  const f = await analysisFixture(db,"FREE",false);
  await sql`UPDATE location_population_collection SET introduced_at=${f.start}::timestamptz+interval '0.5 milliseconds' WHERE ${tenant(f.s)}`.execute(db);
  await sql`DELETE FROM collection_epochs WHERE ${tenant(f.s)}`.execute(db);
  const e: Envelope = {...f.s,shardId:0,gatewaySessionId:"precision",sequence:1,context:"PRODUCTION",kind:"telemetry.connected",at:f.start.toISOString()};
  await projectObservation(db,f.s,e);
  expect(await openCollectionEpoch(db,f.s,f.start,"ROUNDED_PRE_BOUNDARY")).toBeNull();
  expect((await sql`SELECT id FROM collection_epochs WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  const actualStart = new Date(f.start.getTime()+1);
  await projectObservation(db,f.s,{...e,sequence:2,at:actualStart.toISOString()});
  const partial = await result(f);
  expect(evidence(partial,"observed_posts")).toMatchObject({value:null,coverageState:"UNKNOWN"});
  expect(evidence(partial,"observed_posts").coverageReasons).toContain(reason);
  const complete = await analysisMetrics(db,f.s,await f.settings.get(f.s),"OVERALL",actualStart,f.end,"precision",30);
  expect(evidence(complete,"observed_posts")).toMatchObject({value:0,coverageState:"COMPLETE",comparable:true});
});

it.each(["ANNOUNCEMENTS", "SHOWCASE"] as const)("applies historical population limits to %s post and comment metrics", async type => {
  const f = await analysisFixture(db, "FREE", true, undefined, false), cfg = await f.settings.get(f.s);
  await f.settings.update(f.s,f.actor,cfg.revision,{communityModel:{...cfg.communityModel,channels:[{channelId:f.channel,purpose:type === "ANNOUNCEMENTS" ? "ANNOUNCEMENT" : "SHOWCASE"}]}});
  const r = await result(f,type);
  expect(evidence(r,type === "ANNOUNCEMENTS" ? "announcement_posts" : "showcase_posts")).toMatchObject({value:7,coverageState:"LOWER_BOUND",comparable:false});
  if (type === "SHOWCASE") expect(evidence(r,"observed_comments")).toMatchObject({value:null,coverageState:"UNKNOWN"});
});

it("includes row provenance and collector boundary in scoped data identity", async () => {
  const f = await analysisFixture(db), input = {type:"OVERALL" as const,days:30 as const}, window = {start:f.start,end:f.end};
  const before = await analysisDataIdentity(db,f.s,input,window,[f.channel]);
  await sql`UPDATE location_population_collection SET introduced_at=introduced_at+interval '1 second' WHERE ${tenant(f.s)}`.execute(db);
  const boundary = await analysisDataIdentity(db,f.s,input,window,[f.channel]); expect(boundary).not.toBe(before);
  await sql`UPDATE location_post_observations SET population_source='LEGACY_PARTICIPANT_ONLY' WHERE ${tenant(f.s)}`.execute(db);
  expect(await analysisDataIdentity(db,f.s,input,window,[f.channel])).not.toBe(boundary);
  expect(analysisRecipeVersion).toBe("analysis-observation-v3");
});

it("bootstraps future empty guilds once, retains boundary for member deletion and clears it for server deletion", async () => {
  const before = new Date(), f = await analysisFixture(db,"FREE",false,undefined,false), marker = await locationPopulationIntroduction(db,f.s);
  expect(marker).not.toBeNull(); expect(marker!.getTime()).toBeGreaterThanOrEqual(before.getTime());
  await ensureGuild(db,f.s); expect(await locationPopulationIntroduction(db,f.s)).toEqual(marker);
  const privacy = new PrivacyService(db,analysisVault,f.settings);
  await privacy.delete(f.s,f.user,f.actor); expect(await locationPopulationIntroduction(db,f.s)).toEqual(marker);
  await privacy.delete(f.s,f.user,f.actor,true); expect(await locationPopulationIntroduction(db,f.s)).toBeNull();
  await ensureGuild(db,f.s); expect(await locationPopulationIntroduction(db,f.s)).toBeNull();
  expect(await openCollectionEpoch(db,f.s,new Date(),"REPLAY_AFTER_DELETE")).toBeNull();
});

it("upgrades v3 rows conservatively, closes epochs and rejects replay without rewriting saved results", async () => {
  const databaseName = "population_upgrade_" + randomUUID().replaceAll("-", ""), url = new URL(infra.databaseUrl);
  await sql.raw(`CREATE DATABASE ${databaseName}`).execute(db); url.pathname = "/" + databaseName;
  const upgrade = connect(url.toString());
  try {
    await migrate(upgrade,{throughVersion:46});
    const f = await analysisFixture(upgrade,"FREE",true,undefined,false);
    await migrate(upgrade,{throughVersion:49});
    expect((await sql<{n:number}>`SELECT count(*)::int AS n FROM location_post_observations WHERE ${tenant(f.s)} AND definition_version='observation-v3'`.execute(upgrade)).rows[0]!.n).toBe(7);
    const id = randomUUID(), saved = {schemaVersion:1,metrics:[],dataQuality:"COMPLETE",fixture:"immutable before050"};
    await sql`INSERT INTO analysis_runs(id,organization_id,guild_id,scheduler_organization_id,analysis_type,status,request_key,period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until) VALUES(${id}::uuid,${f.s.organizationId}::uuid,${f.s.guildId},${f.s.organizationId}::uuid,'OVERALL','COMPLETED','pre050',${f.start},${f.end},30,'analysis-observation-v2:fixture','population',1,0,${"a".repeat(64)},'FREE','FREE',now()+interval '30 days')`.execute(upgrade);
    await sql`INSERT INTO analysis_results(run_id,organization_id,guild_id,result) VALUES(${id}::uuid,${f.s.organizationId}::uuid,${f.s.guildId},${json(saved)})`.execute(upgrade);
    const oldRun = (await sql<{row:unknown}>`SELECT to_jsonb(r) AS row FROM analysis_runs r WHERE id=${id}::uuid`.execute(upgrade)).rows[0]!.row;
    await migrate(upgrade); await migrate(upgrade);
    const marker = (await locationPopulationIntroduction(upgrade,f.s))!;
    expect((await sql<{n:number}>`SELECT count(*)::int AS n FROM location_post_observations WHERE ${tenant(f.s)} AND definition_version='observation-v3' AND population_source='LEGACY_PARTICIPANT_ONLY'`.execute(upgrade)).rows[0]!.n).toBe(7);
    expect((await sql<{ended_at:Date;end_reason:string}>`SELECT ended_at,end_reason FROM collection_epochs WHERE ${tenant(f.s)}`.execute(upgrade)).rows[0]).toEqual({ended_at:marker,end_reason:"LOCATION_POPULATION_COLLECTOR_UPGRADE"});
    expect((await sql<{row:unknown}>`SELECT to_jsonb(r) AS row FROM analysis_runs r WHERE id=${id}::uuid`.execute(upgrade)).rows[0]!.row).toEqual(oldRun);
    expect((await sql<{result:unknown}>`SELECT result FROM analysis_results WHERE run_id=${id}::uuid`.execute(upgrade)).rows[0]!.result).toEqual(saved);
    const base: Envelope = {...f.s,shardId:0,gatewaySessionId:"reclaimed",sequence:1,context:"PRODUCTION",kind:"telemetry.connected",at:new Date(marker.getTime()-1000).toISOString(),observedAt:new Date(marker.getTime()-1000).toISOString()};
    await projectObservation(upgrade,f.s,base);
    expect(await openCollectionEpoch(upgrade,f.s,new Date(base.at),"BACKDATED_REPLAY",true)).toBeNull();
    expect((await sql`SELECT id FROM collection_epochs WHERE ${tenant(f.s)} AND ended_at IS NULL`.execute(upgrade)).rows).toHaveLength(0);
    // Model Pg's sub-millisecond boundary explicitly and a restart shorter than
    // the 90s heartbeat gap detector. The rounded old epoch cannot fill this gap.
    await sql`UPDATE collection_epochs SET ended_at=${marker}::timestamptz+interval '0.5 milliseconds' WHERE ${tenant(f.s)}`.execute(upgrade);
    const connectedAt = new Date(marker.getTime()+1000), end = new Date(marker.getTime()+60000);
    await projectObservation(upgrade,f.s,{...base,sequence:2,at:connectedAt.toISOString(),observedAt:connectedAt.toISOString()});
    expect((await sql<{started_at:Date}>`SELECT started_at FROM collection_epochs WHERE ${tenant(f.s)} AND ended_at IS NULL`.execute(upgrade)).rows[0]!.started_at).toEqual(connectedAt);
    const gapResult = await analysisMetrics(upgrade,f.s,await f.settings.get(f.s),"OVERALL",marker,end,"restart",30);
    for (const key of ["observed_posts","bot_webhook_posts"]) {
      expect(evidence(gapResult,key)).toMatchObject({value:null,coverageState:"UNKNOWN",comparable:false});
      expect(evidence(gapResult,key).coverageReasons).toContain("COLLECTION_GAP");
    }
    await projectObservation(upgrade,f.s,{...base,sequence:3,kind:"telemetry.disconnected"});
    expect((await sql`SELECT id FROM collection_epochs WHERE ${tenant(f.s)} AND ended_at IS NULL`.execute(upgrade)).rows).toHaveLength(1);
  } finally { await upgrade.destroy(); await sql.raw(`DROP DATABASE ${databaseName}`).execute(db); }
});
