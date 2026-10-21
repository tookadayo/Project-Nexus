import {createHash,randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,ensureGuild,migrate,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import type {Actor} from '../../packages/settings/src/index';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationRuntime} from '../../packages/automation/src/runtime';
import {validateFlowDefinition} from '../../packages/automation/src/definition';
import type {AutomationAdmissionLimits} from '../../packages/automation/src/quota';
import type {FlowDefinition,Statement,ValueInput,ValueType} from '../../packages/automation/src/types';
import {isolatedPostgres} from '../fixtures/postgres';

let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const actor:Actor={key:createHash('sha256').update('synthetic-final-runtime-admin').digest('hex'),encryptedUserId:'encrypted-synthetic-identity',permissions:'8',roles:[],source:'WEB_DASHBOARD',requestId:'synthetic-final-runtime'};
const admission:AutomationAdmissionLimits={activeFlows:10,monthlyRuns:20,guildConcurrent:2,globalConcurrent:4,guildPending:10,globalPending:20,measurementId:'isolated-final-runtime-acceptance'};
const textList:ValueType={kind:'List',element:'PlainText'};
const number=(value:number):ValueInput=>({kind:'literal',type:'Number',value});
const list=(value:string[]):ValueInput=>({kind:'literal',type:textList,value});
const variable=(variableId:string,type:ValueType):ValueInput=>({kind:'variable',type,variableId});
const wait=(id:string,seconds:number):Statement=>({id,kind:'wait',duration:{kind:'literal',type:'Duration',value:seconds}});
const append=(target:string,value:ValueInput):ValueInput=>({kind:'expression',type:textList,expression:{operator:'list.append',args:[variable(target,textList),value]}});

beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});

async function fixture(body:Statement[]){
  const scope=scopeForGuild(String(882000000000000000n+BigInt(++serial)));await ensureGuild(db,scope);
  const clock={now:new Date()};
  const definition:FlowDefinition={schemaVersion:1,semanticProfile:'scratch.v1',id:'final-runtime-'+serial,name:'Synthetic final runtime acceptance',guildId:scope.guildId,trigger:{kind:'manual',inputs:[]},variables:[],body};
  const service=new AutomationService(db,{admission,now:()=>clock.now,authorize:async()=>{},adoptedActions:new Set()});
  const saved=await service.save(scope,actor,{definition,expectedRevision:0,requestId:randomUUID()});expect(saved.validation.issues).toEqual([]);
  // The fixture enables only an isolated synthetic revision. It exercises Run
  // storage/execution; public activation checks have their own integration tests.
  await sql`UPDATE automation_flows SET state='ACTIVE',active_revision=1 WHERE ${tenant(scope)} AND id=${definition.id}`.execute(db);
  let operations=0;
  const runtime=new AutomationRuntime(db,{admission,now:()=>clock.now,adapter:{authorize:async()=>{},execute:async()=>{operations++;throw new Error('UNEXPECTED_OPERATION_IN_PURE_ACCEPTANCE');}}});
  const start=()=>service.start(scope,actor,definition.id,{requestId:randomUUID()});
  return {scope,definition,service,runtime,clock,start,operations:()=>operations};
}

it('T072 starts a distinct Run with fresh locals and provides no previous-Run or persistent-variable input',async()=>{
  const f=await fixture([{id:'declare',kind:'declare',variable:{id:'counter',name:'Counter',type:'Number'},value:number(7)},{id:'change',kind:'assign',variableId:'counter',value:number(99)},wait('hold',3600)]);
  const first=await f.start();expect(await f.runtime.tick(f.scope,first.id)).toMatchObject({state:'WAITING'});
  expect((await f.service.store.run(f.scope,first.id))!.resume.variables.counter!.value).toBe(99);
  const second=await f.start();expect(second.id).not.toBe(first.id);
  expect((await f.service.store.run(f.scope,second.id))!.resume.variables).toEqual({});
  expect(await f.runtime.tick(f.scope,second.id,1)).toMatchObject({state:'RUNNING'});
  expect((await f.service.store.run(f.scope,second.id))!.resume.variables.counter!.value).toBe(7);
  expect((await f.service.store.run(f.scope,first.id))!.resume.variables.counter!.value).toBe(99);
  await expect(f.service.start(f.scope,actor,f.definition.id,{requestId:randomUUID(),values:{counter:{type:'Number',value:99,provenance:[]}}})).rejects.toThrow('AUTOMATION_INPUT_UNDECLARED');
  const previousRead={...f.definition,body:[{id:'previous',kind:'declare',variable:{id:'copy',name:'Copy',type:'Number'},value:variable('previousRun.counter','Number')} as Statement]};
  const rejectedRead=validateFlowDefinition(previousRead);expect(rejectedRead.valid).toBe(false);expect(rejectedRead.issues.some(issue=>issue.path.includes('body.0.value'))).toBe(true);
  const persistentRead={...f.definition,body:[{id:'persistent',kind:'declare',variable:{id:'copy',name:'Copy',type:'Number'},value:{kind:'persistent',type:'Number',variableId:'counter'}}]};
  expect(validateFlowDefinition(persistentRead).issues.some(issue=>issue.code==='SCHEMA')).toBe(true);
  expect(f.operations()).toBe(0);
});

it('T090 freezes foreach [a,b] on entry when each body appends c to the source list',async()=>{
  const f=await fixture([
    {id:'source',kind:'declare',variable:{id:'source',name:'Source',type:textList},value:list(['a','b'])},
    {id:'observed',kind:'declare',variable:{id:'observed',name:'Observed',type:textList},value:list([])},
    {id:'foreach',kind:'repeat',list:variable('source',textList),itemVariable:{id:'item',name:'Item',type:'PlainText'},body:[
      {id:'observe',kind:'assign',variableId:'observed',value:append('observed',variable('item','PlainText'))},
      {id:'grow-source',kind:'assign',variableId:'source',value:append('source',{kind:'literal',type:'PlainText',value:'c'})},
      wait('iteration-wait',1),
    ]},
    wait('after-foreach',60),
  ]);
  const run=await f.start();expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'WAITING'});
  const first=(await f.service.store.run(f.scope,run.id))!;
  expect(first.resume.variables.source!.value).toEqual(['a','b','c']);expect(first.resume.variables.observed!.value).toEqual(['a']);
  expect(first.resume.frames.at(-1)!.loop!.items.map(item=>item.value)).toEqual(['a','b']);
  f.clock.now=new Date(f.clock.now.getTime()+1100);expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'WAITING'});
  const second=(await f.service.store.run(f.scope,run.id))!;
  expect(second.resume.variables.source!.value).toEqual(['a','b','c','c']);expect(second.resume.variables.observed!.value).toEqual(['a','b']);
  expect(second.resume.frames.at(-1)!.loop).toMatchObject({iteration:1});expect(second.resume.frames.at(-1)!.loop!.items.map(item=>item.value)).toEqual(['a','b']);
  f.clock.now=new Date(f.clock.now.getTime()+1100);expect(await f.runtime.tick(f.scope,run.id)).toMatchObject({state:'WAITING'});
  const after=(await f.service.store.run(f.scope,run.id))!;
  expect(after.resume.frames.some(frame=>Boolean(frame.loop))).toBe(false);expect(after.resume.variables.observed!.value).toEqual(['a','b']);expect(after.resume.variables.source!.value).toHaveLength(4);
  expect(f.operations()).toBe(0);
});
