#!/bin/sh
# Build third-party sources only, in a new ignored .local working directory.
# This recipe was inspected, but not executed on the Windows audit host.
set -eu

SOURCE_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
VENDOR_DIR=$(CDPATH='' cd -- "$SOURCE_DIR/.." && pwd)
PROJECT_DIR=$(CDPATH='' cd -- "$VENDOR_DIR/../../../.." && pwd)
COMMIT=4e372e5a3c4a65f871e1bcaab63c78b29dc80ff8
for tool in node npm docker tar mktemp; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing preinstalled tool: $tool" >&2; exit 1; }
done
node "$SOURCE_DIR/verify-sources.mjs"
docker info >/dev/null
mkdir -p "$PROJECT_DIR/.local"
WORK_DIR=$(mktemp -d "$PROJECT_DIR/.local/math-engine-relink-XXXXXX")
tar -xzf "$SOURCE_DIR/gmp-wasm-$COMMIT.tar.gz" -C "$WORK_DIR"
UPSTREAM="$WORK_DIR/gmp-wasm-$COMMIT"
TAG=$(basename "$WORK_DIR" | tr '[:upper:]' '[:lower:]')

# build-gmp.sh skips extraction when the tar exists: flatten its contents first.
mkdir -p "$UPSTREAM/binding/gmp/src" "$UPSTREAM/binding/source-inputs"
tar -xJf "$SOURCE_DIR/gmp-6.3.0.tar.xz" -C "$UPSTREAM/binding/gmp/src" --strip-components=1
cp "$SOURCE_DIR/gmp-6.3.0.tar.xz" "$UPSTREAM/binding/gmp/src/gmp-6.3.0.tar.xz"
cp "$SOURCE_DIR/mpfr-4.2.1.tar.xz" "$UPSTREAM/binding/source-inputs/mpfr-4.2.1.tar.xz"

# Transport-only recipe patch: use our verified MPFR tar rather than RUN wget.
# The original Dockerfile remains in the pinned upstream archive.
node --input-type=module - "$UPSTREAM/binding/mpfr/Dockerfile" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
const path = process.argv[2];
const original = readFileSync(path, 'utf8');
const needle = 'RUN wget https://ftp.gnu.org/gnu/mpfr/mpfr-4.2.1.tar.xz && \\\n  tar xmf mpfr-4.2.1.tar.xz && \\\n  mkdir -p lib/mpfr && mv mpfr-4.2.1/* lib/mpfr';
const replacement = 'COPY ./source-inputs/mpfr-4.2.1.tar.xz /builder/mpfr-4.2.1.tar.xz\nRUN tar xmf mpfr-4.2.1.tar.xz && \\\n  mkdir -p lib/mpfr && mv mpfr-4.2.1/* lib/mpfr';
if (original.split(needle).length !== 2) throw new Error('PinnedMpfrRecipeChanged');
writeFileSync(path, original.replace(needle, replacement));
NODE

copy_output() {
  IMAGE=$1
  DEST=$2
  CONTAINER=$(docker create "$IMAGE")
  trap 'docker rm "$CONTAINER" >/dev/null 2>&1 || true' 0 HUP INT TERM
  docker cp "$CONTAINER:/builder/dist/." "$DEST"
  docker rm "$CONTAINER" >/dev/null
  trap - 0 HUP INT TERM
}
mkdir -p "$UPSTREAM/binding/gmp/dist" "$UPSTREAM/binding/mpfr/dist" "$UPSTREAM/binding/dist"
docker build -f "$UPSTREAM/binding/gmp/Dockerfile" "$UPSTREAM/binding" --tag "nexus-math-$TAG:gmp"
copy_output "nexus-math-$TAG:gmp" "$UPSTREAM/binding/gmp/dist"
docker build -f "$UPSTREAM/binding/mpfr/Dockerfile" "$UPSTREAM/binding" --tag "nexus-math-$TAG:mpfr"
copy_output "nexus-math-$TAG:mpfr" "$UPSTREAM/binding/mpfr/dist"
docker build -f "$UPSTREAM/binding/src/Dockerfile" "$UPSTREAM/binding" --tag "nexus-math-$TAG:binding"
copy_output "nexus-math-$TAG:binding" "$UPSTREAM/binding/dist"

# All JS dependency versions/integrities come from the pinned upstream lock.
# The cache stays inside this disposable build workspace; no host tool install.
(cd "$UPSTREAM" && npm ci --ignore-scripts --no-audit --no-fund --cache "$WORK_DIR/npm-cache" && npm run build-wasm-ts && npm run build-rollup && npm run build-types)
mkdir -p "$WORK_DIR/result"
cp "$UPSTREAM/dist/index.umd.js" "$WORK_DIR/result/index.cjs"
cp "$UPSTREAM/binding/dist/gmp.wasm" "$WORK_DIR/result/gmp.wasm"
node --input-type=module - "$WORK_DIR/result" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
const directory = process.argv[2];
const digest = name => createHash('sha256').update(readFileSync(join(directory, name))).digest('hex');
const record = { upstreamCommit: '4e372e5a3c4a65f871e1bcaab63c78b29dc80ff8', bundleSha256: digest('index.cjs'), wasmSha256: digest('gmp.wasm'), node: process.version, baselineByteReproductionClaimed: false };
writeFileSync(join(directory, 'rebuild-result.json'), JSON.stringify(record, null, 2) + '\n');
NODE
printf 'Rebuilt third-party outputs only: %s/result\nNo NEXUS runtime files were replaced. See the distribution document for private relinking and validation.\n' "$WORK_DIR"
