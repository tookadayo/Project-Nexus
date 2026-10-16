import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {connect,ensureGuild,migrate,sql,tenant,json,type Database} from "../../packages/db/src/index";
import {scopeForGuild} from "../../packages/security/src/scoping";
import type {Actor} from "../../packages/settings/src/index";
import {acquireRuleScopeLocks,ruleScopeLockSet} from "../../packages/rules/src/locks";
import {createOperationalNativeContextPlugin} from "../../packages/rules/src/operational-context-native";
import type {OperationalSourceRequest} from "../../packages/rules/src/operational-context-sources";
import {isolatedPostgres} from "../fixtures/postgres";
let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
beforeAll(async()=>{vi.stubEnv("NEXUS_HOSTED_BETA","off");infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{vi.unstubAllEnvs();await db?.destroy();await infra?.stop();});
async function fixture(caseId="CASE13"){
 const scope=scopeForGuild(String(877800000000000000n+BigInt(++serial)));await ensureGuild(db,scope);
 const id=randomUUID(),actor:Actor={key:"synthetic-native-context-admin",roles:[],permissions:"8",source:"WEB_DASHBOARD",requestId:randomUUID()},now=new Date(),expiry=new Date(now.getTime()+48*3600000),proof={scope,actorHash:actor.key,expiresAt:new Date(now.getTime()+3600000)};
 const targetType=caseId==="CASE15"?"FILTER":caseId==="CASE16"?"GUILD":"MODERATION_QUEUE",targetId=caseId==="CASE16"?scope.guildId:id;
 await sql`INSERT INTO rule_operational_contexts(organization_id,guild_id,id,version,case_id,target_type,target_id,live_version,window_start,window_end,observed_at,created_at,expires_at,content_hash) VALUES(${scope.organizationId}::uuid,${scope.guildId},${id}::uuid,1,${caseId},${targetType},${targetId},'1',${new Date(now.getTime()-1)},${now},${now},${now},${expiry},${"a".repeat(64)})`.execute(db);
 const request:OperationalSourceRequest={contextId:id,caseId,target:{targetType,targetId,liveVersion:"1"},window:{start:new Date(now.getTime()-1).toISOString(),end:now.toISOString()},evaluationAsOf:now.toISOString(),proof,config:{kind:"QUEUE_REVIEW",population:"CURRENT_RETAINED_NATIVE_ATTENTION_V1",itemTypes:["OPERATIONS_REQUEST"],reviews:[]},phase:"CAPTURE",beforeWrite:async()=>{}};
 return {scope,actor,id,request,plugin:createOperationalNativeContextPlugin()};
}
async function read(f:Awaited<ReturnType<typeof fixture>>,changes:Partial<OperationalSourceRequest>={}){return db.transaction().execute(async tx=>{await acquireRuleScopeLocks(tx,ruleScopeLockSet(f.scope));return f.plugin.read(tx,f.scope,f.actor,{...f.request,...changes});});}
describe("finite native operational source persistence (prepared, never executed)",()=>{
 it("does not save any source row during VALIDATE and uses one original expiry during recapture",async()=>{
  const f=await fixture();expect(await read(f,{phase:"VALIDATE"})).toHaveLength(2);
  expect((await sql`SELECT context_id FROM rule_operational_native_captures WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  const first=await read(f),again=await read(f,{evaluationAsOf:new Date().toISOString()});expect(again).toEqual(first);
  expect((await sql`SELECT context_id FROM rule_operational_native_captures WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(1);
 });
 it("rejects another guild's review records and changed source versions without counting an incomplete set",async()=>{
  const f=await fixture(),other=await fixture(),now=new Date();await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,opened_at,version) VALUES(${other.scope.organizationId}::uuid,${other.scope.guildId},'','native-other',${now},'OPEN','OPERATIONS_REQUEST',${now},1)`.execute(db);
  await expect(read(f,{config:{kind:"QUEUE_REVIEW",population:"CURRENT_RETAINED_NATIVE_ATTENTION_V1",itemTypes:["OPERATIONS_REQUEST"],reviews:[{attentionKey:"native-other",expectedVersion:1,classification:"ACTIONABLE",assignment:null}]}})).rejects.toThrow("CASE_NATIVE_QUEUE_REVIEW_INCOMPLETE");
 });
 it("leaves raw platform incident timestamps unknown and never turns absent observations into NONE",async()=>{
  const f=await fixture("CASE16");expect(await read(f,{config:{kind:"PLATFORM_ALERT"}})).toEqual([]);
 });
 it("derives FP and triggered-rule counts from the same existing AutoMod execution set, keeping config provenance explicit",async()=>{
  const f=await fixture("CASE15"),at=new Date(f.request.evaluationAsOf),start=new Date(at.getTime()-3600000),end=new Date(at.getTime()-1000),first=randomUUID(),second=randomUUID(),ruleHash="b".repeat(64),channelId="877811111111111111";
  await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,parent_id,channel_type,observed_at,visibility_state,visibility_observed_at) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${channelId},NULL,0,${at},'VISIBLE',${at})`.execute(db);
  for(const [index,id]of[first,second].entries())await sql`INSERT INTO adaptive_facts(organization_id,guild_id,id,kind,occurred_at,data) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${id}::uuid,'auto_moderation.executed',${new Date(start.getTime()+1000)},${json({ruleHash:index?"c".repeat(64):ruleHash,actionType:1,channelId})})`.execute(db);
  const config={kind:"FILTER_REVIEW",window:{start:start.toISOString(),end:end.toISOString()},filter:{ruleHash,expectedVersion:0,configuredLanguage:"ja"},reviewSetId:randomUUID(),reviewUnit:"NATIVE_AUTOMOD_EXECUTION_EVENT",reviews:[{factId:first,falsePositive:true},{factId:second,falsePositive:false}]};
  const fields=await read(f,{config}),value=(id:string)=>fields.find(field=>field.fieldId===id);
  expect(value("staffFpCount")?.value).toBe(1);expect(value("totalReviewed")?.value).toBe(2);expect(value("triggeredRuleCount")?.value).toBe(2);
  expect(value("ruleVersion")).toMatchObject({value:1,sourceKind:"OPERATOR"});expect(value("configuredLanguage")).toMatchObject({value:"ja",sourceKind:"OPERATOR"});
  expect(await read(f,{config,phase:"VALIDATE",evaluationAsOf:new Date().toISOString()})).toEqual(fields);
  await sql`DELETE FROM adaptive_facts WHERE ${tenant(f.scope)} AND id=${second}::uuid`.execute(db);
  await expect(read(f,{config,phase:"VALIDATE",evaluationAsOf:new Date().toISOString()})).rejects.toThrow("CASE_NATIVE_FILTER_REVIEW_SOURCE_GONE");
 });
 it("rejects expiry extension in SQL and cascades source payload when the authoring context is deleted",async()=>{
  const f=await fixture();await read(f);
  await expect(sql`UPDATE rule_operational_native_captures SET expires_at=expires_at+interval '1 second' WHERE ${tenant(f.scope)}`.execute(db)).rejects.toThrow("OPERATIONAL_SOURCE_EXPIRY_EXTENSION_FORBIDDEN");
  await sql`DELETE FROM rule_operational_contexts WHERE ${tenant(f.scope)} AND id=${f.id}::uuid`.execute(db);
  expect((await sql`SELECT context_id FROM rule_operational_native_captures WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
 });
});
