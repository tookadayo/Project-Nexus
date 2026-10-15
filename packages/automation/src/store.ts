import {createHash,randomUUID} from 'node:crypto';
import {sql,json,tenant,type Database,type Tx} from '../../db/src/index';
import {assert,type Scope} from '../../shared/src/index';
import type {EvaluatedValue,JsonValue} from './types';
import {automationLock,releaseAutomationQuota} from './quota';
import {boundedTerminalCheckpoint} from './iteration-results';
import {DEFAULT_AUTOMATION_LIMITS} from './types';

export const RETENTION_MILLISECONDS=7*86400000;
export type RunStatus='QUEUED'|'RUNNING'|'WAITING'|'WAITING_APPROVAL'|'COMPLETED'|'FAILED'|'CANCELLED'|'EXPIRED'|'UNKNOWN';
export type OperationOutcome={state:'SUCCEEDED';value?:EvaluatedValue}|{state:'FAILED'|'NOT_STARTED'|'UNKNOWN';code:string};
export interface RuntimeFrame {
  path:string;index:number;locals:string[];
  loop?:{nodePath:string;items:EvaluatedValue[];iteration:number;resultIds?:string[];resultIdentity?:string;outcome?:'FAILED'|'NOT_STARTED'|'UNKNOWN';skipped?:boolean;completed?:boolean};
  call?:{parentVariables:Record<string,EvaluatedValue>;parentReadonlyVariables?:string[];outputs:Record<string,string>};
  branch?:{nodePath:string};
  poll?:{nodePath:string;ticket:EvaluatedValue;maxAttempts:number;intervalSeconds:number;deadline:string;attempts:number};
  await?:{identity:string;ticket:EvaluatedValue;deadline:string};
  approvalWait?:{identity:string;actionId:string};
  terminalAfter?:{status:'FAILED'|'EXPIRED';reason:string};
  uncertaintyBoundary?:boolean;
}
export interface IterationCheckpoint {blockId:string;identity:string;states:import('./iteration-results').IterationState[];}
export interface RuntimeContext {
  frames:RuntimeFrame[];variables:Record<string,EvaluatedValue>;
  /** An inherited snapshot is readable inside a branch, never mutable. */
  readonlyVariables?:string[];
  /** Includes enclosing parallel/loop identity; never depends on polling order. */
  identity?:string;
  waitUntil?:string;
  approvalIdentity?:string;
  approvalDeadline?:string;
  awaitIdentity?:string;
  awaitDeadline?:string;
  /** A dispatch checkpoint already charged this statement before a restart. */
  chargedStepIdentity?:string;
  /** Explicit named results only; other completed branch locals are erased. */
  outputs?:Record<string,EvaluatedValue>;
  parallel?:RuntimeParallelGroup;
}
export interface RuntimeParallelGroup {
  identity:string;nodePath:string;cursor:number;
  branches:{id:string;context:RuntimeContext}[];
}
export interface ResumeState extends RuntimeContext {formatVersion?:2;startedAt:string;steps:number;evaluations:number;externalActions:number;pendingAwaitAcknowledgements?:string[];iterations?:IterationCheckpoint[];uncertainty?:{operationIdentity:string;contextIdentity?:string;handlerPath:string;reason:string;phase:'CAPTURED'|'HANDLING'};}
export interface RunRecord {
  organization_id:string;guild_id:string;id:string;flow_id:string;revision:number;semantic_hash:string;
  actor_hash:string;actor_ciphertext:string;beta_generation:number|null;status:RunStatus;
  usage_state:'RESERVED'|'CONSUMED'|'RELEASED';usage_month:Date;started_at:Date;deadline_at:Date;
  wake_at:Date|null;resume:ResumeState;cancel_requested_at:Date|null;ended_at:Date|null;reason:string|null;
}
export interface RandomCommit {fingerprint:string;input:JsonValue;result:EvaluatedValue;}
export interface AutomationApproval {
 id:string;run_id:string;revision:number;identity:string;operation:string;fingerprint:string;
 inputs:Record<string,EvaluatedValue>;state:'PENDING'|'APPROVED'|'REJECTED'|'EXPIRED';expires_at:Date;
 approver_hash:string|null;approver_ciphertext:string|null;
 policy_fingerprint?:string|null;
}
function stableJson(value:unknown):unknown {
  if(value instanceof Date)return value.toISOString();
  if(Array.isArray(value))return value.map(stableJson);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(key=>(value as Record<string,unknown>)[key]!==undefined).map(key=>[key,stableJson((value as Record<string,unknown>)[key])]));
  return value;
}
export const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(stableJson(value))).digest('hex');
const terminal=(status:RunStatus)=>['COMPLETED','FAILED','CANCELLED','EXPIRED','UNKNOWN'].includes(status);

