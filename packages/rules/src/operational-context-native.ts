import {z} from "zod";
import {MessageType} from "discord-api-types/v10";
import {sql,tenant,json,type Tx} from "../../db/src/index";
import {assert,type Scope} from "../../shared/src/index";
import {SettingsService,type Actor} from "../../settings/src/index";
import {operationsAccess} from "../../operations/src/policy";
import {assertMaintenanceAuthorization,type MaintenanceAuthorizationProof} from "../../operations/src/maintenance-authorization";
import {analysisChannelScope} from "../../lifecycle/src/discovery";
import type {CapabilitySnapshot} from "../../shared/src/community-model";
import {canonicalCaseHash} from "./case-engine";
import {canonicalRuleTimestamp,timestampMicros} from "./facts";
import {deriveDutyConcentration,deriveFilterReview,type DutyAssignmentBucket} from "./cases-13-20";
import {nativeObservedChannelVersion} from "./native-cohort-projections";
import {acquireRuleScopeLocks,ruleScopeLockSet} from "./locks";
import {operationalNativeConfig,OPERATIONAL_NATIVE_FIELDS,type OperationalNativeConfig} from "./operational-context-native-contract";
import type {OperationalSourceField,OperationalSourcePlugin,OperationalSourceRequest} from "./operational-context-sources";
import type {Scalar,Unit} from "./case-types";

const HOUR=3600000,MAX_SNAPSHOT=48*HOUR;
const iso=(value:Date)=>value.toISOString(),hash=(value:unknown)=>canonicalCaseHash(JSON.parse(JSON.stringify(value)));
const minimum=(...values:Date[])=>new Date(Math.min(...values.map(value=>value.getTime())));
const deadline=(at:Date)=>new Date(at.getTime()+MAX_SNAPSHOT);
interface Capture {case_id:string;config_hash:string;target_hash:string;source_hash:string;fields:OperationalSourceField[];verified_role_ids:string[];role_observed_at:Date|null;role_expires_at:Date|null;first_captured_at:Date;expires_at:Date;}
interface RoleSeal {scope:Scope;actorHash:string;contextId:string;configHash:string;roleIds:string[];observedAt:Date;expiresAt:Date;}
interface FilterConfig {version:number;rule_hash:string;configured_language:string;definition_hash:string;configured_at:Date;first_captured_at:Date;expires_at:Date;}
interface QueueItem {message_id:string;item_type:string;version:number;status:string;opened_at:Date|null;detected_at:Date;updated_at:Date|null;}
interface AutoModFact {id:string;occurred_at:Date;rule_hash:string;action_type:number|null;}
interface Projection {fields:OperationalSourceField[];sourceHash:string;expiry:Date;filter?:{version:number;definitionHash:string;configuredAt:Date;previous?:FilterConfig};}
const storedField=z.object({fieldId:z.string(),value:z.union([z.string(),z.number().finite(),z.boolean(),z.null()]),quality:z.enum(["SUFFICIENT","PARTIAL","STALE","MISSING","SUPPRESSED","UNKNOWN"]),unit:z.enum(["state","boolean","count","ratio","seconds","minutes","instant","identifier"]),sourceKind:z.enum(["OPERATOR","SYSTEM_OBSERVATION"]),observedAt:z.string().datetime({offset:false}),expiresAt:z.string().datetime({offset:false}),sourceRevision:z.string().regex(/^[a-f0-9]{64}$/),sourceReference:z.string().regex(/^[a-f0-9]{64}$/),window:z.object({start:z.string(),end:z.string()}).strict(),periodRole:z.literal("CONTEXT")}).strict();

