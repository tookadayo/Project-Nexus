import {sql,json,tenant,privacyReadLock,type Database} from '../../db/src/index';
import {assert,type Scope} from '../../shared/src/index';
import {betaAccess} from '../../security/src/hosted-beta';
import {SettingsService} from '../../settings/src/index';
import {automationLock} from './quota';
import {nextScheduleOccurrences,resolveZonedDateTime} from './datetime';
import {nextElapsedOccurrences} from './elapsed-schedule';
import {checkScheduleMeaning,plannedCalendarMeaning} from './schedule-rules';
import {fingerprint} from './store';
import type {AutomationService} from './service';
import type {FlowDefinition,ZonedDateTimeSpec} from './types';

export function nextScheduleAt(definition:FlowDefinition,after:Date):Date|null {
  assert(definition.trigger.kind==='schedule','AUTOMATION_SCHEDULE_REQUIRED');
  const spec=definition.trigger.schedule;
  if(spec.kind==='once'){const at=new Date(resolveZonedDateTime(spec.at));return at>after?at:null;}
  if(spec.kind==='elapsed'){const next=nextElapsedOccurrences(spec,after,1)[0];return next?new Date(next.instant):null;}
  const next=nextScheduleOccurrences(spec,after,1)[0];return next?new Date(next.instant):null;
}
/** A delayed worker never replays the backlog. Generation and acceptance are
 * locked in the same transaction as the occurrence's unique start record. */
export class AutomationScheduler {
  constructor(readonly db:Database,readonly service:AutomationService,readonly now:()=>Date=()=>new Date(),readonly maxLatenessMs=1000) {assert(Number.isSafeInteger(maxLatenessMs)&&maxLatenessMs>=0&&maxLatenessMs<=60000,'AUTOMATION_SCHEDULER_POLICY');}
  async dispatch(s:Scope,id:string,expectedGeneration:number,expectedAt:string) {
    return this.db.transaction().execute(async tx=>{
      // Match API, deletion and external-effect fencing order: privacy, Beta,
      // then automation. Never own the host lock while waiting on a deletion.
      await privacyReadLock(tx,s);await betaAccess(tx,s,'work');await automationLock(tx,s);const now=this.now();
      const schedule=(await sql<{generation:number;revision:number;flow_id:string;rule_hash:string;enabled:boolean;next_at:Date|null;admission_after?:Date|null;planned_local:ZonedDateTimeSpec|null;planned_offset:string|null}>`SELECT * FROM automation_schedules WHERE ${tenant(s)} AND id=${id} FOR UPDATE`.execute(tx)).rows[0];
      if(!schedule?.enabled||schedule.generation!==expectedGeneration||schedule.next_at?.toISOString()!==expectedAt)return {state:'STALE'};
      // All activation/disable mutations already share automationLock. A row
      // write lock here would wait behind an unrelated in-flight effect's
      // FOR SHARE fence while holding the host admission lock.
      const flow=(await sql<{id:string;name:string;draft_revision:number;active_revision:number|null;state:'DRAFT'|'ACTIVE'|'DISABLED'|'DELETED';generation:number;activator_hash:string|null;activator_ciphertext:string|null;beta_generation:number|null;updated_at:Date}>`SELECT * FROM automation_flows WHERE ${tenant(s)} AND id=${schedule.flow_id}`.execute(tx)).rows[0];
      if(!flow||flow.state!=='ACTIVE'||flow.active_revision!==schedule.revision||flow.generation!==schedule.generation)return {state:'STALE'};
      const revision=(await sql<{revision:number;definition:FlowDefinition;semantic_hash:string;complete:boolean}>`SELECT * FROM automation_revisions WHERE ${tenant(s)} AND flow_id=${flow.id} AND revision=${schedule.revision}`.execute(tx)).rows[0]!;
      const planned=schedule.next_at!;
      const plannedMeaning={instant:planned,local:schedule.planned_local,offset:schedule.planned_offset};
      if(planned>now){const review=await checkScheduleMeaning(tx,s,flow.id,schedule.revision,revision.definition,now,this.service.options.scheduleMeaningReader,false,this.service.storage,plannedMeaning);return review.required?{state:'REVIEW_REQUIRED',reason:review.reason}:{state:'NOT_DUE'};}
      const key=fingerprint({id,generation:expectedGeneration,at:expectedAt});
      const old=(await sql<{run_id:string|null;state:string}>`SELECT run_id,state FROM automation_occurrences WHERE ${tenant(s)} AND schedule_id=${id} AND generation=${expectedGeneration} AND occurrence_key=${key}`.execute(tx)).rows[0];
      if(old)return {state:old.state,id:old.run_id};
      const next=nextScheduleAt(revision.definition,now);
      const enabled=(await new SettingsService(this.db).get(s,tx)).enabled;
      const ended=revision.definition.trigger.kind==='schedule'&&revision.definition.trigger.schedule.kind==='elapsed'&&now>=new Date(revision.definition.trigger.schedule.end);
      if(!enabled||ended||(schedule.admission_after&&planned<=schedule.admission_after)||now.getTime()-planned.getTime()>this.maxLatenessMs){
        const meaning=plannedCalendarMeaning(revision.definition,next);
        await sql`INSERT INTO automation_occurrences(organization_id,guild_id,schedule_id,generation,occurrence_key,scheduled_at,state) VALUES(${s.organizationId}::uuid,${s.guildId},${id},${expectedGeneration},${key},${planned},'SKIPPED')`.execute(tx);
        await sql`UPDATE automation_schedules SET next_at=${next},planned_local=${meaning?json(meaning.local):null},planned_offset=${meaning?.offset??null} WHERE ${tenant(s)} AND id=${id}`.execute(tx);return {state:'SKIPPED'};
      }
      const review=await checkScheduleMeaning(tx,s,flow.id,schedule.revision,revision.definition,now,this.service.options.scheduleMeaningReader,false,this.service.storage,plannedMeaning);
      if(review.required)return {state:'REVIEW_REQUIRED',reason:review.reason};
      await betaAccess(tx,s,'work',flow.beta_generation);
      const run=await this.service.acceptRun(tx,s,flow,revision,'schedule:'+key,{});
      await sql`INSERT INTO automation_occurrences(organization_id,guild_id,schedule_id,generation,occurrence_key,scheduled_at,run_id,state) VALUES(${s.organizationId}::uuid,${s.guildId},${id},${expectedGeneration},${key},${planned},${run.id}::uuid,'STARTED')`.execute(tx);
      const meaning=plannedCalendarMeaning(revision.definition,next);
      await sql`UPDATE automation_schedules SET next_at=${next},planned_local=${meaning?json(meaning.local):null},planned_offset=${meaning?.offset??null} WHERE ${tenant(s)} AND id=${id}`.execute(tx);return {state:'STARTED',id:run.id};
    });
  }
}
