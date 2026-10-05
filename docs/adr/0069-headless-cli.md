# ADR-0069: The headless CLI (`extrudo`)

- **Status:** Accepted, 2026-10-05
- **Task:** P5-03 (FR-PRG-03: "Headless CLI (Node): recompute a project with
  overridden parameters and export STL/3MF/STEP, for batch variants and CI";
  NFR-10: core, solver adapter and kernel run headless in Node).
- **Builds on:** ADR-0068 (`@extrudo/api`: `Design.from`, parameters,
  configurations), ADR-0024 (`RecomputeEngine`, `KernelService`), ADR-0034
  (export: `exportMesh`, `writeStl`, `write3mf`, `writeStep`, `checkManifold`),
  ADR-0011/ADR-0050 (the solver, `solveGradually`), ADR-0016 (a parameter
  change re-solves the sketches that use it), ADR-0058/0061 (fonts, attachments),
  ADR-0066 (mesh bodies need manifold-3d, files go to the kernel), ADR-0059
  (configurations), ADR-0009/0061 (`.extrudo` archives).

## Context

The app recomputes a design in a kernel worker after the UI thread has solved its
sketches; a parameter change goes through the shell's `apply`, which re-solves
every sketch whose dimensions use it in the same step (ADR-0016). Everything
underneath already runs in Node: the engine, the facade's WASM, planegcs, the
io writers and the API. What is missing is one place that does in Node what the
app does around them: load an archive with its attachments, apply parameter
changes and re-solve, give the kernel its fonts and files, recompute, export,
and say what went wrong in a way a shell script can act on.

## Decision

### 1. A package with a binary

`packages/cli` (`@extrudo/cli`, GPL-3.0-or-later, `"bin": { "extrudo":
"./bin/extrudo.mjs" }`), Node ≥ 24. Depends on api, core, sketch, kernel (its
Node entry), storage (archives), io (writers), fonts. Boundaries: add it to
`scripts/check-boundaries.mjs`; nothing depends on it. In the repo it runs as
`pnpm extrudo …` (a root script) or `node packages/cli/bin/extrudo.mjs …`;
publishing to npm (bundling the two WASM files and the fonts) is P6's.

### 2. A library first, the CLI on top

`packages/cli/src/headless.ts` exports what the commands use, so tests and other
Node code call it directly:

```ts
const job = await openDesign(bytes | path);             // archive → Design + attachments
job.setParameters({ width: '60 mm', wall: 3 });         // expressions; re-solves sketches
job.applyConfiguration('Large');
const result = await job.compute();                     // bodies, errors, warnings, timings
const files = await job.export({ format: '3mf', bodies, resolution: 'fine' });
await job.save(path);                                    // .extrudo with the changes
job.dispose();                                           // frees the kernel
```

- **Parameter changes re-solve** the sketches whose dimensions read a changed
  parameter (directly or through other parameters), with `solveGradually`, as the
  app's host does; a sketch that fails to solve is an error in the result (its
  name and the solver's message), not a silent stale shape. The rules live in one
  shared function both the app's host and the CLI call if the app's version can
  move to `@extrudo/sketch` cleanly; otherwise the CLI's copy is tested against
  the same cases (the slice says which it did). It takes a **scope**: the app's
  rule (only the sketches whose own values moved — it runs on every slider step)
  and the CLI's (every sketch, so nothing is exported stale) are the same code
  with different arguments.
- **Fonts and files:** bundled fonts from `@extrudo/fonts` on disk; attachments
  (fonts, STEP, meshes) from the archive, given to the kernel the way the
  `Recomputer` does (`addFont`, `addFile`, `enableMeshes` when a mesh import
  exists).
- `compute()` runs the engine once (cold), returns per feature its status and
  messages, and per body its name, volume, box and face count.

### 3. Commands

```
extrudo info <design.extrudo> [--json]
extrudo export <design.extrudo> --format stl|3mf|step [--out <path>]
        [--param name=expr]… [--config <name>] [--bodies a,b]
        [--resolution coarse|medium|fine|<deviation mm>] [--json]
extrudo set <design.extrudo> [--param name=expr]… [--config <name>] --out <new.extrudo>
extrudo check <design.extrudo> [--param …] [--config …] [--json]
```

- `info`: parameters (expression and value), configurations, features with
  status, bodies (after a recompute).
- `export`: one file for 3MF/STEP (all chosen bodies), STL one file per body
  unless `--out` names a single file and one body is chosen; default output next
  to the input with the format's extension. 3MF keeps names and colours as the
  app's export does (the same `modelExport` code path where it can be shared;
  otherwise the same io calls with the same options).
- `set`: writes a new archive with the changes (versions and attachments kept).
- `check`: recomputes and exits non-zero when any feature has an error (for CI
  of a design library).
- **Exit codes:** 0 ok; 1 usage; 2 the design has errors (`check`, or `export`
  where a chosen body doesn't exist); 3 a file can't be read or written. Messages
  on stderr in the app's wording; `--json` prints one JSON object on stdout.
- `--param` takes the app's expression grammar with units (`width=60mm`,
  `angle=30deg`); an unknown name or a bad expression is a usage error naming it.

