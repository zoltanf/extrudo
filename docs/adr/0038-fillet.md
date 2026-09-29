# ADR-0038: Fillet

- **Status:** Accepted, 2026-09-29
- **Task:** P3-01 (fillet; FR-FT-04, FR-UX-06). Code: the facade's
  `fillet`, `tangentChain` and their helpers
  (`packages/kernel/occt/facade/extrudo_facade.cpp`); `Kernel.fillet`,
  `Kernel.tangentChain`, `FilletError` (`packages/kernel/src/kernel.ts`);
  the definition `packages/core/src/fillet.ts`; the evaluator
  `packages/kernel/src/features/fillet.ts`; `KernelApi.tangentChain`
  (`service.ts`, `worker-api.ts`, `browser.ts`, `Recomputer`, the engine);
  the dialog `apps/web/src/features/fillet.ts` and the controller's chain
  following (`features/dialog.ts`, `SelectionField.tangentChain`); the
  Wall bracket template's Fillet1 (`apps/web/src/project/templates.ts`).
- **Builds on:** ADR-0001 (the facade owns OCCT memory), ADR-0005 (edges
  are named after their faces; fillet faces are `fillet:<id>:from:(<edge>)`),
  ADR-0024 (the engine, the shape scope), ADR-0027 (dialog fields, live
  previews), ADR-0033 (`LostReferenceError`, Fix References).
- **Affects:** P3-02 chamfer (same builder family: the diagnosis and the
  chain query carry over), P3-03 shell, P3-04 hole, P3-08 (draft).

## Context

The facade had `fillet(shape, radius)`: staged edge indices, one radius,
`BRepFilletAPI_MakeFillet` on the C++ stack, and a message that guessed
"the radius is probably too large". The Wall bracket's Fillet1 had a
radius and no edges, so it was an error. FR-FT-04 wants several edge sets
with their own radii and tangent-chain selection; FR-UX-06 wants "radius
too large for edge X (max ≈ 2.4 mm)" instead of a kernel error.

Facts about OCCT 8.0.1 that shaped it (read in the sources, then run in
the native harness on the pinned image):

- `BRepFilletAPI_MakeFillet::Add(edge)` builds the whole **contour of
  tangent-continuous edges** around the edge (`ChFi3d_FilBuilder::Add`
  makes a spine of the chain) and does nothing for an edge already in a
  contour. There is no way to round one edge of a tangent chain alone.
  `Contour(edge)` is 0 when the edge can't be added (not between two
  faces); `NbEdges(contour)` / `Edge(contour, j)` list the chain.
- A radius is set per edge of a contour (`SetRadius(r, contour, j)`);
  edges of one chain given different radii make a variable radius that
  jumps at the vertices, which is never what someone meant.
- A failure shows up as `IsDone() == false`, as an exception from
  `Build()`, or as a "done" shape that fails `BRepCheck_Analyzer`. The
  builder's own diagnosis (`NbFaultyContours`, `StripeStatus`) says which
  contour failed but not by how much.

## Decision

1. **Sets are plain inputs.** A fillet has up to 8 edge sets: set 1 is
   `edges` + `radius`, set `n` is `edges<n>` + `radius<n>` (`filletEdgesKey`,
   `filletRadiusKey`, `filletSets`, `filletInputs`; all optional). They
   are ordinary `ref` and `expr` inputs, so the document schema, the file
   format and the migrations don't change (no `docs/file-format.md` edit
   beyond the fact that a `fillet` feature now exists). A set without edges
   is ignored, one with edges needs its radius (a message says so). The
   same edge in two sets with different radii is refused.
2. **Tangent chains: the dialog expands, the kernel rounds.** Because OCCT
   rounds the whole chain, a set is made of whole chains. Picking an edge
   in a `tangentChain` selection field asks the kernel for its chain
   (`KernelApi.tangentChain(body, edge, base)`, facade `tangentChain`) and
   adds every edge of it; unpicking any one removes the chain; a selected
   edge at tool start (pre-selection) gets the same. What the field shows
   is what gets rounded. Edges of one chain given different radii (two
   sets reaching it) fail with "Edges 3 and 8 are one chain of tangent
   edges, so they take one radius".