/** Stores only resumable execution state; diagnostic events never contain values. */
export class AutomationStore {
  constructor(readonly db:Database) {}
  async run(s:Scope,id:string,tx:Tx=this.db) {
    return (await sql<RunRecord>`SELECT * FROM automation_runs WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx)).rows[0]??null;
  }
  async withRunLock<T>(s:Scope,id:string,work:(connection:Database)=>Promise<T>):Promise<T|null> {
    return this.db.connection().execute(async connection=>{
      const key='automation-run:'+s.organizationId+':'+s.guildId+':'+id;
      const locked=(await sql<{locked:boolean}>`SELECT pg_try_advisory_lock(hashtextextended(${key},0)) AS locked`.execute(connection)).rows[0]!.locked;
      if(!locked)return null;
      try{return await work(connection);}
      finally{await sql`SELECT pg_advisory_unlock(hashtextextended(${key},0))`.execute(connection);}
    });
  }
  async save(s:Scope,id:string,state:ResumeState,status:RunStatus,wakeAt:Date|null=null,reason:string|null=null,now=new Date()) {
    let checkpoint={...state};delete checkpoint.pendingAwaitAcknowledgements;
    await this.db.transaction().execute(async tx=>{
      await automationLock(tx,s);
      const row=(await sql<RunRecord>`SELECT * FROM automation_runs WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(row,'AUTOMATION_RUN_NOT_FOUND',404);
      if(row.ended_at)return;
      assert(!wakeAt||wakeAt<=row.deadline_at,'AUTOMATION_DEADLINE_EXCEEDED');
      // A concurrent cancellation cannot be overwritten by a normal checkpoint.
      const result=state.uncertainty&&(row.cancel_requested_at||['COMPLETED','FAILED','CANCELLED','EXPIRED'].includes(status))?'UNKNOWN':row.cancel_requested_at&&status!=='UNKNOWN'?'CANCELLED':status;
      if(terminal(result))checkpoint=boundedTerminalCheckpoint(checkpoint,result);
      assert(Buffer.byteLength(JSON.stringify(checkpoint))<=DEFAULT_AUTOMATION_LIMITS.maxValueBytes,'AUTOMATION_STATE_LIMIT');
      if(terminal(result))await releaseAutomationQuota(tx,s,id);
      for(const identity of state.pendingAwaitAcknowledgements??[]){
        assert(/^[a-f0-9]{64}$/.test(identity),'AUTOMATION_AWAIT_INVALID');
        await sql`UPDATE automation_event_waits SET consumed_at=COALESCE(consumed_at,${now}) WHERE ${tenant(s)} AND run_id=${id}::uuid AND identity=${identity} AND state='MATCHED'`.execute(tx);
      }
      await sql`UPDATE automation_runs SET resume=${json(checkpoint)},status=${result},wake_at=${terminal(result)?null:wakeAt},steps=${state.steps},evaluations=${state.evaluations},external_actions=${state.externalActions},reason=${reason},ended_at=${terminal(result)?now:null},updated_at=${now} WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx);
    });
    delete state.pendingAwaitAcknowledgements;
  }
  async cancel(s:Scope,id:string,now=new Date()) {
    return this.db.transaction().execute(tx=>this.cancelInTransaction(tx,s,id,now));
  }
  async cancelInTransaction(tx:Tx,s:Scope,id:string,now=new Date()) {
      await automationLock(tx,s);
      const row=(await sql<RunRecord>`SELECT * FROM automation_runs WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(row,'AUTOMATION_RUN_NOT_FOUND',404);
      if(row.ended_at)return row;
      await sql`UPDATE automation_runs SET cancel_requested_at=${now},updated_at=${now} WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx);
      // An in-flight or already ambiguous operation may have reached Discord.
      // Keep the run unresolved until the runtime preserves that outcome; a
      // cancellation cannot turn an UNKNOWN write into a terminal cancellation.
      const inFlight=(await sql`SELECT identity FROM automation_operations WHERE ${tenant(s)} AND run_id=${id}::uuid AND state IN ('STARTED','UNKNOWN')`.execute(tx)).rows.length;
      if(!inFlight){
        row.resume=boundedTerminalCheckpoint(row.resume,'CANCELLED');
        await releaseAutomationQuota(tx,s,id);
        await sql`UPDATE automation_runs SET resume=${json(row.resume)},status='CANCELLED',ended_at=${now},wake_at=NULL,reason='CANCEL_REQUESTED' WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx);
      }
      return this.run(s,id,tx);
  }
  async event(s:Scope,runId:string,blockId:string|null,state:string,code:string|null=null) {
    assert(/^[A-Z_]{1,60}$/.test(state)&&(!code||/^[A-Z0-9_]{1,100}$/.test(code)),'AUTOMATION_EVENT_INVALID');
    await sql`INSERT INTO automation_run_events(organization_id,guild_id,run_id,sequence,block_id,state,code) SELECT ${s.organizationId}::uuid,${s.guildId},${runId}::uuid,COALESCE(max(sequence),0)+1,${blockId},${state},${code} FROM automation_run_events WHERE ${tenant(s)} AND run_id=${runId}::uuid`.execute(this.db);
  }
  async randomResult(s:Scope,runId:string,identity:string):Promise<RandomCommit|null> {
    return (await sql<RandomCommit>`SELECT fingerprint,input,result FROM automation_random_results WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity}`.execute(this.db)).rows[0]??null;
  }
  async randomOnce(s:Scope,runId:string,identity:string,make:()=>RandomCommit) {
    return this.db.transaction().execute(async tx=>{
      await sql`SELECT id FROM automation_runs WHERE ${tenant(s)} AND id=${runId}::uuid FOR UPDATE`.execute(tx);
      const old=(await sql<RandomCommit>`SELECT fingerprint,input,result FROM automation_random_results WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity}`.execute(tx)).rows[0];
      if(old)return old;
      const committed=make();
      assert(fingerprint(committed.input)===committed.fingerprint,'AUTOMATION_RANDOM_INPUT_MISMATCH');
      await sql`INSERT INTO automation_random_results(organization_id,guild_id,run_id,identity,fingerprint,input,result) VALUES(${s.organizationId}::uuid,${s.guildId},${runId}::uuid,${identity},${committed.fingerprint},${json(committed.input)},${json(committed.result)})`.execute(tx);
      return committed;
    });
  }
  async verifyRandomInput(s:Scope,runId:string,identity:string,input:JsonValue) {
    const old=await this.randomResult(s,runId,identity);
    assert(old&&old.fingerprint===fingerprint(input),'AUTOMATION_RANDOM_INPUT_MISMATCH',409);
    return old;
  }
  async operation(s:Scope,runId:string,identity:string) {
    return (await sql<{state:'STARTED'|'SUCCEEDED'|'FAILED'|'NOT_STARTED'|'UNKNOWN';fingerprint:string;result:EvaluatedValue|null;reason:string|null}>`SELECT state,fingerprint,result,reason FROM automation_operations WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity}`.execute(this.db)).rows[0]??null;
  }
  async approval(s:Scope,runId:string,identity:string) {
    return (await sql<AutomationApproval>`SELECT * FROM automation_approvals WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity}`.execute(this.db)).rows[0]??null;
  }
  async requireApproval(s:Scope,run:RunRecord,identity:string,operation:string,inputs:Record<string,EvaluatedValue>,expiresAt=run.deadline_at) {
    assert(operation==='discord.addRole'||operation==='discord.removeRole','AUTOMATION_APPROVAL_OPERATION_INVALID');
    assert(Number.isFinite(expiresAt.getTime())&&expiresAt<=run.deadline_at,'AUTOMATION_APPROVAL_DEADLINE_INVALID');
    const id=randomUUID(),hash=fingerprint(inputs);
    return this.db.transaction().execute(async tx=>{
      await automationLock(tx,s);
      const current=(await sql<RunRecord>`SELECT * FROM automation_runs WHERE ${tenant(s)} AND id=${run.id}::uuid FOR UPDATE`.execute(tx)).rows[0];
      const flow=(await sql<{state:string}>`SELECT state FROM automation_flows WHERE ${tenant(s)} AND id=${run.flow_id}`.execute(tx)).rows[0];
      assert(current&&!current.ended_at&&!current.cancel_requested_at&&current.revision===run.revision&&current.semantic_hash===run.semantic_hash&&flow?.state==='ACTIVE','AUTOMATION_STOPPED');
      await sql`INSERT INTO automation_approvals(organization_id,guild_id,id,run_id,revision,identity,operation,fingerprint,inputs,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${run.id}::uuid,${run.revision},${identity},${operation},${hash},${json(inputs)},${expiresAt}) ON CONFLICT(organization_id,guild_id,run_id,identity) DO NOTHING`.execute(tx);
      return (await sql<AutomationApproval>`SELECT * FROM automation_approvals WHERE ${tenant(s)} AND run_id=${run.id}::uuid AND identity=${identity}`.execute(tx)).rows[0]!;
    });
  }
  async beginOperation(s:Scope,runId:string,identity:string,operation:string,inputHash:string) {
    return this.db.transaction().execute(async tx=>{
      const row=(await sql<RunRecord>`SELECT * FROM automation_runs WHERE ${tenant(s)} AND id=${runId}::uuid FOR UPDATE`.execute(tx)).rows[0];
      assert(row&&!row.ended_at&&!row.cancel_requested_at&&row.deadline_at>new Date(),'AUTOMATION_STOPPED');
      const unknown=(await sql`SELECT identity FROM automation_operations WHERE ${tenant(s)} AND run_id=${runId}::uuid AND state IN ('UNKNOWN','STARTED')`.execute(tx)).rows;
      assert(!unknown.length,'AUTOMATION_RESULT_UNKNOWN',409);
      const inserted=await sql`INSERT INTO automation_operations(organization_id,guild_id,run_id,identity,operation,fingerprint,state) VALUES(${s.organizationId}::uuid,${s.guildId},${runId}::uuid,${identity},${operation},${inputHash},'STARTED') ON CONFLICT DO NOTHING RETURNING identity`.execute(tx);
      assert(inserted.rows.length,'AUTOMATION_OPERATION_EXISTS',409);
    });
  }
  async finishOperation(s:Scope,runId:string,identity:string,outcome:OperationOutcome) {
    const value=outcome.state==='SUCCEEDED'?outcome.value??null:null;
    if(value)assert(!value.provenance.some(p=>p.sensitive||p.resumable===false),'AUTOMATION_RESULT_NOT_RESUMABLE');
    await sql`UPDATE automation_operations SET state=${outcome.state},result=${value?json(value):null},reason=${outcome.state==='SUCCEEDED'?null:outcome.code},finished_at=now() WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity} AND state='STARTED'`.execute(this.db);
  }
}
/** The connector independently verifies this DB-issued, immutable receipt and
 * rechecks the approver's current eligibility before changing a role. */
export async function verifyAutomationApproval(db:Tx,s:Scope,runId:string,identity:string,inputHash:string,now=new Date()) {
  const row=(await sql<AutomationApproval>`SELECT a.* FROM automation_approvals a JOIN automation_runs r ON r.organization_id=a.organization_id AND r.guild_id=a.guild_id AND r.id=a.run_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.run_id=${runId}::uuid AND a.identity=${identity} AND a.fingerprint=${inputHash} AND a.state='APPROVED' AND a.expires_at>${now} AND r.deadline_at>${now} AND r.cancel_requested_at IS NULL AND r.ended_at IS NULL AND a.revision=r.revision`.execute(db)).rows[0];
  assert(row?.approver_hash&&row.approver_ciphertext,'AUTOMATION_APPROVAL_REQUIRED',403);return row;
}
