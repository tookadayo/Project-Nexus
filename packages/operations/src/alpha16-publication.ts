import { z } from "zod";
import { sql, type Database, type Tx } from "../../db/src/index";
import { assert } from "../../shared/src/index";
import {
  canonicalPublicJson, officialStaticInputSchema, prepareAnnouncement, publicationReadiness, publicArtifactHash,
  type PublisherCapability, type PublicationManifest,
} from "../../presentation/src/alpha16-publication";
import { approvedRetention, retentionExpiry, type Alpha16RetentionPolicy } from "../../security/src/alpha16-retention";
import { OfficialPublications } from "./publication";
import { IndependentSafetyAuthority, type SafetyEvidenceProof } from "../../security/src/alpha16-safety-state";

type HeadRow = { publication_id: string; generation: string | number; active_generation: string | number | null; pending_generation: string | number | null;
  withdrawn_generation: string | number; withdrawn_source_version: number; sync_state: string; expires_at: Date;
  safety_expires_at?: Date | null; safety_policy_revision?: string | null; verified_generation?: string | null; verified_at?: Date | null; active_artifact_hash?: string | null };
type ManifestRow = { publication_id: string; generation: string | number; source_version: number; source_row_revision: number; previous_generation: string | number;
  operation: "PUBLISH" | "WITHDRAW"; schema_version: 1; artifact_hash: string; state: PublicationManifest["state"];
  effect_state: "PREPARED" | "ADMITTED" | "CONFIRMED" | "NOT_STARTED" | "UNKNOWN"; created_at: Date; published_at: Date | null; expires_at: Date };
export type StaticPublicationReceipt = { state: "CONFIRMED"; generation: number; artifactHash: string } | { state: "NOT_STARTED" | "UNKNOWN" };
export type StaticPublisher = {
  capability: PublisherCapability;
  /** Must atomically compare the remote generation and switch the manifest,
   * index and route visibility together. Implementations are alpha17 gated. */
  switchGeneration(input: { sourceId: string; previousGeneration: number; generation: number; artifactHash: string; payload: unknown; withdraw: boolean }): Promise<StaticPublicationReceipt>;
  /** Read-only reconciliation. It cannot retry a publication or send content. */
  readGeneration(sourceId: string): Promise<{ generation: number; artifactHash: string; withdrawn: boolean } | null>;
};
export type StaticPublicationOptions = {
  enabled?: boolean; canonicalOriginsVerified?: boolean; retention?: Alpha16RetentionPolicy;
  publisher?: StaticPublisher;
  safetyAuthority?: IndependentSafetyAuthority;
  now?: () => Date;
  /** The loopback Operator binds this to the reviewed command/step-up. No
   * browser flag or local-network placement substitutes for authority. */
  authorize?: (action: "PUBLISH" | "WITHDRAW" | "RECONCILE", sourceId: string) => Promise<void>;
};
const number = (value: string | number) => z.coerce.number().safe().int().nonnegative().parse(value);
const sourceId = z.uuid();
const draftCommand = z.object({ publicationId: sourceId, expectedSourceRevision: z.number().int().nonnegative(), expectedGeneration: z.number().safe().int().nonnegative(),
  operation: z.enum(["PUBLISH", "WITHDRAW"]), expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), confirmed: z.literal(true), translationsReviewed: z.literal(true), target: z.literal("public-site") }).strict();
export type StaticPublicationCommand = z.infer<typeof draftCommand>;
export type StaticPublicationStageProof = Readonly<{ publicationId: string }>;

const reviewHash = (source: { id: string; sourceVersion: number; category: unknown; incidentStatus: unknown; ja: unknown; en: unknown }) =>
  publicArtifactHash({ id: source.id, sourceVersion: source.sourceVersion, category: source.category, incidentStatus: source.incidentStatus, ja: source.ja, en: source.en });

/** Expiry is not proof that a remote generation disappeared. Only obsolete
 * history below a retained generation barrier can be erased without blocking
 * the source. This pure decision does not confer publisher authority. */
export function publicationManifestExpiryDecision(head: HeadRow | null, row: ManifestRow, now: Date) {
  const generation = number(row.generation);
  const highWater = head ? Math.max(number(head.generation), number(head.withdrawn_generation), head.pending_generation === null ? 0 : number(head.pending_generation)) : 0;
  const referenced = !!head && (head.active_generation !== null && number(head.active_generation) === generation || head.pending_generation !== null && number(head.pending_generation) === generation);
  const uncertain = row.state === "ACTIVE" || row.effect_state === "ADMITTED" || row.effect_state === "UNKNOWN";
  const headExpired = !!head && head.expires_at.getTime() <= now.getTime();
  return { blockHead: !head || headExpired || head.sync_state === "UNKNOWN" || referenced || uncertain || generation > highWater,
    withdrawalRequired: uncertain || !!head && headExpired && (head.active_generation !== null || head.pending_generation !== null) };
}

