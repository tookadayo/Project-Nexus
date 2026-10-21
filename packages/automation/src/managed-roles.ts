import { z } from "zod";
import { sql, tenant, type Tx } from "../../db/src/index";
import { assert, isDomainError, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import { operationsAccess } from "../../operations/src/policy";
import { assertMaintenanceAuthorization, type MaintenanceAuthorizationProof } from "../../operations/src/maintenance-authorization";
import { acquireRuleScopeLocks, ruleScopeLockSet } from "../../rules/src/locks";
import { AutomationService } from "./service";
import { automationLock } from "./quota";
import { fingerprint,RETENTION_MILLISECONDS } from "./store";
import type { FlowDefinition } from "./types";
import {assertManagedRoleCurrentProof,assertManagedRoleRequestProof,recheckManagedRoleAdmission,type ManagedRoleAdmissionAdapter,type ManagedRoleAdmissionBinding,type ManagedRoleCurrentProof} from './managed-role-admission';

export const managedRolePolicyId = z.string().regex(/^managed_role_[a-f0-9]{32}$/);
const version = z.number().int().nonnegative().max(2147483647), snowflake = z.string().regex(/^\d{17,20}$/);
export const managedRolePolicySpec = z.object({ name: z.string().trim().min(1).max(160), roleId: snowflake,
  operation: z.enum(["GRANT", "REVOKE"]) }).strict();
export const managedRolePolicyBase = z.object({ expectedRevision: version, expectedActiveRevision: version.positive().nullable(),
  expectedGeneration: version, requestId: z.uuid() }).strict();
export const managedRolePolicySave = managedRolePolicyBase.extend({ policy: managedRolePolicySpec }).strict();
const requestProof=z.string().min(1).max(4096);
export const managedRoleRunInput = z.object({ policyRevision: version.positive(), semanticHash: z.string().regex(/^[a-f0-9]{64}$/), memberId: snowflake, requestId: z.uuid(),requestProof:requestProof.optional() }).strict();
export const managedRoleEnableInput=managedRolePolicyBase.extend({semanticHash:z.string().regex(/^[a-f0-9]{64}$/),requestProof:requestProof.optional()}).strict();
export const managedRoleCheckInput = z.object({ revision: version.positive(), kind: z.enum(["VALIDATE", "TEST", "IMPACT"]),
  simulation: z.object({ memberId: snowflake, outcome: z.enum(["SUCCEEDED", "FAILED", "NOT_STARTED", "UNKNOWN"]) }).strict().optional() }).strict();
export type ManagedRolePolicySpec = z.infer<typeof managedRolePolicySpec>;
type Base = z.infer<typeof managedRolePolicyBase>;
type PolicyRow = { id: string; draft_revision: number; active_revision: number | null; generation: number;
  state: string; definition: FlowDefinition; semantic_hash: string; active_definition: FlowDefinition | null };
export interface ManagedRolePolicyDto {
  id: string; policyVersion: number; activeRevision: number | null; generation: number; state: string;
  policy: ManagedRolePolicySpec; semanticHash: string;
  activePolicy: (ManagedRolePolicySpec & { revision: number }) | null;
  activationAvailable: boolean; directMutationAvailable: boolean; reasonCode: string|null;
}
export interface ManagedRoleRunDescriptor {
  kind: "EXISTING_AUTOMATION_RUN"; policyId: string; policyRevision: number; semanticHash: string;
  operation: "discord.addRole" | "discord.removeRole"; roleId: string; requestId: string;
  values: { managed_member: { type: "MemberRef"; value: { id: string; guildId: string }; provenance: {source:"input";guildId:string;resumable:true}[] } };
  approvalRequired: true; directMutationAvailable: boolean; reasonCode: string|null;
  requestProof?:string;requestProofExpiresAt?:string;
}

/** One policy is one finite, ordinary manual Flow. No new Run kind, authority,
 * generic code, role wildcard, subject list, schedule, loop or storage class. */
export function managedRoleFlow(s: Scope, id: string, input: ManagedRolePolicySpec): FlowDefinition {
  managedRolePolicyId.parse(id); const policy = managedRolePolicySpec.parse(input);
  return { schemaVersion: 1, id, guildId: s.guildId, name: policy.name,
    trigger: { kind: "manual", inputs: [{ id: "managed_member", name: "Member", type: "MemberRef" }] }, variables: [],
    targets: { channelIds: [], roleIds: [policy.roleId], parentCategoryIds: [] },
    body: [{ kind: "action", id: "managed_role_action", operation: policy.operation === "GRANT" ? "discord.addRole" : "discord.removeRole",
      approvalRequired: true, inputs: { member: { kind: "variable", type: "MemberRef", variableId: "managed_member" },
        role: { kind: "literal", type: "RoleRef", value: { id: policy.roleId, guildId: s.guildId } } } }] };
}
export function managedRoleSpec(s: Scope, definition: FlowDefinition): ManagedRolePolicySpec | null {
  if (!managedRolePolicyId.safeParse(definition.id).success || definition.guildId !== s.guildId) return null;
  const action = definition.body?.[0], roleId = definition.targets?.roleIds?.[0];
  if (action?.kind !== "action" || !roleId || !["discord.addRole", "discord.removeRole"].includes(action.operation)) return null;
  const spec = managedRolePolicySpec.safeParse({ name: definition.name, roleId, operation: action.operation === "discord.addRole" ? "GRANT" : "REVOKE" });
  if (!spec.success) return null;
  // UI positions can change without granting a new policy capability.
  const body = { ...definition }; delete body.ui;
  return fingerprint(body) === fingerprint(managedRoleFlow(s, definition.id, spec.data)) ? spec.data : null;
}
export function bindManagedRoleRun(s: Scope, policy: ManagedRolePolicyDto, input: z.infer<typeof managedRoleRunInput>): ManagedRoleRunDescriptor {
  const data = managedRoleRunInput.parse(input);
  assert(policy.activeRevision === data.policyRevision && policy.activePolicy?.revision === data.policyRevision
    && policy.policyVersion === data.policyRevision && policy.semanticHash === data.semanticHash && policy.state === "ACTIVE", "MANAGED_ROLE_POLICY_CHANGED", 409);
  return { kind: "EXISTING_AUTOMATION_RUN", policyId: policy.id, policyRevision: data.policyRevision, semanticHash: data.semanticHash,
    operation: policy.policy.operation === "GRANT" ? "discord.addRole" : "discord.removeRole", roleId: policy.policy.roleId, requestId: data.requestId,
    values: { managed_member: { type: "MemberRef", value: { id: data.memberId, guildId: s.guildId }, provenance:[{source:"input",guildId:s.guildId,resumable:true}] } },
    approvalRequired: true, directMutationAvailable: policy.directMutationAvailable, reasonCode: policy.directMutationAvailable?null:policy.reasonCode??"MANAGED_ROLE_G3_NOT_READY" };
}

/** Persistence and request receipts are the existing immutable Flow revision
 * and automation_requests records. Dedicated tables/retention are unnecessary. */
export class ManagedRolePolicies {
  constructor(private readonly service: AutomationService, private readonly proof: MaintenanceAuthorizationProof,private readonly admission?:ManagedRoleAdmissionAdapter) {}
  private async access(tx: Tx, s: Scope, actor: Actor) {
    await (this.service.options.authorize ? this.service.options.authorize(tx, s, actor, "CONFIGURE") : operationsAccess(tx, s, actor, "CONFIGURE"));
    const now = (await sql<{ now: Date }>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
    assertMaintenanceAuthorization(this.proof, s, actor, now);
    assert(!(await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND (lookup_hash IS NULL OR lookup_hash=${actor.key}) LIMIT 1`.execute(tx)).rows.length, "RESOURCE_DELETED", 410);
  }
  private async row(tx: Tx, s: Scope, id: string) {
    managedRolePolicyId.parse(id);
    return (await sql<PolicyRow>`SELECT f.id,f.draft_revision,f.active_revision,f.generation,f.state,r.definition,r.semantic_hash,a.definition AS active_definition
      FROM automation_flows f JOIN automation_revisions r ON r.organization_id=f.organization_id AND r.guild_id=f.guild_id AND r.flow_id=f.id AND r.revision=f.draft_revision
      LEFT JOIN automation_revisions a ON a.organization_id=f.organization_id AND a.guild_id=f.guild_id AND a.flow_id=f.id AND a.revision=f.active_revision
      WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.id=${id} AND f.state<>'DELETED'`.execute(tx)).rows[0];
  }
  private dto(s: Scope, row: PolicyRow): ManagedRolePolicyDto {
    const policy = managedRoleSpec(s, row.definition); assert(policy, "MANAGED_ROLE_POLICY_SHAPE_CHANGED", 409);
    const active = row.active_definition ? managedRoleSpec(s, row.active_definition) : null;
    return { id: row.id, policyVersion: row.draft_revision, activeRevision: row.active_revision, generation: row.generation,
      state: row.state, policy, semanticHash: row.semantic_hash, activePolicy: active && row.active_revision ? { ...active, revision: row.active_revision } : null,
      activationAvailable: false, directMutationAvailable: false, reasonCode: "MANAGED_ROLE_G3_NOT_READY" };
  }
  private binding(current:ManagedRolePolicyDto,phase:ManagedRoleAdmissionBinding['phase'],requestId:string|null,memberId:string|null=null):ManagedRoleAdmissionBinding{
    return {phase,admissionRevision:this.admission?.revision??'unconfigured',policyId:current.id,policyRevision:current.policyVersion,semanticHash:current.semanticHash,activeRevision:current.activeRevision,generation:current.generation,state:current.state,roleId:current.policy.roleId,
      operation:current.policy.operation==='GRANT'?'discord.addRole':'discord.removeRole',memberId,requestId};
  }
  private async prepareAdmission(s:Scope,actor:Actor,binding:ManagedRoleAdmissionBinding){
    const adapter=this.admission;assert(adapter&&/^[A-Za-z0-9_.:-]{1,128}$/.test(adapter.revision)&&adapter.safetyAuthority.externalTargetReadiness().enabled,'MANAGED_ROLE_G3_NOT_READY',409);
    assert(this.service.options.adoptedActions?.has(binding.operation)&&this.service.options.approvalPolicy&&this.service.limits.measurementId&&this.service.limits.activeFlows>0&&this.service.limits.monthlyRuns>0&&this.service.limits.guildConcurrent>0&&this.service.limits.globalConcurrent>0,'MANAGED_ROLE_NATIVE_RUNTIME_UNAVAILABLE',409);
    // Independent/native observations are prepared before the PG transaction;
    // no Discord or other external call is made by the final write callback.
    await adapter.safetyAuthority.observe('TARGET_LIVE_SAFETY',s);
    const proof=await adapter.prepare(s,actor,binding),now=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(this.service.db)).rows[0]!.now;
    assertManagedRoleCurrentProof(s,actor,binding,proof,now);return {adapter,proof};
  }
  private async finalAdmission(tx:Tx,s:Scope,actor:Actor,binding:ManagedRoleAdmissionBinding,prepared:{adapter:ManagedRoleAdmissionAdapter;proof:ManagedRoleCurrentProof},wire?:string){
    await this.access(tx,s,actor);await recheckManagedRoleAdmission(tx,s,actor,binding,prepared.adapter,prepared.proof,wire);
  }
  private async receiptAccess(tx:Tx,s:Scope,actor:Actor,binding:ManagedRoleAdmissionBinding,prepared:{adapter:ManagedRoleAdmissionAdapter;proof:ManagedRoleCurrentProof},wire:string){
    await this.access(tx,s,actor);
    const now=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
    assertManagedRoleCurrentProof(s,actor,binding,prepared.proof,now);
    assert(binding.admissionRevision===prepared.adapter.revision,'MANAGED_ROLE_ADMISSION_BINDING_MISMATCH',409);
    await assertManagedRoleRequestProof(s,actor,binding,prepared.adapter,prepared.proof,wire,now);
    await prepared.adapter.safetyAuthority.assertTarget(tx,s,'AUTOMATION_FLOW',binding.policyId,now);
  }
  private requestExpiry(s:Scope,prepared:{adapter:ManagedRoleAdmissionAdapter;proof:ManagedRoleCurrentProof},issuedAt:Date){
    const safety=prepared.adapter.safetyAuthority.require('TARGET_LIVE_SAFETY',s,undefined,issuedAt);
    return new Date(Math.min(prepared.proof.expiresAt.getTime(),this.proof.expiresAt.getTime(),Date.parse(safety.expiresAt),issuedAt.getTime()+RETENTION_MILLISECONDS));
  }
  private async capabilities(s:Scope,actor:Actor,current:ManagedRolePolicyDto):Promise<ManagedRolePolicyDto>{
    if(!this.admission)return current;
    try{
      const binding=this.binding(current,'ENABLE',null),prepared=await this.prepareAdmission(s,actor,binding);
      const reviewed=await this.service.db.transaction().execute(async tx=>{
        await acquireRuleScopeLocks(tx,ruleScopeLockSet(s,{subjectHashes:[actor.key]}));await this.access(tx,s,actor);await automationLock(tx,s);
        await this.finalAdmission(tx,s,actor,binding,prepared);
        const latest=await this.row(tx,s,current.id);assert(latest&&latest.draft_revision===current.policyVersion&&latest.active_revision===current.activeRevision&&latest.generation===current.generation&&latest.semantic_hash===current.semanticHash&&latest.state===current.state,'AUTOMATION_REVISION_CONFLICT',409);
        const checks=(await sql<{kind:string}>`SELECT kind FROM automation_checks WHERE ${tenant(s)} AND flow_id=${current.id} AND revision=${current.policyVersion} AND semantic_hash=${current.semanticHash}`.execute(tx)).rows;
        return ['VALIDATE','TEST','IMPACT'].every(kind=>checks.some(row=>row.kind===kind));
      });
      const direct=current.state==='ACTIVE'&&current.activeRevision===current.policyVersion&&current.activePolicy?.revision===current.policyVersion;
      return {...current,activationAvailable:reviewed,directMutationAvailable:direct,reasonCode:reviewed||direct?null:'MANAGED_ROLE_NATIVE_REVIEW_REQUIRED'};
    }catch(error){return {...current,activationAvailable:false,directMutationAvailable:false,reasonCode:isDomainError(error)?error.code:'MANAGED_ROLE_G3_NOT_READY'};}
  }
  async list(s: Scope, actor: Actor) {
    await this.access(this.service.db, s, actor);
    const ids = (await sql<{ id: string }>`SELECT id FROM automation_flows WHERE ${tenant(s)} AND id~'^managed_role_[a-f0-9]{32}$' AND state<>'DELETED' ORDER BY updated_at DESC,id LIMIT 200`.execute(this.service.db)).rows;
    const items: ManagedRolePolicyDto[] = [], incompatible: { id: string; reasonCode: string }[] = [];
    for (const { id } of ids) { const row = await this.row(this.service.db, s, id); if (!row) continue;
      if (!managedRoleSpec(s, row.definition)) incompatible.push({ id, reasonCode: "MANAGED_ROLE_POLICY_SHAPE_CHANGED" }); else items.push(await this.capabilities(s,actor,this.dto(s, row))); }
    return { mode: "EXISTING_FLOW_POLICY" as const, items, incompatible, directMutationAvailable:items.some(item=>item.directMutationAvailable),
      reasonCode:items.some(item=>item.directMutationAvailable)?null:"MANAGED_ROLE_G3_NOT_READY", independentPolicyStore: false as const };
  }
  async detail(s: Scope, actor: Actor, id: string) {
    await this.access(this.service.db, s, actor); const row = await this.row(this.service.db, s, id);
    assert(row, "MANAGED_ROLE_POLICY_NOT_FOUND", 404); return this.capabilities(s,actor,this.dto(s, row));
  }
  async history(s: Scope, actor: Actor) {
    await this.access(this.service.db, s, actor);
    const rows = (await sql<{ flow_id: string; run_id: string; revision: number; operation: string; state: string; started_at: Date; finished_at: Date | null }>`SELECT r.flow_id,o.run_id,r.revision,o.operation,o.state,o.started_at,o.finished_at
      FROM automation_operations o JOIN automation_runs r ON r.organization_id=o.organization_id AND r.guild_id=o.guild_id AND r.id=o.run_id
      WHERE o.organization_id=${s.organizationId}::uuid AND o.guild_id=${s.guildId} AND r.flow_id~'^managed_role_[a-f0-9]{32}$'
      AND o.operation IN ('discord.addRole','discord.removeRole') ORDER BY o.started_at DESC,o.run_id,o.identity LIMIT 100`.execute(this.service.db)).rows;
    return { items: rows.map(row => ({ flowId: row.flow_id, runId: row.run_id, revision: row.revision, operation: row.operation,
      state: row.state, startedAt: row.started_at.toISOString(), finishedAt: row.finished_at?.toISOString() ?? null })), retention: "EXISTING_RUN_BOUND" as const };
  }
  private native(s: Scope, actor: Actor, id: string, base: Omit<Base, 'requestId'> & { requestId?: string }, requestHash: string | null, deleting = false,freshGate?:(tx:Tx)=>Promise<void>) {
    return new AutomationService(this.service.db, { ...this.service.options, authorize: async (tx, scope, currentActor, permission) => {
      assert(scope.organizationId === s.organizationId && scope.guildId === s.guildId && currentActor.key === actor.key, "FORBIDDEN", 403);
      if (!tx.isTransaction) { await this.access(tx, scope, currentActor); return; }
      await acquireRuleScopeLocks(tx, ruleScopeLockSet(s, { subjectHashes: [actor.key] }));
      await this.access(tx, scope, currentActor); await automationLock(tx, s);
      // Lock/recheck the safety target before the native Flow row.
      const prior = base.requestId && requestHash ? (await sql<{ actor_hash: string; fingerprint: string; flow_id: string }>`SELECT actor_hash,fingerprint,flow_id FROM automation_requests WHERE ${tenant(s)} AND id=${base.requestId}::uuid`.execute(tx)).rows[0] : undefined;
      if(!prior)await freshGate?.(tx);
      const current = (await sql<{ draft_revision: number; active_revision: number | null; generation: number; state: string }>`SELECT draft_revision,active_revision,generation,state FROM automation_flows WHERE ${tenant(s)} AND id=${id} FOR UPDATE`.execute(tx)).rows[0];
      await this.access(tx, scope, currentActor);
      if (prior) { assert(prior.actor_hash === actor.key && prior.fingerprint === requestHash && prior.flow_id === id, "AUTOMATION_REQUEST_CONFLICT", 409);
        assert(current && (current.state !== 'DELETED' || deleting), "MANAGED_ROLE_POLICY_NOT_FOUND", 410); return; }
      assert((current?.draft_revision ?? 0) === base.expectedRevision && (current?.active_revision ?? null) === base.expectedActiveRevision
        && (current?.generation ?? 0) === base.expectedGeneration && current?.state !== 'DELETED', "AUTOMATION_REVISION_CONFLICT", 409);
      if (current) { const existing = await this.row(tx, s, id); assert(existing && managedRoleSpec(s, existing.definition), "MANAGED_ROLE_POLICY_SHAPE_CHANGED", 409); }
      assert(permission === 'CONFIGURE', "FORBIDDEN", 403);
    } });
  }
  async save(s: Scope, actor: Actor, id: string, input: unknown) {
    managedRolePolicyId.parse(id); const data = managedRolePolicySave.parse(input), { policy, ...base } = data;
    const definition = managedRoleFlow(s, id, policy), requestBinding = { profile: "managed-role-flow.v1", policyId: id, ...base, requestId: undefined };
    const hash = fingerprint({ kind: "SAVE", definition, expectedRevision: base.expectedRevision, requestBinding });
    const saved = await this.native(s, actor, id, base, hash).save(s, actor, { definition, expectedRevision: base.expectedRevision, requestId: base.requestId }, undefined,
      tx => this.access(tx, s, actor), requestBinding);
    return { id, policyVersion: saved.draftRevision, policy: managedRoleSpec(s, saved.definition)!, semanticHash: saved.validation.semanticHash,
      requestId: base.requestId, activePolicyUnchanged: true as const, activationAvailable: false as const, reasonCode: "MANAGED_ROLE_G3_NOT_READY" as const };
  }
  async remove(s: Scope, actor: Actor, id: string, input: unknown) {
    managedRolePolicyId.parse(id); const base = managedRolePolicyBase.parse(input);
    const requestBinding = { profile: "managed-role-flow.v1", policyId: id, ...base, requestId: undefined };
    const hash = fingerprint({ kind: "DELETE", id, requestBinding });
    return this.native(s, actor, id, base, hash, true).disable(s, actor, id, base.requestId, true,
      { requestBinding, beforeWrite: tx => this.access(tx, s, actor) });
  }
  async check(s: Scope, actor: Actor, id: string, input: unknown) {
    const data = managedRoleCheckInput.parse(input), current = await this.detail(s, actor, id);
    assert(current.policyVersion === data.revision, "AUTOMATION_REVISION_CONFLICT", 409);
    assert(data.kind !== "TEST" || data.simulation, "MANAGED_ROLE_SIMULATION_INPUT_REQUIRED");
    const result = await this.native(s, actor, id, { expectedRevision: current.policyVersion, expectedActiveRevision: current.activeRevision, expectedGeneration: current.generation }, null)
      .check(s, actor, id, data.revision, data.kind, data.simulation ? {
        values: { managed_member: { type: "MemberRef", value: { id: data.simulation.memberId, guildId: s.guildId } } },
        outcomes: { managed_role_action: data.simulation.outcome },
      } : {});
    const latest=await this.detail(s,actor,id);
    return { ...result, activationAvailable:latest.activationAvailable, productionAvailable:latest.activationAvailable, directMutationAvailable:latest.directMutationAvailable, productionUnavailableReason:latest.reasonCode };
  }
  async prepareRun(s: Scope, actor: Actor, id: string, input: unknown) {
    const data=managedRoleRunInput.parse(input),current=await this.detail(s,actor,id),descriptor=bindManagedRoleRun(s,current,data);
    const binding=this.binding(current,'START',data.requestId,data.memberId),prepared=await this.prepareAdmission(s,actor,binding);
    await this.service.db.transaction().execute(async tx=>{await acquireRuleScopeLocks(tx,ruleScopeLockSet(s,{subjectHashes:[actor.key]}));await this.access(tx,s,actor);await automationLock(tx,s);await this.finalAdmission(tx,s,actor,binding,prepared);});
    const issuedAt=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(this.service.db)).rows[0]!.now;
    assertManagedRoleCurrentProof(s,actor,binding,prepared.proof,issuedAt);
    const expiresAt=this.requestExpiry(s,prepared,issuedAt);assert(expiresAt>issuedAt,'MANAGED_ROLE_ADMISSION_EXPIRED',409);
    return {...descriptor,directMutationAvailable:true,reasonCode:null,requestProof:await prepared.adapter.issueRequest(s,actor,binding,issuedAt,expiresAt),requestProofExpiresAt:expiresAt.toISOString()};
  }
  async prepareEnable(s:Scope,actor:Actor,id:string,input:unknown){
    const data=managedRoleEnableInput.parse(input),current=await this.detail(s,actor,id);
    assert(current.policyVersion===data.expectedRevision&&current.activeRevision===data.expectedActiveRevision&&current.generation===data.expectedGeneration&&current.semanticHash===data.semanticHash,'AUTOMATION_REVISION_CONFLICT',409);
    const binding=this.binding(current,'ENABLE',data.requestId),prepared=await this.prepareAdmission(s,actor,binding);
    await this.service.db.transaction().execute(async tx=>{await acquireRuleScopeLocks(tx,ruleScopeLockSet(s,{subjectHashes:[actor.key]}));await this.access(tx,s,actor);await automationLock(tx,s);await this.finalAdmission(tx,s,actor,binding,prepared);});
    const issuedAt=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(this.service.db)).rows[0]!.now;
    assertManagedRoleCurrentProof(s,actor,binding,prepared.proof,issuedAt);
    const expiresAt=this.requestExpiry(s,prepared,issuedAt);assert(expiresAt>issuedAt,'MANAGED_ROLE_ADMISSION_EXPIRED',409);
    return {requestId:data.requestId,requestProof:await prepared.adapter.issueRequest(s,actor,binding,issuedAt,expiresAt),requestProofExpiresAt:expiresAt.toISOString()};
  }
  async enable(s: Scope, actor: Actor, id: string, input: unknown) {
    const data = managedRoleEnableInput.parse(input);
    const current = await this.detail(s, actor, id);
    assert(current.policyVersion === data.expectedRevision && current.generation === data.expectedGeneration
      && current.activeRevision === data.expectedActiveRevision && current.semanticHash === data.semanticHash, "AUTOMATION_REVISION_CONFLICT", 409);
    assert(data.requestProof,'MANAGED_ROLE_REQUEST_PROOF_REQUIRED',409);
    const binding=this.binding(current,'ENABLE',data.requestId),prepared=await this.prepareAdmission(s,actor,binding),requestBinding={profile:'managed-role-flow.v1',admissionRevision:prepared.adapter.revision,binding};
    const nativeInput={revision:data.expectedRevision,semanticHash:data.semanticHash,requestId:data.requestId},hash=fingerprint({kind:'ENABLE',id,...nativeInput,requestId:undefined,requestBinding});
    const base={expectedRevision:data.expectedRevision,expectedActiveRevision:data.expectedActiveRevision,expectedGeneration:data.expectedGeneration,requestId:data.requestId};
    const gate=(tx:Tx)=>this.finalAdmission(tx,s,actor,binding,prepared,data.requestProof);
    return this.native(s,actor,id,base,hash,false,gate).enable(s,actor,id,nativeInput,undefined,{requestBinding,beforeWrite:gate,beforeReceipt:tx=>this.receiptAccess(tx,s,actor,binding,prepared,data.requestProof!)});
  }
  async run(s: Scope, actor: Actor, id: string, input: unknown) {
    const data=managedRoleRunInput.parse(input),current=await this.detail(s,actor,id),descriptor=bindManagedRoleRun(s,current,data);
    assert(data.requestProof,'MANAGED_ROLE_REQUEST_PROOF_REQUIRED',409);
    const binding=this.binding(current,'START',data.requestId,data.memberId),prepared=await this.prepareAdmission(s,actor,binding),requestBinding={profile:'managed-role-flow.v1',admissionRevision:prepared.adapter.revision,binding};
    const hash=fingerprint({kind:'START',id,values:descriptor.values,requestBinding}),base={expectedRevision:current.policyVersion,expectedActiveRevision:current.activeRevision,expectedGeneration:current.generation,requestId:data.requestId};
    const gate=(tx:Tx)=>this.finalAdmission(tx,s,actor,binding,prepared,data.requestProof);
    return this.native(s,actor,id,base,hash,false,gate).start(s,actor,id,{requestId:data.requestId,values:descriptor.values},{requestBinding,beforeWrite:gate,beforeReceipt:tx=>this.receiptAccess(tx,s,actor,binding,prepared,data.requestProof!)});
  }
}
