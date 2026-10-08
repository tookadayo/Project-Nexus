import { cancelAnalysisRuns } from "../../analysis/src/usage";
import {
  sql,
  tenant,
  privacyReadLock,
  hasHeldReadFence,
  withHeldReadFences,
  type Tx,
  type Database,
} from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import {
  hostedBetaEnabled,
  betaLimitsSchema,
  type BetaLimits,
  BETA_GRACE_DAYS,
} from "../../config/src/hosted-beta";

export type Invitation = {
  organization_id: string;
  guild_id: string;
  status:
    "REGISTERED" | "ACTIVE" | "PAUSED" | "REVOKED" | "DELETING" | "DELETED";
  generation: number;
  guild_name: string;
  bot_present: boolean;
  bot_checked_at: Date;
  activated_at: Date | null;
  expires_at: Date | null;
  grant_id: string | null;
  limits: BetaLimits;
  created_at: Date;
  updated_at: Date;
};
export const betaLockKey = (s: Scope) =>
  "beta:" + s.organizationId + ":" + s.guildId;
export async function betaLock(tx: Tx, s: Scope, exclusive = false) {
  if (hasHeldReadFence(betaLockKey(s))) {
    assert(!exclusive, "BETA_LOCK_UPGRADE_UNAVAILABLE", 503);
    return;
  }
  await sql`SELECT ${exclusive ? sql`pg_advisory_xact_lock` : sql`pg_advisory_xact_lock_shared`}(hashtextextended(${betaLockKey(s)},0))`.execute(
    tx,
  );
}
export async function betaInvitation(tx: Tx, s: Scope) {
  return (
    (
      await sql<Invitation>`SELECT * FROM beta_guild_invitations WHERE ${tenant(s)}`.execute(
        tx,
      )
    ).rows[0] ?? null
  );
}
export function invitationAllows(
  row: Invitation | null,
  mode: "read" | "work",
  now = new Date(),
  generation?: number | null,
) {
  if (!row || !["ACTIVE", "PAUSED"].includes(row.status) || !row.expires_at)
    return false;
  if (mode === "read")
    return (
      now.getTime() < row.expires_at.getTime() + BETA_GRACE_DAYS * 86400000
    );
  return (
    row.status === "ACTIVE" &&
    row.bot_present &&
    row.expires_at > now &&
    row.grant_id !== null &&
    (generation === undefined || generation === row.generation)
  );
}
export async function betaAccess(
  tx: Tx,
  s: Scope,
  mode: "read" | "work" = "work",
  generation?: number | null,
) {
  if (!hostedBetaEnabled()) return null;
  await betaLock(tx, s);
  const row = await betaInvitation(tx, s);
  const deleted =
    (
      await sql`SELECT id FROM beta_deletion_jobs WHERE ${tenant(s)}`.execute(
        tx,
      )
    ).rows.length > 0;
  assert(
    !deleted && invitationAllows(row, mode, new Date(), generation),
    "BETA_UNAVAILABLE",
    403,
  );
  if (mode === "work") {
    assert(
      (
        await sql`SELECT id FROM entitlement_grants WHERE ${tenant(s)} AND id=${row!.grant_id}::uuid AND revoked_at IS NULL AND starts_at<=clock_timestamp() AND ends_at>clock_timestamp()`.execute(
          tx,
        )
      ).rows.length,
      "BETA_UNAVAILABLE",
      403,
    );
  }
  return row;
}
// A bounded non-analysis worker holds a fence through its external effect and
// save. Pause linearizes after that effect; subsequent jobs cannot start.
export async function betaWork<T>(
  db: Database,
  s: Scope,
  work: () => Promise<T>,
) {
  if (!hostedBetaEnabled()) return work();
  if (hasHeldReadFence(betaLockKey(s))) {
    await betaAccess(db, s);
    return work();
  }
  return db.connection().execute(async (connection) => {
    const privacy = "privacy:" + s.organizationId + ":" + s.guildId;
    await sql`SELECT pg_advisory_lock_shared(hashtextextended(${privacy},0))`.execute(
      connection,
    );
    try {
      await sql`SELECT pg_advisory_lock_shared(hashtextextended(${betaLockKey(s)},0))`.execute(
        connection,
      );
      try {
        return await withHeldReadFences([privacy, betaLockKey(s)], async () => {
          await betaAccess(connection, s);
          return work();
        });
      } finally {
        await sql`SELECT pg_advisory_unlock_shared(hashtextextended(${betaLockKey(s)},0))`.execute(
          connection,
        );
      }
    } finally {
      await sql`SELECT pg_advisory_unlock_shared(hashtextextended(${privacy},0))`.execute(
        connection,
      );
    }
  });
}
export async function betaAnalysisCapacity(tx: Tx, s: Scope, row: Invitation) {
  await sql`SELECT pg_advisory_xact_lock(763212)`.execute(tx);
  const limits = betaLimitsSchema.parse(row.limits);
  // The global limit is the strictest configured live invitation limit, so
  // selecting another Guild cannot bypass an operator's lower host ceiling.
  const globalLimit = (
    await sql<{
      maximum: number;
    }>`SELECT COALESCE(min((limits->>'globalPending')::int),10)::int AS maximum FROM beta_guild_invitations WHERE status='ACTIVE' AND expires_at>clock_timestamp()`.execute(
      tx,
    )
  ).rows[0]!.maximum;
  const counts = (
    await sql<{
      guild: number;
      global: number;
      daily: number;
      monthly: number;
    }>`SELECT count(*) FILTER(WHERE a.status='QUEUED' AND a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId})::int AS guild,count(*) FILTER(WHERE a.status='QUEUED')::int AS global,count(*) FILTER(WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.requested_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND r.state IN ('RESERVED','CONSUMED'))::int AS daily,count(*) FILTER(WHERE a.organization_id=${s.organizationId}::uuid AND a.guild_id=${s.guildId} AND a.requested_at>=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND r.state IN ('RESERVED','CONSUMED'))::int AS monthly FROM analysis_runs a LEFT JOIN analysis_reservations r ON r.run_id=a.id`.execute(
      tx,
    )
  ).rows[0]!;
  assert(
    counts.guild < limits.guildPending &&
      counts.global < Math.min(limits.globalPending, globalLimit),
    "ANALYSIS_BUSY",
    429,
  );
  assert(
    counts.daily < limits.daily && counts.monthly < limits.monthly,
    "BETA_USAGE_LIMIT",
    429,
  );
}
export async function requestBetaDeletion(
  tx: Tx,
  s: Scope,
  reason:
    | "UNLINK"
    | "BOT_REMOVED"
    | "REVOKED"
    | "RETENTION_EXPIRED"
    | "DELETE_REQUEST",
) {
  await privacyReadLock(tx, s);
  await betaLock(tx, s, true);
  await cancelAnalysisRuns(tx, s);
  await sql`UPDATE beta_guild_invitations SET status='DELETING',generation=generation+1,updated_at=now() WHERE ${tenant(s)} AND status NOT IN ('DELETING','DELETED')`.execute(
    tx,
  );
  await sql`UPDATE entitlement_grants SET revoked_at=COALESCE(revoked_at,now()) WHERE id=(SELECT grant_id FROM beta_guild_invitations WHERE ${tenant(s)})`.execute(
    tx,
  );
  await sql`UPDATE api_credentials SET state='REVOKED',revoked_at=COALESCE(revoked_at,now()) WHERE ${tenant(s)}`.execute(
    tx,
  );
  await sql`INSERT INTO beta_deletion_jobs(id,organization_id,guild_id,reason) VALUES(gen_random_uuid(),${s.organizationId}::uuid,${s.guildId},${reason}) ON CONFLICT(organization_id,guild_id) DO NOTHING`.execute(
    tx,
  );
}
