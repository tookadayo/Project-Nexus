import {sql,tenant,type Tx,type Database} from '../../db/src/index';
import {assert,type Scope} from '../../shared/src/index';
import {automationLock} from './quota';
import {releaseAutomationQuota} from './quota';
import type {FlowDefinition} from './types';
import {purgeAutomationEventActor} from './events';
import {dynamicExecutionIdentity} from './runtime';
import {fingerprint,type ResumeState,type RunRecord} from './store';
import {runtimeContexts} from './parallel';
import {noteIterationOperation,boundedTerminalCheckpoint} from './iteration-results';
import {acquireRuleScopeLocks,ruleScopeLockSet} from '../../rules/src/locks';
import {purgeRuleRuntimeRuns} from '../../rules/src/runtime-store';

type MaintenanceRun=Pick<RunRecord,'id'|'revision'|'semantic_hash'|'resume'>;
/** Maintenance has no continuation authority. Match durable dispatch identities
 * before labelling an item uncertain; unrelated branches are only cancelled. */
export function fenceIterationResults(run:MaintenanceRun,definition:FlowDefinition|null,interruptedIdentities:readonly string[],status:string):ResumeState {
  const state=run.resume,identities=new Set(interruptedIdentities);
  if(identities.size){
    const valueAt=(path:string):unknown=>path.split('/').reduce<unknown>((value,key)=>value&&typeof value==='object'&&key!=='__proto__'&&Object.hasOwn(value,key)?(value as Record<string,unknown>)[key]:undefined,definition);
    for(const context of runtimeContexts(state)){
      if(state.uncertainty&&identities.has(state.uncertainty.operationIdentity)&&context.identity===state.uncertainty.contextIdentity){noteIterationOperation(context,'UNKNOWN',state);continue;}
      const frame=context.frames.at(-1);if(!frame||!Number.isSafeInteger(frame.index)||frame.index<0)continue;
      const body=valueAt(frame.path),statement=Array.isArray(body)?body[frame.index] as FlowDefinition['body'][number]|undefined:undefined;
      if(statement?.kind!=='action'&&statement?.kind!=='poll')continue;
      const base=dynamicExecutionIdentity(run,context.frames,statement.id,context.identity);
      const identity=statement.kind==='poll'?fingerprint({poll:base,attempt:frame.poll?.attempts??0}):base;
      if(identities.has(identity))noteIterationOperation(context,'UNKNOWN',state);
    }
  }
  const strict=state.semanticProfile==='scratch.v1'||definition?.semanticProfile==='scratch.v1',version=state.checkpointVersion??0;
  if(strict)assert(Number.isSafeInteger(version)&&version>=0&&version<Number.MAX_SAFE_INTEGER,'AUTOMATION_CHECKPOINT_CONFLICT',409);
  if(strict){state.semanticProfile='scratch.v1';state.checkpointVersion=version+1;}
  return boundedTerminalCheckpoint(state,status);
}

function mentionsDeletedMember(value:unknown,guildId:string,userId:string):boolean {
  if(typeof value==='string')return value===userId||value.includes('<@'+userId+'>')||value.includes('<@!'+userId+'>');
  if(Array.isArray(value))return value.some(item=>mentionsDeletedMember(item,guildId,userId));
  if(!value||typeof value!=='object')return false;
  const object=value as Record<string,unknown>;
  if(object.id===userId&&object.guildId===guildId)return true;
  return Object.values(object).some(item=>mentionsDeletedMember(item,guildId,userId));
}

/** Called inside the existing member erasure transaction. Definitions that
 * explicitly name the deleted member cannot be revived by a retained revision. */
