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

**What the extrude reads under that predicate** (audited for this change; file:line):

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

**What they read under those predicates** (audited for this change; file:line; `features/` unless
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
- `bodies`, costly to ask again: the compile was stopped (its time or memory limit, a trap) or its
  worker died. Trying it on every recompute would run the compile up to its limit each time,
  so it is kept as
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

The import's `compileRetry` (`features/import.ts`) reads the cause the compiler marks on a failed
result (`ScadResult.cause`: `offline`, or `stopped` for its time or memory limit, a trap or its
worker dying, set in `@extrudo/openscad`'s `compiler.ts` and `messages.ts` where it words them),
and so does `compileOnce` to forget such a compile. It doesn't read the words: an error of the
file's own may quote its output, "stopped" in an assert's message say (2026-11-26; they were read
from the words before, `/stopped/`, which took such an error for a stopped compile). An import's own
error (a file that isn't an STL, an OpenSCAD syntax error) is a plain `KernelError` and stays
cached: evaluated, and compiled, once. No other feature throws an `OutsideError`: the import is
the only evaluator that reads a file (`ctx.file`), and the plugin feature, whose expansion reads
its plugin file, words a missing one as a plain `KernelError`, and an expansion's failed run isn't
kept anyway unless the code itself failed (`#expand`). In the engine: the entry's `retry`, no
entry kept for `next`, and the fall-back's condition (a few lines). What `next` costs while its
cause lasts: each recompute that walks the import runs its `prepare` and `evaluate` again (a
look-up of the file; for the compiler not downloaded, one compile request, which asks for the
compiler again), and the features after it stay cached. Nothing starts a recompute because a
feature failed.

Tests (`recompute/outside-errors.test.ts`; real OCCT and manifold, the compiler a stand-in that
answers in the real compiler's words): each cause fails first, then the same document is
recomputed once the cause is gone, then an edit before the import, on three engines: main's
(`allWrite`, and the engine's own source with the rule's lines taken out), this branch's without
the rule, and this one. They assert the table (and count the compiles). A file that isn't an STL
is evaluated once over the same document and an edit before it; an OpenSCAD syntax error is
compiled once, and so is an error of the file's own whose words hold "stopped" (on this engine
and on main's, where the edit before it asks `compileOnce` again). With a plate after the import,
a retry for a `next` cause, the cause still there or gone, evaluates the import alone: the plate
answers `add`, so its key holds no bodies and it stays cached whether the import fails or
computes.

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
term's edit for the imports. The coils' operation is the one write term that doesn't compute: its
edit leaves the coil where it is, overlapping nothing, so a coil's join, cut or intersect with a
body isn't covered here.

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
kernel's own predicate both are clean. The proofs take longer: both files 294 s → 520 s here
(4 cores, the two files side by side, the same machine; the coils' differential 106 s → 198 s, the
lofts' 87 s → 194 s, which also computes more now; every differential keeps its 900 s timeout).

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
predicate changed in the source changes the cleared engine too, so the comparison with it stays
clean and the differential sees such a fault through its other checks (run again on the edits as
they are now, 2026-11-26):
- without the primitives' picked-bodies term: the fall-backs (36 in the primitives design:
  `explicitBodies`' look-up is noticed) and the flips (`bodies: add→add`); the all-`write`
  reference sees nothing, since the fall-back runs the box as `write`;
- without their operation term: the flips (`operation: add→add`) and the all-`write` reference
  (75 differences: under `add` the join onto B0 finds no body and makes a new one); no fall-back;
- without the revolve's extent term: the flips (`to-object: add→add`) and the all-`write`
  reference (statuses, origins, reports and the body IDs, from the first "to object" edit on);
  no fall-back, since "to object" goes up to the XZ plane, which is no body look-up.

A negative control in the same file keeps the fault in the engine under test
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
  or found only by a related name or a fingerprint), any body before it without a naming table
  (`#viewOf` reads every body's table to find the matches and gives up at the first without one,
  which is stricter than it needs to be and only happens when describing a shape failed), or a view
  body without a version; also inside an isolated expansion, as for `add`, and when an evaluation with these
  inputs and this view looked outside it before (`#readsBodies`, shared with `add`) or failed
  with an error to try again once the bodies before it change (an `OutsideError` with `retry:
  'bodies'`, as for `add`; neither the fillet nor the chamfer throws one). `add`'s own
  ID-prefix check doesn't apply: a `view` result is merged by ID (below).

The evaluator gets the view as `ctx.bodies` (a `BodyView`). Its key's last part is the view's
`[id, version]` pairs instead of the chained body-set key. Its result is merged **in place**
(`mergeInPlace`): each body in walk order, a view body replaced by the result's body of its ID or
left out when the result has none, a body outside the view replaced when the result has one of its
ID, then the result's new IDs in its order. That is what the evaluator's `new Map(ctx.bodies)` with
`set` and `delete` gives under `write` **only when** it returns a copy of `ctx.bodies` changed by
`set` and `delete` alone and never puts back an ID it deleted (under `write` a deleted and set
again ID goes to the end; in place it keeps its place), and deletes no body outside the view (its
copy has none to delete). The engine checks the first condition: a result whose view bodies aren't
in the view's order, or come after a body that isn't in the view (`inViewOrder`), is dropped and the
feature runs as `write`, remembered, as for a read. The second is the audit's.
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

**Bodies with the same exact names.** `resolveRef` expects them ("bodies that share names",
`naming/resolve.ts:76`) and tells them apart by `closest`. The view must then hold every such body,
not the first: if it held one, the evaluator would find the name in the view, nothing would be
noticed, and `write`'s `closest` might have picked the other. No kernel feature was found that makes
two such bodies: a solid split by `splitSolids` keeps the whole's face names, each face in one piece,
and names its edges again (`features/bodies.ts:83`, :92); copies by Move/Copy, Mirror and the
patterns take a role (`move:<feature>:from:(<name>)`, a pattern instance its own:
`features/transform.ts:85-88`, `features/pattern.ts:197-200`, `features/mesh-bodies.ts:119-120`);
a move keeps the names but replaces its source; an import names faces over the whole file before it
is split (`features/import.ts:380-386`) and numbers mesh pieces (:498). The engine's own names for a
body given no table (`#positional`, `recompute/engine.ts:1405`, `naming/names.ts:303`) come from the
feature's type and ID only, so two bodies one evaluator returned without tables would share them;
none of the features read for this does. The proof has a test feature that makes such twins.

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

**What the fillet and the chamfer read** (audited for this change; file:line, `features/`):

| Read | Fillet | Chamfer | Under `view` |
|---|---|---|---|
| its sets (`filletSets`, `chamferSets`) and `skipsLostEdges` of `ctx.inputs` | :114, :119 | :120, :125 | inputs only |
| each edge through `edgeResolver` (`lost-edges.ts:27` → `ctx.resolve`) | :128 | :140 | exact name, in the view (above); a lost edge with `skipLostEdges` has no exact match, so `write` |
| the reference face of a set (`ctx.resolve`) | none | :133 | a face reference: its bodies are in the view |
| `flipAt`: `ctx.describe(edge.shape)`, the edge's own body | none | :271 | a view body |
| radii, distances, angle (`ctx.value`) | :219, :226 | :223, :244 | no bodies |
| `new Map(ctx.bodies)`, the map it returns | :150 | :166 | iterates the view: a copy, merged in place |
| `ctx.bodies.get(body)` of each body an edge resolved in | :154 | :170 | a view body |
| `kernel.fillet` / `filletVariable` / `chamfer` of that shape; variable radii and tangent chains are worked out by the facade on that shape | :157, :162 | :172 | that body only |
| `buildRound` (`round-fallback.ts`): retries of the same build, `ctx.warn`; no bodies | :169 | :179 | no bodies |
| `withHistory(kernel, result, [ctx.names(body)])` (`naming/ops.ts`): the history and that body's table | :196 | :205 | a view body |
| the engine after it: `#checkNames` and `#checkSound` with the view as `before` (`engine.ts:1371`, :1372) | | | iterate the view to know its handles |

No global state. Neither iterates to search, deletes a body, makes a body ID, or resolves anything
but its own edge and face references. Every fillet and chamfer input reference is an edge or a face
(`refsOf(FILLET_EDGE_KINDS)`, the chamfer's edge and face kinds), so "another kind" can't happen for
them; a set with no edges is a set the evaluator skips, and with none at all it fails ("Pick at
least one edge"), as `write`.

**Rejected.** Making a result with a body ID outside the view fall back to `write` (it was in the
first version): such a result is merged exactly as `write` merges it, and replacing a body by its
ID doesn't read it.

**The proof** (`recompute/view-access.test.ts`; real OCCT and manifold, `strictLeaks`, no clock,
fixed seeds; the helpers of the `add` proofs, `recompute/add-access-test-support.ts`, which also
compare every body's `measure` box and, asked (`exact`), versions):

- **Designs:** five plates with a fillet each; plates overlapping their neighbours with fillets and
  a slot cut through them after; plates with a chamfer of each mode (equal, two distances with a
  reference face, distance and angle, two edges); a plate with two fillets, the second on edges
  named after the first; a plate whose fillet's edges a groove (a box cut) makes findable by a
  related name only; one fillet across two plates; plates with fillets and an inserted design with
  fillets; two twin boxes (a test feature, `test-twin`, names a box from a tag, so both have the
  same names) and a fillet of an edge named on both; b4, b6, b7 and the simplify-for-print demo.
- **Edits:** 40 seeded per design. The terms of the rule, each both ways, on the design's first
  fillet or chamfer, first in this order: an edge no body has by its name and back (`lose`,
  `find`), no edges and back (`empty`, `fill`), the groove on and off (`split`, `unsplit`), the
  twins swapping places so `closest` picks the other (`swap`), one twin suppressed and back
  (`twin-off`, `twin-on`); then a
  round's radius or distance, `skipLostEdges`, a plate's extrude cycling New Body, join and cut,
  and the generic edits (insert, length, suppress, marker, reorder, delete, undo, parameter).
- **After every step** the cached engine equals a cleared engine: statuses, origins, reports, body
  IDs and order, every mesh and name bit for bit, every body's version and `measure` box; and an
  engine that runs every feature as `write` (the same, but versions, which are keys); no fall-back
  (no feature evaluated more often than the document holds it). Every term flipped both ways
  (`view→write`, `write→view`, from `stats.viewed`); an edited round computed with a view.
- **What "equal, versions included" covers.** A key is remembered as `write` after a read, which
  the same inputs and view make again, and after an `OutsideError` with `retry: 'bodies'`, whose
  cause is outside the document. Once that cause is gone, the engine that remembered runs the
  feature as `write` where a cleared engine takes the view again: the same statuses, bodies, meshes
  and boxes, but that feature's bodies' versions and every key after it differ (a test pins it).
  `add` has the same; no `view` feature throws such an error, and of the `add` features only the
  import does, for an OpenSCAD compile that was stopped (`features/import.ts:678-683`).
- **`view` = `write`:** the same seeded edits with the fillet and chamfer forced to `write` in the
  engine under test, against a cleared engine with views: the same statuses, origins, reports,
  bodies, order, meshes and names (versions differ: they are keys).
- **Twins:** the fillet goes to the twin its fingerprint matches, to the other after `swap`, to the
  one left when the other is suppressed; both twins are in its view, so it runs again when either
  changes.
- **Isolated:** in the inserted design the fillets run as `write`; the host's take views.
- **Reads outside** (a probe feature answering `view`): a `get`, `has`, `size`, `names` of
  another body, a reference resolved in another body and one no body has are each noticed: the
  first recompute evaluates the probe twice and equals the probe as `write`; after an edit outside
  the view it runs as `write` at once (the memory). So are a result with a view body deleted and
  set again (out of the view's order) and an `OutsideError` with `retry: 'bodies'`. A result that replaces a body outside the view
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
  other bodies instead of in place: the body order differs at step 0; a view of the first twin
  only (`#viewOf` stopping at the first exact match): the status differs at step 0 (no guess, so no
  warning) and both twins' meshes after the swap.
- **Taken out, one at a time** (the source changed, the filtered tests run, the source restored):
  the fillet's `bodyAccess` back to `write` (the six-plates counters, the later cut's counter and
  the counter across two plates fail); the chamfer's (the chamfer design's differential: no flip
  to `view`); each of the `BodyView`'s traps (`get`: its probe and the `names` one, which looks
  the body up; `has`; `size`); a non-exact resolution accepted (the fingerprint probe); a lost
  reference not noticed (the probes of a reference in another body and of one no body has); the
  memory not asked (six probes: they evaluate twice again after the edit); the chain after a
  view left out (the later cut's counter); the isolated term (the inserted-design test); the order
  check (the probe that deletes and sets again); the `retry` term for a view (both `OutsideError`
  tests); `#viewOf` stopping at the first exact match (the twins' differential, through its
  comparison with the all-`write` engine, and the twins test); a
  reference no body has by its name taken as nowhere instead of `write` (nine of the eleven
  differentials: fall-backs); the no-reference term (all eleven: the flip to `write` missing);
  the result appended instead of put in place (`view` = `write`). The differential runs both
  engines from the same source, so a fault in the source alone shows only through its other
  checks (the flips, the fall-backs) and the comparison with `write`.

**Not covered:** features other than the fillet and the chamfer (to audit next: shell, draft,
offset and remove faces, thread, the features that take picked bodies, sketches and construction
geometry on faces); twins made by a kernel feature (none found, above); previews; joints,
annotations and sheets (they read the bodies at the marker, not a feature's view).

**Measured** ad hoc, with scripts outside the repository, on one machine. Kernel time and meshes
sent for an edit of the first, a middle and the last plate (its distance to 6 mm) and fillet (its
radius to 0.7 mm), incremental with `have`, in Node, two runs each, each version's own code: main
(with `add` for the extrude) → slice 2 (`add` for more features) → this. Designs of 20 and of 100
plates, each 200 × 120 × 5 mm with 30 holes and a fillet of four of its edges, 0.5 mm.

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
main → slice 2 → this): 11,209 → 11,258 → 11,258 ms over 180 features; the largest change of one
feature is +39 ms (+0.6 %) in slice 2 and +28 ms (+0.4 %) here, both in a boolean neither change
runs differently; the seven fillets and chamfers 47.9 → 47.7 → 48.0 ms.

In the app (those designs as files, production build, Chrome, 1280 × 800, 4 interleaved runs:
the median and the range, ms, main → slice 2 → this), until the model is ready:

| Action | 20 plates | 100 plates |
|---|--:|--:|
| Commit an edit of the first plate in its dialog | 2,216 (2,205–2,223) → 2,230 (2,216–2,617) → 191 (184–281) | 10,820 (10,774–10,867) → 10,850 (10,783–10,878) → 407 (392–410) |
| Undo it | 320 (319–321) → 320 (319–321) → 320 (319–322) | 10,666 (10,642–10,789) → 10,672 (10,625–10,796) → 334 (333–350) |

The page's blocked time (tasks of 50 ms or more), the same runs, 100 plates: click on a face 0,
0, 0; box select 55 (53–56), 56 (54–57), 54 (54–55); commit 120 (120–122), 122 (120–122), 120
(119–122); undo 0, 0, 0; open a sketch 138 (134–141), 137 (136–141), 130 (128–132); drag a point
in it 56 (55–58), 56 (56–115), 56 (55–59); open the design 934 (933–961), 964 (896–983), 922
(908–961). With 20 plates every action is 0 in every run but open a sketch, 80 (80–86), 79
(78–80), 79 (78–92), and open the design, 578 (546–617), 571 (364–613), 553 (543–588). Components rendered on the commit with 100 plates: 25,432 → 25,726
→ 14,454; on the undo 12,097 → 12,194 → 862 (one run with the render counter, whose hooks make
the page's own tasks longer, so its blocked times are not compared).

## Amendment 2026-11-26: the shell, draft, offset faces, remove faces and thread answer `view`

**Decision.** The shell, the draft, offset faces, remove faces and the thread answer `view` for
every input, as the fillet and the chamfer do; the engine falls back to `write` by itself where
the rule above says. None of the five was left `write`. Two engine rules change, each for every
`view` feature:

- **A result holds only its view's bodies** (`inViewOrder`, `recompute/engine.ts`). A result with
  a body outside the view, a replaced one or a new one, now runs as `write` (remembered), where
  the earlier rule merged a replaced body in its place and appended a new one. Two reasons, both
  general: a new body that `splitSolids` splits off is placed right after the body it came from
  (`features/bodies.ts:114`), where `mergeInPlace` would have appended it; and `splitSolids` picks
  a fresh ID among the IDs it is given (`features/bodies.ts:47-49`), which under `view` are the
  view's only, so the ID could be one a body outside the view has. The "Rejected" note of the
  amendment above (a body outside the view merged as `write` merges it) no longer holds: such a
  result is now refused. `mergeInPlace` replaces or drops view bodies and keeps every other body.
- **A `plane` reference takes no part in the view** (`#viewOf`). It is an origin plane or a
  construction plane's output (`features/references.ts:90-93`; `constructionOf` reads
  `ctx.output` at :55): no body is read, and a construction plane is an upstream feature whose key
  is already in the feature's key. A construction plane built on a face of a body answers `read`,
  so its key moves with every body-writing feature before it, and a draft about it runs again on
  any such edit, as it did under `write`: the view saves nothing there, and costs nothing. Before, any reference other than a face, edge, vertex or body
  made the feature `write`. Axes and points would follow the same argument; no `view` feature
  needs them, so they still answer `write`.

**What each reads** (audited for this change; file:line, `features/`). Every reference is a
top-level `ref` input (`faces`; the shell's `bodies` and `wallFaces<n>`; the draft's `plane`), so
`#viewOf` sees them all; none resolves a reference it computes. No global state, no document-level
read. Each returns `new Map(ctx.bodies)` changed by `set` (and the thread's cut by `delete`), so it
meets the merge rule; none deletes an ID and sets it again. The engine's order check catches that
only when a later view body follows the ID put back, so a new `view` feature must not do it at all.

| Feature | Reads | Under `view` |
|---|---|---|
| Shell (`shell.ts`) | its settings and thickness (:60, :64); each face to remove (`ctx.resolve`, :74); each picked body `ctx.bodies.has` (:80); each wall set's thickness and faces (:97, :104); `ctx.bodies.get` of each body to shell (:134), `kernel.shell` of it (:138), its names and the result's description (:149, :152); `new Map(ctx.bodies)` and `set` (:157, :160) | faces and walls by exact name, picked bodies by `body` reference: all in the view; a picked body no body is answers `write` (`#viewOf`) |
| Draft (`draft.ts`) | settings and angle (:47, :52); the neutral plane (`planeOf`, :63: a face is resolved, `references.ts:79`; an origin plane or a construction plane's output reads no body, :90-93); each face (:69); `get` (:78), `kernel.draft` (:81), `withHistory` with that body's names (:87); copy and `set` (:94, :97) | a face plane by exact name, in the view; a `plane` plane takes no part in it |
| Offset faces (`offset-face.ts`) | settings and distance (:64, :66); each face (:76); `get` (:85); the rounds it keeps, `roundsNextTo` (:88): `get`, names, `kernel.tangentFaces` and `surfaceGeometry` of the same body (:137, :138, :142, :146); `kernel.offsetFaces` (:89); names (:100); copy and `set` (:106) | the body of each face only |
| Remove faces (`remove-faces.ts`) | its faces (:39), each resolved (:45); `get` and the face count (:51, :52); `get`, `kernel.removeFaces`, the description for a message (:60, :63, :66); names (:71); copy and `set` (:78) | the body of each face only |
| Thread (`thread.ts`) | settings and numbers (:171, :172); each face (:183), `kernel.threadFace` of its own body (:184); a sleeve that fills it, fused with that body and its names (:188, :190, :191; `sleeveOf` describes and names the same body, :917, :932); the tools, own geometry (:207, :211); a context for the cut whose `bodies` is a plain copy of the view with the filled bodies (:217, :218); the cut, `operate` with the faces' bodies as participants (:223) | the faces' bodies only, see below |

The thread's cut (`operation.ts`): with participants and `cut`, `touching` is empty
(:146-147: no search among the bodies); each participant is looked up with its names (:161,
:162); the result is `new Map(ctx.bodies)` with each cut body `set` or, when nothing is left,
`delete` (:263, :267), then `nameMeshBodies` (:273, the output's own bodies). `splitSolids`
(`bodies.ts`) iterates the bodies (:41) and picks fresh IDs (:47-49) for a body cut in two: new
IDs, so that result runs as `write`. The cut's context is a plain map (:217): a look-up outside
the view there would not be noticed; there is none, by the lines above.

**The proof** (one file per feature, `recompute/view-access-shell.test.ts`, `-draft`,
`-offset-face`, `-remove-faces`, `-thread`, over `recompute/view-access-features-test-support.ts`;
real OCCT and manifold, `strictLeaks`, no clock, fixed seeds):

- **Designs:** plates with shells (one with a wall set of its own thickness, one hollowed closed
  by a body reference, one after a fillet, a slot cut through all of them after); twin bodies
  with the same names (`test-twin`) and a shell of a face named on both; plates with drafts about
  XY; plates with offset faces, one next to a fillet whose round it keeps; plates with a hole
  filled each and a cut after; studs with a thread each (one thinner than the thread, built up to
  it first: the fill, and the cut's plain-copy context), a plate between and a 1 mm box through
  the first stud where its thread is cut, which no thread names: a cut that searched the bodies
  it touches would cut it under `write` but not with a view. A construction plane on the first
  plate's top face (`read`) that the second plate is drafted about.
- **Edits:** 40 seeded per design (20 for the threads, short coarse ones: pitch 2 mm, 3 mm long).
  The rule's terms on the design's first feature (the second plate's draft for the drafts), both
  ways: a face no body has by its name and back, no faces and back; the shell's picked body added
  and taken out (`view` both), one that doesn't exist and back (`write` and back); the draft's
  plane cycling XY, a construction plane and the first plate's bottom face, outside the draft's
  view until it is the plane (`view` throughout: the test asserts that no `plane` edit took
  the view away, `plane: view→write`; one made to a draft another edit had already left `write`
  stays `write`); the twins swapping places and one suppressed and back. Then the features' own inputs (flip,
  keep rounds, hand, extent) and the generic edits.
- **After every step**, as for the fillet: the cached engine equals a cleared engine (versions
  and `measure` boxes included) and an engine running every feature as `write` (all but
  versions, which are keys); no fall-back. The comparison with the all-`write` engine at every
  step is what shows `view` = `write`; a separate run with the five forced to `write` in the
  engine under test was dropped as the same check.
- **Counters** (exact, no fall-back): the shells, a plate's distance: the plate, its shell and
  the cut after (which reads every body); the shell's thickness: the shell and the cut. The
  drafts, a plate's distance: the plate and its draft, one mesh; the draft's angle: the draft,
  one mesh. Offset faces likewise (the plate and its offset; the offset's distance: the offset),
  one mesh each. Remove faces, a plate's distance: the plate, its removal and the cut after (it
  has no number to edit). The threads, the first stud's height: the stud and its thread, one mesh; the
  thread's length: the thread, one mesh. A draft about a construction plane runs again when the
  plane changes; one about a plane on the first plate's face when the first plate changes (the
  plate, its draft, the plane and the second plate's draft). The threads' box: still six faces;
  the thin stud's thread warns that it was built up.
- **The engine rules** in `recompute/view-access.test.ts`: a probe whose result replaces a body
  outside its view, and one that adds a new body, are each dropped and run as `write`,
  remembered.
- **Taken out, one at a time** (the source changed, the filtered tests run, the source restored):
  each feature's `bodyAccess` back to `write` (its counter; the draft's construction-plane test
  too); the `plane` rule (the draft's counter and construction-plane test); the result rule (the
  probes of a replaced and a new body); `body` references in the view (the shells' differential);
  the thread's participants (the cut's `[...bodies]` left out, so it searches the bodies it
  touches): the threads' differential, their counter and the box test.

**Not covered:** a thread whose cut splits its body (it runs as `write`, by the result rule; no
design has one); axes and points as references of a `view` feature; previews; joints,
annotations and sheets.

**From scratch** (ad hoc, a script outside the repository): the 64 designs in `fixtures/`'s
`benchmarks`, `examples`, `demos`, `components` and `sheets` folders (not `scripts/`, whose one
design runs a script and has none of the five) with
main's engine and this one give the same body IDs, meshes bit for bit, statuses, reports,
`inspect` of every body and number of evaluations. Versions differ in the four designs with one
of the five (b4, b5, b6, b9): a version is the key that made the body, and those bodies are now
made under `view` keys. The feature goldens are unchanged.

**Measured** ad hoc, with scripts outside the repository, on one machine. Kernel time and meshes
sent for an edit of the first, a middle and the last of 20 bodies, incremental with `have`, in
Node, two runs each, main → this. Plates of 200 × 120 × 5 mm with 30 holes, each with the
feature (a shell of 1 mm opening its top face; a draft of 3° of its four sides about XY; its top
face offset by 0.5 mm; one hole's wall removed), the edit its distance to 6 mm; studs of Ø8 ×
10 mm with a 5 mm thread each, the edit a height of 12 mm.

| Design | Edit | Evaluated / meshes sent | ms |
|---|---|--:|--:|
| 20 plates, shells | first | 21/20 → 2/1 | 14,478, 14,285 → 742, 743 |
| | middle | 12/11 → 2/1 | 8,251, 7,847 → 748, 748 |
| | last | 2/1 → 2/1 | 803, 748 → 748, 746 |
| 20 plates, drafts | first | 21/20 → 2/1 | 2,087, 2,094 → 140, 139 |
| | middle | 12/11 → 2/1 | 1,160, 1,162 → 140, 136 |
| | last | 2/1 → 2/1 | 151, 140 → 136, 134 |
| 20 plates, offset faces | first | 21/20 → 2/1 | 9,528, 9,385 → 500, 501 |
| | middle | 12/11 → 2/1 | 5,254, 5,183 → 504, 498 |
| | last | 2/1 → 2/1 | 507, 501 → 508, 501 |
| 20 plates, a hole filled | first | 21/20 → 2/1 | 3,493, 3,429 → 207, 206 |
| | middle | 12/11 → 2/1 | 1,914, 1,890 → 207, 201 |
| | last | 2/1 → 2/1 | 207, 204 → 201, 201 |
| 20 studs, threads | first | 21/20 → 2/1 | 25,472, 25,280 → 1,276, 1,266 |
| | middle | 12/11 → 2/1 | 13,978, 13,892 → 1,273, 1,264 |
| | last | 2/1 → 2/1 | 1,295, 1,268 → 1,279, 1,270 |

From scratch (every feature of those 64 designs, the fastest of two runs each, main → this):
11,271 → 11,235 ms over 180 features; the largest increase of one feature +2.7 ms; the six
instances of the five features 7,652 → 7,622 ms.

In the app (20 plates with shells as a file, production build, Chrome, 1280 × 800, 4 interleaved
runs: median and range, ms, main → this), until the model is ready: committing an edit of the
first plate in its dialog 13,764 (13,678–13,913) → 795 (788–806); undoing it 336 (332–337) → 320
(320–321); opening the design 13,505 (13,354–13,654) → 13,492 (13,143–13,609). The page's blocked
time: commit 0 (0–69) → 0 (0–0), undo 0 → 0, open 455 (375–553) → 534 (384–603).

## Amendment 2026-11-26: move, scale and mirror in place, Remove and Combine answer `view`

**Decision.** Five features that take picked bodies answer `view` for the inputs that never add a
body: Move and Scale without a copy, Mirror of bodies without a copy, Remove, and Combine. A
copy, a mirror's join (it needs a copy) and a mirror of features stay `write`, and so do the
patterns of bodies and Split Body, which always add bodies: a `view` result may hold only its
view's bodies (the amendment above), and a rule for new ones is not part of this change (below).
One engine rule changes: `#viewOf` passes over `axis`, `point` and `sketchEntity` references as it
did planes (`PASSED_OVER`, `recompute/engine.ts`): an origin axis or point, a construction axis or
point (`features/references.ts`, `lineOf` and `pointOf`, read through `constructionOf`, `ctx.output`
:55) and a sketch line (`sketchLine`, `ctx.output` :133) read no body, and their feature is
upstream. A straight edge or a vertex is resolved like any face, edge or vertex reference.

**What each reads** (audited for this change; file:line, `features/`). Every reference is a
top-level `ref` input (`bodies`; Combine's `target` and `tools`; Move's `axis`, `from`, `to`;
Scale's `point`; Mirror's `plane`); none resolves a reference it computes, none searches the
bodies, none reads anything document-level. Each returns `new Map(ctx.bodies)` changed by `set`
(and Remove's and Combine's `delete` of the bodies they name), so it meets the merge rule; none
deletes an ID and sets it again.

| Feature | Reads | Under `view` |
|---|---|---|
| Move (`transform.ts`) | each picked body `ctx.bodies.has` (`existing`, :41, :48); the motion: the picked bodies' box centre (`centreOf`, `kernel.properties` of each, :163, :210), an axis (`lineOf`, :169), two points (`pointOf`, :175, :176); each picked body transformed (:81) and named from its table (:85); copy and `set` (`withImages`, :95, :96, :99) | picked bodies by `body` reference; an edge or vertex by exact name; an origin or construction axis or point, a sketch line: passed over |
| Scale (`scale.ts`) | `existing` (:35); its factors (:36); the centre: a point or the picked bodies' box (:44, :94, :95); `kernel.scale` of each picked body and its names (:51, :52); `withImages` (:63) | as for Move |
| Mirror (`transform.ts`) | a mirror of features returns before (:263); `existing` (:264); the plane (`planeOf`, :266: a face resolved, a plane passed over); `transformBodies` (:81, :85); `withImages` (:271); the join (:275 on) is reached only with a copy | picked bodies; a face plane by exact name |
| Remove (`bodies.ts`) | its bodies (:132), each `has` (:133); copy and `delete` (:141, :142) | picked bodies |
| Combine (`combine.ts`) | target and tools, each `has` (`bodyOf`, :64, :72, :73); the target refused as its own tool (:74); each looked up with its names (:77, :78); `bodiesTouch` between the target and each tool only (:84, `operation.ts:51`: a distance of two shapes); the booleans of the target with the tools (:105, :116, :140) and, to intersect, of the tools with each other (:137); the volume of the target before and of the result (`kernel.measure`, :120, :121, :143); copy, `set` the target, `delete` the tools unless kept (:153, :155, :156); the tools' shapes for a preview (`ctx.bodies.get`, :159); `splitSolids` (:162) | target and tools by `body` reference, and shapes made of them only; a result split into pieces holds new bodies and runs as `write` |

**Body references.** `#viewOf` takes each `body` reference's body. A picked body that doesn't
exist makes the feature `write`, and it gives the same error under both. A body picked twice is in
the view once; a body picked as Combine's target and tool is in it once, and the feature fails the
same way under both. No picked-body feature picks "all bodies". With no body picked (each then
fails asking for its bodies, the same way under both), what is left decides:

- Move keeps a view when its axis, `from` or `to` is an edge or a vertex, also one its current
  mode doesn't use (an input the dialog left after a change of mode still counts); an origin or
  construction axis or point, or a sketch line, leaves no reference, so it runs as `write`.
- Scale keeps a view when its centre is a vertex; about its bodies' box or a construction or
  origin point it runs as `write`.
- Mirror keeps a view when its plane is a face; an origin or construction plane leaves none.
- Combine keeps a view: it still names its target.
- Remove's inputs refuse an empty list before any body access is asked, so its feature fails
  without a view or a key; the proof doesn't edit Remove to no bodies.

**Removed bodies.** Remove and Combine (tools not kept) delete bodies of their view from their
copy; `mergeInPlace` leaves a view body the result doesn't hold out, so the next feature gets the
map `write` gives it. The differential's later features and edits (a reorder, a suppress, a body
picked again) read that map at every step.

**Patterns and mirrors of features** stay `write`: they replay the chosen features' tools at
each placement and join or cut them as the features did (`pattern.ts` `replayFeatures`, Mirror
:263 → `mirrorFeatures`), finding the bodies a tool meets among all of them, which a view can't
serve.

**New bodies** (a copy, a pattern instance, a mirrored copy, a split piece) are not taken into a
view. A rule for them would need: where a new body goes in the map (a `set` appends it, while a
piece `splitSolids` splits off goes right after its body); fresh IDs that can't meet a body outside
the view; and their versions from the view's key. That is more than this change makes.

**The proof** (one file per feature, `recompute/view-access-move.test.ts`, `-scale`, `-mirror`,
`-remove`, `-combine`, over `recompute/view-access-features-test-support.ts`; real OCCT and
manifold, `strictLeaks`, no clock, fixed seeds; 10 mm boxes):

- **Designs:** boxes moved freely, about the Z axis and from the origin to another box's corner;
  boxes moved about a construction axis along another box's edge, about a sketch line on XY,
  about a sketch line on another box's top face, and to a construction point on another box's
  corner; boxes scaled about their centre and about another box's corner; boxes mirrored in an
  origin plane and in another box's face, and twin boxes (`test-twin`) whose face, named on both,
  is the mirror plane; boxes with some removed; targets joined, cut and intersected with tool
  boxes. In each design but the twins' and the one about construction geometry, a box that no
  feature names overlaps a box a feature names (Move's, Scale's and Mirror's first box, each
  Combine target, and one of the removed boxes; Remove's design has one more over a box it keeps):
  a feature that searched the bodies it touches, or also took those, would reach it under `write`
  but not with a view.
- **Edits:** 20 seeded per design (24 for Combine: its 21 kinds each once, in order, then three
  seeded). The first pass takes each kind once, in the order listed, on the design's first
  feature (the move about the construction axis in that design): a body no body is and back; no
  bodies and back (not for Remove, whose inputs refuse it; Combine and the twins' mirror keep a
  reference, so they keep the view, and the test says so); the first body picked a second time
  and back (`twice`, `untwice`); the copy turned on and off (`view→write`, `write→view`); Move's
  mode cycling free, about an axis, point to point to a box that comes into the view by its
  vertex, and free again (`view` throughout, asserted); the mirror's plane to a face of a box
  outside the view and back to the YZ plane (`view` throughout, asserted); Combine's operation
  cycling join, cut, intersect and join, its tools kept and not kept, its target picked as a tool
  and taken out again; the twins swapping places, and one suppressed and back. Then the generic
  edits, each once, on the feature as those left it, and seeded edits for the remaining steps.
- **Construction and sketch geometry** (Move): an edit of the box with the construction axis's
  edge runs the box, the axis (`read`) and the move about it; an edit of the XY sketch, the
  sketch and the move about its line; an edit of the box under the face's sketch, the box, that
  sketch and the move about its line; an edit of the corner's box, the box, the construction point
  and the move to it. Every `read` feature after an edited body runs again too (its key holds
  every body before it), and so does each move about it; a box no feature refers to leaves the
  move about the XY sketch's line alone. Every move keeps its view, and every step equals a
  cleared and an all-`write` engine.
- **After every step:** the cached engine equals a cleared engine (versions and `measure` boxes
  too) and an all-`write` engine (all but versions); no fall-back.
- **Counters:** a box's size: the box and its feature, one mesh (Remove: none, the box is gone);
  Move's distance and Scale's factor: the feature alone, one mesh.
- **Taken out, one at a time** (the source changed, the filtered tests run, the source restored),
  and the tests that failed: each feature's `bodyAccess` back to `write` (its differential and
  counter; Mirror's twins too); Move's copy term (a copy as `view`: its differential); Mirror's
  copy term (its differential); the whole pass-over (Move's differential and counter: its axis
  and points make it `write`); each of `axis`, `point` and `sketchEntity` taken out of it alone
  (`sketchEntity`: the test of the moves about construction and sketch geometry, whose two
  sketch-line moves are then not viewed; `axis`: that test, both Move designs' differentials and
  the counter; `point`: that test, the first design's differential and the counter); the upstream features' keys left out of every key (a throwaway change: the test of the moves about construction and sketch geometry, a move
  then kept from before its axis or sketch changed); Remove deleting every
  body it is given (its differential and counter: under `write` the box outside the view goes
  too); Remove also deleting the bodies that touch the ones it names (its differential and counter: under `write` the box over the removed one goes too); Combine
  taking every other body as a tool (its differential and counter).

**Not covered:** a body made by a copy, a pattern or a split in a view (they run as `write`); the
patterns and mirrors of features; Split Body; previews; joints, annotations and sheets.

**From scratch** (ad hoc, a script outside the repository): the 64 designs in `fixtures/`'s
`benchmarks`, `examples`, `demos`, `components` and `sheets` folders with main's engine and this
one give the same body IDs, meshes bit for bit, statuses, reports, `inspect` of every body and
number of evaluations. Versions differ in b3, the one of them with one of the five (a version is
the key that made the body). The feature goldens are unchanged.

**Measured** ad hoc, with scripts outside the repository, on one machine. Kernel time and meshes
sent for an edit of the first, a middle and the last of 20 plates (200 × 120 × 5 mm, 30 holes;
the edit its distance to 6 mm), incremental with `have`, in Node, two runs each, main → this. Each
plate moved 1 mm up, scaled 1.01, mirrored in XZ without a copy, or with a 20 mm box over its
corner that a Remove takes out or that it is joined with.

| Design | Edit | Evaluated / meshes sent | ms |
|---|---|--:|--:|
| 20 plates, moved | first | 21/20 → 2/1 | 2,224, 2,201 → 146, 141 |
| | middle | 12/11 → 2/1 | 1,225, 1,220 → 142, 149 |
| | last | 2/1 → 2/1 | 148, 146 → 140, 146 |
| 20 plates, scaled | first | 21/20 → 2/1 | 2,235, 2,236 → 147, 139 |
| | middle | 12/11 → 2/1 | 1,232, 1,224 → 145, 147 |
| | last | 2/1 → 2/1 | 145, 144 → 139, 138 |
| 20 plates, mirrored | first | 21/20 → 2/1 | 1,954, 1,909 → 131, 130 |
| | middle | 12/11 → 2/1 | 1,093, 1,063 → 126, 125 |
| | last | 2/1 → 2/1 | 130, 127 → 130, 127 |
| 20 plates, a box removed | first | 21/1 → 1/1 | 60, 59 → 63, 60 |
| | middle | 12/1 → 1/1 | 56, 56 → 54, 54 |
| | last | 2/1 → 1/1 | 53, 53 → 55, 55 |
| 20 plates, a box joined | first | 21/20 → 2/1 | 2,662, 2,650 → 164, 169 |
| | middle | 12/11 → 2/1 | 1,483, 1,462 → 162, 162 |
| | last | 2/1 → 2/1 | 165, 165 → 179, 161 |

A Remove is cheap to evaluate again, so it saves evaluations there, not time.

From scratch (every feature of those 64 designs, the fastest of two runs each, main → this):
11,254 → 11,172 ms over 180 features; the largest increase of one feature +2.7 ms.

In the app (the 20 moved plates as a file, production build, Chrome, 1280 × 800, 4 interleaved
runs: median and range, ms, main → this), until the model is ready: committing an edit of the
first plate in its dialog 2,145 (2,123–2,219) → 278 (266–281); undoing it 318 (316–320) → 320
(320–322); opening the design 1,238 (1,203–1,364) → 1,159 (972–1,254). The page's blocked time:
commit 0 → 0, undo 0 → 0, open 551 (533–587) → 471 (385–556).

## Amendment 2026-11-27: new bodies in a `view` result

**Decision.** A `view` result may hold bodies the view didn't have. With it, Move, Scale and
Mirror of bodies answer `view` with a copy too (and a mirror's join), and the patterns of bodies
(rectangular, circular, along a path) and Split Body answer `view`. The rule is the engine's, so
it holds for every `view` feature: a Combine whose result splits (whatever its operation) and a
thread whose cut splits its body (`features/thread.ts:220`) keep their view too. Patterns and
mirrors of features stay `write` (the amendment above).

**What no longer holds.** In the amendment on the shell, draft, offset faces, remove faces and
thread: "a result holds only its view's bodies" (a new body now stays in the view; a body outside
the view in the result is still refused), and its "not covered" thread whose cut splits its body
(it now keeps its view). In the amendment on picked-body features: Combine's "a result split into
pieces holds new bodies and runs as `write`", "new bodies … are not taken into a view", and its
"not covered" copies, patterns and splits and Split Body. This amendment replaces those.

**The rule** (`fitsView`, `placedAsWrite`, `mergeInPlace`, `recompute/engine.ts`):

- **No body with the feature's own ID prefix** (`<feature>:`) may exist, in the view or out of
  it (`hasOwnBodies`, as for `add`): every new ID is `<feature>:<n>`, picked by the feature's own
  count or by skipping the IDs it is given, so with no such body the IDs are the ones `write`
  picks. Else the feature runs as `write` at once.
- **No ID of a body outside the view** in the result (it would replace a body the feature didn't
  see), and the view's bodies in the view's order, as before; no ID put back after its `delete`
  stays a rule for evaluators (the order check sees it only when a later view body follows).
- **Places.** Under `write` a new body's place comes from how it was made: a `set` of a new ID on
  the evaluator's copy of the map appends it at the end of the whole map; `splitSolids` places
  the pieces it splits off right after the body they came from. In a view's result the two show by
  where the new IDs stand. A new ID that a view body follows was placed after the view body before
  it (only `splitSolids` places a body there), so it goes right after that body in the whole map.
  After the result's last view body, the new IDs whose `origins` entry is that body are its
  pieces and go right after it; the rest go to the end, in the result's order. Only two places
  write an `origins` entry: `splitSolids`, for a piece of a body that existed before the feature
  (`features/bodies.ts:88`), and Split Body's mesh path, for a mesh's second side, which it adds
  with a `set` (`features/split-body.ts:94`, :96), so at the end. The two places differ for a mesh
  piece of the last view body when a body outside the view comes after that body in the walk: the
  result can't tell them apart, so then the feature runs as `write` for that walk
  (`placedAsWrite`). That depends on the bodies outside the view, so it is not remembered: the
  view's entry stays cached under its key, and the next walk decides again (with the body after
  it gone, the feature keeps its view and its versions are a cleared engine's). A mesh piece that
  `splitSolids` splits off (a Combine of a mesh target, a mirror's or a pattern's join of meshes)
  falls back the same way although `splitSolids` placed it right after its body: both have an
  `origins` entry for that body and stand right after it in the result, so the result alone can't
  tell them apart. A B-rep piece there keeps the view. A new ID before the result's first view
  body (no evaluator makes one), an ID of a body outside the view and a result out of the view's
  order run as `write`, remembered (`fitsView`: a property of the result for every evaluator
  that keeps the rules).
- **Keys and versions** of a new body are those of any body a feature makes: the version is the
  hash of the key that made it (`hashOf(key, id)`), and a view's key holds the view's versions
  and the inputs.

The engine change is these checks and the merge: 83 lines of code added and 18 removed, comments
aside (6 of the removed lines come back moved or indented anew).

**What each new-body path reads** (audited for this change; file:line, `features/`; the reads of
the in-place paths are in the amendment above):

| Feature | New-body path | Under `view` |
|---|---|---|
| Move, Scale (`transform.ts`, `scale.ts`) | a copy's ID `ctx.bodyId(i)` by the body's place in its list (`transform.ts:90`, `scale.ts:59`), `set` on the copy of the map (`withImages`, `transform.ts:96`, :99) | appended at the end |
| Mirror (`transform.ts`) | copies as Move's; the join: each copy against its own original (`bodiesTouch`, :283), fused into it (:291, :298) or kept apart with `ctx.bodyId(extra++)` (:284, :285, appended); `splitSolids` (:311) | the original and its copy only; pieces of an original after it |
| Patterns of bodies (`pattern.ts`) | each picked body looked up with its names (:407, :417); its instances at each placement, ID `ctx.bodyId(pairSlots(slot, place))` (:431, :432, appended); the join fuses them into the original (:444, :457) and `splitSolids` (:467); the join's warning compares the result with the number of bodies it was given (:410, :470; it read `ctx.bodies.size`, which a view notices); the layout: directions and axis by `lineOf` (:689, :697, :749), a path by `pathFromRefs` (:822: sketch curves through `ctx.output`, edges resolved); the report's centre from the picked bodies' boxes (:146), the bodies there are when none is found (:159): with no bodies picked but an edge direction, axis or path the view exists and this iterates the view's bodies, which is harmless because the evaluator throws "Pick the bodies to pattern." first (:612), the same under both | the picked bodies; references passed over or resolved by name |
| Split Body (`split-body.ts`) | each picked body (:56, :69), the plane (`planeOf`, :58: a face resolved by name, which brings its body into the view; a plane passed over); `splitOne` of that body (:70); a B-rep result stays one compound under its ID (:77) for `splitSolids` (:116) to split; a mesh's smaller side gets the next `ctx.bodyId(n)` not in the map (:92, :93) and a `set` (:94) with an origin (:96) | the picked bodies; a B-rep piece right after its body; a mesh's side at the end, or `write` when it is of the last view body and a body outside the view follows that body |
| Combine (`combine.ts`) | `splitSolids` of the cut target (:162) | as Split Body's B-rep pieces |
| `splitSolids` (`bodies.ts`) | the IDs before it by iterating (:41); fresh IDs `ctx.bodyId(n)` not in the output (:47, :50, :51); a piece right after its body (:113) with an origin when the body existed before (:88) | the output holds the view's bodies and the new ones: the same fresh IDs as under `write` when no body has the feature's prefix |

**Fresh IDs.** Every new ID is `<feature>:<n>` (`ctx.bodyId`, `recompute/engine.ts:1367`):

- Move, Scale: `n` is the body's place in the feature's own list (`transform.ts:90`, `scale.ts:59`);
- Mirror's copies kept apart by the join: counted on by the feature (`transform.ts:284`);
- patterns: from the instance's slot and the body's place in the list (`pattern.ts:431`);
- Split Body's mesh side: the next `n` not in the evaluator's own map (`split-body.ts:92`, :93);
- `splitSolids`: the next `n` not in its output (`bodies.ts:47`–51).

The first three depend on the inputs alone. The last two skip IDs in the map they hold: under
`write` every body, in a view the view's bodies and the new ones. They pick differently only when
a body outside the view has an ID `<feature>:<n>`, and `hasOwnBodies` sends the feature to `write`
whenever any body has that prefix. So no new ID depends on the bodies outside the view.

**Removed, then added.** A view ID deleted and set again goes to the end of the map under `write`
but keeps its place in the merge. The order check sees it only when a later view body follows, so
"never put back an ID after its `delete`" stays a rule for evaluators. No new-body path deletes an
ID it sets:

- Split Body sets the compound under its body's ID (`split-body.ts:77`);
- `splitSolids` builds a new map in order (`bodies.ts:113`);
- Mirror's join sets the original (:291, :298);
- Combine sets its target and deletes only tools.

**Patterns and mirrors of features** answer `write` (`bodiesAccess`, `pattern.ts:712`; Mirror's
`objects` term, `transform.ts:228`): a replayed tool cuts or joins whatever bodies it meets. The
engine gives no view to a `feature` reference either.

**The proof** (`recompute/view-access-new-bodies.test.ts`; real OCCT and manifold, strict leaks,
no clock, fixed seeds, 10 mm boxes). Five designs, each with boxes outside the views before,
between and after the bodies the features name, and a slot cut through every box at the end
(`write`: it reads them all, in order):

- copies: a Move copying two boxes, a Scale and a Mirror copying one each, and a Mirror with a
  copy and a join of two boxes (one copy fused into its box, the other apart, over a box outside
  the view: the join takes only its own original);
- patterns of bodies: a rectangular pattern along X, over a box outside its view, and a circular
  one about Z;
- splits: two boxes split by XZ with a box outside the view before and between them, then a box
  split with a box outside its view after it;
- Combine cuts that split their targets: one with a box outside the view before, one with a box
  outside the view between the target and the tool;
- patterns of bodies joined: a box's three instances, each touching the next, fused into it; and
  a box's instance apart from it, so the fuse makes two solids and the instance is a piece right
  after its box, before a box outside the view.

Which features tell the placement rules apart (where the two places differ):

- a new body at the end, not right after the view's last body: the Scale's and both Mirrors'
  copies and the rectangular pattern (a body outside the view comes after the copied box). The
  Move's copies and the circular pattern's instances are of the last body there is, so both places
  are one for them;
- a piece right after a view body that a later view body follows: the first split's piece of the
  middle box;
- a piece of the view's last body right after it: the second split, the second Combine and the
  joined pattern with its instance apart. The first split's piece of the last box and the first
  Combine's are of the last body there is: the same either way;
- the mesh fall-back: the mesh split.

The tests:

- **Seeded edits**, 20 per design, at every step equal to a cleared engine (versions and
  `measure` boxes too) and an all-`write` engine (all but versions):
  - the rule's terms: a body that doesn't exist, and back; no bodies, and back; a body picked a
    second time, and back; the copy off, and back on (copies); the join off, and back on (the
    joined pattern with its instance apart: the warning on its separate instance, a status the
    comparison holds, appears and goes); the operation cycled cut, intersect, join and back to cut
    (the first Combine);
  - the generic edits (insert, length, suppress, marker, reorder, delete, undo, parameter).
- **Every placement**, each feature's new bodies where `write` puts them, and which features keep
  the view: the four copies, the four patterns, both splits, both Combine cuts.
- **The order a later feature reads**, without the cut (which splits every box):
  - the copies at the end of the map as it stood when each was made (the Move's after the last
    box, the Scale's of a middle box after a box outside its view), the joined Mirror's copy kept
    apart last;
  - a middle box's piece right after it, before the box outside the view;
  - the last box's at the end;
  - a box's piece right after it with a box outside the view after it (a B-rep piece);
  - the joined pattern's instance apart, right after its box, before the box outside the view.
- **A mesh split** (the 20 mm cube STL split by a construction plane), one engine over three
  steps: a box outside the view after the mesh (the split tries its view, then runs as `write`);
  the box gone (it keeps its view, from the cache, and its versions equal a cleared engine's);
  the box back (`write` again, both entries from the cache). Same IDs throughout. Before the
  fall-back was decided at each walk, the second step's versions of the mesh's two sides differed
  from a cleared engine's.
- **A collision control:** a box with the Move's own prefix (`mc:x`) sends the Move to `write` at
  once (no fall-back), while the Scale and the Mirrors keep their views. This shows the check
  fires; `mc:x` is not an ID the Move would pick, so it is no collision itself.
- **Counters:** an edit of a box outside every view evaluates it and the cut; an edit of a copied
  box evaluates it, the Move copying it with another, the Mirrors of it, and the cut.
- **The answers for features:** Mirror and the three patterns answer `view` for bodies and `write`
  for features.
- In `recompute/view-access.test.ts`, a probe whose result adds a body after its view now keeps
  the view (evaluated once) and equals `write`; a probe that puts a new body before its view's
  bodies falls back.

**Not covered** by a test (by reading only): a thread whose cut splits its body (no design small
enough for the time budget); a mirror's join whose fused result splits; the fall-back of a mesh
piece `splitSolids` splits off; a path pattern of bodies in a seeded design (it shares the other
patterns' code; its answer is tested); previews; joints, annotations and sheets.

**Taken out, one at a time** (the source changed, the filtered tests run, the source restored;
every change failed at least one test):

| Taken out | Tests that failed |
|---|---|
| `hasOwnBodies` in the view's choice | the collision control |
| an outside ID refused | the probe that replaces a body outside the view |
| a new ID before the first view body refused | the `lead` probe |
| the view's order checked | the `reorder` probe |
| the mesh fall-back (never `write`) | the mesh split |
| the mesh term (any piece of the last view body with a body outside the view after it: `write`) | the seeded splits, Combine cuts and joined patterns, and their placements |
| the `origins` term (pieces of the last view body at the end) | the seeded splits, Combine cuts and joined patterns, their placements, the order, the mesh split |
| pieces after their body (dropped) | the seeded splits, Combine cuts and joined patterns, their placements, the order, the mesh split |
| the mesh fall-back remembered (its key into `#readsBodies`) | the mesh split (its second step's versions) |
| Move's copy as `write` | the seeded copies, their placements, the counters |
| Scale's copy as `write` | the copies' placements, the collision control, the counters |
| Mirror's copy as `write` | the copies' placements, the collision control, the counters, the answers for features |
| Mirror's `objects` term (features as `view`) | the answers for features |
| the patterns' opt-in (`write`) | the seeded patterns and joined patterns, their placements, the answers for features |
| the patterns' `objects` term (features as `view`) | the answers for features |
| Split Body's opt-in (`write`) | the seeded splits, their placements, the mesh split |

**Test time** (on one machine, each file's own time, run with the other `view-access` files):
`view-access-new-bodies.test.ts` 38.1 s, new; `view-access.test.ts` 165.8 → 167.8 s (the probe
that keeps its view); Move 5.6 → 5.3 s, Scale 1.5 → 1.4 s and Mirror 2.4 → 2.2 s (their copy edits
now viewed); 368.5 → 408.2 s for the twelve files, +39.7 s.

**From scratch** (ad hoc, a script outside the repository): the 64 designs in `fixtures/`'s
`benchmarks`, `examples`, `demos`, `components` and `sheets` folders with main's engine and this
one give the same body IDs, meshes bit for bit, statuses, reports, `inspect` of every body and
number of evaluations. Versions differ in two: b10 (a pattern of bodies) and the lid box in
`components` (Split Body); a version is the key that made the body. The feature goldens are
unchanged. Every feature of those designs, the fastest of four runs each, main → this:
10,636 → 10,628 ms over 180 features; the largest increase of one feature +0.7 ms.

**Measured** ad hoc, with scripts outside the repository, on one machine. Kernel time and meshes
sent for an edit of the first, a middle and the last of 20 plates (200 × 120 × 5 mm, 30 holes;
the edit its distance to 6 mm), incremental with `have`, in Node, two runs each, main → this. Each
plate copied 10 mm up by a Move; patterned along Z (2 instances, 10 mm apart); or split by a
construction plane through it, offset from YZ.

| Design | Edit | Evaluated / meshes sent | ms |
|---|---|--:|--:|
| 20 plates, copied | first | 21/21 → 2/2 | 2,433, 2,444 → 173, 174 |
| | middle | 12/12 → 2/2 | 1,363, 1,366 → 171, 173 |
| | last | 2/2 → 2/2 | 175, 174 → 178, 179 |
| 20 plates, patterned | first | 21/21 → 2/2 | 2,562, 2,138 → 158, 158 |
| | middle | 12/12 → 2/2 | 1,195, 1,236 → 158, 157 |
| | last | 2/2 → 2/2 | 156, 157 → 166, 157 |
| 20 plates, split | first | 21/40 → 2/2 | 4,368, 4,214 → 261, 247 |
| | middle | 12/22 → 2/2 | 2,866, 2,331 → 239, 241 |
| | last | 2/2 → 2/2 | 238, 240 → 242, 242 |

In the app (the 20 copied plates as a file, production build, Chrome, 1280 × 800, 4 interleaved
runs: median and range, ms, main → this), until the model is ready: committing an edit of the
first plate in its dialog 2,304 (2,272–2,343) → 291 (282–299); undoing it 322 (320–324) → 320
(320–321); opening the design 2,314 (2,278–2,473) → 2,356 (2,240–2,555). The page's blocked time:
commit 0 → 0, undo 0 → 0, open 600 (574–653) → 590 (570–647).

## Amendment 2026-11-27: `read` features keyed by the bodies their references name

**Decision.** A `read` feature (a sketch on a face or with projections, a construction plane,
axis or point on a face, edge or vertex, a canvas on a face) gets the view a `view` feature gets:
`#viewOf` gives it the bodies its references name, its key holds their versions instead of every
body before it, and a look-up outside them, a reference resolved other than by its exact name, or
an error to try again once the bodies change makes it run keyed by every body before it, now and
whenever the same view key comes again while `#readsBodies` still holds it (that memory is
bounded, least recently used out first). When no view can be worked out (a reference of
another kind, one no body has by its exact name, an isolated expansion) it is keyed by every body
as before. A sketch's projections are references for the view, as `featureDependencies` already
takes them for its upstream features.

**Why this form.** Three were open: a new answer (`readView`), `view` with a result that changes
no body, or the engine applying the view to `read` itself. The last is the smallest: no feature
changes its answer, the view, its key, the noticed look-ups and the fall-back are the ones `view`
features use, and a `read` result has no bodies, so none of the merge and placement rules
(`fitsView`, `placedAsWrite`, `mergeInPlace`) apply and `bodiesKey` doesn't move. A new answer
would need every `read` feature to opt in again and the same engine code; `view` with no result
bodies would put a feature that changes no body under the rules for those that do. The engine
change: `read` next to `view` where the view is looked up, and the projections in `#viewOf`
(10 lines of code added and 3 removed, comments aside).

**What no longer holds.** "Only `read` and `write` put the body-set key into their own key"
(Decision 2): a `read` feature with a view keys its view's versions. In the amendment on `add`
access, "a sketch on a face is fine as an upstream feature: its key holds the bodies": its key holds
the versions of the bodies its references name (it is still fine as an upstream feature). In the
amendment on the shell and the others, "a construction plane built on a face of a body answers
`read`, so its key moves with every body-writing feature before it": it moves with that body's
version. In the amendment on picked-body features, "every `read` feature after an edited body runs
again too (its key holds every body before it)": only those whose references name the edited body
do. This amendment replaces those.

**What each reads** (audited for this change; file:line, `features/`). Every read of a body is
through a reference the view holds; everything else is upstream (`ctx.output`) or the feature's
own inputs.

| Feature | Answers `read` for | Reads | Under the view |
|---|---|---|---|
| Sketch (`sketch.ts`) | its plane a face, or any projection (:178–182) | the plane: a face resolved by name and described (`sketchFrame`, :258, :259), a construction plane's output (`planeOf`, :272; `ctx.output`); each projection (`projectAll`, :285): an edge or vertex resolved (:342, :348), a face resolved with its body's names (:366–:368), a body by its `body` reference's ID (`bodyShape`, :495, for `projectBody` and the intersection) with its names (:515, :516), a face's centre (:487), an intersection with a face (:552) or a body (`sectionWithPlane`, :546), a point or axis through its construction feature (`pointOf`, `lineOf`, :357, :360), a sketch entity or a whole sketch through `ctx.output` (:394); the sketch data itself | the plane's body and every projected body; a point, axis or sketch entity passed over (upstream); a whole-sketch projection (`feature` reference) gives no view: keyed by every body |
| Construction plane, axis and point (`construction.ts`, 13 types, :85) | a face, edge or vertex among their references (`usesBodies`) | their references only: `planeOf`, `lineOf`, `pointOf` (`references.ts:72`, :102, :155: a face, edge or vertex resolved, a construction or sketch one through `ctx.output`), `ctx.resolve` of a face, edge or vertex and `describe` of it (`construction.ts:326`, :455, :477, :508, :518, :553, :631, :671, :678, :734), a path (`pathFromRefs`, `pattern-path.ts:152`: edges resolved, sketch curves through `ctx.output`) | the bodies of their faces, edges and vertices |
| Canvas (`canvas.ts`, :41) | a face as its plane | `planeOf` of its plane (:61); the image is the feature's own input, not read | the face's body |

No other feature in the app's registry answers `read` (the test-only probe of `recompute/testing.ts`
does, and gets views too). A sketch on an origin plane whose only projections are axes, points or
sketch entities answers `read`, gets no view (none of its references names a body) and stays keyed
by every body: sound, slower than needed. No evaluator above iterates the bodies, asks their number
or looks one up other than through a reference (`bodyShape`'s `ctx.bodies.get` takes a `body`
reference's ID, which the view holds). Nothing is computed for the screen from other bodies during
an evaluation: snapping and silhouettes in the app come from the meshes it was sent.

**Downstream.** A feature that takes a `read` feature's output (an extrude of a sketch's profile, a
`view` feature's passed-over `plane`, `axis`, `point` or `sketchEntity` reference) has its key as
an upstream key, as before. A chain of features none of which is `write` (a sketch on a face, a
New Body extrude of it, a fillet of that body) is left alone by an edit of a body none of them
names; a cut from the sketch is `write` and still keyed by every body before it.

**The proof** (`recompute/view-access-read.test.ts`; real OCCT and manifold, strict leaks, no
clock, a fixed seed, 10 mm boxes). The reference engine of every differential now turns `read`
into `write` as well (`allWrite`, `recompute/add-access-test-support.ts`): keyed by every body
before it, what `read` was. Boxes nothing refers to before the feature (`o0`), between the face's
box and the feature (`o1`) and after it (`o2`).

- **Designs:**
  - a sketch on a box's top face, a New Body extrude of its circle, a fillet of that body's rim;
  - a construction plane over a box's top face with a sketch on it and a New Body extrude of
    that, a canvas on the face, an axis along the box's edge and a box moved about the axis.
- **Seeded edits** (28 and 24), at every step equal to a cleared engine (versions and `measure`
  boxes too) and to the reference engine (all but versions), no fall-back:
  - the reference to a face no body has, and back; no plane, and back;
  - the face's box, the box before, between and after, each 10 mm → 12 mm and back;
  - the sketch's circle 3 mm → 2.5 mm and back; a projection of another box's edge added, and
    taken out;
  - the generic edits (insert, length, suppress, marker, reorder, delete, undo, parameter).
- **Counters:**
  - a box before, between or after: that box alone, its mesh alone;
  - the face's box: the box, the sketch, the extrude and the fillet; their two meshes;
  - a cut from a sketch on a face: a box before it runs the box and the cut, not the sketch;
  - construction: a box before runs alone; the face's box runs the plane, the sketch on it, the
    extrude from that, the canvas, the axis along its edge and the move about it.
- **Never stale**, one test each (each step equal to a cleared engine, versions included): the
  face's box taller (the face keeps its name, the sketch's plane rises); the box whose edge the
  sketch projects wider; the face's box replaced by a Move's body of the same ID before the sketch
  (a version of its own). Each runs the sketch, the extrude and the fillet again.
- **A face found only by a related name** (a slot through the box before the sketch splits its
  top face): no view, keyed by every body, the same result; a box nothing refers to then runs it.
- **A body projected and a body intersected** (a sketch on a face projecting a 20 mm box whole and
  cutting through it: `bodyShape`, the one look-up by ID in a `read` evaluator): an edit of that
  box runs the sketch, and its report changes; an edit of a box nothing refers to runs that box
  alone. Every step equals a cleared engine and the reference.
- **A whole sketch projected** (a `feature` reference): no view; a box nothing refers to runs it.
- **Twin bodies with the face's exact name:** both are in the sketch's view; an edit of the other
  twin runs the sketch, an unrelated box doesn't.
- **A `read` feature that looks outside its view** (a test-only feature that resolves its face
  and looks up a body no reference names): noticed and evaluated keyed by every body; then
  remembered, so an edit of that body runs it once with no view tried, and the step after takes it
  from the cache. Every step equals a cleared engine and the reference.
- The move's and the draft's counters (`view-access-move.test.ts`, `-draft`) now show the
  construction axis, the sketch on a face and the construction point left alone by a box nothing
  refers to.

**Taken out, one at a time** (the source changed, the filtered tests run, the source restored;
every change failed at least one test):

| Taken out | Tests that failed |
|---|---|
| `read` next to `view` where the view is looked up | all thirteen of the file |
| a sketch's projections in `#viewOf` | the seeded sketch design, the three never-stale cases (their sketch projects another box's edge: a look-up outside the view, a fall-back), the body projected and intersected |
| the view's versions out of the key (IDs only) | both seeded designs, both counters of the chains, the three never-stale cases, the body projected and intersected, the twins |
| only the first body with a face's exact name in the view | the twins |
| a noticed look-up not remembered (`#readsBodies`) | the `read` feature that looks outside its view |
| the sketch's `read` answer for a face as `write` | the seeded sketch design, the sketch counters, the cut counter, the three never-stale cases, the related name |
| the construction features' `read` answer as `write` | the seeded construction design, the construction counters |
| the canvas's `read` answer as `write` | the construction counters |
| `resolve` other than by exact name not noticed | the `view` probe of a reference found by its fingerprint (`view-access.test.ts`), the same rule for both |

**Not covered** by a test (by reading only): a construction point on a path and a plane along a
path (`pathFromRefs`), and the face intersection and face-centre projections (they resolve their
references like those tested); a reference found by its fingerprint only (the same noticed
`resolve` as a related name); a `read` feature inside a script's expansion that isn't isolated;
previews.

**Test time** (on one machine, under load from other work): `view-access-read.test.ts` 7.1 s, new,
run with the other `view-access` files (6.1 s alone, its thirteen tests; the four added last, the
body projections, the whole sketch, the twins and the probe, take 0.6 s of it); Move 4.9 s and the
draft 5.1 s (their counters changed, not their designs); the thirteen `view-access` files 414.9 s,
the twelve before 408.2 s, so +6.7 s, and about +7.3 s with the last four.

**From scratch** (ad hoc, a script outside the repository): the 64 designs in `fixtures/`'s
`benchmarks`, `examples`, `demos`, `components` and `sheets` folders with main's engine and this
one give the same body IDs, meshes bit for bit, statuses, reports, `inspect` of every body and
number of evaluations. Versions differ in one, b2: its sketch on a face (with projections) is keyed
by its view, and the cut from it holds that key upstream. The feature goldens are unchanged. Every
feature of those designs, the fastest of four runs each, main → this: 10,642 → 10,719 ms over 180
features, 68 ms of it b9's 6.2 s thread (which this change doesn't reach; its runs spread by about
±100 ms on that machine), +9 ms for the other 179.

**Measured** ad hoc, with scripts outside the repository, on one machine running other work. Kernel
time and meshes sent for an edit of the first, a middle and the last of 20 plates (200 × 120 × 5
mm, 30 holes; the edit its distance to 6 mm), incremental with `have`, in Node, two runs each,
main → this. On each plate's top face a sketch of one 8 mm circle between holes, and a 2 mm cut
from it; or a construction plane on that face (offset 0 mm) with the sketch on it; or the sketch
and a 2 mm New Body extrude instead of the cut.

| Design | Edit | Evaluated / meshes sent | ms |
|---|---|--:|--:|
| 20 plates, a sketch on the face and a cut | first | 41/20 → 22/20 | 2,648, 2,664 → 2,647, 2,651 |
| | middle | 23/11 → 13/11 | 1,482, 1,503 → 1,489, 1,481 |
| | last | 3/1 → 3/1 | 181, 179 → 178, 176 |
| 20 plates, a plane on the face, a sketch on it, a cut | first | 61/20 → 23/20 | 2,635, 2,639 → 2,631, 2,626 |
| | middle | 34/11 → 14/11 | 1,502, 1,483 → 1,476, 1,471 |
| | last | 4/1 → 4/1 | 178, 177 → 178, 177 |
| 20 plates, a sketch on the face and a New Body extrude | first | 41/21 → 3/2 | 136, 139 → 76, 71 |
| | middle | 23/12 → 3/2 | 106, 107 → 70, 72 |
| | last | 3/2 → 3/2 | 72, 74 → 75, 74 |

The sketches and planes no longer run again; a cut does (`write`, keyed by every body before it),
and its time is nearly all of the edit's, so the time barely moves where a cut follows.

In the app (the 20 plates with a sketch and a cut as a file, production build, Chrome, 1280 × 800,
4 interleaved runs: median and range, ms, main → this), until the model is ready: committing an
edit of the first plate in its dialog 2,530 (2,528–2,536) → 2,534 (2,527–2,543); undoing it 323
(322–323) → 322 (321–322); opening the design 2,024 (1,682–2,327) → 1,706 (1,666–2,127). The
page's blocked time: commit 0 → 0, undo 0 → 0, open 450 (406–582) → 467 (413–473).

## Amendment 2026-11-27: operations keyed by the bodies they change

**Decision.** Two kinds of extrude that join, cut or intersect bodies are no longer keyed by every
body before them.

- **Picked bodies, cut or intersect** answer `view` (`cutsPicked`, `features/extrude.ts:106`): the
  picked bodies are `body` references, and nothing else of the bodies is read. A sketch's
  `profile` reference is now passed over by `#viewOf`, like a `sketchEntity`: it is that sketch's
  output (`ctx.output`), whose key is upstream.
- **Automatic participants** (no bodies picked), join, cut or intersect, every side by a distance,
  every profile a sketch's, answer `touch` (`touches`, `features/extrude.ts:123`), a new
  `BodyAccess`: keyed by the bodies the tool touches. The engine keeps each such feature's tool by
  its tool key (type, ID, inputs, values, upstream keys: everything but the bodies, `#touched`),
  with the participant test's answer per body version, and on a later walk asks the test again
  only of bodies whose version it hasn't asked this tool about (`#touching`: `touchingBodies`
  itself, on just those bodies). The bodies touched, in walk order, are the feature's view: key,
  `BodyView`, merge in place and every placement and new-body rule of the `view` amendments, as
  for a `view` feature. The first walk (no tool kept) evaluates with every body, reads the touched
  bodies from the result (`FeatureOutput.touched`, set by `operate`), and keys and cuts down its
  result as if it had had that view (the `rekey` of `#evaluate`), which is what a cleared engine
  does too, so versions agree.

**Why this form.** Three options were weighed (the plan in the private folder): every body's box in
the key (a facade call per body per walk, and a new key on every box change, even one that still
misses); asking the bodies again against the kept tool (built); and splitting each operation's
evaluator into a tool step and an operation step (a new evaluator API for every operation
feature). The second needs no change to results and no facade change: `touchingBodies`, the boxes
and the distances exist; per walk it costs one look-up per body, and a box (and for a near body an
exact distance) only for a body with a new version, once per tool. The engine change is 105 lines
of code added and 5 removed, comments aside (both kinds together).

**Asking again is the feature's work.** The engine reports the feature (`onFeature`) before it asks
the bodies again, so a Stop or a crash there names it (ADR-0155); the recomputer keeps a feature
reported twice at its first start. An ask that fails (an exact distance, a mesh conversion) keeps
no tool: the feature is evaluated with every body, as at first, and fails there with the error a
cleared engine shows, the rest of the design computed; a WASM abort still ends the walk. Answers
are stored only after the whole ask, so none from a failed one. No `touch` key while a body before
the feature has no version (a shape another output holds, such as a profile face reused as a
body): the feature keeps today's key and its cache hit. When an evaluation with every body, keyed
again, finds its result's entry already in the cache, `#evaluate` hands that entry back, and the
walk doesn't count it as its own to drop.

**What "unchanged" means.** A `touch` cut is kept while the bodies it touches come out unchanged
(their versions). A body made or changed by a `write` feature (a revolve, sweep, loft, hole, emboss,
rib, a picked join, a cut through all) gets a new version after any earlier edit, so a cut on it
runs again then, as before.

**Why it can't be stale.** The result of an automatic operation is a function of the tool, of the
bodies it touches (which, in what order, their shapes and names) and of the map it changes in
place.
- The tool is a function of the tool key alone for these inputs: profiles from sketches (their
  keys are upstream; a sketch on a face keys its body's version since the `read` amendment),
  distances; `through-all` and `to-object` (they measure every body, `throughAll`,
  `features/extrude.ts:575`–583, `objectSide`, :531) and face profiles (the tool is made of that
  body's face) stay `write`.
- The bodies touched are what `touchingBodies` returns, a function of (body shape, tool shape) per
  body; a version names one shape, so an answer kept for a version holds for good, and a body with
  a new version is asked again.
- Their versions, in walk order, are the key; the bodies outside stay in their places.
- Errors and warnings ("doesn't touch any body", "doesn't remove anything", "removed a whole
  body", "nothing to join to, so it made a new body") come from the bodies touched alone; an
  evaluation that fails keeps today's key (no tool, nothing kept).
- A tool whose entry the cache let go is not asked again (the kept entry must still be the cache's
  under its key): the next walk evaluates with every body, as at first.
- A body with the feature's own ID prefix, an isolated expansion, or a key remembered as reading
  outside its view: `write`, as for `view`.

**One rule changed for every view:** a result of a view with no bodies may hold new bodies; they go
at the end, as under `write` (`fitsView`: "a new body before the first view body" applies only
when the view has one). It is how a join that touches nothing makes its new body.

**What each reads** (audited for this change; file:line, `features/`):

| Path | Reads | Under the key |
|---|---|---|
| `explicitBodies` (`operation.ts:93`) | `has` of each picked body | picked: the view |
| `operate` (`operation.ts:129`) | `touchingBodies` (:149; :310: every body's box against the tool's, then the exact distance, `bodiesTouch` :51, of the near ones), not asked for a picked cut or intersect; each target's shape and names (:165, :166); a copy of the map changed by `set`/`delete` of targets (:203, :268); a new body from a join that touches nothing (`newBodies`, :338) | the bodies touched (or picked): the view; the test itself asked again by the engine |
| the extrude's tool (`extrude.ts`) | the profiles (`baseOf`, :282: a sketch's through `ctx.output`, `sources.ts:89`, :123; a face resolved by name, `sources.ts:153`, for a face profile: `write`), `centroidOf` (:284), the sides (:286: distances; `through-all` measures the picked bodies or every body, :575–583; `to-object` sizes its target from every body, :531, and resolves its object, :493), `sweep` (:287) | distances and sketch profiles: nothing of the bodies |
| `splitSolids` (:300) | as in the amendment on new bodies | pieces right after their body |

**What no longer holds.** In the amendment on `add` access, "everything else is `write` as before:
join, cut and intersect, picked bodies": a cut or intersect of picked bodies answers `view`, and a
join, cut or intersect with automatic participants by distances `touch`. In the amendment on
`view` access, "the cut through the overlapping plates is `write` and reads the fillets": it is
`touch`, keyed by the plates it touches. In the amendment on `read` features, "a cut from the
sketch is `write` and still keyed by every body before it" and "a cut does (`write`, keyed by
every body before it)": it is keyed by the bodies it touches. This amendment replaces those.

**Not in** (still `write`): a join of picked bodies (its report lists every body the tool touches,
part of the result); `through-all` and `to-object` with automatic participants; face profiles;
the other operation features (revolve, sweep, loft, coil, primitives: the same shape of evaluator,
each needs its tool audited; hole, emboss and rib search the bodies themselves).

**The proof** (`recompute/view-access-operation.test.ts`; real OCCT and manifold, strict leaks, no
clock, fixed seeds, 10 mm boxes). The reference engine of every differential turns `touch` into
`write` as well (`allWrite`), so every differential with a cut (the slot cuts of the earlier
designs) now also compares `touch` with today's keys.

- **Designs:**
  - picked: boxes `o0`, `b1`, `o1`, `b2`, `o2` and a 2 mm slot through all of them cut out of `b1`
    and `b2` only (each in two), `o1` in its way;
  - automatic: boxes `o0` before, `fb` (the slot cuts it in two), `o1` between, the slot cut,
    `o2` after.
- **Seeded edits** (24 each), at every step equal to a cleared engine (versions and `measure` boxes
  too) and to today's keys (all but versions), no fall-back:
  - picked: a body that doesn't exist, and back; no bodies (automatic), and back; a body picked a
    second time, and back; the operation cut → intersect → join → new body → cut; the extent
    distance ↔ through all;
  - automatic: the cut box, the boxes before, between and after, each 10 → 12 mm and back; the box
    between moved into the slot's way and out; the operation cycle; the extent toggle;
  - the generic edits (insert, length, suppress, marker, reorder, delete, undo, parameter).
- **Each way the bodies a tool touches can change**, one test each, every step equal to a cleared
  engine and to today's keys, with exact evaluations:
  - a box whose box misses the tool's, made larger and smaller: it alone;
  - a box whose box meets the tool's but that the tool doesn't touch (the exact distance
    decides), larger and smaller: it alone;
  - a box comes to touch the tool (the cut runs with it), and goes elsewhere (the box alone, the
    cut's first result from the cache);
  - the box it touches moves away (the cut touches nothing: its error), and back;
  - the box it touches changes and still touches (box and cut); the tool changes (the cut);
  - a body added before it in the tool's way (it and the cut), and taken out (nothing);
  - a join of two boxes in the other order: the other keeps its ID; then a box nothing touches
    alone;
  - a join that touches nothing makes a new body at the end; then a box comes to it;
  - a tool whose cache entry was let go (two entries at most) is not used again: the cut runs with
    every body, as at first;
  - a cut from a body's face is keyed by every body: an edit of that body runs it.
- **Counters (picked):** a box not picked runs alone; a picked box runs the cut.
- **The answers:** `touch` for automatic join, cut and intersect by distances; `view` for a picked
  cut; `write` for a picked join, `through-all`, `to-object` and a face profile; `add` for a new
  body.
- The earlier counters that ran a cut after every body (`view-access-read.test.ts`'s cut from a
  sketch on a face, `view-access-new-bodies.test.ts`'s viewed lists) now show the cut kept.

**Taken out, one at a time** (the source changed, the filtered tests run, the source restored;
every change failed at least one test):

| Taken out | Tests that failed |
|---|---|
| `touch` used at all (the tool key) | both seeded designs (the picked one's "no bodies" step is `touch`), five of the touched-set tests (the two boxes that miss, comes to touch, the join in the other order, the join that touches nothing), the evicted tool |
| answers by body version (by ID instead) | the seeded automatic design, comes to touch, the join that touches nothing |
| bodies with a version not yet asked asked again (never asked) | the seeded automatic design, comes to touch, the touched box changes, a body added, the join that touches nothing |
| the touched bodies in walk order in the key (sorted) | a body added before, the join in the other order |
| their versions in the key (IDs only) | the seeded automatic design, the picked counters, and eight of the touched-set tests (all but the evicted tool and the face-profile cut) |
| the first walk keyed by the bodies it touched (no `rekey`) | the same eight as `touch` taken out: no tool is ever kept |
| the kept entry still the cache's (identity) | the evicted tool |
| sketch profiles only (`touches`) | the face-profile cut (its tool kept from before its body changed), the answers |
| distances only (`touches`) | the seeded automatic design (the extent toggle), the answers |
| automatic only (`touches`: a picked join as `touch`) | the answers |
| cut or intersect only (`cutsPicked`: a picked join as `view`) | the seeded picked design, the answers |
| `profile` passed over | the seeded picked design, the picked counters |
| a failed ask turned into an evaluation with every body (no `catch`) | a failed ask (the walk rejected) |
| the feature reported before the ask | the report order |
| no `touch` key while a body has no version | the body without a version (a full evaluation every walk) |
| the tool memory by tool key (by feature ID instead) | back to an earlier tool (its versions) |

Not caught, by reading only: `made` left true when `#evaluate` hands back an entry already there.
It matters only if that entry then failed its view (`misfit`, a noticed read), which no extrude
result can: the entry passed the same checks when it was made.

**Failure paths, tested:** an ask that fails (`Kernel.distance` made to fail for one
box): the cut's error as a cleared engine's, the other features computed; back, the cut runs with
every body and gets its first result from the cache; the failing box again, the error from the
cache. The feature is reported before its exact distance is asked. A body before it without a
version (a test feature whose body is a sketch's profile face): a walk with nothing changed
evaluates nothing. Back to an earlier tool while its memory lives: its own answers (a box the
deeper cut reaches and the shallower doesn't), nothing evaluated.

**Not covered** by a test (by reading only): a mesh tool or target in a `touch` cut (the same
`touchingBodies`, `minGap` for a pair with a mesh); a tool of several solids (a pattern's; the
extrude makes one sweep); a preview walking between two recomputes (the memory is shared, keyed by
tool and checked against the cache like a recompute's); a `touch` extrude inside a script's
expansion (an isolated one is `write`, `scope === undefined`; a non-isolated one walks as the
document's features do); a WASM abort during the ask; `made` as above.

**Test time** (on one machine, under load from other work): `view-access-operation.test.ts`
9.8 s, new, run with the other `view-access` files (8.5 s alone with the tests of the failure
paths, +1.2 s for those); those files 423.5 s, about +9 s in all.

**From scratch** (ad hoc, a script outside the repository): the 64 designs in `fixtures/`'s
`benchmarks`, `examples`, `demos`, `components` and `sheets` folders with main's engine and this
one give the same body IDs, meshes bit for bit, statuses, reports, `inspect` of every body and
number of evaluations. Versions differ in one, b2, the one design with an extrude cut: it is now
keyed by the body it touches. The feature goldens are unchanged. Every feature of those designs,
the fastest of four runs each, main → this: 10,670 → 10,693 ms over 180 features, 25.8 ms of it
b9's 6.2 s thread (which this change doesn't reach; its runs spread by about ±100 ms on that
machine); b2's cut 6.3 → 6.3 ms.

**Per walk** (110 bodies: 100 plates and one slot through a row, in Node, two runs): a walk with
nothing changed 12.5 → 12.0 ms (median of 10; fastest 7.8 → 8.0 ms), so no measurable cost of the
key; an edit of a plate the slot doesn't touch 205 → 13 ms (the cut no longer runs).

**Measured** ad hoc, with scripts outside the repository, on one machine running other work. Kernel
time and meshes sent for an edit of the first, a middle and the last of 20 plates (200 × 120 × 5
mm, 30 holes; the edit its distance to 6 mm), incremental with `have`, in Node, two runs each,
main → this.

| Design | Edit | Evaluated / meshes sent | ms |
|---|---|--:|--:|
| 20 plates, a sketch on the face and a 2 mm cut | first | 22/20 → 3/1 | 2,684, 2,671 → 183, 182 |
| | middle | 13/11 → 3/1 | 1,468, 1,479 → 179, 179 |
| | last | 3/1 → 3/1 | 176, 176 → 181, 181 |
| 20 plates, a plane on the face, a sketch on it, a cut | first | 23/20 → 4/1 | 2,628, 2,617 → 193, 180 |
| | middle | 14/11 → 4/1 | 1,466, 1,467 → 188, 176 |
| | last | 4/1 → 4/1 | 176, 176 → 176, 175 |
| 20 plates, a sketch on the face and a New Body extrude | first | 3/2 → 3/2 | 72, 72 → 72, 73 |
| | middle | 3/2 → 3/2 | 66, 66 → 66, 67 |
| | last | 3/2 → 3/2 | 66, 66 → 67, 67 |
| 20 plates, one slot through 5 of them | first | 2/10 → 2/10 | 874, 872 → 906, 893 |
| | middle | 2/11 → 1/1 | 878, 881 → 53, 52 |
| | last | 2/11 → 1/1 | 880, 898 → 54, 53 |

The first plate of the slot design is one the slot touches: the cut runs again either way (+27 ms,
the plate asked again, and noise).

In the app (the 20 plates with a sketch and a cut as a file, production build, Chrome, 1280 × 800,
4 interleaved runs: median and range, ms, main → this), until the model is ready: committing an
edit of the first plate in its dialog 2,528 (2,527–2,534) → 196 (195–203); undoing it 324
(321–324) → 322 (321–323); opening the design 1,820 (1,724–2,078) → 1,818 (1,639–2,198). The
page's blocked time: commit 0 → 0, undo 0 → 0, open 462 (415–475) → 540 (439–628).

## Amendment 2026-11-27: the other operations keyed by the bodies they touch or pick

**Decision.** Every operation feature that goes through `operate` answers by one rule
(`operationAccess`, `features/operation.ts:93`): `add` for a new body with no picked bodies; `view`
for a cut or intersect of picked bodies; `touch` for a join, cut or intersect of the bodies its
tool touches (automatic participants, or a join of picked bodies) when the tool reads no body; else
`write`. A tool that measures every body (a revolve to an object) is `write` whatever it picks.

- **Picked joins** (the extrude's, and every family's) answer `touch`. Their report lists every
  body the tool touches, so the touch test stays; the bodies they pick are added to the view (the
  engine takes the feature's `body` references, `pickedBodies`), so `explicitBodies` finds them,
  and a picked body that isn't there keeps today's key (the feature's error). `operate` now sets
  `touched` for a join of picked bodies too, also when it touches none of them (a new body).
- **Revolve, sweep, loft, coil, primitives** answer through `operationAccess`, each with when its
  tool reads no body (the conditions their `add` answers already had).
- **The evaluator takes the engine's answers.** With a kept tool, the engine hands the evaluator
  what it asked that tool of each body version (`EvalContext.touched`); `touchingBodies` takes those
  answers instead of asking again (the same tool key builds the same tool, a version is one shape).
  Without it, a touched body that changed was asked twice (by the engine, then by the evaluator):
  measured on 20 plates with a coil cut each, an edit of the last plate went 850 → 1,244 ms.

The engine change for this amendment: 27 lines of code added and 5 removed, comments aside (the
picked bodies in the view, and the answers handed to the evaluator). No facade change, no change to
results.

**What each reads** (audited for this change; file:line, `features/`; what `operate` reads is in
the amendment on operations):

| Feature | The tool reads | `touch` when | `view` (picked cut, intersect) |
|---|---|---|---|
| Revolve (`revolve.ts`) | its axis: an origin or construction axis or a sketch line (`lineOf`, :280), or an edge resolved (:286); its profiles (`baseOf`: a sketch's through `ctx.output` or a face resolved); an angle, or `to-object`, which sizes its target from every body (`sweepToObject`, :509, :533) | an angle, the axis an `axis` or `sketchEntity`, every profile a sketch's | not `to-object` (an edge axis or a face profile is in the view by its reference) |
| Sweep (`sweep.ts`) | its profiles (`baseOf`, :100); its path: sketch curves through `ctx.output` (:238) or edges resolved (:228) | every profile a sketch's, the path sketch curves | always |
| Loft (`loft.ts`) | its sections: profiles through `ctx.output` (:135), points (`pointOf`, :125: a construction point upstream, a vertex resolved), faces | every section a profile, point or sketch entity | always |
| Coil (`coil.ts`) | its placement (`planeFrame`, :205: an origin or construction plane, or a face resolved, `primitives.ts:279`) | on a plane | always |
| Primitives (`primitives.ts`) | as the coil (`planeFrame`, :263, :277–295) | on a plane | always |

Each then calls `explicitBodies` (:261, :107, :94, :165, :121), `operate` (:266, :113, :99, :170,
:126) and `splitSolids`. No evaluator above reads the bodies otherwise.

**Not in** (still `write`): hole, emboss and rib (they read the bodies themselves), `through-all`
and `to-object` with automatic participants, and any tool built on a body's face, edge or vertex
with automatic participants or a picked join (the tool key holds no body; the plan in the private
folder weighs a tool key with the referenced bodies' versions for those).

**What no longer holds.** In the amendment on operations, "a join of picked bodies stays `write`"
and its "Not in" list's revolves, sweeps, lofts, coils and primitives: they answer as above.
This amendment replaces those.

**The proof.** Shared with the extrude (one code path for every family: the touch test asked
again, the key, the view, a failed ask, an evicted tool, the order and version terms, the report
before the ask), tested once in `recompute/view-access-operation.test.ts`. Per family, in
`recompute/view-access-operations.test.ts` (real OCCT and manifold, strict leaks, no clock, a
fixed seed): one small design each, a box `fb` its tool cuts, a box `o1` 20 mm off that `nudge`
moves into the tool's way, boxes before and after.

- **Seeded edits** (18 each; the revolve, sweep, loft and box cut; the coil's left out for time, its
  answer the same `operationAccess`): the cut box and the boxes before and after 10 → 12 mm and
  back; the box between moved into the tool's way and out; the operation cut → intersect → join →
  new body → cut; the generic edits. At every step equal to a cleared engine (versions included)
  and to today's keys, no fall-back.
- **Counters** (each of the five): a box nothing touches runs alone; the cut box runs the cut; a box
  come into the tool's way runs the cut; gone somewhere new, the cut's first result from the cache.
- **A picked revolve cut** is keyed by the bodies it picks: a box in its way but not picked runs
  alone.
- **The answers:** for each family, `touch`, `view`, `write` and `add` for the inputs above.
- **A box cut placed on a body's face** keeps every-body keys: moving that body moves the tool into
  another box's way.
- **Picked joins** (`view-access-operation.test.ts`): a seeded design (24 edits: a body that doesn't
  exist and back, no bodies and back, a body picked twice and back, the cut box and the box before
  resized, the box it touches but doesn't pick moved in and out, the operation cycle, the generic
  edits); counters (a box nothing touches alone; a box come into the slot's way runs the join and
  is listed in its report, not joined; the picked box moved off: a new body and its warning); the
  picked box suppressed: the join's error, as a cleared engine's, no fall-back.
- **The answers handed over:** a touched box made taller is asked its exact distance once (by the
  engine); the cut run again takes that answer.

**Taken out, one at a time** (the source changed, the filtered tests run, the source restored):

| Taken out | Tests that failed |
|---|---|
| the picked bodies in a `touch` view | the picked-join counters (a look-up outside the view: a fall-back) |
| a picked body missing keeps today's key | the picked box suppressed (a fall-back) |
| a join of picked bodies as `touch` (`touches`) | the seeded picked join, the extrude's answers, the picked-join counters |
| `touched` set for a join of picked bodies | the seeded picked join, the picked-join counters (versions) |
| `touched` set for a join that touches none of its picked bodies | the join that touches nothing (versions) |
| `view` for a picked cut or intersect (`operationAccess`) | the picked revolve cut, the answers |
| `touch` at all (`operationAccess`) | the four seeded families, the five counters, the answers |
| the revolve's axis term; its profile term; its `to-object` term | the answers |
| the sweep's path term; the loft's sections term; the coil's plane term | the answers |
| the primitives' plane term | the answers, the box cut on a body's face (stale: its tool kept from before the body moved) |
| the answers handed to the evaluator | the report-order test (the exact distance asked twice) |

Not caught, by reading only: the engine recording the touched bodies (not the view's) as the
tool's answers. The two differ only for a picked body the tool doesn't touch, which is in the view
anyway, so nothing depends on it.

**Not covered** by a test (by reading only): the coil's seeded proof (its counters and answers are
tested); a sweep of a face profile or along edges, a loft through a vertex, a revolve about an
edge, picked (their `view` is the existing rule over their references); mesh bodies; a tool of
several solids (a pattern's); previews.

**Test time** (on one machine, under load from other work): `view-access-operations.test.ts`
TT_NEW s, new; `view-access-operation.test.ts` TT_OLD s with the picked joins and the answers
handed over (was 9.8 s).

**From scratch** (ad hoc, a script outside the repository): the 64 designs in `fixtures/`'s
`benchmarks`, `examples`, `demos`, `components` and `sheets` folders with main's engine and this
one give the same body IDs, meshes bit for bit, statuses, reports, `inspect` of every body and
number of evaluations. Versions differ in 17, each with a box or cylinder (or, in the
sweep-loft-coil benchmark, a coil) that joins or cuts, now keyed by the bodies it touches (in the
hinge, a picked join and a picked cut): b4, b5, b6, b7, the sweep-loft-coil benchmark and the
spool holder; the annotate, offset-face, overhang, remove-faces, section, simplify-for-print and
four sheet demos; the hinge component. No fixture has a revolve, sweep or loft that joins or cuts. The feature
goldens are unchanged. Every feature of those designs, the fastest of four runs each, main → this:
10,615 → 10,629 ms over 180 features; the largest increase of one feature +10.1 ms (b9's 6.2 s
thread, which this change doesn't reach; its runs spread by about ±100 ms).

**Measured** ad hoc, with scripts outside the repository, on one machine running other work. Kernel
time for an edit of the first, a middle and the last of 20 plates (200 × 120 × 5 mm, 30 holes; the
edit its distance to 6 mm), incremental with `have`, in Node, two runs each, main → this. Each plate
has: a boss on its top face joined to the plate it picks; a revolve cut (a ring about a sketch line
along the plate, two grooves across it); a sweep cut (a 3 mm circle up a line); a loft cut (a
10 × 8 mm square to a 4 mm one 8 mm up); a coil cut (Ø12, one turn); a box cut (6 × 6 mm).

| Design | First | Middle | Last | Evaluated / meshes, first |
|---|--:|--:|--:|--:|
| a picked join | 2,396 → 172 | 1,336 → 164 | 168 → 168 | 22/20 → 3/1 |
| a revolve cut | 4,585 → 274 | 2,559 → 268 | 270 → 266 | 21/20 → 2/1 |
| a sweep cut | 2,892 → 182 | 1,612 → 176 | 174 → 174 | 21/20 → 2/1 |
| a loft cut | 6,852 → 375 | 3,767 → 392 | 380 → 374 | 21/20 → 2/1 |
| a coil cut | 16,912 → 857 | 9,302 → 849 | 852 → 850 | 21/20 → 2/1 |
| a box cut | 3,296 → 204 | 1,834 → 197 | 199 → 202 | 21/20 → 2/1 |

