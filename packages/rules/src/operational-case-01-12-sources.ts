import {z} from "zod";
import {sql,tenant,type Tx} from "../../db/src/index";
import {assert,type Scope} from "../../shared/src/index";
import {SettingsService,type Actor} from "../../settings/src/index";
import {operationsAccess} from "../../operations/src/policy";
import {assertMaintenanceAuthorization} from "../../operations/src/maintenance-authorization";
import {analysisChannelScope} from "../../lifecycle/src/discovery";
import {validateFlow} from "../../onboarding/src/flow";
import {addCalendarDays,dateBoundary} from "../../automation/src/datetime";
import {canonicalRuleTimestamp,hashRuleValue,timestampMicros} from "./facts";
import {nativeCohortDefinition} from "./native-cohort-config";
import {observeCaseMetrics,expireCaseMetricObservations,purgeCaseMetricObservations,type NativeCaseMetric,type NativeCaseRead} from "./case-metric-observations";
import type {CohortMetadata,Window} from "./case-types";
import type {OperationalSourcePlugin,OperationalSourceRequest} from "./operational-context-sources";

const discordId=z.string().regex(/^\d{17,20}$/),label=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const instant=z.string().refine(value=>{try{canonicalRuleTimestamp(value);return true;}catch{return false;}},"EXACT_UTC_INSTANT_REQUIRED");
const timeZone=z.string().max(80).refine(value=>{try{new Intl.DateTimeFormat("en",{timeZone:value});return true;}catch{return false;}},"IANA_TIME_ZONE_REQUIRED");
const window=z.object({start:instant,end:instant}).strict().refine(value=>timestampMicros(value.start)<timestampMicros(value.end),"WINDOW_ORDER");
const uniqueIds=z.array(discordId).min(1).max(100).refine(values=>new Set(values).size===values.length);
const shared={settingsRevision:z.number().int().nonnegative()};
const period=z.discriminatedUnion("windowKind",[
 z.object({windowKind:z.literal("ELAPSED"),window,timeZone}).strict(),
 z.object({windowKind:z.literal("CALENDAR_DAY"),window,timeZone,calendarDays:z.number().int().min(1).max(30),calendarStartDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),calendarEndDateExclusive:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict()
]);
const maturityPoint=z.object({joinWindow:window,period}).strict();
const maturitySeries=z.object({current:maturityPoint,prior:maturityPoint,maturityOffsetSeconds:z.number().int().nonnegative().max(30*86400),maturityWindowSeconds:z.number().int().positive().max(30*86400)}).strict();
const eventPeriod=z.object({eventIds:uniqueIds,period}).strict();
export const case01To12SourceConfig=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("WELCOME_REPLIES"),...shared,channelId:discordId,rootMessageIds:uniqueIds,flowVersionId:z.uuid().nullable()}).strict(),
 z.object({kind:z.literal("CANONICAL_ISSUE"),...shared,channelId:discordId,attentionKey:discordId,attentionVersion:z.number().int().nonnegative(),reopenContract:z.literal("SAME_NATIVE_ISSUE_CLOSED_TO_OPEN_V1")}).strict(),
 z.object({kind:z.literal("MATURED_PARTICIPATION"),...shared,channelIds:uniqueIds,signals:z.array(z.enum(["message.sent","reaction.added","reply.received","thread.member_added","voice.duration","scheduled_event.attended"])).min(1).max(6).refine(values=>new Set(values).size===values.length),campaignClass:label,newSeries:maturitySeries,establishedSeries:maturitySeries}).strict(),
 z.object({kind:z.literal("UPCOMING_EVENT"),...shared,eventId:discordId}).strict(),
 z.object({kind:z.literal("FORMAT_COMPARISON"),...shared,channelIds:uniqueIds,purposeClass:z.enum(["COMMUNITY_CONNECTION","STUDY","PROJECT"]),current:eventPeriod,prior:eventPeriod,minN:z.number().int().positive().max(200000),comparisonContract:z.literal("FORMAT.DEDICATED_ATTENDANCE_COMPARISON_V1")}).strict(),
 z.object({kind:z.literal("INTEGRATION_ERRORS"),...shared,contract:z.literal("CURRENT_NATIVE_INTEGRATION_COMPONENT_ERRORS_V1")}).strict(),
 z.object({kind:z.literal("CHANNEL_MESSAGE_COUNT"),...shared,channelId:discordId,population:z.literal("ALL_OBSERVED_HUMAN_POSTS_V1")}).strict(),
 z.object({kind:z.literal("EVENT_REPEAT"),...shared,channelIds:uniqueIds,prior:eventPeriod,current:eventPeriod,campaignClass:label,repeatContract:z.literal("EVENT.REPEAT_WINDOW_V1")}).strict(),
 z.object({kind:z.literal("ANNOUNCEMENT_MENTIONS"),...shared,channelId:discordId,messageId:discordId,countContract:z.literal("DISTINCT_ROLE_EVERYONE_TARGETS_V1")}).strict()
]);
type Config=z.infer<typeof case01To12SourceConfig>;
type Settings=Awaited<ReturnType<SettingsService["get"]>>;
const iso=(value:Date)=>canonicalRuleTimestamp(value.toISOString());
const min=(...values:string[])=>values.reduce((a,b)=>timestampMicros(a)<=timestampMicros(b)?a:b);
const retentionEnd=(at:string,days:number)=>iso(new Date(Date.parse(at)+days*86400000));
const empty=(reason:string):NativeCaseRead=>({fields:[],source:{reason}});
const field=(fieldId:string,value:NativeCaseMetric["value"],unit:NativeCaseMetric["unit"],expiresAt:string,periodWindow:Window):NativeCaseMetric=>({fieldId,value,unit,expiresAt,window:periodWindow});

/** Exact finite catalog; absent personal feedback/outcome/interest is not a
 * native field and cannot be entered through this source configuration. */
export const CASE_01_12_NATIVE_FIELDS:Readonly<Record<string,readonly string[]>>={
 CASE02:["welcome.humanStaffReplyCount","welcome.botReplyCount","welcome.nextDestinationConfigured"],
 CASE03:["support.unansweredAgeSeconds"],CASE04:["support.sameTopicReopenCount"],
 CASE05:["cohort.newCurrent","cohort.newPrior","cohort.establishedCurrent","cohort.establishedPrior"],
 CASE06:["event.scheduled"],CASE07:["format.comparableParticipationState"],CASE08:["activity.integrationErrorCount"],
 CASE10:["channel.messageCount"],CASE11:["event.repeatPoint","event.repeatSourceContract"],CASE12:["announcement.mentionCount"]
};
const kinds:Readonly<Record<string,Config["kind"]>>={CASE02:"WELCOME_REPLIES",CASE03:"CANONICAL_ISSUE",CASE04:"CANONICAL_ISSUE",CASE05:"MATURED_PARTICIPATION",CASE06:"UPCOMING_EVENT",CASE07:"FORMAT_COMPARISON",CASE08:"INTEGRATION_ERRORS",CASE10:"CHANNEL_MESSAGE_COUNT",CASE11:"EVENT_REPEAT",CASE12:"ANNOUNCEMENT_MENTIONS"};
function editorSchema(){
 const schema=z.toJSONSchema(case01To12SourceConfig,{unrepresentable:"any"}) as Record<string,unknown>;
 for(const key of ["oneOf","anyOf"]){const branches=schema[key];if(Array.isArray(branches))for(const raw of branches){const branch=raw as {properties?:{kind?:{const?:string}};"x-case-ids"?:string[]},kind=branch.properties?.kind?.const;if(kind)branch["x-case-ids"]=Object.entries(kinds).filter(([,value])=>value===kind).map(([caseId])=>caseId);}}
 return schema;
}

