import { sql, type Database } from "../../../packages/db/src/index";
import { assert } from "../../../packages/shared/src/index";
import type { DiscordPort } from "../../../packages/discord/src/rest";
import type { IdentityVault } from "../../../packages/identity/src/index";
import { SettingsService } from "../../../packages/settings/src/index";
import { ServerAuthorization } from "../../../packages/security/src/server-authorization";
import {
  AutomationEvents,
  sweepAutomationEventRetention,
  type AutomationEventRow,
  type EventAuthorizer,
} from "../../../packages/automation/src/events";
import {
  AutomationService,
  type AutomationServiceOptions,
} from "../../../packages/automation/src/service";

export function alpha15EventAuthorizer(
  db: Database,
  discord: DiscordPort,
  vault: IdentityVault,
): EventAuthorizer {
  return async (s, identity, requestId) => {
    const userId = vault.open(s, identity.ciphertext);
    assert(
      vault.hash(s, userId) === identity.hash,
      "AUTOMATION_ACTOR_UNAVAILABLE",
      403,
    );
    const snapshot = await new ServerAuthorization(
      discord,
      new SettingsService(db),
      vault,
    ).snapshot(s, userId, "DISCORD_PANEL", requestId);
    assert(!snapshot.member.bot, "AUTOMATION_ACTOR_UNAVAILABLE", 403);
    return { actor: snapshot.actor, userId, checkedAt: snapshot.checkedAt };
  };
}
/** One bounded trusted-DB pass. No subscription, external webhook or timer is
 * created on import. Existing worker cadence owns scheduling. */
export async function processAlpha15AutomationEvents(
  db: Database,
  discord: DiscordPort,
  vault: IdentityVault,
  options: AutomationServiceOptions = {},
  now?: Date,
) {
  const clock = () => now ?? new Date(),
    service = new AutomationService(db, options),
    events = new AutomationEvents(
      db,
      service,
      alpha15EventAuthorizer(db, discord, vault),
      clock,
    );
  const pending = (
    await sql<AutomationEventRow>`SELECT * FROM automation_event_inbox WHERE state='PENDING' ORDER BY created_at,source,event_id LIMIT 20`.execute(
      db,
    )
  ).rows;
  let started = 0,
    skipped = 0;
  for (const event of pending) {
    const result = await events.dispatch(event);
    if (result.state === "STARTED") started++;
    else if (result.state === "SKIPPED") skipped++;
  }
  const retention = await sweepAutomationEventRetention(db, clock());
  return {
    eventsConsidered: pending.length,
    eventsStarted: started,
    eventsSkipped: skipped,
    ...retention,
  };
}
