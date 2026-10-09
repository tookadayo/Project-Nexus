import { historySnapshot, filteredHistory } from "./history-projection";
import { featureDecision } from "../../settings/src/billing/domain";
import { EntitlementService } from "../../settings/src/billing/entitlements";
import { SettingsService } from "../../settings/src/index";
import { z } from "zod";
import { sql, tenant, json, type Database } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { Actor } from "../../settings/src/index";
import type { ChartSpec } from "../../analytics/src/chart-spec";
import {
  chartQuerySchema,
  chartComparison,
} from "../../analytics/src/chart-spec";
import { ExploreService } from "../../analytics/src/explore";
import {
  operationsAccess,
  operationsAudit,
  operationsEvent,
  operationsLock,
} from "./policy";
const DAY = 86400000;
export class InterventionReview {
  constructor(private readonly db: Database) {}
  async create(s: Scope, actor: Actor, input: unknown, now = new Date()) {
    const data = z
        .object({
          title: z.string().trim().min(1).max(120),
          query: chartQuerySchema,
          executionId: z.uuid().optional(),
          teamId: z.uuid().optional(),
        })
        .strict()
        .parse(input),
      query = { ...data.query, compare: false },
      baseline = await new ExploreService(this.db).chart(s, query, now),
      afterStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
      ),
      reviewAt = new Date(afterStart.getTime() + query.days * DAY);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "OPERATE", "improvement_tracking");
      if (data.teamId)
        await operationsAccess(tx, s, actor, "OPERATE", "team_assignment");
      await operationsLock(tx, s);
      if (data.executionId) {
        const previous = (
          await sql<{
            id: string;
            review_at: Date;
            state: string;
          }>`SELECT id,review_at,state FROM operations_interventions WHERE ${tenant(s)} AND execution_id=${data.executionId}::uuid`.execute(
            tx,
          )
        ).rows[0];
        if (previous)
          return {
            id: previous.id,
            reviewAt: previous.review_at.toISOString(),
            state: previous.state,
          };
      }
      const row = (
        await sql<{
          id: string;
        }>`INSERT INTO operations_interventions(organization_id,guild_id,title,metric_query,started_at,review_at,baseline,execution_id,assigned_team_id,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${data.title},${json(query)},${now},${reviewAt},${json(baseline)},${data.executionId ?? null}::uuid,${data.teamId ?? null}::uuid,${actor.key}) RETURNING id`.execute(
          tx,
        )
      ).rows[0]!;
      await operationsAudit(
        tx,
        s,
        actor.key,
        "INTERVENTION_RECORDED",
        row.id,
        1,
      );
      return {
        id: row.id,
        reviewAt: reviewAt.toISOString(),
        state: "MEASURING",
      };
    });
  }
  async list(s: Scope, actor: Actor, now = new Date()) {
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ");
      return interventionRows(tx, s, now);
    });
  }
  async tick(s: Scope, now = new Date()) {
    const row = (
      await sql<{
        id: string;
        metric_query: unknown;
        baseline: ChartSpec;
        review_at: Date;
      }>`SELECT id,metric_query,baseline,review_at FROM operations_interventions WHERE ${tenant(s)} AND state='MEASURING' AND review_at<=${now} ORDER BY review_at,id LIMIT 1`.execute(
        this.db,
      )
    ).rows[0];
    if (!row) return false;
    const after = await new ExploreService(this.db).chart(
        s,
        row.metric_query,
        row.review_at,
      ),
      comparison = chartComparison(after.evidence, row.baseline.evidence);
    await this.db.transaction().execute(async (tx) => {
      await operationsAccess(
        tx,
        s,
        {
          key: "system",
          permissions: "8",
          roles: [],
          source: "SYSTEM",
          requestId: "intervention-review",
        },
        "OPERATE",
        "improvement_tracking",
      );
      await operationsLock(tx, s);
      if (
        !(
          await sql`UPDATE operations_interventions SET state='REVIEW_READY' WHERE ${tenant(s)} AND id=${row.id}::uuid AND state='MEASURING' RETURNING id`.execute(
            tx,
          )
        ).rows.length
      )
        return;
      await sql`INSERT INTO operations_intervention_reviews VALUES(${s.organizationId}::uuid,${s.guildId},${row.id}::uuid,${json(after)},${json(comparison)},${now}) ON CONFLICT DO NOTHING`.execute(
        tx,
      );
      await operationsEvent(
        tx,
        s,
        "intervention.review_ready",
        "review:" + row.id,
        {
          interventionId: row.id,
          before: row.baseline.evidence,
          after: after.evidence,
          comparison,
          causalClaim: false,
        },
      );
    });
    return true;
  }
}
export async function interventionRows(
  tx: import("../../db/src/index").Tx,
  s: Scope,
  now = new Date(),
) {
  const state = await new EntitlementService(tx).effective(s, now);
  const settings = await new SettingsService(tx).get(s);
  // Chart windows and retained daily aggregates use closed UTC days. A valid
  // 30-day snapshot must not expire partway through its last authorized day.
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const bounds = (
    await sql<{
      cutoff: Date;
      deleted: Date | null;
    }>`SELECT greatest(${day}::timestamptz-make_interval(months=>${settings.aggregateRetentionMonths}),${day}::timestamptz-make_interval(days=>${state.limits.historyDays ?? 3650})) AS cutoff,(SELECT max(completed_at) FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NOT NULL) AS deleted`.execute(
      tx,
    )
  ).rows[0]!;
  const cutoff = bounds.cutoff;
  const rows = (
    await sql<{
      id: string;
      title: string;
      started_at: Date;
      review_at: Date;
      state: string;
      assigned_team_id: string | null;
      metric_query: unknown;
      baseline: unknown;
      after_snapshot: unknown;
      comparison: unknown;
    }>`SELECT i.metric_query,i.id,i.title,i.started_at,i.review_at,i.state,i.assigned_team_id,i.baseline,r.after_snapshot,r.comparison FROM operations_interventions i LEFT JOIN operations_intervention_reviews r ON r.organization_id=i.organization_id AND r.guild_id=i.guild_id AND r.intervention_id=i.id WHERE i.organization_id=${s.organizationId}::uuid AND i.guild_id=${s.guildId} ORDER BY i.started_at DESC LIMIT 100`.execute(
      tx,
    )
  ).rows;
  return rows.flatMap((row) => {
    const query = chartQuerySchema.safeParse(row.metric_query);
    if (
      state.privacyDeleted ||
      row.started_at < cutoff ||
      (bounds.deleted !== null && row.started_at <= bounds.deleted) ||
      !query.success ||
      (filteredHistory(query.data.filter) &&
        !featureDecision(state, "surface_breakdowns").allowed)
    )
      return [];
    const baseline = historySnapshot(row.baseline, state, cutoff);
    const after =
      row.after_snapshot === null
        ? null
        : historySnapshot(row.after_snapshot, state, cutoff);
    if (!baseline || (row.after_snapshot !== null && !after)) return [];
    // Recompute only the comparison of two fully permitted evidence summaries.
    const comparison =
      after && featureDecision(state, "comparable_periods").allowed
        ? chartComparison(after.evidence, baseline.evidence)
        : null;
    return [
      {
        id: row.id,
        title: row.title,
        started_at: row.started_at,
        review_at: row.review_at,
        state: row.state,
        assigned_team_id: row.assigned_team_id,
        baseline,
        after_snapshot: after,
        comparison,
      },
    ];
  });
}
