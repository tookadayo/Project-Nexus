import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,migrate,ensureGuild,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationRuntime,type AutomationRuntimeAdapter} from '../../packages/automation/src/runtime';
import {iterationResultType,iterationRunStatus} from '../../packages/automation/src/iteration-results';
import type {OperationOutcome} from '../../packages/automation/src/store';
import type {Actor} from '../../packages/settings/src/index';
import type {FlowDefinition,Statement,ValueInput,ValueType} from '../../packages/automation/src/types';
import {isolatedPostgres} from '../fixtures/postgres';

let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const guild='GUILD',channel='882222222222222222',message='882333333333333333';
const admission={activeFlows:20,monthlyRuns:100,guildConcurrent:2,globalConcurrent:20,guildPending:20,globalPending:100,measurementId:'isolated-result-tests'};
const actor:Actor={key:'synthetic-result-admin',encryptedUserId:'synthetic-encrypted-identity',permissions:'8',roles:[],source:'WEB_DASHBOARD',requestId:'synthetic'};
beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});
const text=(value:string):ValueInput=>({kind:'literal',type:'PlainText',value});
const trace=(value:string,id=value):Statement=>({kind:'assign',id:'trace-'+id,variableId:'trace',value:text(value)});
function send(id:string,content:ValueInput=text(id)):Extract<Statement,{kind:'action'}>{return {kind:'action',id,operation:'discord.sendMessage',inputs:{channel:{kind:'literal',type:'ChannelRef',value:{id:channel,guildId:guild}},content}};}
const outcomeType:ValueType={kind:'OperationOutcome',value:'MessageRef'};
function branch():Extract<Statement,{kind:'resultBranch'}>{return {kind:'resultBranch',id:'handle',value:{kind:'variable',type:outcomeType,variableId:'operation-result'},output:{id:'success-value',name:'Success',type:'MessageRef'},reason:{id:'reason',name:'Safe reason',type:'PlainText'},succeeded:[trace('success')],failed:[trace('failure')],notStarted:[trace('not-started')],unknown:[trace('unknown-start'),trace('unknown-complete')]};}
function body():Statement[]{const action=send('source');action.outcome={id:'operation-result',name:'Operation result',type:outcomeType};return [{kind:'declare',id:'trace-declare',variable:{id:'trace',name:'Trace',type:'PlainText'},value:text('initial')},action,branch(),send('after',{kind:'variable',type:'PlainText',variableId:'trace'})];}
async function fixture(statements:Statement[]=body(),input='12',procedures:FlowDefinition['procedures']=[]){
  const scope=scopeForGuild(String(882000000000000000n+BigInt(++serial))),clock={now:new Date()},calls:string[]=[];await ensureGuild(db,scope);
  const fix=(value:unknown):unknown=>value===guild?scope.guildId:Array.isArray(value)?value.map(fix):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,fix(item)])):value;
  const definition:FlowDefinition={schemaVersion:1,id:'result-'+serial,guildId:scope.guildId,name:'Synthetic typed results',trigger:{kind:'manual',inputs:[{id:'input',name:'Text input',type:'PlainText'}]},variables:[],targets:{channelIds:[channel],roleIds:[],parentCategoryIds:[]},body:fix(statements) as Statement[],...(procedures.length?{procedures:fix(procedures) as NonNullable<FlowDefinition['procedures']>}:{})};
  const service=new AutomationService(db,{admission,authorize:async()=>{},now:()=>clock.now,adoptedActions:new Set(['discord.sendMessage'])});
  const saved=await service.save(scope,actor,{definition,expectedRevision:0,requestId:randomUUID()});expect(saved.validation.issues).toEqual([]);
  const outputs={source:{type:'MessageRef' as const,value:{id:message,guildId:scope.guildId}}},outcomes={source:'SUCCEEDED' as const,after:'SUCCEEDED' as const,'parsed-success':'SUCCEEDED' as const,'parse-failed':'SUCCEEDED' as const,present:'SUCCEEDED' as const,unset:'SUCCEEDED' as const};
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const){const result=await service.check(scope,actor,definition.id,1,kind,{values:{input:{type:'PlainText',value:'12'}},outcomes,outputs});if(kind==='TEST')expect(result).toMatchObject({status:'COMPLETED'});}
  await service.enable(scope,actor,definition.id,{revision:1,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()});
  const adapter:AutomationRuntimeAdapter={authorize:vi.fn(async()=>{}),execute:vi.fn<AutomationRuntimeAdapter['execute']>(async context=>{calls.push(String(context.inputs.content?.value));return {state:'SUCCEEDED',value:{type:'MessageRef',value:{id:message,guildId:scope.guildId},provenance:[{source:'service',guildId:scope.guildId,resumable:true,allowedChannelIds:[channel]}]}};})};
  const runtime=new AutomationRuntime(db,{admission,adapter,now:()=>clock.now}),run=await service.start(scope,actor,definition.id,{requestId:randomUUID(),values:{input:{type:'PlainText',value:input,provenance:[]}}});
  return {scope,clock,calls,definition,service,adapter,runtime,run};
}
async function record(f:Awaited<ReturnType<typeof fixture>>){return (await f.service.store.run(f.scope,f.run.id))!;}

