#!/usr/bin/env bash
# Builds harness.cpp against the facade and OCCT's static WASM libraries in the
# pinned image and runs it under node (P6-05 J3 pose proximity).
# The shapes and poses come from a dump of the hinge (see README.md).
# Usage from the repo root: bash spikes/p6-05-joint-proximity/run.sh busy|plain [leakRounds]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${OCCT_IMAGE:-74e2918318e4}"
OPT="${OPT:--O2}"
LIBS="TKDESTEP TKXSBase TKDE TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d TKG2d TKMath TKernel TKMesh"
LINK=""
for lib in $LIBS; do LINK="$LINK /opencascade.js/build/occt-libraries/lib$lib.a"; done
mkdir -p "$ROOT/spikes/p6-05-joint-proximity/build"
docker run --rm --user 0 -v "$ROOT:/w" -w /w/spikes/p6-05-joint-proximity --entrypoint sh "$IMAGE" -c "
  set -e
  if [ ! -f build/harness.cjs ] || [ -n \"\${REBUILD:-1}\" ]; then
  em++ -std=c++17 $OPT -sMALLOC=mimalloc -fwasm-exceptions -Dprivate=public -I/opencascade.js/build/occt-includes harness.cpp \
    -sALLOW_MEMORY_GROWTH -sENVIRONMENT=node -sERROR_ON_UNDEFINED_SYMBOLS=0 -sSTACK_SIZE=8MB -sNODERAWFS=1 \
    $LINK -o build/harness.cjs
  fi
  node build/harness.cjs $*"