/** Internal, bounded maintenance; no HTTP route, source/body copy or remote
 * I/O. It runs even when new publication generation is disabled. Both history
 * and independently expiring safety roots are erased without extension. */
export async function purgeExpiredStaticPublicationManifests(db: Database, now = new Date(), limit = 100) {
  z.number().safe().int().min(1).max(200).parse(limit);
  assert(Number.isFinite(now.getTime()), "INVALID_REQUEST", 400);
  return db.transaction().execute(async tx => {
    await sql`SELECT pg_advisory_xact_lock(763214)`.execute(tx);
    const installed = (await sql<{ present: boolean }>`SELECT to_regclass('official_static_publication_heads') IS NOT NULL AND to_regclass('official_static_publication_manifests') IS NOT NULL AS present`.execute(tx)).rows[0]?.present === true;
    if (!installed) return { available: false, ready: false, reasonCode: "SCHEMA_NOT_INSTALLED" as const, deletedManifests: 0, blockedHeads: 0, withdrawalRequirements: [] as { publicationId: string; activeGeneration: number | null; pendingGeneration: number | null; action: "WITHDRAW_OR_CONFIRM_ABSENCE" }[], moreExpired: false };
    const blocked = new Set<string>();
    // A head can expire before a later staged manifest. Fence that source now;
    // a future manifest expiry is not permission to keep the source actionable.
    const expiredHeads = (await sql<HeadRow>`SELECT * FROM official_static_publication_heads WHERE expires_at<=${now} AND sync_state<>'UNKNOWN' ORDER BY expires_at,publication_id LIMIT ${limit} FOR UPDATE`.execute(tx)).rows;
    for (const head of expiredHeads) {
      await sql`UPDATE official_static_publication_heads SET sync_state='UNKNOWN',updated_at=${now} WHERE publication_id=${head.publication_id}::uuid`.execute(tx);
      blocked.add(head.publication_id);
    }
    const rows = (await sql<ManifestRow>`SELECT * FROM official_static_publication_manifests WHERE expires_at<=${now} ORDER BY expires_at,publication_id,generation LIMIT ${limit} FOR UPDATE`.execute(tx)).rows;
    for (const row of rows) {
      let head = (await sql<HeadRow>`SELECT * FROM official_static_publication_heads WHERE publication_id=${row.publication_id}::uuid FOR UPDATE`.execute(tx)).rows[0] ?? null;
      const decision = publicationManifestExpiryDecision(head, row, now);
      if (!head) {
        // An orphaned expired manifest is not a new source. Reconstruct only a
        // closed, expired generation barrier, never an OPEN zero head.
        await sql`INSERT INTO official_static_publication_heads(publication_id,pending_generation,sync_state,expires_at,updated_at) VALUES(${row.publication_id}::uuid,${row.generation},'UNKNOWN',${now},${now})`.execute(tx);
        head = (await sql<HeadRow>`SELECT * FROM official_static_publication_heads WHERE publication_id=${row.publication_id}::uuid FOR UPDATE`.execute(tx)).rows[0]!;
      }
      if (decision.blockHead) {
        // Preserve generation identity even if the last PREPARED/NOT_STARTED
        // manifest was newer than the last confirmed remote generation.
        const pending = number(row.generation) > number(head.generation) ? Math.max(number(row.generation), head.pending_generation === null ? 0 : number(head.pending_generation)) : head.pending_generation;
        await sql`UPDATE official_static_publication_heads SET sync_state='UNKNOWN',pending_generation=${pending},expires_at=least(expires_at,${now}),updated_at=${now} WHERE publication_id=${row.publication_id}::uuid`.execute(tx);
        blocked.add(row.publication_id);
      }
      await sql`DELETE FROM official_static_publication_manifests WHERE publication_id=${row.publication_id}::uuid AND generation=${row.generation} AND expires_at<=${now}`.execute(tx);
    }
    // Return the current batch's requirement before erasing finite roots. It
    // is transient maintenance output, never a new retained safety history.
    const withdrawals = (await sql<HeadRow>`SELECT * FROM official_static_publication_heads WHERE sync_state='UNKNOWN' AND (active_generation IS NOT NULL OR pending_generation IS NOT NULL) ORDER BY updated_at,publication_id LIMIT ${limit}`.execute(tx)).rows;
    // Safety roots have an independent finite deadline. Missing roots stay
    // closed at every writer until an independent current generation is read.
    const expiredSafety = (await sql<HeadRow>`DELETE FROM official_static_publication_heads WHERE publication_id IN (SELECT publication_id FROM official_static_publication_heads WHERE coalesce(safety_expires_at,expires_at)<=${now} ORDER BY coalesce(safety_expires_at,expires_at),publication_id LIMIT ${limit}) RETURNING *`.execute(tx)).rows;
    const withdrawalRows = [...new Map([...withdrawals, ...expiredSafety.filter(head => head.active_generation !== null || head.pending_generation !== null)].map(head => [head.publication_id, head])).values()];
    const remaining = (await sql<{ present: boolean }>`SELECT EXISTS(SELECT 1 FROM official_static_publication_manifests WHERE expires_at<=${now}) OR EXISTS(SELECT 1 FROM official_static_publication_heads WHERE coalesce(safety_expires_at,expires_at)<=${now}) AS present`.execute(tx)).rows[0]?.present === true;
    const unresolved = (await sql<{ present: boolean }>`SELECT EXISTS(SELECT 1 FROM official_static_publication_heads WHERE sync_state='UNKNOWN' OR expires_at<=${now}) AS present`.execute(tx)).rows[0]?.present === true;
    return { available: true, ready: false, cleanupComplete: !remaining, externalPublicationReady: false, reasonCode: unresolved || withdrawalRows.length ? "PUBLICATION_WITHDRAWAL_OR_SAFETY_UNRESOLVED" as const : "INDEPENDENT_PUBLICATION_SAFETY_REQUIRED" as const, deletedManifests: rows.length, blockedHeads: blocked.size, deletedSafetyRoots: expiredSafety.length,
      withdrawalRequirements: withdrawalRows.map(head => ({ publicationId: head.publication_id, activeGeneration: head.active_generation === null ? null : number(head.active_generation), pendingGeneration: head.pending_generation === null ? null : number(head.pending_generation), action: "WITHDRAW_OR_CONFIRM_ABSENCE" as const })), moreExpired: remaining };
  });
}

