import {sql,tenant,privacyReadLock,type Database,type Tx} from '../../db/src/index';
import {assert,type Scope} from '../../shared/src/index';
import {SettingsService} from '../../settings/src/index';
import {betaAccess} from '../../security/src/hosted-beta';
import {automationTicketStates} from '../../operations/src/automation-ticket';
import {automationLock} from './quota';
import {fingerprint,type RunRecord} from './store';
import {DEFAULT_AUTOMATION_LIMITS} from './types';

export type AwaitTicketState=typeof automationTicketStates[number];
export interface AwaitRegistration {
  identity:string;ticketId:string;event:'ticketUpdated';states:AwaitTicketState[];expiresAt:Date;
}
export type AwaitResult=
  | {state:'PENDING';expiresAt:Date}
  | {state:'MATCHED';value:{state:AwaitTicketState;version:number};occurredAt:Date;allowedChannelIds:string[]}
  | {state:'TIMED_OUT'|'CANCELLED'};
interface AwaitRow {
  identity:string;revision:number;generation:number;fingerprint:string;ticket_id:string|null;
  expires_at:Date;state:'PENDING'|'MATCHED'|'TIMED_OUT'|'CANCELLED';
  matched_state:AwaitTicketState|null;matched_version:number|null;occurred_at:Date|null;
}
/** Acknowledge only in the same transaction that advances the runtime cursor.
 * Keeping the first result makes a repeated checkpoint idempotent; excluding
 * this acknowledged receipt from wakeups lets later waits sleep normally. */
export async function acknowledgeAutomationAwait(tx:Tx,s:Scope,runId:string,identity:string,now=new Date()) {
  await sql`UPDATE automation_event_waits SET consumed_at=COALESCE(consumed_at,${now}) WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity} AND state='MATCHED'`.execute(tx);
}
export interface AutomationAwaitOptions {
  /** Current real Run actor, existing ticket entitlement and channel visibility.
   * Required on registration AND every result read; no enduring stored grant. */
  authorize:(tx:Tx,s:Scope,run:RunRecord,ticketId:string)=>Promise<{allowedChannelIds:string[]}>;
  now?:()=>Date;
}
const intake=/^intake:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Durable one-shot CT05 continuation, never a new Run or a general event bus.
 * Fixed matched metadata remains readable across checkpoint crashes. Run FK and
 * lifecycle triggers inherit cancellation, erasure and seven-day retention. */
