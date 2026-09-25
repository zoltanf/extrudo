# P0-02 kernel spike

Throwaway code for roadmap task **P0-02**. It compares three ways of driving
OpenCascade (OCCT 8.0) compiled to WASM, and it produced
[ADR-0001](../../docs/adr/0001-geometry-kernel.md). Nothing here is imported by
the app. The production kernel package is P0-09.

| Candidate | Packages (versions tested) | What it is |
|---|---|---|
| **A. libcascade** | `libcascade` 3.0.2 | Raw OCCT API through embind (taucad fork of opencascade.js). Full prebuilt build. |
| **B. replicad** | `replicad` 1.1.0 + `replicad-opencascadejs` 1.1.0 | High-level code-CAD API over a trimmed build made with the same libcascade toolchain. Raw OCCT is reachable through `getOC()`. |
| **C. brepjs** | `brepjs` 20.0.0 + `occt-wasm` 5.3.5 | High-level API over occt-wasm, a C++ facade with arena handles. OCCT classes are not bound. |
| **A′. custom** | `custom-build/` via `@libcascade/toolchain` 3.0.2 | Our own trimmed libcascade build (198 bindings), same raw scenario as A. |

Results are in [`results/summary.md`](results/summary.md) (generated), with the
raw numbers in `results/*.json` and screenshots in `results/browser-*.png`.

## The scenario

The same scenario runs for every candidate, in Node and in a browser Web Worker:

1. Box 40×30×20 → fillet the 4 vertical edges (r = 3) → cut a Ø8 through-hole.
2. Tessellate: positions, normals, indices, per-face triangle ranges and edge
   polylines. Render with plain three.js, one colour per B-rep face.
3. Binary STL (checked for watertightness and volume) and STEP (AP214, plus
   AP242 on the raw path), then re-import the STEP.
4. **Topological naming:** tag the box's 6 faces and 12 edges (and the hole
   tool's faces), then carry the names through the fillet and the cut using OCCT
   history (`Modified` / `Generated` / `IsDeleted`), and report how many of the
   final solid's faces and edges end up with a name.

Checks: `BRepCheck_Analyzer` validity, volume against the analytic value
(22840.18 mm³), and the STEP re-import volume.

## Layout

