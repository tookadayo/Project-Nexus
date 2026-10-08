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
import { operationsAccess, operationsAudit } from "../../operations/src/policy";
import { comparisonEligibility } from "../../shared/src/metric-evidence";
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
export * from "./domain";
export * from "./policy";
function inputIdentity(
  s: Scope,
  type: string,
  from: Date,
  to: Date,
  scope: string,
  recipe: string,
  config: number,
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
    config,
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
    }>`SELECT COALESCE(sum(quantity-reserved-consumed),0)::int AS remaining,COALESCE(sum(reserved),0)::int AS reserved,COALESCE(sum(consumed),0)::int AS consumed FROM analysis_grants WHERE ${tenant(s)} AND (expires_at IS NULL OR expires_at>now())`.execute(
      tx,
    )
  ).rows[0]!;
  return row;
}
async function prepare(tx: Tx, s: Scope, input: AnalysisRequest) {
  const cfg = await new SettingsService(tx).get(s),
    state = await new EntitlementService(tx).effective(s),
    recipe = await currentRecipe(tx, s),
    window = completedWindow(input.days);
  assert(!state.privacyDeleted, "PRIVACY_DELETED", 403);
  const withinHistory =
    state.limits.historyDays === null || input.days <= state.limits.historyDays;
  const scopeIdentity = fingerprint([
    cfg.analysisScope.mode,
    [...cfg.analysisScope.channelIds].sort(),
    cfg.communityModel,
  ]);
  const recipeVersion = analysisRecipeVersion + ":" + (recipe?.id ?? "default");
  const dataRevision = await revision(tx, s);
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
      !cfg.communityModel.modes.includes("SUPPORT_QA") ||
      !cfg.communityModel.channels.some((c) => c.purpose === "SUPPORT"))
  )
    availability = "REQUIRES_SETUP";
  if (
    input.type === "VOICE" &&
    !cfg.communityModel.modes.some((m) => m === "VOICE" || m === "LFG_PLAY")
  )
    availability = "REQUIRES_SETUP";
  if (input.type === "EVENTS" && !cfg.communityModel.modes.includes("EVENTS"))
    availability = "REQUIRES_SETUP";
  return {
    cfg,
    state,
    window,
    scopeIdentity,
    recipeVersion,
    dataRevision,
    result,
    availability,
    fingerprint: inputIdentity(
      s,
      input.type,
      window.start,
      window.end,
      scopeIdentity,
      recipeVersion,
      cfg.revision,
      dataRevision,
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
            }>`SELECT id,status FROM analysis_runs WHERE ${tenant(s)} AND input_fingerprint=${p.fingerprint} AND status IN ('QUEUED','PREPARING','RUNNING','FINALIZING','COMPLETED') AND retention_until>now() ORDER BY requested_at DESC LIMIT 1`.execute(
              tx,
            )
          ).rows[0] ?? null;
        return {
          request: data,
          scope: p.cfg.analysisScope,
          availability: p.availability,
          quality: p.result.dataQuality,
          metrics: p.result.metrics,
          periodStart: p.window.start,
          periodEnd: p.window.end,
          usage,
          duplicate,
          configRevision: p.cfg.revision,
          inputFingerprint: p.fingerprint,
          estimate: data.days === 90 ? "3–10" : "1–3",
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
      const state = await operationsAccess(tx, s, actor, "ANALYZE");
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
        return { run: prior, reused: true };
      }
      const p = await prepare(tx, s, data);
      if (expected) {
        assert(
          expected.revision === p.cfg.revision &&
            expected.fingerprint === p.fingerprint,
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
          await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE ${tenant(s)} AND input_fingerprint=${p.fingerprint} AND status IN ('QUEUED','PREPARING','RUNNING','FINALIZING','COMPLETED') AND retention_until>now() ORDER BY requested_at DESC LIMIT 1`.execute(
            tx,
          )
        ).rows[0];
        if (duplicate) {
          return { run: duplicate, reused: true };
        }
      }
      await included(tx, s, state.limits.analysisRunsMonthly);
      const grant = (
        await sql<{
          id: string;
          source: string;
        }>`SELECT id,source FROM analysis_grants WHERE ${tenant(s)} AND quantity>reserved+consumed AND (expires_at IS NULL OR expires_at>now()) ORDER BY expires_at NULLS LAST,created_at,id LIMIT 1 FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(grant, "ANALYSIS_USAGE_UNAVAILABLE", 409);
      const root =
        (
          await sql<{
            root_organization_id: string;
          }>`SELECT root_organization_id FROM operations_org_guilds WHERE ${tenant(s)} AND state='ACTIVE'`.execute(
            tx,
          )
        ).rows[0]?.root_organization_id ?? s.organizationId;
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
  async result(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      const state = await operationsAccess(tx, s, actor, "READ");
      const run = (
        await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE ${tenant(s)} AND id=${id}::uuid AND retention_until>now() AND requested_at>=now()-make_interval(days=>${state.limits.historyDays ?? 3650})`.execute(
          tx,
        )
      ).rows[0];
      assert(run, "ANALYSIS_NOT_FOUND", 404);
      const result =
        (
          await sql<{
            result: AnalysisResult;
          }>`SELECT result FROM analysis_results WHERE ${tenant(s)} AND run_id=${id}::uuid`.execute(
            tx,
          )
        ).rows[0]?.result ?? null;
      return { run, result };
    });
  }
  async compare(s: Scope, actor: Actor, id: string) {
    const current = await this.result(s, actor, id);
    assert(current.result, "ANALYSIS_RESULT_UNAVAILABLE", 409);
    const rows = await this.history(s, actor, 25),
      prior = rows.find(
        (r) =>
          r.status === "COMPLETED" &&
          r.id !== id &&
          r.period_end <= current.run.period_start &&
          r.analysis_type === current.run.analysis_type &&
          r.recipe_version === current.run.recipe_version &&
          r.scope_identity === current.run.scope_identity &&
          r.period_days === current.run.period_days,
      );
    if (!prior) return { comparable: false, changes: [] };
    const previous = await this.result(s, actor, prior.id);
    if (
      !previous.result ||
      current.run.recipe_version !== prior.recipe_version ||
      current.run.scope_identity !== prior.scope_identity ||
      current.run.period_days !== prior.period_days
    )
      return { comparable: false, changes: [] };
    const changes = current.result.metrics.flatMap((metric) => {
      const before = previous.result!.metrics.find((m) => m.key === metric.key);
      if (
        !before ||
        !comparisonEligibility(metric.evidence, before.evidence).comparable ||
        metric.evidence.value === null ||
        before.evidence.value === null
      )
        return [];
      return [
        {
          key: metric.key,
          before: before.evidence.value,
          after: metric.evidence.value,
          unit: metric.unit,
        },
      ];
    });
    return { comparable: changes.length > 0, changes };
  }
  async attention(s: Scope, actor: Actor, id: string, concernKey: string) {
    z.uuid().parse(id);
    z.string().min(1).max(64).parse(concernKey);
    return this.db.transaction().execute(async (tx) => {
      const state = await operationsAccess(
        tx,
        s,
        actor,
        "OPERATE",
        "basic_attention",
      );
      await analysisLock(tx, s);
      const row = (
        await sql<{
          result: AnalysisResult;
        }>`SELECT r.result FROM analysis_results r JOIN analysis_runs a ON a.id=r.run_id AND a.organization_id=r.organization_id AND a.guild_id=r.guild_id WHERE r.organization_id=${s.organizationId}::uuid AND r.guild_id=${s.guildId} AND r.run_id=${id}::uuid AND a.retention_until>now() AND a.requested_at>=now()-make_interval(days=>${state.limits.historyDays ?? 3650})`.execute(
          tx,
        )
      ).rows[0];
      const concern = row?.result.concerns.find((c) => c.key === concernKey);
      assert(concern, "ANALYSIS_CONCERN_UNAVAILABLE", 404);
      const key = "analysis:" + id + ":" + concernKey;
      await sql`INSERT INTO attention_items(organization_id,guild_id,channel_id,message_id,detected_at,status,opened_at,item_type,target_surface,reason,evidence,updated_at,last_actor_hash) VALUES(${s.organizationId}::uuid,${s.guildId},'',${key},now(),'OPEN',now(),'ANALYSIS_CONCERN','AGGREGATE','ANALYSIS_WAITING_RESPONSE',${json(concern.evidence)},now(),${actor.key}) ON CONFLICT DO NOTHING`.execute(
        tx,
      );
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
  async attentionList(s: Scope, actor: Actor, offset = 0) {
    z.number().int().min(0).max(1000).parse(offset);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ", "basic_attention");
      return (
        await sql<{
          message_id: string;
          version: number;
          status: string;
          evidence: MetricEvidence;
          detected_at: Date;
        }>`SELECT message_id,version,status,evidence,detected_at FROM attention_items WHERE ${tenant(s)} AND item_type='ANALYSIS_CONCERN' AND status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','SNOOZED') ORDER BY detected_at DESC,message_id LIMIT 5 OFFSET ${offset}`.execute(
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
      await operationsAccess(tx, s, actor, "READ", "basic_attention");
      const row = (
        await sql<{
          message_id: string;
          version: number;
          status: string;
          evidence: MetricEvidence;
          detected_at: Date;
        }>`SELECT message_id,version,status,evidence,detected_at FROM attention_items WHERE ${tenant(s)} AND item_type='ANALYSIS_CONCERN' AND message_id=${key}`.execute(
          tx,
        )
      ).rows[0];
      assert(row, "ATTENTION_NOT_FOUND", 404);
      return row;
    });
  }
  async attentionUpdate(
    s: Scope,
    actor: Actor,
    key: string,
    version: number,
    status: "ACKNOWLEDGED" | "RESOLVED",
  ) {
    z.string()
      .regex(/^analysis:[a-f0-9-]{36}:waiting_response$/)
      .parse(key);
    z.number().int().nonnegative().parse(version);
    return new AttentionOperations(this.db).action(
      s,
      key,
      "",
      status,
      new Date(),
      null,
      "MANUAL",
      async (tx) => {
        await operationsAccess(tx, s, actor, "OPERATE", "basic_attention");
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
        await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE id=${id}::uuid AND status='QUEUED' AND available_at<=now() AND retention_until>now() FOR UPDATE`.execute(
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
          assert(
            cfg.enabled && cfg.revision === run.config_revision,
            "ANALYSIS_CONFIGURATION_CHANGED",
            409,
          );
          const recipe = await currentRecipe(tx, s);
          assert(
            analysisRecipeVersion + ":" + (recipe?.id ?? "default") ===
              run.recipe_version,
            "ANALYSIS_CONFIGURATION_CHANGED",
            409,
          );
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
          return { dataRevision, result };
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
        assert(
          cfg.enabled && cfg.revision === run.config_revision,
          "ANALYSIS_CONFIGURATION_CHANGED",
          409,
        );
        const recipe = await currentRecipe(tx, s);
        assert(
          analysisRecipeVersion + ":" + (recipe?.id ?? "default") ===
            run.recipe_version,
          "ANALYSIS_CONFIGURATION_CHANGED",
          409,
        );
        const { dataRevision, result } = snapshot;
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
          run.config_revision,
          dataRevision,
          result,
        );
        await sql`UPDATE analysis_runs SET status='COMPLETED',completed_at=now(),data_revision=${dataRevision}::bigint,input_fingerprint=${fp},lease_token=NULL,lease_until=NULL,failure_class=NULL,failure_detail_safe=NULL,updated_at=now() WHERE id=${run.id}::uuid`.execute(
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
      await sql`UPDATE analysis_runs SET status=${retry ? "QUEUED" : "FAILED"},available_at=now()+make_interval(secs=>${retry ? run.attempts * 2 : 0}),failed_at=CASE WHEN ${!retry} THEN now() ELSE NULL END,failure_class=${category},failure_detail_safe='Analysis could not be completed.',lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=${run.id}::uuid`.execute(
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
      await sql<AnalysisRun>`SELECT * FROM analysis_runs WHERE status='QUEUED' AND retention_until<=now() ORDER BY retention_until LIMIT ${analysisPolicy.dispatchBatch}`.execute(
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
          await sql`SELECT id FROM analysis_runs WHERE id=${run.id}::uuid AND status='QUEUED' AND retention_until<=now() FOR UPDATE`.execute(
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
