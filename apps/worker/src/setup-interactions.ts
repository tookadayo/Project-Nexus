import { setupHandoff } from "../../../packages/discord/src/setup-handoff";
import {
  SettingsService,
  type Actor,
} from "../../../packages/settings/src/index";
import { sql, tenant, type Database } from "../../../packages/db/src/index";
import type { Scope } from "../../../packages/shared/src/index";
import type { UiLocale } from "../../../packages/discord-panels/src/i18n";
import type { Issue } from "../../../packages/discord-panels/src/types";
import type { DiscordPort } from "../../../packages/discord/src/rest";

// Old buttons only show a public Web link; they never write an old draft.
export async function setupInteraction(
  db: Database,
  _discord: DiscordPort,
  s: Scope,
  _actor: Actor,
  _issue: Issue,
  _locale: UiLocale,
  _intent: Record<string, unknown>,
  _values: string[] = [],
) {
  const settings = await new SettingsService(db).get(s);
  const linked =
    (
      await sql`SELECT guild_id FROM server_web_links WHERE ${tenant(s)} AND revoked_at IS NULL`.execute(
        db,
      )
    ).rows.length > 0;
  return setupHandoff(s.guildId, linked && settings.setupVersion >= 3);
}
