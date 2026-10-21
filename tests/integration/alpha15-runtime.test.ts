import {createHash,randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,migrate,ensureGuild,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import type {Actor} from '../../packages/settings/src/index';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationRuntime,type AutomationRuntimeAdapter} from '../../packages/automation/src/runtime';
import {AutomationStore,fingerprint,verifyAutomationApproval} from '../../packages/automation/src/store';
import {AutomationScheduler} from '../../packages/automation/src/scheduler';
import {sweepAutomationRetention,purgeAutomationGuild,purgeAutomationActor,fenceRestoredAutomations} from '../../packages/automation/src/retention';
import type {AutomationAdmissionLimits} from '../../packages/automation/src/quota';
import {automationLock} from '../../packages/automation/src/quota';
import type {FlowDefinition,Statement} from '../../packages/automation/src/types';
import {isolatedPostgres} from '../fixtures/postgres';
import {processAlpha15AutomationRuns} from '../../apps/worker/src/alpha15-automation';
import {setTimeout as delay} from 'node:timers/promises';
import {mockSuccessfulActionOutcomes} from '../fixtures/alpha15-simulation';

let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const channel='884222222222222222',member='884333333333333333',role='884444444444444444';
const admission:AutomationAdmissionLimits={activeFlows:20,monthlyRuns:100,guildConcurrent:1,globalConcurrent:2,guildPending:20,globalPending:200,measurementId:'isolated-synthetic-tests'};
const actor:Actor={key:createHash('sha256').update('synthetic-admin').digest('hex'),encryptedUserId:'encrypted-test-identity',permissions:'8',roles:[],source:'WEB_DASHBOARD',requestId:'synthetic'};
beforeAll(async()=>{
  vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});