interface Coverage {first_seen:Date|null;last_seen:Date|null;epoch_start:Date|null;gaps:boolean;intents:Record<string,string>|null;gateway_state:string|null;last_gateway_at:Date|null;introduced_at:Date|null;bot_reference_started_at:Date|null;bot_reference_observed_at:Date|null;source_clocks_valid:boolean|null;location_started_valid:boolean|null;bot_contract_valid:boolean|null;}
async function coverage(tx:Tx,s:Scope,from:string,to:string,now:string,intents:readonly string[],location=false,bot=false){
 const row=(await sql<Coverage>`SELECT c.first_seen,c.last_seen,e.started_at AS epoch_start,
 EXISTS(SELECT 1 FROM telemetry_health g WHERE g.organization_id=${s.organizationId}::uuid AND g.guild_id=${s.guildId} AND g.started_at<${to}::timestamptz AND (g.ended_at IS NULL OR g.ended_at>${from}::timestamptz)) AS gaps,
 h.intents,h.gateway_state,h.last_gateway_at,p.introduced_at,p.bot_reference_started_at,p.bot_reference_observed_at,
 (c.first_seen<=${from}::timestamptz AND c.last_seen<=${now}::timestamptz AND c.last_seen+interval '90 seconds'>=${to}::timestamptz AND h.last_gateway_at<=${now}::timestamptz AND h.last_gateway_at+interval '90 seconds'>=${now}::timestamptz) AS source_clocks_valid,
 (p.introduced_at<=${from}::timestamptz) AS location_started_valid,
 (p.bot_reference_started_at<=${from}::timestamptz AND p.bot_reference_observed_at=h.last_gateway_at) AS bot_contract_valid
 FROM (SELECT 1) q LEFT JOIN telemetry_cursor c ON c.organization_id=${s.organizationId}::uuid AND c.guild_id=${s.guildId}
 LEFT JOIN discord_integration_health h ON h.organization_id=${s.organizationId}::uuid AND h.guild_id=${s.guildId}
 LEFT JOIN location_population_collection p ON p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId}
 LEFT JOIN LATERAL(SELECT started_at FROM collection_epochs WHERE ${tenant(s)} AND source='GATEWAY' AND started_at<=${from}::timestamptz AND (ended_at IS NULL OR ended_at>=${to}::timestamptz) ORDER BY started_at DESC LIMIT 1) e ON true`.execute(tx)).rows[0];
 const complete=!!(row?.epoch_start&&!row.gaps&&row.source_clocks_valid===true&&row.gateway_state==="CONNECTED"&&intents.every(intent=>row.intents?.[intent]==="AVAILABLE")&&(!location||row.location_started_valid===true)&&(!bot||row.bot_contract_valid===true));
 return {complete,epoch:row?.epoch_start?iso(row.epoch_start):null};
}
async function channelBinding(tx:Tx,s:Scope,settings:Settings,ids:readonly string[],now:string,purpose?:string|readonly string[]){
 const allowed=await analysisChannelScope(tx,s,settings),selected=new Set(allowed.actualChannelIds);
 if(!ids.every(id=>selected.has(id)))return null;
 const rows=(await sql<{channel_id:string;visibility_observed_at:Date|null;visibility_state:string;deleted_at:Date|null;collection_forbidden:boolean;channel_type:number;parent_id:string|null}>`SELECT channel_id,visibility_observed_at,visibility_state,deleted_at,collection_forbidden,channel_type,parent_id FROM discord_surface_state WHERE ${tenant(s)} AND channel_id IN (${sql.join(ids)})`.execute(tx)).rows;
 if(rows.length!==ids.length||rows.some(row=>!row.visibility_observed_at||row.visibility_observed_at>new Date(now)||row.visibility_observed_at.getTime()+3600000<=Date.parse(now)||row.visibility_state!=="VISIBLE"||row.deleted_at||row.collection_forbidden))return null;
 if(purpose&&ids.some(id=>{const actual=allowed.resolutions.find(value=>value.actualChannelId===id)?.effectivePurpose;return !actual||!(typeof purpose==="string"?[purpose]:purpose).includes(actual);}))return null;
 return {expiry:min(...rows.map(row=>iso(new Date(row.visibility_observed_at!.getTime()+3600000)))),reference:hashRuleValue(rows.map(row=>({id:row.channel_id,visibilityObservedAt:iso(row.visibility_observed_at!),type:row.channel_type,parentId:row.parent_id})).sort((a,b)=>a.id.localeCompare(b.id)))};
}
function retained(settings:Settings,from:string,now:string){return timestampMicros(from)>timestampMicros(retentionEnd(now,-settings.detailedRetentionDays));}
/** A base Rule may name its immutable policy definition rather than a native
 * channel/event. Such a bridge is valid only through that CURRENT definition's
 * explicitly enumerated resources; a policy UUID alone is never an event ID. */
async function policyResources(tx:Tx,s:Scope,r:OperationalSourceRequest,channels:readonly string[],events:readonly string[]=[]){
 const root=r.rootTarget??r.target;if(!z.uuid().safeParse(root.targetId).success)return null;
 const row=(await sql<{id:string;version:number;definition:unknown;content_hash:string;expires_at:Date}>`SELECT d.id,d.version,d.definition,d.content_hash,d.expires_at FROM rule_native_cohort_heads h JOIN rule_native_cohort_revisions d ON d.organization_id=h.organization_id AND d.guild_id=h.guild_id AND d.source_id=h.source_id AND d.id=h.revision_id WHERE h.organization_id=${s.organizationId}::uuid AND h.guild_id=${s.guildId} AND h.source_id=${root.targetId}::uuid AND d.enabled AND d.expires_at>${r.evaluationAsOf}::timestamptz`.execute(tx)).rows[0];
 if(!row||String(row.version)!==root.liveVersion||hashRuleValue(row.definition)!==row.content_hash)return null;
 const definition=nativeCohortDefinition.parse(row.definition);if(!("channelIds" in definition)||!channels.every(id=>definition.channelIds.includes(id)))return null;
 if(events.length&&(definition.kind!=="EVENT_RSVP_ATTENDANCE_COHORT"||!events.every(id=>definition.eventIds.includes(id))))return null;
 return {expiry:iso(row.expires_at),reference:hashRuleValue({root,definitionId:row.id,definitionHash:row.content_hash})};
}
function periodMetadata(input:z.infer<typeof period>,resolveCalendar:boolean):Pick<CohortMetadata,"windowKind"|"timeZone"|"metricWindowSeconds"|"calendarDays"|"calendarStartDate"|"calendarEndDateExclusive"|"resolvedCalendar">{
 const elapsed=timestampMicros(input.window.end)-timestampMicros(input.window.start);assert(elapsed>0n&&elapsed%1000000n===0n&&elapsed<=30n*86400n*1000000n,"CASE_METRIC_WINDOW_INVALID",400);
 if(input.windowKind==="ELAPSED")return {windowKind:"ELAPSED",timeZone:input.timeZone,metricWindowSeconds:Number(elapsed/1000000n)};
 assert(addCalendarDays(input.calendarStartDate,input.calendarDays)===input.calendarEndDateExclusive,"CASE_METRIC_CALENDAR_BOUNDARY_MISMATCH",400);
 if(resolveCalendar){assert(canonicalRuleTimestamp(dateBoundary(input.calendarStartDate,input.timeZone))===canonicalRuleTimestamp(input.window.start)&&canonicalRuleTimestamp(dateBoundary(input.calendarEndDateExclusive,input.timeZone))===canonicalRuleTimestamp(input.window.end),"CASE_METRIC_CALENDAR_BOUNDARY_MISMATCH",400);for(let n=0;n<input.calendarDays;n++)dateBoundary(addCalendarDays(input.calendarStartDate,n),input.timeZone);}
 return {windowKind:"CALENDAR_DAY",timeZone:input.timeZone,calendarDays:input.calendarDays,calendarStartDate:input.calendarStartDate,calendarEndDateExclusive:input.calendarEndDateExclusive,metricWindowSeconds:Number(elapsed/1000000n),resolvedCalendar:{start:canonicalRuleTimestamp(input.window.start),end:canonicalRuleTimestamp(input.window.end),boundaryRule:"firstValidEarlier",rulesVersion:"native-case-calendar-v1",confirmed:true}};
}
function samePeriodDefinition(a:z.infer<typeof period>,b:z.infer<typeof period>,resolveCalendar:boolean){const x=periodMetadata(a,resolveCalendar),y=periodMetadata(b,resolveCalendar);return x.windowKind===y.windowKind&&x.timeZone===y.timeZone&&(x.windowKind==="CALENDAR_DAY"?x.calendarDays===y.calendarDays:x.metricWindowSeconds===y.metricWindowSeconds);}

