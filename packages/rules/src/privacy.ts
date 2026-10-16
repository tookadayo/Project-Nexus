import { sql, tenant, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import { acquireRuleScopeLocks, ruleScopeLockSet } from "./locks";
import { purgeRuleRuntimeGuild, purgeExpiredRuleRuntime } from "./runtime-store";
import { purgeIssueRegistry } from "./issue-registry";
import { purgeOperationalCaseContexts, expireOperationalCaseContexts } from "./operational-context";
import { expireRoleAccessObservations } from "./role-access-source";
import { purgeExpiredMinimalTargetSafety } from "../../security/src/alpha16-safety-state";

/** Conservative aggregate invalidation: without subject-free provenance proving
 * independence we cannot retain the guild's old evaluation as usable evidence.
 * The caller owns the deletion tombstone/session transaction and scope locks. */
async function invalidateDerived(tx:Tx,s:Scope){
 await sql`SELECT target_type,target_id FROM rule_target_safety WHERE ${tenant(s)} ORDER BY target_type,target_id FOR UPDATE`.execute(tx);
 await purgeRuleRuntimeGuild(tx,s);
 await sql`UPDATE rule_target_safety SET apply_gate='UNKNOWN_BLOCKED',safety_epoch=LEAST(safety_epoch::numeric+1,9223372036854775807)::bigint,state_version=LEAST(state_version::numeric+1,9223372036854775807)::bigint WHERE ${tenant(s)}`.execute(tx);
 await sql`UPDATE rule_suggestions SET state=CASE WHEN state='CONSUMED' THEN state ELSE 'INVALIDATED' END,version=version+1,actionable_until=LEAST(actionable_until,now()),evaluation_result_id=NULL,invalidated_reason='PRIVACY_DELETED' WHERE ${tenant(s)}`.execute(tx);
 await sql`DELETE FROM rule_suggestion_evidence WHERE ${tenant(s)}`.execute(tx);
 await sql`DELETE FROM rule_job_case_context_refs WHERE ${tenant(s)}`.execute(tx);
 await sql`UPDATE rule_evaluation_jobs SET state=CASE WHEN state IN ('SUCCEEDED','FAILED','CANCELLED') THEN state ELSE 'CANCELLED' END,row_version=row_version+1,finished_at=COALESCE(finished_at,now()),failure_code='PRIVACY_DELETED',actor_hash=NULL WHERE ${tenant(s)}`.execute(tx);
 await sql`DELETE FROM rule_evaluation_results WHERE ${tenant(s)}`.execute(tx);
 await sql`DELETE FROM rule_evaluation_inputs WHERE ${tenant(s)}`.execute(tx);
 await sql`DELETE FROM rule_request_keys WHERE ${tenant(s)}`.execute(tx);
 await sql`DELETE FROM rule_evaluation_jobs WHERE ${tenant(s)}`.execute(tx);
 await sql`DELETE FROM rule_fact_health_refs WHERE ${tenant(s)}`.execute(tx);
 await sql`DELETE FROM rule_fact_values WHERE ${tenant(s)}`.execute(tx);
 await sql`DELETE FROM rule_fact_groups WHERE ${tenant(s)}`.execute(tx);
 await sql`DELETE FROM rule_fact_snapshots WHERE ${tenant(s)}`.execute(tx);
 await sql`DELETE FROM rule_source_health WHERE ${tenant(s)}`.execute(tx);
 for(const table of ["rule_case_observations","rule_case_source_health","rule_case_profile_values","rule_case_contexts"])
  await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(s)}`.execute(tx);
}
export async function purgeRuleActor(tx:Tx,s:Scope,actorHash:string){
 await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));
 await invalidateDerived(tx,s);
 await purgeOperationalCaseContexts(tx,s,actorHash);
 await sql`DELETE FROM rule_suggestion_user_states WHERE ${tenant(s)} AND actor_hash=${actorHash}`.execute(tx);
 await sql`DELETE FROM rule_lineage_suppressions WHERE ${tenant(s)} AND actor_hash=${actorHash}`.execute(tx);
 // Shared rejection has no actor reference; its approved purpose/expiry remains
 // separate. No identity, removed Fact or Run payload is copied into history.
}
export async function purgeRuleGuild(tx:Tx,s:Scope){
 await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));
 await invalidateDerived(tx,s);
 await purgeOperationalCaseContexts(tx,s);
 await purgeIssueRegistry(tx,s);
 await sql`DELETE FROM rule_native_cohort_heads WHERE ${tenant(s)}`.execute(tx);
 await sql`DELETE FROM rule_native_cohort_revisions WHERE ${tenant(s)}`.execute(tx);
 for(const table of ["rule_apply_reservations","rule_suggestion_draft_links","rule_suggestion_user_states","rule_suggestion_history","rule_suggestions","rule_lineage_suppressions","rule_target_safety","rule_config_versions"])
  await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(s)}`.execute(tx);
}

