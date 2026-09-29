# Extrudo's OCCT WASM

Our own trimmed OpenCascade build, with a small C++ facade compiled into it.
The decision and its measurements are in
[ADR-0001](../../../docs/adr/0001-geometry-kernel.md).

| Path | What |
|---|---|
| `libcascade.config.ts` | Build config for `@libcascade/toolchain`: the facade (the only binding: no raw OCCT class is bound), emcc settings. |
| `facade/extrudo_facade.cpp` | The facade (LGPL-2.1-or-later, see `facade/LICENSE`). It owns OCCT memory: shapes sit in an arena behind integer handles, builders live on the C++ stack, and results, history and meshes come back as flat arrays. |
| `occt.mjs` | Build, publish and download (below). Run it as `pnpm occt <command>` from the repo root. |
| `dist/` | The build output (gitignored): `extrudo_occt_single.{js,wasm,d.ts}` and the `init.js` loader. |

## Getting the WASM

You normally don't build it. `pnpm check`, `pnpm dev` and `pnpm build` run
`pnpm occt ensure`, which compares `dist/.inputs-hash` with a hash of the inputs
(the config, everything in `facade/`, the toolchain version) and, if they
differ, downloads the matching build from the GitHub release `occt-<hash>`. It
uses `gh` when installed (needed while the repo is private) and a plain HTTPS
download otherwise.

CI publishes that release: the `occt` job in `.github/workflows/ci.yml` builds
each new input hash once and uploads `dist/` as `extrudo-occt-<hash>.tar.gz`.

## Changing the build

Edit the config or the facade, then build locally to try it:

```sh
pnpm occt build     # Docker + the pinned 2.4 GB image; about 10 minutes
pnpm occt check     # every OCCT symbol used in src/ is bound
```

A plain `em++ -fsyntax-only` inside the image checks the facade in seconds, which
beats waiting for a full build to find a typo:

```sh
docker run --rm -v "$PWD/facade:/f:ro" --entrypoint sh ghcr.io/taucad/opencascade.js:<tag> \
  -c 'em++ -std=c++17 -fsyntax-only -fwasm-exceptions -I/opencascade.js/build/occt-includes /f/extrudo_facade.cpp'
```

Then push; CI builds and publishes the new hash before the tests run.

Things the builds ran into:

- The toolchain parses the facade and generates embind bindings for every class
  in it, so the file holds exactly one class (helpers are private members),
  with no overloaded method names. `const char*` returns become JS strings;
  pointers are returned as `uintptr_t` and read from `wasmMemory` in JS.
- OCCT 8 deprecates the `TopTools_*` and `TColStd_*` collection typedefs; use
  the `NCollection_*` templates directly.
- `mallinfo()` does not link in this build, so the memory probe is `sbrk(0)`
  (`heapTop()`).
- The binding list is `['ExtrudoFacade']` (ADR-0037): the facade's public
  methods take and return ints, doubles and pointers, so no OCCT type crosses
  embind, and binding raw classes only added code and start-up work (198
  classes were 22 % of the WASM). **Don't expose an OCCT type in a facade
  method.** If a raw class is ever needed again, list it in `bindings` and
  also every base class (embind refuses to construct a class whose base is
  unbound) and every type its methods take or return; `libcascade check`
  sees neither. `libcascade check` (`pnpm occt check`) now proves that
  `src/` uses no raw symbol.
- The build needs `MODULARIZE` + `EXPORT_ES6` and the three exception helpers
  in `EXPORTED_RUNTIME_METHODS`.
- Builds without Docker: on a machine with none, push a branch and run
  `gh workflow run ci.yml --ref <branch>`; the `occt` job builds the branch's
  inputs (about 14 minutes) and publishes `occt-<hash>`, which
  `pnpm occt ensure` downloads.
- Try facade changes natively first: a `harness.cpp` that `#include`s
  `extrudo_facade.cpp` builds with `em++` against the image's static
  libraries in seconds and runs under `node` in the container (see the
  project's `CLAUDE.md`), leak checks (`heapTop()`) included. To reach a
  shape behind a handle from the harness (to run an OCCT check on it, say),
  `#define private public` before the `#include` and call `find(handle)`.
- Operations with history write `[input, kind, index, relation, n, (kind,
  index) × n]` records: relations 0 modified, 1 generated, 2 deleted, 3 kept,
  4 first and 5 last (a sweep's start and end copies). Topological naming
  (ADR-0005) reads them; `describe()` gives the geometry and adjacency it
  orders and fingerprints by.
- `prism` takes a taper (ADR-0028): `BRepOffsetAPI_DraftAngle` on the side
  faces, its history carried through with `ModifiedShape` (DraftAngle calls
  a tilted face generated, not modified), and `taperHolds` because
  DraftAngle returns "valid" solids whose sides crossed. `count`/`subShape`
  take kind 3 for solids; `distance` measures solid by solid, since
  `BRepExtrema_DistShapeShape` only sees inside a shape that is a solid
  itself.
- Measuring (ADR-0035): `distance` also leaves the closest points in
  `geometryNumbers`; `properties` gives volume (solids only), area,
  length, centre of mass and a tight box (`BRepBndLib::AddOptimal`
  without triangulation or tolerances; `measure` keeps the fast, loose
  box extrude uses); `surfaceGeometry` a face's surface type, axis or
  normal (out of the face) and radii.

## Licensing

OCCT is LGPL-2.1 with the OCCT exception. The facade is LGPL-2.1-or-later. The
app loads the result as a separate, replaceable `.wasm`.