async function welcome(tx:Tx,s:Scope,c:Extract<Config,{kind:"WELCOME_REPLIES"}>,r:OperationalSourceRequest,settings:Settings,at:string):Promise<NativeCaseRead>{
 if(settings.startChannelId!==c.channelId)return empty("WELCOME_START_CHANNEL_BINDING_MISMATCH");
 const direct=[c.channelId,c.flowVersionId,r.contextId].includes(r.target.targetId),policy=direct?null:await policyResources(tx,s,r,[c.channelId]);
 if(!direct&&!policy)return empty("WELCOME_BASE_POLICY_CHANNEL_BINDING_UNKNOWN");
 const binding=await channelBinding(tx,s,settings,[c.channelId],r.evaluationAsOf,"ONBOARDING");if(!binding||!retained(settings,r.window.start,r.evaluationAsOf))return empty("WELCOME_PURPOSE_SCOPE_OR_RETENTION_UNAVAILABLE");
 const output:NativeCaseMetric[]=[],references:unknown[]=[binding.reference,...(policy?[policy.reference]:[])];
 if(c.flowVersionId&&settings.onboardingEnabled&&(settings.flowVersionId===c.flowVersionId||settings.hybrid.flowVersionId===c.flowVersionId)){
  const flow=(await sql<{definition:unknown;version:number}>`SELECT definition,version FROM flow_versions WHERE ${tenant(s)} AND id=${c.flowVersionId}::uuid`.execute(tx)).rows[0];
  if(flow){const definition=validateFlow(flow.definition),destinations=[...new Set(definition.nodes.flatMap(node=>node.options.flatMap(option=>option.channelId?[option.channelId]:[])))];const next=destinations.filter(id=>id!==c.channelId),allVisible=next.length?await channelBinding(tx,s,settings,next,r.evaluationAsOf):null;
   if(!next.length||allVisible){output.push(field("welcome.nextDestinationConfigured",next.length>0,"boolean",min(binding.expiry,...(allVisible?[allVisible.expiry]:[])),r.window));references.push({flowId:c.flowVersionId,version:flow.version,definitionHash:hashRuleValue(definition)});}
  }
 }
 if(c.flowVersionId===null&&settings.flowVersionId===null&&settings.hybrid.flowVersionId===null){output.push(field("welcome.nextDestinationConfigured",false,"boolean",binding.expiry,r.window));references.push({flowBinding:"EXPLICITLY_UNCONFIGURED",settingsRevision:settings.revision});}
 const health=await coverage(tx,s,r.window.start,r.window.end,r.evaluationAsOf,["members","messages"],true,true);
 if(!health.complete)return {fields:output,source:{references,replyCoverage:"UNVERIFIED"}};
 const unmarked=(await sql`SELECT 1 FROM location_post_observations WHERE ${tenant(s)} AND channel_id=${c.channelId} AND sent_at>=${r.window.start}::timestamptz AND sent_at<${r.window.end}::timestamptz AND author_kind IN ('BOT','WEBHOOK') AND (reference_contract_version IS DISTINCT FROM 'DIRECT_REPLY_V1' OR (message_type=19 AND reference_id IS NULL)) LIMIT 1`.execute(tx)).rows.length;
 if(unmarked)return {fields:output,source:{references,replyCoverage:"LEGACY_OR_MALFORMED_BOT_REFERENCE"}};
 const roots=(await sql<{message_id:string;sent_at:Date;subject_hash:string|null}>`SELECT p.message_id,p.sent_at,p.subject_hash FROM location_post_observations p WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId} AND p.channel_id=${c.channelId} AND p.message_id IN (${sql.join(c.rootMessageIds)}) AND p.author_kind='HUMAN' AND p.population_source='LOCATION_STREAM_V1' AND p.sent_at>=${r.window.start}::timestamptz AND p.sent_at<${r.window.end}::timestamptz AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=p.organization_id AND d.guild_id=p.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=p.subject_hash))`.execute(tx)).rows;
 if(roots.length!==c.rootMessageIds.length||roots.some(row=>!row.subject_hash))return {fields:output,source:{references,roots:"UNVERIFIED"}};
 const roles=[...new Set([settings.adminRoleId,...settings.managerRoleIds,...settings.helperRoleIds,...settings.staffRoleIds].filter((value):value is string=>!!value))];
 if(!roles.length)return {fields:output,source:{references,staffRoles:"MISSING"}};
 const counts=(await sql<{human_staff:string;bot:string;unknown:string;rows:string;ref_hash:string|null}>`WITH replies AS (
 SELECT p.* FROM location_post_observations p JOIN location_post_observations root ON root.organization_id=p.organization_id AND root.guild_id=p.guild_id AND root.message_id=p.reference_id AND root.channel_id=p.channel_id WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId} AND p.channel_id=${c.channelId} AND p.reference_id IN (${sql.join(c.rootMessageIds)}) AND p.sent_at>=root.sent_at AND (p.subject_hash IS NULL OR p.subject_hash<>root.subject_hash) AND p.sent_at>=${r.window.start}::timestamptz AND p.sent_at<${r.window.end}::timestamptz AND p.population_source='LOCATION_STREAM_V1' ORDER BY p.message_id LIMIT 200001
 ), classified AS (SELECT p.*,CASE WHEN p.author_kind='HUMAN' THEN (SELECT bool_or(m.roles && ${sql.val(roles)}::text[]) FROM member_identity_map i JOIN membership_episodes e ON e.organization_id=i.organization_id AND e.guild_id=i.guild_id AND e.identity_id=i.id JOIN member_observable_state m ON m.organization_id=e.organization_id AND m.guild_id=e.guild_id AND m.episode_id=e.id WHERE i.organization_id=p.organization_id AND i.guild_id=p.guild_id AND i.lookup_hash=p.subject_hash AND e.context='PRODUCTION' AND COALESCE(e.engagement_started_at,e.joined_at)<=p.sent_at AND (e.left_at IS NULL OR e.left_at>p.sent_at) AND e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND NOT e.screening_pending AND NOT e.is_guest AND m.roles_observed_at<=p.sent_at AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=i.organization_id AND d.guild_id=i.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=i.lookup_hash))) ELSE false END AS staff FROM replies p)
 SELECT count(*) FILTER(WHERE author_kind='HUMAN' AND staff)::text AS human_staff,count(*) FILTER(WHERE author_kind='BOT' AND reference_contract_version='DIRECT_REPLY_V1')::text AS bot,count(*) FILTER(WHERE author_kind='UNKNOWN' OR (author_kind='HUMAN' AND staff IS NULL) OR (author_kind IN ('BOT','WEBHOOK') AND reference_contract_version IS DISTINCT FROM 'DIRECT_REPLY_V1'))::text AS unknown,count(*)::text AS rows,md5(COALESCE(string_agg(message_id||':'||author_kind||':'||COALESCE(staff::text,'?'),',' ORDER BY message_id),'')) AS ref_hash FROM classified`.execute(tx)).rows[0]!;
 if(Number(counts.rows)>200000||Number(counts.unknown)>0)return {fields:output,source:{references,replies:"CLASSIFICATION_UNKNOWN"}};
 const expiry=min(binding.expiry,retentionEnd(r.window.start,settings.detailedRetentionDays),...(policy?[policy.expiry]:[]));
 output.push(field("welcome.humanStaffReplyCount",Number(counts.human_staff),"count",expiry,r.window),field("welcome.botReplyCount",Number(counts.bot),"count",expiry,r.window));
 return {fields:output,source:{references,roots:hashRuleValue(roots.map(row=>({id:row.message_id,sentAt:iso(row.sent_at)}))),replyDigest:counts.ref_hash,epoch:health.epoch,contract:"DIRECT_REPLY_V1",capturedAt:at}};
}

