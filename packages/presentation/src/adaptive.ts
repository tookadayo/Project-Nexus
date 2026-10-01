import { sql, tenant, type Database } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import {
  volumeMode,
  type CapabilitySnapshot,
  type CommunityModel,
} from "../../shared/src/community-model";
import type { Settings } from "../../settings/src/index";
import { latestCapability } from "../../lifecycle/src/discovery";
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
};
export type AdaptivePresentation = {
  profile: CommunityModel;
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
    }>`SELECT count(*) FILTER(WHERE NOT e.screening_pending AND NOT e.is_guest)::integer AS eligible,count(*) FILTER(WHERE e.screening_pending)::integer AS pending,count(*) FILTER(WHERE e.is_guest)::integer AS guests,count(*) FILTER(WHERE e.joined_at>=${new Date(now.getTime() - 30 * 86400000)})::integer AS joined FROM membership_episodes e LEFT JOIN member_observable_state st ON st.organization_id=e.organization_id AND st.guild_id=e.guild_id AND st.episode_id=e.id WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.context='PRODUCTION' AND e.left_at IS NULL AND NOT(COALESCE(st.roles,'{}'::text[])&&${roles}::text[])`.execute(
      db,
    )
  ).rows[0]!;
  const facts = (
      await sql<{
        kind: string;
        count: number;
        sample: number;
      }>`SELECT kind,count(*)::integer AS count,count(DISTINCT subject_hash) FILTER(WHERE subject_hash<>'')::integer AS sample FROM adaptive_facts WHERE ${tenant(s)} AND occurred_at>=${from} AND occurred_at<=${now} GROUP BY kind`.execute(
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
      }>`SELECT domain,count(DISTINCT (subject_hash,data->>'messageId'))::integer AS count,count(DISTINCT subject_hash)::integer AS sample FROM adaptive_states WHERE ${tenant(s)} AND domain IN ('reaction','poll') AND data->>'active'='true' GROUP BY domain`.execute(
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
    }>`SELECT data->>'surface' AS surface,data->>'purpose' AS purpose,count(*)::integer AS sample,percentile_cont(.5) WITHIN GROUP(ORDER BY (data->>'latencySeconds')::numeric/60)::double precision AS median,percentile_cont(.75) WITHIN GROUP(ORDER BY (data->>'latencySeconds')::numeric/60)::double precision AS p75,percentile_cont(.9) WITHIN GROUP(ORDER BY (data->>'latencySeconds')::numeric/60)::double precision AS p90 FROM adaptive_facts WHERE ${tenant(s)} AND kind='thread.response_received' AND occurred_at>=${from} AND occurred_at<=${now} GROUP BY data->>'surface',data->>'purpose'`.execute(
      db,
    )
  ).rows;
  const reply = (
    await sql<{
      sample: number;
      median: number | null;
      p75: number | null;
      p90: number | null;
    }>`SELECT count(*)::integer AS sample,percentile_cont(.5) WITHIN GROUP(ORDER BY (data->>'latencySeconds')::numeric/60)::double precision AS median,percentile_cont(.75) WITHIN GROUP(ORDER BY (data->>'latencySeconds')::numeric/60)::double precision AS p75,percentile_cont(.9) WITHIN GROUP(ORDER BY (data->>'latencySeconds')::numeric/60)::double precision AS p90 FROM lifecycle_events f JOIN membership_episodes ep ON ep.organization_id=f.organization_id AND ep.guild_id=f.guild_id AND ep.id=f.episode_id WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.kind='reply.received' AND f.context='PRODUCTION' AND f.occurred_at>=${from} AND f.occurred_at<=${now} AND NOT ep.screening_pending AND NOT ep.is_guest`.execute(
      db,
    )
  ).rows[0]!;
  const partial =
      !snapshot ||
      snapshot.coverage.ratio !== 1 ||
      snapshot.coverage.privateThreads === "PARTIAL",
    metrics: AdaptiveMetric[] = [],
    modes = cfg.communityModel.modes,
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
    denominator: number | null = members.eligible,
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
        }>`SELECT count(*)::integer AS count FROM discord_surface_state WHERE ${tenant(s)} AND EXISTS(SELECT 1 FROM jsonb_array_elements(${JSON.stringify(cfg.communityModel.forumTags)}::jsonb) t WHERE t->>'channelId'=parent_id AND t->>'meaning'='RESOLVED' AND t->>'tagId'=ANY(tag_ids))`.execute(
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
  if ((modes.includes("VOICE") || modes.includes("LFG_PLAY")) && has("voice"))
    add(
      "voiceCopresence",
      count("voice.copresence"),
      counts.get("voice.copresence")?.sample ?? 0,
      `Observed human co-presence for at least ${cfg.communityModel.voiceThresholdSeconds / 60} minutes; excludes bots, AFK, guests, Stage audience. This does not prove conversation.`,
    );
  if (modes.includes("LFG_PLAY") && (has("threads") || has("text"))) {
    const lfg = (
      await sql<{
        posts: number;
        after_voice: number;
      }>`SELECT count(*) FILTER(WHERE f.kind='thread.created')::integer AS posts,count(DISTINCT f.subject_hash) FILTER(WHERE f.kind='voice.copresence' AND EXISTS(SELECT 1 FROM adaptive_facts p WHERE p.organization_id=f.organization_id AND p.guild_id=f.guild_id AND p.subject_hash=f.subject_hash AND p.kind='message.sent' AND p.data->>'purpose'='LFG' AND p.occurred_at<f.occurred_at AND p.occurred_at>f.occurred_at-interval '1 day'))::integer AS after_voice FROM adaptive_facts f WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.occurred_at>=${from}`.execute(
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
    if (has("stage")) {
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
        "Current user/message reaction participation since collection began; bots/self reactions excluded. Unique humans shown as sample.",
        null,
      );
    if (count("poll.participated") || states.has("poll"))
      add(
        "pollParticipants",
        states.get("poll")?.count ?? 0,
        states.get("poll")?.sample ?? 0,
        "Current user/poll participation; multiple selected answers count once. No answer meaning collected.",
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
  return {
    profile: cfg.communityModel,
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
