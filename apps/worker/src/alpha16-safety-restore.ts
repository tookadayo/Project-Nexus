import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, type Database } from "../../../packages/db/src/index";
import { assert, type Scope } from "../../../packages/shared/src/index";
import type { IdentityVault } from "../../../packages/identity/src/index";
import type { PrivacyService } from "../../../packages/security/src/privacy";
import { applyDeletionTombstones } from "../../../packages/security/src/tombstones";
import { ALPHA16_MAX_BACKUP_RETENTION_MS,ALPHA16_RESTORE_SOURCE_SCHEMA_VERSION } from "../../../packages/security/src/alpha16-retention";
import { IndependentSafetyAuthority, reconcileIndependentTargetSafety, safetyContentHash, type SafetyEvidenceProof } from "../../../packages/security/src/alpha16-safety-state";
import { acquireRuleScopeLocks } from "../../../packages/rules/src/locks";
import {assertAlpha16RestoredSourceSchema,purgeAlpha16RestoredSourceSnapshots,assertAlpha16RestoredSourceRetention,type RestoredSourceRetentionCoverage} from "../../../packages/security/src/alpha16-restored-source-retention";

const backupSchema = z.object({ reference: z.string().min(1).max(200), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(), expiresAt: z.iso.datetime(), destinationId: z.string().min(1).max(200),
  isolatedDestination: z.literal(true), retentionEnforced: z.literal(true) }).strict();
export type SafetyRestoreBackup = z.infer<typeof backupSchema>;
/** Trusted PC supervisor adapters, never browser input. Implementations must
 * fence all ingestion/outbound processes and the destination before returning
 * isolatedDestination, and conditionally restore exactly the inspected hash.
 * The storage adapter owns durable one-shot restore admission; an uncertain
 * restore result must not be automatically retried. No adapter is installed. */
export type SafetyRestoreAdapters = {
  inspectBackup(reference: string): Promise<unknown>;
  latestTombstones(): Promise<unknown>;
  restoreIsolatedAndPrepareSchema(backup: Readonly<SafetyRestoreBackup>, oneShotId: string): Promise<void>;
  /** Complete expiry enforcement for all configured classes, not one batch. */
  purgeExpiredData(db: Database, now: Date): Promise<void>;
  /** Rebuild from current canonical state; never replay restored outbox rows. */
  rebuildQueuesAndCaches(db: Database): Promise<void>;
  assertDestinationStillIsolated(destinationId: string): Promise<void>;
};
type RecoveryReceipt = Readonly<{ destinationId: string; backupHash: string; reconciledAt: string; validUntil: string;
  recoveryComplete: true; externalApplyReady: false; externalPublicationReady: false }>;
const orderedScopes = (scopes: readonly Scope[]) => [...scopes].sort((a, b) => `${a.organizationId}:${a.guildId}`.localeCompare(`${b.organizationId}:${b.guildId}`));

/** Offline recovery coordinator. A successful pass keeps all old target gates
 * UNKNOWN and all Operator controls STOPPED. It grants no external effect,
 * performs no normal startup, and adds no gate to ordinary privacy deletion. */
