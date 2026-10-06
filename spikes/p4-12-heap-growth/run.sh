#!/usr/bin/env bash
# Builds harness.cpp against the facade and OCCT's static WASM libraries in the
# pinned image and runs it under node (P4-12 heap growth, ADR-0050 §6).
# Usage from the repo root:
#   bash spikes/p4-12-heap-growth/run.sh ROUNDS=1200              # fresh, mimalloc
#   MALLOC=dlmalloc bash spikes/p4-12-heap-growth/run.sh ROUNDS=1200
#   bash spikes/p4-12-heap-growth/run.sh MODE=same ROUNDS=1200
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${OCCT_IMAGE:-74e2918318e4}"
OPT="${OPT:--O1}"
# The real WASM build links mimalloc (provenance: -sMALLOC=mimalloc); mimic it.
MALLOC="${MALLOC:-mimalloc}"
EXTRA="-sMALLOC=$MALLOC"
if [ "$MALLOC" = "mimalloc" ]; then EXTRA="$EXTRA -DMI_ALLOC"; fi
if [ -n "${DEBUG:-}" ]; then EXTRA="$EXTRA -g2"; fi
LIBS="TKDESTEP TKXSBase TKDE TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d TKG2d TKMath TKernel TKMesh"
LINK=""
for lib in $LIBS; do LINK="$LINK /opencascade.js/build/occt-libraries/lib$lib.a"; done
mkdir -p "$ROOT/spikes/p4-12-heap-growth/build"
docker run --rm --user 0 -v "$ROOT:/w" -w /w/spikes/p4-12-heap-growth --entrypoint sh "$IMAGE" -c "
  set -e
  em++ -std=c++17 $OPT $EXTRA -fwasm-exceptions -I/opencascade.js/build/occt-includes harness.cpp \
    -sALLOW_MEMORY_GROWTH -sENVIRONMENT=node -sERROR_ON_UNDEFINED_SYMBOLS=0 -sSTACK_SIZE=8MB \
    $LINK -o build/harness.cjs
  node build/harness.cjs $*"
