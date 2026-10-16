import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ensureGuild,
  json,
  privacyReadLock,
  sql,
  tenant,
  type Database,
  type Tx,
} from "../../db/src/index";
import {
  SettingsService,
  settingsSchema,
  type Actor,
  type SettingsView,
} from "../../settings/src/index";
import { assert, type Scope } from "../../shared/src/index";
import type { DiscordPort, DiscordRest } from "../../discord/src/rest";
import type { PublicApiContext } from "../../security/src/public-api";
import { operationsAccess } from "./policy";
import { analysisChannelScope } from "../../lifecycle/src/discovery";

const uniqueIds = z
  .array(z.string().regex(/^\d{17,20}$/))
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length);
export const webSetupSettingsSchema = settingsSchema.pick({
  uiLanguage: true,
  timezone: true,
  analysisScope: true,
  helperChannelId: true,
  helperEnabled: true,
  managerRoleIds: true,
  newMemberGoals: true,
  goalPreset: true,
});
export const webSetupPatchSchema = z
  .object({
    uiLanguage: settingsSchema.shape.uiLanguage.removeDefault().optional(),
    timezone: settingsSchema.shape.timezone.removeDefault().optional(),
    analysisScope: settingsSchema.shape.analysisScope
      .removeDefault()
      .optional(),
    helperChannelId: settingsSchema.shape.helperChannelId
      .removeDefault()
      .optional(),
    goalPreset: settingsSchema.shape.goalPreset.removeDefault().optional(),
    managerRoleIds: uniqueIds.optional(),
    newMemberGoals: settingsSchema.shape.newMemberGoals
      .refine((values) => new Set(values).size === values.length)
      .optional(),
  })
  .strict();
export type WebSetupSettings = z.infer<typeof webSetupSettingsSchema>;
type DraftRow = {
  id: string;
  version: number;
  settings_revision: number;
  settings: WebSetupSettings;
  applied_revision: number | null;
  expires_at: Date;
};
export const setupDraftView = (row: DraftRow) => ({
  id: row.id,
  version: row.version,
  settingsRevision: row.settings_revision,
  settings: row.settings,
  appliedRevision: row.applied_revision,
  expiresAt: row.expires_at.toISOString(),
});
const fingerprint = (operation: string, input: unknown) =>
  createHash("sha256")
    .update(JSON.stringify([operation, input]))
    .digest("hex");
