import {randomUUID} from "node:crypto";
import {afterAll,beforeAll,expect,it} from "vitest";
import {connect,migrate,sql,json,tenant,type Database} from "../../packages/db/src/index";
import {BOT_REPLY_REFERENCE_CONTRACT,MASS_MENTION_CONTRACT,SCHEDULED_EVENT_TIME_CONTRACT,dedupeKey,type Envelope} from "../../packages/events/src/index";
import {projectObservation} from "../../packages/lifecycle/src/observation";
import {projectLocationPost,projectStructure} from "../../packages/lifecycle/src/adaptive-projector";
import {analysisFixture,analysisVault} from "../fixtures/analysis";
import {scrubStoredPostReferences,sanitizeBotPostReference} from "../../packages/lifecycle/src/alpha16-reference-privacy";
import {acquireRuleScopeLocks,ruleScopeLockSet} from "../../packages/rules/src/locks";
import {LifecycleService} from "../../packages/lifecycle/src/index";
import {GatewayPublisher} from "../../apps/gateway/src/index";
import type {Redis} from "ioredis";
import {isolatedPostgres} from "../fixtures/postgres";
import {protocolHealth} from "../fixtures/alpha16-source-metadata";
// Prepared only. The future suite creates isolated infrastructure; no deployment
// database, real Discord packet, real user, API call or credential is consumed.
let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
beforeAll(async()=>{infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
async function fixture(){const f=await analysisFixture(db,"STARTER",false,{organizationId:randomUUID(),guildId:String(911168100000000000n+BigInt(++serial))}),start=new Date(Date.now()-600000);
 await sql`UPDATE location_population_collection SET introduced_at=${new Date(start.getTime()-1000)} WHERE ${tenant(f.s)}`.execute(db);
 await sql`UPDATE discord_integration_health SET last_gateway_at=NULL WHERE ${tenant(f.s)}`.execute(db);
 await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,observed_at,visibility_state,visibility_observed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${f.channel},0,${start},'VISIBLE',${start}) ON CONFLICT(organization_id,guild_id,channel_id) DO UPDATE SET visibility_state='VISIBLE',visibility_observed_at=EXCLUDED.visibility_observed_at`.execute(db);
 return {...f,start};}
it("starts only at actual protocol telemetry and resets on mixed versions, missing feature, disconnect or gap",async()=>{
 const f=await fixture(),at=(n:number)=>new Date(f.start.getTime()+n*1000);
 const read=async()=>(await sql<{started:Date|null;observed:Date|null;gateway:Date|null}>`SELECT c.bot_reference_started_at AS started,c.bot_reference_observed_at AS observed,h.last_gateway_at AS gateway FROM location_population_collection c JOIN discord_integration_health h USING(organization_id,guild_id) WHERE c.organization_id=${f.s.organizationId}::uuid AND c.guild_id=${f.s.guildId}`.execute(db)).rows[0]!;
 expect((await read()).started).toBeNull();
 await projectObservation(db,f.s,protocolHealth(f.s,at(0),1,{botReplyReferenceContract:undefined}));expect((await read()).started).toBeNull();
 await projectObservation(db,f.s,protocolHealth(f.s,at(30),2));expect((await read()).started).toEqual(at(30));
 await projectObservation(db,f.s,protocolHealth(f.s,at(60),3));expect(await read()).toEqual({started:at(30),observed:at(60),gateway:at(60)});
 await projectObservation(db,f.s,protocolHealth(f.s,at(90),4,{botReplyReferenceContract:undefined}));expect((await read()).started).toBeNull();
 await projectObservation(db,f.s,protocolHealth(f.s,at(120),5));
 await projectObservation(db,f.s,protocolHealth(f.s,at(60),6,{kind:"telemetry.disconnected"}));expect(await read()).toEqual({started:at(120),observed:at(120),gateway:at(120)});
 // Simulate an old projector updating only the existing health timestamp.
 await sql`UPDATE discord_integration_health SET last_gateway_at=${at(140)} WHERE ${tenant(f.s)}`.execute(db);
 expect((await read()).observed).not.toEqual((await read()).gateway);
 await projectObservation(db,f.s,protocolHealth(f.s,at(160),7));expect((await read()).started).toEqual(at(160));
 await projectObservation(db,f.s,protocolHealth(f.s,at(170),8,{kind:"telemetry.disconnected"}));expect((await read()).started).toBeNull();
 await projectObservation(db,f.s,protocolHealth(f.s,at(180),9,{kind:"telemetry.connected"}));expect((await read()).started).toEqual(at(180));
 await projectObservation(db,f.s,protocolHealth(f.s,at(200),10,{kind:"telemetry.gap",gapStart:at(190).toISOString()}));expect((await read()).started).toBeNull();
 await projectObservation(db,f.s,protocolHealth(f.s,at(210),11));expect((await read()).started).toEqual(at(210));
 await projectObservation(db,f.s,protocolHealth(f.s,at(400),12));expect((await read()).started).toEqual(at(400));
 // Full PostgreSQL precision must reject even a sub-millisecond old health.
 await sql`UPDATE discord_integration_health SET last_gateway_at=${at(400)}::timestamptz+interval '0.5 milliseconds' WHERE ${tenant(f.s)}`.execute(db);
 await projectObservation(db,f.s,protocolHealth(f.s,at(400),13,{kind:"telemetry.disconnected"}));expect((await read()).started).toEqual(at(400));
});
it("never retrofits a legacy projected post on retry, and keeps missing mass mentions NULL",async()=>{
 const f=await fixture(),cfg=await f.settings.get(f.s),base:Envelope={...protocolHealth(f.s,f.start,1),kind:"channel.post_observed",authorKind:"BOT",messageType:19,messageId:"922168100000000001",referenceId:"922168100000000002",channelId:f.channel,botReplyReferenceContract:undefined};
 await projectLocationPost(db,f.s,base,cfg,null);
 await projectLocationPost(db,f.s,{...base,botReplyReferenceContract:BOT_REPLY_REFERENCE_CONTRACT,massMentionContract:MASS_MENTION_CONTRACT,mentionEveryone:false,roleMentionCount:0},cfg,null);
 const read=(id:string)=>sql<{reference_contract_version:string|null;mention_everyone:boolean|null;role_mention_count:number|null;mention_contract_version:string|null;reference_id:string|null}>`SELECT reference_contract_version,mention_everyone,role_mention_count,mention_contract_version,reference_id FROM location_post_observations WHERE ${tenant(f.s)} AND message_id=${id}`.execute(db);
 expect((await read(base.messageId!)).rows[0]).toMatchObject({reference_contract_version:null,mention_everyone:null,role_mention_count:null,mention_contract_version:null});
 const fresh={...base,messageId:"922168100000000003",botReplyReferenceContract:BOT_REPLY_REFERENCE_CONTRACT,massMentionContract:MASS_MENTION_CONTRACT,mentionEveryone:true,roleMentionCount:2};
 await projectLocationPost(db,f.s,fresh,cfg,null);expect((await read(fresh.messageId)).rows[0]).toMatchObject({reference_contract_version:BOT_REPLY_REFERENCE_CONTRACT,reference_id:base.referenceId,mention_everyone:true,role_mention_count:2,mention_contract_version:MASS_MENTION_CONTRACT});
});
it("stores native scheduled metadata without relabelling activeSince and clears stale fields on a partial edit",async()=>{
 const f=await fixture(),cfg=await f.settings.get(f.s),eventId="922168100000000010",base:Envelope={...protocolHealth(f.s,f.start,1),kind:"scheduled_event.created",eventId,channelId:f.channel,entityType:2,eventStatus:1,scheduledStartAt:new Date(f.start.getTime()+86400000).toISOString(),scheduledEndAt:null,scheduledMetadataObservedAt:f.start.toISOString(),eventScheduleContract:SCHEDULED_EVENT_TIME_CONTRACT};
 const read=async()=>(await sql<{data:Record<string,unknown>}>`SELECT data FROM adaptive_states WHERE ${tenant(f.s)} AND domain='event' AND state_key=${eventId} AND subject_hash=''`.execute(db)).rows[0]!.data;
 await projectStructure(db,f.s,base,cfg);expect(await read()).toMatchObject({scheduledStartAt:base.scheduledStartAt,scheduledEndAt:null,scheduledMetadataObservedAt:base.scheduledMetadataObservedAt,eventScheduleContract:SCHEDULED_EVENT_TIME_CONTRACT,activeSince:null});
 const edited={...base,kind:"scheduled_event.updated" as const,at:new Date(f.start.getTime()+1000).toISOString(),scheduledStartAt:undefined,scheduledEndAt:undefined,scheduledMetadataObservedAt:undefined,eventScheduleContract:undefined};
 await projectStructure(db,f.s,edited,cfg);expect(await read()).toMatchObject({scheduledStartAt:null,scheduledEndAt:null,scheduledMetadataObservedAt:null,eventScheduleContract:null});
 await projectStructure(db,f.s,{...edited,kind:"scheduled_event.deleted",at:new Date(f.start.getTime()+2000).toISOString()},cfg);expect((await read()).status).toBe(4);
});
it("erases derived clocks through the 033 trigger/rebuild, flags surviving references and scrubs queued Bot copies",async()=>{
 const f=await fixture(),ownHash=f.actor.key,otherIdentity=await analysisVault.resolve(db,f.s,"933168100000000001"),otherHash=analysisVault.hash(f.s,"933168100000000001"),episode=randomUUID(),fact=randomUUID(),question="933168100000000002",ownedMessage="933168100000000003",ownedReply="933168100000000004",humanReference="933168100000000005",botReference="933168100000000006",starter="933168100000000007",pendingMessage="933168100000000008",pendingBot="933168100000000009";
 await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${episode}::uuid,${otherIdentity}::uuid,${new Date(f.start.getTime()-3600000)},'PRODUCTION')`.execute(db);
 await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data,definition_version) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${fact}::uuid,${episode}::uuid,'message.sent',${f.start},'PRODUCTION',${json({messageId:question,channelId:f.channel,receivedExplicitReply:true,receivedHumanParticipant:true,firstReplyLatencySeconds:60})},'observation-v3')`.execute(db);
 const insert=async(message:string,channel:string,at:Date,kind:"HUMAN"|"BOT",hash:string|null,reference:string|null,reply:number|null=null)=>sql`INSERT INTO location_post_observations(organization_id,guild_id,message_id,channel_id,sent_at,author_kind,subject_hash,reference_id,message_type,first_reply_seconds,reply_source,reference_contract_version) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${message},${channel},${at},${kind},${hash},${reference},${reference?19:0},${reply},${reply===null?null:"DIRECT"},${kind==="BOT"?BOT_REPLY_REFERENCE_CONTRACT:null})`.execute(db);
 await insert(question,f.channel,f.start,"HUMAN",otherHash,null,60);await insert(ownedMessage,f.channel,f.start,"HUMAN",ownHash,null);
 await insert(ownedReply,f.channel,new Date(f.start.getTime()+60000),"HUMAN",ownHash,question);
 await insert(humanReference,f.channel,new Date(f.start.getTime()+65000),"HUMAN",otherHash,ownedMessage);
 await insert(botReference,f.channel,new Date(f.start.getTime()+70000),"BOT",null,ownedMessage);
 await insert(starter,starter,f.start,"HUMAN",otherHash,null,90);await insert("933168100000000010",starter,new Date(f.start.getTime()+90000),"HUMAN",ownHash,null);
 const pending:Envelope={...f.s,shardId:0,gatewaySessionId:"pending-original",sequence:1,context:"PRODUCTION",kind:"message.sent",at:f.start.toISOString(),messageId:pendingMessage,channelId:f.channel};
 await sql`INSERT INTO gateway_ingest(organization_id,guild_id,dedupe_key,subject_hash,payload) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${dedupeKey(pending)},${ownHash},${json(pending)})`.execute(db);
 await insert(pendingBot,f.channel,new Date(f.start.getTime()+90000),"BOT",null,pendingMessage);
 const queued:Envelope={...pending,kind:"channel.post_observed",sequence:2,messageId:"933168100000000011",referenceId:ownedMessage,authorKind:"BOT",messageType:19,botReplyReferenceContract:BOT_REPLY_REFERENCE_CONTRACT};
 await sql`INSERT INTO gateway_ingest(organization_id,guild_id,dedupe_key,payload) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${dedupeKey(queued)},${json(queued)})`.execute(db);
 await db.transaction().execute(async tx=>{await acquireRuleScopeLocks(tx,ruleScopeLockSet(f.s));await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"privacy:"+f.s.organizationId+":"+f.s.guildId},0))`.execute(tx);await scrubStoredPostReferences(tx,f.s,ownHash);});
 const rows=(await sql<{message_id:string;reference_id:string|null;reference_contract_version:string|null;first_reply_seconds:number|null;reply_source:string|null;reply_provenance_erased:boolean}>`SELECT message_id,reference_id,reference_contract_version,first_reply_seconds,reply_source,reply_provenance_erased FROM location_post_observations WHERE ${tenant(f.s)}`.execute(db)).rows;
 for(const id of [question,starter])expect(rows.find(r=>r.message_id===id)).toMatchObject({first_reply_seconds:null,reply_source:null,reply_provenance_erased:true});
 for(const id of [humanReference,botReference,pendingBot])expect(rows.find(r=>r.message_id===id)).toMatchObject({reference_id:null,reference_contract_version:null,reply_provenance_erased:true});
 const data=(await sql<{data:Record<string,unknown>}>`SELECT data FROM lifecycle_events WHERE ${tenant(f.s)} AND id=${fact}::uuid`.execute(db)).rows[0]!.data;
 expect(data).toMatchObject({receivedExplicitReply:true,receivedHumanParticipant:true});expect(data).not.toHaveProperty("firstReplyLatencySeconds");
 await sql`SELECT nexus_rebuild_message_observations(${f.s.organizationId}::uuid,${f.s.guildId})`.execute(db);
 expect((await sql<{first_reply_seconds:number|null}>`SELECT first_reply_seconds FROM message_observations WHERE ${tenant(f.s)} AND fact_id=${fact}::uuid`.execute(db)).rows[0]!.first_reply_seconds).toBeNull();
 expect((await sql`SELECT 1 FROM gateway_ingest WHERE ${tenant(f.s)} AND payload->>'kind'='channel.post_observed' AND payload->>'referenceId' IS NOT NULL`.execute(db)).rows).toHaveLength(0);
 expect((await sql<{bot_reference_started_at:Date|null}>`SELECT bot_reference_started_at FROM location_population_collection WHERE ${tenant(f.s)}`.execute(db)).rows[0]!.bot_reference_started_at).toBeNull();
});
it("requires the same retained original or one unprojected typed original and rejects tombstones or orphan replays",async()=>{
 const f=await fixture(),hash=f.actor.key,parent="944168100000000001",base:Envelope={...f.s,shardId:0,gatewaySessionId:"privacy-source",sequence:1,context:"PRODUCTION",kind:"channel.post_observed",at:new Date(f.start.getTime()+60000).toISOString(),messageId:"944168100000000002",channelId:f.channel,messageType:19,referenceType:0,referenceId:parent,authorKind:"BOT",botReplyReferenceContract:BOT_REPLY_REFERENCE_CONTRACT};
 const sanitize=(e:Envelope)=>db.transaction().execute(tx=>sanitizeBotPostReference(tx,f.s,e));
 expect((await sanitize(base)).referenceId).toBeUndefined();
 await sql`INSERT INTO location_post_observations(organization_id,guild_id,message_id,channel_id,sent_at,author_kind,subject_hash,message_type) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${parent},${f.channel},${f.start},'HUMAN',${hash},0)`.execute(db);
 expect(await sanitize(base)).toBe(base);expect((await sanitize({...base,channelId:"944168100000000003"})).referenceId).toBeUndefined();
 const cfg=await f.settings.get(f.s);
 await sql`UPDATE location_post_observations SET sent_at=${new Date(Date.now()-(cfg.detailedRetentionDays+1)*86400000)} WHERE ${tenant(f.s)} AND message_id=${parent}`.execute(db);expect((await sanitize(base)).referenceId).toBeUndefined();
 await sql`UPDATE location_post_observations SET sent_at=${new Date(Date.parse(base.at)+1000)} WHERE ${tenant(f.s)} AND message_id=${parent}`.execute(db);expect((await sanitize(base)).referenceId).toBeUndefined();
 await sql`DELETE FROM location_post_observations WHERE ${tenant(f.s)} AND message_id=${parent}`.execute(db);
 const original={...base,kind:"message.sent" as const,sequence:2,messageId:parent,referenceId:undefined,at:f.start.toISOString(),authorKind:undefined};
 await sql`INSERT INTO gateway_ingest(organization_id,guild_id,dedupe_key,subject_hash,payload) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${dedupeKey(original)},${hash},${json(original)})`.execute(db);
 expect((await sanitize(base)).referenceId).toBe(parent);
 await sql`UPDATE gateway_ingest SET projected_at=now() WHERE ${tenant(f.s)} AND dedupe_key=${dedupeKey(original)}`.execute(db);expect((await sanitize(base)).referenceId).toBeUndefined();
 await sql`UPDATE gateway_ingest SET projected_at=NULL WHERE ${tenant(f.s)} AND dedupe_key=${dedupeKey(original)}`.execute(db);
 const erasedAt=new Date(Date.now()-1000);
 await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,lookup_hash,requested_at,completed_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${randomUUID()}::uuid,${hash},${erasedAt},${erasedAt})`.execute(db);
 expect((await sanitize(base)).botReplyReferenceContract).toBeUndefined();
 await projectObservation(db,f.s,protocolHealth(f.s,new Date(erasedAt.getTime()-1000),8));expect((await sql<{bot_reference_started_at:Date|null}>`SELECT bot_reference_started_at FROM location_population_collection WHERE ${tenant(f.s)}`.execute(db)).rows[0]!.bot_reference_started_at).toBeNull();
});
it("sanitizes both persisted/recovered Gateway copies and old Redis projection while retaining Bot post counts",async()=>{
 const f=await fixture(),event:Envelope={...f.s,shardId:0,gatewaySessionId:"old-redis-copy",sequence:1,context:"PRODUCTION",kind:"channel.post_observed",at:f.start.toISOString(),messageId:"955168100000000001",channelId:f.channel,messageType:19,referenceType:0,referenceId:"955168100000000002",authorKind:"BOT",botReplyReferenceContract:BOT_REPLY_REFERENCE_CONTRACT},published:Envelope[]=[];
 await sql`INSERT INTO gateway_ingest(organization_id,guild_id,dedupe_key,payload) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${dedupeKey(event)},${json(event)})`.execute(db);
 const fakeRedis={xadd:async(...args:unknown[])=>{published.push(JSON.parse(String(args[3])) as Envelope);return "fixture-id";}} as unknown as Redis;
 await new GatewayPublisher(fakeRedis,db,analysisVault).publish(event);expect(published).toHaveLength(1);expect(published[0]!.referenceId).toBeUndefined();expect(published[0]!.messageId).toBe(event.messageId);
 await new LifecycleService(db,analysisVault,f.settings,f.discord).process(event);
 const row=(await sql<{author_kind:string;reference_id:string|null;reference_contract_version:string|null}>`SELECT author_kind,reference_id,reference_contract_version FROM location_post_observations WHERE ${tenant(f.s)} AND message_id=${event.messageId!}`.execute(db)).rows[0];expect(row).toMatchObject({author_kind:"BOT",reference_id:null,reference_contract_version:null});
 // A post observation is not a channel structure update and must not replace
 // the saved actual channel type with an absent metadata field's fallback.
 const surface=(await sql<{channel_type:number;visibility_state:string}>`SELECT channel_type,visibility_state FROM discord_surface_state WHERE ${tenant(f.s)} AND channel_id=${f.channel}`.execute(db)).rows[0];expect(surface).toMatchObject({channel_type:0,visibility_state:"VISIBLE"});
 const stored=(await sql<{payload:Envelope}>`SELECT payload FROM gateway_ingest WHERE ${tenant(f.s)} AND dedupe_key=${dedupeKey(event)}`.execute(db)).rows[0]!.payload;expect(stored.referenceId).toBeUndefined();expect(stored.botReplyReferenceContract).toBeUndefined();
});
