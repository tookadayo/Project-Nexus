/** Server-only artifact loader. Do not export from the browser automation entry point. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ScratchMpfrEngine, type ScratchMpfrBinding } from "./scratch-mpfr.js";

export const SCRATCH_MPFR_ARTIFACT = Object.freeze({
  package: "gmp-wasm", packageVersion: "1.3.2", mpfrVersion: "4.2.1",
  sourceCommit: "4e372e5a3c4a65f871e1bcaab63c78b29dc80ff8",
  bundleSha256: "76af404a6521699a9f2a0dd3fc34a48368b470cc5044e1fa8e5e480a3deae55a",
  wasmSha256: "ca1f8def552c30d44c67247d0a959bbf17e022d1e5999889ce4b9922f5211909",
});
let startup: Promise<ScratchMpfrEngine> | undefined;
export function loadScratchMpfrEngine(): Promise<ScratchMpfrEngine> {
  startup ??= initialize();
  return startup;
}
async function initialize(): Promise<ScratchMpfrEngine> {
  const artifact = new URL("../vendor/math-engine/gmp-wasm-1.3.2/index.cjs", import.meta.url);
  const actualHash = createHash("sha256").update(readFileSync(artifact)).digest("hex");
  if (actualHash !== SCRATCH_MPFR_ARTIFACT.bundleSha256) throw new Error("ScratchMpfrArtifactHashMismatch");
  const library = createRequire(import.meta.url)(fileURLToPath(artifact)) as {
    init(): Promise<{ binding: ScratchMpfrBinding & { mem: Uint8Array; mpfr_get_version(): number } }>;
  };
  const { binding } = await library.init();
  const pointer = binding.mpfr_get_version();
  const version = new TextDecoder().decode(binding.mem.subarray(pointer, binding.mem.indexOf(0, pointer)));
  if (version !== SCRATCH_MPFR_ARTIFACT.mpfrVersion) throw new Error("ScratchMpfrArtifactVersionMismatch");
  return new ScratchMpfrEngine(binding);
}
