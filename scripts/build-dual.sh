#!/usr/bin/env bash
# Build the dual site: the released v1 (git ref $V1_REF, default tag "v1") at /pathmap/
# and the current checkout at /pathmap/v2/, into $OUT (default dist-dual/).
#
#   dist-dual/index.html      <- v1 (unchanged release, its own vite config and base)
#   dist-dual/v2/index.html   <- HEAD built with PATHMAP_BASE=/pathmap/v2/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${OUT:-$ROOT/dist-dual}"
V1_REF="${V1_REF:-v1}"
V2_BASE="${V2_BASE:-/pathmap/v2/}"

cd "$ROOT"
rm -rf "$OUT"
mkdir -p "$OUT/v2"

echo "== building HEAD at $V2_BASE"
PATHMAP_BASE="$V2_BASE" npx vite build --outDir "$OUT/v2" --emptyOutDir

echo "== building $V1_REF at /pathmap/"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git archive "$V1_REF" | tar -x -C "$TMP"
(cd "$TMP" && npm ci --no-audit --no-fund --silent && npx vite build)
cp "$TMP/dist/index.html" "$OUT/index.html"

echo "== done: $OUT"
ls -la "$OUT" "$OUT/v2"
