import {sql,tenant,type Tx} from '../../db/src/index';
import {assert,type Scope} from '../../shared/src/index';

/** Host admission policy, separate from existing analysis/attention paid limits.
 * A production policy is supplied only after a local measurement is recorded. */
export interface AutomationAdmissionLimits {
  activeFlows: number; monthlyRuns: number; guildConcurrent: number;
  globalConcurrent: number; guildPending: number; globalPending: number;
  measurementId: string;
}
export const DISABLED_AUTOMATION_ADMISSION: Readonly<AutomationAdmissionLimits> = Object.freeze({
  activeFlows:0,monthlyRuns:0,guildConcurrent:0,globalConcurrent:0,guildPending:0,globalPending:0,measurementId:'',
});
export function validateAdmissionLimits(limits:AutomationAdmissionLimits) {
  for(const value of [limits.activeFlows,limits.monthlyRuns,limits.guildConcurrent,limits.globalConcurrent,limits.guildPending,limits.globalPending])
    assert(Number.isSafeInteger(value)&&value>=0&&value<=1000000,'AUTOMATION_POLICY_INVALID');
  assert(limits.measurementId.length<=160,'AUTOMATION_POLICY_INVALID');
  return limits;
}
export function utcUsageMonth(now:Date) { return `${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-01`; }
export async function automationLock(tx:Tx,s:Scope) {
  // One host fence makes host capacity and per-guild reservations atomic.
  await sql`SELECT pg_advisory_xact_lock(763215)`.execute(tx);
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'automation:'+s.organizationId+':'+s.guildId},0))`.execute(tx);
}
export async function reserveAutomationQuota(tx:Tx,s:Scope,limits:AutomationAdmissionLimits,now:Date) {
  validateAdmissionLimits(limits);
  assert(limits.measurementId&&limits.monthlyRuns>0,'AUTOMATION_CAPACITY_UNMEASURED',503);
  const count=(await sql<{guild:number;global:number}>`SELECT count(*) FILTER(WHERE ${tenant(s)})::integer AS guild,count(*)::integer AS global FROM automation_runs WHERE ended_at IS NULL`.execute(tx)).rows[0]!;
  assert(count.guild<limits.guildPending&&count.global<limits.globalPending,'AUTOMATION_PENDING_LIMIT',429);
  const month=utcUsageMonth(now);
  await sql`INSERT INTO automation_usage_months(organization_id,guild_id,month) VALUES(${s.organizationId}::uuid,${s.guildId},${month}::date) ON CONFLICT DO NOTHING`.execute(tx);
  const reserved=await sql`UPDATE automation_usage_months SET reserved=reserved+1 WHERE ${tenant(s)} AND month=${month}::date AND reserved+consumed<${limits.monthlyRuns} RETURNING month`.execute(tx);
  assert(reserved.rows.length,'AUTOMATION_MONTHLY_LIMIT',429);
  return month;
}
export async function consumeAutomationQuota(tx:Tx,s:Scope,runId:string,limits:AutomationAdmissionLimits,now=new Date()) {
  const current=(await sql<{status:string;usage_state:string;usage_month:Date;cancel_requested_at:Date|null;ended_at:Date|null;deadline_at:Date}>`SELECT status,usage_state,usage_month,cancel_requested_at,ended_at,deadline_at FROM automation_runs WHERE ${tenant(s)} AND id=${runId}::uuid FOR UPDATE`.execute(tx)).rows[0];
  assert(current,'AUTOMATION_RUN_NOT_FOUND',404);
  // Cancellation/expiry and admission share this row lock. A stop committed
  // before processing starts cannot turn a reservation into consumed usage.
  assert(!current.ended_at&&!current.cancel_requested_at,'AUTOMATION_STOPPED',409);
  assert(current.deadline_at>now,'AUTOMATION_DEADLINE_EXCEEDED',409);
  assert(current.usage_state!=='RELEASED','AUTOMATION_STOPPED');
  const count=(await sql<{guild:number;global:number}>`SELECT count(*) FILTER(WHERE ${tenant(s)})::integer AS guild,count(*)::integer AS global FROM automation_runs WHERE status='RUNNING' AND ended_at IS NULL AND id<>${runId}::uuid`.execute(tx)).rows[0]!;
  assert(count.guild<limits.guildConcurrent&&count.global<limits.globalConcurrent,'AUTOMATION_CONCURRENCY_LIMIT',429);
  if(current.usage_state==='RESERVED')await sql`UPDATE automation_usage_months SET reserved=reserved-1,consumed=consumed+1 WHERE ${tenant(s)} AND month=${current.usage_month}::date AND reserved>0`.execute(tx);
  await sql`UPDATE automation_runs SET usage_state='CONSUMED',status='RUNNING',updated_at=now() WHERE ${tenant(s)} AND id=${runId}::uuid`.execute(tx);
}
export async function releaseAutomationQuota(tx:Tx,s:Scope,runId:string) {
  const rows=(await sql<{usage_month:Date}>`UPDATE automation_runs SET usage_state='RELEASED' WHERE ${tenant(s)} AND id=${runId}::uuid AND usage_state='RESERVED' RETURNING usage_month`.execute(tx)).rows;
  if(rows[0])await sql`UPDATE automation_usage_months SET reserved=reserved-1 WHERE ${tenant(s)} AND month=${rows[0].usage_month}::date AND reserved>0`.execute(tx);
}
