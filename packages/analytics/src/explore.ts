import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  sql,
  tenant,
  json,
  privacyReadLock,
  type Database,
  type Tx,
} from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import { SettingsService, type Actor } from "../../settings/src/index";
import { EntitlementService } from "../../settings/src/billing/entitlements";
import { latestCapability } from "../../lifecycle/src/discovery";
import { operationsAccess } from "../../operations/src/policy";
import {
  buildMetricEvidence,
  evidenceContext,
  evidenceWindow,
  type EvidenceContext,
} from "./evidence";
import {
  chartMetrics,
  chartQuerySchema,
  operationalFilterSchema,
  chartComparison,
  type ChartQuery,
  type ChartSpec,
} from "./chart-spec";

const DAY = 86400000;
export const savedViewSchema = chartQuerySchema
  .extend({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(80),
    revision: z.number().int().positive().optional(),
    shortcut: z
      .enum(["support-health", "newcomer-flow"])
      .nullable()
      .default(null),
  })
  .strict();
type Aggregate = {
  bucket: string;
  period: "CURRENT" | "PREVIOUS";
  channel_id: string;
  value: string;
  revision: string;
  legacy_reply: boolean;
  unknown_cohort: boolean;
  unknown_surface: boolean;
};
export class ExploreService {
  constructor(private readonly db: Database) {}
  async chart(
    s: Scope,
    input: unknown,
    now = new Date(),
    fence?: (tx: Tx) => Promise<unknown>,
  ): Promise<ChartSpec> {
    const query = chartQuerySchema.parse(input);
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      if (fence) await fence(tx);
      const entitlements = new EntitlementService(tx),
        state = await entitlements.effective(s, now);
      assert(!state.privacyDeleted, "PRIVACY_DELETED", 403);
      assert(
        state.limits.historyDays === null ||
          query.days * (query.compare ? 2 : 1) <= state.limits.historyDays,
        "HISTORY_PLAN_LIMIT",
        403,
      );
      const filtered =
        query.filter.channelIds.length ||
        query.filter.categoryIds.length ||
        query.filter.roleIds.length ||
        query.filter.surface !== "ALL" ||
        query.filter.recipeVersionId;
      if (filtered) await entitlements.require(s, "surface_breakdowns");
      if (query.compare) await entitlements.require(s, "comparable_periods");
      const cfg = await new SettingsService(tx).get(s),
        descriptor = chartMetrics[query.metric];
      // Closed UTC days remain lossless after raw-event retention. Live snapshots
      // stay separate; all renderers compare the same complete calendar periods.
      const end = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        ),
        from = new Date(end.getTime() - query.days * DAY),
        start = query.compare
          ? new Date(from.getTime() - query.days * DAY)
          : from;
      const context = await evidenceContext(tx, s, start, end),
        snapshot = await latestCapability(tx, s);
      for (const id of query.filter.channelIds)
        assert(
          snapshot?.channels.some(
            (channel) => channel.id === id && channel.observable,
          ),
          "FILTER_TARGET_NOT_OBSERVABLE",
          403,
        );
      if (query.filter.recipeVersionId)
        assert(
          (
            await sql`SELECT id FROM measurement_recipe_versions WHERE ${tenant(s)} AND id=${query.filter.recipeVersionId}::uuid`.execute(
              tx,
            )
          ).rows.length,
          "RECIPE_NOT_FOUND",
          404,
        );
      const firstFull = start,
        lastFull = end;
      // Interior days use existing lossless observation counts; edges use exact raw
      // timestamps. The two sources never overlap. No person rows leave this query.
      const source = (raw = false) => sql`WITH observations AS (
    SELECT episode_id,kind,channel_key AS channel_id,(day::timestamp AT TIME ZONE 'UTC') AS at,observations AS n,recipe_key AS recipe_id,last_id::text AS revision,definition_version AS observation_definition FROM lifecycle_daily_rollups WHERE ${tenant(s)} AND NOT ${raw} AND day>=${firstFull.toISOString().slice(0, 10)}::date AND day<${lastFull.toISOString().slice(0, 10)}::date AND kind=${descriptor.kind}
    UNION ALL SELECT episode_id,kind,COALESCE(data->>'channelId',''),occurred_at,1,COALESCE(recipe_version_id::text,''),id::text,definition_version FROM lifecycle_events WHERE ${tenant(s)} AND context='PRODUCTION' AND kind=${descriptor.kind} AND occurred_at>=${start} AND occurred_at<${end} AND (${raw} OR occurred_at<${firstFull} OR occurred_at>=${lastFull})
   ), eligible AS (
    SELECT o.*,member_state.roles_observed_at,COALESCE(parent.channel_id,ch.channel_id,o.channel_id) AS surface_channel,COALESCE(parent.parent_id,ch.parent_id) AS category_id,COALESCE(parent.channel_type,ch.channel_type) AS channel_type
    FROM observations o JOIN membership_episodes e ON e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.id=o.episode_id
    LEFT JOIN member_observable_state member_state ON member_state.organization_id=e.organization_id AND member_state.guild_id=e.guild_id AND member_state.episode_id=e.id
    LEFT JOIN discord_surface_state ch ON ch.organization_id=e.organization_id AND ch.guild_id=e.guild_id AND ch.channel_id=o.channel_id
    LEFT JOIN discord_surface_state parent ON parent.organization_id=ch.organization_id AND parent.guild_id=ch.guild_id AND parent.channel_id=ch.parent_id AND ch.channel_type IN (10,11,12)
    WHERE e.context='PRODUCTION' AND e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND NOT e.screening_pending AND NOT e.is_guest
     AND (${query.filter.roleIds.length === 0} OR member_state.roles&&${query.filter.roleIds}::text[] OR member_state.roles_observed_at IS NULL)
     AND (${!query.filter.recipeVersionId} OR o.recipe_id=${query.filter.recipeVersionId ?? ""})
   ), scoped AS (SELECT * FROM eligible WHERE
    (${cfg.analysisScope.mode === "all"} OR channel_id='' OR (${cfg.analysisScope.mode === "include"})=(surface_channel=ANY(${cfg.analysisScope.channelIds}::text[])))
    AND (${query.filter.channelIds.length === 0} OR surface_channel=ANY(${query.filter.channelIds}::text[]) OR channel_id=ANY(${query.filter.channelIds}::text[]))
    AND (${query.filter.categoryIds.length === 0} OR category_id=ANY(${query.filter.categoryIds}::text[]) OR channel_type IS NULL)
    AND (${query.metric !== "forum"} OR channel_type=15 OR channel_type IS NULL)
    AND (${query.filter.surface === "ALL"} OR channel_type IS NULL OR (${query.filter.surface === "TEXT"} AND channel_type IN (0,5)) OR (${query.filter.surface === "FORUM"} AND channel_type=15) OR (${query.filter.surface === "VOICE"} AND channel_type IN (2,13)) OR (${query.filter.surface === "EVENT"} AND kind LIKE 'scheduled_event.%'))
   )`;
      const rows = (
        await sql<Aggregate>`${source()} SELECT to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD') AS bucket,CASE WHEN at>=${from} THEN 'CURRENT' ELSE 'PREVIOUS' END AS period,surface_channel AS channel_id,sum(n)::text AS value,md5(string_agg(revision,',' ORDER BY revision)) AS revision,bool_or(kind='reply.received' AND observation_definition<>'observation-v3') AS legacy_reply,bool_or(${query.filter.roleIds.length > 0} AND roles_observed_at IS NULL) AS unknown_cohort,bool_or(channel_id<>'' AND channel_type IS NULL AND (${query.metric === "forum"} OR ${query.filter.surface !== "ALL"} OR ${query.filter.categoryIds.length > 0})) AS unknown_surface FROM scoped GROUP BY bucket,period,surface_channel ORDER BY bucket,period,surface_channel`.execute(
          tx,
        )
      ).rows;
      const proof = (
        value: number,
        a: Date,
        b: Date,
        ctx: EvidenceContext = context,
      ) => {
        const relevant = rows.filter(
            (row) =>
              row.bucket >= a.toISOString().slice(0, 10) &&
              row.bucket < b.toISOString().slice(0, 10),
          ),
          semanticsReasons = [
            ...(relevant.some((row) => row.legacy_reply)
              ? ["LEGACY_REPLY_SEMANTICS_UNKNOWN"]
              : []),
            ...(relevant.some((row) => row.unknown_cohort)
              ? ["ROLE_COHORT_UNOBSERVED"]
              : []),
            ...(relevant.some((row) => row.unknown_surface)
              ? ["HISTORICAL_SURFACE_UNOBSERVED"]
              : []),
          ];
        return buildMetricEvidence(
          "aggregate." + query.metric,
          {
            value,
            numerator: value,
            denominator: null,
            sample: value,
            minimumSample: 0,
            definition:
              descriptor.title +
              "; count of projected observations in the window",
            definitionVersion: "aggregate-signal-v1",
            requiredSurfaces: [...descriptor.surfaces],
            semanticsKnown: !semanticsReasons.length,
            semanticsReasons,
          },
          snapshot,
          cfg,
          evidenceWindow(ctx, a, b),
        );
      };
      const series = (a: Date, b: Date, period: "CURRENT" | "PREVIOUS") => {
        const points = [];
        for (
          let at = new Date(
            Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()),
          );
          at < b;
          at = new Date(at.getTime() + DAY)
        ) {
          const key = at.toISOString().slice(0, 10),
            lo = new Date(Math.max(a.getTime(), at.getTime())),
            hi = new Date(Math.min(b.getTime(), at.getTime() + DAY));
          // A partial UTC bucket at the comparison boundary needs exact splitting.
          const count = rows
            .filter((row) => row.bucket === key && row.period === period)
            .reduce((n, row) => n + Number(row.value), 0);
          const evidence = proof(count, lo, hi);
          points.push({
            bucket: lo.toISOString(),
            value: evidence.value,
            evidence,
          });
        }
        return points;
      };
      const currentRows = rows.filter((row) => row.period === "CURRENT"),
        currentTotal = currentRows.reduce((n, r) => n + Number(r.value), 0),
        evidence = proof(currentTotal, from, end);
      const spec: ChartSpec = {
        version: 1,
        metric: query.metric,
        title: descriptor.title,
        unit: "observations",
        range: {
          from: from.toISOString(),
          to: end.toISOString(),
          days: query.days,
          timezone: query.timezone,
        },
        filter: query.filter,
        series: [{ key: "CURRENT", points: series(from, end, "CURRENT") }],
        evidence,
        top: [],
        heatmap: [],
        recipeRevision: context.recipe?.id ?? null,
        dataRevision: createHash("sha256")
          .update(JSON.stringify(rows))
          .digest("hex"),
        cacheKey: "",
        caveats: [
          "Observed events are not individual activity scores.",
          "Charts use closed UTC days; heatmaps use the selected timezone.",
          "Role filters use the current observed role cohort.",
          "Changes describe observations, not their cause.",
        ],
      };
      if (query.compare) {
        const previous = proof(
          rows
            .filter((row) => row.period === "PREVIOUS")
            .reduce((n, r) => n + Number(r.value), 0),
          start,
          from,
        );
        spec.series.push({
          key: "PREVIOUS",
          points: series(start, from, "PREVIOUS"),
        });
        spec.comparison = chartComparison(evidence, previous);
      }
      if (await entitlements.can(s, "surface_breakdowns")) {
        const totals = new Map<string, number>();
        for (const row of currentRows)
          if (row.channel_id)
            totals.set(
              row.channel_id,
              (totals.get(row.channel_id) ?? 0) + Number(row.value),
            );
        spec.top = [...totals]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 10)
          .map(([channelId, value]) => ({
            channelId,
            value: evidence.value === null ? null : value,
          }));
        spec.breakdowns = (
          query.filter.channelIds.length
            ? query.filter.channelIds
            : spec.top.map((row) => row.channelId)
        ).map((channelId) => {
          const selected = currentRows.filter(
              (row) => row.channel_id === channelId,
            ),
            total = selected.reduce((n, row) => n + Number(row.value), 0);
          return {
            channelId,
            evidence: proof(total, from, end),
            points: spec.series[0]!.points.map((point) => {
              const at = new Date(point.bucket),
                value = selected
                  .filter((row) => row.bucket === point.bucket.slice(0, 10))
                  .reduce((n, row) => n + Number(row.value), 0),
                evidence = proof(value, at, new Date(at.getTime() + DAY));
              return { bucket: point.bucket, value: evidence.value, evidence };
            }),
          };
        });
        const hourly = (
          await sql<{
            weekday: number;
            hour: number;
            value: string;
          }>`${source(true)} SELECT extract(dow FROM at AT TIME ZONE ${query.timezone})::integer AS weekday,extract(hour FROM at AT TIME ZONE ${query.timezone})::integer AS hour,sum(n)::text AS value FROM scoped WHERE at>=${from} GROUP BY weekday,hour`.execute(
            tx,
          )
        ).rows;
        const heatmapComplete =
          query.days <= cfg.detailedRetentionDays &&
          evidence.coverageState === "COMPLETE";
        spec.heatmap = Array.from({ length: 168 }, (_, i) => {
          const weekday = Math.floor(i / 24),
            hour = i % 24,
            row = hourly.find((r) => r.weekday === weekday && r.hour === hour);
          return {
            weekday,
            hour,
            value:
              evidence.value === null
                ? null
                : row
                  ? Number(row.value)
                  : heatmapComplete
                    ? 0
                    : null,
          };
        });
        if (!heatmapComplete)
          spec.caveats.push(
            "Heatmap detail is partial or unavailable outside retained raw observations; missing cells are not zero.",
          );
      }
      spec.cacheKey = createHash("sha256")
        .update(
          JSON.stringify([
            s,
            query,
            cfg.revision,
            spec.range,
            spec.recipeRevision,
            spec.dataRevision,
            spec.evidence,
          ]),
        )
        .digest("hex");
      return spec;
    });
  }
  async save(s: Scope, actor: Actor, input: unknown) {
    const view = savedViewSchema.parse(input);
    return this.db.transaction().execute(async (tx) => {
      await this.writeAccess(tx, s, actor);
      const id = view.id ?? randomUUID();
      const previous = (
        await sql<{
          segment_id: string;
          revision: number;
        }>`SELECT segment_id,revision FROM saved_metric_views WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(!view.id || previous, "SAVED_VIEW_NOT_FOUND", 404);
      assert(
        !previous || previous.revision === view.revision,
        "REVISION_CONFLICT",
        409,
      );
      const segment = previous?.segment_id ?? randomUUID();
      await sql`INSERT INTO operational_segments(organization_id,guild_id,id,name,filters,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${segment}::uuid,${"view:" + id},${json(view.filter)},${actor.key}) ON CONFLICT(organization_id,guild_id,id) DO UPDATE SET filters=EXCLUDED.filters,revision=operational_segments.revision+1,updated_at=now(),actor_hash=EXCLUDED.actor_hash`.execute(
        tx,
      );
      await sql`INSERT INTO saved_metric_views(organization_id,guild_id,id,name,metric_key,range_days,timezone,comparison,segment_id,shortcut,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${view.name},${view.metric},${view.days},${view.timezone},${view.compare},${segment}::uuid,${view.shortcut},${actor.key}) ON CONFLICT(organization_id,guild_id,id) DO UPDATE SET name=EXCLUDED.name,metric_key=EXCLUDED.metric_key,range_days=EXCLUDED.range_days,timezone=EXCLUDED.timezone,comparison=EXCLUDED.comparison,shortcut=EXCLUDED.shortcut,actor_hash=EXCLUDED.actor_hash,revision=saved_metric_views.revision+1,updated_at=now()`.execute(
        tx,
      );
      return { id, revision: (previous?.revision ?? 0) + 1 };
    });
  }
  async list(s: Scope) {
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      await new EntitlementService(tx).require(s, "surface_breakdowns");
      return (
        await sql<{
          id: string;
          name: string;
          metric_key: ChartQuery["metric"];
          range_days: ChartQuery["days"];
          timezone: string;
          comparison: boolean;
          filters: unknown;
          revision: number;
          shortcut: string | null;
        }>`SELECT v.id,v.name,v.metric_key,v.range_days,v.timezone,v.comparison,g.filters,v.revision,v.shortcut FROM saved_metric_views v JOIN operational_segments g ON g.organization_id=v.organization_id AND g.guild_id=v.guild_id AND g.id=v.segment_id WHERE v.organization_id=${s.organizationId}::uuid AND v.guild_id=${s.guildId} ORDER BY v.name,v.id LIMIT 100`.execute(
          tx,
        )
      ).rows.map((row) => ({
        id: row.id,
        name: row.name,
        revision: row.revision,
        shortcut: row.shortcut,
        metric: row.metric_key,
        days: row.range_days,
        timezone: row.timezone,
        compare: row.comparison,
        filter: operationalFilterSchema.parse(row.filters),
      }));
    });
  }
  async segments(s: Scope) {
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      await new EntitlementService(tx).require(s, "surface_breakdowns");
      return (
        await sql<{
          id: string;
          name: string;
          filters: unknown;
          revision: number;
        }>`SELECT id,name,filters,revision FROM operational_segments WHERE ${tenant(s)} AND name NOT LIKE 'view:%' ORDER BY name,id LIMIT 100`.execute(
          tx,
        )
      ).rows.map((row) => ({
        ...row,
        filters: operationalFilterSchema.parse(row.filters),
      }));
    });
  }
  async saveSegment(s: Scope, actor: Actor, input: unknown) {
    const segment = z
      .object({
        id: z.uuid().optional(),
        name: z
          .string()
          .trim()
          .min(1)
          .max(80)
          .refine((v) => !v.startsWith("view:")),
        revision: z.number().int().positive().optional(),
        filters: operationalFilterSchema,
      })
      .strict()
      .parse(input);
    return this.db.transaction().execute(async (tx) => {
      await this.writeAccess(tx, s, actor);
      const id = segment.id ?? randomUUID(),
        previous = (
          await sql<{
            revision: number;
          }>`SELECT revision FROM operational_segments WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
      assert(!segment.id || previous, "SEGMENT_NOT_FOUND", 404);
      assert(
        !previous || previous.revision === segment.revision,
        "REVISION_CONFLICT",
        409,
      );
      await sql`INSERT INTO operational_segments(organization_id,guild_id,id,name,filters,actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${segment.name},${json(segment.filters)},${actor.key}) ON CONFLICT(organization_id,guild_id,id) DO UPDATE SET name=EXCLUDED.name,filters=EXCLUDED.filters,actor_hash=EXCLUDED.actor_hash,revision=operational_segments.revision+1,updated_at=now()`.execute(
        tx,
      );
      return { id, revision: (previous?.revision ?? 0) + 1 };
    });
  }
  async saved(s: Scope, idOrShortcut: string, now = new Date()) {
    const view = (await this.list(s)).find(
      (v) => v.id === idOrShortcut || v.shortcut === idOrShortcut,
    );
    assert(view, "SAVED_VIEW_NOT_FOUND", 404);
    return this.chart(s, viewToQuery(view), now);
  }
  private async writeAccess(tx: Tx, s: Scope, actor: Actor) {
    await operationsAccess(tx, s, actor, "ANALYZE", "surface_breakdowns");
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"explore:" + s.organizationId + ":" + s.guildId},0))`.execute(
      tx,
    );
  }
}
export function viewToQuery(view: ChartQuery): ChartQuery {
  return {
    metric: view.metric,
    days: view.days,
    compare: view.compare,
    timezone: view.timezone,
    filter: view.filter,
  };
}
