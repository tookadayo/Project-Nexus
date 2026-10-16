import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,ensureGuild,migrate,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import type {Actor} from '../../packages/settings/src/index';
import {validateFlowDefinition} from '../../packages/automation/src/definition';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationRuntime} from '../../packages/automation/src/runtime';
import type {AutomationAdmissionLimits} from '../../packages/automation/src/quota';
import type {FlowDefinition,Statement,ValueInput,ValueType} from '../../packages/automation/src/types';
import {isolatedPostgres} from '../fixtures/postgres';

let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const actor:Actor={key:'synthetic-procedure-revision-admin',encryptedUserId:'encrypted-synthetic-identity',permissions:'8',roles:[],source:'WEB_DASHBOARD',requestId:'synthetic-procedure-revision'};
const admission:AutomationAdmissionLimits={activeFlows:10,monthlyRuns:20,guildConcurrent:3,globalConcurrent:12,guildPending:10,globalPending:20,measurementId:'isolated-procedure-revision-acceptance'};
const literal=(type:ValueType,value:number|string):ValueInput=>({kind:'literal',type,value});
const variable=(variableId:string,type:ValueType):ValueInput=>({kind:'variable',variableId,type});
const wait=(id:string,seconds:number):Statement=>({id,kind:'wait',duration:{kind:'literal',type:'Duration',value:seconds}});

beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});

async function fixture(){
  const scope=scopeForGuild(String(883000000000000000n+BigInt(++serial)));await ensureGuild(db,scope);
  const clock={now:new Date()};
  const service=new AutomationService(db,{admission,now:()=>clock.now,authorize:async()=>{},adoptedActions:new Set()});
  let operations=0;
  const worker=()=>new AutomationRuntime(db,{admission,now:()=>clock.now,adapter:{authorize:async()=>{},execute:async()=>{operations++;throw new Error('UNEXPECTED_OPERATION_IN_PROCEDURE_REVISION_ACCEPTANCE');}}});
  const definition=(revision:number,addInput=false,outputType:ValueType='Number',supplyNewInput=addInput,bindingType=outputType):FlowDefinition=>({
    schemaVersion:1,semanticProfile:'scratch.v1',id:'procedure-revision-'+serial,name:'Synthetic procedure revision acceptance',guildId:scope.guildId,
    trigger:{kind:'manual',inputs:[]},variables:[],
    procedures:[{id:'child',revision,name:'Child',inputs:[{id:'x',name:'X',type:'Number'},...(addInput?[{id:'extra',name:'Extra',type:'PlainText' as const}]:[])],outputs:[{id:'answer',name:'Answer',type:outputType}],body:[
      wait('child-wait',10),
      {id:'child-return',kind:'return',values:{answer:outputType==='Number'?variable('x','Number'):addInput?variable('extra','PlainText'):literal('PlainText','new-v2')}},
    ]}],
    body:[{id:'call-child',kind:'call',procedureId:'child',revision,args:{x:literal('Number',7),...(supplyNewInput?{extra:literal('PlainText','new-v2')}:{})},outputs:{answer:{id:'result',name:'Result',type:bindingType}}},wait('parent-wait',60)],
  });
  const save=(input:FlowDefinition,expectedRevision:number)=>service.save(scope,actor,{definition:input,expectedRevision,requestId:randomUUID()});
  const enable=async(saved:Awaited<ReturnType<typeof save>>)=>{
    expect(saved.validation).toMatchObject({valid:true,complete:true,issues:[]});
    for(const kind of ['VALIDATE','TEST','IMPACT'] as const){
      const checked=await service.check(scope,actor,saved.id,saved.draftRevision,kind);
      expect(checked).toMatchObject({valid:true,complete:true,issues:[]});
      if(kind==='TEST')expect(checked).toMatchObject({status:'COMPLETED',externalChanges:0,productionRuns:0});
      if(kind==='IMPACT')expect(checked).toMatchObject({productionAvailable:true});
    }
    expect(await service.enable(scope,actor,saved.id,{revision:saved.draftRevision,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()})).toMatchObject({state:'ACTIVE',activeRevision:saved.draftRevision});
  };
  const initial=await save(definition(1),0);await enable(initial);
  const start=()=>service.start(scope,actor,initial.id,{requestId:randomUUID()});
  const old=await start();expect(old.revision).toBe(1);
  expect(await worker().tick(scope,old.id)).toMatchObject({state:'WAITING'});
  const held=(await service.store.run(scope,old.id))!;
  expect(held.resume.frames.at(-1)).toMatchObject({path:'procedures/0/body',index:1,call:{}});
  expect(held.resume.variables.x).toMatchObject({type:'Number',value:7});expect(held.resume.variables.extra).toBeUndefined();
  return {scope,clock,service,definition,save,enable,start,worker,initial,old,held,operations:()=>operations};
}

