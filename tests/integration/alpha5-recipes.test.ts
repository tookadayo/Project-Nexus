import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { infrastructure } from "../fixtures/infrastructure";
import {
  connect,
  migrate,
  ensureGuild,
  sql,
  tenant,
  type Database,
} from "../../packages/db/src/index";
import { SettingsService, type Actor } from "../../packages/settings/src/index";
import { currentRecipe } from "../../packages/settings/src/recipes";
import { communityModelSchema } from "../../packages/shared/src/community-model";
import { presetDefinitions } from "../../packages/shared/src/measurement-recipes";
let infra: Awaited<ReturnType<typeof infrastructure>>, db: Database;
beforeAll(async () => {
  infra = await infrastructure();
  db = connect(infra.databaseUrl);
  await migrate(db);
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});
const actor: Actor = {
  key: "admin",
  source: "WEB_DASHBOARD",
  permissions: "32",
  roles: [],
  requestId: "recipe-test",
};
it("stores immutable revisions and does not revise measurement when an unrelated preference changes", async () => {
  const s = { organizationId: randomUUID(), guildId: "111111111111111199" };
  await ensureGuild(db, s);
  const settings = new SettingsService(db);
  await settings.update(s, actor, 0, {
    communityModel: communityModelSchema.parse({
      modes: presetDefinitions.VOICE_FIRST.modes,
      recipePreset: "VOICE_FIRST",
      confirmed: true,
    }),
  });
  const first = await currentRecipe(db, s);
  expect(first?.definition?.voiceThresholdSeconds).toBe(300);
  await settings.update(s, actor, 1, { uiLanguage: "ja" });
  expect((await currentRecipe(db, s))?.id).toBe(first?.id);
  const cfg = await settings.get(s);
  await settings.update(s, actor, 2, {
    communityModel: { ...cfg.communityModel, voiceThresholdSeconds: 600 },
  });
  const second = await currentRecipe(db, s);
  expect(second?.revision).toBe(2);
  expect(second?.id).not.toBe(first?.id);
  expect(
    (
      await sql<{
        definition: { voiceThresholdSeconds: number };
      }>`SELECT definition FROM measurement_recipe_versions WHERE ${tenant(s)} AND id=${first!.id}::uuid`.execute(
        db,
      )
    ).rows[0]!.definition.voiceThresholdSeconds,
  ).toBe(300);
  await expect(
    sql`UPDATE measurement_recipe_versions SET definition='{}' WHERE ${tenant(s)} AND id=${first!.id}::uuid`.execute(
      db,
    ),
  ).rejects.toThrow("immutable");
});
it("does not accept a forged recipe identifier or unconfirmed purpose field", async () => {
  const s = { organizationId: randomUUID(), guildId: "111111111111111199" };
  await ensureGuild(db, s);
  const settings = new SettingsService(db);
  await expect(
    settings.update(s, actor, 0, {
      communityModel: {
        ...communityModelSchema.parse({}),
        recipeVersionId: randomUUID(),
      } as never,
    }),
  ).rejects.toThrow();
  expect(await currentRecipe(db, s)).toBeNull();
});
