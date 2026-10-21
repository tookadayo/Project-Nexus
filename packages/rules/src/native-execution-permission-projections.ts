import {sql,tenant,type Tx} from '../../db/src/index';
import {assert,type Scope} from '../../shared/src/index';
import type {CapabilitySnapshot} from '../../shared/src/community-model';
import {SettingsService,type Actor} from '../../settings/src/index';
import {operationsAccess} from '../../operations/src/policy';
import type {FlowDefinition,Statement,ValueInput} from '../../automation/src/types';
import {canonicalRuleTimestamp,hashRuleValue,immutableSourceHealthId,normalizeSourceHealth,timestampMicros,type FactValue,type RuleTarget,type SourceHealthObservation} from './facts';
import {projectRuntimeAnomalies,type RuntimeExecutionObservation} from './source-adapters';
import {validateRuleConfig,type RuleEngineConfig} from './rule-config';
import {ALPHA16_RETENTION_CONTRACT} from './retention-contract';
import type {NativeProjectionCandidate} from './native-projections';
import type {NativeSourceRequest} from './native-source-request';

const iso=(at:Date)=>canonicalRuleTimestamp(at.toISOString());
const minimum=(...values:string[])=>values.reduce((a,b)=>timestampMicros(a)<=timestampMicros(b)?a:b);
const snapshotEnd=(at:string)=>iso(new Date(Date.parse(at)+ALPHA16_RETENTION_CONTRACT.factSnapshot.maximumSeconds*1000));
function coverageRatio(numerator:number,denominator:number):string|null{
 if(denominator===0)return null;
 const scaled=BigInt(numerator)*1000000000000000000n/BigInt(denominator);
 return scaled===1000000000000000000n?'1':`0.${scaled.toString().padStart(18,'0')}`.replace(/0+$/,'').replace(/\.$/,'');
}
function actualNativeHealth(scope:Scope,sourceType:string,target:RuleTarget,sourceRevision:string,observedAt:string,expiresAt:string,coverage:string|null,lastSuccessfulIngestAt:string,quality:SourceHealthObservation['quality']='SUFFICIENT'):SourceHealthObservation{
 return normalizeSourceHealth({observationId:immutableSourceHealthId(scope,sourceType,sourceRevision,observedAt,target),revision:sourceRevision,sourceType,target,observedAt,expiresAt,coverage,lastSuccessfulIngestAt,neverSucceeded:false,quality,state:quality==='SUPPRESSED'?'DEGRADED':coverage==='1'?'HEALTHY':'DEGRADED'});
}
function windowGuard(request:{windowStart:string;windowEnd:string},asOf:string){
 assert(timestampMicros(request.windowStart)<timestampMicros(request.windowEnd)&&timestampMicros(request.windowEnd)<=timestampMicros(asOf),'RULE_NATIVE_WINDOW_INVALID');
}
type ExecutionRequest=Extract<NativeSourceRequest,{kind:'AUTO_EXECUTION_OBSERVATION'}>;
type PermissionRequest=Extract<NativeSourceRequest,{kind:'PERMISSION_REQUIREMENTS'}>;
function unavailable(request:ExecutionRequest|PermissionRequest,asOf:string,reason:string):NativeProjectionCandidate{
 const runtime=request.kind==='AUTO_EXECUTION_OBSERVATION';
 return {sourceType:runtime?'runtime_execution_observation_v1':'permission_observation_v1',metricId:runtime?'automation.runtime.operational_anomaly_rate':'permission.confirmed_gap_rate',
  target:{targetType:runtime?'AUTOMATION_RUNTIME':'GUILD_PERMISSION_PROFILE',targetId:runtime?request.flowId:request.targetId,liveVersion:runtime?String(request.liveRevision):request.liveVersion},
  value:null,observedAt:asOf,expiresAt:null,sourceRevision:'unavailable',windowStart:request.windowStart,windowEnd:request.windowEnd,periodRole:'CURRENT',sampleSize:null,sealable:false,reasonCodes:[reason]};
}
export interface NativeExecutionObservationRow {
 id:string;revision:number;status:string;started_at:Date;deadline_at:Date;wake_at:Date|null;ended_at:Date|null;
 observation_revision:string|null;observation_status:string|null;due_at:Date|null;observation_deadline:Date|null;terminal_at:Date|null;heartbeat_at:Date|null;observed_at:Date|null;retention_expires_at:Date|null;
}
/** A Run is one execution unit. Missing legacy/liveness observations lower
 * coverage; UNKNOWN is not reclassified as a successful operational result. */
