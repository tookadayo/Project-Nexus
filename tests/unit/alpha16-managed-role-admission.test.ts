import {describe,it,expect} from 'vitest';
import type {Actor} from '../../packages/settings/src/index';
import {ManagedRoleRequestAuthority,assertManagedRoleCurrentProof,assertManagedRoleRequestProof,managedRoleAdmissionHash,type ManagedRoleAdmissionAdapter,type ManagedRoleAdmissionBinding,type ManagedRoleCurrentProof} from '../../packages/automation/src/managed-role-admission';

const scope={organizationId:'00000000-0000-4000-8000-000000000075',guildId:'123456789012345678'};
const actor:Actor={key:'fixture-actor',permissions:'0',roles:[],source:'WEB_DASHBOARD',requestId:'fixture'};
const binding:ManagedRoleAdmissionBinding={phase:'START',admissionRevision:'fixture-v1',policyId:'managed_role_'+'a'.repeat(32),policyRevision:1,semanticHash:'b'.repeat(64),activeRevision:1,generation:1,state:'ACTIVE',roleId:'123456789012345679',operation:'discord.addRole',memberId:'123456789012345680',requestId:'00000000-0000-4000-8000-000000000076'};
const at=new Date('2026-10-16T12:00:00Z'),expiry=new Date('2026-10-16T12:00:01Z');
function proof():ManagedRoleCurrentProof{return {scope,actorHash:actor.key,bindingHash:managedRoleAdmissionHash(scope,actor,binding),expiresAt:expiry,currentlyAuthorized:true,allowRoleVerified:true,nativeRolePolicyVerified:true,nativeApprovalPipelineVerified:true,runtimeWriterCompatible:true,independentRetentionEnforcementReady:true,memberVerified:true};}

describe('Managed Role trusted native admission (unexecuted source fixtures)',()=>{
 it('binds a communication wire to scope, actor, fixed policy/role/op/member and request',async()=>{
  // Synthetic fixture key only; no application key/configuration is generated.
  const signer=new ManagedRoleRequestAuthority('fixture-only-key-'.repeat(4)),wire=await signer.issueRequest(scope,actor,binding,at,expiry);
  expect((await signer.verifyRequest(scope,actor,binding,wire)).bindingHash).toBe(managedRoleAdmissionHash(scope,actor,binding));
  for(const changed of [{...binding,memberId:'123456789012345699'},{...binding,operation:'discord.removeRole' as const},{...binding,generation:2}])await expect(signer.verifyRequest(scope,actor,changed,wire)).rejects.toThrow('MANAGED_ROLE_ADMISSION_BINDING_MISMATCH');
  await expect(signer.verifyRequest({...scope,guildId:'123456789012345698'},actor,binding,wire)).rejects.toThrow('MANAGED_ROLE_ADMISSION_BINDING_MISMATCH');
  await expect(signer.verifyRequest(scope,{...actor,key:'different'},binding,wire)).rejects.toThrow('MANAGED_ROLE_ADMISSION_BINDING_MISMATCH');
 });
 it('rejects expired original wire after receipt erasure without promoting it to a new UUID operation',async()=>{
  const signer=new ManagedRoleRequestAuthority('fixture-only-key-'.repeat(4)),wire=await signer.issueRequest(scope,actor,binding,at,expiry);
  // This pure expiry check deliberately has no receipt database. Lost/purged
  // communication records cannot make the original signed expiry disappear.
  const adapter={verifyRequest:signer.verifyRequest.bind(signer)} as ManagedRoleAdmissionAdapter;
  await expect(assertManagedRoleRequestProof(scope,actor,binding,adapter,proof(),wire,new Date(expiry.getTime()+1))).rejects.toThrow('MANAGED_ROLE_REQUEST_EXPIRED_OR_MISMATCH');
 });
 it('requires current member/native policy/worker compatibility and rejects cross-body/expired proof',()=>{
  expect(()=>assertManagedRoleCurrentProof(scope,actor,binding,proof(),at)).not.toThrow();
  expect(()=>assertManagedRoleCurrentProof(scope,actor,binding,{...proof(),memberVerified:false},at)).toThrow('MANAGED_ROLE_G3_NOT_READY');
  expect(()=>assertManagedRoleCurrentProof(scope,actor,{...binding,roleId:'123456789012345699'},proof(),at)).toThrow('MANAGED_ROLE_ADMISSION_BINDING_MISMATCH');
  expect(()=>assertManagedRoleCurrentProof(scope,actor,binding,proof(),expiry)).toThrow('MANAGED_ROLE_ADMISSION_EXPIRED');
 });
});
