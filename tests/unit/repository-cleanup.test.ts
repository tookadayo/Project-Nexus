import { it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
// These exact historical relative links were delivered inside immutable source
// documents. The hashes check received-document identity, not link resolution.
// One document is retained at a different archive path; the support-design
// document was not among the six received alpha15 originals. Never fabricate it
// or rewrite the originals to make a maintained-document link check pass.
const archivalReferences: {source: string; target: string; sourceSha256: string; retainedTarget?: string; retainedSha256?: string}[] = [
  {source: "docs/design/alpha15-scratch-source/NEXUS-alpha15-scratch-opcode-trace.md", target: "canonical/prior-six-documents/NEXUS-alpha15-practical-blocks-integrated.md", sourceSha256: "494eebf3b9ac5a432532927c1aa141482b5b5737dbcc228b029e621f15898433", retainedTarget: "docs/design/alpha15-source/NEXUS-alpha15-practical-blocks-integrated.md", retainedSha256: "eb26c9567b8cbe567a451072b1cb97142eda4cf7036622ade2dd76edf6684ffa"},
  {source: "docs/design/alpha15-source/NEXUS-alpha15-practical-blocks-integrated.md", target: "NEXUS-alpha15-input-support-design.md", sourceSha256: "eb26c9567b8cbe567a451072b1cb97142eda4cf7036622ade2dd76edf6684ffa"},
];
const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const markdownFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? markdownFiles(join(directory, entry.name))
      : entry.name.endsWith(".md")
        ? [join(directory, entry.name)]
        : [],
  );
it("keeps maintained documentation links resolvable and accounts for exact immutable-source references", () => {
  const broken: string[] = [];
  const seenArchives: string[] = [];
  for (const file of ["README.md", ...markdownFiles("docs")]) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1]!.replace(/^<|>$/g, "");
      if (/^(?:https?:|mailto:|#|\/)/.test(target)) continue;
      const local = decodeURIComponent(target.split("#")[0]!.split("?")[0]!);
      if (local && !existsSync(resolve(dirname(file), local))) {
        const archive = archivalReferences.find(reference => reference.source === file.replace(/\\/g, "/") && reference.target === target);
        if (!archive) {broken.push(`${file}: ${target}`); continue;}
        expect(sha256(file), `Immutable original: ${archive.source}`).toBe(archive.sourceSha256);
        if (archive.retainedTarget) {
          expect(existsSync(archive.retainedTarget), `Retained counterpart: ${archive.retainedTarget}`).toBe(true);
          expect(sha256(archive.retainedTarget)).toBe(archive.retainedSha256);
        }
        seenArchives.push(`${archive.source}: ${archive.target}`);
      }
    }
  }
  expect(broken).toEqual([]);
  // A new missing reference is never covered by a directory-wide exclusion;
  // a later recovered reference also requires explicitly retiring its exception.
  expect(seenArchives.sort()).toEqual(archivalReferences.map(reference => `${reference.source}: ${reference.target}`).sort());
});
it("preserves shipped migrations, Windows entrypoints and the new public billing API", () => {
  for (let version = 1; version <= 37; version++)
    expect(
      readdirSync("migrations").some(
        (name) =>
          name.startsWith(String(version).padStart(3, "0") + "_") &&
          !name.endsWith(".down.sql"),
      ),
    ).toBe(true);
  for (const file of [
    "起動用/開発用/NEXUS SETUP.cmd",
    "起動用/開発用/NEXUS STATUS.cmd",
    "起動用/開発用/NEXUS DOCTOR.cmd",
    "起動用/開発用/START NEXUS.cmd",
    "起動用/開発用/STOP NEXUS.cmd",
    "起動用/開発用/RESTART NEXUS.cmd",
    "packages/settings/src/billing/index.ts",
    "apps/web/app/billing/webhooks/stripe/route.ts",
  ])
    expect(existsSync(file)).toBe(true);
  expect(existsSync("apps/web/app/billing/webhooks/external/route.ts")).toBe(
    false,
  );
  expect(
    readdirSync(".").filter((file) => /^NEXUS v.*\.md$/.test(file)),
  ).toEqual([]);
});
