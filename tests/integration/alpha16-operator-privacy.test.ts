import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { isolatedPostgres } from "../fixtures/postgres";
import { connect, ensureGuild, migrate, sql, tenant, type Database } from "../../packages/db/src/index";
import { IdentityVault } from "../../packages/identity/src/index";
import { SettingsService } from "../../packages/settings/src/index";
import { PrivacyService } from "../../packages/security/src/privacy";
import { operatorDigest, type OperatorAuth } from "../../packages/security/src/operator-auth";
import { PublicTokenCipher } from "../../packages/security/src/public-sessions";
import { Alpha16Operator, OPERATOR_PERMISSIONS, type Alpha16OperatorPolicy, type OperatorGrant } from "../../packages/security/src/alpha16-operator";
import type { Alpha16RetentionClass } from "../../packages/security/src/alpha16-retention";

// Controlled fixture profile only. It does not approve or install an operating
// retention period, credential, external service or provider connection.
let infra: Awaited<ReturnType<typeof isolatedPostgres>>, db: Database, guild = 985160000000000001n, sessionNumber = 0;
const vault = new IdentityVault("b1".repeat(32), "c2".repeat(32));
const publicCipher = new PublicTokenCipher("alpha16-isolated-test-session-cipher");
const userId = "985160000000000099";
beforeAll(async () => { infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); });
function testPolicy(): Alpha16OperatorPolicy {
  const classes: Alpha16RetentionClass[] = ["OPERATOR_PREVIEW", "OPERATOR_STEP_UP", "AUDIT", "DELETION_RECEIPT", "DELETION_JOB", "TOMBSTONE", "OPERATOR_CONTROL"];
  return { revision: "isolated-test-profile", retention: classes.map(kind => ({ class: kind, approved: true as const, enforcementVerified: true as const, revision: "fixture-only", durationMs: kind === "TOMBSTONE" ? 10 * 86400000 : 3600000 })),
    previewMs: 300000, challengeMs: 60000, stepUpMs: 60000, receiptRateWindowMs: 60000, receiptMaxUsesPerWindow: 5, receiptMaxTotalUses: 10, deletionLeaseMs: 60000, guildDeletionWriterCoverageVerified: true };
}
async function fixture(scrubFails = false) {
  const scope = { organizationId: randomUUID(), guildId: String(guild++) }, epoch = randomUUID();
  await ensureGuild(db, scope);
  const sessionValue = String(++sessionNumber).padStart(43, "a"), session = operatorDigest(sessionValue);
  await sql`INSERT INTO operator_sessions(digest,credential_epoch,csrf_digest,expires_at) VALUES(${session},${epoch}::uuid,${"f".repeat(64)},clock_timestamp()+interval '1 hour')`.execute(db);
  const identity = randomUUID(), subjectHash = vault.hash(scope, userId);
  await sql`INSERT INTO member_identity_map(organization_id,guild_id,id,lookup_hash,encrypted_id) VALUES(${scope.organizationId}::uuid,${scope.guildId},${identity}::uuid,${subjectHash},${vault.seal(scope,userId)})`.execute(db);
  const publicDigest = operatorDigest("public:" + sessionValue);
  await sql`INSERT INTO public_oauth_sessions(digest,user_digest,user_ciphertext,token_ciphertext,access_expires_at,expires_at) VALUES(${publicDigest},${publicCipher.userDigest(userId)},'fixture-encrypted-user','fixture-encrypted-token',clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 hour')`.execute(db);
  const scrub = vi.fn(async () => { if (scrubFails) throw new Error("fixture-scrub-unavailable"); });
  const privacy = new PrivacyService(db, vault, new SettingsService(db), scrub);
  const grant: OperatorGrant = { permissions: [...OPERATOR_PERMISSIONS], guildIds: [scope.guildId], global: true };
  const factor = vi.fn(async () => ({ credentialEpoch: epoch }));
  const service = new Alpha16Operator(db, { reauthenticate: factor } as unknown as OperatorAuth, {
    policy: async () => testPolicy(), grant: async () => grant, vault, publicSessionCipher: publicCipher, privacy,
  });
  const preview = await service.previewDeletion(session, { targetType: "DISCORD_USER", targetDiscordId: userId, scopeKind: "GUILD", guildId: scope.guildId });
  return { scope, session, sessionValue, preview, service, grant, publicDigest, subjectHash, scrub, factor,
    confirmation: async () => {
      const challenge = await service.challenge(session, preview.previewId);
      const proof = await service.reauthenticate(sessionValue, "fixture-csrf", { challengeId: challenge.challengeId, challenge: challenge.challenge, password: "fixture-password" });
      return { previewId: preview.previewId, previewHash: preview.previewHash, stepUpToken: proof.stepUpToken, confirmation: true as const };
    } };
}
it("A16-DEL-04 commits tombstone, session revocation, job and limited receipt together", async () => {
  const f = await fixture(), result = await f.service.confirm(f.session, await f.confirmation(), randomUUID(), "PRIVACY_DELETE");
  expect(result).toMatchObject({ state: "QUEUED", livePurgeState: "PENDING", backupState: "UNKNOWN" });
  expect((await sql`SELECT id FROM deletion_requests WHERE ${tenant(f.scope)} AND lookup_hash=${f.subjectHash}`.execute(db)).rows).toHaveLength(1);
  expect((await sql<{ revoked_at: Date | null; token_ciphertext: string | null }>`SELECT revoked_at,token_ciphertext FROM public_oauth_sessions WHERE digest=${f.publicDigest}`.execute(db)).rows[0]).toMatchObject({ revoked_at: expect.any(Date), token_ciphertext: null });
  expect((await sql`SELECT id FROM alpha16_privacy_jobs WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(1);
  const stored = (await sql<{ secret_hash: string }>`SELECT secret_hash FROM alpha16_deletion_receipts WHERE id=${String(result.receiptId)}::uuid`.execute(db)).rows[0]!;
  expect(stored.secret_hash).not.toBe(result.receiptSecret);
  expect(f.scrub).not.toHaveBeenCalled();
});
it("A16-DEL-03 rejects a changed preview hash and keeps the database untouched", async () => {
  const f = await fixture(), confirmation = await f.confirmation();
  await expect(f.service.confirm(f.session, { ...confirmation, previewHash: "0".repeat(64) }, randomUUID(), "PRIVACY_DELETE")).rejects.toThrow("VERSION_MISMATCH");
  expect((await sql`SELECT id FROM deletion_requests WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
  expect((await sql`SELECT id FROM alpha16_privacy_jobs WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
});
it("A16-DEL-02 GLOBAL remains disabled even with a dedicated grant until writer coverage exists", async () => {
  const f = await fixture();
  await expect(f.service.previewDeletion(f.session, { targetType: "DISCORD_USER", targetDiscordId: userId, scopeKind: "GLOBAL", guildId: null })).rejects.toThrow("GLOBAL_WRITER_COVERAGE_UNVERIFIED");
});
it("A16-DEL-03 rechecks current permission before using an issued step-up", async () => {
  const f = await fixture(), confirmation = await f.confirmation();
  f.grant.permissions = [];
  await expect(f.service.confirm(f.session, confirmation, randomUUID(), "PRIVACY_DELETE")).rejects.toThrow("PERMISSION_DENIED");
  expect((await sql`SELECT id FROM deletion_requests WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(0);
});
it("A16-DEL-08 receipt cannot read identity data and requires the exact scope proof", async () => {
  const f = await fixture(), result = await f.service.confirm(f.session, await f.confirmation(), randomUUID(), "PRIVACY_DELETE");
  const proof = { secret: String(result.receiptSecret), scopeProof: String(result.scopeProof) };
  const status = await f.service.deletionStatus(null, result.receiptId, proof);
  expect(status).toMatchObject({ state: "QUEUED", backupState: "UNKNOWN" });
  expect(JSON.stringify(status)).not.toContain(userId);
  expect(status).not.toHaveProperty("receiptSecret");
  await expect(f.service.deletionStatus(null, result.receiptId, { ...proof, scopeProof: "f".repeat(64) })).rejects.toThrow("AUTH_REQUIRED");
});
it("same-intent replay returns current limited status, without another receipt secret", async () => {
  const f = await fixture(), confirmation = await f.confirmation(), key = randomUUID();
  const first = await f.service.confirm(f.session, confirmation, key, "PRIVACY_DELETE");
  const second = await f.service.confirm(f.session, confirmation, key, "PRIVACY_DELETE");
  expect(second.operationId).toBe(first.operationId);
  expect(second).not.toHaveProperty("receiptSecret");
  expect(second).not.toHaveProperty("targetDiscordId");
  expect((await sql`SELECT id FROM alpha16_privacy_jobs WHERE ${tenant(f.scope)}`.execute(db)).rows).toHaveLength(1);
});
it("receipt expiry is independent from job lifecycle and cannot clear the tombstone", async () => {
  const f = await fixture(), result = await f.service.confirm(f.session, await f.confirmation(), randomUUID(), "PRIVACY_DELETE");
  await sql`DELETE FROM alpha16_privacy_jobs WHERE id=${String(result.operationId)}::uuid`.execute(db);
  const status = await f.service.deletionStatus(null, result.receiptId, { secret: String(result.receiptSecret), scopeProof: String(result.scopeProof) });
  expect(status).toMatchObject({ state: "UNKNOWN", livePurgeState: "UNKNOWN", progressClass: "STATUS_RECORD_EXPIRED" });
  expect((await sql`SELECT id FROM deletion_requests WHERE ${tenant(f.scope)} AND lookup_hash=${f.subjectHash}`.execute(db)).rows).toHaveLength(1);
});
it("A16-DEL-06 incomplete queue scrub stays PARTIAL_FAILURE with its tombstone active", async () => {
  const f = await fixture(true), result = await f.service.confirm(f.session, await f.confirmation(), randomUUID(), "PRIVACY_DELETE");
  expect(await f.service.processDeletion(String(result.operationId))).toMatchObject({ state: "PARTIAL_FAILURE" });
  const status = await f.service.deletionStatus(null, result.receiptId, { secret: String(result.receiptSecret), scopeProof: String(result.scopeProof) });
  expect(status.livePurgeState).toBe("PARTIAL_FAILURE");
  expect(status.backupState).toBe("UNKNOWN");
  expect((await sql`SELECT id FROM deletion_requests WHERE ${tenant(f.scope)} AND lookup_hash=${f.subjectHash}`.execute(db)).rows.length).toBeGreaterThan(0);
});
it("purges factor proofs at their own deadline while the reviewed preview remains valid", async () => {
  const f = await fixture(); await f.confirmation();
  await sql`UPDATE alpha16_operator_stepups SET created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE preview_id=${f.preview.previewId}::uuid`.execute(db);
  await sql`UPDATE alpha16_operator_challenges SET created_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE preview_id=${f.preview.previewId}::uuid`.execute(db);
  await f.service.purgeEphemeral();
  expect((await sql`SELECT id FROM alpha16_operator_previews WHERE id=${f.preview.previewId}::uuid AND expires_at>clock_timestamp()`.execute(db)).rows).toHaveLength(1);
  expect((await sql`SELECT token_hash FROM alpha16_operator_stepups WHERE preview_id=${f.preview.previewId}::uuid`.execute(db)).rows).toHaveLength(0);
  expect((await sql`SELECT id FROM alpha16_operator_challenges WHERE preview_id=${f.preview.previewId}::uuid`.execute(db)).rows).toHaveLength(0);
});
