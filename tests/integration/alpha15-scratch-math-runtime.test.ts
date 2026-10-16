import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,expect,it,vi} from 'vitest';
import {connect,ensureGuild,migrate,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import {Components} from '../../packages/security/src/index';
import {IdentityVault} from '../../packages/identity/src/index';
import {SettingsService,type Actor} from '../../packages/settings/src/index';
import {alpha15AutomationInteraction} from '../../apps/worker/src/alpha15-interactions';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationRuntime,type AutomationRuntimeAdapter} from '../../packages/automation/src/runtime';
import {validateFlowDefinition} from '../../packages/automation/src/definition';
import * as numericServer from '../../packages/automation/src/scratch-math-server';
import {automationDispatchCheckpoint} from '../../packages/automation/src/store';
import type {AutomationAdmissionLimits} from '../../packages/automation/src/quota';
import type {AutomationSimulationInput} from '../../packages/automation/src/simulation';
import {DEFAULT_AUTOMATION_LIMITS,type EvaluatedValue,type FlowDefinition,type Statement,type ValueInput} from '../../packages/automation/src/types';
import {withinScratchFourUlps} from '../../packages/automation/src/scratch-numeric';
import type {ScratchTranscendental} from '../../packages/automation/src/scratch-mpfr';
import {isolatedPostgres} from '../fixtures/postgres';

let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const actor:Actor={key:'synthetic-math-runtime-admin',encryptedUserId:'synthetic-encrypted-identity',permissions:'8',roles:[],source:'WEB_DASHBOARD',requestId:'synthetic-math-runtime'};
// These are synthetic fixture capacities, not measured production or plan limits.
const admission:AutomationAdmissionLimits={activeFlows:20,monthlyRuns:100,guildConcurrent:3,globalConcurrent:20,guildPending:20,globalPending:100,measurementId:'isolated-math-runtime-fixtures'};
const number=(value:number):ValueInput=>({kind:'literal',type:'Number',value});
const variable=(variableId:string):ValueInput=>({kind:'variable',type:'Number',variableId});
const math=(mathFunction:ScratchTranscendental,arg:ValueInput):ValueInput=>({kind:'expression',type:'Number',expression:{operator:'number.math',args:[arg],options:{mathFunction}}});
const declare=(id:string,value:ValueInput):Statement=>({id:'declare-'+id,kind:'declare',variable:{id,name:id,type:'Number'},value});
const wait=(id:string,seconds=1):Statement=>({id,kind:'wait',duration:{kind:'literal',type:'Duration',value:seconds}});
const bits=(value:number)=>{const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,value);return view.getBigUint64(0).toString(16).padStart(16,'0');};
const examples:[ScratchTranscendental,number,number][]=[['sin',30,0.5],['cos',60,0.5],['tan',225,1],['asin',0.5,30],['acos',-0.5,120],['atan',1,45],['ln',2,0.6931471805599453],['log',100,2],['exp',1,2.718281828459045],['exp10',2,100]];

beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterEach(()=>vi.restoreAllMocks());
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});

