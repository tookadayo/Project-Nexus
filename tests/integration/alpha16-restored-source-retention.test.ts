import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it} from "vitest";
import {connect,ensureGuild,migrate,sql,json,tenant,type Database} from "../../packages/db/src/index";
import {scopeForGuild} from "../../packages/security/src/scoping";
import {assertAlpha16RestoredSourceSchema,purgeAlpha16RestoredSourceSnapshots,assertAlpha16RestoredSourceRetention} from "../../packages/security/src/alpha16-restored-source-retention";
import {isolatedPostgres} from "../fixtures/postgres";
let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
beforeAll(async()=>{infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
async function fixture(){const scope=scopeForGuild(String(868800000000000000n+BigInt(++serial)));await ensureGuild(db,scope);return scope;}
async function context(scope:Awaited<ReturnType<typeof fixture>>,caseId:string){
  const id=randomUUID(),now=new Date(),expiresAt=new Date(now.getTime()+3600000);
  await sql`INSERT INTO rule_operational_contexts(organization_id,guild_id,id,version,case_id,target_type,target_id,live_version,window_start,window_end,observed_at,created_at,expires_at,content_hash)
    VALUES(${scope.organizationId}::uuid,${scope.guildId},${id}::uuid,1,${caseId},'SOURCE',${id},'1',${new Date(now.getTime()-60000)},${now},${now},${now},${expiresAt},${"a".repeat(64)})`.execute(db);
  return {id,now,expiresAt};
}
describe("isolated restore finite source coverage",()=>{
  it("checks current source schema including 081 erasure quality instead of trusting the migration marker alone",async()=>{
    await assertAlpha16RestoredSourceSchema(db);
    await db.transaction().execute(async tx=>{
      await sql`ALTER TABLE location_post_observations RENAME COLUMN reply_provenance_erased TO hidden_fixture_quality`.execute(tx);
      await expect(assertAlpha16RestoredSourceSchema(tx)).rejects.toThrow("RESTORE_SOURCE_SCHEMA_REQUIRED");
      await sql`ALTER TABLE location_post_observations RENAME COLUMN hidden_fixture_quality TO reply_provenance_erased`.execute(tx);
    });
  });
  it("removes 080 and 082 copied contexts at the earlier child source deadline without renewing another context",async()=>{
    const scope=await fixture(),native=await context(scope,"CASE14"),filter=await context(scope,"CASE15"),metric=await context(scope,"CASE10"),retained=await context(scope,"CASE18"),old=new Date(native.now.getTime()-60000),first=new Date(native.now.getTime()-3600000),future=new Date(native.now.getTime()+1800000),observationId=randomUUID();
    // Deliberately inconsistent restored copies are still schema-valid. Their
    // earlier source expiry, not the future header, must win during cleanup.
    await sql`INSERT INTO rule_operational_native_captures(organization_id,guild_id,context_id,case_id,config_hash,target_hash,source_hash,fields,first_captured_at,expires_at)
      VALUES(${scope.organizationId}::uuid,${scope.guildId},${native.id}::uuid,'CASE14',${"b".repeat(64)},${"c".repeat(64)},${"d".repeat(64)},${json([{expiresAt:old.toISOString()}])},${first},${future})`.execute(db);
    await sql`INSERT INTO rule_operational_filter_configs(organization_id,guild_id,context_id,version,rule_hash,configured_language,definition_hash,configured_at,first_captured_at,expires_at)
      VALUES(${scope.organizationId}::uuid,${scope.guildId},${filter.id}::uuid,1,${"e".repeat(64)},'ja',${"f".repeat(64)},${first},${first},${old})`.execute(db);
    await sql`INSERT INTO rule_case_metric_observations(organization_id,guild_id,id,context_id,config_hash,source_hash,captured_at,expires_at)
      VALUES(${scope.organizationId}::uuid,${scope.guildId},${observationId}::uuid,${metric.id}::uuid,${"b".repeat(64)},${"c".repeat(64)},${first},${future})`.execute(db);
    await sql`INSERT INTO rule_case_metric_values(organization_id,guild_id,observation_id,field_id,value_kind,integer_value,unit,source_expires_at,metadata)
      VALUES(${scope.organizationId}::uuid,${scope.guildId},${observationId}::uuid,'channel.messageCount','INTEGER',1,'count',${old},${json({window:{start:first.toISOString(),end:old.toISOString()}})})`.execute(db);
    const coverage=await db.transaction().execute(tx=>purgeAlpha16RestoredSourceSnapshots(tx));
    expect(coverage).toMatchObject({schemaVersion:82,tableInventoryVerified:true,originalExpiryPurged:true});
    expect((await sql<{id:string;expires_at:Date}>`SELECT id,expires_at FROM rule_operational_contexts WHERE ${tenant(scope)}`.execute(db)).rows).toEqual([{id:retained.id,expires_at:retained.expiresAt}]);
    for(const table of ["rule_operational_native_captures","rule_operational_filter_configs","rule_case_metric_observations","rule_case_metric_values"])
      expect((await sql`SELECT 1 FROM ${sql.table(table)} WHERE ${tenant(scope)}`.execute(db)).rows).toHaveLength(0);
    expect(Date.parse(coverage.nextExpiry!)).toBeLessThanOrEqual(retained.expiresAt.getTime());
    const nativeClocks=(await sql<{bot_reference_started_at:Date|null;bot_reference_observed_at:Date|null}>`SELECT bot_reference_started_at,bot_reference_observed_at FROM location_population_collection WHERE ${tenant(scope)}`.execute(db)).rows[0];
    if(nativeClocks)expect(nativeClocks).toEqual({bot_reference_started_at:null,bot_reference_observed_at:null});
  });
  it("does not certify final completion while an original source deadline still needs purge",async()=>{
    const scope=await fixture(),value=await context(scope,"CASE19"),past=new Date(value.now.getTime()-1000),first=new Date(value.now.getTime()-3600000);
    await sql`INSERT INTO rule_operational_native_captures(organization_id,guild_id,context_id,case_id,config_hash,target_hash,source_hash,fields,first_captured_at,expires_at)
      VALUES(${scope.organizationId}::uuid,${scope.guildId},${value.id}::uuid,'CASE19',${"b".repeat(64)},${"c".repeat(64)},${"d".repeat(64)},'[]'::jsonb,${first},${past})`.execute(db);
    await expect(db.transaction().execute(tx=>assertAlpha16RestoredSourceRetention(tx))).rejects.toThrow("RESTORE_SOURCE_EXPIRY_PURGE_REQUIRED");
    await db.transaction().execute(tx=>purgeAlpha16RestoredSourceSnapshots(tx));
    expect((await sql`SELECT id FROM rule_operational_contexts WHERE ${tenant(scope)}`.execute(db)).rows).toHaveLength(0);
  });
});
