import {beforeAll,afterAll,expect,it} from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import {connect,migrate,ensureGuild,sql} from '../../packages/db/src/index.js';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {createInteractionServer} from '../../apps/interaction/src/server.js';
import {IdentityVault} from '../../packages/identity/src/index.js';
import {Components,scopeForGuild} from '../../packages/security/src/index.js';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {SettingsService} from '../../packages/settings/src/index.js';
import {OnboardingService} from '../../packages/onboarding/src/index.js';
import {templateFlow} from '../../packages/onboarding/src/flow.js';
import {FakeDiscord} from '../fixtures/discord.js';
import {ActionWorker} from '../../apps/worker/src/actions.js';
import {InteractionWorker} from '../../apps/worker/src/interactions.js';
import {DiscordFailure} from '../../packages/discord/src/rest.js';
import {PrivacyService} from '../../packages/security/src/privacy.js';
const server=new EmbeddedPostgres({databaseDir:resolve('.local/test-pg'),user:'nexus',password:'nexus',port:55433,persistent:true,onLog:()=>{},onError:()=>{}});
const db=connect('postgresql://nexus:nexus@127.0.0.1:55433/postgres');
beforeAll(async()=>{if(!existsSync('.local/test-pg/PG_VERSION'))await server.initialise();await server.start();await migrate(db);});
afterAll(async()=>{await db.destroy();await server.stop();});
it('runs migrations idempotently and enforces guild ownership',async()=>{
 await migrate(db);
 const scope={organizationId:randomUUID(),guildId:'123456789012345678'};
 await db.transaction().execute(async tx=>{
  await sql`DELETE FROM guilds WHERE guild_id=${scope.guildId}`.execute(tx);
  await ensureGuild(tx,scope);
 });
 await expect(ensureGuild(db,{...scope,organizationId:randomUUID()})).rejects.toThrow('Tenant mismatch');
 await expect(sql`INSERT INTO guild_settings VALUES(${randomUUID()}::uuid,${scope.guildId},0,'{}')`.execute(db)).rejects.toThrow();
});
it.each([
 ['Discord 429',new DiscordFailure(429,0.01),'PENDING'],
 ['Discord 500',new DiscordFailure(500),'UNKNOWN'],
 ['network timeout',new Error('timeout'),'UNKNOWN'],
 ['role deleted',new DiscordFailure(404),'FAILED'],
 ['permission revoked',new DiscordFailure(403),'FAILED']
] as const)('handles %s without inventing role ownership',async(_name,failure,expected)=>{
 const s=scopeForGuild(String(BigInt('600000000000000000')+BigInt(Math.floor(Math.random()*100000))));await ensureGuild(db,s);
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32));const settings=new SettingsService(db);const onboarding=new OnboardingService(db,settings,vault);const discord=new FakeDiscord();const user='700000000000000000';
 discord.members.set(user,{roles:[],permissions:'0',joinedAt:new Date().toISOString(),bot:false});
 const actor={key:'admin',permissions:'32',roles:[],source:'DISCORD_PANEL' as const,requestId:randomUUID()};const flow=templateFlow('Gaming');flow.nodes[0]!.options[1]!.roleId='800000000000000000';
 const cfg=await onboarding.publish(s,actor,0,flow);await settings.update(s,actor,cfg.revision,{enabled:true,onboardingEnabled:true,startChannelId:'900000000000000000'});
 const session=await onboarding.start(s,user,new Date(discord.members.get(user)!.joinedAt));await onboarding.answer(s,user,session.id,0,'purpose','community');
 const worker=new ActionWorker(db,vault,discord,onboarding);await worker.tick(s);discord.mutationFailure=failure;await worker.tick(s);
 const rows=(await sql<{state:string}>`SELECT state FROM action_outbox WHERE guild_id=${s.guildId} AND kind='ROLE_ADD'`.execute(db)).rows;
 expect(rows[0]!.state).toBe(expected);expect((await sql`SELECT role_id FROM nexus_role_grants WHERE guild_id=${s.guildId}`.execute(db)).rows).toHaveLength(0);
 if(expected==='PENDING'){
  discord.mutationFailure=null;await sql`UPDATE action_outbox SET available_at=now() WHERE guild_id=${s.guildId}`.execute(db);await worker.tick(s);
  expect((await sql`SELECT role_id FROM nexus_role_grants WHERE guild_id=${s.guildId}`.execute(db)).rows).toHaveLength(1);
 }else if(expected==='UNKNOWN'){await worker.tick(s);expect(discord.calls.filter(c=>c.startsWith('add:'))).toHaveLength(1);}
});
it('deletes member and guild data with an audit tombstone and ingestion suppression',async()=>{
 const s=scopeForGuild('611111111111111111');await sql`DELETE FROM guilds WHERE guild_id=${s.guildId}`.execute(db);await ensureGuild(db,s);
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32));const settings=new SettingsService(db);const onboarding=new OnboardingService(db,settings,vault);const privacy=new PrivacyService(db,vault,settings);const user='711111111111111111';
 const actor={key:vault.hash(s,user),permissions:'32',roles:[],source:'DISCORD_PANEL' as const,requestId:randomUUID()};
 const cfg=await onboarding.chooseTemplate(s,actor,0,'Gaming');await settings.update(s,actor,cfg.revision,{enabled:true,onboardingEnabled:true,startChannelId:'811111111111111111'});
 await onboarding.start(s,user,new Date());await privacy.delete(s,user,actor);
 expect((await sql`SELECT id FROM member_identity_map WHERE guild_id=${s.guildId}`.execute(db)).rows).toHaveLength(0);
 await expect(onboarding.start(s,user,new Date())).rejects.toThrow('PRIVACY_OPT_OUT');
 await privacy.delete(s,user,actor,true);
 expect((await sql`SELECT id FROM flow_versions WHERE guild_id=${s.guildId}`.execute(db)).rows).toHaveLength(0);expect((await settings.get(s)).enabled).toBe(false);
 expect((await sql`SELECT id FROM audit_logs WHERE guild_id=${s.guildId} AND action='guild.deleted'`.execute(db)).rows).toHaveLength(1);
});
it('completes Discord panel configuration, pinned branching flow and ownership-safe preference updates',async()=>{
 const s=scopeForGuild('555555555555555555');
 await sql`DELETE FROM guilds WHERE guild_id=${s.guildId}`.execute(db);await ensureGuild(db,s);
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32));const settings=new SettingsService(db);const onboarding=new OnboardingService(db,settings,vault);const discord=new FakeDiscord();
 const adminId='666666666666666666',userId='777777777777777777',managedRole='888888888888888888',manualRole='999999999999999999';
 discord.members.set(adminId,{roles:[],permissions:'32',joinedAt:'2026-09-01T00:00:00Z',bot:false});discord.members.set(userId,{roles:[manualRole],permissions:'0',joinedAt:'2026-09-20T00:00:00Z',bot:false});
 const actor={key:vault.hash(s,adminId),permissions:'32',roles:[],source:'DISCORD_PANEL' as const,requestId:randomUUID()};
 const tokens=new Components('test');const interactions=new InteractionWorker(db,vault,tokens,discord,settings,onboarding,async()=>{});
 const actions=new ActionWorker(db,vault,discord,onboarding);
 const base={id:'100000000000000001',applicationId:'111111111111111111',token:'test',userId:adminId,channelId:'111111111111111112'};
 await interactions.dispatch(s,{...base,command:'panel'});while(await actions.tick(s)){/* drain */}
 expect(discord.calls).toContain('sendPanel');
 const permanent=(await sql<{message_id:string}>`SELECT message_id FROM settings_panels WHERE guild_id=${s.guildId}`.execute(db)).rows[0]!;
 await interactions.dispatch(s,{...base,id:'100000000000000003',command:'panelRefresh'});while(await actions.tick(s)){/* drain */}
 expect(discord.calls.filter(c=>c==='sendPanel')).toHaveLength(1);expect(discord.panels.has(permanent.message_id)).toBe(true);
 const flow=templateFlow('Gaming');flow.nodes[2]!.options[0]!.roleId=managedRole;flow.nodes[2]!.options[1]!.roleId=manualRole;
 let cfg=await onboarding.publish(s,actor,(await settings.get(s)).revision,flow,'Gaming');cfg=await settings.update(s,actor,cfg.revision,{startChannelId:base.channelId,onboardingEnabled:true});
 let session=await onboarding.start(s,userId,new Date(discord.members.get(userId)!.joinedAt));
 const pinned=session.flow_version_id;const newer=await onboarding.publish(s,actor,cfg.revision,templateFlow('General Community'));
 expect((await onboarding.session(s,session.id)).flow_version_id).toBe(pinned);
 await expect(sql`UPDATE flow_versions SET version=90 WHERE guild_id=${s.guildId}`.execute(db)).rejects.toThrow('immutable');
 await expect(onboarding.answer(s,adminId,session.id,0,'purpose','gaming')).rejects.toThrow('SESSION_OWNER');
 session=await onboarding.answer(s,userId,session.id,0,'purpose','gaming');session=await onboarding.answer(s,userId,session.id,1,'game','minecraft');session=await onboarding.answer(s,userId,session.id,2,'edition','java');expect(session.state.complete).toBe(true);
 while(await actions.tick(s)){/* drain */}expect(discord.members.get(userId)!.roles).toContain(managedRole);
 const rollback=await onboarding.rollback(s,actor,newer.revision,pinned);expect(rollback.flowVersionId).not.toBe(pinned);
 session=await onboarding.start(s,userId,new Date(discord.members.get(userId)!.joinedAt),'PRODUCTION',true);
 session=await onboarding.answer(s,userId,session.id,0,'purpose','gaming');session=await onboarding.answer(s,userId,session.id,1,'game','minecraft');session=await onboarding.answer(s,userId,session.id,2,'edition','bedrock');expect(session.state.complete).toBe(true);
 while(await actions.tick(s)){/* drain */}expect(discord.members.get(userId)!.roles).toEqual([manualRole]);
 session=await onboarding.start(s,userId,new Date(discord.members.get(userId)!.joinedAt),'PRODUCTION',true);await onboarding.answer(s,userId,session.id,0,'purpose','community');
 while(await actions.tick(s)){/* drain */}expect(discord.members.get(userId)!.roles).toEqual([manualRole]);expect(discord.calls).not.toContain(`remove:${manualRole}`);
 const preview=await onboarding.start(s,adminId,new Date(discord.members.get(adminId)!.joinedAt),'PREVIEW',true);await onboarding.answer(s,adminId,preview.id,0,'purpose','community');
 expect((await sql`SELECT id FROM action_outbox WHERE guild_id=${s.guildId} AND payload->>'sessionId'=${preview.id}`.execute(db)).rows).toHaveLength(0);
 // A deleted permanent panel is recreated through the outbox, not in the handler.
 discord.panels.clear();await interactions.dispatch(s,{...base,id:'100000000000000002',command:'panel'});while(await actions.tick(s)){/* drain */}
 expect(discord.calls.filter(c=>c==='sendPanel')).toHaveLength(2);
 await expect(interactions.dispatch(s,{...base,userId,command:'panel'})).rejects.toThrow('ADMIN_REQUIRED');
});
it('serializes settings revisions, authorization and audit atomically',async()=>{
 const s=scopeForGuild('444444444444444444');await ensureGuild(db,s);
 await sql`DELETE FROM guild_settings WHERE guild_id=${s.guildId}`.execute(db);
 const settings=new SettingsService(db);const actor={key:'internal-admin',permissions:'32',roles:[],source:'DISCORD_PANEL' as const,requestId:randomUUID()};
 const updates=await Promise.allSettled([settings.update(s,actor,0,{enabled:true}),settings.update(s,actor,0,{enabled:false})]);
 expect(updates.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 expect(updates.filter(r=>r.status==='rejected')).toHaveLength(1);
 expect((await settings.get(s)).revision).toBe(1);
 await expect(settings.update(s,{...actor,permissions:'0'},1,{enabled:true})).rejects.toThrow('ADMIN_REQUIRED');
 await expect(settings.update(s,actor,1,{onboardingEnabled:true})).rejects.toThrow('ONBOARDING_NOT_CONFIGURED');
 expect((await settings.get(s)).revision).toBe(1);
 const audit=await sql`SELECT id FROM audit_logs WHERE request_id=${actor.requestId}`.execute(db);expect(audit.rows).toHaveLength(1);
});
it('HTTP ACK is signed, durable, deduplicated and drops all unsolicited fields',async()=>{
 const keys=generateKeyPairSync('ed25519');const publicKey=keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32));
 const app=createInteractionServer({db,vault,publicKey,applicationId:'111111111111111111'});
 const data={id:String(BigInt('200000000000000000')+BigInt(Date.now())),application_id:'111111111111111111',type:2,token:'test-token',guild_id:'222222222222222222',locale:'ja',guild_locale:'en-US',
  member:{user:{id:'333333333333333333'},permissions:'32',roles:[]},data:{name:'nexus',options:[{name:'panel'}]},content:'PRIVATE BODY',attachments:['PRIVATE FILE']};
 const body=JSON.stringify(data);const ts=String(Math.floor(Date.now()/1000));
 const headers={'content-type':'application/json','x-signature-timestamp':ts,'x-signature-ed25519':sign(null,Buffer.from(ts+body),keys.privateKey).toString('hex')};
 const start=performance.now();const response=await app.inject({method:'POST',url:'/interactions',payload:body,headers});
 expect(performance.now()-start).toBeLessThan(2500);expect(response.json()).toEqual({type:5,data:{flags:64}});
 await app.inject({method:'POST',url:'/interactions',payload:body,headers});
 await expect.poll(async()=>(await sql`SELECT id FROM interaction_jobs WHERE id=${data.id}`.execute(db)).rows.length).toBe(1);
 const rows=await sql<{encrypted_payload:string}>`SELECT encrypted_payload FROM interaction_jobs WHERE id=${data.id}`.execute(db);
 expect(rows.rows).toHaveLength(1);const plaintext=vault.open(scopeForGuild(data.guild_id),rows.rows[0]!.encrypted_payload);
 expect(plaintext).not.toContain('PRIVATE');
 expect(JSON.parse(plaintext)).toMatchObject({locale:'ja',guildLocale:'en-US'});
 expect((await app.inject({method:'POST',url:'/interactions',payload:'{}',headers})).statusCode).toBe(401);
 const s=scopeForGuild(data.guild_id);const tokens=new Components('secret');
 const token=await tokens.issue(db,s,{action:'settings'},'owner');
 expect(token).not.toContain(data.guild_id);await expect(tokens.read(db,s,token,'other')).rejects.toThrow('COMPONENT_OWNER');
 await expect(tokens.read(db,s,token+'x','owner')).rejects.toThrow('INVALID_COMPONENT');
 await app.close();
});