async function issue(tx:Tx,s:Scope,c:Extract<Config,{kind:"CANONICAL_ISSUE"}>,r:OperationalSourceRequest,settings:Settings,at:string):Promise<NativeCaseRead>{
 const binding=await channelBinding(tx,s,settings,[c.channelId],r.evaluationAsOf,["SUPPORT","BUG_REPORT"]);if(!binding)return empty("ISSUE_CHANNEL_NOT_PERMITTED_SUPPORT");
 if(r.target.targetId!==c.attentionKey&&r.target.targetId!==r.contextId)return empty("ISSUE_TARGET_GRAIN_MISMATCH");
 const row=(await sql<{message_id:string;channel_id:string;item_type:string;version:number;detected_at:Date;updated_at:Date|null;status:string;first_reply_seconds:number|null;sent_at:Date;author_kind:string;reply_provenance_erased:boolean}>`SELECT a.message_id,a.channel_id,a.item_type,a.version,a.detected_at,a.updated_at,a.status,p.first_reply_seconds,p.sent_at,p.author_kind,p.reply_provenance_erased FROM attention_items a JOIN location_post_observations p ON p.organization_id=a.organization_id AND p.guild_id=a.guild_id AND p.message_id=a.message_id AND p.channel_id=a.channel_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.message_id=${c.attentionKey} AND a.channel_id=${c.channelId} AND a.version=${c.attentionVersion} AND a.item_type IN ('TEXT_NEWCOMER','FORUM_SUPPORT','LFG_RESPONSE') AND p.population_source='LOCATION_STREAM_V1'`.execute(tx)).rows[0];
 if(!row||row.reply_provenance_erased||row.author_kind!=="HUMAN"||!retained(settings,iso(row.sent_at),r.evaluationAsOf)||row.sent_at>new Date(at))return empty("ISSUE_ORIGINAL_CLOCK_UNVERIFIED");
 const expiry=min(binding.expiry,retentionEnd(iso(row.sent_at),settings.detailedRetentionDays)),fields:NativeCaseMetric[]=[];
 if(r.caseId==="CASE03"&&row.first_reply_seconds===null&&["OPEN","ACKNOWLEDGED","IN_PROGRESS","SNOOZED"].includes(row.status)){
  const health=await coverage(tx,s,iso(row.sent_at),at,r.evaluationAsOf,["messages","members"],true);if(health.complete)fields.push(field("support.unansweredAgeSeconds",Number(timestampMicros(at)-timestampMicros(iso(row.sent_at)))/1000000,"seconds",expiry,r.window));
 }
 if(r.caseId==="CASE04"){
  const history=(await sql<{version:number;state:string;occurred_at:Date}>`SELECT version,state,occurred_at FROM attention_events WHERE ${tenant(s)} AND attention_key=${c.attentionKey} AND occurred_at<=${at}::timestamptz ORDER BY version LIMIT 1001`.execute(tx)).rows;
  // Versions can skip when metadata changes; every native status transition
  // is trigger-recorded. Require the origin and the latest state/version.
  if(history.length&&history.length<=1000&&history[0]!.version===0&&history[0]!.state==="OPEN"&&history.at(-1)!.state===row.status){let count=0;for(let n=1;n<history.length;n++)if(["RESOLVED","DISMISSED"].includes(history[n-1]!.state)&&history[n]!.state==="OPEN"&&history[n]!.occurred_at>=new Date(r.window.start)&&history[n]!.occurred_at<new Date(r.window.end))count++;fields.push(field("support.sameTopicReopenCount",count,"count",expiry,r.window));}
 }
 return {fields,source:{attentionKey:c.attentionKey,version:row.version,detectedAt:iso(row.detected_at),status:row.status,firstReplySeconds:row.first_reply_seconds,binding:binding.reference}};
}

