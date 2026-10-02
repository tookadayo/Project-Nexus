import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sql, tenant, json, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { RecipeDefinition } from "../../shared/src/measurement-recipes";
import {
  recipeDefinition,
  recipePresets,
} from "../../shared/src/measurement-recipes";
import { z } from "zod";
import { assert } from "../../shared/src/index";
import { EntitlementService } from "./entitlements";
import { billingScopeLock, billingAudit } from "./billing";
import { settingsSchema } from "./index";
export type RecipeVersion = {
  id: string;
  revision: number;
  definitionVersion: string;
  preset: string;
  definition: RecipeDefinition | null;
  createdAt: string;
  customKey?: string | null;
};
export async function currentRecipe(
  tx: Tx,
  s: Scope,
): Promise<RecipeVersion | null> {
  const row = (
    await sql<{
      id: string;
      revision: number;
      definition_version: string;
      preset: string;
      definition: RecipeDefinition;
      created_at: Date;
      custom_recipe_key?: string | null;
    }>`SELECT r.* FROM measurement_recipe_heads h JOIN measurement_recipe_versions r ON r.organization_id=h.organization_id AND r.guild_id=h.guild_id AND r.id=h.recipe_version_id WHERE h.organization_id=${s.organizationId}::uuid AND h.guild_id=${s.guildId}`.execute(
      tx,
    )
  ).rows[0];
  return row
    ? {
        id: row.id,
        revision: row.revision,
        definitionVersion: row.definition_version,
        preset: row.preset,
        definition: row.definition.schemaVersion === 1 ? row.definition : null,
        createdAt: row.created_at.toISOString(),
        customKey: row.custom_recipe_key ?? null,
      }
    : null;
}
export async function saveRecipe(
  tx: Tx,
  s: Scope,
  definition: RecipeDefinition,
) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"measurement-recipe:" + s.organizationId + ":" + s.guildId},0))`.execute(
    tx,
  );
  const current = await currentRecipe(tx, s);
  if (current && isDeepStrictEqual(current.definition, definition))
    return current.id;
  const id = randomUUID(),
    revision = (current?.revision ?? 0) + 1;
  await sql`INSERT INTO measurement_recipe_versions(organization_id,guild_id,id,revision,definition_version,preset,definition) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${revision},${definition.definitionVersion},${definition.preset},${json(definition)})`.execute(
    tx,
  );
  await sql`INSERT INTO measurement_recipe_heads VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid) ON CONFLICT(organization_id,guild_id) DO UPDATE SET recipe_version_id=EXCLUDED.recipe_version_id`.execute(
    tx,
  );
  return id;
}
export const customRecipeSchema = z
  .object({
    preset: z.enum(recipePresets),
    key: z.uuid().optional(),
    expectedHead: z.uuid().nullable(),
    strongSignals: z
      .array(
        z.enum([
          "reply.received",
          "thread.response_received",
          "voice.connected",
          "scheduled_event.attended",
        ]),
      )
      .max(4),
    supportingSignals: z
      .array(
        z.enum([
          "message.sent",
          "reaction.added",
          "poll.participated",
          "scheduled_event.subscribed",
          "stage.participated",
          "voice.duration",
          "thread.member_added",
        ]),
      )
      .max(7),
    voiceThresholdSeconds: z.number().int().min(60).max(3600),
    returnFromDay: z.number().int().min(2).max(30),
    returnThroughDay: z.number().int().min(7).max(60),
  })
  .strict()
  .refine(
    (value) => value.returnThroughDay >= value.returnFromDay,
    "Invalid return window",
  );
export async function saveCustomRecipe(
  tx: Tx,
  s: Scope,
  actorHash: string,
  input: unknown,
) {
  const data = customRecipeSchema.parse(input);
  await billingScopeLock(tx, s);
  await new EntitlementService(tx).require(s, "custom_recipe");
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"measurement-recipe:" + s.organizationId + ":" + s.guildId},0))`.execute(
    tx,
  );
  const current = await currentRecipe(tx, s);
  assert((current?.id ?? null) === data.expectedHead, "REVISION_CONFLICT", 409);
  const key = data.key ?? randomUUID();
  if (data.key)
    assert(
      (
        await sql`SELECT id FROM measurement_recipe_versions WHERE ${tenant(s)} AND custom_recipe_key=${key}::uuid LIMIT 1`.execute(
          tx,
        )
      ).rows.length,
      "RECIPE_NOT_FOUND",
      404,
    );
  else {
    const used = (
      await sql<{
        n: number;
      }>`SELECT count(DISTINCT custom_recipe_key)::integer AS n FROM measurement_recipe_versions WHERE ${tenant(s)}`.execute(
        tx,
      )
    ).rows[0]!.n;
    const limit = await new EntitlementService(tx).limit(
      s,
      "customRecipes",
      used,
    );
    assert(limit.allowed, "BILLING_LIMIT_REACHED", 403);
  }
  const row = (
      await sql<{
        settings: unknown;
      }>`SELECT settings FROM guild_settings WHERE ${tenant(s)}`.execute(tx)
    ).rows[0],
    cfg = settingsSchema.parse(row?.settings ?? {});
  assert(cfg.communityModel.confirmed, "COMMUNITY_MODEL_CONFIRMATION_REQUIRED");
  const definition = {
    ...recipeDefinition(
      { ...cfg.communityModel, recipePreset: data.preset },
      cfg.analysisScope,
      cfg.memberStages,
    ),
    definitionVersion: "custom-" + key,
    strongSignals: data.strongSignals,
    supportingSignals: data.supportingSignals,
    voiceThresholdSeconds: data.voiceThresholdSeconds,
    returnFromDay: data.returnFromDay,
    returnThroughDay: data.returnThroughDay,
  };
  const id = randomUUID(),
    revision = (
      await sql<{
        n: number;
      }>`SELECT COALESCE(max(revision),0)::integer+1 AS n FROM measurement_recipe_versions WHERE ${tenant(s)}`.execute(
        tx,
      )
    ).rows[0]!.n;
  await sql`INSERT INTO measurement_recipe_versions(organization_id,guild_id,id,revision,definition_version,preset,definition,custom_recipe_key) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${revision},${definition.definitionVersion},${data.preset},${json(definition)},${key}::uuid)`.execute(
    tx,
  );
  await sql`INSERT INTO measurement_recipe_heads VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid) ON CONFLICT(organization_id,guild_id) DO UPDATE SET recipe_version_id=EXCLUDED.recipe_version_id`.execute(
    tx,
  );
  await billingAudit(tx, s, actorHash, "recipe.custom_saved", {
    id,
    key,
    revision,
  });
  return { id, key, revision };
}
export async function recipeWindowAttributions(
  tx: Tx,
  s: Scope,
  from: Date,
  to: Date,
) {
  return (
    await sql<{
      id: string | null;
      definition_version: string;
    }>`SELECT DISTINCT NULLIF(recipe_key,'')::uuid AS id,definition_version FROM lifecycle_daily_rollups WHERE ${tenant(s)} AND day>=(${from}::timestamptz AT TIME ZONE 'UTC')::date AND day<=(${to}::timestamptz AT TIME ZONE 'UTC')::date UNION SELECT DISTINCT recipe_version_id AS id,definition_version FROM adaptive_facts WHERE ${tenant(s)} AND occurred_at>=${from} AND occurred_at<${to}`.execute(
      tx,
    )
  ).rows;
}

export async function recipeWindowVersions(
  tx: Tx,
  s: Scope,
  from: Date,
  to: Date,
) {
  return [
    ...new Set(
      (await recipeWindowAttributions(tx, s, from, to)).map((r) => r.id),
    ),
  ];
}
