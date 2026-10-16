import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,it,expect} from "vitest";
import {connect,migrate,sql,json,tenant,type Database} from "../../packages/db/src/index";
import {analysisFixture,analysisVault} from "../fixtures/analysis";
import {isolatedPostgres} from "../fixtures/postgres";
import {reviseNativeCohortConfig,type NativeCohortDefinition,type NativeCohortConfig} from "../../packages/rules/src/native-cohort-config";
import {readNativeCohortProjection,nativeObservedChannelVersion,type NativeCohortRequest} from "../../packages/rules/src/native-cohort-projections";
import {OnboardingFlowDrafts,onboardingFlowTargetVersion} from "../../packages/onboarding/src/flow-drafts";
import {templateFlow} from "../../packages/onboarding/src/flow";
import {configHash} from "../../packages/settings/src/revisions";
import type {CapabilitySnapshot,ChannelMetadata} from "../../packages/shared/src/community-model";

// Authored only. The suite provisions isolated PostgreSQL; it never reads
// DATABASE_URL, a deployment database, Discord, real users or credentials.
let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const day=86400000,voice="933333333333333332",other="933333333333333331";
beforeAll(async()=>{infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
async function fixture(){
 const f=await analysisFixture(db,"STARTER",false,{organizationId:randomUUID(),guildId:String(888168200000000000n+BigInt(++serial))});
 const end=new Date();end.setUTCHours(0,0,0,0);const start=new Date(end.getTime()-7*day),previous=new Date(end.getTime()-14*day),joined=new Date(end.getTime()-29*day),at=new Date();
 const channels:ChannelMetadata[]=[{id:f.channel,type:0,parentId:null,observable:true,tagIds:[]},{id:other,type:0,parentId:null,observable:true,tagIds:[]},{id:voice,type:2,parentId:null,observable:true,tagIds:[]}];
 for(const channel of channels)await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,observed_at,visibility_state,visibility_observed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${channel.id},${channel.type},${at},'VISIBLE',${at}) ON CONFLICT(organization_id,guild_id,channel_id) DO UPDATE SET channel_type=EXCLUDED.channel_type,visibility_state='VISIBLE',visibility_observed_at=EXCLUDED.visibility_observed_at,observed_at=EXCLUDED.observed_at`.execute(db);
 const base=(await sql<{snapshot:CapabilitySnapshot}>`SELECT snapshot FROM guild_capability_snapshots WHERE ${tenant(f.s)} ORDER BY checked_at DESC LIMIT 1`.execute(db)).rows[0]!.snapshot,snapshotId=randomUUID();
 await sql`INSERT INTO guild_capability_snapshots VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${snapshotId}::uuid,${json({...base,checkedAt:at.toISOString(),channels})},${at})`.execute(db);
 await sql`INSERT INTO telemetry_cursor VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${joined},${at}) ON CONFLICT(organization_id,guild_id) DO UPDATE SET first_seen=EXCLUDED.first_seen,last_seen=EXCLUDED.last_seen`.execute(db);
 const cfg=await f.settings.get(f.s);
 const common={settingsRevision:cfg.revision,campaignClass:"FIXTURE_PRODUCTION",timeZone:"UTC"};
 async function member(n:number,context:"PRODUCTION"|"TEST"="PRODUCTION"){
  const user=String(922168200000000000n+BigInt(n)),identity=await analysisVault.resolve(db,f.s,user),episode=randomUUID();
  await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context,screening_observed_at,guest_observed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${episode}::uuid,${identity}::uuid,${joined},${context},${joined},${joined})`.execute(db);return {identity,episode,hash:analysisVault.hash(f.s,user),context};
 }
 async function event(person:Awaited<ReturnType<typeof member>>,kind:string,time:Date,data:Record<string,unknown>={}){
  await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,${person.episode}::uuid,${kind},${time},${person.context},${json({channelId:f.channel,...data})})`.execute(db);
 }
 async function save(definition:NativeCohortDefinition){return db.transaction().execute(tx=>reviseNativeCohortConfig(tx,f.s,{sourceId:randomUUID(),revisionId:randomUUID(),baseVersion:0,enabled:true,definition},new Date(),new Date(Date.now()+7*day)));}
 async function project(config:NativeCohortConfig,windowStart=start,windowEnd=end,periodRole:"CURRENT"|"PREVIOUS"="CURRENT",asOf=new Date().toISOString()){
  const request={kind:config.definition.kind,...(config.definition.kind==="CHANNEL_PARTICIPATION_COHORT"?{channelId:config.target.targetId}:{targetId:config.target.targetId}),liveVersion:config.target.liveVersion,windowStart:windowStart.toISOString(),windowEnd:windowEnd.toISOString(),periodRole,sourceConfig:{sourceId:config.sourceId,revisionId:config.revisionId}} as NativeCohortRequest;
  return db.transaction().execute(tx=>readNativeCohortProjection(tx,f.s,f.actor,request,asOf));
 }
 return {...f,end,start,previous,joined,at,common,channels,snapshotId,member,event,save,project};
}
it("intersects the previous unique eligible participant cohort with current participants and excludes newcomers, duplicate events and TEST",async()=>{
 const f=await fixture(),a=await f.member(1),b=await f.member(2),newcomer=await f.member(3),test=await f.member(4,"TEST");
 for(const member of [a,b,test])await f.event(member,"message.sent",new Date(f.start.getTime()-day));
 for(const member of [a,a,newcomer,test])await f.event(member,"message.sent",new Date(f.end.getTime()-day));
 const config=await f.save({kind:"ENGAGEMENT_CONTINUATION_COHORT",...f.common,channelIds:[f.channel],signals:["message.sent"],windowDays:7}),asOf=new Date().toISOString(),[result]=await f.project(config,f.start,f.end,"CURRENT",asOf);
 expect(result!.value).toEqual({kind:"ratio",numerator:"1",denominator:"2"});expect(result!.comparison?.windowKind).toBe("CALENDAR");expect(result!.generatedHealth?.[0]?.lastSuccessfulIngestAt).not.toBe(result!.observedAt);
 const [again]=await f.project(config,f.start,f.end,"CURRENT",asOf);expect(again!.generatedHealth?.[0]?.observationId).toBe(result!.generatedHealth?.[0]?.observationId);expect(again!.expiresAt).toBe(result!.expiresAt);
 await sql`INSERT INTO telemetry_health VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,${new Date(f.start.getTime()-3600000)},${f.start},'fixture gap')`.execute(db);
 const [gap]=await f.project(config);expect(gap!.value).toBeNull();expect(gap!.sealable).toBe(false);expect(gap!.generatedHealth?.[0]?.state).toBe("UNKNOWN");expect(gap!.generatedHealth?.[0]?.coverage).toBeNull();
});
it("uses a matched unique channel/guild population and an immutable native channel observation version",async()=>{
 const f=await fixture(),a=await f.member(11),b=await f.member(12);
 await f.event(a,"message.sent",new Date(f.end.getTime()-day));await f.event(a,"message.sent",new Date(f.end.getTime()-day));await f.event(b,"message.sent",new Date(f.end.getTime()-day),{channelId:other});
 await f.event(a,"message.sent",new Date(f.end.getTime()-10*day));await f.event(b,"message.sent",new Date(f.end.getTime()-10*day),{channelId:other});
 const config=await f.save({kind:"CHANNEL_PARTICIPATION_COHORT",...f.common,channelId:f.channel,channelTargetVersion:nativeObservedChannelVersion(f.snapshotId,f.channels[0]!),populationChannelIds:[f.channel,other],signals:["message.sent"],windowDays:7}),[result]=await f.project(config);
 expect(result!.value).toEqual({kind:"ratio",numerator:"1",denominator:"2"});expect(result!.target.liveVersion).not.toBe(String(config.version));
 const [previous]=await f.project(config,f.previous,f.start,"PREVIOUS");expect(previous!.value).toEqual({kind:"ratio",numerator:"1",denominator:"2"});expect(Date.parse(previous!.expiresAt!)).toBeGreaterThan(Date.now());expect(previous!.generatedHealth?.[0]?.observedAt).toBe(previous!.observedAt);
 await sql`UPDATE discord_surface_state SET collection_forbidden=true WHERE ${tenant(f.s)} AND channel_id=${f.channel}`.execute(db);
 await expect(f.project(config)).rejects.toThrow("RULE_COHORT_CHANNEL_NOT_CURRENTLY_PERMITTED");
});
it("counts only mature onboarding cases with both completion and the same pinned first action inside that case",async()=>{
 const f=await fixture(),flowId=randomUUID(),activationId=randomUUID(),flow=templateFlow("General Community"),definition={name:"fixture first action",windowSeconds:86400,rule:{op:"event",event:"message.sent",withinSeconds:86400}};
 await sql`INSERT INTO flow_versions VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${flowId}::uuid,1,${json(flow)},${f.joined})`.execute(db);
 await sql`INSERT INTO guild_config_revisions(organization_id,guild_id,id,domain,version,definition,hash,author,state,published_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${activationId}::uuid,'activation',1,${json(definition)},${configHash(definition)},'fixture','published',${f.joined})`.execute(db);
 await sql`UPDATE guild_settings SET revision=revision+1,settings=settings||${json({onboardingEnabled:true,flowVersionId:flowId})} WHERE ${tenant(f.s)}`.execute(db);
 const a=await f.member(21),b=await f.member(22),immature=await f.member(23);
 for(const [member,start] of [[a,new Date(f.end.getTime()-2*day)],[b,new Date(f.end.getTime()-3*day)],[immature,new Date(f.end.getTime()-day/4)]] as const){
  await sql`INSERT INTO activation_members VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${member.episode}::uuid,${activationId}::uuid,NULL)`.execute(db);
  await sql`INSERT INTO flow_sessions(organization_id,guild_id,id,episode_id,flow_version_id,revision,state,context,created_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,${member.episode}::uuid,${flowId}::uuid,3,${json({nodeId:null,answers:{},complete:true})},'PRODUCTION',${start})`.execute(db);
  await f.event(member,"nexus_onboarding.completed",new Date(start.getTime()+3600000),{flowVersionId:flowId});
 }
 await f.event(a,"activation.completed",new Date(f.end.getTime()-day*1.5),{definitionId:activationId,definitionVersion:1});
 await f.event(b,"activation.completed",new Date(f.end.getTime()-day*4),{definitionId:activationId,definitionVersion:1});
 const current=await db.transaction().execute(tx=>new OnboardingFlowDrafts(tx).current(tx,f.s,flowId)),config=await f.save({kind:"ONBOARDING_FIRST_ACTION",...f.common,settingsRevision:current.settingsRevision,flowVersionId:flowId,flowTargetVersion:onboardingFlowTargetVersion(current),activationRevisionId:activationId,observationSeconds:86400,windowDays:7}),[result]=await f.project(config);
 expect(result!.value).toEqual({kind:"ratio",numerator:"1",denominator:"2"});expect(result!.comparison?.maturityOffset).toBe("86400");
});
it("preserves the exact HELP first-response gap instead of treating an acknowledgement as a successful answer",async()=>{
 const f=await fixture(),panel=randomUUID(),request=randomUUID(),key="intake:"+request,created=new Date(f.end.getTime()-4*day);
 await sql`INSERT INTO operations_intake_panels(organization_id,guild_id,id,title,category,state,actor_hash) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${panel}::uuid,'fixture','fixture','PUBLISHED',${f.actor.key})`.execute(db);
 await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,target_surface,acknowledged_at,updated_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},'',${key},${created},'ACKNOWLEDGED','OPERATIONS_REQUEST','INTAKE_FORM',${created},${created})`.execute(db);
 await sql`INSERT INTO operations_requests(organization_id,guild_id,id,panel_id,interaction_digest,actor_hash,category,fields_ciphertext,attention_key,created_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${request}::uuid,${panel}::uuid,${request},${f.actor.key},'fixture','FIXTURE_NOT_A_REAL_BODY',${key},${created})`.execute(db);
 // An unrelated actual Discord post can have an observed human reply. Its
 // snowflake grain is not the synthetic intake key, so it cannot answer this
 // form request without an authoritative request-to-message binding.
 await sql`INSERT INTO location_post_observations(organization_id,guild_id,message_id,channel_id,sent_at,author_kind,message_type,first_reply_seconds,reply_source) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},'955555555555555550',${f.channel},${created},'HUMAN',0,60,'DIRECT')`.execute(db);
 const config=await f.save({kind:"HELP_BACKLOG_COHORT",...f.common,panels:[{panelId:panel,version:1}],slaSeconds:3*86400,stalledAfterSeconds:null,windowDays:7}),[result]=await f.project(config);
 expect(result!.value).toBeNull();expect(result!.reasonCodes).toEqual(["HELP_FIRST_RESPONSE_AND_STRUCTURED_STALLED_SOURCE_UNAVAILABLE"]);expect(result!.generatedHealth?.[0]?.state).toBe("UNKNOWN");
});
it("intersects confirmed RSVP with attendance for the same event, excludes unmatched attendance/unsubscribed people and refuses expired previous detail",async()=>{
 const f=await fixture(),eventId="944444444444444440",a=await f.member(31),b=await f.member(32),unmatched=await f.member(33),unsubscribed=await f.member(34),created=new Date(f.end.getTime()-3*day),started=new Date(f.end.getTime()-2*day),completed=new Date(f.end.getTime()-day);
 for(const [kind,time,status] of [["scheduled_event.created",created,1],["scheduled_event.updated",started,2],["scheduled_event.updated",completed,3]] as const)await sql`INSERT INTO adaptive_facts(organization_id,guild_id,id,kind,occurred_at,data) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,${kind},${time},${json({eventId,channelId:voice,entityType:2,status})})`.execute(db);
 async function fact(member:Awaited<ReturnType<typeof f.member>>,kind:string,at:Date){await sql`INSERT INTO adaptive_facts(organization_id,guild_id,id,kind,subject_hash,episode_id,occurred_at,data) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,${kind},${member.hash},${member.episode}::uuid,${at},${json({eventId,channelId:voice,entityType:2})})`.execute(db);}
 for(const member of [a,b,unsubscribed])await fact(member,"scheduled_event.subscribed",new Date(created.getTime()+3600000));
 await fact(b,"scheduled_event.subscribed",new Date(created.getTime()+7200000));await fact(unsubscribed,"scheduled_event.unsubscribed",new Date(created.getTime()+10800000));
 for(const member of [a,unmatched,unsubscribed])await fact(member,"scheduled_event.attended",new Date(started.getTime()+3600000));
 const config=await f.save({kind:"EVENT_RSVP_ATTENDANCE_COHORT",...f.common,eventIds:[eventId],channelIds:[voice],confirmation:"DISCORD_SUBSCRIPTION_AT_EVENT_START",attendance:"OBSERVED_VOICE_STAGE",windowDays:28}),start=new Date(f.end.getTime()-28*day),[result]=await f.project(config,start,f.end);
 expect(result!.value).toEqual({kind:"ratio",numerator:"1",denominator:"2",eligibleEvents:"1"});
 const [previous]=await f.project(config,new Date(start.getTime()-28*day),start,"PREVIOUS");expect(previous!.value).toBeNull();expect(previous!.reasonCodes).toEqual(["NATIVE_COHORT_WINDOW_EXCEEDS_RETAINED_DETAIL"]);
});
