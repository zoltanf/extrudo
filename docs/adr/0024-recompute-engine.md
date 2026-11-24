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
and the app-render job see the same messages). Previews don't compare: while a feature is edited
the view shows only the bodies before it (`dialogBodies`), so the later bodies mount again when
the dialog closes, whatever their mesh objects; only what the page keeps by mesh outside the view
(bounds, the pick index) is kept then.

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