async function fixture(body:Statement[],inputs:Record<string,number>={}){
  const scope=scopeForGuild(String(884000000000000000n+BigInt(++serial)));await ensureGuild(db,scope);
  const clock={now:new Date()},calls:string[]=[];
  const definition:FlowDefinition={schemaVersion:1,semanticProfile:'scratch.v1',id:'math-runtime-'+serial,name:'Synthetic pinned math runtime',guildId:scope.guildId,trigger:{kind:'manual',inputs:Object.keys(inputs).map(id=>({id,name:id,type:'Number'}))},variables:[],body};
  const channel='884222222222222222';
  definition.targets={channelIds:[channel],roleIds:[],parentCategoryIds:[]};
  const send=(id:string):Statement=>({id,kind:'action',operation:'discord.sendMessage',inputs:{channel:{kind:'literal',type:'ChannelRef',value:{id:channel,guildId:scope.guildId}},content:{kind:'literal',type:'PlainText',value:id}}});
  const values=Object.fromEntries(Object.entries(inputs).map(([id,value])=>[id,{type:'Number' as const,value,provenance:[]}])) satisfies Record<string,EvaluatedValue>;
  const mock:AutomationSimulationInput={values:Object.fromEntries(Object.entries(inputs).map(([id,value])=>[id,{type:'Number',value}]))};
  const service=new AutomationService(db,{admission,now:()=>clock.now,authorize:async()=>{},adoptedActions:new Set(['discord.sendMessage'])});
  const adapter:AutomationRuntimeAdapter={authorize:async()=>{},execute:async context=>{calls.push(context.identity);throw Error('UNEXPECTED_EXTERNAL_OPERATION_IN_MATH_ACCEPTANCE');}};
  const worker=()=>new AutomationRuntime(db,{admission,adapter,now:()=>clock.now});
  const start=()=>service.start(scope,actor,definition.id,{requestId:randomUUID(),values});
  return {scope,clock,calls,definition,service,adapter,worker,start,values,mock,send};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;

async function enable(f:Fixture,inspectVariables:string[]=[],expectedRevision=0){
  const saved=await f.service.save(f.scope,actor,{definition:f.definition,expectedRevision,requestId:randomUUID()});
  expect(saved.validation).toMatchObject({valid:true,complete:true,issues:[]});
  expect((await f.service.get(f.scope,actor,f.definition.id)).validation).toMatchObject({valid:true,complete:true,issues:[]});
  expect((await f.service.getRevision(f.scope,actor,f.definition.id,saved.draftRevision)).definition).toEqual(saved.definition);
  let inspected:{variableId:string;value:unknown}[]=[];
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const){
    const checked=await f.service.check(f.scope,actor,f.definition.id,saved.draftRevision,kind,{...f.mock,inspectVariables});
    expect(checked).toMatchObject({valid:true,complete:true,issues:[]});
    if(kind==='TEST'){
      expect(checked).toMatchObject({status:'COMPLETED',externalChanges:0,productionRuns:0});
      if('inspection' in checked&&checked.inspection)inspected=checked.inspection.values;
    }
    if(kind==='IMPACT')expect(checked).toMatchObject({productionAvailable:true});
  }
  expect(await f.service.enable(f.scope,actor,f.definition.id,{revision:saved.draftRevision,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()})).toMatchObject({state:'ACTIVE',activeRevision:saved.draftRevision});
  return inspected;
}

it('runs all ten pinned mathematical functions through save/review/enable/start and preserves exact bits across Wait and worker restart',async()=>{
  const f=await fixture([
    ...examples.map(([op,x])=>declare('constant_'+op,math(op,number(x)))),
    ...examples.map(([op])=>declare('before_'+op,math(op,variable('input_'+op)))),
    wait('math-wait'),
    ...examples.map(([op])=>declare('after_'+op,math(op,variable('input_'+op)))),
    wait('tail-wait',60),
  ],Object.fromEntries(examples.map(([op,x])=>['input_'+op,x])));
  const inspected=await enable(f,examples.flatMap(([op])=>['constant_'+op,'before_'+op,'after_'+op]));
  for(const [op,,reference] of examples)for(const prefix of ['constant_','before_','after_']){
    const result=inspected.find(item=>item.variableId===prefix+op);expect(result,prefix+op).toBeDefined();
    expect(withinScratchFourUlps(result!.value as number,reference),prefix+op).toBe(true);
  }
  const run=await f.start();expect(await f.worker().tick(f.scope,run.id)).toMatchObject({state:'WAITING'});
  const before=(await f.service.store.run(f.scope,run.id))!;
  expect(before.resume.evaluations).toBeGreaterThanOrEqual(examples.length*2*32);
  for(const [op,,reference] of examples){
    expect(withinScratchFourUlps(before.resume.variables['before_'+op]!.value as number,reference),op).toBe(true);
    expect(bits(before.resume.variables['constant_'+op]!.value as number)).toBe(bits(before.resume.variables['before_'+op]!.value as number));
    expect(before.resume.variables['after_'+op]).toBeUndefined();
  }
  f.clock.now=new Date(f.clock.now.getTime()+1100);expect(await f.worker().tick(f.scope,run.id)).toMatchObject({state:'WAITING'});
  const after=(await f.service.store.run(f.scope,run.id))!;
  expect(after.resume.evaluations-before.resume.evaluations).toBeGreaterThanOrEqual(examples.length*32);
  expect(after).toMatchObject({revision:before.revision,semantic_hash:before.semantic_hash,deadline_at:before.deadline_at});
  for(const [op] of examples){
    const expected=bits(before.resume.variables['before_'+op]!.value as number);
    expect(bits(after.resume.variables['before_'+op]!.value as number)).toBe(expected);expect(bits(after.resume.variables['after_'+op]!.value as number)).toBe(expected);
    expect(bits(inspected.find(item=>item.variableId==='after_'+op)!.value as number)).toBe(expected);
  }
  expect(f.calls).toEqual([]);
});

