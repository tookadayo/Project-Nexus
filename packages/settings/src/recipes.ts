import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sql, tenant, json, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { RecipeDefinition } from "../../shared/src/measurement-recipes";
export type RecipeVersion = {
  id: string;
  revision: number;
  definitionVersion: string;
  preset: string;
  definition: RecipeDefinition | null;
  createdAt: string;
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
      }
    : null;
}
export async function saveRecipe(
  tx: Tx,
  s: Scope,
  definition: RecipeDefinition,
) {
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
