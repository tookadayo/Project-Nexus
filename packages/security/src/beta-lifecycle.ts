import {
  sql,
  tenant,
  privacyReadLock,
  type Database,
} from "../../db/src/index";
import { hostedBetaEnabled } from "../../config/src/hosted-beta";
import { betaLock, requestBetaDeletion } from "./hosted-beta";
import { cancelAnalysisRuns as cancelBetaRuns } from "../../analysis/src/usage";
import type { PrivacyService } from "./privacy";
import { operatorAudit } from "./operator-auth";
export class BetaLifecycle {
  constructor(
    private readonly db: Database,
    private readonly privacy: PrivacyService,
  ) {}
  async tick() {
    if (!hostedBetaEnabled()) return;
    const expired = (
      await sql<{
        organization_id: string;
        guild_id: string;
      }>`SELECT organization_id,guild_id FROM beta_guild_invitations WHERE status='ACTIVE' AND expires_at<=clock_timestamp() ORDER BY expires_at LIMIT 10`.execute(
        this.db,
      )
    ).rows;
    for (const row of expired) {
      const s = { organizationId: row.organization_id, guildId: row.guild_id };
      await this.db.transaction().execute(async (tx) => {
        await privacyReadLock(tx, s);
        await betaLock(tx, s, true);
        const changed =
          await sql`UPDATE beta_guild_invitations SET status='PAUSED',generation=generation+1,updated_at=now() WHERE ${tenant(s)} AND status='ACTIVE' AND expires_at<=clock_timestamp() RETURNING guild_id`.execute(
            tx,
          );
        if (changed.rows.length) {
          await cancelBetaRuns(tx, s);
          await operatorAudit(tx, "INVITATION_EXPIRED", "SUCCEEDED", {
            guildId: s.guildId,
          });
        }
      });
    }
    const ended = (
      await sql<{
        organization_id: string;
        guild_id: string;
      }>`SELECT organization_id,guild_id FROM beta_guild_invitations WHERE status IN ('ACTIVE','PAUSED') AND expires_at<=clock_timestamp()-interval '30 days' LIMIT 10`.execute(
        this.db,
      )
    ).rows;
    for (const row of ended)
      await this.db
        .transaction()
        .execute((tx) =>
          requestBetaDeletion(
            tx,
            { organizationId: row.organization_id, guildId: row.guild_id },
            "RETENTION_EXPIRED",
          ),
        );
    const jobs = (
      await sql<{
        id: string;
        organization_id: string;
        guild_id: string;
      }>`SELECT id,organization_id,guild_id FROM beta_deletion_jobs WHERE state IN ('PENDING','ERASED') AND attempts<5 AND available_at<=clock_timestamp() AND requested_at>clock_timestamp()-interval '1 day' ORDER BY requested_at LIMIT 10`.execute(
        this.db,
      )
    ).rows;
    for (const job of jobs) {
      const s = { organizationId: job.organization_id, guildId: job.guild_id };
      try {
        await this.privacy.deleteBetaGuild(s, job.id);
      } catch {
        await sql`UPDATE beta_deletion_jobs SET attempts=attempts+1,available_at=clock_timestamp()+make_interval(secs=>LEAST(3600,30*power(2,attempts)::int)),last_error='DELETE_RETRY_REQUIRED' WHERE id=${job.id}::uuid AND state IN ('PENDING','ERASED')`.execute(
          this.db,
        );
      }
    }
    await sql`DELETE FROM public_oauth_sessions WHERE expires_at<clock_timestamp() OR revoked_at<clock_timestamp()-interval '1 day'`.execute(
      this.db,
    );
    // Operator audit contains no API body or secrets. Finite retention bounds
    // repeated denial logs; persistent deletion tombstones are kept separately.
    await sql`DELETE FROM operator_audit WHERE occurred_at<clock_timestamp()-interval '30 days'`.execute(
      this.db,
    );
    await sql`DELETE FROM operator_requests WHERE created_at<clock_timestamp()-interval '30 days'`.execute(
      this.db,
    );
    await sql`DELETE FROM operator_sessions WHERE expires_at<clock_timestamp() OR revoked_at<clock_timestamp()-interval '1 day'`.execute(
      this.db,
    );
  }
}
