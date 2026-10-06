import { z } from "zod";
import { sql, tenant, type Database } from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import { metricEvidence } from "../../shared/src/metric-evidence";
import type { Actor } from "../../settings/src/index";
import { operationsAccess, operationsAudit, operationsLock } from "./policy";
import type { AttentionState } from "./attention";
export const inboxStates = [
  "OPEN",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "SNOOZED",
  "RESOLVED",
  "DISMISSED",
] as const;
export class AttentionInbox {
  constructor(private readonly db: Database) {}
  async list(s: Scope, actor: Actor, limit = 100) {
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "READ", "attention_inbox");
      return inboxRows(tx, s, limit);
    });
  }
  async action(s: Scope, actor: Actor, input: unknown) {
    const data = z
      .object({
        key: z.string().min(1).max(150),
        channelId: z.string().max(20),
        state: z.enum(inboxStates),
        version: z.number().int().nonnegative(),
        teamId: z.uuid().nullable().optional(),
      })
      .strict()
      .parse(input);
    return this.db.transaction().execute(async (tx) => {
      await operationsAccess(tx, s, actor, "OPERATE", "attention_inbox");
      await operationsLock(tx, s);
      const item = (
        await sql<{
          status: AttentionState;
          version: number;
        }>`SELECT status,version FROM attention_items WHERE ${tenant(s)} AND message_id=${data.key} AND channel_id=${data.channelId} FOR UPDATE`.execute(
          tx,
        )
      ).rows[0];
      assert(item, "ATTENTION_NOT_FOUND", 404);
      assert(item.version === data.version, "REVISION_CONFLICT", 409);
      assert(
        !["RESOLVED", "DISMISSED"].includes(item.status) ||
          item.status === data.state,
        "ATTENTION_NOT_ACTIVE",
        409,
      );
      if (data.teamId !== undefined) {
        await operationsAccess(tx, s, actor, "OPERATE", "team_assignment");
        if (data.teamId)
          assert(
            (
              await sql`SELECT team_id FROM operations_team_bindings WHERE ${tenant(s)} AND team_id=${data.teamId}::uuid`.execute(
                tx,
              )
            ).rows.length,
            "TEAM_NOT_FOUND",
            404,
          );
      }
      assert(data.state !== "SNOOZED", "USE_SNOOZE_CONTROL");
      const changed = data.state !== item.status || data.teamId !== undefined;
      if (changed)
        await sql`UPDATE attention_items SET status=${data.state},assigned_team_id=CASE WHEN ${data.teamId !== undefined} THEN ${data.teamId ?? null}::uuid ELSE assigned_team_id END,last_actor_hash=${actor.key},acknowledged_at=CASE WHEN ${["ACKNOWLEDGED", "IN_PROGRESS"].includes(data.state)} THEN COALESCE(acknowledged_at,now()) ELSE acknowledged_at END,resolved_at=CASE WHEN ${["RESOLVED", "DISMISSED"].includes(data.state)} THEN now() ELSE NULL END,resolution_reason=CASE WHEN ${data.state === "DISMISSED"} THEN 'STAFF_DISMISSED' WHEN ${data.state === "RESOLVED"} THEN 'STAFF_RESOLVED' ELSE NULL END,snooze_until=NULL,version=version+1,updated_at=now() WHERE ${tenant(s)} AND message_id=${data.key}`.execute(
          tx,
        );
      await operationsAudit(
        tx,
        s,
        actor.key,
        "ATTENTION_UPDATED",
        data.key,
        item.version + (changed ? 1 : 0),
      );
      return { state: data.state, version: item.version + (changed ? 1 : 0) };
    });
  }
}
export async function inboxRows(
  tx: import("../../db/src/index").Tx,
  s: Scope,
  limit = 100,
) {
  const rows = (
    await sql<{
      message_id: string;
      channel_id: string;
      status: AttentionState;
      item_type: string;
      reason: string;
      version: number;
      evidence: unknown;
      assigned_team_id: string | null;
      opened_at: Date | null;
    }>`SELECT message_id,channel_id,status,item_type,reason,version,evidence,assigned_team_id,opened_at FROM attention_items WHERE ${tenant(s)} ORDER BY CASE WHEN status IN ('RESOLVED','DISMISSED') THEN 1 ELSE 0 END,opened_at DESC NULLS LAST,message_id LIMIT ${Math.min(100, Math.max(1, limit))}`.execute(
      tx,
    )
  ).rows;
  return rows.map((row) => ({
    ...row,
    evidence:
      row.evidence ??
      metricEvidence({
        metricKey: "attention.saved",
        definitionVersion: "attention-saved-v1",
        definition:
          "Saved operational item; original observation evidence is unavailable.",
        value: null,
        numerator: null,
        denominator: null,
        sampleSize: 0,
        coverageState: "UNKNOWN",
        requiredSurfaces: ["CANONICAL_ATTENTION_QUEUE"],
        evidenceSources: ["attention_items"],
        coverageReasons: ["ORIGINAL_EVIDENCE_UNAVAILABLE"],
        windowStart: row.opened_at?.toISOString() ?? new Date(0).toISOString(),
        windowEnd: row.opened_at?.toISOString() ?? new Date(0).toISOString(),
        collectionEpochIds: [],
      }),
  }));
}