it('keeps mathematical zero positive, nonzero subnormal values and exact reduction of maximum finite degree inputs in the real Run',async()=>{
  const edges:[string,ScratchTranscendental,number,number][]=[
    ['sinZero','sin',0,0],['negativeZero','sin',-0,0],['cosZero','cos',90,0],['lnZero','ln',1,0],
    ['asinTiny','asin',Number.MIN_VALUE,Number.MIN_VALUE*57],['atanTiny','atan',-Number.MIN_VALUE,-Number.MIN_VALUE*57],
    ['expTiny','exp',-744,Number.MIN_VALUE*2],['exp10Tiny','exp10',-323,Number.MIN_VALUE*2],
    ['sinTiny','sin',Number.MIN_VALUE*100,Number.MIN_VALUE*2],['sinNegativeTiny','sin',-Number.MIN_VALUE*100,-Number.MIN_VALUE*2],
    ['cosTiny','cos',-Number.MIN_VALUE,1],
    ['sinMaximum','sin',Number.MAX_VALUE,0.788010753606722],['cosMaximum','cos',Number.MAX_VALUE,-0.6156614753256583],['tanMaximum','tan',Number.MAX_VALUE,-1.2799416321930788],
  ];
  const f=await fixture([...edges.map(([id,op])=>declare(id,math(op,variable('input_'+id)))),wait('edge-wait',60)],Object.fromEntries(edges.map(([id,,x])=>['input_'+id,x])));
  await enable(f);const run=await f.start();expect(await f.worker().tick(f.scope,run.id)).toMatchObject({state:'WAITING'});
  const saved=(await f.service.store.run(f.scope,run.id))!;
  for(const [id,,,reference] of edges){const actual=saved.resume.variables[id]!.value as number;
    if(id.endsWith('Maximum'))expect(withinScratchFourUlps(actual,reference),id).toBe(true);else expect(bits(actual),id).toBe(bits(reference));
  }
  expect(f.calls).toEqual([]);
});

it('rejects constant-folded domain, underflow and overflow errors at save without persisting any flow or Run',async()=>{
  const f=await fixture([]);
  const invalid:[ScratchTranscendental,number,string][]=[['asin',1.0000000000000002,'DomainError'],['acos',-1.0000000000000002,'DomainError'],['ln',0,'DomainError'],['log',-1,'DomainError'],['tan',90,'DomainError'],['sin',-Number.MIN_VALUE,'NumericUnderflow'],['exp',-746,'NumericUnderflow'],['exp10',-324,'NumericUnderflow'],['exp',710,'NumericOverflow'],['exp10',309,'NumericOverflow']];
  for(const [op,x,code] of invalid){
    const definition={...f.definition,body:[declare('invalid',math(op,number(x)))]};
    const diagnostic=validateFlowDefinition(definition,await numericServer.scratchNumericOptions(definition));
    expect(diagnostic.issues,`${op}(${x})`).toEqual(expect.arrayContaining([expect.objectContaining({code,severity:'error',path:'body.0.value'})]));
    await expect(f.service.save(f.scope,actor,{definition,expectedRevision:0,requestId:randomUUID()}),`${op}(${x})`).rejects.toMatchObject({code:'AUTOMATION_DEFINITION_INVALID'});
  }
  const counts=(await sql<{flows:number;runs:number}>`SELECT (SELECT count(*)::integer FROM automation_flows WHERE ${tenant(f.scope)}) AS flows,(SELECT count(*)::integer FROM automation_runs WHERE ${tenant(f.scope)}) AS runs`.execute(db)).rows[0];
  expect(counts).toEqual({flows:0,runs:0});expect(f.calls).toEqual([]);
});

it.each([
  ['domain','ln',0,2,'AUTOMATION_DOMAIN_ERROR'],['underflow','exp',-746,1,'AUTOMATION_NUMERIC_UNDERFLOW'],['overflow','exp',710,1,'AUTOMATION_NUMERIC_OVERFLOW'],
] as const)('stops a dynamic %s error at runtime before the following external operation',async(_kind,op,invalid,valid,reason)=>{
  const f=await fixture([declare('invalid',math(op,variable('x')))],{x:valid});f.definition.body.push(f.send('must-not-send'));
  f.mock.outcomes={'must-not-send':'SUCCEEDED'};await enable(f);
  f.values.x!.value=invalid;
  const run=await f.start();expect(await f.worker().tick(f.scope,run.id)).toMatchObject({state:'FAILED'});
  const failed=(await f.service.store.run(f.scope,run.id))!;expect(failed.ended_at).not.toBeNull();
  expect(failed.reason).toBe(reason);expect(failed.resume.variables.invalid).toBeUndefined();
  expect(await f.worker().tick(f.scope,run.id)).toMatchObject({state:'FAILED'});expect(f.calls).toEqual([]);
  expect((await sql`SELECT identity FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${run.id}::uuid`.execute(db)).rows).toEqual([]);
});

