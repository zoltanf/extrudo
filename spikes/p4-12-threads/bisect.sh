#!/usr/bin/env bash
# The bisect sweep of ADR-0067 §H2: B9's thread at 150, 200, 300, 400 and 600
# turns, each in its own process (a WASM trap costs one process). Usage from
# the repo root:
#   bash spikes/p4-12-threads/bisect.sh            # both internal and external
#   bash spikes/p4-12-threads/bisect.sh 200 300    # those turn counts, internal
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG="${LOG:-/tmp/opencode/p4-12-bisect.log}"
SIDES="${SIDES:-1 0}"
mkdir -p "$(dirname "$LOG")"
: > "$LOG"
for turns in ${@:-150 200 300 400 600}; do
  for internal in $SIDES; do
    echo "########## $turns turns internal=$internal" >> "$LOG"
    timeout 1200 bash spikes/p4-12-threads/run.sh "$turns" "$internal" >> "$LOG" 2>&1
    echo "########## exit $?" >> "$LOG"
  done
done
echo "bisect done" >> "$LOG"