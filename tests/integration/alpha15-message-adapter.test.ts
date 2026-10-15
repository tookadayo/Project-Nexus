import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,migrate,ensureGuild,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import {IdentityVault} from '../../packages/identity/src/index';
import {SettingsService} from '../../packages/settings/src/index';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationRuntime} from '../../packages/automation/src/runtime';
import {ALPHA15_BETA_ADMISSION,ALPHA15_ADOPTED_ACTIONS} from '../../packages/automation/src/admission';
import {DiscordFailure,type AutomationDiscordWrite} from '../../packages/discord/src/rest';
import {createAlpha15DiscordAdapter} from '../../apps/worker/src/alpha15-discord';
import type {FlowDefinition,Statement} from '../../packages/automation/src/types';
import {FakeDiscord} from '../fixtures/discord';
import {isolatedPostgres} from '../fixtures/postgres';
vi.mock('../../packages/automation/src/admission',async importOriginal=>{const actual=await importOriginal<typeof import('../../packages/automation/src/admission')>();return {...actual,ALPHA15_ADOPTED_ACTIONS:new Set([...actual.ALPHA15_ADOPTED_ACTIONS,'discord.editOwnMessage','nexus.readTicket'])};});
let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,sequence=0;
const user='895111111111111111',channel='895222222222222222',message='895333333333333333',post='895444444444444444',vault=new IdentityVault('ab'.repeat(32),'cd'.repeat(32));
beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});
const structured={kind:'literal' as const,type:'LegacyMessageSpec' as const,value:{kind:'legacy',richText:[{kind:'bold',children:[{kind:'text',text:'safe *text* @everyone'}]}],embeds:[{title:'State',description:'Only explicit text'}]}};
const send=(guildId:string):Statement=>({id:'send',kind:'action',operation:'discord.sendMessage',inputs:{channel:{kind:'literal',type:'ChannelRef',value:{id:channel,guildId}},messageSpec:structured},output:{id:'sent',name:'Sent message',type:'MessageRef'}});
const edit=(target:Record<string,unknown>):Statement=>({id:'edit',kind:'action',operation:'discord.editOwnMessage',inputs:{message:target as never,content:{kind:'literal',type:'PlainText',value:'replacement *plain*'}},output:{id:'edited',name:'Edited message',type:'MessageRef'}});
const read=(guildId:string,id=post):Statement=>({id:'read',kind:'action',operation:'nexus.readTicket',inputs:{ticket:{kind:'literal',type:'TicketRef',value:{id,guildId}}},output:{id:'status',name:'Ticket status',type:{kind:'Record',schemaId:'nexus.ticket.status.v1'}}});
async function fixture(body:(guildId:string)=>Statement[]){
  const s=scopeForGuild(String(895000000000000000n+BigInt(++sequence)));await ensureGuild(db,s);
  const actor={key:vault.hash(s,user),encryptedUserId:vault.seal(s,user),permissions:'32',roles:[],source:'WEB_DASHBOARD' as const,requestId:randomUUID()};
  const discord=Object.assign(new FakeDiscord(),{automationPreflight:vi.fn(async()=>{}),canReadAttentionChannel:vi.fn(async()=>true),automationWrite:vi.fn(async(_input:AutomationDiscordWrite,before:()=>Promise<void>)=>{await before();return message;})});
  discord.members.set(user,{permissions:'32',roles:[],joinedAt:'2026-01-01T00:00:00Z',bot:false});
  await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,channel_type,visibility_state,observed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${channel},0,'VISIBLE',now())`.execute(db);
  await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,version,evidence) VALUES(${s.organizationId}::uuid,${s.guildId},${channel},${post},now(),'ACKNOWLEDGED','TEXT_NEWCOMER',3,'{"private":"never-return-original-evidence"}'::jsonb)`.execute(db);
  const definition:FlowDefinition={schemaVersion:1,id:'message-adapter-'+sequence,guildId:s.guildId,name:'Synthetic messages',trigger:{kind:'manual',inputs:[]},variables:[],targets:{channelIds:[channel],roleIds:[],parentCategoryIds:[]},body:body(s.guildId)};
  const service=new AutomationService(db,{admission:ALPHA15_BETA_ADMISSION,adoptedActions:ALPHA15_ADOPTED_ACTIONS}),saved=await service.save(s,actor,{definition,expectedRevision:0,requestId:randomUUID()});
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await service.check(s,actor,definition.id,1,kind,kind==='TEST'?{outcomes:{send:'SUCCEEDED',edit:'SUCCEEDED',read:'SUCCEEDED'},outputs:{send:{type:'MessageRef',value:{id:message,guildId:s.guildId}},edit:{type:'MessageRef',value:{id:message,guildId:s.guildId}},read:{type:{kind:'Record',schemaId:'nexus.ticket.status.v1'},value:{state:'OPEN',version:0}}}}:{});
  await service.enable(s,actor,definition.id,{revision:1,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()});
  const adapter=createAlpha15DiscordAdapter(db,discord,vault),runtime=new AutomationRuntime(db,{admission:service.limits,adapter}),run=await service.start(s,actor,definition.id,{requestId:randomUUID()});
  return {s,actor,discord,definition,service,adapter,runtime,run};
}
it('compiles Legacy rich text and edits only its own confirmed message in the same run',async()=>{
  const f=await fixture(guildId=>[send(guildId),edit({kind:'variable',type:'MessageRef',variableId:'sent'})]);
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'COMPLETED'});
  expect(f.discord.automationWrite.mock.calls.map(call=>call[0])).toEqual([
    expect.objectContaining({kind:'message',channelId:channel,messageSpec:{content:'**safe \\*text\\* @everyone**',embeds:[{title:'State',description:'Only explicit text'}],allowed_mentions:{parse:[],users:[],roles:[],replied_user:false}}}),
    {kind:'editMessage',guildId:f.s.guildId,channelId:channel,messageId:message,content:'replacement \\*plain\\*'},
  ]);
  expect(f.discord.automationPreflight.mock.calls).toHaveLength(2);
});
it('refuses caller-supplied message ownership and a message owned only by another run',async()=>{
  const f=await fixture(guildId=>[edit({kind:'literal',type:'MessageRef',value:{id:message,guildId}})]);
  const other=await f.service.start(f.s,f.actor,f.definition.id,{requestId:randomUUID()});
  await sql`INSERT INTO automation_operations(organization_id,guild_id,run_id,identity,operation,fingerprint,state,result) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${other.id}::uuid,'other-send','discord.sendMessage','synthetic','SUCCEEDED',${JSON.stringify({type:'MessageRef',value:{id:message,guildId:f.s.guildId},provenance:[{source:'service',guildId:f.s.guildId,allowedChannelIds:[channel]}]})}::jsonb)`.execute(db);
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'FAILED'});expect(f.discord.automationWrite).not.toHaveBeenCalled();
});
it('stops an unknown PATCH result without another send or edit',async()=>{
  const f=await fixture(guildId=>[send(guildId),edit({kind:'variable',type:'MessageRef',variableId:'sent'})]);
  f.discord.automationWrite.mockImplementation(async(input,before)=>{await before();if(input.kind==='editMessage')throw new DiscordFailure(0,0,{kind:'network'});return message;});
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'UNKNOWN'});await f.runtime.tick(f.s,f.run.id);expect(f.discord.automationWrite).toHaveBeenCalledTimes(2);
});
it('checks the entire structured value publication provenance before sending',async()=>{
  const f=await fixture(guildId=>[send(guildId)]);
  expect(await f.adapter.execute({scope:f.s,runId:f.run.id,identity:'forged',operation:'discord.sendMessage',inputs:{channel:{type:'ChannelRef',value:{id:channel,guildId:f.s.guildId},provenance:[]},messageSpec:{type:'LegacyMessageSpec',value:structured.value,provenance:[{source:'service',guildId:f.s.guildId,allowedChannelIds:['895999999999999999']}]}},targets:f.definition.targets!,approvalRequired:false})).toEqual({state:'NOT_STARTED',code:'AUTOMATION_PUBLICATION_SCOPE'});
  expect(f.discord.automationWrite).not.toHaveBeenCalled();
});
it('reads only current typed status/version from retained, in-scope, currently readable post tickets',async()=>{
  const f=await fixture(guildId=>[read(guildId)]);expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'COMPLETED'});
  const saved=(await f.service.store.run(f.s,f.run.id))!,result=(await sql<{result:unknown}>`SELECT result FROM automation_operations WHERE ${tenant(f.s)} AND run_id=${f.run.id}::uuid AND operation='nexus.readTicket'`.execute(db)).rows[0]?.result;
  expect(result).toMatchObject({type:{kind:'Record',schemaId:'nexus.ticket.status.v1'},value:{state:'ACKNOWLEDGED',version:3},provenance:expect.arrayContaining([expect.objectContaining({allowedChannelIds:[channel]})])});
  expect(JSON.stringify(saved.resume)).not.toContain('never-return-original-evidence');expect(f.discord.automationWrite).not.toHaveBeenCalled();
});
it.each(['visibility','scope','retention','readPermission'] as const)('refuses a ticket after current %s becomes unavailable',async reason=>{
  const f=await fixture(guildId=>[read(guildId)]);
  if(reason==='visibility')f.discord.canReadAttentionChannel.mockResolvedValue(false);
  if(reason==='scope')await new SettingsService(db).update(f.s,f.actor,0,{analysisScope:{mode:'include',channelIds:[]}});
  if(reason==='retention')await sql`UPDATE attention_items SET detected_at=now()-interval '40 days' WHERE ${tenant(f.s)}`.execute(db);
  if(reason==='readPermission')f.discord.members.get(user)!.permissions='0';
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'FAILED'});expect(f.discord.automationWrite).not.toHaveBeenCalled();
});
it.each([false,true])('reads minimal retained intake status without opening contents (expired=%s)',async expired=>{
  const requestId=randomUUID(),key='intake:'+requestId,f=await fixture(guildId=>[read(guildId,key)]),panel=randomUUID();
  await sql`INSERT INTO operations_intake_panels(organization_id,guild_id,id,title,category,actor_hash) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${panel}::uuid,'Synthetic','support',${f.actor.key})`.execute(db);
  await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,version) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},'',${key},now(),'IN_PROGRESS','OPERATIONS_REQUEST',4)`.execute(db);
  await sql`INSERT INTO operations_requests(organization_id,guild_id,id,panel_id,interaction_digest,actor_hash,category,fields_ciphertext,attention_key) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${requestId}::uuid,${panel}::uuid,'synthetic',${f.actor.key},'support','not-valid-ciphertext-and-never-opened',${key})`.execute(db);
  if(expired){await sql`UPDATE attention_items SET detected_at=now()-interval '40 days' WHERE ${tenant(f.s)} AND message_id=${key}`.execute(db);expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'FAILED'});return;}
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'COMPLETED'});
  const saved=(await f.service.store.run(f.s,f.run.id))!;
  const result=(await sql<{result:{value:unknown}}>`SELECT result FROM automation_operations WHERE ${tenant(f.s)} AND run_id=${f.run.id}::uuid AND operation='nexus.readTicket'`.execute(db)).rows[0]?.result;
  expect(result?.value).toEqual({state:'IN_PROGRESS',version:4});expect(JSON.stringify(saved.resume)).not.toContain('ciphertext-and-never-opened');expect(f.discord.canReadAttentionChannel).not.toHaveBeenCalled();
});
it('reauthorizes the current real actor and intake retention through the same-transaction wait hook',async()=>{
  const f=await fixture(()=>[{kind:'end',id:'end'}]),requestId=randomUUID(),key='intake:'+requestId,panel=randomUUID();
  await sql`INSERT INTO operations_intake_panels(organization_id,guild_id,id,title,category,actor_hash) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${panel}::uuid,'Synthetic','support',${f.actor.key})`.execute(db);
  await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,version) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},'',${key},now(),'IN_PROGRESS','OPERATIONS_REQUEST',4)`.execute(db);
  await sql`INSERT INTO operations_requests(organization_id,guild_id,id,panel_id,interaction_digest,actor_hash,category,fields_ciphertext,attention_key) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${requestId}::uuid,${panel}::uuid,'synthetic',${f.actor.key},'support','opaque-fields-never-opened',${key})`.execute(db);
  const run=(await f.service.store.run(f.s,f.run.id))!;
  const check=()=>db.transaction().execute(tx=>f.adapter.authorizeAwait!(tx,f.s,run,key));
  expect(await check()).toEqual({allowedChannelIds:[]});
  expect(await db.transaction().execute(tx=>f.adapter.authorizeAwait!(tx,f.s,run,post))).toEqual({allowedChannelIds:[channel]});
  f.discord.canReadAttentionChannel.mockResolvedValue(false);
  await expect(db.transaction().execute(tx=>f.adapter.authorizeAwait!(tx,f.s,run,post))).rejects.toThrow('AUTOMATION_TICKET_NOT_AVAILABLE');
  f.discord.canReadAttentionChannel.mockResolvedValue(true);
  f.discord.members.get(user)!.permissions='0';
  await expect(check()).rejects.toThrow();
  f.discord.members.get(user)!.permissions='32';
  await sql`UPDATE attention_items SET detected_at=now()-interval '40 days' WHERE ${tenant(f.s)} AND message_id=${key}`.execute(db);
  await expect(check()).rejects.toThrow('AUTOMATION_TICKET_NOT_AVAILABLE');
  expect(f.discord.automationWrite).not.toHaveBeenCalled();
});
