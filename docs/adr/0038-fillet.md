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

## Amendment 2026-10-01: a radius that runs into a wall (P3-17)

The fuzzer (P3-13) found, on benchmark B4, a fillet that **traps OCCT**
(`RuntimeError: null function or function signature mismatch`, no C++
exception to catch). Doubling the lid's round to 3 mm while its lip was
made longer than the lid left the lid's side faces with a 3 mm strip above a
step; a 3 mm round (and 4 and 6 mm, but not 2.99 or 3.001) is exactly the
face's depth there. Run natively in the OCCT image with function names
(`harness.cpp` over the facade, a STEP of the failing body), the trap is
`Geom2dAdaptor_Curve::EvalD1` called from `BRepBlend_SurfRstConstRad::Values`
inside `ChFi3d_Builder::PerformSetOfSurfOnElSpine`: when the round's contact
line leaves a face through a boundary edge in the middle of the edge's run,
OCCT walks the restriction ("Rst") with a `BRepAdaptor_Curve2d` that was
never initialised (`ChFi3d_Builder::StartSol` builds it for the obstacle
and doesn't check the pcurve), and a null handle's virtual call is a call
through a null function table entry. Every edge of the body does have its
pcurves; the shape is valid. A trap is not a C++ exception, so the
facade's `catch (...)` never sees it, and no destructor runs: a worker that
hits it is restarted (`KernelClient`), losing the cache.

**Decision.** The facade refuses the radius **before OCCT runs**
(`filletRollsOff`, in `addFillets`): a round of radius r touches each of the
two faces at `r · tan(turn / 2)` from the edge (turn = the angle between
their normals; r for a right angle), and when a face next to a straight edge
has a straight boundary edge of its own, parallel to it on the face's side
and overlapping its length (`wallBeside`: the far side of a thin strip, a
step or a pocket wall), at or inside that distance, the round has no face to
sit on along that wall. The refusal takes the diagnosis's route
(`explainFillet`, status 1, "Radius 3 mm is too large for edge 10 (max ≈
2.9 mm).") and its bisection probes use the same check (`filletWorks`), so
no probe reaches a radius that traps either; the maximum it finds is the
wall's distance, rounded down to two digits like any other. Only straight
edges between flat faces are checked (curved faces and arcs go to OCCT as
before). OCCT accepts some radii larger than a wall (a 10 mm round on the
same body "succeeds" with a valid but absurd solid); those are refused too,
which is the safer reading of "too large".

Tests: `fuzz.test.ts` "B4 refuses a fillet that runs into a wall instead of
trapping OCCT" (the three fuzzer edits, expects the "max ≈ 2.9 mm" message and
that 2.5 mm still rounds); the memory test's failed fillets pass through
`filletRollsOff` (a 3 mm round of a 2 mm plate). B4 is in the fuzzer's list.

Rejected: a bound from the faces' overall extent (the failing face is the
whole 33 mm wall minus a notch, so its extent says nothing); checking that
the contact line lies inside the face at sample points (a face that narrows
towards the ends of the edge legitimately leaves it there); catching the
trap (`RuntimeError` is not a C++ exception, and the heap may be corrupt).
Still open: a face whose far boundary is slanted or curved, or an edge that
is an arc, can lead OCCT into the same walk unguarded (chamfers use another
builder; 1000-step fuzz runs of B4, which has one, on four seeds found no trap there); the worker restart is the net.

**Another fix in the same pass:** a fillet (and chamfer) of several bodies
kept each body's result as soon as it was built, so a later body that
failed left the earlier ones behind; results are now kept only when every
body worked, like shell and offset face (`fillet.test.ts` "a body that can not
be filleted releases the others").

## Amendment 2026-10-05: 32 sets and a radius handle (P4-12)

P4-12's backlog asked for more than eight edge sets and an on-canvas radius
handle. Both are in, without a facade change.

**32 sets.** `FILLET_MAX_SETS` (and `CHAMFER_MAX_SETS`) is 32. Nothing else
changes: every input beyond the eighth is optional, so a document written
with fewer sets is read exactly as it was, and the inputs are still plain
`ref`/`expr`/`bool`. The cost is the schema's shape (128 keys) — a document
parse measured 0.196 ms with 8 sets and 0.207 ms with 32 (200 parses of a
four-set chamfer document, `loadDocument`), which is where parsing happens
anyway (opening a file).

Why 32 and not, say, 16: a body's edge count is what bounds the useful
number (a block has 12), and 32 is where the dialog's field list stays a
list a person reads rather than a spreadsheet. The dialog still shows one
empty set after the last filled one, so the number of *visible* sets is
what the user spends.

**The radius handle.** Set 1's `radius` is a `distance` manipulator
(ADR-0027) with its origin at the middle of the set's first edge and its
direction the unit bisector of that edge's two faces' outward normals there,
so the head sits `radius` away from the body and dragging it away grows the
round. Everything comes from the model meshes (`features/edgeHandles.ts`):
the edge's middle from its polyline, each face's normal from the node
nearest that middle (a flat face's normal is the same everywhere, so its own
mean is exact there), and the two faces from the edge's own name
`e[<face>|<face>]` (ADR-0005). The bisector points into the void whether the
corner is convex or concave — both normals point away from the material —
so "away from the body" means the same either way and no inside test is
needed.

Where the handle can't be placed honestly there is none: a seam edge (one
face), an edge of more than two faces, a face the meshes don't have, or two
faces whose normals agree within 60° (a smooth chain, where there is no
corner to point away from). A fingerprint's `dir` would give a plane's
normal without the mesh, but every face of a body that has an edge is in that
body's mesh, so it would only ever be a second path to the same number.