interface RatioRow {numerator:string;denominator:string;rows:string;unknown:string;oldest:Date|null;last_ingest:Date|null;entity_types?:string|null;}
async function maturity(tx:Tx,s:Scope,c:Extract<Config,{kind:"MATURED_PARTICIPATION"}>,r:OperationalSourceRequest,settings:Settings,at:string):Promise<NativeCaseRead>{
 if(r.target.targetId!==s.guildId)return empty("COHORT_GUILD_BINDING_REQUIRED");
 assert([c.newSeries.current,c.establishedSeries.current].every(point=>canonicalRuleTimestamp(point.period.window.start)===canonicalRuleTimestamp(r.window.start)&&canonicalRuleTimestamp(point.period.window.end)===canonicalRuleTimestamp(r.window.end))&&canonicalRuleTimestamp(c.newSeries.prior.period.window.start)===canonicalRuleTimestamp(c.establishedSeries.prior.period.window.start)&&canonicalRuleTimestamp(c.newSeries.prior.period.window.end)===canonicalRuleTimestamp(c.establishedSeries.prior.period.window.end),"CASE_COHORT_CONTEXT_WINDOW_MISMATCH",400);
 const binding=await channelBinding(tx,s,settings,c.channelIds,r.evaluationAsOf);if(!binding)return empty("COHORT_CHANNEL_SCOPE_UNAVAILABLE");
 const fields:NativeCaseMetric[]=[],refs:unknown[]=[];
 for(const [prefix,series,cohortClass] of [["new",c.newSeries,"NEW"],["established",c.establishedSeries,"ESTABLISHED"]] as const){
  assert(samePeriodDefinition(series.current.period,series.prior.period,r.phase==="CAPTURE")&&timestampMicros(series.prior.period.window.end)<=timestampMicros(series.current.period.window.start),"CASE_COHORT_PAIR_DEFINITION_MISMATCH",400);
  for(const [suffix,point,periodRole] of [["Current",series.current,"CURRENT"],["Prior",series.prior,"PRIOR"]] as const){
   const p=point.period,metadata=periodMetadata(p,r.phase==="CAPTURE"),requiredStart=point.joinWindow.start;
   assert(timestampMicros(point.joinWindow.start)+BigInt(series.maturityOffsetSeconds)*1000000n>=timestampMicros(p.window.start)&&timestampMicros(point.joinWindow.end)+BigInt(series.maturityOffsetSeconds+series.maturityWindowSeconds)*1000000n<=timestampMicros(p.window.end),"CASE_COHORT_MATURITY_WINDOW_NOT_FULL",400);
   if(!retained(settings,requiredStart,r.evaluationAsOf)||timestampMicros(p.window.end)>timestampMicros(at))return empty("CASE_COHORT_NOT_RETAINED_OR_MATURE");
   const health=await coverage(tx,s,requiredStart,p.window.end,r.evaluationAsOf,["members",...new Set(c.signals.map(signal=>signal==="reaction.added"?"reactions":signal==="voice.duration"?"voice":signal==="scheduled_event.attended"?"scheduledEvents":"messages"))]);if(!health.complete)return empty("CASE_COHORT_COVERAGE_UNKNOWN");
   const counts=(await sql<RatioRow>`WITH cohort AS (
    SELECT DISTINCT ON(e.identity_id) e.id,e.identity_id,COALESCE(e.engagement_started_at,e.joined_at) AS started FROM membership_episodes e JOIN member_identity_map i ON i.organization_id=e.organization_id AND i.guild_id=e.guild_id AND i.id=e.identity_id
    WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.context='PRODUCTION' AND e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND NOT e.screening_pending AND NOT e.is_guest AND COALESCE(e.engagement_started_at,e.joined_at)>=${point.joinWindow.start}::timestamptz AND COALESCE(e.engagement_started_at,e.joined_at)<${point.joinWindow.end}::timestamptz
    AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=e.organization_id AND d.guild_id=e.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=i.lookup_hash))
    AND NOT EXISTS(SELECT 1 FROM membership_episodes newer WHERE newer.organization_id=e.organization_id AND newer.guild_id=e.guild_id AND newer.identity_id=e.identity_id AND newer.context='PRODUCTION' AND COALESCE(newer.engagement_started_at,newer.joined_at)>COALESCE(e.engagement_started_at,e.joined_at) AND COALESCE(newer.engagement_started_at,newer.joined_at)<${p.window.end}::timestamptz AND newer.screening_observed_at IS NOT NULL AND newer.guest_observed_at IS NOT NULL AND NOT newer.screening_pending AND NOT newer.is_guest)
    ORDER BY e.identity_id,COALESCE(e.engagement_started_at,e.joined_at) DESC,e.id LIMIT 200001
   ), observed AS (SELECT q.*,EXISTS(SELECT 1 FROM lifecycle_events l WHERE l.organization_id=${s.organizationId}::uuid AND l.guild_id=${s.guildId} AND l.episode_id=q.id AND l.context='PRODUCTION' AND l.kind IN (${sql.join(c.signals)}) AND l.data->>'channelId' IN (${sql.join(c.channelIds)}) AND l.occurred_at>=q.started+make_interval(secs=>${series.maturityOffsetSeconds}) AND l.occurred_at<q.started+make_interval(secs=>${series.maturityOffsetSeconds+series.maturityWindowSeconds}) AND l.occurred_at>=${p.window.start}::timestamptz AND l.occurred_at<${p.window.end}::timestamptz) AS participated FROM cohort q)
   SELECT count(*) FILTER(WHERE participated)::text AS numerator,count(*)::text AS denominator,count(*)::text AS rows,'0'::text AS unknown,min(started) AS oldest,max(started) AS last_ingest FROM observed`.execute(tx)).rows[0]!;
   if(Number(counts.rows)>200000)return empty("CASE_COHORT_INPUT_LIMIT");
   const definition=hashRuleValue({contract:"RETENTION.COMPARABLE_MATURITY_V1",population:"LATEST_ELIGIBLE_MEMBERSHIP_EPISODE_PER_IDENTITY",cohortClass,signals:c.signals,channels:c.channelIds,campaignClass:c.campaignClass,offset:series.maturityOffsetSeconds,maturity:series.maturityWindowSeconds,windowKind:metadata.windowKind,timeZone:metadata.timeZone,calendarDays:metadata.calendarDays??null,elapsedSeconds:metadata.windowKind==="ELAPSED"?metadata.metricWindowSeconds:null});
   fields.push({...field(`cohort.${prefix}${suffix}`,{numerator:Number(counts.numerator),denominator:Number(counts.denominator),coverage:1},"ratio",min(binding.expiry,retentionEnd(requiredStart,settings.detailedRetentionDays)),p.window),periodRole,metricId:"RETENTION.MATURED_PARTICIPATION",cohort:{cohortId:hashRuleValue({definition,joinWindow:point.joinWindow}),cohortClass,cohortDefinitionVersion:definition,campaignClass:c.campaignClass,maturityOffset:series.maturityOffsetSeconds,maturityWindowSeconds:series.maturityWindowSeconds,joinWindow:point.joinWindow,windowContractId:"RETENTION.COMPARABLE_MATURITY_V1",...metadata}});
   refs.push({definition,counts:{numerator:counts.numerator,denominator:counts.denominator},epoch:health.epoch});
  }
 }
 for(const suffix of ["current","prior"] as const)assert(timestampMicros(c.establishedSeries[suffix].joinWindow.end)<=timestampMicros(c.newSeries[suffix].joinWindow.start),"CASE_COHORT_CLASSES_OVERLAP",400);
 return {fields,source:{binding:binding.reference,refs}};
}

async function upcoming(tx:Tx,s:Scope,c:Extract<Config,{kind:"UPCOMING_EVENT"}>,r:OperationalSourceRequest,settings:Settings,at:string):Promise<NativeCaseRead>{
 if(c.eventId!==r.target.targetId)return empty("EVENT_NATIVE_TARGET_MISMATCH");
 const row=(await sql<{data:{channelId?:string;entityType?:string;status?:string;scheduledStartAt?:string|null;scheduledEndAt?:string|null;scheduledMetadataObservedAt?:string;eventScheduleContract?:string};observed_at:Date}>`SELECT data,observed_at FROM adaptive_states WHERE ${tenant(s)} AND domain='event' AND state_key=${c.eventId} AND subject_hash=''`.execute(tx)).rows[0];
 if(!row||row.data.eventScheduleContract!=="NATIVE_SCHEDULE_V1"||!row.data.scheduledMetadataObservedAt||!row.data.channelId||!["1","2"].includes(row.data.entityType??"")||!["1","2","3","4"].includes(row.data.status??"")||!row.data.scheduledStartAt||row.observed_at>new Date(r.evaluationAsOf))return empty("EVENT_SCHEDULE_METADATA_UNKNOWN");
 const policy=r.rootTarget?await policyResources(tx,s,r,[row.data.channelId],[c.eventId]):null;if(r.rootTarget&&!policy)return empty("EVENT_TARGET_BINDING_MISMATCH");
 const binding=await channelBinding(tx,s,settings,[row.data.channelId],r.evaluationAsOf);if(!binding||Date.parse(row.data.scheduledMetadataObservedAt)+48*3600000<=Date.parse(r.evaluationAsOf))return empty("EVENT_SCHEDULE_STALE_OR_SCOPE_UNAVAILABLE");
 const scheduled=row.data.status==="1"&&timestampMicros(row.data.scheduledStartAt)>timestampMicros(at),expiry=min(binding.expiry,retentionEnd(row.data.scheduledMetadataObservedAt,2),...(policy?[policy.expiry]:[]));
 return {fields:[field("event.scheduled",scheduled,"boolean",expiry,r.window)],source:{eventId:c.eventId,data:row.data,observedAt:iso(row.observed_at),binding:binding.reference,policy:policy?.reference??null}};
}