function checkWindow(window:{start:string;end:string},now:Date,retainedDays:number,nowExact:string){
 const startExact=canonicalRuleTimestamp(window.start),endExact=canonicalRuleTimestamp(window.end),start=new Date(startExact),end=new Date(endExact),asOf=timestampMicros(nowExact);
 assert(Number.isFinite(start.getTime())&&Number.isFinite(end.getTime())&&Number.isFinite(now.getTime())&&Number.isSafeInteger(retainedDays)&&retainedDays>0&&timestampMicros(startExact)<timestampMicros(endExact)&&timestampMicros(endExact)<=asOf
  &&timestampMicros(startExact)>asOf-BigInt(retainedDays)*86400000000n,"CASE_NATIVE_SOURCE_WINDOW_UNAVAILABLE",409);
 return {start,end,startExact,endExact};
}
function field(request:OperationalSourceRequest,fieldId:string,value:Scalar,unit:Unit,observed:Date,expiry:Date,reference:string,kind:OperationalSourceField["sourceKind"]="SYSTEM_OBSERVATION",quality:OperationalSourceField["quality"]="SUFFICIENT",window=request.window):OperationalSourceField {
 return {fieldId,value,unit,quality,sourceKind:kind,observedAt:iso(observed),expiresAt:iso(expiry),sourceRevision:reference,sourceReference:reference,window,periodRole:"CONTEXT"};
}
async function access(tx:Tx,s:Scope,a:Actor,request:Pick<OperationalSourceRequest,"proof"|"caseId">){
 assert(tx.isTransaction,"RULE_TRANSACTION_REQUIRED",500);
 const now=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
 assertMaintenanceAuthorization(request.proof,s,a,now);
 await operationsAccess(tx,s,a,["CASE13","CASE14","CASE15","CASE16"].includes(request.caseId)?"GOVERN":"ANALYZE");
 assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND (lookup_hash IS NULL OR lookup_hash=${a.key}) LIMIT 1`.execute(tx)).rows.length,"RESOURCE_DELETED",410);
 // These projections cannot certify independence from a pending erasure by
 // looking at a body/identity. Pause capture until that scoped purge finishes.
 assert(!(await sql`SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND completed_at IS NULL LIMIT 1`.execute(tx)).rows.length,"CASE_NATIVE_DELETION_PENDING",409);
 const checked=(await sql<{now:Date}>`SELECT clock_timestamp() AS now`.execute(tx)).rows[0]!.now;
 assertMaintenanceAuthorization(request.proof,s,a,checked);return checked;
}
async function currentAnalysisChannels(tx:Tx,s:Scope,at:Date){
 const settings=await new SettingsService(tx).get(s,tx),allowed=await analysisChannelScope(tx,s,settings);
 if(!allowed.actualChannelIds.length)return {ids:[] as string[],expiresAt:new Date(0)};
 const rows=(await sql<{channel_id:string;visibility_observed_at:Date}>`SELECT ch.channel_id,ch.visibility_observed_at FROM discord_surface_state ch WHERE ch.organization_id=${s.organizationId}::uuid AND ch.guild_id=${s.guildId} AND ch.channel_id IN (${sql.join(allowed.actualChannelIds)}) AND ch.visibility_state='VISIBLE' AND ch.visibility_observed_at<=${at} AND ch.visibility_observed_at>${new Date(at.getTime()-HOUR)} AND ch.deleted_at IS NULL AND NOT ch.collection_forbidden AND (ch.channel_type NOT IN (10,11) OR EXISTS(SELECT 1 FROM discord_surface_state p WHERE p.organization_id=ch.organization_id AND p.guild_id=ch.guild_id AND p.channel_id=ch.parent_id AND p.visibility_state='VISIBLE' AND p.visibility_observed_at<=${at} AND p.visibility_observed_at>${new Date(at.getTime()-HOUR)} AND p.deleted_at IS NULL AND NOT p.collection_forbidden)) ORDER BY ch.channel_id`.execute(tx)).rows;
 return {ids:rows.map(row=>row.channel_id),expiresAt:rows.length?minimum(...rows.map(row=>new Date(row.visibility_observed_at.getTime()+HOUR))):new Date(0)};
}

/** Exact native saved queue population. These are explicitly staff-classified
 * saved items; neither queue type nor a Discord-wide report census is inferred.
 * All current retained selected open items must appear exactly once. */
export function aggregateReviewedQueue(rows:readonly QueueItem[],reviews:Extract<OperationalNativeConfig,{kind:"QUEUE_REVIEW"}>["reviews"],at:Date){
 assert(rows.length<=500&&rows.length===reviews.length,"CASE_NATIVE_QUEUE_REVIEW_INCOMPLETE",409);
 const buckets=new Map<string,DutyAssignmentBucket>();let actionable=0,noise=0,allReviewed=true,allAssigned=true;
 for(const row of rows){
  assert(row.detected_at<=at&&(!row.updated_at||row.updated_at<=at),"CASE_NATIVE_QUEUE_CLOCK_UNAVAILABLE",409);
  const review=reviews.find(value=>value.attentionKey===row.message_id);
  assert(review&&review.expectedVersion===row.version,"CASE_NATIVE_QUEUE_VERSION_MISMATCH",412);
  if(review.classification==="ACTIONABLE")actionable++;else if(review.classification==="NOISE")noise++;else allReviewed=false;
  if(!review.assignment){allAssigned=false;continue;}
  const key=review.assignment.kind+":"+review.assignment.ref,current=buckets.get(key);
  buckets.set(key,{bucketKind:review.assignment.kind,bucketRef:review.assignment.ref,openAssignments:(current?.openAssignments??0)+1});
 }
 const concentration=deriveDutyConcentration(allAssigned?[...buckets.values()]:null);
 const clocks=rows.map(value=>value.opened_at??value.detected_at),oldest=clocks.length?new Date(Math.min(...clocks.map(value=>value.getTime()))):null;
 assert(clocks.every(value=>Number.isFinite(value.getTime())&&value<=at),"CASE_NATIVE_QUEUE_CLOCK_UNAVAILABLE",409);
 return {actionable,noise,allReviewed,load:rows.length,oldestMinutes:oldest?Math.floor((at.getTime()-oldest.getTime())/60000):null,concentration};
}
async function queue(tx:Tx,s:Scope,request:OperationalSourceRequest,c:Extract<OperationalNativeConfig,{kind:"QUEUE_REVIEW"}>,at:Date,roleIds:readonly string[],days:number):Promise<Projection>{
 assert(["CASE13","CASE14"].includes(request.caseId),"CASE_NATIVE_CONFIG_MISMATCH",422);
 const rows=(await sql<QueueItem>`SELECT message_id,item_type,version,status,opened_at,detected_at,updated_at FROM attention_items WHERE ${tenant(s)} AND item_type IN (${sql.join(c.itemTypes)}) AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS') ORDER BY message_id LIMIT 501`.execute(tx)).rows;
 assert(rows.length<=500,"CASE_NATIVE_QUEUE_SOURCE_LIMIT",409);
 for(const review of c.reviews)if(review.assignment?.kind==="ROLE")assert(roleIds.includes(review.assignment.ref),"CASE_DUTY_ROLE_NOT_OBSERVED",409);
 const values=aggregateReviewedQueue(rows,c.reviews,at),reference=hash({population:c.population,itemTypes:c.itemTypes,rows:rows.map(row=>({...row,opened_at:row.opened_at?iso(row.opened_at):null,detected_at:iso(row.detected_at),updated_at:row.updated_at?iso(row.updated_at):null})),reviews:c.reviews});
 // Classifications are this explicit review, not measurements guessed from an
 // Attention reason/category, and role/duty refs never identify a person.
 const expiry=minimum(deadline(at),...rows.map(row=>new Date(row.detected_at.getTime()+days*86400000))),out:OperationalSourceField[]=[];
 if(request.caseId==="CASE13"){
  out.push(field(request,"actionableCount",values.allReviewed?values.actionable:null,"count",at,expiry,reference,"OPERATOR",values.allReviewed?"SUFFICIENT":"UNKNOWN"),field(request,"noiseCount",values.allReviewed?values.noise:null,"count",at,expiry,reference,"OPERATOR",values.allReviewed?"SUFFICIENT":"UNKNOWN"));
 }else{
  out.push(field(request,"queueLoadCount",values.load,"count",at,expiry,reference));
  out.push(field(request,"oldestOpenQueueAgeMinutes",values.oldestMinutes,"minutes",at,expiry,reference,"SYSTEM_OBSERVATION",values.oldestMinutes===null?"UNKNOWN":"SUFFICIENT"));
  if(values.concentration.state!=="SOURCE_UNKNOWN")out.push(field(request,"assignmentConcentrationState",values.concentration.state,"state",at,expiry,reference,"OPERATOR"),field(request,"assignmentConcentrationNumerator",values.concentration.numerator,"count",at,expiry,reference,"OPERATOR"),field(request,"assignmentConcentrationDenominator",values.concentration.denominator,"count",at,expiry,reference,"OPERATOR"));
 }
 return {fields:out,sourceHash:reference,expiry};
}
async function filterReview(tx:Tx,s:Scope,request:OperationalSourceRequest,c:Extract<OperationalNativeConfig,{kind:"FILTER_REVIEW"}>,at:Date,days:number):Promise<Projection>{
 assert(request.caseId==="CASE15","CASE_NATIVE_CONFIG_MISMATCH",422);const window=checkWindow(c.window,at,days,request.evaluationAsOf);
 const settings=await new SettingsService(tx).get(s,tx),allowed=await currentAnalysisChannels(tx,s,at);
 assert(allowed.ids.length,"CASE_NATIVE_FILTER_SCOPE_UNAVAILABLE",409);
 const previous=(await sql<FilterConfig>`SELECT * FROM rule_operational_filter_configs WHERE ${tenant(s)} AND context_id=${request.contextId}::uuid`.execute(tx)).rows[0];
 assert(!previous||previous.expires_at>at,"CASE_NATIVE_FILTER_CONFIG_EXPIRED",410);
 const definitionHash=hash({ruleHash:c.filter.ruleHash,configuredLanguage:c.filter.configuredLanguage}),unchanged=previous?.definition_hash===definitionHash;
 assert(unchanged||(previous?.version??0)===c.filter.expectedVersion,"CASE_NATIVE_FILTER_CONFIG_VERSION_MISMATCH",412);
 const version=unchanged?previous!.version:c.filter.expectedVersion+1;
 const known=(await sql`SELECT f.id FROM adaptive_facts f WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.kind='auto_moderation.executed' AND f.data->>'ruleHash'=${c.filter.ruleHash} AND f.data->>'channelId' IN (${sql.join(allowed.ids)}) AND f.occurred_at>=${new Date(at.getTime()-days*86400000)} AND f.occurred_at<=${at} AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=f.organization_id AND d.guild_id=f.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=f.subject_hash OR d.lookup_hash=f.target_hash)) LIMIT 1`.execute(tx)).rows.length;
 assert(known,"CASE_NATIVE_FILTER_NOT_OBSERVED",409);
 const ids=c.reviews.map(value=>value.factId),rows=ids.length?(await sql<AutoModFact>`SELECT f.id,f.occurred_at,f.data->>'ruleHash' AS rule_hash,(f.data->>'actionType')::integer AS action_type FROM adaptive_facts f WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.id=ANY(${ids}::uuid[]) AND f.kind='auto_moderation.executed' AND f.data->>'channelId' IN (${sql.join(allowed.ids)}) AND f.occurred_at>=${window.startExact}::timestamptz AND f.occurred_at<${window.endExact}::timestamptz AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=f.organization_id AND d.guild_id=f.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=f.subject_hash OR d.lookup_hash=f.target_hash)) ORDER BY f.id`.execute(tx)).rows:[];
 assert(rows.length===ids.length&&rows.every(row=>/^[a-f0-9]{64}$/.test(row.rule_hash)),"CASE_NATIVE_FILTER_REVIEW_SOURCE_GONE",410);
 assert(!rows.length||rows.some(row=>row.rule_hash===c.filter.ruleHash),"CASE_NATIVE_FILTER_RULE_NOT_IN_REVIEW",409);
 const aggregate=deriveFilterReview({reviewSetRef:c.reviewSetId,staffFpCount:c.reviews.filter(value=>value.falsePositive).length,totalReviewed:rows.length,triggeredRuleIds:rows.map(value=>value.rule_hash)});
 const reference=hash({reviewUnit:c.reviewUnit,definitionHash,version,settingsRevision:settings.revision,permittedChannels:allowed.ids,window:c.window,reviewSetId:c.reviewSetId,reviews:c.reviews,rows:rows.map(row=>({...row,occurred_at:iso(row.occurred_at)}))});
 const expiry=minimum(deadline(at),allowed.expiresAt,previous?.expires_at??deadline(at),...rows.map(row=>new Date(row.occurred_at.getTime()+days*86400000)));
 const configuredAt=unchanged?previous!.configured_at:at;
 const out=[field(request,"ruleId",c.filter.ruleHash,"identifier",configuredAt,expiry,reference,"OPERATOR",undefined,c.window),field(request,"ruleVersion",version,"count",configuredAt,expiry,reference,"OPERATOR",undefined,c.window),field(request,"configuredLanguage",c.filter.configuredLanguage,"identifier",configuredAt,expiry,reference,"OPERATOR",undefined,c.window),field(request,"reviewSetRef",aggregate.reviewSetRef,"identifier",at,expiry,reference,"OPERATOR",undefined,c.window),field(request,"staffFpCount",aggregate.staffFpCount,"count",at,expiry,reference,"OPERATOR",undefined,c.window),field(request,"totalReviewed",aggregate.totalReviewed,"count",at,expiry,reference,"OPERATOR",undefined,c.window),field(request,"triggeredRuleCount",aggregate.triggeredRuleCount,"count",at,expiry,reference,"SYSTEM_OBSERVATION",undefined,c.window)];
 return {fields:out,sourceHash:reference,expiry,filter:{version,definitionHash,configuredAt,previous}};
}

