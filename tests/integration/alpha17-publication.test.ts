import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { connect, migrate, sql, type Database } from "../../packages/db/src/index";
import { OfficialPublications } from "../../packages/operations/src/publication";
import { StaticPublications, type StaticPublisher } from "../../packages/operations/src/alpha16-publication";
import { Alpha16Operator, type Alpha16OperatorPolicy, type OperatorGrant } from "../../packages/security/src/alpha16-operator";
import { IndependentSafetyAuthority } from "../../packages/security/src/alpha16-safety-state";
import type { Alpha16RetentionClass } from "../../packages/security/src/alpha16-retention";
import { operatorDigest, type OperatorAuth } from "../../packages/security/src/operator-auth";
import { scopeLockIds } from "../../packages/rules/src/locks";
import { isolatedPostgres } from "../fixtures/postgres";

// Isolated test credentials, policy and remote state only. No operating DB,
// real publisher, stored session, tunnel or externally routed site is used.
let infra: Awaited<ReturnType<typeof isolatedPostgres>>, db: Database;
beforeAll(async () => { infra = await isolatedPostgres(); db = connect(infra.databaseUrl); await migrate(db); });
afterAll(async () => { await db?.destroy(); await infra?.stop(); });
const content = { category: "UPDATE" as const, incidentStatus: "NONE" as const, ja: { title: "Synthetic approved update", summary: "No real data", body: "Reviewed synthetic public text" }, en: null };
async function fixture() {
  const id = randomUUID(), source = new OfficialPublications(db), epoch = randomUUID(), sessionValue = randomUUID().replaceAll("-", "").padEnd(43, "x"), session = operatorDigest(sessionValue);
  await source.change({ id, expectedRevision: 0, requestId: randomUUID(), action: "save", content });
  await sql`INSERT INTO operator_sessions(digest,credential_epoch,csrf_digest,expires_at) VALUES(${session},${epoch}::uuid,${"f".repeat(64)},clock_timestamp()+interval '1 hour')`.execute(db);
  const classes: Alpha16RetentionClass[] = ["OPERATOR_PREVIEW", "OPERATOR_STEP_UP", "AUDIT", "PUBLICATION_HISTORY", "PUBLICATION_WITHDRAWAL"];
  const retention = classes.map(kind => ({ class: kind, revision: "synthetic-only", approved: true as const, enforcementVerified: true as const, durationMs: 3600000 }));
  const policy: Alpha16OperatorPolicy = { revision: "synthetic-only", retention, previewMs: 300000, challengeMs: 60000, stepUpMs: 60000 };
  const grant: OperatorGrant = { global: true, guildIds: [], permissions: ["OPERATOR_ANNOUNCEMENT_PUBLISH"] };
  const observedAt = new Date().toISOString(), expiresAt = new Date(Date.now() + 1800000).toISOString();
  const remote = { publicationId: id, generation: 0, withdrawnGeneration: 0, withdrawnSourceVersion: 0, activeGeneration: null as number | null,
    activeArtifactHash: null as string | null, pendingGeneration: null, state: "CONFIRMED", expiresAt };
  let hash = "", withdrawn = false, loseAck = false;
  const safety = new IndependentSafetyAuthority(() => retention, async () => {
    // A stalled external provider must never run under the Operator GLOBAL
    // lock. Try the same lock on an independent connection, without waiting.
    const lockId = scopeLockIds([{ kind: "GLOBAL", mode: "exclusive" }])[0]!.id;
    await db.transaction().execute(async tx => {
      const result = await sql<{ acquired: boolean }>`SELECT pg_try_advisory_xact_lock(${lockId}::bigint) AS acquired`.execute(tx);
      expect(result.rows[0]?.acquired).toBe(true);
    });
    return { kind: "PUBLICATION_WITHDRAWAL", scope: null,
    generation: `fixture-${remote.generation}`, independent: true, complete: true, policyRevision: "synthetic-only", observedAt, expiresAt, publications: [remote] }; });
  const send = vi.fn(async (input: Parameters<StaticPublisher["switchGeneration"]>[0]) => {
    // A live side effect must be outside the reviewed command transaction and
    // after a durable ADMITTED fence. This independent connection sees both.
    expect((await sql`SELECT operation_id FROM alpha16_operator_commands WHERE operation_id=${operationId}::uuid`.execute(db)).rows).toHaveLength(1);
    expect((await sql<{ effect_state: string }>`SELECT effect_state FROM official_static_publication_manifests WHERE publication_id=${id}::uuid AND generation=${input.generation}`.execute(db)).rows[0]?.effect_state).toBe("ADMITTED");
    remote.generation = input.generation; remote.activeGeneration = input.withdraw ? null : input.generation;
    remote.activeArtifactHash = input.withdraw ? null : input.artifactHash;
    if (input.withdraw) { remote.withdrawnGeneration = input.generation; remote.withdrawnSourceVersion = 1; }
    hash = input.artifactHash; withdrawn = input.withdraw;
    return loseAck ? { state: "UNKNOWN" as const } : { state: "CONFIRMED" as const, generation: input.generation, artifactHash: input.artifactHash };
  });
  const publisher: StaticPublisher = { capability: { atomicSwitch: true, conditionalGeneration: true, readBackHash: true, routeWithdrawal: true, cacheBehaviorVerified: true }, switchGeneration: send,
    readGeneration: vi.fn(async () => remote.generation ? { generation: remote.generation, artifactHash: hash, withdrawn } : null) };
  const publications = new StaticPublications(db, { enabled: true, canonicalOriginsVerified: true, retention, safetyAuthority: safety, publisher, authorize: async () => {} });
  const operator = new Alpha16Operator(db, { reauthenticate: async () => ({ credentialEpoch: epoch }) } as unknown as OperatorAuth,
    { policy: async () => policy, grant: async () => grant, publications: source, staticPublications: publications });
  let operationId = randomUUID();
  async function review(action: "publish" | "withdraw" = "publish", expectedRevision = 1) {
    operationId = randomUUID();
    const preview = await operator.previewAnnouncement(session, { input: { id, action, expectedRevision, requestId: operationId,
      confirmed: true, translationsReviewed: true, target: "public-site" }, reason: "OPERATOR_REQUEST" });
    const challenge = await operator.challenge(session, preview.previewId);
    const proof = await operator.reauthenticate(sessionValue, "fixture-csrf", { challengeId: challenge.challengeId, challenge: challenge.challenge, password: "synthetic-factor" });
    return { preview, body: { previewId: preview.previewId, previewHash: preview.previewHash, stepUpToken: proof.stepUpToken, confirmation: true } };
  }
  return { id, operator, source, publications, publisher, send, session, grant, remote, review, loseAck: () => { loseAck = true; } };
}
it("pins actual PUBLIC content/generation in the reviewed preview and dispatches only after the step-up commit", async () => {
  const f = await fixture(), reviewed = await f.review();
  expect(reviewed.preview.target).toMatchObject({ expectedGeneration: 0, publicContent: { scope: "PUBLIC", sourceVersion: 1, ja: content.ja } });
  const key = randomUUID();
  expect(await f.operator.confirm(f.session, reviewed.body, key, "ANNOUNCEMENT", f.id)).toMatchObject({ state: "CONFIRMED", generation: 1, published: true, publicSiteChanged: true });
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(await f.operator.confirm(f.session, reviewed.body, key, "ANNOUNCEMENT", f.id)).toMatchObject({ state: "ACCEPTED", replay: true });
  expect(f.send).toHaveBeenCalledTimes(1);
  expect((await f.source.detail(f.id)).status).toBe("PUBLISHED");
});
it("withdraws using a new reviewed generation and no DB-only publication success", async () => {
  const f = await fixture(), first = await f.review();
  await f.operator.confirm(f.session, first.body, randomUUID());
  const second = await f.review("withdraw", 2);
  expect(await f.operator.confirm(f.session, second.body, randomUUID())).toMatchObject({ state: "CONFIRMED", generation: 2, published: false, publicSiteChanged: true });
  expect((await f.source.detail(f.id)).status).toBe("WITHDRAWN");
  expect(f.remote.withdrawnGeneration).toBe(2);
});
it("never resends UNKNOWN and reconciles the exact current remote hash read-only", async () => {
  const f = await fixture(), reviewed = await f.review(), key = randomUUID(); f.loseAck();
  expect(await f.operator.confirm(f.session, reviewed.body, key)).toMatchObject({ state: "UNKNOWN", publicSiteChanged: false });
  expect(await f.operator.confirm(f.session, reviewed.body, key)).toMatchObject({ replay: true });
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(await f.operator.reconcileAnnouncement(f.session, f.id, 1)).toEqual({ state: "CONFIRMED", generation: 1 });
  expect(f.send).toHaveBeenCalledTimes(1);
});
it("rechecks permission and source revision before committing or sending", async () => {
  const f = await fixture(), reviewed = await f.review();
  f.grant.permissions = [];
  await expect(f.operator.confirm(f.session, reviewed.body, randomUUID())).rejects.toThrow("PERMISSION_DENIED");
  expect(f.send).not.toHaveBeenCalled();
  f.grant.permissions = ["OPERATOR_ANNOUNCEMENT_PUBLISH"];
  await f.source.change({ id: f.id, expectedRevision: 1, action: "save", content: { ...content, ja: { ...content.ja, title: "Changed after preview" } }, requestId: randomUUID() });
  await expect(f.operator.confirm(f.session, reviewed.body, randomUUID())).rejects.toThrow("REVISION_CONFLICT");
  expect(f.send).not.toHaveBeenCalled();
  expect((await sql`SELECT publication_id FROM official_static_publication_heads WHERE publication_id=${f.id}::uuid`.execute(db)).rows).toHaveLength(0);
});
it("keeps legacy DB-only publication commands closed even with an enabled separate provider", async () => {
  const f = await fixture();
  await expect(f.source.change({ id: f.id, expectedRevision: 1, action: "publish", requestId: randomUUID(), confirmed: true, translationsReviewed: true, target: "public-site" })).rejects.toThrow("PUBLIC_PUBLISH_UNAVAILABLE");
  expect(f.send).not.toHaveBeenCalled();
});
it("exports only confirmed current PUBLIC revisions while excluding a newer draft and withdrawn routes", async () => {
  const f = await fixture(), reviewed = await f.review();
  await f.operator.confirm(f.session, reviewed.body, randomUUID());
  await f.source.change({ id: f.id, expectedRevision: 2, action: "save", content: { ...content, ja: { ...content.ja, title: "Private draft must not export" } }, requestId: randomUUID() });
  const result = await f.publications.exportConfirmedPublicInput({ generation: 10, officialOrigin: "https://www.nexus.example", appOrigin: "https://app.nexus.example", publicationIds: [f.id] });
  expect(result.announcements).toHaveLength(1);
  expect(result.announcements[0]?.source.ja.title).toBe(content.ja.title);
  expect(result.announcements[0]?.source.sourceVersion).toBe(1);
  expect(result.legal).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("Private draft must not export");
  const remove = await f.review("withdraw", 3);
  await f.operator.confirm(f.session, remove.body, randomUUID());
  expect((await f.publications.exportConfirmedPublicInput({ generation: 11, officialOrigin: "https://www.nexus.example", appOrigin: "https://app.nexus.example", publicationIds: [f.id] })).announcements).toEqual([]);
});

