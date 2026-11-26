# ADR-0024: Recompute engine

- **Status:** Accepted, 2026-09-27
- **Task:** P2-01 (recompute engine). Code: `packages/kernel/src/recompute/`
  (`engine.ts` `RecomputeEngine`, `hash.ts`, `types.ts`
  `KernelFeatureDefinition`/`EvalContext`/`FeatureOutput`, `testing.ts`
  test features), `packages/kernel/src/features/` (the kernel's feature
  registry; the sketch evaluator), `service.ts`/`worker.ts`/`browser.ts`
  (`recompute`, `preview`, `endPreview` on the RPC surface),
  `recomputer.ts` (`Recomputer`, the UI-thread side), core's model store
  (`stats`), and in the app `project/ProjectPage.tsx` (`useRecompute`) and
  `shell/Timeline.tsx` (status glyphs, kernel state).
- **Builds on:** ADR-0001 (kernel, facade handles, disposal), ADR-0003
  (document as JSON, the model store), ADR-0004 (parameter evaluation).
- **Affects:** every feature evaluator from P2-02 on, P2-04 (topological
  naming hooks into evaluation), P2-05 (dialog previews), P2-11 (error chips
  and "fix references").

## Context

The document is JSON and geometry is derived (ADR-0003). Something has to
turn the timeline into bodies, in the kernel worker, fast enough to follow
edits: architecture §5.1 asks for incremental evaluation from the first
dirty feature, a shape cache keyed by an input hash, cancellation between
features, debounced previews and crash recovery. The P2-01 acceptance
criterion: a 30-feature fixture edited at feature 25 re-evaluates only
25–30, asserted with counters.

Before P2-01 the model store existed but nothing filled it, the status bar
said "kernel idle", and the kernel only ran on the debug page.

## Decision

1. **Features are keyed by content, not by position.** A feature's cache
   key hashes its type, ID, inputs, the evaluated values of its `expr`
   inputs, the keys of the features it refers to, and the key of the body
   set before it. There is no "first dirty index": the engine walks the
   whole active timeline each time and a hit costs one hash. Undo, redo and
   scrubbing a parameter back to an old value hit the cache for free, which
   an index-based scheme can't do.
2. **Evaluators declare their body access.** `bodyAccess(inputs)` is
   `none` (a sketch on an origin plane), `read` (a sketch on a face) or
   `write` (the default: extrude, fillet). Only `read` and `write` put the
   body-set key into their own key, and only `write` changes the body set.
   So editing an early extrude doesn't re-evaluate a later sketch on an
   origin plane; it does re-evaluate the extrude that uses that sketch's
   profile.
3. **Dependencies between features come from `ref` inputs.** A reference
   whose ID starts with a feature ID and a slash (`<sketch>/<region>`, the
   profile IDs of ADR-0020) makes the feature depend on that one:
   `ctx.output(id)` hands over its output, its key goes into the key, and a
   suppressed, failed, later or missing target fails the feature with a
   plain message ("Needs Sketch1, which has an error."). Faces and edges
   come from the body set (P2-04 resolves them).
