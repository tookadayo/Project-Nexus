import {createCipheriv,createDecipheriv,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {sql,tenant,type Tx} from '../../db/src/index.js';
import {scopeSchema,assert,type Scope} from '../../shared/src/index.js';
export class IdentityVault {
 constructor(private readonly encryptionKey:string,private readonly lookupKey:string){
  for(const key of [encryptionKey,lookupKey]) if(!/^[a-f\d]{64}$/i.test(key)) throw new Error('Invalid vault key');
 }
 hash(s:Scope,userId:string){scopeSchema.parse(s);return createHmac('sha256',Buffer.from(this.lookupKey,'hex')).update(`${s.organizationId}:${s.guildId}:${userId}`).digest('hex');}
 seal(s:Scope,value:string){
  const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',Buffer.from(this.encryptionKey,'hex'),iv);
  cipher.setAAD(Buffer.from(`${s.organizationId}:${s.guildId}`));
  const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');
 }
 open(s:Scope,value:string){
  const data=Buffer.from(value,'base64url');const decipher=createDecipheriv('aes-256-gcm',Buffer.from(this.encryptionKey,'hex'),data.subarray(0,12));
  decipher.setAAD(Buffer.from(`${s.organizationId}:${s.guildId}`));decipher.setAuthTag(data.subarray(12,28));
  return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');
 }
 async resolve(tx:Tx,s:Scope,userId:string){
  if(!/^\d{17,20}$/.test(userId)) throw new Error('Invalid Discord identity');
  const hash=this.hash(s,userId);
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.guildId+hash},0))`.execute(tx);
  assert(!(await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash=${hash}`.execute(tx)).rows.length,'PRIVACY_OPT_OUT');
  await sql`INSERT INTO member_identity_map(organization_id,guild_id,id,lookup_hash,encrypted_id)
   VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${hash},${this.seal(s,userId)}) ON CONFLICT DO NOTHING`.execute(tx);
  const {rows}=await sql<{id:string}>`SELECT id FROM member_identity_map WHERE ${tenant(s)} AND lookup_hash=${hash}`.execute(tx);
  return rows[0]!.id;
 }
 async forAction(tx:Tx,s:Scope,identityId:string){
  const {rows}=await sql<{encrypted_id:string}>`SELECT encrypted_id FROM member_identity_map WHERE ${tenant(s)} AND id=${identityId}::uuid`.execute(tx);
  if(!rows[0]) throw new Error('Identity unavailable');
  return this.open(s,rows[0].encrypted_id);
 }
}
