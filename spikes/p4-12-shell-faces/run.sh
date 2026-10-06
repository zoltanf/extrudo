#!/usr/bin/env bash
# Builds harness.cpp against the facade and OCCT's static WASM libraries in the
# pinned image and runs it under node (P4-12, ADR-0046's amendment).
# Usage from the repo root:
#   bash spikes/p4-12-shell-faces/run.sh              the volume table
#   bash spikes/p4-12-shell-faces/run.sh sweep        the trap sweep (sweep.sh)
#   DEBUG=1 bash spikes/p4-12-shell-faces/run.sh ...  -g2 build (function names in a trap's trace)
#   SAFE=1 ...                                        also -sSAFE_HEAP=1 (stops at the first bad access)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${OCCT_IMAGE:-74e2918318e4}"
OPT="${OPT:--O1}"
EXTRA=""
if [ -n "${DEBUG:-}" ]; then EXTRA="$EXTRA -g2"; fi
if [ -n "${SAFE:-}" ]; then EXTRA="$EXTRA -sSAFE_HEAP=1"; fi
LIBS="TKDESTEP TKXSBase TKDE TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d TKG2d TKMath TKernel TKMesh"
LINK=""
for lib in $LIBS; do LINK="$LINK /opencascade.js/build/occt-libraries/lib$lib.a"; done
mkdir -p "$ROOT/spikes/p4-12-shell-faces/build"
RUN="node build/harness.cjs $*"
if [ "${1:-}" = "sweep" ]; then RUN="sh sweep.sh"; fi
docker run --rm --user 0 -v "$ROOT:/w" -w /w/spikes/p4-12-shell-faces --entrypoint sh "$IMAGE" -c "
  em++ -std=c++17 $OPT $EXTRA -fwasm-exceptions -I/opencascade.js/build/occt-includes harness.cpp \
    -sALLOW_MEMORY_GROWTH -sENVIRONMENT=node -sERROR_ON_UNDEFINED_SYMBOLS=0 -sSTACK_SIZE=5MB \
    $LINK -o build/harness.cjs 2>&1 | grep -v 'warning:' | grep -E 'error|undefined' ;
  $RUN"
