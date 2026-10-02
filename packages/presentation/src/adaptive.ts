import { sql, tenant, type Database } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import {
  volumeMode,
  type CapabilitySnapshot,
  type CommunityModel,
} from "../../shared/src/community-model";
import type { Settings } from "../../settings/src/index";
import { latestCapability } from "../../lifecycle/src/discovery";
import {buildMetricEvidence,evidenceContext} from '../../analytics/src/evidence';
import type {MetricEvidence} from '../../shared/src/metric-evidence';
import type {IntegrationHealth,CollectionEpoch} from '../../shared/src/integration-health';
import {type RecipeVersion} from '../../settings/src/recipes';
import {recipeCandidates,type ModelCandidate} from '../../shared/src/measurement-recipes';
import {journeyAnalysis,type JourneyTransition} from '../../analytics/src/journeys';
export type AdaptiveMetric = {
  key: string;
  count: number | null;
  sample: number;
  denominator: number | null;
  medianMinutes?: number | null;
  p75Minutes?: number | null;
  p90Minutes?: number | null;
  definition: string;
  state: "OBSERVED" | "PENDING" | "PARTIAL" | "UNKNOWN";
  surface?: string;
  purpose?: string;
  evidence?: MetricEvidence;
};
export type AdaptivePresentation = {
  progress?: {
    entered: number;
    eligible: number;
    first: number;
    connected: number;
    repeated: number;
    retained: number;
    pending: number;
    insufficient: number;
    from: string;
    through: string;
    observationDays: number;
    repeatDays: number;
    returnFromDay: number;
    returnThroughDay: number;
  };
  profile: CommunityModel;
  recipe?: RecipeVersion|null;
  journeys?:{recipeId:string|null;transitions:JourneyTransition[]};
  modelV2?:{capability:CapabilitySnapshot['capabilities'];observedUsage:Record<string,number>;adminIntent:CommunityModel;inferredPattern:{scale:string;trafficPerDay:number;newcomerVolume:number};candidates:ModelCandidate[];activeSurfaces:string[]};
  capabilities: CapabilitySnapshot | null;
  volume: "LOW_VOLUME" | "STANDARD" | "HIGH_VOLUME";
  window: { from: string; through: string };
  coverage: {
    ratio: number | null;
    partial: boolean;
    observableChannels: number;
    totalRelevantChannels: number;
  };
  eligible: number;
  unknownMembers?: number;
  integration?: IntegrationHealth;
  epochs?: CollectionEpoch[];
  pending: number;
  guests: number;
  journey: {
    onboardingStarted: number;
    onboardingCompleted: number;
    guideStarted: number;
    guideCompleted: number;
    screeningPassed: number;
  };
  metrics: AdaptiveMetric[];
  caveats: string[];
  collectionSince: string | null;
};
export async function adaptivePresentation(
  db: Database,
  s: Scope,
  cfg: Settings,
  range: number,
  now: Date,
  attention: number,
  staffRoles: string[] = [],
): Promise<AdaptivePresentation> {
  const snapshot = await latestCapability(db, s),
    from = new Date(now.getTime() - range * 86400000),
    roles = [
      ...new Set([
        ...cfg.staffRoleIds,
        ...cfg.managerRoleIds,
        ...cfg.helperRoleIds,
        ...staffRoles,
        ...(cfg.adminRoleId ? [cfg.adminRoleId] : []),
      ]),
    ];
  const members = (
    await sql<{
      eligible: number;
      pending: number;
      guests: number;
      joined: number;
      unknown: number;
    }>`SELECT count(*) FILTER(WHERE e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND NOT e.screening_pending AND NOT e.is_guest)::integer AS eligible,count(*) FILTER(WHERE e.screening_observed_at IS NOT NULL AND e.screening_pending)::integer AS pending,count(*) FILTER(WHERE e.guest_observed_at IS NOT NULL AND e.is_guest)::integer AS guests,count(*) FILTER(WHERE e.screening_observed_at IS NULL OR e.guest_observed_at IS NULL)::integer AS unknown,count(*) FILTER(WHERE e.joined_at>=${new Date(now.getTime() - 30 * 86400000)})::integer AS joined FROM membership_episodes e LEFT JOIN member_observable_state st ON st.organization_id=e.organization_id AND st.guild_id=e.guild_id AND st.episode_id=e.id WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.context='PRODUCTION' AND e.left_at IS NULL AND NOT(COALESCE(st.roles,'{}'::text[])&&${roles}::text[])`.execute(
      db,
    )
  ).rows[0]!;
  const scopeFilter = (data: string) => {
    if (cfg.analysisScope.mode === "all") return sql`true`;
    const ref = sql.ref(data);
    return sql`(${ref}->>'channelId' IS NULL OR ${cfg.analysisScope.mode}='all' OR (${cfg.analysisScope.mode}='include')=(COALESCE((SELECT parent_id FROM discord_surface_state ch WHERE ch.organization_id=${s.organizationId}::uuid AND ch.guild_id=${s.guildId} AND ch.channel_id=${ref}->>'channelId'),${ref}->>'channelId')=ANY(${cfg.analysisScope.channelIds}::text[])))`;
  };
  const staffFilter = (hash: string) =>
    roles.length
      ? sql`NOT EXISTS(SELECT 1 FROM member_identity_map m JOIN membership_episodes e ON e.organization_id=m.organization_id AND e.guild_id=m.guild_id AND e.identity_id=m.id JOIN member_observable_state st ON st.organization_id=e.organization_id AND st.guild_id=e.guild_id AND st.episode_id=e.id WHERE m.organization_id=${s.organizationId}::uuid AND m.guild_id=${s.guildId} AND m.lookup_hash=${sql.ref(hash)} AND st.roles&&${roles}::text[])`
      : sql`true`;
  const facts = (
      await sql<{
        kind: string;
        count: number;
        sample: number;
      }>`SELECT kind,count(*)::integer AS count,count(DISTINCT subject_hash) FILTER(WHERE subject_hash<>'')::integer AS sample FROM adaptive_facts f WHERE ${tenant(s)} AND occurred_at>=${from} AND occurred_at<=${now} AND ${scopeFilter("f.data")} AND ${staffFilter("f.subject_hash")} GROUP BY kind`.execute(
        db,
      )
    ).rows,
    counts = new Map(facts.map((f) => [f.kind, f])),
    count = (key: string) => counts.get(key)?.count ?? 0;
  const active = (
      await sql<{
        domain: string;
        count: number;
        sample: number;
      }>`SELECT domain,count(DISTINCT (subject_hash,data->>'messageId'))::integer AS count,count(DISTINCT subject_hash)::integer AS sample FROM adaptive_states a WHERE ${tenant(s)} AND domain IN ('reaction','poll') AND (domain='poll' OR target_hash IS NOT NULL) AND data->>'active'='true' AND observed_at>=${from} AND observed_at<=${now} AND ${scopeFilter("a.data")} AND ${staffFilter("a.subject_hash")} GROUP BY domain`.execute(
        db,
      )
    ).rows,
    states = new Map(active.map((f) => [f.domain, f]));
  const guestSessions =
    (
      await sql<{
        count: number;
      }>`SELECT count(DISTINCT subject_hash)::integer AS count FROM adaptive_states WHERE ${tenant(s)} AND (domain='guest' OR domain='voice' AND data->>'guest'='true')`.execute(
        db,
      )
    ).rows[0]?.count ?? 0;
  const responses = (
    await sql<{
      surface: string;
      purpose: string;
      sample: number;
      median: number;
      p75: number;
      p90: number;
    }>`SELECT data->>'surface' AS surface,data->>'purpose' AS purpose,count(*)::integer AS sample,percentile_cont(.5) WITHIN GROUP(ORDER BY (data->>'latencySeconds')::numeric/60)::double precision AS median,percentile_cont(.75) WITHIN GROUP(ORDER BY (data->>'latencySeconds')::numeric/60)::double precision AS p75,percentile_cont(.9) WITHIN GROUP(ORDER BY (data->>'latencySeconds')::numeric/60)::double precision AS p90 FROM adaptive_facts f WHERE ${tenant(s)} AND kind='thread.response_received' AND occurred_at>=${from} AND occurred_at<=${now} AND ${scopeFilter("f.data")} AND ${staffFilter("f.subject_hash")} GROUP BY data->>'surface',data->>'purpose'`.execute(
      db,
    )
  ).rows;
  const reply = (
    await sql<{
      sample: number;
      median: number | null;
      p75: number | null;
      p90: number | null;
    }>`SELECT count(*)::integer AS sample,percentile_cont(.5) WITHIN GROUP(ORDER BY (data->>'latencySeconds')::numeric/60)::double precision AS median,percentile_cont(.75) WITHIN GROUP(ORDER BY (data->>'latencySeconds')::numeric/60)::double precision AS p75,percentile_cont(.9) WITHIN GROUP(ORDER BY (data->>'latencySeconds')::numeric/60)::double precision AS p90 FROM lifecycle_events f JOIN membership_episodes ep ON ep.organization_id=f.organization_id AND ep.guild_id=f.guild_id AND ep.id=f.episode_id WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.kind='reply.received' AND f.context='PRODUCTION' AND f.occurred_at>=${from} AND f.occurred_at<=${now} AND ep.screening_observed_at IS NOT NULL AND ep.guest_observed_at IS NOT NULL AND NOT ep.screening_pending AND NOT ep.is_guest AND ${scopeFilter("f.data")} AND ${roles.length ? sql`NOT EXISTS(SELECT 1 FROM member_observable_state st WHERE st.organization_id=ep.organization_id AND st.guild_id=ep.guild_id AND st.episode_id=ep.id AND st.roles&&${roles}::text[])` : sql`true`}`.execute(
      db,
    )
  ).rows[0]!;
  const partial =
      !snapshot ||
      snapshot.coverage.coverageState !== "COMPLETE",
    metrics: AdaptiveMetric[] = [],
    modes = cfg.communityModel.confirmed ? cfg.communityModel.modes : [],
    has = (key: string) =>
      snapshot &&
      ["ENABLED", "OBSERVED", "CONFIGURED", "AVAILABLE"].includes(
        snapshot.capabilities[key]?.status ?? "UNKNOWN",
      );
  const add = (
    key: string,
    value: number,
    sample: number,
    definition: string,
    denominator: number | null = null,
  ) =>
    metrics.push({
      key,
      count: snapshot ? value : null,
      sample,
      denominator,
      definition,
      state: !snapshot
        ? "UNKNOWN"
        : partial
          ? "PARTIAL"
          : sample
            ? "OBSERVED"
            : "PENDING",
    });
  if (
    modes.some((m) =>
      [
        "SOCIAL",
        "LFG_PLAY",
        "SUPPORT_QA",
        "DEVELOPMENT_FEEDBACK",
        "CONTENT_SHOWCASE",
      ].includes(m),
    ) &&
    (has("text") || has("threads") || has("forum"))
  ) {
    add(
      "directReplies",
      reply.sample,
      reply.sample,
      "Explicit reply references from another human; median elapsed minutes.",
    );
    Object.assign(metrics.at(-1)!, {
      medianMinutes: reply.median,
      p75Minutes: reply.p75,
      p90Minutes: reply.p90,
    });
  }
  const postGroups = (
    await sql<{
      unanswered: number;
      purpose: string;
      surface: string;
      count: number;
      sample: number;
    }>`SELECT data->>'purpose' AS purpose,data->>'surface' AS surface,count(*)::integer AS count,count(DISTINCT subject_hash)::integer AS sample,count(*) FILTER(WHERE NOT EXISTS(SELECT id FROM adaptive_facts r WHERE r.organization_id=f.organization_id AND r.guild_id=f.guild_id AND r.kind='thread.response_received' AND r.data->>'channelId'=f.data->>'channelId' AND r.occurred_at<=${now}))::integer AS unanswered FROM adaptive_facts f WHERE ${tenant(s)} AND kind='thread.created' AND EXISTS(SELECT 1 FROM member_identity_map m JOIN membership_episodes e ON e.organization_id=m.organization_id AND e.guild_id=m.guild_id AND e.identity_id=m.id WHERE m.organization_id=f.organization_id AND m.guild_id=f.guild_id AND m.lookup_hash=f.subject_hash AND e.context='PRODUCTION' AND e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND NOT e.screening_pending AND NOT e.is_guest AND e.joined_at<=f.occurred_at AND (e.left_at IS NULL OR e.left_at>f.occurred_at)) AND occurred_at>=${from} AND occurred_at<=${now} AND ${scopeFilter("f.data")} AND ${staffFilter("f.subject_hash")} GROUP BY data->>'purpose',data->>'surface'`.execute(
      db,
    )
  ).rows;
  for (const post of postGroups) {
    const key =
      post.purpose === "LFG" && modes.includes("LFG_PLAY")
        ? "lfgPosts"
        : post.purpose === "SUPPORT" && modes.includes("SUPPORT_QA")
          ? "supportPosts"
          : ["BUG_REPORT", "FEEDBACK"].includes(post.purpose) &&
              modes.includes("DEVELOPMENT_FEEDBACK")
            ? "feedbackPosts"
            : post.surface === "MEDIA_POST" &&
                modes.includes("CONTENT_SHOWCASE")
              ? "showcasePosts"
              : null;
    if (!key) continue;
    add(
      key,
      post.count,
      post.sample,
      "Posts whose creation was observed in the selected window; no historical backfill.",
      null,
    );
    Object.assign(metrics.at(-1)!, {
      surface: post.surface,
      purpose: post.purpose,
    });
    add(
      "postsAwaitingResponse",
      post.unanswered,
      post.count,
      "Observed new posts without a first other-human message; silence does not prove failure or unresolved status.",
      post.count,
    );
    Object.assign(metrics.at(-1)!, {
      surface: post.surface,
      purpose: post.purpose,
    });
  }
  for (const response of responses) {
    const allowed =
      (response.purpose === "LFG" && modes.includes("LFG_PLAY")) ||
      (response.purpose === "SUPPORT" && modes.includes("SUPPORT_QA")) ||
      (["BUG_REPORT", "FEEDBACK"].includes(response.purpose) &&
        modes.includes("DEVELOPMENT_FEEDBACK")) ||
      (response.surface === "MEDIA_POST" && modes.includes("CONTENT_SHOWCASE"));
    if (allowed)
      metrics.push({
        key: "postResponse",
        count: response.sample,
        sample: response.sample,
        denominator: null,
        medianMinutes: response.median,
        p75Minutes: response.p75,
        p90Minutes: response.p90,
        definition:
          "First message from another human in an observed post. A shared thread alone is not a direct reply.",
        state: "PARTIAL",
        surface: response.surface,
        purpose: response.purpose,
      });
  }
  if (modes.includes("SUPPORT_QA") && has("forum")) {
    const resolved =
      (
        await sql<{
          count: number;
        }>`SELECT count(*)::integer AS count FROM discord_surface_state ch WHERE ${tenant(s)} AND (${cfg.analysisScope.mode}='all' OR (${cfg.analysisScope.mode}='include')=(COALESCE(parent_id,channel_id)=ANY(${cfg.analysisScope.channelIds}::text[]))) AND ${staffFilter("ch.owner_hash")} AND EXISTS(SELECT 1 FROM jsonb_array_elements(${JSON.stringify(cfg.communityModel.forumTags)}::jsonb) t WHERE t->>'channelId'=parent_id AND t->>'meaning'='RESOLVED' AND t->>'tagId'=ANY(tag_ids))`.execute(
          db,
        )
      ).rows[0]?.count ?? 0;
    add(
      "resolvedPosts",
      resolved,
      resolved,
      "Current posts with an administrator-mapped RESOLVED tag; archive and lock are not resolution.",
      null,
    );
  }
  if ((modes.includes("VOICE") || modes.includes("LFG_PLAY")) && has("voice")) {
    const participation =
      (
        await sql<{
          count: number;
        }>`SELECT count(DISTINCT subject_hash)::integer AS count FROM adaptive_facts f WHERE ${tenant(s)} AND kind IN ('voice.joined','voice.moved') AND data->>'surface'='VOICE_TEXT' AND data->>'guest'='false' AND occurred_at>=${from} AND occurred_at<=${now} AND ${scopeFilter("f.data")} AND ${staffFilter("f.subject_hash")}`.execute(
          db,
        )
      ).rows[0]?.count ?? 0;
    add(
      "voiceParticipants",
      participation,
      participation,
      "Observed ordinary human Voice participation; joining does not prove co-presence or conversation.",
    );
    add(
      "voiceCopresence",
      counts.get("voice.copresence")?.sample ?? 0,
      counts.get("voice.copresence")?.sample ?? 0,
      `Observed human co-presence for at least ${cfg.communityModel.voiceThresholdSeconds / 60} minutes; excludes bots, AFK, guests, Stage audience. This does not prove conversation.`,
    );
  }
  if (modes.includes("LFG_PLAY") && (has("threads") || has("text"))) {
    const lfg = (
      await sql<{
        posts: number;
        after_voice: number;
      }>`SELECT count(*) FILTER(WHERE f.kind='thread.created')::integer AS posts,count(DISTINCT f.subject_hash) FILTER(WHERE f.kind='voice.copresence' AND EXISTS(SELECT 1 FROM adaptive_facts p WHERE p.organization_id=f.organization_id AND p.guild_id=f.guild_id AND p.subject_hash=f.subject_hash AND p.kind='message.sent' AND p.data->>'purpose'='LFG' AND p.occurred_at<f.occurred_at AND p.occurred_at>f.occurred_at-interval '1 day'))::integer AS after_voice FROM adaptive_facts f WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.occurred_at>=${from} AND f.occurred_at<=${now} AND ${scopeFilter("f.data")} AND ${staffFilter("f.subject_hash")}`.execute(
        db,
      )
    ).rows[0]!;
    add(
      "lfgThenVoice",
      lfg.after_voice,
      lfg.after_voice,
      "LFG activity followed by observed voice co-presence within one day; matching success and same partner unknown.",
    );
  }
  if (modes.includes("EVENTS") && has("events")) {
    add(
      "eventSubscriptions",
      count("scheduled_event.subscribed"),
      counts.get("scheduled_event.subscribed")?.sample ?? 0,
      "Observed event subscriptions; not attendance.",
    );
    add(
      "eventAttendance",
      count("scheduled_event.attended"),
      counts.get("scheduled_event.attended")?.sample ?? 0,
      "Observed Voice/Stage presence during a Gateway-known ACTIVE event window; external attendance unknown.",
    );
    if (
      has("stage") &&
      (count("stage.audience_joined") ||
        count("stage.speaker_joined") ||
        count("stage.joined") ||
        snapshot?.observedUsage.stage)
    ) {
      add(
        "stageAudience",
        count("stage.audience_joined"),
        counts.get("stage.audience_joined")?.sample ?? 0,
        "Stage audience entry; listening does not prove conversation.",
      );
      add(
        "stageSpeakers",
        count("stage.speaker_joined"),
        counts.get("stage.speaker_joined")?.sample ?? 0,
        "Stage speaker state observed (suppress=false); speech itself is not observed.",
      );
    }
  }
  if (modes.includes("CREATOR_FAN") || modes.includes("CONTENT_SHOWCASE")) {
    if (count("reaction.added") || states.has("reaction"))
      add(
        "activeReactions",
        states.get("reaction")?.count ?? 0,
        states.get("reaction")?.sample ?? 0,
        "Current user/message reaction participation last observed in this window; bots/self reactions excluded. Unique humans shown as sample.",
        null,
      );
    if (count("poll.participated") || states.has("poll"))
      add(
        "pollParticipants",
        states.get("poll")?.count ?? 0,
        states.get("poll")?.sample ?? 0,
        "Current user/poll participation last observed in this window; multiple selected answers count once. No answer meaning collected.",
        null,
      );
  }
  const caveats = [
    "Only observable channels and delivered metadata are represented. Private and archived thread coverage can be partial.",
  ];
  if (!cfg.communityModel.confirmed)
    caveats.push(
      "Administrator confirmation of community purposes is pending.",
    );
  if (snapshot && Object.values(snapshot.incidents).some(Boolean))
    caveats.push(
      "A Discord safety incident flag overlaps the observed context; period comparisons need review.",
    );
  const evidence=await evidenceContext(db,s,from,now);
  for(const metric of metrics){
    metric.evidence=buildMetricEvidence(metric.key,{value:metric.count,numerator:metric.count,denominator:metric.denominator,sample:metric.sample,definition:metric.definition,requiredSurfaces:metric.purpose==='LFG'&&['postResponse','postsAwaitingResponse'].includes(metric.key)?['members','messages','threadVisibility']:undefined},snapshot,cfg,evidence);
    metric.count=metric.evidence.value;
    metric.state=metric.evidence.observationState==='UNKNOWN'?'UNKNOWN':metric.evidence.coverageState!=='COMPLETE'?'PARTIAL':metric.evidence.observationState==='OBSERVED'?'OBSERVED':'PENDING';
    if(metric.evidence.observationState==='UNKNOWN'){metric.medianMinutes=null;metric.p75Minutes=null;metric.p90Minutes=null;}
  }
  const volume=volumeMode({members:snapshot?.memberCount??members.eligible,joined30d:members.joined,eligible:members.eligible,eventsPerDay:facts.reduce((n,f)=>n+f.count,0)/range,attention});
  return {
    profile: cfg.communityModel,
    recipe:evidence.recipe,
    journeys:await journeyAnalysis(db,s,cfg,snapshot,evidence),
    modelV2:{capability:snapshot?.capabilities??{},observedUsage:snapshot?.observedUsage??{},adminIntent:cfg.communityModel,inferredPattern:{scale:volume,trafficPerDay:facts.reduce((n,f)=>n+f.count,0)/range,newcomerVolume:members.joined},candidates:recipeCandidates(snapshot,volume),activeSurfaces:[...new Set(snapshot?.channels.filter(c=>c.observable).map(c=>String(c.type))??[])]},
    capabilities: snapshot,
    volume: volumeMode({
      members: snapshot?.memberCount ?? members.eligible,
      joined30d: members.joined,
      eligible: members.eligible,
      eventsPerDay: facts.reduce((n, f) => n + f.count, 0) / range,
      attention,
    }),
    window: { from: from.toISOString(), through: now.toISOString() },
    coverage: {
      ratio: snapshot?.coverage.ratio ?? null,
      partial,
      observableChannels: snapshot?.coverage.observableChannels ?? 0,
      totalRelevantChannels: snapshot?.coverage.totalRelevantChannels ?? 0,
    },
    eligible: members.eligible,
    unknownMembers:members.unknown,
    integration:evidence.health,
    epochs:evidence.epochs,
    pending: members.pending,
    guests: members.guests + guestSessions,
    journey: {
      onboardingStarted: count("native_onboarding.started"),
      onboardingCompleted: count("native_onboarding.completed"),
      guideStarted: count("server_guide.started"),
      guideCompleted: count("server_guide.completed"),
      screeningPassed: count("screening.passed"),
    },
    metrics,
    caveats,
    collectionSince:
      snapshot?.capabilities.text?.availableSince ??
      snapshot?.checkedAt ??
      null,
  };
}
