import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "node:console";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "SOURCES.json"), "utf8"));
let integrityChecks = 0;
for (const file of manifest.files) {
  const target = resolve(root, file.path);
  if (isAbsolute(file.path) || !target.startsWith(root + sep)) {
    throw new Error(`SourcePathOutsideVendorRoot: ${file.path}`);
  }
  const bytes = readFileSync(target);
  if (bytes.byteLength !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
    throw new Error(`SourceHashMismatch: ${file.path}`);
  }
  if (file.integrity) {
    const split = file.integrity.indexOf("-");
    const algorithm = file.integrity.slice(0, split);
    if (algorithm !== "sha512" || createHash(algorithm).update(bytes).digest("base64") !== file.integrity.slice(split + 1)) {
      throw new Error(`SourceIntegrityMismatch: ${file.path}`);
    }
    integrityChecks++;
  }
}
log(JSON.stringify({ success: true, sha256Checks: manifest.files.length, npmIntegrityChecks: integrityChecks, rebuildExecuted: false, detachedSignaturesVerified: false }, null, 2));
