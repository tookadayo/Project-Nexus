import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,expect,it,vi} from 'vitest';
import {connect,ensureGuild,migrate,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import type {Actor} from '../../packages/settings/src/index';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationRuntime,type AutomationRuntimeAdapter} from '../../packages/automation/src/runtime';
import {fingerprint} from '../../packages/automation/src/store';
import {compileCommonUnknownChain} from '../../packages/automation/src/scratch-authoring';
import * as expressions from '../../packages/automation/src/expression';
import type {AutomationAdmissionLimits} from '../../packages/automation/src/quota';
import type {EvaluatedValue,FlowDefinition,Statement,ValueInput,ValueType,VariableDeclaration} from '../../packages/automation/src/types';
import {isolatedPostgres} from '../fixtures/postgres';

let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const guildPlaceholder='SYNTHETIC_GUILD',channel='881222222222222222';
const actor:Actor={key:'synthetic-control-admin',encryptedUserId:'encrypted-synthetic-identity',permissions:'8',roles:[],source:'WEB_DASHBOARD',requestId:'synthetic-control'};
const admission:AutomationAdmissionLimits={activeFlows:20,monthlyRuns:100,guildConcurrent:2,globalConcurrent:20,guildPending:20,globalPending:100,measurementId:'isolated-control-acceptance'};
const number=(value:number):ValueInput=>({kind:'literal',type:'Number',value});
const truth=(value:boolean):ValueInput=>({kind:'literal',type:'Boolean',value});
const unknown:ValueInput={kind:'literal',type:'ConditionResult',value:'unknown'};
const marker=(id:number,value:boolean):ValueInput=>({kind:'expression',type:'Boolean',expression:{operator:'compare.equal',args:[number(id),number(value?id:id+1)]}});
const send=(id:string):Statement=>({id,kind:'action',operation:'discord.sendMessage',inputs:{channel:{kind:'literal',type:'ChannelRef',value:{id:channel,guildId:guildPlaceholder}},content:{kind:'literal',type:'PlainText',value:id}}});
const branch=(id:string,condition:ValueInput,then:Statement[],otherwise:Statement[]=[],uncertain:Statement[]=[]):Statement=>({id,kind:'branch',condition,then,otherwise,unknown:uncertain});
const wait=(id:string):Statement=>({id,kind:'wait',duration:{kind:'literal',type:'Duration',value:10}});
const evaluateOriginal=expressions.evaluateValue;

beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterEach(()=>vi.restoreAllMocks());
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});

async function fixture(body:Statement[],options:{inputs?:VariableDeclaration[];values?:Record<string,EvaluatedValue>;scratchAuthoring?:FlowDefinition['scratchAuthoring']}={}){
  const scope=scopeForGuild(String(881000000000000000n+BigInt(++serial)));await ensureGuild(db,scope);
  const clock={now:new Date()},calls:{operation:string;identity:string;content?:string}[]=[],evaluated:ValueInput[]=[];
  const fix=(value:unknown):unknown=>value===guildPlaceholder?scope.guildId:Array.isArray(value)?value.map(fix):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,fix(item)])):value;
  const definition:FlowDefinition={schemaVersion:1,semanticProfile:'scratch.v1',id:'control-'+serial,name:'Synthetic conditional acceptance',guildId:scope.guildId,trigger:{kind:'manual',inputs:options.inputs??[]},variables:[],targets:{channelIds:[channel],roleIds:[],parentCategoryIds:[]},body:fix(body) as Statement[],...(options.scratchAuthoring?{scratchAuthoring:fix(options.scratchAuthoring) as FlowDefinition['scratchAuthoring']}:{})};
  const service=new AutomationService(db,{admission,now:()=>clock.now,authorize:async()=>{},adoptedActions:new Set(['discord.sendMessage','nexus.readTicket'])});
  const saved=await service.save(scope,actor,{definition,expectedRevision:0,requestId:randomUUID()});expect(saved.validation.issues).toEqual([]);
  // Only private synthetic rows bypass public activation; the subject of these
  // cases is canonical branch execution, fixed revision and Run checkpoints.
  await sql`UPDATE automation_flows SET state='ACTIVE',active_revision=1 WHERE ${tenant(scope)} AND id=${definition.id}`.execute(db);
  const adapter:AutomationRuntimeAdapter={authorize:async()=>{},execute:async context=>{calls.push({operation:context.operation,identity:context.identity,...(context.inputs.content?{content:String(context.inputs.content.value)}:{})});return {state:'SUCCEEDED'};}};
  const runtime=new AutomationRuntime(db,{admission,adapter,now:()=>clock.now});
  const run=await service.start(scope,actor,definition.id,{requestId:randomUUID(),...(options.values?{values:options.values}:{})});
  vi.spyOn(expressions,'evaluateValue').mockImplementation((input,context)=>{
    // Static validation visits all stored branches and has no runtime budget.
    // Observe real runtime dispatch only, while delegating the evaluator intact.
    if(context.budget&&Object.hasOwn(context.variables,'run.startedAt'))evaluated.push(structuredClone(input));
    return evaluateOriginal(input,context);
  });
  const evaluatedCount=(input:ValueInput)=>evaluated.filter(item=>fingerprint(item)===fingerprint(input)).length;
  return {scope,clock,calls,evaluated,evaluatedCount,definition,service,adapter,runtime,run};
}