interface Coverage {first_seen:Date|null;last_seen:Date|null;epoch_start:Date|null;epoch_end:Date|null;introduced_at:Date|null;gaps:boolean;gateway_state:string|null;last_gateway_at:Date|null;messages:string|null;exact_prefix_covered?:boolean;}
/** Full retained location-stream coverage is required even for a known zero.
 * A latest observed reply cannot be certified from a partial event sample. */
export function completePostingCoverage(row:Coverage,start:Date,end:Date,asOf:Date){
 return !!(row.exact_prefix_covered!==false&&row.first_seen&&row.last_seen&&row.epoch_start&&row.introduced_at&&!row.gaps&&row.first_seen<=start&&row.epoch_start<=start&&(!row.epoch_end||row.epoch_end>=end)&&row.introduced_at<=start&&row.last_seen<=asOf&&row.last_seen.getTime()+90000>=end.getTime()&&row.gateway_state==="CONNECTED"&&row.messages==="AVAILABLE"&&row.last_gateway_at&&row.last_gateway_at<=asOf&&row.last_gateway_at.getTime()+90000>=asOf.getTime());
}
async function posting(tx:Tx,s:Scope,request:OperationalSourceRequest,c:Extract<OperationalNativeConfig,{kind:"CHANNEL_POSTING"}>,at:Date,days:number,originalTailEnd?:string):Promise<Projection>{
 assert(["CASE19","CASE20"].includes(request.caseId)&&["CHANNEL","FORUM"].includes(request.target.targetType),"CASE_NATIVE_CONFIG_MISMATCH",422);
 checkWindow(c.window,at,days,request.evaluationAsOf);
 // CASE19 is an explicit business window. CASE20 means latest retained reply
 // at capture, so its tail must reach that capture rather than a past window end.
 // Revalidation keeps the original bound and checks separately for later posts.
 const sourceWindow=request.caseId==="CASE20"?{start:c.window.start,end:originalTailEnd??request.evaluationAsOf}:c.window;
 const window=checkWindow(sourceWindow,at,days,request.evaluationAsOf),exactWindow={start:window.startExact,end:window.endExact};
 // Missing collection after the original capture also invalidates a current
 // latest-reply claim, even if no later post reached the retained stream.
 const coverageEnd=request.caseId==="CASE20"?canonicalRuleTimestamp(request.evaluationAsOf):window.endExact;
 const settings=await new SettingsService(tx).get(s,tx),scope=await analysisChannelScope(tx,s,settings);
 const snapshot=(await sql<{id:string;snapshot:CapabilitySnapshot;checked_at:Date}>`SELECT id,snapshot,checked_at FROM guild_capability_snapshots WHERE ${tenant(s)} AND checked_at<=${at} ORDER BY checked_at DESC,id DESC LIMIT 1`.execute(tx)).rows[0],channel=snapshot?.snapshot.channels.find(value=>value.id===request.target.targetId);
 const surface=(await sql<{parent_id:string|null;channel_type:number;visibility_state:string;visibility_observed_at:Date|null;deleted_at:Date|null;collection_forbidden:boolean}>`SELECT parent_id,channel_type,visibility_state,visibility_observed_at,deleted_at,collection_forbidden FROM discord_surface_state WHERE ${tenant(s)} AND channel_id=${request.target.targetId}`.execute(tx)).rows[0];
 assert(snapshot&&snapshot.checked_at.getTime()+HOUR>at.getTime()&&channel&&channel.observable&&!channel.deleted&&!channel.collectionForbidden&&scope.actualChannelIds.includes(channel.id)&&nativeObservedChannelVersion(snapshot.id,channel)===request.target.liveVersion,"CASE_NATIVE_POSTING_TARGET_NOT_OBSERVED",412);
 assert(surface&&surface.visibility_state==="VISIBLE"&&surface.visibility_observed_at&&surface.visibility_observed_at<=at&&surface.visibility_observed_at.getTime()+HOUR>at.getTime()&&!surface.deleted_at&&!surface.collection_forbidden&&surface.channel_type===channel.type&&surface.parent_id===channel.parentId,"CASE_NATIVE_POSTING_SCOPE_UNAVAILABLE",409);
 // Forum containers have no complete archived-thread census in the current
 // native contract. Never relabel their currently visible subset as complete.
 if(channel.type===15)return {fields:[],sourceHash:hash({snapshot:snapshot.id,reason:"FORUM_THREAD_CENSUS_INCOMPLETE"}),expiry:new Date(snapshot.checked_at.getTime()+HOUR)};
 const health=(await sql<Coverage>`SELECT t.first_seen,t.last_seen,e.started_at AS epoch_start,e.ended_at AS epoch_end,p.introduced_at,COALESCE(t.first_seen<=${window.startExact}::timestamptz AND p.introduced_at<=${window.startExact}::timestamptz,false) AS exact_prefix_covered,
 EXISTS(SELECT 1 FROM telemetry_health g WHERE g.organization_id=${s.organizationId}::uuid AND g.guild_id=${s.guildId} AND g.started_at<${coverageEnd}::timestamptz AND (g.ended_at IS NULL OR g.ended_at>${window.startExact}::timestamptz)) AS gaps,h.gateway_state,h.last_gateway_at,h.intents->>'messages' AS messages
 FROM (SELECT 1) q LEFT JOIN telemetry_cursor t ON t.organization_id=${s.organizationId}::uuid AND t.guild_id=${s.guildId}
 LEFT JOIN discord_integration_health h ON h.organization_id=${s.organizationId}::uuid AND h.guild_id=${s.guildId}
 LEFT JOIN location_population_collection p ON p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId}
 LEFT JOIN LATERAL(SELECT started_at,ended_at FROM collection_epochs WHERE ${tenant(s)} AND source='GATEWAY' AND started_at<=${window.startExact}::timestamptz AND (ended_at IS NULL OR ended_at>=${coverageEnd}::timestamptz) ORDER BY started_at DESC LIMIT 1)e ON true`.execute(tx)).rows[0]!;
 const rows=(await sql<{count:string;oldest:Date|null;latest:Date|null;last_reply:Date|null;legacy:string}>`SELECT count(*)::text AS count,min(sent_at) AS oldest,max(sent_at) AS latest,max(sent_at) FILTER(WHERE message_type=${MessageType.Reply} AND reference_id IS NOT NULL OR ${channel.type} IN (10,11) AND message_id<>channel_id) AS last_reply,count(*) FILTER(WHERE population_source<>'LOCATION_STREAM_V1')::text AS legacy FROM location_post_observations WHERE ${tenant(s)} AND channel_id=${channel.id} AND sent_at>=${window.startExact}::timestamptz AND sent_at<${window.endExact}::timestamptz`.execute(tx)).rows[0]!;
 const later=request.caseId==="CASE20"&&originalTailEnd?(await sql<{count:string;latest:Date|null}>`SELECT count(*)::text AS count,max(sent_at) AS latest FROM location_post_observations WHERE ${tenant(s)} AND channel_id=${channel.id} AND sent_at>=${window.endExact}::timestamptz AND sent_at<${request.evaluationAsOf}::timestamptz`.execute(tx)).rows[0]!:{count:"0",latest:null};
 const complete=completePostingCoverage(health,window.start,new Date(coverageEnd),at)&&rows.legacy==="0";
 const reference=hash({snapshot:snapshot.id,channel,surface:{...surface,visibility_observed_at:iso(surface.visibility_observed_at)},window:exactWindow,rows:{...rows,oldest:rows.oldest?iso(rows.oldest):null,latest:rows.latest?iso(rows.latest):null,last_reply:rows.last_reply?iso(rows.last_reply):null},later:{count:later.count,latest:later.latest?iso(later.latest):null},epochStart:health.epoch_start?iso(health.epoch_start):null,introduced:health.introduced_at?iso(health.introduced_at):null,gaps:health.gaps,complete});
 const observed=health.last_gateway_at??snapshot.checked_at,expiry=minimum(deadline(observed),new Date(snapshot.checked_at.getTime()+HOUR),new Date(surface.visibility_observed_at.getTime()+HOUR),new Date(window.start.getTime()+days*86400000));
 if(!complete)return {fields:[],sourceHash:reference,expiry};
 if(request.caseId==="CASE19")return {fields:[field(request,"postingAggregate","OBSERVED","state",observed,expiry,reference,"SYSTEM_OBSERVATION",undefined,exactWindow)],sourceHash:reference,expiry};
 // Actual metadata after the saved tail changes sourceHash without moving its
 // boundary or source clock. Common snapshot comparison then closes UNKNOWN.
 // No reply in a retained tail cannot certify a global never-replied state.
 return {fields:rows.last_reply?[field(request,"lastReplyAt",iso(rows.last_reply),"instant",observed,expiry,reference,"SYSTEM_OBSERVATION",undefined,exactWindow)]:[],sourceHash:reference,expiry};
}

