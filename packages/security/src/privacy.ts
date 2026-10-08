import { randomUUID } from "node:crypto";
import { sql, tenant, type Database } from "../../db/src/index.js";
import {
  SettingsService,
  settingsSchema,
  audit,
  type Actor,
} from "../../settings/src/index.js";
import { canAdmin, canOperatePanel } from "./index.js";
import type { IdentityVault } from "../../identity/src/index.js";
import { assert, type Scope } from "../../shared/src/index.js";
import { productGuildHash } from "../../shared/src/product-telemetry.js";
import { deleteBillingCommunity, deleteBillingActor } from "./billing-privacy";
import { EntitlementService } from "../../settings/src/billing";
export class PrivacyService {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
    private readonly settings: SettingsService,
    private readonly scrubQueue: (
      s: Scope,
      hash: string | null,
    ) => Promise<void> = async () => {},
  ) {}
  async delete(s: Scope, userId: string, actor: Actor, guild = false) {
    const current = await this.settings.get(s);
    const hash = this.vault.hash(s, userId);
    assert(actor.key === hash, "ACTOR_MISMATCH", 403);
    if (guild) {
      assert(
        (actor.source === "DISCORD_PANEL" ? canOperatePanel : canAdmin)(
          actor.permissions,
          actor.roles,
          [current.adminRoleId, ...current.managerRoleIds],
        ),
        "ADMIN_REQUIRED",
        403,
      );
      await this.settings.mutate(
        s,
        actor,
        current.revision,
        async (_before, tx) => {
          await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"privacy:" + s.organizationId + ":" + s.guildId},0))`.execute(
            tx,
          );
          await sql`DELETE FROM server_verification_challenges WHERE ${tenant(s)}`.execute(
            tx,
          );
          await sql`DELETE FROM server_web_links WHERE ${tenant(s)}`.execute(
            tx,
          );
          await deleteBillingCommunity(tx, s);
          await sql`DELETE FROM operations_organizations WHERE id=${s.organizationId}::uuid AND home_guild_id=${s.guildId}`.execute(
            tx,
          );
          await sql`DELETE FROM operations_org_guilds WHERE ${tenant(s)}`.execute(
            tx,
          );
          for (const table of [
            "location_post_observations",
            "message_observations",
            "reaction_state",
            "reaction_resets",
            "poll_answer_state",
            "poll_participant_state",
            "voice_sessions",
            "member_daily_activity",
            "lifecycle_daily_rollups",
            "adaptive_states",
            "adaptive_facts",
            "discord_surface_state",
            "collection_epochs",
            "discord_integration_health",
            "guild_capability_snapshots",
            "capability_refresh_jobs",
          ])
            await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(s)}`.execute(
              tx,
            );
          // Only an audit tombstone and disabled settings remain. Published flows can be deleted, never mutated.
          for (const table of [
            "analysis_history_cursors",
            "analysis_preview_limits",
            "analysis_results",
            "analysis_usage_ledger",
            "analysis_reservations",
            "analysis_runs",
            "analysis_grants",
            "setup_drafts",
            "report_templates",
            "operations_interventions",
            "playbooks",
            "operations_intake_panels",
            "integration_destinations",
            "webhook_endpoints",
            "api_credentials",
            "api_guild_usage_months",
            "operations_domain_events",
            "operations_coverage_heads",
            "operations_plan_heads",
            "operations_audit_events",
            "event_operation_templates",
            "operations_role_bindings",
            "operations_team_bindings",
            "saved_metric_views",
            "operational_segments",
            "suggestion_feedback",
            "weekly_summary_deliveries",
            "helper_alerts",
            "attention_items",
            "retention_tracking",
            "retention_cohorts",
            "eligible_retention_cohorts",
            "gateway_ingest",
            "usage_counters",
            "guild_subscriptions",
            "guild_capabilities",
            "guild_config_heads",
            "guild_config_revisions",
            "measurement_recipe_heads",
            "measurement_recipe_versions",
            "data_coverage_snapshots",
            "action_outbox",
            "interaction_jobs",
            "interaction_diagnostics",
            "component_tokens",
            "settings_panels",
            "guild_command_sync",
            "event_inbox",
            "telemetry_health",
            "telemetry_cursor",
            "daily_guild_metrics",
            "member_interaction_pairs",
            "member_identity_map",
            "flow_versions",
            "audit_logs",
            "deletion_requests",
          ])
            await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(s)}`.execute(
              tx,
            );
          if (process.env.LOOKUP_KEY)
            await sql`DELETE FROM product_telemetry WHERE guild_hash=${productGuildHash(s.guildId, process.env.LOOKUP_KEY)}`.execute(
              tx,
            );
          await sql`DELETE FROM analysis_input_revisions WHERE ${tenant(s)}`.execute(
            tx,
          );
          await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,completed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,now())`.execute(
            tx,
          );
          await audit(
            tx,
            s,
            { ...actor, key: "deleted-admin", encryptedUserId: undefined },
            "guild.deleted",
            null,
            { completed: true },
          );
          return settingsSchema.parse({ enabled: false });
        },
        true,
      );
      await this.scrubQueue(s, null);
      return;
    }
    await this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"privacy:" + s.organizationId + ":" + s.guildId},0))`.execute(
        tx,
      );
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.organizationId + s.guildId + hash},0))`.execute(
        tx,
      );
      const ids = (
        await sql<{
          id: string;
        }>`SELECT id FROM member_identity_map WHERE ${tenant(s)} AND lookup_hash=${hash}`.execute(
          tx,
        )
      ).rows.map((r) => r.id);
      // Invalidate affected immutable aggregates before erasing their sources.
      // History and financial usage remain recorded; unavailable payloads cannot
      // be redisplayed, compared or reused after a participant privacy deletion.
      await sql`UPDATE analysis_runs a SET invalidated_at=now(),invalidation_reason='PRIVACY_DELETED' WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.invalidated_at IS NULL AND (
        EXISTS(SELECT 1 FROM location_post_observations p WHERE p.organization_id=a.organization_id AND p.guild_id=a.guild_id AND p.subject_hash=${hash} AND p.sent_at>=a.period_start AND p.sent_at<a.period_end AND (a.status<>'COMPLETED' OR cardinality(a.target_channel_ids)=0 OR p.channel_id=ANY(a.target_channel_ids)))
        OR EXISTS(SELECT 1 FROM membership_episodes e WHERE e.organization_id=a.organization_id AND e.guild_id=a.guild_id AND e.identity_id=ANY(${ids}::uuid[]) AND (e.joined_at>=a.period_start AND e.joined_at<a.period_end OR EXISTS(SELECT 1 FROM lifecycle_events f WHERE f.organization_id=e.organization_id AND f.guild_id=e.guild_id AND f.episode_id=e.id AND f.occurred_at>=a.period_start AND f.occurred_at<a.period_end)))
        OR EXISTS(SELECT 1 FROM reaction_state r WHERE r.organization_id=a.organization_id AND r.guild_id=a.guild_id AND (r.subject_hash=${hash} OR r.target_hash=${hash}) AND r.observed_at>=a.period_start AND r.observed_at<a.period_end)
        OR EXISTS(SELECT 1 FROM poll_participant_state p WHERE p.organization_id=a.organization_id AND p.guild_id=a.guild_id AND p.subject_hash=${hash} AND p.observed_at>=a.period_start AND p.observed_at<a.period_end)
      )`.execute(tx);
      await sql`DELETE FROM attention_items i USING analysis_runs a WHERE i.organization_id=a.organization_id AND i.guild_id=a.guild_id AND a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.invalidated_at IS NOT NULL AND i.item_type='ANALYSIS_CONCERN' AND i.message_id LIKE 'analysis:'||a.id::text||':%'`.execute(
        tx,
      );
      await sql`DELETE FROM reaction_resets r USING lifecycle_events f JOIN membership_episodes e ON e.organization_id=f.organization_id AND e.guild_id=f.guild_id AND e.id=f.episode_id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.organization_id=f.organization_id AND r.guild_id=f.guild_id AND r.message_id=f.data->>'messageId' AND e.identity_id=ANY(${ids}::uuid[])`.execute(
        tx,
      );
      await sql`DELETE FROM reaction_state WHERE ${tenant(s)} AND (subject_hash=${hash} OR target_hash=${hash})`.execute(
        tx,
      );
      for (const table of [
        "poll_answer_state",
        "poll_participant_state",
        "voice_sessions",
      ])
        await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(s)} AND subject_hash=${hash}`.execute(
          tx,
        );
      for (const table of ["adaptive_states", "adaptive_facts"])
        await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(s)} AND (subject_hash=${hash} OR target_hash=${hash})`.execute(
          tx,
        );
      await sql`DELETE FROM location_post_observations WHERE ${tenant(s)} AND subject_hash=${hash}`.execute(
        tx,
      );
      await sql`DELETE FROM analysis_history_cursors WHERE ${tenant(s)} AND actor_hash=${hash}`.execute(
        tx,
      );
      await sql`DELETE FROM analysis_preview_limits WHERE ${tenant(s)} AND actor_hash=${hash}`.execute(
        tx,
      );
      // Removing a participant invalidates the aggregate co-presence clock; restart observation conservatively.
      await sql`DELETE FROM adaptive_states WHERE ${tenant(s)} AND domain IN ('voice','voice-channel')`.execute(
        tx,
      );
      await sql`UPDATE discord_surface_state SET owner_hash=NULL WHERE ${tenant(s)} AND owner_hash=${hash}`.execute(
        tx,
      );
      await sql`DELETE FROM gateway_ingest WHERE ${tenant(s)} AND (payload->>'targetHash'=${hash} OR payload->>'ownerHash'=${hash} OR payload->'mentionHashes' ? ${hash})`.execute(
        tx,
      );
      await sql`DELETE FROM attention_items a USING lifecycle_events f JOIN membership_episodes e ON e.organization_id=f.organization_id AND e.guild_id=f.guild_id AND e.id=f.episode_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.organization_id=f.organization_id AND a.guild_id=f.guild_id AND a.message_id=f.data->>'messageId' AND e.identity_id=ANY(${ids}::uuid[])`.execute(
        tx,
      );
      await sql`DELETE FROM helper_alerts a USING lifecycle_events f JOIN membership_episodes e ON e.organization_id=f.organization_id AND e.guild_id=f.guild_id AND e.id=f.episode_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.organization_id=f.organization_id AND a.guild_id=f.guild_id AND a.message_id=f.data->>'messageId' AND e.identity_id=ANY(${ids}::uuid[])`.execute(
        tx,
      );
      const sessions = (
        await sql<{
          id: string;
        }>`SELECT f.id FROM flow_sessions f JOIN membership_episodes e ON f.organization_id=e.organization_id AND f.guild_id=e.guild_id AND f.episode_id=e.id
    WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND e.identity_id=ANY(${ids}::uuid[])`.execute(
          tx,
        )
      ).rows.map((r) => r.id);
      await sql`DELETE FROM action_outbox WHERE ${tenant(s)} AND payload->>'sessionId'=ANY(${sessions}::text[])`.execute(
        tx,
      );
      await sql`DELETE FROM component_tokens WHERE ${tenant(s)} AND actor_hash=${hash}`.execute(
        tx,
      );
      await sql`DELETE FROM server_verification_challenges WHERE ${tenant(s)} AND issuer_hash=${hash}`.execute(
        tx,
      );
      await sql`UPDATE server_web_links SET verified_by_hash=NULL,verified_by_identity_ciphertext=NULL WHERE ${tenant(s)} AND verified_by_hash=${hash}`.execute(
        tx,
      );
      await sql`DELETE FROM server_verification_limits WHERE key_digest=${this.vault.digest("verification-attempt:v1", userId)}`.execute(
        tx,
      );
      const jobs = (
        await sql<{
          id: string;
          encrypted_payload: string;
        }>`SELECT id,encrypted_payload FROM interaction_jobs WHERE ${tenant(s)}`.execute(
          tx,
        )
      ).rows;
      for (const job of jobs) {
        const data = JSON.parse(this.vault.open(s, job.encrypted_payload)) as {
          userId: string;
        };
        if (data.userId === userId) {
          await sql`DELETE FROM action_outbox WHERE ${tenant(s)} AND dedupe_key=${"reply:" + job.id}`.execute(
            tx,
          );
          await sql`DELETE FROM interaction_jobs WHERE ${tenant(s)} AND id=${job.id}`.execute(
            tx,
          );
        }
      }
      await sql`DELETE FROM member_identity_map WHERE ${tenant(s)} AND lookup_hash=${hash}`.execute(
        tx,
      );
      await deleteBillingActor(tx, s, userId, this.vault);
      await sql`UPDATE analysis_runs SET requested_by_actor_hash=NULL,requested_by_user_ciphertext=NULL WHERE ${tenant(s)} AND requested_by_actor_hash=${hash}`.execute(
        tx,
      );
      await sql`UPDATE analysis_grants SET created_by_actor_hash=NULL WHERE ${tenant(s)} AND created_by_actor_hash=${hash}`.execute(
        tx,
      );
      await sql`DELETE FROM setup_drafts WHERE ${tenant(s)} AND actor_hash=${hash}`.execute(
        tx,
      );
      await sql`DELETE FROM api_credentials c USING operations_role_bindings b,operations_role_bindings subject WHERE subject.organization_id=${s.organizationId}::uuid AND subject.guild_id=${s.guildId} AND subject.actor_hash=${hash} AND b.root_organization_id=subject.root_organization_id AND b.member_id=subject.member_id AND c.organization_id=b.organization_id AND c.guild_id=b.guild_id AND c.actor_hash=b.actor_hash`.execute(
        tx,
      );
      await sql`DELETE FROM operations_org_members m USING operations_role_bindings b WHERE b.organization_id=${s.organizationId}::uuid AND b.guild_id=${s.guildId} AND b.actor_hash=${hash} AND m.organization_id=b.root_organization_id AND m.id=b.member_id`.execute(
        tx,
      );
      await sql`DELETE FROM operations_domain_events v USING operations_requests r WHERE v.organization_id=r.organization_id AND v.guild_id=r.guild_id AND r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.actor_hash=${hash} AND v.data->>'attentionKey'=r.attention_key`.execute(
        tx,
      );
      await sql`DELETE FROM attention_items a USING operations_requests r WHERE a.organization_id=r.organization_id AND a.guild_id=r.guild_id AND a.message_id=r.attention_key AND r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.actor_hash=${hash}`.execute(
        tx,
      );
      await sql`DELETE FROM api_credentials WHERE ${tenant(s)} AND actor_hash=${hash}`.execute(
        tx,
      );
      await sql`DELETE FROM operations_audit_events WHERE ${tenant(s)} AND actor_hash=${hash}`.execute(
        tx,
      );
      await sql`UPDATE attention_events SET actor_hash=NULL WHERE ${tenant(s)} AND actor_hash=${hash}`.execute(
        tx,
      );
      await sql`DELETE FROM usage_counters WHERE ${tenant(s)} AND member_hash=${hash}`.execute(
        tx,
      );
      await sql`DELETE FROM gateway_ingest WHERE ${tenant(s)} AND subject_hash=${hash}`.execute(
        tx,
      );
      await sql`DELETE FROM audit_logs WHERE ${tenant(s)} AND actor=${hash}`.execute(
        tx,
      );
      await sql`INSERT INTO deletion_requests(organization_id,guild_id,id,lookup_hash,completed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${hash},now())`.execute(
        tx,
      );
      await audit(
        tx,
        s,
        { ...actor, key: "deleted-member", encryptedUserId: undefined },
        "member.deleted",
        null,
        { completed: true },
      );
    });
    await this.scrubQueue(s, hash);
  }
  async purge(s: Scope) {
    const cfg = await this.settings.get(s);
    const entitlement = await new EntitlementService(this.db).effective(s);
    const cutoff = new Date(Date.now() - cfg.detailedRetentionDays * 86400000);
    await this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"privacy:" + s.organizationId + ":" + s.guildId},0))`.execute(
        tx,
      );
      await sql`DELETE FROM setup_drafts WHERE ${tenant(s)} AND expires_at<now()`.execute(
        tx,
      );
      // Keep immutable usage provenance; expire the aggregate result payload separately.
      await sql`DELETE FROM analysis_results r USING analysis_runs a WHERE r.organization_id=a.organization_id AND r.guild_id=a.guild_id AND r.run_id=a.id AND a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.retention_until<now()`.execute(
        tx,
      );
      await sql`DELETE FROM interaction_jobs WHERE ${tenant(s)} AND created_at<now()-interval '15 minutes'`.execute(
        tx,
      );
      await sql`DELETE FROM server_verification_challenges WHERE ${tenant(s)} AND expires_at<now()-interval '1 day'`.execute(
        tx,
      );
      await sql`DELETE FROM server_verification_limits WHERE updated_at<now()-interval '1 day'`.execute(
        tx,
      );
      await sql`DELETE FROM interaction_diagnostics WHERE ${tenant(s)} AND received_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM helper_alerts WHERE ${tenant(s)} AND created_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM attention_items WHERE ${tenant(s)} AND detected_at<${cutoff}`.execute(
        tx,
      );
      if (process.env.LOOKUP_KEY)
        await sql`DELETE FROM product_telemetry WHERE guild_hash=${productGuildHash(s.guildId, process.env.LOOKUP_KEY)} AND occurred_at<now()-interval '90 days'`.execute(
          tx,
        );
      await sql`DELETE FROM member_interaction_pairs WHERE ${tenant(s)} AND first_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM component_tokens WHERE ${tenant(s)} AND expires_at<now()`.execute(
        tx,
      );
      await sql`DELETE FROM action_outbox WHERE ${tenant(s)} AND kind='REPLY_EDIT' AND created_at<now()-interval '15 minutes'`.execute(
        tx,
      );
      await sql`DELETE FROM event_inbox WHERE ${tenant(s)} AND received_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM gateway_ingest WHERE ${tenant(s)} AND received_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM lifecycle_events WHERE ${tenant(s)} AND occurred_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM native_member_snapshots WHERE ${tenant(s)} AND observed_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM native_snapshot_jobs WHERE ${tenant(s)} AND due_at<${cutoff} AND state IN ('succeeded','unavailable')`.execute(
        tx,
      );
      await sql`DELETE FROM experiment_assignments WHERE ${tenant(s)} AND window_end<now()-interval '90 days'`.execute(
        tx,
      );
      await sql`DELETE FROM intervention_runs WHERE ${tenant(s)} AND assignment_id IS NULL AND created_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM experiment_metric_results WHERE ${tenant(s)} AND computed_at<now()-make_interval(months=>${cfg.aggregateRetentionMonths})`.execute(
        tx,
      );
      await sql`DELETE FROM reply_receipts WHERE ${tenant(s)} AND expires_at<now()`.execute(
        tx,
      );
      await sql`DELETE FROM audit_logs WHERE ${tenant(s)} AND occurred_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM membership_departures WHERE ${tenant(s)} AND departed_at<${cutoff}`.execute(
        tx,
      );
      // Active membership routing state is not an activity log. Keep it for observation windows
      // (including D30); expire departed membership state and historical flow answers separately.
      await sql`DELETE FROM flow_sessions WHERE ${tenant(s)} AND created_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM nexus_role_grants WHERE ${tenant(s)} AND granted_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM intervention_role_grants WHERE ${tenant(s)} AND granted_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM membership_episodes WHERE ${tenant(s)} AND left_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM member_identity_map m WHERE m.organization_id=${s.organizationId}::uuid AND m.guild_id=${s.guildId}
    AND NOT EXISTS(SELECT 1 FROM membership_episodes e WHERE e.organization_id=m.organization_id AND e.guild_id=m.guild_id AND e.identity_id=m.id)`.execute(
        tx,
      );
      await sql`DELETE FROM action_outbox WHERE ${tenant(s)} AND created_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM usage_counters WHERE ${tenant(s)} AND month<date_trunc('month',now())::date`.execute(
        tx,
      );
      await sql`DELETE FROM guild_capabilities WHERE ${tenant(s)} AND checked_at<${cutoff}`.execute(
        tx,
      );
      for (const table of [
        "reaction_state",
        "reaction_resets",
        "poll_answer_state",
        "poll_participant_state",
        "voice_sessions",
      ])
        await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(s)} AND observed_at<${cutoff}`.execute(
          tx,
        );
      for (const table of ["member_daily_activity", "lifecycle_daily_rollups"])
        await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(s)} AND day<(${cutoff}::timestamptz AT TIME ZONE 'UTC')::date`.execute(
          tx,
        );
      for (const table of ["adaptive_states", "adaptive_facts"])
        await sql`DELETE FROM ${sql.table(table)} WHERE ${tenant(s)} AND ${sql.ref(table === "adaptive_states" ? "observed_at" : "occurred_at")}<${cutoff}`.execute(
          tx,
        );
      await sql`DELETE FROM location_post_observations WHERE ${tenant(s)} AND sent_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM discord_surface_state WHERE ${tenant(s)} AND archived AND deleted_at IS NULL AND observed_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM guild_capability_snapshots WHERE ${tenant(s)} AND checked_at<${cutoff} AND id<>(SELECT id FROM guild_capability_snapshots WHERE ${tenant(s)} ORDER BY checked_at DESC LIMIT 1)`.execute(
        tx,
      );
      await sql`DELETE FROM collection_epochs WHERE ${tenant(s)} AND ended_at<${cutoff}`.execute(
        tx,
      );
      await sql`DELETE FROM data_coverage_snapshots WHERE ${tenant(s)} AND observed_at<${cutoff}`.execute(
        tx,
      );
      const recovery = (
        await sql<{
          recovery_until: Date | null;
          recovery_history_days: number | null;
        }>`SELECT recovery_until,recovery_history_days FROM billing_guild_state WHERE ${tenant(s)}`.execute(
          tx,
        )
      ).rows[0];
      const visible =
        entitlement.limits.historyDays ?? cfg.aggregateRetentionMonths * 31;
      const retained =
        recovery?.recovery_until && recovery.recovery_until > new Date()
          ? Math.max(visible, recovery.recovery_history_days ?? visible)
          : visible;
      // Aggregate privacy retention still caps paid history. Member-linked detail uses cutoff above.
      await sql`DELETE FROM daily_guild_metrics WHERE ${tenant(s)} AND day<greatest((now()-make_interval(months=>${cfg.aggregateRetentionMonths}))::date,(now()-make_interval(days=>${retained}))::date)`.execute(
        tx,
      );
      await sql`DELETE FROM suggestion_feedback WHERE ${tenant(s)} AND dismissed_at<now()-make_interval(months=>${cfg.aggregateRetentionMonths})`.execute(
        tx,
      );
      await sql`DELETE FROM retention_cohorts WHERE ${tenant(s)} AND cohort_day<(now()-make_interval(months=>${cfg.aggregateRetentionMonths}))::date`.execute(
        tx,
      );
    });
  }
}
