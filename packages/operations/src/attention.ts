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
import { latestCapability, analysisChannelScope } from "../../lifecycle/src/discovery";
import { enqueue } from "../../discord/src/outbox";
export type AttentionType =
  | "TEXT_NEWCOMER"
  | "FORUM_SUPPORT"
  | "LFG_RESPONSE"
  | "EVENT_OPERATION"
  | "INTEGRATION_HEALTH"
  | "METRIC_TREND"
  | "OPERATIONS_REQUEST"
  | "ANALYSIS_CONCERN";
export type AttentionState =
  | "OPEN"
  | "ACKNOWLEDGED"
  | "IN_PROGRESS"
  | "SNOOZED"
  | "RESOLVED"
  | "DISMISSED";
export function attentionEligibility(s: Scope, _cfg: Settings, _now: Date) {
  // Channel purpose/scope is resolved once by callers. In a public thread only
  // the observed owner starter may be awaiting a structural first response.
  return sql`EXISTS(SELECT 1 FROM discord_surface_state ch WHERE ch.organization_id=${s.organizationId}::uuid AND ch.guild_id=${s.guildId} AND ch.channel_id=f.data->>'channelId' AND (ch.channel_type IN (0,5) OR (ch.channel_type IN (10,11) AND ch.creation_observed AND ch.created_at IS NOT NULL AND f.data->>'messageId'=ch.channel_id AND EXISTS(SELECT 1 FROM member_identity_map m WHERE m.organization_id=e.organization_id AND m.guild_id=e.guild_id AND m.id=e.identity_id AND m.lookup_hash=ch.owner_hash))))`;
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
    }>`SELECT count(*) FILTER(WHERE status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS'))::integer AS open,count(*) FILTER(WHERE status='SNOOZED')::integer AS snoozed,min(opened_at) FILTER(WHERE status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')) AS oldest,count(*) FILTER(WHERE acknowledged_at IS NOT NULL AND opened_at IS NOT NULL AND opened_at>=${from})::integer AS ack_sample,percentile_cont(.5) WITHIN GROUP(ORDER BY extract(epoch FROM acknowledged_at-opened_at)) FILTER(WHERE acknowledged_at IS NOT NULL AND opened_at IS NOT NULL AND opened_at>=${from}) AS ack_median,count(*) FILTER(WHERE resolved_at IS NOT NULL AND opened_at IS NOT NULL AND resolved_at>=${from})::integer AS resolve_sample,percentile_cont(.5) WITHIN GROUP(ORDER BY extract(epoch FROM resolved_at-opened_at)) FILTER(WHERE resolved_at IS NOT NULL AND opened_at IS NOT NULL AND resolved_at>=${from}) AS resolve_median,percentile_cont(.75) WITHIN GROUP(ORDER BY extract(epoch FROM resolved_at-opened_at)) FILTER(WHERE resolved_at IS NOT NULL AND opened_at IS NOT NULL AND resolved_at>=${from}) AS resolve_p75,count(*) FILTER(WHERE opened_at>=${from} AND opened_at<${to})::integer AS opened,count(*) FILTER(WHERE resolved_at>=${from} AND resolved_at<${to})::integer AS resolved FROM attention_items WHERE ${tenant(s)}`.execute(
      tx,
    )
  ).rows[0]!;
  const surface = (
    await sql<{
      type: AttentionType;
      surface: string;
      open: number;
    }>`SELECT item_type AS type,target_surface AS surface,count(*)::integer AS open FROM attention_items WHERE ${tenant(s)} AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS') GROUP BY item_type,target_surface`.execute(
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
        }>`UPDATE attention_items a SET status='RESOLVED',resolved_at=${now},resolution_reason='OBSERVED_RESPONSE',snooze_until=NULL,version=version+1,updated_at=${now} WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.status NOT IN ('RESOLVED','DISMISSED') AND a.item_type IN ('TEXT_NEWCOMER','FORUM_SUPPORT','LFG_RESPONSE') AND EXISTS(SELECT 1 FROM lifecycle_events f WHERE f.organization_id=a.organization_id AND f.guild_id=a.guild_id AND f.kind='message.sent' AND f.data->>'messageId'=a.message_id AND (f.data->>'receivedExplicitReply'='true' OR a.item_type IN ('FORUM_SUPPORT','LFG_RESPONSE') AND f.data->>'receivedHumanParticipant'='true')) RETURNING message_id,version`.execute(
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
      const resolvedScope = await analysisChannelScope(tx,s,cfg), purposes = resolvedScope.resolutions.filter(c => c.selected && ["SUPPORT","BUG_REPORT","LFG"].includes(c.effectivePurpose)).map(c => ({channelId:c.actualChannelId,purpose:c.effectivePurpose,surface:c.surface}));
      await sql`WITH candidates AS (
    SELECT f.data->>'channelId' AS channel_id,f.data->>'messageId' AS message_id,f.occurred_at,CASE WHEN mapping->>'purpose' IN ('SUPPORT','BUG_REPORT') AND mapping->>'surface'='FORUM_POST' THEN 'FORUM_SUPPORT' WHEN mapping->>'purpose'='LFG' THEN 'LFG_RESPONSE' ELSE 'TEXT_NEWCOMER' END AS item_type,mapping->>'surface' AS surface,row_number() OVER(PARTITION BY f.data->>'channelId',f.data->>'messageId' ORDER BY f.occurred_at,f.id) AS rank
    FROM lifecycle_events f JOIN membership_episodes e ON e.organization_id=f.organization_id AND e.guild_id=f.guild_id AND e.id=f.episode_id LEFT JOIN member_observable_state st ON st.organization_id=e.organization_id AND st.guild_id=e.guild_id AND st.episode_id=e.id LEFT JOIN discord_surface_state ch ON ch.organization_id=f.organization_id AND ch.guild_id=f.guild_id AND ch.channel_id=f.data->>'channelId' LEFT JOIN discord_surface_state parent ON parent.organization_id=ch.organization_id AND parent.guild_id=ch.guild_id AND parent.channel_id=ch.parent_id JOIN jsonb_array_elements(${JSON.stringify(purposes)}::jsonb) mapping ON mapping->>'channelId'=f.data->>'channelId'
    WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.kind='message.sent' AND f.context='PRODUCTION' AND e.context='PRODUCTION' AND e.left_at IS NULL AND e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND NOT e.screening_pending AND NOT e.is_guest AND ${attentionEligibility(s, cfg, now)} AND f.occurred_at>=${new Date(now.getTime() - 86400000)} AND f.occurred_at<=${new Date(now.getTime() - cfg.firstResponseMinutes * 60000)} AND f.data->>'receivedExplicitReply' IS DISTINCT FROM 'true' AND mapping->>'surface' IN ('TEXT','THREAD','FORUM_POST') AND f.data->>'receivedHumanParticipant' IS DISTINCT FROM 'true' AND NOT(COALESCE(st.roles,'{}'::text[])&&${roles}::text[]) AND f.data->>'messageId' ~ '^[0-9]{17,20}$' AND f.data->>'channelId' ~ '^[0-9]{17,20}$'
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
      const unknown = reason.endsWith("UNKNOWN"),
        proof = metricEvidence({
          metricKey: "integration.issue",
          definitionVersion: "integration-health-v1",
          definition:
            "Observed integration health issue. This describes collection health, not community activity.",
          value: unknown ? null : problem ? 1 : 0,
          numerator: unknown ? null : problem ? 1 : 0,
          denominator: null,
          sampleSize: unknown ? 0 : 1,
          minimumSample: 1,
          coverageState: unknown ? "UNKNOWN" : "COMPLETE",
          requiredSurfaces: ["INTEGRATION_HEALTH"],
          evidenceSources: ["discord_integration_health"],
          coverageReasons: unknown ? [reason] : [],
          windowStart: now.toISOString(),
          windowEnd: now.toISOString(),
          collectionEpochIds: [],
        });
      if (problem)
        await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,target_surface,reason,opened_at,updated_at,evidence) VALUES(${s.organizationId}::uuid,${s.guildId},'',${key},${now},'OPEN','INTEGRATION_HEALTH','INTEGRATION',${reason},${now},${now},${json(proof)}) ON CONFLICT(organization_id,guild_id,message_id) DO UPDATE SET status=CASE WHEN attention_items.resolution_reason='INTEGRATION_RESTORED' THEN 'OPEN' ELSE attention_items.status END,opened_at=CASE WHEN attention_items.resolution_reason='INTEGRATION_RESTORED' THEN EXCLUDED.opened_at ELSE attention_items.opened_at END,resolved_at=CASE WHEN attention_items.resolution_reason='INTEGRATION_RESTORED' THEN NULL ELSE attention_items.resolved_at END,resolution_reason=CASE WHEN attention_items.resolution_reason='INTEGRATION_RESTORED' THEN NULL ELSE attention_items.resolution_reason END,reason=EXCLUDED.reason,evidence=EXCLUDED.evidence,updated_at=EXCLUDED.updated_at`.execute(
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
      const from = new Date(now.getTime() - 30 * 86400000),
        events = (
          await sql<{
            key: string;
            channel_id: string;
            observed_at: Date;
          }>`SELECT ev.state_key AS key,COALESCE(ev.data->>'channelId','') AS channel_id,ev.observed_at FROM adaptive_states ev WHERE ${tenant(s)} AND ev.domain='event' AND ev.data->>'status'='4' AND ev.observed_at>=${from} AND EXISTS(SELECT 1 FROM adaptive_facts f WHERE f.organization_id=ev.organization_id AND f.guild_id=ev.guild_id AND f.kind='scheduled_event.subscribed' AND f.data->>'eventId'=ev.state_key AND f.occurred_at>=${from}) LIMIT 100`.execute(
            tx,
          )
        ).rows;
      for (const event of events) {
        const proof = metricEvidence({
          metricKey: "event.cancelled_with_observed_signup",
          definitionVersion: "event-signup-v1",
          definition:
            "A cancellation and at least one signup were observed. Signup is not attendance; this is not total participation.",
          value: 1,
          numerator: 1,
          denominator: null,
          sampleSize: 1,
          minimumSample: 1,
          coverageState: "COMPLETE",
          requiredSurfaces: ["SCHEDULED_EVENT"],
          evidenceSources: [
            "adaptive_states",
            "adaptive_facts:scheduled_event.subscribed",
          ],
          coverageReasons: [],
          windowStart: from.toISOString(),
          windowEnd: now.toISOString(),
          collectionEpochIds: [],
        });
        await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,item_type,target_surface,reason,opened_at,updated_at,evidence) VALUES(${s.organizationId}::uuid,${s.guildId},${event.channel_id},${"event:" + event.key},${event.observed_at},'OPEN','EVENT_OPERATION','SCHEDULED_EVENT','CANCELLED_EVENT_WITH_OBSERVED_SIGNUPS',${now},${now},${json(proof)}) ON CONFLICT DO NOTHING`.execute(
          tx,
        );
      }
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
    authorize?: (tx:Tx)=>Promise<void>,
    expectedVersion?:number,
    actorHash?:string,
  ) {
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      await authorize?.(tx);
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
      assert(expectedVersion===undefined||item.version===expectedVersion,'REVISION_CONFLICT',409);
      assert(
        !["RESOLVED", "DISMISSED"].includes(item.status),
        "ATTENTION_NOT_ACTIVE",
        409,
      );
      assert(
        status !== "SNOOZED" || (snoozeUntil && snoozeUntil > at),
        "INVALID_SNOOZE",
      );
      await sql`UPDATE attention_items SET status=${status},acknowledged_at=CASE WHEN ${status === "ACKNOWLEDGED"} THEN COALESCE(acknowledged_at,${at}) ELSE acknowledged_at END,snooze_until=${status === "SNOOZED" ? snoozeUntil : null},resolved_at=${status === "RESOLVED" ? at : null},resolution_reason=${["RESOLVED", "DISMISSED"].includes(status) ? resolutionReason : null},last_actor_hash=CASE WHEN ${actorHash !== undefined} THEN ${actorHash ?? null} ELSE last_actor_hash END,version=version+1,updated_at=${at} WHERE ${tenant(s)} AND message_id=${key}`.execute(
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
    await this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      assert(
        !(
          await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NULL AND completed_at IS NOT NULL`.execute(
            tx,
          )
        ).rows.length,
        "PRIVACY_DELETED",
        403,
      );
      await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,opened_at,item_type,reason,evidence,updated_at) VALUES(${s.organizationId}::uuid,${s.guildId},${channelId},${messageId},${detectedAt},'OPEN',${openedAt},'TEXT_NEWCOMER','ADMIN_ADDED_OBSERVED_POST',${json(evidence)},${openedAt}) ON CONFLICT DO NOTHING`.execute(
        tx,
      );
    });
  }
}
