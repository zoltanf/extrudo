#!/bin/sh
# Builds planegcs WASM variants for the P0-03 spike into ../builds/<variant>/.
#   ./build.sh growth|modern|fast   (needs Docker; ~2 min for the first variant)
# growth: upstream toolchain (emsdk 3.1.45) + ALLOW_MEMORY_GROWTH
# modern: emsdk latest + ALLOW_MEMORY_GROWTH + -msimd128
# fast:   modern + LeastNormLdlt DogLeg step + column-pivoting QR in qp_eq
set -e
VARIANT=${1:?variant}
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$HERE/.work
COMMIT=ee9b156da9827a91a56a888a53520f63d5cffaa6 # planegcs 1.2.0 (main, 2026-07-06)
if [ ! -d "$WORK/planegcs-src" ]; then
  git clone -q https://github.com/Salusoft89/planegcs.git "$WORK/planegcs-src"
  git -C "$WORK/planegcs-src" checkout -q $COMMIT
  # The bindings generator needs tree-sitter, which doesn't build on Node 26.
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$WORK/planegcs-src:/src" -w /src node:20-bookworm \
    sh -c 'npm install --no-audit --no-fund > /dev/null && cd build-bindings && bash process_all.sh'
fi
# Patch a fresh copy: $WORK/p-<variant>/planegcs
rm -rf "$WORK/p-$VARIANT" && mkdir -p "$WORK/p-$VARIANT"
cp -r "$WORK/planegcs-src/planegcs" "$WORK/p-$VARIANT/planegcs"
patch -s -p1 -d "$WORK/p-$VARIANT" < "$HERE/$VARIANT.patch"
if [ "$VARIANT" = growth ]; then
  docker build -q -t extrudo-planegcs-upstream "$WORK/planegcs-src" > /dev/null
  IMAGE=extrudo-planegcs-upstream
else
  docker build -q -t extrudo-planegcs-modern -f "$HERE/Dockerfile" "$HERE" > /dev/null
  IMAGE=extrudo-planegcs-modern
fi
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -e EM_CACHE=/tmp/emcache -v "$WORK/p-$VARIANT/planegcs:/src" -w /src $IMAGE \
  sh -c 'emcmake cmake . -DCMAKE_BUILD_TYPE=Release > /dev/null && emmake make -j "$(nproc)" | grep -E "error|Built target planegcs"'
mkdir -p "$HERE/../builds/$VARIANT"
cp "$WORK/p-$VARIANT/planegcs/bin/planegcs.js" "$WORK/p-$VARIANT/planegcs/bin/planegcs.wasm" "$HERE/../builds/$VARIANT/"
echo "built builds/$VARIANT"
