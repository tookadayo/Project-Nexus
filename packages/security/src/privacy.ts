import {randomUUID} from 'node:crypto';
import {sql,tenant,type Database} from '../../db/src/index.js';
import {SettingsService,settingsSchema,audit,type Actor} from '../../settings/src/index.js';
import {canAdmin} from './index.js';
import type {IdentityVault} from '../../identity/src/index.js';
import {assert,type Scope} from '../../shared/src/index.js';
export class PrivacyService {
 constructor(private readonly db:Database,private readonly vault:IdentityVault,private readonly settings:SettingsService,private readonly scrubQueue:(s:Scope,hash:string|null)=>Promise<void>=async()=>{}){}
 async delete(s:Scope,userId:string,actor:Actor,guild=false){
  const current=await this.settings.get(s);const hash=this.vault.hash(s,userId);
  assert(actor.key===hash,'ACTOR_MISMATCH',403);
  if(guild){
   assert(canAdmin(actor.permissions,actor.roles,current.adminRoleId),'ADMIN_REQUIRED',403);
   await this.settings.mutate(s,actor,current.revision,async(_before,tx)=>{
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'privacy:'+s.organizationId+':'+s.guildId},0))`.execute(tx);
    // Only an audit tombstone and disabled settings remain. Published flows can be deleted, never mutated.
    for(const table of ['retention_tracking','retention_cohorts','gateway_ingest','usage_counters','guild_subscriptions','guild_capabilities','guild_config_heads','guild_config_revisions','data_coverage_snapshots','action_outbox','interaction_jobs','component_tokens','settings_panels','event_inbox','telemetry_health','telemetry_cursor','daily_guild_metrics','member_identity_map','flow_versions','audit_logs','deletion_requests'])
     await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(s)}`.execute(tx);
    await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,completed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,now())`.execute(tx);
    await audit(tx,s,{...actor,key:'deleted-admin'},'guild.deleted',null,{completed:true});
    return settingsSchema.parse({});
   },true);await this.scrubQueue(s,null);return;
  }
  await this.db.transaction().execute(async tx=>{
   await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'privacy:'+s.organizationId+':'+s.guildId},0))`.execute(tx);
   await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.guildId+hash},0))`.execute(tx);
   const ids=(await sql<{id:string}>`SELECT id FROM member_identity_map WHERE ${tenant(s)} AND lookup_hash=${hash}`.execute(tx)).rows.map(r=>r.id);
   const sessions=(await sql<{id:string}>`SELECT f.id FROM flow_sessions f JOIN membership_episodes e ON f.organization_id=e.organization_id AND f.guild_id=e.guild_id AND f.episode_id=e.id
    WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND e.identity_id=ANY(${ids}::uuid[])`.execute(tx)).rows.map(r=>r.id);
   await sql`DELETE FROM action_outbox WHERE ${tenant(s)} AND payload->>'sessionId'=ANY(${sessions}::text[])`.execute(tx);
   await sql`DELETE FROM component_tokens WHERE ${tenant(s)} AND actor_hash=${hash}`.execute(tx);
   const jobs=(await sql<{id:string,encrypted_payload:string}>`SELECT id,encrypted_payload FROM interaction_jobs WHERE ${tenant(s)}`.execute(tx)).rows;
   for(const job of jobs){const data=JSON.parse(this.vault.open(s,job.encrypted_payload)) as {userId:string};if(data.userId===userId){await sql`DELETE FROM action_outbox WHERE ${tenant(s)} AND dedupe_key=${'reply:'+job.id}`.execute(tx);await sql`DELETE FROM interaction_jobs WHERE ${tenant(s)} AND id=${job.id}`.execute(tx);}}
   await sql`DELETE FROM member_identity_map WHERE ${tenant(s)} AND lookup_hash=${hash}`.execute(tx);
   await sql`DELETE FROM usage_counters WHERE ${tenant(s)} AND member_hash=${hash}`.execute(tx);
   await sql`DELETE FROM gateway_ingest WHERE ${tenant(s)} AND subject_hash=${hash}`.execute(tx);
   await sql`DELETE FROM audit_logs WHERE ${tenant(s)} AND actor=${hash}`.execute(tx);
   await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,lookup_hash,completed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${hash},now())`.execute(tx);
   await audit(tx,s,{...actor,key:'deleted-member'},'member.deleted',null,{completed:true});
  });
  await this.scrubQueue(s,hash);
 }
 async purge(s:Scope){
  const cfg=await this.settings.get(s);const cutoff=new Date(Date.now()-cfg.detailedRetentionDays*86400000);
  await this.db.transaction().execute(async tx=>{
   await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'privacy:'+s.organizationId+':'+s.guildId},0))`.execute(tx);
   await sql`DELETE FROM interaction_jobs WHERE ${tenant(s)} AND created_at<now()-interval '15 minutes'`.execute(tx);
   await sql`DELETE FROM component_tokens WHERE ${tenant(s)} AND expires_at<now()`.execute(tx);
   await sql`DELETE FROM action_outbox WHERE ${tenant(s)} AND kind='REPLY_EDIT' AND created_at<now()-interval '15 minutes'`.execute(tx);
   await sql`DELETE FROM event_inbox WHERE ${tenant(s)} AND received_at<${cutoff}`.execute(tx);
   await sql`DELETE FROM gateway_ingest WHERE ${tenant(s)} AND received_at<${cutoff}`.execute(tx);
   await sql`DELETE FROM lifecycle_events WHERE ${tenant(s)} AND occurred_at<${cutoff}`.execute(tx);
   await sql`DELETE FROM native_member_snapshots WHERE ${tenant(s)} AND observed_at<${cutoff}`.execute(tx);
   await sql`DELETE FROM native_snapshot_jobs WHERE ${tenant(s)} AND due_at<${cutoff} AND state IN ('succeeded','unavailable')`.execute(tx);
   await sql`DELETE FROM experiment_assignments WHERE ${tenant(s)} AND window_end<now()-interval '90 days'`.execute(tx);
   await sql`DELETE FROM intervention_runs WHERE ${tenant(s)} AND assignment_id IS NULL AND created_at<${cutoff}`.execute(tx);
   await sql`DELETE FROM experiment_metric_results WHERE ${tenant(s)} AND computed_at<now()-make_interval(months=>${cfg.aggregateRetentionMonths})`.execute(tx);
   await sql`DELETE FROM reply_receipts WHERE ${tenant(s)} AND expires_at<now()`.execute(tx);
   await sql`DELETE FROM audit_logs WHERE ${tenant(s)} AND occurred_at<${cutoff}`.execute(tx);
   await sql`DELETE FROM membership_departures WHERE ${tenant(s)} AND departed_at<${cutoff}`.execute(tx);
   // Active membership routing state is not an activity log. Keep it for observation windows
   // (including D30); expire departed membership state and historical flow answers separately.
   await sql`DELETE FROM flow_sessions WHERE ${tenant(s)} AND created_at<${cutoff}`.execute(tx);
   await sql`DELETE FROM nexus_role_grants WHERE ${tenant(s)} AND granted_at<${cutoff}`.execute(tx);
   await sql`DELETE FROM intervention_role_grants WHERE ${tenant(s)} AND granted_at<${cutoff}`.execute(tx);
   await sql`DELETE FROM membership_episodes WHERE ${tenant(s)} AND left_at<${cutoff}`.execute(tx);
   await sql`DELETE FROM member_identity_map m WHERE m.organization_id=${s.organizationId}::uuid AND m.guild_id=${s.guildId}
    AND NOT EXISTS(SELECT 1 FROM membership_episodes e WHERE e.organization_id=m.organization_id AND e.guild_id=m.guild_id AND e.identity_id=m.id)`.execute(tx);
   await sql`DELETE FROM action_outbox WHERE ${tenant(s)} AND created_at<${cutoff}`.execute(tx);
   await sql`DELETE FROM usage_counters WHERE ${tenant(s)} AND month<date_trunc('month',now())::date`.execute(tx);
   await sql`DELETE FROM guild_capabilities WHERE ${tenant(s)} AND checked_at<${cutoff}`.execute(tx);
   await sql`DELETE FROM data_coverage_snapshots WHERE ${tenant(s)} AND observed_at<${cutoff}`.execute(tx);
   await sql`DELETE FROM daily_guild_metrics WHERE ${tenant(s)} AND day<(now()-make_interval(months=>${cfg.aggregateRetentionMonths}))::date`.execute(tx);
   await sql`DELETE FROM retention_cohorts WHERE ${tenant(s)} AND cohort_day<(now()-make_interval(months=>${cfg.aggregateRetentionMonths}))::date`.execute(tx);
  });
 }
}