| Path | What |
|---|---|
| `src/candidates/raw-occt.ts` | The scenario and the naming test against the raw OCCT API. Runs on libcascade and on replicad's `getOC()` instance. |
| `src/candidates/{libcascade,replicad,brepjs}.ts` | Per-candidate `load()` / `run()`. replicad and brepjs use their own APIs. |
| `src/shared/` | Result types, binary STL writer, watertight check. |
| `src/node/bench.ts` | Node: cold load, first and warm timings, memory loop with a leak control. |
| `src/node/leak-bisect.ts` | Runs one pipeline step thousands of times to find which libcascade call leaks. |
| `src/node/sizes.ts` | Raw, gzip and brotli sizes from the Vite build. |
| `src/node/report.ts` | Builds `results/summary.md`. |
| `src/browser/` | Vite page + worker, and `measure.ts` (Playwright driver). |
| `src/candidates/custom.ts` | Loads the trimmed build from `custom-build/dist/` (build it first, see below). |
| `custom-build/libcascade.config.ts` | Trimmed-build config for `@libcascade/toolchain`. |
| `custom-build/closure.mjs` | Adds base classes and referenced types to the binding list (from the toolchain's symbol catalog). |

## Running it

This package is **not** part of the pnpm workspace.

```sh
cd spikes/p0-02-kernel
pnpm install --ignore-workspace
npx tsc -p tsconfig.json                    # type-check the spike
for c in libcascade replicad brepjs custom; do node src/node/bench.ts $c; done
npx vite build && node src/browser/measure.ts   # uses the repo root's Playwright
node src/node/sizes.ts                      # about 3 min (brotli q11 on 88 MB of WASM)
node src/node/report.ts                     # → results/summary.md
pnpm dev                                    # http://127.0.0.1:5174/?c=libcascade (or replicad, brepjs)
node src/node/leak-bisect.ts                # lists steps; then: [LIB=custom] node src/node/leak-bisect.ts "box + cylinder cut"
```

Node 26 runs the `.ts` files directly (type stripping). `MEM_ITERS=4000` changes
the length of the memory loop.

## Findings in short

See the ADR for the decision. The measured facts:

- **All three pass the scenario** in Node and in a browser worker without
  `SharedArrayBuffer` (page not cross-origin isolated). Valid solid, exact
  volume, watertight STL, and STEP re-imports with the same 11 faces.
- **Warm speed is the same** (about 50 ms for the whole scenario in Node). They
  all run OCCT 8.0. Cold start is not: libcascade takes about
  780 ms to worker-ready in Chromium, against about 135–230 ms for the trimmed
  builds. That's embind registering thousands of classes, not the download.
- **Size (brotli):** libcascade full build 8.22 MB; replicad's trimmed
  toolchain build 4.84 MB; occt-wasm 4.76 MB; our trimmed build 4.34 MB (and
  about 200 ms to worker-ready).
- **History:** raw OCCT (libcascade, or replicad via `getOC()`) exposes full
  face *and* edge history. All 11 final faces get a persistent name, the fillet
  faces come from `Generated(edge)`, and the hole's intersection edges come from
  `Generated(face)`. brepjs/occt-wasm only tracks face → face hashes, so the 4
  fillet faces (generated from edges) get no name (7 of 11). replicad's own API
  discards the builders, so history is only reachable by dropping to `getOC()`.
- **Memory:** in libcascade (prebuilt and our own build), `delete()` from JS
  often doesn't release memory the C++ object owns: a 100k-point
  `NCollection_Array1` leaks its 2.4 MB buffer on every delete, `BRepAlgoAPI_Cut`
  leaks unless `Clear()` is called first, `BRepFilletAPI_MakeFillet` leaks
  (`Reset()` doesn't help). replicad's build behaves the same and its API gives
  no way to call `Clear()`. occt-wasm's facade: zero growth over 4000 rebuilds,
  so OCCT itself doesn't leak here.
- **Custom build:** `@libcascade/toolchain` supports a trimmed symbol list
  *and* our own C++ (`customBindings`) in the same WASM. Our build in
  `custom-build/` runs the whole scenario with identical results. It needs
  Docker and the 2.4 GB `ghcr.io/taucad/opencascade.js` image; a build takes
  about 10 minutes.

## Custom build: the steps (for P0-09)

```sh
cd spikes/p0-02-kernel/custom-build
node closure.mjs --refs              # symbols to add: base classes + referenced types
npx libcascade check ../src          # symbols our source uses ⊆ symbols we bind
npx libcascade build --render-only   # renders .libcascade/extrudo_occt_single.yml, no container
npx libcascade build                 # needs Docker; pulls the pinned image (~2.4 GB), ~10 min
npx libcascade assemble              # types.d.ts + init entries + exports map → dist/
```

What it took to get a working build (each failure cost one 10-minute build):

1. Post-link validation failed: with `-fwasm-exceptions`, `getExceptionMessage`,
   `incrementExceptionRefcount` and `decrementExceptionRefcount` must be in
   `EXPORTED_RUNTIME_METHODS`.
2. The glue came out as CommonJS: `MODULARIZE` and `EXPORT_ES6` are needed,
   because the assembled `init.js` imports it as an ES module.
3. `Cannot construct BRepPrimAPI_MakeBox due to unbound types:
   BRepBuilderAPI_Command`: every base class must be bound, and `check` doesn't
   see that. `closure.mjs --refs` adds base classes and the types the listed
   classes' APIs reference (76 listed → 198).

On this laptop Docker is reachable after adding the user to the `docker`
group (a re-login is needed; until then run commands through
`newgrp docker`).
