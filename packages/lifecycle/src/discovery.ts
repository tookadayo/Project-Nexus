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
import { integrationHealth, openCollectionEpoch } from "./observation";
export async function requestCapabilityRefresh(
  tx: Tx,
  s: Scope,
  reason: string,
  now = new Date(),
) {
  const priority = refreshPriority(reason);
  const prior = reason === "manual" ? null : await latestCapability(tx, s),
    due = prior
      ? new Date(Math.max(now.getTime(), Date.parse(prior.checkedAt) + 60000))
      : new Date(
          now.getTime() +
            (reason === "periodic" ? refreshJitter(s, 0, 300000) : 0),
        );
  await sql`INSERT INTO capability_refresh_jobs(organization_id,guild_id,due_at,reason,priority,requested_at) SELECT ${s.organizationId}::uuid,${s.guildId},${due},${reason},${priority},${now} WHERE EXISTS(SELECT 1 FROM guilds WHERE ${tenant(s)}) ON CONFLICT(organization_id,guild_id) DO UPDATE SET due_at=LEAST(capability_refresh_jobs.due_at,EXCLUDED.due_at),reason=CASE WHEN EXCLUDED.priority>=capability_refresh_jobs.priority THEN EXCLUDED.reason ELSE capability_refresh_jobs.reason END,priority=GREATEST(capability_refresh_jobs.priority,EXCLUDED.priority),revision=capability_refresh_jobs.revision+1,requested_at=EXCLUDED.requested_at,updated_at=now()`.execute(
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
export function refreshPriority(reason: string) {
  return reason === "manual"
    ? 100
    : reason === "install"
      ? 80
      : reason === "permission"
        ? 70
        : ["channel", "thread", "guild", "event"].includes(reason)
          ? 40
          : 10;
}
export function refreshJitter(s: Scope, attempt: number, maximum: number) {
  const key = s.organizationId + ":" + s.guildId + ":" + attempt;
  let hash = 0;
  for (const char of key)
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return hash % maximum;
}
export class DiscoveryWorker {
  constructor(
    private db: Database,
    private discord: DiscordPort,
    private vault: IdentityVault,
  ) {}
  async batch(now = new Date(), concurrency = 4) {
    const results = await Promise.all(
      Array.from({ length: Math.max(1, Math.min(8, concurrency)) }, () =>
        this.tick(now),
      ),
    );
    return results.filter(Boolean).length;
  }
  async tick(now = new Date()) {
    if (!this.discord.capabilityState) return false;
    const lease = randomUUID();
    const job = (
      await sql<{
        organization_id: string;
        guild_id: string;
        attempts: number;
        revision: string;
      }>`UPDATE capability_refresh_jobs SET lease_token=${lease}::uuid,lease_until=${new Date(now.getTime() + 120000)},updated_at=${now} WHERE (organization_id,guild_id) IN (SELECT organization_id,guild_id FROM capability_refresh_jobs WHERE due_at<=${now} AND (lease_until IS NULL OR lease_until<=${now}) ORDER BY priority DESC,due_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`.execute(
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
        if (
          !(
            await sql`SELECT guild_id FROM capability_refresh_jobs WHERE ${tenant(s)} AND lease_token=${lease}::uuid AND lease_until>${now}`.execute(
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
        const snapshotId = randomUUID();
        await sql`INSERT INTO guild_capability_snapshots VALUES(${s.organizationId}::uuid,${s.guildId},${snapshotId}::uuid,${json(snapshot)},${now})`.execute(
          tx,
        );
        // Keep alpha.3 setup readers aligned with native Onboarding, without repeating its REST reads.
        const health = await integrationHealth(tx, s, now);
        await sql`INSERT INTO discord_integration_health(organization_id,guild_id,rest_state,last_refresh_at,last_error_category,updated_at) VALUES(${s.organizationId}::uuid,${s.guildId},'AVAILABLE',${now},NULL,${now}) ON CONFLICT(organization_id,guild_id) DO UPDATE SET rest_state='AVAILABLE',last_refresh_at=EXCLUDED.last_refresh_at,last_error_category=NULL,updated_at=EXCLUDED.updated_at`.execute(
          tx,
        );
        if (
          prior &&
          JSON.stringify([prior.channels, prior.capabilities]) !==
            JSON.stringify([snapshot.channels, snapshot.capabilities])
        )
          await openCollectionEpoch(
            tx,
            s,
            now,
            "CAPABILITY_CHANGED",
            true,
            snapshotId,
          );
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
            members:
              health.intents.members === "UNKNOWN"
                ? null
                : health.intents.members === "AVAILABLE",
            messages:
              health.intents.messages === "UNKNOWN"
                ? null
                : health.intents.messages === "AVAILABLE",
            reactions:
              health.intents.reactions === "UNKNOWN"
                ? null
                : health.intents.reactions === "AVAILABLE",
            voice:
              health.intents.voice === "UNKNOWN"
                ? null
                : health.intents.voice === "AVAILABLE",
            scheduledEvents:
              health.intents.scheduledEvents === "UNKNOWN"
                ? null
                : health.intents.scheduledEvents === "AVAILABLE",
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
          await sql`INSERT INTO discord_surface_state(organization_id,guild_id,channel_id,parent_id,channel_type,owner_hash,archived,locked,created_at,tag_ids,observed_at,visibility_state,visibility_observed_at) VALUES(${s.organizationId}::uuid,${s.guildId},${c.id},${c.parentId},${c.type},${c.ownerHash},${c.archived},${c.locked},${c.createdAt ? new Date(c.createdAt) : null},${c.tagIds}::text[],${now},${source.channels.find((ch) => ch.id === c.id)?.observable === false ? "UNOBSERVABLE" : "VISIBLE"},${now}) ON CONFLICT(organization_id,guild_id,channel_id) DO UPDATE SET parent_id=EXCLUDED.parent_id,channel_type=EXCLUDED.channel_type,owner_hash=EXCLUDED.owner_hash,archived=EXCLUDED.archived,locked=EXCLUDED.locked,tag_ids=EXCLUDED.tag_ids,visibility_state=EXCLUDED.visibility_state,visibility_observed_at=EXCLUDED.visibility_observed_at,observed_at=EXCLUDED.observed_at WHERE discord_surface_state.observed_at<=EXCLUDED.observed_at`.execute(
            tx,
          );
        // REST-discovered ACTIVE events have no observed start: attendance remains unknown until a Gateway ACTIVE observation.
        for (const e of source.scheduledEvents)
          await sql`INSERT INTO adaptive_states VALUES(${s.organizationId}::uuid,${s.guildId},'event',${e.id},'',NULL,${json({ ...e, activeSince: null })},${now}) ON CONFLICT DO NOTHING`.execute(
            tx,
          );
        await sql`UPDATE capability_refresh_jobs SET due_at=CASE WHEN revision=${job.revision}::bigint THEN ${new Date(now.getTime() + 1800000 + refreshJitter(s, 0, 300000))} ELSE due_at END,attempts=0,reason=CASE WHEN revision=${job.revision}::bigint THEN 'periodic' ELSE reason END,priority=CASE WHEN revision=${job.revision}::bigint THEN 10 ELSE priority END,lease_token=NULL,lease_until=NULL,last_error_category=NULL,updated_at=${now} WHERE ${tenant(s)} AND lease_token=${lease}::uuid`.execute(
          tx,
        );
      });
      return true;
    } catch (error) {
      const { isDiscordFailure } = await import("../../discord/src/rest");
      const category = isDiscordFailure(error)
        ? error.status === 429
          ? "DISCORD_RATE_LIMIT"
          : error.status === 403
            ? "PERMISSION"
            : error.status === 0
              ? "DISCORD_TIMEOUT"
              : "DISCORD_UNAVAILABLE"
        : "INTERNAL";
      const delay = isDiscordFailure(error)
        ? Math.max(
            error.retryAfter * 1000,
            30000 * 2 ** Math.min(job.attempts, 6),
          )
        : 30000 * 2 ** Math.min(job.attempts, 6);
      await this.db.transaction().execute(async (tx) => {
        await privacyReadLock(tx, s);
        if (
          !(
            await sql`SELECT guild_id FROM capability_refresh_jobs WHERE ${tenant(s)} AND lease_token=${lease}::uuid`.execute(
              tx,
            )
          ).rows.length
        )
          return;

        await sql`INSERT INTO discord_integration_health(organization_id,guild_id,rest_state,last_refresh_failure_at,last_error_category,updated_at) VALUES(${s.organizationId}::uuid,${s.guildId},'UNKNOWN',${now},${category},${now}) ON CONFLICT(organization_id,guild_id) DO UPDATE SET rest_state='UNKNOWN',last_refresh_failure_at=EXCLUDED.last_refresh_failure_at,last_error_category=EXCLUDED.last_error_category,updated_at=EXCLUDED.updated_at`.execute(
          tx,
        );
        await sql`UPDATE capability_refresh_jobs SET attempts=CASE WHEN attempts>=5 THEN 0 ELSE attempts+1 END,due_at=CASE WHEN revision<>${job.revision}::bigint THEN due_at ELSE ${new Date(now.getTime() + Math.max(job.attempts >= 5 ? 1800000 : delay, delay) + refreshJitter(s, job.attempts, 15000))} END,lease_token=NULL,lease_until=NULL,last_error_category=${category},updated_at=${now} WHERE ${tenant(s)} AND lease_token=${lease}::uuid`.execute(
          tx,
        );
      });
      return true;
    }
  }
}
