import { sql, tenant, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import { latestCapability } from "../../lifecycle/src/discovery";
import { measurementDefinition } from "../../shared/src/measurement-definitions";
import { currentRecipe } from "../../settings/src/recipes";
export async function integrationOperations(tx: Tx, s: Scope) {
  const [snapshot, recipe, queues] = await Promise.all([
    latestCapability(tx, s),
    currentRecipe(tx, s),
    sql<{
      gateway_pending: number;
      projection_lag_seconds: number | null;
      outbox_pending: number;
      outbox_unknown: number;
      capability_pending: number;
    }>`SELECT (SELECT count(*)::integer FROM gateway_ingest WHERE ${tenant(s)} AND projected_at IS NULL) AS gateway_pending,(SELECT extract(epoch FROM now()-min(received_at))::double precision FROM gateway_ingest WHERE ${tenant(s)} AND projected_at IS NULL) AS projection_lag_seconds,(SELECT count(*)::integer FROM action_outbox WHERE ${tenant(s)} AND state IN ('PENDING','RUNNING')) AS outbox_pending,(SELECT count(*)::integer FROM action_outbox WHERE ${tenant(s)} AND state='UNKNOWN') AS outbox_unknown,(SELECT count(*)::integer FROM capability_refresh_jobs WHERE ${tenant(s)} AND due_at<=now()) AS capability_pending`.execute(
      tx,
    ),
  ]);
  const metrics = recipe?.definition?.metrics ?? [];
  return {
    queues: queues.rows[0]!,
    coverage: snapshot?.coverage ?? null,
    inspector:
      snapshot?.channels.map((c) => ({
        channelId: c.id,
        observable: c.observable,
        missingPermissions: c.observable ? [] : ["VIEW_CHANNEL"],
        affectedMetrics: metrics.filter((key) =>
          measurementDefinition(key).surfaces.some(
            (surface) =>
              surface.endsWith("Visibility") &&
              (!surface.startsWith("voice") || [2, 13].includes(c.type)),
          ),
        ),
      })) ?? [],
  };
}
