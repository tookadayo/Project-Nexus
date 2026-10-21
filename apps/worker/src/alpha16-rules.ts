import { randomUUID } from "node:crypto";
import { sql, tenant, type Database, type Tx } from "../../../packages/db/src/index";
import { assert, type Scope } from "../../../packages/shared/src/index";
import type { Actor } from "../../../packages/settings/src/index";
import { operationsAccess,actorPermissions } from "../../../packages/operations/src/policy";
import { readOperatorDispatchGate } from "../../../packages/security/src/alpha16-operator";
import { acquireRuleScopeLocks, ruleScopeLockSet } from "../../../packages/rules/src/locks";
import { loadRuleFacts, type RuleFactStorageRefs } from "../../../packages/rules/src/fact-storage";
import { sealRuleInput, hashRuleValue, type RuleId, type RuleVersionSet, type RuleResult, type RuleTarget,type RuleCooldown } from "../../../packages/rules/src/facts";
import { evaluatePlatform,platformInputHash } from "../../../packages/rules/src/pipeline";
import {loadCaseContexts,type CaseContextRef,type SealedCaseRequest} from "../../../packages/rules/src/case-storage";
import type {CaseEvaluation} from "../../../packages/rules/src/case-types";
import {CASE_CATALOG} from "../../../packages/rules/src/catalog";
import {calendarRelativeInstant} from "../../../packages/automation/src/datetime";
import { validateRuleConfig, type RuleEngineConfig } from "../../../packages/rules/src/rule-config";
import { PLATFORM_VERSIONS, digest, retentionExpiry, type PlatformPolicy } from "../../../packages/rules/src/domain";
import type { EvaluationJob } from "../../../packages/rules/src/service";

