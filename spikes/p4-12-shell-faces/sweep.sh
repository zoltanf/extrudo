#!/bin/sh
# The trap sweep (inside the image, after run.sh built build/harness.cjs): every
# face of each body that touches a tangent neighbour, removed raw (no refusal)
# at several thicknesses, one node process each, so a trap ends one case only.
for b in ${BODIES:-round1 round3 round5 vert3 one3 cylr2 cylr4}; do
  for face in $(node build/harness.cjs faces $b | awk -v all="${ALL:-}" '$6 == "tangent=1" && (all != "" || $2 == "plane") { print $1 }'); do
    for t in ${THICKNESSES:-0.5 1 2 3 4}; do
      out=$(timeout 120 node build/harness.cjs trap $b $face $t raw 2>&1)
      code=$?
      case "$out" in
        *"raw:"*) echo "$out" | grep "raw:" ;;
        *) echo "$b face $face t $t raw: CRASH (exit $code) $(echo "$out" | grep -m1 -E 'RuntimeError|Aborted|error')" ;;
      esac
    done
  done
done