it('T131 preserves the old Run rounding mode across Wait when a newly enabled revision selects a different explicit mode',async()=>{
  const body=(roundingMode:'tiesAwayFromZero'|'tiesTowardPositiveInfinity'):Statement[]=>{
    const rounded:ValueInput={kind:'expression',type:'Number',expression:{operator:'number.roundInteger',args:[variable('x')],options:{roundingMode}}};
    return [declare('before',rounded),wait('rounding-wait'),declare('after',rounded),wait('tail-wait',60)];
  };
  const f=await fixture(body('tiesAwayFromZero'),{x:-1.5});await enable(f);
  const missingMode:ValueInput={kind:'expression',type:'Number',expression:{operator:'number.roundInteger',args:[variable('x')],options:{}}};
  await expect(f.service.save(f.scope,actor,{definition:{...f.definition,body:[declare('invalid',missingMode)]},expectedRevision:1,requestId:randomUUID()})).rejects.toMatchObject({code:'AUTOMATION_DEFINITION_INVALID'});
  const old=await f.start();expect(await f.worker().tick(f.scope,old.id)).toMatchObject({state:'WAITING'});
  const held=(await f.service.store.run(f.scope,old.id))!;expect(held.resume.variables.before!.value).toBe(-2);
  f.definition.body=body('tiesTowardPositiveInfinity');await enable(f,[],1);
  expect((await f.service.store.run(f.scope,old.id))!).toEqual(held);
  f.clock.now=new Date(f.clock.now.getTime()+1100);expect(await f.worker().tick(f.scope,old.id)).toMatchObject({state:'WAITING'});
  const resumed=(await f.service.store.run(f.scope,old.id))!;
  expect(resumed).toMatchObject({revision:1,semantic_hash:held.semantic_hash});expect(resumed.resume.variables.after!.value).toBe(-2);
  const fresh=await f.start();expect(fresh.revision).toBe(2);expect(await f.worker().tick(f.scope,fresh.id)).toMatchObject({state:'WAITING'});
  expect((await f.service.store.run(f.scope,fresh.id))!.resume.variables.before!.value).toBe(-1);
  f.clock.now=new Date(f.clock.now.getTime()+1100);expect(await f.worker().tick(f.scope,fresh.id)).toMatchObject({state:'WAITING'});
  expect((await f.service.store.run(f.scope,fresh.id))!.resume.variables.after!.value).toBe(-1);expect(f.calls).toEqual([]);
});

it('preserves UNKNOWN and cancellation priority after numeric evaluation without resending or evaluating later invalid math',async()=>{
  const f=await fixture([declare('before',math('sin',variable('x'))),wait('before-operation')],{x:30});
  f.definition.body.push(f.send('uncertain-operation'),declare('later',math('ln',variable('x'))));
  f.mock.outcomes={'uncertain-operation':'SUCCEEDED'};await enable(f);
  f.adapter.execute=async context=>{f.calls.push(context.identity);return {state:'UNKNOWN',code:'SYNTHETIC_NUMERIC_UNKNOWN'};};
  const uncertain=await f.start();expect(await f.worker().tick(f.scope,uncertain.id)).toMatchObject({state:'WAITING'});
  const held=(await f.service.store.run(f.scope,uncertain.id))!;
  expect(withinScratchFourUlps(held.resume.variables.before!.value as number,0.5)).toBe(true);
  held.resume.variables.x!.value=0;await f.service.store.save(f.scope,uncertain.id,held.resume,'WAITING',held.wake_at);
  f.clock.now=new Date(f.clock.now.getTime()+1100);expect(await f.worker().tick(f.scope,uncertain.id)).toMatchObject({state:'UNKNOWN'});
  const unknown=(await f.service.store.run(f.scope,uncertain.id))!;
  await f.service.cancel(f.scope,actor,uncertain.id,randomUUID());expect(await f.worker().tick(f.scope,uncertain.id)).toMatchObject({state:'UNKNOWN'});
  expect((await f.service.store.run(f.scope,uncertain.id))!.ended_at).toEqual(unknown.ended_at);expect(f.calls).toHaveLength(1);

  const cancelled=await f.start();expect(await f.worker().tick(f.scope,cancelled.id)).toMatchObject({state:'WAITING'});
  const second=(await f.service.store.run(f.scope,cancelled.id))!;second.resume.variables.x!.value=0;
  await f.service.store.save(f.scope,cancelled.id,second.resume,'WAITING',second.wake_at);
  await f.service.cancel(f.scope,actor,cancelled.id,randomUUID());f.clock.now=new Date(f.clock.now.getTime()+1100);
  expect(await f.worker().tick(f.scope,cancelled.id)).toMatchObject({state:'CANCELLED'});expect(f.calls).toHaveLength(1);
  expect((await sql<{state:string}>`SELECT state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${uncertain.id}::uuid`.execute(db)).rows).toEqual([{state:'UNKNOWN'}]);
  expect((await sql`SELECT identity FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${cancelled.id}::uuid`.execute(db)).rows).toEqual([]);
});

