import { it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
const markdownFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? markdownFiles(join(directory, entry.name))
      : entry.name.endsWith(".md")
        ? [join(directory, entry.name)]
        : [],
  );
it("keeps documentation links resolvable after archival and indexing", () => {
  const broken: string[] = [];
  for (const file of ["README.md", ...markdownFiles("docs")]) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1]!.replace(/^<|>$/g, "");
      if (/^(?:https?:|mailto:|#|\/)/.test(target)) continue;
      const local = decodeURIComponent(target.split("#")[0]!.split("?")[0]!);
      if (local && !existsSync(resolve(dirname(file), local)))
        broken.push(`${file}: ${target}`);
    }
  }
  expect(broken).toEqual([]);
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
    "NEXUS SETUP.cmd",
    "NEXUS STATUS.cmd",
    "NEXUS DOCTOR.cmd",
    "START NEXUS.cmd",
    "STOP NEXUS.cmd",
    "RESTART NEXUS.cmd",
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