/** Run only after startup deletion reconciliation and before read/evaluation or
 * dispatch. No data is copied into a longer-lived table to evade its deadline. */
export async function purgeExpiredRuleData(tx:Tx,s:Scope,now:Date){
 await acquireRuleScopeLocks(tx,ruleScopeLockSet(s));
 await purgeIssueRegistry(tx,s,now);
 await expireOperationalCaseContexts(tx,s,now);
 await expireRoleAccessObservations(tx,s,now);
 await sql`DELETE FROM rule_native_cohort_revisions WHERE ${tenant(s)} AND expires_at<=${now}`.execute(tx);
 await sql`SELECT target_type,target_id FROM rule_target_safety WHERE ${tenant(s)} ORDER BY target_type,target_id FOR UPDATE`.execute(tx);
 await purgeExpiredRuleRuntime(tx,s,now);
 const expiredHealth=(await sql<{id:string}>`SELECT id FROM rule_source_health WHERE ${tenant(s)} AND expires_at<=${now}`.execute(tx)).rows.map(r=>r.id);
 const expiredContexts=(await sql<{id:string}>`SELECT id FROM rule_case_contexts WHERE ${tenant(s)} AND expires_at<=${now}`.execute(tx)).rows.map(r=>r.id);
 const expiredSnapshots=(await sql<{id:string}>`SELECT p.id FROM rule_fact_snapshots p WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId} AND (p.expires_at<=${now} OR EXISTS(SELECT 1 FROM rule_fact_health_refs r WHERE r.organization_id=p.organization_id AND r.guild_id=p.guild_id AND r.snapshot_id=p.id AND r.health_id=ANY(${expiredHealth}::uuid[])))`.execute(tx)).rows.map(r=>r.id);
 const expiredJobs=(await sql<{id:string}>`SELECT j.id FROM rule_evaluation_jobs j WHERE j.organization_id=${s.organizationId}::uuid AND j.guild_id=${s.guildId} AND (j.expires_at<=${now} OR EXISTS(SELECT 1 FROM rule_job_case_context_refs r WHERE r.organization_id=j.organization_id AND r.guild_id=j.guild_id AND r.job_id=j.id AND r.context_id=ANY(${expiredContexts}::uuid[])))`.execute(tx)).rows.map(r=>r.id);
 const expiredResults=(await sql<{id:string}>`SELECT id FROM rule_evaluation_results WHERE ${tenant(s)} AND (expires_at<=${now} OR job_id=ANY(${expiredJobs}::uuid[]))`.execute(tx)).rows.map(r=>r.id);
 const affectedSuggestions=(await sql<{id:string}>`SELECT u.id FROM rule_suggestions u WHERE u.organization_id=${s.organizationId}::uuid AND u.guild_id=${s.guildId} AND (u.actionable_until<=${now} OR u.history_expires_at<=${now} OR u.evaluation_result_id=ANY(${expiredResults}::uuid[]) OR EXISTS(SELECT 1 FROM rule_suggestion_evidence e WHERE e.organization_id=u.organization_id AND e.guild_id=u.guild_id AND e.suggestion_id=u.id AND (e.expires_at<=${now} OR e.snapshot_id=ANY(${expiredSnapshots}::uuid[]) OR e.health_id=ANY(${expiredHealth}::uuid[]) OR e.evaluation_result_id=ANY(${expiredResults}::uuid[]) OR e.case_context_id=ANY(${expiredContexts}::uuid[]))))`.execute(tx)).rows.map(r=>r.id);
 // Evidence expiry makes the parent non-actionable before detaching references.
 await sql`UPDATE rule_suggestions SET state=CASE WHEN state='CONSUMED' THEN state ELSE 'INVALIDATED' END,version=version+1,actionable_until=LEAST(actionable_until,${now}),evaluation_result_id=NULL,invalidated_reason='EVIDENCE_EXPIRED' WHERE ${tenant(s)} AND id=ANY(${affectedSuggestions}::uuid[])`.execute(tx);
 await sql`DELETE FROM rule_suggestion_evidence WHERE ${tenant(s)} AND suggestion_id=ANY(${affectedSuggestions}::uuid[])`.execute(tx);
 await sql`DELETE FROM rule_job_case_context_refs WHERE ${tenant(s)} AND (job_id=ANY(${expiredJobs}::uuid[]) OR context_id=ANY(${expiredContexts}::uuid[]))`.execute(tx);
 await sql`DELETE FROM rule_evaluation_results WHERE ${tenant(s)} AND id=ANY(${expiredResults}::uuid[])`.execute(tx);
 await sql`DELETE FROM rule_evaluation_inputs WHERE ${tenant(s)} AND job_id=ANY(${expiredJobs}::uuid[])`.execute(tx);
 await sql`DELETE FROM rule_evaluation_jobs WHERE ${tenant(s)} AND id=ANY(${expiredJobs}::uuid[])`.execute(tx);
 await sql`DELETE FROM rule_fact_health_refs WHERE ${tenant(s)} AND snapshot_id=ANY(${expiredSnapshots}::uuid[])`.execute(tx);
 await sql`DELETE FROM rule_fact_values WHERE ${tenant(s)} AND snapshot_id=ANY(${expiredSnapshots}::uuid[])`.execute(tx);
 await sql`DELETE FROM rule_fact_groups WHERE ${tenant(s)} AND snapshot_id=ANY(${expiredSnapshots}::uuid[])`.execute(tx);
 await sql`DELETE FROM rule_fact_snapshots WHERE ${tenant(s)} AND id=ANY(${expiredSnapshots}::uuid[])`.execute(tx);
 await sql`DELETE FROM rule_source_health WHERE ${tenant(s)} AND id=ANY(${expiredHealth}::uuid[])`.execute(tx);
 for(const table of ["rule_case_observations","rule_case_source_health","rule_case_profile_values"])
  await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(s)} AND context_id=ANY(${expiredContexts}::uuid[])`.execute(tx);
 await sql`DELETE FROM rule_case_contexts WHERE ${tenant(s)} AND id=ANY(${expiredContexts}::uuid[])`.execute(tx);
 await sql`DELETE FROM rule_suggestion_history WHERE ${tenant(s)} AND expires_at<=${now}`.execute(tx);
 await sql`DELETE FROM rule_lineage_suppressions WHERE ${tenant(s)} AND expires_at<=${now}`.execute(tx);
 await sql`DELETE FROM rule_request_keys WHERE ${tenant(s)} AND expires_at<=${now}`.execute(tx);
 await sql`DELETE FROM rule_suggestion_user_states WHERE ${tenant(s)} AND expires_at<=${now}`.execute(tx);
 // Never delete an unresolved operation guard here: its runtime store must
 // first terminalize UNKNOWN and persist the target root safety fence.
 for(const table of ["rule_suggestion_user_states","rule_suggestion_history"])
  await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(s)} AND suggestion_id IN (SELECT id FROM rule_suggestions WHERE ${tenant(s)} AND history_expires_at<=${now})`.execute(tx);
 await sql`DELETE FROM rule_suggestion_draft_links d WHERE d.organization_id=${s.organizationId}::uuid AND d.guild_id=${s.guildId} AND NOT EXISTS(SELECT 1 FROM rule_apply_reservations r WHERE r.organization_id=d.organization_id AND r.guild_id=d.guild_id AND r.suggestion_id=d.suggestion_id AND r.immutable_revision_id=d.immutable_revision_id) AND (expires_at<=${now} OR suggestion_id IN (SELECT id FROM rule_suggestions WHERE ${tenant(s)} AND history_expires_at<=${now}))`.execute(tx);
 await sql`DELETE FROM rule_suggestions u WHERE u.organization_id=${s.organizationId}::uuid AND u.guild_id=${s.guildId} AND history_expires_at<=${now} AND NOT EXISTS(SELECT 1 FROM rule_apply_reservations r WHERE r.organization_id=u.organization_id AND r.guild_id=u.guild_id AND r.suggestion_id=u.id) AND NOT EXISTS(SELECT 1 FROM rule_suggestion_draft_links d WHERE d.organization_id=u.organization_id AND d.guild_id=u.guild_id AND d.suggestion_id=u.id)`.execute(tx);
 await sql`DELETE FROM rule_config_versions c WHERE c.organization_id=${s.organizationId}::uuid AND c.guild_id=${s.guildId} AND expires_at<=${now} AND NOT EXISTS(SELECT 1 FROM rule_evaluation_jobs j WHERE j.organization_id=c.organization_id AND j.guild_id=c.guild_id AND j.config_version=c.version)`.execute(tx);
 await purgeExpiredMinimalTargetSafety(tx,s,now);
}
