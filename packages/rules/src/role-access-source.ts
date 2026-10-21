import {randomUUID} from "node:crypto";
import {z} from "zod";
import {sql,tenant,json,type Database,type Tx} from "../../db/src/index";
import {assert,type Scope} from "../../shared/src/index";
import type {CapabilitySnapshot,ChannelMetadata} from "../../shared/src/community-model";
import {SettingsService,type Actor} from "../../settings/src/index";
import {operationsAccess} from "../../operations/src/policy";
import {assertMaintenanceAuthorization} from "../../operations/src/maintenance-authorization";
import {roleChannelMetadataSchema,projectRoleChannelAccess,type RoleChannelMetadata} from "../../discord/src/role-access";
import {analysisChannelScope} from "../../lifecycle/src/discovery";
import {OnboardingFlowDrafts,onboardingFlowTargetVersion} from "../../onboarding/src/flow-drafts";
import {hashRuleValue,canonicalRuleTimestamp} from "./facts";
import {canonicalCaseHash} from "./case-engine";
import {nativeObservedChannelVersion} from "./native-cohort-projections";
import {acquireRuleScopeLocks,ruleScopeLockSet} from "./locks";
import type {OperationalSourcePlugin,OperationalSourceRequest,OperationalSourceField} from "./operational-context-sources";

const snowflake=z.string().regex(/^\d{17,20}$/),hash=z.string().regex(/^[a-f0-9]{64}$/);
const common={channelId:snowflake,channelVersion:hash,representativeRoleIds:z.array(snowflake).max(8).refine(ids=>new Set(ids).size===ids.length)};
/** These are declared role compositions, not a claim about any member's roles.
 * @everyone is always implicit. No permissions, observations or person IDs may
 * be supplied by the editor. */
export const roleAccessSourceConfig=z.discriminatedUnion("destinationKind",[
  z.object({...common,destinationKind:z.literal("CASE_CHANNEL")}).strict(),
  z.object({...common,destinationKind:z.literal("ONBOARDING_START")}).strict(),
  z.object({...common,destinationKind:z.literal("NATIVE_ONBOARDING_DEFAULT")}).strict(),
  z.object({...common,destinationKind:z.literal("NATIVE_ONBOARDING_OPTION"),promptId:snowflake,optionId:snowflake}).strict(),
  z.object({...common,destinationKind:z.literal("REPORT_CHANNEL")}).strict(),
]);
type Config=z.infer<typeof roleAccessSourceConfig>;
type Request=Omit<OperationalSourceRequest,"phase"|"beforeWrite"|"prepared">;
interface Binding {hash:string;snapshotId:string;capabilityHash:string;settingsRevision:number;channel:ChannelMetadata;expiresAt:Date;}
interface Stored {id:string;context_id:string;case_id:string;target_type:string;target_id:string;live_version:string;config_hash:string;binding_hash:string;
  capability_snapshot_id:string;capability_hash:string;settings_revision:number;metadata:unknown;source_hash:string;observed_at:Date;created_at:Date;expires_at:Date;}