export function nativeExecutionObservations(rows:readonly NativeExecutionObservationRow[],asOf:string){
 const at=Date.parse(asOf),observed:RuntimeExecutionObservation[]=[];
 assert(rows.length<=2000&&new Set(rows.map(row=>row.id)).size===rows.length,'RULE_NATIVE_EXECUTION_ROWS_INVALID');
 const terminal=new Set(['COMPLETED','FAILED','CANCELLED','EXPIRED','UNKNOWN']);
 for(const row of rows){
  if(!['QUEUED','RUNNING','WAITING','WAITING_APPROVAL',...terminal].includes(row.status))continue;
  if(row.started_at.getTime()>at||row.deadline_at<row.started_at||row.ended_at&&row.ended_at<row.started_at)continue;
  if(!row.observation_revision||!row.observed_at||!row.retention_expires_at||row.observed_at.getTime()>at||row.retention_expires_at.getTime()<=at||row.observation_status!==row.status||row.observation_deadline?.getTime()!==row.deadline_at.getTime())continue;
  if(terminal.has(row.status)!==(row.ended_at!==null)||terminal.has(row.status)!==(row.terminal_at!==null)||row.terminal_at&&row.terminal_at.getTime()>at||row.ended_at&&row.terminal_at&&row.terminal_at>row.ended_at)continue;
  if(row.status==='UNKNOWN')continue;
  if(row.due_at&&row.due_at>row.deadline_at||row.heartbeat_at&&row.heartbeat_at.getTime()>at)continue;
  const state=row.status==='RUNNING'?'EXECUTING':row.status==='QUEUED'?'RESUMABLE':row.status==='WAITING_APPROVAL'?'WAITING':row.status;
  if((state==='WAITING'||state==='RESUMABLE')&&(!row.due_at||row.status!=='QUEUED'&&row.due_at.getTime()!==row.wake_at?.getTime()))continue;
  if(state==='EXECUTING'&&!row.heartbeat_at)continue;
  observed.push({executionRef:row.id,state:state as RuntimeExecutionObservation['state'],dueAt:row.due_at?iso(row.due_at):null,deadlineAt:iso(row.deadline_at),terminalAt:row.terminal_at?iso(row.terminal_at):null,
   leaseExpiresAt:null,heartbeatAt:row.heartbeat_at?iso(row.heartbeat_at):null});
 }
 return {expected:String(rows.length),observed};
}
export async function readNativeExecutionObservation(tx:Tx,s:Scope,actor:Actor,request:ExecutionRequest,context:{evaluationAsOf:string;config:RuleEngineConfig}):Promise<NativeProjectionCandidate[]>{
 assert(tx.isTransaction,'RULE_TRANSACTION_REQUIRED',500);
 const now=canonicalRuleTimestamp(context.evaluationAsOf);windowGuard(request,now);await operationsAccess(tx,s,actor,'ANALYZE');
 validateRuleConfig(context.config);const config=context.config.rules['AUTO-002'];
 if(context.config.approval!=='APPROVED'||!config?.enabled||config.waitGraceSeconds===undefined||config.heartbeatGraceSeconds===undefined||!context.config.approvedSourceTypes.includes('runtime_execution_observation_v1'))return [unavailable(request,now,'NATIVE_RUNTIME_CONFIG_UNAPPROVED')];
 const flow=(await sql<{active_revision:number|null;state:string}>`SELECT active_revision,state FROM automation_flows WHERE ${tenant(s)} AND id=${request.flowId} FOR SHARE`.execute(tx)).rows[0];
 if(flow?.state!=='ACTIVE'||flow.active_revision!==request.liveRevision)return [unavailable(request,now,'NATIVE_LIVE_REVISION_MISMATCH')];
 if(timestampMicros(request.windowStart)<=timestampMicros(now)-BigInt(ALPHA16_RETENTION_CONTRACT.runDerived.maximumSeconds)*1000000n)return [unavailable(request,now,'NATIVE_RUN_WINDOW_EXCEEDS_RETAINED_COVERAGE')];
 // A deletion can remove Runs before this read. Do not label the survivors a
 // complete census, nor retain deleted actor keys in a replacement census.
 const deletion=(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND requested_at>=${request.windowStart}::timestamptz LIMIT 1`.execute(tx)).rows[0];
 if(deletion)return [unavailable(request,now,'NATIVE_RUN_COVERAGE_PRIVACY_GAP')];
 const rows=(await sql<NativeExecutionObservationRow>`SELECT r.id,r.revision,r.status,r.started_at,r.deadline_at,r.wake_at,r.ended_at,o.checkpoint_revision::text AS observation_revision,o.status AS observation_status,o.due_at,o.deadline_at AS observation_deadline,o.terminal_at,o.heartbeat_at,o.observed_at,o.retention_expires_at
 FROM automation_runs r LEFT JOIN automation_execution_observations o ON o.organization_id=r.organization_id AND o.guild_id=r.guild_id AND o.run_id=r.id AND o.revision=r.revision
 WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.flow_id=${request.flowId} AND r.revision=${request.liveRevision}
 AND r.started_at<${request.windowEnd}::timestamptz AND (r.ended_at IS NULL OR r.ended_at>=${request.windowStart}::timestamptz)
 AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=r.organization_id AND d.guild_id=r.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=r.actor_hash)) ORDER BY r.id LIMIT 2001`.execute(tx)).rows;
 if(rows.length>2000)return [unavailable(request,now,'NATIVE_SOURCE_LIMIT_EXCEEDED')];
 const projected=nativeExecutionObservations(rows,now),value=projectRuntimeAnomalies(projected.observed,now,config.waitGraceSeconds,config.heartbeatGraceSeconds,projected.expected);
 const observedIds=new Set(projected.observed.map(row=>row.executionRef)),observations=rows.filter(row=>observedIds.has(row.id));
 if(!observations.length)return [unavailable(request,now,'NATIVE_EXECUTION_OBSERVATION_MISSING')];
 const actualObservedAt=observations.map(row=>iso(row.observed_at!)).reduce((a,b)=>timestampMicros(a)>=timestampMicros(b)?a:b);
 const expiry=minimum(snapshotEnd(now),...rows.map(row=>row.retention_expires_at?iso(row.retention_expires_at):iso(new Date((row.ended_at??row.deadline_at).getTime()+ALPHA16_RETENTION_CONTRACT.runDerived.maximumSeconds*1000))));
 if(timestampMicros(expiry)<=timestampMicros(now))return [unavailable(request,now,'NATIVE_RUN_SOURCE_EXPIRED')];
 const candidate={...unavailable(request,now,'unused'),value,expiresAt:expiry,sourceRevision:hashRuleValue({target:{flowId:request.flowId,revision:request.liveRevision},configRevision:context.config.configVersion,asOf:now,rows:rows.map(row=>({id:row.id,revision:row.revision,state:row.status,observationRevision:row.observation_revision}))}),sampleSize:value.eligible,sealable:true,
  reasonCodes:projected.observed.length===rows.length?[]:['NATIVE_EXECUTION_PARTIAL_COVERAGE']};
 return [{...candidate,generatedHealth:[actualNativeHealth(s,candidate.sourceType,candidate.target,candidate.sourceRevision,now,expiry,coverageRatio(observations.length,rows.length),actualObservedAt)]}];
}

export type NativePermissionKind='BOT_MANAGE_ROLES'|'CHANNEL_VIEW'|'CHANNEL_SEND_MESSAGES'|'CHANNEL_MANAGE'|'CHANNEL_CREATE_THREAD'|'ROLE_ASSIGNABLE'|'OWN_MESSAGE'|'NATIVE_ONBOARDING'|'UNRESOLVED_NATIVE_REQUIREMENT';
export interface NativePermissionRequirement {kind:NativePermissionKind;targetId:string;}
export interface NativePermissionRegistry {
 target:RuleTarget;sourceRevision:string;changedAt:string;requirements:readonly NativePermissionRequirement[];
}
const snowflake=(value:string)=>/^\d{17,20}$/.test(value);
/** Requirements come from enabled reachable native statements and their
 * explicit finite allowlists. Detached/unused procedures contribute nothing. */
export function nativeFlowPermissionRequirements(definition:FlowDefinition):NativePermissionRequirement[]{
 const required=new Map<string,NativePermissionRequirement>();let visited=0;
 const add=(kind:NativePermissionKind,targetId:string)=>required.set(kind+':'+targetId,{kind,targetId});
 const finite=(input:ValueInput|undefined,ids:readonly string[])=>{
  assert(ids.length<=100&&ids.every(snowflake),'RULE_PERMISSION_TARGET_REGISTRY_INVALID');
  if(input?.kind==='literal'){
   const value=input.value;
   if(value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.id==='string'&&value.guildId===definition.guildId&&ids.includes(value.id))return [value.id];
   add('UNRESOLVED_NATIVE_REQUIREMENT',definition.id);return [];
  }
  if(!input||input.kind==='missing'||ids.length===0){add('UNRESOLVED_NATIVE_REQUIREMENT',definition.id);return [];}
  return ids;
 };
 const walk=(body:readonly Statement[],calls:readonly string[])=>{
  for(const node of body){if(node.enabled===false)continue;assert(++visited<=5000,'RULE_PERMISSION_REGISTRY_LIMIT');
   if(node.kind==='action'){
    const channels=definition.targets?.channelIds??[],roles=definition.targets?.roleIds??[],parents=definition.targets?.parentCategoryIds??[];
    if(node.operation==='discord.addRole'||node.operation==='discord.removeRole'){add('BOT_MANAGE_ROLES',definition.guildId);for(const id of finite(node.inputs.role,roles))add('ROLE_ASSIGNABLE',id);}
    else if(node.operation==='discord.sendMessage')for(const id of finite(node.inputs.channel,channels)){add('CHANNEL_VIEW',id);add('CHANNEL_SEND_MESSAGES',id);}
    else if(node.operation==='discord.createThread')for(const id of finite(node.inputs.channel,channels)){add('CHANNEL_VIEW',id);add('CHANNEL_CREATE_THREAD',id);}
    else if(node.operation==='discord.createChannel')for(const id of finite(node.inputs.parent,parents)){add('CHANNEL_VIEW',id);add('CHANNEL_MANAGE',id);}
    else if(node.operation==='discord.editOwnMessage')add('OWN_MESSAGE',definition.id);
    else if(node.operation!=='nexus.readTicket')add('UNRESOLVED_NATIVE_REQUIREMENT',definition.id);
   }else if(node.kind==='call'){
    const key=node.procedureId+':'+node.revision,procedure=definition.procedures?.find(value=>value.id===node.procedureId&&value.revision===node.revision);
    if(!procedure||calls.includes(key)||calls.length>=3)add('UNRESOLVED_NATIVE_REQUIREMENT',definition.id);else walk(procedure.body,[...calls,key]);
   }else if(node.kind==='parallel')for(const branch of node.branches)walk(branch.body,calls);
   else if(node.kind==='switch')for(const branch of node.cases)walk(branch.body,calls);
   else if(node.kind==='boundedLoop'){walk(node.body,calls);for(const body of Object.values(node.handlers))if(body)walk(body,calls);}
   else{
    // All current structural branch names are explicit, never recurse through
    // expression/literal payloads or detached definitions.
    const bodies:readonly string[]=['then','otherwise','unknown','succeeded','failed','notStarted','present','unset','found','notFound','body','matched','exhausted','timedOut','approved','rejected','expired'];
    for(const key of bodies){const value=(node as unknown as Record<string,unknown>)[key];if(Array.isArray(value))walk(value as Statement[],calls);}
   }
  }
 };
 walk(definition.body,[]);return [...required.values()].sort((a,b)=>(a.kind+':'+a.targetId).localeCompare(b.kind+':'+b.targetId));
}

export async function readNativePermissionRequirementRegistry(tx:Tx,s:Scope,actor:Actor,asOf:string):Promise<NativePermissionRegistry|null>{
 assert(tx.isTransaction,'RULE_TRANSACTION_REQUIRED',500);
 await operationsAccess(tx,s,actor,'ANALYZE');const now=canonicalRuleTimestamp(asOf);
 // Stabilize this epoch until Fact sealing commits. Config writers bump it in
 // their own transaction; nonlocking config reads below cannot reverse locks.
 const epoch=(await sql<{revision:string;changed_at:Date}>`SELECT revision::text,changed_at FROM native_permission_requirement_epochs WHERE ${tenant(s)} FOR SHARE`.execute(tx)).rows[0];
 if(!epoch||timestampMicros(iso(epoch.changed_at))>timestampMicros(now))return null;
 const settings=await new SettingsService(tx).get(s,tx);
 const flows=(await sql<{id:string;active_revision:number;generation:number;semantic_hash:string;definition:FlowDefinition}>`SELECT f.id,f.active_revision,f.generation,r.semantic_hash,r.definition FROM automation_flows f JOIN automation_revisions r ON r.organization_id=f.organization_id AND r.guild_id=f.guild_id AND r.flow_id=f.id AND r.revision=f.active_revision WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.state='ACTIVE' AND ${settings.enabled} ORDER BY f.id LIMIT 2001`.execute(tx)).rows;
 if(flows.length>2000)return null;
 const requirements=new Map<string,NativePermissionRequirement>(),refs:unknown[]=[{settingsRevision:settings.revision,epoch:epoch.revision}];
 const add=(kind:NativePermissionKind,id:string)=>{requirements.set(kind+':'+id,{kind,targetId:id});};
 for(const flow of flows){if(flow.definition.guildId!==s.guildId||flow.definition.id!==flow.id)return null;for(const value of nativeFlowPermissionRequirements(flow.definition))add(value.kind,value.targetId);refs.push({flowId:flow.id,revision:flow.active_revision,generation:flow.generation,hash:flow.semantic_hash});}
 if(settings.enabled){
  for(const id of [settings.onboardingEnabled?settings.startChannelId:null,settings.adminNotificationChannelId,settings.weeklySummaryEnabled?settings.weeklySummaryChannelId:null])if(id){add('CHANNEL_VIEW',id);add('CHANNEL_SEND_MESSAGES',id);}
  if(settings.onboardingEnabled){
   const flowId=settings.onboardingMode==='hybrid'?settings.hybrid.flowVersionId:settings.flowVersionId;
   if(flowId){
    // Project only role IDs; onboarding questions/answers never enter the reader.
    const published=(await sql<{version:number;role_ids:unknown}>`SELECT version,jsonb_path_query_array(definition,'$.nodes[*].options[*].roleId') AS role_ids FROM flow_versions WHERE ${tenant(s)} AND id=${flowId}::uuid`.execute(tx)).rows[0];
    if(!published)add('UNRESOLVED_NATIVE_REQUIREMENT','onboarding');
    else{refs.push({flowVersionId:flowId,revision:published.version});if(!Array.isArray(published.role_ids)||published.role_ids.some(value=>typeof value!=='string'||!snowflake(value)))return null;for(const role of published.role_ids as string[]){add('BOT_MANAGE_ROLES',s.guildId);add('ROLE_ASSIGNABLE',role);}}
   }
   if(['native','auto','hybrid'].includes(settings.onboardingMode))add('NATIVE_ONBOARDING',s.guildId);
  }
 }
 // Unreferenced draft/unused destinations create no live requirements.
 const destinations=(await sql<{id:string;kind:string;channel_id:string|null;revision:number}>`SELECT d.id,d.kind,d.channel_id,d.revision FROM integration_destinations d WHERE d.organization_id=${s.organizationId}::uuid AND d.guild_id=${s.guildId} AND d.state='ENABLED' AND ${settings.enabled} AND (
 EXISTS(SELECT 1 FROM report_schedules r WHERE r.organization_id=d.organization_id AND r.guild_id=d.guild_id AND r.destination_id=d.id AND r.state='ENABLED') OR
 EXISTS(SELECT 1 FROM operations_intake_panels p WHERE p.organization_id=d.organization_id AND p.guild_id=d.guild_id AND p.destination_id=d.id AND p.state='PUBLISHED') OR
 EXISTS(SELECT 1 FROM playbooks p JOIN playbook_revisions r ON r.organization_id=p.organization_id AND r.guild_id=p.guild_id AND r.id=p.head_id WHERE p.organization_id=d.organization_id AND p.guild_id=d.guild_id AND p.state='ACTIVE' AND (r.definition->'destinations' ? d.id::text OR r.definition->'escalation'->>'destinationId'=d.id::text))) ORDER BY d.id LIMIT 2001`.execute(tx)).rows;
 if(destinations.length>2000)return null;
 for(const destination of destinations){refs.push({destinationId:destination.id,revision:destination.revision});if(destination.kind==='DISCORD'&&destination.channel_id){add('CHANNEL_VIEW',destination.channel_id);add('CHANNEL_SEND_MESSAGES',destination.channel_id);}else if(destination.kind==='TEAM')add('UNRESOLVED_NATIVE_REQUIREMENT',destination.id);}
 const panels=(await sql<{id:string;version:number;channel_id:string|null}>`SELECT id,version,channel_id FROM operations_intake_panels WHERE ${tenant(s)} AND state='PUBLISHED' AND ${settings.enabled} ORDER BY id LIMIT 2001`.execute(tx)).rows;
 if(panels.length>2000)return null;for(const panel of panels){refs.push({panelId:panel.id,revision:panel.version});if(panel.channel_id){add('CHANNEL_VIEW',panel.channel_id);add('CHANNEL_SEND_MESSAGES',panel.channel_id);}else add('UNRESOLVED_NATIVE_REQUIREMENT',panel.id);}
 const values=[...requirements.values()].sort((a,b)=>(a.kind+':'+a.targetId).localeCompare(b.kind+':'+b.targetId));
 if(values.length>2000)return null;
 const sourceRevision=hashRuleValue({version:'native-permission-requirements.v1',epoch:epoch.revision,refs,requirements:values});
 return {target:{targetType:'GUILD_PERMISSION_PROFILE',targetId:s.guildId,liveVersion:sourceRevision},sourceRevision,changedAt:iso(epoch.changed_at),requirements:values};
}

/** Only already collected native capability atoms can confirm ALLOW/DENY.
 * Guild SendMessages is insufficient to determine channel overwrites; role
 * hierarchy and own-message ownership likewise remain UNKNOWN. */
export function nativePermissionCounts(requirements:readonly NativePermissionRequirement[],snapshot:Pick<CapabilitySnapshot,'botPermissions'|'channels'|'capabilities'|'coverage'>):Extract<FactValue,{kind:'permissions'}>{
 assert(requirements.length<=2000&&new Set(requirements.map(value=>value.kind+':'+value.targetId)).size===requirements.length,'RULE_PERMISSION_REQUIREMENTS_INVALID');
 assert(snapshot.channels.length<=10000&&snapshot.channels.every(value=>value&&typeof value.id==='string')&&new Set(snapshot.channels.map(value=>value.id)).size===snapshot.channels.length,'RULE_PERMISSION_OBSERVATION_INVALID');
 let allowed=0,denied=0,unknown=0,suppressed=0;
 for(const requirement of requirements){
  let result:'ALLOW'|'DENY'|'UNKNOWN'|'SUPPRESSED'='UNKNOWN';
  if(requirement.kind==='BOT_MANAGE_ROLES'&&typeof snapshot.botPermissions?.manageRoles==='boolean')result=snapshot.botPermissions.manageRoles?'ALLOW':'DENY';
  else if(requirement.kind==='CHANNEL_VIEW'){
   const channel=snapshot.channels.find(value=>value.id===requirement.targetId);
   if(channel?.collectionForbidden)result='SUPPRESSED';
   // observable=false also covers Discord's obfuscated channel flag. Without
   // that independent cause in the saved DTO, it is not a confirmed deny.
   else if(channel&&!channel.deleted&&channel.observable===true)result='ALLOW';
  }else if(requirement.kind==='NATIVE_ONBOARDING'){
   const status=snapshot.capabilities.onboarding?.status;
   if(status==='PERMISSION_MISSING')result='DENY';else if(['AVAILABLE','ENABLED','OBSERVED','CONFIGURED'].includes(status??''))result='ALLOW';
  }
  if(result==='ALLOW')allowed++;else if(result==='DENY')denied++;else if(result==='SUPPRESSED')suppressed++;else unknown++;
 }
 return {kind:'permissions',required:String(requirements.length),allowed:String(allowed),denied:String(denied),unknown:String(unknown),suppressed:String(suppressed),requirementRegistered:true};
}
export async function readNativePermissionRequirements(tx:Tx,s:Scope,actor:Actor,request:PermissionRequest,context:{evaluationAsOf:string}):Promise<NativeProjectionCandidate[]>{
 const now=canonicalRuleTimestamp(context.evaluationAsOf);windowGuard(request,now);
 const registry=await readNativePermissionRequirementRegistry(tx,s,actor,now);
 if(!registry||request.targetId!==s.guildId||request.liveVersion!==registry.target.liveVersion)return [unavailable(request,now,'NATIVE_PERMISSION_REQUIREMENT_VERSION_MISMATCH')];
 const source=(await sql<{id:string;snapshot:CapabilitySnapshot;checked_at:Date}>`SELECT id,snapshot,checked_at FROM guild_capability_snapshots WHERE ${tenant(s)} ORDER BY checked_at DESC,id DESC LIMIT 1`.execute(tx)).rows[0];
 if(!source||source.snapshot.schemaVersion!==2||!Array.isArray(source.snapshot.channels)||!source.snapshot.capabilities||!source.snapshot.coverage)return [unavailable(request,now,'NATIVE_PERMISSION_OBSERVATION_UNAVAILABLE')];
 const observedAt=iso(source.checked_at);
 let embeddedTime:string;try{embeddedTime=canonicalRuleTimestamp(source.snapshot.checkedAt);}catch{return [unavailable(request,now,'NATIVE_PERMISSION_OBSERVATION_INVALID')];}
 if(embeddedTime!==observedAt||timestampMicros(observedAt)<timestampMicros(registry.changedAt)||timestampMicros(observedAt)<timestampMicros(request.windowStart)||timestampMicros(observedAt)>=timestampMicros(request.windowEnd)||timestampMicros(observedAt)>timestampMicros(now)||timestampMicros(snapshotEnd(observedAt))<=timestampMicros(now))return [unavailable(request,now,'NATIVE_PERMISSION_OBSERVATION_VERSION_UNVERIFIED')];
 const invalidation=(await sql`SELECT 1 FROM capability_refresh_jobs WHERE ${tenant(s)} AND (requested_at>${source.checked_at} OR due_at<=${now}::timestamptz) UNION ALL SELECT 1 FROM discord_integration_health WHERE ${tenant(s)} AND last_refresh_failure_at>=${source.checked_at} UNION ALL SELECT 1 FROM discord_surface_state WHERE ${tenant(s)} AND (observed_at>${source.checked_at} OR visibility_observed_at>${source.checked_at}) LIMIT 1`.execute(tx)).rows[0];
 if(invalidation)return [unavailable(request,now,'NATIVE_PERMISSION_OBSERVATION_INVALIDATED')];
 let value:ReturnType<typeof nativePermissionCounts>;try{value=nativePermissionCounts(registry.requirements,source.snapshot);}catch{return [unavailable(request,now,'NATIVE_PERMISSION_OBSERVATION_INVALID')];}
 const candidate={...unavailable(request,now,'unused'),target:registry.target,value,observedAt,expiresAt:snapshotEnd(observedAt),sourceRevision:hashRuleValue({registry:registry.sourceRevision,snapshotId:source.id,checkedAt:observedAt,value}),sampleSize:value.required,sealable:true,
  reasonCodes:value.unknown==='0'&&value.suppressed==='0'?[]:['NATIVE_PERMISSION_PARTIAL_OBSERVATION']};
 // The current locked registry existed before this actual Bot observation and
 // remains the same epoch. Pair its health at that observation, never at a new
 // query-success clock; unchanged active config is not an expired history row.
 return [{...candidate,generatedHealth:[actualNativeHealth(s,'permission_observation_v1',registry.target,candidate.sourceRevision,observedAt,candidate.expiresAt,coverageRatio(Number(value.allowed)+Number(value.denied),registry.requirements.length),observedAt,value.suppressed==='0'?'SUFFICIENT':'SUPPRESSED'),
  actualNativeHealth(s,'permission_requirement_registry_v1',registry.target,registry.sourceRevision,observedAt,candidate.expiresAt,'1',registry.changedAt)]}];
}
