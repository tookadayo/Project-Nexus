import {beforeAll,afterAll,it,expect} from 'vitest';
import {infrastructure} from '../fixtures/infrastructure.js';
import {FakeDiscord} from '../fixtures/discord.js';
import {connect,migrate,ensureGuild,sql,tenant,json,type Database} from '../../packages/db/src/index.js';
import {IdentityVault} from '../../packages/identity/src/index.js';
import {SettingsService,type Actor} from '../../packages/settings/src/index.js';
import {scopeForGuild,Components} from '../../packages/security/src/index.js';
import {ServerAuthorization} from '../../packages/security/src/server-authorization.js';
import {ServerVerification,normalizeVerificationCode} from '../../packages/security/src/server-verification.js';
import {PrivacyService} from '../../packages/security/src/privacy.js';
import {OnboardingService} from '../../packages/onboarding/src/index.js';
import {InteractionWorker} from '../../apps/worker/src/interactions.js';
import type {InteractionJob} from '../../apps/interaction/src/server.js';
let infra:Awaited<ReturnType<typeof infrastructure>>,db:Database,sequence=0;
const vault=new IdentityVault('aa'.repeat(32),'bb'.repeat(32));
beforeAll(async()=>{infra=await infrastructure();db=connect(infra.databaseUrl);await migrate(db);});
afterAll(async()=>{await db?.destroy();await infra?.stop();});
async function fixture(){
 const n=++sequence,s=scopeForGuild(String(741111111111111111n+BigInt(n))),user=String(751111111111111111n+BigInt(n)*10n),other=String(BigInt(user)+1n),role='761111111111111111';
 await ensureGuild(db,s);const discord=new FakeDiscord(),settings=new SettingsService(db);let now=Date.now();
 discord.members.set(user,{roles:[],permissions:'32',bot:false,joinedAt:new Date().toISOString()});
 discord.members.set(other,{roles:[],permissions:'8',bot:false,joinedAt:new Date().toISOString()});
 const authority=new ServerAuthorization(discord,settings,vault),service=new ServerVerification(db,vault,authority,()=>now);
 const actor:Actor={key:vault.hash(s,user),permissions:'32',roles:[],source:'DISCORD_PANEL',requestId:'fixture'};
 return {s,user,other,role,discord,settings,authority,service,actor,advance:(ms:number)=>{now+=ms;}};
}
it('rechecks current Discord permissions and configured admin/manager roles when issuing',async()=>{
 const f=await fixture(),member=f.discord.members.get(f.user)!;
 member.permissions='0';await expect(f.service.issue(f.s,f.user)).rejects.toMatchObject({code:'ADMIN_REQUIRED'});
 await f.settings.update(f.s,f.actor,0,{managerRoleIds:[f.role]});member.roles=[f.role];
 const code=await f.service.issue(f.s,f.user);expect(code.expiresAt.getTime()-Date.now()).toBeLessThanOrEqual(600000);
 member.roles=[];f.advance(31000);await expect(f.service.issue(f.s,f.user)).rejects.toMatchObject({code:'ADMIN_REQUIRED'});
 member.permissions='8';await expect(f.service.issue(f.s,f.user)).resolves.toHaveProperty('code');
 f.discord.members.delete(f.user);await expect(f.service.issue(f.s,f.user)).rejects.toMatchObject({status:404});
});
it('stores only keyed code digests and protected issuer identities with safe audit fields',async()=>{
 const f=await fixture(),challenge=await f.service.issue(f.s,f.user);
 const row=(await sql<Record<string,unknown>>`SELECT * FROM server_verification_challenges WHERE ${tenant(f.s)}`.execute(db)).rows[0]!;
 expect(row.code_digest).toBe(vault.digest('verification-code:v1',normalizeVerificationCode(challenge.code)!));
 expect(row.issuer_hash).toBe(vault.hash(f.s,f.user));expect(vault.open(f.s,String(row.issuer_identity_ciphertext))).toBe(f.user);
 const audits=(await sql`SELECT * FROM audit_logs WHERE ${tenant(f.s)}`.execute(db)).rows;
 for(const value of [JSON.stringify(row),JSON.stringify(audits)]){expect(value).not.toContain(challenge.code);expect(value).not.toContain(normalizeVerificationCode(challenge.code)!);expect(value).not.toContain(f.user);}
 expect(audits).toEqual(expect.arrayContaining([expect.objectContaining({action:'server_verification.issued'})]));
 expect((await f.service.connection(f.s,f.user)).state).toBe('VERIFICATION_PENDING');expect((await f.service.connection(f.s,f.other)).state).toBe('INSTALLED_NOT_VERIFIED');
});
it('binds redemption to the issuing identity and accepts normalized input',async()=>{
 const f=await fixture(),challenge=await f.service.issue(f.s,f.user);
 await expect(f.service.redeem(f.other,challenge.code)).rejects.toMatchObject({code:'VERIFICATION_INVALID'});
 expect((await sql<{attempt_count:number}>`SELECT attempt_count FROM server_verification_challenges WHERE ${tenant(f.s)}`.execute(db)).rows[0]!.attempt_count).toBe(0);
 await expect(f.service.redeem(f.user,challenge.code.toLowerCase().replaceAll('-',' '))).resolves.toEqual({guildId:f.s.guildId});
 expect((await f.service.connection(f.s)).state).toBe('VERIFIED');
 await expect(f.service.redeem(f.user,challenge.code)).rejects.toMatchObject({code:'VERIFICATION_INVALID'});
});
it('allows exactly one successful concurrent redemption across database transactions',async()=>{
 const f=await fixture(),challenge=await f.service.issue(f.s,f.user);
 const secondDb=connect(infra.databaseUrl),second=new ServerVerification(secondDb,vault,f.authority);
 try{const results=await Promise.allSettled([f.service.redeem(f.user,challenge.code),second.redeem(f.user,challenge.code)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);}
 finally{await secondDb.destroy();}
 const rows=(await sql`SELECT * FROM server_web_links WHERE ${tenant(f.s)}`.execute(db)).rows;expect(rows).toHaveLength(1);
 expect((await sql`SELECT * FROM audit_logs WHERE ${tenant(f.s)} AND action='server_verification.completed'`.execute(db)).rows).toHaveLength(1);
});
it('rejects expired, revoked and malformed challenges with the same error',async()=>{
 const f=await fixture(),expired=await f.service.issue(f.s,f.user);f.advance(600001);
 await expect(f.service.redeem(f.user,expired.code)).rejects.toMatchObject({code:'VERIFICATION_INVALID'});
 const revoked=await f.service.issue(f.s,f.user);await f.service.revokeChallenge(f.s,revoked.id);
 for(const input of [revoked.code,'invalid','NX-OOOO-1111-LLLL',null,{code:revoked.code},'A'.repeat(1000)])await expect(f.service.redeem(f.user,input)).rejects.toMatchObject({code:'VERIFICATION_INVALID'});
 expect((await f.service.connection(f.s)).state).toBe('INSTALLED_NOT_VERIFIED');
});
it('enforces issuance cooldowns, user/guild quotas and revokes older unused codes',async()=>{
 const f=await fixture(),old=await f.service.issue(f.s,f.user);
 await expect(f.service.issue(f.s,f.user)).rejects.toMatchObject({code:'VERIFICATION_RATE_LIMIT'});
 f.advance(31000);const replacement=await f.service.issue(f.s,f.user);
 await expect(f.service.redeem(f.user,old.code)).rejects.toMatchObject({code:'VERIFICATION_INVALID'});
 for(let i=0;i<3;i++){f.advance(31000);await f.service.issue(f.s,f.user);}
 f.advance(31000);await expect(f.service.issue(f.s,f.user)).rejects.toMatchObject({code:'VERIFICATION_RATE_LIMIT'});
 expect((await sql`SELECT * FROM server_verification_challenges WHERE ${tenant(f.s)} AND revoked_at IS NULL AND used_at IS NULL`.execute(db)).rows).toHaveLength(1);
 expect(replacement.code).not.toBe(old.code);
 const g=await fixture();for(let i=0;i<10;i++){const user=String(BigInt(g.user)+BigInt(i));g.discord.members.set(user,{permissions:'32',roles:[],bot:false,joinedAt:new Date().toISOString()});await g.service.issue(g.s,user);}
 const extra=String(BigInt(g.user)+11n);g.discord.members.set(extra,{permissions:'32',roles:[],bot:false,joinedAt:new Date().toISOString()});await expect(g.service.issue(g.s,extra)).rejects.toMatchObject({code:'VERIFICATION_RATE_LIMIT'});
});
it('persists a bounded per-user guessing budget, including malformed attempts and concurrency',async()=>{
 const f=await fixture(),challenge=await f.service.issue(f.s,f.user);
 await Promise.all(Array.from({length:10},()=>f.service.redeem(f.user,'bad').catch(error=>expect(error.code).toBe('VERIFICATION_INVALID'))));
 await expect(f.service.redeem(f.user,challenge.code)).rejects.toMatchObject({code:'VERIFICATION_RATE_LIMIT'});
 const row=(await sql<{attempt_count:number}>`SELECT attempt_count FROM server_verification_limits WHERE key_digest=${vault.digest('verification-attempt:v1',f.user)}`.execute(db)).rows[0]!;expect(row.attempt_count).toBe(11);
 f.advance(600001);const fresh=await f.service.issue(f.s,f.user);await expect(f.service.redeem(f.user,fresh.code)).resolves.toHaveProperty('guildId');
});
it('issues concurrently without exhausting the authorization connection pool',async()=>{
 const f=await fixture(),users=Array.from({length:10},(_,index)=>String(BigInt(f.user)+BigInt(index)));
 for(const user of users)f.discord.members.set(user,{permissions:'32',roles:[],bot:false,joinedAt:new Date().toISOString()});
 const results=await Promise.all(users.map(user=>f.service.issue(f.s,user)));expect(results).toHaveLength(10);
 expect(new Set(results.map(result=>result.code)).size).toBe(10);
});
it('denies lost authority at redemption and disconnect, and bounds challenge failures',async()=>{
 const f=await fixture(),challenge=await f.service.issue(f.s,f.user),member=f.discord.members.get(f.user)!;
 member.permissions='0';for(let i=0;i<8;i++)await expect(f.service.redeem(f.user,challenge.code)).rejects.toMatchObject({code:'VERIFICATION_INVALID'});
 expect((await sql<{attempt_count:number;revoked_at:Date}>`SELECT attempt_count,revoked_at FROM server_verification_challenges WHERE ${tenant(f.s)}`.execute(db)).rows[0]).toEqual(expect.objectContaining({attempt_count:8,revoked_at:expect.any(Date)}));
 expect((await sql`SELECT * FROM audit_logs WHERE ${tenant(f.s)} AND action='server_verification.failed'`.execute(db)).rows).toHaveLength(1);
 member.permissions='32';f.advance(600001);const fresh=await f.service.issue(f.s,f.user);await f.service.redeem(f.user,fresh.code);
 member.permissions='0';await expect(f.authority.actor(f.s,f.user,'WEB_DASHBOARD','read')).rejects.toMatchObject({code:'ADMIN_REQUIRED'});
 await expect(f.service.disconnect(f.s,f.user,(await f.service.connection(f.s)).version)).rejects.toMatchObject({code:'ADMIN_REQUIRED'});
 expect((await f.service.connection(f.s)).state).toBe('VERIFIED');
});
it('disconnects links and every unused code while preserving settings, history and analytics; relinking restores access',async()=>{
 const f=await fixture();await f.settings.update(f.s,f.actor,0,{timezone:'Asia/Tokyo'});
 const challenge=await f.service.issue(f.s,f.user);await f.service.redeem(f.user,challenge.code);const before=await f.service.connection(f.s);
 const pending=await f.service.issue(f.s,f.other);
 const settingsBefore=await f.settings.get(f.s),auditCount=(await sql<{count:number}>`SELECT count(*)::integer AS count FROM audit_logs WHERE ${tenant(f.s)}`.execute(db)).rows[0]!.count;
 await sql`INSERT INTO daily_guild_metrics(organization_id,guild_id,day,metrics) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},current_date,${json({messages:42})})`.execute(db);
 await f.service.disconnect(f.s,f.user,before.version);
 await expect(f.service.redeem(f.other,pending.code)).rejects.toMatchObject({code:'VERIFICATION_INVALID'});
 expect(await f.settings.get(f.s)).toEqual(settingsBefore);expect((await sql`SELECT * FROM daily_guild_metrics WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(1);
 expect((await sql<{count:number}>`SELECT count(*)::integer AS count FROM audit_logs WHERE ${tenant(f.s)}`.execute(db)).rows[0]!.count).toBe(auditCount+1);
 f.advance(31000);const relink=await f.service.issue(f.s,f.user);await f.service.redeem(f.user,relink.code);
 await expect(f.service.disconnect(f.s,f.user,before.version)).rejects.toMatchObject({code:'REVISION_CONFLICT'});expect((await f.service.connection(f.s)).state).toBe('VERIFIED');
});
it('delivers link codes privately without writing plaintext to outbox or diagnostics',async()=>{
 const f=await fixture(),worker=new InteractionWorker(db,vault,new Components('verification-components'),f.discord,f.settings,new OnboardingService(db,f.settings,vault),async()=>{});
 const oldUrl=process.env.NEXUS_WEB_URL;process.env.NEXUS_WEB_URL='https://nexus.example';
 const input:InteractionJob={id:'771111111111111111',applicationId:'781111111111111111',token:'private-interaction',userId:f.user,command:'link',locale:'en'};
 try{
  await sql`INSERT INTO interaction_jobs(organization_id,guild_id,id,encrypted_payload) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${input.id},${vault.seal(f.s,JSON.stringify(input))})`.execute(db);
  expect(await worker.tick(f.s)).toBe(true);const reply=JSON.stringify(f.discord.panels.get('reply')),code=reply.match(/NX-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}/)?.[0];expect(code).toBeDefined();expect(reply).toContain('https://nexus.example/link');
  expect((await sql`SELECT * FROM action_outbox WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
  for(const table of ['interaction_jobs','interaction_diagnostics','audit_logs','server_verification_challenges'])expect(JSON.stringify((await sql`SELECT * FROM ${sql.table(table)} WHERE ${tenant(f.s)}`.execute(db)).rows)).not.toContain(code!);
  expect((await sql<{state:string}>`SELECT state FROM interaction_jobs WHERE ${tenant(f.s)}`.execute(db)).rows[0]!.state).toBe('SUCCEEDED');
 }finally{if(oldUrl===undefined)delete process.env.NEXUS_WEB_URL;else process.env.NEXUS_WEB_URL=oldUrl;}
});
it('requires actor-bound Discord unlink confirmation and rechecks permissions',async()=>{
 const f=await fixture(),tokens=new Components('verification-components'),worker=new InteractionWorker(db,vault,tokens,f.discord,f.settings,new OnboardingService(db,f.settings,vault),async()=>{});
 const issued=await f.service.issue(f.s,f.user);await f.service.redeem(f.user,issued.code);
 const input:InteractionJob={id:'791111111111111111',applicationId:'781111111111111111',token:'private-interaction',userId:f.user,command:'unlink',locale:'en'};
 const panel=await worker.dispatch(f.s,input),components=(value:unknown):string[]=>Array.isArray(value)?value.flatMap(components):value&&typeof value==='object'?Object.entries(value).flatMap(([key,v])=>key==='custom_id'?[String(v)]:components(v)):[];
 const confirm=components(panel)[0]!;expect((await f.service.connection(f.s)).state).toBe('VERIFIED');
 await expect(worker.dispatch(f.s,{...input,command:undefined,customId:confirm,userId:f.other})).rejects.toMatchObject({code:'COMPONENT_OWNER'});
 f.discord.members.get(f.user)!.permissions='0';await expect(worker.dispatch(f.s,{...input,command:undefined,customId:confirm})).rejects.toMatchObject({code:'ADMIN_REQUIRED'});
 f.discord.members.get(f.user)!.permissions='32';await worker.dispatch(f.s,{...input,command:undefined,customId:confirm});expect((await f.service.connection(f.s)).state).toBe('INSTALLED_NOT_VERIFIED');
});
it('revokes a code when private Discord delivery fails and queues only a safe error',async()=>{
 const f=await fixture(),worker=new InteractionWorker(db,vault,new Components('verification-components'),f.discord,f.settings,new OnboardingService(db,f.settings,vault),async()=>{});
 const oldUrl=process.env.NEXUS_WEB_URL;process.env.NEXUS_WEB_URL='https://nexus.example';f.discord.failure=new Error('delivery unavailable');
 const input:InteractionJob={id:'771111111111111112',applicationId:'781111111111111111',token:'private-interaction',userId:f.user,command:'link',locale:'ja'};
 try{await sql`INSERT INTO interaction_jobs(organization_id,guild_id,id,encrypted_payload) VALUES(${f.s.organizationId}::uuid,${f.s.guildId},${input.id},${vault.seal(f.s,JSON.stringify(input))})`.execute(db);await worker.tick(f.s);
  expect((await sql<{revoked_at:Date}>`SELECT revoked_at FROM server_verification_challenges WHERE ${tenant(f.s)}`.execute(db)).rows[0]!.revoked_at).toBeInstanceOf(Date);
  const outbox=(await sql`SELECT * FROM action_outbox WHERE ${tenant(f.s)}`.execute(db)).rows;expect(outbox).toHaveLength(1);expect(JSON.stringify(outbox)).not.toMatch(/NX-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-/);expect(JSON.stringify(outbox)).not.toContain(input.token);
 }finally{if(oldUrl===undefined)delete process.env.NEXUS_WEB_URL;else process.env.NEXUS_WEB_URL=oldUrl;}
});
it('includes verification identities in existing privacy deletion without granting lasting authority',async()=>{
 const f=await fixture(),issued=await f.service.issue(f.s,f.user);await f.service.redeem(f.user,issued.code);
 await new PrivacyService(db,vault,f.settings).delete(f.s,f.user,f.actor);
 expect((await sql`SELECT * FROM server_verification_challenges WHERE ${tenant(f.s)}`.execute(db)).rows).toHaveLength(0);
 expect((await sql`SELECT verified_by_hash,verified_by_identity_ciphertext FROM server_web_links WHERE ${tenant(f.s)}`.execute(db)).rows[0]).toEqual({verified_by_hash:null,verified_by_identity_ciphertext:null});
 expect((await f.service.connection(f.s)).state).toBe('VERIFIED');f.discord.members.delete(f.user);await expect(f.authority.actor(f.s,f.user,'WEB_DASHBOARD','access')).rejects.toMatchObject({status:404});
});
