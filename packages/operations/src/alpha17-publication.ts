import { z } from "zod";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  activatePublication, buildOfficialStatic, canonicalPublicJson, officialStaticInputSchema,
  prepareAnnouncement, publicAnnouncementSourceSchema, publicArtifactHash, publicationHeadSchema, withdrawPublication,
  type OfficialStaticInput, type PublicationHead, type PublicAnnouncementSource,
} from "../../presentation/src/alpha16-publication";
import type { StaticPublicationReceipt, StaticPublisher } from "./alpha16-publication";

const generation = z.number().safe().int().nonnegative();
const publicFields = publicAnnouncementSourceSchema.shape;
const announcement = z.object({ schemaVersion: z.literal(1), announcementId: z.uuid(), generation: generation.refine(value => value > 0),
  sourceVersion: publicFields.sourceVersion, category: publicFields.category, incidentStatus: publicFields.incidentStatus,
  ja: publicFields.ja, en: publicFields.en, publishedAt: publicFields.publishedAt, updatedAt: publicFields.updatedAt }).strict();
const withdrawal = z.object({ schemaVersion: z.literal(1), type: z.literal("WITHDRAWAL"), sourceId: z.uuid(),
  generation: generation.refine(value => value > 0), withdrawnAt: z.iso.datetime() }).strict();
