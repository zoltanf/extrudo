#!/usr/bin/env bash
# Focused sweep: the MINIMAL document (one revolve) is the harness variant that
# reproducibly steps the heap top after the cache warms, so cures are tested on
# it. Usage from the repo root:
#   bash spikes/p4-12-heap-growth/sweep-minimal.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG="${LOG:-/tmp/p4-12-heap-growth/sweep2.log}"
ROUNDS="${ROUNDS:-3000}"
mkdir -p "$(dirname "$LOG")"
: > "$LOG"
run() {
  local l="$1"; shift
  echo "########## $l :: $*" >> "$LOG"
  timeout 2400 bash spikes/p4-12-heap-growth/run.sh ROUNDS="$ROUNDS" "$@" >> "$LOG" 2>&1
  echo "########## exit $?" >> "$LOG"
}
run "MINIMAL baseline"   CACHE=256 MINIMAL=1
run "MINIMAL CLEAN=1"    CACHE=256 MINIMAL=1 CLEAN=1
run "MINIMAL COPY=1"     CACHE=256 MINIMAL=1 COPY=1
run "MINIMAL MI=collect" CACHE=256 MINIMAL=1 MI=collect
run "MINIMAL dlmalloc"   CACHE=256 MINIMAL=1 MALLOC=dlmalloc
echo "sweep2 done" >> "$LOG"
