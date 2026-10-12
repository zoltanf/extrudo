# Development environment, toolchain and library facts

Moved out of `CLAUDE.md` on 2026-10-12: the two dev machines, the WASM builds (OCCT, planegcs), the facade, and facts about OCCT, planegcs and the libraries learned the hard way.

## Dev machines


The project is developed on two machines. Check which one you are on first
(`grep ^ID= /etc/os-release`, `command -v docker`), because the OCCT and
planegcs builds, screenshot baselines and some tools only work on one of
them. Notes further down that name a machine apply to that machine only.

| | **Arch workstation** (original) | **Ubuntu machine** (since 2026-09-29) |
|---|---|---|
| OS | Arch Linux | Ubuntu 26.04, 4 cores |
| Node, pnpm | Node 26 + pnpm 12 from mise (`~/.config/mise/config.toml`) | Node 24 + pnpm 12 from nvm (no mise) |
| Docker | Yes (`docker` group; socket-activated daemon) | Yes since 2026-09-29 (`docker.io` from Ubuntu; `docker` group). Until the next login, run it through `sg docker -c '…'` (`sg`/`newgrp` come from `util-linux-extra`). No emscripten outside the image, no sudo for agents |
| OCCT / planegcs WASM | `pnpm occt build` / `pnpm planegcs build` locally, or CI | Prefer CI (`gh workflow run ci.yml --ref <branch>`, below): a local build competes for the 4 cores. Local builds are possible but not tried yet |
| Facade checks | `em++ -fsyntax-only` and the native harness in the image | Same, through `sg docker -c`: the pinned image `ghcr.io/taucad/opencascade.js:3.0.2-single-threaded` is pulled; the syntax check takes about 8 s |
| Playwright browser | Playwright's own Chromium (`pnpm e2e:install`) | System Chrome: `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/google-chrome-stable` |
| Screenshot baselines | Regenerate, then check in the Playwright Ubuntu docker image | Some shots fail locally (Chrome renders differently; they pass in CI): `shell.spec.ts:35` dark/light, `sketch.spec.ts:140`, the home screen in `storage.spec.ts` dark/light, and `print-aids.spec.ts`'s overhang shading (about 1 % of pixels). New baselines: take them from CI's `playwright-report-1`/`-2` artifacts (one per e2e shard; `gh run download <id>`) |
| E2E load | Full parallel run fine | Only one full e2e at a time, `--workers=2`; under load timeouts give false failures. Prefer single specs locally and the full suite through CI on the branch. With its NVIDIA GPU, `E2E_GPU=1` makes viewport-heavy specs 17-39 % faster (screenshot specs excluded: they need SwiftShader) |
| Inkscape, rsvg-convert | Installed | Not installed |
| Slicers, FreeCAD | `prusa-slicer`, `orca-slicer`, `freecadcmd` | Not installed |
| `brotli` CLI | – | Not installed (`scripts/measure-startup.mjs` uses Node's zlib) |
| Electron desktop (P6-01) | `pnpm --filter @extrudo/desktop dev` runs | Headless: no display and **no `xvfb-run`** (checked 2026-10-07), and `electron`'s binary is not downloaded (`pnpm-workspace.yaml`'s `allowBuilds` keeps `electron: false`), so `apps/desktop/scripts/smoke.mjs` can't run here. Packaging and the packaged-app smoke run in CI only (`desktop.yml`, slice 3); `electron-builder --linux --dir` does build here (it downloads its own Electron). The desktop unit tests run in Node without Electron |
## Notes

- **Git identity:** check `git config user.email` before committing. The
  Ubuntu machine had none set, so its first commits carried the machine's
  hostname as the author address; set the same name and address as the
  Arch workstation's commits (`git log --format='%an <%ae>'`), per repo if
  need be. A hostname in history is a home-network detail (see below).
- CI uses Node 24 LTS; `engines.node` is `>=24`. Both machines' Node
  versions work.
- **pnpm 12 refuses packages published less than a day or so ago**
  (`minimumReleaseAge`). If an install adds a `minimumReleaseAgeExclude` entry
  to `pnpm-workspace.yaml`, don't keep it: relax the version range (e.g.
  `^8.3.0` instead of `^8.3.1`) so pnpm picks an older release.
- **`biome migrate` rewrote `"recommended": true` into `"preset": "none"`**,
  which silently disables all rules. The config uses `"preset": "recommended"`.
