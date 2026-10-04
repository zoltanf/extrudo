#!/usr/bin/env bash
# Syntax-checks the facade inside the pinned OCCT image (a few seconds).
# Run from the repo root: bash spikes/p4-10-harness/syntax.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${OCCT_IMAGE:-ghcr.io/taucad/opencascade.js:3.0.2-single-threaded}"
docker run --rm -v "$ROOT/packages/kernel/occt/facade:/f:ro" --entrypoint sh "$IMAGE" \
  -c 'em++ -std=c++17 -fsyntax-only -fwasm-exceptions -I/opencascade.js/build/occt-includes /f/extrudo_facade.cpp'