interface Prepared {scope:Scope;actorHash:string;requestHash:string;binding:Binding;metadata:RoleChannelMetadata;expiresAt:Date;}
const fields={CASE01:["onb.actualAccess"],CASE10:["channel.actualAccess"],CASE17:["reportChannel.actualPermission"]} as const;
function editorSchema():Record<string,unknown>{
  const descriptor=z.toJSONSchema(roleAccessSourceConfig) as Record<string,unknown>;
  for(const key of ["oneOf","anyOf"]){
    const branches=descriptor[key];if(!Array.isArray(branches))continue;
    for(const value of branches){
      if(!value||typeof value!=="object")continue;
      const branch=value as Record<string,unknown>,properties=branch.properties as Record<string,{const?:unknown}>|undefined,kind=properties?.destinationKind?.const;
      if(typeof kind!=="string")continue;
      branch["x-case-ids"]=kind==="CASE_CHANNEL"?["CASE10"]:kind==="REPORT_CHANNEL"?["CASE17"]:["CASE01"];
    }
  }
  return descriptor;
}
const iso=(value:Date)=>canonicalRuleTimestamp(value.toISOString()),minimum=(...values:Date[])=>new Date(Math.min(...values.map(value=>value.getTime())));
const requestHash=(request:Request,config:Config)=>hashRuleValue({contextId:request.contextId,caseId:request.caseId,target:request.target,window:request.window,config});
const metadataHash=(metadata:RoleChannelMetadata)=>{const {observedAt:_,...value}=metadata;void _;return hashRuleValue(value);};
async function clock(tx:Tx){return (await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;}
async function authorized(tx:Tx,s:Scope,a:Actor,request:Request,now:Date,capture:boolean){
  assertMaintenanceAuthorization(request.proof,s,a,now);await operationsAccess(tx,s,a,capture?"GOVERN":"ANALYZE");
  if(request.caseId==="CASE17")await operationsAccess(tx,s,a,"GOVERN");
  assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND (lookup_hash IS NULL OR lookup_hash=${a.key}) LIMIT 1`.execute(tx)).rows.length,"RESOURCE_DELETED",410);
  assertMaintenanceAuthorization(request.proof,s,a,await clock(tx));
}
/** Current native metadata fence. No message-body access is implied. CASE10
 * additionally requires its existing analysis scope. Private administrative
 * onboarding/report metadata remains gated by GOVERN and bot viewability. */
async function binding(tx:Tx,s:Scope,a:Actor,request:Request,config:Config,now:Date,capture:boolean):Promise<Binding>{
  await authorized(tx,s,a,request,now,capture);
  const settings=await new SettingsService(tx).get(s,tx);
  const snapshot=(await sql<{id:string;snapshot:CapabilitySnapshot;checked_at:Date}>`SELECT id,snapshot,checked_at FROM guild_capability_snapshots WHERE ${tenant(s)} AND checked_at<=${now} ORDER BY checked_at DESC,id DESC LIMIT 1`.execute(tx)).rows[0];
  const channel=snapshot?.snapshot.channels.find(value=>value.id===config.channelId);
  const surface=(await sql<{parent_id:string|null;channel_type:number;observed_at:Date;visibility_state:string;visibility_observed_at:Date|null;deleted_at:Date|null;collection_forbidden:boolean}>`SELECT parent_id,channel_type,observed_at,visibility_state,visibility_observed_at,deleted_at,collection_forbidden FROM discord_surface_state WHERE ${tenant(s)} AND channel_id=${config.channelId}`.execute(tx)).rows[0];
  assert(snapshot&&channel&&surface&&snapshot.checked_at.getTime()+3600000>now.getTime()&&channel.observable&&!channel.deleted&&!channel.collectionForbidden
    &&surface.visibility_state==="VISIBLE"&&surface.visibility_observed_at&&surface.visibility_observed_at<=now&&surface.visibility_observed_at.getTime()+3600000>now.getTime()
    &&!surface.deleted_at&&!surface.collection_forbidden&&surface.observed_at<=now&&surface.observed_at.getTime()+48*3600000>now.getTime()
    &&channel.type===surface.channel_type&&channel.parentId===surface.parent_id,"ROLE_ACCESS_CHANNEL_NOT_CURRENTLY_VISIBLE",403);
  assert(nativeObservedChannelVersion(snapshot.id,channel)===config.channelVersion,"ROLE_ACCESS_CHANNEL_VERSION_CHANGED",412);
  assert(request.target.liveVersion,"ROLE_ACCESS_TARGET_VERSION_REQUIRED",412);
  let destination:unknown;
  if(request.caseId==="CASE10"){
    assert(config.destinationKind==="CASE_CHANNEL"&&request.target.targetType==="CHANNEL"&&request.target.targetId===config.channelId&&request.target.liveVersion===config.channelVersion,"ROLE_ACCESS_TARGET_MISMATCH",412);
    assert((await analysisChannelScope(tx,s,settings)).actualChannelIds.includes(config.channelId),"ROLE_ACCESS_CHANNEL_NOT_CURRENTLY_PERMITTED",403);
    destination={kind:config.destinationKind};
  }else if(request.caseId==="CASE17"){
    assert(config.destinationKind==="REPORT_CHANNEL"&&request.target.targetType==="PERMISSION"&&request.target.targetId===config.channelId&&request.target.liveVersion===config.channelVersion,"ROLE_ACCESS_TARGET_MISMATCH",412);
    destination={kind:config.destinationKind};
  }else{
    assert(request.caseId==="CASE01"&&request.target.targetType==="ONBOARDING_FLOW","ROLE_ACCESS_CASE_UNSUPPORTED",400);
    const currentFlow=await new OnboardingFlowDrafts(tx).current(tx,s,request.target.targetId),flowVersion=onboardingFlowTargetVersion(currentFlow);
    assert(flowVersion===request.target.liveVersion,"ROLE_ACCESS_ONBOARDING_FLOW_CHANGED",412);
    if(config.destinationKind==="ONBOARDING_START"){
      assert(settings.onboardingEnabled&&settings.startChannelId===config.channelId&&settings.flowVersionId,"ROLE_ACCESS_ONBOARDING_DESTINATION_CHANGED",412);
      assert(settings.flowVersionId===request.target.targetId,"ROLE_ACCESS_ONBOARDING_FLOW_CHANGED",412);
      destination={kind:config.destinationKind,flowVersionId:settings.flowVersionId,flowVersion};
    }else{
      const onboarding=snapshot.snapshot.onboarding;assert(onboarding?.enabled,"ROLE_ACCESS_ONBOARDING_DESTINATION_CHANGED",412);
      if(config.destinationKind==="NATIVE_ONBOARDING_DEFAULT"){
        assert(onboarding.defaultChannelIds.includes(config.channelId),"ROLE_ACCESS_ONBOARDING_DESTINATION_CHANGED",412);
        destination={kind:config.destinationKind,flowVersion,onboarding};
      }else{
        assert(config.destinationKind==="NATIVE_ONBOARDING_OPTION","ROLE_ACCESS_DESTINATION_KIND_INVALID",400);
        const prompt=onboarding.prompts.find(value=>value.id===config.promptId),option=prompt?.options.find(value=>value.id===config.optionId);
        assert(prompt?.inOnboarding&&option&&option.channelIds.includes(config.channelId)
          &&hashRuleValue([...new Set(option.roleIds)].sort())===hashRuleValue([...config.representativeRoleIds].sort()),"ROLE_ACCESS_ONBOARDING_OPTION_CHANGED",412);
        destination={kind:config.destinationKind,flowVersion,prompt,option};
      }
    }
  }
  // Native capability coverage may contain a decimal ratio; the operational
  // canonical codec supports it without silently rounding to an integer.
  const capabilityHash=canonicalCaseHash(snapshot.snapshot),expiresAt=minimum(new Date(snapshot.checked_at.getTime()+3600000),new Date(surface.observed_at.getTime()+48*3600000),new Date(surface.visibility_observed_at.getTime()+3600000));
  const surfaceIdentity={...surface,observed_at:iso(surface.observed_at),visibility_observed_at:iso(surface.visibility_observed_at),deleted_at:null};
  return {hash:hashRuleValue({scope:s,settingsRevision:settings.revision,snapshotId:snapshot.id,capabilityHash,channel,surface:surfaceIdentity,destination}),snapshotId:snapshot.id,capabilityHash,settingsRevision:settings.revision,channel,expiresAt};
}
function validateMetadata(metadata:RoleChannelMetadata,s:Scope,config:Config,native:Binding,now:Date){
  assert(metadata.guildId===s.guildId&&metadata.channelId===config.channelId&&metadata.type===native.channel.type&&metadata.parentId===native.channel.parentId
    &&new Date(metadata.observedAt)<=now&&new Date(metadata.observedAt).getTime()+48*3600000>now.getTime(),"ROLE_ACCESS_NATIVE_METADATA_CHANGED",412);
  assert(new Set(metadata.roles.map(role=>role.id)).size===metadata.roles.length&&metadata.roles.some(role=>role.id===s.guildId)
    &&new Set(metadata.roleOverwrites.map(value=>value.roleId)).size===metadata.roleOverwrites.length
    &&metadata.roleOverwrites.every(value=>metadata.roles.some(role=>role.id===value.roleId)),"ROLE_ACCESS_COVERAGE_INCOMPLETE",409);
  projectRoleChannelAccess(metadata,config.representativeRoleIds);
}
function projected(row:Stored,metadata:RoleChannelMetadata,config:Config,request:OperationalSourceRequest):OperationalSourceField[]{
  const projection=projectRoleChannelAccess(metadata,config.representativeRoleIds);
  const value=request.caseId==="CASE01"?([0,5].includes(metadata.type)?projection.access:null):request.caseId==="CASE10"?projection.visibility:projection.reportPermission;
  const fieldId=fields[request.caseId as keyof typeof fields]?.[0];assert(fieldId,"ROLE_ACCESS_CASE_UNSUPPORTED",400);
  return [{fieldId,value,quality:value===null?"UNKNOWN":"SUFFICIENT",unit:"state",sourceKind:"SYSTEM_OBSERVATION",observedAt:iso(row.observed_at),expiresAt:iso(row.expires_at),
    sourceReference:`role-access:${row.id}`,sourceRevision:row.source_hash,window:request.window,periodRole:"CONTEXT"}];
}
export async function purgeRoleAccessObservations(tx:Tx,s:Scope){await sql`DELETE FROM rule_role_access_observations WHERE ${tenant(s)}`.execute(tx);}
export async function expireRoleAccessObservations(tx:Tx,s:Scope,now:Date){await sql`DELETE FROM rule_role_access_observations WHERE ${tenant(s)} AND expires_at<=${now}`.execute(tx);}

export function createRoleAccessSourcePlugin():OperationalSourcePlugin{
  const prepared=new WeakMap<object,Prepared>();
  return {id:"ROLE_ACCESS_NATIVE",supportedFields:fields,editorSchema:editorSchema(),parseConfig:value=>roleAccessSourceConfig.parse(value),
    async outsideTx(db:Database,s,a,request,ports){
      const config=roleAccessSourceConfig.parse(request.config);if(!ports.discord?.roleChannelMetadata)return undefined;
      const current=()=>db.transaction().execute(async tx=>{await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));return binding(tx,s,a,request,config,await clock(tx),true);});
      const before=await current();
      // Both reads are outside every DB transaction. This detects changes during
      // the capture; response clocks remain the source clocks, not SQL clocks.
      const first=roleChannelMetadataSchema.parse(await ports.discord.roleChannelMetadata(s.guildId,config.channelId));
      const second=roleChannelMetadataSchema.parse(await ports.discord.roleChannelMetadata(s.guildId,config.channelId));
      const after=await current();assert(before.hash===after.hash&&metadataHash(first)===metadataHash(second)&&new Date(first.observedAt)<=new Date(second.observedAt),"ROLE_ACCESS_CAPTURE_CHANGED",412);
      validateMetadata(first,s,config,after,new Date());validateMetadata(second,s,config,after,new Date());
      const token=Object.freeze({kind:"ROLE_ACCESS_PREPARED"}),expiresAt=minimum(after.expiresAt,new Date(new Date(first.observedAt).getTime()+48*3600000));
      prepared.set(token,{scope:{...s},actorHash:a.key,requestHash:requestHash(request,config),binding:after,metadata:second,expiresAt});return token;
    },
    async read(tx,s,a,request){
      const config=roleAccessSourceConfig.parse(request.config),now=new Date(request.evaluationAsOf);assert(tx.isTransaction&&Number.isFinite(now.getTime()),"ROLE_ACCESS_TRANSACTION_REQUIRED",500);
      const native=await binding(tx,s,a,request,config,now,request.phase==="CAPTURE");
      if(request.phase==="CAPTURE"){
        const seal=request.prepared&&typeof request.prepared==="object"?prepared.get(request.prepared):undefined;
        if(!seal)return [];
        assert(seal.scope.organizationId===s.organizationId&&seal.scope.guildId===s.guildId&&seal.actorHash===a.key&&seal.requestHash===requestHash(request,config)
          &&seal.binding.hash===native.hash&&seal.expiresAt>now,"ROLE_ACCESS_CAPTURE_CHANGED",412);
        const metadata=roleChannelMetadataSchema.parse(seal.metadata);validateMetadata(metadata,s,config,native,now);
        const previous=(await sql<{expires_at:Date}>`SELECT expires_at FROM rule_operational_contexts WHERE ${tenant(s)} AND id=${request.contextId}::uuid`.execute(tx)).rows[0];
        const declaredExpiry=request.captureExpiresAt?new Date(request.captureExpiresAt):null;
        assert(!declaredExpiry||Number.isFinite(declaredExpiry.getTime()),"ROLE_ACCESS_CAPTURE_EXPIRED",409);
        const expiresAt=minimum(seal.expiresAt,native.expiresAt,...(previous?[previous.expires_at]:[]),...(declaredExpiry?[declaredExpiry]:[]));assert(expiresAt>now,"ROLE_ACCESS_CAPTURE_EXPIRED",409);
        const row:Stored={id:randomUUID(),context_id:request.contextId,case_id:request.caseId,target_type:request.target.targetType,target_id:request.target.targetId,live_version:request.target.liveVersion!,config_hash:hashRuleValue(config),binding_hash:native.hash,
          capability_snapshot_id:native.snapshotId,capability_hash:native.capabilityHash,settings_revision:native.settingsRevision,metadata,source_hash:hashRuleValue({metadata,config,bindingHash:native.hash}),observed_at:new Date(metadata.observedAt),created_at:now,expires_at:expiresAt};
        await request.beforeWrite();await sql`DELETE FROM rule_role_access_observations WHERE ${tenant(s)} AND context_id=${request.contextId}::uuid`.execute(tx);
        await request.beforeWrite();await sql`INSERT INTO rule_role_access_observations(organization_id,guild_id,id,context_id,case_id,target_type,target_id,live_version,config_hash,binding_hash,capability_snapshot_id,capability_hash,settings_revision,metadata,source_hash,observed_at,created_at,expires_at)
          VALUES(${s.organizationId}::uuid,${s.guildId},${row.id}::uuid,${row.context_id}::uuid,${row.case_id},${row.target_type},${row.target_id},${row.live_version},${row.config_hash},${row.binding_hash},${row.capability_snapshot_id}::uuid,${row.capability_hash},${row.settings_revision},${json(metadata)},${row.source_hash},${row.observed_at},${row.created_at},${row.expires_at})`.execute(tx);
        prepared.delete(request.prepared as object);return projected(row,metadata,config,request);
      }
      const row=(await sql<Stored>`SELECT * FROM rule_role_access_observations WHERE ${tenant(s)} AND context_id=${request.contextId}::uuid AND expires_at>${now} AND observed_at<=${now}`.execute(tx)).rows[0];
      if(!row)return [];
      assert(row.case_id===request.caseId&&row.target_type===request.target.targetType&&row.target_id===request.target.targetId&&row.live_version===request.target.liveVersion
        &&row.config_hash===hashRuleValue(config)&&row.binding_hash===native.hash&&row.capability_snapshot_id===native.snapshotId&&row.capability_hash===native.capabilityHash&&row.settings_revision===native.settingsRevision,"ROLE_ACCESS_SOURCE_CHANGED",412);
      const metadata=roleChannelMetadataSchema.parse(row.metadata);validateMetadata(metadata,s,config,native,now);
      assert(row.source_hash===hashRuleValue({metadata,config,bindingHash:native.hash})&&new Date(metadata.observedAt).getTime()===row.observed_at.getTime()
        &&row.expires_at<=native.expiresAt&&row.expires_at.getTime()<=row.observed_at.getTime()+48*3600000,"ROLE_ACCESS_SOURCE_HASH_MISMATCH",409);
      return projected(row,metadata,config,request);
    },purge:purgeRoleAccessObservations,expire:expireRoleAccessObservations};
}