function send(id='send'):Statement{return {kind:'action',id,operation:'discord.sendMessage',inputs:{channel:{kind:'literal',type:'ChannelRef',value:{id:channel,guildId:'placeholder'}},content:{kind:'literal',type:'PlainText',value:'Synthetic admin template - no external send'}}};}
async function fixture(body:Statement[]=[{kind:'end',id:'end'}],policy:Partial<AutomationAdmissionLimits>={}) {
  const scope=scopeForGuild(String(884000000000000000n+BigInt(++serial)));await ensureGuild(db,scope);
  const now=new Date(),clock={now};
  const fix=(value:unknown):unknown=>Array.isArray(value)?value.map(fix):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='guildId'&&item==='placeholder'?scope.guildId:fix(item)])):value;
  const definition:FlowDefinition={schemaVersion:1,id:'synthetic-'+serial,name:'Synthetic automation',guildId:scope.guildId,trigger:{kind:'manual',inputs:[]},targets:{channelIds:[channel],roleIds:[role],parentCategoryIds:[]},variables:[],body:fix(body) as Statement[]};
  const service=new AutomationService(db,{admission:{...admission,...policy},now:()=>clock.now,authorize:async()=>{},approvalPolicy:async()=>({fingerprint:'a'.repeat(64),changedChannelCount:0}),adoptedActions:new Set(['discord.sendMessage','discord.addRole','discord.removeRole','nexus.readTicket'])});
  const saved=await service.save(scope,actor,{definition,expectedRevision:0,requestId:randomUUID()});
  expect(saved.validation.issues).toEqual([]);
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await service.check(scope,actor,definition.id,1,kind,{outcomes:mockSuccessfulActionOutcomes(definition)});
  await service.enable(scope,actor,definition.id,{revision:1,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()});
  const adapter:AutomationRuntimeAdapter={authorize:async()=>{},execute:async()=>({state:'SUCCEEDED'})};
  const runtime=new AutomationRuntime(db,{admission:service.limits,adapter,now:()=>clock.now});
  return {scope,definition,service,runtime,adapter,clock};
}
it('CAS saves and idempotent requests preserve the exact committed revision',async()=>{
  const f=await fixture(),requestId=randomUUID(),input={definition:{...f.definition,name:'Revised name'},expectedRevision:1,requestId};
  const first=await f.service.save(f.scope,actor,input),again=await f.service.save(f.scope,actor,input);expect(first.draftRevision).toBe(2);expect(again.draftRevision).toBe(2);
  await expect(f.service.save(f.scope,actor,{...input,definition:{...f.definition,name:'Different'}})).rejects.toThrow('AUTOMATION_REQUEST_CONFLICT');
  const updates=await Promise.allSettled([f.service.save(f.scope,actor,{definition:f.definition,expectedRevision:2,requestId:randomUUID()}),f.service.save(f.scope,actor,{definition:f.definition,expectedRevision:2,requestId:randomUUID()})]);
  expect(updates.filter(result=>result.status==='fulfilled').length).toBe(1);
});
it('does not reuse validation/test/impact from an old revision even with the same meaning',async()=>{
  const f=await fixture();const next=await f.service.save(f.scope,actor,{definition:f.definition,expectedRevision:1,requestId:randomUUID()});
  await expect(f.service.enable(f.scope,actor,f.definition.id,{revision:2,semanticHash:next.validation.semanticHash!,requestId:randomUUID()})).rejects.toThrow('AUTOMATION_REVIEW_REQUIRED');
  const result=await f.service.check(f.scope,actor,f.definition.id,2,'TEST');expect(result).toMatchObject({externalChanges:0,productionRuns:0,approvalConsumption:0,mode:'SIMULATION'});
});
it('does not accept an undetermined action simulation as the required activation test',async()=>{
  const f=await fixture([send()]),saved=await f.service.save(f.scope,actor,{definition:f.definition,expectedRevision:1,requestId:randomUUID()});
  await f.service.check(f.scope,actor,f.definition.id,2,'VALIDATE');await f.service.check(f.scope,actor,f.definition.id,2,'IMPACT');
  expect(await f.service.check(f.scope,actor,f.definition.id,2,'TEST')).toMatchObject({status:'UNDETERMINED',steps:[{blockId:'send',state:'UNDETERMINED',code:'MOCK_OUTCOME_REQUIRED'}]});
  await expect(f.service.enable(f.scope,actor,f.definition.id,{revision:2,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()})).rejects.toThrow('AUTOMATION_REVIEW_REQUIRED');
  expect(await f.service.check(f.scope,actor,f.definition.id,2,'TEST',{outcomes:{send:'SUCCEEDED'}})).toMatchObject({status:'COMPLETED'});
  await expect(f.service.enable(f.scope,actor,f.definition.id,{revision:2,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()})).resolves.toMatchObject({state:'ACTIVE'});
});
it('bounds repeated reads by steps and evaluations without consuming the external change budget',async()=>{
  const f=await fixture([{kind:'repeat',id:'read-loop',count:{kind:'literal',type:'Number',value:30},itemVariable:{id:'index',name:'Index',type:'Number'},body:[{kind:'action',id:'read',operation:'nexus.readTicket',inputs:{ticket:{kind:'literal',type:'TicketRef',value:{id:'intake:12345678-1234-1234-1234-123456789abc',guildId:'placeholder'}}}}]}]);let reads=0;
  f.adapter.execute=async context=>{expect(context.operation).toBe('nexus.readTicket');reads++;return {state:'SUCCEEDED'};};
  const run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'COMPLETED'});
  const saved=(await f.service.store.run(f.scope,run.id))!;expect(reads).toBe(30);expect(saved.resume.externalActions).toBe(0);expect(saved.resume.steps).toBe(31);expect(saved.resume.evaluations).toBe(31);
});
it('atomically reserves the final monthly slot and never recharges a duplicate start',async()=>{
  const f=await fixture(undefined,{monthlyRuns:1});const requestId=randomUUID();
  const results=await Promise.allSettled([f.service.start(f.scope,actor,f.definition.id,{requestId}),f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()})]);
  expect(results.filter(result=>result.status==='fulfilled').length).toBe(1);
  const accepted=results.find(result=>result.status==='fulfilled');if(accepted?.status!=='fulfilled')throw new Error('fixture');
  const rows=(await sql<{dedupe_key:string}>`SELECT dedupe_key FROM automation_runs WHERE ${tenant(f.scope)}`.execute(db)).rows;
  expect((await f.service.start(f.scope,actor,f.definition.id,{requestId:rows[0]!.dedupe_key})).id).toBe(accepted.value.id);
  const usage=(await sql<{reserved:number;consumed:number}>`SELECT reserved,consumed FROM automation_usage_months WHERE ${tenant(f.scope)}`.execute(db)).rows[0]!;
  expect(usage).toEqual({reserved:1,consumed:0});
});
it('releases a queued reservation cancelled before its first worker tick',async()=>{
  const f=await fixture(),run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});
  await sql`UPDATE automation_runs SET cancel_requested_at=now() WHERE ${tenant(f.scope)} AND id=${run.id}::uuid`.execute(db);
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'CANCELLED'});
  expect((await f.service.store.run(f.scope,run.id))!.usage_state).toBe('RELEASED');
  expect((await sql`SELECT reserved,consumed FROM automation_usage_months WHERE ${tenant(f.scope)}`.execute(db)).rows).toEqual([{reserved:0,consumed:0}]);
});
it('checks a concurrent stop under the admission row lock before consuming the reservation',async()=>{
  const f=await fixture(),run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});let entered!:()=>void,release!:()=>void;
  const held=new Promise<void>(resolve=>{entered=resolve;}),finished=new Promise<void>(resolve=>{release=resolve;});
  const stop=db.transaction().execute(async tx=>{await automationLock(tx,f.scope);entered();await finished;await sql`UPDATE automation_runs SET cancel_requested_at=now() WHERE ${tenant(f.scope)} AND id=${run.id}::uuid`.execute(tx);});
  await held;const ticking=f.runtime.tick(f.scope,run.id);let waiting=false;
  try{
    for(let attempt=0;attempt<100;attempt++){
      waiting=(await sql<{waiting:boolean}>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event='advisory' AND query LIKE '%pg_advisory_xact_lock(763215)%') AS waiting`.execute(db)).rows[0]!.waiting;
      if(waiting)break;await delay(10);
    }
    expect(waiting).toBe(true);
  }finally{release();await stop;}
  expect(await ticking).toMatchObject({state:'CANCELLED'});expect((await f.service.store.run(f.scope,run.id))!.usage_state).toBe('RELEASED');
  expect((await sql`SELECT reserved,consumed FROM automation_usage_months WHERE ${tenant(f.scope)}`.execute(db)).rows).toEqual([{reserved:0,consumed:0}]);
});
it('releases an expired queued reservation without charging an unstarted execution',async()=>{
  const f=await fixture(),run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});f.clock.now=new Date((await f.service.store.run(f.scope,run.id))!.deadline_at.getTime()+1);
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'EXPIRED'});expect((await f.service.store.run(f.scope,run.id))!.usage_state).toBe('RELEASED');
  expect((await sql`SELECT reserved,consumed FROM automation_usage_months WHERE ${tenant(f.scope)}`.execute(db)).rows).toEqual([{reserved:0,consumed:0}]);
});
it('does not refund already consumed usage when an execution is later cancelled',async()=>{
  const f=await fixture([{kind:'wait',id:'wait',duration:{kind:'literal',type:'Duration',value:10}}]),run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'WAITING'});await sql`UPDATE automation_runs SET cancel_requested_at=now() WHERE ${tenant(f.scope)} AND id=${run.id}::uuid`.execute(db);
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'CANCELLED'});expect((await f.service.store.run(f.scope,run.id))!.usage_state).toBe('CONSUMED');
  expect((await sql`SELECT reserved,consumed FROM automation_usage_months WHERE ${tenant(f.scope)}`.execute(db)).rows).toEqual([{reserved:0,consumed:1}]);
});
it('keeps interrupted write uncertainty ahead of a simultaneous cancellation',async()=>{
  const f=await fixture([send()]),run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});
  await f.service.store.beginOperation(f.scope,run.id,'interrupted','discord.sendMessage','synthetic');await sql`UPDATE automation_runs SET cancel_requested_at=now() WHERE ${tenant(f.scope)} AND id=${run.id}::uuid`.execute(db);
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'UNKNOWN'});expect((await sql`SELECT state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${run.id}::uuid`.execute(db)).rows).toEqual([{state:'UNKNOWN'}]);
});
it('freezes draws and waits across resume without extending the original deadline',async()=>{
  const f=await fixture([{kind:'random',id:'draw',mode:'integer',output:{id:'picked',name:'Picked',type:'Number'},min:{kind:'literal',type:'Number',value:1},max:{kind:'literal',type:'Number',value:100}},{kind:'wait',id:'wait',duration:{kind:'literal',type:'Duration',value:10}},{kind:'end',id:'end'}]);
  const run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'WAITING'});const before=await f.service.store.run(f.scope,run.id);
  const draws=(await sql<{result:unknown}>`SELECT result FROM automation_random_results WHERE ${tenant(f.scope)} AND run_id=${run.id}::uuid`.execute(db)).rows;
  expect(draws.length).toBe(1);f.clock.now=new Date(f.clock.now.getTime()+11000);
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'COMPLETED'});const after=await f.service.store.run(f.scope,run.id);
  expect(after!.deadline_at.toISOString()).toBe(before!.deadline_at.toISOString());
  expect((await sql`SELECT result FROM automation_random_results WHERE ${tenant(f.scope)} AND run_id=${run.id}::uuid`.execute(db)).rows).toEqual(draws);
  expect((await sql`SELECT reserved,consumed FROM automation_usage_months WHERE ${tenant(f.scope)}`.execute(db)).rows[0]).toEqual({reserved:0,consumed:1});
});
it('reads the immutable persisted Run start after waiting, restarting, and repeating a start request',async()=>{
  const fixed={kind:'variable' as const,type:'Instant' as const,variableId:'run.startedAt'};
  const f=await fixture([{kind:'declare',id:'before',variable:{id:'before-time',name:'Before',type:'Instant'},value:fixed},{kind:'wait',id:'wait',duration:{kind:'literal',type:'Duration',value:10}},{kind:'declare',id:'after',variable:{id:'after-time',name:'After',type:'Instant'},value:fixed},{kind:'readClock',id:'clock',output:{id:'now',name:'Now',type:'Instant'}},{kind:'end',id:'end'}]);
  const requestId=randomUUID(),run=await f.service.start(f.scope,actor,f.definition.id,{requestId});
  await expect(f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID(),values:{'run.startedAt':{type:'Instant',value:'2000-01-01T00:00:00.000Z',provenance:[]}}})).rejects.toThrow('AUTOMATION_INPUT_UNDECLARED');
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'WAITING'});
  const before=(await f.service.store.run(f.scope,run.id))!,start=before.started_at.toISOString();
  expect(before.resume.variables['before-time']).toEqual({type:'Instant',value:start,provenance:[{source:'service',guildId:f.scope.guildId,resumable:true}]});
  expect(before.resume.variables['run.startedAt']).toBeUndefined();
  f.clock.now=new Date(f.clock.now.getTime()+11000);
  const restarted=new AutomationRuntime(db,{admission:f.service.limits,adapter:f.adapter,now:()=>f.clock.now});
  expect(await restarted.tick(f.scope,run.id,1)).toMatchObject({state:'RUNNING'});
  const resumed=(await f.service.store.run(f.scope,run.id))!;
  expect(resumed.resume.variables['after-time']).toEqual(before.resume.variables['before-time']);
  expect((await f.service.start(f.scope,actor,f.definition.id,{requestId})).id).toBe(run.id);
  expect((await f.service.store.run(f.scope,run.id))!.started_at.toISOString()).toBe(start);
  expect(await restarted.tick(f.scope,run.id,1)).toMatchObject({state:'RUNNING'});
  expect((await f.service.store.run(f.scope,run.id))!.resume.variables.now!.value).toBe(f.clock.now.toISOString());
  expect(await restarted.tick(f.scope,run.id)).toMatchObject({state:'COMPLETED'});
});
it('commits a random identity once under concurrent workers and rejects replacement input',async()=>{
  const f=await fixture(),run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()}),store=new AutomationStore(db);let generated=0;
  const factory=()=>{generated++;return {input:{count:3},fingerprint:fingerprint({count:3}),result:{type:'Number' as const,value:generated,provenance:[]}};};
  const [first,second]=await Promise.all([store.randomOnce(f.scope,run.id,'draw',factory),store.randomOnce(f.scope,run.id,'draw',factory)]);
  expect(first).toEqual(second);expect(generated).toBe(1);
  await expect(store.verifyRandomInput(f.scope,run.id,'draw',{count:4})).rejects.toThrow('AUTOMATION_RANDOM_INPUT_MISMATCH');
});
it('stops after an ambiguous write, retains successful evidence and sends no later action',async()=>{
  const f=await fixture([send('one'),send('two'),send('three')]);let calls=0;
  f.adapter.execute=async()=>++calls===1?{state:'SUCCEEDED'}:{state:'UNKNOWN',code:'SYNTHETIC_DISCONNECT'};
  const run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'UNKNOWN'});await f.runtime.tick(f.scope,run.id);expect(calls).toBe(2);
  const operations=(await sql<{state:string}>`SELECT state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${run.id}::uuid ORDER BY started_at`.execute(db)).rows;
  expect(operations.map(row=>row.state)).toEqual(['SUCCEEDED','UNKNOWN']);
  const logs=JSON.stringify((await sql`SELECT * FROM automation_run_events WHERE ${tenant(f.scope)}`.execute(db)).rows);expect(logs.includes('Synthetic admin template')).toBe(false);expect(logs.includes('SYNTHETIC_DISCONNECT')).toBe(true);
});
it('keeps an ambiguous write unknown when cancellation arrives before its terminal run checkpoint',async()=>{
  const f=await fixture([send('first'),send('second')]),run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});let calls=0;
  f.adapter.execute=async()=>{calls++;return {state:'UNKNOWN',code:'SYNTHETIC_DISCONNECT'};};
  const finishOperation=f.runtime.store.finishOperation.bind(f.runtime.store);
  vi.spyOn(f.runtime.store,'finishOperation').mockImplementation(async(...args)=>{
    await finishOperation(...args);
    if(args[3].state==='UNKNOWN'){
      await f.service.cancel(f.scope,actor,run.id,randomUUID());
      const pending=(await f.service.store.run(f.scope,run.id))!;
      expect(pending.ended_at).toBeNull();expect(pending.cancel_requested_at).not.toBeNull();expect(pending.usage_state).toBe('CONSUMED');
    }
  });
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'UNKNOWN'});
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'UNKNOWN'});expect(calls).toBe(1);
  expect((await sql`SELECT state,reason FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${run.id}::uuid`.execute(db)).rows).toEqual([{state:'UNKNOWN',reason:'SYNTHETIC_DISCONNECT'}]);
  expect((await f.service.store.run(f.scope,run.id))!.usage_state).toBe('CONSUMED');
  expect((await sql`SELECT reserved,consumed FROM automation_usage_months WHERE ${tenant(f.scope)}`.execute(db)).rows).toEqual([{reserved:0,consumed:1}]);
});
it('treats a committed dispatch interrupted by restart as unknown without retry',async()=>{
  const f=await fixture([send()]),run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});
  const saved=(await f.service.store.run(f.scope,run.id))!;
  const {dynamicExecutionIdentity}=await import('../../packages/automation/src/runtime');
  const identity=dynamicExecutionIdentity(saved,saved.resume.frames,'send');
  await f.service.store.beginOperation(f.scope,run.id,identity,'discord.sendMessage','synthetic');let sent=0;f.adapter.execute=async()=>{sent++;return {state:'SUCCEEDED'};};
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'UNKNOWN'});expect(sent).toBe(0);
});
it('cancels an in-flight write while preserving a late confirmed success',async()=>{
  const f=await fixture([send('first'),send('second')]),run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});
  let signal!:()=>void,finish!:(value:{state:'SUCCEEDED'})=>void;
  const entered=new Promise<void>(resolve=>{signal=resolve;});const result=new Promise<{state:'SUCCEEDED'}>(resolve=>{finish=resolve;});let calls=0;
  f.adapter.execute=async()=>{calls++;signal();return result;};
  const ticking=f.runtime.tick(f.scope,run.id);await entered;await f.service.store.cancel(f.scope,run.id);finish({state:'SUCCEEDED'});
  expect(await ticking).toMatchObject({state:'CANCELLED'});expect(calls).toBe(1);
  expect((await sql`SELECT state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${run.id}::uuid`.execute(db)).rows[0]).toEqual({state:'SUCCEEDED'});
});
it('requires a DB-issued fixed role approval and rejects a forged or changed fingerprint',async()=>{
  const f=await fixture([{kind:'action',id:'role',operation:'discord.addRole',approvalRequired:true,inputs:{member:{kind:'literal',type:'MemberRef',value:{id:member,guildId:'placeholder'}},role:{kind:'literal',type:'RoleRef',value:{id:role,guildId:'placeholder'}}}}]);
  const run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});let changed=0;
  f.adapter.execute=async context=>{await verifyAutomationApproval(db,f.scope,run.id,context.identity,fingerprint(context.inputs),f.clock.now);changed++;return {state:'SUCCEEDED'};};
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'WAITING_APPROVAL'});expect(changed).toBe(0);
  const pending=(await f.service.approvals(f.scope,actor)).items[0]!;
  await expect(f.service.decideApproval(f.scope,actor,pending.id,{decision:'APPROVE',fingerprint:'0'.repeat(64),requestId:randomUUID()})).rejects.toThrow('AUTOMATION_APPROVAL_CHANGED');
  await f.service.decideApproval(f.scope,actor,pending.id,{decision:'APPROVE',fingerprint:pending.fingerprint,policyFingerprint:'a'.repeat(64),requestId:randomUUID()});
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'COMPLETED'});expect(changed).toBe(1);
});
it('does not concatenate waits past the fixed seven-day run deadline',async()=>{
  const f=await fixture(),duration={kind:'variable' as const,type:'Duration' as const,variableId:'duration'};
  const definition:FlowDefinition={...f.definition,trigger:{kind:'manual',inputs:[{id:'duration',name:'Duration',type:'Duration'}]},body:[{kind:'wait',id:'one',duration},{kind:'wait',id:'two',duration}]};
  const saved=await f.service.save(f.scope,actor,{definition,expectedRevision:1,requestId:randomUUID()});
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await f.service.check(f.scope,actor,definition.id,2,kind,{values:{duration:{type:'Duration',value:86400}}});
  // A valid dry-run example does not grant a longer production deadline.
  await f.service.enable(f.scope,actor,definition.id,{revision:2,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()});
  const run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID(),values:{duration:{type:'Duration',value:4*86400,provenance:[]}}});expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'WAITING'});
  f.clock.now=new Date(f.clock.now.getTime()+4*86400000);expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'FAILED'});
  expect((await f.service.store.run(f.scope,run.id))!.reason).toBe('AUTOMATION_DEADLINE_EXCEEDED');
});
it('rechecks current authorization before the next external change',async()=>{
  const f=await fixture([send()]),run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});let sends=0;
  f.adapter.authorize=async()=>{throw new Error('CURRENT_MEMBERSHIP_REVOKED');};f.adapter.execute=async()=>{sends++;return {state:'SUCCEEDED'};};
  expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'FAILED'});expect(sends).toBe(0);
});
it('scheduler rejects stale generations and skips backlog instead of sending it',async()=>{
  const f=await fixture(),at=new Date(f.clock.now.getTime()-10000);
  const definition:FlowDefinition={...f.definition,trigger:{kind:'schedule',schedule:{kind:'once',at:{date:'2026-10-16',time:'09:00',timeZone:'UTC'}}}};
  await sql`UPDATE automation_revisions SET definition=${JSON.stringify(definition)}::jsonb WHERE ${tenant(f.scope)} AND flow_id=${definition.id}`.execute(db);
  await sql`INSERT INTO automation_schedules(organization_id,guild_id,id,flow_id,revision,generation,rule_hash,enabled,next_at) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},'schedule',${definition.id},1,1,'synthetic',true,${at})`.execute(db);
  const scheduler=new AutomationScheduler(db,f.service,()=>f.clock.now);
  expect(await scheduler.dispatch(f.scope,'schedule',0,at.toISOString())).toEqual({state:'STALE'});
  expect(await scheduler.dispatch(f.scope,'schedule',1,at.toISOString())).toEqual({state:'SKIPPED'});
  expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(f.scope)}`.execute(db)).rows.length).toBe(0);
});
it('rejects manual starts without a real requester identity or while globally paused before quota admission',async()=>{
  const f=await fixture();
  await expect(f.service.start(f.scope,{...actor,encryptedUserId:undefined},f.definition.id,{requestId:randomUUID()})).rejects.toThrow('AUTOMATION_IDENTITY_REQUIRED');
  await sql`INSERT INTO guild_settings(organization_id,guild_id,revision,settings) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},1,'{"enabled":false}'::jsonb)`.execute(db);
  await expect(f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()})).rejects.toThrow('AUTOMATION_STOPPED');
  expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  expect((await sql`SELECT month FROM automation_usage_months WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
});
it('skips and advances a due schedule while globally paused without reserving quota or replaying it',async()=>{
  const f=await fixture(),at=f.clock.now;
  const definition:FlowDefinition={...f.definition,trigger:{kind:'schedule',schedule:{kind:'recurring',frequency:'daily',time:'09:00',timeZone:'UTC',startDate:at.toISOString().slice(0,10),endDate:new Date(at.getTime()+2*86400000).toISOString().slice(0,10),missingTime:'skip',repeatedTime:'earlier',pastOccurrences:'skip'}}};
  await sql`UPDATE automation_revisions SET definition=${JSON.stringify(definition)}::jsonb WHERE ${tenant(f.scope)} AND flow_id=${definition.id}`.execute(db);
  await sql`INSERT INTO guild_settings(organization_id,guild_id,revision,settings) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},1,'{"enabled":false}'::jsonb)`.execute(db);
  const generation=(await sql<{generation:number}>`SELECT generation FROM automation_flows WHERE ${tenant(f.scope)} AND id=${definition.id}`.execute(db)).rows[0]!.generation;
  await sql`INSERT INTO automation_schedules(organization_id,guild_id,id,flow_id,revision,generation,rule_hash,enabled,next_at) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},'paused',${definition.id},1,${generation},'synthetic',true,${at})`.execute(db);
  const scheduler=new AutomationScheduler(db,f.service,()=>f.clock.now);
  expect(await scheduler.dispatch(f.scope,'paused',generation,at.toISOString())).toEqual({state:'SKIPPED'});
  const next=(await sql<{next_at:Date}>`SELECT next_at FROM automation_schedules WHERE ${tenant(f.scope)} AND id='paused'`.execute(db)).rows[0]!.next_at;
  expect(next.getTime()).toBeGreaterThan(at.getTime());
  expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  expect((await sql`SELECT month FROM automation_usage_months WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  await sql`UPDATE guild_settings SET settings='{"enabled":true}'::jsonb WHERE ${tenant(f.scope)}`.execute(db);
  expect(await scheduler.dispatch(f.scope,'paused',generation,at.toISOString())).toEqual({state:'STALE'});
});
it('deletes execution/draw/approval/log records after seven days without refilling monthly usage',async()=>{
  const f=await fixture(),run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});await f.runtime.tick(f.scope,run.id);
  const later=new Date(f.clock.now.getTime()+8*86400000);await sweepAutomationRetention(db,later);
  expect(await f.service.store.run(f.scope,run.id)).toBe(null);
  const usage=(await sql<{consumed:number}>`SELECT consumed FROM automation_usage_months WHERE ${tenant(f.scope)}`.execute(db)).rows[0];
  // If the fixture crosses the UTC month plus seven days the numeric accounting
  // has legitimately expired as well; in an open month it must stay consumed.
  if(later.getUTCMonth()===f.clock.now.getUTCMonth())expect(usage?.consumed).toBe(1);
});
it('guild deletion hook erases automation data while preserving other guilds',async()=>{
  const first=await fixture(),second=await fixture();await db.transaction().execute(tx=>purgeAutomationGuild(tx,first.scope));
  expect((await sql`SELECT id FROM automation_flows WHERE ${tenant(first.scope)}`.execute(db)).rows.length).toBe(0);
  expect((await second.service.list(second.scope,actor)).items.length).toBe(1);
});
it('member deletion erases affected references without erasing unrelated definitions',async()=>{
  const f=await fixture([{kind:'action',id:'role',operation:'discord.addRole',approvalRequired:true,inputs:{member:{kind:'literal',type:'MemberRef',value:{id:member,guildId:'placeholder'}},role:{kind:'literal',type:'RoleRef',value:{id:role,guildId:'placeholder'}}}}]);
  const unrelated={...f.definition,id:f.definition.id+'-unrelated',body:[{kind:'end' as const,id:'end'}]};
  await f.service.save(f.scope,actor,{definition:unrelated,expectedRevision:0,requestId:randomUUID()});
  const run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});await f.runtime.tick(f.scope,run.id);
  await db.transaction().execute(tx=>purgeAutomationActor(tx,f.scope,'deleted-member-hash',member));
  expect(await f.service.store.run(f.scope,run.id)).toBe(null);expect((await f.service.list(f.scope,actor)).items.map(item=>item.id)).toEqual([unrelated.id]);
  expect((await sql`SELECT id FROM automation_approvals WHERE ${tenant(f.scope)}`.execute(db)).rows.length).toBe(0);
});
it('restore disables schedules and fences interrupted writes as unknown while cancelling unstarted runs',async()=>{
  const f=await fixture([send()]),first=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()}),second=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});
  await f.service.store.beginOperation(f.scope,first.id,'restored-dispatch','discord.sendMessage','synthetic');
  await sql`INSERT INTO automation_schedules(organization_id,guild_id,id,flow_id,revision,generation,rule_hash,enabled,next_at) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},'restore',${f.definition.id},1,1,'synthetic',true,now()+interval '1 day')`.execute(db);
  await db.transaction().execute(tx=>fenceRestoredAutomations(tx));
  expect((await f.service.store.run(f.scope,first.id))!.status).toBe('UNKNOWN');expect((await f.service.store.run(f.scope,second.id))!.status).toBe('CANCELLED');
  expect((await sql`SELECT state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${first.id}::uuid`.execute(db)).rows[0]).toEqual({state:'UNKNOWN'});
  expect((await sql`SELECT state FROM automation_flows WHERE ${tenant(f.scope)}`.execute(db)).rows[0]).toEqual({state:'DISABLED'});
  expect((await sql`SELECT enabled,next_at FROM automation_schedules WHERE ${tenant(f.scope)}`.execute(db)).rows[0]).toEqual({enabled:false,next_at:null});
  expect((await sql`SELECT reserved FROM automation_usage_months WHERE ${tenant(f.scope)}`.execute(db)).rows[0]).toEqual({reserved:0});
});
it('bounds retained definition bytes atomically across different concurrent flow saves',async()=>{
  const f=await fixture(),first={...f.definition,id:'storage-a'},second={...f.definition,id:'storage-b'};
  const bytes=(await sql<{stored:number;added:number}>`SELECT COALESCE(sum(octet_length(definition::text)),0)::integer AS stored,(SELECT octet_length(${JSON.stringify(first)}::jsonb::text)) AS added FROM automation_revisions WHERE ${tenant(f.scope)}`.execute(db)).rows[0]!;
  const limited=new AutomationService(db,{...f.service.options,storage:{...f.service.storage,maxGuildDefinitionBytes:bytes.stored+bytes.added}});
  const result=await Promise.allSettled([limited.save(f.scope,actor,{definition:first,expectedRevision:0,requestId:randomUUID()}),limited.save(f.scope,actor,{definition:second,expectedRevision:0,requestId:randomUUID()})]);
  expect(result.filter(row=>row.status==='fulfilled').length).toBe(1);expect(result.filter(row=>row.status==='rejected').length).toBe(1);
  const revisions=new AutomationService(db,{...f.service.options,storage:{...f.service.storage,maxRevisionsPerFlow:1}});
  await expect(revisions.save(f.scope,actor,{definition:f.definition,expectedRevision:1,requestId:randomUUID()})).rejects.toThrow('AUTOMATION_DEFINITION_STORAGE_LIMIT');
});
it('confirms start and cancellation receipts without retrying an unknown request',async()=>{
  const f=await fixture(),startId=randomUUID(),cancelId=randomUUID(),run=await f.service.start(f.scope,actor,f.definition.id,{requestId:startId});
  expect(await f.service.request(f.scope,actor,startId)).toMatchObject({state:'CONFIRMED',kind:'START',runId:run.id});
  await f.service.cancel(f.scope,actor,run.id,cancelId);await f.service.cancel(f.scope,actor,run.id,cancelId);
  expect(await f.service.request(f.scope,actor,cancelId)).toMatchObject({state:'CONFIRMED',kind:'CANCEL',runId:run.id});
  expect((await f.service.store.run(f.scope,run.id))!.status).toBe('CANCELLED');
});
it('does not hold host admission while waiting for the privacy/Beta deletion fences',async()=>{
  const f=await fixture(),run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});
  let signal!:()=>void,release!:()=>void;
  const entered=new Promise<void>(resolve=>{signal=resolve;}),finished=new Promise<void>(resolve=>{release=resolve;});
  const privacyKey='privacy:'+f.scope.organizationId+':'+f.scope.guildId,betaKey='beta:'+f.scope.organizationId+':'+f.scope.guildId;
  const fence=db.connection().execute(async connection=>{
    await sql`SELECT pg_advisory_lock(hashtextextended(${privacyKey},0)),pg_advisory_lock(hashtextextended(${betaKey},0))`.execute(connection);signal();
    try{await finished;}finally{await sql`SELECT pg_advisory_unlock(hashtextextended(${betaKey},0)),pg_advisory_unlock(hashtextextended(${privacyKey},0))`.execute(connection);}
  });
  await entered;vi.stubEnv('NEXUS_HOSTED_BETA','on');const ticking=f.runtime.tick(f.scope,run.id);
  try {
    let waiting=false;
    for(let attempt=0;attempt<50;attempt++){
      waiting=(await sql<{count:number}>`SELECT count(*)::integer AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted`.execute(db)).rows[0]!.count>0;
      if(waiting)break;await delay(10);
    }
    expect(waiting).toBe(true);
    const free=await db.connection().execute(async connection=>{
      const row=(await sql<{locked:boolean}>`SELECT pg_try_advisory_lock(763215) AS locked`.execute(connection)).rows[0]!;
      if(row.locked)await sql`SELECT pg_advisory_unlock(763215)`.execute(connection);return row.locked;
    });expect(free).toBe(true);
  }finally{release();await fence;await ticking;vi.stubEnv('NEXUS_HOSTED_BETA','off');}
});
it('starts a scheduled occurrence while another execution holds the same flow dispatch read fence',async()=>{
  const f=await fixture(),at=new Date(Math.ceil((f.clock.now.getTime()+1000)/60000)*60000);
  const definition:FlowDefinition={...f.definition,trigger:{kind:'schedule',schedule:{kind:'once',at:{date:at.toISOString().slice(0,10),time:at.toISOString().slice(11,16),timeZone:'UTC'}}}};
  const saved=await f.service.save(f.scope,actor,{definition,expectedRevision:1,requestId:randomUUID()});for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await f.service.check(f.scope,actor,definition.id,2,kind);
  await f.service.enable(f.scope,actor,definition.id,{revision:2,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()});f.clock.now=at;
  let signal!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{signal=resolve;}),finished=new Promise<void>(resolve=>{release=resolve;});
  const effect=db.transaction().execute(async tx=>{await sql`SELECT id FROM automation_flows WHERE ${tenant(f.scope)} AND id=${definition.id} FOR SHARE`.execute(tx);signal();await finished;});
  await entered;
  try {
    const scheduler=new AutomationScheduler(db,f.service,()=>at);
    const result=await Promise.race([scheduler.dispatch(f.scope,definition.id,2,at.toISOString()),delay(2000).then(()=>{throw new Error('SCHEDULE_BLOCKED_BY_EFFECT');})]);
    expect(result.state).toBe('STARTED');
    const scheduled=(await sql<{actor_hash:string;actor_ciphertext:string}>`SELECT actor_hash,actor_ciphertext FROM automation_runs WHERE ${tenant(f.scope)}`.execute(db)).rows[0];
    expect(scheduled).toEqual({actor_hash:actor.key,actor_ciphertext:actor.encryptedUserId});
  }finally{release();await effect;}
});
it('uses the actual wait-start clock after an earlier slow external action',async()=>{
  const f=await fixture([send(),{kind:'wait',id:'after-send',duration:{kind:'literal',type:'Duration',value:1}}]);
  const run=await f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID()});let completedAt=0;
  f.adapter.execute=async()=>{await delay(40);completedAt=Date.now();return {state:'SUCCEEDED'};};
  await processAlpha15AutomationRuns(db,f.adapter,f.service.options);
  const saved=await f.service.store.run(f.scope,run.id);expect(saved!.status).toBe('WAITING');expect(saved!.wake_at!.getTime()>=completedAt+1000).toBe(true);
});