it('charges mathematical evaluations to the shared persisted budget and hard-stops after worker restart before any operation',async()=>{
  const f=await fixture([wait('budget-wait'),declare('result',math('sin',variable('x')))],{x:30});f.definition.body.push(f.send('must-not-send'));
  f.mock.outcomes={'must-not-send':'SUCCEEDED'};await enable(f);
  const run=await f.start();expect(await f.worker().tick(f.scope,run.id)).toMatchObject({state:'WAITING'});
  // Expression and argument fit; the 32-work reservation exceeds the ceiling by one.
  const held=(await f.service.store.run(f.scope,run.id))!;held.resume.evaluations=DEFAULT_AUTOMATION_LIMITS.maxEvaluations-33;
  await f.service.store.save(f.scope,run.id,held.resume,'WAITING',held.wake_at);
  f.clock.now=new Date(f.clock.now.getTime()+1100);expect(await f.worker().tick(f.scope,run.id)).toMatchObject({state:'FAILED'});
  const failed=(await f.service.store.run(f.scope,run.id))!;
  expect(failed.reason).toBe('AUTOMATION_EVALUATION_BUDGET');expect(failed.resume.evaluations).toBeGreaterThan(DEFAULT_AUTOMATION_LIMITS.maxEvaluations);
  expect(failed.resume.variables.result).toBeUndefined();expect(f.calls).toEqual([]);
  expect((await sql`SELECT identity FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${run.id}::uuid`.execute(db)).rows).toEqual([]);
});

it('fails a Run closed when numeric engine initialization fails without claiming or executing any following operation',async()=>{
  const f=await fixture([declare('result',math('sin',variable('x')))],{x:30});f.definition.body.push(f.send('must-not-send'));
  f.mock.outcomes={'must-not-send':'SUCCEEDED'};await enable(f);const run=await f.start();
  const engineInit=vi.spyOn(numericServer,'scratchNumericOptions').mockRejectedValueOnce(new Error('synthetic engine load fault'));
  expect(await f.worker().tick(f.scope,run.id)).toMatchObject({state:'FAILED'});expect(engineInit).toHaveBeenCalledTimes(1);
  const failed=(await f.service.store.run(f.scope,run.id))!;
  expect(failed.reason).toBe('AUTOMATION_NUMERIC_ENGINE_UNAVAILABLE');expect(failed.ended_at).not.toBeNull();
  expect(failed.resume.evaluations).toBe(0);expect(failed.resume.checkpointVersion).toBe(1);expect(f.calls).toEqual([]);
  expect(await f.worker().tick(f.scope,run.id)).toMatchObject({state:'FAILED'});expect(engineInit).toHaveBeenCalledTimes(1);
  expect((await sql`SELECT identity FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${run.id}::uuid`.execute(db)).rows).toEqual([]);
});

