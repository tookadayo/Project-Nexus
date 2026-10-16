import {z} from "zod";
import {sql,tenant,type Database,type Tx} from "../../db/src/index";
import {assert,type Scope} from "../../shared/src/index";
import type {Actor} from "../../settings/src/index";
import {operationsAccess} from "../../operations/src/policy";
import {assertMaintenanceAuthorization,type MaintenanceAuthorizationProof} from "../../operations/src/maintenance-authorization";
import {minimalOperationAudit} from "../../operations/src/alpha16-audit";
import {acquireRuleScopeLocks,ruleScopeLockSet} from "./locks";
import {BASE_ISSUE_CODES,BASE_RULE_IDS,RULE_CATALOG} from "./rule-catalog";
import {canonicalRuleTimestamp,canonicalRuleJson,hashRuleValue,immutableSourceHealthId,timestampMicros,type FactValue,type RuleResult,type RuleTarget} from "./facts";
import type {NativeProjectionCandidate} from "./native-projections";
import {issueRegistryInput,issueRegistryRemoval} from "./issue-registry-contract";
export {issueRegistryInput,issueRegistryRemoval} from "./issue-registry-contract";
type RegistryRow={id:string;version:number;issue_code:string;base_rule_id:string;base_target_type:string;base_target_id:string;base_live_version:string;
 experiment_ids:string[];playbook_ids:string[];experiments_complete:boolean;playbooks_complete:boolean;experiment_inventory_hash:string;playbook_inventory_hash:string;declared_at:Date;expires_at:Date;};
type InventoryItem={id:string;version:number;state:string;hash:string};
const iso=(value:Date)=>canonicalRuleTimestamp(value.toISOString());
const earlier=(...values:string[])=>values.reduce((a,b)=>timestampMicros(a)<=timestampMicros(b)?a:b);
const baseTarget=(row:RegistryRow):RuleTarget=>({targetType:row.base_target_type,targetId:row.base_target_id,liveVersion:row.base_live_version});
export const issueRegistryTarget=(row:RegistryRow):RuleTarget=>({targetType:"ISSUE_TARGET",targetId:row.id,liveVersion:hashRuleValue({version:row.version,issueCode:row.issue_code,baseTarget:baseTarget(row)})});
const dto=(row:RegistryRow)=>({id:row.id,version:row.version,issueCode:row.issue_code,baseTarget:baseTarget(row),experimentIds:row.experiment_ids,playbookIds:row.playbook_ids,
 experimentsComplete:row.experiments_complete,playbooksComplete:row.playbooks_complete,target:issueRegistryTarget(row),declaredAt:row.declared_at.toISOString(),expiresAt:row.expires_at.toISOString()});
