import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { sql, type Database, type Tx } from "../../db/src/index";
import { assert } from "../../shared/src/index";
import { renderPublicationMarkdown } from "../../shared/src/publication-markdown";

export const publicationCategories = [
  "UPDATE",
  "MAINTENANCE",
  "INCIDENT",
  "SERVICE",
  "POLICY",
] as const;
export type PublicationCategory = (typeof publicationCategories)[number];
export const incidentStatuses = [
  "NONE",
  "INVESTIGATING",
  "MONITORING",
  "RESOLVED",
] as const;
const localeSchema = z.enum(["ja", "en"]);
const translationSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(50000),
  })
  .strict();
export const publicationContentSchema = z
  .object({
    category: z.enum(publicationCategories),
    incidentStatus: z.enum(incidentStatuses),
    ja: translationSchema,
    en: translationSchema.nullable(),
  })
  .strict()
  .refine(
    (value) => value.category === "INCIDENT" || value.incidentStatus === "NONE",
    { message: "INCIDENT_STATUS_REQUIRES_INCIDENT_CATEGORY" },
  );
export type PublicationContent = z.infer<typeof publicationContentSchema>;
const changeSchema = z
  .object({
    id: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    requestId: z.uuid(),
    action: z.enum(["save", "publish", "withdraw", "discard"]),
    content: publicationContentSchema.optional(),
    englishReviewed: z.boolean().optional(),
    confirmed: z.boolean().optional(),
    translationsReviewed: z.boolean().optional(),
    target: z.literal("public-site").optional(),
  })
  .strict();
export type PublicationChange = z.infer<typeof changeSchema>;
type PublicationRow = {
  id: string;
  revision: number;
  edit_revision: number | null;
  published_revision: number | null;
  status: "DRAFT" | "PUBLISHED" | "WITHDRAWN";
  created_at: Date;
  updated_at: Date;
  first_published_at: Date | null;
  published_updated_at: Date | null;
};
type PublicationMetadata = {
  id: string;
  revision: number;
  editRevision: number | null;
  publishedRevision: number | null;
  status: PublicationRow["status"];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  publishedUpdatedAt: string | null;
};
export type OperatorPublication = PublicationMetadata & {
  content: PublicationContent | null;
  published: PublicationContent | null;
};
export type PublicPublicationSummary = {
  id: string;
  revision: number;
  category: PublicationCategory;
  incidentStatus: PublicationContent["incidentStatus"];
  title: string;
  summary: string;
  locale: "ja" | "en";
  requestedLocale: "ja" | "en";
  fallback: boolean;
  publishedAt: string;
  updatedAt: string;
};
const metadata = (row: PublicationRow): PublicationMetadata => ({
  id: row.id,
  revision: row.revision,
  editRevision: row.edit_revision,
  publishedRevision: row.published_revision,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
  publishedAt: row.first_published_at?.toISOString() ?? null,
  publishedUpdatedAt: row.published_updated_at?.toISOString() ?? null,
});
const fingerprint = (input: unknown) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");
const documentSchema = z.enum(["terms", "privacy", "beta"]);
export type LegalDocument = z.infer<typeof documentSchema>;
export type LegalLocale = z.infer<typeof localeSchema>;
export type LegalCandidate = {
  markdown: string;
  source: {
    fileName: string;
    bytes: number;
    sha256: string;
    reviewVersion: string;
    reviewDate: string;
    presentationRevision: string;
  };
  notes: {
    key:
      | "sourceIntroduction"
      | "documentEditorial"
      | "editorialAppendix"
      | "integrationConditions"
      | "announcementsDesign";
    locale: LegalLocale;
    markdown: string;
  }[];
};
export type LegalCandidateLoader = (
  document: LegalDocument,
  locale: LegalLocale,
) => Promise<string | LegalCandidate>;
// Public readers never import filesystem paths or candidate source. Only the
// separate operator listener injects an allowlisted local loader.
const defaultCandidateLoader: LegalCandidateLoader = async () => {
  throw new Error("LEGAL_CANDIDATE_UNAVAILABLE");
};
const optionalText = (max: number) => z.string().trim().max(max);
const optionalEmail = z.union([z.literal(""), z.email().max(320)]);
export const legalSettingsSchema = z
  .object({
    legalName: optionalText(160),
    address: optionalText(1000),
    supportEmail: optionalEmail,
    rightsEmail: optionalEmail,
    effectiveDate: z.union([z.literal(""), z.iso.date()]),
    version: optionalText(100),
    other: optionalText(20000),
  })
  .strict()
  .refine(
    (value) =>
      !value.supportEmail ||
      !value.rightsEmail ||
      value.supportEmail.toLowerCase() !== value.rightsEmail.toLowerCase(),
    { message: "LEGAL_CONTACTS_MUST_DIFFER" },
  );
