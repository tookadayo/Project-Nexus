import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,migrate,ensureGuild,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import type {Actor} from '../../packages/settings/src/index';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationRuntime,type AutomationRuntimeAdapter} from '../../packages/automation/src/runtime';
import {automationDispatchCheckpoint} from '../../packages/automation/src/store';
import type {FlowDefinition,Statement,ValueInput} from '../../packages/automation/src/types';
import type {AutomationAdmissionLimits} from '../../packages/automation/src/quota';
import {isolatedPostgres} from '../fixtures/postgres';

let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const channel='884222222222222222';
const admission:AutomationAdmissionLimits={activeFlows:20,monthlyRuns:100,guildConcurrent:2,globalConcurrent:4,guildPending:20,globalPending:200,measurementId:'isolated-synthetic-tests'};
const actor:Actor={key:'synthetic-loop-admin',encryptedUserId:'encrypted-synthetic-identity',permissions:'8',roles:[],source:'WEB_DASHBOARD',requestId:'synthetic-loop'};
const literal=(type:'Number'|'Boolean'|'ConditionResult'|'Duration'|'Instant',value:number|boolean|string):ValueInput=>({kind:'literal',type,value});
const loop=(overrides:Partial<Extract<Statement,{kind:'boundedLoop'}>>={}):Extract<Statement,{kind:'boundedLoop'}>=>({id:'loop',kind:'boundedLoop',semanticVersion:1,mode:'until',maxBody:literal('Number',3),condition:literal('Boolean',false),until:literal('Instant',new Date(Date.now()+86400000).toISOString()),body:[],handlers:{},...overrides});
function send(id:string):Statement{return {id,kind:'action',operation:'discord.sendMessage',inputs:{channel:{kind:'literal',type:'ChannelRef',value:{id:channel,guildId:'placeholder'}},content:{kind:'literal',type:'PlainText',value:'Synthetic fixture; adapter sends nothing'}}};}
beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});
async function fixture(body:Statement[],extra:Partial<FlowDefinition>={}){
  const scope=scopeForGuild(String(883000000000000000n+BigInt(++serial)));await ensureGuild(db,scope);
  const clock={now:new Date()},calls:string[]=[];
  const fix=(value:unknown):unknown=>Array.isArray(value)?value.map(fix):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='guildId'&&item==='placeholder'?scope.guildId:fix(item)])):value;
  const definition:FlowDefinition={schemaVersion:1,semanticProfile:'scratch.v1',id:'scratch-loop-'+serial,name:'Synthetic loop',guildId:scope.guildId,trigger:{kind:'manual',inputs:[]},targets:{channelIds:[channel],roleIds:[],parentCategoryIds:[]},variables:[],body:fix(body) as Statement[],...extra};
  const service=new AutomationService(db,{admission,now:()=>clock.now,authorize:async()=>{},adoptedActions:new Set(['discord.sendMessage'])});
  const saved=await service.save(scope,actor,{definition,expectedRevision:0,requestId:randomUUID()});expect(saved.validation.issues).toEqual([]);
  // This suite isolates the runtime. Public validation/test/impact activation is
  // covered by separate service tests; these are private synthetic database rows.
  await sql`UPDATE automation_flows SET state='ACTIVE',active_revision=1 WHERE ${tenant(scope)} AND id=${definition.id}`.execute(db);
  const adapter:AutomationRuntimeAdapter={authorize:async()=>{},execute:async context=>{calls.push(context.identity);return {state:'SUCCEEDED'};}};
  const runtime=new AutomationRuntime(db,{admission,adapter,now:()=>clock.now});
  const run=await service.start(scope,actor,definition.id,{requestId:randomUUID()});
  return {scope,service,runtime,adapter,clock,run,calls,definition};
}
async function claim(f:Awaited<ReturnType<typeof fixture>>,identity:string,deadline?:Date,now=f.clock.now){const saved=(await f.service.store.run(f.scope,f.run.id))!;return f.runtime.store.beginOperation(f.scope,f.run.id,identity,'discord.sendMessage','synthetic',deadline,now,automationDispatchCheckpoint(saved.resume));}
it.each(['save','cancel'] as const)('finishes %s at the checkpoint byte ceiling when the CAS version grows a digit',async operation=>{
  const f=await fixture([{id:'end',kind:'end'}]);
  const saved=(await f.service.store.run(f.scope,f.run.id))!;
  saved.resume.checkpointVersion=9;
  saved.resume.variables.private={type:'PlainText',value:'',provenance:[]};
  saved.resume.variables.private.value='x'.repeat(65536-Buffer.byteLength(JSON.stringify(saved.resume)));
  expect(Buffer.byteLength(JSON.stringify(saved.resume))).toBe(65536);
  await sql`UPDATE automation_runs SET resume=${JSON.stringify(saved.resume)}::jsonb WHERE ${tenant(f.scope)} AND id=${f.run.id}::uuid`.execute(db);
  if(operation==='save')await f.service.store.save(f.scope,f.run.id,saved.resume,'COMPLETED',null,null,f.clock.now);
  else await f.service.store.cancel(f.scope,f.run.id,f.clock.now);
  const terminal=(await f.service.store.run(f.scope,f.run.id))!;
  expect(terminal.status).toBe(operation==='save'?'COMPLETED':'CANCELLED');
  expect(terminal.resume.checkpointVersion).toBe(10);
  expect(terminal.resume.semanticProfile).toBe('scratch.v1');
  expect(terminal.resume.variables).toEqual({});
  expect(Buffer.byteLength(JSON.stringify(terminal.resume))).toBeLessThanOrEqual(65536);
  expect(terminal.ended_at).not.toBeNull();
});
it.each([['until',true,'COMPLETED',1],['until',false,'FAILED',0],['while',false,'COMPLETED',1],['while',true,'FAILED',0]] as const)('S001-S003 %s N=0 guard %s => %s',async(mode,condition,status,calls)=>{
  const f=await fixture([loop({mode,maxBody:literal('Number',0),condition:literal('Boolean',condition)}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:status});expect(f.calls).toHaveLength(calls);
});
it('S004-S005 charges N+1 guards, permits final success, and never executes an extra body',async()=>{
  const counter:Statement={id:'declare',kind:'declare',variable:{id:'count',name:'Count',type:'Number'},value:literal('Number',0)};
  const increment:Statement={id:'increment',kind:'assign',variableId:'count',value:{kind:'expression',type:'Number',expression:{operator:'number.add',args:[{kind:'variable',type:'Number',variableId:'count'},literal('Number',1)]}}};
  const condition:ValueInput={kind:'expression',type:'Boolean',expression:{operator:'compare.equal',args:[{kind:'variable',type:'Number',variableId:'count'},literal('Number',3)]}};
  const success=await fixture([counter,loop({condition,body:[increment]}),send('after')]);
  expect(await success.runtime.tick(success.scope,success.run.id)).toMatchObject({state:'COMPLETED'});expect(success.calls).toHaveLength(1);
  const exhausted=await fixture([counter,loop({body:[increment],handlers:{limit:[send('limit')]}}),send('after')]);
  expect(await exhausted.runtime.tick(exhausted.scope,exhausted.run.id)).toMatchObject({state:'FAILED'});expect(exhausted.calls).toHaveLength(1);
  const saved=(await exhausted.service.store.run(exhausted.scope,exhausted.run.id))!;
  expect(saved.reason).toBe('LOOP_LIMIT_REACHED');expect(saved.resume.variables.count!.value).toBe(3);
});
it('S006/S011 selects unknown notification once, ends unsuccessfully, and never falls through',async()=>{
  const f=await fixture([loop({condition:literal('ConditionResult','unknown'),body:[send('body')],handlers:{conditionUnknown:[send('unknown')],limit:[send('limit')]}}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(1);
  expect((await f.service.store.run(f.scope,f.run.id))!.reason).toBe('LOOP_CONDITION_UNKNOWN');
  await f.runtime.tick(f.scope,f.run.id);expect(f.calls).toHaveLength(1);
});
it('S008 distinguishes break from continue and counts a continued body once',async()=>{
  const broken=await fixture([loop({body:[{id:'break',kind:'break'}]}),send('after')]);
  expect(await broken.runtime.tick(broken.scope,broken.run.id)).toMatchObject({state:'COMPLETED'});expect(broken.calls).toHaveLength(1);
  const continued=await fixture([loop({body:[{id:'continue',kind:'continue'}],handlers:{limit:[send('limit')]}}),send('after')]);
  expect(await continued.runtime.tick(continued.scope,continued.run.id)).toMatchObject({state:'FAILED'});expect(continued.calls).toHaveLength(1);
});
it('S020 persists the selected handler PC across a wait and worker restart',async()=>{
  const f=await fixture([loop({maxBody:literal('Number',0),handlers:{limit:[{id:'wait',kind:'wait',duration:literal('Duration',10)},send('handler')]}}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});
  const waiting=(await f.service.store.run(f.scope,f.run.id))!;expect(waiting.resume.loopTermination?.reason).toBe('limit_reached');
  f.clock.now=new Date(f.clock.now.getTime()+11000);
  const restarted=new AutomationRuntime(db,{admission,adapter:f.adapter,now:()=>f.clock.now});
  expect(await restarted.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(1);
});
it('S015 gives a Run expiry precedence over a simultaneous local deadline and wake',async()=>{
  const f=await fixture([loop({until:literal('Instant',new Date(Date.now()+3600000).toISOString()),body:[{id:'wait',kind:'wait',duration:literal('Duration',1)}],handlers:{localDeadline:[{id:'deadline',kind:'end'}]}})]);
  expect(await f.runtime.tick(f.scope,f.run.id,2)).toMatchObject({state:'RUNNING'});
  const saved=(await f.service.store.run(f.scope,f.run.id))!;
  const local=saved.resume.frames.find(frame=>frame.boundedLoop)!.boundedLoop!.deadline!;
  await sql`UPDATE automation_runs SET deadline_at=${new Date(local)},wake_at=${new Date(local)} WHERE ${tenant(f.scope)} AND id=${f.run.id}::uuid`.execute(db);
  f.clock.now=new Date(local);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'EXPIRED'});expect(f.calls).toHaveLength(0);
  expect((await f.service.store.run(f.scope,f.run.id))!.resume.loopTermination).toBeUndefined();
});
it('S017 stops an ambiguous operation before any handler or later iteration',async()=>{
  const f=await fixture([loop({body:[send('body')],handlers:{evaluationError:[send('error')],limit:[send('limit')]}}),send('after')]);
  f.adapter.execute=async context=>{f.calls.push(context.identity);return {state:'UNKNOWN',code:'SYNTHETIC_UNKNOWN'};};
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'UNKNOWN'});expect(f.calls).toHaveLength(1);
});
it('S019 freezes parallel siblings while the selected terminal handler waits and completes',async()=>{
  const f=await fixture([{id:'parallel',kind:'parallel',branches:[{id:'a',name:'A',body:[loop({maxBody:literal('Number',0),handlers:{limit:[{id:'wait',kind:'wait',duration:literal('Duration',10)},send('handler')]}})]},{id:'b',name:'B',body:[{id:'sibling-wait',kind:'wait',duration:literal('Duration',2)},send('sibling')]}]},send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});f.clock.now=new Date(f.clock.now.getTime()+11000);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(1);
});
it('S023 preserves the legacy CT01 empty-unknown join even in a new flow',async()=>{
  const f=await fixture([{id:'branch',kind:'branch',condition:literal('ConditionResult','unknown'),then:[],otherwise:[],unknown:[]},send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toHaveLength(1);
});
it('S007 selects evaluationError for a dynamic guard failure without converting it to unknown',async()=>{
  const setup:Statement={id:'declare',kind:'declare',variable:{id:'zero',name:'Zero',type:'Number'},value:literal('Number',0)};
  const condition:ValueInput={kind:'expression',type:'Boolean',expression:{operator:'compare.greater',args:[{kind:'expression',type:'Number',expression:{operator:'number.divide',args:[literal('Number',1),{kind:'variable',type:'Number',variableId:'zero'}]}},literal('Number',0)]}};
  const f=await fixture([setup,loop({condition,handlers:{evaluationError:[send('error')],conditionUnknown:[send('unknown')]}}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(1);
  expect((await f.service.store.run(f.scope,f.run.id))!.reason).toBe('LOOP_EVALUATION_FAILED');
});
it('S014 selects only the outer deadline owner and unwinds an inner waiting body',async()=>{
  const deadline=new Date(Date.now()+10000).toISOString();
  const f=await fixture([loop({id:'outer',until:literal('Instant',deadline),body:[loop({id:'inner',until:literal('Instant',deadline),body:[{id:'wait',kind:'wait',duration:literal('Duration',1)}],handlers:{localDeadline:[{id:'inner-end',kind:'end'}]}})],handlers:{localDeadline:[{id:'outer-end',kind:'end'}]}}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});f.clock.now=new Date(deadline);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(0);
  const events=(await sql<{block_id:string;code:string}>`SELECT block_id,code FROM automation_run_events WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid AND state='LOOP_HANDLER'`.execute(db)).rows;
  expect(events).toEqual([{block_id:'outer',code:'LOCAL_DEADLINE'}]);
});
it('S016 cancels a waiting terminal handler without starting its notification',async()=>{
  const f=await fixture([loop({maxBody:literal('Number',0),handlers:{limit:[{id:'wait',kind:'wait',duration:literal('Duration',10)},send('handler')]}})]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});
  await f.service.store.cancel(f.scope,f.run.id,f.clock.now);
  f.clock.now=new Date(f.clock.now.getTime()+11000);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'CANCELLED'});expect(f.calls).toHaveLength(0);
  expect((await f.service.store.run(f.scope,f.run.id))!.resume.loopTermination?.reason).toBe('limit_reached');
});
it('S007 resumes a selected evaluation-error handler without redoing a failing body',async()=>{
  const setup:Statement={id:'declare',kind:'declare',variable:{id:'zero',name:'Zero',type:'Number'},value:literal('Number',0)};
  const failed:Statement={id:'failed',kind:'declare',variable:{id:'invalid',name:'Invalid',type:'Number'},value:{kind:'expression',type:'Number',expression:{operator:'number.divide',args:[literal('Number',1),{kind:'variable',type:'Number',variableId:'zero'}]}}};
  const f=await fixture([setup,loop({body:[failed],handlers:{evaluationError:[send('error')]}}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'RUNNING'});
  expect((await f.service.store.run(f.scope,f.run.id))!.resume.loopTermination?.reason).toBe('evaluation_failed');
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(1);
});
it('S009 returns from a procedure inside a loop without running its following steps',async()=>{
  const f=await fixture([{id:'call',kind:'call',procedureId:'child',revision:1,args:{},outputs:{answer:{id:'result',name:'Result',type:'Number'}}},send('after')],{procedures:[{id:'child',revision:1,name:'Child',inputs:[],outputs:[{id:'answer',name:'Answer',type:'Number'}],body:[loop({body:[{id:'return',kind:'return',values:{answer:literal('Number',7)}}]}),{id:'fallback',kind:'return',values:{answer:literal('Number',9)}}]}]});
  expect(await f.runtime.tick(f.scope,f.run.id,4)).toMatchObject({state:'RUNNING'});
  expect((await f.service.store.run(f.scope,f.run.id))!.resume.variables.result!.value).toBe(7);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toHaveLength(1);
});
it('S012 checks current authorization independently before a condition-unknown handler',async()=>{
  const f=await fixture([loop({condition:literal('ConditionResult','unknown'),handlers:{conditionUnknown:[send('handler')]}})]);
  f.adapter.authorize=async()=>{if((await f.service.store.run(f.scope,f.run.id))!.resume.loopTermination)throw new Error('AUTOMATION_PERMISSION_DENIED');};
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(0);
});
it('S016 preserves the original failure when a shared evaluation budget stops the handler',async()=>{
  const f=await fixture([loop({maxBody:literal('Number',0),handlers:{limit:[{id:'wait',kind:'wait',duration:literal('Duration',1)},send('handler')]}})]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});
  const before=(await f.service.store.run(f.scope,f.run.id))!;before.resume.evaluations=5000;
  await f.service.store.save(f.scope,f.run.id,before.resume,'WAITING',before.wake_at);
  f.clock.now=new Date(f.clock.now.getTime()+1100);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(0);
  const saved=(await f.service.store.run(f.scope,f.run.id))!;
  expect(saved.resume.loopTermination?.reason).toBe('limit_reached');expect(saved.reason).toMatch(/LIMIT|BUDGET/);
});
it('S018 retains original and handler-failed codes and never calls another handler',async()=>{
  const setup:Statement={id:'declare',kind:'declare',variable:{id:'zero',name:'Zero',type:'Number'},value:literal('Number',0)};
  const failed:Statement={id:'failed',kind:'declare',variable:{id:'invalid',name:'Invalid',type:'Number'},value:{kind:'expression',type:'Number',expression:{operator:'number.divide',args:[literal('Number',1),{kind:'variable',type:'Number',variableId:'zero'}]}}};
  const f=await fixture([setup,loop({maxBody:literal('Number',0),handlers:{limit:[failed],evaluationError:[send('error')]}}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(0);
  const saved=(await f.service.store.run(f.scope,f.run.id))!;
  expect(saved.resume.loopTermination).toMatchObject({reason:'limit_reached',diagnostics:expect.arrayContaining(['HANDLER_FAILED'])});
});
it('S019 gives a just-started external operation precedence over selecting a loop handler',async()=>{
  const f=await fixture([loop({maxBody:literal('Number',0),handlers:{limit:[send('handler')]}})]);let checks=0;
  f.adapter.authorize=async()=>{if(++checks===2)await claim(f,'synthetic-in-flight');};
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'UNKNOWN'});expect(f.calls).toHaveLength(0);
  expect((await f.service.store.run(f.scope,f.run.id))!.reason).toBe('UNRESOLVED_EXTERNAL_RESULT');
});
it('T120 selects found/notFound and never fabricates an index for absent results',async()=>{
  const resultType={kind:'Record' as const,schemaId:'nexus.index-result.v1'};
  for(const sought of [2,4]){
    const result:ValueInput={kind:'expression',type:resultType,expression:{operator:'list.indexOf',args:[{kind:'literal',type:{kind:'List',element:'Number'},value:[1,2,3]},literal('Number',sought)]}};
    const f=await fixture([{id:'search',kind:'searchBranch',value:result,index:{id:'index',name:'Index',type:'Number'},found:[send('found')],notFound:[]},send('after')]);
    expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toHaveLength(sought===2?2:1);
  }
});
it('T117 rejects a wait past the fixed local deadline while still within seven days',async()=>{
  const f=await fixture([loop({until:literal('Instant',new Date(Date.now()+3600000).toISOString()),body:[{id:'too-long',kind:'wait',duration:literal('Duration',7200)}],handlers:{evaluationError:[send('error')]}}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'RUNNING'});
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(1);
  const saved=(await f.service.store.run(f.scope,f.run.id))!;expect(saved.wake_at).toBeNull();expect(saved.reason).toBe('LOOP_EVALUATION_FAILED');
});
it('T118 inherits a loop deadline through a child procedure and unwinds its waiting frame',async()=>{
  const deadline=new Date(Date.now()+10000).toISOString();
  const f=await fixture([loop({until:literal('Instant',deadline),body:[{id:'call',kind:'call',procedureId:'child',revision:1,args:{},outputs:{}}],handlers:{localDeadline:[{id:'handler',kind:'end'}]}}),send('after')],{procedures:[{id:'child',revision:1,name:'Child',inputs:[],outputs:[],body:[{id:'wait',kind:'wait',duration:literal('Duration',1)},{id:'return',kind:'return',values:{}}]}]});
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});f.clock.now=new Date(deadline);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(0);
  const saved=(await f.service.store.run(f.scope,f.run.id))!;expect(saved.reason).toBe('LOOP_LOCAL_DEADLINE');expect(saved.resume.frames.some(frame=>frame.call)).toBe(false);
});
it('S015 rechecks the current Run deadline when committing an otherwise completed new-profile checkpoint',async()=>{
  const f=await fixture([{id:'end',kind:'end'}]),saved=(await f.service.store.run(f.scope,f.run.id))!,staleNow=f.clock.now;
  f.clock.now=new Date(saved.deadline_at);
  await f.runtime.store.save(f.scope,f.run.id,saved.resume,'COMPLETED',null,null,staleNow);
  const terminal=(await f.service.store.run(f.scope,f.run.id))!;
  expect(terminal.status).toBe('EXPIRED');expect(terminal.ended_at!.toISOString()).toBe(f.clock.now.toISOString());expect(f.calls).toHaveLength(0);
});
it('S017 keeps an in-flight dispatch UNKNOWN ahead of a concurrent completion and deadline',async()=>{
  const f=await fixture([{id:'end',kind:'end'}]),saved=(await f.service.store.run(f.scope,f.run.id))!,staleNow=f.clock.now;
  await claim(f,'synthetic-pending-at-expiry');
  f.clock.now=new Date(saved.deadline_at);
  await f.runtime.store.save(f.scope,f.run.id,saved.resume,'COMPLETED',null,null,staleNow);
  const terminal=(await f.service.store.run(f.scope,f.run.id))!;
  expect(terminal.status).toBe('UNKNOWN');expect(terminal.ended_at!.toISOString()).toBe(f.clock.now.toISOString());expect(f.calls).toHaveLength(0);
  expect((await sql`SELECT state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(db)).rows).toEqual([{state:'STARTED'}]);
});
it('S007 routes a failing parallel child to the enclosing loop handler and freezes its siblings',async()=>{
  const setup:Statement={id:'declare',kind:'declare',variable:{id:'zero',name:'Zero',type:'Number'},value:literal('Number',0)};
  const failed:Statement={id:'failed',kind:'declare',variable:{id:'invalid',name:'Invalid',type:'Number'},value:{kind:'expression',type:'Number',expression:{operator:'number.divide',args:[literal('Number',1),{kind:'variable',type:'Number',variableId:'zero'}]}}};
  const f=await fixture([setup,loop({body:[{id:'parallel',kind:'parallel',branches:[{id:'a',name:'A',body:[failed]},{id:'b',name:'B',body:[send('sibling')]}]}],handlers:{evaluationError:[send('error')]}}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'RUNNING'});
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(1);
  expect((await f.service.store.run(f.scope,f.run.id))!.reason).toBe('LOOP_EVALUATION_FAILED');
});
it('S018 does not recursively enter another failure handler inside an already selected terminal handler',async()=>{
  const f=await fixture([loop({maxBody:literal('Number',0),handlers:{limit:[loop({id:'handler-loop',maxBody:literal('Number',0),handlers:{limit:[send('nested-handler')]}})]}}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(0);
  expect((await f.service.store.run(f.scope,f.run.id))!.resume.loopTermination).toMatchObject({reason:'limit_reached',diagnostics:expect.arrayContaining(['HANDLER_FAILED'])});
});
it('S015 checks a local dispatch deadline with the current transaction clock',async()=>{
  const f=await fixture([{id:'end',kind:'end'}]),staleNow=f.clock.now,effective=new Date(staleNow.getTime()+1000);
  f.clock.now=effective;
  await expect(claim(f,'expired-local-dispatch',effective,staleNow)).rejects.toThrow('AUTOMATION_LOCAL_DEADLINE');
  expect((await sql`SELECT identity FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(db)).rows).toEqual([]);
});
it('fixes variable/computed maxBody once on entry without adopting later variable changes',async()=>{
  for(const kind of ['variable','expression'] as const){
    const bound:ValueInput=kind==='variable'?{kind:'variable',type:'Number',variableId:'n'}:{kind:'expression',type:'Number',expression:{operator:'number.divide',args:[{kind:'variable',type:'Number',variableId:'n'},literal('Number',1)]}};
    const f=await fixture([{id:'bound',kind:'declare',variable:{id:'n',name:'Maximum',type:'Number'},value:literal('Number',3)},loop({maxBody:bound,body:[{id:'change-bound',kind:'assign',variableId:'n',value:literal('Number',100)},send('body')],handlers:{limit:[send('handler')]}}),send('after')]);
    expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(4);
    expect((await f.service.store.run(f.scope,f.run.id))!.reason).toBe('LOOP_LIMIT_REACHED');
  }
});
it('T111 ends only the nearest branch, publishes its output and still joins its sibling',async()=>{
  const f=await fixture([{id:'target',kind:'declare',variable:{id:'joined',name:'Joined',type:'Number'},value:literal('Number',0)},{id:'parallel',kind:'parallel',branches:[{id:'a',name:'A',body:[{id:'local',kind:'declare',variable:{id:'answer',name:'Answer',type:'Number'},value:literal('Number',7)},{id:'branch-end',kind:'endBranch',semanticVersion:1}],outputs:{answer:{kind:'variable',type:'Number',variableId:'answer'}}},{id:'b',name:'B',body:[send('sibling')]}],outputs:{joined:{branchId:'a',outputId:'answer'}}},send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toHaveLength(2);
});
it('T111 explicitly ends a Run from a child and leaves an independent Run active',async()=>{
  const f=await fixture([{id:'parallel',kind:'parallel',branches:[{id:'a',name:'A',body:[{id:'run-end',kind:'endRun',semanticVersion:1}]},{id:'b',name:'B',body:[send('sibling')]}]},send('after')]);
  const other=await fixture([{id:'wait',kind:'wait',duration:literal('Duration',10)}]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toHaveLength(0);
  expect((await other.service.store.run(other.scope,other.run.id))!.ended_at).toBeNull();
});
it('T111 cannot use explicit EndRun to escape a non-success terminal handler',async()=>{
  const f=await fixture([loop({maxBody:literal('Number',0),handlers:{limit:[{id:'run-end',kind:'endRun',semanticVersion:1}]}}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(0);
  expect((await f.service.store.run(f.scope,f.run.id))!.reason).toBe('LOOP_LIMIT_REACHED');
});
it.each(['guard','break','return','endRun'] as const)('S014 commits local expiry ahead of a %s frame pop',async mode=>{
  const deadline=new Date(Date.now()+10000).toISOString();
  const body:Statement[]=mode==='break'?[{id:'break',kind:'break'}]:mode==='return'?[{id:'return',kind:'return',values:{}}]:mode==='endRun'?[{id:'end-run',kind:'endRun',semanticVersion:1}]:[];
  const node=loop({until:literal('Instant',deadline),condition:literal('Boolean',mode==='guard'),body,handlers:{localDeadline:[{id:'deadline-end',kind:'end'}]}});
  const f=mode==='return'?await fixture([{id:'call',kind:'call',procedureId:'child',revision:1,args:{},outputs:{}},send('after')],{procedures:[{id:'child',revision:1,name:'Child',inputs:[],outputs:[],body:[node,{id:'fallback',kind:'return',values:{}}]}]}):await fixture([node,send('after')]);
  let injected=false;const save=f.runtime.store.save.bind(f.runtime.store);
  vi.spyOn(f.runtime.store,'save').mockImplementation(async(...args)=>{
    const before=(await f.service.store.run(f.scope,f.run.id))!;
    if(!injected&&before.resume.frames.some(frame=>frame.boundedLoop)&&!args[2].frames.some(frame=>frame.boundedLoop)&&!args[2].loopTermination){injected=true;f.clock.now=new Date(deadline);}
    return save(...args);
  });
  for(let attempt=0;attempt<4;attempt++){await f.runtime.tick(f.scope,f.run.id);if((await f.service.store.run(f.scope,f.run.id))!.ended_at)break;}
  expect(injected).toBe(true);const result=(await f.service.store.run(f.scope,f.run.id))!;
  expect(result.status).toBe('FAILED');expect(result.reason).toBe('LOOP_LOCAL_DEADLINE');expect(f.calls).toHaveLength(0);
});
it('S007 routes a dynamic integer constraint failure in the body to evaluationError',async()=>{
  const f=await fixture([{id:'fraction',kind:'declare',variable:{id:'n',name:'Fraction',type:'Number'},value:literal('Number',0.5)},loop({body:[{id:'repeat',kind:'repeat',count:{kind:'variable',type:'Number',variableId:'n'},itemVariable:{id:'item',name:'Item',type:'Number'},body:[]}],handlers:{evaluationError:[send('error')]}}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'RUNNING'});
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toHaveLength(1);
});
it('S014 checks a surviving ancestor after discharging an inner local deadline at commit',async()=>{
  const innerAt=new Date(Date.now()+10000).toISOString(),outerAt=new Date(Date.now()+20000).toISOString();
  const f=await fixture([loop({id:'outer',until:literal('Instant',outerAt),body:[loop({id:'inner',until:literal('Instant',innerAt),body:[{id:'wait',kind:'wait',duration:literal('Duration',1)}],handlers:{localDeadline:[{id:'inner-end',kind:'end'}]}})],handlers:{localDeadline:[{id:'outer-end',kind:'end'}]}}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});f.clock.now=new Date(innerAt);
  let injected=false;const save=f.runtime.store.save.bind(f.runtime.store);
  vi.spyOn(f.runtime.store,'save').mockImplementation(async(...args)=>{if(!injected&&args[2].loopTermination?.handlerPath==='body/0/body/0/handlers/localDeadline'){injected=true;f.clock.now=new Date(outerAt);}return save(...args);});
  for(let attempt=0;attempt<4;attempt++){await f.runtime.tick(f.scope,f.run.id);if((await f.service.store.run(f.scope,f.run.id))!.ended_at)break;}
  const result=(await f.service.store.run(f.scope,f.run.id))!;
  expect(result.status).toBe('FAILED');expect(result.resume.loopTermination?.handlerPath).toBe('body/0/handlers/localDeadline');expect(f.calls).toHaveLength(0);
});
it('S020 commits increasing checkpoint versions and rejects a stale ordinary transition',async()=>{
  const f=await fixture([{id:'wait',kind:'wait',duration:literal('Duration',1)}]),initial=(await f.service.store.run(f.scope,f.run.id))!;
  const first=structuredClone(initial.resume),stale=structuredClone(initial.resume);
  await f.runtime.store.save(f.scope,f.run.id,first,'RUNNING');
  expect(first.checkpointVersion).toBe((initial.resume.checkpointVersion??0)+1);
  await expect(f.runtime.store.save(f.scope,f.run.id,stale,'COMPLETED')).rejects.toThrow('AUTOMATION_CHECKPOINT_CONFLICT');
  const saved=(await f.service.store.run(f.scope,f.run.id))!;expect(saved.status).toBe('RUNNING');expect(saved.ended_at).toBeNull();expect(saved.resume.checkpointVersion).toBe(first.checkpointVersion);
});
it('S019 rejects a stale version or terminal-handler identity before creating a dispatch claim',async()=>{
  const f=await fixture([{id:'end',kind:'end'}]),initial=(await f.service.store.run(f.scope,f.run.id))!,token=automationDispatchCheckpoint(initial.resume);
  await f.runtime.store.save(f.scope,f.run.id,initial.resume,'RUNNING');
  await expect(f.runtime.store.beginOperation(f.scope,f.run.id,'stale-dispatch','discord.sendMessage','synthetic',undefined,f.clock.now,token)).rejects.toThrow('AUTOMATION_CHECKPOINT_CONFLICT');
  const latest=(await f.service.store.run(f.scope,f.run.id))!;
  await expect(f.runtime.store.beginOperation(f.scope,f.run.id,'wrong-handler','discord.sendMessage','synthetic',undefined,f.clock.now,{...automationDispatchCheckpoint(latest.resume),terminationIdentity:'f'.repeat(64)})).rejects.toThrow('AUTOMATION_CHECKPOINT_CONFLICT');
  expect((await sql`SELECT identity FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(db)).rows).toEqual([]);
});
it('T097 resumes the same conditional-loop body PC after a worker restart without double addition',async()=>{
  const add=(id:string):Statement=>({id,kind:'assign',variableId:'count',value:{kind:'expression',type:'Number',expression:{operator:'number.add',args:[{kind:'variable',type:'Number',variableId:'count'},literal('Number',1)]}}});
  const condition:ValueInput={kind:'expression',type:'Boolean',expression:{operator:'compare.greaterOrEqual',args:[{kind:'variable',type:'Number',variableId:'count'},literal('Number',4)]}};
  const f=await fixture([{id:'count',kind:'declare',variable:{id:'count',name:'Count',type:'Number'},value:literal('Number',0)},loop({maxBody:literal('Number',2),condition,body:[add('before'),{id:'wait',kind:'wait',duration:literal('Duration',1)},add('after-wait')]}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});
  const first=(await f.service.store.run(f.scope,f.run.id))!;expect(first.resume.variables.count!.value).toBe(1);expect(first.resume.frames.at(-1)).toMatchObject({index:2,boundedLoop:{completed:0,phase:'body'}});
  f.clock.now=new Date(f.clock.now.getTime()+1100);const restarted=new AutomationRuntime(db,{admission,adapter:f.adapter,now:()=>f.clock.now});
  expect(await restarted.tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});expect((await f.service.store.run(f.scope,f.run.id))!.resume.variables.count!.value).toBe(3);
  f.clock.now=new Date(f.clock.now.getTime()+1100);expect(await restarted.tick(f.scope,f.run.id,1)).toMatchObject({state:'RUNNING'});expect((await f.service.store.run(f.scope,f.run.id))!.resume.variables.count!.value).toBe(4);
  expect(await restarted.tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toHaveLength(1);
});
it('S014 discharges multiple expired owners without recurring forever in the first handler',async()=>{
  const times=[10,20,30].map(seconds=>new Date(Date.now()+seconds*1000).toISOString());
  const inner=loop({id:'inner',until:literal('Instant',times[0]!),body:[{id:'wait',kind:'wait',duration:literal('Duration',1)}],handlers:{localDeadline:[{id:'inner-end',kind:'end'}]}});
  const middle=loop({id:'middle',until:literal('Instant',times[1]!),body:[inner],handlers:{localDeadline:[{id:'middle-end',kind:'end'}]}});
  const f=await fixture([loop({id:'outer',until:literal('Instant',times[2]!),body:[middle],handlers:{localDeadline:[{id:'outer-end',kind:'end'}]}}),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});f.clock.now=new Date(times[0]!);
  let injected=false;const save=f.runtime.store.save.bind(f.runtime.store);
  vi.spyOn(f.runtime.store,'save').mockImplementation(async(...args)=>{if(!injected&&args[2].loopTermination?.reason==='local_deadline'){injected=true;f.clock.now=new Date(times[2]!);}return save(...args);});
  for(let attempt=0;attempt<4;attempt++){await f.runtime.tick(f.scope,f.run.id);if((await f.service.store.run(f.scope,f.run.id))!.ended_at)break;}
  const result=(await f.service.store.run(f.scope,f.run.id))!;expect(result.status).toBe('FAILED');expect(result.resume.loopTermination?.handlerPath).toBe('body/0/handlers/localDeadline');expect(f.calls).toHaveLength(0);
});
