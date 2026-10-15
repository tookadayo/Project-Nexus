import {sql,json,tenant,type Tx} from '../../db/src/index';
import type {Scope} from '../../shared/src/index';
import {assert} from '../../shared/src/index';
import {ALPHA15_AUTOMATION_STORAGE,type AutomationStoragePolicy} from './admission';
import {nextScheduleOccurrences,offsetAt,parseDateOnly,zonedDateTimeCandidates} from './datetime';
import type {FlowDefinition,ZonedDateTimeSpec} from './types';

type CalendarSpec=Exclude<Extract<FlowDefinition['trigger'],{kind:'schedule'}>['schedule'],{kind:'elapsed'}>;
export interface ScheduleMeaningReader {
  version:string;
  resolve:(spec:ZonedDateTimeSpec)=>{instant:string|null;offset:string|null};
}
export function currentScheduleMeaningReader():ScheduleMeaningReader {
  return {version:process.versions.tz??`icu:${process.versions.icu??'unavailable'}`,resolve:spec=>{
    const candidates=zonedDateTimeCandidates(spec),instant=(spec.occurrence==='later'?candidates.at(-1):candidates[0])??null;
    return {instant,offset:instant?offsetAt(instant,spec.timeZone):null};
  }};
}
export interface ScheduleMeaningSnapshot {
  formatVersion:1;timeZone:string;databaseVersion:string;
  probes:{local:ZonedDateTimeSpec;instant:string|null;offset:string|null}[];
}
export function plannedCalendarMeaning(definition:FlowDefinition,nextAt:Date|null) {
  if(!nextAt||definition.trigger.kind!=='schedule'||definition.trigger.schedule.kind==='elapsed')return null;
  const spec=definition.trigger.schedule;
  let local:ZonedDateTimeSpec;
  if(spec.kind==='once')local={...spec.at,date:parseDateOnly(spec.at.date)};
  else {
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn',{timeZone:spec.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(nextAt).map(part=>[part.type,part.value]));
    local={date:`${parts.year!.padStart(4,'0')}-${parts.month}-${parts.day}`,time:spec.time,timeZone:spec.timeZone};
  }
  const resolved=currentScheduleMeaningReader().resolve(local);
  assert(resolved.instant===nextAt.toISOString()&&resolved.offset,'TIME_ZONE_MEANING_UNAVAILABLE');
  return {local,offset:resolved.offset};
}
/** Actual local/offset/instant meaning is retained, not just an Intl version.
 * Fixed future occurrence and monthly probes detect changed meaning directly.
 * A database-version change with equal bounded probes still requires review:
 * probes cannot certify every transition in a century-long definition. */