/** Attendance identity sets stay inside SQL and only aggregate components
 * leave this query. Denominators are exact RSVP-at-start for the explicitly
 * separate format contract; repeat uses prior actual attendance instead. */
async function eventRatio(tx:Tx,s:Scope,eventIds:readonly string[],channels:readonly string[],w:Window,at:string):Promise<RatioRow>{
 return (await sql<RatioRow>`WITH raw AS (SELECT data->>'eventId' AS event_id,kind,occurred_at,data FROM adaptive_facts WHERE ${tenant(s)} AND subject_hash='' AND data->>'eventId' IN (${sql.join(eventIds)}) AND kind IN ('scheduled_event.created','scheduled_event.updated','scheduled_event.deleted') AND occurred_at<=${at}::timestamptz ORDER BY id LIMIT 200001), events AS (
 SELECT event_id,min(occurred_at) FILTER(WHERE data->>'status'='2') AS started_at,min(occurred_at) FILTER(WHERE data->>'status'='3') AS ended_at,bool_or(kind='scheduled_event.created') AS created,bool_or(kind='scheduled_event.deleted' OR data->>'status'='4') AS cancelled,bool_and(COALESCE(data->>'channelId' IN (${sql.join(channels)}) AND data->>'entityType' IN ('1','2') AND data->>'status' IN ('1','2','3','4'),false)) AS supported FROM raw GROUP BY event_id
 ), valid AS (SELECT * FROM events WHERE started_at IS NOT NULL AND ended_at>=${w.start}::timestamptz AND ended_at<${w.end}::timestamptz AND created AND NOT cancelled AND supported), latest AS (
 SELECT DISTINCT ON (e.event_id,i.id) e.event_id,i.id AS identity_id,f.kind,e.started_at,e.ended_at FROM valid e JOIN adaptive_facts f ON f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.data->>'eventId'=e.event_id AND f.kind IN ('scheduled_event.subscribed','scheduled_event.unsubscribed') AND f.occurred_at<=e.started_at JOIN membership_episodes m ON m.organization_id=f.organization_id AND m.guild_id=f.guild_id AND m.id=f.episode_id JOIN member_identity_map i ON i.organization_id=m.organization_id AND i.guild_id=m.guild_id AND i.id=m.identity_id WHERE m.context='PRODUCTION' AND m.screening_observed_at IS NOT NULL AND m.guest_observed_at IS NOT NULL AND NOT m.screening_pending AND NOT m.is_guest AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=i.organization_id AND d.guild_id=i.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=i.lookup_hash)) ORDER BY e.event_id,i.id,f.occurred_at DESC,f.id DESC LIMIT 200001
 ), matched AS (SELECT r.*,EXISTS(SELECT 1 FROM adaptive_facts f JOIN membership_episodes m ON m.organization_id=f.organization_id AND m.guild_id=f.guild_id AND m.id=f.episode_id WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.kind='scheduled_event.attended' AND f.data->>'eventId'=r.event_id AND m.identity_id=r.identity_id AND m.context='PRODUCTION' AND f.occurred_at>=r.started_at AND f.occurred_at<r.ended_at) AS attended FROM latest r WHERE kind='scheduled_event.subscribed')
 SELECT count(*) FILTER(WHERE attended)::text AS numerator,count(*)::text AS denominator,((SELECT count(*) FROM raw)+(SELECT count(*) FROM latest))::text AS rows,(${eventIds.length}-(SELECT count(*) FROM valid))::text AS unknown,(SELECT min(occurred_at) FROM raw) AS oldest,(SELECT max(occurred_at) FROM raw) AS last_ingest,(SELECT string_agg(DISTINCT data->>'entityType',',' ORDER BY data->>'entityType') FROM raw) AS entity_types FROM matched`.execute(tx)).rows[0]!;
}
async function format(tx:Tx,s:Scope,c:Extract<Config,{kind:"FORMAT_COMPARISON"}>,r:OperationalSourceRequest,settings:Settings,at:string):Promise<NativeCaseRead>{
 if(!c.current.eventIds.includes(r.target.targetId))return empty("FORMAT_CURRENT_EVENT_TARGET_MISMATCH");
 const policy=r.rootTarget?await policyResources(tx,s,r,c.channelIds,[...c.current.eventIds,...c.prior.eventIds]):null;if(r.rootTarget&&!policy)return empty("FORMAT_CURRENT_EVENT_PROGRAM_BINDING_UNKNOWN");
 assert(canonicalRuleTimestamp(c.current.period.window.start)===canonicalRuleTimestamp(r.window.start)&&canonicalRuleTimestamp(c.current.period.window.end)===canonicalRuleTimestamp(r.window.end),"CASE_NATIVE_FORMAT_CONTEXT_WINDOW_MISMATCH",400);
 const binding=await channelBinding(tx,s,settings,c.channelIds,r.evaluationAsOf);if(!binding)return empty("FORMAT_CHANNEL_SCOPE_UNKNOWN");
 const compatible=samePeriodDefinition(c.current.period,c.prior.period,r.phase==="CAPTURE")&&timestampMicros(c.prior.period.window.end)<=timestampMicros(c.current.period.window.start)&&!c.current.eventIds.some(id=>c.prior.eventIds.includes(id));
 if(!compatible)return {fields:[field("format.comparableParticipationState","NOT_COMPARABLE","state",binding.expiry,r.window)],source:{binding:binding.reference,contract:c.comparisonContract,reason:"EXPLICIT_COMPARISON_DEFINITION_MISMATCH"}};
 const from=min(c.current.period.window.start,c.prior.period.window.start);if(!retained(settings,from,r.evaluationAsOf))return empty("FORMAT_WINDOW_NOT_RETAINED");
 for(const p of [c.current,c.prior])if(timestampMicros(p.period.window.end)>timestampMicros(at)||!(await coverage(tx,s,p.period.window.start,p.period.window.end,r.evaluationAsOf,["members","scheduledEvents","voice"])).complete)return empty("FORMAT_OBSERVATION_COVERAGE_UNKNOWN");
 const current=await eventRatio(tx,s,c.current.eventIds,c.channelIds,c.current.period.window,at),prior=await eventRatio(tx,s,c.prior.eventIds,c.channelIds,c.prior.period.window,at);
 if([current,prior].some(value=>Number(value.rows)>200000||Number(value.unknown)!==0||Number(value.denominator)<c.minN))return empty("FORMAT_SOURCE_OR_MINIMUM_DENOMINATOR_UNKNOWN");
 if(!["1","2"].includes(current.entity_types??"")||current.entity_types!==prior.entity_types)return {fields:[field("format.comparableParticipationState","NOT_COMPARABLE","state",binding.expiry,r.window)],source:{contract:c.comparisonContract,binding:binding.reference,reason:"NATIVE_EVENT_FORMAT_MISMATCH",currentTypes:current.entity_types??null,priorTypes:prior.entity_types??null}};
 const sourceStart=min(from,...[current.oldest,prior.oldest].filter((value):value is Date=>value!==null).map(iso));if(!(await coverage(tx,s,sourceStart,c.current.period.window.end,r.evaluationAsOf,["members","scheduledEvents","voice"])).complete)return empty("FORMAT_EARLIER_EVENT_HISTORY_COVERAGE_UNKNOWN");
 const state=BigInt(current.numerator)*BigInt(prior.denominator)<BigInt(prior.numerator)*BigInt(current.denominator)?"LOW_COMPARABLE":"STABLE_PURPOSE_ALIGNED";
 return {fields:[field("format.comparableParticipationState",state,"state",min(binding.expiry,retentionEnd(from,settings.detailedRetentionDays),...(policy?[policy.expiry]:[]),...[current.oldest,prior.oldest].filter((value):value is Date=>value!==null).map(value=>retentionEnd(iso(value),settings.detailedRetentionDays))),r.window)],source:{contract:c.comparisonContract,purpose:c.purposeClass,binding:binding.reference,policy:policy?.reference??null,current,prior}};
}

