#!/usr/bin/env bash
# Runs a shell command over the OCCT sources inside the pinned image (grep, sed).
# Usage: bash spikes/p4-10-harness/occt-src.sh 'grep -rn SetLaw src/ModelingAlgorithms | head'
set -euo pipefail
IMAGE="${OCCT_IMAGE:-ghcr.io/taucad/opencascade.js:3.0.2-single-threaded}"
docker run --rm -w /opencascade.js/deps/OCCT --entrypoint sh "$IMAGE" -c "$1"