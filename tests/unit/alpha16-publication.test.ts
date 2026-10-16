import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  activatePublication, buildOfficialStatic, contactUnavailable, effectivePublicStatus,
  emptyPublicationHead, officialStaticInputSchema, prepareAnnouncement, publicationReadiness,
  publicAnnouncementSourceSchema, publicStatusSnapshotSchema, withdrawPublication,
  type PublicStatusSnapshot,
} from "../../packages/presentation/src/alpha16-publication";
import { StaticPublications } from "../../packages/operations/src/alpha16-publication";
import type { Database } from "../../packages/db/src/index";

const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-10-16T12:00:00.000Z", until = "2026-10-16T12:05:00.000Z";
const source = { scope: "PUBLIC" as const, id, sourceVersion: 1, category: "UPDATE" as const, incidentStatus: "NONE" as const,
  ja: { title: "更新のお知らせ", summary: "公開内容だけを掲載します。", body: "# 変更\n\n**確認済み**の更新です。" },
  en: { title: "Service update", summary: "Public content only.", body: "# Changes\n\nA **reviewed** update." }, publishedAt: now, updatedAt: now };
const snapshot: PublicStatusSnapshot = { schemaVersion: 1, snapshotVersion: 1, generatedAt: now, validUntil: until, quality: "FRESH", observationSource: "COMBINED",
  components: { pc: { state: "OK", observedAt: now }, tunnel: { state: "OK", observedAt: now }, worker: { state: "OK", observedAt: now }, discordOutbound: { state: "OK", observedAt: now } } };
function bundle() {
  const staged = prepareAnnouncement(source, 1, now);
  const head = activatePublication(emptyPublicationHead("ANNOUNCEMENT", id), staged.manifest, staged.payload, 0, now);
  return { schemaVersion: 1 as const, generation: 1, generatedAt: now, officialOrigin: "https://www.nexus.example", appOrigin: "https://app.nexus.example",
    announcements: [{ source, manifest: head.active! }], status: snapshot, legal: [], contact: contactUnavailable };
}

describe("alpha16 public-only static publication", () => {
  it("rejects private fields, internal scope and unreviewed legal/contact state", () => {
    for (const input of [{ ...source, guildId: "222222222222222222" }, { ...source, scope: "INTERNAL" }, { ...source, credential: "fixture-only" }]) expect(publicAnnouncementSourceSchema.safeParse(input).success).toBe(false);
    expect(officialStaticInputSchema.safeParse({ ...bundle(), contact: { state: "ACCEPTING" } }).success).toBe(false);
    expect(officialStaticInputSchema.safeParse({ ...bundle(), legal: [{ document: "terms", locale: "ja", version: "1", effectiveDate: "2026-10-16", title: "Terms", body: "Pending", approval: "DRAFT" }] }).success).toBe(false);
  });
  it("preserves immutable generations and rejects stale/hash/source conflicts", () => {
    const prepared = prepareAnnouncement(source, 1, now), head = activatePublication(emptyPublicationHead("ANNOUNCEMENT", id), prepared.manifest, prepared.payload, 0, now);
    expect(head.active?.state).toBe("ACTIVE");
    expect(() => activatePublication(head, prepared.manifest, prepared.payload, 0, now)).toThrow("GENERATION_CONFLICT");
    expect(() => activatePublication(emptyPublicationHead("ANNOUNCEMENT", id), prepared.manifest, { ...prepared.payload, ja: { ...source.ja, title: "Changed" } }, 0, now)).toThrow("HASH_MISMATCH");
    expect(() => activatePublication(emptyPublicationHead("ANNOUNCEMENT", "other"), prepared.manifest, prepared.payload, 0, now)).toThrow("SOURCE_CONFLICT");
  });
  it("blocks old jobs and unchanged withdrawn content even under a newer generation", () => {
    const prepared = prepareAnnouncement(source, 1, now), active = activatePublication(emptyPublicationHead("ANNOUNCEMENT", id), prepared.manifest, prepared.payload, 0, now);
    const withdrawn = withdrawPublication(active, 1, 2, now);
    expect(withdrawn.head.active).toBeNull(); expect(withdrawn.manifest.state).toBe("RETRACTED");
    expect(() => activatePublication(withdrawn.head, prepared.manifest, prepared.payload, 2, now)).toThrow("STALE_GENERATION");
    const old = prepareAnnouncement(source, 3, now);
    expect(() => activatePublication(withdrawn.head, old.manifest, old.payload, 2, now)).toThrow("WITHDRAWN_SOURCE");
    const revised = prepareAnnouncement({ ...source, sourceVersion: 2 }, 3, now);
    expect(activatePublication(withdrawn.head, revised.manifest, revised.payload, 2, now).generation).toBe(3);
  });
  it("produces bilingual files, public-only hashes and no server application", () => {
    const result = buildOfficialStatic(bundle(), Date.parse(now));
    expect(result.readiness.enabled).toBe(false);
    expect(Object.keys(result.files).some(path => /announcements\/.+\/en\/index.html$/.test(path))).toBe(true);
    for (const item of result.manifest.files) expect(createHash("sha256").update(result.files[item.path]!).digest("hex")).toBe(item.sha256);
    expect(result.files["index.html"]).toContain("現在このサイトから送信できません");
    expect(result.files["index.html"]).not.toContain("<form");
    expect(Object.keys(result.files).some(path => /(?:auth|dashboard|operator|api|\.env|_next)/.test(path))).toBe(false);
    expect(result.files["index.html"]).toContain("https://app.nexus.example/auth/login");
    expect(result.files["index.html"]).toContain("公開の承認待ち");
  });
  it("omits withdrawn routes and canonical index entries", () => {
    const data = bundle(); data.announcements[0]!.manifest = { ...data.announcements[0]!.manifest, state: "RETRACTED" };
    const result = buildOfficialStatic(data, Date.parse(now));
    expect(Object.keys(result.files).filter(path => path.startsWith("announcements/"))).toEqual(["announcements/index.html"]);
    expect(result.files["announcements/index.html"]).toContain("No published announcements");
  });
  it("escapes public text and does not execute arbitrary HTML or scripts", () => {
    const data = bundle(), altered = { ...source, ja: { ...source.ja, title: "<script>unsafe()</script>", body: "<img src=x onerror=unsafe()>" } };
    const prepared = prepareAnnouncement(altered, 1, now);
    data.announcements = [{ source: altered, manifest: { ...prepared.manifest, state: "ACTIVE", publishedAt: now } }];
    const result = buildOfficialStatic(data, Date.parse(now));
    const article = Object.entries(result.files).find(([path]) => /^announcements\/.+\/index.html$/.test(path))![1];
    expect(article).not.toContain("<script>unsafe"); expect(article).not.toContain("<img src=x"); expect(article).toContain("&lt;script&gt;");
  });
  it("keeps official and application origins distinct and rejects local endpoint URLs", () => {
    for (const origin of ["http://app.nexus.example", "https://127.0.0.1", "https://localhost", "https://app.nexus.example/path", "https://user:pass@app.nexus.example"]) expect(officialStaticInputSchema.safeParse({ ...bundle(), appOrigin: origin }).success).toBe(false);
    expect(officialStaticInputSchema.safeParse({ ...bundle(), appOrigin: "https://www.nexus.example" }).success).toBe(false);
  });
});