export class AutomationAwaits {
  readonly now:()=>Date;
  constructor(readonly db:Database,readonly options:AutomationAwaitOptions){
    assert(typeof options.authorize==='function','AUTOMATION_AWAIT_AUTHORIZATION_REQUIRED');
    this.now=options.now??(()=>new Date());
  }
  private async lock(tx:Tx,s:Scope,runId:string) {
    await privacyReadLock(tx,s);
    const initial=(await sql<RunRecord>`SELECT * FROM automation_runs WHERE ${tenant(s)} AND id=${runId}::uuid`.execute(tx)).rows[0];
    assert(initial,'AUTOMATION_RUN_NOT_FOUND',404);
    await betaAccess(tx,s,'work',initial.beta_generation);
    await automationLock(tx,s);
    const run=(await sql<RunRecord>`SELECT * FROM automation_runs WHERE ${tenant(s)} AND id=${runId}::uuid FOR UPDATE`.execute(tx)).rows[0];
    assert(run,'AUTOMATION_RUN_NOT_FOUND',404);
    return run;
  }
  private async row(tx:Tx,s:Scope,runId:string,identity:string) {
    return (await sql<AwaitRow>`SELECT * FROM automation_event_waits WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity} FOR UPDATE`.execute(tx)).rows[0];
  }
  private async cancel(tx:Tx,s:Scope,runId:string,identity:string,state:'TIMED_OUT'|'CANCELLED') {
    await sql`UPDATE automation_event_waits SET state=${state},ticket_id=NULL,matched_cursor=NULL,matched_state=NULL,matched_version=NULL,occurred_at=NULL WHERE ${tenant(s)} AND run_id=${runId}::uuid AND identity=${identity} AND state IN ('PENDING','MATCHED')`.execute(tx);
    return {state} as AwaitResult;
  }
  private async authorize(tx:Tx,s:Scope,run:RunRecord,ticketId:string) {
    const result=await this.options.authorize(tx,s,run,ticketId);
    assert(result&&Array.isArray(result.allowedChannelIds)&&result.allowedChannelIds.length<=1000&&result.allowedChannelIds.every(id=>/^\d{17,20}$/.test(id)),'AUTOMATION_AWAIT_AUTHORIZATION_REQUIRED');
    return result;
  }
  private async result(tx:Tx,s:Scope,run:RunRecord,row:AwaitRow):Promise<AwaitResult> {
    if(row.state==='CANCELLED'||row.state==='TIMED_OUT')return {state:row.state};
    const flow=(await sql<{state:string;generation:number;active_revision:number|null}>`SELECT state,generation,active_revision FROM automation_flows WHERE ${tenant(s)} AND id=${run.flow_id}`.execute(tx)).rows[0];
    if(run.ended_at||run.cancel_requested_at||!flow||flow.state!=='ACTIVE'||run.revision!==row.revision||!(await new SettingsService(tx).get(s)).enabled)
      return this.cancel(tx,s,run.id,row.identity,'CANCELLED');
    if(run.deadline_at<=this.now()||row.state==='PENDING'&&row.expires_at<=this.now())return this.cancel(tx,s,run.id,row.identity,'TIMED_OUT');
    assert(row.ticket_id,'AUTOMATION_AWAIT_CORRUPT');
    const authorization=await this.authorize(tx,s,run,row.ticket_id);
    if(row.state==='MATCHED'){
      assert(row.matched_state!==null&&row.matched_version!==null&&row.occurred_at,'AUTOMATION_AWAIT_CORRUPT');
      return {state:'MATCHED',value:{state:row.matched_state,version:row.matched_version},occurredAt:row.occurred_at,allowedChannelIds:[...authorization.allowedChannelIds]};
    }
    return {state:'PENDING',expiresAt:row.expires_at};
  }
  async register(s:Scope,runId:string,input:AwaitRegistration):Promise<AwaitResult> {
    assert(/^[a-f0-9]{64}$/.test(input.identity)&&intake.test(input.ticketId)&&input.event==='ticketUpdated','AUTOMATION_AWAIT_INVALID');
    assert(input.states.length>0&&input.states.length<=6&&new Set(input.states).size===input.states.length&&input.states.every(state=>automationTicketStates.includes(state)),'AUTOMATION_AWAIT_STATES_INVALID');
    assert(Number.isFinite(input.expiresAt.getTime()),'AUTOMATION_AWAIT_DEADLINE_INVALID');
    const hash=fingerprint({...input,states:[...input.states].sort()});
    return this.db.transaction().execute(async tx=>{
      const run=await this.lock(tx,s,runId),old=await this.row(tx,s,runId,input.identity);
      if(old){assert(old.fingerprint===hash,'AUTOMATION_AWAIT_INPUT_MISMATCH',409);return this.result(tx,s,run,old);}
      const now=this.now();
      assert(!run.ended_at&&!run.cancel_requested_at&&run.deadline_at>now,'AUTOMATION_STOPPED',409);
      assert(input.expiresAt>now&&input.expiresAt<=run.deadline_at&&input.expiresAt.getTime()-now.getTime()<=7*86400000,'AUTOMATION_AWAIT_DEADLINE_INVALID');
      assert((await new SettingsService(tx).get(s)).enabled,'AUTOMATION_STOPPED',409);
      const flow=(await sql<{state:string;generation:number;active_revision:number|null}>`SELECT state,generation,active_revision FROM automation_flows WHERE ${tenant(s)} AND id=${run.flow_id}`.execute(tx)).rows[0];
      assert(flow?.state==='ACTIVE','AUTOMATION_AWAIT_STALE',409);
      await this.authorize(tx,s,run,input.ticketId);
      // No row lock on attention: a source transaction can own that row while
      // waiting for the same automation fence at deferred commit.
      const ticket=(await sql<{version:number}>`SELECT a.version FROM attention_items a JOIN operations_requests r ON r.organization_id=a.organization_id AND r.guild_id=a.guild_id AND r.attention_key=a.message_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.message_id=${input.ticketId} AND a.item_type='OPERATIONS_REQUEST' AND a.message_id='intake:'||r.id::text`.execute(tx)).rows[0];
      assert(ticket&&Number.isSafeInteger(ticket.version)&&ticket.version>=0,'AUTOMATION_TICKET_NOT_AVAILABLE',404);
      const count=(await sql<{count:number}>`SELECT count(*)::integer AS count FROM automation_event_waits WHERE ${tenant(s)} AND run_id=${runId}::uuid`.execute(tx)).rows[0]!.count;
      assert(count<DEFAULT_AUTOMATION_LIMITS.maxExpandedSteps,'AUTOMATION_AWAIT_LIMIT',429);
      await sql`INSERT INTO automation_event_waits(organization_id,guild_id,run_id,identity,revision,generation,fingerprint,ticket_id,event_kind,states,after_version,registration_cursor,registered_at,expires_at) VALUES(${s.organizationId}::uuid,${s.guildId},${runId}::uuid,${input.identity},${run.revision},${flow.generation},${hash},${input.ticketId},'ticketUpdated',${input.states}::text[],${ticket.version},nextval('automation_await_event_cursor'),${now},${input.expiresAt})`.execute(tx);
      return {state:'PENDING',expiresAt:input.expiresAt};
    });
  }
  async resume(s:Scope,runId:string,identity:string):Promise<AwaitResult> {
    assert(/^[a-f0-9]{64}$/.test(identity),'AUTOMATION_AWAIT_INVALID');
    return this.db.transaction().execute(async tx=>{
      const run=await this.lock(tx,s,runId),row=await this.row(tx,s,runId,identity);
      assert(row,'AUTOMATION_AWAIT_NOT_FOUND',404);
      return this.result(tx,s,run,row);
    });
  }
  async acknowledgeInTransaction(tx:Tx,s:Scope,runId:string,identity:string,now=this.now()) {
    await acknowledgeAutomationAwait(tx,s,runId,identity,now);
  }
}
