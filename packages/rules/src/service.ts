import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, tenant, type Database, type Tx } from "../../db/src/index";
import { operationsAccess, actorPermissions, type OperationPermission } from "../../operations/src/policy";
import { assert, type Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import {readPersonalPreferences} from "../../operations/src/alpha16-personalization";
import {minimalOperationAudit} from "../../operations/src/alpha16-audit";
import { acquireRuleScopeLocks, ruleScopeLockSet } from "./locks";
import { validateRuleConfig, type RuleEngineConfig } from "./rule-config";
import { configActivationInput, configRetirementInput, type ConfigActivationInput, type ConfigRetirementInput, type RuleOperatingAdmission, type RuleOperatingProfileProof } from "./operating-config";
import { expandRuleInputRefs, loadRuleFacts, persistRuleFacts } from "./fact-storage";
import {readNativeRuleSources, type NativeProjectionRegistration} from "./native-projections";
import {listNativeCohortConfigs,readNativeCohortRevision,reviseNativeCohortConfig,nativeCohortRevisionRequest} from "./native-cohort-config";
import {validateNativeCohortBinding,nativeCohortOptions} from "./native-cohort-projections";
import { sealRuleInput,normalizeSourceHealth,hashRuleValue,immutableSourceHealthId, type RuleId, type FactSnapshot, type SourceHealthObservation, type RuleVersionSet } from "./facts";
import { registeredRule } from "./rule-catalog";
import { prepareRuleMutation, withRuleMutation, readRuleEvaluationRequestStatus, evaluationRequestStatusInput, ruleMutationEnvelope, type RuleMutationEnvelope, type RuleMutationReference } from "./communication";
import {persistCaseContext,type CaseRuntimeConfiguration,type CaseContextRef,type CaseSnapshotInput} from "./case-storage";
import {platformInputHash,bindCurrentCaseRoots} from "./pipeline";
import {evaluateRules} from "./rule-engine";
import {CASE_CATALOG} from "./catalog";
import {normalizeCaseTimestamp} from "./case-engine";
import { PLATFORM_VERSIONS, canonicalJson, digest, encodeCursor, decodeCursor, enqueueRequest, applyRequest, retentionExpiry, suggestionDto, suggestionStates, targetTypes, type PlatformPolicy, type SuggestionRow } from "./domain";

type Enqueue=z.infer<typeof enqueueRequest>;
const evaluationRequestHash=(request:Enqueue,actorHash:string)=>digest({actorHash,configVersion:request.configVersion,inputs:[...request.inputs].sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))),...(request.nativeInputs?{nativeInputs:request.nativeInputs}:{}),...(request.requestedCaseIds?{requestedCaseIds:request.requestedCaseIds}:{}),...(request.requestedContextIds?{requestedContextIds:request.requestedContextIds}:{})});
type ConfigVersionRow={version:number;state:string;engine_version:string;definition:RuleEngineConfig;content_hash:string;created_at:Date;expires_at:Date;source_config_version:number|null;operating_profile_revision:string|null;operating_profile_hash:string|null;operating_profile_expires_at:Date|null};
export interface EvaluationJob {
 id:string;config_version:number;evaluation_as_of:Date;input_hash:string;request_hash:string;
 versions:Record<string,string>;inputs:unknown;actor_hash:string|null;
 state:"QUEUED"|"RUNNING"|"CANCEL_REQUESTED"|"SUCCEEDED"|"FAILED"|"CANCELLED";
 row_version:string;attempt_count:number;lease_token:string|null;lease_until:Date|null;
 created_at:Date;finished_at:Date|null;failure_code:string|null;expires_at:Date;
}
export interface TargetDraftAdapter {
 targetType:typeof targetTypes[number];
 adapterId?:string;
 nativeSource?:string;
 unavailableReason?:string;
 /** True only after every live writer participates in the canonical locks/CAS. */
 writerCompatible:boolean;
 validateFields(input:unknown):unknown;
 lockCurrent(tx:Tx,s:Scope,id:string):Promise<{version:string;contentHash:string}>;
 createDraft(tx:Tx,s:Scope,actor:Actor,targetId:string,liveVersion:string,changes:unknown):Promise<{draftId:string;immutableRevisionId:string;contentHash:string}>;
}
export interface RuleAuthorizationProof {scope:Scope;actorHash:string;expiresAt:Date;}
export class RulePlatform {
 constructor(readonly db:Database,readonly policy?:PlatformPolicy,readonly cursorKey?:string,readonly adapters:readonly TargetDraftAdapter[]=[],readonly authorizationProof?:RuleAuthorizationProof,readonly caseRuntime?:CaseRuntimeConfiguration,readonly operatingAdmission?:RuleOperatingAdmission){}
 async transaction<T>(s:Scope,a:Actor,permission:OperationPermission,work:(tx:Tx,now:Date)=>Promise<T>):Promise<T>{
  return this.db.transaction().execute(async tx=>{
   await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));
   const proof=this.authorizationProof;
   assert(proof&&proof.scope.organizationId===s.organizationId&&proof.scope.guildId===s.guildId&&proof.actorHash===a.key&&proof.expiresAt>new Date(),"AUTHZ_UNAVAILABLE",403);
   await operationsAccess(tx,s,a,permission);
   assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND (lookup_hash IS NULL OR lookup_hash=${a.key}) LIMIT 1`.execute(tx)).rows.length,"RESOURCE_DELETED",410);
   const now=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
   assert(proof.expiresAt>now,"AUTHZ_UNAVAILABLE",403);
   return work(tx,now);
  });
 }
 /** This is a readiness report, never a fabricated successful evaluation. */
 private classAvailable(kind:Parameters<typeof retentionExpiry>[1]){
  const value=this.policy?.retention[kind];return !!(this.policy?.approved&&this.policy.visibilityApproved&&value&&Number.isSafeInteger(value.seconds)&&value.seconds>0&&value.approvalReference);
 }
 private draftEditorStatus(targetType:typeof targetTypes[number]){
  const adapter=this.adapters.find(value=>value.targetType===targetType);
  return {targetType,adapterId:adapter?.adapterId??null,writerCompatible:adapter?.writerCompatible===true,reasonCode:adapter?.writerCompatible?null:adapter?.unavailableReason??"TYPED_EDITOR_NOT_REGISTERED"};
 }
 private requireDraftAdapter(targetType:typeof targetTypes[number]){
  const adapter=this.adapters.find(value=>value.targetType===targetType);
  assert(adapter,"TYPED_EDITOR_NOT_REGISTERED",409);
  assert(adapter.writerCompatible,adapter.unavailableReason??"TYPED_EDITOR_WRITER_INCOMPATIBLE",409);
  return adapter;
 }
 private async draftSafety(tx:Tx,s:Scope,row:SuggestionRow,now:Date,lock=false){
  retentionExpiry(this.policy,"TARGET_LIVE_SAFETY",now);
  const safety=(await sql<{apply_gate:string;expires_at:Date;live_version:string;policy_revision:string}>`SELECT apply_gate,expires_at,live_version,policy_revision FROM rule_target_safety WHERE ${tenant(s)} AND target_type=${row.target_type} AND target_id=${row.target_id} ${lock?sql`FOR UPDATE`:sql``}`.execute(tx)).rows[0];
  assert(safety&&safety.apply_gate==="OPEN"&&safety.expires_at>now&&safety.policy_revision===this.policy!.revision&&safety.live_version===row.live_version,"TARGET_SAFETY_UNAVAILABLE",409);return safety;
 }
 private async mutationCeiling(tx:Tx,s:Scope,a:Actor,envelope:RuleMutationEnvelope,now:Date):Promise<Date>{
  const ends:Date[]=[];
  if(envelope.operation==="CONFIG_REVISE"){
   const body=z.object({baseConfigVersion:z.number().int().nonnegative(),definition:z.unknown()}).strict().parse(envelope.payload);
   assert(!envelope.targetId&&envelope.expectedVersion===body.baseConfigVersion,"INVALID_REQUEST");
   ends.push(retentionExpiry(this.policy,"CONFIG",now));
   if(body.baseConfigVersion>0){const row=(await sql<{expires_at:Date}>`SELECT expires_at FROM rule_config_versions WHERE ${tenant(s)} AND version=${body.baseConfigVersion} AND expires_at>${now}`.execute(tx)).rows[0];assert(row,"TARGET_NOT_FOUND",404);ends.push(row.expires_at);}
  }else if(envelope.operation==="CONFIG_ACTIVATE"||envelope.operation==="CONFIG_RETIRE"){
   const body=envelope.operation==="CONFIG_ACTIVATE"?configActivationInput.parse(envelope.payload):configRetirementInput.parse(envelope.payload);
   assert(!envelope.targetId&&envelope.expectedVersion===body.baseConfigVersion,"INVALID_REQUEST");
   const version="draftConfigVersion" in body?body.draftConfigVersion:body.activeConfigVersion;
   const row=(await sql<{expires_at:Date}>`SELECT expires_at FROM rule_config_versions WHERE ${tenant(s)} AND version=${version} AND expires_at>${now}`.execute(tx)).rows[0];
   assert(row,"TARGET_NOT_FOUND",404);ends.push(row.expires_at,retentionExpiry(this.policy,"CONFIG",now));
  }else if(envelope.operation==="EVALUATION_CANCEL"){
   z.object({}).strict().parse(envelope.payload);assert(envelope.targetId&&envelope.expectedVersion===undefined,"INVALID_REQUEST");
   const job=(await sql<{expires_at:Date}>`SELECT expires_at FROM rule_evaluation_jobs WHERE ${tenant(s)} AND id=${envelope.targetId}::uuid AND expires_at>${now}`.execute(tx)).rows[0];assert(job,"TARGET_NOT_FOUND",404);ends.push(job.expires_at,retentionExpiry(this.policy,"EVALUATION",now));
  }else{
   assert(envelope.targetId,"INVALID_REQUEST");const row=await this.suggestion(tx,s,a,envelope.targetId,now);ends.push(row.history_expires_at);
   if(envelope.operation==="SUGGESTION_REJECT"){
    z.object({reasonCode:z.enum(["INCORRECT","NOT_APPLICABLE","OUTDATED","DUPLICATE","UNSAFE","OTHER"])}).strict().parse(envelope.payload);
    assert(envelope.expectedVersion&&envelope.expectedVersion>0,"PRECONDITION_REQUIRED",428);
    ends.push(row.actionable_until,retentionExpiry(this.policy,"SUPPRESSION",now),retentionExpiry(this.policy,"HISTORY",now));
   }else if(envelope.operation==="SUGGESTION_DRAFT"){
    z.object({liveVersion:z.string().min(1).max(128),changes:z.unknown()}).strict().parse(envelope.payload);
    assert(envelope.expectedVersion&&envelope.expectedVersion>0,"PRECONDITION_REQUIRED",428);
    assert(row.action_mode==="CREATE_DRAFT","SUGGESTION_REVIEW_ONLY",409);this.requireDraftAdapter(row.target_type);
    const safety=await this.draftSafety(tx,s,row,now);ends.push(safety.expires_at,row.actionable_until,retentionExpiry(this.policy,"DRAFT_LINK",now),retentionExpiry(this.policy,"HISTORY",now));
   }else{
    z.object({}).strict().parse(envelope.payload);assert(envelope.expectedVersion===undefined,"INVALID_REQUEST");ends.push(retentionExpiry(this.policy,"USER_STATE",now));
    if(envelope.operation==="SUGGESTION_DISMISS")ends.push(retentionExpiry(this.policy,"SUPPRESSION",now));
    const current=(await sql<{expires_at:Date}>`SELECT expires_at FROM rule_suggestion_user_states WHERE ${tenant(s)} AND suggestion_id=${envelope.targetId}::uuid AND actor_hash=${a.key} AND expires_at>${now}`.execute(tx)).rows[0];if(current)ends.push(current.expires_at);
   }
  }
  const end=new Date(Math.min(...ends.map(x=>x.getTime())));assert(end>now,"STATE_CONFLICT",409);return end;
 }
 private async mutation<T>(tx:Tx,s:Scope,a:Actor,envelope:RuleMutationEnvelope,key:string|undefined,now:Date,
  execute:()=>Promise<{reference:RuleMutationReference;response:T}>,replay:(ref:RuleMutationReference)=>Promise<T>):Promise<T>{
  assert(this.cursorKey,"REQUEST_KEY_UNAVAILABLE",503);
  const ceiling=await this.mutationCeiling(tx,s,a,envelope,now);
  return withRuleMutation(tx,s,a.key,this.cursorKey,this.policy,envelope,key,now,ceiling,execute,replay);
 }
 async prepareMutationRequest(s:Scope,a:Actor,raw:unknown){
  const envelope=ruleMutationEnvelope.parse(raw);
  if(envelope.operation==="EVALUATE"){assert(envelope.targetId===undefined&&envelope.expectedVersion===undefined,"INVALID_REQUEST");return this.evaluationRequestKey(s,a,envelope.payload);}
  if(envelope.operation==="CONFIG_ACTIVATE"){
   const input=configActivationInput.parse(envelope.payload),prepared=await this.prepareOperatingActivation(s,a,input);
   return this.transaction(s,a,"GOVERN",async(tx,now)=>{
    assert(this.cursorKey&&this.operatingAdmission,"REQUEST_KEY_UNAVAILABLE",503);
    const profile=await this.operatingAdmission.require(tx,s,a,prepared.definition,this.policy,prepared.proof,now);
    const ceiling=new Date(Math.min((await this.mutationCeiling(tx,s,a,envelope,now)).getTime(),profile.expiresAt.getTime()));
    return prepareRuleMutation(tx,s,a.key,this.cursorKey,this.policy,envelope,now,ceiling);
   });
  }
  const permission:OperationPermission=envelope.operation==="CONFIG_RETIRE"?"GOVERN":envelope.operation==="CONFIG_REVISE"||envelope.operation==="SUGGESTION_DRAFT"?"CONFIGURE":envelope.operation==="SUGGESTION_REJECT"?"OPERATE":envelope.operation==="EVALUATION_CANCEL"?"ANALYZE":"READ";
  return this.transaction(s,a,permission,async(tx,now)=>{
   assert(this.cursorKey,"REQUEST_KEY_UNAVAILABLE",503);const ceiling=await this.mutationCeiling(tx,s,a,envelope,now);
   return prepareRuleMutation(tx,s,a.key,this.cursorKey,this.policy,envelope,now,ceiling);
  });
 }
 private operatingMutationReadiness(permissions:readonly OperationPermission[],active:boolean){
  const governing=permissions.includes("GOVERN"),provider=this.operatingAdmission?.readiness();
  let persistence=this.classAvailable("CONFIG")&&this.classAvailable("REQUEST_KEY"),evaluationPersistence=persistence;
  try{for(const kind of ["CONFIG","REQUEST_KEY"] as const)retentionExpiry(this.policy,kind,new Date());}catch{persistence=false;}
  try{for(const kind of ["CONFIG","FACT","SOURCE_HEALTH","EVALUATION","SUGGESTION","HISTORY","REQUEST_KEY"] as const)retentionExpiry(this.policy,kind,new Date());}catch{evaluationPersistence=false;}
  return {activation:{enabled:governing&&persistence&&evaluationPersistence&&provider?.enabled===true,reasonCode:!governing?"PERMISSION_DENIED":!persistence||!evaluationPersistence?"RETENTION_NOT_APPROVED":provider?.reasonCode??(!provider?"MEASURED_OPERATING_PROVIDER_UNCONFIGURED":null)},
   retirement:{enabled:governing&&persistence&&active,reasonCode:!governing?"PERMISSION_DENIED":!persistence?"RETENTION_NOT_APPROVED":!active?"OPERATIONAL_CONFIG_NOT_ACTIVATED":null}};
 }
 private configDto(row:ConfigVersionRow){return {configVersion:row.version,status:row.state,engineVersion:row.engine_version,definition:row.definition,contentHash:row.content_hash,createdAt:row.created_at.toISOString(),expiresAt:row.expires_at.toISOString(),
  sourceConfigVersion:row.source_config_version,operatingProfileRevision:row.operating_profile_revision,operatingProfileExpiresAt:row.operating_profile_expires_at?.toISOString()??null};}
 async readiness(s:Scope,a:Actor){
  const observed=await this.transaction(s,a,"READ",async(tx,now)=>(await sql<ConfigVersionRow>`SELECT * FROM rule_config_versions WHERE ${tenant(s)} AND state='ACTIVE' AND expires_at>${now} ORDER BY version DESC LIMIT 1`.execute(tx)).rows[0]);
  let proof:RuleOperatingProfileProof|undefined,observationReason:string|null=null;
  if(observed&&this.operatingAdmission?.readiness().enabled){try{proof=await this.operatingAdmission.observe(s,a,observed.definition,this.policy);}catch{observationReason="OPERATING_PROFILE_UNAVAILABLE";}}
  return this.transaction(s,a,"READ",async(tx,now)=>{
   const permissions=await actorPermissions(tx,s,a),row=(await sql<ConfigVersionRow>`SELECT * FROM rule_config_versions WHERE ${tenant(s)} AND state='ACTIVE' AND expires_at>${now} ORDER BY version DESC LIMIT 1`.execute(tx)).rows[0];
   const reasons:string[]=[];
   if(!row)reasons.push("OPERATIONAL_CONFIG_NOT_ACTIVATED");
   if(!this.operatingAdmission?.readiness().enabled)reasons.push("MEASURED_OPERATING_PROVIDER_UNCONFIGURED");
   if(observationReason)reasons.push(observationReason);
   if(!permissions.includes("ANALYZE"))reasons.push("PERMISSION_DENIED");
   if(row){
    if(!row.operating_profile_expires_at||row.operating_profile_expires_at<=now||!row.operating_profile_hash)reasons.push("OPERATING_PROFILE_EXPIRED_OR_UNVERIFIED");
    else if(!proof||!observed||observed.version!==row.version||observed.content_hash!==row.content_hash)reasons.push("OPERATING_PROFILE_UNAVAILABLE");
    else try{const current=await this.operatingAdmission!.require(tx,s,a,row.definition,this.policy,proof,now);assert(current.profileHash===row.operating_profile_hash&&current.profileRevision===row.operating_profile_revision,"OPERATING_PROFILE_CHANGED",409);}catch{reasons.push("OPERATING_PROFILE_UNAVAILABLE");}
   }
   const reasonCodes=[...new Set(reasons)],enabled=reasonCodes.length===0;
   return {versions:PLATFORM_VERSIONS,enabled,reasonCodes,permissions,targetTypes,automaticApplicationAllowed:false,deployment:"PC_NEXT_SAME_ORIGIN",environmentStatus:enabled?"OPERATING_PROFILE_CURRENT":"OPERATING_PROFILE_UNCONFIGURED",
    personalPreferences:await readPersonalPreferences(tx,s,a.key,now),displayApprovalRequired:false,
    typedEditors:targetTypes.map(targetType=>({...this.draftEditorStatus(targetType),actionAdmission:"INITIAL_CATALOG_REVIEW_ONLY" as const,draftCreationAllowed:false})),
    operatingConfigMutation:this.operatingMutationReadiness(permissions,!!row),
    proposalVisibility:{availableWithCurrentRead:true,approvalRequired:false},evaluation:{enabled,reasonCode:reasonCodes[0]??null,configVersion:row?.version??null,operatingProfileExpiresAt:row?.operating_profile_expires_at?.toISOString()??null},sideEffects:{canApply:false,requiresCurrentPermissionAndTargetSafety:true}};
  });
 }
 async config(s:Scope,a:Actor,history=false){return this.transaction(s,a,"READ",async(tx,now)=>{
  const rows=(await sql<ConfigVersionRow>`SELECT * FROM rule_config_versions WHERE ${tenant(s)} AND expires_at>${now} ${history?sql``:sql`AND state='ACTIVE'`} ORDER BY version DESC`.execute(tx)).rows;
  const currentVersion=(await sql<{version:number}>`SELECT version FROM rule_config_versions WHERE ${tenant(s)} ORDER BY version DESC LIMIT 1`.execute(tx)).rows[0]?.version??0;
  return {items:rows.map(r=>this.configDto(r)),currentVersion,status:rows.length?"AVAILABLE":"DISABLED",reasonCode:rows.length?null:"NO_APPROVED_CONFIG",mutationReadiness:this.operatingMutationReadiness(await actorPermissions(tx,s,a),rows.some(row=>row.state==="ACTIVE"))};
 });}
 async reviseConfig(s:Scope,a:Actor,baseVersion:number,definition:RuleEngineConfig,key?:string){
  assert(Number.isSafeInteger(baseVersion)&&baseVersion>=0,"INVALID_REQUEST");
  assert(definition&&typeof definition==="object"&&!Array.isArray(definition),"INVALID_REQUEST");
  assert(definition.profile==="OPERATIONAL"&&definition.approval==="DISABLED"&&!definition.retentionApproved,"CONFIG_ACTIVATION_NOT_ALLOWED",409);
  try{validateRuleConfig(definition);}catch{assert(false,"INVALID_RULE_CONFIG",400);}
  return this.transaction(s,a,"CONFIGURE",async(tx,now)=>{
   const envelope:RuleMutationEnvelope={operation:"CONFIG_REVISE",expectedVersion:baseVersion,payload:{baseConfigVersion:baseVersion,definition}};
   return this.mutation(tx,s,a,envelope,key,now,async()=>{
   const expires=retentionExpiry(this.policy,"CONFIG",now);
   const current=(await sql<{version:number}>`SELECT version FROM rule_config_versions WHERE ${tenant(s)} ORDER BY version DESC LIMIT 1 FOR UPDATE`.execute(tx)).rows[0]?.version??0;
   assert(current===baseVersion,"VERSION_MISMATCH",412);
   const version=current+1;assert(definition.configVersion===String(version),"VERSION_MISMATCH",412);
   await sql`INSERT INTO rule_config_versions(organization_id,guild_id,version,state,engine_version,definition,content_hash,created_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${version},'DRAFT',${PLATFORM_VERSIONS.engine},${JSON.stringify(definition)}::jsonb,${digest(definition)},${now},${expires})`.execute(tx);
   return {reference:{kind:"CONFIG",version},response:{configVersion:version,status:"DRAFT",contentHash:digest(definition),createdAt:now.toISOString(),expiresAt:expires.toISOString()}};
   },async ref=>{
    assert(ref.kind==="CONFIG","IDEMPOTENCY_INTENT_GONE",410);
    const row=(await sql<{version:number;state:string;content_hash:string;created_at:Date;expires_at:Date}>`SELECT version,state,content_hash,created_at,expires_at FROM rule_config_versions WHERE ${tenant(s)} AND version=${ref.version} AND expires_at>${now}`.execute(tx)).rows[0];assert(row,"IDEMPOTENCY_INTENT_GONE",410);
    return {configVersion:row.version,status:row.state,contentHash:row.content_hash,createdAt:row.created_at.toISOString(),expiresAt:row.expires_at.toISOString()};
   });
  });
 }
 private async prepareOperatingActivation(s:Scope,a:Actor,input:ConfigActivationInput){
  assert(this.operatingAdmission?.readiness().enabled,"MEASURED_OPERATING_PROVIDER_UNCONFIGURED",503);
  const definition=await this.transaction(s,a,"GOVERN",async(tx,now)=>{
   const draft=(await sql<ConfigVersionRow>`SELECT * FROM rule_config_versions WHERE ${tenant(s)} AND version=${input.draftConfigVersion} AND expires_at>${now}`.execute(tx)).rows[0];
   assert(draft&&draft.state==="DRAFT"&&draft.content_hash===input.draftContentHash&&digest(draft.definition)===draft.content_hash&&draft.engine_version===PLATFORM_VERSIONS.engine,"CONFIG_SOURCE_CHANGED",409);
   assert(input.draftConfigVersion<=input.baseConfigVersion,"VERSION_MISMATCH",412);
   const candidate:RuleEngineConfig={...structuredClone(draft.definition),configVersion:String(input.baseConfigVersion+1),profile:"OPERATIONAL",approval:"APPROVED",retentionApproved:true};
   try{validateRuleConfig(candidate);}catch{assert(false,"INVALID_RULE_CONFIG",400);}return candidate;
  });
  // Measurement/current source checks are performed outside all DB locks.
  const proof=await this.operatingAdmission.observe(s,a,definition,this.policy);
  return {definition,proof};
 }
 async activateConfig(s:Scope,a:Actor,raw:ConfigActivationInput,key?:string){
  const input=configActivationInput.parse(raw),prepared=await this.prepareOperatingActivation(s,a,input);
  return this.transaction(s,a,"GOVERN",async(tx,now)=>{
   assert(this.operatingAdmission&&this.cursorKey,"REQUEST_KEY_UNAVAILABLE",503);
   const profile=await this.operatingAdmission.require(tx,s,a,prepared.definition,this.policy,prepared.proof,now);
   const envelope:RuleMutationEnvelope={operation:"CONFIG_ACTIVATE",expectedVersion:input.baseConfigVersion,payload:input};
   const ceiling=new Date(Math.min((await this.mutationCeiling(tx,s,a,envelope,now)).getTime(),profile.expiresAt.getTime()));
   return withRuleMutation(tx,s,a.key,this.cursorKey,this.policy,envelope,key,now,ceiling,async()=>{
    const latest=(await sql<{version:number}>`SELECT version FROM rule_config_versions WHERE ${tenant(s)} ORDER BY version DESC LIMIT 1 FOR UPDATE`.execute(tx)).rows[0]?.version??0;
    assert(latest===input.baseConfigVersion,"VERSION_MISMATCH",412);
    const draft=(await sql<ConfigVersionRow>`SELECT * FROM rule_config_versions WHERE ${tenant(s)} AND version=${input.draftConfigVersion} FOR UPDATE`.execute(tx)).rows[0];
    assert(draft&&draft.state==="DRAFT"&&draft.expires_at>now&&draft.content_hash===input.draftContentHash&&digest(draft.definition)===draft.content_hash,"CONFIG_SOURCE_CHANGED",409);
    const writeNow=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
    assert(this.authorizationProof&&this.authorizationProof.expiresAt>writeNow,"AUTHZ_UNAVAILABLE",403);
    const current=await this.operatingAdmission!.require(tx,s,a,prepared.definition,this.policy,prepared.proof,writeNow);
    const admittedAt=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
    assert(this.authorizationProof.expiresAt>admittedAt&&current.expiresAt>admittedAt,"AUTHZ_OR_OPERATING_PROFILE_EXPIRED",403);
    const expires=new Date(Math.min(retentionExpiry(this.policy,"CONFIG",writeNow).getTime(),draft.expires_at.getTime(),current.expiresAt.getTime()));
    assert(expires>writeNow,"OPERATING_PROFILE_EXPIRED",409);
    const retired=(await sql<{version:number}>`UPDATE rule_config_versions SET state='RETIRED' WHERE ${tenant(s)} AND state='ACTIVE' RETURNING version`.execute(tx)).rows.map(row=>row.version);
    if(retired.length)await sql`UPDATE rule_evaluation_jobs SET state='CANCEL_REQUESTED',row_version=row_version+1 WHERE ${tenant(s)} AND config_version=ANY(${retired}::integer[]) AND state IN ('QUEUED','RUNNING')`.execute(tx);
    const version=latest+1;
    const row=(await sql<ConfigVersionRow>`INSERT INTO rule_config_versions(organization_id,guild_id,version,state,engine_version,definition,content_hash,created_at,approved_at,expires_at,operating_profile_revision,operating_profile_hash,operating_profile_expires_at,source_config_version)
      VALUES(${s.organizationId}::uuid,${s.guildId},${version},'ACTIVE',${PLATFORM_VERSIONS.engine},${JSON.stringify(prepared.definition)}::jsonb,${digest(prepared.definition)},${writeNow},${writeNow},${expires},${current.profileRevision},${current.profileHash},${expires},${draft.version}) RETURNING *`.execute(tx)).rows[0]!;
    await minimalOperationAudit(tx,s,a.key,"RULE_CONFIG_ACTIVATE","CONFIG",version,admittedAt);
    return {reference:{kind:"CONFIG" as const,version},response:this.configDto(row)};
   },async ref=>{
    assert(ref.kind==="CONFIG","IDEMPOTENCY_INTENT_GONE",410);
    const row=(await sql<ConfigVersionRow>`SELECT * FROM rule_config_versions WHERE ${tenant(s)} AND version=${ref.version} AND expires_at>${now}`.execute(tx)).rows[0];assert(row,"IDEMPOTENCY_INTENT_GONE",410);return this.configDto(row);
   });
  });
 }
 async retireConfig(s:Scope,a:Actor,raw:ConfigRetirementInput,key?:string){
  const input=configRetirementInput.parse(raw);
  return this.transaction(s,a,"GOVERN",async(tx,now)=>{
   const envelope:RuleMutationEnvelope={operation:"CONFIG_RETIRE",expectedVersion:input.baseConfigVersion,payload:input};
   return this.mutation(tx,s,a,envelope,key,now,async()=>{
    const latest=(await sql<{version:number}>`SELECT version FROM rule_config_versions WHERE ${tenant(s)} ORDER BY version DESC LIMIT 1 FOR UPDATE`.execute(tx)).rows[0]?.version??0;
    assert(latest===input.baseConfigVersion,"VERSION_MISMATCH",412);
    const active=(await sql<ConfigVersionRow>`SELECT * FROM rule_config_versions WHERE ${tenant(s)} AND version=${input.activeConfigVersion} AND state='ACTIVE' FOR UPDATE`.execute(tx)).rows[0];
    assert(active&&active.expires_at>now&&active.content_hash===input.activeContentHash&&digest(active.definition)===active.content_hash,"CONFIG_SOURCE_CHANGED",409);
    const writeNow=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
    assert(this.authorizationProof&&this.authorizationProof.expiresAt>writeNow,"AUTHZ_UNAVAILABLE",403);
    const version=latest+1,definition:RuleEngineConfig={...structuredClone(active.definition),configVersion:String(version),approval:"DISABLED",retentionApproved:false};
    validateRuleConfig(definition);
    const expires=retentionExpiry(this.policy,"CONFIG",writeNow,active.expires_at);assert(expires>writeNow,"CONFIG_SOURCE_EXPIRED",409);
    const changed=await sql`UPDATE rule_config_versions SET state='RETIRED' WHERE ${tenant(s)} AND version=${active.version} AND state='ACTIVE' AND content_hash=${input.activeContentHash} RETURNING version`.execute(tx);assert(changed.rows.length===1,"VERSION_MISMATCH",412);
    await sql`UPDATE rule_evaluation_jobs SET state='CANCEL_REQUESTED',row_version=row_version+1 WHERE ${tenant(s)} AND config_version=${active.version} AND state IN ('QUEUED','RUNNING')`.execute(tx);
    const row=(await sql<ConfigVersionRow>`INSERT INTO rule_config_versions(organization_id,guild_id,version,state,engine_version,definition,content_hash,created_at,expires_at,source_config_version)
      VALUES(${s.organizationId}::uuid,${s.guildId},${version},'RETIRED',${active.engine_version},${JSON.stringify(definition)}::jsonb,${digest(definition)},${writeNow},${expires},${active.version}) RETURNING *`.execute(tx)).rows[0]!;
    await minimalOperationAudit(tx,s,a.key,"RULE_CONFIG_RETIRE","CONFIG",version,writeNow);
    return {reference:{kind:"CONFIG" as const,version},response:this.configDto(row)};
   },async ref=>{assert(ref.kind==="CONFIG","IDEMPOTENCY_INTENT_GONE",410);const row=(await sql<ConfigVersionRow>`SELECT * FROM rule_config_versions WHERE ${tenant(s)} AND version=${ref.version} AND expires_at>${now}`.execute(tx)).rows[0];assert(row,"IDEMPOTENCY_INTENT_GONE",410);return this.configDto(row);});
  });
 }
 async list(s:Scope,a:Actor,query:{state?:typeof suggestionStates[number];targetType?:typeof targetTypes[number];limit:number;cursor?:string}){
  assert(Number.isInteger(query.limit)&&query.limit>0&&query.limit<=100,"INVALID_REQUEST");
  return this.transaction(s,a,"READ",async(tx,now)=>{
   const preference=await readPersonalPreferences(tx,s,a.key,now);
   if(preference.settings.suggestionDisplay==="HIDE")return {items:[],page:{nextCursor:null,snapshotAt:now.toISOString()},status:"EMPTY",reasonCode:"PERSONAL_PREFERENCE"};
   const allowed=await actorPermissions(tx,s,a),filter=canonicalJson({state:query.state??null,targetType:query.targetType??null});
   const binding={organizationId:s.organizationId,guildId:s.guildId,actorHash:a.key,endpoint:"suggestions",filter,sort:"CREATED_DESC_ID_DESC" as const};
   const position=query.cursor?(assert(this.cursorKey,"CURSOR_UNAVAILABLE",503),decodeCursor(this.cursorKey,query.cursor,binding,now)):null;
   const snapshotAt=position?.snapshotAt??now.toISOString();
   const rows=(await sql<SuggestionRow>`SELECT * FROM rule_suggestions WHERE ${tenant(s)} AND history_expires_at>${now} AND created_at<=${snapshotAt}::timestamptz
    ${allowed.includes("GOVERN")?sql``:sql`AND audience='GUILD'`}
    ${query.state?sql`AND state=${query.state}`:sql``}${query.targetType?sql`AND target_type=${query.targetType}`:sql``}
    ${position?sql`AND (created_at,id)<(${position.createdAt}::timestamptz,${position.id}::uuid)`:sql``}
    AND NOT EXISTS(SELECT 1 FROM rule_lineage_suppressions x WHERE x.organization_id=rule_suggestions.organization_id AND x.guild_id=rule_suggestions.guild_id AND x.lineage_key=rule_suggestions.lineage_key AND x.action_class=rule_suggestions.action_id AND x.kind='PER_USER_DISMISS' AND x.actor_hash=${a.key} AND x.expires_at>${now})
    ORDER BY created_at DESC,id DESC LIMIT ${query.limit+1}`.execute(tx)).rows;
   const items=rows.slice(0,query.limit);let nextCursor:string|null=null;
   if(rows.length>query.limit){const last=items.at(-1)!;assert(this.cursorKey&&this.policy?.approved&&this.policy.cursorSeconds&&Number.isSafeInteger(this.policy.cursorSeconds)&&this.policy.cursorSeconds>0,"CURSOR_UNAVAILABLE",503);
    nextCursor=encodeCursor(this.cursorKey,binding,{snapshotAt,createdAt:last.created_at.toISOString(),id:last.id,expiresAt:new Date(Math.min(Date.parse(snapshotAt)+this.policy.cursorSeconds*1000,...items.map(x=>x.history_expires_at.getTime()))).toISOString()});}
   return {items:items.map(r=>suggestionDto(r,now)),page:{nextCursor,snapshotAt},status:items.length?"AVAILABLE":"EMPTY"};
  });
 }
 private async suggestion(tx:Tx,s:Scope,a:Actor,id:string,now:Date,lock=false){
  z.uuid().parse(id);
  const row=(await sql<SuggestionRow>`SELECT * FROM rule_suggestions WHERE ${tenant(s)} AND id=${id}::uuid AND history_expires_at>${now} ${lock?sql`FOR UPDATE`:sql``}`.execute(tx)).rows[0];
  assert(row,"TARGET_NOT_FOUND",404);
  assert(row.audience==="GUILD"||(await actorPermissions(tx,s,a)).includes("GOVERN"),"TARGET_NOT_FOUND",404);
  return row;
 }
 async detail(s:Scope,a:Actor,id:string){return this.transaction(s,a,"READ",async(tx,now)=>{
  const row=await this.suggestion(tx,s,a,id,now);
  const personal=(await sql<{viewed_at:Date|null;dismissed_at:Date|null;saved_at:Date|null}>`SELECT viewed_at,dismissed_at,saved_at FROM rule_suggestion_user_states WHERE ${tenant(s)} AND suggestion_id=${id}::uuid AND actor_hash=${a.key} AND expires_at>${now}`.execute(tx)).rows[0];
  const evidence=(await sql<{kind:string;reference_hash:string;expires_at:Date}>`SELECT kind,reference_hash,expires_at FROM rule_suggestion_evidence WHERE ${tenant(s)} AND suggestion_id=${id}::uuid AND expires_at>${now}`.execute(tx)).rows;
  const permissions=await actorPermissions(tx,s,a),writable=this.classAvailable("USER_STATE")&&this.classAvailable("REQUEST_KEY")&&row.history_expires_at>now,typedEditor=this.draftEditorStatus(row.target_type);
  let canCreateDraft=permissions.includes("CONFIGURE")&&row.state==="ACTIVE"&&row.actionable_until>now&&row.action_mode==="CREATE_DRAFT"&&typedEditor.writerCompatible&&["DRAFT_LINK","HISTORY","REQUEST_KEY","TARGET_LIVE_SAFETY"].every(kind=>this.classAvailable(kind as Parameters<typeof retentionExpiry>[1]));
  if(canCreateDraft){const safety=(await sql<{apply_gate:string;expires_at:Date;live_version:string;policy_revision:string}>`SELECT apply_gate,expires_at,live_version,policy_revision FROM rule_target_safety WHERE ${tenant(s)} AND target_type=${row.target_type} AND target_id=${row.target_id}`.execute(tx)).rows[0];canCreateDraft=!!safety&&safety.apply_gate==="OPEN"&&safety.expires_at>now&&safety.live_version===row.live_version&&safety.policy_revision===this.policy!.revision;}
  return {...suggestionDto(row,now),canView:true,canRecordView:writable,canDismiss:writable&&this.classAvailable("SUPPRESSION"),canSave:writable,canReject:this.classAvailable("REQUEST_KEY")&&this.classAvailable("HISTORY")&&this.classAvailable("SUPPRESSION")&&permissions.includes("OPERATE")&&row.state==="ACTIVE"&&row.actionable_until>now,canCreateDraft,typedEditor:{...typedEditor,actionMode:row.action_mode,admissionReasonCode:row.action_mode==="REVIEW_ONLY"?"SUGGESTION_REVIEW_ONLY":null},canApply:false,perUserState:{viewedAt:personal?.viewed_at?.toISOString()??null,dismissedAt:personal?.dismissed_at?.toISOString()??null,savedAt:personal?.saved_at?.toISOString()??null},evidence:evidence.map(e=>({kind:e.kind,referenceHash:e.reference_hash,expiresAt:e.expires_at.toISOString()}))};
 });}
 async casePreparationExpiry(tx:Tx,s:Scope,now:Date,requestedCaseIds?:readonly string[],requestedContextIds?:readonly string[]):Promise<Date|null>{
  const adapters=this.caseRuntime?.adapters.filter(adapter=>adapter.confirmed)??[];
  if(!adapters.length){assert(!requestedCaseIds?.length&&!requestedContextIds?.length,"CASE_CONTEXT_NOT_AVAILABLE",409);return null;}
  assert(this.caseRuntime?.approved,"CASE_RUNTIME_NOT_APPROVED",409);
  const ends=[retentionExpiry(this.policy,"FACT",now)];
  for(const adapter of adapters){const end=await adapter.expiresAt(tx,s);assert(Number.isFinite(end.getTime())&&end>now,"CASE_EVIDENCE_EXPIRED",409);ends.push(end);}
  return new Date(Math.min(...ends.map(end=>end.getTime())));
 }
 async history(s:Scope,a:Actor,id:string){return this.transaction(s,a,"READ",async(tx,now)=>{
  await this.suggestion(tx,s,a,id,now);return {items:(await sql<{event_sequence:string;event_type:string;reference_digest:string|null;occurred_at:Date}>`SELECT event_sequence,event_type,reference_digest,occurred_at FROM rule_suggestion_history WHERE ${tenant(s)} AND suggestion_id=${id}::uuid AND expires_at>${now} ORDER BY event_sequence`.execute(tx)).rows.map(r=>({sequence:r.event_sequence,eventType:r.event_type,referenceDigest:r.reference_digest,occurredAt:r.occurred_at.toISOString()}))};
 });}
 async userState(s:Scope,a:Actor,id:string,kind:"view"|"dismiss"|"save",key?:string){
  return this.transaction(s,a,"READ",async(tx,now)=>{
   const envelope:RuleMutationEnvelope={operation:kind==="view"?"SUGGESTION_VIEW":kind==="dismiss"?"SUGGESTION_DISMISS":"SUGGESTION_SAVE",targetId:id,payload:{}};
   return this.mutation(tx,s,a,envelope,key,now,async()=>{
   const row=await this.suggestion(tx,s,a,id,now,true);
   const expires=retentionExpiry(this.policy,"USER_STATE",now,row.history_expires_at);
   assert(expires>now,"STATE_CONFLICT",409);
   await sql`INSERT INTO rule_suggestion_user_states(organization_id,guild_id,suggestion_id,actor_hash,viewed_at,dismissed_at,saved_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${a.key},${kind==='view'?now:null},${kind==='dismiss'?now:null},${kind==='save'?now:null},${expires}) ON CONFLICT(organization_id,guild_id,suggestion_id,actor_hash) DO UPDATE SET viewed_at=COALESCE(rule_suggestion_user_states.viewed_at,EXCLUDED.viewed_at),dismissed_at=COALESCE(rule_suggestion_user_states.dismissed_at,EXCLUDED.dismissed_at),saved_at=COALESCE(rule_suggestion_user_states.saved_at,EXCLUDED.saved_at),row_version=rule_suggestion_user_states.row_version+1,expires_at=LEAST(rule_suggestion_user_states.expires_at,EXCLUDED.expires_at)`.execute(tx);
   if(kind==="dismiss")await this.suppress(tx,s,a,row,"PER_USER_DISMISS",now);
   return {reference:{kind:"USER_STATE",suggestionId:id,mutation:kind},response:{suggestionId:id,updated:kind}};
   },async ref=>{
    assert(ref.kind==="USER_STATE"&&ref.suggestionId===id&&ref.mutation===kind,"IDEMPOTENCY_INTENT_GONE",410);
    await this.suggestion(tx,s,a,id,now);
    const state=(await sql<{viewed_at:Date|null;dismissed_at:Date|null;saved_at:Date|null}>`SELECT viewed_at,dismissed_at,saved_at FROM rule_suggestion_user_states WHERE ${tenant(s)} AND suggestion_id=${id}::uuid AND actor_hash=${a.key} AND expires_at>${now}`.execute(tx)).rows[0];
    assert(state&&(kind==="view"?state.viewed_at:kind==="dismiss"?state.dismissed_at:state.saved_at),"IDEMPOTENCY_INTENT_GONE",410);
    return {suggestionId:id,updated:kind};
   });
  });
 }
 private async suppress(tx:Tx,s:Scope,a:Actor,row:SuggestionRow,kind:"SHARED_REJECT"|"PER_USER_DISMISS",now:Date){
  const expires=retentionExpiry(this.policy,"SUPPRESSION",now);const actor=kind==="SHARED_REJECT"?null:a.key;
  await sql`INSERT INTO rule_lineage_suppressions(organization_id,guild_id,id,lineage_key,action_class,kind,actor_hash,created_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${row.lineage_key},${row.action_id},${kind},${actor},${now},${expires}) ON CONFLICT(organization_id,guild_id,kind,actor_hash,lineage_key,action_class) DO NOTHING`.execute(tx);
 }
 private async event(tx:Tx,s:Scope,id:string,type:string,now:Date,historyEnd:Date,ref:string|null=null){
  const expires=retentionExpiry(this.policy,"HISTORY",now,historyEnd);
  await sql`INSERT INTO rule_suggestion_history(organization_id,guild_id,suggestion_id,id,event_sequence,event_type,reference_digest,occurred_at,expires_at) SELECT ${s.organizationId}::uuid,${s.guildId},${id}::uuid,${randomUUID()}::uuid,COALESCE(max(event_sequence),0)+1,${type},${ref},${now},${expires} FROM rule_suggestion_history WHERE ${tenant(s)} AND suggestion_id=${id}::uuid`.execute(tx);
 }
 async reject(s:Scope,a:Actor,id:string,expected:number,reason:string,key?:string){
  z.enum(["INCORRECT","NOT_APPLICABLE","OUTDATED","DUPLICATE","UNSAFE","OTHER"]).parse(reason);
  return this.transaction(s,a,"OPERATE",async(tx,now)=>{
   return this.mutation(tx,s,a,{operation:"SUGGESTION_REJECT",targetId:id,expectedVersion:expected,payload:{reasonCode:reason}},key,now,async()=>{
   const row=await this.suggestion(tx,s,a,id,now,true);assert(row.version===expected,"SUGGESTION_VERSION_MISMATCH",412);assert(row.state==="ACTIVE"&&row.actionable_until>now,"STATE_CONFLICT",409);
   await this.suppress(tx,s,a,row,"SHARED_REJECT",now);
   const result=await sql`UPDATE rule_suggestions SET state='REJECTED',version=version+1 WHERE ${tenant(s)} AND id=${id}::uuid AND version=${expected}`.execute(tx);assert(result.numAffectedRows===1n,"SUGGESTION_VERSION_MISMATCH",412);
   await this.event(tx,s,id,"REJECTED",now,row.history_expires_at,digest({reason}));return {reference:{kind:"REJECT",suggestionId:id,version:expected+1},response:{suggestionId:id,suggestionVersion:expected+1,sharedState:"REJECTED"}};
   },async ref=>{
    assert(ref.kind==="REJECT"&&ref.suggestionId===id,"IDEMPOTENCY_INTENT_GONE",410);
    const row=await this.suggestion(tx,s,a,id,now);return {suggestionId:id,suggestionVersion:row.version,sharedState:row.state};
   });
  });
 }
 async enqueue(s:Scope,a:Actor,key:string,raw:unknown){
  const request=enqueueRequest.parse(raw);assert(/^[\x21-\x7e]{1,128}$/.test(key),"INVALID_IDEMPOTENCY_KEY");
  return this.transaction(s,a,"ANALYZE",async(tx,now)=>{
   const end=retentionExpiry(this.policy,"EVALUATION",now),requestHash=evaluationRequestHash(request,a.key);
   assert(this.cursorKey,"REQUEST_KEY_UNAVAILABLE",503);
   return withRuleMutation<{job:EvaluationJob;deduplicated:boolean}>(tx,s,a.key,this.cursorKey,this.policy,{operation:"EVALUATE",payload:request},key,now,end,async(wireExpiry)=>{
   const config=(await sql<{definition:RuleEngineConfig;engine_version:string;content_hash:string;expires_at:Date}>`SELECT definition,engine_version,content_hash,expires_at FROM rule_config_versions WHERE ${tenant(s)} AND version=${request.configVersion} AND state='ACTIVE' AND approved_at IS NOT NULL AND expires_at>${now} AND operating_profile_expires_at>${now}`.execute(tx)).rows[0];assert(config,"DISABLED_CONFIG",409);
   validateRuleConfig(config.definition);assert(config.definition.profile==="OPERATIONAL"&&config.definition.approval==="APPROVED"&&config.definition.retentionApproved,"DISABLED_CONFIG",409);
   let expiry=new Date(Math.min(end.getTime(),config.expires_at.getTime()));
   let refs=[...request.inputs].sort((x,y)=>canonicalJson(x).localeCompare(canonicalJson(y)));assert(new Set(refs.map(x=>x.kind+':'+x.id)).size===refs.length,"INVALID_REQUEST");
   for(const ref of refs){const rows=ref.kind==="FACT"?(await sql<{content_hash:string;expires_at:Date}>`SELECT content_hash,expires_at FROM rule_fact_snapshots WHERE ${tenant(s)} AND id=${ref.id}::uuid AND state='SEALED' AND registry_version=${ref.revision}`.execute(tx)).rows:(await sql<{content_hash:string;expires_at:Date}>`SELECT content_hash,expires_at FROM rule_source_health WHERE ${tenant(s)} AND id=${ref.id}::uuid AND revision=${ref.revision}`.execute(tx)).rows;
    const row=rows[0];assert(row&&row.expires_at>now,"INPUT_NOT_AVAILABLE",409);expiry=new Date(Math.min(expiry.getTime(),row.expires_at.getTime()));}
   const duplicate=(await sql<EvaluationJob>`SELECT * FROM rule_evaluation_jobs WHERE ${tenant(s)} AND actor_hash=${a.key} AND request_hash=${requestHash} AND state IN ('QUEUED','RUNNING','CANCEL_REQUESTED') AND expires_at>${now}`.execute(tx)).rows[0];
   if(duplicate){
    assert(wireExpiry<=duplicate.expires_at,"INVALID_IDEMPOTENCY_KEY");
    return {reference:{kind:"EVALUATION",jobId:duplicate.id},response:{job:duplicate,deduplicated:true}};
   }
   if(request.nativeInputs){
    // The prepared request fixes resource/config descriptors. The first
    // accepted enqueue, rather than the earlier key-preparation request,
    // captures native values and pins the projection's evaluation clock.
    const native=await readNativeRuleSources(tx,s,a,request.nativeInputs,{authority:this.authorizationProof,evaluationAsOf:now.toISOString(),engineConfig:config.definition});
    assert(!native.diagnostics.some(item=>item.status==="UNKNOWN"||item.status==="DISABLED"),"NATIVE_EVALUATION_INPUT_UNAVAILABLE",409);
    const captured=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
    assert(this.authorizationProof&&this.authorizationProof.expiresAt>captured,"AUTHZ_UNAVAILABLE",403);
    await persistRuleFacts(tx,s,native.facts,native.generatedHealth,captured,{fact:retentionExpiry(this.policy,"FACT",now),sourceHealth:retentionExpiry(this.policy,"SOURCE_HEALTH",now)});
    const nativeRefs=[...native.facts.map(f=>({kind:"FACT" as const,id:f.snapshotId,revision:f.metricDefinitionVersion})),...native.generatedHealth.map(h=>({kind:"SOURCE_HEALTH" as const,id:h.observationId,revision:h.revision})),...native.reusedHealthRefs.map(h=>({kind:"SOURCE_HEALTH" as const,id:h.observationId,revision:h.revision}))];
    const merged=new Map<string,typeof refs[number]>();
    for(const ref of [...refs,...nativeRefs]){const identity=ref.kind+":"+ref.id,prior=merged.get(identity);assert(!prior||prior.revision===ref.revision,"RULE_HEALTH_REVISION_AMBIGUOUS",409);merged.set(identity,ref);}
    refs=[...merged.values()].sort((x,y)=>canonicalJson(x).localeCompare(canonicalJson(y)));
   }
   const versions={...PLATFORM_VERSIONS,config:String(request.configVersion),configHash:config.content_hash};
   // Empty native refs are admitted only by an explicit typed CASE selector.
   const expanded=refs.length?await expandRuleInputRefs(tx,s,refs):{facts:[],sourceHealth:[],expiresAt:expiry},data=await loadRuleFacts(tx,s,expanded);
   expiry=new Date(Math.min(expiry.getTime(),expanded.expiresAt.getTime()));
   assert(wireExpiry<=expiry,"INVALID_IDEMPOTENCY_KEY");
   const baseTargets=[...data.facts.map(f=>f.target),...data.sourceHealth.map(h=>h.target)];
   const ruleTargets=[...new Map(baseTargets.map(target=>[digest(target),target])).values()];
   // Selection follows catalog target types, including cross-domain DATA/COMM
   // when their native target is requested; CASE aliases add no rule slots.
   const requestedRuleIds=Object.entries(config.definition.rules).filter(([id,value])=>value?.enabled&&ruleTargets.some(target=>target.targetType===registeredRule(id)?.targetType)).map(([id])=>id as RuleId);
   const engineVersions:RuleVersionSet={engineVersion:versions.engine,configVersion:versions.config,catalogVersion:versions.catalog,schemaVersion:versions.schema,branchVersion:versions.branch,actionVersion:versions.action,explanationVersion:versions.explanation,ruleVersions:Object.fromEntries(requestedRuleIds.map(id=>[id,registeredRule(id)!.ruleVersion]))};
   const preliminary=sealRuleInput({guildId:s.guildId,evaluationAsOf:now.toISOString(),versions:engineVersions,requestedRuleIds,...data,targets:ruleTargets,ruleTargets});
   const caseRefs:CaseContextRef[]=[],caseInputs:CaseSnapshotInput[]=[],caseAdapters=this.caseRuntime?.adapters.filter(adapter=>adapter.confirmed)??[];
   const allowed=await actorPermissions(tx,s,a);
   if(caseAdapters.length){
    assert(this.caseRuntime?.approved&&Object.values(this.caseRuntime.aggregateBudget).every(n=>Number.isSafeInteger(n)&&n>0),"CASE_RUNTIME_NOT_APPROVED",409);
    for(const adapter of caseAdapters){
     const entries=await adapter.read(tx,s,{evaluationAsOf:preliminary.evaluationAsOf,versions:{catalog:versions.catalog,rule:versions.catalog,engine:versions.engine,config:versions.config,schema:versions.schema,branch:versions.branch,action:versions.action,explanation:versions.explanation},permissions:[...allowed],...(request.requestedCaseIds?{requestedCaseIds:request.requestedCaseIds}:{}),...(request.requestedContextIds?{requestedContextIds:request.requestedContextIds}:{})});
     for(const entry of entries){
      if(request.requestedCaseIds&&!request.requestedCaseIds.some(caseId=>caseId===entry.caseId))continue;
      if(request.requestedContextIds&&!request.requestedContextIds.includes(entry.context.contextId))continue;
      const definition=CASE_CATALOG.find(c=>c.id===entry.caseId);assert(definition,"CASE_NOT_REGISTERED",409);
      assert(entry.context.guildId===s.guildId&&normalizeCaseTimestamp(entry.context.evaluationAsOf)===normalizeCaseTimestamp(preliminary.evaluationAsOf),"CASE_CONTEXT_NOT_SEALED",409);
      assert(entry.context.permissions.every(permission=>allowed.some(p=>p===permission))&&(definition.requiredAudience!=="RESTRICTED_STAFF"||allowed.includes("GOVERN")),"PERMISSION_DENIED",403);
      assert(caseInputs.length<20&&!caseInputs.some(c=>c.caseId===entry.caseId),"CASE_CONTEXT_SCHEMA",409);
      caseInputs.push(entry);
     }
    }
   }
   if(request.requestedCaseIds)assert(request.requestedCaseIds.every(caseId=>caseInputs.some(entry=>entry.caseId===caseId)),"CASE_CONTEXT_NOT_AVAILABLE",409);
   if(request.requestedContextIds)assert(request.requestedContextIds.every(id=>caseInputs.some(entry=>entry.context.contextId===id)),"CASE_CONTEXT_NOT_AVAILABLE",409);
   const caseTargets=caseInputs.map(c=>{assert(c.context.target.liveVersion!==null,"TARGET_VERSION_UNAVAILABLE",409);return {...c.context.target,liveVersion:c.context.target.liveVersion};});
   const targets=[...new Map([...baseTargets,...caseTargets].map(t=>[digest(t),t])).values()];
   const input=sealRuleInput({guildId:s.guildId,evaluationAsOf:now.toISOString(),versions:engineVersions,requestedRuleIds,...data,targets,ruleTargets});
   const evaluated=evaluateRules(input,config.definition);
   assert(evaluated.status==="COMPLETED",evaluated.reasonCodes[0]??"BASE_RULE_EVALUATION_INCOMPLETE",409);
   let bound:CaseSnapshotInput[];
   try{bound=bindCurrentCaseRoots(input,caseInputs,evaluated);}catch(error){assert(false,error instanceof Error&&["BASE_RULE_RESULT_NOT_AVAILABLE","BASE_RULE_EVALUATION_INCOMPLETE"].includes(error.message)?error.message:"CASE_CONTEXT_NOT_SEALED",409);}
   for(const entry of bound)caseRefs.push(await persistCaseContext(tx,s,entry,now,this.policy,true));
   const caseAggregateBudget=caseRefs.length?this.caseRuntime!.aggregateBudget:null,inputHash=platformInputHash(input.inputHash,caseRefs,caseAggregateBudget);
   if(caseRefs.length)expiry=new Date(Math.min(expiry.getTime(),...caseRefs.map(ref=>Date.parse(ref.expiresAt))));
   const descriptor={refs:{facts:expanded.facts,sourceHealth:expanded.sourceHealth},targets:input.targets,ruleTargets:input.ruleTargets,requestedRuleIds,versions:engineVersions,sealedInputHash:input.inputHash,caseRefs,caseAggregateBudget,...(request.requestedCaseIds?{requestedCaseIds:request.requestedCaseIds}:{}),...(request.requestedContextIds?{requestedContextIds:request.requestedContextIds}:{})};
   await operationsAccess(tx,s,a,"ANALYZE");
   const completedAt=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
   assert(this.authorizationProof&&this.authorizationProof.expiresAt>completedAt,"AUTHZ_UNAVAILABLE",403);
   assert(expiry>completedAt&&wireExpiry>completedAt,"INPUT_OR_REQUEST_EXPIRED",409);
   const job=(await sql<EvaluationJob>`INSERT INTO rule_evaluation_jobs(organization_id,guild_id,id,config_version,evaluation_as_of,input_hash,request_hash,versions,inputs,actor_hash,state,created_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${request.configVersion},${now},${inputHash},${requestHash},${JSON.stringify(versions)}::jsonb,${JSON.stringify(descriptor)}::jsonb,${a.key},'QUEUED',${now},${expiry}) RETURNING *`.execute(tx)).rows[0]!;
   for(const ref of caseRefs)await sql`INSERT INTO rule_job_case_context_refs VALUES(${s.organizationId}::uuid,${s.guildId},${job.id}::uuid,${ref.snapshotId}::uuid,${ref.revision},${ref.contentHash})`.execute(tx);
   assert(wireExpiry<=expiry,"INVALID_IDEMPOTENCY_KEY");
   for(const ref of refs)await sql`INSERT INTO rule_evaluation_inputs VALUES(${s.organizationId}::uuid,${s.guildId},${job.id}::uuid,${ref.kind},${ref.id}::uuid,${ref.revision})`.execute(tx);
   return {reference:{kind:"EVALUATION",jobId:job.id},response:{job,deduplicated:false}};
   },async ref=>{
    assert(ref.kind==="EVALUATION","IDEMPOTENCY_INTENT_GONE",410);
    const job=(await sql<EvaluationJob>`SELECT * FROM rule_evaluation_jobs WHERE ${tenant(s)} AND id=${ref.jobId}::uuid AND expires_at>${now}`.execute(tx)).rows[0];assert(job,"IDEMPOTENCY_INTENT_GONE",410);return {job,deduplicated:true};
   });
  });
 }
 async job(s:Scope,a:Actor,id:string,cancel=false,key?:string){z.uuid().parse(id);return this.transaction(s,a,cancel?"ANALYZE":"READ",async(tx,now)=>{
  const read=async(lock=false)=>{const job=(await sql<EvaluationJob>`SELECT * FROM rule_evaluation_jobs WHERE ${tenant(s)} AND id=${id}::uuid AND expires_at>${now} ${lock?sql`FOR UPDATE`:sql``}`.execute(tx)).rows[0];assert(job,"TARGET_NOT_FOUND",404);return job;};
  const dto=(job:EvaluationJob)=>({evaluationJobId:job.id,status:job.state,evaluationAsOf:job.evaluation_as_of.toISOString(),inputHash:job.input_hash,versions:job.versions,failureCode:job.failure_code,finishedAt:job.finished_at?.toISOString()??null});
  if(!cancel)return dto(await read());
  return this.mutation(tx,s,a,{operation:"EVALUATION_CANCEL",targetId:id,payload:{}},key,now,async()=>{
   const job=await read(true);assert(["QUEUED","RUNNING"].includes(job.state),"STATE_CONFLICT",409);
   const changed=await sql`UPDATE rule_evaluation_jobs SET state='CANCEL_REQUESTED',row_version=row_version+1 WHERE ${tenant(s)} AND id=${id}::uuid AND row_version=${job.row_version} RETURNING id`.execute(tx);assert(changed.rows.length===1,"STATE_CONFLICT",409);job.state="CANCEL_REQUESTED";
   return {reference:{kind:"EVALUATION_CANCEL",jobId:id},response:dto(job)};
  },async ref=>{assert(ref.kind==="EVALUATION_CANCEL"&&ref.jobId===id,"IDEMPOTENCY_INTENT_GONE",410);return dto(await read());});
 });}
 async evaluationRequestKey(s:Scope,a:Actor,raw:unknown){const body=enqueueRequest.parse(raw);return this.transaction(s,a,"ANALYZE",async(tx,now)=>{
  const requestEnd=retentionExpiry(this.policy,"REQUEST_KEY",now),evaluationEnd=retentionExpiry(this.policy,"EVALUATION",now);assert(this.cursorKey,"REQUEST_KEY_UNAVAILABLE",503);
  const prepare=async(expires:Date)=>{
   await operationsAccess(tx,s,a,"ANALYZE");
   const completedAt=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
   assert(this.authorizationProof&&this.authorizationProof.expiresAt>completedAt,"AUTHZ_UNAVAILABLE",403);
   assert(expires>completedAt,"INPUT_OR_REQUEST_EXPIRED",409);
   return prepareRuleMutation(tx,s,a.key,this.cursorKey!,this.policy,{operation:"EVALUATE",payload:body},now,expires);
  };
  const config=(await sql<{expires_at:Date;definition:RuleEngineConfig}>`SELECT expires_at,definition FROM rule_config_versions WHERE ${tenant(s)} AND version=${body.configVersion} AND state='ACTIVE' AND approved_at IS NOT NULL AND expires_at>${now} AND operating_profile_expires_at>${now}`.execute(tx)).rows[0];assert(config,"DISABLED_CONFIG",409);
  const requestHash=evaluationRequestHash(body,a.key);
  const current=(await sql<{expires_at:Date}>`SELECT expires_at FROM rule_evaluation_jobs WHERE ${tenant(s)} AND actor_hash=${a.key} AND request_hash=${requestHash} AND state IN ('QUEUED','RUNNING','CANCEL_REQUESTED') AND expires_at>${now}`.execute(tx)).rows[0];
  if(current){
   // Reusing a currently accepted request never reads newer native values or
   // CASE context. The worker reconstructs only the first sealed references.
   const expires=new Date(Math.min(requestEnd.getTime(),evaluationEnd.getTime(),config.expires_at.getTime(),current.expires_at.getTime()));
   return prepare(expires);
  }
  let inputExpiry=body.inputs.length?(await expandRuleInputRefs(tx,s,body.inputs)).expiresAt:new Date(8640000000000000);
  if(body.nativeInputs){
   validateRuleConfig(config.definition);
   const native=await readNativeRuleSources(tx,s,a,body.nativeInputs,{authority:this.authorizationProof,evaluationAsOf:now.toISOString(),engineConfig:config.definition});
   assert(!native.diagnostics.some(item=>item.status==="UNKNOWN"||item.status==="DISABLED"),"NATIVE_EVALUATION_INPUT_UNAVAILABLE",409);
   const expiries=[...native.facts.map(f=>Date.parse(f.expiresAt)),...native.sourceHealth.map(h=>Date.parse(h.expiresAt))];
   assert(expiries.length>0,"NATIVE_EVALUATION_INPUT_UNAVAILABLE",409);inputExpiry=new Date(Math.min(inputExpiry.getTime(),...expiries));
  }
  const caseExpiry=await this.casePreparationExpiry(tx,s,now,body.requestedCaseIds,body.requestedContextIds);
  const expires=new Date(Math.min(requestEnd.getTime(),evaluationEnd.getTime(),config.expires_at.getTime(),inputExpiry.getTime(),caseExpiry?.getTime()??Infinity,body.nativeInputs?now.getTime()+30000:Infinity));
  return prepare(expires);
 });}
 /** An accepted request is reconstructed in this same current-authority
  * transaction. A status read never calls enqueue/job or requires a new
  * generation/WRITE retention policy for an already retained reference. */
 async evaluationRequestStatus(s:Scope,a:Actor,raw:unknown){const {key}=evaluationRequestStatusInput.parse(raw);return this.transaction(s,a,"ANALYZE",async(tx,now)=>{
  assert(this.cursorKey,"REQUEST_KEY_UNAVAILABLE",503);
  const receipt=await readRuleEvaluationRequestStatus(tx,s,a.key,this.cursorKey,key,now);
  const job=receipt.status==="DONE"?(await sql<EvaluationJob>`SELECT * FROM rule_evaluation_jobs WHERE ${tenant(s)} AND id=${receipt.evaluationJobId}::uuid AND actor_hash=${a.key} AND expires_at>${now}`.execute(tx)).rows[0]:undefined;
  await operationsAccess(tx,s,a,"ANALYZE");
  const completedAt=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
  assert(this.authorizationProof&&this.authorizationProof.expiresAt>completedAt,"AUTHZ_UNAVAILABLE",403);
  if("expiresAt" in receipt&&Date.parse(receipt.expiresAt)<=completedAt.getTime())return {status:"EXPIRED" as const,acceptance:"UNKNOWN" as const,job:null};
  if(receipt.status!=="DONE")return {status:receipt.status,acceptance:"UNKNOWN" as const,job:null,...("expiresAt" in receipt?{expiresAt:receipt.expiresAt}:{})};
  if(!job||job.expires_at<=completedAt)return {status:"UNAVAILABLE" as const,acceptance:"UNKNOWN" as const,job:null};
  return {status:"DONE" as const,acceptance:"CONFIRMED" as const,expiresAt:receipt.expiresAt,job:{evaluationJobId:job.id,status:job.state,evaluationAsOf:job.evaluation_as_of.toISOString(),inputHash:job.input_hash,versions:job.versions,failureCode:job.failure_code,finishedAt:job.finished_at?.toISOString()??null}};
 });}
 /** Internal typed source bridge. No browser route accepts registrations or raw
  * Facts. It returns the same immutable input refs accepted by enqueue(); that
  * existing path seals asOf/config/refs once, under its unchanged G3 gates. */
 async snapshotNativeSources(s:Scope,a:Actor,requests:unknown,registrations:readonly NativeProjectionRegistration[]=[]){
  return this.transaction(s,a,"ANALYZE",async(tx,now)=>{
   const config=(await sql<{definition:RuleEngineConfig}>`SELECT definition FROM rule_config_versions WHERE ${tenant(s)} AND state='ACTIVE' AND approved_at IS NOT NULL AND expires_at>${now} AND operating_profile_expires_at>${now} ORDER BY version DESC LIMIT 1`.execute(tx)).rows[0];
   if(config)validateRuleConfig(config.definition);
   const data=await readNativeRuleSources(tx,s,a,requests,{authority:this.authorizationProof,registrations,engineConfig:config?.definition});
   // Do not silently omit an unresolved requested target from enqueue's target
   // set. A caller may explicitly choose a separate narrower request later.
   if(data.diagnostics.some(value=>value.status==="UNKNOWN"||value.status==="DISABLED"))return {inputs:[],diagnostics:data.diagnostics,status:"UNAVAILABLE" as const};
   if(data.facts.length&&!(this.policy?.kind==="OPERATIONAL"&&this.policy.approved))return {inputs:[],diagnostics:data.diagnostics.map(value=>value.status==="PROJECTED"?{...value,status:"DISABLED" as const,reasonCodes:["RETENTION_NOT_APPROVED"]}:value),status:"DISABLED" as const};
   const captured=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
   assert(this.authorizationProof&&this.authorizationProof.expiresAt>captured,"AUTHZ_UNAVAILABLE",403);
   if(data.facts.length){
    const fact=retentionExpiry(this.policy,"FACT",now),sourceHealth=retentionExpiry(this.policy,"SOURCE_HEALTH",now);
    // New typed native observations are sealed once. Reused health is not
    // reinserted and its original effective DB expiry remains authoritative.
    await persistRuleFacts(tx,s,data.facts,data.generatedHealth,captured,{fact,sourceHealth});
   }
   const inputs=[...data.facts.map(value=>({kind:"FACT" as const,id:value.snapshotId,revision:value.metricDefinitionVersion})),...[...data.reusedHealthRefs,...data.generatedHealth].map(value=>({kind:"SOURCE_HEALTH" as const,id:value.observationId,revision:value.revision}))];
   return {inputs,diagnostics:data.diagnostics,status:inputs.length?"AVAILABLE" as const:"UNAVAILABLE" as const};
  });
 }
 async nativeSourceConfigs(s:Scope,a:Actor,sourceId?:string){return this.transaction(s,a,"READ",async(tx,now)=>({items:await listNativeCohortConfigs(tx,s,now,sourceId),status:"AVAILABLE" as const,operationalApproval:false}));}
 async nativeSourceOptions(s:Scope,a:Actor){return this.transaction(s,a,"READ",async(tx,now)=>nativeCohortOptions(tx,s,a,now));}
 /** Independent read: unavailable business metrics do not conceal an actual
  * UNKNOWN/partial native health observation. Nothing is persisted here. */
 async observeNativeSourceHealth(s:Scope,a:Actor,requests:unknown){return this.transaction(s,a,"ANALYZE",async(tx,now)=>{
  const config=(await sql<{definition:RuleEngineConfig}>`SELECT definition FROM rule_config_versions WHERE ${tenant(s)} AND state='ACTIVE' AND approved_at IS NOT NULL AND expires_at>${now} AND operating_profile_expires_at>${now} ORDER BY version DESC LIMIT 1`.execute(tx)).rows[0];if(config)validateRuleConfig(config.definition);
  const data=await readNativeRuleSources(tx,s,a,requests,{authority:this.authorizationProof,engineConfig:config?.definition,evaluationAsOf:now.toISOString()});
  return {observations:data.observedHealth.map(value=>({...value,persisted:false as const})),diagnostics:data.diagnostics,status:data.observedHealth.length?"OBSERVED" as const:"UNKNOWN" as const};
 });}
 /** Explicit health-only snapshot; it shares SOURCE_HEALTH retention and does
  * not create/approve a business Fact or publish an incomplete native batch. */
 async snapshotNativeSourceHealth(s:Scope,a:Actor,requests:unknown){return this.transaction(s,a,"ANALYZE",async(tx,now)=>{
  const sourceHealth=retentionExpiry(this.policy,"SOURCE_HEALTH",now);
  const config=(await sql<{definition:RuleEngineConfig}>`SELECT definition FROM rule_config_versions WHERE ${tenant(s)} AND state='ACTIVE' AND approved_at IS NOT NULL AND expires_at>${now} AND operating_profile_expires_at>${now} ORDER BY version DESC LIMIT 1`.execute(tx)).rows[0];
  assert(config,"DISABLED_CONFIG",409);validateRuleConfig(config.definition);assert(config.definition.profile==="OPERATIONAL"&&config.definition.approval==="APPROVED"&&config.definition.retentionApproved&&config.definition.approvedSourceTypes.includes("source_health_observation_v1"),"NATIVE_APPROVED_RULE_CONFIG_REQUIRED",409);
  const data=await readNativeRuleSources(tx,s,a,requests,{authority:this.authorizationProof,engineConfig:config.definition,evaluationAsOf:now.toISOString()});
  const observations=data.observedHealth.filter(value=>config.definition.approvedSourceTypes.includes(value.observation.sourceType));
  assert(observations.length>0,"NATIVE_SOURCE_HEALTH_UNAVAILABLE",409);
  // An explicit source/metric projection retains the exact native quality,
  // clocks and deadline. It does not copy or invent a business value.
  const projected=observations.map(({metricId,observation})=>{const revision=hashRuleValue({nativeObservation:observation.revision,metricId,target:observation.target}),target={targetType:"DATA_SOURCE_METRIC",targetId:hashRuleValue({metricId,sourceType:observation.sourceType,nativeTargetType:observation.target.targetType,nativeTargetId:observation.target.targetId}),liveVersion:observation.revision};return normalizeSourceHealth({...observation,observationId:immutableSourceHealthId(s,observation.sourceType,revision,observation.observedAt,target),revision,target});});
  await persistRuleFacts(tx,s,[],projected,now,{fact:sourceHealth,sourceHealth});
  const complete=observations.length===data.observedHealth.length&&!data.diagnostics.some(value=>value.status==="UNKNOWN"||value.status==="DISABLED");
  return {inputs:projected.map(value=>({kind:"SOURCE_HEALTH" as const,id:value.observationId,revision:value.revision})),diagnostics:data.diagnostics,status:complete?"AVAILABLE" as const:"PARTIAL" as const,complete};
 });}
 async reviseNativeSourceConfig(s:Scope,a:Actor,raw:unknown){
  const input=nativeCohortRevisionRequest.parse(raw);
  return this.transaction(s,a,"CONFIGURE",async(tx,now)=>{
   await validateNativeCohortBinding(tx,s,input.definition,now);
   const end=retentionExpiry(this.policy,"CONFIG",now);
   assert(this.authorizationProof&&this.authorizationProof.expiresAt>new Date(),"AUTHZ_UNAVAILABLE",403);
   return reviseNativeCohortConfig(tx,s,input,now,end);
  });
 }
 async disableNativeSourceConfig(s:Scope,a:Actor,sourceId:string,raw:unknown){
  z.uuid().parse(sourceId);const input=z.object({revisionId:z.uuid(),baseVersion:z.number().int().positive()}).strict().parse(raw);
  return this.transaction(s,a,"CONFIGURE",async(tx,now)=>{
   const replay=await readNativeCohortRevision(tx,s,sourceId,input.revisionId,now);
   if(replay){assert(replay.baseVersion===input.baseVersion&&!replay.enabled&&replay.draftParentRevisionId===null,"IDEMPOTENCY_KEY_REUSED",409);return {...replay,deduplicated:true};}
   const current=(await listNativeCohortConfigs(tx,s,now,sourceId))[0];assert(current,"TARGET_NOT_FOUND",404);
   assert(current.version===input.baseVersion,"RULE_COHORT_CONFIG_VERSION_MISMATCH",412);
   const end=retentionExpiry(this.policy,"CONFIG",now,new Date(current.expiresAt));
   return reviseNativeCohortConfig(tx,s,{sourceId,...input,enabled:false,definition:current.definition},now,end);
  });
 }
 /** Internal, authorized adapter entry. Browser requests cannot submit Facts. */
 async snapshotFromAdapter(s:Scope,a:Actor,adapter:{confirmed:boolean;sourceTypes:readonly string[];read(tx:Tx,s:Scope):Promise<{facts:readonly FactSnapshot[];sourceHealth:readonly SourceHealthObservation[]}>}){
  assert(adapter.confirmed,"SOURCE_ADAPTER_NOT_CONFIRMED",409);
  return this.transaction(s,a,"ANALYZE",async(tx,now)=>{
   const fact=retentionExpiry(this.policy,"FACT",now),sourceHealth=retentionExpiry(this.policy,"SOURCE_HEALTH",now),data=await adapter.read(tx,s);
   assert(data.facts.every(f=>adapter.sourceTypes.includes(f.sourceType))&&data.sourceHealth.every(h=>adapter.sourceTypes.includes(h.sourceType)),"SOURCE_ADAPTER_SCOPE_MISMATCH",403);
   await persistRuleFacts(tx,s,data.facts,data.sourceHealth,now,{fact,sourceHealth});
   return {snapshotIds:[...new Set(data.facts.map(f=>f.snapshotId))],sourceHealthIds:data.sourceHealth.map(h=>h.observationId)};
  });
 }
 async snapshot(s:Scope,a:Actor,id:string){z.uuid().parse(id);return this.transaction(s,a,"ANALYZE",async(tx,now)=>{
  const row=(await sql<{id:string;state:string;content_hash:string;captured_at:Date;expires_at:Date}>`SELECT id,state,content_hash,captured_at,expires_at FROM rule_fact_snapshots WHERE ${tenant(s)} AND id=${id}::uuid AND state='SEALED' AND expires_at>${now}`.execute(tx)).rows[0];assert(row,"TARGET_NOT_FOUND",404);
  return {snapshotId:row.id,state:row.state,contentHash:row.content_hash,capturedAt:row.captured_at.toISOString(),expiresAt:row.expires_at.toISOString()};
 });}
 async createDraft(s:Scope,a:Actor,id:string,expected:number,request:{liveVersion:string;changes:unknown},key?:string){
  return this.transaction(s,a,"CONFIGURE",async(tx,now)=>{
   return this.mutation(tx,s,a,{operation:"SUGGESTION_DRAFT",targetId:id,expectedVersion:expected,payload:request},key,now,async()=>{
   // Scope locks precede all rows; the target is locked before the Suggestion.
   const observed=await this.suggestion(tx,s,a,id,now);assert(observed.action_mode==="CREATE_DRAFT","SUGGESTION_REVIEW_ONLY",409);const adapter=this.requireDraftAdapter(observed.target_type);
   const safety=await this.draftSafety(tx,s,observed,now,true);
   const current=await adapter.lockCurrent(tx,s,observed.target_id);
   const row=await this.suggestion(tx,s,a,id,now,true);assert(row.version===expected,"SUGGESTION_VERSION_MISMATCH",412);assert(current.version===request.liveVersion&&row.live_version===request.liveVersion&&safety.live_version===request.liveVersion,"TARGET_VERSION_MISMATCH",412);
   assert(row.state==="ACTIVE"&&row.actionable_until>now,"SUGGESTION_NOT_APPLICABLE",409);
   const changes=adapter.validateFields(request.changes);assert(digest(changes)===digest(row.action_payload),"DRAFT_CONTENT_NOT_APPROVED",409);
   const end=retentionExpiry(this.policy,"DRAFT_LINK",now,row.actionable_until),draft=await adapter.createDraft(tx,s,a,row.target_id,current.version,changes);
   await sql`INSERT INTO rule_suggestion_draft_links VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${draft.draftId},${draft.immutableRevisionId},${draft.contentHash},${current.version},${expected},${now},${end})`.execute(tx);
   await this.event(tx,s,id,"DRAFT_CREATED",now,row.history_expires_at,digest(draft));
   // Native draft and link/history are one transaction. A permission or expiry
   // failure after native work rolls all of them back instead of leaving an
   // unlinked draft behind.
   await operationsAccess(tx,s,a,"CONFIGURE");
   const completedAt=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
   assert(this.authorizationProof&&this.authorizationProof.expiresAt>completedAt,"AUTHZ_UNAVAILABLE",403);
   assert(row.actionable_until>completedAt&&end>completedAt,"SUGGESTION_NOT_APPLICABLE",409);
   await this.draftSafety(tx,s,row,completedAt);
   return {reference:{kind:"DRAFT",suggestionId:id,draftId:draft.draftId,immutableRevisionId:draft.immutableRevisionId},response:draft};
   },async ref=>{
    assert(ref.kind==="DRAFT"&&ref.suggestionId===id,"IDEMPOTENCY_INTENT_GONE",410);const row=await this.suggestion(tx,s,a,id,now);
    await this.draftSafety(tx,s,row,now);
    const link=(await sql<{draft_id:string;immutable_revision_id:string;content_hash:string}>`SELECT draft_id,immutable_revision_id,content_hash FROM rule_suggestion_draft_links WHERE ${tenant(s)} AND suggestion_id=${id}::uuid AND draft_id=${ref.draftId} AND immutable_revision_id=${ref.immutableRevisionId} AND expires_at>${now}`.execute(tx)).rows[0];assert(link,"IDEMPOTENCY_INTENT_GONE",410);
    return {draftId:link.draft_id,immutableRevisionId:link.immutable_revision_id,contentHash:link.content_hash};
   });
  });
 }
 async operation(s:Scope,a:Actor,id:string){z.uuid().parse(id);return this.transaction(s,a,"READ",async(tx,now)=>{
  const row=(await sql<{id:string;target_type:string;target_id:string;state:string;created_at:Date;send_admitted_at:Date|null;terminal_at:Date|null;suggestion_id:string}>`SELECT id,target_type,target_id,state,created_at,send_admitted_at,terminal_at,suggestion_id FROM rule_runtime_intents WHERE ${tenant(s)} AND id=${id}::uuid AND expires_at>${now}`.execute(tx)).rows[0];assert(row,"TARGET_NOT_FOUND",404);
  await this.suggestion(tx,s,a,row.suggestion_id,now);return {operationId:row.id,target:{targetType:row.target_type,targetId:row.target_id},status:row.state,requestedAt:row.created_at.toISOString(),admittedAt:row.send_admitted_at?.toISOString()??null,terminalAt:row.terminal_at?.toISOString()??null,retryAllowed:false};
 });}
 async apply(s:Scope,a:Actor,id:string,expected:number,raw:unknown){const request=applyRequest.parse(raw);return this.transaction(s,a,"CONFIGURE",async(tx,now)=>{
  const row=await this.suggestion(tx,s,a,id,now);assert(row.version===expected,"SUGGESTION_VERSION_MISMATCH",412);assert(row.live_version===request.liveVersion,"TARGET_VERSION_MISMATCH",412);retentionExpiry(this.policy,"TARGET_LIVE_SAFETY",now);
  // Initial catalog has no activation/side-effect action. No operation is queued.
  assert(false,"APPLY_ACTION_NOT_REGISTERED",409);
 });}
}
