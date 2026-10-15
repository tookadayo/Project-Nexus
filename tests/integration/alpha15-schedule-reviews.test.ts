import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,migrate,ensureGuild,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationScheduler} from '../../packages/automation/src/scheduler';
import {currentScheduleMeaningReader,type ScheduleMeaningReader} from '../../packages/automation/src/schedule-rules';
import {processAlpha15AutomationSchedules} from '../../apps/worker/src/alpha15-automation';
import type {Actor} from '../../packages/settings/src/index';
import type {FlowDefinition,TriggerDefinition} from '../../packages/automation/src/types';
import {isolatedPostgres} from '../fixtures/postgres';

let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const actor:Actor={key:'synthetic-scheduler-actor',encryptedUserId:'synthetic-encrypted',permissions:'8',roles:[],source:'WEB_DASHBOARD',requestId:'synthetic'};
const admission={activeFlows:20,monthlyRuns:100,guildConcurrent:1,globalConcurrent:2,guildPending:20,globalPending:200,measurementId:'isolated-schedule'};
beforeAll(async()=>{
  vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);
  await migrate(db,{throughVersion:58});
  await sql.raw(await readFile(new URL('../../migrations/059_alpha15_schedule_reviews.sql',import.meta.url),'utf8')).execute(db);
});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});
async function fixture(calendar=false,activate=true){
  const s=scopeForGuild(String(889000000000000000n+BigInt(++serial))),clock={now:new Date('2026-11-01T00:00:00Z')};await ensureGuild(db,s);
  const reader:ScheduleMeaningReader={...currentScheduleMeaningReader()},options={admission,authorize:async()=>{},now:()=>clock.now,scheduleMeaningReader:reader};
  const trigger:TriggerDefinition=calendar?{kind:'schedule',schedule:{kind:'recurring',frequency:'daily',time:'09:00',timeZone:'America/New_York',startDate:'2026-11-01',endDate:'2026-12-31',missingTime:'skip',repeatedTime:'earlier',pastOccurrences:'skip'}}:{kind:'schedule',schedule:{kind:'elapsed',anchor:'2026-11-01T00:01:00Z',intervalSeconds:60,end:'2026-11-01T00:10:00Z',pastOccurrences:'skip'}};
  const definition:FlowDefinition={schemaVersion:1,id:'schedule-'+serial,guildId:s.guildId,name:'Synthetic schedule',trigger,variables:[],body:[{kind:'end',id:'end'}]},service=new AutomationService(db,options);
  const saved=await service.save(s,actor,{definition,expectedRevision:0,requestId:randomUUID()});
  if(activate){for(const kind of ['VALIDATE','TEST','IMPACT'] as const)expect((await service.check(s,actor,definition.id,1,kind)).valid).toBe(true);
  await service.enable(s,actor,definition.id,{revision:1,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()});}
  const scheduler=new AutomationScheduler(db,service,()=>clock.now);
  const row=async()=>(await sql<{generation:number;next_at:Date|null;enabled:boolean;review_required:boolean;review_reason:string|null}>`SELECT * FROM automation_schedules WHERE ${tenant(s)} AND id=${definition.id}`.execute(db)).rows[0]!;
  const dispatch=async()=>{const current=await row();return scheduler.dispatch(s,definition.id,current.generation,current.next_at!.toISOString());};
  return {s,clock,reader,options,definition,service,scheduler,row,dispatch,saved};
}
it('admits one independent Run per anchored occurrence and never duplicates a concurrent tick',async()=>{
  const f=await fixture(),current=await f.row();f.clock.now=current.next_at!;
  const starts=await Promise.all([f.scheduler.dispatch(f.s,f.definition.id,current.generation,current.next_at!.toISOString()),f.scheduler.dispatch(f.s,f.definition.id,current.generation,current.next_at!.toISOString())]);
  expect(starts.filter(result=>result.state==='STARTED')).toHaveLength(1);
  expect((await f.row()).next_at!.toISOString()).toBe('2026-11-01T00:02:00.000Z');
  f.clock.now=new Date('2026-11-01T00:02:00Z');expect(await f.dispatch()).toMatchObject({state:'STARTED'});
  const runs=(await sql<{id:string;deadline_at:Date;started_at:Date}>`SELECT id,deadline_at,started_at FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows;
  expect(new Set(runs.map(run=>run.id)).size).toBe(2);expect(runs.every(run=>run.deadline_at.getTime()-run.started_at.getTime()===7*86400000)).toBe(true);
});
it('skips missed elapsed occurrences, preserves the anchor and excludes starts after the end',async()=>{
  const f=await fixture();f.clock.now=new Date('2026-11-01T00:05:30Z');expect(await f.dispatch()).toMatchObject({state:'SKIPPED'});
  expect((await f.row()).next_at!.toISOString()).toBe('2026-11-01T00:06:00.000Z');
  f.clock.now=new Date('2026-11-01T00:10:00Z');expect(await f.dispatch()).toMatchObject({state:'SKIPPED'});expect((await f.row()).next_at).toBeNull();
  expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows).toEqual([]);
});
it('does not revive an occurrence after a concurrent definition disable or changed revision',async()=>{
  const f=await fixture(),current=await f.row();await f.service.disable(f.s,actor,f.definition.id,randomUUID());f.clock.now=current.next_at!;
  expect(await f.scheduler.dispatch(f.s,f.definition.id,current.generation,current.next_at!.toISOString())).toMatchObject({state:'STALE'});
  expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows).toEqual([]);
});
it('serializes cancellation against admission and rejects the old generation after a replacement revision',async()=>{
  const f=await fixture(),current=await f.row();f.clock.now=current.next_at!;
  await Promise.all([f.dispatch(),f.service.disable(f.s,actor,f.definition.id,randomUUID())]);
  const accepted=(await sql<{cancel_requested_at:Date|null}>`SELECT cancel_requested_at FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows;
  expect(accepted.length).toBeLessThanOrEqual(1);expect(accepted.every(run=>run.cancel_requested_at!==null)).toBe(true);
  const next=await f.service.save(f.s,actor,{definition:f.definition,expectedRevision:1,requestId:randomUUID()});
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await f.service.check(f.s,actor,f.definition.id,2,kind);
  await f.service.enable(f.s,actor,f.definition.id,{revision:2,semanticHash:next.validation.semanticHash!,requestId:randomUUID()});
  expect(await f.scheduler.dispatch(f.s,f.definition.id,current.generation,current.next_at!.toISOString())).toMatchObject({state:'STALE'});
  const fresh=await f.row();f.clock.now=fresh.next_at!;expect(await f.dispatch()).toMatchObject({state:'STARTED'});
});
it('detects changed calendar meaning before a future occurrence is due and retains existing Runs',async()=>{
  const f=await fixture(true),current=await f.row();f.clock.now=current.next_at!;const first=await f.dispatch();expect(first.state).toBe('STARTED');
  const old=f.reader.resolve;f.reader.resolve=local=>({...old(local),offset:'+03:00'});
  f.clock.now=new Date(f.clock.now.getTime()+60000);
  const result=await processAlpha15AutomationSchedules(db,f.options,f.clock.now);expect(result.scheduled).toBe(0);
  expect(await f.row()).toMatchObject({enabled:false,next_at:null,review_required:true,review_reason:'TIME_ZONE_MEANING_CHANGED'});
  const run=(await sql<{status:string;cancel_requested_at:Date|null}>`SELECT status,cancel_requested_at FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows[0]!;
  expect(run).toEqual({status:'QUEUED',cancel_requested_at:null});
  const detail=await f.service.get(f.s,actor,f.definition.id);expect(detail.scheduleReview).toMatchObject({required:true,reason:'TIME_ZONE_MEANING_CHANGED'});
});
it('requires a new checked revision and explicit enable even if the old database rules return',async()=>{
  const f=await fixture(true);f.reader.version='synthetic-new-version';expect(await f.dispatch()).toMatchObject({state:'REVIEW_REQUIRED'});
  f.reader.version=currentScheduleMeaningReader().version;
  expect((await f.service.check(f.s,actor,f.definition.id,1,'VALIDATE')).valid).toBe(false);
  await expect(f.service.enable(f.s,actor,f.definition.id,{revision:1,semanticHash:f.saved.validation.semanticHash!,requestId:randomUUID()})).rejects.toThrow('TIME_ZONE_DATABASE_CHANGED');
  const next=await f.service.save(f.s,actor,{definition:f.definition,expectedRevision:1,requestId:randomUUID()});
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)expect((await f.service.check(f.s,actor,f.definition.id,2,kind)).valid).toBe(true);
  expect((await f.row()).enabled).toBe(false);
  await f.service.enable(f.s,actor,f.definition.id,{revision:2,semanticHash:next.validation.semanticHash!,requestId:randomUUID()});
  expect(await f.row()).toMatchObject({enabled:true,review_required:false,review_reason:null});
});
it('checks the same meaning again at enable and commits the review block on rejection',async()=>{
  const f=await fixture(true);f.reader.version='synthetic-version-between-review-and-enable';
  await expect(f.service.enable(f.s,actor,f.definition.id,{revision:1,semanticHash:f.saved.validation.semanticHash!,requestId:randomUUID()})).rejects.toThrow('TIME_ZONE_DATABASE_CHANGED');
  expect(await f.row()).toMatchObject({enabled:false,review_required:true});
});
it('re-resolves the stored next local occurrence outside all initial probes, even with the same timezone database version',async()=>{
  const f=await fixture(true),target='2026-12-20';
  const snapshot=(await sql<{snapshot:{probes:{local:{date:string}}[]}}>`SELECT snapshot FROM automation_schedule_reviews WHERE ${tenant(f.s)} AND flow_id=${f.definition.id}`.execute(db)).rows[0]!.snapshot;
  expect(snapshot.probes.every(probe=>probe.local.date!==target)).toBe(true);
  f.clock.now=new Date('2026-12-19T15:00:00Z');
  await f.service.enable(f.s,actor,f.definition.id,{revision:1,semanticHash:f.saved.validation.semanticHash!,requestId:randomUUID()});
  expect((await f.row()).next_at!.toISOString()).toBe('2026-12-20T14:00:00.000Z');
  const resolve=f.reader.resolve;
  f.reader.resolve=local=>{const old=resolve(local);return local.date===target&&old.instant?{instant:new Date(Date.parse(old.instant)+3600000).toISOString(),offset:'-04:00'}:old;};
  expect(await f.dispatch()).toMatchObject({state:'REVIEW_REQUIRED',reason:'TIME_ZONE_PLANNED_INSTANT_CHANGED'});
  expect(await f.row()).toMatchObject({enabled:false,review_required:true});
  expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows).toEqual([]);
});
it('keeps an unchecked new revision reviewable after an early enable click',async()=>{
  const f=await fixture(true,false);
  await expect(f.service.enable(f.s,actor,f.definition.id,{revision:1,semanticHash:f.saved.validation.semanticHash!,requestId:randomUUID()})).rejects.toThrow('AUTOMATION_REVIEW_REQUIRED');
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)expect((await f.service.check(f.s,actor,f.definition.id,1,kind)).valid).toBe(true);
  await expect(f.service.enable(f.s,actor,f.definition.id,{revision:1,semanticHash:f.saved.validation.semanticHash!,requestId:randomUUID()})).resolves.toMatchObject({state:'ACTIVE'});
});
it('counts normalized timezone snapshots within the existing definition storage budget',async()=>{
  const f=await fixture(true,false),limited=new AutomationService(db,{...f.options,storage:{...f.service.storage,maxGuildDefinitionBytes:1000,maxHostDefinitionBytes:2000}});
  await expect(limited.check(f.s,actor,f.definition.id,1,'VALIDATE')).rejects.toThrow('AUTOMATION_DEFINITION_BYTES_LIMIT');
  expect((await sql`SELECT revision FROM automation_schedule_reviews WHERE ${tenant(f.s)}`.execute(db)).rows).toEqual([]);
});
