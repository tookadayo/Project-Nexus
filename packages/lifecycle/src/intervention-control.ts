import {z} from "zod";
import {sql,tenant,type Database,type Tx} from "../../db/src/index";
import {assert,type Scope} from "../../shared/src/index";
import type {Actor} from "../../settings/src/index";
import {operationsAccess} from "../../operations/src/policy";
import {minimalOperationAudit} from "../../operations/src/alpha16-audit";
import {assertMaintenanceAuthorization,type MaintenanceAuthorizationProof} from "../../operations/src/maintenance-authorization";
import {acquireRuleScopeLocks,ruleScopeLockSet} from "../../rules/src/locks";

export const interventionCancellation=z.object({runId:z.uuid(),expectedState:z.enum(['suggested','approval','queued'])}).strict();
/** Stops one existing native run before admission. It does not recall an effect
 * or resolve UNKNOWN. The old runtime already treats suppressed as terminal. */
export async function cancelInterventionRun(db:Database,s:Scope,actor:Actor,input:unknown,
 authorization:MaintenanceAuthorizationProof|undefined,beforeWrite?:(tx:Tx)=>Promise<void>){
 const data=interventionCancellation.parse(input);
 return db.transaction().execute(async tx=>{
  await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));
  await operationsAccess(tx,s,actor,'CONFIGURE');
  const run=(await sql<{state:string;attempts:number}>`SELECT state,attempts FROM intervention_runs WHERE ${tenant(s)} AND id=${data.runId}::uuid FOR UPDATE`.execute(tx)).rows[0];
  assert(run,'INTERVENTION_RUN_NOT_FOUND',404);
  assert(run.state===data.expectedState,'RUN_STATE_CONFLICT',412);
  assert(['suggested','approval','queued'].includes(run.state)&&run.attempts===0,'INTERVENTION_ALREADY_ADMITTED',409);
  const queue=(await sql<{id:string;state:string;attempts:number;operation_phase:string|null}>`SELECT id,state,attempts,operation_phase FROM action_outbox WHERE ${tenant(s)} AND kind='INTERVENTION_DELIVER' AND payload->>'runId'=${data.runId} ORDER BY id FOR UPDATE`.execute(tx)).rows;
  assert(queue.every(row=>row.state==='PENDING'&&row.attempts===0&&row.operation_phase===null),'INTERVENTION_DELIVERY_UNRESOLVED',409);
  await operationsAccess(tx,s,actor,'CONFIGURE');assertMaintenanceAuthorization(authorization,s,actor);await beforeWrite?.(tx);
  await sql`UPDATE action_outbox SET state='FAILED',error_category='OPERATOR_CANCELLED',completed_at=COALESCE(completed_at,clock_timestamp()),lease_until=NULL,lease_token=NULL WHERE ${tenant(s)} AND kind='INTERVENTION_DELIVER' AND payload->>'runId'=${data.runId} AND state='PENDING'`.execute(tx);
  await sql`UPDATE intervention_runs SET state='suppressed',reason='OPERATOR_CANCELLED',lease_until=NULL WHERE ${tenant(s)} AND id=${data.runId}::uuid AND state=${data.expectedState}`.execute(tx);
  // A 14-day operation audit must not become another copy of a Run record.
  await minimalOperationAudit(tx,s,actor.key,'INTERVENTION_CANCELLED','lifecycle-intervention',null);
  assertMaintenanceAuthorization(authorization,s,actor);
  return {runId:data.runId,state:'suppressed',cancelled:true,externalEffect:'NONE'} as const;
 });
}
