import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {sql,tenant,type Tx} from '../../db/src/index';
import {assert,type Scope} from '../../shared/src/index';
import type {Actor} from '../../settings/src/index';
import type {IndependentSafetyAuthority} from '../../security/src/alpha16-safety-state';
import {fingerprint,RETENTION_MILLISECONDS} from './store';

export interface ManagedRoleAdmissionBinding {
 phase:'ENABLE'|'START';admissionRevision:string;policyId:string;policyRevision:number;semanticHash:string;
 activeRevision:number|null;generation:number;state:string;roleId:string;
 operation:'discord.addRole'|'discord.removeRole';memberId:string|null;requestId:string|null;
}
export interface ManagedRoleCurrentProof {
 scope:Scope;actorHash:string;bindingHash:string;expiresAt:Date;
 currentlyAuthorized:true;allowRoleVerified:true;nativeRolePolicyVerified:true;
 nativeApprovalPipelineVerified:true;runtimeWriterCompatible:true;
 independentRetentionEnforcementReady:true;memberVerified:boolean;
}
/** Installed only by the server composition root. Browser JSON never supplies
 * profiles, native proofs, signing keys or safety authority. prepare may read
 * existing native observations; recheck is transaction-local and has no external
 * effects. No profile is installed by this module.
 *
 * issue/verify must sign the complete binding hash, original issuedAt and expiry
 * using the existing deployment's trusted key authority. The original expiry
 * must survive receipt purge/restore; an expired wire can never become a fresh
 * UUID operation. These are communication proofs, not operation tokens.
 *
 * runtimeWriterCompatible certifies the actual worker's current safety recheck,
 * one-use independent send fence and native role policy/approval/UNKNOWN path.
 * A read-only safety provider alone cannot satisfy this adapter contract. */
export interface ManagedRoleAdmissionAdapter {
 revision:string;safetyAuthority:IndependentSafetyAuthority;
 prepare(s:Scope,actor:Actor,binding:ManagedRoleAdmissionBinding):Promise<ManagedRoleCurrentProof>;
 recheck(tx:Tx,s:Scope,actor:Actor,binding:ManagedRoleAdmissionBinding,proof:ManagedRoleCurrentProof):Promise<void>;
 issueRequest(s:Scope,actor:Actor,binding:ManagedRoleAdmissionBinding,issuedAt:Date,expiresAt:Date):Promise<string>;
 verifyRequest(s:Scope,actor:Actor,binding:ManagedRoleAdmissionBinding,wire:string):Promise<{bindingHash:string;issuedAt:Date;expiresAt:Date}>;
}
export function managedRoleAdmissionHash(s:Scope,actor:Actor,binding:ManagedRoleAdmissionBinding){return fingerprint({purpose:'managed-role-native-request.v1',scope:s,actorHash:actor.key,binding});}
const requestWireClaims=z.object({purpose:z.literal('MANAGED_ROLE_NATIVE_REQUEST'),bindingHash:z.string().regex(/^[a-f0-9]{64}$/),issuedAt:z.iso.datetime(),expiresAt:z.iso.datetime()}).strict();
/** Optional server implementation of the communication signer. The caller
 * supplies its existing durable deployment key; no key is generated or read
 * from configuration here. Neither wire nor claims need a new history table. */
