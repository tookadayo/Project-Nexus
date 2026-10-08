import { sql, tenant, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { Settings } from "../../settings/src/index";
import { latestCapability, analysisChannelScope } from "../../lifecycle/src/discovery";
import {
  integrationHealth,
  collectionEpochs,
} from "../../lifecycle/src/observation";
import { currentRecipe } from "../../settings/src/recipes";
import { metricCoverage, locationPopulationCoversWindowStart, type EvidenceContext } from "./evidence";
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
  const [snapshot, health, epochs, recipe, gap, populationWindowCovered] = await Promise.all([
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
    locationPopulationCoversWindowStart(tx,s,from),
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
  const scope = await analysisChannelScope(tx,s,cfg),
    supportChannels = scope.resolutions.filter(c => c.selected && ["SUPPORT","BUG_REPORT"].includes(c.effectivePurpose)).map(c => c.actualChannelId),
    announcementChannels = scope.resolutions.filter(c => c.selected && c.effectivePurpose === "ANNOUNCEMENT").map(c=>c.actualChannelId),
    showcaseChannels = scope.resolutions.filter(c => c.selected && c.effectivePurpose === "SHOWCASE").map(c=>c.actualChannelId),
    forumChannels = scope.resolutions.filter(c => c.surface === "FORUM_POST" || c.surface === "MEDIA_POST").map(c=>c.actualChannelId),
    channels = type === "SUPPORT" ? supportChannels : type === "ANNOUNCEMENTS" ? announcementChannels : type === "SHOWCASE" ? showcaseChannels : scope.actualChannelIds;
  const effectiveSnapshot = snapshot ? {...snapshot,channels:scope.channels.map(c=>({...c,tagIds:snapshot.channels.find(old=>old.id===c.id)?.tagIds ?? []}))} : null;
  const staff = [
    ...cfg.staffRoleIds,
    ...cfg.managerRoleIds,
    ...cfg.helperRoleIds,
    ...(cfg.adminRoleId ? [cfg.adminRoleId] : []),
  ];
  const eligible = sql`e.context='PRODUCTION' AND NOT e.screening_pending AND NOT e.is_guest AND e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND GREATEST(e.screening_observed_at,e.guest_observed_at)<=${to} AND NOT(COALESCE(st.roles,'{}'::text[])&&${staff}::text[])`;
  const selected = sql`m.channel_id=ANY(${channels}::text[])`;
  const rows = await sql<{
    posts: number;
    replies: number;
    latency: number | null;
    waiting: number;
    legacy: boolean;
    legacy_population: boolean;
    unknown_roles: boolean;
    announcement_posts:number;
    bot_posts:number;
    comments:number;
    showcase_posts:number;
  }>`WITH observed AS (
   SELECT p.organization_id,p.guild_id,p.message_id,p.channel_id,p.sent_at,CASE WHEN p.sent_at+p.first_reply_seconds*interval '1 second'<${to} THEN p.first_reply_seconds END AS first_reply_seconds,CASE WHEN o.definition_version IS NOT NULL AND o.definition_version<>'observation-v3' THEN o.definition_version ELSE p.definition_version END AS definition_version,p.author_kind,p.message_type,p.reference_id,o.episode_id,p.population_source<>'LOCATION_STREAM_V1' AS legacy_population FROM location_post_observations p LEFT JOIN message_observations o ON o.organization_id=p.organization_id AND o.guild_id=p.guild_id AND o.message_id=p.message_id WHERE p.organization_id=${s.organizationId}::uuid AND p.guild_id=${s.guildId}
   UNION ALL SELECT o.organization_id,o.guild_id,o.message_id,o.channel_id,o.sent_at,CASE WHEN o.sent_at+o.first_reply_seconds*interval '1 second'<${to} THEN o.first_reply_seconds END,o.definition_version,'HUMAN',0,NULL,o.episode_id,true FROM message_observations o WHERE o.organization_id=${s.organizationId}::uuid AND o.guild_id=${s.guildId} AND NOT EXISTS(SELECT 1 FROM location_post_observations p WHERE p.organization_id=o.organization_id AND p.guild_id=o.guild_id AND p.message_id=o.message_id)
  ) SELECT count(*)::int AS posts,count(m.first_reply_seconds)::int AS replies,${previewOnly ? sql`NULL::double precision` : sql`percentile_cont(0.5) WITHIN GROUP(ORDER BY m.first_reply_seconds)`} AS latency,count(*) FILTER(WHERE m.channel_id=ANY(${supportChannels}::text[]) AND m.first_reply_seconds IS NULL AND m.author_kind='HUMAN' AND m.reference_id IS NULL AND (NOT(m.channel_id=ANY(${forumChannels}::text[])) OR m.message_id=m.channel_id) AND m.sent_at<=${to}::timestamptz-interval '1 day')::int AS waiting,count(*) FILTER(WHERE m.channel_id=ANY(${announcementChannels}::text[]))::int AS announcement_posts,count(*) FILTER(WHERE m.author_kind IN ('BOT','WEBHOOK'))::int AS bot_posts,count(*) FILTER(WHERE m.channel_id=ANY(${forumChannels}::text[]) AND m.message_id<>m.channel_id)::int AS comments,count(*) FILTER(WHERE m.channel_id=ANY(${showcaseChannels}::text[]) AND (NOT(m.channel_id=ANY(${forumChannels}::text[])) OR m.message_id=m.channel_id))::int AS showcase_posts,COALESCE(bool_or(m.definition_version<>'observation-v3'),false) AS legacy,COALESCE(bool_or(m.legacy_population),false) AS legacy_population,COALESCE(bool_or(st.roles_observed_at IS NULL),false) AS unknown_roles FROM observed m LEFT JOIN membership_episodes e ON e.organization_id=m.organization_id AND e.guild_id=m.guild_id AND e.id=m.episode_id LEFT JOIN member_observable_state st ON st.organization_id=e.organization_id AND st.guild_id=e.guild_id AND st.episode_id=e.id LEFT JOIN discord_surface_state ch ON ch.organization_id=m.organization_id AND ch.guild_id=m.guild_id AND ch.channel_id=m.channel_id WHERE ${selected} AND m.sent_at>=${from} AND m.sent_at<${to} AND (${type !== "NEW_MEMBERS"} OR (${eligible} AND e.joined_at>=${from} AND e.joined_at<${to}))`.execute(
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
  }>`SELECT l.kind,CASE WHEN l.kind='voice.connected' THEN count(DISTINCT l.episode_id)::int ELSE sum(l.observations)::int END AS n,COALESCE(bool_or(st.roles_observed_at IS NULL),false) AS unknown_roles,bool_or(l.recipe_key<>${recipe?.id ?? ""} OR l.definition_version<>'observation-v3') AS mixed FROM lifecycle_daily_rollups l JOIN membership_episodes e ON e.organization_id=l.organization_id AND e.guild_id=l.guild_id AND e.id=l.episode_id LEFT JOIN member_observable_state st ON st.organization_id=e.organization_id AND st.guild_id=e.guild_id AND st.episode_id=e.id WHERE l.organization_id=${s.organizationId}::uuid AND l.guild_id=${s.guildId} AND ${eligible} AND l.day>=(${from}::timestamptz AT TIME ZONE 'UTC')::date AND day<(${to}::timestamptz AT TIME ZONE 'UTC')::date AND kind IN ('voice.connected','scheduled_event.subscribed','scheduled_event.attended') AND (channel_key=ANY(${channels}::text[]) OR (kind='scheduled_event.subscribed' AND channel_key='')) GROUP BY l.kind`.execute(
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
    minimum = 0,
    unknown = false,
    mixed = false,
    unknownRoles = false,
  ) {
    const def = measurementDefinition(definitionKey),
      coverage = metricCoverage(def.surfaces, effectiveSnapshot, cfg, context);
    const inaccessible = def.surfaces.includes("textVisibility") && channels.length === 0 && (scope.missingChannelIds.length>0 || scope.resolutions.some(c=>["PERMISSION_MISSING","DELETED","FORBIDDEN","PARENT_UNKNOWN","UNSUPPORTED_TYPE"].includes(c.collectionEligibility) && (cfg.analysisScope.mode !== "include" || cfg.analysisScope.channelIds.includes(c.actualChannelId) || Boolean(c.parentChannelId && cfg.analysisScope.channelIds.includes(c.parentChannelId)))));
    // Participant projections prove their human cohort only. Even v3 reply
    // semantics do not prove collection of the full staff/Bot post population.
    const populationMetric = type !== "NEW_MEMBERS" && ["observed_posts", "observed_replies", "first_reply_seconds", "waiting_response", "announcement_posts", "bot_webhook_posts", "showcase_posts", "observed_comments"].includes(key);
    const incompletePopulation = populationMetric && (!populationWindowCovered || r.legacy_population);
    const unconfirmedZero = populationMetric && value === 0 && (incompletePopulation || coverage.state !== "COMPLETE" || mixed || Boolean(staff.length && unknownRoles) || context.safety || epochs.length > 128);
    const reasons = [
      ...coverage.reasons,
      ...(incompletePopulation ? ["LEGACY_PARTICIPANT_ONLY_COVERAGE"] : []),
      ...(inaccessible ? ["SELECTED_LOCATION_UNAVAILABLE"] : []),
      ...(unknown ? ["LEGACY_REPLY_SEMANTICS_UNKNOWN"] : []),
      ...(mixed ? ["RECIPE_CHANGED_OR_LEGACY"] : []),
      ...(staff.length && unknownRoles
        ? ["STAFF_CLASSIFICATION_UNOBSERVED"]
        : []),
    ];
    const state = unknown || inaccessible || coverage.state === "UNKNOWN" || unconfirmedZero
      ? "UNKNOWN"
      : mixed || (staff.length && unknownRoles) || context.safety
        ? "PARTIAL"
        : incompletePopulation
          ? ["first_reply_seconds", "waiting_response"].includes(key) || coverage.state === "PARTIAL" ? "PARTIAL" : "LOWER_BOUND"
        : coverage.state;
    const evidence = metricEvidence({
      metricKey: key,
      definitionVersion: analysisRecipeVersion + ":" + def.version + ":" + type,
      definition: def.version,
      value,
      numerator: sample,
      denominator: null,
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
      0,
      false,
      false,
      members.rows[0]!.unknown_roles,
    );
  if (["OVERALL", "NEW_MEMBERS", "SUPPORT","ANNOUNCEMENTS","SHOWCASE"].includes(type)) {
    add(
      "observed_posts",
      "analysisPosts",
      r.posts,
      r.posts,
      "COUNT",
      0,
      false,
      false,
      type === "NEW_MEMBERS" && r.unknown_roles,
    );
    add(
      "observed_replies",
      "analysisReplies",
      r.replies,
      r.posts,
      "COUNT",
      0,
      r.legacy,
      false,
      type === "NEW_MEMBERS" && r.unknown_roles,
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
      type === "NEW_MEMBERS" && r.unknown_roles,
    );
    if (supportChannels.length && !["ANNOUNCEMENTS","SHOWCASE"].includes(type)) add(
      "waiting_response",
      "analysisWaiting",
      r.waiting,
      r.posts,
      "COUNT",
      0,
      r.legacy,
      false,
      type === "NEW_MEMBERS" && r.unknown_roles,
    );
  }
  if (["OVERALL","ANNOUNCEMENTS","SHOWCASE"].includes(type)) {
    if (announcementChannels.length) add("announcement_posts","analysisPosts",r.announcement_posts,r.announcement_posts,"COUNT",0);
    add("bot_webhook_posts","analysisPosts",r.bot_posts,r.bot_posts,"COUNT",0);
    const states = await sql<{reactions:number;polls:number}>`SELECT (SELECT count(*)::int FROM reaction_state WHERE ${tenant(s)} AND active AND channel_id=ANY(${channels}::text[]) AND observed_at>=${from} AND observed_at<${to}) AS reactions,(SELECT count(DISTINCT subject_hash)::int FROM poll_participant_state WHERE ${tenant(s)} AND answer_count>0 AND channel_id=ANY(${channels}::text[]) AND observed_at>=${from} AND observed_at<${to}) AS polls`.execute(tx);
    add("observed_reactions","activeReactions",states.rows[0]!.reactions,states.rows[0]!.reactions,"COUNT",0);
    add("poll_participants","pollParticipants",states.rows[0]!.polls,states.rows[0]!.polls,"COUNT",0);
    if (type === "SHOWCASE") {
      add("showcase_posts","showcasePosts",r.showcase_posts,r.showcase_posts,"COUNT",0);
      add("observed_comments","analysisComments",r.comments,r.comments,"COUNT",0);
    }
  }
  if (type === "OVERALL" || type === "VOICE") {
    const row = signals.rows.find((r) => r.kind === "voice.connected");
    add(
      "voice_copresence",
      "voiceCopresence",
      row?.n ?? null,
      row?.n ?? 0,
      "COUNT",
      0,
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
      m.evidence.value !== null && m.evidence.sampleSize>0 && m.evidence.observationState === "OBSERVED",
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