it('T034 evaluates false then true, selecting only the second of three clauses',async()=>{
  const conditions=[marker(101,false),marker(202,true),marker(303,true)];
  const f=await fixture([branch('first',conditions[0]!,[send('first-body')],[branch('second',conditions[1]!,[send('second-body')],[branch('third',conditions[2]!,[send('third-body')],[send('else-body')])])]),send('after')]);
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});
  expect(f.calls.map(call=>call.content)).toEqual(['second-body','after']);
  expect(conditions.map(f.evaluatedCount)).toEqual([1,1,0]);
});

it('T038 executes only the selected common unknown copy and never evaluates a following true elif',async()=>{
  const later=marker(202,true);
  const compiled=compileCommonUnknownChain({id:'unknown-first-chain',clauses:[{id:'first',condition:unknown,then:[send('first-body')]},{id:'second',condition:later,then:[send('second-body')]}],otherwise:[send('else-body')],template:[send('shared-unknown')]});
  const f=await fixture([compiled.statement,send('after')],{scratchAuthoring:{version:1,chains:[compiled.metadata]}});
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});
  expect(f.calls.map(call=>call.content)).toEqual(['shared-unknown','after']);expect(f.evaluatedCount(unknown)).toBe(1);expect(f.evaluatedCount(later)).toBe(0);
  // Normal CT01 unknown completion joins its parent, as required by the
  // priority supplement; this case does not impose a loop-style failure stop.
});

it('T039 stops the false-to-unknown chain at its single common handler before later elif or else',async()=>{
  const first=marker(101,false),later=marker(303,true);
  const compiled=compileCommonUnknownChain({id:'unknown-second-chain',clauses:[{id:'first',condition:first,then:[send('first-body')]},{id:'second',condition:unknown,then:[send('second-body')]},{id:'third',condition:later,then:[send('third-body')]}],otherwise:[send('else-body')],template:[send('shared-unknown')]});
  const f=await fixture([compiled.statement,send('after')],{scratchAuthoring:{version:1,chains:[compiled.metadata]}});
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});
  expect(f.calls.map(call=>call.content)).toEqual(['shared-unknown','after']);expect(f.evaluatedCount(first)).toBe(1);expect(f.evaluatedCount(unknown)).toBe(1);expect(f.evaluatedCount(later)).toBe(0);
});

const divisor:ValueInput={kind:'variable',type:'Number',variableId:'divisor'};
const divisionCondition:ValueInput={kind:'expression',type:'Boolean',expression:{operator:'compare.greater',args:[{kind:'expression',type:'Number',expression:{operator:'number.divide',args:[number(1),divisor]}},number(0)]}};
const divisorInputs:VariableDeclaration[]=[{id:'divisor',name:'Divisor',type:'Number'}];
const zeroInput:Record<string,EvaluatedValue>={divisor:{type:'Number',value:0,provenance:[]}};

it('T041 terminates a dynamic zero-divisor CT01 as FAILED without unknown, false or else execution',async()=>{
  const f=await fixture([branch('divide',divisionCondition,[send('true-body')],[send('false-body')],[send('unknown-body')]),send('after')],{inputs:divisorInputs,values:zeroInput});
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});
  const failed=(await f.service.store.run(f.scope,f.run.id))!;expect(failed.reason).toBe('AUTOMATION_DIVIDE_BY_ZERO');expect(f.evaluatedCount(divisionCondition)).toBe(1);expect(f.calls).toEqual([]);
  expect((await sql`SELECT identity FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(db)).rows).toEqual([]);
});

it('T042 keeps an UNKNOWN selected-elif write fixed across retries and worker restart',async()=>{
  const conditions=[marker(101,false),marker(202,true),marker(303,true)];
  const f=await fixture([branch('first',conditions[0]!,[send('first-body')],[branch('second',conditions[1]!,[send('selected-write')],[branch('third',conditions[2]!,[send('third-body')],[send('else-body')])])]),send('after')]);
  f.adapter.execute=async context=>{f.calls.push({operation:context.operation,identity:context.identity,content:String(context.inputs.content!.value)});return {state:'UNKNOWN',code:'SYNTHETIC_UNRESOLVED_WRITE'};};
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'UNKNOWN'});
  const initial=(await f.service.store.run(f.scope,f.run.id))!,terminalAt=initial.ended_at!.toISOString();
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'UNKNOWN'});
  const restarted=new AutomationRuntime(db,{admission,adapter:f.adapter,now:()=>f.clock.now});expect(await restarted.tick(f.scope,f.run.id)).toMatchObject({state:'UNKNOWN'});
  expect(f.calls.map(call=>call.content)).toEqual(['selected-write']);expect(conditions.map(f.evaluatedCount)).toEqual([1,1,0]);
  const operations=(await sql<{identity:string;state:string;reason:string}>`SELECT identity,state,reason FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(db)).rows;
  expect(operations).toEqual([{identity:f.calls[0]!.identity,state:'UNKNOWN',reason:'SYNTHETIC_UNRESOLVED_WRITE'}]);
  expect((await f.service.store.run(f.scope,f.run.id))!.ended_at!.toISOString()).toBe(terminalAt);
});

