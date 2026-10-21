import { createHash } from "node:crypto";
import {
  sql,
  tenant,
  privacyReadLock,
  type Database,
  type Tx,
} from "../../../packages/db/src/index";
import { betaAccess } from "../../../packages/security/src/hosted-beta";
import { SettingsService } from "../../../packages/settings/src/index";
import { enqueue } from "../../../packages/discord/src/outbox";
import {
  isDiscordFailure,
  isDiscordWriteNotStartedError,
  type DiscordPort,
} from "../../../packages/discord/src/rest";
import { setupHandoff } from "../../../packages/discord/src/setup-handoff";
import {
  assert,
  isDomainError,
  type Scope,
} from "../../../packages/shared/src/index";

export type InstallEvidence = {
  source: "created" | "ready";
  botJoinedAt: number | null;
  /** Established by the registration transaction, never by an event count. */
  firstRegistration: boolean;
  systemChannelId?: string | null;
};
type Notice = {
  generation: string;
  kind: "SETUP" | "DASHBOARD";
  state: "UNSENT" | "SENDING" | "SUCCEEDED" | "FAILED" | "UNKNOWN" | "WEB_ONLY";
  channel_id: string | null;
  destination_kind: "ADMIN" | "SYSTEM" | null;
  action_id: string | null;
  expires_at: Date;
};
type NoticeTarget = { id: string; kind: "ADMIN" | "SYSTEM" };
export type InstallNoticeStatus = {
  state: Notice["state"];
  reason:
    | "NO_VERIFIED_NOTICE"
    | "DELIVERY_UNAVAILABLE"
    | "RESULT_UNKNOWN"
    | "QUEUED"
    | "DELIVERED";
  nextAction: "CONTINUE_WEB_SETUP" | "OPEN_DASHBOARD";
};
export type InstallAction = {
  id: string;
  leaseToken: string;
  attempts: number;
  payload: Record<string, unknown>;
};
const lock = (tx: Tx, s: Scope) =>
  sql`SELECT pg_advisory_xact_lock(hashtextextended(${"install-notice:" + s.organizationId + ":" + s.guildId},0))`.execute(
    tx,
  );

export function freshInstallation(evidence: InstallEvidence, now = Date.now()) {
  return (
    evidence.source === "created" &&
    evidence.firstRegistration &&
    evidence.botJoinedAt !== null &&
    Number.isFinite(evidence.botJoinedAt) &&
    evidence.botJoinedAt <= now &&
    now - evidence.botJoinedAt <= 60000
  );
}

/** No channel scan, DM, member list or message-history lookup is performed. */
export class InstallNotices {
  constructor(
    private readonly db: Database,
    private readonly discord: Pick<
      DiscordPort,
      "checkChannel" | "sendInstallNotice" | "installationSystemChannel"
    >,
    private readonly systemAllowed?: (s: Scope, id: string) => Promise<boolean>,
  ) {}

  private async allowsSystem(s: Scope, id: string) {
    if (this.systemAllowed) return this.systemAllowed(s, id);
    return Boolean(
      this.discord.installationSystemChannel &&
      (await this.discord.installationSystemChannel(s.guildId)) === id,
    );
  }

  /** Caller must already have current guild read authorization. No target names. */
  async status(s: Scope): Promise<InstallNoticeStatus> {
    const settings = await new SettingsService(this.db).get(s);
    const nextAction =
      settings.setupVersion >= 3 &&
      (
        await sql`SELECT guild_id FROM server_web_links WHERE ${tenant(s)} AND revoked_at IS NULL`.execute(
          this.db,
        )
      ).rows.length
        ? ("OPEN_DASHBOARD" as const)
        : ("CONTINUE_WEB_SETUP" as const);
    const row = (
      await sql<{
        state: Notice["state"];
        outbox_state: string | null;
        lease_until: Date | null;
      }>`SELECT n.state,a.state AS outbox_state,a.lease_until FROM install_notices n LEFT JOIN action_outbox a ON a.organization_id=n.organization_id AND a.guild_id=n.guild_id AND a.id=n.action_id WHERE n.organization_id=${s.organizationId}::uuid AND n.guild_id=${s.guildId} AND n.expires_at>clock_timestamp() ORDER BY n.observed_at DESC LIMIT 1`.execute(
        this.db,
      )
    ).rows[0];
    if (!row)
      return { state: "WEB_ONLY", reason: "NO_VERIFIED_NOTICE", nextAction };
    let state = row.state;
    if (
      row.outbox_state === "UNKNOWN" ||
      (row.state === "SENDING" &&
        (!row.outbox_state ||
          (row.outbox_state === "RUNNING" &&
            row.lease_until &&
            row.lease_until < new Date())))
    )
      state = "UNKNOWN";
    else if (row.outbox_state === "FAILED") state = "FAILED";
    return {
      state,
      reason:
        state === "UNKNOWN"
          ? "RESULT_UNKNOWN"
          : state === "SUCCEEDED"
            ? "DELIVERED"
            : ["UNSENT", "SENDING"].includes(state)
              ? "QUEUED"
              : "DELIVERY_UNAVAILABLE",
      nextAction,
    };
  }

