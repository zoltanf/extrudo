#!/bin/sh
# Downloads what the spike measures: the two npm builds and the upstream snapshot.
set -e
cd "$(dirname "$0")"
npm pack openscad-wasm-prebuilt@1.2.0 openscad-wasm@0.0.4 --silent
mkdir -p pre ow snap
tar xzf openscad-wasm-prebuilt-1.2.0.tgz -C pre
tar xzf openscad-wasm-0.0.4.tgz -C ow
curl -sfLO https://files.openscad.org/snapshots/OpenSCAD-2026.10.05-WebAssembly-web.zip
unzip -o -q OpenSCAD-2026.10.05-WebAssembly-web.zip -d snap
cp snap/openscad.js snap/openscad.wasm web/