it.each([['SUCCEEDED','success'],['FAILED','failure'],['NOT_STARTED','not-started']] as const)('uses the explicitly handled %s route with a genuine service outcome',async(state,expected)=>{
  const f=await fixture(),execute=f.adapter.execute;
  f.adapter.execute=vi.fn(async context=>context.identity&&context.inputs.content?.value==='source'&&state!=='SUCCEEDED'?(f.calls.push('source'),{state,code:'SYNTHETIC_CONFIRMED'} as OperationOutcome):execute(context));
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toEqual(['source',expected]);
  expect((await sql<{state:string}>`SELECT state FROM automation_operations WHERE ${tenant(f.scope)} ORDER BY started_at,identity`.execute(db)).rows.map(row=>row.state)).toEqual([state,'SUCCEEDED']);
});
it('runs the pure UNKNOWN handler, preserves its reason, and never performs a later change',async()=>{
  const f=await fixture();f.adapter.execute=vi.fn<AutomationRuntimeAdapter['execute']>(async()=>{f.calls.push('source');return {state:'UNKNOWN',code:'SYNTHETIC_DISCONNECT'};});
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'UNKNOWN'});const saved=await record(f);
  expect(saved.resume.variables.trace!.value).toBe('unknown-complete');expect(saved.resume.uncertainty).toMatchObject({phase:'HANDLING',reason:'SYNTHETIC_DISCONNECT'});expect(saved.resume.externalActions).toBe(1);expect(f.calls).toEqual(['source']);
  await f.runtime.tick(f.scope,f.run.id);expect(f.calls).toEqual(['source']);expect((await sql`SELECT state FROM automation_operations WHERE ${tenant(f.scope)}`.execute(db)).rows).toEqual([{state:'UNKNOWN'}]);
});
it('reconstructs an UNKNOWN outcome after the ledger commits before its captured-result checkpoint',async()=>{
  const f=await fixture();f.adapter.execute=vi.fn<AutomationRuntimeAdapter['execute']>(async()=>({state:'UNKNOWN',code:'SYNTHETIC_DISCONNECT'}));await f.runtime.tick(f.scope,f.run.id,1);
  const save=f.runtime.store.save.bind(f.runtime.store),drop=vi.spyOn(f.runtime.store,'save').mockImplementation(async(...args)=>args[2].uncertainty?undefined:save(...args));
  await f.runtime.tick(f.scope,f.run.id,1);drop.mockRestore();expect((await record(f)).resume.uncertainty).toBeUndefined();expect(f.adapter.execute).toHaveBeenCalledTimes(1);
  vi.mocked(f.adapter.authorize).mockClear();const restarted=new AutomationRuntime(db,{admission,adapter:f.adapter,now:()=>f.clock.now});
  expect(await restarted.tick(f.scope,f.run.id)).toMatchObject({state:'UNKNOWN'});expect((await record(f)).resume.variables.trace!.value).toBe('unknown-complete');expect((await record(f)).resume.externalActions).toBe(1);expect(f.adapter.execute).toHaveBeenCalledTimes(1);expect(f.adapter.authorize).not.toHaveBeenCalled();
});
it('resumes only the remaining pure UNKNOWN handler after a restart and retains uncertainty on cancellation',async()=>{
  const f=await fixture();f.adapter.execute=vi.fn<AutomationRuntimeAdapter['execute']>(async()=>({state:'UNKNOWN',code:'SYNTHETIC_DISCONNECT'}));
  for(let step=0;step<4;step++)await f.runtime.tick(f.scope,f.run.id,1);
  expect((await record(f)).resume.variables.trace!.value).toBe('unknown-start');expect((await record(f)).status).toBe('RUNNING');
  vi.mocked(f.adapter.authorize).mockClear();const restarted=new AutomationRuntime(db,{admission,adapter:f.adapter,now:()=>f.clock.now});expect(await restarted.tick(f.scope,f.run.id)).toMatchObject({state:'UNKNOWN'});expect(f.adapter.execute).toHaveBeenCalledTimes(1);expect(f.adapter.authorize).not.toHaveBeenCalled();
  const c=await fixture();c.adapter.execute=vi.fn<AutomationRuntimeAdapter['execute']>(async()=>({state:'UNKNOWN',code:'SYNTHETIC_DISCONNECT'}));await c.runtime.tick(c.scope,c.run.id,1);await c.runtime.tick(c.scope,c.run.id,1);await c.service.cancel(c.scope,actor,c.run.id,randomUUID());expect(await c.runtime.tick(c.scope,c.run.id)).toMatchObject({state:'UNKNOWN'});expect(c.adapter.execute).toHaveBeenCalledTimes(1);
});
it('does not let another parallel branch resume after an UNKNOWN outcome',async()=>{
  const action=send('source');action.outcome={id:'operation-result',name:'Outcome',type:outcomeType};const handler=branch();handler.succeeded=[];handler.failed=[];handler.notStarted=[];handler.unknown=[{kind:'declare',id:'pure-marker',variable:{id:'pure-marker',name:'Pure marker',type:'PlainText'},value:text('Handled unknown')}];
  const f=await fixture([{kind:'parallel',id:'parallel',branches:[{id:'source-branch',name:'Source',body:[action,handler]},{id:'unrelated',name:'Unrelated',body:[{kind:'wait',id:'later',duration:{kind:'literal',type:'Duration',value:10}},send('after')]}]}]);
  f.adapter.execute=vi.fn<AutomationRuntimeAdapter['execute']>(async()=>({state:'UNKNOWN',code:'SYNTHETIC_DISCONNECT'}));expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'UNKNOWN'});expect(f.adapter.execute).toHaveBeenCalledTimes(1);expect((await record(f)).resume.parallel!.branches[1]!.context.frames[0]!.index).toBe(0);
});
it('executes strict conversion failure and Optional presence through the same saved typed runtime',async()=>{
  const parseType:ValueType={kind:'ParseResult',value:'Number'};
  const f=await fixture([{kind:'resultBranch',id:'parse-branch',value:{kind:'expression',type:parseType,expression:{operator:'value.parse',args:[{kind:'variable',type:'PlainText',variableId:'input'}],options:{conversion:'decimal'}}},output:{id:'parsed',name:'Parsed',type:'Number'},reason:{id:'parse-reason',name:'Reason',type:'PlainText'},succeeded:[send('parsed-success')],failed:[send('parse-failed')],notStarted:[],unknown:[]}],'10abc');
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toEqual(['parse-failed']);
  const p=await fixture([{kind:'optionalBranch',id:'optional',value:{kind:'literal',type:{kind:'Optional',value:'Boolean'},value:{state:'set',value:false}},output:{id:'present-value',name:'Present',type:'Boolean'},present:[send('present')],unset:[send('unset')]}]);expect(await p.runtime.tick(p.scope,p.run.id)).toMatchObject({state:'COMPLETED'});expect(p.calls).toEqual(['present']);
});
it.each(['break','end'] as const)('keeps a handled iteration failure terminal when its handler uses %s',async exit=>{
  const action=send('source');action.outcome={id:'operation-result',name:'Outcome',type:outcomeType};const handle=branch();handle.failed=[{kind:exit,id:'failure-exit'}];
  const f=await fixture([{kind:'declare',id:'trace-declare',variable:{id:'trace',name:'Trace',type:'PlainText'},value:text('initial')},{kind:'repeat',id:'items',count:{kind:'literal',type:'Number',value:2},itemVariable:{id:'item',name:'Item',type:'Number'},body:[action,handle],results:[{output:{id:'item-results',name:'Results',type:{kind:'List',element:iterationResultType('Number')}},value:{kind:'variable',type:'Number',variableId:'item'}}]},send('after')]);
  f.adapter.execute=vi.fn<AutomationRuntimeAdapter['execute']>(async context=>{f.calls.push(String(context.inputs.content?.value));return {state:'FAILED',code:'SYNTHETIC_CONFIRMED'};});
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toEqual(['source']);expect(iterationRunStatus((await record(f)).resume)[0]!.states).toEqual(['FAILED','NOT_STARTED']);
});
it('keeps a handled iteration failure terminal when a procedure handler returns',async()=>{
  const action=send('source');action.outcome={id:'operation-result',name:'Outcome',type:outcomeType};const handle=branch();handle.failed=[{kind:'return',id:'failure-return',values:{}}];
  const f=await fixture([{kind:'call',id:'call',procedureId:'procedure',revision:1,args:{},outputs:{}},send('after')],'12',[{id:'procedure',revision:1,name:'Procedure',inputs:[],outputs:[],body:[{kind:'declare',id:'trace-declare',variable:{id:'trace',name:'Trace',type:'PlainText'},value:text('initial')},{kind:'repeat',id:'items',count:{kind:'literal',type:'Number',value:2},itemVariable:{id:'item',name:'Item',type:'Number'},body:[action,handle],results:[{output:{id:'item-results',name:'Results',type:{kind:'List',element:iterationResultType('Number')}},value:{kind:'variable',type:'Number',variableId:'item'}}]},{kind:'return',id:'normal-return',values:{}}]}]);
  f.adapter.execute=vi.fn<AutomationRuntimeAdapter['execute']>(async context=>{f.calls.push(String(context.inputs.content?.value));return {state:'FAILED',code:'SYNTHETIC_CONFIRMED'};});
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toEqual(['source']);expect(iterationRunStatus((await record(f)).resume)[0]!.states).toEqual(['FAILED','NOT_STARTED']);
});