it('T087 keeps an executing child revision across Wait/restart and enables the new child only for the new Flow revision',async()=>{
  const f=await fixture();
  const updated=await f.save(f.definition(2,true,'PlainText'),1);await f.enable(updated);
  const stillHeld=(await f.service.store.run(f.scope,f.old.id))!;
  expect(stillHeld).toEqual(f.held);
  expect((await f.service.getRevision(f.scope,actor,f.initial.id,1)).definition).toEqual(f.initial.definition);
  expect((await f.service.getRevision(f.scope,actor,f.initial.id,2)).definition.procedures![0]).toMatchObject({id:'child',revision:2,outputs:[{id:'answer',type:'PlainText'}]});

  f.clock.now=new Date(f.clock.now.getTime()+11000);
  expect(await f.worker().tick(f.scope,f.old.id)).toMatchObject({state:'WAITING'});
  const resumedOld=(await f.service.store.run(f.scope,f.old.id))!;
  expect(resumedOld).toMatchObject({revision:1,semantic_hash:f.held.semantic_hash,started_at:f.held.started_at,deadline_at:f.held.deadline_at});
  expect(resumedOld.resume.frames).toHaveLength(1);expect(resumedOld.resume.frames[0]).toMatchObject({path:'body',index:2});
  expect(resumedOld.resume.variables.result).toMatchObject({type:'Number',value:7});expect(resumedOld.resume.variables.extra).toBeUndefined();

  const fresh=await f.start();expect(fresh).toMatchObject({revision:2});expect(fresh.id).not.toBe(f.old.id);
  expect(await f.worker().tick(f.scope,fresh.id)).toMatchObject({state:'WAITING'});
  expect((await f.service.store.run(f.scope,fresh.id))!.resume.variables.extra).toMatchObject({type:'PlainText',value:'new-v2'});
  f.clock.now=new Date(f.clock.now.getTime()+11000);
  expect(await f.worker().tick(f.scope,fresh.id)).toMatchObject({state:'WAITING'});
  const resumedNew=(await f.service.store.run(f.scope,fresh.id))!;
  expect(resumedNew.revision).toBe(2);expect(resumedNew.semantic_hash).not.toBe(resumedOld.semantic_hash);
  expect(resumedNew.resume.variables.result).toMatchObject({type:'PlainText',value:'new-v2'});
  expect((await f.service.store.run(f.scope,f.old.id))!).toEqual(resumedOld);expect(f.operations()).toBe(0);
});

it('T087 diagnoses a newly required child argument, blocks activation of that incomplete draft and preserves the executing old child',async()=>{
  const f=await fixture();
  const incomplete=await f.save(f.definition(2,true,'Number',false),1);
  expect(incomplete.draftRevision).toBe(2);expect(incomplete.validation).toMatchObject({valid:false,complete:false});
  expect(incomplete.validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'MISSING_INPUT',severity:'missing',path:'body.0'})]));
  const checked=await f.service.check(f.scope,actor,f.initial.id,2,'VALIDATE');
  expect(checked).toMatchObject({valid:false,complete:false});expect(checked.issues).toEqual(incomplete.validation.issues);
  await expect(f.service.enable(f.scope,actor,f.initial.id,{revision:2,semanticHash:incomplete.validation.semanticHash??checked.semanticHash,requestId:randomUUID()})).rejects.toThrow('AUTOMATION_DEFINITION_INCOMPLETE');
  expect(await f.service.get(f.scope,actor,f.initial.id)).toMatchObject({draftRevision:2,activeRevision:1,state:'ACTIVE'});
  expect((await f.service.store.run(f.scope,f.old.id))!).toEqual(f.held);
  expect(await f.start()).toMatchObject({revision:1});
  f.clock.now=new Date(f.clock.now.getTime()+11000);expect(await f.worker().tick(f.scope,f.old.id)).toMatchObject({state:'WAITING'});
  const resumed=(await f.service.store.run(f.scope,f.old.id))!;
  expect(resumed).toMatchObject({revision:1,semantic_hash:f.held.semantic_hash,deadline_at:f.held.deadline_at});expect(resumed.resume.variables.result).toMatchObject({type:'Number',value:7});expect(f.operations()).toBe(0);
});

it('T087 rejects rebinding an old Number output to a new PlainText child result without changing the stored revision or old Run',async()=>{
  const f=await fixture();
  const incompatible=f.definition(2,false,'PlainText',false,'Number');
  const diagnostic=validateFlowDefinition(incompatible);
  expect(diagnostic.valid).toBe(false);expect(diagnostic.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'TYPE',severity:'error',path:'body.0'})]));
  await expect(f.save(incompatible,1)).rejects.toThrow('AUTOMATION_DEFINITION_INVALID');
  const unchanged=await f.service.get(f.scope,actor,f.initial.id);
  expect(unchanged).toMatchObject({draftRevision:1,activeRevision:1,state:'ACTIVE'});expect(unchanged.definition).toEqual(f.initial.definition);
  await expect(f.service.getRevision(f.scope,actor,f.initial.id,2)).rejects.toThrow('AUTOMATION_REVISION_NOT_FOUND');
  expect((await f.service.store.run(f.scope,f.old.id))!).toEqual(f.held);
  f.clock.now=new Date(f.clock.now.getTime()+11000);expect(await f.worker().tick(f.scope,f.old.id)).toMatchObject({state:'WAITING'});
  const resumed=(await f.service.store.run(f.scope,f.old.id))!;
  expect(resumed).toMatchObject({revision:1,semantic_hash:f.held.semantic_hash,deadline_at:f.held.deadline_at});expect(resumed.resume.variables.result).toMatchObject({type:'Number',value:7});expect(f.operations()).toBe(0);
});
