import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, tenant, json, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import {
  surfaceFor,
  purposeFor,
  strongResponseAllowed,
} from "../../shared/src/community-model";
import type { Envelope } from "../../events/src/index";
import type { Settings } from "../../settings/src/index";
import { latestCapability, requestCapabilityRefresh } from "./discovery";
import { projectNativeSnapshot } from "./native";
import { projectActivation } from "./activation";
const id = z.string().regex(/^\d{17,20}$/),
  hashSchema = z.string().regex(/^[a-f\d]{64}$/);
const factData = z
  .object({
    channelId: id.nullable().optional(),
    parentId: id.nullable().optional(),
    messageId: id.optional(),
    referenceId: id.optional(),
    eventId: id.optional(),
    surface: z
      .enum([
        "TEXT",
        "ANNOUNCEMENT",
        "VOICE_TEXT",
        "STAGE_TEXT",
        "THREAD",
        "FORUM_POST",
        "MEDIA_POST",
        "UNKNOWN",
      ])
      .optional(),
    purpose: z.string().max(32).optional(),
    latencySeconds: z.number().nonnegative().optional(),
    seconds: z.number().nonnegative().optional(),
    suppress: z.boolean().optional(),
    guest: z.boolean().optional(),
    active: z.boolean().optional(),
    ruleHash: hashSchema.optional(),
    actionType: z.number().int().optional(),
    tagIds: z.array(id).optional(),
    resolved: z.boolean().optional(),
    entityType: z.number().int().optional(),
    status: z.number().int().optional(),
  })
  .strict();