function initialSettings(current: SettingsView) {
  const selected = Object.fromEntries(
    Object.keys(webSetupSettingsSchema.shape).map((key) => [
      key,
      current[key as keyof SettingsView],
    ]),
  );
  return webSetupSettingsSchema.parse({
    ...selected,
    ...(current.revision === 0
      ? { analysisScope: { mode: "include", channelIds: [] } }
      : {}),
  });
}
async function savedTimeZoneSource(tx: Tx, s: Scope) {
  const saved = (
    await sql<{ settings: Record<string, unknown> }>`SELECT settings FROM guild_settings WHERE ${tenant(s)}`.execute(tx)
  ).rows[0]?.settings;
  if (!saved) return "missing" as const;
  if (!Object.hasOwn(saved, "timezone")) return "legacy" as const;
  return settingsSchema.shape.timezone.removeDefault().safeParse(saved.timezone).success
    ? ("saved" as const)
    : ("invalid" as const);
}
export class WebSetupService {
  constructor(
    private readonly db: Database,
    private readonly discord: DiscordPort,
    private readonly context?: PublicApiContext,
  ) {}
  private async authorize(tx: Tx, s: Scope, actor: Actor) {
    if (this.context)
      assert(
        this.context.scope.guildId === s.guildId &&
          this.context.scope.organizationId === s.organizationId &&
          this.context.actor.key === actor.key &&
          Date.now() - this.context.snapshot.checkedAt <= 10000 &&
          Date.now() >= this.context.snapshot.checkedAt,
        "AUTHORIZATION_EXPIRED",
        403,
      );
    await operationsAccess(tx, s, actor, "CONFIGURE");
  }
  private async lock(tx: Tx, s: Scope, actor: Actor) {
    await this.authorize(tx, s, actor);
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"web-setup:" + s.organizationId + ":" + s.guildId + ":" + actor.key},0))`.execute(
      tx,
    );
  }
  private async previous(
    tx: Tx,
    s: Scope,
    actor: Actor,
    id: string,
    operation: string,
    hash: string,
  ) {
    z.uuid().parse(id);
    const row = (
      await sql<{
        operation: string;
        fingerprint: string;
        result: Record<string, unknown>;
      }>`SELECT operation,fingerprint,result FROM web_setup_requests WHERE ${tenant(s)} AND actor_hash=${actor.key} AND id=${id}::uuid AND expires_at>clock_timestamp()`.execute(
        tx,
      )
    ).rows[0];
    if (row)
      assert(
        row.operation === operation && row.fingerprint === hash,
        "IDEMPOTENCY_CONFLICT",
        409,
      );
    return row?.result;
  }
  private async remember(
    tx: Tx,
    s: Scope,
    actor: Actor,
    id: string,
    operation: string,
    hash: string,
    result: unknown,
  ) {
    await sql`INSERT INTO web_setup_requests(organization_id,guild_id,actor_hash,id,operation,fingerprint,result) VALUES(${s.organizationId}::uuid,${s.guildId},${actor.key},${id}::uuid,${operation},${hash},${json(result)})`.execute(
      tx,
    );
  }
  async result(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await this.authorize(tx, s, actor);
      const row = (
        await sql<{
          result: unknown;
        }>`SELECT result FROM web_setup_requests WHERE ${tenant(s)} AND actor_hash=${actor.key} AND id=${id}::uuid AND expires_at>clock_timestamp()`.execute(
          tx,
        )
      ).rows[0];
      return row
        ? { state: "COMPLETED" as const, result: row.result }
        : { state: "NOT_FOUND" as const };
    });
  }
  async status(s: Scope, actor: Actor, name: string) {
    return this.db.transaction().execute(async (tx) => {
      await this.authorize(tx, s, actor);
      const current = await new SettingsService(tx).get(s),
        connection =
          (
            await sql`SELECT 1 FROM server_web_links WHERE ${tenant(s)} AND revoked_at IS NULL`.execute(
              tx,
            )
          ).rows.length > 0,
        draft = (
          await sql<DraftRow>`SELECT id,version,settings_revision,settings,applied_revision,expires_at FROM web_setup_drafts WHERE ${tenant(s)} AND actor_hash=${actor.key} AND expires_at>clock_timestamp() AND applied_revision IS NULL ORDER BY created_at DESC LIMIT 1`.execute(
            tx,
          )
        ).rows[0];
      return {
        state: !connection
          ? ("LINK_REQUIRED" as const)
          : current.setupVersion < 3
            ? ("SETUP_REQUIRED" as const)
            : ("COMPLETE" as const),
        guild: { id: s.guildId, name },
        checkedAt: new Date().toISOString(),
        connection: connection ? "VERIFIED" : "INSTALLED_NOT_VERIFIED",
        settingsRevision: current.revision,
        setupVersion: current.setupVersion,
        existing: current.revision > 0,
        // Compatibility defaults in SettingsService are not evidence of a
        // user's saved region. Clients must confirm a candidate separately.
        timeZoneSource: await savedTimeZoneSource(tx, s),
        missing: current.setupVersion < 3 ? ["review"] : [],
        settings: initialSettings(current),
        ...(draft ? { draft: setupDraftView(draft) } : {}),
      };
    });
  }
  async verify(context: PublicApiContext, requestId: string) {
    const { scope: s, actor, snapshot, userId } = context,
      hash = fingerprint("verify", {});
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      await this.lock(tx, s, actor);
      const old = await this.previous(tx, s, actor, requestId, "verify", hash);
      const link = (
        await sql`SELECT 1 FROM server_web_links WHERE ${tenant(s)} AND revoked_at IS NULL`.execute(
          tx,
        )
      ).rows.length;
      if (old) {
        assert(link, "SERVER_NOT_VERIFIED", 409);
        return old;
      }
      assert(
        link ||
          snapshot.member.ownerId === userId ||
          (BigInt(snapshot.member.permissions) & 40n) !== 0n,
        "ADMIN_REQUIRED",
        403,
      );
      assert(
        Date.now() - snapshot.checkedAt <= 10000,
        "AUTHORIZATION_EXPIRED",
        403,
      );
      await ensureGuild(tx, s);
      // Repeat confirmation returns the existing connection, without new generations.
      if (!link)
        await sql`INSERT INTO server_web_links(organization_id,guild_id,verified_at,verified_by_hash,verified_by_identity_ciphertext,updated_at,revision) VALUES(${s.organizationId}::uuid,${s.guildId},clock_timestamp(),${actor.key},${actor.encryptedUserId!},clock_timestamp(),${randomUUID()}::uuid) ON CONFLICT(organization_id,guild_id) DO UPDATE SET verified_at=EXCLUDED.verified_at,verified_by_hash=EXCLUDED.verified_by_hash,verified_by_identity_ciphertext=EXCLUDED.verified_by_identity_ciphertext,revoked_at=NULL,updated_at=EXCLUDED.updated_at,revision=EXCLUDED.revision`.execute(
          tx,
        );
      const result = { state: "VERIFIED", guildId: s.guildId };
      await this.remember(tx, s, actor, requestId, "verify", hash, result);
      return result;
    });
  }
  async save(
    s: Scope,
    actor: Actor,
    input: {
      requestId: string;
      draftId?: string;
      expectedDraftRevision?: number;
      patch: z.infer<typeof webSetupPatchSchema>;
    },
  ) {
    const patch = webSetupPatchSchema.parse(input.patch),
      hash = fingerprint("draft", input);
    return this.db.transaction().execute(async (tx) => {
      await this.lock(tx, s, actor);
      const old = await this.previous(
        tx,
        s,
        actor,
        input.requestId,
        "draft",
        hash,
      );
      if (old) return old;
      const current = await new SettingsService(tx).get(s);
      let row: DraftRow | undefined;
      if (input.draftId) {
        z.uuid().parse(input.draftId);
        row = (
          await sql<DraftRow>`SELECT * FROM web_setup_drafts WHERE ${tenant(s)} AND actor_hash=${actor.key} AND id=${input.draftId}::uuid AND expires_at>clock_timestamp() AND applied_revision IS NULL FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        assert(
          row && row.version === input.expectedDraftRevision,
          "REVISION_CONFLICT",
          409,
        );
      } else
        assert(
          input.expectedDraftRevision === undefined,
          "REVISION_CONFLICT",
          409,
        );
      // A new draft must not silently promote UTC/legacy defaults into a
      // confirmed guild setting. An explicit field also confirms unchanged UTC.
      if (!row && (await savedTimeZoneSource(tx, s)) !== "saved")
        assert(Object.hasOwn(patch, "timezone"), "TIMEZONE_CONFIRMATION_REQUIRED");
      const settings = webSetupSettingsSchema.parse({
        ...(row?.settings ?? initialSettings(current)),
        ...patch,
      });
      // New selection is a finite include snapshot; an old all/exclude setting is preserved unless explicitly changed.
      if (patch.analysisScope)
        assert(
          patch.analysisScope.mode === "include",
          "INVALID_ANALYSIS_SCOPE",
        );
      const id = row?.id ?? randomUUID();
      const saved = (
        await sql<DraftRow>`INSERT INTO web_setup_drafts(organization_id,guild_id,id,actor_hash,settings_revision,settings) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${actor.key},${current.revision},${json(settings)}) ON CONFLICT(organization_id,guild_id,id) DO UPDATE SET settings=EXCLUDED.settings,version=web_setup_drafts.version+1 RETURNING *`.execute(
          tx,
        )
      ).rows[0]!;
      const result = setupDraftView(saved);
      await this.remember(tx, s, actor, input.requestId, "draft", hash, result);
      return result;
    });
  }
  private async validateTargets(
    tx: Tx,
    s: Scope,
    actor: Actor,
    current: SettingsView,
    next: WebSetupSettings,
  ) {
    if (next.helperChannelId !== current.helperChannelId) {
      assert(
        !current.helperEnabled,
        "NOTIFICATION_IMPACT_REVIEW_REQUIRED",
        409,
      );
      if (next.helperChannelId) {
        await this.canViewChannel(s, actor, next.helperChannelId);
        await this.discord.checkChannel(s.guildId, next.helperChannelId);
      }
    }
    if (
      JSON.stringify(next.managerRoleIds) !==
      JSON.stringify(current.managerRoleIds)
    ) {
      const roles = await this.discord.roles(s.guildId);
      assert(
        next.managerRoleIds.every((id) => roles.some((role) => role.id === id)),
        "ROLE_NOT_FOUND",
      );
    }
    if (
      JSON.stringify(next.analysisScope) !==
      JSON.stringify(current.analysisScope)
    ) {
      assert(next.analysisScope.mode === "include", "INVALID_ANALYSIS_SCOPE");
      const resolved = await analysisChannelScope(tx, s, {
        communityModel: current.communityModel,
        analysisScope: next.analysisScope,
      });
      assert(
        next.analysisScope.channelIds.every((id) =>
          resolved.resolutions.some(
            (c) => c.actualChannelId === id && c.selected,
          ),
        ),
        "CHANNEL_PERMISSION_MISSING",
      );
      // Check the actual current member's overwrites before accepting new targets.
      for (const id of next.analysisScope.channelIds)
        await this.canViewChannel(s, actor, id);
    }
  }
  private async canViewChannel(s: Scope, actor: Actor, id: string) {
    if ((BigInt(actor.permissions) & 8n) !== 0n) return;
    const reader = this.discord as DiscordPort &
      Partial<Pick<DiscordRest, "canReadAttentionChannel">>;
    assert(
      this.context &&
        reader.canReadAttentionChannel &&
        (await reader.canReadAttentionChannel(
          s.guildId,
          id,
          this.context.userId,
          this.context.snapshot.member,
        )),
      "CHANNEL_PERMISSION_MISSING",
      403,
    );
  }
  async apply(
    s: Scope,
    actor: Actor,
    input: {
      requestId: string;
      draftId: string;
      expectedDraftRevision: number;
      expectedSettingsRevision: number;
      confirmScopeChange?: boolean;
    },
  ) {
    const hash = fingerprint("apply", input);
    const replay = await this.db.transaction().execute(async (tx) => {
      await this.authorize(tx, s, actor);
      return this.previous(tx, s, actor, input.requestId, "apply", hash);
    });
    if (replay) return replay;
    let committedResult:
      | { draftId: string; settingsRevision: number; complete: boolean }
      | undefined;
    try {
      await new SettingsService(this.db).mutate(
        s,
        actor,
        input.expectedSettingsRevision,
        async (current, tx) => {
          await this.lock(tx, s, actor);
          assert(
            (
              await sql`SELECT 1 FROM server_web_links WHERE ${tenant(s)} AND revoked_at IS NULL`.execute(
                tx,
              )
            ).rows.length,
            "SERVER_NOT_VERIFIED",
            403,
          );
          const row = (
            await sql<DraftRow>`SELECT * FROM web_setup_drafts WHERE ${tenant(s)} AND id=${input.draftId}::uuid AND actor_hash=${actor.key} AND expires_at>clock_timestamp() FOR UPDATE`.execute(
              tx,
            )
          ).rows[0];
          assert(
            row &&
              row.applied_revision === null &&
              row.version === input.expectedDraftRevision &&
              row.settings_revision === input.expectedSettingsRevision,
            "REVISION_CONFLICT",
            409,
          );
          const next = webSetupSettingsSchema.parse(row.settings);
          assert(
            next.helperEnabled === current.helperEnabled,
            "NOTIFICATION_IMPACT_REVIEW_REQUIRED",
            409,
          );
          const scopeChanged =
            JSON.stringify(next.analysisScope) !==
            JSON.stringify(current.analysisScope);
          assert(
            !scopeChanged ||
              input.expectedSettingsRevision === 0 ||
              input.confirmScopeChange === true,
            "SCOPE_IMPACT_REVIEW_REQUIRED",
            409,
          );
          await this.validateTargets(
            tx,
            s,
            actor,
            { ...current, revision: input.expectedSettingsRevision },
            next,
          );
          const result = {
            draftId: row.id,
            settingsRevision: input.expectedSettingsRevision + 1,
            complete: true,
          };
          await sql`UPDATE web_setup_drafts SET applied_revision=${result.settingsRevision},version=version+1 WHERE ${tenant(s)} AND id=${row.id}::uuid`.execute(
            tx,
          );
          await this.remember(
            tx,
            s,
            actor,
            input.requestId,
            "apply",
            hash,
            result,
          );
          committedResult = result;
          return {
            ...current,
            ...next,
            setupVersion: 3,
            setupSteps: {
              scope: true,
              notifications: true,
              team: true,
              goals: true,
            },
          };
        },
      );
    } catch (error) {
      const replay = await this.db.transaction().execute(async (tx) => {
        await this.authorize(tx, s, actor);
        return this.previous(tx, s, actor, input.requestId, "apply", hash);
      });
      if (replay) return replay;
      throw error;
    }
    assert(committedResult, "SAVE_RESULT_UNKNOWN", 503);
    return committedResult;
  }
  async complete(
    s: Scope,
    actor: Actor,
    input: { requestId: string; settingsRevision: number },
  ) {
    const hash = fingerprint("complete", input);
    return this.db.transaction().execute(async (tx) => {
      await this.lock(tx, s, actor);
      const old = await this.previous(
        tx,
        s,
        actor,
        input.requestId,
        "complete",
        hash,
      );
      if (old) return old;
      const cfg = await new SettingsService(tx).get(s);
      assert(
        (
          await sql`SELECT 1 FROM server_web_links WHERE ${tenant(s)} AND revoked_at IS NULL`.execute(
            tx,
          )
        ).rows.length,
        "SERVER_NOT_VERIFIED",
        403,
      );
      assert(
        cfg.revision === input.settingsRevision && cfg.setupVersion >= 3,
        "REVISION_CONFLICT",
        409,
      );
      const result = { settingsRevision: cfg.revision, complete: true };
      await this.remember(
        tx,
        s,
        actor,
        input.requestId,
        "complete",
        hash,
        result,
      );
      return result;
    });
  }
  async purge() {
    await sql`DELETE FROM web_setup_drafts WHERE expires_at<=clock_timestamp()`.execute(
      this.db,
    );
    await sql`DELETE FROM web_setup_requests WHERE expires_at<=clock_timestamp()`.execute(
      this.db,
    );
    await sql`DELETE FROM web_setup_install_requests WHERE expires_at<=clock_timestamp()`.execute(
      this.db,
    );
  }
}
