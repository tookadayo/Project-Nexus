import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it} from "vitest";
import {connect,migrate,sql,tenant,type Database} from "../../packages/db/src/index";
import {isolatedPostgres} from "../fixtures/postgres";
import {analysisFixture} from "../fixtures/analysis";
import {RuleIssueRegistry,readIssueRegistryCandidate} from "../../packages/rules/src/issue-registry";
import {hashRuleValue,type RuleResult} from "../../packages/rules/src/facts";
let infra:Awaited<ReturnType<typeof isolatedPostgres>>,db:Database;
beforeAll(async()=>{infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
async function fixture(){
 const f=await analysisFixture(db,"SCALE"),now=Date.now(),baseTarget={targetType:"CHANNEL",targetId:"123456789012345679",liveVersion:"fixture-1"};
 await sql`INSERT INTO rule_config_versions(organization_id,guild_id,version,state,engine_version,definition,content_hash,created_at,approved_at,expires_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},1,'ACTIVE','fixture','{}'::jsonb,${'c'.repeat(64)},now(),now(),now()+interval '1 hour')`.execute(db);
 const periods=Array.from({length:3},(_,i)=>({windowStart:new Date(now-(3-i)*60000).toISOString(),windowEnd:new Date(now-(2-i)*60000).toISOString()}));
 for(const period of periods){
  const job=randomUUID(),result:RuleResult={ruleId:"ENG-001",ruleVersion:"1",target:baseTarget,decision:"FIRE",reasonCodes:["SYNTHETIC"],priority:"P2",issueCode:"ENG_CHANNEL_UNDERUSE",domain:"CHANNEL_USAGE",evidenceRefs:[],sourceHealthRefs:[],...period,evaluationAsOf:new Date(now).toISOString(),inputHash:'a'.repeat(64),action:"REVIEW_ONLY",sufficient:false,partialCoverage:false,actionableUntil:new Date(now+3600000).toISOString(),lineageKey:'b'.repeat(64)};
  await sql`INSERT INTO rule_evaluation_jobs(organization_id,guild_id,id,config_version,evaluation_as_of,input_hash,request_hash,versions,inputs,state,created_at,finished_at,expires_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${job}::uuid,1,${new Date(now)},${result.inputHash},${hashRuleValue(period)},'{}'::jsonb,'{}'::jsonb,'SUCCEEDED',${new Date(now)},${new Date(now)},${new Date(now+3600000)})`.execute(db);
  await sql`INSERT INTO rule_evaluation_results(organization_id,guild_id,id,job_id,rule_id,target_type,target_id,live_version,result,reason_code,result_hash,payload,expires_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,${job}::uuid,'ENG-001',${baseTarget.targetType},${baseTarget.targetId},${baseTarget.liveVersion},'FIRE','SYNTHETIC',${hashRuleValue(result)},${JSON.stringify(result)}::jsonb,${new Date(now+3600000)})`.execute(db);
 }
 const service=new RuleIssueRegistry(db,{authorization:{scope:f.s,actorHash:f.actor.key,expiresAt:new Date(now+60000)}}),listed=await service.list(f.s,f.actor);
 const input={id:randomUUID(),expectedVersion:0,issueCode:"ENG_CHANNEL_UNDERUSE",baseTarget,experimentIds:[],playbookIds:[],experimentsComplete:false,playbooksComplete:false,validForSeconds:1800,inventoryHashes:listed.inventoryHashes};
 return {...f,service,input,periods};
}
it("requires an explicit complete census before an empty map can mean ABSENT",async()=>{
 const f=await fixture(),saved=await f.service.save(f.s,f.actor,f.input),asOf=new Date(Date.now()+1000).toISOString();
 const before=await db.transaction().execute(tx=>readIssueRegistryCandidate(tx,f.s,f.actor,{kind:"EXPERIMENT_STATE",issueCode:f.input.issueCode,targetId:saved.target.targetId,liveVersion:saved.target.liveVersion},asOf));
 expect(before.sealable).toBe(false);expect(before.reasonCodes).toContain("ISSUE_REGISTRY_CENSUS_NOT_DECLARED_COMPLETE");
 const next=await f.service.save(f.s,f.actor,{...f.input,expectedVersion:1,experimentsComplete:true});
 const result=await db.transaction().execute(tx=>readIssueRegistryCandidate(tx,f.s,f.actor,{kind:"EXPERIMENT_STATE",issueCode:f.input.issueCode,targetId:next.target.targetId,liveVersion:next.target.liveVersion},new Date(Date.now()+1000).toISOString()));
 expect(result.value).toEqual({kind:"enum",value:"ABSENT"});expect(result.generatedHealth?.[0]?.observedAt).not.toEqual(new Date(Date.now()+1000).toISOString());
});
it("rejects a stale inventory assertion instead of binding unseen native changes",async()=>{
 const f=await fixture();await expect(f.service.save(f.s,f.actor,{...f.input,inventoryHashes:{...f.input.inventoryHashes,experiments:'0'.repeat(64)}})).rejects.toThrow("ISSUE_REGISTRY_INVENTORY_CHANGED");
 expect((await sql`SELECT id FROM rule_issue_registry WHERE ${tenant(f.s)}`.execute(db)).rows).toEqual([]);
});
it("uses three exact retained base results without copying a longer issue history",async()=>{
 const f=await fixture(),saved=await f.service.save(f.s,f.actor,f.input),request={kind:"STRUCTURED_ISSUE_PERIODS" as const,issueCode:f.input.issueCode,targetId:saved.target.targetId,liveVersion:saved.target.liveVersion,baseTargetType:f.input.baseTarget.targetType,baseTargetId:f.input.baseTarget.targetId,baseLiveVersion:f.input.baseTarget.liveVersion,periods:f.periods};
 const result=await db.transaction().execute(tx=>readIssueRegistryCandidate(tx,f.s,f.actor,request,new Date(Date.now()+1000).toISOString()));
 expect(result.value).toMatchObject({kind:"issuePeriods",periods:[{state:"FIRE"},{state:"FIRE"},{state:"FIRE"}]});
 await sql`DELETE FROM rule_evaluation_results WHERE ${tenant(f.s)} AND (payload->>'windowStart')::timestamptz=${f.periods[0]!.windowStart}::timestamptz`.execute(db);
 const missing=await db.transaction().execute(tx=>readIssueRegistryCandidate(tx,f.s,f.actor,request,new Date(Date.now()+1000).toISOString()));
 expect(missing.sealable).toBe(false);expect(missing.reasonCodes).toContain("ISSUE_PERIOD_RESULT_MISSING_OR_INELIGIBLE");
});
it("keeps original source expiry and never revives an expired registry by reading",async()=>{
 const f=await fixture(),saved=await f.service.save(f.s,f.actor,f.input);
 const expired=await db.transaction().execute(tx=>readIssueRegistryCandidate(tx,f.s,f.actor,{kind:"PLAYBOOK_STATE",issueCode:f.input.issueCode,targetId:saved.target.targetId,liveVersion:saved.target.liveVersion},new Date(Date.parse(saved.expiresAt)+1).toISOString()));
 expect(expired.sealable).toBe(false);expect(expired.reasonCodes).toContain("ISSUE_REGISTRY_VERSION_UNAVAILABLE");
 expect((await f.service.list(f.s,f.actor)).items[0]?.expiresAt).toBe(saved.expiresAt);
});
