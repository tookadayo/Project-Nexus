import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { connect,migrate,sql,tenant,json,type Database } from "../../packages/db/src/index";
import { infrastructure } from "../fixtures/infrastructure";
import { analysisFixture } from "../fixtures/analysis";
import { analysisMetrics } from "../../packages/analytics/src/analysis";
import { analysisChannelScope } from "../../packages/lifecycle/src/discovery";
import { projectLocationPost,projectStructure } from "../../packages/lifecycle/src/adaptive-projector";
import { CommunityService } from "../../packages/presentation/src/community";
import { AnalyticsService } from "../../packages/analytics/src/index";
import { AttentionOperations } from "../../packages/operations/src/attention";
import { buildCapabilitySnapshot } from "../../packages/discord/src/discovery";
import { analysisVault } from "../fixtures/analysis";
import { stabilizationServers } from "../fixtures/stabilization-servers";
import type { Envelope } from "../../packages/events/src/index";
let infra:Awaited<ReturnType<typeof infrastructure>>,db:Database;
beforeAll(async()=>{infra=await infrastructure();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
const category="733333333333333333",b="733333333333333334",forum="733333333333333335",thread="733333333333333336";
async function structure(f:Awaited<ReturnType<typeof analysisFixture>>,type=0,parent:string|null=category,id=f.channel){await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,parent_id,observed_at,visibility_state) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${id},${type},${parent},${f.start},'VISIBLE') ON CONFLICT DO NOTHING`.execute(db);}
async function result(f:Awaited<ReturnType<typeof analysisFixture>>){const cfg=await f.settings.get(f.s);return analysisMetrics(db,f.s,cfg,"OVERALL",f.start,f.end,"scope",30);}
const value=(r:Awaited<ReturnType<typeof result>>,key:string)=>r.metrics.find(m=>m.key===key)?.evidence.value;
it("counts selected actual text A under its category, excludes B and basic presentation agrees",async()=>{
 const f=await analysisFixture(db);await structure(f);await structure(f,0,category,b);
 await f.settings.update(f.s,f.actor,1,{analysisScope:{mode:"include",channelIds:[f.channel]}});
 await sql`INSERT INTO telemetry_cursor(organization_id,guild_id,first_seen,last_seen) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${f.start},${f.end})`.execute(db);
 await sql`UPDATE lifecycle_events SET occurred_at=${new Date(f.start.getTime()+2*86400000)} WHERE ${tenant(f.s)} AND kind='message.sent'`.execute(db);
 const episode=(await sql<{episode_id:string}>`SELECT episode_id FROM message_observations WHERE ${tenant(f.s)} LIMIT 1`.execute(db)).rows[0]!.episode_id;
 await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',${new Date(f.start.getTime()+2*86400000)},'PRODUCTION',${json({channelId:b,messageId:"733333333333333339"})})`.execute(db);
 expect(value(await result(f),"observed_posts")).toBe(7);
 const basic=await new CommunityService(db,f.settings).overview(f.s,30,f.end);expect(basic.hiddenChannelCount).toBe(1);expect(basic.channels.map(c=>c.channelId)).not.toContain(b);
 const scoped=await analysisChannelScope(db,f.s,await f.settings.get(f.s));expect(scoped.actualChannelIds).toEqual([f.channel]);
 const canonical=await new AnalyticsService(db,f.settings).canonical(f.s,f.start,f.end,f.end);expect(canonical).toBeDefined();
});
it("counts staff announcements and Bot/Webhook occurrence separately from participants",async()=>{
 const f=await analysisFixture(db);await structure(f,5);await f.settings.update(f.s,f.actor,1,{staffRoleIds:[b],communityModel:{...(await f.settings.get(f.s)).communityModel,channels:[{channelId:f.channel,purpose:"ANNOUNCEMENT"}]}});
 await sql`UPDATE member_observable_state SET roles=ARRAY[${b}] WHERE ${tenant(f.s)}`.execute(db);
 const cfg=await f.settings.get(f.s),base={...f.s,shardId:0,gatewaySessionId:"location",sequence:1,at:new Date(f.end.getTime()-86400000).toISOString(),context:"PRODUCTION" as const,kind:"channel.post_observed" as const,channelId:f.channel,messageType:0};
 for(const [index,authorKind] of ["BOT","WEBHOOK"].entries())await projectLocationPost(db,f.s,{...base,messageId:String(733333333333333350n+BigInt(index)),authorKind:authorKind as "BOT"|"WEBHOOK"},cfg,null);
 const r=await result(f);expect(value(r,"observed_posts")).toBe(9);expect(value(r,"announcement_posts")).toBe(9);expect(value(r,"bot_webhook_posts")).toBe(2);expect(value(r,"new_members")).toBe(0);expect(value(r,"waiting_response")).toBeUndefined();expect(r.concerns).toEqual([]);
});
it("detects structural Forum first human response without Reply references once",async()=>{
 const f=await analysisFixture(db,"FREE",false);await structure(f,15,null,forum);await structure(f,11,forum,thread);
 const cfg={...(await f.settings.get(f.s)),analysisScope:{mode:"include" as const,channelIds:[forum]},communityModel:{...(await f.settings.get(f.s)).communityModel,channels:[{channelId:forum,purpose:"SUPPORT" as const}]}};
 const base={...f.s,shardId:0,gatewaySessionId:"forum",sequence:1,context:"PRODUCTION" as const,kind:"message.sent" as const,channelId:thread,messageType:0,humanVerified:true};
 const at=new Date(f.end.getTime()-2*86400000);await projectLocationPost(db,f.s,{...base,messageId:thread,at:at.toISOString()},cfg,"a".repeat(64));
 await projectLocationPost(db,f.s,{...base,messageId:"733333333333333337",at:new Date(at.getTime()+120000).toISOString()},cfg,"b".repeat(64));
 await projectLocationPost(db,f.s,{...base,messageId:"733333333333333338",at:new Date(at.getTime()+240000).toISOString()},cfg,"c".repeat(64));
 const r=await analysisMetrics(db,f.s,cfg,"SUPPORT",f.start,f.end,"scope",30);expect(value(r,"observed_posts")).toBe(3);expect(value(r,"observed_replies")).toBe(1);expect(value(r,"waiting_response")).toBe(0);
 const p=(await sql<{first_reply_seconds:number;reply_source:string}>`SELECT first_reply_seconds,reply_source FROM location_post_observations WHERE ${tenant(f.s)} AND message_id=${thread}`.execute(db)).rows[0]!;expect(p).toEqual({first_reply_seconds:120,reply_source:"THREAD"});
});
it("a Forum reply to a comment also establishes the starter's first other-human response",async()=>{
 const f=await analysisFixture(db,"FREE",false);await structure(f,15,null,forum);await structure(f,11,forum,thread);const cfg=await f.settings.get(f.s),at=new Date(f.end.getTime()-3600000),base={...f.s,shardId:0,gatewaySessionId:"comment-reply",sequence:1,kind:"message.sent" as const,channelId:thread,context:"PRODUCTION" as const,humanVerified:true,messageType:0};
 await projectLocationPost(db,f.s,{...base,messageId:thread,at:at.toISOString()},cfg,"a".repeat(64));await projectLocationPost(db,f.s,{...base,messageId:b,at:new Date(at.getTime()+60000).toISOString()},cfg,"a".repeat(64));await projectLocationPost(db,f.s,{...base,messageId:category,messageType:19,referenceId:b,at:new Date(at.getTime()+120000).toISOString()},cfg,"b".repeat(64));
 expect((await sql<{first_reply_seconds:number}>`SELECT first_reply_seconds FROM location_post_observations WHERE ${tenant(f.s)} AND message_id=${thread}`.execute(db)).rows[0]?.first_reply_seconds).toBe(120);
});
it("showcase and unmapped posts have no reply duty; observed zero differs from unknown",async()=>{
 const f=await analysisFixture(db,"FREE",false);await structure(f);await f.settings.update(f.s,f.actor,1,{communityModel:{...(await f.settings.get(f.s)).communityModel,modes:[],confirmed:false,channels:[]}});
 const r=await result(f);expect(value(r,"waiting_response")).toBeUndefined();expect(value(r,"bot_webhook_posts")).toBe(0);expect(r.dataQuality).toBe("NO_DATA");
 await sql`UPDATE discord_integration_health SET gateway_state='UNKNOWN' WHERE ${tenant(f.s)}`.execute(db);expect(value(await result(f),"bot_webhook_posts")).toBeNull();
});
it("provides distinct announcement and showcase analyses without invented response concerns",async()=>{
 const f=await analysisFixture(db,"FREE",false);await structure(f,5,null,f.channel);await structure(f,15,null,forum);await structure(f,11,forum,thread);
 const cfg={...(await f.settings.get(f.s)),communityModel:{...(await f.settings.get(f.s)).communityModel,channels:[{channelId:f.channel,purpose:"ANNOUNCEMENT" as const},{channelId:forum,purpose:"SHOWCASE" as const}]}};
 const at=new Date(f.end.getTime()-2*86400000),base={...f.s,shardId:0,gatewaySessionId:"purposes",sequence:1,kind:"message.sent" as const,context:"PRODUCTION" as const,messageType:0,humanVerified:true,at:at.toISOString()};
 await projectLocationPost(db,f.s,{...base,messageId:"733333333333333360",channelId:f.channel},cfg,"a".repeat(64));
 await projectLocationPost(db,f.s,{...base,messageId:thread,channelId:thread},cfg,"b".repeat(64));
 await projectLocationPost(db,f.s,{...base,messageId:"733333333333333361",channelId:thread},cfg,"c".repeat(64));
 const announcements=await analysisMetrics(db,f.s,cfg,"ANNOUNCEMENTS",f.start,f.end,"scope",30),showcase=await analysisMetrics(db,f.s,cfg,"SHOWCASE",f.start,f.end,"scope",30);
 expect(value(announcements,"observed_posts")).toBe(1);expect(value(showcase,"showcase_posts")).toBe(1);expect(value(showcase,"observed_comments")).toBe(1);expect(announcements.concerns).toEqual([]);expect(showcase.concerns).toEqual([]);expect(value(showcase,"waiting_response")).toBeUndefined();
});
it("deletion tombstones beat stale discovery snapshot and replayed structure",async()=>{
 const f=await analysisFixture(db);await structure(f);const cfg=await f.settings.get(f.s),at=new Date(),e:Envelope={...f.s,shardId:0,gatewaySessionId:"delete",sequence:1,kind:"channel.deleted",channelId:f.channel,channelType:0,at:at.toISOString(),context:"PRODUCTION"};
 await projectStructure(db,f.s,e,cfg);await projectStructure(db,f.s,{...e,sequence:2,kind:"channel.changed",at:new Date(at.getTime()+1000).toISOString()},cfg);expect((await analysisChannelScope(db,f.s,cfg)).actualChannelIds).not.toContain(f.channel);expect(value(await result(f),"observed_posts")).toBeNull();
});
it("uses trusted observed types before discovery and cannot revive a tombstone or private thread",async()=>{
 const f=await analysisFixture(db,"FREE",false),cfg=await f.settings.get(f.s),at=new Date(),base:Envelope={...f.s,shardId:0,gatewaySessionId:"typed",sequence:1,kind:"channel.post_observed",messageId:b,channelId:b,channelType:0,authorKind:"BOT",at:at.toISOString(),context:"PRODUCTION"};
 await projectStructure(db,f.s,base,cfg);await projectLocationPost(db,f.s,base,cfg,null);expect((await sql`SELECT message_id FROM location_post_observations WHERE ${tenant(f.s)} AND channel_id=${b}`.execute(db)).rows).toHaveLength(1);
 await projectStructure(db,f.s,{...base,kind:"channel.deleted",sequence:2},cfg);await projectStructure(db,f.s,{...base,sequence:3,at:new Date(at.getTime()+1000).toISOString()},cfg);expect((await analysisChannelScope(db,f.s,cfg)).actualChannelIds).not.toContain(b);
 await projectStructure(db,f.s,{...base,channelId:thread,channelType:12,sequence:4},cfg);expect((await sql`SELECT channel_id FROM discord_surface_state WHERE ${tenant(f.s)} AND channel_id=${thread}`.execute(db)).rows).toHaveLength(0);
});
it.each(stabilizationServers)("$id persists actual scope across basic, detailed and purpose-only Attention",async server=>{
 const f=await analysisFixture(db,"FREE",false),at=new Date(f.end.getTime()-2*3600000),joined=new Date(at.getTime()-3600000),identity=await analysisVault.resolve(db,f.s,f.user),hash=analysisVault.hash(f.s,f.user),episode=randomUUID();
 await sql`DELETE FROM guild_capability_snapshots WHERE ${tenant(f.s)}`.execute(db);
 await sql`INSERT INTO guild_capability_snapshots VALUES(${f.s.organizationId}::uuid,${f.s.guildId},gen_random_uuid(),${json(buildCapabilitySnapshot(server.source,f.end))},${f.end})`.execute(db);
 const cfg=await f.settings.update(f.s,f.actor,1,{communityModel:server.model,analysisScope:server.scope});
 await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context,screening_observed_at,guest_observed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${episode}::uuid,${identity}::uuid,${joined},'PRODUCTION',${joined},${joined})`.execute(db);
 await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,parent_id,channel_type,visibility_state,observed_at) SELECT ${f.s.organizationId}::uuid,${f.s.guildId},id,parent,type,CASE WHEN observable THEN 'VISIBLE' ELSE 'UNOBSERVABLE' END,${at} FROM jsonb_to_recordset(${JSON.stringify(server.source.channels.map(c=>({id:c.id,parent:c.parentId,type:c.type,observable:c.observable})))}::jsonb) AS c(id text,parent text,type integer,observable boolean)`.execute(db);
 let posts=0;
 const selected=await analysisChannelScope(db,f.s,cfg);
 for(const c of selected.resolutions.filter(c=>c.selected && [0,5,15,16].includes(c.channelType!))){
  const publicThread=[15,16].includes(c.channelType!),id=publicThread?String(BigInt(c.actualChannelId)+5000n):c.actualChannelId,messageId=String(BigInt(id)+(publicThread?0n:4000n));
  if(publicThread)await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,parent_id,channel_type,visibility_state,observed_at,created_at,creation_observed,owner_hash) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${id},${c.actualChannelId},11,'VISIBLE',${at},${at},true,${hash})`.execute(db);
  await projectLocationPost(db,f.s,{...f.s,shardId:0,gatewaySessionId:server.id,sequence:++posts,kind:"message.sent",channelId:id,messageId,messageType:0,humanVerified:true,at:at.toISOString(),context:"PRODUCTION"},cfg,hash);
  await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},gen_random_uuid(),${episode}::uuid,'message.sent',${at},'PRODUCTION',${json({channelId:id,messageId})})`.execute(db);
 }
 const scoped=await analysisChannelScope(db,f.s,cfg),basic=await analysisMetrics(db,f.s,cfg,"OVERALL",f.start,f.end,"fixture",30);
 expect(value(basic,"observed_posts")).toBe(posts);expect(scoped.actualChannelIds.some(id=>server.source.threads.some(t=>t.id===id&&t.type===12))).toBe(false);
 for(const type of ["ANNOUNCEMENTS","SHOWCASE","SUPPORT"] as const){const detail=await analysisMetrics(db,f.s,cfg,type,f.start,f.end,"fixture",30);expect(detail.concerns.every(c=>c.metricKey==="waiting_response")).toBe(true);if(type!=="SUPPORT")expect(value(detail,"waiting_response")).toBeUndefined();}
 await new AttentionOperations(db).observe(f.s,cfg,f.end);
 const rows=(await sql<{channel_id:string}>`SELECT channel_id FROM attention_items WHERE ${tenant(f.s)} AND item_type IN ('TEXT_NEWCOMER','FORUM_SUPPORT','LFG_RESPONSE')`.execute(db)).rows,expected=scoped.resolutions.filter(c=>c.selected&&[0,5,10,11].includes(c.channelType!)&&["SUPPORT","BUG_REPORT","LFG"].includes(c.effectivePurpose)).map(c=>c.actualChannelId);
 expect(rows.map(r=>r.channel_id).sort()).toEqual(expected.sort());
 if(server.id==="S8"){
  const social=server.source.channels.find(c=>c.type===0)!,support=server.source.channels.find(c=>c.type===15)!,movedCategory=String(BigInt(social.id)+8000n),unselected=String(BigInt(social.id)+9000n);
  await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,parent_id,channel_type,visibility_state,observed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${movedCategory},NULL,4,'VISIBLE',${f.end}),(${f.s.organizationId}::uuid,${f.s.guildId},${unselected},${movedCategory},0,'VISIBLE',${f.end})`.execute(db);await sql`UPDATE discord_surface_state SET parent_id=${movedCategory} WHERE ${tenant(f.s)} AND channel_id=${social.id}`.execute(db);
  const moved=await analysisChannelScope(db,f.s,cfg);expect(moved.actualChannelIds).toContain(social.id);expect(moved.resolutions.find(c=>c.actualChannelId===social.id)?.effectivePurpose).toBe("GENERAL_CONVERSATION");expect(moved.actualChannelIds).not.toContain(unselected);
  await sql`UPDATE discord_surface_state SET visibility_state='UNOBSERVABLE' WHERE ${tenant(f.s)} AND channel_id=${support.id}`.execute(db);const lost=await analysisChannelScope(db,f.s,cfg);expect(lost.actualChannelIds).not.toContain(support.id);expect(lost.actualChannelIds).not.toContain(String(BigInt(support.id)+5000n));
 }
});