export class Alpha16SafetyRestore {
  private readonly receipts = new WeakMap<RecoveryReceipt, { backup: SafetyRestoreBackup; tombstones: SafetyEvidenceProof; publications: SafetyEvidenceProof; targets: { scope: Scope; proof: SafetyEvidenceProof }[];sourceRetention:RestoredSourceRetentionCoverage }>();
  private restoreAttempted = false;
  constructor(private readonly db: Database, private readonly vault: IdentityVault, private readonly privacy: PrivacyService,
    private readonly safety: IndependentSafetyAuthority, private readonly adapters?: SafetyRestoreAdapters,
    private readonly clock: () => Date = () => new Date()) {}
  readiness() {
    const blockers = [...(!this.adapters ? ["ISOLATED_RESTORE_ADAPTER_UNCONFIGURED"] : []),
      ...["RESTORE_TOMBSTONE", "TARGET_LIVE_SAFETY", "PUBLICATION_WITHDRAWAL"].flatMap(kind => this.safety.readiness(kind as "RESTORE_TOMBSTONE" | "TARGET_LIVE_SAFETY" | "PUBLICATION_WITHDRAWAL").blockers.map(reason => `${kind}:${reason}`))];
    return { enabled: blockers.length === 0, blockers };
  }
  private assertBackup(backup: SafetyRestoreBackup) {
    const now = this.clock().getTime(), created = Date.parse(backup.createdAt), expires = Date.parse(backup.expiresAt);
    assert(Number.isFinite(now) && created <= now && expires > now && expires > created && expires - created <= ALPHA16_MAX_BACKUP_RETENTION_MS,
      "BACKUP_EXPIRED_OR_RETENTION_LIMIT", 409);
  }
  private async latest() {
    const proof = await this.safety.observe("RESTORE_TOMBSTONE", null, this.clock());
    const content = await this.adapters!.latestTombstones();
    this.safety.assertTombstones(content, proof, this.clock());
    return { proof, content };
  }
  private async scopes() {
    const rows = (await sql<Scope>`SELECT organization_id AS "organizationId",guild_id AS "guildId" FROM guilds ORDER BY organization_id,guild_id LIMIT 10001`.execute(this.db)).rows;
    assert(rows.length <= 10000, "RESTORE_SCOPE_CAPACITY_UNCONFIGURED", 503); return orderedScopes(rows);
  }
  async restore(reference: string): Promise<RecoveryReceipt> {
    assert(this.readiness().enabled && this.adapters, "SAFETY_RESTORE_UNAVAILABLE", 503);
    assert(!this.restoreAttempted, "RESTORE_RESULT_REQUIRES_RECONCILIATION", 409);
    const backup = backupSchema.parse(await this.adapters.inspectBackup(reference));
    assert(backup.reference === reference, "BACKUP_IDENTITY_MISMATCH", 409); this.assertBackup(backup);
    const before = await this.latest();
    await applyDeletionTombstones(this.db, this.vault, this.privacy, before.content, { authority: this.safety, proof: before.proof });
    await this.adapters.assertDestinationStillIsolated(backup.destinationId); this.assertBackup(backup);
    assert(!this.restoreAttempted, "RESTORE_RESULT_REQUIRES_RECONCILIATION", 409);
    this.restoreAttempted = true;
    // A timeout/throw is not proof the storage restore did not happen. This
    // instance deliberately refuses another restore. Only a boolean is kept;
    // there is no unbounded backup hash/attempt history cache.
    await this.adapters.restoreIsolatedAndPrepareSchema(Object.freeze({ ...backup }), randomUUID());
    await assertAlpha16RestoredSourceSchema(this.db);
    const after = await this.latest();
    await applyDeletionTombstones(this.db, this.vault, this.privacy, after.content, { authority: this.safety, proof: after.proof });
    // New finite native/metric copies need explicit coverage even when an older
    // supervisor's generic purge adapter knows only the earlier table set.
    await this.db.transaction().execute(tx=>purgeAlpha16RestoredSourceSnapshots(tx));
    await this.adapters.purgeExpiredData(this.db, this.clock());
    await this.adapters.rebuildQueuesAndCaches(this.db);
    const scopes = await this.scopes(), targets: { scope: Scope; proof: SafetyEvidenceProof }[] = [];
    for (const scope of scopes) targets.push({ scope, proof: await this.safety.observe("TARGET_LIVE_SAFETY", scope, this.clock()) });
    const publicationProof = await this.safety.observe("PUBLICATION_WITHDRAWAL", null, this.clock());
    // Refresh after the erasure/rebuild work. A concurrently added deletion
    // changes the hash and prevents completion, without repeating a restore.
    const latest = await this.latest();
    assert(safetyContentHash(latest.content) === safetyContentHash(after.content), "LATEST_TOMBSTONES_CHANGED", 409);
    await this.adapters.assertDestinationStillIsolated(backup.destinationId); this.assertBackup(backup);
    const sourceRetention=await this.db.transaction().execute(async tx => {
      await acquireRuleScopeLocks(tx, [{ kind: "GLOBAL", mode: "exclusive" }]);
      const current = orderedScopes((await sql<Scope>`SELECT organization_id AS "organizationId",guild_id AS "guildId" FROM guilds ORDER BY organization_id,guild_id LIMIT 10001`.execute(tx)).rows);
      assert(safetyContentHash(current) === safetyContentHash(scopes), "RESTORE_SCOPE_SET_CHANGED", 409);
      this.safety.assertTombstones(latest.content, latest.proof, this.clock());
      this.safety.require("PUBLICATION_WITHDRAWAL", null, publicationProof, this.clock());
      for (const target of targets) await reconcileIndependentTargetSafety(tx, target.scope, this.safety, target.proof, this.clock());
      // Recheck all opaque proofs after lock waits/work. Returned roots from
      // a backup cannot substitute for these process-local current proofs.
      for (const target of targets) this.safety.require("TARGET_LIVE_SAFETY", target.scope, target.proof, this.clock());
      this.safety.require("PUBLICATION_WITHDRAWAL", null, publicationProof, this.clock());
      this.safety.assertTombstones(latest.content, latest.proof, this.clock());
      this.assertBackup(backup);
      return assertAlpha16RestoredSourceRetention(tx);
    });
    const validUntil = new Date(Math.min(Date.parse(backup.expiresAt), Date.parse(latest.proof.expiresAt), Date.parse(publicationProof.expiresAt), ...targets.map(target => Date.parse(target.proof.expiresAt)),...(sourceRetention.nextExpiry?[Date.parse(sourceRetention.nextExpiry)]:[])));
    assert(validUntil>this.clock(),"RESTORE_SOURCE_EXPIRY_PURGE_REQUIRED",409);
    const receipt = Object.freeze({ destinationId: backup.destinationId, backupHash: backup.contentHash, reconciledAt: this.clock().toISOString(), validUntil: validUntil.toISOString(),
      recoveryComplete: true as const, externalApplyReady: false as const, externalPublicationReady: false as const });
    this.receipts.set(receipt, { backup, tombstones: latest.proof, publications: publicationProof, targets,sourceRetention }); return receipt;
  }
  assertRecoveryReceipt(receipt: RecoveryReceipt) {
    const record = this.receipts.get(receipt);
    assert(record && Date.parse(receipt.validUntil) > this.clock().getTime(), "RESTORE_RECEIPT_UNVERIFIED", 409);
    assert(record.sourceRetention.schemaVersion===ALPHA16_RESTORE_SOURCE_SCHEMA_VERSION&&(!record.sourceRetention.nextExpiry||Date.parse(record.sourceRetention.nextExpiry)>this.clock().getTime()),"RESTORE_SOURCE_EXPIRY_PURGE_REQUIRED",409);
    this.assertBackup(record.backup);
    this.safety.require("RESTORE_TOMBSTONE", null, record.tombstones, this.clock());
    this.safety.require("PUBLICATION_WITHDRAWAL", null, record.publications, this.clock());
    for (const target of record.targets) this.safety.require("TARGET_LIVE_SAFETY", target.scope, target.proof, this.clock());
    // The receipt attests this isolated pass only. Starting a supervisor or
    // re-opening a target requires separate current admission/permissions.
    return { recoveryComplete: true as const, externalApplyReady: false as const, externalPublicationReady: false as const,finiteSourceRetention:record.sourceRetention };
  }
}
