#!/usr/bin/env bash
# Runs a shell command over the OCCT sources inside the pinned image (grep, sed).
# Usage: bash spikes/p4-01-harness/occt-src.sh 'grep -rn SetLaw src/ModelingAlgorithms | head'
set -euo pipefail
IMAGE="${OCCT_IMAGE:-74e2918318e4}"
docker run --rm -w /opencascade.js/deps/OCCT --entrypoint sh "$IMAGE" -c "$1"
