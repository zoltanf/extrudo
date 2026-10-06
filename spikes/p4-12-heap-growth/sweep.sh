#!/usr/bin/env bash
# Sweeps the heap-growth cures natively (P4-12, ADR-0050 §6). Each line is a
# variant; run.sh is rebuilt per allocator but the compile is cached by emcc.
# The reported growth is the heap top from the round the rolling cache filled
# (WARM) to the end, so the cache's own live memory is not counted.
# Usage from the repo root:
#   bash spikes/p4-12-heap-growth/sweep.sh              # the whole table
#   ROUNDS=600 bash spikes/p4-12-heap-growth/sweep.sh   # shorter
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG="${LOG:-/tmp/p4-12-heap-growth/sweep.log}"
ROUNDS="${ROUNDS:-1200}"
mkdir -p "$(dirname "$LOG")"
: > "$LOG"
run() {
  local label="$1"; shift
  echo "########## $label :: $*" | tee -a "$LOG"
  timeout 2400 bash spikes/p4-12-heap-growth/run.sh ROUNDS="$ROUNDS" "$@" >> "$LOG" 2>&1
  local code=$?
  echo "########## exit $code" >> "$LOG"
}
run "mimalloc baseline #1"       CACHE=256
run "mimalloc baseline #2"       CACHE=256
run "mimalloc baseline #3"       CACHE=256
run "mimalloc MINIMAL"           CACHE=256 MINIMAL=1
run "mimalloc NOMESH"            CACHE=256 NOMESH=1
run "dlmalloc"                   CACHE=256 MALLOC=dlmalloc
run "mimalloc MI=collect"        CACHE=256 MI=collect
run "mimalloc MI=purge0"         CACHE=256 MI=purge0
run "mimalloc MI=purge0+collect" CACHE=256 MI=purge0collect
run "mimalloc MI=retain0"        CACHE=256 MI=retain0
run "mimalloc CLEAN=1"           CACHE=256 CLEAN=1
run "mimalloc COPY=1"            CACHE=256 COPY=1
run "mimalloc tiny cache 24"     CACHE=24
echo "sweep done" | tee -a "$LOG"