export async function purgeAutomationActor(tx:Tx,s:Scope,actorHash:string,userId?:string) {
  await automationLock(tx,s);
  await purgeAutomationEventActor(tx,s,actorHash);
  const definitions=(await sql<{flow_id:string;definition:FlowDefinition}>`SELECT flow_id,definition FROM automation_revisions WHERE ${tenant(s)}`.execute(tx)).rows;
  const flows=new Set(definitions.filter(row=>userId&&mentionsDeletedMember(row.definition,s.guildId,userId)).map(row=>row.flow_id));
  for(const row of (await sql<{id:string}>`SELECT id FROM automation_flows WHERE ${tenant(s)} AND activator_hash=${actorHash}`.execute(tx)).rows)flows.add(row.id);
  const runs=(await sql<{id:string;actor_hash:string;flow_id:string;resume:unknown}>`SELECT id,actor_hash,flow_id,resume FROM automation_runs WHERE ${tenant(s)}`.execute(tx)).rows;
  const affected=new Set(runs.filter(run=>flows.has(run.flow_id)||run.actor_hash===actorHash||userId&&mentionsDeletedMember(run.resume,s.guildId,userId)).map(run=>run.id));
  const approvals=(await sql<{run_id:string;inputs:unknown;approver_hash:string|null}>`SELECT run_id,inputs,approver_hash FROM automation_approvals WHERE ${tenant(s)}`.execute(tx)).rows;
  for(const approval of approvals)if(approval.approver_hash===actorHash||userId&&mentionsDeletedMember(approval.inputs,s.guildId,userId))affected.add(approval.run_id);
  const draws=(await sql<{run_id:string;input:unknown;result:unknown}>`SELECT run_id,input,result FROM automation_random_results WHERE ${tenant(s)}`.execute(tx)).rows;
  for(const draw of draws)if(userId&&(mentionsDeletedMember(draw.input,s.guildId,userId)||mentionsDeletedMember(draw.result,s.guildId,userId)))affected.add(draw.run_id);
  for(const id of affected){await releaseAutomationQuota(tx,s,id);await sql`DELETE FROM automation_occurrences WHERE ${tenant(s)} AND run_id=${id}::uuid`.execute(tx);await sql`DELETE FROM automation_runs WHERE ${tenant(s)} AND id=${id}::uuid`.execute(tx);}
  for(const id of flows){await sql`DELETE FROM automation_rollbacks WHERE ${tenant(s)} AND flow_id=${id}`.execute(tx);await sql`DELETE FROM automation_schedules WHERE ${tenant(s)} AND flow_id=${id}`.execute(tx);await sql`DELETE FROM automation_flows WHERE ${tenant(s)} AND id=${id}`.execute(tx);}
  // Request IDs are metadata, but the deleted actor's digest is still erased.
  await sql`DELETE FROM automation_requests WHERE ${tenant(s)} AND actor_hash=${actorHash}`.execute(tx);
  return {deletedFlows:flows.size,deletedRuns:affected.size};
}

/** Restore is an uncertainty boundary, not a continuation authorization. Run
 * this before public/worker admission after restoring any backup. */
