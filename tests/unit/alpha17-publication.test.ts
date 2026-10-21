import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AtomicStaticPublisher, atomicBundleFingerprint, atomicPublicationSafetyProvider, buildAnnouncementBundle, UnverifiedHostingPublisher, verifyAtomicPublicationHost,
  type AtomicHostProof, type AtomicPublicationBundle, type AtomicPublicationHost } from "../../packages/operations/src/alpha17-publication";
import { emptyPublicationHead, prepareAnnouncement, publicArtifactHash } from "../../packages/presentation/src/alpha16-publication";

const id = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const context = { officialOrigin: "https://www.nexus.example", appOrigin: "https://app.nexus.example" };
/** Memory fixture proves only this local routing implementation. It is not an
 * adapter, credential, capability assertion or deployment for an external host. */
class LocalFixtureHost implements AtomicPublicationHost {
  readonly deployment = "LOCAL_FIXTURE" as const;
  private active: AtomicPublicationBundle;
  private stages = new Map<string, AtomicPublicationBundle>();
  switches = 0;
  publicReads = 0;
  loseAck = false;
  corruptStage = false;
  staleCache = false;
  constructor(initial: AtomicPublicationBundle) { this.active = structuredClone(initial); }
  async readPublic() {
    this.publicReads++;
    if (Date.parse(this.active.snapshot.expiresAt) <= Date.now()) throw new Error("EXPIRED");
    return structuredClone(this.active);
  }
  async stageImmutable(bundle: AtomicPublicationBundle) {
    const key = atomicBundleFingerprint(bundle);
    if (!this.stages.has(key)) this.stages.set(key, structuredClone(bundle));
    return key;
  }
  async readStaged(key: string) {
    const result = structuredClone(this.stages.get(key)!);
    if (this.corruptStage) result.files["index.html"] += "changed";
    return result;
  }
  async compareAndSwitch(expectedRevision: number, stagedKey: string) {
    this.switches++;
    const next = this.stages.get(stagedKey)!;
    if (this.active.snapshot.revision !== expectedRevision || Date.parse(this.active.snapshot.expiresAt) <= Date.now()
      || Date.parse(next.snapshot.expiresAt) <= Date.now() || next.snapshot.revision !== expectedRevision + 1) return "CONFLICT" as const;
    if (!this.staleCache) this.active = structuredClone(next);
    if (this.loseAck) throw new Error("ACK_LOST_AFTER_SWITCH");
    return "CONFIRMED" as const;
  }
  async isolatedProbe(initial: AtomicPublicationBundle) {
    const host = new LocalFixtureHost(initial);
    host.staleCache = this.staleCache;
    return { host, dispose: async () => { host.stages.clear(); } };
  }
}
function initial() {
  return buildAnnouncementBundle({ schemaVersion: 1, revision: 0, observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120000).toISOString(),
    publications: [id, other].map(sourceId => ({ head: emptyPublicationHead("ANNOUNCEMENT", sourceId), source: null, receiptHash: null })) }, context, Date.now());
}
function publication(sourceId = id, sourceVersion = 1, generation = 1, previousGeneration = 0) {
  const time = new Date().toISOString(), source = { scope: "PUBLIC" as const, id: sourceId, sourceVersion, category: "UPDATE" as const, incidentStatus: "NONE" as const,
    ja: { title: "Reviewed synthetic update", summary: "No real data", body: "Synthetic public-only fixture." }, en: null, publishedAt: time, updatedAt: time };
  const prepared = prepareAnnouncement(source, generation, time);
  return { sourceId, previousGeneration, generation, payload: prepared.payload, artifactHash: prepared.manifest.artifactHash, withdraw: false };
}
async function fixture() {
  const host = new LocalFixtureHost(initial()), proof = await verifyAtomicPublicationHost(host, context);
  return { host, proof, publisher: new AtomicStaticPublisher(host, proof, context) };
}