- Don't use `pkill -f <pattern>` in a compound shell command: the pattern
  matches the shell itself and kills it. Kill by PID or port instead.
- This project is intended to become **public open source**. Unlike the rest
  of `~/Work`, it must never contain credentials, home-network details or
  personal data.
- **Spikes** live in `spikes/<task>/` as standalone packages outside the
  workspace (`pnpm install --ignore-workspace`); Biome ignores `spikes/`.
  Node 26 runs their `.ts` files directly (type stripping), and `using` works.
- **libcascade's `delete()` often doesn't free C++-owned memory** (found in
  P0-02): a 100k-point `NCollection_Array1` leaks its 2.4 MB buffer on every
  delete; `BRepAlgoAPI_Cut` leaks unless `Clear()` is called first;
  `BRepFilletAPI_MakeFillet` leaks and `Reset()` doesn't help. Reproduce with
  `spikes/p0-02-kernel/src/node/leak-bisect.ts` (`LIB=custom` for the trimmed
  build). The WASM heap only grows once its initial slack is used up (128 MB
  for the prebuilt build, 23 MB for ours), so run leak tests on a small heap,
  for ≥ 1000 iterations, with a leak control that must fail. A
  `malloc`-address probe was tried and is too noisy; `OSD_MemInfo` and
  embind's instance counters aren't exported. Reported upstream as
  [taucad/opencascade.js#40](https://github.com/taucad/opencascade.js/issues/40); check it before P0-09.
- **brepjs `*WithEvolution` returns empty maps unless the input faces carry
  metadata** (for example `tagFaces`): brepjs only sends face hashes to the
  kernel when there is something to propagate.
- **Custom OCCT builds need Docker** (2.4 GB image, about 12 minutes per
  build), so they run locally only on the Arch workstation; elsewhere use CI
  (the CI note below). On the Arch workstation the user is in the `docker`
  group (since 2026-09-25; plain `docker` works since the next login, seen
  2026-09-27). The daemon is socket-activated.
- **Prototype facade code natively first** (P2-02, Arch workstation): the image has OCCT's
  static WASM libraries (`/opencascade.js/build/occt-libraries/libTK*.a`)
  and node. A `harness.cpp` that `#include`s `extrudo_facade.cpp` and
  calls its methods from `main()` builds with `em++ -std=c++17 -O1
  -fwasm-exceptions -I/opencascade.js/build/occt-includes harness.cpp
  -sALLOW_MEMORY_GROWTH -sENVIRONMENT=node <libs: TKBO TKBool TKFillet
  TKOffset TKPrim TKShHealing TKTopAlgo TKGeomAlgo TKBRep TKGeomBase TKG3d
  TKG2d TKMath TKernel TKMesh>` and runs with `node` in the container in
  about 3 s, versus 12 minutes for `pnpm occt build`. Leak checks work
  there too (`heapTop()` over 300 vs 1500 iterations). `MODULARIZE` +
  `EXPORT_ES6` and the three exception helpers in `EXPORTED_RUNTIME_METHODS`
  are required.
- **The planegcs WASM is not in git either** (`packages/sketch/planegcs/dist/`):
  CI's `planegcs` job publishes `planegcs-<hash>`, `pnpm wasm` fetches both
  builds. After changing `build.sh`, the `Dockerfile` or the patch, run
  `pnpm planegcs build` (Arch workstation; through `newgrp docker` if
  needed) or let CI build it (preferred on the Ubuntu machine). Its clone lives in `packages/sketch/node_modules/.cache/planegcs-build/`,
  under node_modules so Vitest skips the clone's own tests (it ran them when
  the clone sat in `planegcs/.work/`). Sketch tests
  import `../../planegcs/dist/planegcs.js`; the browser loads it through
  `@extrudo/sketch/browser` (`?url`).
- **Solver drag speed depends on iterations, not size alone** (P1-03): with
  temporary constraints planegcs runs an SQP from an identity Hessian every
  call. A chained 99-entity plate drags in 11 ms, a 52-curve gear loop in
  120 ms. Benchmark with an off-path pointer (a pointer on the feasible path
  converges in a few iterations and hides this):
  `BENCH=1 pnpm vitest run packages/sketch/src/solver/perf.test.ts`.
