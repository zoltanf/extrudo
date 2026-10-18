#!/usr/bin/env bash
# Smoke test of the Docker image (ADR-0091): the app answers with the headers
# apps/web/public/_headers gives each path.
#
#   scripts/docker-smoke.sh [base-url]     # default http://127.0.0.1:8080
#
# Needs curl, node, and a built apps/web/dist (it names a hashed asset and a .wasm).
set -euo pipefail

base="${1:-http://127.0.0.1:8080}"
root="$(cd "$(dirname "$0")/.." && pwd)"
dist="$root/apps/web/dist"
fail() { echo "FAIL: $*" >&2; exit 1; }

# A container that has just started needs a moment before it accepts connections.
for _ in $(seq 30); do curl -sS -o /dev/null "$base/" 2>/dev/null && break; sleep 1; done

# Fetches a path, leaving the status in $status and the lower-cased headers in $headers.
fetch() {
  local path="$1"; shift
  headers="$(curl -sS -o /tmp/docker-smoke-body -D - -w 'status:%{http_code}\n' "$@" "$base$path" | tr -d '\r' | tr 'A-Z' 'a-z')"
  status="$(sed -n 's/^status://p' <<<"$headers")"
}

# The value of one response header from the last fetch.
header() { sed -n "s/^$1: //p" <<<"$headers" | head -n1; }

check_status() { [ "$status" = 200 ] || fail "$path answered $status, not 200"; }

# Every header `_headers` gives the path, with the exact value.
check_expected() {
  local line name value
  while IFS= read -r line; do
    name="${line%%: *}"; value="${line#*: }"
    [ "$(header "$name")" = "$(tr 'A-Z' 'a-z' <<<"$value")" ] || fail "$path: header $name is '$(header "$name")', expected '$value'"
  done < <(node "$root/scripts/nginx-headers.mjs" --expect "$path")
}

for path in / /index.html /sw.js /manifest.webmanifest; do
  fetch "$path"; check_status; check_expected
  [ "$(header cache-control)" = no-cache ] || fail "$path: cache-control is '$(header cache-control)', expected no-cache"
  echo "ok $path"
done

asset="$(cd "$dist" && ls assets/*.js | head -n1)"
[ -n "$asset" ] || fail "no assets/*.js in $dist"
path="/$asset"; fetch "$path"; check_status; check_expected
[ "$(header cache-control)" = "public, max-age=31536000, immutable" ] || fail "$path: cache-control is '$(header cache-control)'"
case "$(header content-type)" in text/javascript*|application/javascript*) ;; *) fail "$path: content-type is '$(header content-type)'" ;; esac
echo "ok $path"

wasm="$(cd "$dist" && find . -name '*.wasm' | head -n1 | sed 's|^\./||')"
[ -n "$wasm" ] || fail "no .wasm in $dist"
path="/$wasm"; fetch "$path"; check_status; check_expected
[ "$(header content-type)" = application/wasm ] || fail "$path: content-type is '$(header content-type)', expected application/wasm"
echo "ok $path"

path=/no-such-page; fetch "$path"; check_status
cmp -s /tmp/docker-smoke-body "$dist/index.html" || fail "$path did not return index.html"
check_expected
echo "ok $path (index.html)"

path=/; fetch "$path" -H 'Accept-Encoding: gzip'; check_status
[ "$(header content-encoding)" = gzip ] || fail "/: no gzip with Accept-Encoding: gzip"
echo "ok gzip"

echo "Docker smoke test passed ($base)"
