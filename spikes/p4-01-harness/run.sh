#!/usr/bin/env bash
# Builds harness.cpp against the facade and OCCT's static WASM libraries in the
# pinned image and runs it under node (P4-01, ADR-0055).
# Usage from the repo root: bash spikes/p4-01-harness/run.sh [leaks]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${OCCT_IMAGE:-74e2918318e4}"
OPT="${OPT:--O1}"
LIBS="TKDESTEP TKXSBase TKDE TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d TKG2d TKMath TKernel TKMesh"
LINK=""
for lib in $LIBS; do LINK="$LINK /opencascade.js/build/occt-libraries/lib$lib.a"; done
mkdir -p "$ROOT/spikes/p4-01-harness/build"
docker run --rm --user 0 -v "$ROOT:/w" -w /w/spikes/p4-01-harness --entrypoint sh "$IMAGE" -c "
  em++ -std=c++17 $OPT -fwasm-exceptions -I/opencascade.js/build/occt-includes harness.cpp \
    -sALLOW_MEMORY_GROWTH -sENVIRONMENT=node -sERROR_ON_UNDEFINED_SYMBOLS=0 -sSTACK_SIZE=5MB \
    $LINK -o build/harness.cjs 2>&1 | grep -v 'warning:' | grep -E 'error|undefined' ;
  node build/harness.cjs $*"
