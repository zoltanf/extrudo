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
  # Q24 (slice D9): spikeSpindle lets a torus fit keep R <= r (the D8 gates off), spikeTorusSurface builds its surface
  # (prismatic.cpp defines both before the include; a facade without these lines builds unchanged).
  # Q25 (slice D10): spikeKeepPieces records each piece the "< 4 regions" rule turns into planes.
  # Q26 (slice D11): spikeQ26* hooks in rebuildHybrid record the region face builds, each attempt's outcome, and a
  # copy of the regions (prismatic.cpp declares them before the include; with Q26 unset they change nothing).
  sed -e 's/^ *private:/ public:/' \
    -e 's/|| !(R > r) ||/|| (!spikeSpindle \&\& !(R > r)) ||/' \
    -e 's/|| surfaces\[i\]\.majorRadius > radius)/|| spikeSpindle || surfaces[i].majorRadius > radius)/' \
    -e 's/if (cyl\.radius - r > r)/if (spikeSpindle || cyl.radius - r > r)/' \
    -e 's/return new Geom_ToroidalSurface(frame, majorRadius, radius);/return spikeTorusSurface(frame, majorRadius, radius);/' \
    -e 's/^\( *\)for (int r : s\.regions) surfaces\.push_back(planeOf(r));/\1spikeKeepPieces.push_back(s.regions);\n\1for (int r : s.regions) surfaces.push_back(planeOf(r));/' \
    -e 's/} else if (!BRepCheck_Analyzer(face)\.IsValid()) {/} else if (!spikeQ26Face(*this, face, i, pass, attempt, regionUsed[i])) {/' \
    -e 's/^\( *\)why = "edge tolerance " + std::to_string(worst) + " mm";/&\n\1spikeQ26Null(i, pass, attempt, why);/' \
    -e '/auto buildRegion = /,/^      };/s/^\( *\)why = std::string("threw ") + e\.GetMessageString();/&\n\1spikeQ26Null(i, pass, attempt, why);/' \
    -e 's/^\( *\)if (estimate > HYBRID_FACET_CAP \* FACETED_ESTIMATE_MARGIN) return capRefusal(estimate, true);/\1spikeQ26Event(attempt, "tolerance", tolerance);\n\1spikeQ26Event(attempt, "estimate", estimate);\n&/' \
    -e 's/^\( *\)\/\/ The faces that fail, back to their regions: those explode, once\./\1spikeQ26Invalid(attempt, result, faces, healed, solids);\n&/' \
    -e 's/^\( *\)if (facets > HYBRID_FACET_CAP) return capRefusal(facets, false);/\1spikeQ26Valid(attempt, resultFaces.Extent(), facets, undone, healed);\n&/' \
    -e 's/^\( *\)std::set<int> offRegions;/&\n\1spikeQ26Event(attempt, "volume ok");/' \
    -e 's/^\( *\)if (undoCollapses(offRegions, collapsedNow)) {/\1spikeQ26Event(attempt, "nodes off", offRegions.size());\n&/' \
    -e 's/^\( *\)stage("faces");/\1spikeQ26Faces(*this, seg, regions, hybridOf, attempt);\n&/' \
    "${FACADE:-$R/packages/kernel/occt/facade/extrudo_facade.cpp}" > "$S/$B/facade_public.cpp"
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
  docker run --rm --user 0 -e FACES="${FACES:-}" -e PIECES="${PIECES:-}" -e TIMES="${TIMES:-}" -e SEGMENT="${SEGMENT:-}" -e BUDGET="${BUDGET:-}" -e HYBRID_BUDGET="${HYBRID_BUDGET:-}" -e GAPS="${GAPS:-}" -e UNFIT="${UNFIT:-}" -e FILE="${FILE:-}" -e TOL="${TOL:-}" -e FACETED_DEBUG="${FACETED_DEBUG:-}" -e Q20="${Q20:-}" -e Q20OFF="${Q20OFF:-}" -e Q20FACES="${Q20FACES:-}" -e Q21="${Q21:-}" -e Q22A="${Q22A:-}" -e Q22B="${Q22B:-}" -e Q22OLD="${Q22OLD:-}" -e Q23="${Q23:-}" -e Q24="${Q24:-}" -e Q24SPINDLE="${Q24SPINDLE:-}" -e Q24REV="${Q24REV:-}" -e Q25="${Q25:-}" -e Q25ONLY="${Q25ONLY:-}" -e Q26="${Q26:-}" -e Q26PLANES="${Q26PLANES:-}" -e Q26LADDER="${Q26LADDER:-}" -e STEP_OUT="${STEP_OUT:-}" -e Q26TOUCH="${Q26TOUCH:-}" \
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
