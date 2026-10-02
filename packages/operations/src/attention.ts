import {
  sql,
  tenant,
  json,
  privacyReadLock,
  type Database,
  type Tx,
} from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import { assert } from "../../shared/src/index";
import type { Settings } from "../../settings/src/index";
import type { MetricEvidence } from "../../shared/src/metric-evidence";
import { metricEvidence } from "../../shared/src/metric-evidence";
import {
  evidenceContext,
  buildMetricEvidence,
} from "../../analytics/src/evidence";
import { latestCapability } from "../../lifecycle/src/discovery";
import { enqueue } from "../../discord/src/outbox";
export type AttentionType =
  | "TEXT_NEWCOMER"
  | "FORUM_SUPPORT"
  | "LFG_RESPONSE"
  | "EVENT_OPERATION"
  | "INTEGRATION_HEALTH";
export type AttentionState = "OPEN" | "ACKNOWLEDGED" | "SNOOZED" | "RESOLVED";
export function attentionEligibility(s: Scope, cfg: Settings, now: Date) {
  const mapped = sql`EXISTS(SELECT 1 FROM discord_surface_state ch JOIN jsonb_array_elements(${JSON.stringify(cfg.communityModel.channels)}::jsonb) mapping ON mapping->>'channelId'=ch.parent_id WHERE ch.organization_id=f.organization_id AND ch.guild_id=f.guild_id AND ch.channel_id=f.data->>'channelId' AND mapping->>'purpose' IN ('SUPPORT','LFG') AND ${cfg.communityModel.confirmed})`;
  const owner = sql`EXISTS(SELECT 1 FROM discord_surface_state ch JOIN member_identity_map m ON m.organization_id=ch.organization_id AND m.guild_id=ch.guild_id AND m.lookup_hash=ch.owner_hash WHERE ch.organization_id=${s.organizationId}::uuid AND ch.guild_id=${s.guildId} AND ch.channel_id=f.data->>'channelId' AND m.id=e.identity_id AND ch.creation_observed AND ch.created_at>=${new Date(now.getTime() - 86400000)} AND f.occurred_at>=ch.created_at)`;
  return sql`CASE WHEN ${mapped} THEN ${owner} AND f.data->>'receivedHumanParticipant' IS DISTINCT FROM 'true' ELSE COALESCE(e.engagement_started_at,e.joined_at)>=${new Date(now.getTime() - 3 * 86400000)} AND f.occurred_at>=COALESCE(e.engagement_started_at,e.joined_at) AND f.occurred_at<COALESCE(e.engagement_started_at,e.joined_at)+interval '72 hours' END`;
}
export type TeamOperations = {
  evidence?: Record<string, MetricEvidence>;
  openBacklog: number;
  snoozed: number;
  oldestOpenAt: string | null;
  acknowledgementSample: number;
  medianAcknowledgementSeconds: number | null;
  resolutionSample: number;
  medianResolutionSeconds: number | null;
  p75ResolutionSeconds: number | null;
  itemsOpened: number;
  itemsResolved: number;
  surfaceBreakdown: { type: AttentionType; surface: string; open: number }[];
};
export async function teamOperations(
  tx: Tx,
  s: Scope,
  from: Date,
  to: Date,
): Promise<TeamOperations> {
  const r = (
    await sql<{
      open: number;
      snoozed: number;
      oldest: Date | null;
      ack_sample: number;
      ack_median: number | null;
      resolve_sample: number;
      resolve_median: number | null;
      resolve_p75: number | null;
      opened: number;
      resolved: number;
    }>`SELECT count(*) FILTER(WHERE status IN ('OPEN','ACKNOWLEDGED'))::integer AS open,count(*) FILTER(WHERE status='SNOOZED')::integer AS snoozed,min(opened_at) FILTER(WHERE status IN ('OPEN','ACKNOWLEDGED')) AS oldest,count(*) FILTER(WHERE acknowledged_at IS NOT NULL AND opened_at IS NOT NULL AND opened_at>=${from})::integer AS ack_sample,percentile_cont(.5) WITHIN GROUP(ORDER BY extract(epoch FROM acknowledged_at-opened_at)) FILTER(WHERE acknowledged_at IS NOT NULL AND opened_at IS NOT NULL AND opened_at>=${from}) AS ack_median,count(*) FILTER(WHERE resolved_at IS NOT NULL AND opened_at IS NOT NULL AND resolved_at>=${from})::integer AS resolve_sample,percentile_cont(.5) WITHIN GROUP(ORDER BY extract(epoch FROM resolved_at-opened_at)) FILTER(WHERE resolved_at IS NOT NULL AND opened_at IS NOT NULL AND resolved_at>=${from}) AS resolve_median,percentile_cont(.75) WITHIN GROUP(ORDER BY extract(epoch FROM resolved_at-opened_at)) FILTER(WHERE resolved_at IS NOT NULL AND opened_at IS NOT NULL AND resolved_at>=${from}) AS resolve_p75,count(*) FILTER(WHERE opened_at>=${from} AND opened_at<${to})::integer AS opened,count(*) FILTER(WHERE resolved_at>=${from} AND resolved_at<${to})::integer AS resolved FROM attention_items WHERE ${tenant(s)}`.execute(
      tx,
    )
  ).rows[0]!;
  const surface = (
    await sql<{
      type: AttentionType;
      surface: string;
      open: number;
    }>`SELECT item_type AS type,target_surface AS surface,count(*)::integer AS open FROM attention_items WHERE ${tenant(s)} AND status IN ('OPEN','ACKNOWLEDGED') GROUP BY item_type,target_surface`.execute(
      tx,
    )
  ).rows;
  return {
    evidence: Object.fromEntries(
      [
        ["openBacklog", r.open, r.open],
        ["snoozed", r.snoozed, r.snoozed],
        ["itemsOpened", r.opened, r.opened],
        ["itemsResolved", r.resolved, r.resolved],
        ["medianAcknowledgementSeconds", r.ack_median, r.ack_sample],
        ["medianResolutionSeconds", r.resolve_median, r.resolve_sample],
        ["p75ResolutionSeconds", r.resolve_p75, r.resolve_sample],
      ].map(([key, value, sample]) => [
        String(key),
        metricEvidence({
          metricKey: "team." + key,
          definitionVersion: "attention-operations-v1",
          definition:
            "Tenant-scoped saved Attention queue; elapsed seconds use observed acknowledgement/resolution clocks only.",
          value: Number.isFinite(value) ? Number(value) : null,
          numerator: typeof sample === "number" ? sample : null,
          denominator: null,
          sampleSize: Number(sample),
          minimumSample:
            typeof key === "string" && key.endsWith("Seconds") ? 5 : 0,
          coverageState: "COMPLETE",
          requiredSurfaces: ["CANONICAL_ATTENTION_QUEUE"],
          evidenceSources: ["attention_items"],
          coverageReasons: [],
          windowStart: from.toISOString(),
          windowEnd: to.toISOString(),
          collectionEpochIds: [],
        }),
      ]),
    ),
    openBacklog: r.open,
    snoozed: r.snoozed,
    oldestOpenAt: r.oldest?.toISOString() ?? null,
    acknowledgementSample: r.ack_sample,
    medianAcknowledgementSeconds: r.ack_median,
    resolutionSample: r.resolve_sample,
    medianResolutionSeconds: r.resolve_median,
    p75ResolutionSeconds: r.resolve_p75,
    itemsOpened: r.opened,
    itemsResolved: r.resolved,
    surfaceBreakdown: surface,
  };
}
export class AttentionOperations {
  constructor(private readonly db: Database) {}
  async observe(s: Scope, cfg: Settings, now = new Date()) {
    const context = await evidenceContext(
        this.db,
        s,
        new Date(now.getTime() - 86400000),
        now,
      ),
      snapshot = await latestCapability(this.db, s);
    await this.integrationIssue(
      s,
      "integration:gateway",
      context.health.gateway !== "CONNECTED",
      "GATEWAY_" + context.health.gateway,
      now,
    );
    await this.integrationIssue(
      s,
      "integration:members",
      context.health.intents.members !== "AVAILABLE",
      "MEMBERS_" + context.health.intents.members,
      now,
    );
    if (context.health.intents.scheduledEvents === "AVAILABLE")
      await this.eventIssues(s, now);
    const available =
      context.health.gateway === "CONNECTED" &&
      context.health.intents.members === "AVAILABLE" &&
      context.health.intents.messages === "AVAILABLE";
    if (!available) return { available: false, context };
    const roles = [
      ...cfg.staffRoleIds,
      ...cfg.managerRoleIds,
      ...cfg.helperRoleIds,
      ...(cfg.adminRoleId ? [cfg.adminRoleId] : []),
    ];
    await this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      if (
        (
          await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NULL AND completed_at IS NOT NULL`.execute(
            tx,
          )
        ).rows.length
      )
        return;
      const resolved = (
        await sql<{
          message_id: string;
          version: number;
        }>`UPDATE attention_items a SET status='RESOLVED',resolved_at=${now},resolution_reason='OBSERVED_RESPONSE',snooze_until=NULL,version=version+1,updated_at=${now} WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.status<>'RESOLVED' AND a.item_type IN ('TEXT_NEWCOMER','FORUM_SUPPORT','LFG_RESPONSE') AND EXISTS(SELECT 1 FROM lifecycle_events f WHERE f.organization_id=a.organization_id AND f.guild_id=a.guild_id AND f.kind='message.sent' AND f.data->>'messageId'=a.message_id AND (f.data->>'receivedExplicitReply'='true' OR a.item_type IN ('FORUM_SUPPORT','LFG_RESPONSE') AND f.data->>'receivedHumanParticipant'='true')) RETURNING message_id,version`.execute(
          tx,
        )
      ).rows;
      for (const row of resolved)
        await enqueue(
          tx,
          s,
          "attention:" + row.message_id + ":" + row.version,
          "PANEL_REFRESH",
          {},
        );
      await sql`WITH candidates AS (
    SELECT f.data->>'channelId' AS channel_id,f.data->>'messageId' AS message_id,f.occurred_at,CASE WHEN mapping->>'purpose'='SUPPORT' AND ${cfg.communityModel.confirmed} THEN 'FORUM_SUPPORT' WHEN mapping->>'purpose'='LFG' AND ${cfg.communityModel.confirmed} THEN 'LFG_RESPONSE' ELSE 'TEXT_NEWCOMER' END AS item_type,CASE WHEN ch.channel_type IN (11,12) AND parent.channel_type=15 THEN 'FORUM_POST' WHEN ch.channel_type IN (11,12) THEN 'THREAD' ELSE 'TEXT' END AS surface,row_number() OVER(PARTITION BY CASE WHEN mapping->>'purpose' IN ('SUPPORT','LFG') AND ${cfg.communityModel.confirmed} THEN f.data->>'channelId' ELSE f.episode_id::text END ORDER BY f.occurred_at,f.id) AS rank
    FROM lifecycle_events f JOIN membership_episodes e ON e.organization_id=f.organization_id AND e.guild_id=f.guild_id AND e.id=f.episode_id LEFT JOIN member_observable_state st ON st.organization_id=e.organization_id AND st.guild_id=e.guild_id AND st.episode_id=e.id LEFT JOIN discord_surface_state ch ON ch.organization_id=f.organization_id AND ch.guild_id=f.guild_id AND ch.channel_id=f.data->>'channelId' LEFT JOIN discord_surface_state parent ON parent.organization_id=ch.organization_id AND parent.guild_id=ch.guild_id AND parent.channel_id=ch.parent_id LEFT JOIN jsonb_array_elements(${JSON.stringify(cfg.communityModel.channels)}::jsonb) mapping ON mapping->>'channelId'=COALESCE(ch.parent_id,ch.channel_id)
    WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.kind='message.sent' AND f.context='PRODUCTION' AND e.context='PRODUCTION' AND e.left_at IS NULL AND e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND NOT e.screening_pending AND NOT e.is_guest AND ${attentionEligibility(s, cfg, now)} AND f.occurred_at>=${new Date(now.getTime() - 86400000)} AND f.occurred_at<=${new Date(now.getTime() - cfg.firstResponseMinutes * 60000)} AND f.data->>'receivedExplicitReply' IS DISTINCT FROM 'true' AND COALESCE(ch.channel_type,0) NOT IN (2,5,13) AND (ch.visibility_state IS NULL OR ch.visibility_state='VISIBLE') AND COALESCE(mapping->>'purpose','OTHER') NOT IN ('STAFF','ANNOUNCEMENT','ONBOARDING') AND NOT(COALESCE(st.roles,'{}'::text[])&&${roles}::text[]) AND f.data->>'messageId' ~ '^[0-9]{17,20}$' AND f.data->>'channelId' ~ '^[0-9]{17,20}$' AND (${cfg.analysisScope.mode}='all' OR (${cfg.analysisScope.mode}='include')=(COALESCE(ch.parent_id,ch.channel_id,f.data->>'channelId')=ANY(${cfg.analysisScope.channelIds}::text[])))
   ) INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,target_surface,reason,opened_at,threshold_seconds,updated_at)
    SELECT ${s.organizationId}::uuid,${s.guildId},channel_id,message_id,occurred_at,'OPEN',item_type,surface,CASE item_type WHEN 'FORUM_SUPPORT' THEN 'FIRST_HUMAN_RESPONSE_PENDING' WHEN 'LFG_RESPONSE' THEN 'LFG_RESPONSE_PENDING' ELSE 'DIRECT_REPLY_PENDING' END,${now},${cfg.firstResponseMinutes * 60},${now} FROM candidates WHERE rank=1 ON CONFLICT DO NOTHING`.execute(
        tx,
      );
      for (const type of [
        "TEXT_NEWCOMER",
        "FORUM_SUPPORT",
        "LFG_RESPONSE",
      ] as const) {
        const proof = buildMetricEvidence(
          "attention:" + type,
          {
            value: 1,
            numerator: 1,
            denominator: null,
            sample: 1,
            minimumSample: 0,
            definition:
              type === "TEXT_NEWCOMER"
                ? "Observed newcomer post without a direct human reply"
                : "Observed mapped post without another human participant",
            requiredSurfaces:
              type === "TEXT_NEWCOMER"
                ? ["members", "messages", "textVisibility"]
                : [
                    "members",
                    "messages",
                    type === "FORUM_SUPPORT"
                      ? "forumVisibility"
                      : "threadVisibility",
                  ],
          },
          snapshot,
          cfg,
          context,
        );
        await sql`UPDATE attention_items SET evidence=${json(proof)} WHERE ${tenant(s)} AND item_type=${type} AND status<>'RESOLVED' AND evidence IS DISTINCT FROM ${json(proof)}`.execute(
          tx,
        );
      }
      await sql`UPDATE attention_items SET status='OPEN',snooze_until=NULL,updated_at=${now},version=version+1 WHERE ${tenant(s)} AND status='SNOOZED' AND snooze_until<=${now}`.execute(
        tx,
      );
    });
    return { available: true, context };
  }
  private async integrationIssue(
    s: Scope,
    key: string,
    problem: boolean,
    reason: string,
    now: Date,
  ) {
    await this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      if (
        (
          await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NULL AND completed_at IS NOT NULL`.execute(
            tx,
          )
        ).rows.length
      )
        return;
      if (problem)
        await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,target_surface,reason,opened_at,updated_at) VALUES(${s.organizationId}::uuid,${s.guildId},'',${key},${now},'OPEN','INTEGRATION_HEALTH','INTEGRATION',${reason},${now},${now}) ON CONFLICT(organization_id,guild_id,message_id) DO UPDATE SET status=CASE WHEN attention_items.resolution_reason='INTEGRATION_RESTORED' THEN 'OPEN' ELSE attention_items.status END,opened_at=CASE WHEN attention_items.resolution_reason='INTEGRATION_RESTORED' THEN EXCLUDED.opened_at ELSE attention_items.opened_at END,resolved_at=CASE WHEN attention_items.resolution_reason='INTEGRATION_RESTORED' THEN NULL ELSE attention_items.resolved_at END,resolution_reason=CASE WHEN attention_items.resolution_reason='INTEGRATION_RESTORED' THEN NULL ELSE attention_items.resolution_reason END,reason=EXCLUDED.reason,updated_at=EXCLUDED.updated_at`.execute(
          tx,
        );
      else
        await sql`UPDATE attention_items SET status='RESOLVED',resolved_at=${now},resolution_reason='INTEGRATION_RESTORED',updated_at=${now},version=version+1 WHERE ${tenant(s)} AND message_id=${key} AND status<>'RESOLVED'`.execute(
          tx,
        );
    });
  }
  private async eventIssues(s: Scope, now: Date) {
    await this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      if (
        (
          await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NULL AND completed_at IS NOT NULL`.execute(
            tx,
          )
        ).rows.length
      )
        return;
      await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,target_surface,reason,opened_at,updated_at)
        SELECT ${s.organizationId}::uuid,${s.guildId},COALESCE(ev.data->>'channelId',''),'event:'||ev.state_key,ev.observed_at,'OPEN','EVENT_OPERATION','SCHEDULED_EVENT','CANCELLED_EVENT_WITH_OBSERVED_SIGNUPS',${now},${now} FROM adaptive_states ev WHERE ev.organization_id=${s.organizationId}::uuid AND ev.guild_id=${s.guildId} AND ev.domain='event' AND ev.data->>'status'='4' AND EXISTS(SELECT 1 FROM adaptive_facts f WHERE f.organization_id=ev.organization_id AND f.guild_id=ev.guild_id AND f.kind='scheduled_event.subscribed' AND f.data->>'eventId'=ev.state_key AND f.occurred_at>=${new Date(now.getTime() - 30 * 86400000)}) ON CONFLICT DO NOTHING`.execute(
        tx,
      );
    });
  }
  async action(
    s: Scope,
    key: string,
    channelId: string,
    status: AttentionState,
    at = new Date(),
    snoozeUntil: Date | null = null,
    resolutionReason = "MANUAL",
  ) {
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      const item = (
        await sql<{
          status: AttentionState;
          version: number;
        }>`SELECT status,version FROM attention_items WHERE ${tenant(s)} AND message_id=${key} AND channel_id=${channelId} FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(item, "ATTENTION_NOT_FOUND", 404);
      if (item.status === status) return { status, duplicate: true };
      assert(item.status !== "RESOLVED", "ATTENTION_NOT_ACTIVE", 409);
      assert(
        status !== "SNOOZED" || (snoozeUntil && snoozeUntil > at),
        "INVALID_SNOOZE",
      );
      await sql`UPDATE attention_items SET status=${status},acknowledged_at=CASE WHEN ${status === "ACKNOWLEDGED"} THEN COALESCE(acknowledged_at,${at}) ELSE acknowledged_at END,snooze_until=${status === "SNOOZED" ? snoozeUntil : null},resolved_at=${status === "RESOLVED" ? at : null},resolution_reason=${status === "RESOLVED" ? resolutionReason : null},version=version+1,updated_at=${at} WHERE ${tenant(s)} AND message_id=${key}`.execute(
        tx,
      );
      await enqueue(
        tx,
        s,
        "attention:" + key + ":" + (item.version + 1),
        "PANEL_REFRESH",
        {},
      );
      return { status, duplicate: false };
    });
  }
  async addObserved(
    s: Scope,
    channelId: string,
    messageId: string,
    openedAt: Date,
    detectedAt: Date,
    evidence: MetricEvidence | null = null,
  ) {
    await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,opened_at,item_type,reason,evidence,updated_at) VALUES(${s.organizationId}::uuid,${s.guildId},${channelId},${messageId},${detectedAt},'OPEN',${openedAt},'TEXT_NEWCOMER','ADMIN_ADDED_OBSERVED_POST',${json(evidence)},${openedAt}) ON CONFLICT DO NOTHING`.execute(
      this.db,
    );
  }
}
