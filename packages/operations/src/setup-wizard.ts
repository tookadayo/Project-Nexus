import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, tenant, json, type Database } from "../../db/src/index";
import {
  SettingsService,
  type Actor,
  type Settings,
} from "../../settings/src/index";
import { assert, type Scope } from "../../shared/src/index";
import { operationsAccess } from "./policy";
const id = z.string().regex(/^\d{17,20}$/),
  steps = ["scope", "notifications", "team", "goals"] as const;
const draftSchema = z
  .object({
    analysisScope: z.object({
      mode: z.enum(["all", "include", "exclude"]),
      channelIds: z.array(id).max(200),
    }),
    helperChannelId: id.nullable(),
    helperEnabled: z.boolean(),
    managerRoleIds: z.array(id).max(20),
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
      .max(7),
    skipped: z.array(z.enum(steps)).max(4),
  })
  .strict();
export type SetupDraft = {
  id: string;
  settings_revision: number;
  version: number;
  step: number;
  draft: z.infer<typeof draftSchema>;
  applied_at: Date | null;
};
export class SetupWizard {
  constructor(private readonly db: Database) {}
  async open(s: Scope, actor: Actor) {
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE");
      const cfg = await new SettingsService(tx).get(s),
        id = randomUUID();
      return (
        await sql<SetupDraft>`INSERT INTO setup_drafts(id,organization_id,guild_id,actor_hash,settings_revision,draft) VALUES(${id}::uuid,${s.organizationId}::uuid,${s.guildId},${actor.key},${cfg.revision},${json({ analysisScope: cfg.analysisScope, helperChannelId: cfg.helperChannelId, helperEnabled: cfg.helperEnabled, managerRoleIds: cfg.managerRoleIds, newMemberGoals: cfg.newMemberGoals, skipped: [] })}) RETURNING *`.execute(
          tx,
        )
      ).rows[0]!;
    });
  }
  async get(s: Scope, actor: Actor, id: string) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE");
      const row = (
        await sql<SetupDraft>`SELECT * FROM setup_drafts WHERE ${tenant(s)} AND id=${id}::uuid AND actor_hash=${actor.key} AND expires_at>now()`.execute(
          tx,
        )
      ).rows[0];
      assert(row, "COMPONENT_EXPIRED", 409);
      return row;
    });
  }
  async change(
    s: Scope,
    actor: Actor,
    id: string,
    version: number,
    field: string,
    values: string[],
  ) {
    z.uuid().parse(id);
    z.array(z.string().max(32)).max(25).parse(values);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE");
      const row = (
        await sql<SetupDraft>`SELECT * FROM setup_drafts WHERE ${tenant(s)} AND id=${id}::uuid AND actor_hash=${actor.key} AND expires_at>now() AND applied_at IS NULL FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(row && row.version === version, "REVISION_CONFLICT", 409);
      const draft = draftSchema.parse(row.draft);
      if (field === "mode" && row.step === 0)
        draft.analysisScope = {
          mode: z.enum(["all", "include", "exclude"]).parse(values[0]),
          channelIds: [],
        };
      else if (field === "channels" && row.step === 0)
        draft.analysisScope.channelIds = z
          .array(idSchema())
          .max(25)
          .parse(values);
      else if (field === "notifications" && row.step === 1) {
        draft.helperChannelId = idSchema().parse(values[0]);
        draft.helperEnabled = true;
      } else if (field === "team" && row.step === 2)
        draft.managerRoleIds = z.array(idSchema()).max(20).parse(values);
      else if (field === "goals" && row.step === 3)
        draft.newMemberGoals = draftSchema.shape.newMemberGoals.parse(values);
      else throw new Error("INVALID_SETUP_FIELD");
      draft.skipped = draft.skipped.filter((step) => step !== steps[row.step]);
      return (
        await sql<SetupDraft>`UPDATE setup_drafts SET draft=${json(draft)},version=version+1 WHERE id=${row.id}::uuid RETURNING *`.execute(
          tx,
        )
      ).rows[0]!;
    });
  }
  async move(
    s: Scope,
    actor: Actor,
    id: string,
    version: number,
    direction: "next" | "back" | "skip",
  ) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "CONFIGURE");
      const row = (
        await sql<SetupDraft>`SELECT * FROM setup_drafts WHERE ${tenant(s)} AND id=${id}::uuid AND actor_hash=${actor.key} AND expires_at>now() AND applied_at IS NULL FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(row && row.version === version, "REVISION_CONFLICT", 409);
      const draft = draftSchema.parse(row.draft);
      if (direction === "skip") {
        assert(row.step > 0 && row.step < 4, "INVALID_SETUP_STEP");
        draft.skipped = [...new Set([...draft.skipped, steps[row.step]!])];
      }
      if (row.step === 0 && direction === "next")
        assert(
          draft.analysisScope.mode === "all" ||
            draft.analysisScope.channelIds.length,
          "INVALID_ANALYSIS_SCOPE",
        );
      const step = Math.max(
        0,
        Math.min(4, row.step + (direction === "back" ? -1 : 1)),
      );
      return (
        await sql<SetupDraft>`UPDATE setup_drafts SET step=${step},draft=${json(draft)},version=version+1 WHERE id=${row.id}::uuid RETURNING *`.execute(
          tx,
        )
      ).rows[0]!;
    });
  }
  async confirm(s: Scope, actor: Actor, id: string, version: number) {
    const row = await this.get(s, actor, id);
    if (row.applied_at) return new SettingsService(this.db).get(s);
    return new SettingsService(this.db).mutate(
      s,
      actor,
      row.settings_revision,
      async (current, tx) => {
        await operationsAccess(tx, s, actor, "CONFIGURE");
        const saved = (
          await sql<SetupDraft>`SELECT * FROM setup_drafts WHERE ${tenant(s)} AND id=${id}::uuid AND actor_hash=${actor.key} AND expires_at>now() AND applied_at IS NULL FOR UPDATE`.execute(
            tx,
          )
        ).rows[0];
        assert(
          saved && saved.step === 4 && saved.version === version,
          "REVISION_CONFLICT",
          409,
        );
        const { skipped: _skipped, ...patch } = draftSchema.parse(saved.draft);
        void _skipped;
        await sql`UPDATE setup_drafts SET applied_at=now(),version=version+1 WHERE id=${id}::uuid`.execute(
          tx,
        );
        return {
          ...current,
          ...patch,
          setupVersion: 2,
          setupSteps: {
            scope: true,
            notifications: true,
            team: true,
            goals: true,
          },
        } satisfies Settings;
      },
    );
  }
}
function idSchema() {
  return id;
}
