import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "node:console";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prefix = "gmp-wasm-4e372e5a3c4a65f871e1bcaab63c78b29dc80ff8/";
const upstream = resolve(root, "source/gmp-wasm-4e372e5a3c4a65f871e1bcaab63c78b29dc80ff8.tar.gz");
const npm = resolve(root, "source/gmp-wasm-1.3.2.npm.tgz");
const listing = archive => execFileSync("tar", ["-tf", archive], { encoding: "utf8" }).split(/\r?\n/).filter(path => path && !path.endsWith("/"));
const npmPaths = new Set(listing(npm).map(path => path.replace(/^package\//, "")));
const shared = listing(upstream).filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length)).filter(path => npmPaths.has(path));
const read = (archive, path) => execFileSync("tar", ["-xOf", archive, path], { maxBuffer: 8 * 1024 * 1024 });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const compared = shared.map(path => {
  const first = read(upstream, prefix + path), second = read(npm, "package/" + path);
  if (!first.equals(second)) throw new Error(`NpmCommitSharedFileMismatch: ${path}`);
  return { path, sha256: digest(first) };
});
if (compared.length !== 38) throw new Error(`UnexpectedSharedFileCount: ${compared.length}`);
const original = read(npm, "package/dist/index.umd.js");
const runtime = readFileSync(resolve(root, "gmp-wasm-1.3.2/index.cjs"));
if (!original.equals(runtime)) throw new Error("RuntimeBundleNpmMismatch");
log(JSON.stringify({ success: true, sharedFileCount: compared.length, sharedFiles: compared, runtimeBundleMatchesNpm: true, bundleSha256: digest(runtime), binaryRebuildVerified: false }, null, 2));