export async function fenceRestoredAutomations(tx:Tx,now=new Date()) {
  await sql`SELECT pg_advisory_xact_lock(763215)`.execute(tx);
  // A restored admission receipt cannot authorize a new run. Keep only its
  // terminal status and deletion linkage, never the old pending input state.
  await sql`UPDATE automation_event_inbox SET state='SKIPPED',reason='RESTORE_REVIEW_REQUIRED',finished_at=${now},ticket_id=NULL,ticket_state=NULL,ticket_version=NULL,channel_id=NULL,actor_ciphertext=NULL WHERE state='PENDING'`.execute(tx);
  // Native instances and their signed tokens belong to the pre-restore state.
  // Removing both prevents a still-unexpired Discord button from reclaiming it.
  await sql`DELETE FROM component_tokens WHERE intent->>'action'='automationTrigger'`.execute(tx);
  await sql`DELETE FROM automation_interaction_instances`.execute(tx);
  // Restored review receipts are historical evidence, not a fresh activation
  // check. The immutable revision must pass all three checks again offline.
  await sql`DELETE FROM automation_checks`.execute(tx);
  await sql`UPDATE automation_flows SET state='DISABLED',generation=generation+1,updated_at=${now} WHERE state='ACTIVE'`.execute(tx);
  await sql`UPDATE automation_schedules SET enabled=false,generation=generation+1,next_at=NULL WHERE enabled`.execute(tx);
  const runs=(await sql<MaintenanceRun&{organization_id:string;guild_id:string;definition:FlowDefinition|null}>`SELECT r.organization_id,r.guild_id,r.id,r.revision,r.semantic_hash,r.resume,(SELECT definition FROM automation_revisions v WHERE v.organization_id=r.organization_id AND v.guild_id=r.guild_id AND v.flow_id=r.flow_id AND v.revision=r.revision) AS definition FROM automation_runs r WHERE r.ended_at IS NULL FOR UPDATE OF r`.execute(tx)).rows;
  for(const run of runs){
    const s={organizationId:run.organization_id,guildId:run.guild_id};
    const interrupted=(await sql<{identity:string}>`SELECT identity FROM automation_operations WHERE ${tenant(s)} AND run_id=${run.id}::uuid AND state IN ('STARTED','UNKNOWN') FOR UPDATE`.execute(tx)).rows,unknown=interrupted.length>0;
    const resume=fenceIterationResults(run,run.definition,interrupted.map(operation=>operation.identity),unknown?'UNKNOWN':'CANCELLED');
    await releaseAutomationQuota(tx,s,run.id);
    await sql`UPDATE automation_operations SET state='UNKNOWN',reason='RESTORE_REVIEW_REQUIRED',finished_at=${now} WHERE ${tenant(s)} AND run_id=${run.id}::uuid AND state='STARTED'`.execute(tx);
    await sql`UPDATE automation_runs SET resume=${JSON.stringify(resume)}::jsonb,status=${unknown?'UNKNOWN':'CANCELLED'},cancel_requested_at=COALESCE(cancel_requested_at,${now}),ended_at=${now},wake_at=NULL,reason='RESTORE_REVIEW_REQUIRED',updated_at=${now} WHERE ${tenant(s)} AND id=${run.id}::uuid`.execute(tx);
    await sql`UPDATE automation_approvals SET state='EXPIRED' WHERE ${tenant(s)} AND run_id=${run.id}::uuid AND state IN ('PENDING','APPROVED')`.execute(tx);
  }
  return {stoppedRuns:runs.length};
}

/** Called by guild erasure and restore tombstone application under the existing
 * exclusive privacy fence. No administrative audit table is modified here. */
export async function purgeAutomationGuild(tx:Tx,s:Scope) {
  await automationLock(tx,s);
  await sql`DELETE FROM automation_schedules WHERE ${tenant(s)}`.execute(tx);
  await sql`DELETE FROM automation_runs WHERE ${tenant(s)}`.execute(tx);
  await sql`DELETE FROM automation_flows WHERE ${tenant(s)}`.execute(tx);
  await sql`DELETE FROM automation_usage_months WHERE ${tenant(s)}`.execute(tx);
}
/** Bounded maintenance, using DB time supplied explicitly for deterministic
 * tests. Execution state, draws, action evidence, and diagnostic events are
 * physically deleted no later than seven days after the run ends. */
