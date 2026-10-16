import {sql,type Database} from '../../../packages/db/src/index';
import {AutomationService,type AutomationServiceOptions} from '../../../packages/automation/src/service';
import {AutomationRuntime,type AutomationRuntimeAdapter} from '../../../packages/automation/src/runtime';
import {AutomationScheduler} from '../../../packages/automation/src/scheduler';
import {sweepAutomationRetention} from '../../../packages/automation/src/retention';

/** A bounded polling pass. The app's existing worker scheduler owns cadence;
 * importing this module cannot start timers or change production data. */
export async function processAlpha15AutomationSchedules(db:Database,options:AutomationServiceOptions={},now?:Date) {
  const clock=()=>now??new Date(),service=new AutomationService(db,options),scheduler=new AutomationScheduler(db,service,clock),queriedAt=clock();
  const schedules=(await sql<{organization_id:string;guild_id:string;id:string;generation:number;next_at:Date}>`SELECT organization_id,guild_id,id,generation,next_at FROM automation_schedules WHERE enabled AND next_at IS NOT NULL AND (next_at<=${queriedAt} OR rules_checked_at IS NULL OR rules_checked_at<=${new Date(queriedAt.getTime()-60000)}) ORDER BY rules_checked_at NULLS FIRST,next_at LIMIT 20`.execute(db)).rows;
  let scheduled=0;
  for(const schedule of schedules){try{const result=await scheduler.dispatch({organizationId:schedule.organization_id,guildId:schedule.guild_id},schedule.id,schedule.generation,schedule.next_at.toISOString());if(result.state==='STARTED')scheduled++;}catch{/* Unavailable admission does not replay past occurrences on recovery. */}}
  return {scheduled,considered:schedules.length};
}
export async function processAlpha15AutomationRuns(db:Database,adapter:AutomationRuntimeAdapter,options:AutomationServiceOptions={},now?:Date) {
  // A production pass uses a fresh clock at each step. A frozen explicit Date
  // exists only for deterministic tests, never implicitly for an entire batch.
  const clock=()=>now??new Date(),service=new AutomationService(db,options),runtime=new AutomationRuntime(db,{admission:service.limits,adapter,now:clock,scratchRandomAttempts:service.scratchRandomAttempts}),queriedAt=clock();
  const runs=(await sql<{organization_id:string;guild_id:string;id:string}>`SELECT organization_id,guild_id,id FROM automation_runs WHERE ended_at IS NULL AND (status IN ('QUEUED','RUNNING') OR status IN ('WAITING','WAITING_APPROVAL') AND wake_at<=${queriedAt} OR deadline_at<=${queriedAt} OR cancel_requested_at IS NOT NULL) ORDER BY created_at LIMIT 20`.execute(db)).rows;
  for(const run of runs)await runtime.tick({organizationId:run.organization_id,guildId:run.guild_id},run.id);
  return {processed:runs.length};
}
export async function processAlpha15Automations(db:Database,adapter:AutomationRuntimeAdapter,options:AutomationServiceOptions={},now?:Date) {
  const schedules=await processAlpha15AutomationSchedules(db,options,now),runs=await processAlpha15AutomationRuns(db,adapter,options,now);
  const retention=await sweepAutomationRetention(db,now??new Date());
  return {...schedules,...runs,retention};
}
