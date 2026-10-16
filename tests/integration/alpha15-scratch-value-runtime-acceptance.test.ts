import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import Fastify from 'fastify';
import {afterAll,afterEach,beforeAll,expect,it,vi} from 'vitest';
import {connect,ensureGuild,migrate,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild,apiToken} from '../../packages/security/src/scoping';
import {createPublicApiProof} from '../../packages/security/src/public-api';
import {PublicSessions} from '../../packages/security/src/public-sessions';
import {IdentityVault} from '../../packages/identity/src/index';
import type {Actor} from '../../packages/settings/src/index';
import {isDomainError} from '../../packages/shared/src/index';
import * as diagnostics from '../../packages/shared/src/diagnostics';
import * as observability from '../../packages/shared/src/observability';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationRuntime,type AutomationRuntimeAdapter} from '../../packages/automation/src/runtime';
import type {AutomationAdmissionLimits} from '../../packages/automation/src/quota';
import type {EvaluatedValue,FlowDefinition,Statement,ValueInput,ValueType,VariableDeclaration} from '../../packages/automation/src/types';
import {registerAlpha15Automation} from '../../apps/api/src/alpha15-automation';
import {processAlpha15AutomationRuns} from '../../apps/worker/src/alpha15-automation';
import {FakeDiscord} from '../fixtures/discord';
import {isolatedPostgres} from '../fixtures/postgres';

let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const actor:Actor={key:'synthetic-value-runtime-admin',encryptedUserId:'synthetic-encrypted-identity',permissions:'8',roles:[],source:'WEB_DASHBOARD',requestId:'synthetic-value-runtime'};
const admission:AutomationAdmissionLimits={activeFlows:20,monthlyRuns:100,guildConcurrent:2,globalConcurrent:10,guildPending:20,globalPending:100,measurementId:'isolated-value-runtime-fixtures'};
const numberList:ValueType={kind:'List',element:'Number'};
const number=(value:number):ValueInput=>({kind:'literal',type:'Number',value});
const variable=(variableId:string,type:ValueType):ValueInput=>({kind:'variable',variableId,type});
const declare=(id:string,type:ValueType,value:ValueInput):Statement=>({id:'declare-'+id,kind:'declare',variable:{id,name:id,type},value});
const wait=(id:string,seconds=1):Statement=>({id,kind:'wait',duration:{kind:'literal',type:'Duration',value:seconds}});
const append=(list:ValueInput):ValueInput=>({kind:'expression',type:numberList,expression:{operator:'list.append',args:[list,number(3)]}});

beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');vi.stubEnv('NEXUS_SESSION_SECRET','s'.repeat(64));vi.stubEnv('NEXUS_WEB_URL','https://nexus.example');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterEach(()=>vi.restoreAllMocks());
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});

async function fixture(body:Statement[],inputs:VariableDeclaration[]=[],values:Record<string,EvaluatedValue>={}){
  const scope=scopeForGuild(String(889000000000000000n+BigInt(++serial)));await ensureGuild(db,scope);
  const clock={now:new Date()},calls:{identity:string;content:unknown}[]=[];
  const definition:FlowDefinition={schemaVersion:1,semanticProfile:'scratch.v1',id:'value-runtime-'+serial,name:'Synthetic value runtime acceptance',guildId:scope.guildId,trigger:{kind:'manual',inputs},variables:[],body};
  const channel='889222222222222222';definition.targets={channelIds:[channel],roleIds:[],parentCategoryIds:[]};
  const send=(id:string,content:string):Statement=>({id,kind:'action',operation:'discord.sendMessage',inputs:{channel:{kind:'literal',type:'ChannelRef',value:{id:channel,guildId:scope.guildId}},content:{kind:'literal',type:'PlainText',value:content}}});
  const options={admission,now:()=>clock.now,authorize:async()=>{},adoptedActions:new Set(['discord.sendMessage'])};
  const service=new AutomationService(db,options);
  const adapter:AutomationRuntimeAdapter={authorize:async()=>{},execute:async context=>{calls.push({identity:context.identity,content:context.inputs.content?.value});throw Error('UNEXPECTED_OPERATION_IN_VALUE_ACCEPTANCE');}};
  const worker=()=>new AutomationRuntime(db,{admission,adapter,now:()=>clock.now});
  const start=()=>service.start(scope,actor,definition.id,{requestId:randomUUID(),values});
  return {scope,clock,calls,definition,service,options,adapter,worker,start,values,send};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function enable(f:Fixture){
  const saved=await f.service.save(f.scope,actor,{definition:f.definition,expectedRevision:0,requestId:randomUUID()});expect(saved.validation).toMatchObject({valid:true,complete:true,issues:[]});
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const){
    const checked=await f.service.check(f.scope,actor,f.definition.id,1,kind,{values:Object.fromEntries(Object.entries(f.values).map(([id,{type,value}])=>[id,{type,value}])),outcomes:Object.fromEntries(f.definition.body.filter(statement=>statement.kind==='action').map(statement=>[statement.id,'SUCCEEDED' as const]))});
    expect(checked).toMatchObject({valid:true,complete:true});if(kind==='TEST')expect(checked).toMatchObject({status:'COMPLETED'});
  }
  expect(await f.service.enable(f.scope,actor,f.definition.id,{revision:1,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()})).toMatchObject({state:'ACTIVE',activeRevision:1});
}