### 4. Speed and memory

One kernel per process, disposed at the end. `export` of B1-B10 each under 10 s
on the CI runner; a test records the times in the Results.

## Slices

1. `headless.ts` (open, parameters with re-solve, configurations, compute, export,
   save), tests on the benchmark fixtures: B4 with `clearance` changed recomputes
   to the same volumes the B4 e2e reads; B2 `wall` change re-solves its offset
   sketch; a design with user fonts and a STEP import (fixtures from P4-03b and
   P4-06) computes; a mesh import enables manifold.
2. The binary and its commands, exit codes, `--json`, tests that spawn the CLI on
   fixtures (Node child process), docs (`docs/cli.md`, README, CLAUDE.md), the
   roadmap tick.

## Rejected

- **Driving the web app headless (Playwright) for exports:** slow, needs a
  browser, and hides errors behind the UI; everything the app does here is
  already plain TypeScript.
- **Recomputing without re-solving sketches:** a parameter that drives a
  dimension would export the old shape with no error.

## Deferred

- Publishing to npm (a bundled package with the WASM and fonts) and a single-file
  binary: Phase 6.
- Running scripts (P5-02) and OpenSCAD imports (P5-04) from the CLI: they come
  with their tasks.

## Results

**What was shared, and what was not.** The slice's own rule: the re-solve
moves into `@extrudo/sketch` if the app's version can come out cleanly, and the
same for the export. Both could:

- **`settleSketches`** (`packages/sketch/src/inference/settle.ts`) is the app's
  host `settle`, verbatim, plus `dimensionValues` and `collapses` (out of
  `apps/web/src/sketch/values.ts` and `host.ts`; `values.ts` is gone and `host.ts`
  re-throws `SketchSettleError` as the `CommandError` its callers expect) and a
  `scope` (below), so both sides run the same code with the rule each needs.
  `settle.test.ts` tests it on its own, the app's 1 326 tests and the kernel's
  unchanged.
- **The export** moved to `packages/kernel/src/model-export.ts` (`RESOLUTIONS`,
  `DEFLECTION_RANGE`, `ANGLE_RANGE`, `ModelExporter`, `ExportBody`, `MeshedBodies`,
  `meshBodies`, `openBodies`, `safeFileName`, `modelFileName`, `meshBytes`,
  `formatBytes`, `stlBytes`). The app's `modelExport.ts` re-exports all of it and
  keeps only the browser's part (`initialBodies`, the `Blob`s, the slicer
  hand-off), so an export written here holds what the Export dialog holds.
  `usedFonts` moved to core's `sketch/text.ts` (the app re-exports it), so both
  read the same list of fonts.
- One thing is **not** shared: `Node runs the workspace's TypeScript as it is` is
  now a rule the packages the CLI loads must keep — a constructor parameter
  property is out (Node strips types, it does not compile them). Twelve of them
  became fields: the error classes of `kernel.ts`, `LostReferenceError`,
  `MissingFileError`, `SketchChange`, `ArchiveError`, `ProjectNotFoundError`.

**The shared function has both scopes; the app keeps its own rule.** The move
into `@extrudo/sketch` first took the CLI's stronger rule for the app's: every
sketch solved, what moved stored. That is wrong for the app, which calls
`settleSketches` on **every** parameter write, dimension edit and step of a
customizer slider drag (ADR-0016, ADR-0059): a design with many sketches, or
with one slow sketch (a 52-curve gear loop solves in about 120 ms), would solve
all of them per step, and an unrelated parameter change would quietly store
geometry moves in its undo step. So `settleSketches` takes `scope`:

- **`'changed'`** (the default) skips a sketch whose driving dimension values
  are the same as before — `continue`, before any solve: exactly the old host
  rule, so the app (and the CLI's app-shaped callers) cost a solve only in the
  sketches a change moves, and no unrelated move reaches an undo step.
- **`'all'`** is what `setParameters` and `applyConfiguration` pass: every
  sketch is solved and what moved is stored, so a sketch something else pulled
  out of shape (a projection sync, a script, another sketch's geometry) is
  repaired instead of exported stale — which is the point of §Rejected's second
  entry.

The refusal rules are the same in both: a sketch whose own values *changed* is
refused when a solve that failed worked before, a curve collapses, a dimension
would over-constrain or a value the solve doesn't reach. A sketch whose values
didn't change is never refused over what its solve says (that was true before
this change either way), and a movement under 1 nm is not stored, so a solve
that re-solves to the same numbers adds nothing to the undo step.
`settle.test.ts` covers both scopes on the same document (a corner moved 5 mm
by hand): `'changed'` reaches the solver zero times and returns nothing for it,
`'all'` returns the repair.

**`setParameters` and `applyConfiguration` are `async`.** They load planegcs (a
few MB of WASM) the first time they are called, and nothing else is async about
them; `compute`, `export` and `save` were already promises.

**Body names are derived, not stored.** The app amends a `nameBodies` command
into the undo step that made each body (ADR-0030), which needs a model store to
watch. The CLI asks `newBodyNames` for the names a live body without metadata
would get, exactly as `bodyEntries` does before storing them, and `save` writes
what the document already held. A design that had body names keeps them.

**`--out` with an STL of several bodies.** The ADR says "one file per body
unless `--out` names a single file and one body is chosen"; what it does not say
is what `--out` means with several bodies chosen, and this does the obvious
thing: the bodies go into the one file it names (`ExportOptions.singleFile`).

**`info` lists every parameter, not only the ones a person added.** A driving
dimension's own parameter (`d1`, or the name it was given) is what `--param`
takes to move a sketch, and a feature input's is what it refuses with a message
naming the feature and the input, so `info` prints all three kinds in three
groups with their owner — which is what the app's Parameters dialog shows.

**Times** (`export --format 3mf` to a file, process start to exit, on the
development machine — an Arch workstation, OCCT and planegcs built for it, `nice
-n 19`; `cli.test.ts` prints this table on every run):

| Design | Time |
|---|---|
| B1 plate | 0.8 s |
| B2 storage box | 0.9 s |
| B3 phone stand | 1.0 s |
| B4 box with a lid | 1.1 s |
| B5 PCB enclosure | 1.4 s |
| B6 wall hook | 1.2 s |
| B7 knurled knob | 2.3 s |
| B8 name tag | 1.6 s |
| B9 bottle cap | 9.6 s |
| B10 chain link | 1.2 s |

The same table on the Ubuntu machine (4 cores, OCCT and planegcs from CI, `nice
-n 19`) came out a little faster for every design but B8 — 0.6, 0.7, 0.9, 1.0,
1.3, 1.0, 2.0, 1.9, 9.4, 1.1 s — so the numbers below are the machine's, not the
design's.

§4's "each under 10 s" holds, but only after a change this slice made: the first
version measured every body's volume before an export, and B9 took 22.6 s — the
exact mass properties of two bodies with modelled threads (ADR-0067 §H3) cost
12.9 s, more than the 10.6 s recompute that produces them, and a file of
triangles has no use for them. An export now recomputes and meshes, and measures
nothing; `info` still measures (it prints the volumes) and `check` does not (it
is about the features, and it is what CI runs). `Dispose` frees the kernel and
reports `liveShapes: 0` for every fixture.

**What the fixtures showed.** The numbers the benchmark e2e specs read come out
of the fixtures unchanged: B4 with `clearance=0.4mm, length=70mm, lid=4mm` gives
the box 70 × 40 × 30 mm and the lid 70 × 40 × 9 mm, with the lid's volume within
5 % of the spec's `lidBlockVolume − fillet`, and B4 with `wall=5mm` makes the
cavity 70 × 50 × 36 mm. Two things are worth knowing about the designs
themselves, not about the CLI:

- **B2's cavity follows `wall`, `height` and `bottom`, not `width` and `depth`.**
  The benchmark drew Sketch2 (the inner profile) with the Offset tool on a
  rectangle of its own, and nothing connects that rectangle to Sketch1's
  dimensions; the app's Parameters dialog shows the same for the Storage box
  template. A configuration that widens the box widens the block and leaves the
  cavity where it was, and `headless.test.ts` asserts exactly that rather than
  what a reader might assume.
- **The P4-01 sweep/loft/coil fixture's coiled body meshes with non-manifold
  edges** (176 at the medium deflection, 376 at the fine one, no boundary edges)
  where the groove boolean meets the helix's facets. That is that model's
  tessellation, not the export path (every other fixture is closed, checked with
  `@extrudo/io`'s `checkManifold` on the bytes read back), and it is not one of
  the B1–B10 benchmark designs, so its test asks for a clean compute and a file
  that reads back rather than for a closed mesh.

**Tests.** `headless.test.ts` (21 cases, real OCCT and planegcs): every
benchmark fixture opens, computes with no errors and exports a closed 3MF whose
objects are the bodies; B4 with `clearance`; B2's `wall` re-solving its offset
sketch (the change reports `['Sketch2']` and the points move); a configuration of
the Storage box template applied through the API; a design with a user font as an
attachment, a STEP import and a mesh import (manifold loaded for the last); the
errors an unknown parameter, a bad expression, a missing file and a change a
sketch cannot take give; and `dispose` leaving nothing held.
`cli.test.ts` (18 cases) spawns the binary: `info --json` on B4,
`export --format stl --param clearance=0.4mm` writing two STLs that `readStl`
reads and `checkManifold` passes, an STL and a STEP, `set --out` opening with
the change in it while the design it came from is untouched, `check` at 0 on B1
and 2 with its message on a design built through the API with a fillet that has
no edges, every usage mistake at 1, every file problem at 3, and the export times
above. `packages/sketch/src/inference/settle.test.ts` (5 cases) covers the
shared rule on its own, both scopes.