describe("alpha17 public generation pipeline (local fixture only)", () => {
  it("requires a process-local host-bound proof, never a serialized capability flag", async () => {
    const host = new LocalFixtureHost(initial());
    const forged = { deployment: "LOCAL_FIXTURE", expiresAt: Date.now() + 60000 } as AtomicHostProof;
    const publisher = new AtomicStaticPublisher(host, forged, context);
    expect(publisher.capability.atomicSwitch).toBe(false);
    expect(await publisher.switchGeneration(publication())).toEqual({ state: "NOT_STARTED" });
    expect(host.publicReads).toBe(0);
    const remote = new UnverifiedHostingPublisher();
    expect(await remote.switchGeneration()).toEqual({ state: "NOT_STARTED" });
    expect(remote.capability.atomicSwitch).toBe(false);
  });
  it("publishes one immutable generation and atomically removes all old routes on withdrawal", async () => {
    const { host, publisher } = await fixture(), publish = publication();
    expect(await publisher.switchGeneration(publish)).toEqual({ state: "CONFIRMED", generation: 1, artifactHash: publish.artifactHash });
    const active = await host.readPublic();
    expect(Object.keys(active.files).some(path => /^announcements\/.+\/index.html$/.test(path))).toBe(true);
    expect(await publisher.readGeneration(id)).toEqual({ generation: 1, artifactHash: publish.artifactHash, withdrawn: false });
    const payload = { schemaVersion: 1, type: "WITHDRAWAL", sourceId: id, generation: 2, withdrawnAt: new Date().toISOString() };
    const remove = { sourceId: id, previousGeneration: 1, generation: 2, artifactHash: publicArtifactHash(payload), payload, withdraw: true };
    expect(await publisher.switchGeneration(remove)).toEqual({ state: "CONFIRMED", generation: 2, artifactHash: remove.artifactHash });
    expect(await publisher.readGeneration(id)).toEqual({ generation: 2, artifactHash: remove.artifactHash, withdrawn: true });
    const after = await host.readPublic();
    expect(Object.keys(after.files).filter(path => path.startsWith("announcements/"))).toEqual(["announcements/index.html"]);
    expect(after.files["announcements/index.html"]).not.toContain("Reviewed synthetic update");
    expect(after.snapshot.publications.find(item => item.head.sourceId === id)?.source).toBeNull();
    expect(await publisher.switchGeneration(publication(id, 1, 3, 2))).toEqual({ state: "NOT_STARTED" });
    expect((await publisher.switchGeneration(publication(id, 2, 3, 2))).state).toBe("CONFIRMED");
  });
  it("does not switch after hash tampering, private fields or an absent generation root", async () => {
    const { host, publisher } = await fixture();
    const input = publication();
    expect(await publisher.switchGeneration({ ...input, payload: { ...input.payload, guildId: "private" }, artifactHash: publicArtifactHash({ ...input.payload, guildId: "private" }) })).toEqual({ state: "NOT_STARTED" });
    expect(await publisher.switchGeneration({ ...publication("33333333-3333-4333-8333-333333333333") })).toEqual({ state: "NOT_STARTED" });
    host.corruptStage = true;
    expect(await publisher.switchGeneration(input)).toEqual({ state: "NOT_STARTED" });
    expect(host.switches).toBe(0);
  });
  it("compares the complete site root so concurrent changes cannot lose another announcement", async () => {
    const { host, publisher } = await fixture();
    const results = await Promise.all([publisher.switchGeneration(publication()), publisher.switchGeneration(publication(other))]);
    expect(results.filter(result => result.state === "CONFIRMED")).toHaveLength(1);
    expect(results.filter(result => result.state === "NOT_STARTED")).toHaveLength(1);
    expect((await host.readPublic()).snapshot.publications.filter(item => item.source)).toHaveLength(1);
  });
  it("classifies lost acknowledgement as UNKNOWN and only reads when reconciling", async () => {
    const { host, publisher } = await fixture(), input = publication();
    host.loseAck = true;
    expect(await publisher.switchGeneration(input)).toEqual({ state: "UNKNOWN" });
    const switches = host.switches;
    expect(await publisher.readGeneration(id)).toEqual({ generation: 1, artifactHash: input.artifactHash, withdrawn: false });
    expect(host.switches).toBe(switches);
  });
  it("expires capability proofs and rejects a host that serves a stale generation", async () => {
    const { host, proof } = await fixture();
    const expired = new AtomicStaticPublisher(host, proof, context, () => proof.expiresAt);
    expect(expired.capability.atomicSwitch).toBe(false);
    expect(await expired.switchGeneration(publication())).toEqual({ state: "NOT_STARTED" });
    const caching = new LocalFixtureHost(initial()); caching.staleCache = true;
    await expect(verifyAtomicPublicationHost(caching, context)).rejects.toThrow("PUBLICATION_PROBE_CAS_FAILED");
  });
  it("stops before replacing an existing legal route or unknown public metadata", async () => {
    const original = initial(), path = "legal/terms/ja/index.html";
    original.files[path] = "Reviewed existing legal content must be preserved";
    const manifest = JSON.parse(original.files["manifest.json"]!);
    manifest.files.push({ path, sha256: createHash("sha256").update(original.files[path]).digest("hex") });
    original.files["manifest.json"] = JSON.stringify(manifest);
    const host = new LocalFixtureHost(original), proof = await verifyAtomicPublicationHost(host, context);
    const publisher = new AtomicStaticPublisher(host, proof, context);
    expect(await publisher.switchGeneration(publication())).toEqual({ state: "NOT_STARTED" });
    expect(host.switches).toBe(0);
    expect((await host.readPublic()).files[path]).toBe(original.files[path]);
  });
  it("never promotes a local fixture into an independent production safety authority", async () => {
    const { host, proof } = await fixture();
    const provider = atomicPublicationSafetyProvider(host, proof, "fixture-only");
    await expect(provider("PUBLICATION_WITHDRAWAL", null)).rejects.toThrow("INDEPENDENT_PUBLICATION_HOST_UNVERIFIED");
  });
  it("never includes legal candidates, contact submissions or private state in generated bundles", () => {
    const result = initial();
    expect(Object.keys(result.files).some(path => /^(?:legal|operator|api|dashboard|\.env|_next)\//.test(path))).toBe(false);
    expect(result.files["index.html"]).not.toContain("<form");
    expect(Object.keys(result.snapshot)).toEqual(["schemaVersion", "revision", "observedAt", "expiresAt", "publications"]);
  });
});