async function clock(tx:Tx){return (await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;}
async function inventory(tx:Tx,s:Scope){
 // The native control contract treats a missing experiment control as running.
 // It does not establish relevance: that requires the separate explicit map.
 const experiments=(await sql<InventoryItem>`SELECT r.id,r.version,COALESCE(c.state,'running') AS state,r.hash FROM guild_config_revisions r LEFT JOIN experiment_controls c ON c.organization_id=r.organization_id AND c.guild_id=r.guild_id AND c.revision_id=r.id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.domain='experiment' AND r.state='published' ORDER BY r.id LIMIT 201`.execute(tx)).rows;
 const playbooks=(await sql<InventoryItem>`SELECT p.id,p.version,p.state,r.definition::text AS hash FROM playbooks p JOIN playbook_revisions r ON r.organization_id=p.organization_id AND r.guild_id=p.guild_id AND r.id=p.head_id WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId} ORDER BY p.id LIMIT 201`.execute(tx)).rows;
 assert(experiments.length<=200&&playbooks.length<=200,"ISSUE_REGISTRY_INVENTORY_LIMIT",409);
 const normalize=(rows:InventoryItem[])=>rows.map(row=>({...row,hash:hashRuleValue(row.hash)}));
 return {experiments:normalize(experiments),playbooks:normalize(playbooks)};
}
export class RuleIssueRegistry{
 constructor(private readonly db:Database,private readonly options:{authorization?:MaintenanceAuthorizationProof}={}){}
 private async transaction<T>(s:Scope,a:Actor,write:boolean,work:(tx:Tx,now:Date)=>Promise<T>){return this.db.transaction().execute(async tx=>{
  await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));assertMaintenanceAuthorization(this.options.authorization,s,a,await clock(tx));
  await operationsAccess(tx,s,a,write?"CONFIGURE":"READ");
  assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND (lookup_hash IS NULL OR lookup_hash=${a.key}) LIMIT 1`.execute(tx)).rows.length,"RESOURCE_DELETED",410);
  const result=await work(tx,await clock(tx));assertMaintenanceAuthorization(this.options.authorization,s,a,await clock(tx));await operationsAccess(tx,s,a,write?"CONFIGURE":"READ");return result;
 });}
 async list(s:Scope,a:Actor){return this.transaction(s,a,false,async(tx,now)=>{
  const rows=(await sql<RegistryRow>`SELECT * FROM rule_issue_registry WHERE ${tenant(s)} AND expires_at>${now} ORDER BY issue_code,id LIMIT 100`.execute(tx)).rows;
  const all=await inventory(tx,s);
  const targets=(await sql<{issue_code:string;target_type:string;target_id:string;live_version:string}>`SELECT DISTINCT ON(r.rule_id,r.target_type,r.target_id,r.live_version) r.payload->>'issueCode' AS issue_code,r.target_type,r.target_id,r.live_version FROM rule_evaluation_results r JOIN rule_evaluation_jobs j ON j.organization_id=r.organization_id AND j.guild_id=r.guild_id AND j.id=r.job_id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND j.state='SUCCEEDED' AND j.expires_at>${now} AND r.expires_at>${now} AND r.rule_id IN (${sql.join(BASE_RULE_IDS)}) AND r.live_version IS NOT NULL ORDER BY r.rule_id,r.target_type,r.target_id,r.live_version,j.evaluation_as_of DESC LIMIT 200`.execute(tx)).rows;
  return {items:rows.map(dto),inventory:{experiments:all.experiments.map(({id,version,state})=>({id,version,state})),playbooks:all.playbooks.map(({id,version,state})=>({id,version,state}))},
   inventoryHashes:{experiments:hashRuleValue(all.experiments),playbooks:hashRuleValue(all.playbooks)},
   issueCodes:RULE_CATALOG.filter(r=>BASE_RULE_IDS.includes(r.ruleId)).map(r=>({issueCode:r.issueCode,ruleId:r.ruleId,targetType:r.targetType})),
   baseTargets:targets.filter(r=>BASE_ISSUE_CODES.includes(r.issue_code)).map(r=>({issueCode:r.issue_code,baseTarget:{targetType:r.target_type,targetId:r.target_id,liveVersion:r.live_version}})),observedAt:now.toISOString()};
 });}
 async save(s:Scope,a:Actor,raw:unknown){const input=issueRegistryInput.parse(raw);return this.transaction(s,a,true,async(tx,now)=>{
  const rule=RULE_CATALOG.find(r=>BASE_RULE_IDS.includes(r.ruleId)&&r.issueCode===input.issueCode);assert(rule&&rule.targetType===input.baseTarget.targetType,"ISSUE_REGISTRY_BASE_TARGET_INVALID",400);
  assert(new Set(input.experimentIds).size===input.experimentIds.length&&new Set(input.playbookIds).size===input.playbookIds.length,"ISSUE_REGISTRY_DUPLICATE",400);
  const prior=(await sql<RegistryRow>`SELECT * FROM rule_issue_registry WHERE ${tenant(s)} AND id=${input.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
  assert((prior?.version??0)===input.expectedVersion,"ISSUE_REGISTRY_VERSION_CONFLICT",409);
  assert(!(await sql`SELECT 1 FROM rule_issue_registry WHERE ${tenant(s)} AND issue_code=${input.issueCode} AND base_target_type=${input.baseTarget.targetType} AND base_target_id=${input.baseTarget.targetId} AND id<>${input.id}::uuid`.execute(tx)).rows.length,"ISSUE_REGISTRY_TARGET_ALREADY_CONFIGURED",409);
  const evidence=(await sql`SELECT 1 FROM rule_evaluation_results r JOIN rule_evaluation_jobs j ON j.organization_id=r.organization_id AND j.guild_id=r.guild_id AND j.id=r.job_id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.rule_id=${rule.ruleId} AND r.target_type=${input.baseTarget.targetType} AND r.target_id=${input.baseTarget.targetId} AND r.live_version=${input.baseTarget.liveVersion} AND r.expires_at>${now} AND j.expires_at>${now} AND j.state='SUCCEEDED' LIMIT 1`.execute(tx)).rows.length;
  assert(evidence,"ISSUE_REGISTRY_BASE_OBSERVATION_UNAVAILABLE",409);
  const all=await inventory(tx,s);
  assert(input.inventoryHashes.experiments===hashRuleValue(all.experiments)&&input.inventoryHashes.playbooks===hashRuleValue(all.playbooks),"ISSUE_REGISTRY_INVENTORY_CHANGED",409);
  assert(input.experimentIds.every(id=>all.experiments.some(r=>r.id===id))&&input.playbookIds.every(id=>all.playbooks.some(r=>r.id===id)),"ISSUE_REGISTRY_REFERENCE_UNAVAILABLE",409);
  if(input.experimentIds.length||input.experimentsComplete)await operationsAccess(tx,s,a,"CONFIGURE","experiments");
  if(input.playbookIds.length||input.playbooksComplete)await operationsAccess(tx,s,a,"CONFIGURE","playbooks");
  const expiresAt=new Date(now.getTime()+input.validForSeconds*1000),version=input.expectedVersion+1;
  const row=(await sql<RegistryRow>`INSERT INTO rule_issue_registry(organization_id,guild_id,id,version,issue_code,base_rule_id,base_target_type,base_target_id,base_live_version,experiment_ids,playbook_ids,experiments_complete,playbooks_complete,experiment_inventory_hash,playbook_inventory_hash,declared_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${input.id}::uuid,${version},${input.issueCode},${rule.ruleId},${input.baseTarget.targetType},${input.baseTarget.targetId},${input.baseTarget.liveVersion},${input.experimentIds}::uuid[],${input.playbookIds}::uuid[],${input.experimentsComplete},${input.playbooksComplete},${hashRuleValue(all.experiments)},${hashRuleValue(all.playbooks)},${now},${expiresAt}) ON CONFLICT(organization_id,guild_id,id) DO UPDATE SET version=EXCLUDED.version,issue_code=EXCLUDED.issue_code,base_rule_id=EXCLUDED.base_rule_id,base_target_type=EXCLUDED.base_target_type,base_target_id=EXCLUDED.base_target_id,base_live_version=EXCLUDED.base_live_version,experiment_ids=EXCLUDED.experiment_ids,playbook_ids=EXCLUDED.playbook_ids,experiments_complete=EXCLUDED.experiments_complete,playbooks_complete=EXCLUDED.playbooks_complete,experiment_inventory_hash=EXCLUDED.experiment_inventory_hash,playbook_inventory_hash=EXCLUDED.playbook_inventory_hash,declared_at=EXCLUDED.declared_at,expires_at=EXCLUDED.expires_at RETURNING *`.execute(tx)).rows[0]!;
  await minimalOperationAudit(tx,s,a.key,"RULE.ISSUE_REGISTRY.SAVE",input.id,version,now);return {id:row.id,version,target:issueRegistryTarget(row),expiresAt:expiresAt.toISOString()};
 });}
 async remove(s:Scope,a:Actor,raw:unknown){const input=issueRegistryRemoval.parse(raw);return this.transaction(s,a,true,async(tx,now)=>{
  const row=(await sql`DELETE FROM rule_issue_registry WHERE ${tenant(s)} AND id=${input.id}::uuid AND version=${input.expectedVersion} RETURNING id`.execute(tx)).rows[0];assert(row,"ISSUE_REGISTRY_VERSION_CONFLICT",409);
  await minimalOperationAudit(tx,s,a.key,"RULE.ISSUE_REGISTRY.DELETE",input.id,input.expectedVersion,now);return {deleted:true as const};
 });}
}