/** Caller already holds the complete canonical scope set. Actor erasure uses
 * the same conservative source-wide invalidation: no per-person shadow index. */
export async function purgeOperationalNativeContextSources(tx:Tx,s:Scope){assert(tx.isTransaction,"RULE_TRANSACTION_REQUIRED",500);await sql`DELETE FROM rule_operational_native_captures WHERE ${tenant(s)}`.execute(tx);await sql`DELETE FROM rule_operational_filter_configs WHERE ${tenant(s)}`.execute(tx);}
export async function expireOperationalNativeContextSources(tx:Tx,s:Scope,now:Date){assert(tx.isTransaction,"RULE_TRANSACTION_REQUIRED",500);await sql`DELETE FROM rule_operational_native_captures WHERE ${tenant(s)} AND expires_at<=${now}`.execute(tx);await sql`DELETE FROM rule_operational_filter_configs WHERE ${tenant(s)} AND expires_at<=${now}`.execute(tx);}
/** Authorized metadata choices, not new observations or a hidden unbounded
 * census. No member/actor/body column is selected or returned. */
export async function readOperationalNativeSourceOptions(tx:Tx,s:Scope,a:Actor,proof:MaintenanceAuthorizationProof){
 const request={caseId:"CASE13",proof},at=await access(tx,s,a,request),settings=await new SettingsService(tx).get(s,tx),allowed=await currentAnalysisChannels(tx,s,at),cutoff=new Date(at.getTime()-settings.detailedRetentionDays*86400000);
 const queueRows=(await sql<{attention_key:string;item_type:string;version:number;opened_at:Date|null;detected_at:Date}>`SELECT message_id AS attention_key,item_type,version,opened_at,detected_at FROM attention_items WHERE ${tenant(s)} AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS') AND detected_at>=${cutoff} AND detected_at<=${at} ORDER BY message_id LIMIT 501`.execute(tx)).rows;
 const expiredQueueSource=(await sql`SELECT 1 FROM attention_items WHERE ${tenant(s)} AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS') AND detected_at<${cutoff} LIMIT 1`.execute(tx)).rows.length>0;
 const events=allowed.ids.length?(await sql<{id:string;rule_hash:string;occurred_at:Date}>`SELECT f.id,f.data->>'ruleHash' AS rule_hash,f.occurred_at FROM adaptive_facts f WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.kind='auto_moderation.executed' AND f.occurred_at>=${cutoff} AND f.occurred_at<=${at} AND f.data->>'channelId' IN (${sql.join(allowed.ids)}) AND f.data->>'ruleHash'~'^[a-f0-9]{64}$' AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=f.organization_id AND d.guild_id=f.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=f.subject_hash OR d.lookup_hash=f.target_hash)) ORDER BY f.occurred_at DESC,f.id LIMIT 501`.execute(tx)).rows:[];
 const filters=(await sql<{context_id:string;version:number;rule_hash:string;configured_language:string;expires_at:Date}>`SELECT context_id,version,rule_hash,configured_language,expires_at FROM rule_operational_filter_configs WHERE ${tenant(s)} AND expires_at>${at} ORDER BY context_id LIMIT 101`.execute(tx)).rows;
 assert(filters.length<=100,"CASE_NATIVE_FILTER_LIMIT",409);await access(tx,s,a,request);
 return {asOf:iso(at),queue:{population:"CURRENT_RETAINED_NATIVE_ATTENTION_V1" as const,complete:queueRows.length<=500&&!expiredQueueSource,truncated:queueRows.length>500,expiredSourcePending:expiredQueueSource,items:queueRows.slice(0,500).map(row=>({attentionKey:row.attention_key,itemType:row.item_type,expectedVersion:row.version,openedAt:iso(row.opened_at??row.detected_at)}))},autoMod:{unit:"NATIVE_AUTOMOD_EXECUTION_EVENT" as const,truncated:events.length>500,events:events.slice(0,500).map(row=>({factId:row.id,ruleHash:row.rule_hash,occurredAt:iso(row.occurred_at)}))},filters:filters.map(row=>({contextId:row.context_id,version:row.version,ruleHash:row.rule_hash,configuredLanguage:row.configured_language,expiresAt:iso(row.expires_at)}))};
}
function editorSchema(){
 const schema=z.toJSONSchema(operationalNativeConfig),branches=(schema.anyOf??schema.oneOf) as {properties?:{kind?:{const?:unknown}};[key:string]:unknown}[]|undefined;
 for(const branch of branches??[]){const kind=branch.properties?.kind?.const;branch["x-case-ids"]=kind==="QUEUE_REVIEW"?["CASE13","CASE14"]:kind==="FILTER_REVIEW"?["CASE15"]:kind==="CHANNEL_POSTING"?["CASE19","CASE20"]:[];}
 return schema;
}
export function createOperationalNativeContextPlugin():OperationalSourcePlugin {
 const roleSeals=new WeakMap<object,RoleSeal>();
 return {id:"CASE_13_20_NATIVE",supportedFields:OPERATIONAL_NATIVE_FIELDS,editorSchema:editorSchema(),parseConfig:value=>operationalNativeConfig.parse(value),
 async outsideTx(db,s,a,request,ports){
  const config=operationalNativeConfig.parse(request.config),requested=config.kind==="QUEUE_REVIEW"?[...new Set(config.reviews.flatMap(value=>value.assignment?.kind==="ROLE"?[value.assignment.ref]:[]))]:[];
  if(!requested.length)return undefined;
  const authorize=()=>db.transaction().execute(async tx=>{await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));return access(tx,s,a,request);});
  await authorize();assert(ports.discord,"CASE_DUTY_ROLE_OBSERVATION_UNAVAILABLE",503);
  const roles=await ports.discord.roles(s.guildId),observedAt=new Date();await authorize();
  assert(requested.length<=128&&requested.every(id=>roles.some(value=>value.id===id&&!value.managed&&value.id!==s.guildId)),"CASE_DUTY_ROLE_NOT_OBSERVED",409);
  const token=Object.freeze({kind:"NATIVE_DUTY_ROLE_INVENTORY"});
  roleSeals.set(token,{scope:{...s},actorHash:a.key,contextId:request.contextId,configHash:hash(config),roleIds:requested,observedAt,expiresAt:minimum(new Date(observedAt.getTime()+HOUR),request.proof.expiresAt)});return token;
 },
 async read(tx,s,a,request){
  const checked=await access(tx,s,a,request),at=new Date(request.evaluationAsOf),config=operationalNativeConfig.parse(request.config);
  assert(Number.isFinite(at.getTime())&&at<=checked,"CASE_NATIVE_CLOCK_INVALID",409);
  const settings=await new SettingsService(tx).get(s,tx),saved=(await sql<Capture>`SELECT * FROM rule_operational_native_captures WHERE ${tenant(s)} AND context_id=${request.contextId}::uuid`.execute(tx)).rows[0];
  const parent=(await sql<{expires_at:Date}>`SELECT expires_at FROM rule_operational_contexts WHERE ${tenant(s)} AND id=${request.contextId}::uuid`.execute(tx)).rows[0];
  assert(!saved||saved.expires_at>at,"CASE_NATIVE_CAPTURE_EXPIRED",410);
  const prepared=request.prepared&&typeof request.prepared==="object"?roleSeals.get(request.prepared):undefined;
  const requiresRoles=config.kind==="QUEUE_REVIEW"&&config.reviews.some(value=>value.assignment?.kind==="ROLE");
  const savedRoles=requiresRoles&&request.phase==="VALIDATE"&&saved?.config_hash===hash(config)&&saved.role_observed_at&&saved.role_observed_at<=at&&saved.role_expires_at&&saved.role_expires_at>at?saved:null;
  if(requiresRoles&&!savedRoles)assert(prepared?.scope.organizationId===s.organizationId&&prepared.scope.guildId===s.guildId&&prepared.actorHash===a.key&&prepared.contextId===request.contextId&&prepared.configHash===hash(config)&&prepared.observedAt<=at&&prepared.expiresAt>at,"CASE_DUTY_ROLE_OBSERVATION_UNAVAILABLE",409);
  const roleIds=savedRoles?.verified_role_ids??prepared?.roleIds??[],roleObserved=savedRoles?.role_observed_at??prepared?.observedAt??null,roleExpiry=savedRoles?.role_expires_at??prepared?.expiresAt??null;
  const originalTailEnd=request.phase==="VALIDATE"&&request.caseId==="CASE20"&&saved?.case_id==="CASE20"&&saved.config_hash===hash(config)&&saved.target_hash===hash(request.target)?z.array(storedField).max(16).parse(saved.fields).find(value=>value.fieldId==="lastReplyAt")?.window.end:undefined;
  const projection:Projection=config.kind==="QUEUE_REVIEW"?await queue(tx,s,request,config,at,roleIds,settings.detailedRetentionDays):config.kind==="FILTER_REVIEW"?await filterReview(tx,s,request,config,at,settings.detailedRetentionDays):config.kind==="CHANNEL_POSTING"?await posting(tx,s,request,config,at,settings.detailedRetentionDays,originalTailEnd):{fields:[],sourceHash:hash({reason:"PLATFORM_ACTIVE_ALERT_CONTRACT_UNAVAILABLE"}),expiry:deadline(at)};
  if(config.kind==="PLATFORM_ALERT")assert(request.caseId==="CASE16","CASE_NATIVE_CONFIG_MISMATCH",422);
  const configHash=hash(config),targetHash=hash(request.target),expiry=minimum(projection.expiry,parent?.expires_at??deadline(at),request.captureExpiresAt?new Date(request.captureExpiresAt):deadline(at),saved?.expires_at??deadline(at),deadline(saved?.first_captured_at??at),...(requiresRoles&&roleExpiry?[roleExpiry]:[]));
  assert(expiry>at,"CASE_NATIVE_SOURCE_EXPIRED",410);
  if(saved?.case_id===request.caseId&&saved.config_hash===configHash&&saved.target_hash===targetHash&&saved.source_hash===projection.sourceHash&&saved.expires_at.getTime()===expiry.getTime()){
   const fields=z.array(storedField).max(16).parse(saved.fields);await access(tx,s,a,request);return fields;
  }
  const fields=projection.fields.map(value=>({...value,expiresAt:iso(minimum(new Date(value.expiresAt),expiry))}));
  if(request.phase==="CAPTURE"){
   await request.beforeWrite();await access(tx,s,a,request);
   if(projection.filter&&config.kind==="FILTER_REVIEW"){
    const current=projection.filter,first=current.previous?.first_captured_at??at;
    await sql`INSERT INTO rule_operational_filter_configs(organization_id,guild_id,context_id,version,rule_hash,configured_language,definition_hash,configured_at,first_captured_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${request.contextId}::uuid,${current.version},${config.filter.ruleHash},${config.filter.configuredLanguage},${current.definitionHash},${current.configuredAt},${first},${expiry}) ON CONFLICT(organization_id,guild_id,context_id) DO UPDATE SET version=EXCLUDED.version,rule_hash=EXCLUDED.rule_hash,configured_language=EXCLUDED.configured_language,definition_hash=EXCLUDED.definition_hash,configured_at=EXCLUDED.configured_at,expires_at=LEAST(rule_operational_filter_configs.expires_at,EXCLUDED.expires_at)`.execute(tx);
   }
   await request.beforeWrite();await access(tx,s,a,request);
   await sql`INSERT INTO rule_operational_native_captures(organization_id,guild_id,context_id,case_id,config_hash,target_hash,source_hash,fields,verified_role_ids,role_observed_at,role_expires_at,first_captured_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${request.contextId}::uuid,${request.caseId},${configHash},${targetHash},${projection.sourceHash},${json(fields)},${requiresRoles?roleIds:[]}::text[],${requiresRoles?roleObserved:null},${requiresRoles?roleExpiry:null},${saved?.first_captured_at??at},${expiry}) ON CONFLICT(organization_id,guild_id,context_id) DO UPDATE SET case_id=EXCLUDED.case_id,config_hash=EXCLUDED.config_hash,target_hash=EXCLUDED.target_hash,source_hash=EXCLUDED.source_hash,fields=EXCLUDED.fields,verified_role_ids=EXCLUDED.verified_role_ids,role_observed_at=EXCLUDED.role_observed_at,role_expires_at=EXCLUDED.role_expires_at,expires_at=LEAST(rule_operational_native_captures.expires_at,EXCLUDED.expires_at)`.execute(tx);
  }
  await access(tx,s,a,request);return fields;
 },
 purge:purgeOperationalNativeContextSources,purgeActor:purgeOperationalNativeContextSources,expire:expireOperationalNativeContextSources,
 };
}
