import { randomUUID } from "node:crypto";
import { logFailure } from "../../shared/src/diagnostics";
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
import { currentRecipe } from "../../settings/src/recipes";
import { EntitlementService } from "../../settings/src/billing/entitlements";
import {
  operationsAccess,
  operationsAudit,
  actorPermissions,
} from "../../operations/src/policy";
import {
  compareAnalyses,
  metricComparisonReasons,
  observedChanges,
  type ComparisonRun,
} from "./comparison";
import type { InternalBillingActor } from "../../security/src/billing-authorization";
import { AttentionOperations } from "../../operations/src/attention";
import type { MetricEvidence } from "../../shared/src/metric-evidence";
import { analysisMetrics } from "../../analytics/src/analysis";
import {
  analysisRequest,
  analysisTypes,
  analysisRecipeVersion,
  completedWindow,
  fingerprint,
  failureClass,
  type AnalysisRequest,
  type AnalysisRun,
  type AnalysisResult,
  type Availability,
  type AnalysisFailure,
} from "./domain";
import { analysisPolicy } from "./policy";
import { analysisEvent, analysisTiming } from "./telemetry";
import { analysisChannelScope } from "../../lifecycle/src/discovery";
import {
  analysisDataIdentity,
  confirmationIdentity,
  meaningfulSettings,
} from "./identity";
export * from "./domain";
export * from "./policy";
export * from "./comparison";
function inputIdentity(
  s: Scope,
  type: string,
  from: Date,
  to: Date,
  scope: string,
  recipe: string,
  data: string,
  result: AnalysisResult,
) {
  return fingerprint([
    s.organizationId,
    s.guildId,
    type,
    from.toISOString(),
    to.toISOString(),
    scope,
    recipe,
    data,
    result.metrics.map((m) => [m.key, m.quality, m.evidence.coverageReasons]),
  ]);
}
const liveStates = ["PREPARING", "RUNNING", "FINALIZING"];
export async function analysisLock(tx: Tx, s: Scope) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"analysis:" + s.organizationId + ":" + s.guildId},0))`.execute(
    tx,
  );
}
async function revision(tx: Tx, s: Scope) {
  return (
    (
      await sql<{
        revision: string;
      }>`SELECT revision::text FROM analysis_input_revisions WHERE ${tenant(s)}`.execute(
        tx,
      )
    ).rows[0]?.revision ?? "0"
  );
}
async function included(
  tx: Tx,
  s: Scope,
  quantity: number | null,
  at = new Date(),
) {
  if (!quantity) return;
  const month = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)),
    expires = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  await sql`INSERT INTO analysis_grants(id,organization_id,guild_id,source,source_identity,quantity,expires_at) VALUES(${randomUUID()}::uuid,${s.organizationId}::uuid,${s.guildId},'PLAN_INCLUDED',${month.toISOString().slice(0, 10)},${quantity},${expires}) ON CONFLICT(organization_id,guild_id,source,source_identity) DO UPDATE SET quantity=GREATEST(analysis_grants.quantity,EXCLUDED.quantity) WHERE analysis_grants.quantity<EXCLUDED.quantity`.execute(
    tx,
  );
}
export async function analysisUsage(tx: Tx, s: Scope) {
  const state = await new EntitlementService(tx).effective(s);
  assert(!state.privacyDeleted, "PRIVACY_DELETED", 403);
  await analysisLock(tx, s);
  await included(tx, s, state.limits.analysisRunsMonthly);
  const row = (
    await sql<{
      remaining: number;
      reserved: number;
      consumed: number;
    }>`SELECT COALESCE(sum(quantity-reserved-consumed),0)::int AS remaining,COALESCE(sum(reserved),0)::int AS reserved,COALESCE(sum(consumed),0)::int AS consumed FROM analysis_grants WHERE ${tenant(s)} AND source<>'BUG_CORRECTION' AND (expires_at IS NULL OR expires_at>now())`.execute(
      tx,
    )
  ).rows[0]!;
  return row;
}
function resolvedScopeIdentity(
  cfg: Awaited<ReturnType<SettingsService["get"]>>,
  resolved: Awaited<ReturnType<typeof analysisChannelScope>>,
) {
  return fingerprint([
    meaningfulSettings(cfg),
    {
      mode: cfg.analysisScope.mode,
      channelIds: [...cfg.analysisScope.channelIds].sort(),
      excludedChannelIds: [
        ...(cfg.analysisScope.excludedChannelIds ?? []),
      ].sort(),
    },
    resolved.selectedChannelIds
      .map((id) => {
        const c = resolved.resolutions.find((c) => c.actualChannelId === id);
        return [
          id,
          c?.channelType,
          c?.effectivePurpose,
          c?.collectionEligibility,
        ];
      })
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
}
async function validateRunConditions(
  tx: Tx,
  s: Scope,
  run: AnalysisRun,
  cfg: Awaited<ReturnType<SettingsService["get"]>>,
) {
  const resolved = await analysisChannelScope(tx, s, cfg),
    recipe = await currentRecipe(tx, s);
  const version = analysisRecipeVersion + ":" + (recipe?.id ?? "default");
  assert(
    cfg.enabled &&
      version === run.recipe_version &&
      (run.confirmation_fingerprint
        ? confirmationIdentity(
            s,
            {
              type: run.analysis_type,
              days: run.period_days as 7 | 30 | 90,
              ...(run.correction_of ? { correctionOf: run.correction_of } : {}),
            },
            { start: run.period_start, end: run.period_end },
            resolvedScopeIdentity(cfg, resolved),
            version,
            cfg,
          ) === run.confirmation_fingerprint
        : cfg.revision === run.config_revision),
    "ANALYSIS_CONFIGURATION_CHANGED",
    409,
  );
  return resolved;
}
async function availableStoredTargets(tx: Tx, s: Scope) {
  const cfg = await new SettingsService(tx).get(s),
    resolved = await analysisChannelScope(tx, s, cfg);
  return resolved.resolutions
    .filter((c) => c.collectionEligibility === "ELIGIBLE")
    .map((c) => c.actualChannelId);
}
async function storedRun(tx: Tx, s: Scope, id: string, historyDays: number) {
  const run = (
    await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE ${tenant(s)} AND id=${id}::uuid AND retention_until>now() AND requested_at>=now()-make_interval(days=>${historyDays})`.execute(
      tx,
    )
  ).rows[0];
  assert(run, "ANALYSIS_NOT_FOUND", 404);
  assert(!run.invalidated_at, "ANALYSIS_DATA_REMOVED", 410);
  const available = new Set(await availableStoredTargets(tx, s));
  assert(
    (run.target_channel_ids ?? []).every((id) => available.has(id)),
    "ANALYSIS_TARGET_UNAVAILABLE",
    403,
  );
  return run;
}
async function visibleStoredResult(
  tx: Tx,
  s: Scope,
  result: AnalysisResult | null,
  historyDays: number,
) {
  if (!result?.baseline) return result;
  const targets = await availableStoredTargets(tx, s);
  const visible = (
    await sql`SELECT id FROM analysis_runs WHERE ${tenant(s)} AND id=${result.baseline.runId}::uuid AND invalidated_at IS NULL AND retention_until>now() AND requested_at>=now()-make_interval(days=>${historyDays}) AND target_channel_ids<@${targets}::text[]`.execute(
      tx,
    )
  ).rows.length;
  if (visible) return result;
  const copy = structuredClone(result);
  delete copy.baseline;
  return copy;
}
async function comparisonResult(
  tx: Tx,
  s: Scope,
  run: AnalysisRun,
  result: AnalysisResult,
  historyDays: number,
) {
  const compatible = result.metrics
    .filter((m) => !metricComparisonReasons(m).length)
    .map((m) => ({
      key: m.key,
      definitionVersion: m.evidence.definitionVersion,
      unit: m.unit,
      windowStart: m.evidence.windowStart,
      windowEnd: m.evidence.windowEnd,
      windowKind: m.evidence.windowKind ?? "",
    }));
  if (!compatible.length) return null;
  const targets = await availableStoredTargets(tx, s);
  return (
    (
      await sql<
        ComparisonRun & {
          run_id: string;
          result: AnalysisResult;
        }
      >`SELECT a.id,a.analysis_type,a.period_start,a.period_end,a.period_days,a.recipe_version,a.scope_identity,r.run_id,r.result FROM analysis_runs a JOIN analysis_results r ON r.run_id=a.id AND r.organization_id=a.organization_id AND r.guild_id=a.guild_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.status='COMPLETED' AND a.invalidated_at IS NULL AND a.id<>${run.id}::uuid AND a.period_end<=${run.period_start} AND a.analysis_type=${run.analysis_type} AND a.recipe_version=${run.recipe_version} AND a.scope_identity=${run.scope_identity} AND a.period_days=${run.period_days} AND a.period_end-a.period_start=${run.period_end}::timestamptz-${run.period_start}::timestamptz AND a.retention_until>now() AND a.target_channel_ids<@${targets}::text[] AND a.requested_at>=now()-make_interval(days=>${historyDays}) AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.result->'metrics') m JOIN jsonb_array_elements(${json(compatible)}) c ON m->>'key'=c->>'key' AND m->'evidence'->>'definitionVersion'=c->>'definitionVersion' AND m->>'unit'=c->>'unit' WHERE r.result->'schemaVersion'=${json(result.schemaVersion)} AND m->'evidence'->>'comparable'='true' AND m->'evidence'->'comparisonBlockers'='[]'::jsonb AND m->'evidence'->>'observationState'='OBSERVED' AND m->'evidence'->>'coverageState'='COMPLETE' AND jsonb_array_length(m->'evidence'->'collectionEpochIds')>0 AND jsonb_typeof(m->'evidence'->'value')='number' AND COALESCE(m->'evidence'->>'windowKind','')=c->>'windowKind' AND (m->'evidence'->>'windowEnd')::timestamptz>(m->'evidence'->>'windowStart')::timestamptz AND (m->'evidence'->>'windowEnd')::timestamptz-(m->'evidence'->>'windowStart')::timestamptz=(c->>'windowEnd')::timestamptz-(c->>'windowStart')::timestamptz AND (m->'evidence'->>'windowEnd')::timestamptz<=(c->>'windowStart')::timestamptz) ORDER BY a.period_end DESC,a.requested_at DESC,a.id DESC LIMIT 1`.execute(
        tx,
      )
    ).rows[0] ?? null
  );
}
async function prepare(tx: Tx, s: Scope, input: AnalysisRequest) {
  const cfg = await new SettingsService(tx).get(s),
    state = await new EntitlementService(tx).effective(s),
    recipe = await currentRecipe(tx, s),
    window = input.periodStart
      ? { start: new Date(input.periodStart), end: new Date(input.periodEnd!) }
      : completedWindow(input.days);
  assert(
    window.end <= new Date() &&
      window.end.getUTCHours() === 0 &&
      window.end.getUTCMinutes() === 0 &&
      window.end.getUTCSeconds() === 0 &&
      window.end.getUTCMilliseconds() === 0,
    "INVALID_ANALYSIS_WINDOW",
    400,
  );
  assert(!state.privacyDeleted, "PRIVACY_DELETED", 403);
  if (input.correctionOf) {
    const original = (
      await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE ${tenant(s)} AND id=${input.correctionOf}::uuid AND status='COMPLETED' AND invalidated_at IS NULL AND retention_until>now() AND requested_at>=now()-make_interval(days=>${state.limits.historyDays ?? 3650}) AND scope_bug_impact='POSSIBLE_CATEGORY_PARENT' AND recipe_version LIKE 'analysis-observation-v1:%' AND EXISTS(SELECT 1 FROM analysis_usage_ledger l WHERE l.run_id=analysis_runs.id AND l.outcome='CONSUMED')`.execute(
        tx,
      )
    ).rows[0];
    assert(
      original &&
        original.analysis_type === input.type &&
        original.period_days === input.days &&
        original.period_start.getTime() === window.start.getTime() &&
        original.period_end.getTime() === window.end.getTime(),
      "ANALYSIS_CORRECTION_INVALID",
      409,
    );
  }
  const withinHistory =
    state.limits.historyDays === null || input.days <= state.limits.historyDays;
  const resolved = await analysisChannelScope(tx, s, cfg);
  const scopeIdentity = resolvedScopeIdentity(cfg, resolved);
  const recipeVersion = analysisRecipeVersion + ":" + (recipe?.id ?? "default");
  const dataRevision = await revision(tx, s);
  const dataIdentity = await analysisDataIdentity(
    tx,
    s,
    input,
    window,
    resolved.actualChannelIds,
  );
  const confirmationFingerprint = confirmationIdentity(
    s,
    input,
    window,
    scopeIdentity,
    recipeVersion,
    cfg,
  );
  const result = await analysisMetrics(
    tx,
    s,
    cfg,
    input.type,
    window.start,
    window.end,
    scopeIdentity,
    input.days,
    true,
  );
  result.comparisonMetadata.recipeVersion = recipeVersion;
  let availability: Availability =
    result.dataQuality === "NO_DATA"
      ? "INSUFFICIENT_DATA"
      : result.dataQuality === "COMPLETE"
        ? "AVAILABLE"
        : "PARTIAL";
  if (!cfg.enabled || !withinHistory) availability = "UNAVAILABLE";
  if (
    input.type === "SUPPORT" &&
    (!cfg.communityModel.confirmed ||
      !resolved.resolutions.some(
        (c) =>
          c.selected && ["SUPPORT", "BUG_REPORT"].includes(c.effectivePurpose),
      ))
  )
    availability = "REQUIRES_SETUP";
  if (
    input.type === "VOICE" &&
    !cfg.communityModel.modes.some((m) => m === "VOICE" || m === "LFG_PLAY") &&
    !resolved.resolutions.some(
      (c) => c.selected && [2, 13].includes(c.channelType ?? -1),
    )
  )
    availability = "REQUIRES_SETUP";
  if (
    (input.type === "ANNOUNCEMENTS" || input.type === "SHOWCASE") &&
    (!cfg.communityModel.confirmed ||
      !resolved.resolutions.some(
        (c) =>
          c.selected &&
          c.effectivePurpose ===
            (input.type === "ANNOUNCEMENTS" ? "ANNOUNCEMENT" : "SHOWCASE"),
      ))
  )
    availability = "REQUIRES_SETUP";
  return {
    cfg,
    state,
    window,
    scopeIdentity,
    recipeVersion,
    dataRevision,
    dataIdentity,
    confirmationFingerprint,
    targetChannelIds: resolved.actualChannelIds,
    conditions: {
      kind: input.type,
      ...(input.correctionOf
        ? {
            correctionOf: input.correctionOf,
            correctionReason: "CATEGORY_PARENT_RESOLUTION",
          }
        : {}),
      periodStart: window.start.toISOString(),
      periodEnd: window.end.toISOString(),
      settings: meaningfulSettings(cfg),
      places: resolved.resolutions
        .filter((c) => resolved.selectedChannelIds.includes(c.actualChannelId))
        .map((c) => ({
          id: c.actualChannelId,
          purpose: c.effectivePurpose,
          parentChannelId: c.parentChannelId,
          categoryId: c.categoryId,
          type: c.channelType,
        })),
    },
    result,
    availability,
    fingerprint: inputIdentity(
      s,
      input.type,
      window.start,
      window.end,
      scopeIdentity,
      recipeVersion,
      dataIdentity,
      result,
    ),
  };
}
export class AnalysisService {
  constructor(private readonly db: Database) {}
  async menu(s: Scope, actor: Actor, days: 7 | 30 | 90 = 30) {
    return this.db
      .transaction()
      .setIsolationLevel("repeatable read")
      .execute(async (tx) => {
        await operationsAccess(tx, s, actor, "READ");
        const usage = await analysisUsage(tx, s),
          items = [];
        for (const type of analysisTypes) {
          const p = await prepare(tx, s, { type, days });
          items.push({ type, availability: p.availability });
        }
        return { items, usage, days };
      });
  }
  async preview(s: Scope, actor: Actor, input: unknown) {
    const data = analysisRequest.parse(input);
    await this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ");
      await sql`DELETE FROM analysis_preview_limits WHERE minute<now()-interval '2 minutes'`.execute(
        tx,
      );
      const admitted = (
        await sql`INSERT INTO analysis_preview_limits(organization_id,guild_id,actor_hash,minute,requests) VALUES(${s.organizationId}::uuid,${s.guildId},${actor.key},date_trunc('minute',now()),1) ON CONFLICT(organization_id,guild_id,actor_hash,minute) DO UPDATE SET requests=analysis_preview_limits.requests+1 WHERE analysis_preview_limits.requests<${analysisPolicy.previewRequestsPerMinute} RETURNING requests`.execute(
          tx,
        )
      ).rows.length;
      assert(admitted, "ANALYSIS_PREVIEW_BUSY", 429);
    });
    return this.db
      .transaction()
      .setIsolationLevel("repeatable read")
      .execute(async (tx) => {
        await operationsAccess(tx, s, actor, "READ");
        const usage = await analysisUsage(tx, s),
          p = await prepare(tx, s, data);
        const duplicate =
          (
            await sql<{
              id: string;
              status: AnalysisRun["status"];
            }>`SELECT id,status FROM analysis_runs WHERE ${tenant(s)} AND input_fingerprint=${p.fingerprint} AND recipe_version=${p.recipeVersion} AND invalidated_at IS NULL AND status IN ('QUEUED','PREPARING','RUNNING','FINALIZING','COMPLETED') AND retention_until>now() ORDER BY requested_at DESC LIMIT 1`.execute(
              tx,
            )
          ).rows[0] ?? null;
        return {
          request: {
            ...data,
            periodStart: p.window.start.toISOString(),
            periodEnd: p.window.end.toISOString(),
          },
          scope: p.cfg.analysisScope,
          targetChannelCount: p.targetChannelIds.length,
          availability: p.availability,
          quality: p.result.dataQuality,
          metrics: p.result.metrics,
          periodStart: p.window.start,
          periodEnd: p.window.end,
          usage,
          duplicate,
          configRevision: p.cfg.revision,
          inputFingerprint: p.confirmationFingerprint,
          estimate: null,
          consumeCount: data.correctionOf ? (0 as const) : (1 as const),
          correctionOf: data.correctionOf ?? null,
        };
      });
  }
  async request(
    s: Scope,
    actor: Actor,
    input: unknown,
    key: string,
    expected?: { revision: number; fingerprint: string },
    rerun = false,
  ) {
    const data = analysisRequest.parse(input);
    z.string().min(1).max(128).parse(key);
    analysisEvent("analysis_requested");
    const accepted = await this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      const state = await operationsAccess(tx, s, actor, "ANALYZE");
      const root =
        (
          await sql<{
            root_organization_id: string;
          }>`SELECT root_organization_id FROM operations_org_guilds WHERE ${tenant(s)} AND state='ACTIVE'`.execute(
            tx,
          )
        ).rows[0]?.root_organization_id ?? s.organizationId;
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"analysis-org:" + root},0))`.execute(
        tx,
      );
      await analysisLock(tx, s);
      const prior = (
        await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE ${tenant(s)} AND request_key=${key}`.execute(
          tx,
        )
      ).rows[0];
      if (prior) {
        assert(
          prior.analysis_type === data.type && prior.period_days === data.days,
          "IDEMPOTENCY_CONFLICT",
          409,
        );
        assert(
          (prior.correction_of ?? null) === (data.correctionOf ?? null),
          "IDEMPOTENCY_CONFLICT",
          409,
        );
        assert(
          !data.periodStart ||
            (prior.period_start.toISOString() === data.periodStart &&
              prior.period_end.toISOString() === data.periodEnd),
          "IDEMPOTENCY_CONFLICT",
          409,
        );
        return { run: prior, reused: true };
      }
      const p = await prepare(tx, s, data);
      if (expected) {
        assert(
          expected.fingerprint === p.confirmationFingerprint,
          "ANALYSIS_PREVIEW_CHANGED",
          409,
        );
      }
      assert(
        ["AVAILABLE", "PARTIAL"].includes(p.availability),
        p.availability === "INSUFFICIENT_DATA"
          ? "ANALYSIS_NO_DATA"
          : "ANALYSIS_UNAVAILABLE",
        409,
      );
      if (!rerun) {
        const duplicate = (
          await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE ${tenant(s)} AND input_fingerprint=${p.fingerprint} AND recipe_version=${p.recipeVersion} AND invalidated_at IS NULL AND status IN ('QUEUED','PREPARING','RUNNING','FINALIZING','COMPLETED') AND retention_until>now() ORDER BY requested_at DESC LIMIT 1`.execute(
            tx,
          )
        ).rows[0];
        if (duplicate) {
          return { run: duplicate, reused: true };
        }
      }
      const pending = (
        await sql<{
          guild: number;
          org: number;
        }>`SELECT count(*) FILTER(WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId})::int AS guild,count(*) FILTER(WHERE COALESCE(l.root_organization_id,a.organization_id)=${root}::uuid)::int AS org FROM analysis_runs a LEFT JOIN operations_org_guilds l ON l.organization_id=a.organization_id AND l.guild_id=a.guild_id AND l.state='ACTIVE' WHERE a.status='QUEUED' AND ((a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId}) OR COALESCE(l.root_organization_id,a.organization_id)=${root}::uuid)`.execute(
          tx,
        )
      ).rows[0]!;
      assert(
        pending.guild < analysisPolicy.guildPending &&
          pending.org < analysisPolicy.organizationPending,
        "ANALYSIS_BUSY",
        429,
      );
      await included(tx, s, state.limits.analysisRunsMonthly);
      if (data.correctionOf) {
        await sql`INSERT INTO analysis_grants(id,organization_id,guild_id,source,source_identity,quantity) VALUES(${randomUUID()}::uuid,${s.organizationId}::uuid,${s.guildId},'BUG_CORRECTION',${data.correctionOf},1) ON CONFLICT(organization_id,guild_id,source,source_identity) DO NOTHING`.execute(
          tx,
        );
        const correction = (
          await sql<{
            consumed: number;
          }>`SELECT consumed FROM analysis_grants WHERE ${tenant(s)} AND source='BUG_CORRECTION' AND source_identity=${data.correctionOf}`.execute(
            tx,
          )
        ).rows[0]!;
        assert(correction.consumed === 0, "ANALYSIS_CORRECTION_USED", 409);
      }
      const grant = (
        await sql<{
          id: string;
          source: string;
        }>`SELECT id,source FROM analysis_grants WHERE ${tenant(s)} AND ${data.correctionOf ? sql`source='BUG_CORRECTION' AND source_identity=${data.correctionOf}` : sql`source<>'BUG_CORRECTION'`} AND quantity>reserved+consumed AND (expires_at IS NULL OR expires_at>now()) ORDER BY expires_at NULLS LAST,created_at,id LIMIT 1 FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(grant, "ANALYSIS_USAGE_UNAVAILABLE", 409);
      const retentionDays = Math.min(
        p.cfg.aggregateRetentionMonths * 31,
        state.limits.historyDays ?? 3650,
      );
      const id = randomUUID(),
        run = (
          await sql<AnalysisRun>`INSERT INTO analysis_runs(id,organization_id,guild_id,scheduler_organization_id,analysis_type,request_key,requested_by_actor_hash,requested_by_user_ciphertext,period_start,period_end,period_days,recipe_version,scope_identity,config_revision,data_revision,input_fingerprint,plan_at_request,priority_class,retention_until) VALUES(${id}::uuid,${s.organizationId}::uuid,${s.guildId},${root}::uuid,${data.type},${key},${actor.key},${actor.encryptedUserId ?? null},${p.window.start},${p.window.end},${data.days},${p.recipeVersion},${p.scopeIdentity},${p.cfg.revision},${p.dataRevision}::bigint,${p.fingerprint},${state.plan},${state.plan === "FREE" && grant.source === "PACK_PURCHASE" ? "PACK_ONLY" : state.plan},now()+make_interval(days=>${retentionDays})) RETURNING *`.execute(
            tx,
          )
        ).rows[0]!;
      await sql`UPDATE analysis_runs SET confirmation_fingerprint=${p.confirmationFingerprint},data_identity=${p.dataIdentity},target_channel_ids=${p.targetChannelIds}::text[],conditions=${json(p.conditions)},scope_bug_impact='CORRECTED_DEFINITION',correction_of=${data.correctionOf ?? null}::uuid WHERE id=${id}::uuid`.execute(
        tx,
      );
      Object.assign(run, {
        confirmation_fingerprint: p.confirmationFingerprint,
        data_identity: p.dataIdentity,
        target_channel_ids: p.targetChannelIds,
        conditions: p.conditions,
        correction_of: data.correctionOf ?? null,
      });
      await sql`UPDATE analysis_grants SET reserved=reserved+1 WHERE id=${grant.id}::uuid`.execute(
        tx,
      );
      await sql`INSERT INTO analysis_reservations(run_id,organization_id,guild_id,grant_id,state) VALUES(${id}::uuid,${s.organizationId}::uuid,${s.guildId},${grant.id}::uuid,'RESERVED')`.execute(
        tx,
      );
      await operationsAudit(tx, s, actor.key, "ANALYSIS_REQUESTED", id, 0);
      return { run, reused: false };
    });
    analysisEvent(
      accepted.reused ? "analysis_duplicate_reused" : "analysis_reserved",
    );
    return accepted;
  }
  async history(s: Scope, actor: Actor, limit = 10) {
    return this.db.transaction().execute(async (tx) => {
      const state = await operationsAccess(tx, s, actor, "READ");
      return (
        await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE ${tenant(s)} AND retention_until>now() AND requested_at>=now()-make_interval(days=>${state.limits.historyDays ?? 3650}) ORDER BY requested_at DESC,id LIMIT ${z.number().int().min(1).max(25).parse(limit)}`.execute(
          tx,
        )
      ).rows;
    });
  }
  async historyPage(
    s: Scope,
    actor: Actor,
    input: {
      cursor?: string;
      direction?: "next" | "previous";
      type?: AnalysisRequest["type"];
      status?: AnalysisRun["status"];
      limit?: number;
    } = {},
  ) {
    const options = z
      .object({
        cursor: z.uuid().optional(),
        direction: z.enum(["next", "previous"]).default("next"),
        type: z.enum(analysisTypes).optional(),
        status: z
          .enum([
            "QUEUED",
            "PREPARING",
            "RUNNING",
            "FINALIZING",
            "COMPLETED",
            "FAILED",
            "CANCELED",
          ])
          .optional(),
        limit: z.number().int().min(1).max(25).default(5),
      })
      .strict()
      .parse(input);
    return this.db.transaction().execute(async (tx) => {
      const state = await operationsAccess(tx, s, actor, "READ"),
        filters = {
          type: options.type ?? null,
          status: options.status ?? null,
          limit: options.limit,
        };
      await sql`DELETE FROM analysis_history_cursors WHERE expires_at<=now()`.execute(
        tx,
      );
      let boundary: { requested_at: string; run_id: string } | undefined;
      if (options.cursor) {
        const cursor = (
          await sql<{
            requested_at: string;
            run_id: string;
            filters: typeof filters;
          }>`SELECT requested_at::text,run_id,filters FROM analysis_history_cursors WHERE ${tenant(s)} AND token=${options.cursor}::uuid AND actor_hash=${actor.key} AND expires_at>now()`.execute(
            tx,
          )
        ).rows[0];
        assert(
          cursor &&
            cursor.filters.type === filters.type &&
            cursor.filters.status === filters.status &&
            cursor.filters.limit === filters.limit,
          "ANALYSIS_CURSOR_INVALID",
          409,
        );
        boundary = cursor;
      }
      const base = sql`${tenant(s)} AND retention_until>now() AND requested_at>=now()-make_interval(days=>${state.limits.historyDays ?? 3650}) AND (${options.type ?? null}::text IS NULL OR analysis_type=${options.type ?? null}) AND (${options.status ?? null}::text IS NULL OR status=${options.status ?? null})`;
      const earlier = options.direction === "next";
      const condition = boundary
        ? earlier
          ? sql`(requested_at,id)<(${boundary.requested_at},${boundary.run_id}::uuid)`
          : sql`(requested_at,id)>(${boundary.requested_at},${boundary.run_id}::uuid)`
        : sql`true`;
      const rows = (
        await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE ${base} AND ${condition} ORDER BY ${earlier ? sql`requested_at DESC,id DESC` : sql`requested_at,id`} LIMIT ${options.limit}`.execute(
          tx,
        )
      ).rows;
      const runs = earlier ? rows : rows.reverse();
      async function cursorFor(
        run: AnalysisRun | undefined,
        direction: "next" | "previous",
      ) {
        if (!run) return null;
        const at = sql`(SELECT requested_at FROM analysis_runs WHERE id=${run.id}::uuid)`;
        const exists = (
          await sql`SELECT id FROM analysis_runs WHERE ${base} AND ${direction === "next" ? sql`(requested_at,id)<(${at},${run.id}::uuid)` : sql`(requested_at,id)>(${at},${run.id}::uuid)`} LIMIT 1`.execute(
            tx,
          )
        ).rows.length;
        if (!exists) return null;
        const token = randomUUID();
        await sql`INSERT INTO analysis_history_cursors(token,organization_id,guild_id,actor_hash,requested_at,run_id,filters) SELECT ${token}::uuid,${s.organizationId}::uuid,${s.guildId},${actor.key},requested_at,id,${json(filters)} FROM analysis_runs WHERE ${tenant(s)} AND id=${run.id}::uuid`.execute(
          tx,
        );
        return token;
      }
      return {
        runs,
        nextCursor: await cursorFor(runs.at(-1), "next"),
        previousCursor: await cursorFor(runs[0], "previous"),
      };
    });
  }
  async cancel(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ");
      await analysisLock(tx, s);
      const run = (
        await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE ${tenant(s)} AND id=${id}::uuid FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(run, "ANALYSIS_NOT_FOUND", 404);
      const permissions = await actorPermissions(tx, s, actor);
      assert(
        (run.requested_by_actor_hash === actor.key &&
          permissions.includes("ANALYZE")) ||
          permissions.includes("OPERATE"),
        "ANALYSIS_CANCEL_FORBIDDEN",
        403,
      );
      if (run.status === "CANCELED") return { run, canceled: false };
      assert(run.status === "QUEUED", "ANALYSIS_ALREADY_STARTED", 409);
      const updated = (
        await sql<AnalysisRun>`UPDATE analysis_runs SET status='CANCELED',failure_class='CANCELED',failed_at=now(),updated_at=now() WHERE id=${id}::uuid RETURNING *`.execute(
          tx,
        )
      ).rows[0]!;
      await finalizeUsage(tx, s, id, "RELEASED");
      await operationsAudit(tx, s, actor.key, "ANALYSIS_CANCELED", id, 0);
      return { run: updated, canceled: true };
    });
  }
  async result(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      const state = await operationsAccess(tx, s, actor, "READ");
      const run = await storedRun(tx, s, id, state.limits.historyDays ?? 3650);
      const result =
        (
          await sql<{
            result: AnalysisResult;
          }>`SELECT result FROM analysis_results WHERE ${tenant(s)} AND run_id=${id}::uuid`.execute(
            tx,
          )
        ).rows[0]?.result ?? null;
      return {
        run,
        canOperate: (await actorPermissions(tx, s, actor)).includes("OPERATE"),
        reviews: (
          await sql<{
            message_id: string;
            status: string;
          }>`SELECT message_id,status FROM attention_items WHERE ${tenant(s)} AND item_type='ANALYSIS_CONCERN' AND split_part(message_id,':',2)=${id}`.execute(
            tx,
          )
        ).rows,
        result: await visibleStoredResult(
          tx,
          s,
          result,
          state.limits.historyDays ?? 3650,
        ),
      };
    });
  }
  async compare(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      const state = await operationsAccess(tx, s, actor, "READ");
      const run = await storedRun(tx, s, id, state.limits.historyDays ?? 3650),
        result = (
          await sql<{
            result: AnalysisResult;
          }>`SELECT result FROM analysis_results WHERE ${tenant(s)} AND run_id=${id}::uuid`.execute(
            tx,
          )
        ).rows[0]?.result;
      assert(result, "ANALYSIS_RESULT_UNAVAILABLE", 409);
      let previous = await comparisonResult(
        tx,
        s,
        run,
        result,
        state.limits.historyDays ?? 3650,
      );
      if (!previous) {
        const targets = await availableStoredTargets(tx, s);
        // Explain the most recent visible prior result when no eligible baseline exists.
        // Hidden, removed or expired results are never used for diagnostics.
        previous =
          (
            await sql<
              ComparisonRun & { run_id: string; result: AnalysisResult }
            >`SELECT a.id,a.analysis_type,a.period_start,a.period_end,a.period_days,a.recipe_version,a.scope_identity,r.run_id,r.result FROM analysis_runs a JOIN analysis_results r ON r.run_id=a.id AND r.organization_id=a.organization_id AND r.guild_id=a.guild_id WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.id<>${id}::uuid AND a.status='COMPLETED' AND a.analysis_type=${run.analysis_type} AND a.period_end<=${run.period_end} AND a.invalidated_at IS NULL AND a.retention_until>now() AND a.requested_at>=now()-make_interval(days=>${state.limits.historyDays ?? 3650}) AND a.target_channel_ids<@${targets}::text[] ORDER BY a.period_end DESC,a.requested_at DESC,a.id DESC LIMIT 1`.execute(
              tx,
            )
          ).rows[0] ?? null;
      }
      return compareAnalyses(
        run,
        result,
        previous ? { run: previous, result: previous.result } : null,
      );
    });
  }
  async attention(s: Scope, actor: Actor, id: string, concernKey: string) {
    z.uuid().parse(id);
    z.string().min(1).max(64).parse(concernKey);
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      const state = await operationsAccess(
        tx,
        s,
        actor,
        "OPERATE",
        "basic_attention",
      );
      await analysisLock(tx, s);
      await storedRun(tx, s, id, state.limits.historyDays ?? 3650);
      const row = (
        await sql<{
          result: AnalysisResult;
        }>`SELECT r.result FROM analysis_results r JOIN analysis_runs a ON a.id=r.run_id AND a.organization_id=r.organization_id AND a.guild_id=r.guild_id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.run_id=${id}::uuid AND a.retention_until>now() AND a.invalidated_at IS NULL AND a.requested_at>=now()-make_interval(days=>${state.limits.historyDays ?? 3650})`.execute(
          tx,
        )
      ).rows[0];
      const concern = row?.result.concerns.find((c) => c.key === concernKey);
      assert(concern, "ANALYSIS_CONCERN_UNAVAILABLE", 404);
      const key = "analysis:" + id + ":" + concernKey;
      const inserted =
        await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,opened_at,item_type,target_surface,reason,evidence,updated_at,last_actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},'',${key},now(),'OPEN',now(),'ANALYSIS_CONCERN','AGGREGATE','ANALYSIS_WAITING_RESPONSE',${json(concern.evidence)},now(),${actor.key}) ON CONFLICT DO NOTHING RETURNING message_id`.execute(
          tx,
        );
      if (inserted.rows.length)
        await operationsAudit(
          tx,
          s,
          actor.key,
          "ANALYSIS_ATTENTION_ADDED",
          key,
          0,
        );
      return key;
    });
  }
  async attentionList(
    s: Scope,
    actor: Actor,
    offset = 0,
    filter: "active" | "all" = "active",
  ) {
    z.number().int().min(0).max(1000).parse(offset);
    z.enum(["active", "all"]).parse(filter);
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      const state = await operationsAccess(
          tx,
          s,
          actor,
          "READ",
          "basic_attention",
        ),
        targets = await availableStoredTargets(tx, s);
      return (
        await sql<{
          message_id: string;
          version: number;
          status: string;
          evidence: MetricEvidence;
          detected_at: Date;
        }>`SELECT i.message_id,i.version,i.status,i.evidence,i.detected_at FROM attention_items i JOIN analysis_runs a ON a.organization_id=i.organization_id AND a.guild_id=i.guild_id AND a.id::text=split_part(i.message_id,':',2) WHERE i.organization_id=${s.organizationId}::uuid AND i.guild_id=${s.guildId} AND i.item_type='ANALYSIS_CONCERN' ${filter === "active" ? sql`AND i.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','SNOOZED')` : sql``} AND a.invalidated_at IS NULL AND a.retention_until>now() AND a.requested_at>=now()-make_interval(days=>${state.limits.historyDays ?? 3650}) AND a.target_channel_ids<@${targets}::text[] ORDER BY i.detected_at DESC,i.message_id LIMIT 5 OFFSET ${offset}`.execute(
          tx,
        )
      ).rows;
    });
  }
  async attentionItem(s: Scope, actor: Actor, key: string) {
    z.string()
      .regex(/^analysis:[a-f0-9-]{36}:waiting_response$/)
      .parse(key);
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      const state = await operationsAccess(
        tx,
        s,
        actor,
        "READ",
        "basic_attention",
      );
      await storedRun(
        tx,
        s,
        key.split(":")[1]!,
        state.limits.historyDays ?? 3650,
      );
      const row = (
        await sql<{
          message_id: string;
          version: number;
          status: string;
          evidence: MetricEvidence;
          detected_at: Date;
          opened_at: Date | null;
          acknowledged_at: Date | null;
          resolved_at: Date | null;
          updated_at: Date | null;
        }>`SELECT message_id,version,status,evidence,detected_at,opened_at,acknowledged_at,resolved_at,updated_at FROM attention_items WHERE ${tenant(s)} AND item_type='ANALYSIS_CONCERN' AND message_id=${key}`.execute(
          tx,
        )
      ).rows[0];
      assert(row, "ATTENTION_NOT_FOUND", 404);
      return {
        ...row,
        canOperate: (await actorPermissions(tx, s, actor)).includes("OPERATE"),
        events: (
          await sql<{
            state: string;
            version: number;
            occurred_at: Date;
          }>`SELECT state,version,occurred_at FROM attention_events WHERE ${tenant(s)} AND attention_key=${key} ORDER BY version DESC LIMIT 5`.execute(
            tx,
          )
        ).rows,
      };
    });
  }
  async attentionUpdate(
    s: Scope,
    actor: Actor,
    key: string,
    version: number,
    status: "ACKNOWLEDGED" | "RESOLVED" | "DISMISSED",
  ) {
    z.string()
      .regex(/^analysis:[a-f0-9-]{36}:waiting_response$/)
      .parse(key);
    z.number().int().nonnegative().parse(version);
    z.enum(["ACKNOWLEDGED", "RESOLVED", "DISMISSED"]).parse(status);
    return new AttentionOperations(this.db).action(
      s,
      key,
      "",
      status,
      new Date(),
      null,
      status === "DISMISSED" ? "MANUAL_WITHDRAWAL" : "MANUAL",
      async (tx) => {
        await privacyReadLock(tx, s);
        const state = await operationsAccess(
          tx,
          s,
          actor,
          "OPERATE",
          "basic_attention",
        );
        await storedRun(
          tx,
          s,
          key.split(":")[1]!,
          state.limits.historyDays ?? 3650,
        );
        assert(
          (
            await sql`SELECT message_id FROM attention_items WHERE ${tenant(s)} AND message_id=${key} AND item_type='ANALYSIS_CONCERN'`.execute(
              tx,
            )
          ).rows.length,
          "ATTENTION_NOT_FOUND",
          404,
        );
        await operationsAudit(
          tx,
          s,
          actor.key,
          "ANALYSIS_ATTENTION_UPDATED",
          key,
          version,
        );
      },
      version,
      actor.key,
    );
  }
  async manualGrant(s: Scope, actor: InternalBillingActor, input: unknown) {
    assert(actor.internal, "NEXUS_INTERNAL_ADMIN_REQUIRED", 403);
    const d = z
      .object({
        quantity: z.number().int().min(1).max(100000),
        sourceIdentity: z.string().min(8).max(180),
        expiresAt: z.iso.datetime().optional(),
      })
      .strict()
      .parse(input);
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      assert(
        !(await new EntitlementService(tx).effective(s)).privacyDeleted,
        "PRIVACY_DELETED",
        403,
      );
      await analysisLock(tx, s);
      const previous = (
        await sql<{
          id: string;
          quantity: number;
          expires_at: Date | null;
        }>`SELECT id,quantity,expires_at FROM analysis_grants WHERE ${tenant(s)} AND source='MANUAL' AND source_identity=${d.sourceIdentity}`.execute(
          tx,
        )
      ).rows[0];
      if (previous) {
        assert(
          previous.quantity === d.quantity &&
            (previous.expires_at?.toISOString() ?? null) ===
              (d.expiresAt ? new Date(d.expiresAt).toISOString() : null),
          "IDEMPOTENCY_CONFLICT",
          409,
        );
        return previous.id;
      }
      const id = randomUUID();
      await sql`INSERT INTO analysis_grants(id,organization_id,guild_id,source,source_identity,quantity,expires_at,created_by_actor_hash) VALUES(${id}::uuid,${s.organizationId}::uuid,${s.guildId},'MANUAL',${d.sourceIdentity},${d.quantity},${d.expiresAt ?? null}::timestamptz,${actor.hash})`.execute(
        tx,
      );
      await operationsAudit(tx, s, actor.hash, "ANALYSIS_MANUAL_GRANT", id, 0);
      return id;
    });
  }
  async claim(id: string): Promise<AnalysisRun | null> {
    z.uuid().parse(id);
    const known = (
      await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE id=${id}::uuid`.execute(
        this.db,
      )
    ).rows[0];
    if (!known) return null;
    const s = {
      organizationId: known.organization_id,
      guildId: known.guild_id,
    };
    let released = false;
    const claimed = await this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      const link = (
        await sql<{
          root_organization_id: string;
          home_guild_id: string;
        }>`SELECT g.root_organization_id,o.home_guild_id FROM operations_org_guilds g JOIN operations_organizations o ON o.id=g.root_organization_id WHERE g.organization_id=${s.organizationId}::uuid AND g.guild_id=${s.guildId} AND g.state='ACTIVE'`.execute(
          tx,
        )
      ).rows[0];
      const root = link?.root_organization_id ?? s.organizationId;
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"analysis-org:" + root},0))`.execute(
        tx,
      );
      await analysisLock(tx, s);
      const run = (
        await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE id=${id}::uuid AND status='QUEUED' AND available_at<=now() AND retention_until>now() AND requested_at>now()-make_interval(secs=>${analysisPolicy.maximumQueueWaitSeconds}) FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      if (!run) return null;
      const state = await new EntitlementService(tx).effective(s);
      if (state.privacyDeleted) {
        released = await finalizeUsage(tx, s, id, "RELEASED");
        await sql`UPDATE analysis_runs SET status='CANCELED',failure_class='AUTHORIZATION',failed_at=now(),updated_at=now() WHERE id=${id}::uuid`.execute(
          tx,
        );
        return null;
      }
      const rootState = link
        ? await new EntitlementService(tx).effective({
            organizationId: root,
            guildId: link.home_guild_id,
          })
        : state;
      const active = (
        await sql<{
          guild: number;
          org: number;
        }>`SELECT count(*) FILTER(WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId})::int AS guild,count(*) FILTER(WHERE COALESCE(g.root_organization_id,a.organization_id)=${root}::uuid)::int AS org FROM analysis_runs a LEFT JOIN operations_org_guilds g ON g.organization_id=a.organization_id AND g.guild_id=a.guild_id AND g.state='ACTIVE' WHERE a.status=ANY(${liveStates}::text[]) AND a.lease_until>now() AND ((a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId}) OR COALESCE(g.root_organization_id,a.organization_id)=${root}::uuid)`.execute(
          tx,
        )
      ).rows[0]!;
      if (
        active.guild >= analysisPolicy.guildConcurrency ||
        active.org >= (rootState.limits.analysisConcurrency ?? 1)
      ) {
        await sql`UPDATE analysis_runs SET available_at=now()+interval '1 second' WHERE id=${id}::uuid`.execute(
          tx,
        );
        return null;
      }
      const claimed = (
        await sql<AnalysisRun>`UPDATE analysis_runs SET scheduler_organization_id=${root}::uuid,status='RUNNING',lease_token=${randomUUID()}::uuid,lease_until=now()+make_interval(secs=>${analysisPolicy.leaseSeconds}),attempts=attempts+1,started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=${id}::uuid RETURNING *`.execute(
          tx,
        )
      ).rows[0]!;
      return claimed;
    });
    if (released) analysisEvent("analysis_usage_released");
    if (claimed) {
      analysisEvent("analysis_started");
      analysisTiming("delay", Date.now() - claimed.requested_at.getTime());
    }
    return claimed;
  }
  async heartbeat(run: AnalysisRun) {
    return (
      (
        await sql`UPDATE analysis_runs SET lease_until=now()+make_interval(secs=>${analysisPolicy.leaseSeconds}),updated_at=now() WHERE id=${run.id}::uuid AND lease_token=${run.lease_token}::uuid AND lease_until>now() AND status='RUNNING' RETURNING id`.execute(
          this.db,
        )
      ).rows.length > 0
    );
  }
  async execute(
    run: AnalysisRun,
    authorize?: (tx?: Tx) => Promise<void>,
    compute = analysisMetrics,
  ) {
    const s = { organizationId: run.organization_id, guildId: run.guild_id };
    try {
      await authorize?.();
      const snapshot = await this.db
        .transaction()
        .setIsolationLevel("repeatable read")
        .execute(async (tx) => {
          await privacyReadLock(tx, s);
          const state = await new EntitlementService(tx).effective(s);
          assert(!state.privacyDeleted, "PRIVACY_DELETED", 403);
          await sql`SET LOCAL statement_timeout='60s'`.execute(tx);
          const cfg = await new SettingsService(tx).get(s);
          const resolved = await validateRunConditions(tx, s, run, cfg);
          const dataRevision = await revision(tx, s),
            result = await compute(
              tx,
              s,
              cfg,
              run.analysis_type,
              run.period_start,
              run.period_end,
              run.scope_identity,
              run.period_days,
            );
          assert(result.dataQuality !== "NO_DATA", "ANALYSIS_NO_DATA", 409);
          result.comparisonMetadata.recipeVersion = run.recipe_version;
          const baseline = await comparisonResult(
            tx,
            s,
            run,
            result,
            state.limits.historyDays ?? 3650,
          );
          if (baseline)
            result.baseline = {
              runId: baseline.run_id,
              changes: observedChanges(result, baseline.result).filter(
                (c) => c.before !== c.after,
              ),
            };
          const dataIdentity = await analysisDataIdentity(
            tx,
            s,
            { type: run.analysis_type, days: run.period_days as 7 | 30 | 90 },
            { start: run.period_start, end: run.period_end },
            resolved.actualChannelIds,
          );
          return {
            dataRevision,
            dataIdentity,
            targetChannelIds: resolved.actualChannelIds,
            calculatedAt: new Date(),
            result,
          };
        });
      await this.db.transaction().execute(async (tx) => {
        await privacyReadLock(tx, s);
        await analysisLock(tx, s);
        await authorize?.(tx);
        assert(
          !(await new EntitlementService(tx).effective(s)).privacyDeleted,
          "PRIVACY_DELETED",
          403,
        );
        const cfg = await new SettingsService(tx).get(s);
        await validateRunConditions(tx, s, run, cfg);
        assert(
          !(
            await sql`SELECT id FROM analysis_runs WHERE id=${run.id}::uuid AND invalidated_at IS NOT NULL`.execute(
              tx,
            )
          ).rows.length,
          "PRIVACY_DELETED",
          403,
        );
        const {
          dataRevision,
          dataIdentity,
          targetChannelIds,
          calculatedAt,
          result,
        } = snapshot;
        // A process that lost its lease cannot publish a result or finalize usage.
        const owned = (
          await sql`SELECT id FROM analysis_runs WHERE id=${run.id}::uuid AND lease_token=${run.lease_token}::uuid AND lease_until>clock_timestamp() AND status='RUNNING' FOR UPDATE`.execute(
            tx,
          )
        ).rows.length;
        assert(owned, "ANALYSIS_CLAIM_LOST", 409);
        await sql`UPDATE analysis_runs SET status='FINALIZING',updated_at=now() WHERE id=${run.id}::uuid`.execute(
          tx,
        );
        await sql`INSERT INTO analysis_results(run_id,organization_id,guild_id,result) VALUES(${run.id}::uuid,${s.organizationId}::uuid,${s.guildId},${json(result)})`.execute(
          tx,
        );
        assert(
          await finalizeUsage(tx, s, run.id, "CONSUMED"),
          "ANALYSIS_RESERVATION_UNAVAILABLE",
          409,
        );
        const fp = inputIdentity(
          s,
          run.analysis_type,
          run.period_start,
          run.period_end,
          run.scope_identity,
          run.recipe_version,
          dataIdentity,
          result,
        );
        await sql`UPDATE analysis_runs SET status='COMPLETED',completed_at=now(),data_revision=${dataRevision}::bigint,input_fingerprint=${fp},lease_token=NULL,lease_until=NULL,failure_class=NULL,failure_detail_safe=NULL,updated_at=now() WHERE id=${run.id}::uuid`.execute(
          tx,
        );
        await sql`UPDATE analysis_runs SET data_identity=${dataIdentity},target_channel_ids=${targetChannelIds}::text[],calculated_at=${calculatedAt} WHERE id=${run.id}::uuid`.execute(
          tx,
        );
      });
      analysisEvent("analysis_usage_consumed");
      analysisEvent("analysis_completed");
      analysisTiming(
        "duration",
        Date.now() - (run.started_at ?? run.requested_at).getTime(),
      );
    } catch (error) {
      if (error instanceof Error && error.message === "ANALYSIS_CLAIM_LOST")
        return;
      logFailure({
        action: "analysis",
        stage: "calculation_publication",
        error,
      });
      await this.fail(run, failureClass(error));
    }
  }
  async fail(run: AnalysisRun, category: AnalysisFailure, expiredOnly = false) {
    const s = { organizationId: run.organization_id, guildId: run.guild_id };
    const outcome = await this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      await analysisLock(tx, s);
      const owned = (
        await sql`SELECT id FROM analysis_runs WHERE id=${run.id}::uuid AND lease_token=${run.lease_token}::uuid AND status=ANY(${liveStates}::text[]) AND (${!expiredOnly} OR lease_until<now()) FOR UPDATE`.execute(
          tx,
        )
      ).rows.length;
      if (!owned) return;
      const retry =
        ["TRANSIENT_INFRASTRUCTURE", "UNKNOWN"].includes(category) &&
        run.attempts < analysisPolicy.maxAttempts;
      const released =
        !retry && (await finalizeUsage(tx, s, run.id, "RELEASED"));
      await sql`UPDATE analysis_runs SET status=${retry ? "QUEUED" : "FAILED"},available_at=now()+make_interval(secs=>${retry ? run.attempts * 2 + Math.random() * 2 : 0}),failed_at=CASE WHEN ${!retry} THEN now() ELSE NULL END,failure_class=${category},failure_detail_safe='Analysis could not be completed.',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${run.id}::uuid`.execute(
        tx,
      );
      return { retry, released };
    });
    if (!outcome) return false;
    if (outcome.released) analysisEvent("analysis_usage_released");
    analysisEvent(outcome.retry ? "analysis_retried" : "analysis_failed");
    return true;
  }
  async recover() {
    const expired = (
      await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE status=ANY(${liveStates}::text[]) AND lease_until<now() ORDER BY lease_until LIMIT ${analysisPolicy.dispatchBatch}`.execute(
        this.db,
      )
    ).rows;
    for (const run of expired) {
      if (await this.fail(run, "TRANSIENT_INFRASTRUCTURE", true))
        analysisEvent("analysis_recovered");
    }
    const abandoned = (
      await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE status='QUEUED' AND (retention_until<=now() OR requested_at<=now()-make_interval(secs=>${analysisPolicy.maximumQueueWaitSeconds})) ORDER BY requested_at LIMIT ${analysisPolicy.dispatchBatch}`.execute(
        this.db,
      )
    ).rows;
    for (const run of abandoned) {
      const released = await this.db.transaction().execute(async (tx) => {
        const s = {
          organizationId: run.organization_id,
          guildId: run.guild_id,
        };
        await privacyReadLock(tx, s);
        await analysisLock(tx, s);
        const owned = (
          await sql`SELECT id FROM analysis_runs WHERE id=${run.id}::uuid AND status='QUEUED' AND (retention_until<=now() OR requested_at<=now()-make_interval(secs=>${analysisPolicy.maximumQueueWaitSeconds})) FOR UPDATE`.execute(
            tx,
          )
        ).rows.length;
        if (!owned) return;
        const finalized = await finalizeUsage(tx, s, run.id, "RELEASED");
        await sql`UPDATE analysis_runs SET status='CANCELED',failure_class='CANCELED',failed_at=now(),updated_at=now() WHERE id=${run.id}::uuid`.execute(
          tx,
        );
        return finalized;
      });
      if (released) analysisEvent("analysis_usage_released");
    }
    // Interleave organizations and guilds before the bounded dispatcher batch.
    return (
      await sql<AnalysisRun>`WITH guild_order AS(SELECT a.*,COALESCE(l.root_organization_id,a.organization_id) AS current_scheduler_organization_id,row_number() OVER(PARTITION BY a.organization_id,a.guild_id ORDER BY requested_at,id) AS guild_rank FROM analysis_runs a LEFT JOIN operations_org_guilds l ON l.organization_id=a.organization_id AND l.guild_id=a.guild_id AND l.state='ACTIVE' WHERE a.status='QUEUED' AND a.available_at<=now() AND a.retention_until>now()), org_order AS(SELECT g.*,row_number() OVER(PARTITION BY current_scheduler_organization_id ORDER BY guild_rank,requested_at,id) AS org_rank FROM guild_order g) SELECT * FROM org_order ORDER BY org_rank,guild_rank,requested_at,id LIMIT ${analysisPolicy.dispatchBatch}`.execute(
        this.db,
      )
    ).rows;
  }
}
async function finalizeUsage(
  tx: Tx,
  s: Scope,
  id: string,
  outcome: "CONSUMED" | "RELEASED",
) {
  const r = (
    await sql<{
      grant_id: string;
    }>`UPDATE analysis_reservations SET state=${outcome},finalized_at=now() WHERE ${tenant(s)} AND run_id=${id}::uuid AND state='RESERVED' RETURNING grant_id`.execute(
      tx,
    )
  ).rows[0];
  if (!r) return false;
  await sql`UPDATE analysis_grants SET reserved=reserved-1,consumed=consumed+${outcome === "CONSUMED" ? 1 : 0} WHERE id=${r.grant_id}::uuid`.execute(
    tx,
  );
  await sql`INSERT INTO analysis_usage_ledger(run_id,organization_id,guild_id,grant_id,outcome) VALUES(${id}::uuid,${s.organizationId}::uuid,${s.guildId},${r.grant_id}::uuid,${outcome})`.execute(
    tx,
  );
  return true;
}
