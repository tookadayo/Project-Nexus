import { randomUUID } from "node:crypto";
import { sql, json, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index.js";
import { hostedBetaEnabled } from "../../config/src/hosted-beta";
import { betaInvitation, betaLock } from "../../security/src/hosted-beta";
import { assert } from "../../shared/src/index";
import {
  assertRuleExternalEffectActivation, assertTargetSafety,
  type RuleExternalEffectActivation, type TargetSafetyState, type TargetSafetyCheck,
} from "../../rules/src/runtime-safety";

export interface RuleOutboxAdmission {
  contract: "alpha16.rule.v1";
  intentId: string;
  activation: RuleExternalEffectActivation;
  targetSafety: TargetSafetyState | null;
  targetCheck: TargetSafetyCheck;
}
export type ActionKind =
  | "INSTALL_NOTICE"
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
  ruleAdmission?: RuleOutboxAdmission,
) {
  if (ruleAdmission || Object.hasOwn(payload, "ruleOperationIntentId") || Object.hasOwn(payload, "ruleRuntimeContract")) {
    // New operations cannot reach an old worker by dressing up as a legacy
    // outbox action. Domain intent and outbox must share a PG transaction.
    assert(tx.isTransaction && ruleAdmission?.contract === "alpha16.rule.v1", "RULE_OUTBOX_CONTRACT_REQUIRED", 409);
    assert(ruleAdmission.targetCheck.scope.organizationId === s.organizationId
      && ruleAdmission.targetCheck.scope.guildId === s.guildId, "FORBIDDEN", 403);
    assertRuleExternalEffectActivation(ruleAdmission.activation);
    assertTargetSafety(ruleAdmission.targetSafety, ruleAdmission.targetCheck);
    assert(typeof ruleAdmission.intentId === "string" && ruleAdmission.intentId.length > 0, "RULE_INTENT_REQUIRED");
    assert(!Object.hasOwn(payload, "ruleOperationIntentId") || payload.ruleOperationIntentId === ruleAdmission.intentId,
      "RULE_OUTBOX_INTENT_MISMATCH", 409);
    assert(!Object.hasOwn(payload, "ruleRuntimeContract") || payload.ruleRuntimeContract === ruleAdmission.contract,
      "RULE_OUTBOX_CONTRACT_REQUIRED", 409);
    payload = { ...payload, ruleOperationIntentId: ruleAdmission.intentId, ruleRuntimeContract: ruleAdmission.contract };
  }
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
