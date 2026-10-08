import { z } from "zod";
import { SetupWizard } from "../../../packages/operations/src/setup-wizard";
import { setupWizardPanel, setupPlacesPanel } from "../../../packages/discord-panels/src/views/setup-wizard";
import { successPanel } from "../../../packages/discord-panels/src/views/success";
import { analysisCopy } from "../../../packages/discord-panels/src/i18n/analysis";
import type { Database } from "../../../packages/db/src/index";
import type { Scope } from "../../../packages/shared/src/index";
import type { Actor } from "../../../packages/settings/src/index";
import type { UiLocale } from "../../../packages/discord-panels/src/i18n";
import type { Issue } from "../../../packages/discord-panels/src/types";
import type { DiscordPort } from "../../../packages/discord/src/rest";
export async function setupInteraction(
  db: Database,
  discord: DiscordPort,
  s: Scope,
  actor: Actor,
  issue: Issue,
  locale: UiLocale,
  intent: Record<string, unknown>,
  values: string[] = [],
) {
  const wizard = new SetupWizard(db),
    action = intent.action;
  if (action === "setupWizard")
    return setupWizardPanel(issue, await wizard.open(s, actor), locale);
  const id = z.uuid().parse(intent.draftId),
    version = z.number().int().nonnegative().parse(intent.version);
  if(action==="setupWizardPlaces")return setupPlacesPanel(issue,await wizard.get(s,actor,id),locale,z.number().int().nonnegative().max(1000).parse(intent.placePage??0));
  if(action==="setupWizardResume")return setupWizardPanel(issue,await wizard.get(s,actor,id),locale);
  if (action === "setupWizardConfirm") {
    const state = await wizard.get(s, actor, id);
    if (state.draft.helperEnabled && state.draft.helperChannelId)
      await discord.checkChannel(s.guildId, state.draft.helperChannelId);
    for (const role of state.draft.managerRoleIds)
      await discord.validateRole(s.guildId, role);
    await wizard.confirm(s, actor, id, version);
    return successPanel(
      issue,
      analysisCopy(locale, "saved"),
      analysisCopy(locale, "basic"),
      { label: analysisCopy(locale, "home"), action: "setupHome" },
      locale,
    );
  }
  if (action === "setupWizardChange")
    return setupWizardPanel(
      issue,
      await wizard.change(
        s,
        actor,
        id,
        version,
        z.string().max(32).parse(intent.field),
        values,
      ),
      locale,
    );
  return setupWizardPanel(
    issue,
    await wizard.move(
      s,
      actor,
      id,
      version,
      action === "setupWizardBack" ? "back" : intent.skip ? "skip" : "next",
    ),
    locale,
  );
}