it('T074 leaves the source and old List copies unchanged until explicit DA02 assignment and persists that distinction across Wait and a new worker',async()=>{
  const f=await fixture([
    declare('callerList',numberList,{kind:'literal',type:numberList,value:[1,2]}),
    declare('alias',numberList,variable('callerList',numberList)),
    declare('oldCopy',numberList,variable('callerList',numberList)),
    declare('newList',numberList,append(variable('callerList',numberList))),
    wait('before-assignment'),
    {id:'explicit-da02',kind:'assign',variableId:'callerList',value:append(variable('callerList',numberList))},
    wait('after-assignment'),
    declare('readAfterRestart',numberList,variable('callerList',numberList)),
    wait('tail',60),
  ]);
  await enable(f);const run=await f.start();expect(await f.worker().tick(f.scope,run.id)).toMatchObject({state:'WAITING'});
  const initial=(await f.service.store.run(f.scope,run.id))!;
  expect(initial.resume.variables.callerList!.value).toEqual([1,2]);expect(initial.resume.variables.newList!.value).toEqual([1,2,3]);
  expect(initial.resume.variables.alias!.value).toEqual([1,2]);expect(initial.resume.variables.oldCopy!.value).toEqual([1,2]);
  f.clock.now=new Date(f.clock.now.getTime()+1100);expect(await f.worker().tick(f.scope,run.id)).toMatchObject({state:'WAITING'});
  const assigned=(await f.service.store.run(f.scope,run.id))!;
  expect(assigned.resume.variables.callerList!.value).toEqual([1,2,3]);expect(assigned.resume.variables.alias!.value).toEqual([1,2]);expect(assigned.resume.variables.oldCopy!.value).toEqual([1,2]);
  expect(assigned.resume.variables.newList!.value).toEqual([1,2,3]);expect(initial.resume.variables.callerList!.value).toEqual([1,2]);
  f.clock.now=new Date(f.clock.now.getTime()+1100);expect(await f.worker().tick(f.scope,run.id)).toMatchObject({state:'WAITING'});
  const resumed=(await f.service.store.run(f.scope,run.id))!;
  expect(resumed.resume.variables.readAfterRestart!.value).toEqual([1,2,3]);expect(resumed.resume.variables.alias!.value).toEqual([1,2]);expect(resumed.resume.variables.oldCopy!.value).toEqual([1,2]);expect(f.calls).toEqual([]);
});

