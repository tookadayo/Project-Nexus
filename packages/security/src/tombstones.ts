import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql, tenant, ensureGuild, type Database } from "../../db/src/index";
import type { IdentityVault } from "../../identity/src/index";
import type { PrivacyService } from "./privacy";
import { requestBetaDeletion } from "./hosted-beta";
import { PublicTokenCipher } from "./public-sessions";
import { operatorAudit } from "./operator-auth";
import { assert } from "../../shared/src/index";
const scope = z
  .object({
    organizationId: z.uuid(),
    guildId: z.string().regex(/^\d{17,20}$/),
  })
  .strict();
const snapshotSchema = z
  .object({
    version: z.literal(1),
    guilds: z.array(scope).max(10000),
    members: z
      .array(
        scope
          .extend({ lookupHash: z.string().regex(/^[a-f0-9]{64}$/) })
          .strict(),
      )
      .max(100000),
  })
  .strict();
export type DeletionTombstones = z.infer<typeof snapshotSchema>;
// No API content, display names, provider tokens or recoverable member IDs.
export async function captureDeletionTombstones(
  db: Database,
): Promise<DeletionTombstones> {
  const guilds = (
    await sql<{
      organizationId: string;
      guildId: string;
    }>`SELECT organization_id AS "organizationId",guild_id AS "guildId" FROM beta_deletion_jobs UNION SELECT organization_id,guild_id FROM deletion_requests WHERE lookup_hash IS NULL`.execute(
      db,
    )
  ).rows;
  const members = (
    await sql<{
      organizationId: string;
      guildId: string;
      lookupHash: string;
    }>`SELECT DISTINCT organization_id AS "organizationId",guild_id AS "guildId",lookup_hash AS "lookupHash" FROM deletion_requests WHERE lookup_hash IS NOT NULL AND completed_at IS NOT NULL`.execute(
      db,
    )
  ).rows;
  return snapshotSchema.parse({ version: 1, guilds, members });
}
export const sealDeletionTombstones = (
  value: DeletionTombstones,
  key: string,
) =>
  new PublicTokenCipher(key).seal(
    "deletion-tombstones:v1",
    JSON.stringify(snapshotSchema.parse(value)),
  );
export const openDeletionTombstones = (value: string, key: string) =>
  snapshotSchema.parse(
    JSON.parse(
      new PublicTokenCipher(key).open("deletion-tombstones:v1", value),
    ),
  );
// OS-local restore only, before any ingest/outbound worker starts. Deliberately
// invalidates every restored login, since a backup may predate its revocation.
export async function applyDeletionTombstones(
  db: Database,
  vault: IdentityVault,
  privacy: PrivacyService,
  input: unknown,
) {
  const snapshot = snapshotSchema.parse(input);
  await db.transaction().execute(async (tx) => {
    await sql`UPDATE public_oauth_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()),token_ciphertext=NULL,user_ciphertext='',refresh_owner=NULL,refresh_until=NULL,generation=generation+1`.execute(
      tx,
    );
    await sql`UPDATE operator_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp())`.execute(
      tx,
    );
  });
  for (const s of snapshot.guilds) {
    await db.transaction().execute(async (tx) => {
      await ensureGuild(tx, s);
      await requestBetaDeletion(tx, s, "DELETE_REQUEST");
      // Restored DONE rows may coexist with restored pre-deletion data. Reapply
      // deletion rather than trusting that historical completion marker.
      await sql`UPDATE beta_deletion_jobs SET state='PENDING',attempts=0,requested_at=clock_timestamp(),available_at=clock_timestamp(),completed_at=NULL,last_error=NULL WHERE ${tenant(s)}`.execute(
        tx,
      );
    });
    const job = (
      await sql<{
        id: string;
      }>`SELECT id FROM beta_deletion_jobs WHERE ${tenant(s)}`.execute(db)
    ).rows[0]!;
    await privacy.deleteBetaGuild(s, job.id);
  }
  for (const member of snapshot.members) {
    const s = {
      organizationId: member.organizationId,
      guildId: member.guildId,
    };
    if (
      snapshot.guilds.some(
        (g) => g.guildId === s.guildId && g.organizationId === s.organizationId,
      )
    )
      continue;
    const identity = (
      await sql<{
        encrypted_id: string;
      }>`SELECT encrypted_id FROM member_identity_map WHERE ${tenant(s)} AND lookup_hash=${member.lookupHash}`.execute(
        db,
      )
    ).rows[0];
    if (identity) {
      const userId = vault.open(s, identity.encrypted_id);
      assert(
        vault.hash(s, userId) === member.lookupHash,
        "TOMBSTONE_IDENTITY_UNAVAILABLE",
        503,
      );
      await privacy.delete(s, userId, {
        key: member.lookupHash,
        permissions: "0",
        roles: [],
        source: "SYSTEM",
        requestId: randomUUID(),
      });
    } else {
      // Without a matching identity/key or a completed scoped erasure, never
      // claim the restored member's data was deleted. Keep recovery offline.
      assert(
        (
          await sql`SELECT id FROM deletion_requests WHERE ${tenant(s)} AND lookup_hash=${member.lookupHash} AND completed_at IS NOT NULL`.execute(
            db,
          )
        ).rows.length,
        "TOMBSTONE_IDENTITY_UNAVAILABLE",
        503,
      );
    }
  }
  await operatorAudit(db, "RESTORE_TOMBSTONES", "SUCCEEDED", {
    after: {
      guilds: snapshot.guilds.length,
      members: snapshot.members.length,
      sessionsRevoked: true,
    },
  });
}
