import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  connect,
  migrate,
  sql,
  type Database,
} from "../../packages/db/src/index";
import {
  OfficialPublications,
  type PublicationContent,
  type PublicationChange,
} from "../../packages/operations/src/publication";
import { createOperatorServer } from "../../apps/operator/src/server";
import {
  OperatorAuth,
  passwordCredentials,
} from "../../packages/security/src/operator-auth";
import { BetaOperator } from "../../packages/security/src/beta-operator";
import { isolatedPostgres } from "../fixtures/postgres";

let infra: Awaited<ReturnType<typeof isolatedPostgres>>,
  db: Database,
  service: OfficialPublications;
const content = (marker = "Synthetic A", en = false): PublicationContent => ({
  category: "UPDATE",
  incidentStatus: "NONE",
  ja: {
    title: marker,
    summary: marker + " summary",
    body: "## Synthetic heading\n\n" + marker,
  },
  en: en
    ? {
        title: marker + " EN",
        summary: marker + " EN summary",
        body: "## Synthetic English\n\n" + marker + " EN",
      }
    : null,
});
const change = (
  id: string,
  expectedRevision: number,
  action: PublicationChange["action"],
  extra: Partial<PublicationChange> = {},
) =>
  service.change({
    id,
    expectedRevision,
    action,
    requestId: randomUUID(),
    ...extra,
  });
const create = async (value = content()) =>
  change(randomUUID(), 0, "save", {
    content: value,
    englishReviewed: !!value.en,
  });
const publish = (
  id: string,
  revision: number,
  extra: Partial<PublicationChange> = {},
) =>
  change(id, revision, "publish", {
    confirmed: true,
    translationsReviewed: true,
    target: "public-site",
    ...extra,
  });
// Historical, synthetic LEGACY data is seeded only inside this isolated test
// database. This does not invoke or enable the unconfigured static publisher.
const seedLegacyPublished = async (draft: { id: string; revision: number }) => {
  const result = await sql`UPDATE official_publications SET
    revision=revision+1,published_revision=edit_revision,status='PUBLISHED',
    first_published_at=COALESCE(first_published_at,clock_timestamp()),
    published_updated_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE id=${draft.id}::uuid AND revision=${draft.revision}
      AND edit_revision IS NOT NULL AND delivery_mode='LEGACY' RETURNING id`.execute(db);
  expect(result.rows).toHaveLength(1);
  return service.detail(draft.id);
};
beforeAll(async () => {
  infra = await isolatedPostgres();
  db = connect(infra.databaseUrl);
  await migrate(db);
  service = new OfficialPublications(
    db,
    async (document, locale) =>
      `# Synthetic ${document} ${locale}\n\n[To be confirmed] **Private candidate**`,
  );
});
afterAll(async () => {
  await db?.destroy();
  await infra?.stop();
});

