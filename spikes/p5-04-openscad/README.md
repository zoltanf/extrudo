# P5-04 spike: OpenSCAD in WebAssembly

Measures three OpenSCAD WASM builds in Node and in Chrome under the app's
headers. The numbers are in `docs/adr/0071-openscad-import.md`.

    ./fetch.sh                      # the two npm builds and the upstream snapshot
    KEEP=1 node bench.mjs snap manifold cgal repeat errors params formats
    KEEP=1 node bench.mjs pre manifold        # openscad-wasm-prebuilt 1.2.0
    node --expose-gc heap.mjs                 # reuse vs a fresh instance per compile
    node more.mjs                             # memory, determinism, fonts, -D, a heap ceiling
    PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/google-chrome-stable node browser.mjs
                                              # nested module worker, CSP, timeout