export async function adaptiveFact(
  tx: Tx,
  s: Scope,
  kind: string,
  at: Date,
  data: z.input<typeof factData>,
  hash = "",
  episodeId: string | null = null,
  targetHash: string | null = null,
) {
  await sql`INSERT INTO adaptive_facts VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${kind},${hash},${targetHash},${episodeId}::uuid,${at},${json(factData.parse(data))}) ON CONFLICT DO NOTHING`.execute(
    tx,
  );
}
type State = { data: Record<string, unknown>; observed_at: Date };
async function state(tx: Tx, s: Scope, domain: string, key: string, hash = "") {
  return (
    await sql<State>`SELECT data,observed_at FROM adaptive_states WHERE ${tenant(s)} AND domain=${domain} AND state_key=${key} AND subject_hash=${hash} FOR UPDATE`.execute(
      tx,
    )
  ).rows[0];
}
async function setState(
  tx: Tx,
  s: Scope,
  domain: string,
  key: string,
  hash: string,
  data: Record<string, unknown>,
  at: Date,
  target: string | null = null,
) {
  await sql`INSERT INTO adaptive_states VALUES(${s.organizationId}::uuid,${s.guildId},${domain},${key},${hash},${target},${json(data)},${at}) ON CONFLICT(organization_id,guild_id,domain,state_key,subject_hash) DO UPDATE SET data=EXCLUDED.data,target_hash=EXCLUDED.target_hash,observed_at=EXCLUDED.observed_at WHERE adaptive_states.observed_at<=EXCLUDED.observed_at`.execute(
    tx,
  );
}
export async function resolveSurface(tx: Tx, s: Scope, channelId: string) {
  const c = (
    await sql<{
      channel_type: number;
      parent_id: string | null;
      owner_hash: string | null;
      created_at: Date | null;
      tag_ids: string[];
      parent_type: number | null;
      creation_observed: boolean;
    }>`SELECT c.*,p.channel_type AS parent_type FROM discord_surface_state c LEFT JOIN discord_surface_state p ON p.organization_id=c.organization_id AND p.guild_id=c.guild_id AND p.channel_id=c.parent_id WHERE c.organization_id=${s.organizationId}::uuid AND c.guild_id=${s.guildId} AND c.channel_id=${channelId}`.execute(
      tx,
    )
  ).rows[0];
  return {
    surface: surfaceFor(c?.channel_type, c?.parent_type ?? undefined),
    parentId: c?.parent_id ?? null,
    ownerHash: c?.owner_hash ?? null,
    createdAt: c?.created_at ?? null,
    tagIds: c?.tag_ids ?? [],
    creationObserved: c?.creation_observed ?? false,
  };
}
export async function projectStructure(
  tx: Tx,
  s: Scope,
  e: Envelope,
  cfg: Settings,
) {
  const at = new Date(e.at);
  if (
    e.kind === "telemetry.connected" ||
    e.kind === "telemetry.disconnected" ||
    e.kind === "telemetry.gap"
  ) {
    await sql`DELETE FROM adaptive_states WHERE ${tenant(s)} AND domain IN ('voice','voice-channel')`.execute(
      tx,
    );
    return false;
  }
  if (e.kind === "guild.updated") {
    await requestCapabilityRefresh(tx, s, "guild", at);
    if (e.afkChannelId !== undefined)
      await setState(
        tx,
        s,
        "guild",
        "afk",
        "",
        { channelId: e.afkChannelId },
        at,
      );
    if (e.incidents && Object.values(e.incidents).some(Boolean))
      await adaptiveFact(tx, s, "safety.context", at, {});
    return true;
  }
  if (
    e.kind.startsWith("channel.") ||
    [
      "thread.created",
      "thread.updated",
      "thread.deleted",
      "thread.list_synced",
    ].includes(e.kind)
  ) {
    if (!e.channelId) return true;
    if (e.kind.endsWith("deleted"))
      await sql`DELETE FROM discord_surface_state WHERE ${tenant(s)} AND channel_id=${e.channelId} AND observed_at<=${at}`.execute(
        tx,
      );
    else
      await sql`INSERT INTO discord_surface_state VALUES(${s.organizationId}::uuid,${s.guildId},${e.channelId},${e.parentId ?? null},${e.channelType ?? -1},${e.ownerHash ?? null},${e.archived ?? false},${e.locked ?? false},${e.createdAt ? new Date(e.createdAt) : e.kind === "thread.created" ? at : null},${e.tagIds ?? []}::text[],${at},${e.kind === "thread.created"}) ON CONFLICT(organization_id,guild_id,channel_id) DO UPDATE SET creation_observed=discord_surface_state.creation_observed OR EXCLUDED.creation_observed,channel_type=EXCLUDED.channel_type,parent_id=EXCLUDED.parent_id,owner_hash=COALESCE(EXCLUDED.owner_hash,discord_surface_state.owner_hash),archived=EXCLUDED.archived,locked=EXCLUDED.locked,created_at=COALESCE(discord_surface_state.created_at,EXCLUDED.created_at),tag_ids=EXCLUDED.tag_ids,observed_at=EXCLUDED.observed_at WHERE discord_surface_state.observed_at<=EXCLUDED.observed_at`.execute(
        tx,
      );
    const parent = e.parentId ?? e.channelId,
      resolved = cfg.communityModel.forumTags.some(
        (t) =>
          t.channelId === parent &&
          t.meaning === "RESOLVED" &&
          e.tagIds?.includes(t.tagId),
      );
    if (e.kind === "thread.created" || e.kind === "thread.updated") {
      const surface = await resolveSurface(tx, s, e.channelId),
        purpose = purposeFor(cfg.communityModel, e.channelId, e.parentId);
      await adaptiveFact(
        tx,
        s,
        e.kind,
        at,
        {
          channelId: e.channelId,
          parentId: e.parentId,
          tagIds: e.tagIds,
          resolved,
          surface: surface.surface,
          purpose,
        },
        e.ownerHash ?? "",
        null,
        e.ownerHash ?? null,
      );
      if (e.kind === "thread.created" && surface.surface === "FORUM_POST")
        await adaptiveFact(
          tx,
          s,
          "forum.post_created",
          at,
          {
            channelId: e.channelId,
            parentId: e.parentId,
            surface: surface.surface,
            purpose,
          },
          e.ownerHash ?? "",
        );
      if (e.kind === "thread.created" && surface.surface === "MEDIA_POST")
        await adaptiveFact(
          tx,
          s,
          "media.post_created",
          at,
          {
            channelId: e.channelId,
            parentId: e.parentId,
            surface: surface.surface,
            purpose,
          },
          e.ownerHash ?? "",
        );
      if (e.kind === "thread.updated" && e.tagIds)
        await adaptiveFact(
          tx,
          s,
          "forum.tags_changed",
          at,
          {
            channelId: e.channelId,
            parentId: e.parentId,
            tagIds: e.tagIds,
            resolved,
          },
          e.ownerHash ?? "",
        );
    }
    await requestCapabilityRefresh(tx, s, "structure", at);
    return true;
  }
  if (
    [
      "scheduled_event.created",
      "scheduled_event.updated",
      "scheduled_event.deleted",
    ].includes(e.kind)
  ) {
    if (!e.eventId) return true;
    const prior = await state(tx, s, "event", e.eventId),
      activeSince =
        e.eventStatus === 2
          ? prior?.data.status === 2
            ? (prior.data.activeSince ?? at.toISOString())
            : at.toISOString()
          : null;
    await setState(
      tx,
      s,
      "event",
      e.eventId,
      "",
      {
        channelId: e.channelId ?? null,
        entityType: e.entityType,
        status: e.kind.endsWith("deleted") ? 4 : e.eventStatus,
        activeSince,
      },
      at,
    );
    await adaptiveFact(tx, s, e.kind, at, {
      eventId: e.eventId,
      channelId: e.channelId,
      entityType: e.entityType,
      status: e.eventStatus,
    });
    if (e.eventStatus === 2 && e.channelId && e.entityType !== 3) {
      const sessions = (
        await sql<{
          subject_hash: string;
          data: Record<string, unknown>;
        }>`SELECT subject_hash,data FROM adaptive_states WHERE ${tenant(s)} AND domain='voice' AND data->>'channelId'=${e.channelId}`.execute(
          tx,
        )
      ).rows;
      for (const session of sessions) {
        if (
          !session.data.guest &&
          session.data.episodeId &&
          ((e.entityType === 1 && session.data.stage === true) ||
            (e.entityType === 2 && session.data.voiceKnown === true))
        ) {
          await adaptiveFact(
            tx,
            s,
            "scheduled_event.attended",
            at,
            {
              eventId: e.eventId,
              channelId: e.channelId,
              entityType: e.entityType,
            },
            session.subject_hash,
            String(session.data.episodeId),
          );
          await lifecycleFact(
            tx,
            s,
            String(session.data.episodeId),
            "scheduled_event.attended",
            at,
            {
              eventId: e.eventId,
              channelId: e.channelId,
              entityType: e.entityType,
            },
          );
        }
      }
    }
    await requestCapabilityRefresh(tx, s, "event", at);
    return true;
  }
  if (e.kind.startsWith("stage.")) {
    await adaptiveFact(tx, s, e.kind, at, { channelId: e.channelId });
    return true;
  }
  if (
    e.kind === "reaction.removed_all" ||
    e.kind === "reaction.removed_emoji"
  ) {
    await sql`UPDATE adaptive_states SET data=jsonb_set(data,'{active}','false'::jsonb),observed_at=${at} WHERE ${tenant(s)} AND domain='reaction' AND data->>'messageId'=${e.messageId ?? ""} AND data->>'channelId'=${e.channelId ?? ""} AND observed_at<=${at} AND (${e.kind}='reaction.removed_all' OR data->>'emojiHash'=${e.emojiHash ?? ""})`.execute(
      tx,
    );
    return true;
  }
  return false;
}
async function lifecycleFact(
  tx: Tx,
  s: Scope,
  episodeId: string,
  kind: string,
  at: Date,
  data: Record<string, unknown>,
) {
  await sql`INSERT INTO lifecycle_events VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${episodeId}::uuid,${kind},${at},'PRODUCTION',${json(data)}) ON CONFLICT DO NOTHING`.execute(
    tx,
  );
}
export async function projectMemberFlags(
  tx: Tx,
  s: Scope,
  e: Envelope,
  episodeId: string,
  hash: string,
) {
  if (e.memberFlags === undefined && e.pending === undefined) return;
  const prior = (
    await sql<{
      member_flags: number;
      screening_pending: boolean;
      flags_observed_at: Date | null;
    }>`SELECT member_flags,screening_pending,flags_observed_at FROM membership_episodes WHERE ${tenant(s)} AND id=${episodeId}::uuid FOR UPDATE`.execute(
      tx,
    )
  ).rows[0]!;
  const at = new Date(e.observedAt ?? e.at);
  if (prior.flags_observed_at && prior.flags_observed_at > at) return;
  const flags = e.memberFlags ?? prior.member_flags,
    pending = e.pending ?? prior.screening_pending;
  if (prior.member_flags !== flags || prior.screening_pending !== pending)
    await projectNativeSnapshot(tx, s, episodeId, BigInt(flags), pending, at);
  const flagKinds = [
    [8, "native_onboarding.started"],
    [2, "native_onboarding.completed"],
    [32, "server_guide.started"],
    [64, "server_guide.completed"],
  ] as const;
  for (const [bit, kind] of flagKinds)
    if (flags & bit && !(prior.member_flags & bit))
      await adaptiveFact(tx, s, kind, at, {}, hash, episodeId);
  if (prior.screening_pending && !pending)
    await adaptiveFact(tx, s, "screening.passed", at, {}, hash, episodeId);
  await sql`UPDATE membership_episodes SET flags_observed_at=${at},member_flags=${flags},screening_pending=${pending},is_guest=${Boolean(flags & 16)},engagement_started_at=CASE WHEN ${prior.screening_pending && !pending} THEN ${at} WHEN ${pending} THEN NULL ELSE engagement_started_at END WHERE ${tenant(s)} AND id=${episodeId}::uuid`.execute(
    tx,
  );
}
export async function projectAdaptiveMember(
  tx: Tx,
  s: Scope,
  e: Envelope,
  cfg: Settings,
  hash: string,
  episodeId: string | null,
  guest = false,
) {
  const at = new Date(e.at),
    channelId = e.channelId ?? null,
    surface = channelId ? await resolveSurface(tx, s, channelId) : null,
    purpose = channelId
      ? purposeFor(cfg.communityModel, channelId, surface?.parentId)
      : "OTHER",
    scopeId = surface?.parentId ?? channelId;
  const allowed =
    !scopeId ||
    cfg.analysisScope.mode === "all" ||
    (cfg.analysisScope.mode === "include") ===
      cfg.analysisScope.channelIds.includes(scopeId);
  if (!allowed || purpose === "STAFF") return true;
  if (e.kind === "auto_moderation.executed") {
    await adaptiveFact(
      tx,
      s,
      e.kind,
      at,
      { channelId, ruleHash: e.ruleHash, actionType: e.actionType },
      hash,
      episodeId,
    );
    return true;
  }
  if (e.kind === "voice.state") {
    await projectVoice(tx, s, e, cfg, hash, episodeId, guest);
    return true;
  }
  if (!episodeId || guest) return true;
  if (
    (e.kind === "reaction.added" && e.emojiHash) ||
    e.kind === "reaction.removed"
  ) {
    const key = `${e.channelId}:${e.messageId}:${e.emojiHash}:${e.reactionType ?? 0}`,
      prior = await state(tx, s, "reaction", key, hash);
    if (prior && prior.observed_at > at) return true;
    const target =
      e.targetHash ??
      prior?.data.targetHash ??
      (
        await sql<{
          lookup_hash: string;
        }>`SELECT m.lookup_hash FROM lifecycle_events f JOIN membership_episodes ep ON ep.organization_id=f.organization_id AND ep.guild_id=f.guild_id AND ep.id=f.episode_id JOIN member_identity_map m ON m.organization_id=ep.organization_id AND m.guild_id=ep.guild_id AND m.id=ep.identity_id WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.kind='message.sent' AND f.data->>'messageId'=${e.messageId ?? ""} LIMIT 1`.execute(
          tx,
        )
      ).rows[0]?.lookup_hash ??
      null;
    if (
      target === hash ||
      (target &&
        (
          await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash=${String(target)}`.execute(
            tx,
          )
        ).rows.length)
    )
      return true;
    const active = e.kind === "reaction.added";
    await setState(
      tx,
      s,
      "reaction",
      key,
      hash,
      {
        active,
        channelId,
        messageId: e.messageId,
        emojiHash: e.emojiHash,
        reactionType: e.reactionType ?? 0,
        targetHash: target,
      },
      at,
      target ? String(target) : null,
    );
    if (active && !prior?.data.active && target) {
      const previouslyReceived = target
        ? (
            await sql`SELECT id FROM adaptive_facts WHERE ${tenant(s)} AND kind='reaction.added' AND subject_hash=${hash} AND target_hash=${String(target)} AND data->>'messageId'=${e.messageId ?? ""} LIMIT 1`.execute(
              tx,
            )
          ).rows.length > 0
        : false;
      await adaptiveFact(
        tx,
        s,
        "reaction.added",
        at,
        { channelId, messageId: e.messageId, active },
        hash,
        episodeId,
        target ? String(target) : null,
      );
      await lifecycleFact(tx, s, episodeId, "reaction.added", at, {
        channelId,
        messageId: e.messageId,
      });
      if (target && !previouslyReceived) {
        const recipient = (
          await sql<{
            id: string;
          }>`SELECT ep.id FROM membership_episodes ep JOIN member_identity_map m ON m.organization_id=ep.organization_id AND m.guild_id=ep.guild_id AND m.id=ep.identity_id WHERE ep.organization_id=${s.organizationId}::uuid AND ep.guild_id=${s.guildId} AND m.lookup_hash=${String(target)} AND ep.left_at IS NULL AND NOT ep.screening_pending AND NOT ep.is_guest LIMIT 1`.execute(
            tx,
          )
        ).rows[0];
        if (recipient)
          await lifecycleFact(tx, s, recipient.id, "reaction.received", at, {
            channelId,
            messageId: e.messageId,
          });
      }
    }
    return true;
  }
  if (e.kind === "poll.vote_added" || e.kind === "poll.vote_removed") {
    const key = `${e.channelId}:${e.messageId}`,
      prior = await state(tx, s, "poll", key, hash);
    if (prior && prior.observed_at > at) return true;
    const answers = new Set(
      Array.isArray(prior?.data.answers)
        ? (prior.data.answers as string[])
        : [],
    );
    if (e.answerHash) {
      if (e.kind === "poll.vote_added") answers.add(e.answerHash);
      else answers.delete(e.answerHash);
    }
    await setState(
      tx,
      s,
      "poll",
      key,
      hash,
      {
        channelId,
        messageId: e.messageId,
        answers: [...answers],
        active: answers.size > 0,
      },
      at,
    );
    if (answers.size) {
      await adaptiveFact(
        tx,
        s,
        "poll.participated",
        at,
        { channelId, messageId: e.messageId, active: true },
        hash,
        episodeId,
      );
      if (episodeId)
        await lifecycleFact(tx, s, episodeId, "poll.participated", at, {
          channelId,
          messageId: e.messageId,
        });
    }
    return true;
  }
  if (e.kind.startsWith("thread.member_")) {
    await adaptiveFact(
      tx,
      s,
      e.kind,
      at,
      {
        channelId,
        parentId: surface?.parentId,
        surface: surface?.surface,
        purpose,
      },
      hash,
      episodeId,
    );
    if (
      e.kind === "thread.member_added" &&
      purpose === "LFG" &&
      surface?.ownerHash &&
      surface.ownerHash !== hash
    )
      await sql`UPDATE lifecycle_events f SET data=jsonb_set(data,'{receivedHumanParticipant}','true'::jsonb) FROM membership_episodes ep JOIN member_identity_map m ON m.organization_id=ep.organization_id AND m.guild_id=ep.guild_id AND m.id=ep.identity_id WHERE f.organization_id=${s.organizationId}::uuid AND f.guild_id=${s.guildId} AND f.episode_id=ep.id AND f.organization_id=ep.organization_id AND f.guild_id=ep.guild_id AND m.lookup_hash=${surface.ownerHash} AND f.kind='message.sent' AND f.data->>'channelId'=${channelId}`.execute(
        tx,
      );
    if (episodeId && e.kind === "thread.member_added")
      await lifecycleFact(tx, s, episodeId, e.kind, at, { channelId });
    return true;
  }
  if (e.kind === "message.sent") {
    await adaptiveFact(
      tx,
      s,
      "message.sent",
      at,
      {
        channelId,
        messageId: e.messageId,
        referenceId: e.referenceId,
        surface: surface?.surface ?? "UNKNOWN",
        parentId: surface?.parentId,
        purpose,
      },
      hash,
      episodeId,
    );
    if (e.referenceId)
      await adaptiveFact(
        tx,
        s,
        "reply.sent",
        at,
        {
          channelId,
          messageId: e.messageId,
          referenceId: e.referenceId,
          surface: surface?.surface,
          purpose,
        },
        hash,
        episodeId,
      );
    if (
      surface &&
      ["THREAD", "FORUM_POST", "MEDIA_POST"].includes(surface.surface)
    )
      await adaptiveFact(
        tx,
        s,
        "thread.activity",
        at,
        {
          channelId,
          messageId: e.messageId,
          surface: surface.surface,
          purpose,
          parentId: surface.parentId,
        },
        hash,
        episodeId,
      );
    for (const target of e.mentionHashes ?? [])
      if (
        !(
          await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash=${target}`.execute(
            tx,
          )
        ).rows.length
      )
        await adaptiveFact(
          tx,
          s,
          "mention.sent",
          at,
          { channelId, messageId: e.messageId, surface: surface?.surface },
          hash,
          episodeId,
          target,
        );
    if (
      surface &&
      ["THREAD", "FORUM_POST", "MEDIA_POST"].includes(surface.surface) &&
      surface.ownerHash &&
      surface.ownerHash !== hash &&
      surface.createdAt &&
      surface.createdAt <= at &&
      surface.creationObserved
    ) {
      const owner = (
        await sql<{
          id: string;
        }>`SELECT ep.id FROM membership_episodes ep JOIN member_identity_map m ON m.organization_id=ep.organization_id AND m.guild_id=ep.guild_id AND m.id=ep.identity_id WHERE ep.organization_id=${s.organizationId}::uuid AND ep.guild_id=${s.guildId} AND m.lookup_hash=${surface.ownerHash} AND ep.left_at IS NULL AND NOT ep.screening_pending AND NOT ep.is_guest LIMIT 1`.execute(
          tx,
        )
      ).rows[0];
      if (owner) {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"thread-response:" + s.organizationId + ":" + s.guildId + ":" + channelId},0))`.execute(
          tx,
        );
        const previous = (
          await sql`SELECT id FROM adaptive_facts WHERE ${tenant(s)} AND kind='thread.response_received' AND data->>'channelId'=${channelId}`.execute(
            tx,
          )
        ).rows.length;
        if (!previous) {
          const latencySeconds = Math.max(
            0,
            (at.getTime() - surface.createdAt.getTime()) / 1000,
          );
          await adaptiveFact(
            tx,
            s,
            "thread.response_received",
            at,
            {
              channelId,
              parentId: surface.parentId,
              surface: surface.surface,
              purpose,
              latencySeconds,
            },
            surface.ownerHash,
            owner.id,
            hash,
          );
          if (strongResponseAllowed(cfg.communityModel, purpose))
            await lifecycleFact(
              tx,
              s,
              owner.id,
              "thread.response_received",
              at,
              { channelId, latencySeconds },
            );
          await sql`UPDATE lifecycle_events SET data=jsonb_set(data,'{receivedExplicitReply}','true'::jsonb) WHERE ${tenant(s)} AND episode_id=${owner.id}::uuid AND kind='message.sent' AND data->>'channelId'=${channelId}`.execute(
            tx,
          );
        }
      }
    }
    return purpose === "ANNOUNCEMENT" || purpose === "ONBOARDING";
  }
  if (
    e.kind === "scheduled_event.subscribed" ||
    e.kind === "scheduled_event.unsubscribed"
  )
    await adaptiveFact(
      tx,
      s,
      e.kind,
      at,
      { eventId: e.eventId },
      hash,
      episodeId,
    );
  return false;
}
function channelClock(data: Record<string, unknown> | undefined, at: Date) {
  return (
    Number(data?.seconds ?? 0) +
    (Number(data?.count ?? 0) >= 2 && typeof data?.since === "string"
      ? Math.max(0, (at.getTime() - Date.parse(data.since)) / 1000)
      : 0)
  );
}
async function qualifyVoice(
  tx: Tx,
  s: Scope,
  cfg: Settings,
  hash: string,
  data: Record<string, unknown>,
  seconds: number,
  at: Date,
) {
  if (
    data.connected ||
    data.guest ||
    data.stage ||
    data.voiceKnown !== true ||
    seconds < cfg.communityModel.voiceThresholdSeconds
  )
    return;
  const episodeId = String(data.episodeId),
    channelId = String(data.channelId);
  await adaptiveFact(
    tx,
    s,
    "voice.copresence",
    at,
    { channelId, seconds },
    hash,
    episodeId,
  );
  if (
    cfg.communityModel.modes.includes("VOICE") ||
    cfg.communityModel.modes.includes("LFG_PLAY")
  )
    await lifecycleFact(tx, s, episodeId, "voice.connected", at, { channelId });
  if (cfg.flags.activation_dsl_v2)
    await projectActivation(tx, s, episodeId, at);
  data.connected = true;
}
async function projectVoice(
  tx: Tx,
  s: Scope,
  e: Envelope,
  cfg: Settings,
  hash: string,
  episodeId: string | null,
  guest: boolean,
) {
  const at = new Date(e.at);
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"voice:" + s.organizationId + ":" + s.guildId},0))`.execute(
    tx,
  );
  const prior = await state(tx, s, "voice", "current", hash);
  if (prior && prior.observed_at > at) return;
  const surface = e.channelId ? await resolveSurface(tx, s, e.channelId) : null,
    afk =
      (await state(tx, s, "guild", "afk"))?.data.channelId ??
      (await latestCapability(tx, s))?.afkChannelId;
  const channelId = e.channelId === afk ? null : (e.channelId ?? null),
    stage = surface?.surface === "STAGE_TEXT",
    voiceKnown = surface?.surface === "VOICE_TEXT";
  if (
    prior?.data.channelId === channelId &&
    prior.data.stage === stage &&
    prior.data.voiceKnown === voiceKnown &&
    prior.data.suppress === e.suppress &&
    prior.data.guest === guest
  )
    return;
  if (prior) {
    const oldChannel = String(prior.data.channelId),
      oldStage = Boolean(prior.data.stage),
      clock = await state(tx, s, "voice-channel", oldChannel),
      seconds = channelClock(clock?.data, at);
    if (prior.data.voiceKnown === true && !prior.data.guest) {
      await qualifyVoice(
        tx,
        s,
        cfg,
        hash,
        prior.data,
        Math.max(0, seconds - Number(prior.data.baseline ?? 0)),
        at,
      );
      await setState(
        tx,
        s,
        "voice-channel",
        oldChannel,
        "",
        {
          count: Math.max(0, Number(clock?.data.count ?? 1) - 1),
          seconds,
          since: at.toISOString(),
        },
        at,
      );
    }
    await adaptiveFact(
      tx,
      s,
      oldStage ? "stage.left" : "voice.left",
      at,
      {
        channelId: oldChannel,
        seconds: Math.max(
          0,
          (at.getTime() - Date.parse(String(prior.data.joinedAt))) / 1000,
        ),
        suppress:
          typeof prior.data.suppress === "boolean"
            ? prior.data.suppress
            : undefined,
        guest: Boolean(prior.data.guest),
      },
      hash,
      episodeId,
    );
    if (episodeId && !guest && prior.data.voiceKnown === true)
      await lifecycleFact(tx, s, episodeId, "voice.duration", at, {
        channelId: oldChannel,
        seconds: Math.max(
          0,
          (at.getTime() - Date.parse(String(prior.data.joinedAt))) / 1000,
        ),
      });
    await sql`DELETE FROM adaptive_states WHERE ${tenant(s)} AND domain='voice' AND subject_hash=${hash}`.execute(
      tx,
    );
  }
  if (!channelId) return;
  const clock = await state(tx, s, "voice-channel", channelId),
    baseline = channelClock(clock?.data, at);
  if (voiceKnown && !guest)
    await setState(
      tx,
      s,
      "voice-channel",
      channelId,
      "",
      {
        count: Number(clock?.data.count ?? 0) + 1,
        seconds: baseline,
        since: at.toISOString(),
      },
      at,
    );
  await setState(
    tx,
    s,
    "voice",
    "current",
    hash,
    {
      channelId,
      joinedAt: at.toISOString(),
      baseline,
      stage,
      voiceKnown,
      suppress: e.suppress,
      guest,
      episodeId,
      connected: false,
    },
    at,
  );
  await adaptiveFact(
    tx,
    s,
    stage
      ? e.suppress === true
        ? "stage.audience_joined"
        : e.suppress === false
          ? "stage.speaker_joined"
          : "stage.joined"
      : prior
        ? "voice.moved"
        : "voice.joined",
    at,
    {
      channelId,
      suppress: e.suppress,
      guest,
      surface: surface?.surface ?? "UNKNOWN",
    },
    hash,
    episodeId,
  );
  if (episodeId && !guest && stage)
    await lifecycleFact(tx, s, episodeId, "stage.participated", at, {
      channelId,
      suppress: e.suppress,
    });
  if (episodeId && !guest && voiceKnown)
    await lifecycleFact(tx, s, episodeId, "voice.started", at, { channelId });
  if (episodeId && !guest) {
    const events = (
      await sql<{
        state_key: string;
        data: Record<string, unknown>;
      }>`SELECT state_key,data FROM adaptive_states WHERE ${tenant(s)} AND domain='event' AND data->>'channelId'=${channelId} AND data->>'status'='2' AND data->>'entityType'<>'3' AND data->>'activeSince' IS NOT NULL`.execute(
        tx,
      )
    ).rows;
    for (const ev of events) {
      if (!(
        (Number(ev.data.entityType) === 1 && stage) ||
        (Number(ev.data.entityType) === 2 && voiceKnown)
      ))
        continue;
      await adaptiveFact(
        tx,
        s,
        "scheduled_event.attended",
        at,
        {
          eventId: ev.state_key,
          channelId,
          entityType: Number(ev.data.entityType),
        },
        hash,
        episodeId,
      );
      await lifecycleFact(tx, s, episodeId, "scheduled_event.attended", at, {
        eventId: ev.state_key,
        channelId,
        entityType: Number(ev.data.entityType),
      });
    }
  }
}
export async function tickVoice(
  tx: Tx,
  s: Scope,
  cfg: Settings,
  now = new Date(),
) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"voice:" + s.organizationId + ":" + s.guildId},0))`.execute(
    tx,
  );
  const sessions = (
    await sql<{
      subject_hash: string;
      data: Record<string, unknown>;
      clock: Record<string, unknown>;
    }>`SELECT v.subject_hash,v.data,c.data AS clock FROM adaptive_states v JOIN adaptive_states c ON c.organization_id=v.organization_id AND c.guild_id=v.guild_id AND c.domain='voice-channel' AND c.state_key=v.data->>'channelId' WHERE v.organization_id=${s.organizationId}::uuid AND v.guild_id=${s.guildId} AND v.domain='voice' AND v.data->>'connected'='false' AND v.data->>'guest'='false' AND v.data->>'stage'='false' ORDER BY ((c.data->>'seconds')::numeric-(v.data->>'baseline')::numeric+CASE WHEN (c.data->>'count')::integer>=2 THEN GREATEST(0,extract(epoch FROM ${now}-(c.data->>'since')::timestamptz)) ELSE 0 END) DESC LIMIT 500`.execute(
      tx,
    )
  ).rows;
  for (const session of sessions) {
    await qualifyVoice(
      tx,
      s,
      cfg,
      session.subject_hash,
      session.data,
      Math.max(
        0,
        channelClock(session.clock, now) - Number(session.data.baseline),
      ),
      now,
    );
    if (session.data.connected)
      await setState(
        tx,
        s,
        "voice",
        "current",
        session.subject_hash,
        session.data,
        now,
      );
  }
}
