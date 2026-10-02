import { traceStep } from "../../shared/src/observability";
import { sql, type Tx, tenant } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
export type ActivityFact = {
  episode_id: string;
  kind: string;
  occurred_at: Date;
  data: Record<string, unknown>;
  reaction_count: number;
};
// Interior UTC days use materialized contributions. Window edges and an optional
// reaction cutoff day read raw facts, preserving exact timestamps without a 30-day scan.
export function activityRollupQuery(
  s: Scope,
  from: Date,
  to: Date,
  reactionFrom = from,
) {
  const firstInterior = new Date(
      Date.UTC(
        from.getUTCFullYear(),
        from.getUTCMonth(),
        from.getUTCDate() + 1,
      ),
    ),
    extraBoundary = new Date(
      Date.UTC(
        reactionFrom.getUTCFullYear(),
        reactionFrom.getUTCMonth(),
        reactionFrom.getUTCDate(),
      ),
    ),
    extraThrough = new Date(extraBoundary.getTime() + 86400000),
    lastBoundary = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
    );
  return sql<ActivityFact>`WITH boundary AS (
 SELECT episode_id,kind,occurred_at,data,id,row_number() OVER(PARTITION BY episode_id,kind,(occurred_at AT TIME ZONE 'UTC')::date,COALESCE(data->>'channelId','') ORDER BY occurred_at,id) AS first_rank,row_number() OVER(PARTITION BY episode_id,kind,(occurred_at AT TIME ZONE 'UTC')::date,COALESCE(data->>'channelId','') ORDER BY occurred_at DESC,id DESC) AS last_rank,count(*) OVER(PARTITION BY episode_id,kind,(occurred_at AT TIME ZONE 'UTC')::date,COALESCE(data->>'channelId','')) AS observations
 FROM lifecycle_events WHERE ${tenant(s)} AND context='PRODUCTION' AND occurred_at>=${from} AND occurred_at<=${to} AND (occurred_at<${firstInterior} OR occurred_at>=${lastBoundary} OR occurred_at>=${extraBoundary} AND occurred_at<${extraThrough}) AND (kind<>'reaction.received' OR occurred_at>=${reactionFrom})
 ), compact AS (
 SELECT episode_id,kind,occurred_at,data,CASE WHEN kind='reaction.received' AND first_rank=1 THEN observations ELSE 0 END::integer AS reaction_count FROM boundary WHERE first_rank=1 OR last_rank=1 OR occurred_at>=${extraBoundary} AND occurred_at<${extraThrough}
 UNION ALL SELECT r.episode_id,r.kind,r.first_at,r.first_data,CASE WHEN r.kind='reaction.received' THEN r.observations ELSE 0 END::integer FROM lifecycle_daily_rollups r WHERE ${tenant(s)} AND day>=${firstInterior.toISOString().slice(0, 10)}::date AND day<${lastBoundary.toISOString().slice(0, 10)}::date AND day<>${extraBoundary.toISOString().slice(0, 10)}::date
 UNION ALL SELECT r.episode_id,r.kind,r.last_at,r.last_data,0 FROM lifecycle_daily_rollups r WHERE ${tenant(s)} AND day>=${firstInterior.toISOString().slice(0, 10)}::date AND day<${lastBoundary.toISOString().slice(0, 10)}::date AND day<>${extraBoundary.toISOString().slice(0, 10)}::date AND first_id<>last_id
 ) SELECT * FROM compact WHERE (kind<>'reaction.received' OR occurred_at>=${reactionFrom}) AND kind IN ('message.sent','reaction.received','reaction.added','voice.started','voice.duration','voice.connected','scheduled_event.subscribed','fallback.answer','interaction.used','role.added','reply.received','reply.established','thread.response_received','thread.member_added','poll.participated','scheduled_event.attended','stage.participated','activation.completed') ORDER BY occurred_at`;
}

export async function activityRollups(
  tx: Tx,
  s: Scope,
  from: Date,
  to: Date,
  reactionFrom = from,
): Promise<ActivityFact[]> {
  return traceStep(
    "measurement.rollup.read",
    {},
    async () =>
      (await activityRollupQuery(s, from, to, reactionFrom).execute(tx)).rows,
  );
}
