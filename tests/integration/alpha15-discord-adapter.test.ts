import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {connect,migrate,ensureGuild,sql,tenant,type Database} from '../../packages/db/src/index';
import {scopeForGuild} from '../../packages/security/src/scoping';
import {IdentityVault} from '../../packages/identity/src/index';
import {SettingsService} from '../../packages/settings/src/index';
import {PrivacyService} from '../../packages/security/src/privacy';
import {applyDeletionTombstones} from '../../packages/security/src/tombstones';
import {AutomationService} from '../../packages/automation/src/service';
import {AutomationRuntime} from '../../packages/automation/src/runtime';
import {ALPHA15_BETA_ADMISSION,ALPHA15_ADOPTED_ACTIONS} from '../../packages/automation/src/admission';
import {DiscordFailure,DiscordWriteNotStartedError,type AutomationDiscordWrite} from '../../packages/discord/src/rest';
import {createAlpha15DiscordAdapter} from '../../apps/worker/src/alpha15-discord';
import {DomainError} from '../../packages/shared/src/index';
import type {FlowDefinition,Statement} from '../../packages/automation/src/types';
import {FakeDiscord} from '../fixtures/discord';
import {isolatedPostgres} from '../fixtures/postgres';
import {mockSuccessfulActionOutcomes} from '../fixtures/alpha15-simulation';
let db:Database,infra:Awaited<ReturnType<typeof isolatedPostgres>>,sequence=0;
const user='886111111111111111',channel='886222222222222222',created='886333333333333333',vault=new IdentityVault('ab'.repeat(32),'cd'.repeat(32));
beforeAll(async()=>{vi.stubEnv('NEXUS_HOSTED_BETA','off');infra=await isolatedPostgres();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();vi.unstubAllEnvs();});
async function fixture(body?:Statement[]){
  const s=scopeForGuild(String(886000000000000000n+BigInt(++sequence)));await ensureGuild(db,s);
  const actor={key:vault.hash(s,user),encryptedUserId:vault.seal(s,user),permissions:'32',roles:[],source:'WEB_DASHBOARD' as const,requestId:randomUUID()};
  const discord=Object.assign(new FakeDiscord(),{automationPreflight:vi.fn(async()=>{}),automationWrite:vi.fn(async(_input:AutomationDiscordWrite,before:()=>Promise<void>)=>{await before();return created;})});
  discord.members.set(user,{permissions:'32',roles:[],joinedAt:'2026-01-01T00:00:00Z',bot:false});
  const definition:FlowDefinition={schemaVersion:1,id:'adapter-'+sequence,guildId:s.guildId,name:'Synthetic connector',trigger:{kind:'manual',inputs:[]},variables:[],targets:{channelIds:[channel],roleIds:[],parentCategoryIds:[]},body:body??[{id:'send',kind:'action',operation:'discord.sendMessage',inputs:{channel:{kind:'literal',type:'ChannelRef',value:{id:channel,guildId:s.guildId}},content:{kind:'literal',type:'PlainText',value:'**synthetic** @everyone'}}}]};
  const service=new AutomationService(db,{admission:ALPHA15_BETA_ADMISSION,adoptedActions:ALPHA15_ADOPTED_ACTIONS});
  const saved=await service.save(s,actor,{definition,expectedRevision:0,requestId:randomUUID()});
  for(const kind of ['VALIDATE','TEST','IMPACT'] as const)await service.check(s,actor,definition.id,1,kind,{outcomes:mockSuccessfulActionOutcomes(definition)});
  await service.enable(s,actor,definition.id,{revision:1,semanticHash:saved.validation.semanticHash!,requestId:randomUUID()});
  const adapter=createAlpha15DiscordAdapter(db,discord,vault),runtime=new AutomationRuntime(db,{admission:service.limits,adapter});
  const run=await service.start(s,actor,definition.id,{requestId:randomUUID()});
  return {s,actor,discord,definition,service,adapter,runtime,run};
}
it('uses the real activating member, escapes plain text, and stores no body in run events',async()=>{
  const f=await fixture();expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'COMPLETED'});
  const [write]=f.discord.automationWrite.mock.calls[0]!;expect(write).toMatchObject({kind:'message',guildId:f.s.guildId,channelId:channel,content:'\\*\\*synthetic\\*\\* @everyone'});
  expect(write.kind==='message'&&write.nonce.length).toBe(25);
  expect(JSON.stringify((await sql`SELECT * FROM automation_run_events WHERE ${tenant(f.s)}`.execute(db)).rows)).not.toContain('synthetic**');
});
it('binds a manual run to its actual requester and checks that member native channel access',async()=>{
  const f=await fixture(),requester='886444444444444444';
  await f.service.cancel(f.s,f.actor,f.run.id,randomUUID());
  const actor={...f.actor,key:vault.hash(f.s,requester),encryptedUserId:vault.seal(f.s,requester),requestId:randomUUID()};
  f.discord.members.set(requester,{permissions:'32',roles:[],joinedAt:'2026-01-01T00:00:00Z',bot:false});
  const run=await f.service.start(f.s,actor,f.definition.id,{requestId:randomUUID()}),saved=(await f.service.store.run(f.s,run.id))!;
  expect(saved.actor_hash).toBe(actor.key);expect(vault.open(f.s,saved.actor_ciphertext)).toBe(requester);
  expect((await sql<{activator_hash:string}>`SELECT activator_hash FROM automation_flows WHERE ${tenant(f.s)} AND id=${f.definition.id}`.execute(db)).rows[0]?.activator_hash).toBe(f.actor.key);
  const checkedActors:string[]=[];let dispatched=0;
  f.discord.automationPreflight.mockImplementation(async(...args:unknown[])=>{checkedActors.push(String(args[1]));if(args[1]===requester)throw new DomainError('AUTOMATION_TARGET_PERMISSION',403);});
  f.discord.automationWrite.mockImplementation(async(_input,before)=>{await before();dispatched++;return created;});
  expect(await f.runtime.tick(f.s,run.id)).toMatchObject({state:'FAILED'});
  expect(checkedActors).toEqual([requester]);expect(dispatched).toBe(0);
});
it('stops before dispatch after the activating member loses permission',async()=>{
  const f=await fixture();f.discord.members.get(user)!.permissions='0';
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'FAILED'});expect(f.discord.automationWrite).not.toHaveBeenCalled();
});
it('rechecks cancellation after network preflight and never performs the write',async()=>{
  const f=await fixture();let dispatched=0;
  f.discord.automationPreflight.mockImplementation(async()=>{await sql`UPDATE automation_runs SET cancel_requested_at=now() WHERE ${tenant(f.s)} AND id=${f.run.id}::uuid`.execute(db);});
  f.discord.automationWrite.mockImplementation(async(_input,before)=>{await before();dispatched++;return created;});
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'CANCELLED'});expect(dispatched).toBe(0);
});
it('preserves an unknown remote result without any automatic resend',async()=>{
  const f=await fixture();f.discord.automationWrite.mockImplementation(async(_input,before)=>{await before();throw new DiscordFailure(0,0,{kind:'network'});});
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'UNKNOWN'});await f.runtime.tick(f.s,f.run.id);expect(f.discord.automationWrite).toHaveBeenCalledTimes(1);
});
it('preserves branded transport pre-dispatch rejection as not started without retry',async()=>{
  const f=await fixture();
  f.discord.automationWrite.mockImplementation(async(_input,before)=>{await before();throw new DiscordWriteNotStartedError('AUTOMATION_PARENT_POLICY_CHANGED');});
  expect(await f.runtime.tick(f.s,f.run.id)).toMatchObject({state:'FAILED'});
  expect((await sql`SELECT state,reason FROM automation_operations WHERE ${tenant(f.s)} AND run_id=${f.run.id}::uuid`.execute(db)).rows).toEqual([{state:'NOT_STARTED',reason:'AUTOMATION_PARENT_POLICY_CHANGED'}]);
  await f.runtime.tick(f.s,f.run.id);expect(f.discord.automationWrite).toHaveBeenCalledTimes(1);
});
it('records a confirmed forbidden response as failed and malformed success as unknown',async()=>{
  const failed=await fixture();failed.discord.automationWrite.mockImplementation(async(_input,before)=>{await before();throw new DiscordFailure(403);});
  expect(await failed.runtime.tick(failed.s,failed.run.id)).toMatchObject({state:'FAILED'});
  const unknown=await fixture();unknown.discord.automationWrite.mockImplementation(async(_input,before)=>{await before();throw new DiscordFailure(200);});
  expect(await unknown.runtime.tick(unknown.s,unknown.run.id)).toMatchObject({state:'UNKNOWN'});
});
it('member and guild erasure reach the new state through the real privacy service',async()=>{
  const f=await fixture(),unrelated=await fixture(),privacy=new PrivacyService(db,vault,new SettingsService(db));
  await sql`INSERT INTO web_setup_requests(organization_id,guild_id,actor_hash,id,operation,fingerprint,result) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${f.actor.key},${randomUUID()}::uuid,'TEST','synthetic','{}')`.execute(db);
  await privacy.delete(f.s,user,f.actor);
  expect((await sql`SELECT id FROM automation_flows WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  expect((await sql`SELECT id FROM web_setup_requests WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(unrelated.s)}`.execute(db)).rows).toHaveLength(1);
  await sql`INSERT INTO install_notices(organization_id,guild_id,generation,kind,state) VALUES(${unrelated.s.organizationId}::uuid,${unrelated.s.guildId},${'a'.repeat(64)},'SETUP','WEB_ONLY')`.execute(db);
  await privacy.delete(unrelated.s,user,unrelated.actor,true);
  expect((await sql`SELECT id FROM automation_runs WHERE ${tenant(unrelated.s)}`.execute(db)).rows).toHaveLength(0);
  expect((await sql`SELECT generation FROM install_notices WHERE ${tenant(unrelated.s)}`.execute(db)).rows).toHaveLength(0);
});
it('offline tombstone application fences restored writes instead of replaying them',async()=>{
  const f=await fixture(),privacy=new PrivacyService(db,vault,new SettingsService(db));
  await f.service.store.beginOperation(f.s,f.run.id,'interrupted','discord.sendMessage','synthetic');
  await applyDeletionTombstones(db,vault,privacy,{version:1,guilds:[],members:[]});
  expect((await f.service.store.run(f.s,f.run.id))?.status).toBe('UNKNOWN');
  expect((await sql<{state:string}>`SELECT state FROM automation_flows WHERE ${tenant(f.s)}`.execute(db)).rows[0]?.state).toBe('DISABLED');
  expect(f.discord.automationWrite).not.toHaveBeenCalled();
});
