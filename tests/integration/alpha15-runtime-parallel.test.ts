import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,migrate,ensureGuild,sql,tenant,json,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import type {Actor} from '../../packages/settings/src/index';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationRuntime,type AutomationRuntimeAdapter} from '../../packages/automation/src/runtime';
import {fingerprint,verifyAutomationApproval,type ResumeState} from '../../packages/automation/src/store';
import {parallelRunStatus} from '../../packages/automation/src/parallel';
import {purgeAutomationActor,purgeAutomationGuild,sweepAutomationRetention} from '../../packages/automation/src/retention';
import type {FlowDefinition,Statement,ValueInput} from '../../packages/automation/src/types';
import {processAlpha15AutomationRuns} from '../../apps/worker/src/alpha15-automation';
import {isolatedPostgres} from '../fixtures/postgres';
import {mockSuccessfulActionOutcomes} from '../fixtures/alpha15-simulation';

let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const channel='889222222222222222',member='889333333333333333',role='889444444444444444';
const actor:Actor={key:'parallel-admin',encryptedUserId:'encrypted-synthetic',permissions:'8',roles:[],source:'WEB_DASHBOARD',requestId:'synthetic'};
const number=(value:number):ValueInput=>({kind:'literal',type:'Number',value});
const text=(value:string):ValueInput=>({kind:'literal',type:'PlainText',value});
const variable=(variableId:string):ValueInput=>({kind:'variable',type:'PlainText',variableId});
const wait=(id:string,seconds:number):Statement=>({kind:'wait',id,duration:{kind:'literal',type:'Duration',value:seconds}});
const send=(id:string,content:ValueInput=text(id)):Statement=>({kind:'action',id,operation:'discord.sendMessage',inputs:{channel:{kind:'literal',type:'ChannelRef',value:{id:channel,guildId:'placeholder'}},content}});
const parallel=(id:string,bodies:Statement[][]):Statement=>({kind:'parallel',id,branches:bodies.map((body,index)=>({id:id+'-branch-'+index,name:'Branch '+index,body}))});
beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});
async function fixture(body:Statement[],inputs:Extract<FlowDefinition['trigger'],{kind:'manual'}>['inputs']=[]) {
  const scope=scopeForGuild(String(889000000000000000n+BigInt(++serial)));await ensureGuild(db,scope);
  const clock={now:new Date()},calls:string[]=[];
  const fix=(value:unknown):unknown=>Array.isArray(value)?value.map(fix):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,key==='guildId'&&item==='placeholder'?scope.guildId:fix(item)])):value;
  const definition:FlowDefinition={schemaVersion:1,id:'parallel-'+serial,guildId:scope.guildId,name:'Synthetic parallel',trigger:{kind:'manual',inputs},variables:[],targets:{channelIds:[channel],roleIds:[role],parentCategoryIds:[]},body:fix(body) as Statement[]};
  const service=new AutomationService(db,{admission:{activeFlows:20,monthlyRuns:100,guildConcurrent:1,globalConcurrent:2,guildPending:20,globalPending:200,measurementId:'isolated-parallel-test'},authorize:async()=>{},now:()=>clock.now,approvalPolicy:async()=>({fingerprint:'a'.repeat(64),changedChannelCount:0}),adoptedActions:new Set(['discord.sendMessage','discord.addRole'])});
  const saved=await service.save(scope,actor,{definition,expectedRevision:0,requestId:randomUUID()});expect(saved.validation.issues).toEqual([]);
  const mockOutputs:Record<string,{type:'Number';value:number}>={};
  const findDraws=(value:unknown):void=>{if(Array.isArray(value)){value.forEach(findDraws);return;}if(!value||typeof value!=='object')return;const object=value as Record<string,unknown>;if(object.kind==='random')mockOutputs[String(object.id)]={type:'Number',value:1};Object.values(object).forEach(findDraws);};findDraws(body);
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await service.check(scope,actor,definition.id,1,kind,{outcomes:mockSuccessfulActionOutcomes(definition),outputs:mockOutputs,...(inputs.length?{values:{member:{type:'MemberRef',value:{id:member,guildId:scope.guildId}}}}:{})});
  await service.enable(scope,actor,definition.id,{revision:1,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()});
  const adapter:AutomationRuntimeAdapter={authorize:async()=>{},execute:async context=>{calls.push(String(context.inputs.content?.value??context.operation));return {state:'SUCCEEDED'};}};
  const runtime=()=>new AutomationRuntime(db,{admission:service.limits,adapter,now:()=>clock.now});
  const run=await service.start(scope,actor,definition.id,{requestId:randomUUID(),...(inputs.length?{values:{member:{type:'MemberRef',value:{id:member,guildId:scope.guildId},provenance:[]}}}:{})});
  return {scope,service,definition,clock,calls,adapter,runtime,run};
}
it('advances another branch during a wait, persists the all-join and resumes after restart',async()=>{
  const f=await fixture([parallel('join',[[wait('pause',10),send('later')],[send('immediate')]]),send('after-join')]);
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});expect(f.calls).toEqual(['immediate']);
  const saved=(await f.service.store.run(f.scope,f.run.id))!,status=parallelRunStatus(saved.resume,f.clock.now)!;
  expect(status.join).toBe('ALL');expect(status.branches.map(branch=>branch.state)).toEqual(['WAITING','COMPLETED']);
  expect(saved.wake_at!.getTime()).toBe(f.clock.now.getTime()+10000);expect(JSON.stringify(status)).not.toContain('immediate');
  f.clock.now=new Date(f.clock.now.getTime()+10000);
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toEqual(['immediate','later','after-join']);
  expect((await f.service.store.run(f.scope,f.run.id))!.resume.externalActions).toBe(3);
});
it('interleaves bounded statements fairly instead of finishing one whole branch first',async()=>{
  const f=await fixture([parallel('join',[[send('a1'),send('a2')],[send('b1'),send('b2')]]),send('joined')]);
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toEqual(['a1','b1','a2','b2','joined']);
  const saved=(await f.service.store.run(f.scope,f.run.id))!;expect(saved.resume.steps).toBe(6);expect(saved.resume.externalActions).toBe(5);
});
it('isolates mutable branch locals and keeps the parent snapshot unchanged',async()=>{
  const declaration=(id:string,value:string):Statement=>({kind:'declare',id:'declare-'+id,variable:{id,name:id,type:'PlainText'},value:text(value)});
  const assignment=(id:string,value:string):Statement=>({kind:'assign',id:'assign-'+id,variableId:id,value:text(value)});
  const f=await fixture([declaration('parent','parent-value'),parallel('join',[[declaration('a','a-before'),assignment('a','a-after'),send('a-send',variable('a'))],[declaration('b','b-before'),assignment('b','b-after'),send('b-send',variable('b'))]]),send('parent-send',variable('parent'))]);
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toEqual(['a-after','b-after','parent-value']);
  expect((await f.service.store.run(f.scope,f.run.id))!.resume.parallel).toBeUndefined();
});
it('freezes explicit named branch results and publishes only mapped values at the all-join',async()=>{
  const declaration=(id:string,value:string):Statement=>({kind:'declare',id:'declare-'+id,variable:{id,name:id,type:'PlainText'},value:text(value)});
  const f=await fixture([declaration('result-a','pending-a'),declaration('result-b','pending-b'),{kind:'parallel',id:'named',branches:[
    {id:'a',name:'A',body:[declaration('local-a','fixed-a'),declaration('unused','discard-this')],outputs:{selected:variable('local-a')}},
    {id:'b',name:'B',body:[wait('b-wait',1),declaration('local-b','fixed-b')],outputs:{selected:variable('local-b')}},
  ],outputs:{'result-a':{branchId:'a',outputId:'selected'},'result-b':{branchId:'b',outputId:'selected'}}},send('read-a',variable('result-a')),send('read-b',variable('result-b'))]);
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});expect(f.calls).toEqual([]);
  const saved=(await f.service.store.run(f.scope,f.run.id))!,completed=saved.resume.parallel!.branches.find(branch=>branch.id==='a')!.context;
  expect(completed.variables).toEqual({});expect(completed.outputs).toMatchObject({selected:{value:'fixed-a'}});expect(JSON.stringify(completed)).not.toContain('discard-this');
  expect(saved.resume.variables['result-a']!.value).toBe('pending-a');expect(JSON.stringify(parallelRunStatus(saved.resume,f.clock.now))).not.toContain('fixed-a');
  f.clock.now=new Date(f.clock.now.getTime()+1000);expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toEqual(['fixed-a','fixed-b']);
});
it('keeps draw identities distinct across nested joins and parent loop iterations',async()=>{
  const draw=(id:string):Statement=>({kind:'random',id,mode:'integer',min:number(1),max:number(100),output:{id:id+'-result',name:id,type:'Number'}});
  const f=await fixture([{kind:'repeat',id:'repeat',count:number(2),itemVariable:{id:'item',name:'item',type:'Number'},body:[parallel('outer',[[draw('a'),wait('pause',1)],[parallel('inner',[[draw('b')],[draw('c')]])]])]}]);
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});
  const first=(await sql<{identity:string;result:unknown}>`SELECT identity,result FROM automation_random_results WHERE ${tenant(f.scope)} ORDER BY identity`.execute(db)).rows;expect(first).toHaveLength(3);
  f.clock.now=new Date(f.clock.now.getTime()+1000);expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});
  const second=(await sql<{identity:string;result:unknown}>`SELECT identity,result FROM automation_random_results WHERE ${tenant(f.scope)} ORDER BY identity`.execute(db)).rows;expect(second).toHaveLength(6);expect(new Set(second.map(row=>row.identity)).size).toBe(6);
  expect(second.filter(row=>first.some(prior=>prior.identity===row.identity))).toEqual(first);
  f.clock.now=new Date(f.clock.now.getTime()+1000);expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});
});
it.each(['UNKNOWN','FAILED'] as const)('halts every sibling before another side effect after %s',async state=>{
  const f=await fixture([parallel('join',[[send('first')],[send('forbidden-next')]]),send('forbidden-parent')]);let sent=0;
  f.adapter.execute=async()=>{sent++;return {state,code:'SYNTHETIC_FAILURE'};};
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state});await f.runtime().tick(f.scope,f.run.id);expect(sent).toBe(1);
});
it('reuses a confirmed branch write after a lost checkpoint without charging it twice',async()=>{
  const f=await fixture([parallel('join',[[send('first')],[send('second')]]),send('after')]);let dispatchCheckpoint:ResumeState|undefined;
  f.adapter.execute=async context=>{f.calls.push(String(context.inputs.content!.value));dispatchCheckpoint??=structuredClone((await f.service.store.run(f.scope,f.run.id))!.resume);return {state:'SUCCEEDED'};};
  await f.runtime().tick(f.scope,f.run.id,2);expect(f.calls).toEqual(['first']);
  await sql`UPDATE automation_runs SET resume=${json(dispatchCheckpoint!)},status='RUNNING' WHERE ${tenant(f.scope)} AND id=${f.run.id}::uuid`.execute(db);
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toEqual(['first','second','after']);
  const saved=(await f.service.store.run(f.scope,f.run.id))!;expect(saved.resume.steps).toBe(4);expect(saved.resume.externalActions).toBe(3);
});
it('resumes a waiting sibling through the worker while another branch awaits formal approval',async()=>{
  const roleAction:Statement={kind:'action',id:'role',operation:'discord.addRole',approvalRequired:true,inputs:{member:{kind:'literal',type:'MemberRef',value:{id:member,guildId:'placeholder'}},role:{kind:'literal',type:'RoleRef',value:{id:role,guildId:'placeholder'}}}};
  const f=await fixture([parallel('join',[[roleAction],[wait('pause',1),send('after-wait')]]),send('after-join')]);
  f.adapter.execute=async context=>{if(context.operation==='discord.addRole')await verifyAutomationApproval(db,f.scope,f.run.id,context.identity,fingerprint(context.inputs),f.clock.now);f.calls.push(String(context.inputs.content?.value??'role'));return {state:'SUCCEEDED'};};
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'WAITING_APPROVAL'});expect(f.calls).toEqual([]);
  expect((await f.service.store.run(f.scope,f.run.id))!.wake_at).not.toBeNull();
  f.clock.now=new Date(f.clock.now.getTime()+1000);await processAlpha15AutomationRuns(db,f.adapter,f.service.options,f.clock.now);expect(f.calls).toEqual(['after-wait']);
  const approval=(await f.service.approvals(f.scope,actor)).items[0]!;
  await f.service.decideApproval(f.scope,actor,approval.id,{decision:'APPROVE',fingerprint:approval.fingerprint,policyFingerprint:'a'.repeat(64),requestId:randomUUID()});
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});expect(f.calls).toEqual(['after-wait','role','after-join']);
});
it('stops waiting siblings immediately when a formal branch approval is rejected',async()=>{
  const roleAction:Statement={kind:'action',id:'role',operation:'discord.addRole',approvalRequired:true,inputs:{member:{kind:'literal',type:'MemberRef',value:{id:member,guildId:'placeholder'}},role:{kind:'literal',type:'RoleRef',value:{id:role,guildId:'placeholder'}}}};
  const f=await fixture([parallel('join',[[roleAction],[wait('pause',10),send('never')]])]);
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'WAITING_APPROVAL'});
  const approval=(await f.service.approvals(f.scope,actor)).items[0]!;await f.service.decideApproval(f.scope,actor,approval.id,{decision:'REJECT',fingerprint:approval.fingerprint,requestId:randomUUID()});
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toEqual([]);
});
it('shares a single external action budget across every branch',async()=>{
  const f=await fixture([parallel('join',[[send('last-allowed')],[send('over-budget')]])]);
  const saved=(await f.service.store.run(f.scope,f.run.id))!;saved.resume.externalActions=24;
  await sql`UPDATE automation_runs SET resume=${json(saved.resume)} WHERE ${tenant(f.scope)} AND id=${f.run.id}::uuid`.execute(db);
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toEqual(['last-allowed']);
  expect((await f.service.store.run(f.scope,f.run.id))!.reason).toBe('AUTOMATION_ACTION_LIMIT');
});
it.each([['steps',999,'AUTOMATION_STEP_LIMIT'],['evaluations',4999,'AUTOMATION_EVALUATION_BUDGET']] as const)('shares the %s budget across forked contexts',async(counter,used,reason)=>{
  const f=await fixture([parallel('join',[[send('a')],[send('b')]])]),saved=(await f.service.store.run(f.scope,f.run.id))!;
  saved.resume[counter]=used;await sql`UPDATE automation_runs SET resume=${json(saved.resume)} WHERE ${tenant(f.scope)} AND id=${f.run.id}::uuid`.execute(db);
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toEqual([]);expect((await f.service.store.run(f.scope,f.run.id))!.reason).toBe(reason);
});
it('fences concurrent worker ticks so a branch effect starts once',async()=>{
  const f=await fixture([parallel('join',[[send('a')],[send('b')]])]);let entered!:()=>void,finish!:()=>void;
  const started=new Promise<void>(resolve=>{entered=resolve;}),pending=new Promise<void>(resolve=>{finish=resolve;});
  f.adapter.execute=async context=>{f.calls.push(String(context.inputs.content!.value));if(f.calls.length===1){entered();await pending;}return {state:'SUCCEEDED'};};
  const first=f.runtime().tick(f.scope,f.run.id);await started;expect(await f.runtime().tick(f.scope,f.run.id)).toBeNull();finish();
  expect(await first).toMatchObject({state:'COMPLETED'});expect(f.calls).toEqual(['a','b']);
});
it('retains an in-flight success during cancellation and never starts a sibling',async()=>{
  const f=await fixture([parallel('join',[[send('first')],[send('never')]])]);let entered!:()=>void,finish!:()=>void,sent=0;
  const started=new Promise<void>(resolve=>{entered=resolve;}),pending=new Promise<void>(resolve=>{finish=resolve;});
  f.adapter.execute=async()=>{sent++;entered();await pending;return {state:'SUCCEEDED'};};
  const ticking=f.runtime().tick(f.scope,f.run.id);await started;await f.service.cancel(f.scope,actor,f.run.id,randomUUID());finish();
  expect(await ticking).toMatchObject({state:'CANCELLED'});expect(sent).toBe(1);
  expect((await sql`SELECT state FROM automation_operations WHERE ${tenant(f.scope)}`.execute(db)).rows).toEqual([{state:'SUCCEEDED'}]);
});
it('marks an interrupted branch dispatch unknown before any sibling resumes',async()=>{
  const f=await fixture([parallel('join',[[wait('a-wait',1),send('a-send')],[wait('b-wait',1),send('b-send')]])]);
  await f.runtime().tick(f.scope,f.run.id);await f.service.store.beginOperation(f.scope,f.run.id,'interrupted-branch','discord.sendMessage','synthetic');
  f.clock.now=new Date(f.clock.now.getTime()+1000);
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'UNKNOWN'});expect(f.calls).toEqual([]);
});
it('enforces the immutable Run deadline across branch waits and erases all checkpoints after retention',async()=>{
  const f=await fixture([{kind:'end',id:'initial-end'}]),duration:ValueInput={kind:'variable',type:'Duration',variableId:'duration'};
  await f.service.cancel(f.scope,actor,f.run.id,randomUUID());
  const definition:FlowDefinition={...f.definition,trigger:{kind:'manual',inputs:[{id:'duration',name:'Duration',type:'Duration'}]},body:[parallel('join',[[{kind:'wait',id:'first',duration},{kind:'wait',id:'second',duration}],[wait('other',2*86400)]])]};
  const saved=await f.service.save(f.scope,actor,{definition,expectedRevision:1,requestId:randomUUID()});
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await f.service.check(f.scope,actor,definition.id,2,kind,{values:{duration:{type:'Duration',value:86400}}});
  // The finite test sample fits; larger production input still shares the original Run deadline.
  await f.service.enable(f.scope,actor,definition.id,{revision:2,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()});
  f.run=await f.service.start(f.scope,actor,definition.id,{requestId:randomUUID(),values:{duration:{type:'Duration',value:4*86400,provenance:[]}}});
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});f.clock.now=new Date(f.clock.now.getTime()+4*86400000);
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});expect((await f.service.store.run(f.scope,f.run.id))!.reason).toBe('AUTOMATION_DEADLINE_EXCEEDED');
  await sweepAutomationRetention(db,new Date(f.clock.now.getTime()+7*86400000+1));expect(await f.service.store.run(f.scope,f.run.id)).toBeNull();
});
it('erases dynamic member references in branch snapshots without removing an unrelated definition',async()=>{
  const f=await fixture([parallel('join',[[wait('a-wait',10)],[wait('b-wait',10)]])],[{id:'member',name:'Member',type:'MemberRef'}]);
  await f.runtime().tick(f.scope,f.run.id);await db.transaction().execute(tx=>purgeAutomationActor(tx,f.scope,'unrelated-deleted-actor',member));
  expect(await f.service.store.run(f.scope,f.run.id)).toBeNull();expect((await f.service.list(f.scope,actor)).items).toHaveLength(1);
});
it('observes deletion between branch checkpoints without reviving state or dispatching another effect',async()=>{
  const f=await fixture([parallel('join',[[send('never-a')],[send('never-b')]])]);let deleted=false;
  f.adapter.authorize=async(_scope,run)=>{if(run.resume.parallel&&!deleted){deleted=true;await db.transaction().execute(tx=>purgeAutomationGuild(tx,f.scope));}};
  expect(await f.runtime().tick(f.scope,f.run.id)).toMatchObject({state:'DELETED'});expect(f.calls).toEqual([]);
  expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
});
