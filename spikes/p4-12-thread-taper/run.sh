#!/usr/bin/env bash
# Builds harness.cpp against the facade and OCCT's static WASM libraries in the
# pinned image and runs it under node (P4-12, ADR-0056's third amendment:
# tapered threads on conical faces). Usage from the repo root:
#   bash spikes/p4-12-thread-taper/run.sh            # helix radii, NPT 1/2 on a cone, the mean-diameter comparison
#   bash spikes/p4-12-thread-taper/run.sh leaks 300  # heap top over rounds of a tapered sweep and its cut
#   bash spikes/p4-12-thread-taper/run.sh compare    # straight threads: this facade against main's (OLD=1 build)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${OCCT_IMAGE:-ghcr.io/taucad/opencascade.js:3.0.2-single-threaded}"
OPT="${OPT:--O1}"
LIBS="TKDESTEP TKXSBase TKDE TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d TKG2d TKMath TKernel TKMesh"
LINK=""
for lib in $LIBS; do LINK="$LINK /opencascade.js/build/occt-libraries/lib$lib.a"; done
DIR="$ROOT/spikes/p4-12-thread-taper"
mkdir -p "$DIR/build"
if [ "${1:-}" = compare ]; then
  # main's facade, for the straight thread built the old way.
  git -C "$ROOT" show "${BASE:-origin/main}:packages/kernel/occt/facade/extrudo_facade.cpp" > "$DIR/build/old_facade.cpp"
fi
build() {
  docker run --rm --user 0 -v "$ROOT:/w" -w /w/spikes/p4-12-thread-taper --entrypoint sh "$IMAGE" -c "
    em++ -std=c++17 $OPT $2 -fwasm-exceptions -I/opencascade.js/build/occt-includes harness.cpp \
      -sALLOW_MEMORY_GROWTH -sENVIRONMENT=node -sERROR_ON_UNDEFINED_SYMBOLS=0 -sSTACK_SIZE=8MB \
      $LINK -o build/$1.cjs > build/$1.log 2>&1
    grep -E 'error|undefined' build/$1.log && exit 1
    test -f build/$1.cjs || { echo 'the harness did not build' >&2; exit 1; }"
}
run() {
  docker run --rm --user 0 -v "$ROOT:/w" -w /w/spikes/p4-12-thread-taper --entrypoint sh "$IMAGE" -c "node build/$1.cjs ${*:2}"
}
build harness ""
if [ "${1:-}" = compare ]; then
  build old "-DOLD=1"
  echo "== main's facade"; run old compare
  echo "== this facade"; run harness compare
else
  run harness "$@"
fi