export type LegalSettings = z.infer<typeof legalSettingsSchema>;
const emptyLegalSettings: LegalSettings = {
  legalName: "",
  address: "",
  supportEmail: "",
  rightsEmail: "",
  effectiveDate: "",
  version: "",
  other: "",
};
export const legalPublicationBlockers = [
  "LEGAL_PUBLICATION_NOT_AUTHORIZED",
  "ADULT_MANAGER_CONSENT_AND_INSTALLATION_GATE_UNVERIFIED",
  "POLICY_RETENTION_ENCRYPTION_RESTORE_AND_REGIONAL_REVIEW_PENDING",
  "OWNER_DETAILS_AND_FINAL_DOCUMENT_REVIEW_REQUIRED",
] as const;

/** All mutation methods are called only after operator-session and CSRF checks.
 * Public readers select only the immutable published revision, never edit data.
 * No cache is kept here; web public routes must also use no-store responses. */
export class OfficialPublications {
  constructor(
    private readonly db: Database,
    private readonly readCandidate: LegalCandidateLoader = defaultCandidateLoader,
  ) {}
  private async content(tx: Tx, id: string, revision: number | null) {
    if (revision === null) return null;
    const row = (
      await sql<{
        content: PublicationContent;
      }>`SELECT content FROM official_publication_revisions WHERE publication_id=${id}::uuid AND revision=${revision}`.execute(
        tx,
      )
    ).rows[0];
    assert(row, "PUBLICATION_REVISION_UNAVAILABLE", 503);
    return publicationContentSchema.parse(row.content);
  }
  private async hydrate(
    tx: Tx,
    row: PublicationMetadata,
  ): Promise<OperatorPublication> {
    return {
      ...row,
      content: await this.content(tx, row.id, row.editRevision),
      published: await this.content(tx, row.id, row.publishedRevision),
    };
  }
  private async current(tx: Tx, id: string) {
    return (
      (
        await sql<PublicationRow>`SELECT * FROM official_publications WHERE id=${id}::uuid`.execute(
          tx,
        )
      ).rows[0] ?? null
    );
  }
  async list() {
    // The operator can still reach old publications to withdraw them. Only the
    // labels required by the picker are returned; full bodies require detail.
    const rows = (
      await sql<
        PublicationRow & {
          draft_ja_title: string | null;
          draft_en_title: string | null;
          published_ja_title: string | null;
          published_en_title: string | null;
        }
      >`SELECT p.*,d.content->'ja'->>'title' AS draft_ja_title,d.content->'en'->>'title' AS draft_en_title,
      r.content->'ja'->>'title' AS published_ja_title,r.content->'en'->>'title' AS published_en_title
      FROM official_publications p
      LEFT JOIN official_publication_revisions d ON d.publication_id=p.id AND d.revision=p.edit_revision
      LEFT JOIN official_publication_revisions r ON r.publication_id=p.id AND r.revision=p.published_revision
      ORDER BY p.updated_at DESC,p.id DESC`.execute(this.db)
    ).rows;
    return rows.map((row) => ({
      ...metadata(row),
      content:
        row.edit_revision === null
          ? null
          : {
              ja: { title: row.draft_ja_title! },
              en:
                row.draft_en_title === null
                  ? null
                  : { title: row.draft_en_title },
            },
      published:
        row.published_revision === null
          ? null
          : {
              ja: { title: row.published_ja_title! },
              en:
                row.published_en_title === null
                  ? null
                  : { title: row.published_en_title },
            },
    }));
  }
  async detail(id: string) {
    z.uuid().parse(id);
    const row = await this.current(this.db, id);
    assert(row, "PUBLICATION_NOT_FOUND", 404);
    return this.hydrate(this.db, metadata(row));
  }
  async preview(id: string, revision: number, locale: LegalLocale = "ja") {
    const article = await this.detail(id);
    assert(article.revision === revision, "REVISION_CONFLICT", 409);
    assert(article.content, "PUBLICATION_DRAFT_EMPTY", 409);
    const language = localeSchema.parse(locale),
      actual = language === "en" && article.content.en ? "en" : "ja";
    const content = article.content[actual]!;
    return {
      id,
      revision,
      locale: actual,
      fallback: actual !== language,
      title: content.title,
      summary: content.summary,
      ...renderPublicationMarkdown(content.body),
    };
  }
  async change(input: unknown): Promise<OperatorPublication> {
    const data = changeSchema.parse(input),
      hash = fingerprint(data);
    assert(
      data.action !== "save" || data.content,
      "PUBLICATION_CONTENT_REQUIRED",
    );
    assert(
      data.action === "save" || data.content === undefined,
      "INVALID_REQUEST",
    );
    assert(
      data.action !== "save" ||
        !data.content?.en ||
        data.englishReviewed === true,
      "ENGLISH_REVIEW_REQUIRED",
    );
    assert(
      data.action !== "publish" ||
        (data.confirmed === true &&
          data.translationsReviewed === true &&
          data.target === "public-site"),
      "PUBLICATION_CONFIRMATION_REQUIRED",
    );
    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(763214)`.execute(tx);
      const prior = (
        await sql<{
          fingerprint: string;
          result: PublicationMetadata;
        }>`SELECT fingerprint,result FROM official_publication_requests WHERE id=${data.requestId}::uuid`.execute(
          tx,
        )
      ).rows[0];
      if (prior) {
        assert(prior.fingerprint === hash, "IDEMPOTENCY_CONFLICT", 409);
        return this.hydrate(tx, prior.result);
      }
      const current = await this.current(tx, data.id);
      assert(
        (current?.revision ?? 0) === data.expectedRevision,
        "REVISION_CONFLICT",
        409,
      );
      assert(current || data.action === "save", "PUBLICATION_NOT_FOUND", 404);
      const revision = data.expectedRevision + 1;
      if (data.action === "save") {
        if (!current)
          await sql`INSERT INTO official_publications(id,revision) VALUES(${data.id}::uuid,${revision})`.execute(
            tx,
          );
        await sql`INSERT INTO official_publication_revisions(publication_id,revision,content) VALUES(${data.id}::uuid,${revision},${JSON.stringify(data.content)}::jsonb)`.execute(
          tx,
        );
        await sql`UPDATE official_publications SET revision=${revision},edit_revision=${revision},updated_at=clock_timestamp() WHERE id=${data.id}::uuid`.execute(
          tx,
        );
      } else if (data.action === "publish") {
        assert(current?.edit_revision, "PUBLICATION_DRAFT_EMPTY", 409);
        assert(
          current.status !== "PUBLISHED" ||
            current.published_revision !== current.edit_revision,
          "PUBLICATION_ALREADY_CURRENT",
          409,
        );
        await sql`UPDATE official_publications SET revision=${revision},published_revision=edit_revision,status='PUBLISHED',first_published_at=COALESCE(first_published_at,clock_timestamp()),published_updated_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=${data.id}::uuid`.execute(
          tx,
        );
      } else if (data.action === "withdraw") {
        assert(
          current?.status === "PUBLISHED",
          "PUBLICATION_NOT_PUBLISHED",
          409,
        );
        await sql`UPDATE official_publications SET revision=${revision},status='WITHDRAWN',updated_at=clock_timestamp() WHERE id=${data.id}::uuid`.execute(
          tx,
        );
      } else {
        assert(
          current?.edit_revision !== null &&
            current?.edit_revision !== current?.published_revision,
          "PUBLICATION_DRAFT_EMPTY",
          409,
        );
        await sql`UPDATE official_publications SET revision=${revision},edit_revision=published_revision,updated_at=clock_timestamp() WHERE id=${data.id}::uuid`.execute(
          tx,
        );
      }
      const result = metadata((await this.current(tx, data.id))!);
      await this.record(
        tx,
        data.requestId,
        hash,
        data.action,
        revision,
        result,
        data.id,
      );
      return this.hydrate(tx, result);
    });
  }
  private async record(
    tx: Tx,
    id: string,
    hash: string,
    action: string,
    revision: number,
    result: unknown,
    publicationId: string | null,
  ) {
    await sql`INSERT INTO official_publication_requests(id,fingerprint,publication_id,action,revision,result) VALUES(${id}::uuid,${hash},${publicationId}::uuid,${action},${revision},${JSON.stringify(result)}::jsonb)`.execute(
      tx,
    );
    await sql`INSERT INTO official_publication_audit(id,request_id,publication_id,actor,action,revision,result) VALUES(${randomUUID()}::uuid,${id}::uuid,${publicationId}::uuid,'local-operator',${action},${revision},'SUCCEEDED')`.execute(
      tx,
    );
  }
  private publicSummary(
    row: PublicationRow & { content: PublicationContent },
    requestedLocale: LegalLocale,
  ): PublicPublicationSummary {
    const content = publicationContentSchema.parse(row.content),
      locale = requestedLocale === "en" && content.en ? "en" : "ja",
      translated = content[locale]!;
    return {
      id: row.id,
      revision: row.published_revision!,
      category: content.category,
      incidentStatus: content.incidentStatus,
      title: translated.title,
      summary: translated.summary,
      locale,
      requestedLocale,
      fallback: locale !== requestedLocale,
      publishedAt: row.first_published_at!.toISOString(),
      updatedAt: row.published_updated_at!.toISOString(),
    };
  }
  async publicList(
    input: {
      category?: PublicationCategory;
      page?: number;
      locale?: LegalLocale;
    } = {},
  ) {
    const data = z
      .object({
        category: z.enum(publicationCategories).optional(),
        page: z.number().int().min(1).max(100000).default(1),
        locale: localeSchema.default("ja"),
      })
      .strict()
      .parse(input);
    const filter = data.category
      ? sql`AND r.content->>'category'=${data.category}`
      : sql``;
    // A single statement keeps the page and total on one database snapshot.
    const result = (
      await sql<{
        total: number;
        items: (Omit<
          PublicationRow,
          | "created_at"
          | "updated_at"
          | "first_published_at"
          | "published_updated_at"
        > & {
          created_at: string;
          updated_at: string;
          first_published_at: string;
          published_updated_at: string;
          content: PublicationContent;
        })[];
      }>`
      WITH published AS (SELECT p.*,r.content FROM official_publications p JOIN official_publication_revisions r ON r.publication_id=p.id AND r.revision=p.published_revision WHERE p.status='PUBLISHED' ${filter}),
      page AS (SELECT * FROM published ORDER BY first_published_at DESC,id DESC LIMIT 20 OFFSET ${(data.page - 1) * 20})
      SELECT (SELECT count(*)::int FROM published) AS total,COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY first_published_at DESC,id DESC) FROM page),'[]'::jsonb) AS items`.execute(
        this.db,
      )
    ).rows[0]!;
    const items = result.items.map((row) =>
      this.publicSummary(
        {
          ...row,
          created_at: new Date(row.created_at),
          updated_at: new Date(row.updated_at),
          first_published_at: new Date(row.first_published_at),
          published_updated_at: new Date(row.published_updated_at),
        },
        data.locale,
      ),
    );
    return {
      items,
      page: data.page,
      pageSize: 20,
      total: result.total,
      hasNext: data.page * 20 < result.total,
    };
  }
  async publicDetail(id: string, locale: LegalLocale = "ja") {
    if (!z.uuid().safeParse(id).success) return null;
    const language = localeSchema.parse(locale);
    const row = (
      await sql<
        PublicationRow & { content: PublicationContent }
      >`SELECT p.*,r.content FROM official_publications p JOIN official_publication_revisions r ON r.publication_id=p.id AND r.revision=p.published_revision WHERE p.id=${id}::uuid AND p.status='PUBLISHED'`.execute(
        this.db,
      )
    ).rows[0];
    if (!row) return null;
    const summary = this.publicSummary(row, language),
      body = row.content[summary.locale]!.body;
    return { ...summary, body, ...renderPublicationMarkdown(body) };
  }
  private async settings(tx: Tx) {
    const row = (
      await sql<{
        revision: number;
        settings: Partial<LegalSettings>;
      }>`SELECT revision,settings FROM official_legal_settings WHERE singleton=true`.execute(
        tx,
      )
    ).rows[0]!;
    return {
      revision: row.revision,
      settings: legalSettingsSchema.parse({
        ...emptyLegalSettings,
        ...row.settings,
      }),
    };
  }
  async legal() {
    const result = await this.settings(this.db);
    const documents = await Promise.all(
      documentSchema.options.flatMap((document) =>
        localeSchema.options.map(async (locale) => {
          let available = false;
          try {
            const candidate = await this.readCandidate(document, locale);
            available =
              (typeof candidate === "string"
                ? candidate
                : candidate.markdown
              ).trim().length > 0;
          } catch {
            /* private missing candidate remains unavailable */
          }
          return { document, locale, available };
        }),
      ),
    );
    return {
      ...result,
      releaseBlocked: true as const,
      blockers: legalPublicationBlockers,
      documents,
    };
  }
  async saveLegal(input: unknown) {
    const data = z
        .object({
          expectedRevision: z.number().int().nonnegative(),
          requestId: z.uuid(),
          settings: legalSettingsSchema,
        })
        .strict()
        .parse(input),
      hash = fingerprint(data);
    await this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(763214)`.execute(tx);
      const prior = (
        await sql<{
          fingerprint: string;
        }>`SELECT fingerprint FROM official_publication_requests WHERE id=${data.requestId}::uuid`.execute(
          tx,
        )
      ).rows[0];
      if (prior) {
        assert(prior.fingerprint === hash, "IDEMPOTENCY_CONFLICT", 409);
        return;
      }
      const current = await this.settings(tx);
      assert(
        current.revision === data.expectedRevision,
        "REVISION_CONFLICT",
        409,
      );
      const revision = current.revision + 1;
      await sql`UPDATE official_legal_settings SET revision=${revision},settings=${JSON.stringify(data.settings)}::jsonb,updated_at=clock_timestamp() WHERE singleton=true`.execute(
        tx,
      );
      await this.record(
        tx,
        data.requestId,
        hash,
        "legal",
        revision,
        { revision },
        null,
      );
    });
    return this.legal();
  }
  async legalPreview(
    documentInput: string,
    localeInput: string,
    revision: number,
  ) {
    const document = documentSchema.parse(documentInput),
      locale = localeSchema.parse(localeInput),
      current = await this.settings(this.db);
    assert(current.revision === revision, "REVISION_CONFLICT", 409);
    let candidate: string | LegalCandidate;
    try {
      candidate = await this.readCandidate(document, locale);
    } catch {
      assert(false, "LEGAL_CANDIDATE_UNAVAILABLE", 503);
    }
    const source =
      typeof candidate === "string" ? candidate : candidate.markdown;
    assert(source.trim().length > 0, "LEGAL_CANDIDATE_UNAVAILABLE", 503);
    // No interpolation with owner settings. The operator-only source adapter
    // supplies documented display changes and separate original editorial notes.
    const review =
      typeof candidate === "string"
        ? undefined
        : {
            source: candidate.source,
            notes: candidate.notes.map((note, index) => ({
              key: note.key,
              locale: note.locale,
              // Separate documents must not create duplicate anchor IDs in the DOM.
              html: renderPublicationMarkdown(note.markdown).html.replaceAll(
                'id="publication-',
                'id="legal-note-' + index + "-publication-",
              ),
            })),
          };
    return {
      document,
      locale,
      revision,
      title: document,
      sourceAvailable: true,
      releaseBlocked: true,
      review,
      ...renderPublicationMarkdown(source),
    };
  }
}
