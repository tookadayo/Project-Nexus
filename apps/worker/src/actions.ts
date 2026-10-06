import { traceStep } from "../../../packages/shared/src/observability.js";
import { deliveryFence } from "../../../packages/operations/src/delivery-policy";
import { operationsLock } from "../../../packages/operations/src/policy";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  sql,
  tenant,
  privacyReadLock,
  type Database,
  type Tx,
} from "../../../packages/db/src/index.js";
import { assert, type Scope } from "../../../packages/shared/src/index.js";
import { IdentityVault } from "../../../packages/identity/src/index.js";
import {
  DiscordFailure,
  type DiscordAttachment,
  type DiscordPort,
} from "../../../packages/discord/src/rest.js";
import {
  errorReference,
  logFailure,
} from "../../../packages/shared/src/diagnostics.js";
import {
  enqueue,
  type ActionKind,
} from "../../../packages/discord/src/outbox.js";
import { OnboardingService } from "../../../packages/onboarding/src/index.js";
import { selectedOptions } from "../../../packages/onboarding/src/flow.js";
import {
  audit,
  SettingsService,
} from "../../../packages/settings/src/index.js";
import type { Panel } from "../../../packages/discord-panels/src/index.js";
import { EntitlementService } from "../../../packages/settings/src/billing/entitlements";
import { InterventionWorker } from "./interventions.js";
import type { InteractionHealth } from "../../interaction/src/health.js";
type Action = {
  id: string;
  kind: ActionKind;
  payload: Record<string, unknown>;
  attempts: number;
  leaseToken: string;
};
function attachmentFiles(input: unknown): DiscordAttachment[] | undefined {
  if (input === undefined) return undefined;
  return z
    .array(
      z
        .object({
          filename: z.string().regex(/^[a-z0-9_-]+\.(png|csv|json)$/),
          dataBase64: z.string().max(2800000),
        })
        .strict(),
    )
    .max(5)
    .parse(input)
    .map((file) => {
      const data = Buffer.from(file.dataBase64, "base64");
      if (
        data.length > 2 * 1024 * 1024 ||
        data.toString("base64") !== file.dataBase64
      )
        throw new Error("INVALID_ATTACHMENT");
      return { filename: file.filename, data };
    });
}
function cleanAttachmentBody(body: Panel): Panel {
  const clean = { ...body } as Panel & { nexusFiles?: unknown };
  delete clean.nexusFiles;
  return clean;
}
export class ActionWorker {
  constructor(
    private readonly db: Database,
    private readonly vault: IdentityVault,
    private readonly discord: DiscordPort,
    private readonly onboarding: OnboardingService,
    private readonly interactionHealth?: InteractionHealth,
    private readonly refreshPanel?: (s: Scope) => Promise<Panel>,
  ) {}
  async tick(s: Scope): Promise<boolean> {
    return traceStep("action.outbox", {}, () => this.execute(s));
  }
  private async execute(s: Scope): Promise<boolean> {
    // A crashed worker may have performed a REST operation; never blindly retry its expired lease.
    await sql`UPDATE action_outbox SET state=CASE WHEN (kind IN ('PANEL_DELETE','PANEL_REFRESH') OR kind='PANEL_UPSERT' AND operation_phase IS DISTINCT FROM 'CREATE') THEN 'PENDING' ELSE 'UNKNOWN' END,last_error='Worker lease expired',error_category='LEASE_EXPIRED',lease_until=NULL,lease_token=NULL,updated_at=now() WHERE ${tenant(s)} AND state='RUNNING' AND lease_until<now()`.execute(
      this.db,
    );
    const action = await this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"action-claim:" + s.organizationId + ":" + s.guildId},0))`.execute(
        tx,
      );
      const row = (
        await sql<Action>`SELECT id,kind,payload,attempts FROM action_outbox q WHERE ${tenant(s)} AND state='PENDING' AND available_at<=now() AND NOT EXISTS(SELECT 1 FROM action_outbox running WHERE running.organization_id=q.organization_id AND running.guild_id=q.guild_id AND running.state='RUNNING') ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`.execute(
          tx,
        )
      ).rows[0];
      if (row) {
        row.leaseToken = randomUUID();
        await sql`UPDATE action_outbox SET state='RUNNING',attempts=attempts+1,lease_until=now()+interval '60 seconds',lease_token=${row.leaseToken}::uuid,updated_at=now() WHERE ${tenant(s)} AND id=${row.id}::uuid`.execute(
          tx,
        );
      }
      return row;
    });
    if (!action) return false;
    if (action.kind === "PANEL_REFRESH") return this.refresh(s, action);
    if (action.kind === "INTERVENTION_DELIVER") {
      const runId = z.uuid().parse(action.payload.runId);
      await new InterventionWorker(this.db, this.vault, this.discord).tick(
        s,
        runId,
      );
      const run = (
        await sql<{
          state: string;
          available_at: Date;
        }>`SELECT state,available_at FROM intervention_runs WHERE ${tenant(s)} AND id=${runId}::uuid`.execute(
          this.db,
        )
      ).rows[0];
      const state =
        run?.state === "queued"
          ? "PENDING"
          : run?.state === "delivered"
            ? "SUCCEEDED"
            : run?.state === "unknown" || run?.state === "running"
              ? "UNKNOWN"
              : "FAILED";
      await sql`UPDATE action_outbox SET state=${state},available_at=${run?.available_at ?? new Date()},lease_until=NULL WHERE ${tenant(s)} AND id=${action.id}::uuid AND lease_token=${action.leaseToken}::uuid`.execute(
        this.db,
      );
      return true;
    }
    let creating = false;
    let sideEffectStarted = false,
      replyCompleted = false;
    try {
      if (!(await this.live(s, action))) return true;
      if (action.kind.startsWith("ROLE_")) {
        const payload = z
          .object({ sessionId: z.uuid(), roleId: z.string().optional() })
          .parse(action.payload);
        const plan = await this.rolePlan(s, action, payload.sessionId);
        if (plan) {
          const { session, episode, desired, grants, userId } = plan;
          if (action.kind === "ROLE_RECONCILE") {
            await this.commit(s, action, async (tx) => {
              for (const roleId of desired.keys())
                await enqueue(tx, s, `${action.id}:add:${roleId}`, "ROLE_ADD", {
                  sessionId: session.id,
                  roleId,
                });
              for (const grant of grants)
                if (!desired.has(grant.role_id))
                  await enqueue(
                    tx,
                    s,
                    `${action.id}:remove:${grant.role_id}`,
                    "ROLE_REMOVE",
                    { sessionId: session.id, roleId: grant.role_id },
                  );
            });
          } else {
            const roleId = z
                .string()
                .regex(/^\d{17,20}$/)
                .parse(payload.roleId),
              member = await this.discord.member(s.guildId, userId);
            if (
              action.kind === "ROLE_ADD" &&
              desired.has(roleId) &&
              !member.roles.includes(roleId)
            ) {
              await this.discord.validateRole(s.guildId, roleId);
              if (!(await this.rolePlan(s, action, payload.sessionId)))
                return true;
              sideEffectStarted = true;
              await this.discord.addRole(s.guildId, userId, roleId);
              const saved = await this.commit(s, action, async (tx) => {
                await sql`INSERT INTO nexus_role_grants(organization_id,guild_id,episode_id,role_id,action_id,flow_version_id,node_id) VALUES(${s.organizationId}::uuid,${s.guildId},${session.episode_id}::uuid,${roleId},${action.id}::uuid,${session.flow_version_id}::uuid,${desired.get(roleId)!}) ON CONFLICT(organization_id,guild_id,episode_id,role_id) DO UPDATE SET action_id=EXCLUDED.action_id,flow_version_id=EXCLUDED.flow_version_id,node_id=EXCLUDED.node_id,granted_at=now(),revoked_at=NULL`.execute(
                  tx,
                );
              });
              if (!saved)
                await this.discord.removeRole(s.guildId, userId, roleId);
            }
            if (
              action.kind === "ROLE_REMOVE" &&
              !desired.has(roleId) &&
              grants.some((g) => g.role_id === roleId)
            ) {
              if (member.roles.includes(roleId)) {
                await this.discord.validateRole(s.guildId, roleId);
                if (!(await this.live(s, action))) return true;
                sideEffectStarted = true;
                await this.discord.removeRole(s.guildId, userId, roleId);
              }
              await this.commit(s, action, async (tx) => {
                await sql`UPDATE nexus_role_grants SET revoked_at=now() WHERE ${tenant(s)} AND episode_id=${episode.id}::uuid AND role_id=${roleId}`.execute(
                  tx,
                );
              });
            }
          }
        }
      } else if (action.kind === "PANEL_UPSERT") {
        const payload = action.payload as { channelId: string; body: Panel };
        await this.discord.checkChannel(s.guildId, payload.channelId);
        const existing = (
          await sql<{
            channel_id: string;
            message_id: string;
          }>`SELECT channel_id,message_id FROM settings_panels WHERE ${tenant(s)}`.execute(
            this.db,
          )
        ).rows[0];
        if (!(await this.live(s, action))) return true;
        let id: string | undefined;
        if (existing && existing.channel_id === payload.channelId) {
          try {
            sideEffectStarted = true;
            await this.discord.editPanel(
              existing.channel_id,
              existing.message_id,
              payload.body,
            );
            id = existing.message_id;
          } catch (error) {
            if (!(error instanceof DiscordFailure) || error.status !== 404)
              throw error;
          }
        }
        if (!id) {
          if (!(await this.live(s, action))) return true;
          sideEffectStarted = true;
          if (
            !(await this.commit(s, action, async (tx) => {
              await sql`UPDATE action_outbox SET operation_phase='CREATE' WHERE ${tenant(s)} AND id=${action.id}::uuid AND lease_token=${action.leaseToken}::uuid`.execute(
                tx,
              );
            }))
          )
            return true;
          creating = true;
          id = await this.discord.sendPanel(
            payload.channelId,
            payload.body,
            action.id,
          );
        }
        const saved = await this.commit(s, action, async (tx) => {
          await sql`INSERT INTO settings_panels(organization_id,guild_id,channel_id,message_id) VALUES(${s.organizationId}::uuid,${s.guildId},${payload.channelId},${id!}) ON CONFLICT(organization_id,guild_id) DO UPDATE SET channel_id=EXCLUDED.channel_id,message_id=EXCLUDED.message_id`.execute(
            tx,
          );
          if (
            existing &&
            existing.message_id !== id &&
            this.discord.deletePanel
          )
            await enqueue(
              tx,
              s,
              `panel-delete:${existing.message_id}`,
              "PANEL_DELETE",
              {
                channelId: existing.channel_id,
                messageId: existing.message_id,
              },
            );
        });
        if (!saved && this.discord.deletePanel)
          await this.discord.deletePanel(payload.channelId, id);
      } else if (action.kind === "PANEL_DELETE") {
        const payload = z
          .object({ channelId: z.string(), messageId: z.string() })
          .parse(action.payload);
        const active = (
          await sql<{
            message_id: string;
          }>`SELECT message_id FROM settings_panels WHERE ${tenant(s)}`.execute(
            this.db,
          )
        ).rows[0];
        if (
          active?.message_id !== payload.messageId &&
          this.discord.deletePanel
        ) {
          if (!(await this.live(s, action))) return true;
          try {
            sideEffectStarted = true;
            await this.discord.deletePanel(
              payload.channelId,
              payload.messageId,
            );
          } catch (error) {
            if (!(error instanceof DiscordFailure) || error.status !== 404)
              throw error;
          }
        }
      } else if (action.kind === "COMMANDS_REGISTER") {
        sideEffectStarted = true;
        await this.discord.registerCommands(
          s.guildId,
          z.array(z.unknown()).parse(action.payload.commands),
        );
      } else if (
        [
          "TEST_MESSAGE",
          "CHART_PUBLISH",
          "OPERATIONS_NOTIFY",
          "REPORT_PUBLISH",
          "INTAKE_PUBLISH",
          "INTAKE_NOTIFY",
        ].includes(action.kind)
      ) {
        const payload = action.payload as { channelId: string; body: Panel };
        if (action.kind === "OPERATIONS_NOTIFY")
          await new EntitlementService(this.db).require(s, "playbooks");
        if (action.kind === "REPORT_PUBLISH")
          await new EntitlementService(this.db).require(
            s,
            action.payload.export === true
              ? "recurring_exports"
              : "scheduled_reports",
          );
        if (action.kind === "INTAKE_NOTIFY")
          await new EntitlementService(this.db).require(
            s,
            "surface_breakdowns",
          );
        if (action.kind === "INTAKE_PUBLISH") {
          await new EntitlementService(this.db).require(s, "intake_panels");
          assert(
            (
              await sql`SELECT id FROM operations_intake_panels WHERE ${tenant(s)} AND id=${String(action.payload.intakePanelId)}::uuid AND version=${Number(action.payload.intakePanelVersion)} AND state='PUBLISHING'`.execute(
                this.db,
              )
            ).rows.length,
            "INTAKE_PANEL_UNAVAILABLE",
            409,
          );
        }
        await this.discord.checkChannel(s.guildId, payload.channelId);
        if (action.payload.roleId)
          assert(
            (await this.discord.roles(s.guildId)).some(
              (role) => role.id === action.payload.roleId,
            ),
            "ROLE_NOT_FOUND",
            404,
          );
        if (!(await this.live(s, action))) return true;
        const publishedId = await this.db.transaction().execute(async (tx) => {
          await privacyReadLock(tx, s);
          if (!(await this.live(s, action, tx))) return null;
          await operationsLock(tx, s);
          if (action.kind === "OPERATIONS_NOTIFY")
            await deliveryFence(
              tx,
              s,
              "PLAYBOOK",
              String(action.payload.playbookRunId),
            );
          if (action.kind === "REPORT_PUBLISH")
            await deliveryFence(
              tx,
              s,
              "REPORT",
              String(action.payload.reportRunId),
            );
          if (action.kind === "INTAKE_PUBLISH")
            await deliveryFence(
              tx,
              s,
              "INTAKE",
              String(action.payload.intakePanelId),
            );
          if (action.kind === "INTAKE_NOTIFY")
            await deliveryFence(
              tx,
              s,
              "INTAKE_NOTIFY",
              String(action.payload.intakeRequestId),
            );
          if (action.payload.roleId)
            await new EntitlementService(tx).require(s, "team_routing");
          sideEffectStarted = true;
          return this.discord.sendPanel(
            payload.channelId,
            payload.body,
            action.id,
            attachmentFiles(action.payload.files),
          );
        });
        if (!publishedId) return true;
        if (action.kind === "INTAKE_PUBLISH")
          await this.commit(s, action, async (tx) => {
            await sql`UPDATE operations_intake_panels SET state='PUBLISHED',message_id=${publishedId} WHERE ${tenant(s)} AND id=${String(action.payload.intakePanelId)}::uuid AND version=${Number(action.payload.intakePanelVersion)} AND state='PUBLISHING'`.execute(
              tx,
            );
          });
      } else {
        const payload = action.payload as {
          encryptedToken: string;
          applicationId: string;
          body: Panel;
          interactionHash?: string;
        };
        sideEffectStarted = true;
        if (action.kind === "REPLY_FOLLOWUP") {
          if (!this.discord.followup) throw new Error("FOLLOWUP_UNAVAILABLE");
          await this.discord.followup(
            payload.applicationId,
            this.vault.open(s, payload.encryptedToken),
            cleanAttachmentBody(payload.body),
          );
        } else
          await this.discord.editReply(
            payload.applicationId,
            this.vault.open(s, payload.encryptedToken),
            cleanAttachmentBody(payload.body),
            attachmentFiles(action.payload.files),
          );
        replyCompleted = true;
        if (payload.interactionHash)
          await this.commit(s, action, async (tx) => {
            await sql`UPDATE interaction_diagnostics SET result='completed',completed_at=now() WHERE ${tenant(s)} AND interaction_hash=${payload.interactionHash!}`.execute(
              tx,
            );
          });
      }
      await this.commit(s, action, async (tx) => {
        await sql`UPDATE action_outbox SET state='SUCCEEDED',lease_until=NULL,lease_token=NULL,error_category=NULL,last_error=NULL WHERE ${tenant(s)} AND id=${action.id}::uuid AND lease_token=${action.leaseToken}::uuid`.execute(
          tx,
        );
        await audit(
          tx,
          s,
          {
            key: "system",
            permissions: "0",
            roles: [],
            source: "SYSTEM",
            requestId: action.id,
          },
          "action.executed",
          null,
          { kind: action.kind, id: action.id },
        );
      });
      if (replyCompleted) this.interactionHealth?.completed();
    } catch (error) {
      const known = error instanceof DiscordFailure;
      logFailure({
        reference: errorReference(),
        action: action.kind,
        stage: "action_execution",
        error,
      });
      const panelRetry =
        ["PANEL_UPSERT", "PANEL_DELETE"].includes(action.kind) &&
        !creating &&
        (!known || error.status === 0 || error.status >= 500);
      const canRetry =
        panelRetry ||
        (known &&
          (error.status === 429 || error.status >= 500) &&
          (!sideEffectStarted ||
            error.status === 429 ||
            action.kind === "REPLY_EDIT"));
      const state =
        canRetry && action.attempts < 5
          ? "PENDING"
          : sideEffectStarted &&
              (!known || error.status >= 500 || error.status === 0)
            ? "UNKNOWN"
            : "FAILED";
      await sql`UPDATE action_outbox SET state=${state},lease_until=NULL,operation_phase=CASE WHEN ${state}='PENDING' THEN NULL ELSE operation_phase END,error_category=${known ? (error.status === 429 ? "DISCORD_RATE_LIMIT" : error.status === 0 ? "DISCORD_TIMEOUT" : error.status >= 500 ? "DISCORD_UNAVAILABLE" : "PERMISSION") : "INTERNAL"},last_error=${known ? `HTTP ${error.status}` : sideEffectStarted ? "Ambiguous side effect" : "Precondition failed"},
    available_at=${new Date(Date.now() + (known ? Math.max(error.retryAfter, 2 ** action.attempts) : 1) * 1000)} WHERE ${tenant(s)} AND id=${action.id}::uuid AND lease_token=${action.leaseToken}::uuid`.execute(
        this.db,
      );
      if (action.kind === "REPLY_EDIT") {
        this.interactionHealth?.failed("reply_failed");
        const hash =
          typeof action.payload.interactionHash === "string"
            ? action.payload.interactionHash
            : null;
        if (hash)
          await sql`UPDATE interaction_diagnostics SET result=${state === "UNKNOWN" ? "unknown" : state === "FAILED" ? "failed" : "queued"},error_code=${known ? `HTTP_${error.status}` : "REPLY_ERROR"} WHERE ${tenant(s)} AND interaction_hash=${hash}`.execute(
            this.db,
          );
      }
    }
    return true;
  }
  private async live(s: Scope, action: Action, tx: Tx = this.db) {
    return (
      (
        await sql`SELECT id FROM action_outbox WHERE ${tenant(s)} AND id=${action.id}::uuid AND state='RUNNING' AND lease_token=${action.leaseToken}::uuid AND lease_until>now() AND NOT EXISTS(SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NULL AND completed_at IS NOT NULL)`.execute(
          tx,
        )
      ).rows.length > 0
    );
  }
  private async commit(
    s: Scope,
    action: Action,
    write: (tx: Tx) => Promise<void>,
  ) {
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      if (!(await this.live(s, action, tx))) return false;
      await write(tx);
      return true;
    });
  }
  private async rolePlan(s: Scope, action: Action, sessionId: string) {
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      if (!(await this.live(s, action, tx))) return null;
      const session = await this.onboarding.session(s, sessionId, tx),
        episode = (
          await sql<{
            id: string;
            identity_id: string;
            left_at: Date | null;
          }>`SELECT * FROM membership_episodes WHERE ${tenant(s)} AND id=${session.episode_id}::uuid`.execute(
            tx,
          )
        ).rows[0];
      const latest = (
          await sql<{
            id: string;
          }>`SELECT id FROM flow_sessions WHERE ${tenant(s)} AND episode_id=${session.episode_id}::uuid AND context='PRODUCTION' ORDER BY created_at DESC LIMIT 1`.execute(
            tx,
          )
        ).rows[0],
        settings = await new SettingsService(this.db).get(s, tx);
      if (
        !episode ||
        latest?.id !== session.id ||
        session.context !== "PRODUCTION" ||
        !session.state.complete ||
        episode.left_at ||
        !settings.enabled ||
        !settings.onboardingEnabled
      )
        return null;
      const desired = new Map(
          selectedOptions(session.definition, session.state)
            .filter((o) => o.roleId)
            .map((o) => [o.roleId!, o.id]),
        ),
        grants = (
          await sql<{
            role_id: string;
          }>`SELECT role_id FROM nexus_role_grants WHERE ${tenant(s)} AND episode_id=${session.episode_id}::uuid AND revoked_at IS NULL`.execute(
            tx,
          )
        ).rows,
        userId = await this.vault.forAction(tx, s, episode.identity_id);
      return { session, episode, desired, grants, userId };
    });
  }

  private async refresh(s: Scope, action: Action) {
    // Editing an existing panel is idempotent. Rendering and REST run without a DB transaction or lock.
    const renderStartedAt = new Date();
    try {
      const existing = (
        await sql<{
          channel_id: string;
          message_id: string;
        }>`SELECT channel_id,message_id FROM settings_panels WHERE ${tenant(s)}`.execute(
          this.db,
        )
      ).rows[0];
      if (existing) {
        if (!this.refreshPanel) throw new Error("Panel renderer unavailable");
        const body = await this.refreshPanel(s);
        const live = (
          await sql`SELECT id FROM action_outbox WHERE ${tenant(s)} AND id=${action.id}::uuid AND state='RUNNING' AND lease_token=${action.leaseToken}::uuid AND lease_until>now() AND NOT EXISTS(SELECT 1 FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NULL AND completed_at IS NOT NULL)`.execute(
            this.db,
          )
        ).rows.length;
        if (!live) return true;
        await this.discord.editPanel(
          existing.channel_id,
          existing.message_id,
          body,
        );
      }
      await sql`UPDATE action_outbox SET state='SUCCEEDED',completed_at=now(),updated_at=now(),lease_until=NULL,lease_token=NULL,last_error=NULL,error_category=NULL WHERE ${tenant(s)} AND id=${action.id}::uuid AND lease_token=${action.leaseToken}::uuid`.execute(
        this.db,
      );
      await sql`UPDATE action_outbox SET state='SUCCEEDED',completed_at=now(),updated_at=now(),error_category=NULL,last_error=NULL WHERE ${tenant(s)} AND kind='PANEL_REFRESH' AND state='PENDING' AND created_at<=${renderStartedAt}`.execute(
        this.db,
      );
    } catch (error) {
      const known = error instanceof DiscordFailure,
        retry =
          (!known ||
            error.status === 0 ||
            error.status === 429 ||
            error.status >= 500) &&
          action.attempts < 5;
      const category = known
        ? error.status === 429
          ? "DISCORD_RATE_LIMIT"
          : error.status === 0
            ? "DISCORD_TIMEOUT"
            : error.status >= 500
              ? "DISCORD_UNAVAILABLE"
              : "DISCORD_PERMISSION"
        : "INTERNAL";
      logFailure({
        reference: errorReference(),
        action: "PANEL_REFRESH",
        stage: "action_execution",
        error,
      });
      await sql`UPDATE action_outbox SET state=${retry ? "PENDING" : "FAILED"},lease_until=NULL,lease_token=NULL,error_category=${category},last_error=${category},updated_at=now(),completed_at=CASE WHEN ${!retry} THEN now() ELSE NULL END,available_at=${new Date(Date.now() + Math.max(known ? error.retryAfter : 0, 2 ** action.attempts) * 1000)} WHERE ${tenant(s)} AND id=${action.id}::uuid AND lease_token=${action.leaseToken}::uuid`.execute(
        this.db,
      );
    }
    return true;
  }
}
