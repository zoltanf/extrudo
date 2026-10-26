#!/bin/bash
# verify_all.sh <verify_step> <step-dir> <stl-dir> <list>: runs verify_step on
# every file named in <list> (paths relative to <stl-dir>, one per line) against
# <step-dir>/<name>.step and prints one JSON line each; a missing or empty STEP
# prints {"missing":true}. See ../README.md ("Outside converters").
set -u
VERIFY="$1" STEPS="$2" STLS="$3" LIST="$4"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  step="$STEPS/$(basename "$f" .stl).step"
  if [ ! -s "$step" ]; then
    printf '{"step":"%s","stl":"%s","missing":true}\n' "$step" "$STLS/$f"
    continue
  fi
  "$VERIFY" "$step" "$STLS/$f"
done < "$LIST"
