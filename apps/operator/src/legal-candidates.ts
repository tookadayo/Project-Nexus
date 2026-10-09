import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import type {
  LegalCandidate,
  LegalCandidateLoader,
  LegalDocument,
  LegalLocale,
} from "../../../packages/operations/src/publication";

// Only the separate authenticated operator server imports this module.
// Private review inputs live outside the repository and are never public assets.
const unavailable = "LEGAL_CANDIDATE_UNAVAILABLE";
const sourceLimit = 2 * 1024 * 1024;
const sourceSchema = z
  .object({
    fileName: z
      .string()
      .min(1)
      .max(180)
      .regex(/^[^\\/:*?"<>|]+\.md$/u)
      .refine(
        (name) =>
          name !== ".md" &&
          !name.startsWith(".") &&
          [...name].every(
            (character) =>
              character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
          ),
      ),
    bytes: z.number().int().positive().max(sourceLimit),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const marker = z
  .string()
  .min(1)
  .max(1000)
  .refine((value) => value.endsWith("\n"));
const section = z
  .object({
    prefix: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[^\r\n]+$/),
    suffix: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[^\r\n]+$/),
  })
  .strict();
const layoutSchema = z
  .object({
    boundaries: z
      .object({
        terms: marker,
        privacy: marker,
        beta: marker,
        appendix: marker.optional(),
      })
      .strict(),
    sections: z.object({ terms: section, privacy: section }).strict(),
    editorial: z
      .object({
        terms: z.array(z.string().min(1).max(20000)).max(10),
        privacy: z.array(z.string().min(1).max(20000)).max(10),
        beta: z.array(z.string().min(1).max(20000)).max(10),
      })
      .strict(),
  })
  .strict();
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.literal("UNPUBLISHED_REVIEW_ONLY"),
    sources: z
      .object({
        ja: sourceSchema,
        en: sourceSchema,
        conditions: sourceSchema,
        announcements: sourceSchema,
      })
      .strict(),
    layouts: z.object({ ja: layoutSchema, en: layoutSchema }).strict(),
    reviewVersion: z.string().min(1).max(100),
    reviewDate: z.iso.date(),
    presentationRevision: z.string().min(1).max(100),
  })
  .strict()
  .refine((value) => Boolean(value.layouts.ja.boundaries.appendix));
export type LegalReviewManifest = z.infer<typeof manifestSchema>;
export type LegalSourceSpec = z.infer<typeof sourceSchema>;
type SourceLayout = z.infer<typeof layoutSchema>;

function ensure(condition: unknown): asserts condition {
  if (!condition) throw new Error(unavailable);
}
async function readBounded(path: string, limit: number) {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    ensure(info.isFile() && info.size > 0 && info.size <= limit);
    const bytes = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const chunk = await handle.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (chunk.bytesRead === 0) break;
      length += chunk.bytesRead;
    }
    ensure(length === info.size);
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}
function decode(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}
export function verifiedLegalSource(spec: LegalSourceSpec, bytes: Uint8Array) {
  ensure(sourceSchema.safeParse(spec).success && bytes.length === spec.bytes);
  ensure(createHash("sha256").update(bytes).digest("hex") === spec.sha256);
  try {
    return decode(bytes);
  } catch {
    throw new Error(unavailable);
  }
}
async function readSource(directory: string, spec: LegalSourceSpec) {
  const file = await realpath(join(directory, spec.fileName));
  // A basename in the manifest cannot escape through a symlink or junction.
  ensure(dirname(file) === directory);
  return verifiedLegalSource(spec, await readBounded(file, sourceLimit));
}
const escapePattern = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lossless ranges: concatenation reproduces the verified input exactly. */
export function partitionLegalSource(source: string, layout: SourceLayout) {
  const markers = [
    layout.boundaries.terms,
    layout.boundaries.privacy,
    layout.boundaries.beta,
    ...(layout.boundaries.appendix ? [layout.boundaries.appendix] : []),
  ];
  const positions = markers.map((marker) => {
    const index = source.indexOf(marker);
    ensure(index > 0 && source[index - 1] === "\n");
    ensure(source.indexOf(marker, index + marker.length) === -1);
    return index;
  });
  ensure(
    positions.every(
      (position, index) => index === 0 || position > positions[index - 1]!,
    ),
  );
  const [terms, privacy, beta, appendix = source.length] = positions as [
    number,
    number,
    number,
    number?,
  ];
  const result = {
    introduction: source.slice(0, terms),
    terms: source.slice(terms, privacy),
    privacy: source.slice(privacy, beta),
    beta: source.slice(beta, appendix),
    appendix: source.slice(appendix),
  };
  for (const [document, total] of [
    ["terms", 12],
    ["privacy", 14],
  ] as const) {
    const { prefix, suffix } = layout.sections[document];
    const pattern = new RegExp(
      "^" + escapePattern(prefix) + "(\\d+)" + escapePattern(suffix),
      "gm",
    );
    const numbers = [...result[document].matchAll(pattern)].map((match) =>
      Number(match[1]),
    );
    ensure(
      numbers.length === total &&
        numbers.every((number, index) => number === index + 1),
    );
  }
  return result;
}