- **The OCCT WASM is not in git.** `packages/kernel/occt/dist/` is built by CI
  once per input hash (config + `facade/` + toolchain version) and published as
  the GitHub release `occt-<hash>`; `pnpm occt ensure` downloads it with `gh`.
  After changing the config or the facade, run `pnpm occt build` locally
  (Arch workstation; through `newgrp docker` until the next login) or let CI
  build it (preferred on the Ubuntu machine: the CI note below).
  The CI path is proven (run 36179601320, 2026-09-25): the `occt` job took
  about 16 minutes and published the release before the tests ran. After a
  local rebuild, restart the dev server: it keeps serving the old WASM.
- **A trap that moves when the heap or call order changes may be a stack
  overflow** (2026-10-11): build the native harness with the build's own stack
  (`-sSTACK_SIZE=8MB` today; it was 64 kB until ADR-0001's amendment of that day)
  and `-sSTACK_OVERFLOW_CHECK=2`, which names the frame. On the real build,
  painting the stack from JS between calls measures each call's depth (the
  stack is the 8 MB below the initial `__stack_pointer`, the first mutable i32
  global in the binary's global section). The OCCT bindings step compiles the
  facade without Emscripten's own headers (`emscripten/stack.h` is "file not
  found" there): declare such a function `extern "C"` yourself.
- **Facade C++ (`packages/kernel/occt/facade/`):** the toolchain binds every
  class in the file, so it holds one class with no overloaded names. Check it
  in seconds with `em++ -fsyntax-only` inside the image (README, Arch
  workstation) before a 10-minute build. OCCT 8 deprecates `TopTools_*`/`TColStd_*` typedefs (use
  `NCollection_*`), `Standard_False`, and `Standard_Failure::GetMessageString`
  (use `what()`); `DynamicType()` isn't available on `Standard_Failure`.
  `mallinfo()` doesn't link, so the memory probe is `sbrk(0)` (`heapTop()`).
- Biome needs `css.parser.tailwindDirectives` for Tailwind's `@theme` and
  `@custom-variant`, and the icon sources are exempt from
  `noSvgWithoutTitle` (they are decorative; controls carry the label).
- **Vite's watcher can miss a second edit to a file made within about a
  second of the first** (seen with two scripted edits in a row): the dev
  server keeps serving the old transform. `touch` the file, then reload.
- **planegcs's `internal_alignment_point2ellipse` does nothing useful in our
  build** (converges without moving, wrong DOF count; P1-05). Ellipses use
  ordinary constraints instead (ADR-0014). Vitest swallows `console.log` in
  probe tests: write to a file in the scratchpad to see output.
- **planegcs "solves" some contradictions by collapsing geometry** (P1-06):
  two horizontal lines made perpendicular become dots 0.0001 mm long, with
  `ok: true`, and `check()` accepts the constraint. The host refuses a user
  constraint whose solve shrinks a curve below 1 µm (`collapses` in
  `sketch/tools/host.ts`).
- **planegcs names redundant equations, not constraints** (P1-06): a
  multi-equation constraint (collinear, some midpoints) can be partly
  redundant and still remove a freedom, and duplicates get their redundancy
  spread over both. `SketchSolver.check` therefore decides "not needed" by
  comparing DOF with and without the constraint whenever any redundancy
  shows (`#dofWithout`); reports have `redundant` (all equations) and
  `partlyRedundant`.
- **planegcs "solves" contradicting dimension values** (P1-08): a line
  10 mm long by one dimension and 20 mm by another solves with `ok: true`,
  the second listed as redundant and simply unmet. Check that dimensions
  hold by measuring (`unmetDimensions` in `packages/sketch/src/solver/status.ts`).
  Constraints on fixed geometry alone come back as redundant too
  (`overdetermined`); the status ignores them.
- **The Claude browser pane freezes its page while the pane is hidden**:
  input times out ("Timed out getting the tab ready") and scripts hang for
  45 s. That's not an app hang; reload, or check the flow in Playwright.
- **Don't render tool UI through `React.lazy`**: a suspended boundary is held
  back for up to ~300 ms, and keys typed into the heads-up box in that time
  are lost (flaky e2e). Load the module and render the component directly.
- **The Claude browser pane's `type` action inserts text without keydown
  events**, so it can't test "typing goes into the heads-up box"; use `key`
  presses, or Playwright's `keyboard.type`, which do fire keydown.
- Vitest 5 takes test options as the **second** argument:
  `it(name, { timeout }, fn)`; the old third-argument form throws.
- **planegcs (P0-03):** the published `@salusoft89/planegcs` WASM has a fixed
  16 MB heap and aborts with `Aborted(OOM)` at about 100 entities in one
  system; we build our own (`spikes/p0-03-solver/planegcs-build/build.sh`).
  Its bindings generator needs tree-sitter, which doesn't compile on Node 26:
  it runs in a `node:20-bookworm` container. Endpoint tangency must be
  `angle_via_point`: `tangent_la` + coincident endpoints gives false
  redundancies and a wrong DOF from a solved state. Set
  `debug_mode = DebugMode.NoDebug` or it prints to stdout. Adding or removing a
  constraint re-runs the full diagnosis (QR); changing parameter values doesn't.
- **SolveSpace's `slvs` npm package (3.1.0-dev.14)** is an old dev build:
  fixed heap, `tangent()` aborts, no `setParamValue`, entity objects without
  `point`. Rejected in P0-03; don't re-evaluate it without a newer build.
- **`LineSegments2.computeLineDistances()` throws on an empty geometry**
  ("reading 'count'": no `instanceStart` attribute yet). Call it only after
  `setPositions` with at least one segment.
- **R3F can deliver `pointerout` for the plane behind after `pointermove` on
  the one in front** (propagation stopped). Clear a hover only if it still
  names the object that was left (read the store, not the render closure).
- **A `fix` constraint holds whatever position the sketch stores** (P1-10):
  move a fixed point in the same change and the solve accepts it where it
  moved. Refuse such changes yourself (Scale does); a solve won't.
  `dimensionValues` reads cached parameter values first, so a dimension
  whose expression a change rewrites must be evaluated directly (the host
  does this for `exprs`).
- **The dev server takes an assigned port** (`.claude/launch.json` has
  `autoPort` and `--port "${PORT:-5173}"`), so a second session can run its
  own server while another holds 5173.
- **Export golden files** (`packages/sketch/src/export/golden/`) are
  rewritten with `UPDATE_GOLDEN=1 pnpm vitest run packages/sketch/src/export`;
  review the diff. Inkscape is installed on the Arch workstation
  (2026-09-27; not on the Ubuntu machine): `inkscape
  --query-width f.svg` gives px at 96/in (377.953 = 100 mm), and
  `--export-type=png --export-dpi=25.4 --export-area-page` makes 1 px = 1 mm
  (`rsvg-convert -d 25.4 -p 25.4` works too). ezdxf isn't installed; a throwaway venv in the scratchpad
  (`python3 -m venv … && pip install ezdxf`) audits DXF files. E2E export
  tests read the dialog's `data-export-summary` and the file from
  `page.waitForEvent('download')`. The Sketch tab's Export tile is named
  "Export" (its short label): find it inside the "Export" group.
- **OCCT profile facts** (P2-02): General Fuse (`BOPAlgo_Builder`) refuses
  a single argument and never splits an edge at its own crossing;
  `BOPAlgo_BuilderFace` keeps dangling edges and bridges inside faces and
  makes a circle touching the outline from inside a second wire of the
  same face (sharing a vertex). The facade handles all four; see ADR-0025.
- OCCT's STEP writer prints a banner to stdout from inside WASM. Route
  Emscripten's `print` to a logger (or ignore it in tests).
- **three-mesh-bvh must be built with `{ indirect: true }`**: the default
  BVH reorders the geometry's index buffer, which breaks `faceRanges`.
- Importing `@react-three/fiber` into a module a node unit test imports
  makes Vitest print `THREE_CJS_DEPRECATED`; keep such modules free of
  R3F hooks.
- **OCCT history facts** (P2-04, P2-06): `BRepPrimAPI_MakeRevol::Generated`
  returns nothing for edges square to the axis in a full revolution (the
  facade asks `Revol().Shape(edge)`); a boolean's `Generated(face)` gives
  section edges and vertices, never faces; without `SimplifyResult`,
  coplanar overlapping faces get split; use
  `MapShapesAndUniqueAncestors` (a seam edge lists its face twice
  otherwise); `BRepAlgoAPI_BuilderAlgo::Clear()` is protected (builders
  on the stack free themselves; the `Clear()` rule is for builders deleted
  from JS); `BRepOffsetAPI_DraftAngle` calls tilted faces *generated*
  (use `ModifiedShape`) and returns "valid" solids whose sides have
  crossed (the facade checks); `BRepExtrema_DistShapeShape` detects
  "inside" only for a top-level SOLID. OCCT sources are in the image at
  `/opencascade.js/deps/OCCT/src/`; in the native harness, run the
  container as root to write the emscripten cache, and `#define private
  public` reaches private helpers.
- **Kernel test suites**: topological naming `pnpm vitest run
  packages/kernel/src/naming`; the extrude option golden table
  (`packages/kernel/src/features/golden/extrude-options.json`, 108
  combinations) is a file snapshot: update with `pnpm vitest run -u
  packages/kernel/src/features/extrude` and review the diff. The kernel
  tsconfig has no node types: use `toMatchFileSnapshot`, not `node:fs`.
- **Body names and projection syncs are amended into the latest undo
  step** (`DocumentState.amend`): a test that dispatches a feature and
  then calls `model.computed({…, doc})` sees the names join that step,
  and `undo` removes both.
- **WASM heap growth with a warm cache** (P2-07, closed 2026-10-06): a worker
  that reaches the browser's limit is replaced between recomputes (P4-12 §H4,
  `Recomputer`'s `heapRecycleBytes`, 1 GiB by default), which frees the whole
  heap but recomputes cold.  The growth itself is **mesher fragmentation under
  mimalloc**, not a leak: the revolve document's top moves 10.7 MB per 100
  recomputes, all of it in `mesh` (`HEAP_ATTRIBUTE=1`, which now skips
  `heap`/`stats` or it recurses), and it needs **fresh** shapes going through
  `BRepMesh_IncrementalMesh` while the cache holds live triangulations (no mesh,
  or re-meshing one shape, is flat). The mesher's transient
  `NCollection_IncAllocator` blocks are freed each mesh but not reused, because
  the cached triangulations are interleaved with them. `spikes/p4-12-heap-growth`
  (facade `#include`d, `heapTop()`; `run.sh`/`sweep.sh`/`sweep-minimal.sh`,
  `NOMESH`/`MODE=same`/`CLEAN`/`COPY`/`MI`) reproduces and tried the cures:
  `BRepTools::Clean`, meshing a copy, dlmalloc and the mimalloc options
  (`mi_collect`, `purge_delay`, `page_full_retain`) — none flat; OCCT's
  `MEMORY_BLOCK_SIZE_HUGE` can't be patched (no toolchain hook). It stays
  bounded by the recycle (1 GiB, ~8,500 recomputes; a lower default was
  rejected because a cold B9 recompute is 8 s, `HEAP_BOUND=1 … heap-bound`).
  The warm-cache probe checks 20 MB/100 and `mesh-golden.test.ts` fingerprints
  every fixture body's mesh. Memory tests of big booleans clear the engine each
  run and warm up through every value first.
- **Slicers on the Arch workstation** (2026-09-28; none on the Ubuntu
  machine): `prusa-slicer --info
  f.3mf|f.stl` prints `manifold = yes`, facets, volume per object;
  `orca-slicer --datadir <scratch> --outputdir <dir> --export-3mf out.3mf
  f.3mf` re-exports (`Metadata/model_settings.config` has names and
  `mesh_stat` repair counts; its CLI ignores file colours). `freecadcmd
  script.py` with `Import.insert` reads STEP names and solids. lib3mf
  installs with pip in a scratchpad venv (`lib3mf.get_wrapper()`, reader
  `SetStrictModeActive(True)`, `IsManifoldAndOriented`). Bambu Studio
  isn't installed.
- **Export meshes weld through the topology, not by position** (P2-12):
  every edge's polygon on each face's triangulation lists that face's
  nodes along it; BRepMesh discretises an edge once, so both faces'
  polygons match node for node. A degenerate edge (pole, apex) collapses
  to its vertex, and triangles that become degenerate are dropped. Mesh
  a copy (`BRepBuilderAPI_Copy(s, false, false)`): BRepMesh keeps an
  existing triangulation that is fine enough, so meshing the cached shape
  would leave coarse exports fine and refine the display.
- **Facade checks with Docker on the Ubuntu machine** (since 2026-09-29;
  `sg docker -c '…'` until the shell has the group): `em++
  -fsyntax-only` and the native harness both run in
  `ghcr.io/taucad/opencascade.js:3.0.2-single-threaded` (`--user 0`, harness
  in the scratchpad, `-sERROR_ON_UNDEFINED_SYMBOLS=0` and `TKDESTEP TKXSBase
  TKDE` among the libs so the whole facade links). Real OCCT 8.0.1 headers
  are also at `https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/src/…`
  (the tag's tarball works for grepping the sources: `src/ModelingAlgorithms/TKFillet/…`).
  Changing the facade changes the OCCT input hash, so `pnpm build`/`pnpm
  wasm` fail until CI has published it; `pnpm --filter @extrudo/web build`
  and Vitest/Playwright still work with the `dist/` you have.
- **OCCT builds through CI** (the preferred way on the 4-core Ubuntu
  machine; works from either machine): push a branch (only `main` and pull requests trigger CI by
  themselves) and run `gh workflow run ci.yml --ref <branch>`; the `occt`
  job builds that branch's inputs in about 14 minutes and publishes
  `occt-<hash>`, then `pnpm occt ensure` downloads it. The dispatch needs the
  workflow file on `main`; runs of one ref cancel each other, so run
  experiments from separate branches (and delete the branch afterwards).
- **`node scripts/measure-startup.mjs`** prints the size table and times a
  first visit, a repeat visit and an offline visit under CDP throttling
  (`--mbit`, `--no-browser`); it uses `PLAYWRIGHT_CHROMIUM_PATH` for a
  system Chromium (on the Ubuntu machine `/usr/bin/google-chrome`). The
  ADR-0037 numbers were measured on the Ubuntu machine.
- **The scratchpad is shared between agents in one session**: put harness
  files in your own subfolder (`<scratchpad>/<task>/`); `harness.js` from
  another task once ran in place of a fresh build. Shell commands that
  mix `&&`, heredocs and `python3 -` are sometimes refused by the worktree
  guard: write scripts with the Write tool and run them as one plain
  command.
- **Fuzzing** (`packages/kernel/src/fuzz.test.ts`, P3-13): 200 seeded steps
  per fixture in CI; `FUZZ_STEPS=1500 FUZZ_REPORT=1` for a long run with a
  report (counts of every feature message, warm recompute times; the report
  shows as a soft failure), `FUZZ_SEED` for another sequence, `FUZZ_ONLY=B9`
  for one fixture (a slow one on its own), `FUZZ_HEAP=n` for heap samples. Warm-cache heap of the revolve document: `HEAP_RUNS=n
  … memory.test.ts -t "warm cache"` (about 0.3 s a run; `HEAP_MAX_ENTRIES`,
  `HEAP_ONLY=G|R|F|GF|RF|GR`): it grows about 11 MB per 100 recomputes with
  all three revolves, not with any subset (ADR-0050 §6's 2026-10-06 amendment,
  the item closed): `HEAP_ATTRIBUTE=1` prints which `Kernel` call grew the top,
  and it is `mesh` alone, on **fresh** shapes (`spikes/p4-12-heap-growth` is
  the harness; `NOMESH`/`MODE=same` are flat). Cold recompute times per fixture:
  `HEAP_BOUND=1 … kernel/src/heap-bound`, and the display mesh's fingerprint:
  `pnpm vitest run -u packages/kernel/src/mesh-golden`. **Our OCCT
  build already links mimalloc** (the toolchain default); cures tried and
  rejected are in the ADR (dlmalloc grows smoothly at the same rate and is 30 %
  slower; `BRepTools::Clean`, meshing a copy and the mimalloc options don't
  cure it). Silhouette
  cost: `BENCH=1 … viewport/silhouette.test.ts`; booleans of many tools:
  `BENCH=1 … kernel/src/boolean-bench.test.ts`. A native OCCT harness for
  such experiments builds in the image by its digest (the tag shows as
  `<none>` on the Arch workstation): `docker run --rm --user 0 -v
  <dir>:/w -w /w --entrypoint sh <image id> -c 'em++ … && node h.js'`.
- **The fuzzer covers B1-B10 (B8 and B10 since P4-11) plus the P4-01 sweep
  fixture** (P3-17, ADR-0038/0047 amendments; B8 and B10 at the full 200
  steps — 70 s and 14 s — and both load the bundled font first, as the worker
  does, so B8's emboss has ink to stand on while it is edited). **B9 is back in
  the default run since P4-12 (ADR-0067 §H2) at 200 steps with its own 60 s
  step limit, and B8 has a 30 s one**; `FUZZ_ONLY=B9` runs a single fixture.
  The old reason B9 was out (`FUZZ_B9=1`, 6 steps) was two things, both fixed
  or known: `mergeTools` asked OCCT for the exact distance between two thread
  tools, and a thread of about 400 turns corrupted the WASM heap. B9 runs 120
  steps at a 90 s step limit (measured on a 4-core machine: 5 ms median, 18 s at
  the 95th percentile, 39 s the slowest, which builds a thread), B8 gets 40 s
  (its `× 10000` dimension took 11.8 s).
  **`mergeTools` now merges two tools whose boxes overlap without that distance
  when either has more than `HEAVY_TOOL_FACES` (200) faces**
  (`operation.ts`'s `isHeavyTool`); light tools still get the exact test, which
  matters: the distance between the tools of two 36- and 30-turn threads is
  **277 s** in one call (`thread.test.ts` times every `Kernel` method to find
  it), while B9's own few-turn threads cost seconds. **The 400-turn heap trap is
  OCCT running out of memory, not a bug** (`spikes/p4-12-threads/` bisected it:
  `IntCurvesFace_Intersector`'s constructor unwinding into a virtual call on a
  null object, the heap 403 MB → 1903 MB at 350 turns and over 2 GB at 400),
  and the tooth is now cut out of the ring in pieces of `THREAD_CHUNK` turns,
  so a boolean only meets one piece's faces (600 turns build that way);
  `MAX_TURNS` stays 150 because a piece-wise cut costs 0.35 s a turn, so 150 is
  already 25-40 s:
  B5's `FUZZ_SEED=7` and `FUZZ_SEED=2026` at `FUZZ_STEPS=1000` reached a
  pattern of 2 × 20 instances that took 55 s; it takes 2.4 s since `operate`
  finds targets solid by solid (`pattern-bench.test.ts`: `BENCH=1`, prints the
  time per `Kernel` method), and both sequences run in the default test.
  **A wasm trap (`RuntimeError: null function or function signature
  mismatch`) is a null-pointer call inside OCCT**: find it by dumping the
  failing body (`kernel.writeStep` in a wrapper around the call), reading it
  back in a native harness built with `-g2 -sNODERAWFS=1` (function names
  appear in the trace) and sweeping the parameter in separate processes. The
  fillet one is `Geom2dAdaptor_Curve::EvalD1` under `ChFi3d_Builder::StartSol`
  when a round's contact line leaves a face through a wall parallel to the
  edge; the facade refuses it first (`filletRollsOff`). The second one,
  `memory access out of bounds` in `TopOpeBRepBuild_Builder::MergeSolid` under
  `ChFi3d_Builder::Compute`, is two rounds meeting at a corner where one runs
  over a curved boundary of its face (a rod lying on a step); `filletRollsOff`
  refuses that too, for chains that meet another (ADR-0038's 2026-10-10 amendment). **Never `scope.keep`
  inside a loop or round that can still throw**: keep after the last thing
  that can fail (a later failure leaks what was kept; strict leaks catches it).
- **IndexedDB and the second tab** (P4-09's follow-up): the database is at
  version 2 (the linked folder's handle store), and an upgrade is held up by
  **every other tab of this origin** — silently, or the app never finishes
  opening. `openDatabase(factory?, name?, { onBlocked, onVersionChange })` is
  how storage says both (the `blocked` request keeps waiting and succeeds when
  the others let go; a connection gets `onversionchange` → the callback, then
  closes), and `webPlatform()` words them through `platform/databaseNotice.ts`:
  "Close Extrudo's other tabs to finish updating." while the open waits, and in
  the tab that lets go "Extrudo was updated in another tab. Reload this tab to
  keep working." with a Reload button that saves first. Its store is wrapped in
  `closedStorage`, which replaces **only** the browser's closed-connection
  `InvalidStateError`. The toasts need a page before the app is mounted: the
  notification store is one per page (`appNotifications`) and `main.tsx` draws
  `ToastsOnly` while `webPlatform()` runs. `e2e/storage.spec.ts` covers it with
  two pages of one context: the second tab's init script makes
  `indexedDB.open` throw (so it holds no connection of its own) and keeps the
  real one as `window.__idbOpen`, which then upgrades the database by one
  version.
