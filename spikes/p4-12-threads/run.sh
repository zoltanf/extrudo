#!/usr/bin/env bash
# Builds harness.cpp against the facade and OCCT's static WASM libraries in the
# pinned image and runs it under node (P4-12, ADR-0067 §H2). One run per turn
# count, so a WASM trap costs one process:
#   bash spikes/p4-12-threads/run.sh 400              # 400 turns, internal M20
#   bash spikes/p4-12-threads/run.sh 400 0            # external
#   bash spikes/p4-12-threads/run.sh 200 1 LEAD=0     # without the lead-ins
# Set OCCT_DEBUG=1 for the unsplit build with -g2 -sNODERAWFS=1, so a trap's
# stack trace has function names (it needs about 12 minutes).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${OCCT_IMAGE:-74e2918318e4}"
OPT="${OPT:--O1}"
DEBUG="${OCCT_DEBUG:-0}"
LIBS="TKDESTEP TKXSBase TKDE TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d TKG2d TKMath TKernel TKMesh"
LINK=""
for lib in $LIBS; do LINK="$LINK /opencascade.js/build/occt-libraries/lib$lib.a"; done
mkdir -p "$ROOT/spikes/p4-12-threads/build"
OUT=build/harness.cjs
DBG=""
if [ "$DEBUG" != "0" ]; then OUT=build/harness-debug.cjs; DBG="-g2 -sNODERAWFS=1"; fi
docker run --rm --user 0 -v "$ROOT:/w" -w /w/spikes/p4-12-threads --entrypoint sh "$IMAGE" -c "
  em++ -std=c++17 $OPT $DBG -fwasm-exceptions -I/opencascade.js/build/occt-includes harness.cpp \
    -sALLOW_MEMORY_GROWTH -sENVIRONMENT=node -sERROR_ON_UNDEFINED_SYMBOLS=0 -sSTACK_SIZE=8MB \
    $LINK -o $OUT 2>&1 | grep -v 'warning:' | grep -E 'error|undefined' || true
  node $OUT $*"