/** Presentation only: verified local files remain unchanged. */
export function legalDisplayMarkdown(source: string, locale: LegalLocale) {
  const markdown = source.replace(/Hosted Beta(?:\s?1)?/g, "Closed Beta 1");
  return locale === "en"
    ? markdown.replace(/^# ((?:Section )?\d+\.)/gm, "## $1")
    : markdown;
}

export function createLegalCandidateLoader(
  manifestPath?: string,
): LegalCandidateLoader {
  return async (document, locale) => {
    try {
      ensure(["terms", "privacy", "beta"].includes(document));
      ensure(locale === "ja" || locale === "en");
      ensure(
        manifestPath &&
          isAbsolute(manifestPath) &&
          !/^[\\/]{2}/.test(manifestPath),
      );
      // Re-read every time: no stale candidate survives deletion or alteration.
      const path = await realpath(manifestPath);
      ensure(!/^[\\/]{2}/.test(path));
      const manifest = manifestSchema.parse(
        JSON.parse(decode(await readBounded(path, 64 * 1024))),
      );
      const directory = dirname(path);
      const [source, japanese, conditions, announcements] = await Promise.all([
        readSource(directory, manifest.sources[locale]),
        locale === "ja"
          ? Promise.resolve(null)
          : readSource(directory, manifest.sources.ja),
        readSource(directory, manifest.sources.conditions),
        readSource(directory, manifest.sources.announcements),
      ]);
      const layout = manifest.layouts[locale];
      const parts = partitionLegalSource(source, layout);
      let body = parts[document as LegalDocument];
      const notes: LegalCandidate["notes"] = [
        { key: "sourceIntroduction", locale, markdown: parts.introduction },
      ];
      const editorial = layout.editorial[document];
      for (const note of editorial) {
        ensure(body.split(note).length === 2);
        body = body.replace(note, "");
      }
      ensure(body.trim().length > 0);
      if (editorial.length)
        notes.push({
          key: "documentEditorial",
          locale,
          markdown: editorial.join("\n\n"),
        });
      notes.push(
        {
          key: "editorialAppendix",
          locale: "ja",
          markdown:
            locale === "ja"
              ? parts.appendix
              : partitionLegalSource(japanese!, manifest.layouts.ja).appendix,
        },
        { key: "integrationConditions", locale: "ja", markdown: conditions },
        { key: "announcementsDesign", locale: "ja", markdown: announcements },
      );
      return {
        markdown: legalDisplayMarkdown(body, locale),
        source: {
          ...manifest.sources[locale],
          reviewVersion: manifest.reviewVersion,
          reviewDate: manifest.reviewDate,
          presentationRevision: manifest.presentationRevision,
        },
        notes,
      };
    } catch {
      // Do not expose a private path, manifest value or filesystem diagnostic.
      throw new Error(unavailable);
    }
  };
}

export const readLegalCandidate: LegalCandidateLoader = (document, locale) =>
  createLegalCandidateLoader(process.env.NEXUS_LEGAL_REVIEW_MANIFEST)(
    document,
    locale,
  );