it("rejects same-version edits at the DB boundary before they can alter reviewed content", async () => {
  const f = await fixture(), reviewed = await f.review();
  await expect(sql`UPDATE official_publication_revisions SET content=${JSON.stringify({ ...content, ja: { ...content.ja, title: "Changed behind the revision" } })}::jsonb WHERE publication_id=${f.id}::uuid AND revision=1`.execute(db)).rejects.toThrow("OFFICIAL_REVISION_IMMUTABLE");
  expect(await f.operator.confirm(f.session, reviewed.body, randomUUID())).toMatchObject({ state: "CONFIRMED", publicSiteChanged: true });
  expect(f.send).toHaveBeenCalledTimes(1);
});
it("requires the exact reviewed public content hash before preparing a generation", async () => {
  const f = await fixture();
  await expect(f.publications.stage({ publicationId: f.id, expectedSourceRevision: 1, expectedGeneration: 0,
    operation: "PUBLISH", expectedContentHash: "0".repeat(64), confirmed: true, translationsReviewed: true, target: "public-site" })).rejects.toThrow("PUBLICATION_REVIEW_CONFLICT");
  expect(f.send).not.toHaveBeenCalled();
  expect((await sql`SELECT publication_id FROM official_static_publication_heads WHERE publication_id=${f.id}::uuid`.execute(db)).rows).toHaveLength(0);
});