  async observe(s: Scope, evidence: InstallEvidence) {
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      await lock(tx, s);
      await sql`UPDATE install_notices n SET state=CASE WHEN a.state='FAILED' THEN 'FAILED' ELSE 'UNKNOWN' END FROM action_outbox a WHERE n.organization_id=${s.organizationId}::uuid AND n.guild_id=${s.guildId} AND a.organization_id=n.organization_id AND a.guild_id=n.guild_id AND a.id=n.action_id AND n.state IN ('UNSENT','SENDING') AND (a.state IN ('FAILED','UNKNOWN') OR a.state='RUNNING' AND a.lease_until<clock_timestamp())`.execute(
        tx,
      );
      const current = (
        await sql<Notice>`SELECT * FROM install_notices WHERE ${tenant(s)} AND expires_at>clock_timestamp() ORDER BY observed_at DESC LIMIT 1`.execute(
          tx,
        )
      ).rows[0];
      if (current) return current.state;
      // An older adapter cannot silently substitute the retrying panel sender.
      if (!this.discord.sendInstallNotice) return "WEB_ONLY" as const;
      // A missing ledger is never evidence of an unsent notice. Older installs,
      // re-additions and restored databases remain Web-only, including after purge.
      const recentJoin =
        evidence.source === "created" &&
        evidence.botJoinedAt !== null &&
        evidence.botJoinedAt <= Date.now() &&
        Date.now() - evidence.botJoinedAt <= 60000;
      if (!recentJoin) return "WEB_ONLY" as const;
      const request = (
        await sql<{
          id: string;
        }>`SELECT id FROM web_setup_install_requests WHERE ${tenant(s)} AND bot_absent_at<${new Date(evidence.botJoinedAt!)} AND expires_at>=${new Date(evidence.botJoinedAt!)} AND expires_at>clock_timestamp() AND notice_claimed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      if (!freshInstallation(evidence) && !request) return "WEB_ONLY" as const;
      await betaAccess(tx, s);
      const deleted = (
        await sql`SELECT id FROM beta_deletion_jobs WHERE ${tenant(s)} UNION ALL SELECT id FROM deletion_requests WHERE ${tenant(s)} AND completed_at IS NOT NULL AND lookup_hash IS NULL`.execute(
          tx,
        )
      ).rows.length;
      if (deleted) return "WEB_ONLY" as const;
      const settings = await new SettingsService(tx).get(s);
      if (!settings.enabled) return "WEB_ONLY" as const;
      const kind =
        settings.setupVersion >= 3
          ? ("DASHBOARD" as const)
          : ("SETUP" as const);
      const generation = createHash("sha256")
        .update(`guild-install:${s.guildId}:${evidence.botJoinedAt}`)
        .digest("hex");
      let target: NoticeTarget | undefined,
        targetUnverified = false;
      const select = async (
        candidate: NoticeTarget,
      ): Promise<NoticeTarget | undefined> => {
        try {
          await this.discord.checkChannel(s.guildId, candidate.id);
          return candidate;
        } catch (error) {
          // Only a definite pre-send denial permits the next explicitly allowed target.
          if (!(
            (isDiscordFailure(error) && [403, 404].includes(error.status)) ||
            (isDomainError(error) &&
              ["CHANNEL_PERMISSION_MISSING", "INVALID_START_CHANNEL"].includes(
                error.code,
              ))
          ))
            targetUnverified = true;
        }
      };
      if (settings.adminNotificationChannelId)
        target = await select({
          id: settings.adminNotificationChannelId,
          kind: "ADMIN",
        });
      if (!target && !targetUnverified) {
        try {
          // This explicit one-time installation guide is authorized for the
          // guild's current system channel. A Gateway hint never authorizes an
          // arbitrary channel, and the worker checks the current metadata again.
          const systemId = this.systemAllowed
            ? evidence.systemChannelId &&
              (await this.systemAllowed(s, evidence.systemChannelId))
              ? evidence.systemChannelId
              : null
            : await this.discord.installationSystemChannel?.(s.guildId);
          if (systemId && systemId !== settings.adminNotificationChannelId)
            target = await select({ id: systemId, kind: "SYSTEM" });
        } catch {
          // Unavailable metadata is Web-only; never guess another destination.
        }
      }
      const state = target ? "UNSENT" : "WEB_ONLY";
      await sql`INSERT INTO install_notices(organization_id,guild_id,generation,kind,state,channel_id,destination_kind) VALUES(${s.organizationId}::uuid,${s.guildId},${generation},${kind},${state},${target?.id ?? null},${target?.kind ?? null}) ON CONFLICT DO NOTHING`.execute(
        tx,
      );
      if (request)
        await sql`UPDATE web_setup_install_requests SET notice_claimed_at=clock_timestamp() WHERE ${tenant(s)} AND id=${request.id}::uuid AND notice_claimed_at IS NULL`.execute(
          tx,
        );
      if (target) {
        const action = await enqueue(
          tx,
          s,
          `install-notice:${generation}`,
          "INSTALL_NOTICE",
          { generation },
        );
        await sql`UPDATE install_notices SET action_id=${action}::uuid WHERE ${tenant(s)} AND generation=${generation} AND kind=${kind}`.execute(
          tx,
        );
      }
      return state;
    });
  }

  async deliver(s: Scope, action: InstallAction) {
    const generation = action.payload.generation;
    assert(
      typeof generation === "string" && /^[a-f0-9]{64}$/.test(generation),
      "INVALID_INSTALL_NOTICE",
    );
    let sending = false,
      prepared = false;
    try {
      assert(
        this.discord.sendInstallNotice,
        "INSTALL_NOTICE_TRANSPORT_REQUIRED",
      );
      const notice = await this.db.transaction().execute(async (tx) => {
        await privacyReadLock(tx, s);
        await lock(tx, s);
        await betaAccess(tx, s);
        const lease = (
          await sql`SELECT id FROM action_outbox WHERE ${tenant(s)} AND id=${action.id}::uuid AND state='RUNNING' AND lease_token=${action.leaseToken}::uuid AND lease_until>clock_timestamp()`.execute(
            tx,
          )
        ).rows.length;
        assert(lease, "INSTALL_NOTICE_LEASE_EXPIRED");
        const row = (
          await sql<Notice>`SELECT * FROM install_notices WHERE ${tenant(s)} AND generation=${generation} AND action_id=${action.id}::uuid AND expires_at>clock_timestamp() FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        assert(
          row && row.state === "UNSENT" && row.channel_id,
          "INSTALL_NOTICE_UNAVAILABLE",
        );
        const settings = await new SettingsService(tx).get(s);
        assert(settings.enabled, "INSTALL_NOTICE_DISABLED");
        assert(
          row.destination_kind === "ADMIN"
            ? settings.adminNotificationChannelId === row.channel_id
            : row.destination_kind === "SYSTEM" &&
                (await this.allowsSystem(s, row.channel_id)),
          "INSTALL_NOTICE_TARGET_CHANGED",
        );
        await this.discord.checkChannel(s.guildId, row.channel_id);
        // Durable send-intent before REST. A crash is unknown, never unsent.
        await sql`UPDATE install_notices SET state='SENDING' WHERE ${tenant(s)} AND generation=${generation} AND action_id=${action.id}::uuid`.execute(
          tx,
        );
        return row;
      });
      prepared = true;
      const body = setupHandoff(s.guildId, notice.kind === "DASHBOARD");
      const message = await this.db.transaction().execute(async (tx) => {
        await privacyReadLock(tx, s);
        await betaAccess(tx, s);
        // Same configuration boundary as SettingsService.mutate, held through REST.
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.organizationId + ":" + s.guildId},0))`.execute(
          tx,
        );
        return this.discord.sendInstallNotice!(
          notice.channel_id!,
          body,
          action.id,
          async () => {
            // The transport calls this after its route lock/cooldown, immediately
            // before its only request. Outbox 429 retries run this entire path anew.
            await betaAccess(tx, s);
            const settings = await new SettingsService(tx).get(s);
            assert(settings.enabled, "INSTALL_NOTICE_DISABLED");
            assert(
              notice.destination_kind === "ADMIN"
                ? settings.adminNotificationChannelId === notice.channel_id
                : notice.destination_kind === "SYSTEM" &&
                    (await this.allowsSystem(s, notice.channel_id!)),
              "INSTALL_NOTICE_TARGET_CHANGED",
            );
            await this.discord.checkChannel(s.guildId, notice.channel_id!);
            assert(
              (
                await sql`SELECT id FROM action_outbox WHERE ${tenant(s)} AND id=${action.id}::uuid AND state='RUNNING' AND lease_token=${action.leaseToken}::uuid AND lease_until>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND completed_at IS NOT NULL AND lookup_hash IS NULL) AND EXISTS(SELECT 1 FROM install_notices WHERE ${tenant(s)} AND action_id=${action.id}::uuid AND state='SENDING' AND expires_at>clock_timestamp())`.execute(
                  tx,
                )
              ).rows.length,
              "INSTALL_NOTICE_UNAVAILABLE",
            );
            sending = true;
          },
        );
      });
      await this.finish(s, action, generation, "SUCCEEDED", message);
    } catch (error) {
      const known = isDiscordFailure(error);
      const notStarted = isDiscordWriteNotStartedError(error);
      const retry = known && error.status === 429 && action.attempts < 5;
      const prior = (
        await sql<{
          state: Notice["state"];
        }>`SELECT state FROM install_notices WHERE ${tenant(s)} AND generation=${generation} AND action_id=${action.id}::uuid`.execute(
          this.db,
        )
      ).rows[0];
      const unknown =
        prior?.state === "UNKNOWN" ||
        (!prepared && prior?.state === "SENDING") ||
        (sending &&
          !notStarted &&
          (!known || error.status < 400 || error.status >= 500));
      const state = retry ? "UNSENT" : unknown ? "UNKNOWN" : "FAILED";
      await this.finish(
        s,
        action,
        generation,
        state,
        undefined,
        retry ? Math.max(error.retryAfter, 1) : undefined,
      );
    }
  }

  private async finish(
    s: Scope,
    action: InstallAction,
    generation: string,
    state: Notice["state"],
    message?: string,
    retryAfter?: number,
  ) {
    await this.db.transaction().execute(async (tx) => {
      await lock(tx, s);
      const outbox =
        state === "UNSENT"
          ? "PENDING"
          : state === "SUCCEEDED"
            ? "SUCCEEDED"
            : state === "UNKNOWN"
              ? "UNKNOWN"
              : "FAILED";
      const updated =
        await sql`UPDATE action_outbox SET state=${outbox},lease_until=NULL,lease_token=NULL,completed_at=CASE WHEN ${outbox}='PENDING' THEN NULL ELSE clock_timestamp() END,available_at=clock_timestamp()+${retryAfter ?? 0}*interval '1 second',error_category=${state === "UNKNOWN" ? "RESULT_UNKNOWN" : state === "FAILED" ? "INSTALL_NOTICE_PRECONDITION" : null},last_error=NULL WHERE ${tenant(s)} AND id=${action.id}::uuid AND state='RUNNING' AND lease_token=${action.leaseToken}::uuid RETURNING id`.execute(
          tx,
        );
      if (!updated.rows.length && state === "SUCCEEDED" && message) {
        // A lease may expire while REST completes. Preserve a confirmed late
        // success without claiming a new lease, recreating deleted data or sending.
        const late =
          await sql`UPDATE action_outbox SET state='SUCCEEDED',completed_at=clock_timestamp(),error_category=NULL,last_error=NULL WHERE ${tenant(s)} AND id=${action.id}::uuid AND state='UNKNOWN' AND EXISTS(SELECT 1 FROM install_notices WHERE ${tenant(s)} AND generation=${generation} AND action_id=${action.id}::uuid AND state IN ('SENDING','UNKNOWN') AND expires_at>clock_timestamp()) RETURNING id`.execute(
            tx,
          );
        if (late.rows.length)
          await sql`UPDATE install_notices SET state='SUCCEEDED',message_id=${message} WHERE ${tenant(s)} AND generation=${generation} AND action_id=${action.id}::uuid`.execute(
            tx,
          );
      }
      if (updated.rows.length)
        await sql`UPDATE install_notices SET state=${state},message_id=COALESCE(${message ?? null},message_id) WHERE ${tenant(s)} AND generation=${generation} AND action_id=${action.id}::uuid AND state NOT IN ('SUCCEEDED','UNKNOWN')`.execute(
          tx,
        );
    });
  }

  /** Called from worker maintenance even when no guilds are currently active. */
  async purge() {
    await this.db.transaction().execute(async (tx) => {
      await sql`DELETE FROM action_outbox WHERE kind='INSTALL_NOTICE' AND created_at<=clock_timestamp()-interval '7 days'`.execute(
        tx,
      );
      await sql`DELETE FROM install_notices WHERE expires_at<=clock_timestamp()`.execute(
        tx,
      );
    });
  }
}
