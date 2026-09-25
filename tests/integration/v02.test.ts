import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Redis} from 'ioredis';
import {infrastructure} from '../fixtures/infrastructure.js';
import {connect,migrate,ensureGuild,sql,tenant,json,type Database} from '../../packages/db/src/index.js';
import {SettingsService,type Actor} from '../../packages/settings/src/index.js';
import {IdentityVault} from '../../packages/identity/src/index.js';
import {scopeForGuild} from '../../packages/security/src/index.js';
import {domainRevisions} from '../../packages/settings/src/domain-config.js';
import {type ConfigDomain} from '../../packages/settings/src/revisions.js';
import {LifecycleService} from '../../packages/lifecycle/src/index.js';
import {NativeMemberSnapshotWorker,projectNativeSnapshot} from '../../packages/lifecycle/src/native.js';
import {FakeDiscord} from '../fixtures/discord.js';
import {DiscordFailure} from '../../packages/discord/src/rest.js';
import {InterventionService} from '../../packages/lifecycle/src/interventions.js';
import {InterventionWorker} from '../../apps/worker/src/interventions.js';
import {ExperimentService} from '../../packages/lifecycle/src/experiments.js';
import {EntitlementService,recordUsage} from '../../packages/settings/src/entitlements.js';
import {PrivacyService} from '../../packages/security/src/privacy.js';
import {AnalyticsService} from '../../packages/analytics/src/index.js';
import {createApi} from '../../apps/api/src/server.js';
import {apiToken} from '../../packages/security/src/index.js';
import {normalize} from '../../packages/events/src/index.js';
import type {Scope} from '../../packages/shared/src/index.js';
import {DomainError} from '../../packages/shared/src/index.js';
import {GatewayPublisher,STREAM} from '../../apps/gateway/src/index.js';
import {StreamConsumer,scrubStream} from '../../apps/worker/src/streams.js';
import {PresentationService} from '../../packages/presentation/src/index.js';
import {CommunityService} from '../../packages/presentation/src/community.js';
import {WeeklySummaryWorker} from '../../apps/worker/src/weekly.js';
import {HelperWorker} from '../../apps/worker/src/helpers.js';
let infra:Awaited<ReturnType<typeof infrastructure>>,db:Database;const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32));
const user='922222222222222222',channel='933333333333333333';let counter=0;
const actor:Actor={key:'admin',permissions:'32',roles:[],source:'DISCORD_PANEL',requestId:'v02-test'};
beforeAll(async()=>{infra=await infrastructure();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
async function setup(){
 const s=scopeForGuild(String(911111111111111111n+BigInt(++counter)));await ensureGuild(db,s);const settings=new SettingsService(db),discord=new FakeDiscord();
 await settings.update(s,actor,0,{enabled:true,flags:{native_capability_v2:true,native_snapshot_v2:true,activation_dsl_v2:true,interventions_v2:true,experiments_v2:true,billing_v1:false}});
 await sql`INSERT INTO guild_subscriptions(organization_id,guild_id,plan_key) VALUES(${s.organizationId}::uuid,${s.guildId},'GROWTH')`.execute(db);
 const now=new Date();discord.members.set(user,{roles:[],permissions:'0',bot:false,joinedAt:now.toISOString(),flags:'106',pending:false});
 return {s,settings,discord,now,lifecycle:new LifecycleService(db,vault,settings,discord)};
}
async function publish(s:Scope,domain:ConfigDomain,definition:unknown){const revisions=domainRevisions(db),id=await revisions.draft(s,actor,domain,definition),preview=await revisions.preview(s,id);await revisions.publish(s,actor,id,preview.before?.id??null,preview.confirmationHash);return id;}
async function join(ctx:Awaited<ReturnType<typeof setup>>,joined=ctx.now){
 ctx.discord.members.get(user)!.joinedAt=joined.toISOString();await ctx.lifecycle.process({...ctx.s,shardId:0,gatewaySessionId:'test',sequence:1,kind:'member.joined',at:joined.toISOString(),joinedAt:joined.toISOString(),context:'PRODUCTION',encryptedUserId:vault.seal(ctx.s,user)});
 return (await sql<{id:string}>`SELECT id FROM membership_episodes WHERE ${tenant(ctx.s)}`.execute(db)).rows[0]!.id;
}
const intervention=(mode='suggest')=>({name:'Helper',trigger:'member.joined',delaySeconds:0,conditions:[],actions:[{type:'staff_alert',channelId:channel,text:'A newcomer may need help.'}],cooldownSeconds:86400,safetyMode:mode,frequencyCaps:{dmPerDay:1,contactsPerWeek:3}});
it('collects basic newcomer activity without configuring onboarding or a goal',async()=>{
 const ctx=await setup(),joined=new Date(Date.now()-60000);await join(ctx,joined);
 const asOf=new Date(Date.now()+1000),from=new Date(joined.getTime()-1000);
 await sql`INSERT INTO telemetry_cursor VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${from},${asOf})`.execute(db);
 const metrics=await new AnalyticsService(db,ctx.settings).canonical(ctx.s,from,asOf,asOf);
 expect(metrics.new_members.value).toBe(1);expect(metrics.activation_rate.value).toBeNull();expect(metrics.onboarding_completion.value).toBeNull();
});
it('preserves anonymous mature D30 denominators after personal deletion and counts activity once',async()=>{
 const ctx=await setup(),day=86400000,joined=new Date(Date.now()-35*day),episode=await join(ctx,joined);
 await sql`UPDATE retention_tracking SET started_at=${new Date(Date.now()-65*day)} WHERE ${tenant(ctx.s)}`.execute(db);
 await sql`INSERT INTO telemetry_cursor VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${new Date(Date.now()-65*day)},now())`.execute(db);
 for(let i=0;i<2;i++)await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'reaction.added',${new Date(joined.getTime()+30*day+i)},'PRODUCTION','{}')`.execute(db);
 const analytics=new AnalyticsService(db,ctx.settings);expect(await analytics.matureD30(ctx.s)).toMatchObject({value:1,numerator:1,denominator:1});
 await new PrivacyService(db,vault,ctx.settings).delete(ctx.s,user,{...actor,key:vault.hash(ctx.s,user)});
 expect((await sql`SELECT * FROM episode_retention WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(0);
 expect(await analytics.matureD30(ctx.s)).toMatchObject({value:1,numerator:1,denominator:1});
 await sql`UPDATE retention_tracking SET started_at=now() WHERE ${tenant(ctx.s)}`.execute(db);
 expect((await analytics.matureD30(ctx.s)).value).toBeNull();
});
it('publishes immutable revisions, rejects stale heads and rolls back by copying',async()=>{
 const {s}=await setup(),r=domainRevisions(db),definition={name:'Reply',windowSeconds:604800,rule:{op:'reply_received',withinSeconds:604800}};
 const first=await publish(s,'activation',definition);await expect(sql`UPDATE guild_config_revisions SET hash='changed' WHERE ${tenant(s)} AND id=${first}::uuid`.execute(db)).rejects.toThrow('immutable');
 const a=await r.draft(s,actor,'activation',definition),b=await r.draft(s,actor,'activation',definition),ap=await r.preview(s,a),bp=await r.preview(s,b);
 const updates=await Promise.allSettled([r.publish(s,actor,a,first,ap.confirmationHash),r.publish(s,actor,b,first,bp.confirmationHash)]);expect(updates.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const copy=await r.rollback(s,actor,first);expect(copy).not.toBe(first);expect((await r.get(s,copy)).state).toBe('draft');
});
it('schedules five checkpoints and projects first-observed timestamps without invented completion time',async()=>{
 const ctx=await setup(),episode=await join(ctx);expect((await sql`SELECT * FROM native_snapshot_jobs WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(5);
 const worker=new NativeMemberSnapshotWorker(db,vault,ctx.discord);expect(await worker.tick(ctx.s)).toBe(true);
 const state=(await sql<Record<string,unknown>>`SELECT * FROM native_lifecycle_state WHERE ${tenant(ctx.s)}`.execute(db)).rows[0]!;
 expect(state.native_onboarding_first_observed_completed_at).toBeInstanceOf(Date);expect(state).not.toHaveProperty('completed_at');
 const earlier=new Date(ctx.now.getTime()-1000);await db.transaction().execute(tx=>projectNativeSnapshot(tx,ctx.s,episode,106n,false,earlier));
 const events=(await sql`SELECT * FROM lifecycle_events WHERE ${tenant(ctx.s)} AND kind='native_onboarding.observed_completed'`.execute(db)).rows;expect(events).toHaveLength(1);
});
it('pins activation versions and never changes the past when a new definition is published',async()=>{
 const ctx=await setup();const id=await publish(ctx.s,'activation',{name:'Message',windowSeconds:604800,rule:{op:'event',event:'message.sent',withinSeconds:604800}});
 const joined=new Date(Date.now()+10),episode=await join(ctx,joined);
 await ctx.lifecycle.process(normalize({t:'MESSAGE_CREATE',s:2,d:{guild_id:ctx.s.guildId,id:'944444444444444444',channel_id:channel,author:{id:user},timestamp:new Date(joined.getTime()+1000).toISOString(),type:0,content:'never store'}},0,'test',vault)!);
 const activated=(await sql<{data:{definitionId:string}}>`SELECT data FROM lifecycle_events WHERE ${tenant(ctx.s)} AND kind='activation.completed'`.execute(db)).rows;expect(activated[0]?.data.definitionId).toBe(id);
 await publish(ctx.s,'activation',{name:'Reply',windowSeconds:604800,rule:{op:'reply_received',withinSeconds:604800}});
 expect((await sql<{revision_id:string}>`SELECT revision_id FROM activation_members WHERE ${tenant(ctx.s)} AND episode_id=${episode}::uuid`.execute(db)).rows[0]?.revision_id).toBe(id);
});
it('does not expose assignments until an approved action succeeds, and preserves holdouts',async()=>{
 const ctx=await setup(),episode=await join(ctx),interventionId=await publish(ctx.s,'intervention',intervention('approval'));
 const expId=await publish(ctx.s,'experiment',{name:'Delivery accounting',eligibility:[],randomization:'member',blockSeconds:86400,variants:[{key:'control',weight:1,interventionRevisionId:interventionId},{key:'treatment',weight:1,interventionRevisionId:interventionId}],primaryMetric:'activation',windowSeconds:3600,minimumSample:20,guardrails:{maxLeaveRate:.3,maxFailureRate:.1,maxAlerts:100}});
 const experiments=new ExperimentService(db),assignment=await experiments.assign(ctx.s,expId,episode);expect(assignment).toBeTruthy();expect(await experiments.assign(ctx.s,expId,episode)).toEqual(assignment);
 await expect(sql`UPDATE experiment_assignments SET variant='other' WHERE ${tenant(ctx.s)}`.execute(db)).rejects.toThrow('immutable');
 const run=await new InterventionService(db).propose(ctx.s,interventionId,episode,assignment!.id);expect(run?.state).toBe('approval');
 expect((await sql`SELECT * FROM experiment_exposures WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(0);
 const worker=new InterventionWorker(db,vault,ctx.discord);expect(await worker.tick(ctx.s)).toBe(false);
 await new InterventionService(db).approve(ctx.s,actor,run!.id);await worker.tick(ctx.s);
 expect((await sql`SELECT * FROM experiment_exposures WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(1);
 expect((await experiments.result(ctx.s,expId)).evidenceStatus).toBe('INSUFFICIENT_DATA');
 // A separate no-action assignment is never queued for delivery.
 const holdoutId=await publish(ctx.s,'experiment',{name:'Control',eligibility:[],randomization:'member',blockSeconds:86400,variants:[{key:'control',weight:100,interventionRevisionId:null},{key:'treatment',weight:1,interventionRevisionId:null}],primaryMetric:'activation',windowSeconds:3600,minimumSample:20,guardrails:{maxLeaveRate:.3,maxFailureRate:.1,maxAlerts:100}});
 expect(await experiments.deliverAssigned(ctx.s,holdoutId,episode)).toMatchObject({holdout:true});
});
it('suppresses bot-origin triggers, enforces cooldown and does not invent exposure on delivery failure',async()=>{
 const ctx=await setup(),episode=await join(ctx),id=await publish(ctx.s,'intervention',intervention('auto')),service=new InterventionService(db);
 expect(await service.propose(ctx.s,id,episode,null,'bot')).toBeNull();const run=await service.propose(ctx.s,id,episode);expect(run?.state).toBe('queued');expect(await service.propose(ctx.s,id,episode)).toBeNull();
 ctx.discord.failure=new DiscordFailure(403);await new InterventionWorker(db,vault,ctx.discord).tick(ctx.s);
 expect((await sql`SELECT * FROM experiment_exposures WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(0);
 expect((await sql<{state:string}>`SELECT state FROM intervention_runs WHERE ${tenant(ctx.s)}`.execute(db)).rows[0]!.state).toBe('suppressed');
});
it('enforces DM off even for auto and rejects unauthorized approvals',async()=>{
 const ctx=await setup(),episode=await join(ctx),id=await publish(ctx.s,'intervention',{...intervention('auto'),actions:[{type:'send_dm',text:'Hello'}]});
 const service=new InterventionService(db),run=await service.propose(ctx.s,id,episode);expect(run).toMatchObject({state:'suppressed',reason:'DM_DISABLED'});
 await expect(service.approve(ctx.s,{...actor,permissions:'0'},run!.id)).rejects.toThrow('ADMIN_REQUIRED');
});
it('deduplicates MTM across replays and gates free plans independently of price',async()=>{
 const ctx=await setup();const hash=vault.hash(ctx.s,user);await Promise.all(Array.from({length:10},()=>recordUsage(db,ctx.s,hash,new Date())));
 expect((await new EntitlementService(db).usage(ctx.s)).used).toBe(1);
 await sql`UPDATE guild_subscriptions SET plan_key='FREE' WHERE ${tenant(ctx.s)}`.execute(db);
 expect(await new EntitlementService(db).can(ctx.s,'experiments')).toBe(false);expect(await new EntitlementService(db).can(ctx.s,'fallback_onboarding')).toBe(true);
});
it('cascades member deletion through snapshots, assignments, interventions and usage',async()=>{
 const ctx=await setup(),episode=await join(ctx),id=await publish(ctx.s,'intervention',intervention());await new InterventionService(db).propose(ctx.s,id,episode);await new NativeMemberSnapshotWorker(db,vault,ctx.discord).tick(ctx.s);
 const privacy=new PrivacyService(db,vault,ctx.settings);await privacy.delete(ctx.s,user,{...actor,key:vault.hash(ctx.s,user)});
 for(const table of ['native_member_snapshots','native_snapshot_jobs','intervention_runs','usage_counters'])expect((await sql`SELECT * FROM ${sql.table(table)} WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(0);
 await privacy.delete(ctx.s,user,{...actor,key:vault.hash(ctx.s,user)},true);expect((await sql`SELECT * FROM guild_config_revisions WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(0);
});
it('purges detail at 30 days without a destructive database reset',async()=>{
 const ctx=await setup();await join(ctx,new Date(Date.now()-31*86400000));await new PrivacyService(db,vault,ctx.settings).purge(ctx.s);
 expect((await sql`SELECT * FROM lifecycle_events WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(0);
 expect((await sql`SELECT * FROM membership_episodes WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(1);
 await sql`UPDATE membership_episodes SET left_at=joined_at WHERE ${tenant(ctx.s)}`.execute(db);await new PrivacyService(db,vault,ctx.settings).purge(ctx.s);
 expect((await sql`SELECT * FROM membership_episodes WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(0);expect((await sql`SELECT * FROM guilds WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(1);
});
it('exposes only scoped v2 data and validates configuration mutations',async()=>{
 const ctx=await setup(),key='v02-test-api-key',api=createApi(new AnalyticsService(db,ctx.settings),key,db),base=`/v2/organizations/${ctx.s.organizationId}/guilds/${ctx.s.guildId}`;
 const headers={authorization:`Bearer ${apiToken(key,ctx.s)}`};
 const result=await api.inject({url:base+'/dashboard',headers});expect(result.statusCode).toBe(200);expect(result.json().metrics.new_members.value).toBeNull();expect(result.body).not.toContain(user);
 expect((await api.inject({method:'POST',url:base+'/configuration',headers,payload:{action:'draft',domain:'activation',definition:{sql:'SELECT *'}}})).statusCode).toBe(400);
 const response=await api.inject({method:'POST',url:base+'/configuration',headers,payload:{action:'draft',domain:'activation',definition:{name:'Event',windowSeconds:604800,rule:{op:'scheduled_event_subscribed',withinSeconds:604800}}}});expect(response.statusCode).toBe(200);expect(response.json().confirmationHash).toBeTruthy();
 await api.close();
});
it('preserves v0.1 settings and pins existing questionnaires to fallback during additive migration',async()=>{
 await sql`CREATE DATABASE v01_backfill`.execute(db);const url=new URL(infra.databaseUrl);url.pathname='/v01_backfill';const old=connect(url.toString());
 try{
  await sql`CREATE TABLE schema_migrations(version integer PRIMARY KEY)`.execute(old);
  for(const [i,name] of ['001_foundation','002_runtime','003_telemetry','004_lifecycle'].entries()){await sql.raw(await readFile(new URL(`../../migrations/${name}.sql`,import.meta.url),'utf8')).execute(old);await sql`INSERT INTO schema_migrations VALUES(${i+1})`.execute(old);}
  const s=scopeForGuild('966666666666666666');await ensureGuild(old,s);
  await sql`INSERT INTO guild_settings VALUES(${s.organizationId}::uuid,${s.guildId},7,'{"enabled":true,"onboardingEnabled":true,"flowVersionId":"00000000-0000-4000-8000-000000000001","startChannelId":"933333333333333333"}'::jsonb)`.execute(old);
  await migrate(old);const settings=await new SettingsService(old).get(s);expect(settings).toMatchObject({revision:7,enabled:true,onboardingEnabled:true,onboardingMode:'fallback',flowVersionId:'00000000-0000-4000-8000-000000000001'});await migrate(old);
 }finally{await old.destroy();}
});
it('recovers sanitized PostgreSQL ingest after Redis failure and erases queued member data',async()=>{
 const ctx=await setup();const redis=new Redis(infra.redisUrl,{maxRetriesPerRequest:0,enableOfflineQueue:false,lazyConnect:true,retryStrategy:()=>null});redis.on('error',()=>{});await redis.connect();
 const publisher=new GatewayPublisher(redis,db,vault),consumer=new StreamConsumer(redis,ctx.lifecycle,'v02-durable',0);await consumer.init();
 const event=normalize({t:'GUILD_MEMBER_ADD',s:1,d:{guild_id:ctx.s.guildId,user:{id:user},joined_at:ctx.now.toISOString(),content:'SECRET'}},0,'durable',vault)!;
 await new Promise<void>(resolve=>{redis.once('end',resolve);redis.disconnect();});
 await expect(publisher.publish(event)).rejects.toThrow('stream unavailable');
 const pending=(await sql<{payload:unknown}>`SELECT payload FROM gateway_ingest WHERE ${tenant(ctx.s)} AND projected_at IS NULL`.execute(db)).rows;expect(pending).toHaveLength(1);expect(JSON.stringify(pending)).not.toContain('SECRET');expect(JSON.stringify(pending)).not.toContain(user);
 await redis.connect();expect(await publisher.recover()).toBe(1);await consumer.tick();
 expect((await sql`SELECT dedupe_key FROM gateway_ingest WHERE ${tenant(ctx.s)} AND projected_at IS NOT NULL`.execute(db)).rows).toHaveLength(1);
 const privacy=new PrivacyService(db,vault,ctx.settings,(s,hash)=>scrubStream(redis,vault,s,hash));await privacy.delete(ctx.s,user,{...actor,key:vault.hash(ctx.s,user)});
 expect((await redis.xrange(STREAM,'-','+')).filter(([,fields])=>fields.join('').includes(ctx.s.guildId))).toHaveLength(0);
 await publisher.publish(event);expect((await sql`SELECT dedupe_key FROM gateway_ingest WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(0);await redis.quit();
});
it('enforces weekly contact caps across concurrently approved revisions',async()=>{
 const ctx=await setup(),episode=await join(ctx),service=new InterventionService(db),runs:string[]=[];
 for(let i=0;i<4;i++){const revision=await publish(ctx.s,'intervention',{...intervention('approval'),name:`Helper ${i}`});const run=await service.propose(ctx.s,revision,episode);runs.push(run!.id);}
 for(const id of runs)await service.approve(ctx.s,actor,id);
 const worker=new InterventionWorker(db,vault,ctx.discord);await Promise.all(runs.map(run=>worker.tick(ctx.s,run)));
 expect(ctx.discord.calls.filter(c=>c==='sendPanel').length).toBeLessThanOrEqual(3);
 expect((await sql`SELECT id FROM intervention_runs WHERE ${tenant(ctx.s)} AND state='suppressed'`.execute(db)).rows.length).toBeGreaterThanOrEqual(1);
});
it('stops experiments without changing existing assignment and rejects restart after stop',async()=>{
 const ctx=await setup(),episode=await join(ctx),id=await publish(ctx.s,'experiment',{name:'Stop test',eligibility:[],randomization:'time_block',blockSeconds:86400,variants:[{key:'control',weight:50,interventionRevisionId:null},{key:'treatment',weight:50,interventionRevisionId:null}],primaryMetric:'activation',windowSeconds:3600,minimumSample:20,guardrails:{maxLeaveRate:.3,maxFailureRate:.1,maxAlerts:100}});
 const service=new ExperimentService(db),assignment=await service.assign(ctx.s,id,episode);await service.control(ctx.s,actor,id,'stopped');expect(await service.assign(ctx.s,id,episode)).toBeNull();
 expect((await sql<{id:string}>`SELECT id FROM experiment_assignments WHERE ${tenant(ctx.s)}`.execute(db)).rows[0]?.id).toBe(assignment!.id);await expect(service.control(ctx.s,actor,id,'running')).rejects.toThrow('STOPPED_EXPERIMENT_IMMUTABLE');
});
it('builds first-reply distribution from one mature first message per newcomer',async()=>{
 const ctx=await setup(),now=new Date('2026-06-20T12:00:00.000Z'),day=86400000,joined=new Date(now.getTime()-3*day),episode=await join(ctx,joined);
 await sql`INSERT INTO lifecycle_events VALUES
  (${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',${new Date(joined.getTime()+3600000)},'PRODUCTION',${json({messageId:'700000000000000001',channelId:channel,firstReplyLatencySeconds:600})}),
  (${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',${new Date(joined.getTime()+7200000)},'PRODUCTION',${json({messageId:'700000000000000002',channelId:channel})})`.execute(db);
 const recentIdentity=await vault.resolve(db,ctx.s,'922222222222222223'),recentEpisode=randomUUID(),recentJoin=new Date(now.getTime()-12*3600000);
 await sql`INSERT INTO membership_episodes VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${recentEpisode}::uuid,${recentIdentity}::uuid,${recentJoin},NULL,'PRODUCTION')`.execute(db);
 await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${recentEpisode}::uuid,'message.sent',${new Date(recentJoin.getTime()+60000)},'PRODUCTION',${json({messageId:'700000000000000003',channelId:channel})})`.execute(db);
 const distribution=(await new PresentationService(db).journey(ctx.s,7,now)).firstReplyDistribution;
 expect(distribution.find(bucket=>bucket.bucket==='5m_1h')).toMatchObject({count:1,rate:1});
 expect(distribution.find(bucket=>bucket.bucket==='unanswered_24h')).toMatchObject({count:0,rate:0});
 expect(distribution.reduce((sum,bucket)=>sum+(bucket.count??0),0)).toBe(1);
});
it('keeps retention unavailable across telemetry gaps and preserves D30 right censoring',async()=>{
 const ctx=await setup(),now=new Date('2026-06-20T12:00:00.000Z'),day=86400000,joined=new Date('2026-06-10T12:00:00.000Z'),episode=await join(ctx,joined),cohort=joined.toISOString().slice(0,10);
 await sql`INSERT INTO telemetry_cursor VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${new Date('2026-06-01T00:00:00.000Z')},${now})`.execute(db);
 await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'reaction.added',${new Date(joined.getTime()+7*day+3600000)},'PRODUCTION',${json({channelId:channel,messageId:'700000000000000004'})})`.execute(db);
 await sql`INSERT INTO telemetry_health VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${new Date('2026-06-17T06:00:00.000Z')},${new Date('2026-06-17T18:00:00.000Z')},'test gap')`.execute(db);
 const row=(await new PresentationService(db).journey(ctx.s,30,now)).retention.find(item=>item.cohort===cohort)!;
 expect(row).toMatchObject({d7:null,d30:null,maturity:{d7:'unavailable',d30:'provisional'}});
 expect(row.coverage.status).not.toBe('healthy');
 expect(row.coverage.notes).toContain('retention_gap');
});
it('derives Native, fallback and hybrid onboarding readiness from settings and capabilities',async()=>{
 const modes=[
  {mode:'native' as const,native:true,patch:{onboardingMode:'native' as const}},
  {mode:'fallback' as const,native:false,patch:{onboardingMode:'fallback' as const,startChannelId:channel,flowVersionId:randomUUID()}},
  {mode:'hybrid' as const,native:true,patch:{onboardingMode:'hybrid' as const,startChannelId:channel,hybrid:{enabled:true,flowVersionId:randomUUID(),trigger:'after_native_onboarding_observed' as const,nativePromptMappings:{}}}}
 ];
 for(const item of modes){
  const ctx=await setup(),cfg=await ctx.settings.get(ctx.s),now=new Date();await ctx.settings.update(ctx.s,actor,cfg.revision,item.patch);
  await sql`INSERT INTO guild_capabilities VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${json({coverage:'healthy',sendMessages:true,manageRoles:true,nativeOnboardingEnabled:item.native,recommendedMode:item.native?'native':'fallback'})},${now})`.execute(db);
  await sql`INSERT INTO telemetry_cursor VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${new Date(now.getTime()-86400000)},${now})`.execute(db);
  const onboarding=(await new PresentationService(db).home(ctx.s,now)).setup.steps.find(step=>step.key==='onboarding');expect(onboarding,item.mode).toMatchObject({complete:true,reason:'ready'});
 }
});
it('serves 7D, 30D and 90D Journey ranges and creates a test from a published Action',async()=>{
 const ctx=await setup(),actionId=await publish(ctx.s,'intervention',intervention('approval')),key='v03-test-api-key',api=createApi(new AnalyticsService(db,ctx.settings),key,db),base=`/v3/organizations/${ctx.s.organizationId}/guilds/${ctx.s.guildId}`,headers={authorization:`Bearer ${apiToken(key,ctx.s)}`};
 for(const range of [7,30,90]){const response=await api.inject({url:`${base}/journey?range=${range}`,headers});expect(response.statusCode).toBe(200);expect(response.json().range).toBe(range);}
 const tooSmall=await api.inject({method:'POST',url:base+'/results/draft',headers,payload:{actionId,primaryMetric:'activation'}});expect(tooSmall.statusCode).toBe(400);
 const goalId=await publish(ctx.s,'activation',{name:'First message',windowSeconds:604800,rule:{op:'event',event:'message.sent',withinSeconds:604800}}),joined=new Date(Date.now()-10*86400000),now=new Date();
 await sql`INSERT INTO telemetry_cursor VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${new Date(now.getTime()-32*86400000)},${now})`.execute(db);
 for(let i=0;i<40;i++){const id=await vault.resolve(db,ctx.s,String(940000000000000000n+BigInt(i))),episode=randomUUID();await sql`INSERT INTO membership_episodes VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${episode}::uuid,${id}::uuid,${joined},NULL,'PRODUCTION')`.execute(db);await sql`INSERT INTO activation_members VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${episode}::uuid,${goalId}::uuid,${new Date(joined.getTime()+60000)})`.execute(db);await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'activation.completed',${new Date(joined.getTime()+60000)},'PRODUCTION',${json({definitionId:goalId})}),(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',${new Date(joined.getTime()+60000)},'PRODUCTION',${json({messageId:String(950000000000000000n+BigInt(i)),channelId:channel})})`.execute(db);}
 const draft=await api.inject({method:'POST',url:base+'/results/draft',headers,payload:{actionId,primaryMetric:'activation'}});expect(draft.statusCode).toBe(200);const preview=draft.json();expect(preview.after.definition).toMatchObject({randomization:'time_block',variants:[{key:'control',interventionRevisionId:null},{key:'treatment',interventionRevisionId:actionId}]});
 const publishResponse=await api.inject({method:'POST',url:`/v2/organizations/${ctx.s.organizationId}/guilds/${ctx.s.guildId}/configuration`,headers,payload:{action:'publish',id:preview.after.id,expectedHead:null,confirmationHash:preview.confirmationHash}});expect(publishResponse.statusCode).toBe(200);
 const results=await api.inject({url:base+'/results',headers});expect(results.statusCode).toBe(200);expect(results.json().items[0]).toMatchObject({randomization:'time_block',analysis:'intention_to_treat',state:'running'});await api.close();
});
it('rechecks selected channels and events before enabling an improvement',async()=>{
 const ctx=await setup(),key='v04-permissions',events=[{id:'833333333333333333',label:'Community call'}];
 const port=Object.assign(ctx.discord,{options:async()=>({channels:[{id:channel,label:'#helpers'}],roles:[],events})});
 const api=createApi(new AnalyticsService(db,ctx.settings),key,db,port),base=`/v3/organizations/${ctx.s.organizationId}/guilds/${ctx.s.guildId}`,headers={authorization:`Bearer ${apiToken(key,ctx.s)}`};
 ctx.discord.failure=new DomainError('CHANNEL_PERMISSION_MISSING');
 const blocked=await api.inject({method:'POST',url:base+'/actions/draft',headers,payload:{templateKey:'reply_rescue',channelId:channel}});
 expect(blocked.statusCode).not.toBe(200);
 ctx.discord.failure=null;
 const draft=await api.inject({method:'POST',url:base+'/actions/draft',headers,payload:{templateKey:'reply_rescue',channelId:channel}});expect(draft.statusCode).toBe(200);
 ctx.discord.failure=new DomainError('CHANNEL_PERMISSION_MISSING');
 const preview=draft.json(),deleted=await api.inject({method:'POST',url:`/v2/organizations/${ctx.s.organizationId}/guilds/${ctx.s.guildId}/configuration`,headers,payload:{action:'publish',id:preview.after.id,expectedHead:null,confirmationHash:preview.confirmationHash}});
 expect(deleted.json().error).toBe('CHANNEL_PERMISSION_MISSING');
 ctx.discord.failure=null;
 const eventDraft=await api.inject({method:'POST',url:base+'/actions/draft',headers,payload:{templateKey:'event_recommendation',channelId:channel,eventId:events[0]!.id}});expect(eventDraft.statusCode).toBe(200);
 events.length=0;const eventPreview=eventDraft.json(),removed=await api.inject({method:'POST',url:`/v2/organizations/${ctx.s.organizationId}/guilds/${ctx.s.guildId}/configuration`,headers,payload:{action:'publish',id:eventPreview.after.id,expectedHead:null,confirmationHash:eventPreview.confirmationHash}});
 expect(removed.json().error).toBe('EVENT_NOT_AVAILABLE');
 const original=await ctx.settings.get(ctx.s);
 ctx.discord.failure=new DomainError('CHANNEL_PERMISSION_MISSING');
 const invalidDestination=await api.inject({method:'POST',url:base+'/settings/notification',headers,payload:{channelId:channel,revision:original.revision}});expect(invalidDestination.statusCode).not.toBe(200);
 ctx.discord.failure=null;
 const destination=await api.inject({method:'POST',url:base+'/settings/notification',headers,payload:{channelId:channel,revision:original.revision}});expect(destination.statusCode).toBe(200);expect(destination.json().adminNotificationChannelId).toBe(channel);
 const retention=await api.inject({method:'POST',url:base+'/settings/retention',headers,payload:{days:14,revision:destination.json().revision}});expect(retention.statusCode).toBe(200);expect(retention.json().detailedRetentionDays).toBe(14);
 await api.close();
});
it('keeps measurement warnings separate from ranked community opportunities',async()=>{
 const ctx=await setup(),home=await new PresentationService(db).home(ctx.s);
 expect(home.communityOpportunity).toBeNull();expect(home.measurementWarning).toMatchObject({stage:'data',reason:'measurement_coverage'});
 const opportunities=await new PresentationService(db).opportunities(ctx.s);expect(opportunities.items).toEqual([]);expect(opportunities.measurementWarnings[0]).toMatchObject({stage:'data'});
});
it('aggregates newcomer channel activity without returning member records or message text',async()=>{
 const ctx=await setup(),goalId=await publish(ctx.s,'activation',{name:'First message',windowSeconds:86400,rule:{op:'event',event:'message.sent',withinSeconds:86400}}),joined=new Date(Date.now()-3*86400000);
 for(let i=0;i<3;i++){const identity=await vault.resolve(db,ctx.s,String(960000000000000000n+BigInt(i))),episode=randomUUID(),first=new Date(joined.getTime()+60000);await sql`INSERT INTO membership_episodes VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${episode}::uuid,${identity}::uuid,${joined},NULL,'PRODUCTION')`.execute(db);await sql`INSERT INTO activation_members VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${episode}::uuid,${goalId}::uuid,${first})`.execute(db);for(const [kind,data] of [['message.sent',{messageId:String(970000000000000000n+BigInt(i)),channelId:channel}],['reply.received',{latencySeconds:60,channelId:channel}],['activation.completed',{definitionId:goalId}]] as const)await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,${kind},${first},'PRODUCTION',${json(data)})`.execute(db);}
 const view=await new PresentationService(db).journey(ctx.s,7);expect(view.channels).toMatchObject([{channelId:channel,firstMessages:3,firstReplies:3,firstSuccesses:3,goalEligible:3,goalCompleted:3}]);expect(JSON.stringify(view.channels)).not.toContain('episodeId');
});
it('validates each improvement and sends a fully isolated setup test',async()=>{
 const ctx=await setup(),key='v05-test-notification',api=createApi(new AnalyticsService(db,ctx.settings),key,db,ctx.discord),base=`/v3/organizations/${ctx.s.organizationId}/guilds/${ctx.s.guildId}`,headers={authorization:`Bearer ${apiToken(key,ctx.s)}`},input={templateKey:'reply_rescue',channelId:channel};
 ctx.discord.failure=new DomainError('CHANNEL_PERMISSION_MISSING');const denied=await api.inject({method:'POST',url:base+'/actions/preflight',headers,payload:input});expect(denied.json().status).toBe('permission_needed');ctx.discord.failure=null;
 const ready=await api.inject({method:'POST',url:base+'/actions/preflight',headers,payload:input});expect(ready.json().status).toBe('ready');
 const sent=await api.inject({method:'POST',url:base+'/actions/test',headers,payload:input});expect(sent.json()).toMatchObject({status:'sent',context:'TEST'});expect(ctx.discord.calls.filter(call=>call==='sendPanel')).toHaveLength(1);
 expect(JSON.stringify([...ctx.discord.panels.values()][0])).toContain('[TEST]');
 for(const table of ['intervention_runs','experiment_assignments','lifecycle_events','membership_episodes'])expect((await sql`SELECT 1 FROM ${sql.table(table)} WHERE ${tenant(ctx.s)}`.execute(db)).rows,table).toHaveLength(0);
 await api.close();
});
it('sends one concise optional weekly summary and never duplicates its delivery',async()=>{
 const ctx=await setup(),cfg=await ctx.settings.get(ctx.s);await ctx.settings.update(ctx.s,actor,cfg.revision,{weeklySummaryEnabled:true,weeklySummaryChannelId:channel});
 const worker=new WeeklySummaryWorker(db,ctx.discord);expect(await worker.tick(ctx.s,new Date('2026-09-24T12:00:00.000Z'))).toBe(true);expect(await worker.tick(ctx.s,new Date('2026-09-24T12:00:00.000Z'))).toBe(false);
 expect(ctx.discord.calls.filter(call=>call==='sendPanel')).toHaveLength(1);
 const content=JSON.stringify([...ctx.discord.panels.values()][0]);expect(content).toContain('Weekly growth summary');expect(content).toContain('View improvement');
 expect((await sql`SELECT state FROM weekly_summary_deliveries WHERE ${tenant(ctx.s)}`.execute(db)).rows).toMatchObject([{state:'sent'}]);
});
it('records optional suggestion feedback without member identifiers',async()=>{
 const ctx=await setup(),key='v05-feedback',api=createApi(new AnalyticsService(db,ctx.settings),key,db,ctx.discord),base=`/v3/organizations/${ctx.s.organizationId}/guilds/${ctx.s.guildId}`,headers={authorization:`Bearer ${apiToken(key,ctx.s)}`};
 const result=await api.inject({method:'POST',url:base+'/opportunities/dismiss',headers,payload:{suggestionType:'CONNECTION_DROP',reason:'already_handled'}});expect(result.statusCode).toBe(200);
 const rows=(await sql<{suggestion_type:string;reason:string}>`SELECT suggestion_type,reason FROM suggestion_feedback WHERE ${tenant(ctx.s)}`.execute(db)).rows;expect(rows).toEqual([{suggestion_type:'CONNECTION_DROP',reason:'already_handled'}]);
 expect((await sql`SELECT 1 FROM membership_episodes WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(0);
 await api.close();
});
it('shows administrator setting changes without exposing saved configuration values',async()=>{
 const ctx=await setup(),cfg=await ctx.settings.get(ctx.s),who='922222222222222224';
 await ctx.settings.update(ctx.s,{...actor,key:vault.hash(ctx.s,who),encryptedUserId:vault.seal(ctx.s,who)},cfg.revision,{analysisScope:{mode:'include',channelIds:[channel]}});
 const key='v052-audit',api=createApi(new AnalyticsService(db,ctx.settings),key,db,ctx.discord,undefined,vault),base=`/v3/organizations/${ctx.s.organizationId}/guilds/${ctx.s.guildId}`;
 const reply=await api.inject({method:'GET',url:base+'/audit',headers:{authorization:`Bearer ${apiToken(key,ctx.s)}`}});
 expect(reply.statusCode).toBe(200);expect(reply.json()).toEqual(expect.arrayContaining([expect.objectContaining({actorId:who,changed:expect.arrayContaining(['analysisScope'])})]));
 expect(JSON.stringify(reply.json())).not.toContain(channel);await api.close();
});
it('hides a channel when repeated events come from fewer than three newcomers',async()=>{
 const ctx=await setup(),joined=new Date(Date.now()-3*86400000),identities:string[]=[];
 for(let i=0;i<3;i++){
  const identity=await vault.resolve(db,ctx.s,String(980000000000000000n+BigInt(Math.min(i,1)))),episode=randomUUID(),episodeJoined=new Date(joined.getTime()+(i===2?86400000:0));
  identities.push(identity);
  await sql`INSERT INTO membership_episodes VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${episode}::uuid,${identity}::uuid,${episodeJoined},NULL,'PRODUCTION')`.execute(db);
  await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',${episodeJoined},'PRODUCTION',${json({channelId:channel,messageId:String(981000000000000000n+BigInt(i))})})`.execute(db);
  for(let j=0;j<4;j++)await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'reply.received',${new Date(episodeJoined.getTime()+j*1000)},'PRODUCTION',${json({channelId:channel,latencySeconds:60})})`.execute(db);
 }
 expect(new Set(identities).size).toBe(2);
 const view=await new PresentationService(db).journey(ctx.s,7);expect(view.channels).toEqual([]);expect(view.hiddenChannelCount).toBe(1);
 await sql`INSERT INTO telemetry_cursor VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${new Date(joined.getTime()-1000)},${new Date()})`.execute(db);
 const community=await new CommunityService(db).overview(ctx.s,7);expect(community.channels).toEqual([]);expect(community.hiddenChannelCount).toBe(1);
});
it('marks an expired weekly send as unknown without resending it',async()=>{
 const ctx=await setup(),cfg=await ctx.settings.get(ctx.s);await ctx.settings.update(ctx.s,actor,cfg.revision,{weeklySummaryEnabled:true,weeklySummaryChannelId:channel});
 await sql`INSERT INTO weekly_summary_deliveries(organization_id,guild_id,week_start,channel_id,state,attempted_at,lease_until) VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},'2026-09-14'::date,${channel},'sending','2026-09-22'::timestamptz,'2026-09-22'::timestamptz)`.execute(db);
 const worker=new WeeklySummaryWorker(db,ctx.discord);expect(await worker.tick(ctx.s,new Date('2026-09-24T12:00:00.000Z'))).toBe(false);
 expect(ctx.discord.calls.filter(call=>call==='sendPanel')).toHaveLength(0);
 expect((await sql<{state:string;status_note:string}>`SELECT state,status_note FROM weekly_summary_deliveries WHERE ${tenant(ctx.s)}`.execute(db)).rows).toMatchObject([{state:'unknown',status_note:'送信結果を確認できませんでした'}]);
});
it('retries a weekly summary when analytics fails before Discord sending starts',async()=>{
 const ctx=await setup(),cfg=await ctx.settings.get(ctx.s);await ctx.settings.update(ctx.s,actor,cfg.revision,{weeklySummaryEnabled:true,weeklySummaryChannelId:channel});
 const broken={canonical:async()=>{throw new Error('temporary analytics failure');}} as unknown as AnalyticsService;
 const at=new Date('2026-09-24T12:00:00.000Z');
 expect(await new WeeklySummaryWorker(db,ctx.discord,ctx.settings,broken).tick(ctx.s,at)).toBe(false);
 expect((await sql<{state:string;attempted_at:Date|null}>`SELECT state,attempted_at FROM weekly_summary_deliveries WHERE ${tenant(ctx.s)}`.execute(db)).rows).toMatchObject([{state:'ready',attempted_at:null}]);
 expect(ctx.discord.calls.filter(call=>call==='sendPanel')).toHaveLength(0);
 expect(await new WeeklySummaryWorker(db,ctx.discord).tick(ctx.s,at)).toBe(true);
 expect((await sql<{state:string}>`SELECT state FROM weekly_summary_deliveries WHERE ${tenant(ctx.s)}`.execute(db)).rows).toMatchObject([{state:'sent'}]);
});
it('does not retry a weekly summary when Discord sending has an uncertain result',async()=>{
 const ctx=await setup(),cfg=await ctx.settings.get(ctx.s);await ctx.settings.update(ctx.s,actor,cfg.revision,{weeklySummaryEnabled:true,weeklySummaryChannelId:channel});
 const uncertain=new Proxy(ctx.discord,{get(target,key){if(key==='sendPanel')return async()=>{throw new Error('connection closed after request');};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 const at=new Date('2026-09-24T12:00:00.000Z'),worker=new WeeklySummaryWorker(db,uncertain);
 expect(await worker.tick(ctx.s,at)).toBe(false);
 expect((await sql<{state:string}>`SELECT state FROM weekly_summary_deliveries WHERE ${tenant(ctx.s)}`.execute(db)).rows).toMatchObject([{state:'unknown'}]);
 expect(await new WeeklySummaryWorker(db,ctx.discord).tick(ctx.s,at)).toBe(false);
 expect(ctx.discord.calls.filter(call=>call==='sendPanel')).toHaveLength(0);
});
it('allows a plan override only in explicit development mode',async()=>{
 const ctx=await setup();
 try{vi.stubEnv('NEXUS_DEV_PLAN','FREE');vi.stubEnv('NODE_ENV','production');expect(await new EntitlementService(db).plan(ctx.s)).toBe('GROWTH');vi.stubEnv('NODE_ENV','development');expect(await new EntitlementService(db).plan(ctx.s)).toBe('FREE');}
 finally{vi.unstubAllEnvs();}
});
it('counts each reply partner once and removes both sides of a deleted member pair',async()=>{
 const ctx=await setup(),joined=new Date(Date.now()-20*86400000),targetEpisode=await join(ctx,joined),targetMessage='988000000000000001';
 const send=async(userId:string,kind:'member.joined'|'message.sent',at:Date,messageId?:string,referenceId?:string)=>ctx.lifecycle.process({...ctx.s,shardId:0,gatewaySessionId:'partners',sequence:++counter,kind,at:at.toISOString(),joinedAt:kind==='member.joined'?joined.toISOString():undefined,context:'PRODUCTION',encryptedUserId:vault.seal(ctx.s,userId),channelId:kind==='message.sent'?channel:undefined,messageId,messageType:kind==='message.sent'?0:undefined,referenceId});
 await send(user,'message.sent',new Date(joined.getTime()+60000),targetMessage);
 for(let i=0;i<2;i++){
  const peer=String(989000000000000000n+BigInt(i));ctx.discord.members.set(peer,{roles:[],permissions:'0',bot:false,joinedAt:joined.toISOString()});await send(peer,'member.joined',joined);
  for(let repeat=0;repeat<(i===0?2:1);repeat++)await send(peer,'message.sent',new Date(joined.getTime()+120000+i*60000+repeat*1000),String(989100000000000000n+BigInt(i*10+repeat)),targetMessage);
 }
 const rows=(await sql<{episode_id:string;peer_identity_id:string}>`SELECT episode_id,peer_identity_id FROM member_interaction_pairs WHERE ${tenant(ctx.s)}`.execute(db)).rows;
 expect(rows.filter(row=>row.episode_id===targetEpisode)).toHaveLength(2);
 expect(rows).toHaveLength(4);expect(JSON.stringify(rows)).not.toContain(user);
 await new PrivacyService(db,vault,ctx.settings).delete(ctx.s,user,{...actor,key:vault.hash(ctx.s,user)});
 expect((await sql`SELECT 1 FROM member_interaction_pairs WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(0);
});
it('shows a newcomer reply queue and sends one capped helper alert without message content',async()=>{
 const ctx=await setup(),now=new Date(),joined=new Date(now.getTime()-2*3600000),episode=await join(ctx,joined),messageId='988000000000000101';
 const cfg=await ctx.settings.get(ctx.s);await ctx.settings.update(ctx.s,actor,cfg.revision,{helperChannelId:channel,helperEnabled:true});
 await ctx.lifecycle.process({...ctx.s,shardId:0,gatewaySessionId:'helper',sequence:++counter,kind:'message.sent',at:new Date(joined.getTime()+60000).toISOString(),context:'PRODUCTION',encryptedUserId:vault.seal(ctx.s,user),channelId:channel,messageId,messageType:0});
 await sql`INSERT INTO telemetry_cursor VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${new Date(joined.getTime()-1000)},${now})`.execute(db);
 const view=await new CommunityService(db).overview(ctx.s,7,now);expect(view.daily.attentionCount).toBe(1);expect(view.attention).toMatchObject([{messageId,channelId:channel}]);expect(JSON.stringify(view.attention)).not.toContain(user);
 const worker=new HelperWorker(db,ctx.discord,ctx.settings);expect(await worker.tick(ctx.s,now)).toBe(true);expect(await worker.tick(ctx.s,now)).toBe(false);
 expect(ctx.discord.calls.filter(call=>call==='sendPanel')).toHaveLength(1);expect(JSON.stringify([...ctx.discord.panels.values()][0])).toContain(messageId);
 expect((await sql`SELECT state FROM helper_alerts WHERE ${tenant(ctx.s)}`.execute(db)).rows).toMatchObject([{state:'sent'}]);
 await new PrivacyService(db,vault,ctx.settings).delete(ctx.s,user,{...actor,key:vault.hash(ctx.s,user)});
 expect((await sql`SELECT 1 FROM helper_alerts WHERE ${tenant(ctx.s)}`.execute(db)).rows).toHaveLength(0);
 expect((await sql`SELECT 1 FROM membership_episodes WHERE ${tenant(ctx.s)} AND id=${episode}::uuid`.execute(db)).rows).toHaveLength(0);
});
it('compares tagged feedback places and reply coverage without identifying helpers',async()=>{
 const ctx=await setup(),now=new Date(),joined=new Date(now.getTime()-20*86400000),cfg=await ctx.settings.get(ctx.s);
 await ctx.settings.update(ctx.s,actor,cfg.revision,{goalPreset:'early_access',importantChannels:[{channelId:channel,purpose:'feedback'}]});
 await sql`INSERT INTO telemetry_cursor VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${new Date(joined.getTime()-1000)},${now})`.execute(db);
 for(let i=0;i<5;i++){
  const identity=await vault.resolve(db,ctx.s,String(988200000000000000n+BigInt(i))),episode=randomUUID(),first=new Date(joined.getTime()+3600000),reply=new Date(first.getTime()+3600000);
  await sql`INSERT INTO membership_episodes VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${episode}::uuid,${identity}::uuid,${joined},NULL,'PRODUCTION')`.execute(db);
  await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',${first},'PRODUCTION',${json({channelId:channel,messageId:String(988300000000000000n+BigInt(i))})}),(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'reply.received',${reply},'PRODUCTION',${json({channelId:channel,latencySeconds:3600})})`.execute(db);
 }
 const view=await new CommunityService(db).overview(ctx.s,30,now);
 expect(view.goalPreset).toBe('early_access');expect(view.importantPlaces).toMatchObject([{channelId:channel,purpose:'feedback',newcomers:5,receivedReplyPercent:100}]);
 expect(view.helperCoverage).toMatchObject([{sample:5,medianReplyMinutes:60}]);expect(JSON.stringify(view.helperCoverage)).not.toContain('identity');
});
it('compares age-matched activity and separates mature newcomer outcomes',async()=>{
 const ctx=await setup(),now=new Date('2026-09-24T12:00:00.000Z'),newJoin=new Date(now.getTime()-20*86400000),oldJoin=new Date(now.getTime()-45*86400000);
 await sql`INSERT INTO telemetry_cursor VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${new Date(newJoin.getTime()-1000)},${now})`.execute(db);
 for(let i=0;i<15;i++){const identity=await vault.resolve(db,ctx.s,String(990000000000000000n+BigInt(i))),episode=randomUUID(),joined=i<10?newJoin:oldJoin;await sql`INSERT INTO membership_episodes VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${episode}::uuid,${identity}::uuid,${joined},NULL,'PRODUCTION')`.execute(db);const activity=i<10?new Date(joined.getTime()+60000):new Date(now.getTime()-2*86400000);await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',${activity},'PRODUCTION',${json({messageId:String(991000000000000000n+BigInt(i)),channelId:channel})})`.execute(db);if(i<10){await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'reply.received',${new Date(activity.getTime()+600000)},'PRODUCTION',${json({channelId:channel,latencySeconds:600})})`.execute(db);if(i<5){for(const day of [3,8])await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'reaction.added',${new Date(joined.getTime()+day*86400000)},'PRODUCTION',${json({channelId:channel,messageId:String(992000000000000000n+BigInt(i*10+day))})})`.execute(db);}}else await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'reaction.added',${new Date(now.getTime()-86400000)},'PRODUCTION',${json({channelId:channel,messageId:String(993000000000000000n+BigInt(i))})})`.execute(db);}
 const view=await new CommunityService(db).overview(ctx.s,30,now);expect(view.classification.continuing).toBe(5);expect(view.compare.available).toBe(true);expect(view.outcomes).toMatchObject({retained:5,notRetained:5,pending:0,insufficient:0});expect(view.stages.map(stage=>stage.count)).toEqual([10,10,10,5,5]);expect(JSON.stringify(view)).not.toContain('episode_id');
 const sevenDays=await new CommunityService(db).overview(ctx.s,7,now);expect(sevenDays.stages.map(stage=>stage.count)).toEqual([10,10,10,5,5]);expect(sevenDays.cohortWindow).toMatchObject({observedThroughDays:14,total:10});
 await sql`INSERT INTO telemetry_health VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${new Date(now.getTime()-2*86400000)},${new Date(now.getTime()-86400000)},'test gap')`.execute(db);
 const incomplete=await new CommunityService(db).overview(ctx.s,30,now);expect(incomplete.compare.available).toBe(false);expect(incomplete.compare.continuing).toBeNull();
 await sql`DELETE FROM telemetry_health WHERE ${tenant(ctx.s)}`.execute(db);
 const departing=(await sql<{id:string}>`SELECT id FROM membership_episodes WHERE ${tenant(ctx.s)} AND joined_at=${oldJoin} LIMIT 1`.execute(db)).rows[0]!;
 await sql`UPDATE membership_episodes SET left_at=${new Date(now.getTime()-86400000)} WHERE ${tenant(ctx.s)} AND id=${departing.id}::uuid`.execute(db);
 const afterExit=await new CommunityService(db).overview(ctx.s,30,now);expect(afterExit.classification.continuing).toBe(4);expect(afterExit.classification.exited).toBe(1);expect(afterExit.compare.available).toBe(false);
});
it('attributes replies and later channel activity to the correct channel and time order',async()=>{
 const ctx=await setup(),now=new Date('2026-09-24T12:00:00.000Z'),joined=new Date(now.getTime()-5*86400000),other='777111111111111111';
 await sql`INSERT INTO telemetry_cursor VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${new Date(joined.getTime()-1000)},${now})`.execute(db);
 for(let i=0;i<3;i++){
  const identity=await vault.resolve(db,ctx.s,String(996000000000000000n+BigInt(i))),episode=randomUUID();
  await sql`INSERT INTO membership_episodes VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${episode}::uuid,${identity}::uuid,${joined},NULL,'PRODUCTION')`.execute(db);
  for(const [hour,target] of [[1,other],[4,channel],...(i===0?[[6,other]]:[])] as Array<[number,string]>){
   await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',${new Date(joined.getTime()+hour*3600000)},'PRODUCTION',${json({channelId:target,messageId:String(997000000000000000n+BigInt(i*10+hour))})})`.execute(db);
  }
  await sql`INSERT INTO lifecycle_events VALUES(${ctx.s.organizationId}::uuid,${ctx.s.guildId},${randomUUID()}::uuid,${episode}::uuid,'reply.received',${new Date(joined.getTime()+5*3600000)},'PRODUCTION',${json({channelId:other,latencySeconds:60})})`.execute(db);
 }
 const view=await new CommunityService(db).overview(ctx.s,7,now),intro=view.channels.find(item=>item.channelId===channel),general=view.channels.find(item=>item.channelId===other);
 expect(intro).toMatchObject({newcomers:3,receivedReplyPercent:0,laterElsewherePercent:33});
 expect(general).toMatchObject({newcomers:3,receivedReplyPercent:100,laterElsewherePercent:100});
 expect(view.transitions).toContainEqual({from:other,to:channel,count:3});
 expect(view.transitions).not.toContainEqual({from:channel,to:other,count:3});
});
