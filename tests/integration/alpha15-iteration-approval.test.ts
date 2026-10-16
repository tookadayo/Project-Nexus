import {createHash,randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,migrate,ensureGuild,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationRuntime,type AutomationRuntimeAdapter} from '../../packages/automation/src/runtime';
import {verifyAutomationApproval,fingerprint} from '../../packages/automation/src/store';
import {iterationResultType,iterationRunStatus} from '../../packages/automation/src/iteration-results';
import type {FlowDefinition,Statement,ValueInput} from '../../packages/automation/src/types';
import {compileFlowDefinition,validateFlowDefinition} from '../../packages/automation/src/definition';
import {simulateAutomationPlan} from '../../packages/automation/src/simulation';
import {isolatedPostgres} from '../fixtures/postgres';
import {mockSuccessfulActionOutcomes} from '../fixtures/alpha15-simulation';

let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const channel='875222222222222222',member='875333333333333333',role='875444444444444444';
const actor={key:createHash('sha256').update('synthetic-iteration').digest('hex'),encryptedUserId:'synthetic-encrypted',permissions:'8',roles:[],source:'WEB_DASHBOARD' as const,requestId:'synthetic'};
const limits={activeFlows:20,monthlyRuns:100,guildConcurrent:2,globalConcurrent:5,guildPending:20,globalPending:100,measurementId:'synthetic-A-remaining'};
const literal=(type:ValueInput['type'],value:unknown):ValueInput=>({kind:'literal',type,value:value as never});
// Only new definition literals use whole seconds; runtime clocks retain their precision.
const inputInstantAfter=(seconds:number)=>new Date(Math.ceil(Date.now()/1000)*1000+seconds*1000).toISOString();
const variable=(id:string,type:ValueInput['type']='Number'):ValueInput=>({kind:'variable',type,variableId:id});
const send=(id='send'):Statement=>({kind:'action',id,operation:'discord.sendMessage',inputs:{channel:literal('ChannelRef',{id:channel,guildId:'placeholder'}),content:literal('PlainText','Synthetic template')}});
beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});
async function fixture(body:Statement[],procedures?:FlowDefinition['procedures']){
  const s=scopeForGuild(String(875000000000000000n+BigInt(++serial)));await ensureGuild(db,s);const clock={now:new Date()};
  const fixed=JSON.parse(JSON.stringify(body).replaceAll('placeholder',s.guildId)) as Statement[];
  const definition:FlowDefinition={schemaVersion:1,id:'remaining-'+serial,guildId:s.guildId,name:'Synthetic remaining A',trigger:{kind:'manual',inputs:[]},variables:[],targets:{channelIds:[channel],roleIds:[role],parentCategoryIds:[]},body:fixed,...(procedures?{procedures}:{} )};
  const service=new AutomationService(db,{admission:limits,authorize:async()=>{},approvalPolicy:async()=>({fingerprint:'a'.repeat(64),changedChannelCount:0}),adoptedActions:new Set(['discord.sendMessage','discord.addRole']),now:()=>clock.now});
  const saved=await service.save(s,actor,{definition,expectedRevision:0,requestId:randomUUID()});expect(saved.validation.issues).toEqual([]);
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await service.check(s,actor,definition.id,1,kind,{outcomes:mockSuccessfulActionOutcomes(definition),approvals:{approval:'APPROVED'}});
  await service.enable(s,actor,definition.id,{revision:1,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()});
  const adapter:AutomationRuntimeAdapter={authorize:async()=>{},execute:async()=>({state:'SUCCEEDED'})};
  const runtime=new AutomationRuntime(db,{admission:limits,adapter,now:()=>clock.now});
  const run=await service.start(s,actor,definition.id,{requestId:randomUUID()});return {s,service,runtime,adapter,run,clock,definition};
}
function loop(body:Statement[],count=5):Statement{return {kind:'repeat',id:'items',count:literal('Number',count),itemVariable:{id:'item',name:'Item',type:'Number'},body,results:[{output:{id:'itemResults',name:'Item results',type:{kind:'List',element:iterationResultType('Number')}},value:variable('item')}]};}
const third:ValueInput={kind:'expression',type:'Boolean',expression:{operator:'compare.equal',args:[variable('item'),literal('Number',3)]}};

