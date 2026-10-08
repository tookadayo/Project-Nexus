import { analysisChannelScope } from "../../lifecycle/src/discovery";
import { activityRollupQuery } from "../../lifecycle/src/rollups";
import { sql, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { Settings } from "../../settings/src/index";
import type { CapabilitySnapshot } from "../../shared/src/community-model";
import type {
  RecipeDefinition,
  JourneyNode,
  RecipeTransition,
} from "../../shared/src/measurement-recipes";
import { journeyNames } from "../../shared/src/operations-copy";
import { buildMetricEvidence, type EvidenceContext } from "./evidence";
import type { MetricEvidence } from "../../shared/src/metric-evidence";
export type JourneyObservation = {
  member: string;
  kind: string;
  at: number;
  lastAt?: number;
  joinedAt: number;
  channelId?: string | null;
  eventId?: string | null;
  purpose?: string | null;
  resolved?: boolean;
};
export type JourneyTransition = {
  from: JourneyNode;
  to: JourneyNode;
  unit: RecipeTransition["unit"];
  fromLabel: readonly [string, string];
  toLabel: readonly [string, string];
  evidence: MetricEvidence;
};
type NodeTime = { member: string; at: number; entity: string };
function activityKinds(definition: RecipeDefinition) {
  const kinds = new Set([
    ...definition.strongSignals,
    ...definition.supportingSignals,
  ]);
  if (
    ["SOCIAL", "LFG_GAMING", "SUPPORT_FORUM", "LARGE_MIXED"].includes(
      definition.preset,
    )
  )
    kinds.add("message.sent");
  return kinds;
}
function nodeTimes(
  node: JourneyNode,
  observations: JourneyObservation[],
  definition: RecipeDefinition,
) {
  const times = new Map<string, NodeTime>(),
    activity = activityKinds(definition);
  for (const o of observations) {
    let matched = false,
      entity = "";
    switch (node) {
      case "join":
        matched = o.kind === "member.joined";
        break;
      case "first_post":
        matched = o.kind === "message.sent";
        break;
      case "direct_reply":
        matched = o.kind === "reply.received";
        break;
      case "connection":
        matched = definition.strongSignals.includes(o.kind);
        break;
      case "lfg_post":
        matched = o.kind === "thread.created" && o.purpose === "LFG";
        entity = o.channelId ?? "";
        break;
      case "question":
        matched =
          o.kind === "thread.created" &&
          ["SUPPORT", "BUG_REPORT", "FEEDBACK"].includes(o.purpose ?? "");
        entity = o.channelId ?? "";
        break;
      case "post_response":
        matched = o.kind === "thread.response_received";
        entity = o.channelId ?? "";
        break;
      case "resolution":
        matched =
          ["forum.tags_changed", "thread.resolved"].includes(o.kind) &&
          o.resolved === true;
        entity = o.channelId ?? "";
        break;
      case "voice_join":
        matched = o.kind === "voice.started";
        break;
      case "voice_copresence":
        matched = o.kind === "voice.connected";
        break;
      case "signup":
        matched = o.kind === "scheduled_event.subscribed";
        entity = o.eventId ?? "";
        break;
      case "attendance":
      case "repeat_attendance":
        matched = o.kind === "scheduled_event.attended";
        entity = o.eventId ?? "";
        break;
      case "reaction":
        matched = o.kind === "reaction.added";
        break;
      case "poll":
        matched = o.kind === "poll.participated";
        break;
      case "later_activity":
        matched =
          activity.has(o.kind) &&
          o.at >= o.joinedAt + definition.returnFromDay * 86400000 &&
          o.at < o.joinedAt + definition.returnThroughDay * 86400000;
        break;
      case "repeat_participation":
        matched = activity.has(o.kind);
        entity = new Date(o.at).toISOString().slice(0, 10);
        break;
    }
    if (!matched) continue;
    if (
      [
        "question",
        "lfg_post",
        "post_response",
        "resolution",
        "signup",
        "attendance",
        "repeat_attendance",
      ].includes(node) &&
      !entity
    )
      continue;
    const key = o.member + ":" + entity,
      previous = times.get(key);
    if (!previous || previous.at > o.at)
      times.set(key, { member: o.member, at: o.at, entity });
  }
  return times;
}
export function transitionCounts(
  definition: RecipeDefinition,
  observations: JourneyObservation[],
  transition: RecipeTransition,
) {
  const from = nodeTimes(transition.from, observations, definition),
    to = nodeTimes(transition.to, observations, definition),
    sources = new Map<string, NodeTime>(),
    targetsByMember = new Map<string, NodeTime[]>();
  for (const [key, value] of from) {
    const scoped = transition.unit === "MEMBER" ? value.member : key,
      previous = sources.get(scoped);
    if (!previous || previous.at > value.at) sources.set(scoped, value);
  }
  for (const value of to.values()) {
    const targets = targetsByMember.get(value.member) ?? [];
    targets.push(value);
    targetsByMember.set(value.member, targets);
  }
  let numerator = 0;
  for (const [key, source] of sources) {
    const targets =
      transition.unit === "MEMBER"
        ? (targetsByMember.get(source.member) ?? [])
        : to.has(key)
          ? [to.get(key)!]
          : [];
    if (
      targets.some(
        (t) =>
          t.at >= source.at &&
          (transition.to !== "repeat_participation" ||
            t.entity !== new Date(source.at).toISOString().slice(0, 10)) &&
          (transition.to !== "repeat_attendance" || t.entity !== source.entity),
      )
    )
      numerator++;
  }
  return { numerator, denominator: sources.size };
}
function requiredSurfaces(
  transition: RecipeTransition,
  definition: RecipeDefinition,
) {
  const nodes = [transition.from, transition.to],
    result = new Set(["members"]);
  if (
    nodes.some((n) =>
      ["first_post", "direct_reply", "connection", "later_activity"].includes(
        n,
      ),
    ) &&
    definition.metrics.some((k) =>
      ["directReplies", "postResponse"].includes(k),
    )
  ) {
    result.add("messages");
    result.add("textVisibility");
  }
  if (
    nodes.some((n) =>
      ["lfg_post", "question", "post_response", "resolution"].includes(n),
    )
  ) {
    result.add("messages");
    result.add(
      definition.preset === "LFG_GAMING"
        ? "threadVisibility"
        : "forumVisibility",
    );
  }
  if (
    nodes.some((n) => ["voice_join", "voice_copresence"].includes(n)) ||
    (nodes.includes("later_activity") &&
      definition.strongSignals.includes("voice.connected"))
  ) {
    result.add("voice");
    result.add("voiceVisibility");
  }
  if (
    nodes.some((n) => ["signup", "attendance", "repeat_attendance"].includes(n))
  )
    result.add("scheduledEvents");
  if (nodes.some((n) => ["attendance", "repeat_attendance"].includes(n))) {
    result.add("voice");
    result.add("voiceVisibility");
  }
  if (nodes.includes("reaction")) {
    result.add("reactions");
    result.add("textVisibility");
  }
  if (nodes.includes("poll")) {
    result.add("polls");
    result.add("textVisibility");
  }
  return [...result];
}
export async function journeyAnalysis(
  tx: Tx,
  s: Scope,
  cfg: Settings,
  snapshot: CapabilitySnapshot | null,
  context: EvidenceContext,
  prepared?: JourneyObservation[],
): Promise<{ recipeId: string | null; transitions: JourneyTransition[] }> {
  const recipe = context.recipe,
    definition = recipe?.definition;
  if (!definition) return { recipeId: recipe?.id ?? null, transitions: [] };
  const resolvedScope = await analysisChannelScope(tx,s,{communityModel:{...cfg.communityModel,channels:definition.channels},analysisScope:definition.scope});
  const roles = [
    ...cfg.staffRoleIds,
    ...cfg.managerRoleIds,
    ...cfg.helperRoleIds,
    ...(cfg.adminRoleId ? [cfg.adminRoleId] : []),
  ];
  const rows = (
    await sql<{
      member: string;
      kind: string;
      at: Date;
      last_at: Date;
      joined_at: Date;
      channel_id: string | null;
      event_id: string | null;
      purpose: string | null;
      resolved: boolean;
    }>`WITH eligible AS (
  SELECT e.id,${prepared ? sql`e.id::text` : sql`m.lookup_hash`} AS member,m.lookup_hash AS lookup_hash,COALESCE(e.engagement_started_at,e.joined_at) AS joined_at FROM membership_episodes e JOIN member_identity_map m ON m.organization_id=e.organization_id AND m.guild_id=e.guild_id AND m.id=e.identity_id LEFT JOIN member_observable_state st ON st.organization_id=e.organization_id AND st.guild_id=e.guild_id AND st.episode_id=e.id
  WHERE e.organization_id=${s.organizationId}::uuid AND e.guild_id=${s.guildId} AND e.context='PRODUCTION' AND e.screening_observed_at IS NOT NULL AND e.guest_observed_at IS NOT NULL AND NOT e.screening_pending AND NOT e.is_guest AND NOT(COALESCE(st.roles,'{}'::text[])&&${roles}::text[])
 ), facts AS (
  ${prepared ? sql`` : sql`SELECT e.member,f.kind,f.occurred_at AS at,e.joined_at,f.data->>'channelId' AS channel_id,f.data->>'eventId' AS event_id,COALESCE(mapping->>'effectivePurpose',f.data->>'purpose') AS purpose,COALESCE(f.data->>'resolved'='true',false) AS resolved FROM (${activityRollupQuery(s, context.from, new Date(context.to.getTime() - 1))}) f JOIN eligible e ON e.id=f.episode_id LEFT JOIN discord_surface_state ch ON ch.organization_id=${s.organizationId}::uuid AND ch.guild_id=${s.guildId} AND ch.channel_id=f.data->>'channelId' LEFT JOIN jsonb_array_elements(${JSON.stringify(resolvedScope.resolutions)}::jsonb) mapping ON mapping->>'actualChannelId'=f.data->>'channelId' WHERE f.occurred_at>=${context.from} AND f.occurred_at<${context.to} UNION ALL `} SELECT e.member,f.kind,f.occurred_at AS at,e.joined_at,f.data->>'channelId' AS channel_id,f.data->>'eventId' AS event_id,f.data->>'purpose' AS purpose,COALESCE(f.data->>'resolved'='true',false) AS resolved FROM adaptive_facts f JOIN eligible e ON e.lookup_hash=f.subject_hash WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.occurred_at>=${context.from} AND f.occurred_at<${context.to}
  ${prepared ? sql`` : sql`UNION ALL SELECT member,'member.joined',joined_at,joined_at,NULL,NULL,NULL,false FROM eligible WHERE joined_at>=${context.from} AND joined_at<${context.to}`}
 ) SELECT member,kind,min(at) AS at,max(at) AS last_at,joined_at,channel_id,event_id,purpose,resolved FROM facts WHERE channel_id IS NULL OR channel_id=ANY(${resolvedScope.actualChannelIds}::text[]) GROUP BY member,kind,joined_at,channel_id,event_id,purpose,resolved,date_trunc('day',at)`.execute(
      tx,
    )
  ).rows;
  const observations: JourneyObservation[] = [
    ...(prepared ?? []),
    ...rows.flatMap((r) => {
      const o = {
        member: r.member,
        kind: r.kind,
        at: r.at.getTime(),
        joinedAt: r.joined_at.getTime(),
        channelId: r.channel_id,
        eventId: r.event_id,
        purpose: r.purpose,
        resolved: r.resolved,
      };
      return r.last_at > r.at ? [o, { ...o, at: r.last_at.getTime() }] : [o];
    }),
  ];
  const eventTypes = new Map(
    (
      await sql<{
        state_key: string;
        type: number | null;
      }>`SELECT state_key,(data->>'entityType')::integer AS type FROM adaptive_states WHERE organization_id=${s.organizationId}::uuid AND guild_id=${s.guildId} AND domain='event'`.execute(
        tx,
      )
    ).rows.map((r) => [r.state_key, r.type]),
  );
  return {
    recipeId: recipe!.id,
    transitions: definition.transitions.map((t) => {
      const transitionObservations =
        t.to === "later_activity"
          ? observations.filter(
              (o) =>
                o.joinedAt !== undefined &&
                o.joinedAt + definition.returnThroughDay * 86400000 <=
                  context.to.getTime(),
            )
          : observations;
      const attendanceTransition = ["attendance", "repeat_attendance"].includes(
        t.to,
      );
      const unobservableAttendance =
        attendanceTransition &&
        observations.some(
          (o) =>
            o.kind === "scheduled_event.subscribed" &&
            (!o.eventId || ![1, 2].includes(eventTypes.get(o.eventId) ?? -1)),
        );
      const observableTransitions = unobservableAttendance
        ? transitionObservations.filter(
            (o) =>
              !o.eventId || [1, 2].includes(eventTypes.get(o.eventId) ?? -1),
          )
        : transitionObservations;
      const count = transitionCounts(definition, observableTransitions, t),
        evidence = buildMetricEvidence(
          "journey:" + t.from + ":" + t.to,
          {
            value: count.denominator
              ? count.numerator / count.denominator
              : null,
            numerator: count.numerator,
            denominator: count.denominator,
            sample: count.denominator,
            collecting:
              t.to === "later_activity" &&
              count.denominator === 0 &&
              observations.some(
                (o) =>
                  o.joinedAt !== undefined &&
                  o.joinedAt + definition.returnThroughDay * 86400000 >
                    context.to.getTime(),
              ),
            definition: t.from + " -> " + t.to,
            definitionVersion: definition.definitionVersion,
            requiredSurfaces: requiredSurfaces(t, definition),
          },
          snapshot,
          cfg,
          context,
        );
      if (unobservableAttendance) {
        evidence.value = null;
        evidence.denominator = null;
        if (
          count.denominator === 0 ||
          evidence.observationState === "UNKNOWN"
        ) {
          evidence.numerator = null;
          evidence.observationState = "UNKNOWN";
          evidence.coverageState = "UNKNOWN";
        } else evidence.coverageState = "PARTIAL";
        evidence.coverageReasons.push("EXTERNAL_EVENT_ATTENDANCE_UNOBSERVABLE");
        evidence.comparable = false;
        evidence.comparisonBlockers.push("ATTENDANCE_UNOBSERVABLE");
      }
      return {
        ...t,
        fromLabel: journeyNames[t.from],
        toLabel:
          t.to === "later_activity"
            ? ([
                `参加後${definition.returnFromDay}〜${definition.returnThroughDay}日目にも活動`,
                `Activity on days ${definition.returnFromDay}–${definition.returnThroughDay} after joining`,
              ] as const)
            : journeyNames[t.to],
        evidence,
      };
    }),
  };
}
