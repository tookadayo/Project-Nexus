import {createHmac,randomUUID} from 'node:crypto';
import Fastify from 'fastify';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,migrate,ensureGuild,sql,tenant,json,type Database} from '../../packages/db/src/index';
import {scopeForGuild,apiToken} from '../../packages/security/src/scoping';
import {PublicSessions,publicSessionDigest} from '../../packages/security/src/public-sessions';
import {createPublicApiProof} from '../../packages/security/src/public-api';
import {IdentityVault} from '../../packages/identity/src/index';
import {isDomainError,DomainError} from '../../packages/shared/src/index';
import {registerAlpha15Automation} from '../../apps/api/src/alpha15-automation';
import {AutomationRuntime} from '../../packages/automation/src/runtime';
import {FakeDiscord} from '../fixtures/discord';
import {isolatedPostgres} from '../fixtures/postgres';
let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,serial=0;
const key='synthetic-api-key',secret='s'.repeat(64),user='884111111111111111',vault=new IdentityVault('ab'.repeat(32),'cd'.repeat(32));
beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');vi.stubEnv('NEXUS_SESSION_SECRET',secret);vi.stubEnv('NEXUS_WEB_URL','https://nexus.example');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});
async function fixture(){
  const s=scopeForGuild(String(885000000000000000n+BigInt(++serial)));await ensureGuild(db,s);
  await sql`INSERT INTO server_web_links(organization_id,guild_id,verified_at,updated_at,revision) VALUES(${s.organizationId}::uuid,${s.guildId},now(),now(),${randomUUID()}::uuid)`.execute(db);
  const discord=Object.assign(new FakeDiscord(),{options:async()=>({channels:[{id:'884222222222222222',label:'private-name'}],roles:[],events:[]}),automationPreflight:async()=>{throw new DomainError('AUTOMATION_TARGET_PERMISSION',403);}});
  discord.members.set(user,{permissions:'32',roles:[],joinedAt:'2026-01-01T00:00:00Z',bot:false});
  const sessions=new PublicSessions(db,secret,async()=>{throw new Error('unexpected refresh');}),reference=await sessions.create(user,{accessToken:'synthetic'},3600),app=Fastify();
  app.setErrorHandler((error,_req,reply)=>reply.code(isDomainError(error)?error.status:400).send({error:isDomainError(error)?error.code:'VALIDATION'}));
  const service=registerAlpha15Automation(app,db,key,discord,vault,{admission:{activeFlows:3,monthlyRuns:20,guildConcurrent:1,globalConcurrent:2,guildPending:10,globalPending:100,measurementId:'isolated-api-projections'}});
  const base=`/v3/organizations/${s.organizationId}/guilds/${s.guildId}/automation`;
  const definition={schemaVersion:1,id:'test',guildId:s.guildId,name:'Synthetic',trigger:{kind:'manual',inputs:[]},variables:[],body:[{kind:'end',id:'end'}]};
  async function call(method:'GET'|'PUT'|'POST',suffix:string,body?:unknown,headers:Record<string,string>={}){
    const path=base+suffix;return app.inject({method,url:path,headers:{authorization:`Bearer ${apiToken(key,s)}`,'x-nexus-user-proof':createPublicApiProof({scope:s,userId:user,sessionReference:reference,method,path,body,...(method!=='GET'?{origin:'https://nexus.example'}:{})}),...(method!=='GET'?{origin:'https://nexus.example','content-type':'application/json'}:{}),...headers},...(body===undefined?{}:{payload:JSON.stringify(body)})});
  }
  return {s,app,discord,reference,call,definition,service};
}
it('requires v2 exact query/body and one-time proof even when the scoped bearer is valid',async()=>{
  const f=await fixture();try{
    const path=`/v3/organizations/${f.s.organizationId}/guilds/${f.s.guildId}/automation/overview?view=all&limit=1`;
    const proof=createPublicApiProof({scope:f.s,userId:user,sessionReference:f.reference,method:'GET',path});
    const headers={authorization:`Bearer ${apiToken(key,f.s)}`,'x-nexus-user-proof':proof};
    expect((await f.app.inject({method:'GET',url:path.replace('limit=1','limit=2'),headers})).statusCode).toBe(401);
    expect((await f.app.inject({method:'GET',url:path,headers})).statusCode).toBe(200);
    expect((await f.app.inject({method:'GET',url:path,headers})).statusCode).toBe(401);
    const draftPath=`/v3/organizations/${f.s.organizationId}/guilds/${f.s.guildId}/automation/flows/test/draft`;
    const body={definition:f.definition,expectedRevision:0,requestId:randomUUID()};
    const signed=createPublicApiProof({scope:f.s,userId:user,sessionReference:f.reference,method:'PUT',path:draftPath,body,origin:'https://nexus.example'});
    const mutationHeaders={authorization:`Bearer ${apiToken(key,f.s)}`,'x-nexus-user-proof':signed,origin:'https://nexus.example','content-type':'application/json'};
    expect((await f.app.inject({method:'PUT',url:draftPath,headers:mutationHeaders,payload:{...body,expectedRevision:1}})).statusCode).toBe(401);
    expect((await f.app.inject({method:'PUT',url:draftPath,headers:mutationHeaders,payload:body})).statusCode).toBe(200);
    const now=Date.now(),legacy=Buffer.from(JSON.stringify({scope:f.s,userId:user,sessionDigest:publicSessionDigest(f.reference),method:'GET',path:path.split('?')[0],issuedAt:now,expiresAt:now+30000})).toString('base64url');
    const mac=createHmac('sha256',secret).update('public-api:v1:'+legacy).digest('base64url');
    expect((await f.app.inject({method:'GET',url:path,headers:{...headers,'x-nexus-user-proof':legacy+'.'+mac}})).statusCode).toBe(401);
  }finally{await f.app.close();}
});
it('returns only explicitly selected simulation values to the currently authorized configuring user',async()=>{
  const f=await fixture();try{
    const definition={...f.definition,semanticProfile:'scratch.v1',body:[
      {id:'number',kind:'declare',variable:{id:'count',name:'Count',type:'Number'},value:{kind:'literal',type:'Number',value:8}},
      {id:'private',kind:'declare',variable:{id:'notSelected',name:'Not selected',type:'PlainText'},value:{kind:'literal',type:'PlainText',value:'synthetic unselected inspection value'}},
    ]};
    expect((await f.call('PUT','/flows/test/draft',{definition,expectedRevision:0,requestId:randomUUID()})).statusCode).toBe(200);
    const ordinary=await f.call('POST','/flows/test/test',{revision:1});
    expect(ordinary.statusCode).toBe(200);expect(ordinary.json().inspection).toBeUndefined();
    expect(ordinary.body).not.toContain('synthetic unselected inspection value');
    const selected=await f.call('POST','/flows/test/test',{revision:1,simulation:{inspectVariables:['count']}});
    expect(selected.statusCode).toBe(200);
    expect(selected.json().inspection).toMatchObject({mode:'SIMULATION_ONLY',values:[{variableId:'count',type:'Number',value:8}],unavailable:[]});
    expect(selected.body).not.toContain('synthetic unselected inspection value');
    expect(selected.headers['cache-control']).toBe('no-store');
    expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
    f.discord.members.get(user)!.permissions='0';
    expect((await f.call('POST','/flows/test/test',{revision:1,simulation:{inspectVariables:['count']}})).statusCode).toBe(403);
    expect((await f.call('POST','/flows/test/test',{revision:1,simulation:{inspectVariables:['count']}},{'x-nexus-user-proof':''})).statusCode).toBe(401);
  }finally{await f.app.close();}
});
it('rejects malformed, duplicate and excessive simulation inspector selections at the API boundary',async()=>{
  const f=await fixture();try{
    for(const inspectVariables of [['bad/id'],['same','same'],Array.from({length:129},(_,index)=>'v'+index)]){
      expect((await f.call('POST','/flows/test/test',{revision:1,simulation:{inspectVariables}})).statusCode).toBe(400);
    }
  }finally{await f.app.close();}
});
it('reads an explicitly selected saved revision within the current user and tenant boundary',async()=>{
  const f=await fixture(),other=await fixture();try{
    expect((await f.call('PUT','/flows/test/draft',{definition:f.definition,expectedRevision:0,requestId:randomUUID()})).statusCode).toBe(200);
    expect((await f.call('PUT','/flows/test/draft',{definition:{...f.definition,name:'Current revision'},expectedRevision:1,requestId:randomUUID()})).statusCode).toBe(200);
    const previous=await f.call('GET','/flows/test/revisions/1');
    expect(previous.statusCode).toBe(200);expect(previous.headers['cache-control']).toBe('no-store');
    expect(previous.json()).toEqual({id:'test',revision:1,definition:expect.objectContaining({name:'Synthetic',guildId:f.s.guildId})});
    expect((await f.call('GET','/flows/test/revisions/2')).json().definition.name).toBe('Current revision');
    expect((await other.call('GET','/flows/test/revisions/1')).statusCode).toBe(404);
    expect((await f.call('GET','/flows/test/revisions/1',undefined,{'x-nexus-user-proof':''})).statusCode).toBe(401);
    f.discord.members.get(user)!.permissions='0';
    expect((await f.call('GET','/flows/test/revisions/1')).statusCode).toBe(403);
    expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  }finally{await f.app.close();await other.app.close();}
});
it('bounds revision inputs and does not expose a retained revision of a deleted flow',async()=>{
  const f=await fixture();try{
    expect((await f.call('PUT','/flows/test/draft',{definition:f.definition,expectedRevision:0,requestId:randomUUID()})).statusCode).toBe(200);
    for(const revision of ['0','-1','1.5','2147483648','Infinity','not-a-revision'])
      expect((await f.call('GET','/flows/test/revisions/'+revision)).statusCode).toBe(400);
    expect((await f.call('GET','/flows/test/revisions/2')).statusCode).toBe(404);
    await sql`UPDATE automation_flows SET state='DELETED',deleted_at=now() WHERE ${tenant(f.s)} AND id='test'`.execute(db);
    expect((await sql`SELECT revision FROM automation_revisions WHERE ${tenant(f.s)} AND flow_id='test'`.execute(db)).rows).toHaveLength(1);
    expect((await f.call('GET','/flows/test/revisions/1')).statusCode).toBe(404);
  }finally{await f.app.close();}
});
it('binds automation save to the live public user instead of a fixed web-admin actor',async()=>{
  const f=await fixture();try{
    const saved=await f.call('PUT','/flows/test/draft',{definition:f.definition,expectedRevision:0,requestId:randomUUID()});expect(saved.statusCode).toBe(200);
    const row=(await sql<{actor_hash:string}>`SELECT actor_hash FROM automation_requests WHERE ${tenant(f.s)}`.execute(db)).rows[0]!;expect(row.actor_hash).toBe(vault.hash(f.s,user));
    expect((await f.call('GET','/flows/test')).statusCode).toBe(200);
  }finally{await f.app.close();}
});
it('does not advertise production availability for a metadata trigger without an adopted ingress',async()=>{
  const f=await fixture();try{
    const definition={...f.definition,trigger:{kind:'messageMetadata',channelIds:['884222222222222222'],excludeBots:true,inputs:[]}};
    expect((await f.call('PUT','/flows/test/draft',{definition,expectedRevision:0,requestId:randomUUID()})).statusCode).toBe(200);
    const impact=await f.call('POST','/flows/test/impact',{revision:1});
    expect(impact.statusCode).toBe(200);
    expect(impact.json()).toMatchObject({productionAvailable:false,productionUnavailableReason:'AUTOMATION_TRIGGER_UNAVAILABLE'});
  }finally{await f.app.close();}
});
it('rejects a service token without the real-user proof and stale membership',async()=>{
  const f=await fixture();try{
    expect((await f.call('GET','/flows',undefined,{'x-nexus-user-proof':''})).statusCode).toBe(401);
    f.discord.members.get(user)!.permissions='0';expect((await f.call('GET','/flows')).statusCode).toBe(403);
  }finally{await f.app.close();}
});
it('rejects a cross-origin mutation and client actor fields without creating a draft',async()=>{
  const f=await fixture();try{
    const input={definition:f.definition,expectedRevision:0,requestId:randomUUID()};expect((await f.call('PUT','/flows/test/draft',input,{origin:'https://attacker.example'})).statusCode).toBe(403);
    expect((await f.call('PUT','/flows/test/draft',{...input,actor:{permissions:'8',key:'web-admin'}})).statusCode).toBe(400);
    expect((await sql`SELECT id FROM automation_flows WHERE ${tenant(f.s)}`.execute(db)).rows.length).toBe(0);
  }finally{await f.app.close();}
});
it('does not reveal inaccessible target names and rejects a revoked shared session',async()=>{
  const f=await fixture();try{
    const targets=await f.call('GET','/targets?kind=ChannelRef');expect(targets.statusCode).toBe(200);expect(targets.json()).toEqual({state:'AVAILABLE',items:[]});expect(targets.body.includes('private-name')).toBe(false);
    await sql`UPDATE public_oauth_sessions SET revoked_at=now() WHERE digest=${publicSessionDigest(f.reference)}`.execute(db);
    expect((await f.call('GET','/overview')).statusCode).toBe(401);
  }finally{await f.app.close();}
});
it('returns durable parallel branch status without resume values or encrypted identities',async()=>{
  const f=await fixture(),other=await fixture();try{
    const definition={...f.definition,body:[{kind:'parallel',id:'join',branches:[{id:'a',name:'A',body:[{kind:'wait',id:'wait-a',duration:{kind:'literal',type:'Duration',value:10}}]},{id:'b',name:'B',body:[{kind:'wait',id:'wait-b',duration:{kind:'literal',type:'Duration',value:20}}]}]}]};
    const saved=await f.call('PUT','/flows/test/draft',{definition,expectedRevision:0,requestId:randomUUID()});expect(saved.statusCode).toBe(200);
    for(const action of ['validate','test','impact'])expect((await f.call('POST','/flows/test/'+action,{revision:1})).statusCode).toBe(200);
    expect((await f.call('POST','/flows/test/enable',{revision:1,semanticHash:saved.json().validation.semanticHash,requestId:randomUUID()})).statusCode).toBe(200);
    const started=await f.call('POST','/flows/test/runs',{requestId:randomUUID()});expect(started.statusCode).toBe(200);const runId=started.json().id as string,now=new Date();
    const runtime=new AutomationRuntime(db,{admission:f.service.limits,adapter:{authorize:async()=>{},execute:async()=>{throw new Error('unexpected fake effect');}},now:()=>now});expect(await runtime.tick(f.s,runId)).toMatchObject({state:'WAITING'});
    const run=(await f.service.store.run(f.s,runId))!;run.resume.parallel!.branches[0]!.context.variables.private={type:'PlainText',value:'private-resume-value',provenance:[]};
    await sql`UPDATE automation_runs SET resume=${json(run.resume)} WHERE ${tenant(f.s)} AND id=${runId}::uuid`.execute(db);
    const response=await f.call('GET','/runs/'+runId);expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().parallel).toMatchObject({join:'ALL',branches:[{id:'a',state:'WAITING'},{id:'b',state:'WAITING'}]});
    for(const forbidden of ['private-resume-value','actor_ciphertext','actor_hash','variables','resume','encryptedUserId'])expect(response.body).not.toContain(forbidden);
    expect((await other.call('GET','/runs/'+runId)).statusCode).toBe(404);
  }finally{await f.app.close();await other.app.close();}
});
it('returns only scoped event receipt metadata, supports a checked flow filter and includes it in overview',async()=>{
  const f=await fixture(),other=await fixture();try{
    for(const current of [f,other])expect((await current.call('PUT','/flows/test/draft',{definition:current.definition,expectedRevision:0,requestId:randomUUID()})).statusCode).toBe(200);
    expect((await f.call('PUT','/flows/another/draft',{definition:{...f.definition,id:'another'},expectedRevision:0,requestId:randomUUID()})).statusCode).toBe(200);
    const eventId=randomUUID(),anotherId=randomUUID(),hiddenId=randomUUID(),at=new Date('2026-10-15T10:00:00.000Z');
    await sql`INSERT INTO automation_event_inbox(organization_id,guild_id,source,event_id,flow_id,revision,generation,kind,ticket_id,channel_id,occurred_at,deadline_at,state) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},'INTERNAL',${eventId},'test',1,1,'ticketCreated','private-ticket-key','private-channel-key',${at},now()+interval '7 days','PENDING')`.execute(db);
    await sql`INSERT INTO automation_event_inbox(organization_id,guild_id,source,event_id,flow_id,revision,generation,kind,actor_hash,actor_ciphertext,occurred_at,deadline_at,state,reason,finished_at) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},'INTERACTION',${anotherId},'another',1,1,'interaction','private-actor-hash',NULL,${at},now()+interval '7 days','SKIPPED','AUTOMATION_MONTHLY_LIMIT',now()),(${other.s.organizationId}::uuid,${other.s.guildId},'INTERACTION',${hiddenId},'test',1,1,'interaction','other-actor',NULL,${at},now()+interval '7 days','SKIPPED','AUTOMATION_STOPPED',now())`.execute(db);
    const response=await f.call('GET','/event-receipts');expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().items).toHaveLength(2);expect(response.json().items.find((item:{eventId:string})=>item.eventId===eventId)).toEqual({source:'INTERNAL',eventId,flowId:'test',revision:1,state:'PENDING',reason:null,runId:null,occurredAt:at.toISOString()});
    for(const forbidden of ['private-ticket-key','private-channel-key','private-actor-hash','private-actor-ciphertext',hiddenId,'actor_hash','actor_ciphertext','ticket_id','channel_id'])expect(response.body).not.toContain(forbidden);
    const filtered=await f.call('GET','/event-receipts?flowId=test');expect(filtered.json().items).toHaveLength(1);expect(filtered.json().items[0].eventId).toBe(eventId);
    expect((await f.call('GET','/event-receipts?flowId=absent')).statusCode).toBe(404);expect((await f.call('GET','/event-receipts?flowId=bad%20id')).statusCode).toBe(400);
    expect((await f.call('GET','/overview')).json().eventReceipts).toEqual(response.json().items);
    expect((await f.call('GET','/event-receipts',undefined,{'x-nexus-user-proof':''})).statusCode).toBe(401);
    f.discord.members.get(user)!.permissions='0';expect((await f.call('GET','/event-receipts')).statusCode).toBe(403);
  }finally{await f.app.close();await other.app.close();}
});
it('bounds receipt metadata responses and never exposes untrusted diagnostic text',async()=>{
  const f=await fixture();try{
    expect((await f.call('PUT','/flows/test/draft',{definition:f.definition,expectedRevision:0,requestId:randomUUID()})).statusCode).toBe(200);
    await sql`INSERT INTO automation_event_inbox(organization_id,guild_id,source,event_id,flow_id,revision,generation,kind,occurred_at,deadline_at,state,reason,finished_at) SELECT ${f.s.organizationId}::uuid,${f.s.guildId},'INTERNAL','synthetic-'||n,'test',1,1,'ticketCreated',now(),now()+interval '7 days','SKIPPED','private external error text',now() FROM generate_series(1,101) n`.execute(db);
    const response=await f.call('GET','/event-receipts?flowId=test');expect(response.statusCode).toBe(200);expect(response.json().items).toHaveLength(100);expect(response.body).not.toContain('private external error text');expect(response.json().items.every((item:{reason:string})=>item.reason==='AUTOMATION_EVENT_FAILED')).toBe(true);
  }finally{await f.app.close();}
});