4. **Outputs:** `bodies` (the whole body set after a `write` feature, as
   handles; bodies passed on unchanged keep their handle), `shapes` (named
   handles later features use, such as a sketch's profile faces in P2-02),
   `data` (plain JSON-like values) and `warnings`. Body IDs are
   `<featureId>:<n>` (`ctx.bodyId(n)`), stable across recomputes.
5. **The cache owns shapes by reference count.** An entry holds a
   reference to every handle in its output; a body shared by the entries
   of every feature it passes through goes back to the kernel when the
   last one is evicted. Eviction is least-recently-used beyond `maxEntries`
   (256), and never touches the entries the latest recompute or preview
   uses, or those a walk still running holds. Failures are cached too.
6. **Leaks are caught where they happen.** The engine compares the
   facade's live shape count before and after each evaluation with the
   number of new handles in the output; a difference is reported
   (`onLeak`; a thrown error with `strictLeaks`, which the tests use).
   Evaluators use `kernel.scope()` and `ShapeScope.keep()` for results.
7. **Cancellation by generation, at yields.** Each request bumps its
   channel's generation (recompute, preview). Before evaluating a feature
   that missed the cache, the walk yields to the event loop through a
   `MessageChannel` (not `setTimeout`, which nests to 4 ms); a newer request
   that arrived meanwhile has bumped the generation, and the older walk
   returns `cancelled`. What it computed stays in the cache. After the
   yield the walk looks in the cache again, because another walk (a
   preview) may have computed the same key meanwhile; without that, both
   evaluated it and one result leaked (found by a test).
8. **Previews are walks of a trial timeline**: the features before
   `index`, then the draft. They have their own generation, so a preview
   doesn't cancel a recompute; `endPreview` unpins their entries. OK with
   unchanged inputs then hits the cache.
9. **Meshes only for what the caller lacks.** Each body result carries a
   `version` (a hash of the key of the entry that made the shape and the
   body ID: the same after a kernel restart). The request's `have` lists
   the versions the caller holds; their meshes are left out, the rest are
   transferred. The `Recomputer` keeps the meshes and asks for everything
   again if the kernel ever omits one it doesn't have.
10. **Status.** Every active, unsuppressed feature gets `ok`, `warning` or
    `error` with a message. Errors come from `KernelError`s thrown by
    evaluators, invalid inputs (the definition's schema), expression errors
    ("Height: …"), unknown types ("This version of Extrudo can't compute
    Extrude features."), dependencies, and crashes. A failed feature
    passes the body set on unchanged, so the rest of the timeline still
    computes. Other exceptions become "Internal error: …" and are logged.
11. **The `Recomputer` (UI thread) owns one `KernelClient` per open
    project.** It follows document changes (not other store changes),
    gathers them for 30 ms, and sends the latest document; one sent while
    another runs cancels it in the worker, and stale results are dropped by
    a sequence number. A progress callback (`onFeature`, a Comlink proxy)
    names the feature being evaluated; when the kernel crashes, that
    feature is remembered as the culprit and sent as `crashed` after the
    restart, so it is shown as an error instead of crashing the kernel
    again, until the feature object changes. Model records that come back
    equal keep their identity, so the shell doesn't re-render per edit.
    `preview(draft, index)` waits 60 ms for the draft to settle and
    resolves `undefined` when superseded.
12. **Display.** Timeline chips of active features show ✕ or ⚠ on their
    corner with the status colour on the border, add "error"/"warning" to
    their accessible name and put the message in the tooltip. The status
    bar counts errors and shows the kernel state ("computing…", "computed
    in 3.2 ms", "kernel stopped"; `data-model-status` for tests). The
    template's placeholder extrudes and fillet now show as errors, which is
    what they are until their evaluators exist.

## Consequences

- An evaluator is one `KernelFeatureDefinition` registered in
  `kernelFeatures()`; it gets typed inputs, expression values, the bodies
  and its references' outputs, and doesn't deal with caching,
  cancellation or reference counting.
- Every open project runs a kernel worker. In e2e that means every test
  compiles the OCCT WASM; the full suite is slower under parallel load, and
  B1 (about 15 s alone, near 30 s in the full run already before P2-01)
  got a 60 s timeout.
- The key includes an `expr` input's `paramName`, so renaming a model
  parameter re-evaluates its feature once. Harmless and rare.
- The hash is 128-bit cyrb128 over canonical (key-sorted) JSON: fast and
  collision-free in practice, not cryptographic.

## Rejected

- **Recompute from a dirty index** (the first changed feature onward):
  simple, but undo and scrubbing re-evaluate everything after the edit,
  and an edit to a sketch nothing uses still recomputes the rest.
- **Chained keys** (each key includes the previous feature's key): a
  sketch on an origin plane would re-evaluate whenever an earlier body
  changed.
- **Cancelling through `SharedArrayBuffer`** (an abort flag the evaluator
  polls): needs COOP/COEP headers, which we avoid until profiling asks for
  threads (architecture §7); a single OCCT call can't be interrupted
  anyway.
- **A mesh cache in the worker**: meshes are transferred, which detaches
  their buffers in the worker; the caller keeps them instead and says what
  it has.
- **Showing the template's unimplemented features as warnings** or hiding
  their status: they produce nothing, and a newer file opened in an older
  app would look the same; an error with a plain message is honest.

## Open

- Memory cap by bytes rather than entry count (the facade can't report a
  shape's size yet).
- Tessellation tied to model size (P2-03); a fixed 0.05 mm / 0.3 rad now.
- A single long OCCT operation can't be cancelled; only the steps between
  features can.
- ~~The browser panel doesn't show feature status yet; P2-11 adds error
  chips' actions and "fix references".~~ Fix references came with P2-11,
  browser status with P3-17 (ADR-0033 amendment).

## Amendment 2026-11-10: crashes that name a new feature

The crashed features live in the `Recomputer` only, and `KernelClient` gives
up after three restarts in a minute. So four features that trap the kernel
left it failed, and a design with them failed the same way on every open
(the security review of 2026-10-15, finding B5; a test on the base with five
such features: three restarts, then "failed", four kernels).

- `KernelClientOptions.counts(error)` says whether a crash counts against
  `maxRestarts`. The `Recomputer` answers no for a crash in a feature of the
  document it sent that isn't yet known to crash, while fewer than
  `MAX_CRASHED_FEATURES` = 8 are: it is one feature fewer to try, and it is
  skipped from then on. Any other crash counts as before (one in a feature
  already skipped, outside a feature, or in a feature the document doesn't
  have, such as a script's generated one, which no list skips).
- A design with up to eight such features now opens with those features
  shown as errors and the rest built; past eight, three more crashes in a
  minute stop the kernel as before (twelve kernels at most).
- Nothing is stored: the list is still per open document, so each open finds
  the crashes again (one kernel start each). Rejected for now: keeping the
  list in the document (a file-format change), and importing the features
  that trapped the import's own check suppressed (the check's kernel would
  have to report them; a proposal in the hardening report).

## Amendment 2026-11-24: unchanged bodies keep their mesh objects

A body's `version` changes with the key of the entry that made it (item 9), and a key takes in
the body set before the feature (every body-writing feature before it). So an edit of an early
feature changes the version of every later body, even when the later features make the same
shapes again: in a design of plates side by side (each a sketch and an extrude), an edit of the
first plate's extrude evaluates every later extrude again and sends every body's mesh (measured
in Node: 30 plates, 30 meshes, 6.6 MB, 1.41 s in the kernel; 100 plates, 100 meshes, 21.9 MB,
4.65 s; the last plate's edit: one mesh, 58 and 80 ms). The `Recomputer` held none of those
versions, so the model store got a new mesh object for every body, and the view rebuilt every
body (edges, face colours, bounds, uploads) and the page its per-mesh caches.

**Decision.** When the kernel sends a mesh for the model, the `Recomputer` compares it with the
mesh it holds for that body ID (`sameMesh`, `mesh.ts`) and, when they are the same in every field,
hands out the held object (under the new version). `sameMesh` compares typed arrays bit for bit
(`-0` and `0`, or two NaNs with other bits, differ; the array kind must match), the face, edge and
vertex names element by element, and the rest by `Object.is`; a field one mesh has and the other
hasn't, or an object of a kind it doesn't know, makes them different. A body that changed in any
way — its shape, its tessellation, a face's name, its face order — gets the new object.

**Not changed.** The kernel still evaluates and meshes the later features, and the worker still
transfers their meshes (no protocol change: the web worker, the desktop app, the agent's host
and the app-render job see the same messages). Previews don't compare: a preview's bodies that the draft
leaves alone already come back as the model's objects (by version, `#held`), and while an
existing feature is edited the view shows only the bodies before it (`dialogBodies`), so the
later bodies mount again when the dialog closes, whatever their mesh objects; only what the page
keeps by mesh outside the view (bounds, the pick index) is kept then.

**Rejected.** Taking a new-body feature's key out of the body-set chain (it would also save the
kernel's time) changes how the engine caches whole body maps: large. Hashing meshes in the worker
(saves the transfer and the page's comparison) is a hash, not an equality, and changes the worker
protocol.

**Measured** (30 and 100 plates with 30 holes each, production build, Chrome with a GPU,
1280 × 800, quiet machine; main → this). Blocked time (tasks of 50 ms or more from the action
until 1.5 s after it), median of 4 runs (lowest–highest): undo on 100 plates 64 (63–65) → 0 ms;
commit of an edit in a feature dialog on 100 plates 189 (186–192) → 122 (120–125) ms. On 30
plates both were at or under the 50 ms line already (undo 0 → 0, commit 50 → 51). Clicks, box
selects, opening a sketch, drags and opening the design stay within their runs' spread.
`Body` renders: undo 100 → 1 (100 plates), 30 → 1 (30 plates); commit 200 → 101 and 60 → 31 (the
later bodies mount again after the dialog). In a CPU profile (unminified, one run) of the
100-plate commit, `edgeSegments` and `paintFaces` take 68 → 32 ms; the comparison (`sameBytes`)
takes 8 ms.

**Rules.**

- The model's meshes from the kernel go through `#kept`: a held mesh is handed out again only
  when `sameMesh` says it is the same in every field.
- `sameMesh` compares every field of `BodyMesh`; a new field is compared by it (typed array,
  string array, or a value) or makes meshes different. Never compare positions alone.
- Nothing writes into a mesh's arrays (ADR-0102 §9): a kept mesh is the same data for good.
- Tested: `mesh-same.test.ts` (copies and offset views the same; `-0`, NaN bits, every field
  changed or gone, another array kind, an unknown field: different);
  `recomputer-keep.test.ts` against OCCT: an edit of the first of six plates makes the kernel
  send six meshes and only the first a new object; a seeded run of up to 40 edits, each of ten kinds at least once
  (a distance, suppress, a reorder, the marker, a rename, a body's colour and visibility, a hole
  through a body, a combine that removes a body, undo, redo) where after each a body keeps its
  object exactly when its mesh is the same as before, and every mesh equals a full rebuild's; a
  dialog's commit keeps the later plates' objects; and against a stand-in kernel that sends every
  body again under a new version, 60 steps of one-field changes (a bit of each array, `-0`, a
  face, edge or vertex name, names gone, the mesh flag) where exactly the changed bodies get new
  objects. Taken out, the reuse fails all four; comparing numbers by value fails the `-0` cases;
  leaving the names out of the comparison fails the stand-in run; keeping every held mesh fails
  all four.

## Amendment 2026-11-24: `add` access, for features that only add bodies

A feature's key takes in the body set before it (`bodiesKey`) unless it reads no body (`none`),
so every body feature is chained to every earlier one: an edit of the first of 100 separate plates
(each a sketch and a New Body extrude) evaluated all 100 extrudes again and sent all 100 meshes,
4,568 ms in the kernel (measured in Node, the table below), against 84 ms for the last plate. Yet a New Body extrude of
a sketch's profiles by distances reads no body before it.

**Decision.** `BodyAccess` gains `add`: the feature only adds bodies and reads none before it.

- The engine (`#run`, `engine.ts`) hands an `add` evaluator no bodies (`NoBodies`, an empty map),
  keys it with `'add'` in place of `bodiesKey`, appends its bodies after the ones before it
  (`mergeBodies(bodies, ∅, output)`) and moves the chain on: `bodiesKey = hash('add', bodiesKey,
  key)`, so every later feature that reads bodies still keys the whole set. The output an `add`
  entry holds is its own new bodies only; nothing reads an output's `bodies` but the engine itself
  (features read upstream outputs' `data`, `shapes` and `previewTools`; joints, annotations and
  sheets read the walk's body map).
- It is treated as `write` inside an isolated expansion (an inserted design, whose merge moves the
  expansion's bodies) and when a body with the feature's own ID prefix (`<feature>:`) exists
  already (its new IDs would replace that body in place under `write`, and be appended under
  `add`). A document reaches that check when one feature's ID is another's followed by `:` (a
  feature `ex0:a`, whose body is `ex0:a:0`, before `ex0`; feature IDs are any string,
  `FeatureIdSchema`), and the test below has that case. A real clash, a body named
  `<feature>:<n>` before the feature, I found no way to make: every evaluator names new bodies
  through `ctx.bodyId` (`<feature>:<n>`, `engine.ts`), and feature IDs are unique.
- **Fail closed.** A look-up in the empty map (`get`, `has`, `size`), or the context's `names` or
  `resolve`, marks the evaluation as having read a body and fails it; the engine drops that
  result, remembers the key (`#readsBodies`) and evaluates the feature as `write`, now and whenever
  the same inputs come again. If another walk (a preview beside a recompute) has made that `write`
  result meanwhile, it is a cache hit like any other: counted as reused and moved to the recently
  used end. `clear()` forgets the keys with the cache, and the set holds at most `maxEntries`
  keys (256 by default), the least recently used going first: a key it forgets costs one more
  `add` evaluation that falls back again, never a different result. With a right predicate the set
  stays empty. A read by iterating over the map (copying it, or collecting its
  handles) gives nothing and is not noticed: the extrude's own copies (`newBodies`,
  `splitSolids`) iterate, so the predicate and the differential test below are the guard for a
  read by iteration ("through all" over every body, the touching bodies of a join).
- **The extrude answers `add`** (`addsOnly`, `features/extrude.ts`) when its operation is New Body,
  no bodies are picked, every side's extent is a distance, and every profile is a sketch's
  profile or text. Everything else is `write` as before: join, cut and intersect, picked bodies,
  "through all", "to object", face profiles.

**What the extrude reads under that predicate** (audited on this branch; file:line):

- `extrudeSettings(ctx.inputs)` (`features/extrude.ts:242`) and the expression values
  (`distanceOf` :567, `taperOf` :577, the symmetric half :292): inputs and values, in the key.
- `baseOf` (:247 → `sources.ts` `partsOf` :67): `profilePart` (:86) and `textParts` (:113) read the
  sketch's output (`ctx.output`: its key is upstream); `facePart` (:152, resolves among the bodies)
  is never reached.
- `centroidOf` (:249 → `sources.ts:201`): `describe` of the profile's own face.
- `explicitBodies` (:250 → `operation.ts:91`): returns at once for no picked bodies.
- `resolveSides` (:251): with distances only, values; `throughAll`, `objectPlane` and
  `objectSide` (the readers of bodies) are never reached.
- `sweep` (:252) and the trim of a side (:255, `to-object` only): the profile's face and values.
- `operate` → `newBodies` (`operation.ts:333`): `new Map(ctx.bodies)` (iterates the empty map),
  `kernel.solids` and `measure` of the tool's own solids (:347), IDs from `ctx.bodyId` (:341,
  :356).
- `splitSolids` (`bodies.ts:38`): `new Set(ctx.bodies.values())` (iterates), fresh IDs from
  `ctx.bodyId` (:47) checked against the output's own IDs.
- The engine around it: `#references` (its `names` and `resolve` replaced, see fail closed),
  `#checkNames` (iterates the bodies before), `#checkSound` and the leak count (the output's fresh
  handles only, the same set as under `write`).
- No global state: no `measure` of a body before it, no names of other bodies, no files or fonts
  but through the sketch's output.

**Never answer `add` for** a feature that joins, cuts, intersects, patterns, splits, moves,
scales or removes bodies; finds bodies it touches or goes through; resolves a face, edge, vertex or
body reference among the bodies; is placed on a body's face; names its bodies from earlier ones;
or makes body IDs outside its own `<feature>:` prefix (the own-prefix check above looks only
there). Mesh bodies are no exception today: `mesh:<feature>` is the name of a mesh body's face
(`meshFaceName`, `features/mesh-bodies.ts`), and the body's ID comes from `ctx.bodyId`.
A sketch on a face is fine as an upstream feature: its key holds the bodies and reaches the
extrude through `upstream`.

**What changes.** Body IDs, names, order, results, errors and files are the same (the proof
below), given that no box a feature reads depends on whether a body was meshed (ADR-0035's
amendment of 2026-11-24). An `add` keeps later bodies cached, and so meshed for the view, where
they used to be evaluated again; a "through all" after them measures them. The proof's case
`through all over cached bodies` is that: with boxes from triangulations (the OCCT build before
that amendment, `occt-8bd8ae5125b7`) it fails, T's mesh differs from a cleared engine's; with
the current build it passes. Versions get a new meaning in memory only: an `add` body's version no longer changes when
an unrelated earlier feature changes, so the kernel doesn't evaluate it again or send its mesh.
Everything that reads versions compares one body's version with what it drew from it (the
`Recomputer`'s held meshes, a sheet view's staleness in `viewRunner.ts`/`viewLines.ts`, the
engine's sheet-view cache): a version still names one shape, so none of them assumed that an
earlier edit changes every later version.

**Measured.** Kernel time and meshes sent for an edit (a distance set to 6 mm) of the first, a
middle and the last plate, incremental with `have`, one run each in Node, on this branch with
the extrude always `write` (main's behaviour) → as it is:

| Design | Edit | Evaluated | Meshes sent | ms |
|---|---|--:|--:|--:|
| 30 plates | first | 30 → 1 | 30 → 1 | 1,400 → 59 |
| | middle | 16 → 1 | 16 → 1 | 753 → 62 |
| | last | 1 → 1 | 1 → 1 | 67 → 64 |
| 100 plates | first | 100 → 1 | 100 → 1 | 4,568 → 85 |
| | middle | 51 → 1 | 51 → 1 | 2,407 → 83 |
| | last | 1 → 1 | 1 → 1 | 84 → 78 |
| 20 overlapping plates and a slot cut | first | 21 → 2 | 25 → 10 | 380 → 228 |
| | middle | 12 → 2 | 21 → 11 | 331 → 229 |
| | last | 2 → 2 | 11 → 11 | 231 → 229 |
| 20 plates, each with a fillet | first | 40 → 21 | 20 → 20 | 3,692 → 2,969 |
| | middle | 22 → 12 | 11 → 11 | 2,102 → 1,658 |
| | last | 2 → 2 | 1 → 1 | 204 → 199 |

The cut reads every plate, so it runs again and sends the pieces it makes; a fillet keys the body
set, so every later fillet and its body still run (`view` access, later, is for those). In the
app (30 and 100 plates with 30 holes each, production build, Chrome with a GPU, 1280 × 800, quiet
machine, median of 4 runs, main → this), committing an edit of the first plate's extrude in its
dialog takes 1,408 → 184 ms (30 plates) and 4,414 → 266 ms (100 plates) until the model is ready,
and undoing it 320 → 320 ms and 1,775 → 330 ms. The page's blocked time (tasks of 50 ms or more)
stays within its runs' spread for six of the seven measured actions; opening the 30-plate design
gave 432–604 ms (main) and 436–659 ms (this), two clusters in both (about 440 ms, and 600–660 ms)
with the medians in different ones. Components rendered on the commit 7,080 → 3,886 and 21,261 →
10,129, on the 100-plate undo 5,975 → 641.

**The proof** (`recompute/add-access.test.ts`, real OCCT, `strictLeaks`, no clock): eight designs
(plates with a parameter; overlapping plates and a cut through them; the b2, b3 and b4
benchmarks; the hinge with its components; plates with an inserted design, an isolated expansion
with New Body extrudes; plates with a failed and a stopped feature), each with plates after it
until it holds five extrudes that answer `add`, and 40 seeded edits each. After every step the
engine that kept its cache, holding the meshes it was sent like the `Recomputer`, gives what a
cleared engine gives for the same document: statuses and errors, origins, reports, body IDs and
order, every mesh array bit for bit and every name, and every body's measured box; and so does an
all-`write` engine (see "Two references" below); a mesh left out under `have` must be one it
holds. Each design starts with no errors but the ones it is built with.

The edits, each kind at least once in every design: an insert; one edit per term of the
predicate, made to an extrude that answers `add`, which must leave it `write` ("through all",
"to object" up to an earlier extrude's end cap or body, a face profile (that cap), a picked body,
two sides with side 2 "through all") or `add` (symmetric, a taper, a text profile); one that takes
an extrude back to `add` (one side, a distance, a new body, nothing picked); an extrude's
operation; another region of its sketch; a length scaled; suppress or unsuppress; the marker; a
reorder; a delete; undo to an earlier state; a parameter. The edited extrude must compute (not
only fail the same way in both engines): after "through all", two sides, symmetric, a taper, a
picked body and the way back in every design, and after each of the others in at least one (text
not in b2, "to object" not in b3 nor the design with failures, a face profile not in the design
with failures). The bodies are flat and curved (holes, the benchmarks' fillets and rounds).
**Not covered by these edits:** sketch geometry, constraints and dimensions (only the choice of
region); the features inside an inserted design; features other than extrudes but by a length
scaled, suppress, reorder and delete; "to object" up to a vertex or a plane; joints,
annotations, sheets and previews (a preview only in the reused count below); mesh bodies,
imports, scripts and OpenSCAD features; the stopped list (fixed per design).

**What a cached body carries, and what the tests show.** A cached body carries the
triangulation the view's meshing left on its faces, where a body evaluated again has none.
- OCCT's booleans and its distance check (behind `bodiesTouch`) give the same result over
  operands meshed coarse (0.5 mm), fine (0.005 mm) or not at all: the same description
  (sub-shape counts, order, types, sizes), history, volume, and display mesh of a copy of the
  result, bit for bit, for fuse, cut and common of a torus, a body with a B-spline face and a
  filleted box with a hole, and the same distance (`meshed-operands.test.ts`; a result whose
  operand moved by a nanometre compares as different).
- A cut keeps a body's untouched faces with their triangulation. The result's mesh equals a
  cleared engine's when that triangulation is the view's own (the view meshes every body at one
  tessellation): a hole through a spline body clear of its B-spline side, and a hole in a plate
  joined to a torus away from the torus (`add-access.test.ts`, cases by name). A finer
  triangulation left on the cached body reaches the result's mesh (a control in the same file),
  so the rule is: nothing but the view's meshing at the view's tessellation leaves a
  triangulation on a cached body.
- **Settled (ADR-0035's amendment "a kernel call never changes the shapes it is given"):** after
  a cut or an intersect over a cached torus or loft, an edit that made that feature a join gave a
  result whose `measure` box was about 1e-12 mm larger than from scratch. The cause was the
  boolean raising a vertex tolerance of its tool in place, and the tool's bottom cap is its
  sketch's cached profile face; booleans now work on copies. The differential set has the curved
  design (a torus, a spline extrude and a smooth loft, with a plate joined to the torus, holes
  and a plate over the others), clean over its 40 seeded edits; it differs with the build before
  that amendment.

Cases by name: through all over cached bodies (P1–P3 lying cylinders, `add`; T a New Body disc
"through all" both ways, `write`; P1's distance edited: exactly P1 and T evaluated, the same as a
cleared engine; see What changes); a New Body extrude of two separate profiles (`M:0`, `M:1`),
an earlier plate edited (only that plate evaluated), its distance edited, one profile dropped
(`M:1` gone), back; a feature `ex0:a` before `ex0` (the own-prefix check: `ex0` runs as `write`,
so an edit of `ex0:a` evaluates both, and the result is a cleared engine's); the predicate term by
term (`addsOnly` for 14 inputs).

Negative controls in the same file, each making the comparison fail: (1) an engine whose chain
isn't moved on after an `add` (made from `engine.ts`'s own source with that line taken out, in a
temporary file, so the engine has no switch for it): no difference at step 0, where nothing is
cached, and differences after; (2) the extrude answering `add` for a join: a join finds the
bodies it touches by iterating, which the fall-back doesn't notice, so it gets other content at
step 0 already; (3) an engine that hands `add` features the bodies but still keys them without
(`NoBodies` replaced the same way), with the extrude answering `add` for "through all": T is
right at step 0 and stale after P1 grows (its `add` key finds the old entry; T's mesh differs).
Only (1) and (3) need the cache to be wrong.

Counters: an edit of the first of six separate plates evaluates one feature and sends one mesh;
on four overlapping plates and a cut through them, making the second plate a join, "through
all", "to object", a face profile or two sides with side 2 "through all", or picking a body for
the third, evaluates exactly that extrude and the cut (the later plates answer `add`), and the
edited extrude computes; an `add` evaluator that looks a body up runs again as `write` with the
same result (`sk0, ex0, sk1, ex1, ex1`), straight away as `write` the next time (nothing
evaluated), and after `clear()` as `add` again; with `maxEntries` 1 a key forgotten for a newer
one is tried as `add` again; a recompute and a preview side by side, the preview's fall-back
finds the recompute's `write` result: evaluated `ex1` once, reused 4.

Each was checked to fail with its change taken out (the line removed or replaced, the test run,
the file restored): `clear()` keeping the keys, no bound, the fall-back's hit not counted, no
own-prefix check, the extrude always `write` (the six-plate counter, the overlapping-plates
counter, the two-profile case and the "through all" case), and the predicate without its picked
bodies, extent, face or text term (the predicate's own test and the proof's plates design, which
checks each term's access after its edit). Control (3) without its fault (the right engine with
that predicate) differs at step 0 already, as (2) does: T sees no bodies.
`recomputer-keep.test.ts`'s six-mesh case now edits grooved plates (a cut reads every plate), and
a new case shows one mesh for separate plates.

**More features answer `add` (2026-11-25).** The primitives, the revolve, the coil, the sweep, the
loft and the import answer `add` too, each for the inputs its predicate allows; everything else is
`write` as before. The predicates use the parsed inputs' settings (`primitiveSettings`,
`revolveSettings`, …), as `addsOnly` does.

- **Box, cylinder, sphere, torus** (`primitiveAddsOnly`, `features/primitives.ts`; there is no
  other primitive type, `KERNEL_PRIMITIVES`) and **the coil** (`coilAddsOnly`, `features/coil.ts`),
  both through `placedAddsOnly`: New Body, no picked bodies, placed on a plane (the default XY, an
  origin plane or a construction plane). `write` for a face placement, join, cut and intersect,
  and picked bodies.
- **The revolve** (`revolveAddsOnly`, `features/revolve.ts`): New Body, no picked bodies, extent
  `angle`, the axis an origin or construction axis or a sketch line (`axis` or `sketchEntity`),
  every profile a sketch's profile or text. `write` for a face profile, an edge axis, no axis,
  "to object" whatever the object (a plane too: see below), join, cut, intersect, picked bodies.
- **The sweep** (`sweepAddsOnly`, `features/sweep.ts`): New Body, no picked bodies, every profile
  a sketch's profile, every piece of the path a sketch curve. `write` for a face profile, an edge
  in the path, join, cut, intersect, picked bodies.
- **The loft** (`loftAddsOnly`, `features/loft.ts`): New Body, no picked bodies, every section a
  sketch's profile, a sketch point, or the origin or a construction point (`profile`, `sketchEntity`,
  `point`). `write` for a face or a vertex section, join, cut, intersect, picked bodies.
- **The import** (`features/import.ts`): `add` for every input. It has no reference input, so no
  picked body, no operation and no upstream feature. It reads the bodies before it only by
  iterating, to skip IDs under its own prefix, which the own-prefix check leaves none of.
  `splitSolids` (`features/bodies.ts`) used to look an ID up (`ctx.bodies.has`) for each fresh
  piece of a body with two or more solids, which every STEP file of several solids reaches (a
  FreeCAD or f3d design's stored shapes are plain STEP or STL imports, with no feature type of
  their own): it now collects the IDs before it by iterating (`earlier`), the same set under
  `write`. Without that change the look-up failed the `add` evaluation of every such file inside
  `splitSolids`, after a piece was kept, so it left shapes behind (see the checks below) and the
  file would be parsed again as `write`.

**What they read under those predicates** (audited on this branch; file:line; `features/` unless
said; the shared helpers as listed for the extrude: `explicitBodies` `operation.ts:91` returns at
once for no picked bodies, `operate` → `newBodies` `operation.ts:333` iterates the empty map and
names bodies with `ctx.bodyId` (:341, :356), `splitSolids` `bodies.ts:38`/:41 iterates, and its
look-up `earlier.has` (:88) is the local set):

- Primitives (`primitives.ts`, one evaluator `primitive()` for all four): `primitiveSettings`
  (:112) and `numbersOf` (:113: `ctx.value` or the core's constant); `placement` (:114) →
  `planeFrame` (:273): `ref.kind === 'face'` resolves among the bodies (:275, not reached),
  `originPlane` (:287, a constant table) or `planeOf` → `constructionOf` → `ctx.output` of the
  construction plane (`references.ts:55`: an upstream key; a construction plane on a body face is
  `read`, `construction.ts:85`); `build` (:116): `planarFace` (:301, own curves), `namedPrism`
  (:447) or `namedRevolve` (:463), which take the kernel only; `explicitBodies` (:117, reached for
  New Body too: picked bodies left from a join are looked up and fail if gone); `operate` (:122);
  `splitSolids` (:119). Body IDs `<feature>:0`.
- Coil (`coil.ts`): `coilSettings` (:113), `numbersOf` (:114), `placement` (:148 → `planeFrame`
  :201, as above), `helixSweep` (:151 → :81 `planarFace`, :83 `kernel.helix`, :94 `sweepTool`):
  own geometry; `explicitBodies` (:161), `operate` (:166), `splitSolids` (:163). IDs
  `<feature>:<n>`.
- Revolve (`revolve.ts`): `revolveSettings` (:220); `partsOf` (:226 → `sources.ts`
  `profilePart` :86 / `textParts` :113, sketch outputs; `facePart` :152 not reached);
  `uniteParts` (:227, own faces); `axisOf` (:228 → :263): `originAxis` (:266, constant),
  `lineOf` → `constructionOf` (:269, upstream), `sketchLineAxis` (:273 → :299 `ctx.output`,
  upstream), the edge branch (:275 `ctx.resolve`) not reached; `oneSide` (:234 → :331, :363):
  the parts' own faces and a half plane; `anglesOf` (:239 → :406, `ctx.value`); `sweep` (:241,
  `namedRevolve` :478); `centroidOf` (:244, own face); `explicitBodies` (:250), `operate` (:255),
  `splitSolids` (:252). `sweepToObject` (:242) is not reached: it **iterates and measures every
  body** (`for (const body of ctx.bodies.values())`, :522) to size its target, for every kind of
  object, before `trimTarget` (`to-object.ts:49`, `ctx.bodies.get` :60, `ctx.resolve` :71) looks
  at it; that iteration isn't noticed, so the extent term is `extent === 'angle'`, not "the object
  is a plane". IDs `<feature>:0…n-1` (several separate profiles make several bodies).
- Sweep (`sweep.ts`): `sweepSettings` (:76), `ctx.value` of twist and scale (:83, :84); `baseOf`
  (:92 → `partsOf`: `profilePart`; `facePart` not reached; the schema allows no text in a sweep);
  `pathOf` (:93 → `pieceOf`: the edge branch :220 not reached, a sketch curve's exact geometry and
  frame from `ctx.output` :230, upstream; `kernel.path` :207 of those pieces); `sweepTool` (:94 →
  `namedSweep` :267, kernel only); `explicitBodies` (:99); `placementReport` (:101 → `kernel.properties`
  :132, :181 of the profile face and the own path); `operate` (:105), `splitSolids` (:102). IDs
  `<feature>:<n>`.
- Loft (`loft.ts`): `loftSettings` (:61); `sectionOf` (:71): a profile → `partsOf` (:107,
  `profilePart`; a face → `facePart`, not reached), a point → `pointOf` (:119 →
  `references.ts:162`: the origin point or `constructionOf`, upstream; a vertex → `ctx.resolve`
  `references.ts:157`, not reached), a sketch point → `sketchPoint` (:120 → :129 `ctx.output`,
  upstream); the coplanarity check (:80, own planes); `loftTool` (:87 → `namedLoft` :156);
  `explicitBodies` (:88), `operate` (:93), `splitSolids` (:90). IDs `<feature>:<n>`.
- Import (`import.ts`): `ctx.fileType` (:142) picks the branch. STEP: `ctx.file` (:155),
  `readStep` (:157) and the XDE reads of colours, names and hidden solids, all of the file;
  `new Map(ctx.bodies)` (:195, iterates), `ctx.bodyId(0)` (:194), `importNames` (:198, own shape),
  `splitSolids` (:200; fresh IDs from `ctx.bodyId`), `importReport` (:338, the output's own naming
  tables). Mesh files and OpenSCAD: `readMeshFile` (:512) or the 3MF `prepare` compiled
  (`ctx.prepared` :684), `meshBodies` (:400, :688): `new Set(ctx.bodies.keys())` (:484) and
  `new Map(ctx.bodies)` (:485) iterate, `used.has` (:490) is the local set. `prepareImport`
  (:580) has no bodies at all (`PrepareContext`). No `names`, `resolve` or measure of an earlier
  body. Body IDs `<feature>:<n>`; `import:<feature>:face:<n>` and `mesh:<feature>` are face names.
- The engine around them: as for the extrude. `#checkSound` with `keepsBrokenBodies` (the import)
  only warns; `#checkNames` iterates the bodies before it only when a table doesn't match.
- No global state but the core's constant tables (origin planes and axes, the primitives' and
  coil's default numbers) and the OpenSCAD compiles a compiler keeps (`compiles`, :642, keyed by
  file name, source digest and definitions). File bytes come through `options.files` and are not
  in the key (their bytes never change under their IDs); the attachment ID is.

**What changes for an import.**
- Its key no longer holds the bodies before it, so an edit before it is a cache hit: `prepare`
  and `evaluate` don't run, the file isn't read, parsed or compiled again, and its bodies keep
  their versions (no mesh is sent).
- The cache entry is still dropped as any other: inside an inserted design, after a body with its
  own ID prefix, and when evicted.
- An error is cached like any other result. One whose cause was outside the document (the file's
  bytes not there yet, say) would then no longer be tried again after an edit before the import,
  as it was on main. The rule below tries those again at least as often as main did.

**Errors from outside the document (2026-11-25).** An error can say its cause is outside the
document, so that the same inputs may do better another time: the evaluator throws an
`OutsideError` (`recompute/types.ts`, a `KernelError`) with one of two answers.
- `next`, cheap to ask again: the engine keeps no entry, so the next recompute (any, an edit
  after the import too) tries again. `MissingFileError` (the bytes haven't reached the worker),
  "OpenSCAD isn't loaded in this kernel" (`#prepare`'s `openscad()`) and the compiler's "OpenSCAD
  isn't downloaded yet" (offline).
- `bodies`, costly to ask again: the compile was stopped by its time (60 s) or memory limit, or
  its worker died. Trying it on every recompute could cost a minute each time, so it is kept as
  main's `write` key kept it: an `add` evaluation that fails this way falls back to `write` for
  these inputs as one that read a body does (`#readsBodies`, then the entry under the key with
  the bodies before it; the fall-back's evaluation reuses what `prepare` gave, so nothing is
  compiled twice), and an edit before the import tries again. Once it computes, it stays `write`
  for these inputs until the engine forgets the key (`#readsBodies` keeps at most `maxEntries`).

When was a failed import tried again? Main (the import `write`) tried it when its key moved: its
own inputs or values, a feature it refers to, any body before it; and after eviction or a worker
restart (an empty engine). Without the rule its key holds no bodies, so only its own edit did.

| Cause | Main | Before the rule | Now |
|---|---|---|---|
| The bytes not there yet | an edit before it | its own edit | the next recompute |
| OpenSCAD not loaded | an edit before it | its own edit | the next recompute |
| OpenSCAD not downloaded (offline) | an edit before it | its own edit | the next recompute |
| A compile stopped (time, memory, its worker) | an edit before it | its own edit | an edit before it |

The import's `compileRetry` (`features/import.ts`) reads the compiler's own words ("isn't
downloaded", "stopped"), as `compileOnce` already did to forget such a compile. An import's own
error (a file that isn't an STL, an OpenSCAD syntax error) is a plain `KernelError` and stays
cached: evaluated, and compiled, once. No other feature throws an `OutsideError`: the import is
the only evaluator that reads a file (`ctx.file`), and the plugin feature, whose expansion reads
its plugin file, words a missing one as a plain `KernelError`, and an expansion's failed run isn't
kept anyway unless the code itself failed (`#expand`). In the engine: the entry's `retry`, no
entry kept for `next`, and the fall-back's condition (a few lines).

Tests (`recompute/outside-errors.test.ts`; real OCCT and manifold, the compiler a stand-in that
answers in the real compiler's words): each cause fails first, then the same document is
recomputed once the cause is gone, then an edit before the import, on three engines: main's
(`allWrite`, and the engine's own source with the rule's lines taken out), this branch's without
the rule, and this one. They assert the table (and count the compiles). A file that isn't an STL
is evaluated once over the same document and an edit before it; an OpenSCAD syntax error is
compiled once.

**Left `write`**, New Body features looked at (file:line, the read that keeps each there):
thread (`thread.ts:180` resolves the face to thread, :214 copies every body for its cut, :220 the
cut), emboss (`emboss.ts:151` and :269 resolve the face, :153 and :276 `ctx.bodies.get`), rib
(`rib.ts:113` `ctx.bodies.size`, :118, :228, :241 iterate the bodies, :146 a join), hole
(`hole.ts:121` and :277 iterate the bodies, :141 a cut), mesh to solid (`mesh-to-solid.ts:56`
`ctx.bodies.get` of the body it converts). Script, plugin and insert-design are expansions;
combine, the moves and mirrors, patterns, place on bed, remove, fillet, chamfer, shell, draft,
offset and remove faces, split body, scale and simplify for print change bodies.

**The proof for them** (`recompute/add-access-features.test.ts`; real OCCT, a real manifold
module and OpenSCAD's WASM in Node, `strictLeaks`, no clock; the helpers both proofs share are in
`recompute/add-access-test-support.ts`). Six designs, each with a box B0 and a plate before the
feature's instances, a cut after them that splits several into pieces, and one instance after the
cut: a box, cylinder, sphere and torus (one on a construction plane, one sized by a parameter);
revolves about the X axis, a sketch line and a construction axis (one symmetric); coils on XY, a
construction plane and XZ; sweeps along two sketch lines (one twisted, one scaled); lofts through
profiles on construction planes (one ruled); imports of a STEP file of three solids (named, two
coloured, one hidden), an STL, a 3MF of two parts and an OpenSCAD file of two blocks whose size
follows a parameter. 40 seeded edits each: every term of the feature's predicate, made to an
instance that answers `add`, which must leave it `write` (join, cut or intersect, the instance
moved onto B0 for it; a picked body; a face to sit on, or as a profile or section; an edge as axis
or path; a vertex as a loft's tip; "to object" up to XZ) or `add` (another plane or an offset; a box turned, a torus
on its side; a coil's section or hand; another axis, text, angles and directions; a path's first
curve, twist, scale, a fixed orientation; a point as a tip, ruled; an import's up axis, position
and units); one that takes an instance back to `add` (its own inputs again); and the generic edits
(an insert, a length scaled, suppress, the marker, a reorder, a delete, undo, a parameter). After
every step the cached engine gives what a cleared engine gives, compared as for the extrude, and
no recompute of either evaluates a feature twice (no fall-back). The extrude's proof now checks the
same for its nine designs. The edited instance computed (status `ok`) at least once after: the
operation (a real join, cut or intersect with B0) for the primitives, revolves, sweeps and lofts,
a picked body and the way back in every design but the imports, a face to sit on, a plane, an
offset and the shape for the primitives and coils, a face profile, an edge axis, "to object", an
axis, text and angles for the revolves, a face profile (a cylinder's top along a path from its
centre), an edge path (with a profile at its foot), the path and twist for the sweeps, a face
section, a vertex tip (a small box over each loft), a point and ruled for the lofts, and every
term's edit for the imports. The coils' operation is the one write term that doesn't compute: the
coil moved onto B0 kept one evaluation in the seeded run busy for over 25 minutes (not looked
into), so its edit leaves the coil where it is, overlapping nothing.

**Two references (2026-11-25).** A cleared engine with the same features can't see a predicate
that admits inputs whose evaluator only iterates the bodies: under `add` both engines hand it the
same empty `NoBodies`, so both make the same wrong result and nothing falls back. So both proofs
compare the engine under test with a second reference too, cleared each step: the kernel's
features with every `add` answer turned into `write` (`allWrite` in
`recompute/add-access-test-support.ts`, main's engine before `add`), on everything but versions
and keys: statuses and errors, origins, reports, body IDs and their order, every mesh (names
included) bit for bit, and every body's `measure` box (both references compare boxes now). The
proof in both files is clean against it. A control shows what it adds: the revolve's predicate
without its `extent === 'angle'` term, in the engine under test and in the cleared reference alike
(as if the kernel had the fault), and a revolve "to object" up to XZ at x 150: the plane is sized
from the bodies the evaluator iterates, so under `add` it is too small and the revolve fails, the
same way in both engines and without a fall-back. The comparison with the cleared engine is clean
at both steps, the one with the all-`write` engine differs at the edit (statuses), and with the
kernel's own predicate both are clean. The proofs take longer: both files 295 s → 496 s here
(4 cores, one run each; the coils' differential 106 s → 197 s, the lofts' 87 s → 194 s; every
differential keeps its 900 s timeout).

**No fall-back, counted exactly.** `fallbacks` counts a feature evaluated twice in one recompute.
It used to allow as many evaluations as the document held the ID, since the seeded insert could
put back a deleted feature that an undo had already restored; the insert now puts one back only
while its ID is free, and `fallbacks` refuses a document that holds an ID twice.

Counters: an edit of the first of four separate instances (each primitive type, revolves, coils,
sweeps, lofts; an STL import before a 3MF, the STEP and the OpenSCAD import) evaluates that
feature alone and sends one mesh; in each design, every term made to the first instance (an engine
of its own per term) evaluates exactly that instance and the cut, also when the instance then
fails (its body is gone, so the cut reads another body set); an import after a box `i0:a` (whose
body `i0:a:0` has the import's prefix) runs as `write`, and an edit of the box evaluates both;
an edit of a plate before four imports (the STEP file of three solids, the STL, the 3MF, the
OpenSCAD file) evaluates the plate alone and sends one mesh, and the import's `prepare` and
`evaluate` don't run, `options.files` isn't asked for a file and nothing is compiled (a wrapped
registry and compiler count them). The predicates term by term (`primitiveAddsOnly` for each type,
`coilAddsOnly`, `revolveAddsOnly`, `sweepAddsOnly`, `loftAddsOnly`, the import's answer).

Each was checked to fail with its change taken out (the file changed, the filtered test run, the
file restored): each feature's `bodyAccess` back to `() => 'write'` (the first-of-four counter of
that feature: all four primitives, the coil, revolve, sweep and loft; for the import also the
file-read counter and its predicate test); each predicate without one of its terms (the
predicate's own test: operation and picked bodies for each, the primitives' plane, the revolve's
extent, axis and profile terms, the sweep's profile and path terms, the loft's section term); and
`splitSolids` with `ctx.bodies.has` again (the file-read counter and the imports' first-of-four
counter). With that look-up the STEP import's `add` evaluation also left two shapes behind: the
look-up throws after the piece before it was kept (`scope.keep`), so the strict leak check failed
the first recompute; without strict leaks the engine would warn of the leak and fall back. A
predicate changed in the source changes the cleared engine too, so the differential sees such a
fault through its other checks: without the primitives' picked-bodies term the fall-backs (36 in
the primitives design: `explicitBodies`' look-up is noticed), without their operation term the
flips (the edit to a join left the box `add`: `operation: add→add`), without the revolve's extent term the fall-backs (a revolve to a
body looks it up). A negative control in the same file keeps the fault in the engine under test
only, as the extrude's control (2) does: a box joined to a box it overlaps, said to be `add`,
finds no body to join (the iteration isn't noticed, no fall-back) and makes a new one, so the
bodies, statuses, reports, a mesh and a box differ at once, against both references. The revolve
control of "Two references" keeps the fault in both engines.

**Measured.** Kernel time and meshes sent for an edit of the first, a middle and the last
instance, incremental with `have`, in Node, two runs each, on this branch with the features above
always `write` (main's behaviour; the extrude keeps `add`) → as it is. 50 boxes 20 × 20 × 10 mm
apart on XY, the edit a height of 12 mm; 50 knobs, each a sketch on XZ revolved 360° about one of
its own lines, the edit an angle of 300°; 20 plates (60 × 40 × 5 mm extrudes) with a STEP import
(`fixtures/imports/b3.step`) after the eleventh, the edit a plate's distance of 6 mm.

| Design | Edit | Evaluated | Meshes sent | ms |
|---|---|--:|--:|--:|
| 50 boxes | first | 50 → 1 | 50 → 1 | 199, 202 → 11, 11 |
| | middle | 26 → 1 | 26 → 1 | 99, 100 → 8, 8 |
| | last | 1 → 1 | 1 → 1 | 6, 6 → 10, 10 |
| 50 knobs | first | 50 → 1 | 50 → 1 | 407, 406 → 17, 18 |
| | middle | 26 → 1 | 26 → 1 | 213, 212 → 15, 16 |
| | last | 1 → 1 | 1 → 1 | 17, 17 → 15, 15 |
| 20 plates and an import | first | 2 → 1 | 3 → 1 | 36, 36 → 6, 6 |
| | middle (before the import) | 2 → 1 | 3 → 1 | 34, 55 → 9, 7 |
| | last | 1 → 1 | 1 → 1 | 7, 7 → 7, 7 |

Before, the edited plate and the import ran (the plates are `add` on both); now the import is a
cache hit and its file isn't read. The last box's edit, 6 → 10 ms in these two runs, is
6.4 → 6.8 ms as the median of 20 edits (each a new height; the box's evaluate 1.8 ms and its mesh 1.0 ms on both).
The difference is the engine's walk, and it grows with the number of bodies faster than they do:
with 500 boxes the last box's edit takes 20.0 → 32.0 ms (20 edits, two runs: 19.9–20.0 and
31.7–32.0 ms). A CPU profile puts it in `mergeBodies`, which copies the bodies before an `add`
feature to append its own (about 7.5 ms of a walk of 500 boxes), and in `hasOwnBodies`' scan of
their IDs (about 2 ms): both scale with the bodies before each `add` feature, so a walk of N such
features costs on the order of N² map entries. Not changed: appending in place would have to
keep the snapshots a walk hands out (`ScadStep.before` and `after`, a preview's base) unchanged.

In the app (the 30- and 100-plate designs above, production build, the same machine and setup,
median of 4 interleaved runs, main → this): committing an edit of the first plate in its dialog
191 → 184 ms (30 plates) and 260 → 262 ms (100 plates) until the model is ready, undoing it
320 → 321 and 331 → 330 ms. The page's blocked time stays within its runs' spread for six of
the seven actions; opening the 100-plate design gave 818–864 ms (main) and 865–926 ms (this),
and opening the 30-plate one 571–582 and 448–595 ms. Opening the 100-plate design again, quiet
machine, interleaved: 4 more runs of all the actions gave 1,022–1,050 and 1,045–1,194 ms (this
higher in all 8 pairs, by 44 ms as the median difference); 8 runs of opening alone 1,047–1,150
and 991–1,139 ms (medians 1,092 and 1,097); 4 profiled runs 1,027–1,212 and 998–1,094 ms (this
lower in 3 of the 4 pairs), their blocked time split by kind (React render and commit, three.js, sketch
drawing, garbage collection, worker messages) with no kind higher here beyond its spread. Not
a difference of this change, then, as far as these runs tell; the level moves by about 200 ms
between batches of runs. The plates are extrudes, which answered
`add` before, so no change was expected there.

**Not covered:** the features inside an inserted design (an import in one included); a sketch's
geometry, constraints and dimensions; a construction plane or axis made from a body's face or edge
under one of these features (it answers `read` and reaches them as an upstream key, as a sketch on
a face does for the extrude); an import whose attachment record changes its file name (the
attachment commands add and remove a record, `addAttachment` refuses an ID in use); joints, annotations, sheets
and previews.

## Amendment 2026-11-25: `view` access, for features that change only the bodies they name

**Context.** After `add`, a fillet still keyed the whole body set: an edit of any earlier
body-writing feature changed every later fillet's key, so each ran again and its body was sent
again, though it reads and changes only the bodies its edges are on.

**Decision.** `BodyAccess` gains `view`: the feature reads and changes only the bodies its
references name. For such a feature the engine works out its view before evaluating it
(`#viewOf`, `recompute/engine.ts`):

- every body a `body` reference names, and every body whose naming table holds the **exact**
  name of a face, edge or vertex reference, in walk order;
- `write` instead when the feature has no such reference, a reference of another kind, a body
  reference to no body, a face, edge or vertex reference that no body has by that exact name (lost,
  or found only by a related name or a fingerprint), or a view body without a naming table or a
  version; also inside an isolated expansion, as for `add`, and when an evaluation with these
  inputs and this view looked outside it before (`#readsBodies`, shared with `add`) or failed
  with an error to try again once the bodies before it change (an `OutsideError` with `retry:
  'bodies'`, as for `add`; neither the fillet nor the chamfer throws one). `add`'s own
  ID-prefix check doesn't apply: a `view` result is merged by ID (below).

The evaluator gets the view as `ctx.bodies` (a `BodyView`). Its key's last part is the view's
`[id, version]` pairs instead of the chained body-set key. Its result is merged **in place**
(`mergeInPlace`): each body in walk order, a view body replaced by the result's body of its ID or
left out when the result has none, a body outside the view replaced when the result has one of its
ID, then the result's new IDs in its order; that is what `new Map(bodies)` with `set` and `delete`
gives under `write`, but for a `delete` of a body outside the view (the evaluator's copy has none).
Then `bodiesKey = hashOf('view', bodiesKey, key)`: every later feature that reads bodies keys the
set with this result in it. `RecomputeStats.viewed` lists the features that took their result
with a view.

The fillet and the chamfer answer `view` for every input (`features/fillet.ts`,
`features/chamfer.ts`); the engine falls back by itself.

**Fail-closed.** A `BodyView` notices a look-up of a body outside it (`get`, `has`), its size
(which differs from the design's), `names` of such a body, and a reference resolved by anything but
its exact name (a related name, a fingerprint, or lost: every input reference has an exact match in
the view, so such a reference is one the view wasn't made for). A noticed read throws, the result
is dropped, the feature runs again as `write` and the key is remembered, as for `add`. Two things
can't be noticed: iterating (it gives the view's bodies, and it is how an evaluator copies its input
map) and a `delete` of a body outside the view from that copy. Both are kept out by the audit of
each feature that answers `view` (below): an evaluator that iterates to search the bodies, or
deletes bodies it didn't name, must not answer `view`.

**Why the view is complete.** `resolveRef` (`naming/resolve.ts`) collects candidates from every
body it is given (:101) and, when any has the exact name (:116), returns from among those only:
one wins (:117), several are told apart by the fingerprint among them (:118, `closest`). The view
holds every body with an exact match, in the same order, so the evaluator resolves to the same
body, index and name, and `closest` compares the same candidates. The related-name branch (:123)
and the fingerprint branch (:143) look at every body; they are reached only when no body has the
exact name, and then `#viewOf` has already answered `write`. Body versions identify content (a
version is the hash of the key that made the shape, and a `view` key holds its view's versions),
and the view is worked out again on every walk from the naming tables, so a body that gains or
loses a matching name changes the view's ID list and the key.

**What the fillet and the chamfer read** (audited on this branch; file:line, `features/`):

| Read | Fillet | Chamfer | Under `view` |
|---|---|---|---|
| its sets (`filletSets`, `chamferSets`) and `skipsLostEdges` of `ctx.inputs` | :114, :119 | :120, :125 | inputs only |
| each edge through `edgeResolver` (`lost-edges.ts:27` → `ctx.resolve`) | :127 | :139 | exact name, in the view (above); a lost edge with `skipLostEdges` has no exact match, so `write` |
| the reference face of a set (`ctx.resolve`) | none | :133 | a face reference: its bodies are in the view |
| `flipAt`: `ctx.describe(edge.shape)`, the edge's own body | none | :271 | a view body |
| radii, distances, angle (`ctx.value`) | :219, :226 | :223, :244 | no bodies |
| `new Map(ctx.bodies)`, the map it returns | :150 | :166 | iterates the view: a copy, merged in place |
| `ctx.bodies.get(body)` of each body an edge resolved in | :154 | :170 | a view body |
| `kernel.fillet` / `filletVariable` / `chamfer` of that shape; variable radii and tangent chains are worked out by the facade on that shape | :157, :162 | :172 | that body only |
| `buildRound` (`round-fallback.ts`): retries of the same build, `ctx.warn`; no bodies | :169 | :179 | no bodies |
| `withHistory(kernel, result, [ctx.names(body)])` (`naming/ops.ts`): the history and that body's table | :196 | :205 | a view body |
| the engine after it: `#checkNames` and `#checkSound` with the view as `before` (`engine.ts:1355`, :1356) | | | iterate the view to know its handles |

No global state. Neither iterates to search, deletes a body, makes a body ID, or resolves anything
but its own edge and face references. Every fillet and chamfer input reference is an edge or a face
(`refsOf(FILLET_EDGE_KINDS)`, the chamfer's edge and face kinds), so "another kind" can't happen for
them; a set with no edges is a set the evaluator skips, and with none at all it fails ("Pick at
least one edge"), as `write`.

**Rejected.** Making a result with a body ID outside the view fall back to `write` (it was in the
first version): such a result is merged exactly as `write` merges it, and replacing a body by its
ID doesn't read it.

**The proof** (`recompute/view-access.test.ts`; real OCCT and manifold, `strictLeaks`, no clock,
fixed seeds; the helpers of the `add` proofs, `recompute/add-access-test-support.ts`, which now
also compare versions and every body's `measure` box when asked, `exact`):

- **Designs:** five plates with a fillet each; plates overlapping their neighbours with fillets and
  a slot cut through them after; plates with a chamfer of each mode (equal, two distances with a
  reference face, distance and angle, two edges); a plate with two fillets, the second on edges
  named after the first; a plate whose fillet's edges a groove (a box cut) makes findable by a
  related name only; one fillet across two plates; plates with fillets and an inserted design with
  fillets; b4, b6, b7 and the simplify-for-print demo.
- **Edits:** 40 seeded per design. The terms of the rule, each both ways, on the design's first
  fillet or chamfer, first in this order: an edge no body has by its name and back (`lose`,
  `find`), no edges and back (`empty`, `fill`), the groove on and off (`split`, `unsplit`); then a
  round's radius or distance, `skipLostEdges`, a plate's extrude cycling New Body, join and cut,
  and the generic edits (insert, length, suppress, marker, reorder, delete, undo, parameter).
- **After every step** the cached engine equals a cleared engine: statuses, origins, reports, body
  IDs and order, every mesh and name bit for bit, every body's version and `measure` box; no
  fall-back (no feature evaluated more often than the document holds it). Every term flipped both
  ways (`view→write`, `write→view`, from `stats.viewed`); an edited round computed with a view.
- **`view` = `write`:** the same seeded edits with the fillet and chamfer forced to `write` in the
  engine under test, against a cleared engine with views: the same statuses, origins, reports,
  bodies, order, meshes and names (versions differ: they are keys).
- **Isolated:** in the inserted design the fillets run as `write`; the host's take views.
- **Reads outside** (a probe feature answering `view`): a `get`, `has`, `size`, `names` of
  another body, a reference resolved in another body and one no body has are each noticed: the
  first recompute evaluates the probe twice and equals the probe as `write`; after an edit outside
  the view it runs as `write` at once (the memory). A result that replaces a body outside the view
  takes its result's view and equals `write`. A copy of the view isn't a read. A probe that moves
  every body it iterates over moves only its view: not noticed, and different from `write`, which
  is why each `view` feature is audited.
- **Counters:** six plates with a fillet each, for plate 0, 2 and 5: its sketch edited evaluates
  that sketch, its extrude and its fillet and sends one mesh; its fillet's radius evaluates the
  fillet alone, one mesh; its extrude's distance the extrude and the fillet, one mesh; every fillet
  took a view; no fall-back. The cut through the overlapping plates is `write` and reads the
  fillets: a fillet's radius edited evaluates the fillet and the cut. A fillet across two plates
  runs again when one of them changes, not when the third does.
- **Negative controls** (the engine's source changed in a temporary copy, `faultyEngine`): the
  view's versions left out of its key: step 0 equal, then an edit of a plate leaves its fillet
  stale (`mesh ex0:0`); a view missing one of its bodies: caught by the fall-back at once (the
  fillet across two plates evaluated twice), the result right; the result appended after the
  other bodies instead of in place: the body order differs at step 0.
- **Taken out, one at a time** (the source changed, the filtered tests run, the source restored):
  the fillet's `bodyAccess` back to `write` (the six-plates counters, the later cut's counter and
  the counter across two plates fail); the chamfer's (the chamfer design's differential: no flip
  to `view`); each of the `BodyView`'s traps (`get`: its probe and the `names` one, which looks
  the body up; `has`; `size`); a non-exact resolution accepted (the fingerprint probe); a lost
  reference not noticed (the probes of a reference in another body and of one no body has); the
  memory not asked (six probes: they evaluate twice again after the edit); the chain after a
  view left out (the later cut's counter); the isolated term (the inserted-design test); a
  reference no body has by its name taken as nowhere instead of `write` (nine of the eleven
  differentials: fall-backs); the no-reference term (all eleven: the flip to `write` missing);
  the result appended instead of put in place (`view` = `write`). The differential runs both
  engines from the same source, so a fault in the source alone shows only through its other
  checks (the flips, the fall-backs) and the comparison with `write`.
- The prototype's four differences on its overlapping-fillets design (section 4.7 of the plan:
  "through all" over meshed plates) are gone: its seeded differential on that design and five
  others gives 0 differences in 246 comparisons with today's engine, and with views.

**Not covered:** features other than the fillet and the chamfer (the plan's next ones: shell,
draft, offset and remove faces, thread, the picked-body features, sketches and construction
geometry on faces); a fillet whose edge has an exact match on a body a pattern or a mirror copied
(the view holds both, `closest` decides as it does today: not in the designs); previews; joints,
annotations and sheets (they read the bodies at the marker, not a feature's view).

**Measured.** Kernel time and meshes sent for an edit of the first, a middle and the last plate
(its distance to 6 mm) and fillet (its radius to 0.7 mm), incremental with `have`, in Node, two
runs each, each version's own code: main (with `add` for the extrude) → slice 2 (`add` for more
features) → this. The plates of the 30- and 100-plate designs (200 × 120 × 5 mm, 30 holes each),
each with a fillet of four edges, 0.5 mm.

| Design | Edit | Evaluated / meshes sent | ms |
|---|---|--:|--:|
| 20 plates | first plate | 21/20 → 21/20 → 2/1 | 2,262, 2,268 → 2,231, 2,237 → 150, 153 |
| | middle plate | 12/11 → 12/11 → 2/1 | 1,248, 1,249 → 1,264, 1,245 → 145, 143 |
| | last plate | 2/1 → 2/1 → 2/1 | 148, 147 → 145, 144 → 149, 145 |
| | first fillet | 20/20 → 20/20 → 1/1 | 2,245, 2,210 → 2,252, 2,218 → 120, 130 |
| | middle fillet | 11/11 → 11/11 → 1/1 | 1,266, 1,259 → 1,250, 1,235 → 125, 121 |
| | last fillet | 1/1 → 1/1 → 1/1 | 120, 118 → 117, 117 → 131, 123 |
| 100 plates | first plate | 101/100 → 101/100 → 2/1 | 11,095, 11,057 → 11,199, 11,004 → 198, 198 |
| | middle plate | 52/51 → 52/51 → 2/1 | 5,629, 5,671 → 5,743, 5,610 → 189, 190 |
| | last plate | 2/1 → 2/1 → 2/1 | 181, 179 → 181, 178 → 194, 192 |
| | first fillet | 100/100 → 100/100 → 1/1 | 10,903, 11,139 → 10,883, 10,879 → 164, 165 |
| | middle fillet | 51/51 → 51/51 → 1/1 | 5,612, 5,641 → 5,611, 5,601 → 171, 170 |
| | last fillet | 1/1 → 1/1 → 1/1 | 162, 166 → 162, 165 → 169, 173 |

The last plate's and the last fillet's edits evaluate the same features in all three. With 100
plates they take 180 → 193 ms and 164 → 171 ms (medians of the two runs, main → this; 20 plates:
148 → 147 and 119 → 127 ms): every fillet's view is worked out on every walk (its four
references against every body's naming table) and merged in place (a copy of the bodies), so
like `add`'s merge it grows with the bodies before each fillet. Not looked into further.

From scratch (every feature of the 64 designs in `fixtures/`, the fastest of two runs each,
main → slice 2 → this): 11,209 → 11,258 → 11,258 ms over 180 features; the largest change is
the bottle cap's first thread, 6,286 → 6,325 → 6,314 ms (the runs of the boolean copies round gave
6,263–6,291 ms for it); the seven fillets and chamfers 47.9 → 47.7 → 48.0 ms.

In the app (those designs as files, production build, Chrome, 1280 × 800, median of 4 interleaved
runs with their range, main → slice 2 → this), until the model is ready:

| Action | 20 plates | 100 plates |
|---|--:|--:|
| Commit an edit of the first plate in its dialog | 2,216 → 2,230 → 191 ms | 10,820 → 10,850 → 407 ms |
| Undo it | 320 → 320 → 320 ms | 10,666 → 10,672 → 334 ms |

The page's blocked time (tasks of 50 ms or more) of the seven measured actions (click on a face,
box select, commit, undo, open a sketch, drag a point in it, open the design) stays within its
runs' spread on both designs. Components rendered on the commit with 100 plates: 25,432 → 25,726
→ 14,454; on the undo 12,097 → 12,194 → 862 (one run with the render counter, whose hooks make
the page's own tasks longer, so its blocked times are not compared).
