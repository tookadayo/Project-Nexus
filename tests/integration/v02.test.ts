import {beforeAll,afterAll,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Redis} from 'ioredis';
import {infrastructure} from '../fixtures/infrastructure.js';
import {connect,migrate,ensureGuild,sql,tenant,type Database} from '../../packages/db/src/index.js';
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
import {GatewayPublisher,STREAM} from '../../apps/gateway/src/index.js';
import {StreamConsumer,scrubStream} from '../../apps/worker/src/streams.js';
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
