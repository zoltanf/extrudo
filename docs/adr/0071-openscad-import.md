# ADR-0071: OpenSCAD import (`.scad` files as mesh bodies)

- **Status:** Accepted, 2026-10-05 (slice 1 implemented)
- **Task:** P5-04 (FR-IO-08: "OpenSCAD `.scad` import as a mesh body (through
  openscad-wasm)").
- **Builds on:** ADR-0066 (attachments for imports, the `import` feature, files
  reaching the worker, mesh bodies on manifold-3d, the lazily loaded second
  WASM), ADR-0067 (no `'unsafe-eval'`; a recycled or crashed worker gets its
  resources again through `#resend`), ADR-0054 (the content policy, the licence
  allow-list and `NOTICE`), ADR-0037 (the precache and its size), ADR-0069 (the
  headless CLI), ADR-0024 (the engine and its cache key), ADR-0038 (numbered
  input sets), ADR-0068 (the API generator reads every input's schema).

## Context

OpenSCAD is how a large part of the 3D-printing community shares parametric
parts: Thingiverse's Customizer, Printables' "OpenSCAD" models, BOSL2 and MCAD.
A `.scad` file is a program that makes a mesh. Extrudo already has everything
after the mesh (ADR-0066: a mesh body, booleans with solids, transforms,
export); what it lacks is the compiler, and — the point of doing this at all —
a way to make the file's top-level variables follow the document's parameters,
so a downloaded customizer part becomes a part of a parametric design.

OpenSCAD runs in WebAssembly. Three builds exist, and the spike
(`spikes/p5-04-openscad/`: `fetch.sh`, `bench.mjs`, `heap.mjs`, `more.mjs`,
`browser.mjs`) measured them in Node 24 and in Chrome under the app's real
headers (`apps/web/public/_headers`' `/*` block: COOP/COEP and `script-src
'self' 'wasm-unsafe-eval'`), on the 4-core Ubuntu machine.

### What the spike measured

| | `openscad-wasm-prebuilt` 1.2.0 (npm) | `openscad-wasm` 0.0.4 (npm) | **Upstream snapshot 2026.10.05** (files.openscad.org) |
|---|---|---|---|
| Licence | GPL-2.0-or-later | GPL-2.0 (only) | **GPL-2.0-or-later** (OpenSCAD's own) |
| Packaging | one 11.07 MB `.js`, the WASM base64 inside | one 13.93 MB `.js`, base64 inside | `openscad.js` 0.10 MB + `openscad.wasm` |
| WASM raw / gzip / brotli | 8.18 / 2.65 / 1.92 MB | 10.33 / 3.16 / 2.21 MB | **11.00 / 3.35 / 2.32 MB** (glue 0.10 / 0.02 / 0.02) |
| `eval` / `new Function` in the glue | none | none | **none** |
| Fetches anything cross-origin | no | no | **no** (with `instantiateWasm` it fetches nothing at all) |
| Manifold backend | `--enable=manifold` (2025 dev build) | flag ignored: CGAL | **`--backend=manifold`, the default** |
| Cube − cylinder (`$fn=64`), Node | 288 ms | 211 ms | **54 ms** (29 ms median in a warm process) |
| `minkowski` cube + sphere `$fn=64` | **traps**, heap 3.3 GB | traps | **156–189 ms**; CGAL 830 ms |
| 100 `difference`s in a plate | instance dead | instance dead | **230–251 ms**; CGAL **72 s** |
| `minkowski` sphere `$fn=300` + cube | – | – | 2.8 s, 83 MB of WASM heap, 4.6 MB of STL |

The snapshot in a **nested module worker** inside a module worker (the kernel
worker's shape) under the app's headers, in Chrome: `crossOriginIsolated`
true, **no policy violation and no console error**; `compileStreaming` of the
11 MB WASM 68–87 ms, an instance from the compiled module 7–15 ms (59 ms the
first time), cube − cylinder 13–26 ms, the minkowski 175 ms, the 100
differences 245–250 ms. A tail-recursive loop of 10⁹ steps was stopped by a
3 s timer with `worker.terminate()`; a new worker compiled the next file 15 ms
after its own 68 ms compile.

**Instances.** The snapshot's `callMain` exits the runtime when `main`
returns, after which every call throws "program has already aborted!", unless
the module is made with `noExitRuntime: true`; then one instance can compile
again and again — but it keeps OpenSCAD's geometry and CGAL caches between
runs (16 MB of heap grew to 48 MB over 50 different files, and a repeated file
is a cache hit at 1.8 ms). A **fresh instance per compile** from an already
compiled `WebAssembly.Module` costs 10–13 ms in Node (median total 42 ms for
the cube − cylinder against 29 ms reused), starts at 16 MB, carries no state
from the last file and frees its whole heap when it is dropped.

**Output.** Binary STL is float32 (7 digits, a relative error); OFF is printed
with **6 significant digits** (`16.7336`: lossy); **3MF is indexed and has 6
decimals** (1 µm absolute at any size), plus the `color()`s as
`basematerials`. `@extrudo/io`'s `read3mf` reads OpenSCAD's 3MF as it is
(296 nodes, 584 triangles, `checkManifold` ok for a red cube and a blue
sphere: two solids in one object, which `decompose()` takes apart).

**Determinism.** The same source gives byte-identical output twice in fresh
instances and 50 times in one instance (STL hashed; the 3MF carries a random
`p:UUID`, the geometry is the same).

**Messages** (stderr; the exit code is 1 for a fatal one):

| Case | OpenSCAD says | Exit |
|---|---|---|
| Syntax error | `ERROR: Parser error: syntax error in file /in.scad, line 3` | 1 |
| 2D result | `Current top level object is not a 3D object.` | 1 |
| Nothing | `Current top level object is empty.` | 1 |
| `assert` | `ERROR: Assertion 'false' failed: "too thin" in file /in.scad, line 1` | 1 |
| `echo` | `ECHO: "hello", 3` | 0 |
| A warning | `WARNING: undefined operation (undefined + number) in file /in.scad, line 1` | 0 |
| Missing `include` | `WARNING: Can't find include file 'MCAD/gears.scad'. in file /in.scad, line 1` | **0**: the model goes on without it |
| Missing `use` | `WARNING: Can't open library 'missing.scad'. in file …, line 1` | 0 |
| `import("part.stl")` with no such file | `WARNING: Can't open import file '/part.stl', import() at line 1` | 1 (empty) |
| `text()` | `WARNING: Can't get font  in file …` (and with a `fonts.conf` and Inter in MEMFS the call **traps**: null function) | 1 (empty) |

Every message line is preceded by "Could not initialize localization", and a
successful run ends with a dozen lines of statistics; both are noise.
`include`/`use`/`import()` of a file that *is* in MEMFS work.

**The customizer.** `-o x.param` / `--export-format=param` prints the file's
customizer variables as JSON (`name`, `caption`, `group`, `initial`, `min`,
`max`, `step`, `type`: number, string, boolean, vectors). `-D name=value`
overrides a top-level variable; the definitions are appended after the file,
so an error in one is reported on a line past the file's end, and **a name the
file doesn't have is accepted silently**.

**Memory.** The glue's `getHeapMax()` is 4 GB (the 32-bit limit). It is one
arrow function in the glue; replaced by `Module.heapMax`, a 64 MB ceiling
stopped the `$fn=300` minkowski at 57.6 MB with a trap ("memory access out of
bounds"), cleanly, inside its own worker.

## Decision

### 1. The build: OpenSCAD's own WebAssembly snapshot, pinned and mirrored

The **upstream snapshot** (`OpenSCAD-2026.10.05-WebAssembly-web.zip`,
sha256 `a27c8852…825ef3d`), not either npm package: it is the only build with
Manifold as its backend (5–300× faster than CGAL on every model above, and the
npm builds trap on ordinary models), it is GPL-2.0-or-later, its glue
evaluates no strings, and the WASM is a separate file (streaming compile, a
hashed asset, no 11 MB of base64 in a JS chunk).

files.openscad.org keeps snapshots for about nine months, so the build is
**mirrored as our own release** through the scheme OCCT and planegcs use
(`scripts/wasm-release.mjs`): `packages/openscad/openscad.mjs` is a
`wasmRelease` whose "build" downloads the pinned zip, checks its sha256,
unpacks `openscad.js` and `openscad.wasm` into `packages/openscad/dist/` and
applies one patch to the glue (§6's ceiling); CI's `openscad` job publishes
`openscad-<hash>` once per input hash, `pnpm wasm` downloads it, and **`ensure`
falls back to the build itself** when the release is missing (it is a download,
not a Docker build, so anyone can run it). `dist/` is not in git.

### 2. A `.scad` file is an attachment the `import` feature reads

A new media type **`application/x-openscad`** (`.scad`) in core's
`media-types.ts`, in `MODEL_MEDIA_TYPES` (so `FILE_INPUT_MEDIA_TYPES.import`
takes it, and `isModelMediaType`) and its own `isScadMediaType`. The
evaluator compiles the file to a 3MF and goes on through **ADR-0066's mesh path
unchanged**: `read3mf`, `units` (as for a mesh: `auto` and `mm` are 1 mm per
OpenSCAD unit), `up`, `meshFrom` with its closed-solid check and message, one
body per piece (`decompose()`), names `mesh:<feature>` and `#2`, `#3`… No new
feature type, so no file-format §6.31.

### 3. A package of its own, loaded only for a design that needs it

`packages/openscad` (`@extrudo/openscad`, GPL-3.0-or-later; nothing internal):
the compile protocol's types, the run (one OpenSCAD instance per compile from
a compiled module), the wording of OpenSCAD's messages, and two compilers that
each run OpenSCAD in **a worker of its own** — `./node` (a `worker_threads`
worker) and `./browser` (a nested module worker). The kernel imports **types
only** from it; the kernel worker's entry (`worker.ts`) loads `./browser` with a
dynamic `import()` when `KernelApi.enableOpenscad()` is first called, and Node
callers (the CLI, tests) pass `./node`'s compiler in through
`KernelServiceOptions.openscad`. A design without a `.scad` import loads none of
it. `enableOpenscad()` also enables meshes (a compile's result is a mesh body).

**Why a worker of its own, not the kernel's thread.** `callMain` is
synchronous and OpenSCAD has no time limit: a runaway `for` or recursion in
the kernel's thread would hang the kernel worker for good (the client restarts
a *crashed* worker, not a busy one), and a trap would take the OCCT heap with
it. In its own worker a compile can be stopped (`terminate()`, measured above),
its memory goes with the instance, and the kernel survives anything the file
does.

**That makes the compile asynchronous, and evaluators are synchronous**, so the
engine gets one small hook: a feature definition may have **`prepare(ctx):
Promise<unknown>`**, awaited by the walk right before `evaluate` (after the
yield that lets a newer request cancel, and checked for cancellation again
after it), whose result `evaluate` reads as `ctx.prepared`. A `KernelError`
thrown by `prepare` is the feature's error as if `evaluate` had thrown it. It
runs only when the cache misses, so the compile is cached by the engine's
ordinary key: the file's attachment ID (content-addressed) and the override
values. `prepare` makes no shapes, so scopes and strict leaks are unchanged.

### 4. The WASM is not precached (slice 2)

11.0 MB raw / 2.32 MB brotli is +44 % raw on the app's 24.76 MB precache
(ADR-0066 slice 3) for a feature few designs use; manifold's 0.54 MB was 3 %.
So `openscad.wasm` joins the demo clips in `precache-plugin.ts`'s `SKIPPED`
and the service worker **caches it at runtime on first use** (a cache of its
own, kept across updates while its hashed name is the same): the first `.scad`
import needs the network once, every later one works offline. Offline before
that, the feature says so: "OpenSCAD isn't downloaded yet: connect to the
internet once to compile gear.scad." This is slice 2's (the app's) to build.

### 5. Parameters: numbered overrides, in slice 1

The `import` feature gets **up to 32 overrides** of the file's top-level
variables, as numbered input pairs in ADR-0038's manner: `scadName`,
`scadValue`, `scadName2`, `scadValue2` … `scadName32`, `scadValue32`.

- `scadName<n>` is an `enum` input whose value is the variable's name (any
  OpenSCAD identifier, `$fn` included: `^\$?[A-Za-z_][A-Za-z0-9_]*$`); the
  schema can't list the values, since they come from the file. The API
  generator types an enum with no listed values as `string`.
- `scadValue<n>` is an **`expr`** with its own `unit` (`length`, `angle` or
  `unitless`, default `unitless`): a value bound to a document parameter keeps
  that parameter's unit, so `width` (a length) can drive `box_width`. The kernel
  passes the evaluated number through as it is — Extrudo's base units are
  millimetres and degrees, which are OpenSCAD's — as `-D name=<number>`.
- A name the file doesn't have is a **warning** ("gear.scad has no variable
  teeth_count: its override does nothing."), checked against the file's own
  parameter list, which the same compile asks for; a pair with only one half,
  or a name twice, is an error.
- Numbers only. Strings, booleans and vectors (`show_lid = true;`) are
  Deferred: they need input kinds the document doesn't have.

They are plain inputs that survive ADR-0003's rules (a recipe, no IDs) and the
API generator, so a script writes `d.import({ file, scadName: 'teeth',
scadValue: 'teeth' })`. The cache key is the engine's: the file and the
evaluated values, so a changed parameter recompiles and an unchanged one is a
hit. The dialog that fills them from the file's customizer list is slice 2.

### 6. Limits and messages

- **Time:** 60 s a compile, then the worker is terminated and a new one made:
  "gear.scad took longer than 60 s to compile, so Extrudo stopped it: simplify
  the model (a lower $fn, fewer minkowski steps)."
- **Memory:** a 1 GiB ceiling through the glue patch (`getHeapMax` reads
  `Module.heapMax`): "gear.scad needed more than 1 GB of memory to compile…". A
  trap below the ceiling is "OpenSCAD stopped while compiling gear.scad: …".
- **Errors** are OpenSCAD's own text, worded in the app's style and pointed at
  the file and line: "gear.scad, line 12: syntax error.", "gear.scad, line 3:
  assertion failed: "too thin"."; a 2D-only result "gear.scad makes a 2D shape:
  Extrudo imports 3D solids (extrude it with linear_extrude or
  rotate_extrude).", an empty one "gear.scad makes nothing…".
- **A missing `include`/`use`/`import()` is an error naming the file**
  ("gear.scad, line 1: can't find MCAD/involute_gears.scad: Extrudo compiles one
  .scad file on its own, without libraries."), where OpenSCAD only warns and
  goes on with a wrong model.
- **`echo()` and warnings are the feature's warnings**, at most five, then "…
  and 7 more messages from OpenSCAD."; `text()` without fonts is a warning that
  says so.

## Slices

1. **Kernel, Node, CLI, docs** (this one): the package, the mirror and its CI
   job, the media type, the overrides, the engine's `prepare`, the `import`
   evaluator's `.scad` branch, `KernelApi.enableOpenscad()` and the worker's
   loader (code path; the `Recomputer` calls it in slice 2), the CLI, fixtures
   and tests with real OpenSCAD in Node, `docs/file-format.md`, the API pages,
   licences.
2. **The app**: the Insert tab's Import accepting `.scad`; the dialog's
   overrides (the file's customizer list from `KernelApi.scadParameters`, each
   variable a row with an `<ExpressionInput>` bound to a parameter or a value);
   the `Recomputer` sending the file and calling `enableOpenscad()` (and again
   after `#resend`); the runtime cache rule in `sw.js` and `SKIPPED`; the
   offline message; `e2e/import-scad.spec.ts` and `e2e/hosting.spec.ts` with a
   `.scad` import; the Customizer showing a design whose parameters drive a
   `.scad` part.

## Rejected

- **`openscad-wasm-prebuilt` / `openscad-wasm` from npm:** older, CGAL-bound or
  trapping on a minkowski and a 100-hole plate, the WASM base64 inside an
  11–14 MB JS file; the second is GPL-2.0-only.
- **Compiling in the kernel's thread:** no time limit is possible, a trap kills
  the kernel, and OpenSCAD's caches would grow the kernel worker's memory.
- **Compiling before the recompute** (the `Recomputer` or the CLI compiles each
  `.scad` and sends the mesh as a file): the override values are the engine's
  to evaluate, previews have their own, and the cache key would be built twice.
- **One OpenSCAD instance for every compile:** 13 ms cheaper, but its caches
  grow without a bound we set and state from one file reaches the next.
- **OFF or STL as the hand-over:** OFF loses digits; STL is float32 and
  unindexed. 3MF keeps 1 µm and the colours.
- **A new input kind for overrides** (a record of name → expression): every
  consumer of input kinds (the API's generator and call mapping, the dialogs,
  the file format) would need a case, and the numbered pairs already work.

## Deferred

- Libraries (MCAD, BOSL2) and multi-file designs (`include`/`use` of other
  attachments), `import()` of attachments, `text()` with the bundled fonts (the
  snapshot traps with a hand-made `fonts.conf`).
- String, boolean and vector overrides; colours from `color()` onto bodies.
- Replacing the `.scad` file of an import (ADR-0066's Deferred).
