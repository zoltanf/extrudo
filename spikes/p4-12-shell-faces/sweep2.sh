#!/bin/sh
# The plug sweep (inside the image, after run.sh built build/harness.cjs): every
# flat face of each body that runs smoothly into a neighbour, removed through
# the facade's shell() (inside and outside are both in `trap`'s facade path:
# inside only here) at several thicknesses, one node process each.
for b in ${BODIES:-round1 round3 round5 one3 one5 cylr2 cylr4 top3 top5}; do
  for face in $(node build/harness.cjs faces $b | awk '$6 == "tangent=1" && $2 == "plane" { print $1 }'); do
    for t in ${THICKNESSES:-0.3 0.5 1 2 3 4 6}; do
      out=$(timeout 120 node build/harness.cjs trap $b $face $t 2>&1)
      code=$?
      case "$out" in
        *"facade:"*) echo "$out" | grep "facade:" ;;
        *) echo "$b face $face t $t facade: CRASH (exit $code) $(echo "$out" | grep -m1 -E 'RuntimeError|Aborted|error')" ;;
      esac
    done
  done
done