it('PR29 keeps two confirmed results, a skip, an unknown and a remaining unstarted item through restart',async()=>{
  const body=[loop([{kind:'branch',id:'skip-third',condition:third,then:[{kind:'continue',id:'skip'}],otherwise:[],unknown:[]},send()]),send('after')];
  const f=await fixture(body);let sends=0;f.adapter.execute=async()=>++sends===3?{state:'UNKNOWN',code:'SYNTHETIC_UNKNOWN'}:{state:'SUCCEEDED'};
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'UNKNOWN'});
  const stored=(await f.service.store.run(f.s,f.run.id))!;
  expect(iterationRunStatus(stored.resume)).toMatchObject([{states:['SUCCEEDED','SUCCEEDED','SKIPPED','UNKNOWN','NOT_STARTED'],counts:{SUCCEEDED:2,SKIPPED:1,UNKNOWN:1,NOT_STARTED:1}}]);
  expect(sends).toBe(3);expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'UNKNOWN'});expect(sends).toBe(3);
  const rows=(stored.resume.variables.itemResults!.value as {state:string;outcome:{state:string;value?:number}}[]);expect(rows[0]!.outcome.value).toBe(1);expect(rows[3]!.outcome).not.toHaveProperty('value');
  expect(JSON.stringify(iterationRunStatus(stored.resume))).not.toContain('Synthetic template');
});
it('collects final scoped values and returns an empty result list for zero items',async()=>{
  const f=await fixture([loop([{kind:'declare',id:'body-value',variable:{id:'derived',name:'Derived',type:'Number'},value:variable('item')}],0)]);
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'COMPLETED'});expect(iterationRunStatus((await f.service.store.run(f.s,f.run.id))!.resume)[0]!.states).toEqual([]);
});
it('declared output expressions can read body locals and type mismatch is rejected before save',()=>{
  const l=loop([{kind:'declare',id:'local',variable:{id:'derived',name:'Derived',type:'Number'},value:variable('item')}],2) as Extract<Statement,{kind:'repeat'}>;l.results![0]!.value=variable('derived');
  const definition:FlowDefinition={schemaVersion:1,id:'scope-results',guildId:'875111111111111111',name:'Result scope',trigger:{kind:'manual',inputs:[]},variables:[],body:[l]};
  expect(simulateAutomationPlan(compileFlowDefinition(definition)).iterations?.[0]!.counts.SUCCEEDED).toBe(2);
  l.results![0]!.output.type={kind:'List',element:'Number'};expect(validateFlowDefinition(definition).issues.some(issue=>issue.code==='TYPE')).toBe(true);
});
it('a successful procedure return records the skipped current result and leaves remaining items unstarted',async()=>{
  const p={id:'procedure',revision:1,name:'Return early',inputs:[],outputs:[{id:'value',name:'Value',type:'Number' as const}],body:[loop([{kind:'return',id:'early-return',values:{value:variable('item')}}],2),{kind:'return' as const,id:'fallback',values:{value:literal('Number',0)}}]};
  const f=await fixture([{kind:'call',id:'invoke',procedureId:p.id,revision:1,args:{},outputs:{value:{id:'returned',name:'Returned',type:'Number'}}}],[p]);
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'COMPLETED'});
  expect(iterationRunStatus((await f.service.store.run(f.s,f.run.id))!.resume)[0]!.states).toEqual(['SKIPPED','NOT_STARTED']);
  expect(simulateAutomationPlan(compileFlowDefinition(f.definition)).iterations?.[0]!.states).toEqual(['SKIPPED','NOT_STARTED']);
});

