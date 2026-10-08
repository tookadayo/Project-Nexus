import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  sql,
  tenant,
  ensureGuild,
  privacyReadLock,
  type Database,
  type Tx,
} from "../../db/src/index";
import { assert, type Scope } from "../../shared/src/index";
import { scopeForGuild } from "./scoping";
import {
  betaInvitation,
  betaLock,
  requestBetaDeletion,
  type Invitation,
} from "./hosted-beta";
import {
  betaLimitsSchema,
  betaDefaults,
  BETA_ACTIVE_MAX,
  BETA_INVITATION_DAYS,
} from "../../config/src/hosted-beta";
import {
  canonicalFeatures,
  featureAvailability,
} from "../../settings/src/plan-registry";
import { operatorAudit } from "./operator-auth";
import { cancelAnalysisRuns as cancelBetaRuns } from "../../analysis/src/usage";
export { cancelAnalysisRuns as cancelBetaRuns } from "../../analysis/src/usage";

export const betaFeatures = canonicalFeatures.filter(
  (feature) =>
    featureAvailability[feature] === "available" && feature !== "multi_guild",
);
const changeSchema = z
  .object({
    guildId: z.string().regex(/^\d{17,20}$/),
    action: z.enum([
      "register",
      "activate",
      "pause",
      "resume",
      "extend",
      "revoke",
      "unlink",
      "delete",
      "limits",
      "retryDeletion",
    ]),
    generation: z.number().int().nonnegative().nullable(),
    requestId: z.uuid(),
    reason: z.string().trim().min(1).max(400),
    expiresAt: z.iso.datetime().optional(),
    limits: betaLimitsSchema.optional(),
  })
  .strict();