export async function sweepAutomationRetention(db:Database,now=new Date()) {
  assert(Number.isFinite(now.getTime()),'AUTOMATION_RETENTION_TIME_INVALID');
  const cutoff=new Date(now.getTime()-7*86400000);
  // Scope discovery has no locks or payload reads. Each bounded scope then
  // gets its COMPLETE canonical set in one transaction, before the legacy
  // global fence. Never take GLOBAL alone then append hashed guild locks.
  const scopes=(await sql<{organization_id:string;guild_id:string}>`SELECT organization_id,guild_id FROM (
    SELECT organization_id,guild_id,deadline_at AS due FROM automation_runs WHERE ended_at IS NULL AND deadline_at<=${now}
    UNION ALL SELECT organization_id,guild_id,ended_at+interval '7 days' FROM automation_runs WHERE ended_at<=${cutoff}
    UNION ALL SELECT organization_id,guild_id,deleted_at+interval '7 days' FROM automation_flows WHERE state='DELETED' AND deleted_at<=${cutoff}
    UNION ALL SELECT organization_id,guild_id,retention_expires_at FROM automation_execution_observations WHERE retention_expires_at<=${now}
    UNION ALL SELECT organization_id,guild_id,created_at+interval '7 days' FROM automation_requests WHERE created_at<=${cutoff}
    UNION ALL SELECT organization_id,guild_id,created_at+interval '7 days' FROM automation_occurrences WHERE created_at<=${cutoff}
    UNION ALL SELECT organization_id,guild_id,month+interval '1 month'+interval '7 days' FROM automation_usage_months WHERE month+interval '1 month'+interval '7 days'<=${now} AND reserved=0
   ) candidates GROUP BY organization_id,guild_id ORDER BY min(due),organization_id,guild_id LIMIT 100`.execute(db)).rows;
  let expiredCount=0,deletedRuns=0,deletedFlows=0,deletedObservations=0;
  for(const candidate of scopes){
   const s={organizationId:candidate.organization_id,guildId:candidate.guild_id};
   const counts=await db.transaction().execute(async tx=>{
    await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));
    await automationLock(tx,s);
    const flows=deletedFlows<100?(await sql<{id:string}>`SELECT id FROM automation_flows WHERE ${tenant(s)} AND state='DELETED' AND deleted_at<=${cutoff} ORDER BY id LIMIT ${100-deletedFlows}`.execute(tx)).rows:[];
    const oldRuns=deletedRuns<200?(await sql<{id:string}>`SELECT id FROM automation_runs WHERE ${tenant(s)} AND ended_at<=${cutoff} ORDER BY ended_at,id LIMIT ${200-deletedRuns}`.execute(tx)).rows:[];
    const flowRuns=flows.length?(await sql<{id:string}>`SELECT id FROM automation_runs WHERE ${tenant(s)} AND flow_id=ANY(${flows.map(flow=>flow.id)}::text[]) ORDER BY id`.execute(tx)).rows:[];
    const purgeIds=[...new Set([...oldRuns,...flowRuns].map(run=>run.id))].sort();
    const expiring=expiredCount<100?(await sql<{id:string}>`SELECT id FROM automation_runs WHERE ${tenant(s)} AND ended_at IS NULL AND deadline_at<=${now} AND NOT(id=ANY(${purgeIds}::uuid[])) ORDER BY deadline_at,id LIMIT ${100-expiredCount}`.execute(tx)).rows:[];
    const observationIds=deletedObservations<200?(await sql<{run_id:string}>`SELECT run_id FROM automation_execution_observations WHERE ${tenant(s)} AND retention_expires_at<=${now} ORDER BY retention_expires_at,run_id LIMIT ${200-deletedObservations}`.execute(tx)).rows:[];
    const lockRunIds=[...new Set([...purgeIds,...expiring.map(run=>run.id),...observationIds.map(row=>row.run_id)])].sort();
    const observationPurgeRunIds=[...new Set([...observationIds.map(row=>row.run_id),...expiring.map(run=>run.id)])].sort();
    // This normal lifecycle purge writes UNKNOWN root blockades BEFORE Run or
    // lower-ranked rows are locked/deleted. It invalidates dependent proposals
    // and removes all runtime children, satisfying the parent delete guard.
    if(lockRunIds.length)await purgeRuleRuntimeRuns(tx,s,purgeIds,now,lockRunIds);
    const expired=expiring.length?(await sql<MaintenanceRun&{usage_state:string;usage_month:Date;definition:FlowDefinition|null}>`SELECT r.id,r.revision,r.semantic_hash,r.resume,r.usage_state,r.usage_month,(SELECT definition FROM automation_revisions v WHERE v.organization_id=r.organization_id AND v.guild_id=r.guild_id AND v.flow_id=r.flow_id AND v.revision=r.revision) AS definition FROM automation_runs r WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.id=ANY(${expiring.map(run=>run.id)}::uuid[]) AND r.ended_at IS NULL AND r.deadline_at<=${now} ORDER BY r.id FOR UPDATE OF r`.execute(tx)).rows:[];
    for(const run of expired){
      const interrupted=(await sql<{identity:string}>`SELECT identity FROM automation_operations WHERE ${tenant(s)} AND run_id=${run.id}::uuid AND state IN ('STARTED','UNKNOWN') FOR UPDATE`.execute(tx)).rows;
      const ruleUnresolved=(await sql`SELECT 1 FROM rule_runtime_intents WHERE ${tenant(s)} AND run_id=${run.id}::uuid AND (state='RESULT_UNKNOWN' OR send_admitted_at IS NOT NULL AND state IN ('EXECUTING','CANCEL_REQUESTED')) LIMIT 1`.execute(tx)).rows.length>0;
      const unknown=interrupted.length>0||ruleUnresolved;
      const resume=fenceIterationResults(run,run.definition,interrupted.map(operation=>operation.identity),unknown?'UNKNOWN':'EXPIRED');
      if(run.usage_state==='RESERVED')await sql`UPDATE automation_usage_months SET reserved=reserved-1 WHERE ${tenant(s)} AND month=${run.usage_month}::date AND reserved>0`.execute(tx);
      await sql`UPDATE automation_runs SET resume=${JSON.stringify(resume)}::jsonb,status=${unknown?'UNKNOWN':'EXPIRED'},usage_state=${run.usage_state==='RESERVED'?'RELEASED':run.usage_state},ended_at=${now},wake_at=NULL,reason='RUN_DEADLINE',updated_at=${now} WHERE ${tenant(s)} AND id=${run.id}::uuid`.execute(tx);
    }
    // Every mutation remains inside the captured scope. A guild appearing
    // after discovery is left for the next bounded pass, never added as a late
    // lock acquisition under the old global automation fence.
    const runs=oldRuns.length?await sql`DELETE FROM automation_runs WHERE ${tenant(s)} AND id=ANY(${oldRuns.map(run=>run.id)}::uuid[]) AND ended_at<=${cutoff} RETURNING id`.execute(tx):{rows:[]};
    await sql`DELETE FROM automation_requests WHERE ${tenant(s)} AND created_at<=${cutoff}`.execute(tx);
    // Occurrence deduplication is only needed while it could start; no backlog
    // replay is allowed, so consumed metadata can be erased within seven days.
    await sql`DELETE FROM automation_occurrences WHERE ${tenant(s)} AND created_at<=${cutoff}`.execute(tx);
    for(const flow of flows){
      // A user deleting a definition requests cancellation. A stalled worker
      // cannot keep its data indefinitely or revive it after retention cleanup.
      await sql`DELETE FROM automation_schedules WHERE ${tenant(s)} AND flow_id=${flow.id}`.execute(tx);
      await sql`DELETE FROM automation_runs WHERE ${tenant(s)} AND flow_id=${flow.id} AND id=ANY(${purgeIds}::uuid[])`.execute(tx);
      await sql`DELETE FROM automation_flows WHERE ${tenant(s)} AND id=${flow.id}`.execute(tx);
    }
    // Aggregate counters contain no identities or payload. Keep the closed
    // calendar month only through its accounting reconciliation grace period.
    await sql`DELETE FROM automation_usage_months WHERE ${tenant(s)} AND month+interval '1 month'+interval '7 days'<=${now} AND reserved=0`.execute(tx);
    // Own expiry can precede parent ended_at+7d (for example a late terminal).
    // FK cascade alone is therefore insufficient. Delete after terminal writes
    // as well, so an already elapsed observation cannot survive this pass.
    const observations=observationPurgeRunIds.length?await sql`DELETE FROM automation_execution_observations WHERE ${tenant(s)} AND run_id=ANY(${observationPurgeRunIds}::uuid[]) AND retention_expires_at<=${now} RETURNING run_id`.execute(tx):{rows:[]};
    return {expired:expired.length,deletedRuns:runs.rows.length,deletedFlows:flows.length,deletedObservations:observations.rows.length};
   });
   expiredCount+=counts.expired;deletedRuns+=counts.deletedRuns;deletedFlows+=counts.deletedFlows;deletedObservations+=counts.deletedObservations;
  }
  return {expired:expiredCount,deletedRuns,deletedFlows};
}