it('T113 keeps real Run body and variable canaries out of known execution logs, monitoring calls and history responses while distinguishing necessary resume and saved definitions',async()=>{
  const bodyCanary='synthetic-body-canary-8f341-private-text',variableCanary='synthetic-variable-canary-b2379-private-value';
  const f=await fixture([
    declare('privateCopy','PlainText',variable('privateInput','PlainText')),wait('private-wait'),
    declare('length','Number',{kind:'expression',type:'Number',expression:{operator:'text.length',args:[variable('privateCopy','PlainText')]}}),
  ],[{id:'privateInput',name:'Private input',type:'PlainText'}],{privateInput:{type:'PlainText',value:variableCanary,provenance:[]}});
  f.definition.body.push(f.send('write-private-body',bodyCanary));await enable(f);
  f.adapter.execute=async context=>{f.calls.push({identity:context.identity,content:context.inputs.content?.value});throw new Error('synthetic transport error '+bodyCanary+' '+variableCanary);};
  const stderr:string[]=[];
  vi.spyOn(process.stderr,'write').mockImplementation(chunk=>{stderr.push(typeof chunk==='string'?chunk:Buffer.from(chunk).toString());return true;});
  const consoleCalls=[vi.spyOn(console,'log').mockImplementation(()=>{}),vi.spyOn(console,'info').mockImplementation(()=>{}),vi.spyOn(console,'warn').mockImplementation(()=>{}),vi.spyOn(console,'error').mockImplementation(()=>{}),vi.spyOn(console,'debug').mockImplementation(()=>{})];
  const logger=vi.spyOn(diagnostics,'logFailure'),traceStep=vi.spyOn(observability,'traceStep'),traceSync=vi.spyOn(observability,'traceSync');
  const run=await f.start();
  // This is the same poll/catch boundary used by scripts/dev.ts. Connector
  // messages are absorbed by runtime into a bounded status code before it.
  const poll=()=>processAlpha15AutomationRuns(db,f.adapter,f.options,f.clock.now).catch(error=>{diagnostics.logFailure({action:'alpha15_automation',stage:'run_poll',error});throw error;});
  expect(await poll()).toMatchObject({processed:1});
  const waiting=(await f.service.store.run(f.scope,run.id))!;
  expect(waiting.status).toBe('WAITING');expect(waiting.resume.variables.privateCopy!.value).toBe(variableCanary);
  expect(JSON.stringify(waiting.resume)).not.toContain(bodyCanary);
  expect(JSON.stringify((await f.service.getRevision(f.scope,actor,f.definition.id,1)).definition)).toContain(bodyCanary);
  f.clock.now=new Date(f.clock.now.getTime()+1100);expect(await poll()).toMatchObject({processed:1});
  const terminal=(await f.service.store.run(f.scope,run.id))!;expect(terminal.status).toBe('UNKNOWN');expect(terminal.reason).toBe('CONNECTOR_RESULT_UNKNOWN');
  expect(f.calls).toHaveLength(1);expect(f.calls[0]!.content).toBe(bodyCanary);
  const events=(await sql<{state:string;code:string}>`SELECT * FROM automation_run_events WHERE ${tenant(f.scope)} AND run_id=${run.id}::uuid`.execute(db)).rows;
  expect(events).toEqual([expect.objectContaining({state:'UNKNOWN',code:'CONNECTOR_RESULT_UNKNOWN'})]);
  const metadata={events,operations:(await sql`SELECT * FROM automation_operations WHERE ${tenant(f.scope)} AND run_id=${run.id}::uuid`.execute(db)).rows,run:(await sql`SELECT to_jsonb(r)-'resume' AS metadata FROM automation_runs r WHERE ${tenant(f.scope)} AND id=${run.id}::uuid`.execute(db)).rows,requests:(await sql`SELECT * FROM automation_requests WHERE ${tenant(f.scope)}`.execute(db)).rows,checks:(await sql`SELECT * FROM automation_checks WHERE ${tenant(f.scope)}`.execute(db)).rows,operationsAudit:(await sql`SELECT * FROM operations_audit_events WHERE ${tenant(f.scope)}`.execute(db)).rows};

  const key='synthetic-value-api-key',user='889111111111111111',vault=new IdentityVault('ab'.repeat(32),'cd'.repeat(32)),discord=new FakeDiscord();
  discord.members.set(user,{permissions:'8',roles:[],bot:false,joinedAt:'2026-01-01T00:00:00Z'});
  await sql`INSERT INTO server_web_links(organization_id,guild_id,verified_at,updated_at,revision) VALUES(${f.scope.organizationId}::uuid,${f.scope.guildId},now(),now(),${randomUUID()}::uuid)`.execute(db);
  const reference=await new PublicSessions(db,'s'.repeat(64),async()=>{throw Error('UNEXPECTED_REFRESH');}).create(user,{accessToken:'synthetic'},3600);
  const app=Fastify({logger:false});app.setErrorHandler((error,_request,reply)=>reply.code(isDomainError(error)?error.status:400).send({error:isDomainError(error)?error.code:'VALIDATION'}));
  registerAlpha15Automation(app,db,key,discord,vault,f.options);
  const historyResponses:{path:string;body:string}[]=[];
  try{
    const get=async(suffix:string)=>{const path=`/v3/organizations/${f.scope.organizationId}/guilds/${f.scope.guildId}/automation${suffix}`;return app.inject({method:'GET',url:path,headers:{authorization:`Bearer ${apiToken(key,f.scope)}`,'x-nexus-user-proof':createPublicApiProof({scope:f.scope,userId:user,sessionReference:reference,method:'GET',path})}});};
    for(const path of ['/overview','/runs/'+run.id,'/event-receipts','/flows']){const response=await get(path);expect(response.statusCode,path).toBe(200);expect(response.headers['cache-control']).toBe('no-store');historyResponses.push({path,body:response.body});}
    const history=JSON.parse(historyResponses.find(response=>response.path.startsWith('/runs/'))!.body);
    expect(history).toMatchObject({id:run.id,state:'UNKNOWN',reason:'CONNECTOR_RESULT_UNKNOWN',events:[{state:'UNKNOWN',code:'CONNECTOR_RESULT_UNKNOWN'}]});
    for(const key of ['resume','variables','actor_ciphertext','actor_hash'])expect(history).not.toHaveProperty(key);
    const configuration=await get('/flows/'+f.definition.id);expect(configuration.statusCode).toBe(200);expect(configuration.body).toContain(bodyCanary);expect(configuration.body).not.toContain(variableCanary);
  }finally{await app.close();}

  for(const canary of [bodyCanary,variableCanary]){
    expect(JSON.stringify(metadata)).not.toContain(canary);expect(JSON.stringify(historyResponses)).not.toContain(canary);
    expect(JSON.stringify(stderr)).not.toContain(canary);expect(JSON.stringify(consoleCalls.flatMap(spy=>spy.mock.calls))).not.toContain(canary);
    expect(JSON.stringify(traceStep.mock.calls.map(args=>args.slice(0,2)))).not.toContain(canary);expect(JSON.stringify(traceSync.mock.calls.map(args=>args.slice(0,2)))).not.toContain(canary);
  }
  expect(logger).not.toHaveBeenCalled();expect(stderr).toEqual([]);expect(consoleCalls.every(spy=>spy.mock.calls.length===0)).toBe(true);expect(traceStep).not.toHaveBeenCalled();expect(traceSync).not.toHaveBeenCalled();

  const paths=['packages/automation/src/runtime.ts','packages/automation/src/store.ts','packages/automation/src/service.ts','packages/automation/src/expression.ts','packages/automation/src/definition.ts','packages/automation/src/parallel.ts','packages/automation/src/bounded-loop.ts','packages/automation/src/iteration-results.ts','packages/automation/src/quota.ts','packages/automation/src/await.ts','packages/automation/src/scratch-math-server.ts','packages/db/src/index.ts','apps/worker/src/alpha15-automation.ts','apps/api/src/alpha15-automation.ts'];
  const directSink=/\bconsole\.(?:log|warn|error|info|debug)\s*\(|\b(?:logger|log)\.(?:info|warn|error|debug|trace)\s*\(|@opentelemetry|\b(?:traceStep|traceSync|startActiveSpan|startSpan)\s*\(/g;
  const sources=await Promise.all(paths.map(async path=>{const source=await readFile(path,'utf8');const sinkReferences=source.match(directSink)??[];expect(sinkReferences,path).toEqual([]);return {path,sha256:createHash('sha256').update(source).digest('hex'),directLoggerOrOtelReferences:sinkReferences};}));
  for(const path of ['packages/shared/src/diagnostics.ts','packages/shared/src/observability.ts','packages/shared/src/errors.ts']){const source=await readFile(path,'utf8');sources.push({path,sha256:createHash('sha256').update(source).digest('hex'),directLoggerOrOtelReferences:source.match(/process\.stderr\.write|traceCorrelation\(|startActiveSpan\(|duration\.record\(|failures\.add\(|logFailure\(/g)??[]});}
  const dev=await readFile('scripts/dev.ts','utf8'),api=await readFile('apps/api/src/server.ts','utf8');
  expect(dev).toMatch(/processAlpha15AutomationRuns\(db,alpha15Adapter,alpha15Options\)[\s\S]*?logFailure\(\{action:'alpha15_automation',stage:'run_poll',error\}\)/);expect(api).toMatch(/Fastify\(\{\s*logger:\s*false\s*\}\)/);
  await writeFile('.local/alpha15-scratch-value-runtime-sinks.json',JSON.stringify({plan:'T113',scope:'Synthetic real DB Run via processAlpha15AutomationRuns and authenticated management HTTP routes',status:'local known sinks verified',sources,knownSinks:[{sink:'automation_run_events',rows:events.length,valuesAndBodyAbsent:true},{sink:'automation_operations / automation_requests / run metadata excluding resume',valuesAndBodyAbsent:true},{sink:'API overview/run detail/event receipts/flow summaries',responses:historyResponses.length,valuesAndBodyAbsent:true},{sink:'scripts/dev.ts run_poll catch -> diagnostics.logFailure -> process.stderr',calls:logger.mock.calls.length,capturedWrites:stderr.length},{sink:'console log/info/warn/error/debug',calls:consoleCalls.reduce((count,spy)=>count+spy.mock.calls.length,0)},{sink:'shared observability traceStep/traceSync',calls:traceStep.mock.calls.length+traceSync.mock.calls.length}],allowedStorage:{savedUserDefinitionContainsBody:true,waitingResumeContainsRequiredUserInput:true,waitingResumeDoesNotContainMessageBody:true},limitations:['Synthetic mock connector, no native Discord operations.','No external OTLP exporter, collector, database server logging or third-party infrastructure sink was configured or measured.','Static inventory is scoped to the listed execution modules and current dev/API entry boundaries; no repository-wide universal sink assertion.','Saved user configuration and necessary bounded resume state are not diagnostic logs.'],entryEvidence:[{path:'scripts/dev.ts',sha256:createHash('sha256').update(dev).digest('hex'),boundary:'processAlpha15AutomationRuns.catch -> logFailure; automation poll is outside guild.work span'},{path:'apps/api/src/server.ts',sha256:createHash('sha256').update(api).digest('hex'),boundary:'Fastify logger:false'}]},null,2)+'\n');
});