it('preserves deadline and unresolved-operation priority over numeric engine initialization failure with a concurrent cancellation request',async()=>{
  const f=await fixture([declare('result',math('sin',variable('x')))],{x:30});f.definition.body.push(f.send('must-not-send'));
  f.mock.outcomes={'must-not-send':'SUCCEEDED'};await enable(f);
  const expired=await f.start();
  await sql`UPDATE automation_runs SET deadline_at=${f.clock.now} WHERE ${tenant(f.scope)} AND id=${expired.id}::uuid`.execute(db);
  const deadlineFault=vi.spyOn(numericServer,'scratchNumericOptions').mockRejectedValueOnce(new Error('synthetic engine load fault'));
  expect(await f.worker().tick(f.scope,expired.id)).toMatchObject({state:'EXPIRED'});expect(deadlineFault).toHaveBeenCalledTimes(1);
  const deadline=(await f.service.store.run(f.scope,expired.id))!;
  expect(deadline.reason).toBe('RUN_DEADLINE');expect(deadline.ended_at).toEqual(f.clock.now);expect(deadline.resume.evaluations).toBe(0);
  deadlineFault.mockRestore();

  const uncertain=await f.start(),before=(await f.service.store.run(f.scope,uncertain.id))!;
  await f.service.store.beginOperation(f.scope,uncertain.id,'synthetic-inflight-operation','discord.sendMessage','synthetic-input-fingerprint',undefined,f.clock.now,automationDispatchCheckpoint(before.resume));
  // Model a request arriving while dispatch is in flight, without the public
  // cancellation method eagerly resolving a Run that has no in-flight claim.
  await sql`UPDATE automation_runs SET cancel_requested_at=${f.clock.now} WHERE ${tenant(f.scope)} AND id=${uncertain.id}::uuid`.execute(db);
  const uncertaintyFault=vi.spyOn(numericServer,'scratchNumericOptions').mockRejectedValueOnce(new Error('synthetic engine load fault'));
  expect(await f.worker().tick(f.scope,uncertain.id)).toMatchObject({state:'UNKNOWN'});expect(uncertaintyFault).toHaveBeenCalledTimes(1);
  const unknown=(await f.service.store.run(f.scope,uncertain.id))!;
  expect(unknown.ended_at).not.toBeNull();expect(unknown.resume.evaluations).toBe(0);expect(unknown.cancel_requested_at).toEqual(f.clock.now);
  expect(await f.worker().tick(f.scope,uncertain.id)).toMatchObject({state:'UNKNOWN'});expect(uncertaintyFault).toHaveBeenCalledTimes(1);expect(f.calls).toEqual([]);
  expect((await sql<{identity:string;state:string}>`SELECT identity,state FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${uncertain.id}::uuid`.execute(db)).rows).toEqual([{identity:'synthetic-inflight-operation',state:'STARTED'}]);
  expect((await sql`SELECT identity FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${expired.id}::uuid`.execute(db)).rows).toEqual([]);
});

it('creates an actor-bound Discord menu button for a reviewed interaction Flow containing literal pinned math without starting a Run',async()=>{
  const f=await fixture([declare('result',math('sin',number(30)))]);f.definition.trigger={kind:'interaction',inputs:[]};await enable(f);
  const tokens=new Components('synthetic-math-menu-components'),vault=new IdentityVault('ab'.repeat(32),'cd'.repeat(32));
  const userId='884111111111111111',channelId='884222222222222222',applicationId='884333333333333333';
  const authorization={scope:f.scope,userId,member:{permissions:'8',roles:[],bot:false,joinedAt:'2026-01-01T00:00:00Z'},settings:await new SettingsService(db).get(f.scope),actor,checkedAt:Date.now()};
  const panel=await alpha15AutomationInteraction(db,f.scope,{id:'884444444444444444',applicationId,token:'synthetic-not-sent',userId,channelId},{action:'automationMenu'},authorization,tokens,vault,'en',{admission,adoptedActions:new Set()});
  const controls=(value:unknown):Record<string,unknown>[]=>{
    if(Array.isArray(value))return value.flatMap(controls);
    if(!value||typeof value!=='object')return [];
    const node=value as Record<string,unknown>;return [...(typeof node.custom_id==='string'?[node]:[]),...Object.values(node).flatMap(controls)];
  };
  const buttons=controls(panel);expect(buttons).toHaveLength(1);expect(buttons[0]!.label).toBe(f.definition.name);
  const intent=await tokens.read(db,f.scope,String(buttons[0]!.custom_id),actor.key);
  expect(intent).toMatchObject({action:'automationTrigger',flowId:f.definition.id,revision:1});
  expect((await sql<{flow_id:string;revision:number;actor_hash:string}>`SELECT flow_id,revision,actor_hash FROM automation_interaction_instances WHERE ${tenant(f.scope)}`.execute(db)).rows).toEqual([{flow_id:f.definition.id,revision:1,actor_hash:actor.key}]);
  expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(f.scope)}`.execute(db)).rows).toEqual([]);expect(f.calls).toEqual([]);
});