function approvalFlow(until=inputInstantAfter(60)):Statement[]{return [
  {kind:'approval',id:'approval',actionId:'role',until:literal('Instant',until),approved:[],rejected:[{kind:'end',id:'rejected-end'}],expired:[{kind:'end',id:'expired-end'}]},
  {kind:'action',id:'role',operation:'discord.addRole',approvalRequired:true,inputs:{member:literal('MemberRef',{id:member,guildId:'placeholder'}),role:literal('RoleRef',{id:role,guildId:'placeholder'})}},send('after-role'),
];}
it('CT06 freezes the ordinary role action identity and reuses one current formal approval receipt',async()=>{
  const f=await fixture(approvalFlow());let writes=0;
  f.adapter.execute=async context=>{if(context.operation==='discord.addRole')await verifyAutomationApproval(db,f.s,f.run.id,context.identity,fingerprint(context.inputs),f.clock.now);writes++;return {state:'SUCCEEDED'};};
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'WAITING_APPROVAL'});expect(writes).toBe(0);
  const first=(await f.service.approvals(f.s,actor)).items[0]!;expect((await f.service.store.run(f.s,f.run.id))!.wake_at?.toISOString()).toBe(first.expiresAt);
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'WAITING_APPROVAL'});expect((await f.service.approvals(f.s,actor)).items).toHaveLength(1);
  await f.service.decideApproval(f.s,actor,first.id,{decision:'APPROVE',fingerprint:first.fingerprint,policyFingerprint:'a'.repeat(64),requestId:randomUUID()});
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'COMPLETED'});expect(writes).toBe(2);
  expect((await sql`SELECT id FROM automation_approvals WHERE ${tenant(f.s)} AND run_id=${f.run.id}::uuid`.execute(db)).rows).toHaveLength(1);
});
it.each(['REJECT','EXPIRE'] as const)('CT06 %s executes the terminal branch without entering the approved role action',async decision=>{
  const f=await fixture(approvalFlow());let writes=0;f.adapter.execute=async()=>{writes++;return {state:'SUCCEEDED'};};await f.runtime.tick(f.s,f.run.id);
  const pending=(await f.service.approvals(f.s,actor)).items[0]!;
  if(decision==='REJECT')await f.service.decideApproval(f.s,actor,pending.id,{decision:'REJECT',fingerprint:pending.fingerprint,requestId:randomUUID()});else f.clock.now=new Date(Date.parse(pending.expiresAt)+1);
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:decision==='REJECT'?'FAILED':'EXPIRED'});expect(writes).toBe(0);
});
it('CT06 refuses new approval records after a cancellation and rejects non-role targets statically',async()=>{
  const f=await fixture(approvalFlow());await f.service.store.cancel(f.s,f.run.id);
  const run=(await f.service.store.run(f.s,f.run.id))!;
  await expect(f.service.store.requireApproval(f.s,run,'never','discord.addRole',{})).rejects.toThrow('AUTOMATION_STOPPED');
  expect((await sql`SELECT id FROM automation_approvals WHERE ${tenant(f.s)} AND run_id=${f.run.id}::uuid`.execute(db)).rows).toHaveLength(0);
  const invalid=structuredClone(f.definition);(invalid.body[0] as Extract<Statement,{kind:'approval'}>).actionId='after-role';expect(validateFlowDefinition(invalid).issues.some(issue=>issue.code==='APPROVAL_TARGET')).toBe(true);
});
it('rejects statically oversized declared lists and preflights dynamic lists without persisting an oversized checkpoint',async()=>{
  const f=await fixture([{kind:'end',id:'end'}]),l=loop([],100) as Extract<Statement,{kind:'repeat'}>;
  l.results=Array.from({length:8},(_,index)=>({output:{id:'result'+index,name:'Result '+index,type:{kind:'List',element:iterationResultType('Number')}},value:variable('item')}));
  expect(validateFlowDefinition({...f.definition,body:[l]}).issues.some(issue=>issue.code==='ITERATION_RESULT_LIMIT')).toBe(true);
  l.count=variable('count');
  const definition:FlowDefinition={...f.definition,trigger:{kind:'manual',inputs:[{id:'count',name:'Count',type:'Number'}]},body:[l]};
  const saved=await f.service.save(f.s,actor,{definition,expectedRevision:1,requestId:randomUUID()});expect(saved.validation.issues).toEqual([]);
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await f.service.check(f.s,actor,definition.id,2,kind,{values:{count:{type:'Number',value:3}}});
  await f.service.enable(f.s,actor,definition.id,{revision:2,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()});
  const actual=await f.service.start(f.s,actor,definition.id,{requestId:randomUUID(),values:{count:{type:'Number',value:100,provenance:[]}}});
  let writes=0;f.adapter.execute=async()=>{writes++;return {state:'SUCCEEDED'};};
  expect(await f.runtime.tick(f.s,actual.id)).toMatchObject({state:'FAILED'});
  const stored=(await f.service.store.run(f.s,actual.id))!;expect(Buffer.byteLength(JSON.stringify(stored.resume))).toBeLessThanOrEqual(65536);expect(writes).toBe(0);
  expect(simulateAutomationPlan(compileFlowDefinition(definition),{values:{count:{type:'Number',value:100}}}).status).toBe('FAILED');
});
it('keeps completed rows and confirmed writes when later result collection exceeds the state budget',async()=>{
  const f=await fixture([{kind:'end',id:'end'}]),l=loop([send()],10) as Extract<Statement,{kind:'repeat'}>;
  l.results=Array.from({length:8},(_,index)=>({output:{id:'result'+index,name:'Result '+index,type:{kind:'List',element:iterationResultType('PlainText')}},value:variable('text','PlainText')}));
  const definition:FlowDefinition={...f.definition,trigger:{kind:'manual',inputs:[{id:'text',name:'Text',type:'PlainText'}]},body:JSON.parse(JSON.stringify([l,send('after')]).replaceAll('placeholder',f.s.guildId)) as Statement[]};
  const saved=await f.service.save(f.s,actor,{definition,expectedRevision:1,requestId:randomUUID()});expect(saved.validation.issues).toEqual([]);
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await f.service.check(f.s,actor,definition.id,2,kind,{values:{text:{type:'PlainText',value:'short'}},outcomes:{send:'SUCCEEDED',after:'SUCCEEDED'}});
  await f.service.enable(f.s,actor,definition.id,{revision:2,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()});
  const actual=await f.service.start(f.s,actor,definition.id,{requestId:randomUUID(),values:{text:{type:'PlainText',value:'x'.repeat(1800),provenance:[]}}});
  let writes=0;f.adapter.execute=async()=>{writes++;return {state:'SUCCEEDED'};};
  expect(await f.runtime.tick(f.s,actual.id)).toMatchObject({state:'FAILED'});
  const stored=(await f.service.store.run(f.s,actual.id))!,summary=iterationRunStatus(stored.resume)[0]!;
  expect(Buffer.byteLength(JSON.stringify(stored.resume))).toBeLessThanOrEqual(65536);expect(summary.counts.SUCCEEDED).toBeGreaterThan(0);expect(summary.counts.FAILED).toBe(1);expect(summary.counts.NOT_STARTED).toBeGreaterThan(0);
  const operations=(await sql<{state:string}>`SELECT state FROM automation_operations WHERE ${tenant(f.s)} AND run_id=${actual.id}::uuid`.execute(db)).rows;
  expect(operations).toHaveLength(writes);expect(operations.every(row=>row.state==='SUCCEEDED')).toBe(true);expect(writes).toBe(summary.counts.SUCCEEDED!+1);
});
