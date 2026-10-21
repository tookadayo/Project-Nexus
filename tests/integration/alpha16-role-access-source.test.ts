import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {PermissionFlagsBits as P} from "discord-api-types/v10";
import {connect,ensureGuild,migrate,sql,json,tenant,type Database,type Tx} from "../../packages/db/src/index";
import {scopeForGuild} from "../../packages/security/src/scoping";
import type {Actor} from "../../packages/settings/src/index";
import type {DiscordPort} from "../../packages/discord/src/rest";
import {roleChannelMetadata} from "../../packages/discord/src/role-access";
import {createRoleAccessSourcePlugin,expireRoleAccessObservations} from "../../packages/rules/src/role-access-source";
import {nativeObservedChannelVersion} from "../../packages/rules/src/native-cohort-projections";
import {acquireRuleScopeLocks,ruleScopeLockSet} from "../../packages/rules/src/locks";
import type {OperationalSourceRequest} from "../../packages/rules/src/operational-context-sources";
import {isolatedPostgres} from "../fixtures/postgres";
import {templateFlow} from "../../packages/onboarding/src/flow";
import {OnboardingFlowDrafts,onboardingFlowTargetVersion} from "../../packages/onboarding/src/flow-drafts";
let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
beforeAll(async()=>{vi.stubEnv("NEXUS_HOSTED_BETA","off");infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{vi.unstubAllEnvs();await db?.destroy();await infra?.stop();});
async function fixture(caseId:"CASE01"|"CASE10"|"CASE17"="CASE10",memberException=false){
  const scope=scopeForGuild(String(869900000000000000n+BigInt(++serial)));await ensureGuild(db,scope);
  const actor:Actor={key:"synthetic-role-access-admin",permissions:"8",roles:[],source:"WEB_DASHBOARD",requestId:randomUUID()};
  const proof={scope,actorHash:actor.key,expiresAt:new Date(Date.now()+60000)},channelId="869911111111111111",roleId="869922222222222222",personId="869933333333333333",contextId=randomUUID(),snapshotId=randomUUID();
  const observedAt=new Date(Date.now()-1000),channel={id:channelId,type:0,parentId:null,observable:true,tagIds:[]};
  await sql`INSERT INTO guild_capability_snapshots(organization_id,guild_id,id,snapshot,checked_at)
    VALUES(${scope.organizationId}::uuid,${scope.guildId},${snapshotId}::uuid,${json({schemaVersion:2,checkedAt:observedAt.toISOString(),channels:[channel],coverage:{ratio:0.5},onboarding:{enabled:true,mode:0,defaultChannelIds:[channelId],prompts:[]}})},${observedAt})`.execute(db);
  await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,parent_id,channel_type,observed_at,visibility_state,visibility_observed_at,collection_forbidden)
    VALUES(${scope.organizationId}::uuid,${scope.guildId},${channelId},NULL,0,${observedAt},'VISIBLE',${observedAt},false)`.execute(db);
  const channelVersion=nativeObservedChannelVersion(snapshotId,channel),target={targetType:caseId==="CASE01"?"ONBOARDING_FLOW":caseId==="CASE17"?"PERMISSION":"CHANNEL",targetId:channelId,liveVersion:channelVersion};
  if(caseId==="CASE01"){
    const flowId=randomUUID();await sql`INSERT INTO flow_versions(organization_id,guild_id,id,version,definition) VALUES(${scope.organizationId}::uuid,${scope.guildId},${flowId}::uuid,1,${json(templateFlow("General Community"))})`.execute(db);
    await sql`INSERT INTO guild_settings(organization_id,guild_id,revision,settings) VALUES(${scope.organizationId}::uuid,${scope.guildId},1,${json({onboardingEnabled:true,startChannelId:channelId,flowVersionId:flowId})})`.execute(db);
    target.targetId=flowId;target.liveVersion=await db.transaction().execute(async tx=>onboardingFlowTargetVersion(await new OnboardingFlowDrafts(tx).current(tx,scope,flowId)));
  }
  const config={destinationKind:caseId==="CASE01"?"NATIVE_ONBOARDING_DEFAULT":caseId==="CASE17"?"REPORT_CHANNEL":"CASE_CHANNEL",channelId,channelVersion,representativeRoleIds:[roleId]};
  const request:Omit<OperationalSourceRequest,"phase"|"beforeWrite"|"prepared">={contextId,caseId,target,window:{start:new Date(observedAt.getTime()-60000).toISOString(),end:observedAt.toISOString()},evaluationAsOf:new Date().toISOString(),proof,config};
  const metadata=()=>roleChannelMetadata(scope.guildId,channelId,{id:channelId,guild_id:scope.guildId,type:0,parent_id:null,permission_overwrites:[
    {type:0,id:roleId,allow:String(P.ViewChannel|P.SendMessages),deny:"0"},...(memberException?[{type:1,id:personId,allow:"0",deny:String(P.ViewChannel)}]:[])]},
    [{id:scope.guildId,permissions:"0"},{id:roleId,permissions:"0"}],new Date());
  const read=vi.fn(async()=>metadata()),discord={roleChannelMetadata:read} as unknown as DiscordPort,plugin=createRoleAccessSourcePlugin();
  async function scoped<T>(work:(tx:Tx,now:Date)=>Promise<T>){return db.transaction().execute(async tx=>{await acquireRuleScopeLocks(tx,ruleScopeLockSet(scope));const now=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;return work(tx,now);});}
  async function capture(prepared:unknown){return scoped(async(tx,now)=>{
    await sql`INSERT INTO rule_operational_contexts(organization_id,guild_id,id,version,case_id,target_type,target_id,live_version,window_start,window_end,observed_at,created_at,expires_at,content_hash)
      VALUES(${scope.organizationId}::uuid,${scope.guildId},${contextId}::uuid,1,${caseId},${target.targetType},${target.targetId},${target.liveVersion},${new Date(request.window.start)},${new Date(request.window.end)},${now},${now},${new Date(now.getTime()+48*3600000)},${"a".repeat(64)})`.execute(tx);
    return plugin.read(tx,scope,actor,{...request,evaluationAsOf:now.toISOString(),phase:"CAPTURE",prepared,beforeWrite:async()=>{}});
  });}
  return {scope,actor,proof,channelId,roleId,personId,request,observedAt,plugin,discord,read,scoped,capture};
}
describe("native role access immutable capture source",()=>{
  it("captures all three exact native targets and rereads original provenance without Discord or clock renewal",async()=>{
    for(const caseId of ["CASE01","CASE10","CASE17"] as const){
      const f=await fixture(caseId),prepared=await f.plugin.outsideTx!(db,f.scope,f.actor,f.request,{discord:f.discord}),captured=await f.capture(prepared);
      expect(captured[0]).toMatchObject({fieldId:caseId==="CASE01"?"onb.actualAccess":caseId==="CASE10"?"channel.actualAccess":"reportChannel.actualPermission",quality:"SUFFICIENT",sourceKind:"SYSTEM_OBSERVATION",value:caseId==="CASE17"?"RESTRICTED":"ALLOWED"});
      expect(Date.parse(captured[0]!.expiresAt)).toBeLessThanOrEqual(f.observedAt.getTime()+3600000);expect(f.read).toHaveBeenCalledTimes(2);
      const again=await f.scoped((tx,now)=>f.plugin.read(tx,f.scope,f.actor,{...f.request,evaluationAsOf:now.toISOString(),phase:"VALIDATE",beforeWrite:async()=>{throw new Error("read must not write");}}));
      expect(again).toEqual(captured);expect(f.read).toHaveBeenCalledTimes(2);
    }
  });
  it("retains only member-exception presence and emits UNKNOWN instead of an individual permission claim",async()=>{
    const f=await fixture("CASE17",true),prepared=await f.plugin.outsideTx!(db,f.scope,f.actor,f.request,{discord:f.discord}),captured=await f.capture(prepared);
    expect(captured[0]).toMatchObject({value:null,quality:"UNKNOWN",sourceKind:"SYSTEM_OBSERVATION"});
    const data=(await sql<{metadata:unknown}>`SELECT metadata FROM rule_role_access_observations WHERE ${tenant(f.scope)}`.execute(db)).rows[0]!.metadata;
    expect(JSON.stringify(data)).not.toContain(f.personId);expect(data).toMatchObject({memberOverwritePresent:true});
  });
  it("rejects pre/post capture changes, a forged opaque token, expired proof and current binding changes",async()=>{
    const f=await fixture();
    f.read.mockReset();let count=0;f.read.mockImplementation(async()=>roleChannelMetadata(f.scope.guildId,f.channelId,{id:f.channelId,guild_id:f.scope.guildId,type:0,parent_id:null,permission_overwrites:[]},[{id:f.scope.guildId,permissions:String(++count===1?0n:P.ViewChannel)},{id:f.roleId,permissions:"0"}],new Date()));
    await expect(f.plugin.outsideTx!(db,f.scope,f.actor,f.request,{discord:f.discord})).rejects.toThrow("ROLE_ACCESS_CAPTURE_CHANGED");
    const good=await fixture(),prepared=await good.plugin.outsideTx!(db,good.scope,good.actor,good.request,{discord:good.discord});
    expect(await good.capture({...(prepared as object)})).toEqual([]);
    await sql`DELETE FROM rule_operational_contexts WHERE ${tenant(good.scope)}`.execute(db);
    good.proof.expiresAt=new Date(0);await expect(good.capture(prepared)).rejects.toThrow("CURRENT_AUTHORIZATION_REQUIRED");
    good.proof.expiresAt=new Date(Date.now()+60000);
    await sql`UPDATE discord_surface_state SET collection_forbidden=true WHERE ${tenant(good.scope)}`.execute(db);
    await expect(good.capture(prepared)).rejects.toThrow("ROLE_ACCESS_CHANNEL_NOT_CURRENTLY_VISIBLE");
  });
  it("purges its earlier original expiry independently and cascades on canonical context deletion",async()=>{
    const f=await fixture(),prepared=await f.plugin.outsideTx!(db,f.scope,f.actor,f.request,{discord:f.discord});await f.capture(prepared);
    await f.scoped((tx)=>expireRoleAccessObservations(tx,f.scope,new Date(f.observedAt.getTime()+3600001)));
    expect((await sql`SELECT id FROM rule_role_access_observations WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
    expect((await sql`SELECT id FROM rule_operational_contexts WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(1);
    const g=await fixture(),p=await g.plugin.outsideTx!(db,g.scope,g.actor,g.request,{discord:g.discord});await g.capture(p);
    await sql`DELETE FROM rule_operational_contexts WHERE ${tenant(g.scope)}`.execute(db);
    expect((await sql`SELECT id FROM rule_role_access_observations WHERE ${tenant(g.scope)}`.execute(db)).rows).toHaveLength(0);
  });
});
