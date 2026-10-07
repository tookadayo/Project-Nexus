import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const files = execFileSync(
  "git",
  ["ls-files", "-co", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const detectors = [
  ["Stripe API key", /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9_]{12,}/g],
  ["Stripe webhook secret", /\bwhsec_[A-Za-z0-9_]{12,}/g],
  [
    "Discord client secret",
    /DISCORD_CLIENT_SECRET\s*[:=]\s*["']([A-Za-z0-9_-]{24,})["']/g,
  ],
  [
    "Session secret",
    /NEXUS_SESSION_SECRET\s*[:=]\s*["']([A-Za-z0-9_-]{32,})["']/g,
  ],
] as const;
const findings: string[] = [];
for (const file of new Set(files)) {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const [category, pattern] of detectors)
    for (const match of source.matchAll(pattern)) {
      const token = match[1] ?? match[0];
      // Explicit, deliberately invalid test credentials are allowed only in tests.
      if (
        file.startsWith("tests/") &&
        /(?:fixture|fake|invalid|dummy|placeholder)/i.test(token)
      )
        continue;
      if (file === "scripts/secret-scan.ts") continue;
      findings.push(`${file}: ${category}`);
    }
}
if (findings.length) {
  process.stderr.write(
    "Potential secrets detected (values redacted):\n" +
      [...new Set(findings)].join("\n") +
      "\n",
  );
  process.exitCode = 1;
} else
  process.stdout.write(
    `Secret scan passed (${new Set(files).size} source files; values never printed).\n`,
  );