describe("alpha16 independently expiring status", () => {
  it("turns an expired, future, stale or unobservable snapshot into UNKNOWN", () => {
    expect(effectivePublicStatus(snapshot, Date.parse(until)).state).toBe("OK");
    expect(effectivePublicStatus(snapshot, Date.parse(until) + 1)).toMatchObject({ state: "UNKNOWN", expired: true });
    expect(effectivePublicStatus(snapshot, Date.parse(now) - 1).state).toBe("UNKNOWN");
    expect(effectivePublicStatus({ ...snapshot, quality: "STALE" }, Date.parse(now)).state).toBe("UNKNOWN");
    expect(effectivePublicStatus(null, Date.parse(now)).state).toBe("UNKNOWN");
  });
  it("keeps PC, Tunnel, Worker and outbound failures independent", () => {
    for (const key of ["pc", "tunnel", "worker", "discordOutbound"] as const) {
      const value = { ...snapshot, components: { ...snapshot.components, [key]: { state: "STOPPED", observedAt: now } } };
      const result = effectivePublicStatus(value, Date.parse(now));
      expect(result.state).toBe("DEGRADED"); expect(result.components[key].state).toBe("STOPPED");
      for (const other of Object.keys(result.components) as (keyof PublicStatusSnapshot["components"])[]) if (other !== key) expect(result.components[other].state).toBe("OK");
    }
  });
  it("rejects observed future state, missing observations, bad validity and private health details", () => {
    expect(publicStatusSnapshotSchema.safeParse({ ...snapshot, validUntil: now }).success).toBe(false);
    expect(publicStatusSnapshotSchema.safeParse({ ...snapshot, internalIP: "127.0.0.1" }).success).toBe(false);
    expect(publicStatusSnapshotSchema.safeParse({ ...snapshot, components: { ...snapshot.components, pc: { state: "OK", observedAt: null } } }).success).toBe(false);
    expect(publicStatusSnapshotSchema.safeParse({ ...snapshot, components: { ...snapshot.components, pc: { state: "OK", observedAt: until } } }).success).toBe(false);
  });
  it("renders UNKNOWN without script support and has a browser expiry check", () => {
    const result = buildOfficialStatic(bundle(), Date.parse(now));
    expect(result.files["status/index.html"]).toContain('data-overall>現在状態不明');
    expect(result.files["status/index.html"]).toContain("<noscript>");
    expect(Object.entries(result.files).find(([path]) => /^assets\/status-.+\.js$/.test(path))?.[1]).toContain("Date.now()<=Date.parse(snapshot.validUntil)");
  });
});

describe("alpha16 publisher prerequisites", () => {
  it("never promotes unknown hosting capability or unapproved retention into an enabled publisher", () => {
    expect(publicationReadiness({ enabled: true, retentionApproved: true, canonicalOriginsVerified: true }).enabled).toBe(false);
    expect(publicationReadiness({ enabled: true, retentionApproved: false, canonicalOriginsVerified: true, capability: { atomicSwitch: true, conditionalGeneration: true, readBackHash: true, routeWithdrawal: true, cacheBehaviorVerified: true } }).enabled).toBe(false);
  });
  it("stops before any database or publisher side effect when unconfigured", async () => {
    const service = new StaticPublications({} as Database, { authorize: async () => undefined });
    await expect(service.stage({ publicationId: id, expectedSourceRevision: 1, expectedGeneration: 0, operation: "PUBLISH", confirmed: true, translationsReviewed: true, target: "public-site" })).rejects.toThrow("PUBLIC_PUBLISH_UNAVAILABLE");
  });
});
