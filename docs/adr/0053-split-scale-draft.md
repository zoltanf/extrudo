# ADR-0053: Split Body, Scale and Draft; benchmark B6

- **Status:** Accepted, 2026-10-01
- **Task:** P3-08, second half (FR-FT-12), and benchmark B6 of P3-14. Code: the
  facade's `scale` and `draft` (`packages/kernel/occt/facade/extrudo_facade.cpp`,
  block "scale and draft (P3-08)"); `Kernel.scale`, `Kernel.draft`, `DraftError`
  (`packages/kernel/src/kernel.ts`); the definitions `packages/core/src/split-body.ts`,
  `scale.ts`, `draft.ts`; the evaluators `packages/kernel/src/features/split-body.ts`,
  `scale.ts`, `draft.ts`; the dialogs `apps/web/src/features/split-body.ts`,
  `scale.ts`, `draft.ts`; `e2e/split-body.spec.ts`, `scale.spec.ts`,
  `draft.spec.ts`, `benchmark-b6.spec.ts` and `fixtures/benchmarks/b6-wall-hook.extrudo`;
  the file format, `docs/file-format.md` 6.19 to 6.21. **The facade changed** (OCCT input hash `0ba43e09d993`)
  (additive: two methods and their helpers), no schema-version change, no
  migration; three new feature types.
- **Builds on:** ADR-0051 (offset face: a facade modify feature on a copy,
  checked, diagnosed by bisection, names kept), ADR-0028 (extrude's taper and
  the DraftAngle facts), ADR-0044 (the `transform` facade, how copies are
  renamed), ADR-0030 (bodies, `splitSolids`), ADR-0027 (dialogs, manipulators),
  ADR-0039 and ADR-0050 (benchmark fixtures, the fuzzer).

## Context

FR-FT-12 asks for split body (by a plane or face), scale (uniform and
non-uniform) and draft; offset face came in ADR-0051. Benchmark B6, the wall
hook, needs draft and fillets on intersecting edges.

Facts about OCCT 8.0.1 found on the way (native harness on the pinned image):

- `BRepBuilderAPI_GTransform` (the only way to apply a `gp_GTrsf`) runs
  `BRepBuilderAPI_NurbsConvert` first, always: **every surface and curve of the
  result is a B-spline**, planes and lines included (`BRepTools_GTrsfModification`
  only knows B-splines and Béziers). A non-uniformly scaled box would have no
  flat face to sketch on and no straight edge to turn about.
- `BRepBuilderAPI_GTransform::Modified` is broken (it fills a local list and
  returns an empty one); `ModifiedShape` works. The edges of its result carry
  `Geom_TrimmedCurve`s around the B-splines.
- `BRepOffsetAPI_DraftAngle::ConnectedFaces` throws; adding a face that an
  earlier `Add` drafted already (its smooth chain) is a no-op, so it isn't
  needed. A positive angle removes matter on the pull side of the neutral
  plane. DraftAngle refuses (`AddDone` false) a face whose smooth neighbours
  aren't planes, cylinders or cones (a side next to a rounded top edge) and
  can't tilt anything but planes, cylinders and cones.
- **DraftAngle returns "valid" solids whose faces have crossed** (ADR-0028):
  the sides of a box drafted past 26.6° meet and go through each other, and
  `BRepCheck_Analyzer` passes them. The edges between faces that crossed run
  backwards, and a cylinder drafted past its radius is a cone whose tip lies
  inside the face.
- A sweep of 5,544 drafts (boxes, cylinders, a holed plate, an L, boxes with
  vertical, top or all edges rounded, chamfered boxes, a shelled box, a
  cylinder with a rounded rim; every face alone and all together; six neutral
  planes, seven angles from −40° to 75°) and 27 scales of each of those bodies
  trapped nothing and kept the heap flat. Draft does not share offset's trap on
  smooth chains with a sharp edge inside: those bodies are refused cleanly.
- OCCT's default `BRepGProp::VolumeProperties` is about 0.8 % off on B-spline
  faces (an exact elliptic wall, or a cylinder only converted to B-splines);
  the version with a tolerance is exact. `properties()` and `measure()` use the
  default.