async function integration(tx:Tx,s:Scope,r:OperationalSourceRequest,settings:Settings):Promise<NativeCaseRead>{
 if(r.target.targetId!==s.guildId)return empty("INTEGRATION_GUILD_BINDING_REQUIRED");
 const row=(await sql<{gateway_state:string;last_gateway_at:Date|null;intents:Record<string,string>;last_refresh_at:Date|null;updated_at:Date}>`SELECT gateway_state,last_gateway_at,intents,last_refresh_at,updated_at FROM discord_integration_health WHERE ${tenant(s)}`.execute(tx)).rows[0];
 if(!row||row.updated_at>new Date(r.evaluationAsOf)||!row.last_gateway_at||row.last_gateway_at>new Date(r.evaluationAsOf)||row.last_gateway_at.getTime()+90000<Date.parse(r.evaluationAsOf))return empty("INTEGRATION_NATIVE_HEALTH_STALE");
 const values=Object.entries(row.intents).filter(([key])=>["members","messages","reactions","voice","scheduledEvents"].includes(key));
 if(!["CONNECTED","DISCONNECTED"].includes(row.gateway_state)||values.length!==5||values.some(([,value])=>!["AVAILABLE","UNAVAILABLE","PERMISSION_MISSING","DISABLED"].includes(value)))return empty("INTEGRATION_COMPONENT_HEALTH_UNKNOWN");
 const count=Number(row.gateway_state==="DISCONNECTED")+values.filter(([,value])=>["UNAVAILABLE","PERMISSION_MISSING"].includes(value)).length;
 return {fields:[field("activity.integrationErrorCount",count,"count",retentionEnd(iso(row.updated_at),2),r.window)],source:{contract:"CURRENT_NATIVE_INTEGRATION_COMPONENT_ERRORS_V1",gateway:row.gateway_state,intents:values,settingsRevision:settings.revision}};
}
async function posts(tx:Tx,s:Scope,c:Extract<Config,{kind:"CHANNEL_MESSAGE_COUNT"}>,r:OperationalSourceRequest,settings:Settings):Promise<NativeCaseRead>{
 if(r.target.targetId!==c.channelId)return empty("CHANNEL_TARGET_BINDING_MISMATCH");const binding=await channelBinding(tx,s,settings,[c.channelId],r.evaluationAsOf);
 if(!binding||!retained(settings,r.window.start,r.evaluationAsOf)||!(await coverage(tx,s,r.window.start,r.window.end,r.evaluationAsOf,["messages"],true)).complete)return empty("CHANNEL_POST_WINDOW_COVERAGE_UNKNOWN");
 const row=(await sql<{count:string;rows:string;unknown:string;digest:string}>`WITH bounded AS (SELECT p.message_id,p.author_kind,p.population_source,p.subject_hash FROM location_post_observations p WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId} AND p.channel_id=${c.channelId} AND p.sent_at>=${r.window.start}::timestamptz AND p.sent_at<${r.window.end}::timestamptz AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=p.organization_id AND d.guild_id=p.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=p.subject_hash)) ORDER BY p.message_id LIMIT 200001) SELECT count(*) FILTER(WHERE author_kind='HUMAN')::text AS count,count(*)::text AS rows,count(*) FILTER(WHERE author_kind='UNKNOWN' OR (author_kind='HUMAN' AND subject_hash IS NULL) OR population_source<>'LOCATION_STREAM_V1')::text AS unknown,md5(COALESCE(string_agg(message_id||':'||author_kind,',' ORDER BY message_id),'')) AS digest FROM bounded`.execute(tx)).rows[0]!;
 if(Number(row.rows)>200000||Number(row.unknown))return empty("CHANNEL_POST_POPULATION_UNKNOWN_OR_LIMIT");
 return {fields:[field("channel.messageCount",Number(row.count),"count",min(binding.expiry,retentionEnd(r.window.start,settings.detailedRetentionDays)),r.window)],source:{contract:c.population,digest:row.digest,binding:binding.reference}};
}
async function repeat(tx:Tx,s:Scope,c:Extract<Config,{kind:"EVENT_REPEAT"}>,r:OperationalSourceRequest,settings:Settings,at:string):Promise<NativeCaseRead>{
 assert(canonicalRuleTimestamp(c.current.period.window.start)===canonicalRuleTimestamp(r.window.start)&&canonicalRuleTimestamp(c.current.period.window.end)===canonicalRuleTimestamp(r.window.end),"CASE_NATIVE_REPEAT_CONTEXT_WINDOW_MISMATCH",400);
 assert(samePeriodDefinition(c.current.period,c.prior.period,r.phase==="CAPTURE")&&timestampMicros(c.prior.period.window.end)<=timestampMicros(c.current.period.window.start)&&!c.current.eventIds.some(id=>c.prior.eventIds.includes(id)),"EVENT_REPEAT_COMPARISON_DEFINITION_MISMATCH",400);
 if(!c.current.eventIds.includes(r.target.targetId)||timestampMicros(c.current.period.window.end)>timestampMicros(at))return empty("EVENT_REPEAT_TARGET_OR_MATURITY_MISMATCH");
 const from=c.prior.period.window.start,to=c.current.period.window.end,binding=await channelBinding(tx,s,settings,c.channelIds,r.evaluationAsOf);if(!binding||!retained(settings,from,r.evaluationAsOf)||!(await coverage(tx,s,from,to,r.evaluationAsOf,["members","scheduledEvents","voice"])).complete)return empty("EVENT_REPEAT_WINDOW_COVERAGE_UNKNOWN");
 // Establish that every named event has complete, retained native start/end
 // metadata. This validation is distinct from the repeat denominator.
 const a=await eventRatio(tx,s,c.current.eventIds,c.channelIds,c.current.period.window,at),b=await eventRatio(tx,s,c.prior.eventIds,c.channelIds,c.prior.period.window,at);if([a,b].some(value=>Number(value.unknown)!==0||Number(value.rows)>200000))return empty("EVENT_REPEAT_NATIVE_EVENT_UNKNOWN");
 const sourceStart=min(from,...[a.oldest,b.oldest].filter((value):value is Date=>value!==null).map(iso));if(!(await coverage(tx,s,sourceStart,to,r.evaluationAsOf,["members","scheduledEvents","voice"])).complete)return empty("EVENT_REPEAT_EARLIER_EVENT_HISTORY_COVERAGE_UNKNOWN");
 const row=(await sql<{numerator:string;denominator:string;rows:string}>`WITH attendance AS (
 SELECT i.id AS identity_id,f.data->>'eventId' AS event_id,f.occurred_at FROM adaptive_facts f JOIN membership_episodes e ON e.organization_id=f.organization_id AND e.guild_id=f.guild_id AND e.id=f.episode_id JOIN member_identity_map i ON i.organization_id=e.organization_id AND i.guild_id=e.guild_id AND i.id=e.identity_id
 WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.kind='scheduled_event.attended' AND f.data->>'eventId' IN (${sql.join([...c.prior.eventIds,...c.current.eventIds])}) AND f.occurred_at>=${from}::timestamptz AND f.occurred_at<${to}::timestamptz AND e.context='PRODUCTION' AND e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND NOT e.screening_pending AND NOT e.is_guest AND NOT EXISTS(SELECT 1 FROM deletion_requests d WHERE d.organization_id=i.organization_id AND d.guild_id=i.guild_id AND (d.lookup_hash IS NULL OR d.lookup_hash=i.lookup_hash)) ORDER BY f.id LIMIT 200001
 ), previous AS (SELECT DISTINCT identity_id FROM attendance WHERE event_id IN (${sql.join(c.prior.eventIds)}) AND occurred_at>=${c.prior.period.window.start}::timestamptz AND occurred_at<${c.prior.period.window.end}::timestamptz), current AS (SELECT DISTINCT identity_id FROM attendance WHERE event_id IN (${sql.join(c.current.eventIds)}) AND occurred_at>=${c.current.period.window.start}::timestamptz AND occurred_at<${c.current.period.window.end}::timestamptz)
 SELECT (SELECT count(*) FROM previous p JOIN current c USING(identity_id))::text AS numerator,(SELECT count(*) FROM previous)::text AS denominator,(SELECT count(*) FROM attendance)::text AS rows`.execute(tx)).rows[0]!;
 if(Number(row.rows)>200000)return empty("EVENT_REPEAT_SOURCE_LIMIT");const expiry=min(binding.expiry,retentionEnd(from,settings.detailedRetentionDays),...[a.oldest,b.oldest].filter((value):value is Date=>value!==null).map(value=>retentionEnd(iso(value),settings.detailedRetentionDays))),metadata=periodMetadata(c.current.period,r.phase==="CAPTURE"),definition=hashRuleValue({contract:c.repeatContract,channels:c.channelIds,campaign:c.campaignClass,periodKind:metadata.windowKind,timeZone:metadata.timeZone,calendarDays:metadata.calendarDays??null,elapsedSeconds:metadata.windowKind==="ELAPSED"?metadata.metricWindowSeconds:null});
 const point:NativeCaseMetric={...field("event.repeatPoint",{numerator:Number(row.numerator),denominator:Number(row.denominator),coverage:1},"ratio",expiry,c.current.period.window),periodRole:"CURRENT",metricId:"EVENT.DEDICATED_REPEAT_RATE",cohort:{cohortId:hashRuleValue({prior:c.prior,definition}),cohortClass:"EVENT",cohortDefinitionVersion:definition,campaignClass:c.campaignClass,maturityOffset:0,maturityWindowSeconds:metadata.metricWindowSeconds,joinWindow:c.prior.period.window,windowContractId:c.repeatContract,...metadata}};
 return {fields:[point,field("event.repeatSourceContract","DEDICATED_CONFIRMED","state",expiry,r.window)],source:{definition,binding:binding.reference,point:{numerator:row.numerator,denominator:row.denominator},eventSource:[a,b]}};
}
async function announcement(tx:Tx,s:Scope,c:Extract<Config,{kind:"ANNOUNCEMENT_MENTIONS"}>,r:OperationalSourceRequest,settings:Settings):Promise<NativeCaseRead>{
 const binding=await channelBinding(tx,s,settings,[c.channelId],r.evaluationAsOf,"ANNOUNCEMENT");if(!binding||!retained(settings,r.window.start,r.evaluationAsOf))return empty("ANNOUNCEMENT_SCOPE_OR_RETENTION_UNKNOWN");
 const row=(await sql<{mention_everyone:boolean|null;role_mention_count:number|null;mention_contract_version:string|null;sent_at:Date}>`SELECT mention_everyone,role_mention_count,mention_contract_version,sent_at FROM location_post_observations WHERE ${tenant(s)} AND channel_id=${c.channelId} AND message_id=${c.messageId} AND population_source='LOCATION_STREAM_V1' AND sent_at>=${r.window.start}::timestamptz AND sent_at<${r.window.end}::timestamptz`.execute(tx)).rows[0];
 if(!row||row.mention_contract_version!=="ROLE_EVERYONE_V1"||row.mention_everyone===null||row.role_mention_count===null)return empty("ANNOUNCEMENT_DISTINCT_MASS_TARGET_METADATA_UNKNOWN");
 assert(Number.isSafeInteger(row.role_mention_count)&&row.role_mention_count>=0&&row.role_mention_count<=1000,"ANNOUNCEMENT_MENTION_METADATA_INVALID",409);
 // Distinct role targets + one everyone target. This is explicitly NOT the
 // number of recipients, repeated text tokens or individual user mentions.
 return {fields:[field("announcement.mentionCount",Number(row.mention_everyone)+row.role_mention_count,"count",min(binding.expiry,retentionEnd(iso(row.sent_at),settings.detailedRetentionDays)),r.window)],source:{contract:c.countContract,messageId:c.messageId,sentAt:iso(row.sent_at),everyone:row.mention_everyone,roleTargets:row.role_mention_count,binding:binding.reference}};
}