A variable set's handle moves `radius` only; its End radius is a field of
its own and gets a handle of its own in a later pass (the field names leave
the room).

**The cost:** the handle stands on the edge's middle, and like every
manipulator handle it takes the clicks that land on it, so re-picking that
same edge takes a click a little along it. The two tangent-chain e2e tests
say so and click a little along (they also try the middle first, which is
where the pick does not always find the edge).

**A bug the handles found.** A dialog's heads-up box took every plain digit
typed while it was open, `Shift+1…7` (the view commands) with them: the
overlay's keydown listener is registered before the shell's (child effects
run first) and called `preventDefault()`, so the shell's shortcut handler
saw a handled event and skipped. That had been true for every dialog with a
manipulator (an extrude's distance arrow) since P2-05; the fillet handle
made it bite, in B8, whose fourth fillet edge is picked from the back view.
A key with a modifier is a command, so the box takes plain typing only
(`e2e/fillet.spec.ts` covers Shift+4).

Rejected: a minimum screen length for the arrow (`scale`, so a 1 mm radius
is still 18 px long) — it makes the arrow lie about the value, which is the
one thing a handle next to a number must not do; a handle on every set (32
arrows is a thicket, and set 1's is the one that matters); an inside test to
flip the arrow on a concave edge (unnecessary: the bisector is already
right).

### Amendment: handles for every set and a variable fillet's ends (P4-12, second part)

**Built.** Every set with edges has its own Radius arrow (`radius<n>`), by the
same rules and refusals as set 1's; empty sets compute nothing (the spec loops
over the sets that have edges only). The overlay draws the **active** arrow as
before and the others small (5 px head, 1.5 px line) and at 0.6 opacity, in
the same tokens. The active one is the arrow whose own field, or one it
`follows` (the set's Edges pick field, Variable, Swap ends), was touched last:
`pickInto` now also sets the dialog's `activeField`, and a field no arrow knows
leaves the last choice standing. Grabbing a quiet arrow activates it. A
`DistanceManipulator` has the two new optional members `quiet` and `follows`.
Arrows whose heads land within 12 px of an earlier one are drawn 14 px apart
by `lift` (decided between drags so a head doesn't jump under the pointer).

**A variable set has two arrows**, at the two free ends of its tangent chain,
each on the bisector of the faces of the chain's edge at that end. `chainEnds`
(`edgeHandles.ts`) walks the chain through the edges' shared end points. **Which
end is the start comes from the edges' own polylines**: the round starts at the
end the polylines flow away from. That is not documented OCCT behaviour, so it
is measured (`packages/kernel/src/features/fillet-variable-start.test.ts`: all
twelve edges of a box and a line-arc-line chain, whichever edge comes first,
each by the distance from the chain's ends to the result's nearest vertex, 2 mm
at the start and 4 mm at the end); if the edges of a chain disagree about the
direction, or the chain is closed, branched or broken, nothing says which end
starts and **both arrows are left out** (the fields still work). With Swap ends
the arrow that writes `radius` stands at the end and the one that writes
`radiusEnd` at the start. Rejected: asking the kernel for the start (a facade or
report change for something the meshes already say), and keeping a Radius arrow
at the first edge's middle for a variable set (a radius that isn't there).

## Amendment 2026-10-10: two rounds meeting where one runs over a curve

A design trapped OCCT with `RuntimeError: memory access out of bounds` on a
three-edge, 10 mm fillet. Run natively with function names (a STEP of the body, the facade in
a harness), the trap is `TopoDS_Iterator::Next` inside
`TopOpeBRepBuild_Builder::MergeSolid`, called from `ChFi3d_Builder::Compute`
after the rounds are computed: OCCT's rebuild of the solid reads a shape that
isn't there. The cause, rebuilt by hand: the top edge of a step's wall whose
round reaches down the wall past a rod lying along the step (the wall's
boundary there is an arc 6.5 mm below the edge), and **another round meeting
it at a corner**. That round alone builds a valid solid at any radius; with
any second chain sharing one of its vertices it builds an invalid solid, throws
inside `TopOpeBRepDS`, or traps, depending on where the rod's seam lies.
A slanted straight boundary (a ridge instead of the rod) doesn't trap, and
chains that don't touch it don't matter.

**Decision.** `wallBeside` takes a `curves` flag: a curved boundary edge of
the flat face (not one that starts at the edge's own ends) counts as a wall at
its nearest point within the edge's length, sampled at 65 points.
`addFillets` sets it for a chain that shares a vertex with another chain, so
`filletRollsOff` refuses those radii before OCCT runs and the diagnosis
reports what a person can act on: each chain builds alone, so it is status 4,
"These fillets can't all be built where they meet. Try radii up to about
6.4 mm, or fewer edges at once." A lone chain is checked as before (straight
walls only), so the round that works alone still builds.

Test: `kernel.test.ts` "refuses rounds that meet at a corner where one runs
over a rod, instead of trapping OCCT" (the bar, step and rod by hand; it
trapped before). Still open: an edge that is an arc, a curved face, and a
curved boundary crossed by a lone chain go to OCCT unguarded, as before.
