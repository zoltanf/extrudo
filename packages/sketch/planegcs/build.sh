#!/usr/bin/env bash
# Builds Extrudo's planegcs WASM into dist/ (ADR-0002). Needs Docker; about two
# minutes the first time. Run it through `pnpm planegcs build`, which also
# stamps dist/ with the input hash.
#
# 1. Clone planegcs at the pinned commit into $WORK/src.
# 2. Generate its C++ bindings in a Node 20 container (the generator needs
#    tree-sitter, which doesn't build on Node 26).
# 3. Apply planegcs.patch to a fresh copy: ALLOW_MEMORY_GROWTH, -msimd128,
#    DogLeg's Gauss step LeastNormLdlt, column-pivoting QR in qp_eq.
# 4. Compile with the pinned emsdk image (Dockerfile).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# Work files live under node_modules so no tool (Vitest, Biome, tsc) picks up the clone.
WORK=$HERE/../node_modules/.cache/planegcs-build
COMMIT=ee9b156da9827a91a56a888a53520f63d5cffaa6 # planegcs 1.2.0 (main, 2026-07-06)
if [ ! -f "$WORK/src/.bindings-$COMMIT" ]; then
  rm -rf "$WORK/src"
  git clone -q https://github.com/Salusoft89/planegcs.git "$WORK/src"
  git -C "$WORK/src" checkout -q $COMMIT
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$WORK/src:/src" -w /src node:20-bookworm \
    sh -c 'npm ci --no-audit --no-fund > /dev/null && cd build-bindings && bash process_all.sh'
  touch "$WORK/src/.bindings-$COMMIT"
fi
rm -rf "$WORK/build" && mkdir -p "$WORK/build"
cp -r "$WORK/src/planegcs" "$WORK/build/planegcs"
patch -s -p1 -d "$WORK/build" < "$HERE/planegcs.patch"
docker build -q -t extrudo-planegcs-toolchain "$HERE" > /dev/null
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e EM_CACHE=/tmp/emcache -v "$WORK/build/planegcs:/src" -w /src extrudo-planegcs-toolchain \
  sh -c 'emcmake cmake . -DCMAKE_BUILD_TYPE=Release > build.log 2>&1 && emmake make -j "$(nproc)" >> build.log 2>&1' \
  || { tail -40 "$WORK/build/planegcs/build.log"; exit 1; }
rm -rf "$HERE/dist" && mkdir -p "$HERE/dist"
cp "$WORK/build/planegcs/bin/planegcs.js" "$WORK/build/planegcs/bin/planegcs.wasm" "$HERE/dist/"
cp "$WORK/src/LICENSE" "$HERE/dist/LICENSE"
# Emscripten doesn't type its glue; src/solver/module.ts narrows the module to what we use.
cat > "$HERE/dist/planegcs.d.ts" <<'DTS'
declare const init: (options?: Record<string, unknown>) => Promise<unknown>;
export default init;
DTS
echo "built packages/sketch/planegcs/dist"
