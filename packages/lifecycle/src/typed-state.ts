import { sql, tenant, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { Envelope } from "../../events/src/index";

export type StateClock = {
  observed_at: Date;
  source_session: string | null;
  source_sequence: string | number | null;
  source_ordinal: number | null;
};
// Sequence is authoritative only within one Gateway session. Across sessions a
// tied clock cannot establish order, so the projection retains an ambiguity.
export function compareClock(e: Envelope, prior: StateClock): number | null {
  if (
    prior.source_session === e.gatewaySessionId &&
    prior.source_sequence !== null
  ) {
    const sequence = e.sequence - Number(prior.source_sequence);
    return sequence === 0
      ? (e.ordinal ?? 0) - (prior.source_ordinal ?? 0)
      : sequence;
  }
  const difference = Date.parse(e.at) - prior.observed_at.getTime();
  return difference === 0 ? null : difference;
}
export async function projectReactionState(
  tx: Tx,
  s: Scope,
  e: Envelope,
  hash: string,
  target: string | null,
) {
  if (!e.channelId || !e.messageId || !e.emojiHash)
    return { accepted: false, wasActive: false, ambiguous: false };
  const prior = (
    await sql<
      StateClock & { active: boolean; ambiguous: boolean }
    >`SELECT * FROM reaction_state WHERE ${tenant(s)} AND channel_id=${e.channelId} AND message_id=${e.messageId} AND emoji_hash=${e.emojiHash} AND reaction_type=${e.reactionType ?? 0} AND subject_hash=${hash} FOR UPDATE`.execute(
      tx,
    )
  ).rows[0];
  const resets = (
    await sql<StateClock>`SELECT * FROM reaction_resets WHERE ${tenant(s)} AND channel_id=${e.channelId} AND message_id=${e.messageId} AND emoji_key IN ('*',${e.emojiHash})`.execute(
      tx,
    )
  ).rows;
  const clocks = [...(prior ? [prior] : []), ...resets],
    comparisons = clocks.map((p) => compareClock(e, p));
  if (comparisons.some((n) => n !== null && n <= 0))
    return {
      accepted: false,
      wasActive: prior?.active ?? false,
      ambiguous: prior?.ambiguous ?? false,
    };
  const ambiguous = comparisons.includes(null),
    active = e.kind === "reaction.added";
  await sql`INSERT INTO reaction_state(organization_id,guild_id,channel_id,message_id,emoji_hash,reaction_type,subject_hash,target_hash,active,observed_at,source_session,source_sequence,source_ordinal,ambiguous) VALUES(${s.organizationId}::uuid,${s.guildId},${e.channelId},${e.messageId},${e.emojiHash},${e.reactionType ?? 0},${hash},${target},${active},${new Date(e.at)},${e.gatewaySessionId},${e.sequence},${e.ordinal ?? 0},${ambiguous}) ON CONFLICT(organization_id,guild_id,channel_id,message_id,emoji_hash,reaction_type,subject_hash) DO UPDATE SET target_hash=EXCLUDED.target_hash,active=EXCLUDED.active,observed_at=EXCLUDED.observed_at,source_session=EXCLUDED.source_session,source_sequence=EXCLUDED.source_sequence,source_ordinal=EXCLUDED.source_ordinal,ambiguous=EXCLUDED.ambiguous`.execute(
    tx,
  );
  return { accepted: true, wasActive: prior?.active ?? false, ambiguous };
}
export async function resetReactionState(tx: Tx, s: Scope, e: Envelope) {
  if (!e.channelId || !e.messageId) return;
  const key = e.kind === "reaction.removed_all" ? "*" : e.emojiHash;
  if (!key) return;
  const prior = (
    await sql<StateClock>`SELECT * FROM reaction_resets WHERE ${tenant(s)} AND channel_id=${e.channelId} AND message_id=${e.messageId} AND emoji_key=${key} FOR UPDATE`.execute(
      tx,
    )
  ).rows[0];
  if (prior && compareClock(e, prior) !== null && compareClock(e, prior)! <= 0)
    return;
  await sql`INSERT INTO reaction_resets VALUES(${s.organizationId}::uuid,${s.guildId},${e.channelId},${e.messageId},${key},${new Date(e.at)},${e.gatewaySessionId},${e.sequence},${e.ordinal ?? 0}) ON CONFLICT(organization_id,guild_id,channel_id,message_id,emoji_key) DO UPDATE SET observed_at=EXCLUDED.observed_at,source_session=EXCLUDED.source_session,source_sequence=EXCLUDED.source_sequence,source_ordinal=EXCLUDED.source_ordinal`.execute(
    tx,
  );
  const rows = (
    await sql<
      StateClock & {
        subject_hash: string;
        emoji_hash: string;
        reaction_type: number;
      }
    >`SELECT * FROM reaction_state WHERE ${tenant(s)} AND channel_id=${e.channelId} AND message_id=${e.messageId} AND (${key}='*' OR emoji_hash=${key}) FOR UPDATE`.execute(
      tx,
    )
  ).rows;
  for (const row of rows) {
    const order = compareClock(e, row);
    if (order !== null && order <= 0) continue;
    await sql`UPDATE reaction_state SET active=false,observed_at=${new Date(e.at)},source_session=${e.gatewaySessionId},source_sequence=${e.sequence},source_ordinal=${e.ordinal ?? 0},ambiguous=${order === null} WHERE ${tenant(s)} AND channel_id=${e.channelId} AND message_id=${e.messageId} AND emoji_hash=${row.emoji_hash} AND reaction_type=${row.reaction_type} AND subject_hash=${row.subject_hash}`.execute(
      tx,
    );
  }
  await sql`UPDATE adaptive_states a SET data=jsonb_set(a.data,'{active}',to_jsonb(r.active)),observed_at=r.observed_at FROM reaction_state r WHERE a.organization_id=r.organization_id AND a.guild_id=r.guild_id AND a.domain='reaction' AND a.subject_hash=r.subject_hash AND a.data->>'channelId'=r.channel_id AND a.data->>'messageId'=r.message_id AND a.data->>'emojiHash'=r.emoji_hash AND COALESCE((a.data->>'reactionType')::integer,0)=r.reaction_type AND a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND r.channel_id=${e.channelId} AND r.message_id=${e.messageId}`.execute(
    tx,
  );
}
export async function projectPollState(
  tx: Tx,
  s: Scope,
  e: Envelope,
  hash: string,
) {
  if (!e.channelId || !e.messageId || !e.answerHash) return null;
  const prior = (
    await sql<StateClock>`SELECT * FROM poll_answer_state WHERE ${tenant(s)} AND channel_id=${e.channelId} AND message_id=${e.messageId} AND subject_hash=${hash} AND answer_hash=${e.answerHash} FOR UPDATE`.execute(
      tx,
    )
  ).rows[0];
  const order = prior ? compareClock(e, prior) : 1;
  if (order !== null && order <= 0) return null;
  await sql`INSERT INTO poll_answer_state VALUES(${s.organizationId}::uuid,${s.guildId},${e.channelId},${e.messageId},${hash},${e.answerHash},${e.kind === "poll.vote_added"},${new Date(e.at)},${e.gatewaySessionId},${e.sequence},${e.ordinal ?? 0},${order === null}) ON CONFLICT(organization_id,guild_id,channel_id,message_id,subject_hash,answer_hash) DO UPDATE SET active=EXCLUDED.active,observed_at=EXCLUDED.observed_at,source_session=EXCLUDED.source_session,source_sequence=EXCLUDED.source_sequence,source_ordinal=EXCLUDED.source_ordinal,ambiguous=EXCLUDED.ambiguous`.execute(
    tx,
  );
  const result = (
    await sql<{
      answers: string[];
      observed_at: Date;
      ambiguous: boolean;
    }>`SELECT COALESCE(array_agg(answer_hash) FILTER(WHERE active),'{}'::text[]) AS answers,max(observed_at) AS observed_at,bool_or(ambiguous) AS ambiguous FROM poll_answer_state WHERE ${tenant(s)} AND channel_id=${e.channelId} AND message_id=${e.messageId} AND subject_hash=${hash}`.execute(
      tx,
    )
  ).rows[0]!;
  await sql`INSERT INTO poll_participant_state VALUES(${s.organizationId}::uuid,${s.guildId},${e.channelId},${e.messageId},${hash},${result.answers.length},${result.observed_at},${result.ambiguous}) ON CONFLICT(organization_id,guild_id,channel_id,message_id,subject_hash) DO UPDATE SET answer_count=EXCLUDED.answer_count,observed_at=EXCLUDED.observed_at,ambiguous=EXCLUDED.ambiguous`.execute(
    tx,
  );
  return result;
}
