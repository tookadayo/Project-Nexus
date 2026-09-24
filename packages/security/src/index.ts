import {createHmac,createPublicKey,verify,timingSafeEqual,randomUUID} from 'node:crypto';
import {PermissionFlagsBits} from 'discord-api-types/v10';
import {sql,tenant,json,type Tx} from '../../db/src/index.js';
import {assert,type Scope} from '../../shared/src/index.js';
export {scopeForGuild,apiToken,validApiToken} from './scoping.js';
export function verifyInteraction(publicKey:string,signature:string,timestamp:string,body:Buffer,now=Date.now()){
 if(!/^[a-f\d]{128}$/i.test(signature)||!/^\d{10}$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>300000) return false;
 try{
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(publicKey,'hex')]),format:'der',type:'spki'});
  return verify(null,Buffer.concat([Buffer.from(timestamp),body]),key,Buffer.from(signature,'hex'));
 }catch{return false;}
}
export function canAdmin(permissions:string,roles:string[],adminRole:string|null){
 const bits=BigInt(permissions);
 return (bits&PermissionFlagsBits.ManageGuild)!==0n || (bits&PermissionFlagsBits.Administrator)!==0n || (adminRole!==null&&roles.includes(adminRole));
}
export class Components {
 constructor(private readonly key:string){}
 private mac(id:string){return createHmac('sha256',this.key).update(id).digest('base64url').slice(0,22);}
 async issue(tx:Tx,s:Scope,intent:Record<string,unknown>,actorHash:string|null=null,ttl=900){
  const id=randomUUID();
  await sql`INSERT INTO component_tokens(organization_id,guild_id,id,actor_hash,intent,expires_at)
    VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${actorHash},${json(intent)},${new Date(Date.now()+ttl*1000)})`.execute(tx);
  return `${id}.${this.mac(id)}`;
 }
 async read(tx:Tx,s:Scope,token:string,actorHash:string){
  const [id,mac]=token.split('.');assert(id&&mac&&/^[a-f\d-]{36}$/.test(id),'INVALID_COMPONENT');
  const expected=Buffer.from(this.mac(id));const supplied=Buffer.from(mac);
  assert(supplied.length===expected.length&&timingSafeEqual(supplied,expected),'INVALID_COMPONENT');
  const {rows}=await sql<{actor_hash:string|null,intent:Record<string,unknown>}>`SELECT actor_hash,intent FROM component_tokens
   WHERE ${tenant(s)} AND id=${id}::uuid AND expires_at>now()`.execute(tx);
  const row=rows[0];assert(row,'COMPONENT_EXPIRED');assert(row.actor_hash===null||row.actor_hash===actorHash,'COMPONENT_OWNER',403);
  return row.intent;
 }
}
