import { sql, tenant, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { Settings } from "../../settings/src/index";
import { fingerprint, type AnalysisRequest } from "./domain";

export function meaningfulSettings(cfg: Settings) {
  return {
    confirmed: cfg.communityModel.confirmed,
    modes: [...cfg.communityModel.modes].sort(),
    forumTags: [...cfg.communityModel.forumTags].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    ),
    voiceThresholdSeconds: cfg.communityModel.voiceThresholdSeconds,
    staffRoles: [
      ...new Set([
        ...cfg.staffRoleIds,
        ...cfg.managerRoleIds,
        ...cfg.helperRoleIds,
        ...(cfg.adminRoleId ? [cfg.adminRoleId] : []),
      ]),
    ].sort(),
  };
}
export function confirmationIdentity(
  s: Scope,
  input: AnalysisRequest,
  window: { start: Date; end: Date },
  scope: string,
  recipe: string,
  cfg: Settings,
) {
  return fingerprint([
    s.organizationId,
    s.guildId,
    input.type,
    window.start.toISOString(),
    window.end.toISOString(),
    scope,
    recipe,
    meaningfulSettings(cfg),
    cfg.enabled,
    input.correctionOf ? 0 : 1,
    input.correctionOf ?? null,
  ]);
}

// Scoped content checksums detect corrections/deletions even when aggregate
// values happen to stay equal. The old global revision is telemetry only.
// Each source is bounded by the same period/places as calculation.
export async function analysisDataIdentity(
  tx: Tx,
  s: Scope,
  input: AnalysisRequest,
  window: { start: Date; end: Date },
  channels: string[],
) {
  const { start: from, end: to } = window;
  const row = (
    await sql<{ identity: string }>`WITH relevant_episodes AS (
    SELECT episode_id AS id FROM message_observations WHERE ${tenant(s)} AND channel_id=ANY(${channels}::text[]) AND sent_at>=${from} AND sent_at<${to}
    UNION SELECT episode_id FROM lifecycle_daily_rollups WHERE ${tenant(s)} AND day>=(${from}::timestamptz AT TIME ZONE 'UTC')::date AND day<(${to}::timestamptz AT TIME ZONE 'UTC')::date AND (channel_key=ANY(${channels}::text[]) OR (kind LIKE 'scheduled_event.%' AND channel_key=''))
    UNION SELECT id FROM membership_episodes WHERE ${tenant(s)} AND joined_at>=${from} AND joined_at<${to} AND ${["OVERALL", "NEW_MEMBERS"].includes(input.type)}
  ), source_rows AS (
    SELECT 'location' AS source,md5((to_jsonb(p)||jsonb_build_object('first_reply_seconds',CASE WHEN p.sent_at+p.first_reply_seconds*interval '1 second'<${to} THEN p.first_reply_seconds END,'reply_source',CASE WHEN p.sent_at+p.first_reply_seconds*interval '1 second'<${to} THEN p.reply_source END))::text) AS hash FROM location_post_observations p WHERE ${tenant(s)} AND channel_id=ANY(${channels}::text[]) AND sent_at>=${from} AND sent_at<${to}
    UNION ALL
    SELECT 'messages' AS source, md5((to_jsonb(m)||jsonb_build_object('first_reply_seconds',CASE WHEN m.sent_at+m.first_reply_seconds*interval '1 second'<${to} THEN m.first_reply_seconds END))::text) AS hash FROM message_observations m WHERE ${tenant(s)} AND channel_id=ANY(${channels}::text[]) AND sent_at>=${from} AND sent_at<${to}
    UNION ALL SELECT 'rollups',md5(to_jsonb(l)::text) FROM lifecycle_daily_rollups l WHERE ${tenant(s)} AND day>=(${from}::timestamptz AT TIME ZONE 'UTC')::date AND day<(${to}::timestamptz AT TIME ZONE 'UTC')::date AND (channel_key=ANY(${channels}::text[]) OR (kind LIKE 'scheduled_event.%' AND channel_key=''))
    UNION ALL SELECT 'members',md5(to_jsonb(e)::text) FROM membership_episodes e WHERE ${tenant(s)} AND id IN (SELECT id FROM relevant_episodes)
    UNION ALL SELECT 'roles',md5(to_jsonb(st)::text) FROM member_observable_state st WHERE ${tenant(s)} AND episode_id IN (SELECT id FROM relevant_episodes)
    UNION ALL SELECT 'reactions',md5(to_jsonb(r)::text) FROM reaction_state r WHERE ${tenant(s)} AND channel_id=ANY(${channels}::text[]) AND observed_at>=${from} AND observed_at<${to}
    UNION ALL SELECT 'polls',md5(to_jsonb(p)::text) FROM poll_participant_state p WHERE ${tenant(s)} AND channel_id=ANY(${channels}::text[]) AND observed_at>=${from} AND observed_at<${to}
    UNION ALL SELECT 'population_collector',md5(to_jsonb(c)::text) FROM location_population_collection c WHERE ${tenant(s)}
    UNION ALL SELECT 'epochs',md5(to_jsonb(e)::text) FROM collection_epochs e WHERE ${tenant(s)} AND started_at<${to} AND (ended_at IS NULL OR ended_at>${from})
    UNION ALL SELECT 'gaps',md5(to_jsonb(g)::text) FROM telemetry_health g WHERE ${tenant(s)} AND started_at<${to} AND (ended_at IS NULL OR ended_at>${from})
    UNION ALL SELECT 'safety',md5(to_jsonb(f)::text) FROM adaptive_facts f WHERE ${tenant(s)} AND kind='safety.context' AND occurred_at>=${from} AND occurred_at<${to}
  ) SELECT md5(COALESCE(string_agg(source||':'||hash,',' ORDER BY source,hash),'')) AS identity FROM source_rows`.execute(
      tx,
    )
  ).rows[0]!;
  return row.identity;
}
