import { createHash } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLegalCandidateLoader,
  legalDisplayMarkdown,
  partitionLegalSource,
  readLegalCandidate,
  verifiedLegalSource,
} from "../../apps/operator/src/legal-candidates";
import type {
  LegalCandidate,
  LegalLocale,
} from "../../packages/operations/src/publication";
import { renderPublicationMarkdown } from "../../packages/shared/src/publication-markdown";
import { createSyntheticLegalFixture } from "../fixtures/legal-candidates";

let fixture: Awaited<ReturnType<typeof createSyntheticLegalFixture>>;
beforeEach(async () => {
  fixture = await createSyntheticLegalFixture();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fixture.cleanup();
});
const loader = () => createLegalCandidateLoader(fixture.manifestPath);
const updateManifest = () =>
  writeFile(fixture.manifestPath, JSON.stringify(fixture.manifest));

describe("explicit local legal review inputs", () => {
  it("is unavailable by default and never substitutes synthetic documents", async () => {
    vi.stubEnv("NEXUS_LEGAL_REVIEW_MANIFEST", "");
    await expect(readLegalCandidate("terms", "ja")).rejects.toThrow(
      "LEGAL_CANDIDATE_UNAVAILABLE",
    );
    for (const path of [
      "relative/manifest.json",
      "//server/share/manifest.json",
      String.raw`\\server\share\manifest.json`,
      String.raw`\\?\C:\manifest.json`,
    ]) {
      await expect(
        createLegalCandidateLoader(path)("terms", "ja"),
      ).rejects.toThrow("LEGAL_CANDIDATE_UNAVAILABLE");
    }
  });
  it("loads only the explicitly configured manifest and exposes the same metadata DTO", async () => {
    vi.stubEnv("NEXUS_LEGAL_REVIEW_MANIFEST", fixture.manifestPath);
    const candidate = (await readLegalCandidate(
      "terms",
      "ja",
    )) as LegalCandidate;
    expect(candidate.source).toEqual({
      ...fixture.manifest.sources.ja,
      reviewVersion: "test-only",
      reviewDate: "2000-01-01",
      presentationRevision: "test-only-closed-beta-label",
    });
    expect(candidate.markdown).toContain("TEST_BODY_JA_terms");
  });
  for (const locale of ["ja", "en"] as const) {
    it(
      "partitions every character once and validates complete numbered sections: " +
        locale,
      () => {
        const source = fixture.sources[locale],
          layout = fixture.manifest.layouts[locale];
        const parts = partitionLegalSource(source, layout);
        expect(Object.values(parts).join("")).toBe(source);
        expect(parts.terms).toBe(fixture.bodies[locale].terms);
        expect(parts.privacy).toBe(fixture.bodies[locale].privacy);
        expect(parts.beta).toBe(fixture.bodies[locale].beta);
        expect(parts.beta).not.toContain("TEST_EDITORIAL_END");
        expect(() =>
          partitionLegalSource(
            source.replace(
              layout.boundaries.privacy,
              "# TEST_BROKEN_BOUNDARY\n",
            ),
            layout,
          ),
        ).toThrow("LEGAL_CANDIDATE_UNAVAILABLE");
        expect(() =>
          partitionLegalSource(source + layout.boundaries.privacy, layout),
        ).toThrow("LEGAL_CANDIDATE_UNAVAILABLE");
        const prefix = layout.sections.terms.prefix;
        expect(() =>
          partitionLegalSource(
            source.replace(prefix + "12", prefix + "11"),
            layout,
          ),
        ).toThrow("LEGAL_CANDIDATE_UNAVAILABLE");
      },
    );
    for (const document of ["terms", "privacy", "beta"] as const) {
      it(
        "preserves the private body and separates editorial notes: " +
          locale +
          " " +
          document,
        async () => {
          const candidate = (await loader()(
            document,
            locale,
          )) as LegalCandidate;
          expect(candidate.markdown).toContain(
            "TEST_END_" + locale.toUpperCase() + "_" + document,
          );
          expect(candidate.markdown).not.toMatch(
            /TEST_SOURCE_INTRO|TEST_EDITORIAL|TEST_INTEGRATION_NOTES|TEST_ANNOUNCEMENT_NOTES|Hosted Beta/,
          );
          expect(
            candidate.notes.find((note) => note.key === "sourceIntroduction")
              ?.markdown,
          ).toContain("TEST_SOURCE_INTRO_" + locale.toUpperCase());
          expect(
            candidate.notes.find((note) => note.key === "editorialAppendix"),
          ).toMatchObject({ locale: "ja" });
          expect(
            candidate.notes.find((note) => note.key === "editorialAppendix")
              ?.markdown,
          ).toContain("TEST_EDITORIAL_END");
          expect(
            candidate.notes.find((note) => note.key === "integrationConditions")
              ?.markdown,
          ).toBe(fixture.sources.conditions);
          expect(
            candidate.notes.find((note) => note.key === "announcementsDesign")
              ?.markdown,
          ).toBe(fixture.sources.announcements);
          if (locale === "en")
            expect(
              candidate.notes.find((note) => note.key === "documentEditorial")
                ?.markdown,
            ).toBe(fixture.editorialMarker);
          const html = renderPublicationMarkdown(candidate.markdown);
          const clauses = html.headings.filter((heading) =>
            /^第\d+条|^(?:Section )?\d+\./.test(heading.text),
          );
          expect(clauses).toHaveLength(
            document === "terms" ? 12 : document === "privacy" ? 14 : 0,
          );
          expect(clauses.every((heading) => heading.level === 3)).toBe(true);
          expect(html.html).not.toMatch(/<script|<iframe|<img|<form|mailto:/i);
          if (document === "privacy")
            expect(html.html.match(/<tr>/g)).toHaveLength(6);
        },
      );
    }
  }
  it("rejects truncated, altered, invalid UTF-8 and oversized source bytes", () => {
    const spec = fixture.manifest.sources.ja,
      bytes = Buffer.from(fixture.sources.ja);
    expect(() => verifiedLegalSource(spec, bytes.subarray(0, -1))).toThrow(
      "LEGAL_CANDIDATE_UNAVAILABLE",
    );
    const altered = Buffer.from(bytes);
    altered[200] = altered[200]! ^ 1;
    expect(() => verifiedLegalSource(spec, altered)).toThrow(
      "LEGAL_CANDIDATE_UNAVAILABLE",
    );
    const invalid = Buffer.from([0xff]);
    expect(() =>
      verifiedLegalSource(
        {
          ...spec,
          bytes: 1,
          sha256: createHash("sha256").update(invalid).digest("hex"),
        },
        invalid,
      ),
    ).toThrow("LEGAL_CANDIDATE_UNAVAILABLE");
    expect(() =>
      verifiedLegalSource({ ...spec, bytes: 3 * 1024 * 1024 }, bytes),
    ).toThrow("LEGAL_CANDIDATE_UNAVAILABLE");
  });
  it("does not cache a candidate after a source is modified or removed", async () => {
    const read = loader(),
      path = join(fixture.directory, fixture.manifest.sources.ja.fileName);
    await expect(read("terms", "ja")).resolves.toBeTruthy();
    await writeFile(path, fixture.sources.ja + "altered");
    await expect(read("terms", "ja")).rejects.toThrow(
      "LEGAL_CANDIDATE_UNAVAILABLE",
    );
    await unlink(path);
    await expect(read("terms", "ja")).rejects.toThrow(
      "LEGAL_CANDIDATE_UNAVAILABLE",
    );
  });
  it("requires every referenced input and rejects an altered supporting note", async () => {
    await writeFile(
      join(fixture.directory, fixture.manifest.sources.conditions.fileName),
      "changed",
    );
    await expect(loader()("terms", "en")).rejects.toThrow(
      "LEGAL_CANDIDATE_UNAVAILABLE",
    );
  });
  it("refuses source traversal, unknown manifest fields and malformed manifests without private diagnostics", async () => {
    for (const fileName of [
      "../private.md",
      "..\\private.md",
      "C:\\private.md",
      "/private.md",
    ]) {
      fixture.manifest.sources.ja.fileName = fileName;
      await updateManifest();
      await expect(loader()("terms", "ja")).rejects.toThrow(
        /^LEGAL_CANDIDATE_UNAVAILABLE$/,
      );
    }
    fixture.manifest.sources.ja.fileName = "test-ja.md";
    await writeFile(
      fixture.manifestPath,
      JSON.stringify({ ...fixture.manifest, extra: "TEST_PRIVATE_DIAGNOSTIC" }),
    );
    await expect(loader()("terms", "ja")).rejects.toThrow(
      /^LEGAL_CANDIDATE_UNAVAILABLE$/,
    );
    await writeFile(fixture.manifestPath, "{");
    await expect(loader()("terms", "ja")).rejects.toThrow(
      /^LEGAL_CANDIDATE_UNAVAILABLE$/,
    );
  });
  it("rejects oversized or invalid UTF-8 manifests and oversized source files", async () => {
    await writeFile(fixture.manifestPath, Buffer.alloc(64 * 1024 + 1, 32));
    await expect(loader()("terms", "ja")).rejects.toThrow(
      "LEGAL_CANDIDATE_UNAVAILABLE",
    );
    await writeFile(fixture.manifestPath, Buffer.from([0xff]));
    await expect(loader()("terms", "ja")).rejects.toThrow(
      "LEGAL_CANDIDATE_UNAVAILABLE",
    );
    await updateManifest();
    await writeFile(
      join(fixture.directory, fixture.manifest.sources.ja.fileName),
      Buffer.alloc(2 * 1024 * 1024 + 1, 32),
    );
    await expect(loader()("terms", "ja")).rejects.toThrow(
      "LEGAL_CANDIDATE_UNAVAILABLE",
    );
  });
  it("rejects absent or repeated editorial spans instead of losing body text", async () => {
    fixture.manifest.layouts.en.editorial.terms = ["TEST_MISSING_EDITORIAL"];
    await updateManifest();
    await expect(loader()("terms", "en")).rejects.toThrow(
      "LEGAL_CANDIDATE_UNAVAILABLE",
    );
    fixture.manifest.layouts.en.editorial.terms = [fixture.bodies.en.terms];
    await updateManifest();
    await expect(loader()("terms", "en")).rejects.toThrow(
      "LEGAL_CANDIDATE_UNAVAILABLE",
    );
    fixture.manifest.layouts.en.editorial.terms = ["TEST ONLY"];
    await updateManifest();
    await expect(loader()("terms", "en")).rejects.toThrow(
      "LEGAL_CANDIDATE_UNAVAILABLE",
    );
  });
  it("refuses unknown documents and locales before reading any source", async () => {
    await expect(loader()("../private" as "terms", "ja")).rejects.toThrow(
      "LEGAL_CANDIDATE_UNAVAILABLE",
    );
    await expect(
      loader()("terms", "../private" as LegalLocale),
    ).rejects.toThrow("LEGAL_CANDIDATE_UNAVAILABLE");
  });
  it("changes only the existing presentation label and English heading levels", async () => {
    expect(
      legalDisplayMarkdown("# TEST Hosted Beta1\n# Section 7. TEST", "en"),
    ).toBe("# TEST Closed Beta 1\n## Section 7. TEST");
    await loader()("terms", "ja");
    expect(
      await readFile(
        join(fixture.directory, fixture.manifest.sources.ja.fileName),
        "utf8",
      ),
    ).toBe(fixture.sources.ja);
  });
});
