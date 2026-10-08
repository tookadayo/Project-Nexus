import { betaAccess } from "./hosted-beta";
import { privacyReadLock, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { Components } from "./index";
import { hostedBetaEnabled } from "../../config/src/hosted-beta";
export const betaMaintenanceAction = (action: string) =>
  [
    "unlink",
    "unlinkConfirm",
    "unlinkCancel",
    "deleteMember",
    "deleteMemberConfirm",
    "deleteGuild",
    "deleteGuildConfirm",
  ].includes(action);
export const betaReadAction = (action: string) =>
  /^(?:overview|status|help|dashboard|settings|panel|controlNavigate|controlRefresh|controlAnalysis|controlChannelPage|controlAttentionPage|controlSettings|controlRules|lifecycle|cohorts|diagnose|experiments|reports|billing)$/.test(
    action,
  ) || /^analysis(?:History|Result|Compare|Menu|Page)/.test(action);
export async function betaInteractionAdmission(
  tx: Tx,
  s: Scope,
  job: { command?: string; customId?: string; betaGeneration?: number },
  components: Components | undefined,
  actorHash: string,
) {
  if (!hostedBetaEnabled()) return;
  const action =
    job.customId && components
      ? String((await components.read(tx, s, job.customId, actorHash)).action)
      : (job.command ?? "");
  if (betaMaintenanceAction(action)) return;
  await privacyReadLock(tx, s);
  const row = await betaAccess(tx, s, betaReadAction(action) ? "read" : "work");
  if (row) job.betaGeneration = row.generation;
}
