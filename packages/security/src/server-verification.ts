import {randomInt,randomUUID} from 'node:crypto';
import {ensureGuild,privacyReadLock,sql,tenant,type Database,type Tx} from '../../db/src/index';
import type {IdentityVault} from '../../identity/src/index';
import {audit,type Actor} from '../../settings/src/index';
import {assert,type Scope} from '../../shared/src/index';
import {scopeForGuild} from './scoping';
import type {ServerAuthorization,GuildAuthorizationSnapshot} from './server-authorization';

const alphabet='23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function verificationCode(){const value=Array.from({length:12},()=>alphabet[randomInt(alphabet.length)]).join('');return `NX-${value.slice(0,4)}-${value.slice(4,8)}-${value.slice(8)}`;}
export function normalizeVerificationCode(value:unknown):string|null{
 if(typeof value!=='string'||value.length>64)return null;
 const normalized=value.replace(/[\s-]/g,'').toUpperCase();
 return /^NX[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{12}$/.test(normalized)?normalized:null;
}
export type VerificationState='VERIFIED'|'INSTALLED_NOT_VERIFIED'|'NOT_INSTALLED'|'VERIFICATION_PENDING';
type Link={verified_at:Date;revoked_at:Date|null;updated_at:Date;revision:string};
type Challenge={id:string;organization_id:string;guild_id:string;issuer_hash:string;expires_at:Date;used_at:Date|null;revoked_at:Date|null;attempt_count:number};
type Authority=Pick<ServerAuthorization,'snapshot'|'require'|'revalidate'>;
export class ServerVerification {
 constructor(private readonly db:Database,private readonly vault:IdentityVault,private readonly authority:Authority,private readonly clock:()=>number=Date.now){}
 private async lock(tx:Tx,s:Scope){await privacyReadLock(tx,s);await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'verification:'+s.organizationId+':'+s.guildId},0))`.execute(tx);}
 async connection(s:Scope,userId?:string){
  const link=(await sql<Link>`SELECT verified_at,revoked_at,updated_at,revision FROM server_web_links WHERE ${tenant(s)}`.execute(this.db)).rows[0];
  const pending=userId?(await sql`SELECT id FROM server_verification_challenges WHERE ${tenant(s)} AND issuer_hash=${this.vault.hash(s,userId)} AND expires_at>${new Date(this.clock())} AND used_at IS NULL AND revoked_at IS NULL LIMIT 1`.execute(this.db)).rows.length>0:false;
  return {state:(!link?.revoked_at&&link?'VERIFIED':pending?'VERIFICATION_PENDING':'INSTALLED_NOT_VERIFIED') as VerificationState,version:link?.revision??null};
 }
 async issue(s:Scope,userId:string,source:Actor['source']='DISCORD_PANEL',authorization?:GuildAuthorizationSnapshot){
  const snapshot=authorization??await this.authority.snapshot(s,userId,source,randomUUID());this.authority.require(snapshot);
  const now=new Date(this.clock()),expiresAt=new Date(now.getTime()+600000);
  const issuerKey=this.vault.digest('verification-issuer:v1',userId),code=verificationCode(),id=randomUUID();
  await this.db.transaction().execute(async tx=>{
   await sql`SELECT pg_advisory_xact_lock(hashtextextended(${issuerKey},0))`.execute(tx);
   await this.lock(tx,s);const actor=await this.authority.revalidate(s,userId,snapshot,tx);await ensureGuild(tx,s);
   const window=new Date(now.getTime()-600000);
   const userRows=(await sql<{created_at:Date;guild_id:string}>`SELECT created_at,guild_id FROM server_verification_challenges WHERE issuer_rate_key=${issuerKey} AND created_at>${window}`.execute(tx)).rows;
   const guildCount=(await sql<{count:number}>`SELECT count(*)::integer AS count FROM server_verification_challenges WHERE ${tenant(s)} AND created_at>${window}`.execute(tx)).rows[0]!.count;
   assert(userRows.length<5&&guildCount<10&&!userRows.some(row=>row.guild_id===s.guildId&&now.getTime()-row.created_at.getTime()<30000),'VERIFICATION_RATE_LIMIT',429);
   await sql`UPDATE server_verification_challenges SET revoked_at=${now} WHERE ${tenant(s)} AND issuer_hash=${actor.key} AND used_at IS NULL AND revoked_at IS NULL`.execute(tx);
   await sql`INSERT INTO server_verification_challenges(organization_id,guild_id,id,code_digest,issuer_hash,issuer_rate_key,issuer_identity_ciphertext,created_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${this.vault.digest('verification-code:v1',normalizeVerificationCode(code)!)},${actor.key},${issuerKey},${actor.encryptedUserId!},${now},${expiresAt})`.execute(tx);
   await audit(tx,s,actor,'server_verification.issued',null,{challengeId:id,state:'VERIFICATION_PENDING',expiresAt:expiresAt.toISOString()});
  });
  return {id,code,expiresAt};
 }
 async redeem(userId:string,input:unknown){
  assert(/^\d{17,20}$/.test(userId),'VERIFICATION_INVALID',400);
  const now=new Date(this.clock()),rateKey=this.vault.digest('verification-attempt:v1',userId),normalized=normalizeVerificationCode(input);
  const attempt=await this.db.transaction().execute(async tx=>{
   const limit=(await sql<{attempt_count:number}>`INSERT INTO server_verification_limits(key_digest,window_started_at,attempt_count,updated_at) VALUES(${rateKey},${now},1,${now}) ON CONFLICT(key_digest) DO UPDATE SET attempt_count=CASE WHEN server_verification_limits.window_started_at<=${new Date(now.getTime()-600000)} THEN 1 ELSE server_verification_limits.attempt_count+1 END,window_started_at=CASE WHEN server_verification_limits.window_started_at<=${new Date(now.getTime()-600000)} THEN ${now} ELSE server_verification_limits.window_started_at END,updated_at=${now} RETURNING attempt_count`.execute(tx)).rows[0]!;
   return limit.attempt_count;
  });
  assert(attempt<=10,'VERIFICATION_RATE_LIMIT',429);assert(normalized,'VERIFICATION_INVALID');
  const candidate=(await sql<Challenge>`SELECT * FROM server_verification_challenges WHERE code_digest=${this.vault.digest('verification-code:v1',normalized)}`.execute(this.db)).rows[0];
  assert(candidate,'VERIFICATION_INVALID');
  const s=scopeForGuild(candidate.guild_id);
  assert(s.organizationId===candidate.organization_id&&this.vault.hash(s,userId)===candidate.issuer_hash&&!candidate.used_at&&!candidate.revoked_at&&candidate.expires_at>new Date(this.clock()),'VERIFICATION_INVALID');
  let snapshot:GuildAuthorizationSnapshot|undefined;
  try{snapshot=await this.authority.snapshot(s,userId,'WEB_DASHBOARD',randomUUID());this.authority.require(snapshot);}catch{snapshot=undefined;}
  const result=await this.db.transaction().execute(async tx=>{
   await this.lock(tx,s);
   const challenge=(await sql<Challenge>`SELECT * FROM server_verification_challenges WHERE ${tenant(s)} AND id=${candidate.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
   if(!challenge||challenge.used_at||challenge.revoked_at||challenge.expires_at<=new Date(this.clock()))return {error:'VERIFICATION_INVALID'} as const;
   await sql`UPDATE server_verification_challenges SET attempt_count=attempt_count+1,last_attempt_at=${now} WHERE ${tenant(s)} AND id=${challenge.id}::uuid`.execute(tx);
   let actor:Actor;
   try{assert(snapshot,'VERIFICATION_INVALID');actor=await this.authority.revalidate(s,userId,snapshot,tx);}
   catch{
    if(challenge.attempt_count+1>=8)await sql`UPDATE server_verification_challenges SET revoked_at=${now} WHERE ${tenant(s)} AND id=${challenge.id}::uuid`.execute(tx);
    // One event for the blocked challenge, without recording individual guesses.
    if(challenge.attempt_count===0)await audit(tx,s,{key:challenge.issuer_hash,permissions:'0',roles:[],source:'WEB_DASHBOARD',requestId:randomUUID()},'server_verification.failed',null,{challengeId:challenge.id,state:'REJECTED'});
    return {error:'VERIFICATION_INVALID'} as const;
   }
   if(challenge.expires_at<=new Date(this.clock()))return {error:'VERIFICATION_INVALID'} as const;
   await sql`UPDATE server_verification_challenges SET used_at=${now} WHERE ${tenant(s)} AND id=${challenge.id}::uuid`.execute(tx);
   await sql`INSERT INTO server_web_links(organization_id,guild_id,verified_at,verified_by_hash,verified_by_identity_ciphertext,updated_at,revision) VALUES(${s.organizationId}::uuid,${s.guildId},${now},${actor.key},${actor.encryptedUserId!},${now},${randomUUID()}::uuid) ON CONFLICT(organization_id,guild_id) DO UPDATE SET verified_at=EXCLUDED.verified_at,verified_by_hash=EXCLUDED.verified_by_hash,verified_by_identity_ciphertext=EXCLUDED.verified_by_identity_ciphertext,revoked_at=NULL,updated_at=EXCLUDED.updated_at,revision=EXCLUDED.revision`.execute(tx);
   await audit(tx,s,actor,'server_verification.completed',null,{challengeId:challenge.id,state:'VERIFIED'});
   return {guildId:s.guildId} as const;
  });
  assert(!('error' in result),'VERIFICATION_INVALID',400);
  return result as {guildId:string};
 }
 async revokeChallenge(s:Scope,id:string){await sql`UPDATE server_verification_challenges SET revoked_at=${new Date(this.clock())} WHERE ${tenant(s)} AND id=${id}::uuid AND used_at IS NULL`.execute(this.db);}
 async disconnect(s:Scope,userId:string,version:string|null,source:Actor['source']='WEB_DASHBOARD',authorization?:GuildAuthorizationSnapshot){
  const snapshot=authorization??await this.authority.snapshot(s,userId,source,randomUUID());this.authority.require(snapshot);
  const now=new Date(this.clock());
  await this.db.transaction().execute(async tx=>{
   await this.lock(tx,s);
   const actor=await this.authority.revalidate(s,userId,snapshot,tx);
   const link=(await sql<Link>`SELECT verified_at,revoked_at,updated_at,revision FROM server_web_links WHERE ${tenant(s)} FOR UPDATE`.execute(tx)).rows[0];
   assert((link?.revision??null)===version,'REVISION_CONFLICT',409);
   await sql`UPDATE server_web_links SET revoked_at=${now},updated_at=${now},revision=${randomUUID()}::uuid WHERE ${tenant(s)}`.execute(tx);
   await sql`UPDATE server_verification_challenges SET revoked_at=${now} WHERE ${tenant(s)} AND used_at IS NULL AND revoked_at IS NULL`.execute(tx);
   await audit(tx,s,actor,'server_verification.revoked',null,{state:'INSTALLED_NOT_VERIFIED'});
  });
 }
}
