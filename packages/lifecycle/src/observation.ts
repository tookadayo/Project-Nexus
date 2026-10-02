import { randomUUID } from "node:crypto";
import { sql, tenant, json, type Tx } from "../../db/src/index";
import type { Scope } from "../../shared/src/index";
import type { Envelope } from "../../events/src/index";
import {
  observationIntents,
  type IntegrationHealth,
  type CollectionEpoch,
} from "../../shared/src/integration-health";

export async function openCollectionEpoch(
  tx: Tx,
  s: Scope,
  at: Date,
  reason: string,
  rotate = false,
  snapshotId: string | null = null,
) {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${"collection:" + s.organizationId + ":" + s.guildId},0))`.execute(
    tx,
  );
  const previous = (
    await sql<{
      id: string;
      started_at: Date;
    }>`SELECT id,started_at FROM collection_epochs WHERE ${tenant(s)} AND source='GATEWAY' AND ended_at IS NULL`.execute(
      tx,
    )
  ).rows[0];
  if (previous && (!rotate || previous.started_at > at)) return previous.id;
  if (previous)
    await sql`UPDATE collection_epochs SET ended_at=${at},end_reason=${reason} WHERE ${tenant(s)} AND id=${previous.id}::uuid`.execute(
      tx,
    );
  const id = randomUUID();
  await sql`INSERT INTO collection_epochs(organization_id,guild_id,id,source,started_at,start_reason,capability_snapshot_id) VALUES(${s.organizationId}::uuid,${s.guildId},${id}::uuid,'GATEWAY',${at},${reason},${snapshotId}::uuid)`.execute(
    tx,
  );
  return id;
}
export async function closeCollectionEpoch(
  tx: Tx,
  s: Scope,
  at: Date,
  reason: string,
) {
  await sql`UPDATE collection_epochs SET ended_at=GREATEST(started_at,${at}),end_reason=${reason} WHERE ${tenant(s)} AND source='GATEWAY' AND ended_at IS NULL AND started_at<=${at}`.execute(
    tx,
  );
}
export async function projectObservation(tx: Tx, s: Scope, e: Envelope) {
  const at = new Date(e.observedAt ?? e.at);
  const connected = e.kind === "telemetry.connected",
    disconnected = e.kind === "telemetry.disconnected";
  if (disconnected) {
    await closeCollectionEpoch(
      tx,
      s,
      at,
      e.healthReason === "INTENT_UNAVAILABLE"
        ? "INTENT_UNAVAILABLE"
        : "GATEWAY_GAP",
    );
  } else if (e.kind === "telemetry.gap") {
    await closeCollectionEpoch(
      tx,
      s,
      new Date(e.gapStart ?? e.at),
      "GATEWAY_GAP",
    );
    await openCollectionEpoch(tx, s, at, "GATEWAY_GAP");
  } else
    await openCollectionEpoch(
      tx,
      s,
      at,
      connected ? (e.healthReason ?? "GATEWAY_CONNECTED") : "FIRST_OBSERVATION",
      connected,
    );
  const intents: Record<string, string> = {};
  const delivered = e.kind.startsWith("member.")
    ? "members"
    : e.kind === "message.sent"
      ? "messages"
      : e.kind.startsWith("reaction.")
        ? "reactions"
        : e.kind.startsWith("poll.")
          ? "polls"
          : e.kind === "voice.state"
            ? "voice"
            : e.kind.startsWith("scheduled_event.")
              ? "scheduledEvents"
              : e.kind === "auto_moderation.executed"
                ? "autoMod"
                : null;
  if (delivered) intents[delivered] = "AVAILABLE";
  if (!connected && !disconnected && e.kind !== "telemetry.heartbeat") {
    if (delivered)
      await sql`INSERT INTO discord_integration_health(organization_id,guild_id,intents,updated_at) VALUES(${s.organizationId}::uuid,${s.guildId},${json(intents)},${at}) ON CONFLICT(organization_id,guild_id) DO UPDATE SET intents=discord_integration_health.intents||EXCLUDED.intents,updated_at=GREATEST(discord_integration_health.updated_at,EXCLUDED.updated_at) WHERE discord_integration_health.last_gateway_at IS NULL OR discord_integration_health.last_gateway_at<=${at}`.execute(
        tx,
      );
    return;
  }
  if (e.requestedIntents)
    for (const key of observationIntents)
      intents[key] = e.requestedIntents.includes(key)
        ? "AVAILABLE"
        : "UNAVAILABLE";
  await sql`INSERT INTO discord_integration_health(organization_id,guild_id,gateway_state,last_gateway_at,intents,updated_at)
 VALUES(${s.organizationId}::uuid,${s.guildId},${disconnected ? "DISCONNECTED" : "CONNECTED"},${at},${json(intents)},${at})
 ON CONFLICT(organization_id,guild_id) DO UPDATE SET gateway_state=EXCLUDED.gateway_state,last_gateway_at=EXCLUDED.last_gateway_at,
 intents=discord_integration_health.intents||EXCLUDED.intents,updated_at=EXCLUDED.updated_at WHERE discord_integration_health.last_gateway_at IS NULL OR discord_integration_health.last_gateway_at<=EXCLUDED.last_gateway_at`.execute(
    tx,
  );
}
export async function integrationHealth(
  tx: Tx,
  s: Scope,
  now = new Date(),
): Promise<IntegrationHealth> {
  const row = (
    await sql<{
      gateway_state: IntegrationHealth["gateway"];
      last_gateway_at: Date | null;
      intents: IntegrationHealth["intents"];
      rest_state: IntegrationHealth["rest"];
      last_refresh_at: Date | null;
      last_refresh_failure_at: Date | null;
      last_error_category: string | null;
    }>`SELECT * FROM discord_integration_health WHERE ${tenant(s)}`.execute(tx)
  ).rows[0];
  const intents = Object.fromEntries(
    observationIntents.map((k) => [k, row?.intents[k] ?? "UNKNOWN"]),
  ) as IntegrationHealth["intents"];
  const gateway =
    row?.last_gateway_at &&
    row.last_gateway_at.getTime() >= now.getTime() - 90000
      ? row.gateway_state
      : row?.last_gateway_at
        ? "DISCONNECTED"
        : "UNKNOWN";
  return {
    gateway,
    lastGatewayAt: row?.last_gateway_at?.toISOString() ?? null,
    intents,
    rest: row?.rest_state ?? "UNKNOWN",
    capabilityFresh: Boolean(
      row?.last_refresh_at &&
      row.last_refresh_at.getTime() >= now.getTime() - 3600000 &&
      (!row.last_refresh_failure_at ||
        row.last_refresh_at >= row.last_refresh_failure_at),
    ),
    lastSuccessfulRefresh: row?.last_refresh_at?.toISOString() ?? null,
    lastRefreshFailure: row?.last_refresh_failure_at?.toISOString() ?? null,
    lastErrorCategory: row?.last_error_category ?? null,
    severe: gateway !== "CONNECTED" || intents.members !== "AVAILABLE",
  };
}
export async function collectionEpochs(
  tx: Tx,
  s: Scope,
  from: Date,
  to: Date,
): Promise<CollectionEpoch[]> {
  const rows = (
    await sql<{
      id: string;
      source: string;
      started_at: Date;
      ended_at: Date | null;
      start_reason: string;
      end_reason: string | null;
      capability_snapshot_id: string | null;
    }>`SELECT * FROM collection_epochs WHERE ${tenant(s)} AND started_at<${to} AND (ended_at IS NULL OR ended_at>${from}) ORDER BY started_at`.execute(
      tx,
    )
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at?.toISOString() ?? null,
    startReason: r.start_reason,
    endReason: r.end_reason,
    capabilitySnapshotId: r.capability_snapshot_id,
  }));
}
