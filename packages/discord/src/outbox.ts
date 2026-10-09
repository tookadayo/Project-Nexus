import { randomUUID } from "node:crypto";
import { sql, json, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index.js";
import { hostedBetaEnabled } from "../../config/src/hosted-beta";
import { betaInvitation, betaLock } from "../../security/src/hosted-beta";
export type ActionKind =
  | "ROLE_RECONCILE"
  | "ROLE_ADD"
  | "ROLE_REMOVE"
  | "PANEL_UPSERT"
  | "PANEL_DELETE"
  | "PANEL_REFRESH"
  | "REPLY_EDIT"
  | "REPLY_FOLLOWUP"
  | "TEST_MESSAGE"
  | "COMMANDS_REGISTER"
  | "INTERVENTION_DELIVER"
  | "CHART_PUBLISH"
  | "OPERATIONS_NOTIFY"
  | "REPORT_PUBLISH"
  | "INTAKE_PUBLISH"
  | "INTAKE_NOTIFY";
export async function enqueue(
  tx: Tx,
  s: Scope,
  key: string,
  kind: ActionKind,
  payload: Record<string, unknown>,
  generation?: number | null,
) {
  const id = randomUUID();
  // Capture at enqueue, never upgrade an existing deduped job to a new
  // invitation generation. Reply producers may inherit their dispatch fence.
  let recorded = payload;
  if (hostedBetaEnabled()) {
    await betaLock(tx, s);
    const invitation = await betaInvitation(tx, s);
    recorded = {
      ...payload,
      betaGeneration:
        generation === undefined
          ? (invitation?.generation ?? null)
          : generation,
    };
  }
  const { rows } = await sql<{
    id: string;
  }>`INSERT INTO action_outbox(organization_id,guild_id,id,dedupe_key,kind,payload)
 VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,${key},${kind},${json(recorded)})
 ON CONFLICT(organization_id,guild_id,dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key RETURNING id`.execute(
    tx,
  );
  return rows[0]!.id;
}
