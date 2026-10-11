import {betaAccess,betaLock} from '../../security/src/hosted-beta';
import {privacyReadLock} from '../../db/src/index';
export * from "./billing/index";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql, tenant, json, type Database, type Tx } from "../../db/src/index";
import { actorPermissions } from "../../operations/src/policy";
import { assert, type Scope } from "../../shared/src/index";
import { saveRecipe, currentRecipe } from "./recipes";
import { recipeDefinition } from "../../shared/src/measurement-recipes";
import { communityModelSchema } from "../../shared/src/community-model";
import { analysisScopeSchema } from "../../shared/src/channel-scope";
import type { CapabilitySnapshot } from "../../shared/src/community-model";
import { EntitlementService } from "./billing/entitlements";
export const templates = [
  "Gaming",
  "Creator",
  "Developer / OSS",
  "Product / SaaS",
  "Education",
  "General Community",
] as const;
const id = z.string().regex(/^\d{17,20}$/);
export const settingsSchema = z
  .object({
    communityModel: communityModelSchema,
    enabled: z.boolean().default(true),
    onboardingEnabled: z.boolean().default(false),
    template: z.enum(templates).default("General Community"),
    uiLanguage: z.enum(["auto", "ja", "en", "bilingual"]).default("auto"),
    startChannelId: id.nullable().default(null),
    adminNotificationChannelId: id.nullable().default(null),
    adminRoleId: id.nullable().default(null),
    managerRoleIds: z.array(id).max(20).default([]),
    helperRoleIds: z.array(id).max(20).default([]),
    flowVersionId: z.uuid().nullable().default(null),
    weeklySummaryEnabled: z.boolean().default(false),
    weeklySummaryChannelId: id.nullable().default(null),
    weeklySummaryDay: z.number().int().min(0).max(6).default(1),
    weeklySummaryHour: z.number().int().min(0).max(23).default(9),
    timezone: z
      .string()
      .max(64)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      })
      .default("UTC"),
    setupVersion: z.number().int().min(1).default(2),
    setupSteps: z
      .object({
        scope: z.boolean(),
        team: z.boolean(),
        notifications: z.boolean(),
        goals: z.boolean(),
      })
      .strict()
      .default({
        scope: false,
        team: false,
        notifications: false,
        goals: false,
      }),
    goalPreset: z
      .enum(["multiplayer", "early_access", "live_service"])
      .nullable()
      .default(null),
    newMemberGoals: z
      .array(
        z.enum([
          "reply",
          "lfg",
          "voice",
          "event",
          "feedback",
          "bug",
          "playtest",
        ]),
      )
      .max(7)
      .default([]),
    importantChannels: z
      .array(
        z
          .object({
            channelId: id,
            purpose: z.enum([
              "lfg",
              "feedback",
              "bug",
              "playtest",
              "discussion",
            ]),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    analysisScope: analysisScopeSchema.default({ mode: "all", channelIds: [] }),
    staffRoleIds: z.array(id).max(30).default([]),
    memberStages: z
      .object({
        newDays: z.number().int().min(1).max(90).default(14),
        startingDays: z.number().int().min(15).max(180).default(30),
        recentDays: z.number().int().min(7).max(90).default(30),
        activeDays: z.number().int().min(2).max(30).default(2),
        repeatDays: z.number().int().min(2).max(14).default(2),
        retainedFromDay: z.number().int().min(2).max(30).default(7),
        retainedThroughDay: z.number().int().min(7).max(60).default(14),
      })
      .strict()
      .default({
        newDays: 14,
        startingDays: 30,
        recentDays: 30,
        activeDays: 2,
        repeatDays: 2,
        retainedFromDay: 7,
        retainedThroughDay: 14,
      }),
    mode: z.literal("SUGGEST").default("SUGGEST"),
    activationWindowHours: z.number().int().min(1).max(720).default(168),
    firstResponseMinutes: z.number().int().min(1).max(1440).default(20),
    helperEnabled: z.boolean().default(false),
    helperChannelId: id.nullable().default(null),
    helperRoleId: id.nullable().default(null),
    helperAlertCooldownMinutes: z.number().int().min(15).max(1440).default(60),
    reportEnabled: z.literal(false).default(false),
    onboardingMode: z
      .enum(["auto", "native", "fallback", "hybrid"])
      .default("auto"),
    hybrid: z
      .object({
        enabled: z.boolean(),
        flowVersionId: z.uuid().nullable(),
        trigger: z.enum([
          "after_join",
          "after_native_onboarding_observed",
          "manual",
        ]),
        nativePromptMappings: z.record(z.string(), z.string()),
      })
      .strict()
      .default({
        enabled: false,
        flowVersionId: null,
        trigger: "manual",
        nativePromptMappings: {},
      }),
    detailedRetentionDays: z
      .union([z.literal(7), z.literal(14), z.literal(30)])
      .default(30),
    aggregateRetentionMonths: z
      .union([z.literal(3), z.literal(12), z.literal(24)])
      .default(24),
    dmEnabled: z.boolean().default(false),
    flags: z
      .object({
        native_capability_v2: z.boolean().default(false),
        native_snapshot_v2: z.boolean().default(false),
        activation_dsl_v2: z.boolean().default(true),
        interventions_v2: z.boolean().default(true),
        experiments_v2: z.boolean().default(true),
        billing_v1: z.boolean().default(false),
      })
      .strict()
      .default({
        native_capability_v2: false,
        native_snapshot_v2: false,
        activation_dsl_v2: true,
        interventions_v2: true,
        experiments_v2: true,
        billing_v1: false,
      }),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsView = Settings & { revision: number };
export type Actor = {
  key: string;
  permissions: string;
  roles: string[];
  source: "DISCORD_PANEL" | "WEB_DASHBOARD" | "SYSTEM";
  requestId: string;
  encryptedUserId?: string;
  /** Request-local trusted identity projection; never persisted or sent to clients. */
  organizationMemberDigest?: (rootOrganizationId: string) => string;
};
export async function audit(
  tx: Tx,
  s: Scope,
  actor: Actor,
  action: string,
  before: unknown,
  after: unknown,
) {
  await sql`INSERT INTO audit_logs(organization_id,guild_id,id,actor,action,source,before_value,after_value,request_id,actor_identity_ciphertext)
 VALUES(${s.organizationId}::uuid,${s.guildId},${randomUUID()}::uuid,${actor.key},${action},${actor.source},${json(before)},${json(after)},${actor.requestId},${actor.encryptedUserId ?? null})`.execute(
    tx,
  );
}
export class SettingsService {
  constructor(private readonly db: Database) {}
  async get(s: Scope, tx: Tx = this.db): Promise<SettingsView> {
    const { rows } = await sql<{
      settings: Settings;
      revision: number;
    }>`SELECT settings,revision FROM guild_settings WHERE ${tenant(s)}`.execute(
      tx,
    );
    const saved = rows[0]?.settings,
      settings = settingsSchema.parse(saved ?? {});
    if (saved && !Object.hasOwn(saved, "timezone"))
      settings.timezone = "Asia/Tokyo";
    if (saved && !Object.hasOwn(saved, "setupSteps"))
      settings.setupSteps = {
        scope: true,
        team: true,
        notifications: true,
        goals: true,
      };
    if (saved && !Object.hasOwn(saved, "setupVersion"))
      settings.setupVersion = 1;
    return { ...settings, revision: rows[0]?.revision ?? 0 };
  }
  async mutate(
    s: Scope,
    actor: Actor,
    revision: number,
    change: (current: Settings, tx: Tx) => Promise<Settings>,
    redactAudit = false,
  ): Promise<SettingsView> {
    return this.db.transaction().execute(async (tx) => {
      if(redactAudit){
        // All mutating paths acquire privacy, Beta, then settings locks.
        // A deletion must never wait for privacy while owning the settings lock.
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${'privacy:'+s.organizationId+':'+s.guildId},0))`.execute(tx);
        await betaLock(tx,s,true);
      }else{await privacyReadLock(tx,s);await betaAccess(tx,s);}
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.organizationId + ":" + s.guildId},0))`.execute(
        tx,
      );
      const current = await this.get(s, tx);
      assert(
        (await actorPermissions(tx,s,actor)).includes('CONFIGURE'),
        "ADMIN_REQUIRED",
        403,
      );
      assert(current.revision === revision, "REVISION_CONFLICT", 409);
      const { revision: _revision, ...before } = current;
      void _revision;
      const next = settingsSchema.parse(await change(before, tx));
      const entitlements = new EntitlementService(tx);
      if (
        next.helperEnabled &&
        (!before.helperEnabled ||
          next.helperChannelId !== before.helperChannelId ||
          next.helperRoleId !== before.helperRoleId)
      )
        await entitlements.require(s, "attention_automation");
      if (
        next.weeklySummaryEnabled &&
        (!before.weeklySummaryEnabled ||
          next.weeklySummaryChannelId !== before.weeklySummaryChannelId)
      )
        await entitlements.require(s, "scheduled_digest");
      if (
        JSON.stringify(next.communityModel) !==
        JSON.stringify(before.communityModel)
      ) {
        const snapshot = (
          await sql<{
            snapshot: CapabilitySnapshot;
          }>`SELECT snapshot FROM guild_capability_snapshots WHERE ${tenant(s)} ORDER BY checked_at DESC LIMIT 1`.execute(
            tx,
          )
        ).rows[0]?.snapshot;
        if (snapshot) {
          assert(
            next.communityModel.channels.every((c) =>
              snapshot.channels.some((known) => known.id === c.channelId),
            ),
            "CHANNEL_NOT_FOUND",
          );
          assert(
            next.communityModel.forumTags.every((t) =>
              snapshot.channels.some(
                (c) =>
                  c.id === t.channelId &&
                  [15, 16].includes(c.type) &&
                  c.tagIds.includes(t.tagId),
              ),
            ),
            "FORUM_TAG_NOT_FOUND",
          );
        }
      }
      const recipeChanged =
        JSON.stringify([
          next.communityModel,
          next.analysisScope,
          next.memberStages,
        ]) !==
        JSON.stringify([
          before.communityModel,
          before.analysisScope,
          before.memberStages,
        ]);
      if (
        next.communityModel.confirmed &&
        (recipeChanged || !(await currentRecipe(tx, s)))
      )
        await saveRecipe(
          tx,
          s,
          recipeDefinition(
            next.communityModel,
            next.analysisScope,
            next.memberStages,
          ),
        );
      if (next.enabled && !before.enabled)
        await sql`DELETE FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NULL`.execute(
          tx,
        );
      assert(
        !next.onboardingEnabled || (next.startChannelId && next.flowVersionId),
        "ONBOARDING_NOT_CONFIGURED",
      );
      await sql`INSERT INTO guild_settings(organization_id,guild_id,revision,settings) VALUES(${s.organizationId}::uuid,${s.guildId},${revision + 1},${json(next)})
    ON CONFLICT(organization_id,guild_id) DO UPDATE SET revision=EXCLUDED.revision,settings=EXCLUDED.settings`.execute(
        tx,
      );
      await audit(
        tx,
        s,
        redactAudit
          ? { ...actor, key: "deleted-admin", encryptedUserId: undefined }
          : actor,
        "settings.updated",
        redactAudit ? null : before,
        redactAudit ? { enabled: false } : next,
      );
      return { ...next, revision: revision + 1 };
    });
  }
  async update(
    s: Scope,
    actor: Actor,
    revision: number,
    patch: Partial<Settings>,
  ) {
    return this.mutate(s, actor, revision, async (current) =>
      settingsSchema.parse({ ...current, ...patch }),
    );
  }
}