export interface RuleWorkerOptions {
 policy:PlatformPolicy;
 runtime:{approved:boolean;leaseSeconds:number;maxClaims:number};
 /** Live authorization is obtained outside the DB transaction. The returned
  * proof expires; the same stale Actor is never reused after evaluation. */
 authorize(s:Scope,actorHash:string):Promise<{actor:Actor;expiresAt:Date}>;
 /** Registered DB metadata reader. No external operation occurs under locks.
  * Without a reader, proposal visibility records UNKNOWN explicitly. */
 readTarget?(tx:Tx,s:Scope,target:RuleTarget):Promise<CurrentProposalTarget>;
}
export interface CurrentProposalTarget {state:"PRESENT"|"MISSING"|"UNKNOWN";liveVersion:string|null;}
interface JobDescriptor {refs:RuleFactStorageRefs;targets:readonly RuleTarget[];ruleTargets?:readonly RuleTarget[];requestedRuleIds:RuleId[];requestedCaseIds?:readonly string[];requestedContextIds?:readonly string[];versions:RuleVersionSet;sealedInputHash:string;caseRefs:CaseContextRef[];caseAggregateBudget:{maxSteps:number;maxOperations:number;maxInputs:number}|null;}
type ExactJob=EvaluationJob&{evaluation_as_of_exact:string};
const exactAsOf=sql.raw(`to_char(evaluation_as_of AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
/** Calendar gaps fail closed; folds choose the later occurrence explicitly.
 * The resolved deadline is stored once, so later tzdata cannot reinterpret it. */
export function resolveRuleCooldown(createdAt:Date,cooldown:RuleCooldown):Date{
 assert(Number.isSafeInteger(cooldown.value)&&cooldown.value>0,"COOLDOWN_NOT_APPROVED",409);
 const end=cooldown.unit==="SECOND"?new Date(createdAt.getTime()+cooldown.value*1000):new Date(calendarRelativeInstant(createdAt.toISOString(),cooldown.value,cooldown.timeZone,"later"));
 assert(Number.isFinite(end.getTime())&&end>createdAt,"COOLDOWN_NOT_RESOLVED",409);return end;
}
/** PG is the job authority. A queue may deliver this UUID repeatedly; claiming
 * and finalization are CAS fenced. No external action occurs in this worker. */
export class RuleEvaluationWorker {
 constructor(readonly db:Database,readonly options:RuleWorkerOptions){}
 private async access(tx:Tx,s:Scope,a:Actor,expiresAt:Date,now:Date){
  assert(expiresAt>now,"AUTHZ_UNAVAILABLE",403);
  await operationsAccess(tx,s,a,"ANALYZE");
  assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND (lookup_hash IS NULL OR lookup_hash=${a.key}) LIMIT 1`.execute(tx)).rows.length,"RESOURCE_DELETED",410);
  const gate=await readOperatorDispatchGate(tx,s);assert(gate.allowed,"OPERATOR_DISPATCH_STOPPED",409);
  const current=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
  assert(expiresAt>current,"AUTHZ_UNAVAILABLE",403);return current;
 }
 async process(s:Scope,id:string){
  const options=this.options;
  assert(options.runtime.approved&&Number.isSafeInteger(options.runtime.leaseSeconds)&&options.runtime.leaseSeconds>0&&Number.isSafeInteger(options.runtime.maxClaims)&&options.runtime.maxClaims>0,"RUNTIME_CONFIG_NOT_APPROVED",409);
  retentionExpiry(options.policy,"EVALUATION",new Date());
  const observed=(await sql<EvaluationJob>`SELECT * FROM rule_evaluation_jobs WHERE ${tenant(s)} AND id=${id}::uuid AND expires_at>clock_timestamp()`.execute(this.db)).rows[0];
  assert(observed?.actor_hash,"TARGET_NOT_FOUND",404);
  const actorHash=observed.actor_hash,first=await options.authorize(s,actorHash),lease=randomUUID();assert(first.actor.key===actorHash,"AUTHZ_SUBJECT_MISMATCH",403);
  const claimed=await this.db.transaction().execute(async tx=>{
   await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));const now=await this.access(tx,s,first.actor,first.expiresAt,new Date());
   const job=(await sql<ExactJob>`SELECT *,${exactAsOf} AS evaluation_as_of_exact FROM rule_evaluation_jobs WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(tx)).rows[0];assert(job&&job.expires_at>now,"TARGET_NOT_FOUND",404);assert(job.actor_hash===actorHash,"AUTHZ_SUBJECT_MISMATCH",403);
   if(job.state==="CANCEL_REQUESTED"){await sql`UPDATE rule_evaluation_jobs SET state='CANCELLED',finished_at=${now},row_version=row_version+1 WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx);return null;}
   if(job.state!=="QUEUED"&&!(job.state==="RUNNING"&&job.lease_until&&job.lease_until<=now))return null;
   assert(job.attempt_count<options.runtime.maxClaims,"EVALUATION_CLAIMS_EXHAUSTED",409);
   const saved=(await sql<{definition:RuleEngineConfig;content_hash:string;expires_at:Date}>`SELECT definition,content_hash,expires_at FROM rule_config_versions WHERE ${tenant(s)} AND version=${job.config_version} AND state='ACTIVE' AND approved_at IS NOT NULL AND expires_at>${now} AND operating_profile_expires_at>${now}`.execute(tx)).rows[0];assert(saved,"DISABLED_CONFIG",409);validateRuleConfig(saved.definition);
   assert(saved.definition.profile==="OPERATIONAL"&&saved.definition.approval==="APPROVED"&&saved.definition.retentionApproved&&saved.content_hash===job.versions.configHash,"DISABLED_CONFIG",409);
   const descriptor=job.inputs as JobDescriptor;
   assert(descriptor.refs&&descriptor.targets&&descriptor.versions&&descriptor.sealedInputHash,"INPUT_NOT_SEALED",409);
   const data=await loadRuleFacts(tx,s,descriptor.refs);
   const input=sealRuleInput({guildId:s.guildId,evaluationAsOf:job.evaluation_as_of_exact,versions:descriptor.versions,requestedRuleIds:descriptor.requestedRuleIds,...data,targets:descriptor.targets,...(descriptor.ruleTargets!==undefined?{ruleTargets:descriptor.ruleTargets}:{})});
   const cases=await loadCaseContexts(tx,s,descriptor.caseRefs??[],input.evaluationAsOf);
   if(descriptor.requestedContextIds)assert(new Set(descriptor.requestedContextIds).size===descriptor.requestedContextIds.length&&descriptor.requestedContextIds.length===cases.length&&descriptor.requestedContextIds.every(id=>cases.some(entry=>entry.context.contextId===id)),"CASE_CONTEXT_SELECTION_MISMATCH",409);
   if(descriptor.requestedCaseIds)assert(descriptor.requestedCaseIds.length===cases.length&&descriptor.requestedCaseIds.every(id=>cases.some(entry=>entry.caseId===id)),"CASE_CONTEXT_SELECTION_MISMATCH",409);
   const allowed=await actorPermissions(tx,s,first.actor);assert(cases.every(c=>c.context.permissions.every(p=>allowed.some(permission=>permission===p))),"PERMISSION_DENIED",403);
   assert(input.inputHash===descriptor.sealedInputHash&&platformInputHash(input.inputHash,descriptor.caseRefs??[],descriptor.caseAggregateBudget??null)===job.input_hash,"INPUT_HASH_MISMATCH",409);
   const until=new Date(Math.min(now.getTime()+options.runtime.leaseSeconds*1000,job.expires_at.getTime()));
   await sql`UPDATE rule_evaluation_jobs SET state='RUNNING',lease_token=${lease}::uuid,lease_until=${until},attempt_count=attempt_count+1,row_version=row_version+1 WHERE ${tenant(s)} AND id=${id}::uuid AND row_version=${job.row_version}`.execute(tx);
   return {job,input,cases,caseAggregateBudget:descriptor.caseAggregateBudget??null,config:saved.definition,configHash:saved.content_hash};
  });
  if(!claimed)return {status:"NOT_CLAIMED"};
  const result=evaluatePlatform({input:claimed.input,config:claimed.config,cases:claimed.cases,aggregateBudget:claimed.caseAggregateBudget});
  const fresh=await options.authorize(s,actorHash);assert(fresh.actor.key===actorHash,"AUTHZ_SUBJECT_MISMATCH",403);
  return this.db.transaction().execute(async tx=>{
   await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));const now=await this.access(tx,s,fresh.actor,fresh.expiresAt,new Date());
   // Target roots and guards are inspected before the job/evaluation rows. The
   // guild scope lock serializes all participating v16 writers and deletion.
   await sql`SELECT target_type,target_id FROM rule_target_safety WHERE ${tenant(s)} ORDER BY target_type,target_id FOR UPDATE`.execute(tx);
   const targetStates=new Map<string,CurrentProposalTarget>();
   for(const target of claimed.input.targets){
    const current=await options.readTarget?.(tx,s,target)??{state:"UNKNOWN" as const,liveVersion:null};
    assert(["PRESENT","MISSING","UNKNOWN"].includes(current.state)&&(current.state==="PRESENT"?typeof current.liveVersion==="string"&&/^[A-Za-z0-9_.:-]{1,128}$/.test(current.liveVersion):current.liveVersion===null),"TARGET_METADATA_INVALID",409);
    targetStates.set(digest(target),current);
   }
   // Existing lower-ranked rows are locked as a fixed set before Evaluation.
   // The exclusive guild scope covers absent Suggestion identities as well.
   await sql`SELECT id FROM rule_suggestions WHERE ${tenant(s)} ORDER BY target_type,target_id,id FOR UPDATE`.execute(tx);
   const job=(await sql<ExactJob>`SELECT *,${exactAsOf} AS evaluation_as_of_exact FROM rule_evaluation_jobs WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(tx)).rows[0];
   assert(job&&job.lease_token===lease&&job.lease_until&&job.lease_until>now&&job.expires_at>now,"STALE_WORKER",409);
   assert(job.actor_hash===actorHash,"AUTHZ_SUBJECT_MISMATCH",403);
   if(job.state==="CANCEL_REQUESTED"){await sql`UPDATE rule_evaluation_jobs SET state='CANCELLED',finished_at=${now},row_version=row_version+1 WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx);return {status:"CANCELLED"};}
   assert(job.state==="RUNNING","STATE_CONFLICT",409);
   const config=(await sql<{content_hash:string}>`SELECT content_hash FROM rule_config_versions WHERE ${tenant(s)} AND version=${job.config_version} AND state='ACTIVE' AND approved_at IS NOT NULL AND expires_at>${now} AND operating_profile_expires_at>${now}`.execute(tx)).rows[0];assert(config?.content_hash===claimed.configHash,"CONFIG_CHANGED",409);
   // Re-read exactly the sealed references for expiry/deletion before publish;
   // never replace them with newer observations.
   const descriptor=job.inputs as JobDescriptor;await loadRuleFacts(tx,s,descriptor.refs);
   const reloadedCases=await loadCaseContexts(tx,s,descriptor.caseRefs??[],job.evaluation_as_of_exact);
   const allowed=await actorPermissions(tx,s,fresh.actor);assert(reloadedCases.every(c=>c.context.permissions.every(p=>allowed.some(permission=>permission===p))),"PERMISSION_DENIED",403);
   assert(result.inputHash===job.input_hash,"INPUT_HASH_MISMATCH",409);
   const incomplete=!result.complete||!result.publishable;
   if(incomplete){await sql`UPDATE rule_evaluation_jobs SET state='FAILED',finished_at=${now},failure_code=${result.reasonCodes[0]??'REQUIRED_INPUT_INCOMPLETE'},row_version=row_version+1 WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx);return {status:"FAILED",reasonCode:result.reasonCodes[0]??"REQUIRED_INPUT_INCOMPLETE"};}
   for(const finding of result.ruleOutput.results){
    const resultId=randomUUID(),expires=new Date(Math.min(job.expires_at.getTime(),retentionExpiry(options.policy,"EVALUATION",now).getTime()));
    await sql`INSERT INTO rule_evaluation_results(organization_id,guild_id,id,job_id,rule_id,target_type,target_id,live_version,result,reason_code,result_hash,payload,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${resultId}::uuid,${id}::uuid,${finding.ruleId},${finding.target.targetType},${finding.target.targetId},${finding.target.liveVersion},${finding.decision},${finding.reasonCodes[0]??'EVALUATED'},${hashRuleValue(finding)},${JSON.stringify(finding)}::jsonb,${expires})`.execute(tx);
    if(finding.decision!=="FIRE")continue;
    if(result.supersededRuleHashes.includes(hashRuleValue(finding)))continue;
    const current=targetStates.get(digest(finding.target))??{state:"UNKNOWN" as const,liveVersion:null};
    await this.publish(tx,s,job,finding,resultId,now,expires,current);
   }
   for(const finding of result.caseResults){
    const snapshot=reloadedCases.find(c=>c.caseId===finding.caseId),target=snapshot?.context.target??{targetType:"GUILD",targetId:s.guildId,liveVersion:null},resultId=randomUUID(),expires=new Date(Math.min(job.expires_at.getTime(),retentionExpiry(options.policy,"EVALUATION",now).getTime()));
    await sql`INSERT INTO rule_evaluation_results(organization_id,guild_id,id,job_id,rule_id,target_type,target_id,live_version,result,reason_code,result_hash,payload,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${resultId}::uuid,${id}::uuid,${finding.caseId},${target.targetType},${target.targetId},${target.liveVersion},${finding.outcome==="ACTION"?'FIRE':finding.outcome==="DISABLED"?'DISABLED':finding.outcome==="INELIGIBLE"?'INELIGIBLE':'NO_FIRE'},${finding.reasonCode},${finding.canonicalHash},${JSON.stringify(finding)}::jsonb,${expires})`.execute(tx);
    if(!snapshot||!finding.action||!finding.publishable)continue;
    const current=targetStates.get(digest(target))??{state:"UNKNOWN" as const,liveVersion:null};
    await this.publishCase(tx,s,finding,snapshot,resultId,now,expires,current);
   }
   await sql`UPDATE rule_evaluation_jobs SET state='SUCCEEDED',finished_at=${now},row_version=row_version+1 WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx);
   return {status:"SUCCEEDED",ruleCount:result.ruleOutput.results.length,caseCount:result.caseResults.length};
  });
 }
 private async publish(tx:Tx,s:Scope,job:EvaluationJob,f:RuleResult,resultId:string,now:Date,resultExpiry:Date,current:CurrentProposalTarget){
  const policy=this.options.policy,historyEnd=retentionExpiry(policy,"SUGGESTION",now),end=new Date(Math.min(resultExpiry.getTime(),Date.parse(f.actionableUntil??now.toISOString()),historyEnd.getTime()));
  assert(end>now,"EVIDENCE_EXPIRED",409);
  const actionId="REVIEW_"+f.ruleId.replaceAll("-","_"),blocked=(await sql`SELECT 1 FROM rule_lineage_suppressions WHERE ${tenant(s)} AND lineage_key=${f.lineageKey} AND action_class=${actionId} AND kind='SHARED_REJECT' AND expires_at>${now}`.execute(tx)).rows.length;
  if(blocked)return;
  const dedupe=digest({target:f.target,rule:f.ruleId,ruleVersion:f.ruleVersion,versions:job.versions,windowStart:f.windowStart,windowEnd:f.windowEnd,issue:f.issueCode});
  const old=(await sql<{id:string;state:string}>`SELECT id,state FROM rule_suggestions WHERE ${tenant(s)} AND dedupe_key=${dedupe}`.execute(tx)).rows[0];
  if(old){await sql`UPDATE rule_suggestions SET last_observed_at=${now} WHERE ${tenant(s)} AND id=${old.id}::uuid`.execute(tx);return;}
  if((await sql`SELECT 1 FROM rule_suggestions WHERE ${tenant(s)} AND lineage_key=${f.lineageKey} AND action_id=${actionId} AND cooldown_until>${now} LIMIT 1`.execute(tx)).rows.length)return;
  assert(f.cooldown,"COOLDOWN_NOT_APPROVED",409);const cooldownUntil=resolveRuleCooldown(now,f.cooldown);assert(cooldownUntil<=historyEnd,"COOLDOWN_EXCEEDS_APPROVED_HISTORY",409);
  const id=randomUUID();
  const changed=current.state==="PRESENT"&&current.liveVersion!==f.target.liveVersion;
  const explanation={reasonCodes:f.reasonCodes,hypothesis:null,action:"REVIEW_ONLY",ownerRole:"SERVER_OPERATOR",caution:"OBSERVATION_IS_NOT_CAUSAL_EVIDENCE",reviewCondition:"REASSESS_SAME_DEFINITION_AND_WINDOW",currentTarget:current,constraints:["REVIEW_ONLY_NO_EFFECT",...(current.state==="PRESENT"?changed?["TARGET_VERSION_CHANGED"]:[]:["TARGET_"+current.state])],localized:{ja:"確認された観測と設定条件に基づく見直し案です。原因や改善効果は確定していません。",en:"Review the recorded observations and configured conditions. Causes and improvement effects remain unconfirmed."}};
  await sql`INSERT INTO rule_suggestions(organization_id,guild_id,id,target_type,target_id,live_version,evaluation_result_id,evaluation_ref_hash,evaluation_as_of,rule_id,versions,window_start,window_end,issue_code,dedupe_key,lineage_key,action_id,action_mode,action_payload,explanation,state,audience,created_at,last_observed_at,actionable_until,history_expires_at,cooldown_until,cooldown_metadata,invalidated_reason) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${f.target.targetType},${f.target.targetId},${f.target.liveVersion},${resultId}::uuid,${hashRuleValue(f)},${job.evaluation_as_of},${f.ruleId},${JSON.stringify(job.versions)}::jsonb,${f.windowStart}::timestamptz,${f.windowEnd}::timestamptz,${f.issueCode},${dedupe},${f.lineageKey},${actionId},'REVIEW_ONLY','{}'::jsonb,${JSON.stringify(explanation)}::jsonb,${changed?'INVALIDATED':'ACTIVE'},${['PERM-001','AUTO-001','AUTO-002'].includes(f.ruleId)?'RESTRICTED':'GUILD'},${now},${now},${changed?now:end},${historyEnd},${cooldownUntil},${JSON.stringify(f.cooldown)}::jsonb,${changed?'TARGET_VERSION_CHANGED':null})`.execute(tx);
  for(const snapshotId of new Set(f.evidenceRefs.map(r=>r.snapshotId)))await sql`INSERT INTO rule_suggestion_evidence(organization_id,guild_id,suggestion_id,id,kind,snapshot_id,reference_hash,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${randomUUID()}::uuid,'FACT',${snapshotId}::uuid,${digest({snapshotId})},${end})`.execute(tx);
  for(const ref of f.sourceHealthRefs)await sql`INSERT INTO rule_suggestion_evidence(organization_id,guild_id,suggestion_id,id,kind,health_id,reference_hash,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${randomUUID()}::uuid,'SOURCE_HEALTH',${ref.observationId}::uuid,${digest(ref)},${end})`.execute(tx);
  await sql`INSERT INTO rule_suggestion_history VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${randomUUID()}::uuid,1,'CREATED',${hashRuleValue(f)},${now},${retentionExpiry(policy,"HISTORY",now,historyEnd)})`.execute(tx);
 }
 private async publishCase(tx:Tx,s:Scope,result:CaseEvaluation,snapshot:SealedCaseRequest,resultId:string,now:Date,resultExpiry:Date,current:CurrentProposalTarget){
  const action=result.action,explanation=result.explanation;assert(action&&explanation&&result.publishable&&snapshot.profile.kind==="OPERATIONAL","CASE_NOT_PUBLISHABLE",409);
  const definition=CASE_CATALOG.find(c=>c.id===result.caseId)!,template=definition.explanations.find(e=>e.id===explanation.explanationId)!;
  const policy=this.options.policy,historyEnd=retentionExpiry(policy,"SUGGESTION",now),end=new Date(Math.min(historyEnd.getTime(),resultExpiry.getTime(),Date.parse(snapshot.seal.expiresAt),Date.parse(action.actionableUntil)));
  assert(end>now,"EVIDENCE_EXPIRED",409);
  const lineage=digest({organizationId:s.organizationId,guildId:s.guildId,targetType:action.target.targetType,targetId:action.target.targetId,issueCode:result.reasonCode,metricScope:result.caseId});
  const blocked=(await sql`SELECT 1 FROM rule_lineage_suppressions WHERE ${tenant(s)} AND lineage_key=${lineage} AND action_class=${action.actionId} AND kind='SHARED_REJECT' AND expires_at>${now}`.execute(tx)).rows.length;
  if(blocked)return;
  const dedupe=digest({target:action.target,caseId:result.caseId,caseRevision:definition.revision,versions:snapshot.context.versions,window:snapshot.context.window,issue:result.reasonCode,actionId:action.actionId});
  const old=(await sql<{id:string}>`SELECT id FROM rule_suggestions WHERE ${tenant(s)} AND dedupe_key=${dedupe}`.execute(tx)).rows[0];
  if(old){await sql`UPDATE rule_suggestions SET last_observed_at=${now} WHERE ${tenant(s)} AND id=${old.id}::uuid`.execute(tx);return;}
  if((await sql`SELECT 1 FROM rule_suggestions WHERE ${tenant(s)} AND lineage_key=${lineage} AND action_id=${action.actionId} AND cooldown_until>${now} LIMIT 1`.execute(tx)).rows.length)return;
  const configured=snapshot.profile.values[result.caseId+".cooldownSeconds"];assert(configured?.unit==="seconds"&&typeof configured.value==="number","CASE_COOLDOWN_NOT_APPROVED",409);
  const cooldown:RuleCooldown={unit:"SECOND",value:configured.value},cooldownUntil=resolveRuleCooldown(now,cooldown),id=randomUUID();
  assert(cooldownUntil<=historyEnd,"COOLDOWN_EXCEEDS_APPROVED_HISTORY",409);
  // Fixed registry slots and digests survive as minimal history. Observation
  // values stay in their independently expiring typed context columns.
  const changed=current.state==="PRESENT"&&current.liveVersion!==action.target.liveVersion;
  const savedExplanation={explanationId:template.id,explanationVersion:template.version,observation:explanation.observation,branchReason:explanation.branchReason,hypothesis:explanation.hypothesis,action:action.actionId,ownerRole:action.ownerRole,caution:explanation.caution,alternative:explanation.alternative,reviewCondition:explanation.reviewCondition,branchPath:result.branchPath,localized:template.translations??null,sourceRefs:definition.provenance,evidenceDigest:digest(action.evidenceRefs),audience:action.audience,currentTarget:current,constraints:["REVIEW_ONLY_NO_EFFECT",...(current.state==="PRESENT"?changed?["TARGET_VERSION_CHANGED"]:[]:["TARGET_"+current.state])]};
  await sql`INSERT INTO rule_suggestions(organization_id,guild_id,id,target_type,target_id,live_version,evaluation_result_id,evaluation_ref_hash,evaluation_as_of,rule_id,versions,window_start,window_end,issue_code,dedupe_key,lineage_key,action_id,action_mode,action_payload,explanation,state,audience,created_at,last_observed_at,actionable_until,history_expires_at,cooldown_until,cooldown_metadata,invalidated_reason) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${action.target.targetType},${action.target.targetId},${action.target.liveVersion},${resultId}::uuid,${result.canonicalHash},${snapshot.context.evaluationAsOf}::timestamptz,${result.caseId},${JSON.stringify(snapshot.context.versions)}::jsonb,${snapshot.context.window.start}::timestamptz,${snapshot.context.window.end}::timestamptz,${result.reasonCode},${dedupe},${lineage},${action.actionId},'REVIEW_ONLY','{}'::jsonb,${JSON.stringify(savedExplanation)}::jsonb,${changed?'INVALIDATED':'ACTIVE'},${action.audience==="RESTRICTED_STAFF"?'RESTRICTED':'GUILD'},${now},${now},${changed?now:end},${historyEnd},${cooldownUntil},${JSON.stringify(cooldown)}::jsonb,${changed?'TARGET_VERSION_CHANGED':null})`.execute(tx);
  await sql`INSERT INTO rule_suggestion_evidence(organization_id,guild_id,suggestion_id,id,kind,case_context_id,reference_hash,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${randomUUID()}::uuid,'CASE_CONTEXT',${snapshot.seal.snapshotId}::uuid,${snapshot.seal.contentHash},${end})`.execute(tx);
  await sql`INSERT INTO rule_suggestion_history VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${randomUUID()}::uuid,1,'CREATED',${result.canonicalHash},${now},${retentionExpiry(policy,"HISTORY",now,historyEnd)})`.execute(tx);
 }
}

export const alpha16RuleWorkerReadiness={enabled:false,reasonCodes:["RETENTION_NOT_APPROVED","RUNTIME_CONFIG_NOT_APPROVED","SOURCE_MAPPINGS_NOT_CONFIRMED","OPERATOR_CONTROLS_NOT_CONFIGURED"],versions:PLATFORM_VERSIONS} as const;