export type BetaChange = z.infer<typeof changeSchema>;
type Probe = {
  name: string;
  present: boolean;
  canObserve: boolean;
  checkedAt: number;
};
function grantLimits(row: Invitation) {
  return {
    guilds: 1,
    historyDays: 30,
    monthlyObservedMembers: 5000,
    customRecipes: 5,
    automationRules: 10,
    scheduledReports: 10,
    teamSeats: 5,
    webhooks: 5,
    apiRequestsMonthly: 1000,
    intakePanels: 10,
    analysisRunsMonthly: row.limits.monthly,
    analysisConcurrency: 1,
  };
}
function invitationAudit(row: Invitation | null) {
  return row
    ? {
        status: row.status,
        generation: row.generation,
        activatedAt: row.activated_at,
        expiresAt: row.expires_at,
        limits: row.limits,
        grantId: row.grant_id,
        botPresent: row.bot_present,
      }
    : null;
}
async function betaGrant(tx: Tx, s: Scope, row: Invitation, reason: string) {
  const limits = grantLimits(row);
  if (row.grant_id) {
    const updated =
      await sql`UPDATE entitlement_grants SET ends_at=${row.expires_at},limits=${JSON.stringify(limits)}::jsonb WHERE ${tenant(s)} AND id=${row.grant_id}::uuid AND revoked_at IS NULL RETURNING id`.execute(
        tx,
      );
    if (updated.rows.length) return row.grant_id;
  }
  const id = randomUUID();
  await sql`INSERT INTO entitlement_grants(id,organization_id,guild_id,source,features,limits,ends_at,created_by,reason) VALUES(${id}::uuid,${s.organizationId}::uuid,${s.guildId},'PARTNER',${JSON.stringify(betaFeatures)}::jsonb,${JSON.stringify(limits)}::jsonb,${row.expires_at},'local-beta-operator',${reason})`.execute(
    tx,
  );
  return id;
}
export class BetaOperator {
  constructor(
    private readonly db: Database,
    private readonly probe: (guildId: string) => Promise<Probe>,
  ) {}
  async list() {
    return (
      await sql<Invitation>`SELECT * FROM beta_guild_invitations ORDER BY created_at,guild_id`.execute(
        this.db,
      )
    ).rows;
  }
  async detail(guildId: string) {
    const s = scopeForGuild(guildId),
      invitation = await betaInvitation(this.db, s);
    assert(invitation, "BETA_GUILD_NOT_FOUND", 404);
    const grants = (
      await sql`SELECT source,quantity,reserved,consumed,expires_at FROM analysis_grants WHERE ${tenant(s)} ORDER BY created_at DESC LIMIT 12`.execute(
        this.db,
      )
    ).rows;
    const history = (
      await sql`SELECT action,result,reason,before_state,after_state,occurred_at,request_id FROM operator_audit WHERE guild_id=${guildId} ORDER BY occurred_at DESC LIMIT 30`.execute(
        this.db,
      )
    ).rows;
    const deletion =
      (
        await sql`SELECT state,attempts,requested_at,available_at,completed_at,last_error FROM beta_deletion_jobs WHERE ${tenant(s)}`.execute(
          this.db,
        )
      ).rows[0] ?? null;
    return { invitation, grants, history, deletion };
  }
  async change(input: unknown) {
    const data = changeSchema.parse(input),
      s = scopeForGuild(data.guildId);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");
    const prior = (
      await sql<{
        fingerprint: string;
        result: Invitation;
      }>`SELECT fingerprint,result FROM operator_requests WHERE id=${data.requestId}::uuid`.execute(
        this.db,
      )
    ).rows[0];
    if (prior) {
      assert(prior.fingerprint === fingerprint, "IDEMPOTENCY_CONFLICT", 409);
      return prior.result;
    }
    const proof = ["register", "activate", "resume"].includes(data.action)
      ? await this.probe(data.guildId)
      : null;
    if (proof)
      assert(
        proof.present && proof.canObserve && proof.name.length <= 100,
        "BETA_BOT_UNAVAILABLE",
        409,
      );
    return this.db.transaction().execute(async (tx) => {
      await privacyReadLock(tx, s);
      await betaLock(tx, s, true);
      // Serializes capacity AND request-key races across guilds.
      await sql`SELECT pg_advisory_xact_lock(763211)`.execute(tx);
      const repeated = (
        await sql<{
          fingerprint: string;
          result: Invitation;
        }>`SELECT fingerprint,result FROM operator_requests WHERE id=${data.requestId}::uuid`.execute(
          tx,
        )
      ).rows[0];
      if (repeated) {
        assert(
          repeated.fingerprint === fingerprint,
          "IDEMPOTENCY_CONFLICT",
          409,
        );
        return repeated.result;
      }
      assert(
        data.action === "retryDeletion" ||
          !(
            await sql`SELECT id FROM beta_deletion_jobs WHERE ${tenant(s)} UNION ALL SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash IS NULL`.execute(
              tx,
            )
          ).rows.length,
        "PRIVACY_DELETED",
        403,
      );
      let row = await betaInvitation(tx, s);
      const before = row;
      assert(
        (row?.generation ?? null) === data.generation,
        "REVISION_CONFLICT",
        409,
      );
      if (data.action === "retryDeletion") {
        assert(row, "BETA_GUILD_NOT_FOUND", 404);
        const pending = (
          await sql`SELECT id FROM beta_deletion_jobs WHERE ${tenant(s)} AND state IN ('PENDING','ERASED') FOR UPDATE`.execute(
            tx,
          )
        ).rows.length;
        assert(pending, "BETA_INVALID_STATE", 409);
        await sql`UPDATE beta_deletion_jobs SET attempts=0,requested_at=clock_timestamp(),available_at=clock_timestamp(),last_error=NULL WHERE ${tenant(s)} AND state IN ('PENDING','ERASED')`.execute(
          tx,
        );
        row = (
          await sql<Invitation>`UPDATE beta_guild_invitations SET generation=generation+1,updated_at=clock_timestamp() WHERE ${tenant(s)} RETURNING *`.execute(
            tx,
          )
        ).rows[0]!;
        await operatorAudit(tx, "RETRYDELETION", "SUCCEEDED", {
          requestId: data.requestId,
          guildId: s.guildId,
          reason: data.reason,
          before: invitationAudit(before),
          after: invitationAudit(row),
        });
        await sql`INSERT INTO operator_requests(id,fingerprint,guild_id,result) VALUES(${data.requestId}::uuid,${fingerprint},${s.guildId},${JSON.stringify(row)}::jsonb)`.execute(
          tx,
        );
        return row;
      }
      if (proof)
        assert(
          Number.isFinite(proof.checkedAt) &&
            Date.now() >= proof.checkedAt &&
            Date.now() - proof.checkedAt <= 10000,
          "BETA_BOT_UNAVAILABLE",
          409,
        );
      if (data.action === "register") {
        assert(!row && data.generation === null, "REVISION_CONFLICT", 409);
        await ensureGuild(tx, s);
        row = (
          await sql<Invitation>`INSERT INTO beta_guild_invitations(organization_id,guild_id,guild_name,bot_present,bot_checked_at,limits) VALUES(${s.organizationId}::uuid,${s.guildId},${proof!.name},true,${new Date(proof!.checkedAt)},${JSON.stringify(betaDefaults)}::jsonb) RETURNING *`.execute(
            tx,
          )
        ).rows[0]!;
      } else {
        assert(
          row && !["REVOKED", "DELETING", "DELETED"].includes(row.status),
          "BETA_UNAVAILABLE",
          403,
        );
        const next = { ...row, generation: row.generation + 1 };
        if (data.action === "activate" || data.action === "resume") {
          assert(
            data.action === "activate"
              ? row.status === "REGISTERED"
              : row.status === "PAUSED" ||
                  (row.status === "ACTIVE" &&
                    row.expires_at !== null &&
                    row.expires_at <= new Date()),
            "BETA_INVALID_STATE",
            409,
          );
          if (data.action === "activate") {
            next.activated_at = new Date();
            next.expires_at = new Date(
              Date.now() + BETA_INVITATION_DAYS * 86400000,
            );
          }
          assert(
            next.expires_at && next.expires_at > new Date(),
            "BETA_EXPIRED",
            409,
          );
          const count = (
            await sql<{
              n: number;
            }>`SELECT count(*)::int AS n FROM beta_guild_invitations WHERE status='ACTIVE' AND expires_at>clock_timestamp()`.execute(
              tx,
            )
          ).rows[0]!.n;
          assert(count < BETA_ACTIVE_MAX, "BETA_GUILD_LIMIT", 409);
          next.status = "ACTIVE";
          next.bot_present = true;
          next.bot_checked_at = new Date(proof!.checkedAt);
          next.guild_name = proof!.name;
        } else if (data.action === "pause") {
          assert(row.activated_at, "BETA_INVALID_STATE", 409);
          next.status = "PAUSED";
        } else if (data.action === "extend") {
          assert(row.activated_at && data.expiresAt, "BETA_INVALID_STATE", 409);
          const expiry = new Date(data.expiresAt);
          assert(
            row.expires_at &&
              expiry > row.expires_at &&
              expiry.getTime() > Date.now() &&
              expiry.getTime() <=
                Math.max(Date.now(), row.expires_at.getTime()) + 30 * 86400000,
            "BETA_INVALID_EXPIRY",
            400,
          );
          next.expires_at = expiry;
          // Extending an expired invitation does not implicitly occupy capacity.
          if (row.expires_at <= new Date()) next.status = "PAUSED";
        } else if (data.action === "limits") {
          assert(data.limits, "BETA_INVALID_LIMITS", 400);
          next.limits = betaLimitsSchema.parse(data.limits);
        } else {
          next.status = data.action === "revoke" ? "REVOKED" : "DELETING";
        }
        const canceled = await cancelBetaRuns(tx, s);
        if (["revoke", "unlink", "delete"].includes(data.action)) {
          await requestBetaDeletion(
            tx,
            s,
            data.action === "revoke"
              ? "REVOKED"
              : data.action === "unlink"
                ? "UNLINK"
                : "DELETE_REQUEST",
          );
          next.status = "DELETING";
        } else if (next.activated_at)
          next.grant_id = await betaGrant(tx, s, next, data.reason);
        row = (
          await sql<Invitation>`UPDATE beta_guild_invitations SET status=${next.status},generation=${next.generation},activated_at=${next.activated_at},expires_at=${next.expires_at},guild_name=${next.guild_name},bot_present=${next.bot_present},bot_checked_at=${next.bot_checked_at},grant_id=${next.grant_id}::uuid,limits=${JSON.stringify(next.limits)}::jsonb,updated_at=now() WHERE ${tenant(s)} RETURNING *`.execute(
            tx,
          )
        ).rows[0]!;
        await operatorAudit(tx, data.action.toUpperCase(), "SUCCEEDED", {
          requestId: data.requestId,
          guildId: s.guildId,
          reason: data.reason,
          before: invitationAudit(before),
          after: { ...invitationAudit(row), canceledRuns: canceled },
        });
      }
      if (data.action === "register")
        await operatorAudit(tx, "REGISTER", "SUCCEEDED", {
          requestId: data.requestId,
          guildId: s.guildId,
          reason: data.reason,
          before: invitationAudit(before),
          after: invitationAudit(row),
        });
      await sql`INSERT INTO operator_requests(id,fingerprint,guild_id,result) VALUES(${data.requestId}::uuid,${fingerprint},${s.guildId},${JSON.stringify(row)}::jsonb)`.execute(
        tx,
      );
      return row;
    });
  }
}