## Decision

### 1. Split Body (`splitBody`): two booleans, no facade change

Inputs: `bodies`, `plane` (an origin or construction plane, or a flat face,
taken as its whole plane) and `keep` (`both`, `above`, `below`; above is the
side the plane's normal points to). Each side is the **common part of the body
and a box on that side of the plane** (sized from the body so it reaches past
it everywhere, placed by the existing `transform`). Both sides are named
through the booleans' history and then **named again as one shape** (a
compound of the two), so a face cut in two keeps its name as `#1` and `#2`,
one piece in each body: names stay unique across bodies, which `resolveRef`
needs (two exact matches make it guess, ADR-0044). The box's faces are all
named `split:<feature>:cut:above` (or `below`); only the one on the plane can
reach the result. `splitSolids` then makes a body of every solid, the largest
keeping the body's ID (ADR-0030). A body the plane misses stays whole with a
warning (an error if it misses them all); keeping an empty side is an error,
since the body would vanish.

### 2. Scale (`scale`): the facade's `scale(shape)`

Inputs: `bodies`, `point` (a vertex or construction point; empty: the centre of
the bodies' box, as Move turns about), `mode` (`uniform`, `non-uniform`),
`factor` or `x`, `y`, `z` (plain numbers, default 1), `copy`. Factors must be
greater than 0 (a mirror is Mirror); all 1 is a warning.

The facade takes six staged numbers (centre, three factors). Equal factors use
`gp_Trsf::SetScale` through `BRepBuilderAPI_Transform` (types kept, history as
for `transform`). Different factors use `gp_GTrsf` through
`BRepBuilderAPI_GTransform`, then **`restoreCanonical` puts flat faces back on
planes** (`GeomLib_IsPlanarSurface`, the plane oriented like the B-spline so the
face keeps its side, the edges' old p-curves dropped and new ones built on the
plane) **and straight edges between such faces back on lines** (degree-1,
two-pole B-splines rebuilt as lines through the same vertices, swapped in by a
`BRepTools_ReShape`). If that doesn't give a valid shape the all-B-spline
result is kept. History maps every input sub-shape through `ModifiedShape` and
the ReShape's `Value` (`recordImages`), so **every face keeps its name** and a
fillet after a scale survives a change of factor. Copies are renamed like
Move's (`scale:<feature>:from:(<name>)`).

### 3. Draft (`draft`): the facade's `draft(shape, point, normal, angle)`

Inputs: `faces`, `plane` (the neutral plane; its normal is the pull
direction), `angle`, `flip`. A positive angle narrows the body along the pull,
as a part drawn out of a mould (OCCT's own sign). Before OCCT runs, each face is
checked: not a plane, cylinder or cone (status 3), or a plane parallel to the
neutral plane (status 7). The builder works on a copy with its staged faces;
the result must be a valid solid of positive volume in which **every edge's ends
keep their order** (compared through the vertices' images, since OCCT may run a
new edge either way) and **no cone has its tip inside its own face** (from the
cone's parameters: the tip is at v = −R / sin α). On failure: a face OCCT won't
take (status 2, the face), or the largest angle of the same sign that works by
bisection (status 1), or none (6). History is `recordImages` over
`ModifiedShape` (DraftAngle calls tilted faces "generated"): every face keeps
its name. The evaluator words it: "The faces can't tilt by 45°: that is too
steep for this body (max ≈ 36°). Try a smaller angle.", "Face 6 is parallel
to the neutral plane, so there is no line to tilt it about.", "Face 2 can't
tilt about this plane: the faces around it can't follow. Rounded or chamfered
edges next to it often stop this: draft before rounding the edges."

### 4. The dialogs and the toolbar

Draft, Split Body and Scale are in the Solid tab's Modify menu (the group's
tiles don't change), with no default keys; their commands come from the tool
catalogue like every dialog's. Split Body: Bodies, Plane (picked like Create
Sketch's plane), Keep. Scale: Bodies, Point (optional), Scale type, Scale
factor or X/Y/Z factor, Create copy. Draft: Faces (`tangentChain`, as Offset
Face's: OCCT drafts smooth chains together), Plane, Angle (default 3°), Flip,
and an **angle arc** where the first face meets the neutral plane: it starts
along the pull, so it shows which way that is, and turns towards the inside of
the face by the angle.

### 5. Benchmark B6: the wall hook

`e2e/benchmark-b6.spec.ts` builds it through the UI: parameters `wall`,
`width`, `height`, `arm`, `reach`, `lip`, `taper`, `radius`; a plate, an arm
and a lip as three Box primitives joined into one body; Draft1 tilts the arm's
two sides (each one face with the lip's side) and its top by `taper` about the
plate's front face; Fillet1 rounds the plate's four top edges, which meet at
its corners, and the inside corner under the arm. It exports the 3MF (one closed
solid, 40 × 30 × 60 mm), changes parameters and exports the fixture.
`packages/kernel/src/benchmarks.test.ts` recomputes the fixture headless (the
drafted volume against an exact integral) and the fuzzer runs on it.
`packages/kernel/src/benchmarks.test.ts` recomputes the fixture headless (the
drafted volume against an exact integral) and the fuzzer runs on it.

**Fuzzing B6** (`FUZZ_STEPS=1000`, three seeds: the default, 1 and 777):
3000 edits of the parameters and every expression input, suppressions and
marker moves, with no crash, internal error, leak or warm/cold difference.
In the default seed's report 382 of 1000 recomputes had a feature error,
every one a worded message (counted per feature): lost references after edits that merged or
removed faces (a narrow plate swallowing the arm's sides, 260), fillets too
large or meeting (88), sizes of 0 or less (198 on the boxes), draft angles of
90° or more (15), too steep (22) or not draftable once the arm's neighbours
changed (39). The slowest recompute took 172 ms (median 22 ms). Nothing needed
fixing in the new features.

## Alternatives rejected

- **A splitting facade method** (`BRepAlgoAPI_Splitter` or General Fuse with a
  plane face). One operation, but the halves share the section face, so both
  bodies would carry one face name; renaming it per side needs the same
  per-side naming as two booleans. The booleans need no facade change.
- **The largest piece keeps the ID for a split, or the side above the plane
  does.** The second is steadier when an edit makes the other side the larger,
  but ADR-0030's rule is the same for every feature that makes several bodies;
  kept.
- **Non-uniform scale as all B-splines** (what OCCT gives). Flat faces would
  stop being flat for sketches, mirror planes, construction planes, hole
  placement and draft; straight edges would stop being axes.
- **A `BRepTools_Modification` of our own** for the non-uniform scale (planes to
  planes, lines to lines, circles to ellipses, without the NURBS step). The
  facade may hold only one class (ADR-0001); restoring planes and lines
  afterwards gets the cases that matter.
- **A self-intersection check** (`BOPAlgo_ArgumentAnalyzer`) instead of the
  edge-order and cone-tip tests. It costs on every preview; the cheap tests
  catch every crossing the sweep produced.

## Open items

- **Draft can't follow rounded or chamfered neighbours**: a side whose top
  edge is rounded is refused ("draft before rounding the edges"). Drafting the
  fillet with it would need a fillet rebuilt after the draft.
- **Split by a curved face** (a cylinder's wall extended) isn't offered: only
  planes and flat faces. Fusion also splits by bodies.
- **A cylinder scaled only along its axis** comes out as a B-spline; planes and
  lines are restored, cylinders and cones not (`ShapeAnalysis_CanonicalRecognition`
  could, with new p-curves).
- **Volumes of B-spline bodies are about 0.8 % off** in Print Info and Measure:
  `properties()` uses OCCT's default integration. Passing a tolerance makes it
  exact at some cost; worth measuring.
- **Draft per face**: one angle and one neutral plane for all faces; Fusion's
  parting-line draft and two-sided draft aren't there.
- **Scale with a handle** in the view: the factor has no manipulator (the
  framework's handles are lengths and angles).