export function snapshotScheduleMeaning(spec:CalendarSpec,checkedAt:Date,reader=currentScheduleMeaningReader()):ScheduleMeaningSnapshot {
  const probes=new Map<string,ZonedDateTimeSpec>(),add=(local:ZonedDateTimeSpec)=>probes.set(JSON.stringify(local),local);
  const timeZone=spec.kind==='once'?spec.at.timeZone:spec.timeZone;
  if(spec.kind==='once')add(spec.at);
  else {
    const start=parseDateOnly(spec.startDate),end=parseDateOnly(spec.endDate);
    for(const occurrence of nextScheduleOccurrences(spec,checkedAt,16))add({date:occurrence.localDate,time:spec.time,timeZone});
    // Include endpoints and fixed monthly probes across the finite definition.
    // This stays <= 1,220 probes under the validated 100-year limit.
    for(const date of [start,end])add({date,time:spec.time,timeZone});
    const first=Number(start.slice(0,4))*12+Number(start.slice(5,7))-1,last=Number(end.slice(0,4))*12+Number(end.slice(5,7))-1;
    for(let month=first;month<=last;month++){
      const date=`${Math.floor(month/12).toString().padStart(4,'0')}-${(month%12+1).toString().padStart(2,'0')}-15`;
      if(date>=start&&date<=end)add({date,time:spec.time,timeZone});
    }
  }
  return {formatVersion:1,timeZone,databaseVersion:reader.version,probes:[...probes.values()].map(local=>({local,...reader.resolve(local)}))};
}
export function changedScheduleMeaning(snapshot:ScheduleMeaningSnapshot,reader=currentScheduleMeaningReader()):string|null {
  if(snapshot.formatVersion!==1||!Array.isArray(snapshot.probes)||!snapshot.probes.length)return 'TIME_ZONE_REVIEW_REQUIRED';
  try{for(const probe of snapshot.probes){const current=reader.resolve(probe.local);if(current.instant!==probe.instant||current.offset!==probe.offset)return 'TIME_ZONE_MEANING_CHANGED';}}
  catch{return 'TIME_ZONE_MEANING_UNAVAILABLE';}
  return snapshot.databaseVersion===reader.version?null:'TIME_ZONE_DATABASE_CHANGED';
}
export async function checkScheduleMeaning(tx:Tx,s:Scope,flowId:string,revision:number,definition:FlowDefinition,now:Date,reader=currentScheduleMeaningReader(),create=false,storage:AutomationStoragePolicy=ALPHA15_AUTOMATION_STORAGE,planned?:{instant:Date;local:ZonedDateTimeSpec|null;offset:string|null}) {
  if(definition.trigger.kind!=='schedule')return {required:false,reason:null,checkedAt:null};
  await sql`UPDATE automation_schedules SET rules_checked_at=${now} WHERE ${tenant(s)} AND flow_id=${flowId} AND revision=${revision}`.execute(tx);
  if(definition.trigger.schedule.kind==='elapsed')return {required:false,reason:null,checkedAt:null};
  let row=(await sql<{snapshot:ScheduleMeaningSnapshot;checked_at:Date;invalidated_at:Date|null;reason:string|null}>`SELECT * FROM automation_schedule_reviews WHERE ${tenant(s)} AND flow_id=${flowId} AND revision=${revision} FOR UPDATE`.execute(tx)).rows[0];
  if(!row&&create){
    const snapshot=snapshotScheduleMeaning(definition.trigger.schedule,now,reader);
    const bytes=(await sql<{guild:number;host:number;added:number}>`SELECT (SELECT COALESCE(sum(octet_length(definition::text)),0) FROM automation_revisions WHERE ${tenant(s)})+(SELECT COALESCE(sum(octet_length(snapshot::text)),0) FROM automation_schedule_reviews WHERE ${tenant(s)}) AS guild,(SELECT COALESCE(sum(octet_length(definition::text)),0) FROM automation_revisions)+(SELECT COALESCE(sum(octet_length(snapshot::text)),0) FROM automation_schedule_reviews) AS host,octet_length(${json(snapshot)}::text) AS added`.execute(tx)).rows[0]!;
    assert(Number(bytes.guild)+bytes.added<=storage.maxGuildDefinitionBytes&&Number(bytes.host)+bytes.added<=storage.maxHostDefinitionBytes,'AUTOMATION_DEFINITION_BYTES_LIMIT',429);
    await sql`INSERT INTO automation_schedule_reviews(organization_id,guild_id,flow_id,revision,snapshot,checked_at) VALUES(${s.organizationId}::uuid,${s.guildId},${flowId},${revision},${json(snapshot)},${now})`.execute(tx);
    row={snapshot,checked_at:now,invalidated_at:null,reason:null};
  }
  let reason=row?.invalidated_at?row.reason:row?changedScheduleMeaning(row.snapshot,reader):'TIME_ZONE_REVIEW_REQUIRED';
  if(!reason&&planned){
    try{
      const actual=planned.local?reader.resolve(planned.local):null;
      if(!actual||actual.instant!==planned.instant.toISOString()||actual.offset!==planned.offset)reason='TIME_ZONE_PLANNED_INSTANT_CHANGED';
    }catch{reason='TIME_ZONE_MEANING_UNAVAILABLE';}
  }
  if(reason){
    if(!row)await sql`INSERT INTO automation_schedule_reviews(organization_id,guild_id,flow_id,revision,snapshot,checked_at,invalidated_at,reason) VALUES(${s.organizationId}::uuid,${s.guildId},${flowId},${revision},${json({formatVersion:1,timeZone:'unverified',databaseVersion:reader.version,probes:[]})},${now},${now},${reason}) ON CONFLICT DO NOTHING`.execute(tx);
    if(row)await sql`UPDATE automation_schedule_reviews SET invalidated_at=COALESCE(invalidated_at,${now}),reason=${reason} WHERE ${tenant(s)} AND flow_id=${flowId} AND revision=${revision}`.execute(tx);
    await sql`UPDATE automation_schedules SET enabled=false,next_at=NULL,review_required=true,review_reason=${reason} WHERE ${tenant(s)} AND flow_id=${flowId} AND revision=${revision}`.execute(tx);
  }
  return {required:Boolean(reason),reason,checkedAt:row?.checked_at.toISOString()??null};
}