/** PC publication authority. Staged artifacts reference the existing immutable
 * source revision; they do not copy its body into a second history table.
 * No actual publisher adapter is installed by alpha16. */
export class StaticPublications {
  private readonly sources: OfficialPublications;
  private readonly stageProofs = new WeakMap<StaticPublicationStageProof, { command: string; safety: SafetyEvidenceProof }>();
  constructor(private readonly db: Database, private readonly options: StaticPublicationOptions = {}) { this.sources = new OfficialPublications(db); }
  readiness() {
    const publication = publicationReadiness({ enabled: this.options.enabled === true, retentionApproved: Boolean(approvedRetention(this.options.retention ?? [], "PUBLICATION_HISTORY")),
      canonicalOriginsVerified: this.options.canonicalOriginsVerified === true, capability: this.options.publisher?.capability });
    const safety = this.options.safetyAuthority?.readiness("PUBLICATION_WITHDRAWAL");
    const blockers = [...publication.blockers, ...(!approvedRetention(this.options.retention ?? [], "PUBLICATION_WITHDRAWAL") ? ["PUBLICATION_WITHDRAWAL_LIFETIME_UNCONFIGURED"] : []), ...(safety?.blockers ?? ["INDEPENDENT_SAFETY_SOURCE_UNCONFIGURED"])];
    return { enabled: blockers.length === 0, blockers };
  }
  private async permitted(action: "PUBLISH" | "WITHDRAW" | "RECONCILE", id: string) {
    assert(this.options.authorize, "PUBLICATION_AUTHORITY_REQUIRED", 403);
    await this.options.authorize(action, sourceId.parse(id));
    assert(this.readiness().enabled && this.options.publisher, "PUBLIC_PUBLISH_UNAVAILABLE", 503);
    return this.options.safetyAuthority!.observe("PUBLICATION_WITHDRAWAL", null, this.currentTime());
  }
  private currentTime() { return this.options.now?.() ?? new Date(); }
  private async lock(tx: Tx) { await sql`SELECT pg_advisory_xact_lock(763214)`.execute(tx); }
  private async head(tx: Tx, id: string) { return (await sql<HeadRow>`SELECT * FROM official_static_publication_heads WHERE publication_id=${id}::uuid FOR UPDATE`.execute(tx)).rows[0] ?? null; }
  private async manifest(tx: Tx, id: string, generation: number) {
    const row = (await sql<ManifestRow>`SELECT * FROM official_static_publication_manifests WHERE publication_id=${id}::uuid AND generation=${generation} FOR UPDATE`.execute(tx)).rows[0];
    assert(row, "PUBLICATION_MANIFEST_NOT_FOUND", 404); return row;
  }
  async status(id: string) {
    sourceId.parse(id);
    const row = (await sql<HeadRow>`SELECT * FROM official_static_publication_heads WHERE publication_id=${id}::uuid`.execute(this.db)).rows[0];
    return { publicationId: id, generation: row ? number(row.generation) : null, activeGeneration: row?.active_generation == null ? null : number(row.active_generation),
      pendingGeneration: row?.pending_generation == null ? null : number(row.pending_generation), syncState: row && row.expires_at.getTime() > Date.now() && row.safety_expires_at && row.safety_expires_at.getTime() > Date.now() ? row.sync_state : "UNKNOWN", readiness: this.readiness() };
  }
  async previewGeneration(id: string, operation: "PUBLISH" | "WITHDRAW") {
    await this.permitted(operation, id);
    const { entry } = this.options.safetyAuthority!.publication(id, undefined, this.currentTime());
    assert(entry.state === "CONFIRMED" && entry.pendingGeneration === null, "PUBLICATION_SAFETY_UNRESOLVED", 503);
    const state = await this.status(id);
    assert(state.generation === null || state.generation === entry.generation && state.pendingGeneration === null && state.syncState !== "UNKNOWN", "PUBLICATION_GENERATION_CONFLICT", 409);
    return entry.generation;
  }
  async previewSource(id: string, expectedRevision: number, operation: "PUBLISH" | "WITHDRAW") {
    const expectedGeneration = await this.previewGeneration(id, operation);
    const source = await this.db.transaction().execute(tx => this.sources.staticSourceInTransaction(tx, id, expectedRevision, this.currentTime(), operation === "PUBLISH"));
    return { expectedGeneration, source, contentHash: reviewHash(source) };
  }
  /** Fetch independent current authority BEFORE any caller takes DB locks.
   * The process-local, one-use proof is bound to the complete typed command. */
  async prepareStage(input: unknown) {
    const command = draftCommand.parse(input), safety = await this.permitted(command.operation, command.publicationId);
    const proof = Object.freeze({ publicationId: command.publicationId });
    this.stageProofs.set(proof, { command: canonicalPublicJson(command), safety });
    return proof;
  }
  async stage(input: unknown, now = this.currentTime()) {
    const proof = await this.prepareStage(input);
    return this.db.transaction().execute(tx => this.stageInTransaction(tx, input, now, proof));
  }
  /** Bind the exact source and generation inside the Operator step-up commit.
   * Only local PREPARED rows are written here; external I/O is after commit. */
  async stageInTransaction(tx: Tx, input: unknown, now = this.currentTime(), proof?: StaticPublicationStageProof) {
    assert(tx.isTransaction, "TRANSACTION_REQUIRED", 500);
    const command = draftCommand.parse(input), accepted = proof && this.stageProofs.get(proof);
    assert(accepted && accepted.command === canonicalPublicJson(command) && this.readiness().enabled, "PUBLICATION_STAGE_PROOF_REQUIRED", 503);
    // No remote provider or callback is awaited while the caller holds locks.
    this.options.safetyAuthority!.publication(command.publicationId, accepted.safety, this.currentTime());
    this.stageProofs.delete(proof!);
    await this.lock(tx);
    let head = await this.head(tx, command.publicationId);
    const expires = retentionExpiry(this.options.retention ?? [], "PUBLICATION_HISTORY", now);
    const { entry, evidence } = this.options.safetyAuthority!.publication(command.publicationId, undefined, now);
    const safetyExpires = new Date(Math.min(Date.parse(entry.expiresAt), retentionExpiry(this.options.retention ?? [], "PUBLICATION_WITHDRAWAL", new Date(evidence.observedAt)).getTime()));
    if (!head) {
      assert(command.expectedGeneration === entry.generation && entry.state === "CONFIRMED" && entry.pendingGeneration === null, "PUBLICATION_GENERATION_CONFLICT", 409);
      // The independent current source supplies the generation high-water;
      // a purged/absent local row is never interpreted as generation zero.
      await sql`INSERT INTO official_static_publication_heads(publication_id,generation,active_generation,pending_generation,withdrawn_generation,withdrawn_source_version,sync_state,expires_at,safety_expires_at,safety_policy_revision,verified_generation,verified_at,active_artifact_hash)
        VALUES(${command.publicationId}::uuid,${entry.generation},${entry.activeGeneration},NULL,${entry.withdrawnGeneration},${entry.withdrawnSourceVersion},'CONFIRMED',${safetyExpires},${safetyExpires},${evidence.policyRevision},${evidence.generation},${new Date(evidence.observedAt)},${entry.activeArtifactHash})`.execute(tx);
      head = (await this.head(tx, command.publicationId))!;
    }
    await sql`UPDATE official_publications SET delivery_mode='STATIC' WHERE id=${command.publicationId}::uuid`.execute(tx);
    assert(head.expires_at.getTime() > now.getTime() && head.safety_expires_at && head.safety_expires_at > now && head.safety_policy_revision === evidence.policyRevision, "PUBLICATION_SAFETY_EXPIRED", 503);
    assert(head.sync_state !== "UNKNOWN" && entry.state === "CONFIRMED" && number(head.generation) === entry.generation && number(head.withdrawn_generation) === entry.withdrawnGeneration && head.withdrawn_source_version === entry.withdrawnSourceVersion && (head.active_generation === null ? null : number(head.active_generation)) === entry.activeGeneration, "INDEPENDENT_PUBLICATION_SAFETY_MISMATCH", 409);
    assert((head.active_artifact_hash ?? null) === entry.activeArtifactHash, "PUBLICATION_HASH_MISMATCH", 409);
    await sql`UPDATE official_static_publication_heads SET verified_generation=${evidence.generation},verified_at=${new Date(evidence.observedAt)},expires_at=least(expires_at,${safetyExpires}),safety_expires_at=least(safety_expires_at,${safetyExpires}) WHERE publication_id=${command.publicationId}::uuid`.execute(tx);
    assert(head.sync_state !== "UNKNOWN", "PUBLICATION_SAFETY_UNRESOLVED", 503);
    assert(number(head.generation) === command.expectedGeneration && head.pending_generation === null, "PUBLICATION_GENERATION_CONFLICT", 409);
    const source = await this.sources.staticSourceInTransaction(tx, command.publicationId, command.expectedSourceRevision, now, command.operation === "PUBLISH");
    assert(!command.expectedContentHash || reviewHash(source) === command.expectedContentHash, "PUBLICATION_REVIEW_CONFLICT", 409);
    if (command.operation === "WITHDRAW") assert(head.active_generation !== null, "PUBLICATION_NOT_PUBLISHED", 409);
    else assert(source.sourceVersion > head.withdrawn_source_version, "PUBLICATION_WITHDRAWN_SOURCE", 409);
    const prior = (await sql<{ generation: string | number }>`SELECT COALESCE(max(generation),0) AS generation FROM official_static_publication_manifests WHERE publication_id=${command.publicationId}::uuid`.execute(tx)).rows[0]!;
    const generation = Math.max(number(prior.generation), number(head.generation), number(head.withdrawn_generation)) + 1;
    z.number().safe().int().positive().parse(generation);
    const payload = command.operation === "PUBLISH" ? prepareAnnouncement(source, generation, now.toISOString()).payload
      : { schemaVersion: 1, type: "WITHDRAWAL", sourceId: source.id, generation, withdrawnAt: now.toISOString() };
    const artifactHash = publicArtifactHash(payload);
    await sql`INSERT INTO official_static_publication_manifests(publication_id,generation,source_version,source_row_revision,previous_generation,operation,schema_version,artifact_hash,state,effect_state,created_at,expires_at)
      VALUES(${command.publicationId}::uuid,${generation},${source.sourceVersion},${command.expectedSourceRevision},${head.generation},${command.operation},1,${artifactHash},'STAGED','PREPARED',${now},${expires})`.execute(tx);
    await sql`UPDATE official_static_publication_heads SET pending_generation=${generation},sync_state='PREPARED',updated_at=${now} WHERE publication_id=${command.publicationId}::uuid`.execute(tx);
    return { publicationId: command.publicationId, generation, artifactHash, state: "PREPARED" as const, published: false as const };
  }
  private async payload(tx: Tx, row: ManifestRow) {
    const source = await this.sources.staticSourceInTransaction(tx, row.publication_id, row.source_row_revision, row.created_at, row.operation === "PUBLISH");
    const value = row.operation === "PUBLISH" ? prepareAnnouncement(source, number(row.generation), row.created_at.toISOString()).payload
      : { schemaVersion: 1, type: "WITHDRAWAL", sourceId: source.id, generation: number(row.generation), withdrawnAt: row.created_at.toISOString() };
    assert(publicArtifactHash(value) === row.artifact_hash, "PUBLICATION_HASH_MISMATCH", 409);
    return value;
  }
  /** Admission commits before the external call. ADMITTED/UNKNOWN generations
   * can only be reconciled read-only, never dispatched for a second time. */
  async dispatch(id: string, generation: number, now = this.currentTime()) {
    const command = (await sql<ManifestRow>`SELECT * FROM official_static_publication_manifests WHERE publication_id=${sourceId.parse(id)}::uuid AND generation=${generation}`.execute(this.db)).rows[0];
    assert(command, "PUBLICATION_MANIFEST_NOT_FOUND", 404);
    await this.permitted(command.operation, id);
    const prepared = await this.db.transaction().execute(async tx => {
      await this.lock(tx);
      const row = await this.manifest(tx, sourceId.parse(id), generation), head = await this.head(tx, id);
      assert(row.operation === command.operation, "PUBLICATION_GENERATION_CONFLICT", 409);
      const { entry, evidence } = this.options.safetyAuthority!.publication(id, undefined, now);
      assert(head && head.expires_at.getTime() > now.getTime() && head.safety_expires_at && head.safety_expires_at > now && head.safety_policy_revision === evidence.policyRevision && row.expires_at.getTime() > now.getTime(), "PUBLICATION_SAFETY_EXPIRED", 503);
      assert(entry.state === "CONFIRMED" && entry.pendingGeneration === null && entry.generation === number(head.generation)
        && entry.withdrawnGeneration === number(head.withdrawn_generation) && entry.withdrawnSourceVersion === head.withdrawn_source_version
        && entry.activeGeneration === (head.active_generation === null ? null : number(head.active_generation))
        && entry.activeArtifactHash === (head.active_artifact_hash ?? null), "INDEPENDENT_PUBLICATION_SAFETY_MISMATCH", 409);
      assert(head.sync_state !== "UNKNOWN", "PUBLICATION_SAFETY_UNRESOLVED", 503);
      assert(head.pending_generation !== null && number(head.pending_generation) === generation && row.effect_state === "PREPARED", "PUBLICATION_REPLAY_REJECTED", 409);
      const payload = await this.payload(tx, row);
      const fresh = this.options.safetyAuthority!.publication(id, undefined, this.currentTime());
      assert(fresh.evidence.policyRevision===evidence.policyRevision&&fresh.entry.state==="CONFIRMED"&&fresh.entry.pendingGeneration===null
        && fresh.entry.generation===entry.generation&&fresh.entry.activeGeneration===entry.activeGeneration&&fresh.entry.activeArtifactHash===entry.activeArtifactHash
        && fresh.entry.withdrawnGeneration===entry.withdrawnGeneration&&fresh.entry.withdrawnSourceVersion===entry.withdrawnSourceVersion,
      "INDEPENDENT_PUBLICATION_SAFETY_MISMATCH",409);
      await sql`UPDATE official_static_publication_manifests SET effect_state='ADMITTED' WHERE publication_id=${id}::uuid AND generation=${generation}`.execute(tx);
      await sql`UPDATE official_static_publication_heads SET sync_state='ADMITTED',updated_at=${now} WHERE publication_id=${id}::uuid`.execute(tx);
      return { row, payload };
    });
    let receipt: StaticPublicationReceipt;
    try { receipt = await this.options.publisher!.switchGeneration({ sourceId: id, previousGeneration: number(prepared.row.previous_generation), generation,
      artifactHash: prepared.row.artifact_hash, payload: prepared.payload, withdraw: prepared.row.operation === "WITHDRAW" }); }
    catch { receipt = { state: "UNKNOWN" }; }
    if (receipt.state !== "CONFIRMED" || receipt.generation !== generation || receipt.artifactHash !== prepared.row.artifact_hash) {
      const state = receipt.state === "NOT_STARTED" ? "NOT_STARTED" : "UNKNOWN";
      await this.recordUnconfirmed(id, generation, state);
      return { state, generation, published: false };
    }
    try { await this.options.safetyAuthority!.observe("PUBLICATION_WITHDRAWAL", null, this.currentTime()); await this.confirm(id, generation, this.currentTime()); }
    catch { await this.recordUnconfirmed(id, generation, "UNKNOWN"); return { state: "UNKNOWN" as const, generation, published: false }; }
    return { state: "CONFIRMED" as const, generation, published: prepared.row.operation === "PUBLISH" };
  }
  private async recordUnconfirmed(id: string, generation: number, state: "NOT_STARTED" | "UNKNOWN") {
    await this.db.transaction().execute(async tx => {
      await this.lock(tx);
      await sql`UPDATE official_static_publication_manifests SET effect_state=${state},state=CASE WHEN ${state}='NOT_STARTED' THEN 'RETIRED' ELSE state END WHERE publication_id=${id}::uuid AND generation=${generation} AND effect_state IN ('ADMITTED','UNKNOWN')`.execute(tx);
      await sql`UPDATE official_static_publication_heads SET sync_state=${state},pending_generation=CASE WHEN ${state}='NOT_STARTED' THEN NULL ELSE pending_generation END,updated_at=clock_timestamp() WHERE publication_id=${id}::uuid AND pending_generation=${generation}`.execute(tx);
    });
  }
  private async confirm(id: string, generation: number, now: Date) {
    await this.db.transaction().execute(async tx => {
      await this.lock(tx);
      const row = await this.manifest(tx, id, generation), head = await this.head(tx, id);
      const { entry, evidence } = this.options.safetyAuthority!.publication(id, undefined, now);
      assert(head && head.pending_generation !== null && number(head.pending_generation) === generation && number(head.generation) === number(row.previous_generation), "PUBLICATION_GENERATION_CONFLICT", 409);
      assert(head.expires_at.getTime() > now.getTime() && head.safety_expires_at && head.safety_expires_at > now && head.safety_policy_revision === evidence.policyRevision && row.expires_at.getTime() > now.getTime(), "PUBLICATION_SAFETY_EXPIRED", 503);
      assert(entry.state === "CONFIRMED" && entry.generation === generation && entry.pendingGeneration === null && entry.activeGeneration === (row.operation === "WITHDRAW" ? null : generation)
        && entry.activeArtifactHash === (row.operation === "WITHDRAW" ? null : row.artifact_hash)
        && (row.operation !== "WITHDRAW" || entry.withdrawnGeneration >= generation && entry.withdrawnSourceVersion >= row.source_version), "INDEPENDENT_PUBLICATION_SAFETY_MISMATCH", 409);
      assert(["ADMITTED", "UNKNOWN"].includes(row.effect_state), "PUBLICATION_REPLAY_REJECTED", 409);
      await this.payload(tx, row);
      await sql`UPDATE official_static_publication_manifests SET state='RETIRED' WHERE publication_id=${id}::uuid AND state='ACTIVE'`.execute(tx);
      await sql`UPDATE official_static_publication_manifests SET state=${row.operation === "WITHDRAW" ? "RETRACTED" : "ACTIVE"},effect_state='CONFIRMED',published_at=${now} WHERE publication_id=${id}::uuid AND generation=${generation}`.execute(tx);
      if (row.operation === "PUBLISH") {
        const changed = await sql`UPDATE official_publications SET revision=revision+1,published_revision=${row.source_version},status='PUBLISHED',first_published_at=COALESCE(first_published_at,${row.created_at}),published_updated_at=${row.created_at},updated_at=${now} WHERE id=${id}::uuid AND revision=${row.source_row_revision} AND edit_revision=${row.source_version} RETURNING id`.execute(tx);
        assert(changed.rows.length === 1, "REVISION_CONFLICT", 409);
      } else {
        const changed = await sql`UPDATE official_publications SET revision=revision+1,status='WITHDRAWN',updated_at=${now} WHERE id=${id}::uuid AND revision=${row.source_row_revision} AND status='PUBLISHED' RETURNING id`.execute(tx);
        assert(changed.rows.length === 1, "REVISION_CONFLICT", 409);
      }
      await sql`UPDATE official_static_publication_heads SET generation=${generation},active_generation=${row.operation === "PUBLISH" ? generation : null},pending_generation=NULL,
        withdrawn_generation=CASE WHEN ${row.operation}='WITHDRAW' THEN ${generation} ELSE withdrawn_generation END,
        withdrawn_source_version=CASE WHEN ${row.operation}='WITHDRAW' THEN greatest(withdrawn_source_version,${row.source_version}) ELSE withdrawn_source_version END,
        sync_state='CONFIRMED',verified_generation=${evidence.generation},verified_at=${new Date(evidence.observedAt)},active_artifact_hash=${entry.activeArtifactHash},updated_at=${now} WHERE publication_id=${id}::uuid`.execute(tx);
    });
  }
  async reconcile(id: string, generation: number) {
    await this.permitted("RECONCILE", id);
    const row = (await sql<ManifestRow>`SELECT * FROM official_static_publication_manifests WHERE publication_id=${id}::uuid AND generation=${generation}`.execute(this.db)).rows[0];
    assert(row && ["ADMITTED", "UNKNOWN"].includes(row.effect_state), "PUBLICATION_RECONCILE_UNAVAILABLE", 409);
    let remote: Awaited<ReturnType<StaticPublisher["readGeneration"]>>;
    try { remote = await this.options.publisher!.readGeneration(id); } catch { remote = null; }
    if (!remote || remote.generation !== generation || remote.artifactHash !== row.artifact_hash || remote.withdrawn !== (row.operation === "WITHDRAW")) return { state: "UNKNOWN" as const, generation };
    await this.options.safetyAuthority!.observe("PUBLICATION_WITHDRAWAL", null, this.currentTime());
    await this.confirm(id, generation, this.currentTime());
    return { state: "CONFIRMED" as const, generation };
  }
  /** Explicit allowlist export of confirmed current PUBLIC revisions only.
   * No draft, legal candidate, contact settings, actor or arbitrary DB column
   * can enter this input. This is preparation, not an external switch. */
  async exportConfirmedPublicInput(input: { officialOrigin: string; appOrigin: string; generation: number; publicationIds: string[] }, now = this.currentTime()) {
    const request = z.object({ officialOrigin: z.string(), appOrigin: z.string(), generation: z.number().safe().int().positive(),
      publicationIds: z.array(sourceId).max(1000) }).strict().parse(input);
    assert(new Set(request.publicationIds).size === request.publicationIds.length, "PUBLICATION_DUPLICATE_SOURCE", 400);
    assert(this.readiness().enabled, "PUBLIC_PUBLISH_UNAVAILABLE", 503);
    for (const id of request.publicationIds) await this.permitted("RECONCILE", id);
    const announcements = await this.db.transaction().execute(async tx => {
      await this.lock(tx);
      const result = [];
      for (const id of request.publicationIds) {
        const head = await this.head(tx, id), { entry } = this.options.safetyAuthority!.publication(id, undefined, this.currentTime());
        assert(head && head.sync_state === "CONFIRMED" && head.pending_generation === null && head.expires_at > now && head.safety_expires_at && head.safety_expires_at > now,
          "PUBLICATION_SAFETY_UNRESOLVED", 503);
        assert(entry.state === "CONFIRMED" && entry.pendingGeneration === null && entry.generation === number(head.generation)
          && entry.activeGeneration === (head.active_generation === null ? null : number(head.active_generation)) && entry.activeArtifactHash === (head.active_artifact_hash ?? null)
          && entry.withdrawnGeneration === number(head.withdrawn_generation) && entry.withdrawnSourceVersion === head.withdrawn_source_version, "INDEPENDENT_PUBLICATION_SAFETY_MISMATCH", 409);
        if (head.active_generation === null) continue;
        const row = await this.manifest(tx, id, number(head.active_generation));
        assert(row.state === "ACTIVE" && row.effect_state === "CONFIRMED" && row.published_at && row.expires_at > now && row.artifact_hash === entry.activeArtifactHash, "PUBLICATION_ARTIFACT_UNAVAILABLE", 409);
        const current = (await sql<{ revision: number; status: string; published_revision: number }>`SELECT revision,status,published_revision FROM official_publications WHERE id=${id}::uuid`.execute(tx)).rows[0];
        assert(current?.status === "PUBLISHED" && current.published_revision === row.source_version, "PUBLICATION_ARTIFACT_UNAVAILABLE", 409);
        const source = await this.sources.staticSourceInTransaction(tx, id, current.revision, row.created_at, false);
        assert(prepareAnnouncement(source, number(row.generation), row.created_at.toISOString()).manifest.artifactHash === row.artifact_hash, "PUBLICATION_HASH_MISMATCH", 409);
        result.push({ source, manifest: { schemaVersion: 1 as const, type: "ANNOUNCEMENT" as const, sourceId: id, sourceVersion: row.source_version,
          generation: number(row.generation), artifactHash: row.artifact_hash, state: "ACTIVE" as const, createdAt: row.created_at.toISOString(), publishedAt: row.published_at.toISOString() } });
      }
      return result;
    });
    return officialStaticInputSchema.parse({ schemaVersion: 1, generation: request.generation, generatedAt: now.toISOString(), officialOrigin: request.officialOrigin,
      appOrigin: request.appOrigin, announcements, status: null, legal: [], contact: { state: "UNAVAILABLE", messageCode: "CONTACT_OPERATIONS_NOT_APPROVED" } });
  }
  /** Prepared local artifact bytes are not publication success. */
  async preparedArtifact(id: string, generation: number) {
    return this.db.transaction().execute(async tx => {
      await this.lock(tx); const row = await this.manifest(tx, sourceId.parse(id), generation);
      const head = await this.head(tx, id);
      assert(head && head.sync_state !== "UNKNOWN" && head.expires_at.getTime() > Date.now() && head.safety_expires_at && head.safety_expires_at.getTime() > Date.now(), "PUBLICATION_ARTIFACT_UNAVAILABLE", 409);
      assert(row.effect_state === "PREPARED" && row.expires_at.getTime() > Date.now(), "PUBLICATION_ARTIFACT_UNAVAILABLE", 409);
      return canonicalPublicJson(await this.payload(tx, row));
    });
  }
}
