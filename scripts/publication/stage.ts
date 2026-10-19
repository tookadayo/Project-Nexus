import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectOfficialBundle, stageOfficialBundle } from "../../packages/operations/src/alpha17-winscp-staging";

/** Explicit CLI only. It never imports ENV, a server, DB, Operator or a live
 * publisher. The default is a read-only local preflight. Even --execute-staging
 * remains closed until a reviewed host/provider private-root verifier exists;
 * a config-file boolean is not that verifier. */
export async function publicationStagingCommand(args: string[]) {
  const [configFile, bundleDirectory, mode] = args;
  if (args.length < 2 || args.length > 3 || !configFile || !bundleDirectory || mode !== undefined && mode !== "--execute-staging") {
    return { state: "NOT_STARTED", published: false, reasonCode: "STAGING_USAGE", usage: "tsx scripts/publication/stage.ts <non-secret-staging-config.json> <generation-directory> [--execute-staging]" };
  }
  try {
    const config = JSON.parse(await readFile(resolve(configFile), "utf8"));
    const input = { config, bundleDirectory: resolve(bundleDirectory) };
    return mode === "--execute-staging" ? stageOfficialBundle(input) : inspectOfficialBundle(input);
  } catch { return { state: "NOT_STARTED", published: false, reasonCode: "STAGING_INPUT_UNREADABLE" }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await publicationStagingCommand(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result) + "\n");
  if ("reasonCode" in result && result.reasonCode !== "STAGING_PREFLIGHT_ONLY") process.exitCode = 1;
}
