import { sql, tenant, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
export async function finalizeUsage(
  tx: Tx,
  s: Scope,
  id: string,
  outcome: "CONSUMED" | "RELEASED",
) {
  const r = (
    await sql<{
      grant_id: string;
    }>`UPDATE analysis_reservations SET state=${outcome},finalized_at=now() WHERE ${tenant(s)} AND run_id=${id}::uuid AND state='RESERVED' RETURNING grant_id`.execute(
      tx,
    )
  ).rows[0];
  if (!r) return false;
  await sql`UPDATE analysis_grants SET reserved=reserved-1,consumed=consumed+${outcome === "CONSUMED" ? 1 : 0} WHERE id=${r.grant_id}::uuid`.execute(
    tx,
  );
  await sql`INSERT INTO analysis_usage_ledger(run_id,organization_id,guild_id,grant_id,outcome) VALUES(${id}::uuid,${s.organizationId}::uuid,${s.guildId},${r.grant_id}::uuid,${outcome})`.execute(
    tx,
  );
  return true;
}

export async function cancelAnalysisRuns(tx: Tx, s: Scope) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"analysis:" + s.organizationId + ":" + s.guildId},0))`.execute(
    tx,
  );
  const rows = (
    await sql<{
      id: string;
    }>`SELECT id FROM analysis_runs WHERE ${tenant(s)} AND status IN ('QUEUED','PREPARING','RUNNING','FINALIZING') ORDER BY id FOR UPDATE`.execute(
      tx,
    )
  ).rows;
  for (const row of rows) await finalizeUsage(tx, s, row.id, "RELEASED");
  await sql`UPDATE analysis_runs SET status='CANCELED',lease_token=NULL,lease_until=NULL,failure_class='CANCELED',failure_detail_safe='The server is unavailable for new work.',failed_at=now(),updated_at=now() WHERE ${tenant(s)} AND status IN ('QUEUED','PREPARING','RUNNING','FINALIZING')`.execute(
    tx,
  );
  return rows.length;
}
