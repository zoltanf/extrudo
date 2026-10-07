#!/usr/bin/env bash
# Builds harness.cpp against the facade and OCCT's static WASM libraries in the
# pinned image and runs it under node (P4-12, ADR-0063's amendment: exact
# conics in the kernel). Usage from the repo root:
#   bash spikes/p4-12-conics/run.sh [leaks [rounds]]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${OCCT_IMAGE:-ghcr.io/taucad/opencascade.js:3.0.2-single-threaded}"
OPT="${OPT:--O1}"
LIBS="TKDESTEP TKXSBase TKDE TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d TKG2d TKMath TKernel TKMesh"
LINK=""
for lib in $LIBS; do LINK="$LINK /opencascade.js/build/occt-libraries/lib$lib.a"; done
mkdir -p "$ROOT/spikes/p4-12-conics/build"
docker run --rm --user 0 -v "$ROOT:/w" -w /w/spikes/p4-12-conics --entrypoint sh "$IMAGE" -c "
  rm -f build/harness.cjs build/harness.wasm
  em++ -std=c++17 $OPT -fwasm-exceptions -I/opencascade.js/build/occt-includes harness.cpp \
    -sALLOW_MEMORY_GROWTH -sENVIRONMENT=node -sERROR_ON_UNDEFINED_SYMBOLS=0 -sSTACK_SIZE=8MB \
    $LINK -o build/harness.cjs > build/compile.log 2>&1
  cat build/compile.log
  grep -E 'error|undefined' build/compile.log && exit 1
  test -f build/harness.cjs || { echo 'the harness did not build' >&2; exit 1; }
  node build/harness.cjs $*"
