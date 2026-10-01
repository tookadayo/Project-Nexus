import { randomUUID } from "node:crypto";
import {
  sql,
  tenant,
  json,
  privacyReadLock,
  type Database,
  type Tx,
} from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { CapabilitySnapshot } from "../../shared/src/community-model";
import type { IdentityVault } from "../../identity/src/index";
import type { DiscordPort } from "../../discord/src/rest";
import { buildCapabilitySnapshot } from "../../discord/src/discovery";
export async function requestCapabilityRefresh(
  tx: Tx,
  s: Scope,
  reason: string,
  now = new Date(),
) {
  const prior = reason === "manual" ? null : await latestCapability(tx, s),
    due = prior
      ? new Date(Math.max(now.getTime(), Date.parse(prior.checkedAt) + 60000))
      : now;
  await sql`INSERT INTO capability_refresh_jobs(organization_id,guild_id,due_at,reason) SELECT ${s.organizationId}::uuid,${s.guildId},${due},${reason} WHERE EXISTS(SELECT 1 FROM guilds WHERE ${tenant(s)}) ON CONFLICT(organization_id,guild_id) DO UPDATE SET due_at=LEAST(capability_refresh_jobs.due_at,EXCLUDED.due_at),reason=EXCLUDED.reason`.execute(
    tx,
  );
}
export async function latestCapability(tx: Tx, s: Scope) {
  return (
    (
      await sql<{
        snapshot: CapabilitySnapshot;
      }>`SELECT snapshot FROM guild_capability_snapshots WHERE ${tenant(s)} ORDER BY checked_at DESC LIMIT 1`.execute(
        tx,
      )
    ).rows[0]?.snapshot ?? null
  );
}
export class DiscoveryWorker {
  constructor(
    private db: Database,
    private discord: DiscordPort,
    private vault: IdentityVault,
  ) {}
  async tick(now = new Date()) {
    if (!this.discord.capabilityState) return false;
    const job = (
      await sql<{
        organization_id: string;
        guild_id: string;
        attempts: number;
        due_at: Date;
      }>`UPDATE capability_refresh_jobs SET due_at=${new Date(now.getTime() + 120000)} WHERE (organization_id,guild_id) IN (SELECT organization_id,guild_id FROM capability_refresh_jobs WHERE due_at<=${now} ORDER BY due_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`.execute(
        this.db,
      )
    ).rows[0];
    if (!job) return false;
    const s = { organizationId: job.organization_id, guildId: job.guild_id };
    try {
      const source = await this.discord.capabilityState(s.guildId, (id) =>
          this.vault.hash(s, id),
        ),
        prior = await latestCapability(this.db, s);
      const usageRows = (
          await sql<{
            kind: string;
            count: number;
          }>`SELECT kind,count(*)::integer AS count FROM adaptive_facts WHERE ${tenant(s)} AND occurred_at>=${new Date(now.getTime() - 30 * 86400000)} GROUP BY kind`.execute(
            this.db,
          )
        ).rows,
        usage: Record<string, number> = {};
      for (const row of usageRows) {
        const key = row.kind.startsWith("poll.")
          ? "poll"
          : row.kind.startsWith("reaction.")
            ? "reaction"
            : row.kind.startsWith("server_guide.")
              ? "serverGuide"
              : row.kind === "message.sent"
                ? "text"
                : row.kind.startsWith("voice.")
                  ? "voice"
                  : row.kind.startsWith("stage.")
                    ? "stage"
                    : row.kind.startsWith("thread.")
                      ? "threads"
                      : row.kind;
        usage[key] = (usage[key] ?? 0) + row.count;
      }
      const surfaceUsage = (
        await sql<{
          surface: string;
          count: number;
        }>`SELECT data->>'surface' AS surface,count(*)::integer AS count FROM adaptive_facts WHERE ${tenant(s)} AND kind='message.sent' AND occurred_at>=${new Date(now.getTime() - 30 * 86400000)} GROUP BY data->>'surface'`.execute(
          this.db,
        )
      ).rows;
      for (const row of surfaceUsage) {
        const key = (
          {
            TEXT: "text",
            ANNOUNCEMENT: "announcements",
            VOICE_TEXT: "voiceText",
            STAGE_TEXT: "stageText",
            FORUM_POST: "forum",
            MEDIA_POST: "media",
            THREAD: "threads",
          } as Record<string, string>
        )[row.surface];
        if (key)
          usage[key] = (key === "text" ? 0 : (usage[key] ?? 0)) + row.count;
      }
      const snapshot = buildCapabilitySnapshot(source, now, prior, usage);
      await this.db.transaction().execute(async (tx) => {
        await privacyReadLock(tx, s);
        if (
          !(
            await sql`SELECT guild_id FROM guilds WHERE ${tenant(s)} AND NOT EXISTS(SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NULL AND completed_at IS NOT NULL)`.execute(
              tx,
            )
          ).rows.length
        )
          return;
        const suppressed = new Set(
          (
            await sql<{
              lookup_hash: string;
            }>`SELECT lookup_hash FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NOT NULL AND completed_at IS NOT NULL`.execute(
              tx,
            )
          ).rows.map((row) => row.lookup_hash),
        );
        for (const thread of source.threads)
          if (thread.ownerHash && suppressed.has(thread.ownerHash))
            thread.ownerHash = null;
        await sql`INSERT INTO guild_capability_snapshots VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${json(snapshot)},${now})`.execute(
          tx,
        );
        // Keep alpha.3 setup readers aligned with native Onboarding, without repeating its REST reads.
        const gatewayLive =
          (
            await sql`SELECT last_seen FROM telemetry_cursor WHERE ${tenant(s)} AND last_seen>=${new Date(now.getTime() - 90000)} AND NOT EXISTS(SELECT id FROM telemetry_health WHERE ${tenant(s)} AND ended_at IS NULL)`.execute(
              tx,
            )
          ).rows.length > 0;
        const legacy = {
          guildId: s.guildId,
          communityEnabled: source.features.includes("COMMUNITY"),
          nativeOnboardingAvailable:
            source.endpointStatus.onboarding === "AVAILABLE",
          nativeOnboardingEnabled: source.onboarding?.enabled ?? false,
          membershipScreeningEnabled: source.features.includes(
            "MEMBER_VERIFICATION_GATE_ENABLED",
          ),
          serverGuideSignalsAvailable: usage.serverGuide ? true : null,
          intents: {
            members: gatewayLive ? true : null,
            messages: gatewayLive ? true : null,
            reactions: gatewayLive ? true : null,
            voice: gatewayLive ? true : null,
            scheduledEvents: gatewayLive ? true : null,
          },
          manageGuild: source.botPermissions?.manageGuild ?? false,
          manageRoles: source.botPermissions?.manageRoles ?? false,
          sendMessages: source.botPermissions?.sendMessages ?? false,
          highestBotRolePosition:
            source.botPermissions?.highestRolePosition ?? null,
          onboardingMode: "auto",
          recommendedMode: source.onboarding?.enabled ? "native" : "fallback",
          nativePromptIds: source.onboarding?.prompts.map((p) => p.id) ?? [],
          checkedAt: now.toISOString(),
          coverage:
            source.endpointStatus.channels === "AVAILABLE"
              ? "healthy"
              : "unavailable",
        };
        await sql`INSERT INTO guild_capabilities VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${json(legacy)},${now})`.execute(
          tx,
        );
        for (const c of [
          ...source.channels.map((c) => ({
            id: c.id,
            parentId: c.parentId,
            type: c.type,
            ownerHash: null,
            archived: false,
            locked: false,
            createdAt: null,
            tagIds: c.tagIds,
          })),
          ...source.threads,
        ])
          await sql`INSERT INTO discord_surface_state VALUES(${s.organizationId}::uuid,${s.guildId},${c.id},${c.parentId},${c.type},${c.ownerHash},${c.archived},${c.locked},${c.createdAt ? new Date(c.createdAt) : null},${c.tagIds}::text[],${now}) ON CONFLICT(organization_id,guild_id,channel_id) DO UPDATE SET parent_id=EXCLUDED.parent_id,channel_type=EXCLUDED.channel_type,owner_hash=EXCLUDED.owner_hash,archived=EXCLUDED.archived,locked=EXCLUDED.locked,tag_ids=EXCLUDED.tag_ids,observed_at=EXCLUDED.observed_at`.execute(
            tx,
          );
        // REST-discovered ACTIVE events have no observed start: attendance remains unknown until a Gateway ACTIVE observation.
        for (const e of source.scheduledEvents)
          await sql`INSERT INTO adaptive_states VALUES(${s.organizationId}::uuid,${s.guildId},'event',${e.id},'',NULL,${json({ ...e, activeSince: null })},${now}) ON CONFLICT DO NOTHING`.execute(
            tx,
          );
        await sql`UPDATE capability_refresh_jobs SET due_at=${new Date(now.getTime() + 1800000)},attempts=0,reason='periodic' WHERE ${tenant(s)}`.execute(
          tx,
        );
      });
      return true;
    } catch {
      await sql`UPDATE capability_refresh_jobs SET attempts=attempts+1,due_at=${new Date(now.getTime() + Math.min(1800000, 30000 * 2 ** Math.min(job.attempts, 6)))} WHERE ${tenant(s)}`.execute(
        this.db,
      );
      return true;
    }
  }
}
