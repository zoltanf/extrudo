#!/bin/sh
# Builds and runs harness.cpp inside the pinned opencascade.js image (P4-02).
# Usage from the repo root: sh spikes/p4-02-harness/build.sh [experiment]
# (through `sg docker -c '…'` if the shell lacks the docker group).
# Rebuilds h.cjs only when harness.cpp or the facade is newer.
set -e
docker run --rm --user 0 -v "$PWD":/w -w /w/spikes/p4-02-harness --entrypoint sh \
  ghcr.io/taucad/opencascade.js:3.0.2-single-threaded -c '
L=/opencascade.js/build/occt-libraries
F=../../packages/kernel/occt/facade/extrudo_facade.cpp
if [ ! -f h.cjs ] || [ harness.cpp -nt h.cjs ] || [ $F -nt h.cjs ]; then
em++ -std=c++17 -O2 -fwasm-exceptions -I/opencascade.js/build/occt-includes harness.cpp \
  -sALLOW_MEMORY_GROWTH -sENVIRONMENT=node -sERROR_ON_UNDEFINED_SYMBOLS=0 -sSTACK_SIZE=8MB \
  -Wl,--start-group $L/libTK*.a -Wl,--end-group -o h.cjs 2>&1 | grep -v warning || true
fi
node h.cjs "$@"' sh "$@"
