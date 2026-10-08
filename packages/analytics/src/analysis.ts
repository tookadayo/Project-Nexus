import { sql, tenant, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { Settings } from "../../settings/src/index";
import { latestCapability } from "../../lifecycle/src/discovery";
import {
  integrationHealth,
  collectionEpochs,
} from "../../lifecycle/src/observation";
import { currentRecipe } from "../../settings/src/recipes";
import { metricCoverage, type EvidenceContext } from "./evidence";
import { measurementDefinition } from "../../shared/src/measurement-definitions";
import { metricEvidence } from "../../shared/src/metric-evidence";
import {
  quality,
  type AnalysisType,
  type AnalysisMetric,
  type AnalysisResult,
  analysisRecipeVersion,
} from "../../analysis/src/domain";

// Only aggregates leave this boundary. Reply counts concern explicitly observed
// replies to posts; they never infer a question, resolution, or message meaning.
export async function analysisMetrics(
  tx: Tx,
  s: Scope,
  cfg: Settings,
  type: AnalysisType,
  from: Date,
  to: Date,
  scopeIdentity: string,
  days: number,
  previewOnly = false,
): Promise<AnalysisResult> {
  const [snapshot, health, epochs, recipe, gap] = await Promise.all([
    latestCapability(tx, s),
    integrationHealth(tx, s, new Date()),
    collectionEpochs(tx, s, from, to, 129),
    currentRecipe(tx, s),
    sql<{
      gap: boolean;
      unknown: boolean;
      safety: boolean;
    }>`SELECT EXISTS(SELECT 1 FROM telemetry_health WHERE ${tenant(s)} AND started_at<${to} AND (ended_at IS NULL OR ended_at>${from})) AS gap,EXISTS(SELECT 1 FROM membership_episodes WHERE ${tenant(s)} AND context='PRODUCTION' AND joined_at>=${from} AND joined_at<${to} AND (screening_observed_at IS NULL OR guest_observed_at IS NULL OR GREATEST(screening_observed_at,guest_observed_at)>${to})) AS unknown,EXISTS(SELECT 1 FROM adaptive_facts WHERE ${tenant(s)} AND kind='safety.context' AND occurred_at>=${from} AND occurred_at<${to}) AS safety`.execute(
      tx,
    ),
  ]);
  const context: EvidenceContext = {
    health,
    epochs,
    gap: gap.rows[0]!.gap,
    safety: gap.rows[0]!.safety,
    from,
    to,
    unknownJoins: gap.rows[0]!.unknown ? [from] : [],
  };
  const configured = cfg.communityModel.channels
    .filter((c) => c.purpose === "SUPPORT")
    .map((c) => c.channelId);
  const channels = (snapshot?.channels ?? [])
    .filter(
      (c) =>
        c.observable &&
        cfg.communityModel.channels.find((p) => p.channelId === c.id)
          ?.purpose !== "STAFF" &&
        (cfg.analysisScope.mode === "all" ||
          (cfg.analysisScope.mode === "include") ===
            cfg.analysisScope.channelIds.includes(c.id)) &&
        (type !== "SUPPORT" || configured.includes(c.id)),
    )
    .map((c) => c.id);
  const staff = [
    ...cfg.staffRoleIds,
    ...cfg.managerRoleIds,
    ...cfg.helperRoleIds,
    ...(cfg.adminRoleId ? [cfg.adminRoleId] : []),
  ];
  const eligible = sql`e.context='PRODUCTION' AND NOT e.screening_pending AND NOT e.is_guest AND e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND GREATEST(e.screening_observed_at,e.guest_observed_at)<=${to} AND NOT(COALESCE(st.roles,'{}'::text[])&&${staff}::text[])`;
  const selected = sql`COALESCE(ch.parent_id,m.channel_id)=ANY(${channels}::text[]) AND ch.channel_type IS DISTINCT FROM 12`;
  const rows = await sql<{
    posts: number;
    replies: number;
    latency: number | null;
    waiting: number;
    legacy: boolean;
    unknown_roles: boolean;
  }>`SELECT count(*)::int AS posts,count(m.first_reply_seconds)::int AS replies,${previewOnly ? sql`NULL::double precision` : sql`percentile_cont(0.5) WITHIN GROUP(ORDER BY m.first_reply_seconds)`} AS latency,count(*) FILTER(WHERE m.first_reply_seconds IS NULL AND m.sent_at<=${to}::timestamptz-interval '1 day')::int AS waiting,COALESCE(bool_or(m.definition_version<>'observation-v3'),false) AS legacy,COALESCE(bool_or(st.roles_observed_at IS NULL),false) AS unknown_roles FROM message_observations m JOIN membership_episodes e ON e.organization_id=m.organization_id AND e.guild_id=m.guild_id AND e.id=m.episode_id LEFT JOIN member_observable_state st ON st.organization_id=e.organization_id AND st.guild_id=e.guild_id AND st.episode_id=e.id LEFT JOIN discord_surface_state ch ON ch.organization_id=m.organization_id AND ch.guild_id=m.guild_id AND ch.channel_id=m.channel_id WHERE m.organization_id=${s.organizationId}::uuid AND m.guild_id=${s.guildId} AND ${eligible} AND ${selected} AND m.sent_at>=${from} AND m.sent_at<${to} AND (${type !== "NEW_MEMBERS"} OR (e.joined_at>=${from} AND e.joined_at<${to}))`.execute(
    tx,
  );
  const members = await sql<{
    n: number;
    unknown_roles: boolean;
  }>`SELECT count(*)::int AS n,COALESCE(bool_or(st.roles_observed_at IS NULL),false) AS unknown_roles FROM membership_episodes e LEFT JOIN member_observable_state st ON st.organization_id=e.organization_id AND st.guild_id=e.guild_id AND st.episode_id=e.id WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND ${eligible} AND e.joined_at>=${from} AND e.joined_at<${to}`.execute(
    tx,
  );
  const signals = await sql<{
    kind: string;
    n: number;
    mixed: boolean;
    unknown_roles: boolean;
  }>`SELECT l.kind,sum(l.observations)::int AS n,COALESCE(bool_or(st.roles_observed_at IS NULL),false) AS unknown_roles,bool_or(l.recipe_key<>${recipe?.id ?? ""} OR l.definition_version<>'observation-v3') AS mixed FROM lifecycle_daily_rollups l JOIN membership_episodes e ON e.organization_id=l.organization_id AND e.guild_id=l.guild_id AND e.id=l.episode_id LEFT JOIN member_observable_state st ON st.organization_id=e.organization_id AND st.guild_id=e.guild_id AND st.episode_id=e.id WHERE l.organization_id=${s.organizationId}::uuid AND l.guild_id=${s.guildId} AND ${eligible} AND l.day>=(${from}::timestamptz AT TIME ZONE 'UTC')::date AND day<(${to}::timestamptz AT TIME ZONE 'UTC')::date AND kind IN ('voice.connected','scheduled_event.subscribed','scheduled_event.attended') AND (channel_key=ANY(${channels}::text[]) OR (kind='scheduled_event.subscribed' AND channel_key='')) GROUP BY l.kind`.execute(
    tx,
  );
  const metrics: AnalysisMetric[] = [],
    r = rows.rows[0]!;
  function add(
    key: string,
    definitionKey: string,
    value: number | null,
    sample: number,
    unit: AnalysisMetric["unit"] = "COUNT",
    minimum = 1,
    unknown = false,
    mixed = false,
    unknownRoles = false,
  ) {
    const def = measurementDefinition(definitionKey),
      coverage = metricCoverage(def.surfaces, snapshot, cfg, context);
    const reasons = [
      ...coverage.reasons,
      ...(unknown ? ["LEGACY_REPLY_SEMANTICS_UNKNOWN"] : []),
      ...(mixed ? ["RECIPE_CHANGED_OR_LEGACY"] : []),
      ...(staff.length && unknownRoles
        ? ["STAFF_CLASSIFICATION_UNOBSERVED"]
        : []),
    ];
    const state = unknown
      ? "UNKNOWN"
      : mixed || (staff.length && unknownRoles) || context.safety
        ? "PARTIAL"
        : coverage.state;
    const evidence = metricEvidence({
      metricKey: key,
      definitionVersion: analysisRecipeVersion + ":" + def.version + ":" + type,
      definition: def.version,
      value: sample ? value : null,
      numerator: sample,
      denominator: sample ? null : 0,
      sampleSize: sample,
      minimumSample: minimum,
      coverageState: state,
      coverageReasons: reasons,
      requiredSurfaces: def.surfaces,
      evidenceSources: def.sources,
      windowStart: from.toISOString(),
      windowEnd: to.toISOString(),
      collectionEpochIds: epochs.slice(0, 128).map((e) => e.id),
      comparisonBlockers: [
        ...(context.safety ? ["SAFETY_CONTEXT"] : []),
        ...(epochs.length > 128 ? ["EPOCH_LIMIT"] : []),
      ],
      available: state !== "UNKNOWN",
    });
    metrics.push({ key, unit, evidence, quality: quality(evidence) });
  }
  if (type === "OVERALL" || type === "NEW_MEMBERS")
    add(
      "new_members",
      "new_members",
      members.rows[0]!.n,
      members.rows[0]!.n,
      "COUNT",
      1,
      false,
      false,
      members.rows[0]!.unknown_roles,
    );
  if (["OVERALL", "NEW_MEMBERS", "SUPPORT"].includes(type)) {
    add(
      "observed_posts",
      "analysisPosts",
      r.posts,
      r.posts,
      "COUNT",
      1,
      false,
      false,
      r.unknown_roles,
    );
    add(
      "observed_replies",
      "analysisReplies",
      r.replies,
      r.posts,
      "COUNT",
      1,
      r.legacy,
      false,
      r.unknown_roles,
    );
    add(
      "first_reply_seconds",
      "analysisReplyLatency",
      r.latency,
      r.replies,
      "SECONDS",
      5,
      r.legacy,
      false,
      r.unknown_roles,
    );
    add(
      "waiting_response",
      "analysisWaiting",
      r.waiting,
      r.posts,
      "COUNT",
      1,
      r.legacy,
      false,
      r.unknown_roles,
    );
  }
  if (type === "OVERALL" || type === "VOICE") {
    const row = signals.rows.find((r) => r.kind === "voice.connected");
    add(
      "voice_copresence",
      "voiceCopresence",
      row?.n ?? null,
      row?.n ?? 0,
      "COUNT",
      1,
      false,
      row?.mixed,
      row?.unknown_roles,
    );
  }
  if (type === "OVERALL" || type === "EVENTS")
    for (const [key, kind, def] of [
      ["event_signups", "scheduled_event.subscribed", "eventSubscriptions"],
      ["event_attendance", "scheduled_event.attended", "eventAttendance"],
    ] as const) {
      const row = signals.rows.find((r) => r.kind === kind);
      add(
        key,
        def,
        row?.n ?? null,
        row?.n ?? 0,
        "COUNT",
        1,
        false,
        row?.mixed,
        row?.unknown_roles,
      );
    }
  const observed = metrics.filter(
    (m) =>
      m.evidence.value !== null && m.evidence.observationState === "OBSERVED",
  );
  const dataQuality = !observed.length
    ? "NO_DATA"
    : metrics.every(
          (m) => m.quality === "COMPLETE" || m.quality === "NOT_APPLICABLE",
        )
      ? "COMPLETE"
      : "PARTIAL";
  const waiting = metrics.find((m) => m.key === "waiting_response");
  return {
    schemaVersion: 1,
    summary: dataQuality === "COMPLETE" ? "OBSERVED" : "PARTIAL",
    metrics,
    concerns:
      waiting?.evidence.value && waiting.quality === "COMPLETE"
        ? [
            {
              key: "waiting_response",
              metricKey: waiting.key,
              reason: "WAITING_RESPONSE",
              value: waiting.evidence.value,
              evidence: waiting.evidence,
            },
          ]
        : [],
    importantChanges: [],
    recommendedActions: waiting?.evidence.value
      ? ["REVIEW_WAITING_RESPONSE"]
      : [],
    dataQuality,
    comparisonMetadata: {
      recipeVersion: analysisRecipeVersion,
      scopeIdentity,
      periodDays: days,
    },
  };
}
