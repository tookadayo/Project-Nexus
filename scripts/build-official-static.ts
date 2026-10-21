import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { buildOfficialStatic } from "../packages/presentation/src/alpha16-publication";

/** Offline preparation only: no ENV, server import, DB, auth or publisher. A
 * new generation directory is created exclusively; no prior artifact is edited. */
export async function writeOfficialStatic(inputPath: string, outputRoot: string, now: number) {
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const result = buildOfficialStatic(input, now);
  const root = resolve(outputRoot), generationRoot = resolve(root, `generation-${result.manifest.generation}`);
  await mkdir(root, { recursive: true });
  await mkdir(generationRoot, { recursive: false });
  for (const [name, content] of Object.entries(result.files)) {
    const destination = resolve(generationRoot, name), child = relative(generationRoot, destination);
    if (isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) throw new Error("STATIC_OUTPUT_ESCAPE");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, { flag: "wx", encoding: "utf8" });
  }
  return { generationRoot, fileCount: Object.keys(result.files).length, readiness: result.readiness };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("Usage: tsx scripts/build-official-static.ts <approved-public-input.json> <local-output-directory>");
  const prepared = await writeOfficialStatic(input, output, Date.now());
  process.stdout.write(JSON.stringify({ ...prepared, published: false }) + "\n");
}
