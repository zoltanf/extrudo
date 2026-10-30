#!/usr/bin/env bash
# bash run.sh              the faceted probe (harness.cpp)
# bash run.sh prismatic [case]   the facade's prismatic method on slice 3's matrix (prismatic.cpp)
set -euo pipefail
S="$(cd "$(dirname "$0")" && pwd)"
R="$(cd "$S/../.." && pwd)"
if [ "${1:-}" = prismatic ]; then
  IMAGE="${OCCT_IMAGE:-ghcr.io/taucad/opencascade.js:3.1.0-single-threaded}"
  # BUILD: the build folder under spikes/stl-to-solid (default build), so that two runs don't share one.
  B="${BUILD:-build}"
  mkdir -p "$S/$B"
  # The facade with its private members public, so the harness can look inside.
  sed 's/^ *private:/ public:/' "${FACADE:-$R/packages/kernel/occt/facade/extrudo_facade.cpp}" > "$S/$B/facade_public.cpp"
  # STL_DIR: a folder mounted read-only at /stl for cases f (FILE), F (all of it) and g (faceted, FILE), at TOL.
  STL=()
  [ -n "${STL_DIR:-}" ] && STL=(-v "$STL_DIR:/stl:ro")
  # SAN=1: AddressSanitizer; SAN=ub: UndefinedBehaviorSanitizer; SAN=heap: SAFE_HEAP + assertions.
  FLAGS="-O2 -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=4GB"
  OUT=prismatic
  case "${SAN:-}" in
    1) FLAGS="-O1 -g2 -fsanitize=address -sINITIAL_MEMORY=2GB -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=4GB"; OUT=prismatic-asan ;;
    ub) FLAGS="-O1 -g2 -fsanitize=undefined -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=4GB"; OUT=prismatic-ubsan ;;
    heap) FLAGS="-O1 -g2 -sSAFE_HEAP=1 -sASSERTIONS=2 -DEXTRUDO_FACADE_CHECKS -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=4GB"; OUT=prismatic-heap ;;
  esac
  docker run --rm --user 0 -e FACES="${FACES:-}" -e PIECES="${PIECES:-}" -e TIMES="${TIMES:-}" -e SEGMENT="${SEGMENT:-}" -e BUDGET="${BUDGET:-}" -e HYBRID_BUDGET="${HYBRID_BUDGET:-}" -e GAPS="${GAPS:-}" -e UNFIT="${UNFIT:-}" -e FILE="${FILE:-}" -e TOL="${TOL:-}" -e FACETED_DEBUG="${FACETED_DEBUG:-}" -e Q20="${Q20:-}" -e Q20OFF="${Q20OFF:-}" -e Q20FACES="${Q20FACES:-}" \
    -e NOBUILD="${NOBUILD:-}" -e B="$B" -e FLAGS="$FLAGS" -e OUT="$OUT" -v "$S:/w" -v "$R/fixtures:/repo/fixtures:ro" "${STL[@]}" -w /w --entrypoint sh "$IMAGE" -c '
    set -e
    LINK=$(ls /opencascade.js/build/occt-libraries/*.a | tr "\n" " ")
    [ -n "$NOBUILD" ] || em++ -std=c++17 $FLAGS -fwasm-exceptions -I$B -I/opencascade.js/build/occt-includes prismatic.cpp \
      -sENVIRONMENT=node -sERROR_ON_UNDEFINED_SYMBOLS=0 -sSTACK_SIZE=8MB -sNODERAWFS=1 \
      -Wl,--start-group $LINK -Wl,--end-group -o $B/$OUT.cjs
    node $B/$OUT.cjs '"${2:-}"
  exit
fi
IMAGE="${OCCT_IMAGE:-ghcr.io/taucad/opencascade.js:3.0.2-single-threaded}"
docker run --rm --user 0 -v "$S:/w" -w /w --entrypoint sh "$IMAGE" -c '
  set -e
  ls /opencascade.js/build/occt-libraries | tr "\n" " "; echo
  LINK=""
  for lib in TKDESTL TKDE TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d TKG2d TKMath TKernel TKMesh; do
    [ -f /opencascade.js/build/occt-libraries/lib$lib.a ] && LINK="$LINK /opencascade.js/build/occt-libraries/lib$lib.a"
  done
  mkdir -p build
  em++ -std=c++17 -O2 -fwasm-exceptions -I/opencascade.js/build/occt-includes harness.cpp \
    -sALLOW_MEMORY_GROWTH -sENVIRONMENT=node -sERROR_ON_UNDEFINED_SYMBOLS=0 -sSTACK_SIZE=8MB -sNODERAWFS=1 \
    $LINK -o build/harness.cjs
  node build/harness.cjs'