export function createCase01To12SourcePlugin():OperationalSourcePlugin{return {
 id:"CASE_01_12_NATIVE",supportedFields:CASE_01_12_NATIVE_FIELDS,
 editorSchema:editorSchema(),
 parseConfig:value=>case01To12SourceConfig.parse(value),
 async read(tx,s,actor:Actor,r){
  const c=case01To12SourceConfig.parse(r.config);assert(kinds[r.caseId]===c.kind,"CASE_NATIVE_SOURCE_KIND_MISMATCH",400);
  assertMaintenanceAuthorization(r.proof,s,actor,new Date(r.evaluationAsOf));await operationsAccess(tx,s,actor,r.caseId==="CASE06"?"GOVERN":r.caseId==="CASE12"?"CONFIGURE":"ANALYZE");
  const settings=await new SettingsService(tx).get(s,tx);assert(settings.enabled&&settings.revision===c.settingsRevision,"CASE_NATIVE_SETTINGS_VERSION_MISMATCH",412);
  assert(timestampMicros(r.window.start)<timestampMicros(r.window.end)&&timestampMicros(r.window.end)<=timestampMicros(r.evaluationAsOf),"CASE_NATIVE_WINDOW_INVALID",400);
  return observeCaseMetrics(tx,s,r,c,async(at,fresh)=>{const sourceRequest:OperationalSourceRequest={...r,phase:fresh?"CAPTURE":"VALIDATE"};
   switch(c.kind){case "WELCOME_REPLIES":return welcome(tx,s,c,sourceRequest,settings,at);case "CANONICAL_ISSUE":return issue(tx,s,c,sourceRequest,settings,at);case "MATURED_PARTICIPATION":return maturity(tx,s,c,sourceRequest,settings,at);case "UPCOMING_EVENT":return upcoming(tx,s,c,sourceRequest,settings,at);case "FORMAT_COMPARISON":return format(tx,s,c,sourceRequest,settings,at);case "INTEGRATION_ERRORS":return integration(tx,s,sourceRequest,settings);case "CHANNEL_MESSAGE_COUNT":return posts(tx,s,c,sourceRequest,settings);case "EVENT_REPEAT":return repeat(tx,s,c,sourceRequest,settings,at);case "ANNOUNCEMENT_MENTIONS":return announcement(tx,s,c,sourceRequest,settings);}
  });
 },expire:async(tx,s,now)=>{await expireCaseMetricObservations(tx,s,now);},purge:async(tx,s)=>{await purgeCaseMetricObservations(tx,s);},purgeActor:async(tx,s)=>{await purgeCaseMetricObservations(tx,s);}
};}