export class ManagedRoleRequestAuthority{
 constructor(private readonly key:string){assert(Buffer.byteLength(key)>=32,'MANAGED_ROLE_SIGNING_KEY_UNAVAILABLE',503);}
 private signature(payload:string){return createHmac('sha256',this.key).update('nexus-managed-role-request.v1\0'+payload).digest();}
 async issueRequest(s:Scope,actor:Actor,binding:ManagedRoleAdmissionBinding,issuedAt:Date,expiresAt:Date){
  assert(Number.isFinite(issuedAt.getTime())&&Number.isFinite(expiresAt.getTime())&&expiresAt>issuedAt&&expiresAt.getTime()<=issuedAt.getTime()+RETENTION_MILLISECONDS,'MANAGED_ROLE_REQUEST_EXPIRY_INVALID',409);
  const payload=Buffer.from(JSON.stringify(requestWireClaims.parse({purpose:'MANAGED_ROLE_NATIVE_REQUEST',bindingHash:managedRoleAdmissionHash(s,actor,binding),issuedAt:issuedAt.toISOString(),expiresAt:expiresAt.toISOString()}))).toString('base64url');
  return 'nexus_mr1.'+payload+'.'+this.signature(payload).toString('base64url');
 }
 async verifyRequest(s:Scope,actor:Actor,binding:ManagedRoleAdmissionBinding,wire:string){
  assert(wire.length<=4096,'MANAGED_ROLE_REQUEST_INVALID',410);
  const parts=wire.split('.'),payload=parts[1]??'',signature=parts[2]??'';
  assert(parts.length===3&&parts[0]==='nexus_mr1'&&/^[A-Za-z0-9_-]+$/.test(payload)&&/^[A-Za-z0-9_-]{43}$/.test(signature),'MANAGED_ROLE_REQUEST_INVALID',410);
  const received=Buffer.from(signature,'base64url'),expected=this.signature(payload);
  assert(received.length===expected.length&&timingSafeEqual(received,expected),'MANAGED_ROLE_REQUEST_INVALID',410);
  let decoded:unknown;try{decoded=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));}catch{assert(false,'MANAGED_ROLE_REQUEST_INVALID',410);}
  const parsed=requestWireClaims.safeParse(decoded);assert(parsed.success,'MANAGED_ROLE_REQUEST_INVALID',410);
  assert(parsed.data.bindingHash===managedRoleAdmissionHash(s,actor,binding),'MANAGED_ROLE_ADMISSION_BINDING_MISMATCH',403);
  return {bindingHash:parsed.data.bindingHash,issuedAt:new Date(parsed.data.issuedAt),expiresAt:new Date(parsed.data.expiresAt)};
 }
}
export function assertManagedRoleCurrentProof(s:Scope,actor:Actor,binding:ManagedRoleAdmissionBinding,proof:ManagedRoleCurrentProof,now:Date){
 assert(proof.scope.organizationId===s.organizationId&&proof.scope.guildId===s.guildId&&proof.actorHash===actor.key&&proof.bindingHash===managedRoleAdmissionHash(s,actor,binding),'MANAGED_ROLE_ADMISSION_BINDING_MISMATCH',403);
 assert(proof.expiresAt instanceof Date&&Number.isFinite(proof.expiresAt.getTime())&&proof.expiresAt>now,'MANAGED_ROLE_ADMISSION_EXPIRED',409);
 assert(proof.currentlyAuthorized===true&&proof.allowRoleVerified===true&&proof.nativeRolePolicyVerified===true&&proof.nativeApprovalPipelineVerified===true&&proof.runtimeWriterCompatible===true&&proof.independentRetentionEnforcementReady===true&&(!binding.memberId||proof.memberVerified===true),'MANAGED_ROLE_G3_NOT_READY',409);
}
export async function assertManagedRoleRequestProof(s:Scope,actor:Actor,binding:ManagedRoleAdmissionBinding,adapter:ManagedRoleAdmissionAdapter,proof:ManagedRoleCurrentProof,wire:string,now:Date){
 const signed=await adapter.verifyRequest(s,actor,binding,wire);
 assert(signed.bindingHash===managedRoleAdmissionHash(s,actor,binding)&&signed.issuedAt instanceof Date&&signed.expiresAt instanceof Date&&Number.isFinite(signed.issuedAt.getTime())&&Number.isFinite(signed.expiresAt.getTime())&&signed.issuedAt<=now&&signed.expiresAt>now&&signed.expiresAt.getTime()<=signed.issuedAt.getTime()+RETENTION_MILLISECONDS&&signed.expiresAt<=proof.expiresAt,'MANAGED_ROLE_REQUEST_EXPIRED_OR_MISMATCH',410);
}
export async function recheckManagedRoleAdmission(tx:Tx,s:Scope,actor:Actor,binding:ManagedRoleAdmissionBinding,adapter:ManagedRoleAdmissionAdapter,proof:ManagedRoleCurrentProof,wire?:string){
 assert(tx.isTransaction,'TRANSACTION_REQUIRED',500);
 const now=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
 assertManagedRoleCurrentProof(s,actor,binding,proof,now);
 assert(binding.admissionRevision===adapter.revision,'MANAGED_ROLE_ADMISSION_BINDING_MISMATCH',409);
 assert(adapter.safetyAuthority.externalTargetReadiness().enabled,'MANAGED_ROLE_G3_NOT_READY',409);
 await adapter.recheck(tx,s,actor,binding,proof);
 await adapter.safetyAuthority.assertTarget(tx,s,'AUTOMATION_FLOW',binding.policyId,now);
 const root=(await sql<{live_version:string}>`SELECT live_version FROM rule_target_safety WHERE ${tenant(s)} AND target_type='AUTOMATION_FLOW' AND target_id=${binding.policyId}`.execute(tx)).rows[0];
 assert(root?.live_version===`${binding.policyRevision}:${binding.activeRevision??'none'}:${binding.generation}:${binding.state}`,'MANAGED_ROLE_TARGET_VERSION_MISMATCH',409);
 assert(!(await sql`SELECT 1 FROM automation_runs r WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.flow_id=${binding.policyId} AND (r.status='UNKNOWN' OR EXISTS(SELECT 1 FROM automation_operations o WHERE o.organization_id=r.organization_id AND o.guild_id=r.guild_id AND o.run_id=r.id AND o.state IN ('STARTED','UNKNOWN'))) LIMIT 1`.execute(tx)).rows.length,'MANAGED_ROLE_RESULT_UNRESOLVED',409);
 if(wire!==undefined)await assertManagedRoleRequestProof(s,actor,binding,adapter,proof,wire,now);
}