it('T044 resumes the chosen true branch PC after external state changes without rereading or reevaluating its condition',async()=>{
  const recordType:ValueType={kind:'Record',schemaId:'nexus.ticket.status.v1'},ticket='intake:'+randomUUID();
  const condition:ValueInput={kind:'expression',type:'Boolean',expression:{operator:'compare.equal',args:[{kind:'expression',type:'Number',expression:{operator:'record.field',args:[{kind:'variable',type:recordType,variableId:'snapshot'}],options:{key:'version'}}},number(1)]}};
  const read:Statement={id:'read',kind:'action',operation:'nexus.readTicket',inputs:{ticket:{kind:'literal',type:'TicketRef',value:{id:ticket,guildId:guildPlaceholder}}},output:{id:'snapshot',name:'Ticket snapshot',type:recordType}};
  const f=await fixture([read,branch('selected',condition,[send('before-wait'),wait('branch-wait'),send('after-wait')],[send('else-body')]),send('after')]);
  await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,evidence,version) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},${channel},${ticket},now(),'OPEN','OPERATIONS_REQUEST','{}'::jsonb,1)`.execute(db);
  f.adapter.execute=async context=>{
    f.calls.push({operation:context.operation,identity:context.identity,...(context.inputs.content?{content:String(context.inputs.content.value)}:{})});
    if(context.operation==='nexus.readTicket'){
      const item=(await sql<{status:string;version:number}>`SELECT status,version FROM attention_items WHERE ${tenant(f.scope)} AND message_id=${ticket}`.execute(db)).rows[0]!;
      return {state:'SUCCEEDED',value:{type:recordType,value:{state:item.status,version:item.version},provenance:[{source:'service',guildId:f.scope.guildId,allowedChannelIds:[channel],resumable:true}]}};
    }
    return {state:'SUCCEEDED'};
  };
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'WAITING'});
  const paused=(await f.service.store.run(f.scope,f.run.id))!;expect(paused.resume.frames.at(-1)).toMatchObject({path:'body/1/then',index:2});
  expect(f.evaluatedCount(condition)).toBe(1);expect(f.calls.map(call=>call.content??call.operation)).toEqual(['nexus.readTicket','before-wait']);
  await sql`UPDATE attention_items SET status='RESOLVED',version=2 WHERE ${tenant(f.scope)} AND message_id=${ticket}`.execute(db);
  expect((await sql<{version:number}>`SELECT version FROM attention_items WHERE ${tenant(f.scope)} AND message_id=${ticket}`.execute(db)).rows[0]!.version).toBe(2);
  f.clock.now=new Date(f.clock.now.getTime()+11000);const restarted=new AutomationRuntime(db,{admission,adapter:f.adapter,now:()=>f.clock.now});
  expect(await restarted.tick(f.scope,f.run.id)).toMatchObject({state:'COMPLETED'});
  expect(f.calls.map(call=>call.content??call.operation)).toEqual(['nexus.readTicket','before-wait','after-wait','after']);expect(f.evaluatedCount(condition)).toBe(1);
});

it('T050 short-circuits true OR but still invokes current authorization immediately before dispatch',async()=>{
  const condition:ValueInput={kind:'expression',type:'Boolean',expression:{operator:'condition.or',args:[truth(true),divisionCondition]}};
  const f=await fixture([branch('or',condition,[send('selected-write')],[send('else-body')]),send('after')],{inputs:divisorInputs,values:zeroInput});
  const authorizationActions:number[]=[];
  f.adapter.authorize=async(_scope,run)=>{authorizationActions.push(run.resume.externalActions);if(run.resume.externalActions>0)throw new Error('AUTOMATION_CURRENT_PERMISSION_REVOKED');};
  expect(await f.runtime.tick(f.scope,f.run.id)).toMatchObject({state:'FAILED'});
  const stopped=(await f.service.store.run(f.scope,f.run.id))!;
  expect(stopped.reason).toBe('AUTOMATION_CURRENT_PERMISSION_REVOKED');expect(f.evaluatedCount(condition)).toBe(1);expect(authorizationActions).toContain(1);expect(f.calls).toEqual([]);
  expect((await sql`SELECT identity FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${f.run.id}::uuid`.execute(db)).rows).toEqual([]);
});
