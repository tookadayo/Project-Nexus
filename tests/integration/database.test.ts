import {beforeAll,afterAll,expect,it,vi} from 'vitest';
import {infrastructure} from '../fixtures/infrastructure.js';
import {migrate,ensureGuild,sql} from '../../packages/db/src/index.js';
import {Kysely,PostgresDialect} from 'kysely';
import pg from 'pg';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {createInteractionServer} from '../../apps/interaction/src/server.js';
import {IdentityVault} from '../../packages/identity/src/index.js';
import {Components,scopeForGuild} from '../../packages/security/src/index.js';
import {SettingsService} from '../../packages/settings/src/index.js';
import {OnboardingService} from '../../packages/onboarding/src/index.js';
import {templateFlow} from '../../packages/onboarding/src/flow.js';
import {FakeDiscord} from '../fixtures/discord.js';
import {ActionWorker} from '../../apps/worker/src/actions.js';
import {InteractionWorker} from '../../apps/worker/src/interactions.js';
import {DiscordFailure} from '../../packages/discord/src/rest.js';
import {PrivacyService} from '../../packages/security/src/privacy.js';
import {CommunityService} from '../../packages/presentation/src/community.js';
import {HelperWorker} from '../../apps/worker/src/helpers.js';
let infra:Awaited<ReturnType<typeof infrastructure>>,db:Kysely<Record<string,never>>;
const closingClients=new Set<Promise<void>>();
beforeAll(async()=>{infra=await infrastructure();const pool=new pg.Pool({connectionString:infra.databaseUrl,max:10,connectionTimeoutMillis:500});pool.on('connect',client=>{const closed=new Promise<void>(done=>client.once('end',()=>{closingClients.delete(closed);done();}));closingClients.add(closed);});db=new Kysely<Record<string,never>>({dialect:new PostgresDialect({pool})});await migrate(db);});
// pg-pool resolves end() before every socket has finished closing. Keep the
// fixture alive until the clients emit end, so shutdown cannot send a FATAL
// administrator-termination error to a still-closing idle connection.
afterAll(async()=>{await db?.destroy();await Promise.all(closingClients);await infra?.stop();});
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
it('preserves completed setup for existing v0.5.2 settings rows',async()=>{
 const s=scopeForGuild('623456789012345678');await ensureGuild(db,s);
 await sql`INSERT INTO guild_settings(organization_id,guild_id,revision,settings) VALUES(${s.organizationId}::uuid,${s.guildId},0,'{"enabled":true}'::jsonb) ON CONFLICT(organization_id,guild_id) DO UPDATE SET revision=0,settings=EXCLUDED.settings`.execute(db);
 const settings=new SettingsService(db),legacy=await settings.get(s);
 expect(legacy.setupSteps).toEqual({scope:true,team:true,notifications:true,goals:true});
 expect(legacy.setupVersion).toBe(1);expect(legacy.timezone).toBe('Asia/Tokyo');
 await settings.update(s,{key:'admin',permissions:'8',roles:[],source:'DISCORD_PANEL',requestId:randomUUID()},0,{helperEnabled:false});
 expect((await settings.get(s)).setupSteps).toEqual(legacy.setupSteps);
});
it.each([
 ['Discord 429',new DiscordFailure(429,0.01),'PENDING'],
 ['Discord 500',new DiscordFailure(500),'UNKNOWN'],
 ['network timeout',new Error('timeout'),'UNKNOWN'],
 ['role deleted',new DiscordFailure(404),'FAILED'],
 ['permission revoked',new DiscordFailure(403),'FAILED']
] as const)('handles %s without inventing role ownership',async(_name,failure,expected)=>{
 const s=scopeForGuild(String(BigInt('600000000000000000')+BigInt(Math.floor(Math.random()*100000))));await sql`DELETE FROM guilds WHERE guild_id=${s.guildId}`.execute(db);await ensureGuild(db,s);
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32));const settings=new SettingsService(db);const onboarding=new OnboardingService(db,settings,vault);const discord=new FakeDiscord();const user='700000000000000000';
 discord.members.set(user,{roles:[],permissions:'0',joinedAt:new Date().toISOString(),bot:false});
 const actor={key:'admin',permissions:'8',roles:[],source:'DISCORD_PANEL' as const,requestId:randomUUID()};const flow=templateFlow('Gaming');flow.nodes[0]!.options[1]!.roleId='800000000000000000';
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
 const actor={key:vault.hash(s,user),permissions:'8',roles:[],source:'DISCORD_PANEL' as const,requestId:randomUUID()};
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
 discord.members.set(adminId,{roles:[],permissions:'8',joinedAt:'2026-09-01T00:00:00Z',bot:false});discord.members.set(userId,{roles:[manualRole],permissions:'0',joinedAt:'2026-09-20T00:00:00Z',bot:false});
 const actor={key:vault.hash(s,adminId),permissions:'8',roles:[],source:'DISCORD_PANEL' as const,requestId:randomUUID()};
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
it('moves a panel only after the new message is created and keeps the old panel on failure',async()=>{
 const s=scopeForGuild('644444444444444444');await sql`DELETE FROM guilds WHERE guild_id=${s.guildId}`.execute(db);await ensureGuild(db,s);
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32)),settings=new SettingsService(db),discord=new FakeDiscord(),tokens=new Components('test'),onboarding=new OnboardingService(db,settings,vault);
 const userId='644444444444444445',channelA='644444444444444446',channelB='644444444444444447';discord.members.set(userId,{roles:[],permissions:'8',joinedAt:'2026-09-01T00:00:00Z',bot:false});
 const interactions=new InteractionWorker(db,vault,tokens,discord,settings,onboarding,async()=>{}),actions=new ActionWorker(db,vault,discord,onboarding);
 const base={id:'644444444444444448',applicationId:'644444444444444449',token:'test',userId,channelId:channelA};
 await interactions.dispatch(s,{...base,command:'panel'});while(await actions.tick(s)){/* drain outbox */}
 const original=(await sql<{channel_id:string;message_id:string}>`SELECT channel_id,message_id FROM settings_panels WHERE guild_id=${s.guildId}`.execute(db)).rows[0]!;
 const preview=await interactions.dispatch(s,{...base,id:'644444444444444450',channelId:channelB,command:'panel'}),controls=JSON.stringify(preview);
 expect(controls).toContain('Move to this channel');
 expect((await sql<{channel_id:string}>`SELECT channel_id FROM settings_panels WHERE guild_id=${s.guildId}`.execute(db)).rows[0]?.channel_id).toBe(channelA);
 const find=(node:unknown):string|undefined=>{if(!node||typeof node!=='object')return;const item=node as {label?:string;custom_id?:string;components?:unknown[]};if(item.label==='Move to this channel')return item.custom_id;for(const child of item.components??[]){const found=find(child);if(found)return found;}};
 const customId=find(preview);expect(customId).toBeDefined();
 await interactions.dispatch(s,{...base,id:'644444444444444451',channelId:channelB,customId,command:''});
 discord.failure=new DiscordFailure(403);await actions.tick(s);
 expect((await sql<{channel_id:string;message_id:string}>`SELECT channel_id,message_id FROM settings_panels WHERE guild_id=${s.guildId}`.execute(db)).rows[0]).toEqual(original);
 discord.failure=null;
 const remove=discord.deletePanel.bind(discord);discord.deletePanel=async()=>{throw new DiscordFailure(503);};
 await interactions.dispatch(s,{...base,id:'644444444444444452',channelId:channelB,customId,command:''});await actions.tick(s);
 const moved=(await sql<{channel_id:string;message_id:string}>`SELECT channel_id,message_id FROM settings_panels WHERE guild_id=${s.guildId}`.execute(db)).rows[0]!;
 expect(moved.channel_id).toBe(channelB);expect(moved.message_id).not.toBe(original.message_id);
 await actions.tick(s);expect(discord.panels.has(original.message_id)).toBe(true);
 expect((await sql<{state:string}>`SELECT state FROM action_outbox WHERE guild_id=${s.guildId} AND kind='PANEL_DELETE'`.execute(db)).rows[0]?.state).toBe('PENDING');
 discord.deletePanel=remove;await sql`UPDATE action_outbox SET available_at=now() WHERE guild_id=${s.guildId} AND kind='PANEL_DELETE'`.execute(db);await actions.tick(s);
 expect(discord.panels.has(original.message_id)).toBe(false);
 const staleAction=await tokens.issue(db,s,{action:'controlTryImprove'},null,900);
 await expect(interactions.dispatch(s,{...base,id:'644444444444444453',customId:staleAction,messageId:original.message_id,command:''})).rejects.toThrow('COMPONENT_EXPIRED');
});
it('records the panel failure stage and safe REST metadata when status still works',async()=>{
 const s=scopeForGuild('645555555555555555');await sql`DELETE FROM guilds WHERE guild_id=${s.guildId}`.execute(db);await ensureGuild(db,s);
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32)),settings=new SettingsService(db),discord=new FakeDiscord(),tokens=new Components('test'),onboarding=new OnboardingService(db,settings,vault);
 const userId='645555555555555556',channelId='645555555555555557',secret='interaction-private-token';discord.members.set(userId,{roles:[],permissions:'8',joinedAt:new Date().toISOString(),bot:false});
 const worker=new InteractionWorker(db,vault,tokens,discord,settings,onboarding,async()=>{});
 const base={applicationId:'645555555555555558',token:secret,userId,channelId};
 expect(JSON.stringify(await worker.dispatch(s,{...base,id:'645555555555555559',command:'status'}))).toContain('Discord');
 discord.failure=new DiscordFailure(503,0,{routeCategory:'channel',rateLimitScope:'shared',bucket:'panel-bucket'});
 const job={...base,id:'645555555555555560',command:'panel'};
 await sql`INSERT INTO interaction_jobs(organization_id,guild_id,id,encrypted_payload) VALUES(${s.organizationId}::uuid,${s.guildId},${job.id},${vault.seal(s,JSON.stringify(job))})`.execute(db);
 const logs:string[]=[];const writer=vi.spyOn(process.stderr,'write').mockImplementation(value=>{logs.push(String(value));return true;});
 try{expect(await worker.tick(s)).toBe(true);}finally{writer.mockRestore();}
 const failure=logs.map(line=>{try{return JSON.parse(line) as Record<string,unknown>;}catch{return null;}}).find(row=>row?.command==='panel');
 expect(failure).toMatchObject({action:'panel',stage:'panel_channel_validation',httpStatus:503,routeCategory:'channel',rateLimitScope:'shared',bucket:'panel-bucket'});
 expect(failure?.reference).toMatch(/^NXS-[A-F0-9]{12}$/);expect(JSON.stringify(failure)).not.toContain(secret);
});
it('reconciles a crashed panel send by nonce without activating a second panel',async()=>{
 const s=scopeForGuild('646666666666666666');await sql`DELETE FROM guilds WHERE guild_id=${s.guildId}`.execute(db);await ensureGuild(db,s);
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32)),settings=new SettingsService(db),discord=new FakeDiscord(),tokens=new Components('test'),onboarding=new OnboardingService(db,settings,vault);
 const userId='646666666666666667',channelId='646666666666666668';discord.members.set(userId,{roles:[],permissions:'8',joinedAt:new Date().toISOString(),bot:false});
 const interactions=new InteractionWorker(db,vault,tokens,discord,settings,onboarding,async()=>{}),actions=new ActionWorker(db,vault,discord,onboarding);
 await interactions.dispatch(s,{id:'646666666666666669',applicationId:'646666666666666670',token:'test',userId,channelId,command:'panel'});
 const pending=(await sql<{id:string;payload:{body:unknown}}>`SELECT id,payload FROM action_outbox WHERE guild_id=${s.guildId} AND kind='PANEL_UPSERT'`.execute(db)).rows[0]!;
 const sent=await discord.sendPanel(channelId,pending.payload.body as Parameters<FakeDiscord['sendPanel']>[1],pending.id);
 await sql`UPDATE action_outbox SET state='RUNNING',lease_until=now()-interval '1 minute' WHERE guild_id=${s.guildId} AND id=${pending.id}::uuid`.execute(db);
 expect(await actions.tick(s)).toBe(true);
 expect((await sql<{message_id:string}>`SELECT message_id FROM settings_panels WHERE guild_id=${s.guildId}`.execute(db)).rows[0]?.message_id).toBe(sent);
 expect(discord.panels.size).toBe(1);
});
it('completes setup with optional choices and confirms manager role grants',async()=>{
 const s=scopeForGuild('655555555555555555');await sql`DELETE FROM guilds WHERE guild_id=${s.guildId}`.execute(db);await ensureGuild(db,s);
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32)),settings=new SettingsService(db),discord=new FakeDiscord(),tokens=new Components('test'),onboarding=new OnboardingService(db,settings,vault);
 const userId='655555555555555556',channelId='655555555555555557',roleId='655555555555555558';discord.members.set(userId,{roles:[],permissions:'8',joinedAt:'2026-09-01T00:00:00Z',bot:false});discord.roles=async()=>[{id:roleId,managed:false,permissions:'0',position:1}];
 const worker=new InteractionWorker(db,vault,tokens,discord,settings,onboarding,async()=>{}),actions=new ActionWorker(db,vault,discord,onboarding);
 const base={applicationId:'655555555555555559',token:'test',userId,channelId};await worker.dispatch(s,{...base,id:'655555555555555560',command:'panel'});while(await actions.tick(s)){/* drain outbox */}
 const messageId=(await sql<{message_id:string}>`SELECT message_id FROM settings_panels WHERE guild_id=${s.guildId}`.execute(db)).rows[0]!.message_id;
 let serial=561;const dispatchAction=async(action:string,values?:string[])=>{const current=await settings.get(s),customId=await tokens.issue(db,s,{action,revision:current.revision},null,900);return worker.dispatch(s,{...base,id:`655555555555555${serial++}`,command:'',customId,messageId,values});};
 for(const action of ['controlScopeDefault','controlSkipTeam','controlSkipNotifications','controlSkipGoals'])await dispatchAction(action);
 const done=await settings.get(s);expect(done.setupSteps).toEqual({scope:true,team:true,notifications:true,goals:true});expect(done.managerRoleIds).toEqual([]);expect(done.helperEnabled).toBe(false);expect(done.newMemberGoals).toEqual([]);
 const preview=await dispatchAction('controlManagers',[roleId]);expect(JSON.stringify(preview)).toContain('Confirm roles');expect((await settings.get(s)).managerRoleIds).toEqual([]);
 const find=(node:unknown):string|undefined=>{if(!node||typeof node!=='object')return;const item=node as {label?:string;custom_id?:string;components?:unknown[]};if(item.label==='Confirm roles')return item.custom_id;for(const child of item.components??[]){const found=find(child);if(found)return found;}};
 const findCancel=(node:unknown):string|undefined=>{if(!node||typeof node!=='object')return;const item=node as {label?:string;custom_id?:string;components?:unknown[]};if(item.label==='Cancel')return item.custom_id;for(const child of item.components??[]){const found=findCancel(child);if(found)return found;}};
 expect(findCancel(preview)).toBeDefined();const cancelled=await worker.dispatch(s,{...base,id:'655555555555555574',command:'',customId:findCancel(preview)});
 expect(JSON.stringify(cancelled)).toContain('Roles that can manage NEXUS');expect(JSON.stringify(cancelled)).not.toContain('Reply Rescue');
 const confirm=find(preview);expect(confirm).toBeDefined();await worker.dispatch(s,{...base,id:'655555555555555570',command:'',customId:confirm});expect((await settings.get(s)).managerRoleIds).toEqual([roleId]);
 const revision=(await settings.get(s)).revision,clear=await tokens.issue(db,s,{action:'controlClearManagers',revision},null,900),clearPreview=await worker.dispatch(s,{...base,id:'655555555555555571',command:'',customId:clear,messageId});
 expect((await settings.get(s)).managerRoleIds).toEqual([roleId]);await worker.dispatch(s,{...base,id:'655555555555555572',command:'',customId:find(clearPreview)});expect((await settings.get(s)).managerRoleIds).toEqual([]);
 const withHelper=await settings.update(s,{key:vault.hash(s,userId),permissions:'8',roles:[],source:'DISCORD_PANEL',requestId:randomUUID()},(await settings.get(s)).revision,{helperRoleIds:[roleId]});
 const clearHelpers=await tokens.issue(db,s,{action:'controlClearHelpers',revision:withHelper.revision},null,900);await worker.dispatch(s,{...base,id:'655555555555555573',command:'',customId:clearHelpers,messageId});expect((await settings.get(s)).helperRoleIds).toEqual([]);
 const old=await settings.update(s,{key:vault.hash(s,userId),permissions:'8',roles:[],source:'DISCORD_PANEL',requestId:randomUUID()},(await settings.get(s)).revision,{setupVersion:1});
 const review=await tokens.issue(db,s,{action:'controlReviewSetup'},null,900);expect(JSON.stringify(await worker.dispatch(s,{...base,id:'655555555555555575',command:'',customId:review,messageId}))).toContain('Setup 1/4');
 for(const [index,step] of (['scope','team','notifications','goals'] as const).entries()){
  const revision=(await settings.get(s)).revision,token=await tokens.issue(db,s,{action:'setupNext',step,revision},null,900);
  await worker.dispatch(s,{...base,id:`65555555555555557${index+6}`,command:'',customId:token});
 }
 const upgraded=await settings.get(s);expect(upgraded.setupVersion).toBe(2);expect(upgraded.managerRoleIds).toEqual(old.managerRoleIds);
 const status=await worker.dispatch(s,{...base,id:'655555555555555580',command:'status'});expect(JSON.stringify(status)).toContain('0.6.0-alpha.4');expect(JSON.stringify(status)).not.toContain('PID');
});
it('distinguishes setup approval from safe skip during a legacy guild review',async()=>{
 const s=scopeForGuild('656666666666666666');await sql`DELETE FROM guilds WHERE guild_id=${s.guildId}`.execute(db);await ensureGuild(db,s);
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32)),settings=new SettingsService(db),discord=new FakeDiscord(),tokens=new Components('test'),onboarding=new OnboardingService(db,settings,vault);
 const userId='656666666666666667',channelId='656666666666666668',roleId='656666666666666669';discord.members.set(userId,{roles:[],permissions:'8',joinedAt:new Date().toISOString(),bot:false});
 const actor={key:vault.hash(s,userId),permissions:'8',roles:[],source:'DISCORD_PANEL' as const,requestId:randomUUID()};
 await settings.update(s,actor,0,{setupVersion:1,setupSteps:{scope:true,team:true,notifications:true,goals:true},analysisScope:{mode:'include',channelIds:[channelId]},managerRoleIds:[roleId],helperRoleIds:[roleId],helperEnabled:true,helperChannelId:channelId,goalPreset:'multiplayer',newMemberGoals:['reply']});
 const worker=new InteractionWorker(db,vault,tokens,discord,settings,onboarding,async()=>{}),base={applicationId:'656666666666666670',token:'test',userId,channelId,command:''};
 await worker.dispatch(s,{...base,id:'656666666666666676',customId:await tokens.issue(db,s,{action:'controlReviewSetup'},null,900)});
 expect((await settings.get(s)).setupVersion).toBe(1);
 let serial=671;let oldToken='';
 for(const [step,mode] of [['scope','complete'],['team','skip'],['notifications','complete'],['goals','skip']] as const){
  const current=await settings.get(s),customId=await tokens.issue(db,s,{action:'setupNext',step,mode,revision:current.revision},null,900);
  if(step==='scope')oldToken=customId;
  await worker.dispatch(s,{...base,id:`656666666666666${serial++}`,customId});
 }
 const done=await settings.get(s);
 expect(done.setupVersion).toBe(2);expect(done.analysisScope).toEqual({mode:'include',channelIds:[channelId]});
 expect(done.managerRoleIds).toEqual([]);expect(done.helperRoleIds).toEqual([]);expect(done.helperEnabled).toBe(true);
 expect(done.goalPreset).toBeNull();expect(done.newMemberGoals).toEqual([]);
 await expect(worker.dispatch(s,{...base,id:'656666666666666675',customId:oldToken})).rejects.toThrow('REVISION_CONFLICT');
});
it('previews an improvement without saving, cancels cleanly, and applies on confirmation',async()=>{
 const s=scopeForGuild('666666666666666661');await sql`DELETE FROM guilds WHERE guild_id=${s.guildId}`.execute(db);await ensureGuild(db,s);
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32)),settings=new SettingsService(db),discord=new FakeDiscord(),tokens=new Components('test'),onboarding=new OnboardingService(db,settings,vault);
 const userId='666666666666666662',channelId='666666666666666663';discord.members.set(userId,{roles:[],permissions:'8',joinedAt:'2026-09-01T00:00:00Z',bot:false});
 const worker=new InteractionWorker(db,vault,tokens,discord,settings,onboarding,async()=>{}),actor={key:vault.hash(s,userId),permissions:'8',roles:[],source:'DISCORD_PANEL' as const,requestId:randomUUID()};
 await settings.update(s,actor,0,{helperChannelId:channelId});
 const base={applicationId:'666666666666666664',token:'test',userId,channelId,command:''},issue=async(action:string)=>tokens.issue(db,s,{action},null,900);
 const find=(node:unknown,label:string):string|undefined=>{if(!node||typeof node!=='object')return;const item=node as {label?:string;custom_id?:string;components?:unknown[]};if(item.label===label)return item.custom_id;for(const child of item.components??[]){const found=find(child,label);if(found)return found;}};
 const preview=await worker.dispatch(s,{...base,id:'666666666666666665',customId:await issue('controlTryImprove')});expect(JSON.stringify(preview)).toContain('Preview:');expect((await settings.get(s)).helperEnabled).toBe(false);
 await worker.dispatch(s,{...base,id:'666666666666666666',customId:find(preview,'Cancel')});expect((await settings.get(s)).helperEnabled).toBe(false);
 const again=await worker.dispatch(s,{...base,id:'666666666666666667',customId:await issue('controlTryImprove')});await worker.dispatch(s,{...base,id:'666666666666666668',customId:find(again,'Enable notification')});
 expect((await settings.get(s)).helperEnabled).toBe(true);expect((await settings.get(s)).firstResponseMinutes).toBe(20);
});
it('snoozes an attention item, shows it after expiry, and suppresses it when resolved',async()=>{
 const s=scopeForGuild('677777777777777771');await sql`DELETE FROM attention_items WHERE guild_id=${s.guildId}`.execute(db);await sql`DELETE FROM guilds WHERE guild_id=${s.guildId}`.execute(db);await ensureGuild(db,s);
 const identity=randomUUID(),episode=randomUUID(),channelId='677777777777777772',messageId='677777777777777773';
 await sql`INSERT INTO member_identity_map(organization_id,guild_id,id,lookup_hash,encrypted_id) VALUES(${s.organizationId}::uuid,${s.guildId},${identity}::uuid,'attention-test','cipher')`.execute(db);
 await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context) VALUES(${s.organizationId}::uuid,${s.guildId},${episode}::uuid,${identity}::uuid,now()-interval '2 days','PRODUCTION')`.execute(db);
 await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',now()-interval '1 hour','PRODUCTION',jsonb_build_object('channelId',${channelId}::text,'messageId',${messageId}::text))`.execute(db);
 await sql`INSERT INTO telemetry_cursor(organization_id,guild_id,first_seen,last_seen) VALUES(${s.organizationId}::uuid,${s.guildId},now()-interval '3 days',now())`.execute(db);
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32)),settings=new SettingsService(db),discord=new FakeDiscord(),tokens=new Components('test'),onboarding=new OnboardingService(db,settings,vault),userId='677777777777777774';discord.members.set(userId,{roles:[],permissions:'8',joinedAt:'2026-09-01T00:00:00Z',bot:false});
 const worker=new InteractionWorker(db,vault,tokens,discord,settings,onboarding,async()=>{}),base={applicationId:'677777777777777775',token:'test',userId,channelId,command:''};
 const issue=async(action:string,extra:Record<string,unknown>={})=>tokens.issue(db,s,{action,channelId,messageId,...extra},null,900);
 const actor={key:vault.hash(s,userId),permissions:'8',roles:[],source:'DISCORD_PANEL' as const,requestId:randomUUID()};await settings.update(s,actor,0,{helperChannelId:channelId,helperEnabled:true});const helpers=new HelperWorker(db,discord,settings);
 expect((await new CommunityService(db).overview(s)).attention.map(item=>item.messageId)).toContain(messageId);
 for(const [index,choice] of [{minutes:30},{minutes:60},{until:'today'}].entries()){
  await worker.dispatch(s,{...base,id:`67777777777777778${index}`,customId:await issue('controlSnooze',choice)});
  expect((await new CommunityService(db).overview(s)).attention).toHaveLength(0);
  expect(await helpers.tick(s)).toBe(false);
  await sql`UPDATE attention_items SET snooze_until=now()-interval '1 minute' WHERE guild_id=${s.guildId}`.execute(db);
  expect((await new CommunityService(db).overview(s)).attention.map(item=>item.messageId)).toContain(messageId);
 }
 await sql`UPDATE attention_items SET snooze_until=NULL WHERE guild_id=${s.guildId}`.execute(db);
 expect((await new CommunityService(db).overview(s)).attention).toHaveLength(0);
 expect(await helpers.tick(s)).toBe(false);
 await sql`UPDATE attention_items SET snooze_until=now()-interval '1 minute' WHERE guild_id=${s.guildId}`.execute(db);
 await worker.dispatch(s,{...base,id:'677777777777777790',customId:await issue('controlAcknowledge')});
 expect((await new CommunityService(db).overview(s)).attention[0]?.status).toBe('ACKNOWLEDGED');
 expect(await helpers.tick(s)).toBe(false);
 await worker.dispatch(s,{...base,id:'677777777777777791',customId:await issue('controlResolve')});
 expect((await new CommunityService(db).overview(s)).attention).toHaveLength(0);
 expect(await helpers.tick(s)).toBe(false);
 expect((await sql<{status:string}>`SELECT status FROM attention_items WHERE guild_id=${s.guildId}`.execute(db)).rows[0]?.status).toBe('RESOLVED');
});
it('gates context commands and explains only observed newcomer messages',async()=>{
 const s=scopeForGuild('688888888888888881');await sql`DELETE FROM guilds WHERE guild_id=${s.guildId}`.execute(db);await ensureGuild(db,s);
 const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32)),settings=new SettingsService(db),discord=new FakeDiscord(),tokens=new Components('test'),onboarding=new OnboardingService(db,settings,vault);
 const adminId='688888888888888882',guestId='688888888888888883',targetId='688888888888888884',channelId='688888888888888885',messageId='688888888888888886';
 discord.members.set(adminId,{roles:[],permissions:'8',joinedAt:'2026-09-01T00:00:00Z',bot:false});discord.members.set(guestId,{roles:[],permissions:'0',joinedAt:'2026-09-01T00:00:00Z',bot:false});
 const identity=randomUUID(),episode=randomUUID();
 await sql`INSERT INTO member_identity_map(organization_id,guild_id,id,lookup_hash,encrypted_id) VALUES(${s.organizationId}::uuid,${s.guildId},${identity}::uuid,${vault.hash(s,targetId)},${vault.seal(s,targetId)})`.execute(db);
 await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context) VALUES(${s.organizationId}::uuid,${s.guildId},${episode}::uuid,${identity}::uuid,now()-interval '2 days','PRODUCTION')`.execute(db);
 await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',now()-interval '1 hour','PRODUCTION',jsonb_build_object('channelId',${channelId}::text,'messageId',${messageId}::text))`.execute(db);
 const worker=new InteractionWorker(db,vault,tokens,discord,settings,onboarding,async()=>{}),base={applicationId:'688888888888888887',token:'test',channelId,command:'contextAdd',targetMessageId:messageId};
 await expect(worker.dispatch(s,{...base,id:'688888888888888888',userId:guestId})).rejects.toThrow('ADMIN_REQUIRED');
 expect((await sql`SELECT status FROM attention_items WHERE guild_id=${s.guildId}`.execute(db)).rows).toHaveLength(0);
 expect(JSON.stringify(await worker.dispatch(s,{...base,id:'688888888888888889',userId:adminId}))).toContain('Added to Attention');
 expect(JSON.stringify(await worker.dispatch(s,{...base,id:'688888888888888890',userId:adminId,command:'contextExplain'}))).toContain('Message detection');
 expect(JSON.stringify(await worker.dispatch(s,{...base,id:'688888888888888891',userId:adminId,command:'contextMember',targetUserId:targetId}))).toContain('New member status');
 await expect(worker.dispatch(s,{...base,id:'688888888888888892',userId:guestId,command:'contextMember',targetUserId:targetId})).rejects.toThrow('ADMIN_REQUIRED');
 expect(JSON.stringify(await worker.dispatch(s,{...base,id:'688888888888888893',userId:adminId,command:'contextResolve'}))).toContain('Marked resolved');
 expect((await sql<{status:string}>`SELECT status FROM attention_items WHERE guild_id=${s.guildId}`.execute(db)).rows[0]?.status).toBe('RESOLVED');
});
it('counts first connection only inside the first 72 hours',async()=>{
 const s=scopeForGuild('699999999999999991');await sql`DELETE FROM guilds WHERE guild_id=${s.guildId}`.execute(db);await ensureGuild(db,s);
 const identity=randomUUID(),episode=randomUUID(),joined=new Date(Date.now()-16*86400000);
 await sql`INSERT INTO member_identity_map(organization_id,guild_id,id,lookup_hash,encrypted_id) VALUES(${s.organizationId}::uuid,${s.guildId},${identity}::uuid,'window-test','cipher')`.execute(db);
 await sql`INSERT INTO membership_episodes(organization_id,guild_id,id,identity_id,joined_at,context) VALUES(${s.organizationId}::uuid,${s.guildId},${episode}::uuid,${identity}::uuid,${joined},'PRODUCTION')`.execute(db);
 await sql`INSERT INTO telemetry_cursor(organization_id,guild_id,first_seen,last_seen) VALUES(${s.organizationId}::uuid,${s.guildId},${new Date(joined.getTime()-60000)},now())`.execute(db);
 await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episode}::uuid,'message.sent',${new Date(joined.getTime()+3600000)},'PRODUCTION','{}'::jsonb)`.execute(db);
 await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episode}::uuid,'voice.connected',${new Date(joined.getTime()+4*86400000)},'PRODUCTION','{}'::jsonb)`.execute(db);
 const community=new CommunityService(db);expect((await community.overview(s)).stages.find(step=>step.key==='connected')?.count).toBe(0);
 await sql`INSERT INTO lifecycle_events(organization_id,guild_id,id,episode_id,kind,occurred_at,context,data) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episode}::uuid,'reply.received',${new Date(joined.getTime()+2*86400000)},'PRODUCTION','{}'::jsonb)`.execute(db);
 expect((await community.overview(s)).stages.find(step=>step.key==='connected')?.count).toBe(1);
});
it('serializes settings revisions, authorization and audit atomically',async()=>{
 const s=scopeForGuild('444444444444444444');await ensureGuild(db,s);
 await sql`DELETE FROM guild_settings WHERE guild_id=${s.guildId}`.execute(db);
 const settings=new SettingsService(db);const actor={key:'internal-admin',permissions:'8',roles:[],source:'DISCORD_PANEL' as const,requestId:randomUUID()};
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
  member:{user:{id:'333333333333333333'},permissions:'8',roles:[]},data:{name:'nexus',options:[{name:'panel'}]},content:'PRIVATE BODY',attachments:['PRIVATE FILE']};
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