it("keeps drafts and private translations absent from all public projections", async () => {
  const draft = await create(content("UNPUBLISHED-SYNTHETIC", true));
  expect(await service.publicDetail(draft.id, "ja")).toBeNull();
  expect(await service.publicDetail(draft.id, "en")).toBeNull();
  for (const category of [undefined, "UPDATE"] as const) {
    const list = await service.publicList({ category });
    expect(JSON.stringify(list)).not.toContain("UNPUBLISHED-SYNTHETIC");
    expect(list.items.some((x) => x.id === draft.id)).toBe(false);
  }
});
it("leaves retained legacy A stable while B is edited and unconfigured publication stays closed", async () => {
  const a = await create(content("SYNTHETIC-PUBLISHED-A", true));
  const first = await seedLegacyPublished(a);
  const b = await change(a.id, first.revision, "save", {
    content: content("SYNTHETIC-PRIVATE-B", true),
    englishReviewed: true,
  });
  expect((await service.publicDetail(a.id))!.title).toBe(
    "SYNTHETIC-PUBLISHED-A",
  );
  expect((await service.publicDetail(a.id, "en"))!.title).toBe(
    "SYNTHETIC-PUBLISHED-A EN",
  );
  expect((await service.preview(a.id, b.revision)).title).toBe(
    "SYNTHETIC-PRIVATE-B",
  );
  await expect(publish(a.id, first.revision)).rejects.toThrow(
    "PUBLIC_PUBLISH_UNAVAILABLE",
  );
  await expect(service.preview(a.id, first.revision)).rejects.toThrow(
    "REVISION_CONFLICT",
  );
  await expect(publish(a.id, b.revision)).rejects.toThrow(
    "PUBLIC_PUBLISH_UNAVAILABLE",
  );
  expect((await service.publicDetail(a.id))!.title).toBe("SYNTHETIC-PUBLISHED-A");
  expect((await service.detail(a.id)).revision).toBe(b.revision);
  expect((await service.publicDetail(a.id))!.publishedAt).toBe(
    first.publishedAt,
  );
});
it("rejects concurrent editor writes and keeps the losing draft from becoming visible", async () => {
  const a = await create();
  const writes = await Promise.allSettled(
    ["EDITOR-B", "EDITOR-C"].map((marker) =>
      change(a.id, a.revision, "save", { content: content(marker) }),
    ),
  );
  expect(writes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(
    writes
      .filter((x) => x.status === "rejected")
      .map((x) => (x.status === "rejected" ? x.reason.message : "")),
  ).toEqual(["REVISION_CONFLICT"]);
  expect(await service.publicDetail(a.id)).toBeNull();
});
it("deduplicates concurrent draft saves and metadata-only audit in one transaction", async () => {
  const a = await create();
  const request = {
    id: a.id,
    expectedRevision: a.revision,
    requestId: randomUUID(),
    action: "save" as const,
    content: content("SYNTHETIC-NOT-IN-AUDIT", true),
    englishReviewed: true,
  };
  const [one, two] = await Promise.all([
    service.change(request),
    service.change(request),
  ]);
  expect(one).toEqual(two);
  expect(
    (
      await sql`SELECT * FROM official_publication_audit WHERE request_id=${request.requestId}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(1);
  const records =
    await sql`SELECT * FROM official_publication_requests WHERE publication_id=${a.id}::uuid`.execute(
      db,
    );
  expect(JSON.stringify(records.rows)).not.toContain("SYNTHETIC-NOT-IN-AUDIT");
  await expect(
    service.change({
      ...request,
      expectedRevision: request.expectedRevision + 1,
    }),
  ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  // A delayed retry receives its exact original result, not a later edit.
  await change(a.id, one.revision, "save", { content: content("LATER-DRAFT") });
  expect(await service.change(request)).toEqual(one);
});
it("rolls back both draft pointer and request when audit storage fails", async () => {
  const a = await create(),
    requestId = randomUUID();
  await sql
    .raw(
      "CREATE FUNCTION synthetic_publication_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$",
    )
    .execute(db);
  await sql
    .raw(
      "CREATE TRIGGER synthetic_publication_audit_failure BEFORE INSERT ON official_publication_audit FOR EACH ROW EXECUTE FUNCTION synthetic_publication_audit_failure()",
    )
    .execute(db);
  try {
    await expect(change(a.id, a.revision, "save", {
      requestId,
      content: content("SYNTHETIC-ROLLED-BACK"),
    })).rejects.toThrow(
      "synthetic audit failure",
    );
  } finally {
    await sql
      .raw(
        "DROP TRIGGER synthetic_publication_audit_failure ON official_publication_audit",
      )
      .execute(db);
    await sql
      .raw("DROP FUNCTION synthetic_publication_audit_failure()")
      .execute(db);
  }
  expect(await service.publicDetail(a.id)).toBeNull();
  expect((await service.detail(a.id)).revision).toBe(a.revision);
  expect(
    (
      await sql`SELECT id FROM official_publication_requests WHERE id=${requestId}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(0);
});
it("keeps unconfigured withdrawal closed and never reopens a retained withdrawn legacy row", async () => {
  const a = await create(content("WITHDRAW-SYNTHETIC", true));
  const live = await seedLegacyPublished(a);
  await expect(change(a.id, live.revision, "withdraw")).rejects.toThrow(
    "PUBLIC_PUBLISH_UNAVAILABLE",
  );
  expect(await service.detail(a.id)).toEqual(live);
  // Model a previously withdrawn LEGACY record, not a successful current
  // remote withdrawal. New publisher work requires its independent authority.
  await sql`UPDATE official_publications SET revision=revision+1,status='WITHDRAWN',updated_at=clock_timestamp() WHERE id=${a.id}::uuid`.execute(db);
  expect(await service.publicDetail(a.id, "ja")).toBeNull();
  expect(await service.publicDetail(a.id, "en")).toBeNull();
  expect(
    JSON.stringify(
      await service.publicList({ category: "UPDATE", locale: "en" }),
    ),
  ).not.toContain("WITHDRAW-SYNTHETIC");
  const edit = await service.detail(a.id);
  expect(edit.status).toBe("WITHDRAWN");
  await expect(publish(a.id, edit.revision)).rejects.toThrow(
    "PUBLIC_PUBLISH_UNAVAILABLE",
  );
  expect(await service.publicDetail(a.id)).toBeNull();
});
it("discards an edit without altering its published content or deleting publication history", async () => {
  const a = await create(),
    live = await seedLegacyPublished(a);
  const b = await change(a.id, live.revision, "save", {
    content: content("DISCARD-SYNTHETIC"),
  });
  const discarded = await change(a.id, b.revision, "discard");
  expect(discarded.content).toEqual(a.content);
  expect((await service.publicDetail(a.id))!.title).toBe(a.content!.ja.title);
  expect(
    (
      await sql`SELECT revision FROM official_publication_revisions WHERE publication_id=${a.id}::uuid`.execute(
        db,
      )
    ).rows,
  ).toHaveLength(2);
  const unpublished = await create();
  const empty = await change(unpublished.id, unpublished.revision, "discard");
  expect(empty.content).toBeNull();
  await expect(service.preview(empty.id, empty.revision)).rejects.toThrow(
    "PUBLICATION_DRAFT_EMPTY",
  );
  await expect(publish(empty.id, empty.revision)).rejects.toThrow(
    "PUBLIC_PUBLISH_UNAVAILABLE",
  );
});
it("never reuses old English when a retained current legacy revision has no translation", async () => {
  const a = await create(content("OLD-EN-SYNTHETIC", true)),
    live = await seedLegacyPublished(a);
  const b = await change(a.id, live.revision, "save", {
    content: content("CURRENT-JA-SYNTHETIC"),
  });
  await seedLegacyPublished(b);
  const result = await service.publicDetail(a.id, "en");
  expect(result).toMatchObject({
    fallback: true,
    locale: "ja",
    requestedLocale: "en",
    title: "CURRENT-JA-SYNTHETIC",
  });
  expect(JSON.stringify(result)).not.toContain("OLD-EN-SYNTHETIC");
  await expect(
    create({ ...content(), en: content("EN").ja }).then((x) =>
      change(x.id, x.revision, "save", {
        content: content("REVIEW-MISSING", true),
      }),
    ),
  ).rejects.toThrow("ENGLISH_REVIEW_REQUIRED");
});
it("uses the same safe Markdown for operator preview and public rendering", async () => {
  const malicious = content("SYNTHETIC-XSS");
  malicious.ja.body =
    "## Safety\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))\n\n![tracker](https://example.invalid/tracker.png)\n\n[link](https://example.invalid/help)";
  const draft = await create(malicious),
    preview = await service.preview(draft.id, draft.revision);
  await seedLegacyPublished(draft);
  const published = await service.publicDetail(draft.id);
  expect(published!.html).toBe(preview.html);
  expect(preview.html).not.toMatch(/<script|<img|href="javascript:/i);
  expect(preview.html).toContain("&lt;script&gt;");
  expect(preview.headings).toHaveLength(1);
});
it("keeps incident state separate and paginates category-filtered published rows only", async () => {
  const invalid = { ...content(), incidentStatus: "RESOLVED" as const };
  await expect(create(invalid)).rejects.toThrow();
  for (let i = 0; i < 22; i++) {
    const a = await create({
      ...content("SYNTHETIC-MAINTENANCE-" + i),
      category: "MAINTENANCE",
    });
    await seedLegacyPublished(a);
  }
  const one = await service.publicList({ category: "MAINTENANCE", page: 1 }),
    two = await service.publicList({ category: "MAINTENANCE", page: 2 });
  expect(one).toMatchObject({ total: 22, pageSize: 20, hasNext: true });
  expect(one.items).toHaveLength(20);
  expect(two.items).toHaveLength(2);
  expect(new Set([...one.items, ...two.items].map((x) => x.id)).size).toBe(22);
  expect(JSON.stringify(one)).not.toContain('"body"');
});
it("holds legal publication blocked with all synthetic owner fields completed and keeps PII out of audit", async () => {
  const initial = await service.legal();
  const settings = {
    legalName: "Synthetic Review Operator",
    address: "Synthetic review address",
    supportEmail: "support@example.invalid",
    rightsEmail: "rights@example.invalid",
    effectiveDate: "2026-10-09",
    version: "synthetic-0.6",
    other: "Synthetic unresolved review note",
  };
  const request = {
    expectedRevision: initial.revision,
    requestId: randomUUID(),
    settings,
  };
  const result = await service.saveLegal(request);
  expect(result.releaseBlocked).toBe(true);
  expect(result.settings).toEqual(settings);
  expect(result.documents.every((x) => x.available)).toBe(true);
  expect((await service.saveLegal(request)).revision).toBe(result.revision);
  await expect(
    service.saveLegal({ ...request, requestId: randomUUID() }),
  ).rejects.toThrow("REVISION_CONFLICT");
  const preview = await service.legalPreview("terms", "en", result.revision);
  expect(preview.releaseBlocked).toBe(true);
  expect(preview.html).toContain("To be confirmed");
  expect(preview.html).not.toContain(settings.legalName);
  const records =
    await sql`SELECT * FROM official_publication_requests WHERE action='legal'`.execute(
      db,
    );
  expect(JSON.stringify(records.rows)).not.toContain(settings.legalName);
  expect(JSON.stringify(records.rows)).not.toContain(settings.supportEmail);
  await expect(
    service.legalPreview("../secrets", "ja", result.revision),
  ).rejects.toThrow();
  const absent = new OfficialPublications(db, async () => {
    throw Error("synthetic missing source");
  });
  expect((await absent.legal()).documents.every((x) => !x.available)).toBe(
    true,
  );
  await expect(
    absent.legalPreview("privacy", "ja", result.revision),
  ).rejects.toThrow("LEGAL_CANDIDATE_UNAVAILABLE");
});
it("enforces actual operator authentication, CSRF, Host/Origin, expiry and no-store on the new routes", async () => {
  const credentials = await passwordCredentials(
    "Synthetic local operator password",
  );
  const auth = new OperatorAuth(db, async () => credentials),
    beta = new BetaOperator(db, async () => ({
      name: "Synthetic",
      present: true,
      canObserve: true,
      checkedAt: Date.now(),
    }));
  const confirmedContacts = {
    supportEmail: "support@example.invalid",
    rightsEmail: "privacy@example.invalid",
    confirmedOn: "2026-10-09",
  };
  let contactReadCount = 0,
    contactsAvailable = true;
  const app = createOperatorServer(db, auth, beta, "http://127.0.0.1:3210", {
    readLegalCandidate: async () => "# Synthetic private candidate",
    readConfirmedLegalContacts: async () => {
      contactReadCount++;
      if (!contactsAvailable)
        throw Error("synthetic local contact path must stay private");
      return confirmedContacts;
    },
  });
  const host = { host: "127.0.0.1:3210" },
    session = await auth.login("Synthetic local operator password");
  const headers = {
    ...host,
    origin: "http://127.0.0.1:3210",
    cookie: `nexus_operator=${session.value}`,
    "x-csrf-token": session.csrf,
  };
  const draft = await create();
  const input = {
    id: draft.id,
    expectedRevision: draft.revision,
    requestId: randomUUID(),
    action: "publish",
    confirmed: true,
    translationsReviewed: true,
    target: "public-site",
  };
  try {
    for (const path of [
      "/operator/publications",
      `/operator/publications/${draft.id}`,
      "/operator/legal",
      "/operator/legal/terms/ja?revision=1",
    ]) {
      expect(
        (await app.inject({ method: "GET", url: path, headers: host }))
          .statusCode,
      ).toBe(401);
    }
    expect(contactReadCount).toBe(0);
    const ok = await app.inject({
      method: "GET",
      url: "/operator/publications",
      headers,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    const beforeLegal = await service.legal();
    const legalResponse = await app.inject({
      method: "GET",
      url: "/operator/legal",
      headers,
    });
    expect(legalResponse.statusCode).toBe(200);
    expect(legalResponse.headers["cache-control"]).toBe("no-store");
    expect(legalResponse.json()).toMatchObject({
      revision: beforeLegal.revision,
      settings: beforeLegal.settings,
      releaseBlocked: true,
      blockers: beforeLegal.blockers,
      confirmedContacts,
    });
    expect(contactReadCount).toBe(1);
    expect(await service.legal()).toEqual(beforeLegal);
    contactsAvailable = false;
    const unavailableContacts = await app.inject({
      method: "GET",
      url: "/operator/legal",
      headers,
    });
    expect(unavailableContacts.statusCode).toBe(503);
    expect(unavailableContacts.json()).toEqual({
      error: "OPERATOR_UNAVAILABLE",
    });
    expect(unavailableContacts.body).not.toContain(
      "synthetic local contact path",
    );
    expect(await service.legal()).toEqual(beforeLegal);
    expect((await service.legal()).releaseBlocked).toBe(true);
    contactsAvailable = true;
    for (const path of ["/operator/legal", "/operator-ui.js"]) {
      const unauthenticated = await app.inject({
        method: "GET",
        url: path,
        headers: host,
      });
      expect(unauthenticated.body).not.toMatch(
        /support@example\.invalid|privacy@example\.invalid/,
      );
    }
    for (const altered of [
      { ...headers, "x-csrf-token": "wrong" },
      { ...headers, origin: "https://example.invalid" },
      { ...headers, host: "example.invalid" },
      { ...headers, "x-forwarded-for": "127.0.0.1" },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/operator/publications",
            headers: altered,
            payload: input,
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/operator/publications",
          headers: host,
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/operator/legal/publish",
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/operator/legal/%2e%2e/ja?revision=1",
          headers,
        })
      ).statusCode,
    ).not.toBe(200);
    const response = await app.inject({
      method: "POST",
      url: "/operator/publications",
      headers,
      payload: input,
    });
    expect(response.statusCode).toBe(428);
    expect(response.json()).toEqual({ error: "PRECONDITION_REQUIRED" });
    expect(await service.detail(draft.id)).toEqual(draft);
    expect(await service.publicDetail(draft.id)).toBeNull();
    await sql`UPDATE operator_sessions SET expires_at=clock_timestamp()-interval '1 second'`.execute(
      db,
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/operator/publications",
          headers,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/operator/publications",
          headers,
          payload: input,
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    await app.close();
  }
});

it("enforces immutable historical content at the database boundary", async () => {
  const draft = await create(content("IMMUTABLE-SYNTHETIC"));
  await expect(
    sql`UPDATE official_publication_revisions SET content='{}'::jsonb WHERE publication_id=${draft.id}::uuid`.execute(
      db,
    ),
  ).rejects.toThrow("OFFICIAL_REVISION_IMMUTABLE");
  await expect(
    sql`DELETE FROM official_publication_revisions WHERE publication_id=${draft.id}::uuid`.execute(
      db,
    ),
  ).rejects.toThrow("OFFICIAL_REVISION_IMMUTABLE");
  expect((await service.detail(draft.id)).content!.ja.title).toBe(
    "IMMUTABLE-SYNTHETIC",
  );
});

it("returns picker labels without private bodies while keeping every publication reachable", async () => {
  const draft = await create(content("PICKER-SYNTHETIC"));
  for (let i = 0; i < 201; i++)
    await create(content("RECENT-PICKER-SYNTHETIC-" + i));
  const list = await service.list();
  const item = list.find((value) => value.id === draft.id)!;
  expect(item.content).toEqual({ ja: { title: "PICKER-SYNTHETIC" }, en: null });
  expect(JSON.stringify(list)).not.toContain('"body"');
  expect((await service.detail(draft.id)).content!.ja.body).toContain(
    "Synthetic heading",
  );
});