const snapshotSchema = z.object({ schemaVersion: z.literal(1), revision: generation, observedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(), publications: z.array(z.object({ head: publicationHeadSchema,
    source: publicAnnouncementSourceSchema.nullable(), receiptHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict()).max(1000) }).strict();
export type AtomicPublicationSnapshot = z.infer<typeof snapshotSchema>;
export type AtomicPublicationBundle = { snapshot: AtomicPublicationSnapshot; files: Record<string, string> };
export type StaticSiteContext = Pick<OfficialStaticInput, "officialOrigin" | "appOrigin">;

/** Trusted code adapter, never constructed from an Operator request or a JSON
 * capability flag. readPublic must independently read the publicly routed
 * generation (including no-store/expiry enforcement), not echo the upload.
 * All routes and manifest resolve through one atomically switched root. */
export interface AtomicPublicationHost {
  readonly deployment: "LOCAL_FIXTURE" | "REMOTE";
  readPublic(): Promise<AtomicPublicationBundle>;
  stageImmutable(bundle: AtomicPublicationBundle): Promise<string>;
  readStaged(key: string): Promise<AtomicPublicationBundle>;
  compareAndSwitch(expectedRevision: number, stagedKey: string): Promise<"CONFIRMED" | "CONFLICT" | "UNKNOWN">;
  /** A disposable, disjoint private test namespace with the SAME routing,
   * conditional switch, expiry and cache code as this host. */
  isolatedProbe(initial: AtomicPublicationBundle): Promise<{ host: AtomicPublicationHost; dispose(): Promise<void> }>;
}
export type AtomicHostProof = Readonly<{ deployment: "LOCAL_FIXTURE" | "REMOTE"; expiresAt: number }>;
const proofs = new WeakMap<AtomicHostProof, AtomicPublicationHost>();
const capable = Object.freeze({ atomicSwitch: true, conditionalGeneration: true, readBackHash: true, routeWithdrawal: true, cacheBehaviorVerified: true });
const closed = Object.freeze({ atomicSwitch: false, conditionalGeneration: false, readBackHash: false, routeWithdrawal: false, cacheBehaviorVerified: false });
function requireValue(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
function checkedSnapshot(input: unknown, now: number) {
  const data = snapshotSchema.parse(input);
  requireValue(Number.isFinite(now) && Date.parse(data.observedAt) <= now && Date.parse(data.expiresAt) > now && Date.parse(data.expiresAt) > Date.parse(data.observedAt), "PUBLICATION_HOST_EXPIRED");
  requireValue(new Set(data.publications.map(item => item.head.sourceId)).size === data.publications.length, "PUBLICATION_HOST_DUPLICATE_SOURCE");
  for (const item of data.publications) {
    requireValue(item.head.type === "ANNOUNCEMENT" && (item.head.active !== null) === (item.source !== null), "PUBLICATION_HOST_SOURCE_MISMATCH");
    requireValue(item.head.generation === 0 ? item.receiptHash === null : item.receiptHash !== null, "PUBLICATION_HOST_RECEIPT_MISSING");
    if (item.source) {
      requireValue(item.receiptHash === item.head.active!.artifactHash, "PUBLICATION_HASH_MISMATCH");
      requireValue(item.head.sourceId === item.source.id, "PUBLICATION_HOST_SOURCE_MISMATCH");
      const prepared = prepareAnnouncement(item.source, item.head.active!.generation, item.head.active!.createdAt);
      requireValue(prepared.manifest.artifactHash === item.head.active!.artifactHash && item.head.active!.sourceVersion === item.source.sourceVersion, "PUBLICATION_HASH_MISMATCH");
    }
  }
  return data;
}
/** Public projection only. Legal candidates, contacts, private health and billing
 * are deliberately absent; a future approved exporter must provide its own
 * reviewed provenance, not merely an APPROVED_PUBLIC string. */
export function buildAnnouncementBundle(input: AtomicPublicationSnapshot, context: StaticSiteContext, now: number): AtomicPublicationBundle {
  const snapshot = checkedSnapshot(input, now);
  const data = officialStaticInputSchema.parse({ schemaVersion: 1, generation: snapshot.revision || 1, generatedAt: new Date(now).toISOString(),
    ...context, announcements: snapshot.publications.filter(item => item.source !== null).map(item => ({ source: item.source, manifest: item.head.active })),
    status: null, legal: [], contact: { state: "UNAVAILABLE", messageCode: "CONTACT_OPERATIONS_NOT_APPROVED" } });
  return { snapshot, files: buildOfficialStatic(data, now).files };
}
function checkedBundle(input: AtomicPublicationBundle, now: number): AtomicPublicationBundle {
  const snapshot = checkedSnapshot(input.snapshot, now);
  requireValue(input.files && typeof input.files === "object", "PUBLICATION_HOST_BUNDLE_INVALID");
  const manifest = z.object({ schemaVersion: z.literal(1), generation: generation, generatedAt: z.iso.datetime(),
    files: z.array(z.object({ path: z.string().regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9_./-]+$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).max(10000) }).strict().parse(JSON.parse(input.files["manifest.json"] ?? "null"));
  requireValue(manifest.generation === (snapshot.revision || 1), "PUBLICATION_HOST_GENERATION_MISMATCH");
  const names = manifest.files.map(item => item.path);
  requireValue(new Set(names).size === names.length && Object.keys(input.files).length === names.length + 1 && !names.includes("manifest.json"), "PUBLICATION_HOST_BUNDLE_INVALID");
  for (const item of manifest.files) {
    requireValue(typeof input.files[item.path] === "string", "PUBLICATION_HOST_BUNDLE_INVALID");
    // Manifest hashes are byte hashes, not canonical JSON hashes.
    requireValue(sha256(input.files[item.path]!) === item.sha256, "PUBLICATION_HASH_MISMATCH");
  }
  return { snapshot, files: input.files };
}
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function sameBundle(a: AtomicPublicationBundle, b: AtomicPublicationBundle) {
  return publicArtifactHash(a) === publicArtifactHash(b);
}

/** Verify real behavior in a disposable namespace. This proof is process-local,
 * finite, host-bound and cannot be loaded from config/backups. No implementation
 * for the unverified Onamae host is registered by alpha17. */
export async function verifyAtomicPublicationHost(host: AtomicPublicationHost, context: StaticSiteContext): Promise<AtomicHostProof> {
  const now = Date.now();
  const id = "11111111-1111-4111-8111-111111111111", time = new Date(now).toISOString();
  const initial = buildAnnouncementBundle({ schemaVersion: 1, revision: 0, observedAt: time, expiresAt: new Date(now + 1000).toISOString(), publications: [{ head: { type: "ANNOUNCEMENT", sourceId: id, generation: 0, active: null, withdrawnGeneration: 0, withdrawnSourceVersion: 0 }, source: null, receiptHash: null }] }, context, now);
  const probe = await host.isolatedProbe(initial);
  try {
    requireValue(probe.host !== host && probe.host.deployment === host.deployment, "PUBLICATION_PROBE_NOT_ISOLATED");
    requireValue(sameBundle(checkedBundle(await probe.host.readPublic(), now), initial), "PUBLICATION_PROBE_READBACK_FAILED");
    const source: PublicAnnouncementSource = { scope: "PUBLIC", id, sourceVersion: 1, category: "UPDATE", incidentStatus: "NONE", ja: { title: "Synthetic probe", summary: "Probe only", body: "Public synthetic probe" }, en: null, publishedAt: time, updatedAt: time };
    const prepared = prepareAnnouncement(source, 1, time), head = activatePublication(initial.snapshot.publications[0]!.head, prepared.manifest, prepared.payload, 0, time);
    const published = buildAnnouncementBundle({ ...initial.snapshot, revision: 1, observedAt: time, publications: [{ head, source, receiptHash: prepared.manifest.artifactHash }] }, context, now);
    const staged = await probe.host.stageImmutable(published);
    requireValue(sameBundle(checkedBundle(await probe.host.readStaged(staged), now), published), "PUBLICATION_PROBE_READBACK_FAILED");
    requireValue(sameBundle(await probe.host.readPublic(), initial), "PUBLICATION_PROBE_STAGE_VISIBLE");
    const race = await Promise.all([probe.host.compareAndSwitch(0, staged), probe.host.compareAndSwitch(0, staged)]);
    requireValue(race.filter(value => value === "CONFIRMED").length === 1 && race.filter(value => value === "CONFLICT").length === 1, "PUBLICATION_PROBE_CAS_FAILED");
    requireValue(sameBundle(checkedBundle(await probe.host.readPublic(), now), published), "PUBLICATION_PROBE_PUBLIC_READBACK_FAILED");
    const removalResult = withdrawPublication(head, 1, 2, time), withdrawnHead = removalResult.head;
    const withdrawn = buildAnnouncementBundle({ ...initial.snapshot, revision: 2, observedAt: time, publications: [{ head: withdrawnHead, source: null, receiptHash: removalResult.manifest.artifactHash }] }, context, now);
    const removal = await probe.host.stageImmutable(withdrawn);
    requireValue(sameBundle(await probe.host.readStaged(removal), withdrawn) && await probe.host.compareAndSwitch(1, removal) === "CONFIRMED", "PUBLICATION_PROBE_WITHDRAWAL_FAILED");
    const after = checkedBundle(await probe.host.readPublic(), now);
    requireValue(sameBundle(after, withdrawn) && !Object.keys(after.files).some(path => /^announcements\/.+\//.test(path)), "PUBLICATION_PROBE_WITHDRAWAL_FAILED");
    // The adapter must exercise its independently expiring public route and all
    // cache layers here; returning a cached bundle after expiry fails the proof.
    const expired = { ...withdrawn, snapshot: { ...withdrawn.snapshot, revision: 3, expiresAt: new Date(now - 1).toISOString() } };
    const expiredKey = await probe.host.stageImmutable(expired);
    requireValue(await probe.host.compareAndSwitch(2, expiredKey) === "CONFLICT", "PUBLICATION_PROBE_EXPIRY_FAILED");
    await delay(Math.max(0, Date.parse(initial.snapshot.expiresAt) - Date.now()) + 5);
    let denied = false;
    try { await probe.host.readPublic(); } catch { denied = true; }
    requireValue(denied, "PUBLICATION_PROBE_PUBLIC_EXPIRY_FAILED");
  } finally { await probe.dispose(); }
  const proof = Object.freeze({ deployment: host.deployment, expiresAt: now + 60000 });
  proofs.set(proof, host); return proof;
}

/** Full generation pipeline. It never retries an admitted switch. A transport
 * that can only upload files cannot implement this host interface and cannot
 * acquire a proof. LOCAL_FIXTURE proof is intentionally not a remote approval. */
export class AtomicStaticPublisher implements StaticPublisher {
  constructor(private readonly host: AtomicPublicationHost, private readonly proof: AtomicHostProof,
    private readonly context: StaticSiteContext, private readonly now: () => number = Date.now) {}
  get capability() { return proofs.get(this.proof) === this.host && this.proof.expiresAt > this.now() ? capable : closed; }
  async switchGeneration(input: Parameters<StaticPublisher["switchGeneration"]>[0]): Promise<StaticPublicationReceipt> {
    let admitted = false;
    try {
      requireValue(this.capability.atomicSwitch, "PUBLICATION_HOST_UNVERIFIED");
      z.uuid().parse(input.sourceId); generation.parse(input.previousGeneration); generation.refine(value => value > input.previousGeneration).parse(input.generation);
      requireValue(publicArtifactHash(input.payload) === input.artifactHash, "PUBLICATION_HASH_MISMATCH");
      const before = checkedBundle(await this.host.readPublic(), this.now());
      // This first adapter owns an announcement-only template. It must never
      // replace an existing site's legal/status/pricing/release or other routes
      // merely because those bytes passed a manifest hash check.
      const generatedAt = z.iso.datetime().parse(JSON.parse(before.files["manifest.json"]!).generatedAt);
      requireValue(sameBundle(before, buildAnnouncementBundle(before.snapshot, this.context, Date.parse(generatedAt))), "PUBLICATION_SITE_BASE_UNSUPPORTED");
      const selected = before.snapshot.publications.find(item => item.head.sourceId === input.sourceId);
      // Missing remote roots never imply an empty generation zero.
      requireValue(selected && selected.head.generation === input.previousGeneration, "PUBLICATION_GENERATION_CONFLICT");
      let head: PublicationHead, source: PublicAnnouncementSource | null;
      if (input.withdraw) {
        const payload = withdrawal.parse(input.payload);
        requireValue(payload.sourceId === input.sourceId && payload.generation === input.generation, "PUBLICATION_SOURCE_CONFLICT");
        const removed = withdrawPublication(selected.head, input.previousGeneration, input.generation, payload.withdrawnAt);
        requireValue(removed.manifest.artifactHash === input.artifactHash, "PUBLICATION_HASH_MISMATCH");
        head = removed.head; source = null;
      } else {
        const payload = announcement.parse(input.payload);
        requireValue(payload.announcementId === input.sourceId && payload.generation === input.generation, "PUBLICATION_SOURCE_CONFLICT");
        source = publicAnnouncementSourceSchema.parse({ scope: "PUBLIC", id: payload.announcementId, sourceVersion: payload.sourceVersion,
          category: payload.category, incidentStatus: payload.incidentStatus, ja: payload.ja, en: payload.en, publishedAt: payload.publishedAt, updatedAt: payload.updatedAt });
        const prepared = prepareAnnouncement(source, input.generation, new Date(this.now()).toISOString());
        head = activatePublication(selected.head, prepared.manifest, payload, input.previousGeneration, new Date(this.now()).toISOString());
      }
      const next = buildAnnouncementBundle({ ...before.snapshot, revision: before.snapshot.revision + 1, observedAt: new Date(this.now()).toISOString(),
        publications: before.snapshot.publications.map(item => item.head.sourceId === input.sourceId ? { head, source, receiptHash: input.artifactHash } : item) }, this.context, this.now());
      const key = await this.host.stageImmutable(next);
      requireValue(sameBundle(checkedBundle(await this.host.readStaged(key), this.now()), next), "PUBLICATION_HASH_MISMATCH");
      requireValue(this.capability.atomicSwitch, "PUBLICATION_HOST_UNVERIFIED");
      admitted = true;
      const switched = await this.host.compareAndSwitch(before.snapshot.revision, key);
      if (switched === "CONFLICT") return { state: "NOT_STARTED" };
      if (switched !== "CONFIRMED") return { state: "UNKNOWN" };
      requireValue(sameBundle(checkedBundle(await this.host.readPublic(), this.now()), next), "PUBLICATION_PUBLIC_READBACK_FAILED");
      return { state: "CONFIRMED", generation: input.generation, artifactHash: input.artifactHash };
    } catch { return { state: admitted ? "UNKNOWN" : "NOT_STARTED" }; }
  }
  async readGeneration(sourceId: string) {
    z.uuid().parse(sourceId);
    requireValue(this.capability.atomicSwitch, "PUBLICATION_HOST_UNVERIFIED");
    const current = checkedBundle(await this.host.readPublic(), this.now());
    const entry = current.snapshot.publications.find(item => item.head.sourceId === sourceId);
    if (!entry || !entry.head.generation) return null;
    if (entry.head.active) return { generation: entry.head.generation, artifactHash: entry.head.active.artifactHash, withdrawn: false };
    // A withdrawn receipt retains only its exact public hash, never body history.
    return { generation: entry.head.generation, artifactHash: entry.receiptHash!, withdrawn: true };
  }
}

/** An encrypted file transfer alone never establishes route/CAS/cache support.
 * No staging or public mutation occurs through this publisher. */
export class UnverifiedHostingPublisher implements StaticPublisher {
  readonly capability = closed;
  async switchGeneration(): Promise<StaticPublicationReceipt> { return { state: "NOT_STARTED" }; }
  async readGeneration() { return null; }
}
export const atomicBundleFingerprint = (bundle: AtomicPublicationBundle) => sha256(canonicalPublicJson(bundle));

/** Read independent current publication roots directly from an external atomic
 * host. A local fixture/backup/config file cannot be promoted to this provider.
 * The remote deadline is preserved; reads never renew retention. */
export function atomicPublicationSafetyProvider(host: AtomicPublicationHost, proof: AtomicHostProof, policyRevision: string,
  now: () => number = Date.now): import("../../security/src/alpha16-safety-state").IndependentSafetyProvider {
  z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/).parse(policyRevision);
  return async (kind, scope) => {
    requireValue(kind === "PUBLICATION_WITHDRAWAL" && scope === null && host.deployment === "REMOTE"
      && proofs.get(proof) === host && proof.expiresAt > now(), "INDEPENDENT_PUBLICATION_HOST_UNVERIFIED");
    const bundle = checkedBundle(await host.readPublic(), now());
    return { kind: "PUBLICATION_WITHDRAWAL", scope: null, generation: `site-${bundle.snapshot.revision}-${atomicBundleFingerprint(bundle).slice(0, 24)}`,
      independent: true, complete: true, policyRevision, observedAt: bundle.snapshot.observedAt, expiresAt: bundle.snapshot.expiresAt,
      publications: bundle.snapshot.publications.map(({ head }) => ({ publicationId: head.sourceId, generation: head.generation,
        activeGeneration: head.active?.generation ?? null, activeArtifactHash: head.active?.artifactHash ?? null, pendingGeneration: null,
        withdrawnGeneration: head.withdrawnGeneration, withdrawnSourceVersion: head.withdrawnSourceVersion, state: "CONFIRMED", expiresAt: bundle.snapshot.expiresAt })) };
  };
}