3. **One facade call builds; failure carries a diagnosis.**
   `fillet(shape)` takes the staged edge indices (`pushArg`) and one radius
   per edge (`pushNumber`), adds them, sets one radius per contour, builds
   with `Build()` inside `try`, and checks the result with
   `BRepCheck_Analyzer`. On failure it returns 0 with the diagnosis in
   `geometryNumbers` (`[status, n, n × [m, edge × m, value]]`), which
   `Kernel.fillet` turns into a `FilletError` with typed `problems`:
   - `too-large`: a chain that fails **alone** at its radius, with the
     largest radius that works, found by bisection from 0 in seven steps
     (within 0.8 % of the radius: the message keeps two digits anyway, and
     a failing build can take a second; a maximum of 0 means nothing down
     to 1/128 of the radius works); every probe is a builder on the C++
     stack.
   - `unfilletable`: `Contour(edge) == 0`.
   - `mixed-radii`: two radii in one chain.
   - `together`: every chain works alone but not all at once (corners
     where fillets meet); the value is the largest factor all radii can be
     scaled by.
   - `other`: an exception with no diagnosis.
   Probing only happens after a failure. Measured in Node on the Ubuntu
   machine: one edge 2 mm on a 10 mm cube 54 ms, the same at 50 mm (fails,
   diagnosed) 90 ms, a 40 × 40 × 2 plate with all 12 edges at 3 mm 330 ms;
   the pathological case, all 12 edges of a cube at 6 mm (every chain
   fine alone, all together colliding), took 10 s with 11 probes, each
   failing build about a second, hence seven steps and no first probe.
4. **Messages are written in the evaluator, not the facade** (FR-UX-06):
   "Radius 50 mm is too large for edge 12 (max ≈ 19 mm)." The maximum is
   rounded **down** to two significant digits, so the number given works
   (a test runs it). Edges count from 1 in the kernel's order, as the
   selection's "Edge 12 · Body1" rows do. When no radius works: "Edge 12
   can't be rounded with radius 5 mm, or with any smaller one." Combined
   failures: "These fillets can't all be built where they meet. Try radii
   up to about 4.1 mm, or fewer edges at once."
5. **Edges are references.** The evaluator resolves every edge with
   `ctx.resolve` (a lost one is a `LostReferenceError`, so Fix References
   and Keep Closest Match work), groups edges by body and fillets each
   body on its own, and names the result with `withHistory`: fillet faces
   are `fillet:<id>:from:(<edge name>)`, other faces keep their names, so
   later features keep their references when a radius changes (tested).
   The feature has `bodyAccess: 'write'` and no preview tools: the preview
   is the rounded body itself.
6. **The Wall bracket template** gets a real Fillet1 with two sets: the
   bend's inside corner with `wall / 2` and its outside corner with
   `wall * 1.5` (concentric, and they follow `wall`). Its edges are named
   after Sketch1's side faces (`edgeName([side, side])` with the ids of
   Extrude1 and the outline's lines), so the template needs no kernel run.
   The body has 12 faces now.
7. **Memory:** the builder is only ever on the C++ stack (the facade's
   probes included); `memory.test.ts` runs 1000 rounds of successful and
   failing fillets with their diagnosis, a chain query and a mixed-radii
   refusal and expects a flat heap and no leftover shapes; the file's
   existing leak control (results kept and meshed) must still trip.

## Rejected

- **A "tangent chain" toggle** that lets you round one edge of a chain.
  OCCT can't (decision above); faking it would mean building our own spine
  or splitting the edge. The dialog shows what will be rounded instead.
  Variable radius (FR-FT-04 "comes later") would need the per-edge laws.
- **A repeating group field in the dialog framework** for edge sets. It
  would have changed `FeatureDialogSpec`, `DialogValues` and the input
  mapping for one feature; eight fixed slots that appear as the previous
  one fills cover the use with the existing field kinds. Eight is a limit;
  raise `FILLET_MAX_SETS` if anyone hits it (extra inputs are a strict-schema
  error for older readers, see `docs/file-format.md`).
- **Trusting `IsDone()`.** Some fillets "finish" with an invalid solid; the
  facade checks with `BRepCheck_Analyzer` and treats that as a failure.
- **Using `NbFaultyContours`/`FaultyContour` to find the failing chain.**
  After an exception the builder isn't fit to ask, and it says nothing
  about how far off the radius is. Rebuilding each chain alone is simpler
  and gives the number.
- **A maximum radius from geometry** (edge lengths, face widths, angle
  between faces). It is wrong at corners and for curved faces; bisection
  on the real algorithm is right by construction.
- **Building OCCT natively on the Ubuntu machine** to prototype the facade
  (tried with zig as the compiler before Docker arrived): about 2500 files
  and a shared CPU; the pinned image's static libraries and `em++` run the
  same harness in seconds.

## Consequences

- P3-02 chamfer can reuse `tangentChain`, `FilletError`-style diagnosis
  and the dialog's `tangentChain` selection option.
- A fillet's UI is a second radius field per set with no on-canvas handle
  yet (no manipulator): a distance arrow can't be placed on a curved
  chain without a normal to draw it along.
- The dialog's preview after a failed radius keeps the last good drawing,
  dimmed (ADR-0027), and the message shows in the dialog.
