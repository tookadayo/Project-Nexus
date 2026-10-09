import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { LegalReviewManifest } from "../../apps/operator/src/legal-candidates";
import type {
  LegalDocument,
  LegalLocale,
} from "../../packages/operations/src/publication";

// Generated test markers, not contractual or policy language. Never a runtime fallback.
export async function createSyntheticLegalFixture() {
  const directory = await mkdtemp(join(tmpdir(), "nexus-legal-fixture-"));
  const sources = {
    ja: "",
    en: "",
    conditions: "# TEST_INTEGRATION_NOTES\n\nTEST ONLY: integration marker.\n",
    announcements:
      "# TEST_ANNOUNCEMENT_NOTES\n\nTEST ONLY: announcement marker.\n",
  };
  const layouts = {} as LegalReviewManifest["layouts"];
  const bodies = { ja: {}, en: {} } as Record<
    LegalLocale,
    Record<LegalDocument, string>
  >;
  const editorialMarker = "## TEST_EDITORIAL_DRAFT\n";
  for (const locale of ["ja", "en"] as const) {
    const label = locale.toUpperCase();
    layouts[locale] = {
      boundaries: {
        terms: "# TEST_TERMS_" + label + "\n",
        privacy: "# TEST_PRIVACY_" + label + "\n",
        beta: "# TEST_Hosted Beta_" + label + "\n",
        ...(locale === "ja" ? { appendix: "# TEST_EDITORIAL_APPENDIX\n" } : {}),
      },
      sections: {
        terms: {
          prefix: locale === "ja" ? "## 第" : "# Section ",
          suffix: locale === "ja" ? "条" : ".",
        },
        privacy: { prefix: locale === "ja" ? "## " : "# ", suffix: "." },
      },
      editorial: {
        terms: locale === "en" ? [editorialMarker] : [],
        privacy: locale === "en" ? [editorialMarker] : [],
        beta: locale === "en" ? [editorialMarker] : [],
      },
    };
    const sectionText = (document: "terms" | "privacy", count: number) =>
      Array.from({ length: count }, (_, index) => {
        const spec = layouts[locale].sections[document];
        return (
          spec.prefix +
          (index + 1) +
          spec.suffix +
          " TEST_" +
          document.toUpperCase() +
          "_" +
          label +
          "_" +
          (index + 1) +
          "\n\nTEST ONLY: fixture text " +
          (index + 1) +
          ".\n"
        );
      }).join("\n");
    for (const document of ["terms", "privacy", "beta"] as const) {
      bodies[locale][document] =
        layouts[locale].boundaries[document] +
        "\n" +
        (locale === "en" ? editorialMarker + "\n" : "") +
        "TEST ONLY: not legal terms or a privacy policy. TEST_BODY_" +
        label +
        "_" +
        document +
        "\n\n" +
        (document === "beta"
          ? "- TEST_BETA_ITEM\n"
          : sectionText(document, document === "terms" ? 12 : 14)) +
        (document === "privacy"
          ? "\n| TEST_COLUMN_A | TEST_COLUMN_B |\n| --- | --- |\n" +
            Array.from(
              { length: 5 },
              (_, index) =>
                "| TEST_ROW_" + index + " | TEST_CELL_" + index + " |",
            ).join("\n") +
            "\n"
          : "") +
        "\nTEST_END_" +
        label +
        "_" +
        document +
        "\n\n";
    }
    sources[locale] =
      "# TEST_SOURCE_INTRO_" +
      label +
      "\n\nTEST ONLY: synthetic review input.\n\n" +
      bodies[locale].terms +
      bodies[locale].privacy +
      bodies[locale].beta +
      (locale === "ja"
        ? layouts.ja.boundaries.appendix + "\nTEST_EDITORIAL_END\n"
        : "");
  }
  const specs = {} as LegalReviewManifest["sources"];
  for (const key of ["ja", "en", "conditions", "announcements"] as const) {
    const bytes = Buffer.from(sources[key], "utf8");
    specs[key] = {
      fileName: "test-" + key + ".md",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    await writeFile(join(directory, specs[key].fileName), bytes);
  }
  const manifest: LegalReviewManifest = {
    schemaVersion: 1,
    status: "UNPUBLISHED_REVIEW_ONLY",
    sources: specs,
    layouts,
    reviewVersion: "test-only",
    reviewDate: "2000-01-01",
    presentationRevision: "test-only-closed-beta-label",
  };
  const manifestPath = join(directory, "review-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const contactsPath = join(directory, "test-contacts.json");
  await writeFile(
    contactsPath,
    JSON.stringify({
      supportEmail: "support@example.invalid",
      rightsEmail: "privacy@example.invalid",
      confirmedOn: "2000-01-01",
    }),
  );
  return {
    directory,
    manifestPath,
    manifest,
    sources,
    bodies,
    editorialMarker,
    contactsPath,
    cleanup: async () => {
      const target = resolve(directory);
      if (
        dirname(target) !== resolve(tmpdir()) ||
        !basename(target).startsWith("nexus-legal-fixture-")
      )
        throw new Error("UNEXPECTED_FIXTURE_DIRECTORY");
      await rm(target, { recursive: true, force: true });
    },
  };
}