type Period={windowStart:string;windowEnd:string};
export type IssueNativeRequest={kind:"EXPERIMENT_STATE"|"PLAYBOOK_STATE";issueCode:string;targetId:string;liveVersion:string}|{kind:"STRUCTURED_ISSUE_PERIODS";issueCode:string;targetId:string;liveVersion:string;baseTargetType:string;baseTargetId:string;baseLiveVersion:string;periods:readonly Period[]};
/** Reads only retained authoritative base results. It never persists period
 * history, derives an issue from Suggestion counts, or extends source expiry. */
export async function readIssueRegistryCandidate(tx:Tx,s:Scope,a:Actor,request:IssueNativeRequest,now:string):Promise<NativeProjectionCandidate>{
 assert(tx.isTransaction,"RULE_TRANSACTION_REQUIRED",500);await operationsAccess(tx,s,a,"ANALYZE");
 const structured=request.kind==="STRUCTURED_ISSUE_PERIODS",sourceType=structured?"structured_issue_registry_v1":request.kind==="EXPERIMENT_STATE"?"experiment_registry_v1":"playbook_mapping_registry_v1";
 const metricId=structured?"issue.recurrence_consecutive_periods":request.kind==="EXPERIMENT_STATE"?"issue.active_experiment_state":"issue.playbook_coverage";
 const target={targetType:"ISSUE_TARGET",targetId:request.targetId,liveVersion:request.liveVersion};
 const unavailable=(reason:string):NativeProjectionCandidate=>({sourceType,metricId,target,value:null,observedAt:now,expiresAt:null,sourceRevision:"unavailable",windowStart:null,windowEnd:null,periodRole:"CURRENT",sampleSize:null,sealable:false,reasonCodes:[reason]});
 if(!BASE_ISSUE_CODES.includes(request.issueCode)||!z.uuid().safeParse(request.targetId).success)return unavailable("ISSUE_REGISTRY_TARGET_UNAVAILABLE");
 const row=(await sql<RegistryRow>`SELECT * FROM rule_issue_registry WHERE ${tenant(s)} AND id=${request.targetId}::uuid AND issue_code=${request.issueCode} AND expires_at>${now}::timestamptz`.execute(tx)).rows[0];
 if(!row||canonicalRuleJson(issueRegistryTarget(row))!==canonicalRuleJson(target))return unavailable("ISSUE_REGISTRY_VERSION_UNAVAILABLE");
 let value:FactValue,sourceRevision:string,expiresAt=iso(row.expires_at),windowStart=iso(row.declared_at),windowEnd=now,sampleSize:string,observedAt=iso(row.declared_at);
 if(structured){
  if(request.baseTargetType!==row.base_target_type||request.baseTargetId!==row.base_target_id||request.baseLiveVersion!==row.base_live_version||request.periods.length!==3)return unavailable("ISSUE_REGISTRY_BASE_TARGET_MISMATCH");
  const periods=request.periods.map(p=>({windowStart:canonicalRuleTimestamp(p.windowStart),windowEnd:canonicalRuleTimestamp(p.windowEnd)}));
  if(periods.some((p,i)=>timestampMicros(p.windowStart)>=timestampMicros(p.windowEnd)||timestampMicros(p.windowEnd)>timestampMicros(now)||i>0&&p.windowStart!==periods[i-1]!.windowEnd))return unavailable("ISSUE_REGISTRY_PERIODS_NOT_CONSECUTIVE");
  const selected:{id:string;result_hash:string;expires_at:Date;payload:RuleResult}[]=[];
  for(const p of periods){
   const rows=(await sql<{id:string;result_hash:string;expires_at:Date;payload:RuleResult;decision:string;evaluation_as_of:Date;input_hash:string}>`SELECT r.id,r.result_hash,LEAST(r.expires_at,j.expires_at) AS expires_at,r.payload,r.result AS decision,j.evaluation_as_of,j.input_hash FROM rule_evaluation_results r JOIN rule_evaluation_jobs j ON j.organization_id=r.organization_id AND j.guild_id=r.guild_id AND j.id=r.job_id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.rule_id=${row.base_rule_id} AND r.target_type=${row.base_target_type} AND r.target_id=${row.base_target_id} AND r.live_version=${row.base_live_version} AND j.state='SUCCEEDED' AND r.expires_at>${now}::timestamptz AND j.expires_at>${now}::timestamptz AND (r.payload->>'windowStart')::timestamptz=${p.windowStart}::timestamptz AND (r.payload->>'windowEnd')::timestamptz=${p.windowEnd}::timestamptz ORDER BY j.evaluation_as_of DESC,r.id LIMIT 2`.execute(tx)).rows;
   const latest=rows[0];if(!latest||hashRuleValue(latest.payload)!==latest.result_hash||canonicalRuleTimestamp(latest.payload.evaluationAsOf)!==iso(latest.evaluation_as_of)||latest.payload.inputHash!==latest.input_hash||latest.payload.partialCoverage||!['FIRE','NO_FIRE'].includes(latest.decision)||(latest.decision==='NO_FIRE'&&!latest.payload.sufficient)||(latest.decision==='FIRE'&&(!latest.payload.actionableUntil||timestampMicros(latest.payload.actionableUntil)<=timestampMicros(now)))||latest.payload.decision!==latest.decision||latest.payload.issueCode!==request.issueCode||latest.payload.ruleId!==row.base_rule_id||canonicalRuleJson(latest.payload.target)!==canonicalRuleJson(baseTarget(row))||canonicalRuleTimestamp(latest.payload.windowStart)!==p.windowStart||canonicalRuleTimestamp(latest.payload.windowEnd)!==p.windowEnd)return unavailable("ISSUE_PERIOD_RESULT_MISSING_OR_INELIGIBLE");
   if(rows[1]&&rows[1].payload.evaluationAsOf===latest.payload.evaluationAsOf&&rows[1].result_hash!==latest.result_hash)return unavailable("ISSUE_PERIOD_RESULT_AMBIGUOUS");
   selected.push(latest);
  }
  value={kind:"issuePeriods",issueCode:request.issueCode,periods:periods.map((p,i)=>({...p,state:selected[i]!.payload.decision as "FIRE"|"NO_FIRE"}))};
  expiresAt=earlier(expiresAt,...selected.map(r=>iso(r.expires_at)));windowStart=periods[0]!.windowStart;windowEnd=periods[2]!.windowEnd;sampleSize="3";
  observedAt=[observedAt,...selected.map(r=>canonicalRuleTimestamp(r.payload.evaluationAsOf))].sort().at(-1)!;
  sourceRevision=hashRuleValue({registryId:row.id,registryVersion:row.version,results:selected.map(r=>({id:r.id,hash:r.result_hash,expiresAt:iso(r.expires_at)}))});
 }else{
  const all=await inventory(tx,s),experiment=request.kind==="EXPERIMENT_STATE",items=experiment?all.experiments:all.playbooks,ids=experiment?row.experiment_ids:row.playbook_ids;
  const complete=experiment?row.experiments_complete:row.playbooks_complete,expectedHash=experiment?row.experiment_inventory_hash:row.playbook_inventory_hash;
  if(hashRuleValue(items)!==expectedHash)return unavailable("ISSUE_REGISTRY_NATIVE_INVENTORY_CHANGED");
  if(ids.some(id=>!items.some(r=>r.id===id)))return unavailable("ISSUE_REGISTRY_MAPPED_REFERENCE_MISSING");
  const mapped=items.filter(r=>ids.includes(r.id)),active=mapped.some(r=>experiment?r.state==='running':r.state==='ACTIVE');
  const state=active?(experiment?"PRESENT":"ENABLED"):!complete?"UNKNOWN":mapped.length&&!experiment?"DISABLED":"ABSENT";
  if(state==="UNKNOWN")return unavailable("ISSUE_REGISTRY_CENSUS_NOT_DECLARED_COMPLETE");
  value={kind:"enum",value:state};sourceRevision=hashRuleValue({registryId:row.id,registryVersion:row.version,inventoryHash:expectedHash,mappedIds:ids,complete});sampleSize=String(mapped.length);
 }
 if(timestampMicros(windowStart)>=timestampMicros(windowEnd))return unavailable("ISSUE_REGISTRY_OBSERVATION_WINDOW_EMPTY");
 if(timestampMicros(observedAt)>timestampMicros(now))return unavailable("ISSUE_REGISTRY_OBSERVATION_IN_FUTURE");
 return {sourceType,metricId,target,value,observedAt,expiresAt,sourceRevision,windowStart,windowEnd,periodRole:"CURRENT",sampleSize,sealable:true,reasonCodes:[],
  generatedHealth:[{observationId:immutableSourceHealthId(s,sourceType,sourceRevision,observedAt,target),revision:sourceRevision,sourceType,observedAt,expiresAt,quality:"SUFFICIENT",state:"HEALTHY",lastSuccessfulIngestAt:observedAt,neverSucceeded:false,coverage:"1",target}],
  comparison:{cohortDefinitionVersion:"native-issue-registry-v1",campaignClass:"REGISTERED_BASE_ISSUE",maturityOffset:"0",windowKind:"ELAPSED",timeZone:"UTC",cohortId:hashRuleValue({issueCode:row.issue_code,baseTarget:baseTarget(row)})}};
}
export async function purgeIssueRegistry(tx:Tx,s:Scope,now?:Date){await sql`DELETE FROM rule_issue_registry WHERE ${tenant(s)} ${now?sql`AND expires_at<=${now}`:sql``}`.execute(tx);}
