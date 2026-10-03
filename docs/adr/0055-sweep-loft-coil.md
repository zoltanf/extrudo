# ADR-0055: Sweep, loft and coil

- **Status:** Accepted, 2026-10-02
- **Task:** P4-01 (FR-FT-14). Code: the facade's block "paths, sweeps and
  lofts (P4-01)" (`packages/kernel/occt/facade/extrudo_facade.cpp`: `pathClear`,
  `pathSketch`, `pathEdge`, `pathWire`, `helix`, `sweep`, `loft`);
  `Kernel.path`, `helix`, `sweep`, `loft`, `PathError`, `SweepError`,
  `LoftError` (`packages/kernel/src/kernel.ts`); `namedSweep`, `namedLoft`
  (`naming/ops.ts`) and `nameLoft` (`naming/names.ts`); the definitions
  `packages/core/src/sweep.ts`, `loft.ts`, `coil.ts`; the evaluators
  `packages/kernel/src/features/sweep.ts`, `loft.ts`, `coil.ts`; the dialogs
  `apps/web/src/features/sweep.ts`, `loft.ts`, `coil.ts`; the native harness
  `spikes/p4-01-harness/`; `e2e/sweep-loft-coil.spec.ts`; the file format,
  `docs/file-format.md` 6.22 to 6.24. **The facade changed** (additive: seven
  methods and their helpers; OCCT input hash `0bdee0285892`), no
  schema-version change, no migration; three new feature types.
- **Builds on:** ADR-0028/0029 (extrude, revolve: sources, `operate`,
  `splitSolids`, the proposal rule), ADR-0032 (primitives' placement), ADR-0047
  (patterns replay a feature's `previewTools`), ADR-0005 (naming), ADR-0025
  (sketch curves staged exactly), ADR-0027 (dialogs).

## Context

FR-FT-14 asks for sweep, loft and coil. Benchmark B10 (a cable chain link, P4-11)
needs a sweep or a loft that a pattern can repeat, with a tolerance parameter.
P4-02 (modeled threads) needs a helix it can sweep a thread profile along.

A previous attempt left 783 lines of facade code that had never been compiled
(path staging piece by piece, a helix, a sweep with a two-pass scale, a loft
that sewed closed rings). This task kept its structure where it held up in a
native harness and rewrote the rest (below).

Facts about OCCT 8.0.1 found in the native harness (`spikes/p4-01-harness`,
`run.sh` builds `harness.cpp` against the pinned image's static libraries and
runs it under node; 64 checks of volumes, caps, history and refusals):

- `BRepOffsetAPI_MakePipeShell` sweeps one wire; a face with holes is the outer
  wire's solid minus each hole's solid (a boolean cut, whose `Modified` carries
  the names). Its `Generated(edge)` gives the edge's side faces, `FirstShape` and
  `LastShape` the caps. A solid may come out inside out: `BRepLib::OrientClosedSolid`
  fixes it.
- **Scaling along the path is one `SetLaw` with a `Law_Linear`** over the
  parameter range of `BRepAdaptor_CompCurve` on the spine, also for a chain of
  several edges (end cap a quarter of the start at scale 0.5, exactly; a 0.5
  frustum's volume exact to 1e-9).
- MakePipeShell has no twist. **A twist is an auxiliary spine**
  (`SetMode(wire, false, BRepFill_NoContact)`: the profile's normal points from
  the path to the auxiliary curve in the plane square to the path): we build it
  as a B-spline through 401 points at equal lengths, turned by `twist·s/L` on a
  rotation-minimising frame (double reflection), within 1 mm of the path or
  0.2 / curvature. A square twisted 90° along 50 mm keeps its volume to 1e-6.
  A path with a sharp corner has no such frame: a twist there is refused.
- `BRepOffsetAPI_ThruSections` decides that a loft is a closed ring when its
  last section `IsSame` its first, **after** its own compatibility pass, which
  copies the wires: adding the first wire again makes a solid with two
  coincident caps that `BRepCheck_Analyzer` passes. The facade lines the
  sections up itself (`BRepFill_CompatibleWires`), then lofts them with the
  check off and the first compatible wire repeated. `Generated(edge)` works for
  every section's edges (through the compatible wires' pieces for a ring).
- `BOPAlgo_ArgumentAnalyzer` in self-intersection mode flags the faces of a
  closed loft (B-spline faces that close on themselves along a seam that isn't
  periodic): rings are checked for validity and a positive volume only.
- A helix is a 2D line on a cylindrical or conical surface; `BRepLib::BuildCurves3d`
  makes its 3D curve (within 0.1 µm). Swept with a fixed binormal (the axis), a
  section in the axial plane stays in it: the volume is the section's area times
  `turns · 2π · r` of its centroid (Pappus), checked to 1e-5. Its timing is in the one-edge-per-turn point below.
- **MakePipeShell's result depends on which edge the section's wire starts
  with.** An equilateral triangle pointing at a coil's axis, its wire starting
  with the edge parallel to the axis, sweeps counter-clockwise into a solid
  `BRepCheck_Analyzer` refuses, and clockwise into a sound one; started at
  either other edge it is sound both ways. The facade tries a failed sweep
  again from each of the section's next edges (up to four; the same edges, so
  the history is unchanged).
- **A helix of one edge for all its turns makes slow and wrong booleans**: a
  20-turn groove cut round a post took 10.5 s and removed 73 mm³ instead of
  about 460 (the P4-02 thread work saw such a cut return its input uncut),
  and a 200-turn coil (from the fuzzer) took 165 s. Built as **one edge per
  turn** the sweep is 12 times quicker (0.11 s for 20 turns), has a side
  face per turn that the boolean prunes by box, and the same groove cuts
  correctly in 3.7 s whether the coil has 20 or 100 turns.
- A sweep along a path of several edges has one side face per profile edge
  per path edge: they are named `side:<source>#1`, `#2` … along the path
  (`deriveNames` numbering).
- The leak check (`run.sh leaks 600`: 120 against 600 rounds of a twisted,
  scaled tube, a round and a square coil and a loft) keeps the heap top flat.

## Decision

### 1. Paths: exact sketch curves and edges, chained in the facade

A path is staged piece by piece: `pathSketch(frame)` takes the curves staged
with the existing `sketchClear`/`sketchLine`/`sketchArc`/`sketchEllipse`/`sketchSpline`
(the same exact curves a sketch's faces use, ADR-0025) and places them in the
sketch's frame; `pathEdge(shape, edge)` takes a body edge. `pathWire(tolerance)`
chains them end to end in whatever order and direction they come (ends within
1 µm meet), starting with the first piece in its own direction, and fails with
the number of pieces that don't meet. The sketch's output now carries
`exact` curves per entity (construction ones too) next to the polylines a path
pattern walks (`SketchOutputData.exact`), so the kernel stages them without the
document.

### 2. Sweep (`sweep`)

Inputs: `profiles` (profiles and flat faces in one plane, united like
extrude's, holes allowed), `path`, `orientation` (`follow`: corrected Frenet;
`fixed`: a fixed trihedron, the profile stays parallel to itself), `twist`
(follow only), `scale` (the end's factor), `operation`, `bodies`. **The profile
stays where it is and travels with the path's frame from the path's end
nearer to its centre** (the facade walks the chain backwards when the far end
is nearer): it need not touch the path, so a profile beside the path sweeps a
parallel solid, and a path can be picked from either end. Corners are mitred
(`BRepBuilderAPI_RightCorner`). With `verify` (on for sweeps) the facade runs
the self-intersection check only when a cheap test says it might matter (a bend
tighter than the profile's reach, a corner, the path coming back within twice
the reach); the coil turns it off and checks its sizes instead.

Faces: `sweep:<id>:cap:start`, `cap:end`, `side:<source>` (`namedSweep`, the
same naming as extrude). Status codes map to messages: runs into itself,
couldn't sweep (a bend too tight, a corner), a twist on a sharp path, a scale
on a closed path.

### 3. Loft (`loft`)

Inputs: `sections` in order (profiles, flat faces, and at the first or last
place a point: a construction point, a vertex or a sketch point), `ruled`,
`closed`, `operation`, `bodies`. The facade takes faces without holes and
points (`AddVertex`); the history names each section's input. `nameLoft` names
caps `loft:<id>:cap:start|end` and a side face after the edge of the
**earliest** section that bounds it, so a ruled loft's middle faces take the
middle section's curves. Neighbouring sections in one plane, holes, a point in
the middle and closed lofts of fewer than three sections are refused before
OCCT runs.

### 4. Coil (`coil`), and the helix P4-02 reuses

Placement like a primitive (`plane`, `x`, `y`, `offset`; the axis is the
plane's normal and the helix starts on the frame's X side); `type` chooses two
of `revolutions`, `height`, `pitch` (`coilTurns`); `diameter`, `taper`,
`direction` (counter-clockwise: right-handed), `section` (circle, square,
equilateral triangle pointing out or in) of `size`, `position` (inside, on,
outside the diameter). The section is centred on the helix's start height.
The evaluator refuses, before OCCT runs, a section as tall as the pitch (the
turns would touch) and one that reaches the axis at either end of a taper;
then it sweeps without the self-intersection check.

**P4-02 reuses `helixSweep(ctx, scope, spec)`** (`features/coil.ts`): a
`HelixSweep` is the frame, radius, pitch, turns, taper, hand and any closed
section as `PlanarCurve`s in the (distance from the axis, height) plane, with
a role per curve for the names. A modeled thread passes its thread profile (a
trapezoid of the preset's pitch, with the print tolerance) and the hole's or
shaft's frame and cuts or joins with `operate` like any solid feature. The
facade's `helix` (a wire of one edge per turn, so the side faces are one per turn, `side:<role>#n`) and `sweep` with a binormal are the kernel API; P4-02 found the same need for its own thread helix.

### 5. Dialogs, toolbar, patterns

Sweep, Loft and Coil sit in Solid › Create's menu after Revolve, with no
default keys; their specs are registered in `featureDialogs()` and their tools
in `TABS`, so `buildCommands` offers them. Sweep's Path field takes tangent
chains of edges; Loft's Sections field also picks sketch points
(`sketchPoints`); Coil has arrows for the diameter and the height. Sweep and
Loft propose join for a body's face (`proposeSweep`, travel `both`), Coil a
join on a face. All three are in `PATTERNABLE_FEATURE_TYPES`: their join or cut
tool is a `previewTools` entry from `operate`, so patterns and mirrors repeat
them (tested: a pattern of a cutting sweep and of a coil cut).

**Patterns skip repeats that lie on the original** (`distinctPlacements` in
`kernel/src/features/pattern.ts`, an amendment to ADR-0047): the fuzzer set a
pattern of a 20-turn coil cut to a distance of 0, and OCCT took 44 s to cut the
coil into the faces it had already cut. A feature pattern now drops placements
equal to the original's or to an earlier one (within 1 µm) and warns when none
is left; a body pattern still makes its (coincident) copies.

### 6. Tests and the fuzzer

Core schema tests (`core/src/sweep-loft-coil.test.ts`), kernel tests through
the engine with `strictLeaks` and three golden tables
(`kernel/src/features/sweep-loft-coil.test.ts`, `golden/{sweep,loft,coil}-options.json`),
dialog tests (`apps/web/src/features/sweep-loft-coil.test.ts`), the e2e spec,
and a fixture for the fuzzer, `fixtures/benchmarks/p4-01-sweep-loft-coil.extrudo`
(a twisted, scaling sweep, a loft to an offset plane, a parameter-sized coil
cut into a post and a pattern of it), which `features/sweep-loft-coil-fixture.test.ts`
writes with `WRITE_FIXTURES=1` and checks otherwise.

### 7. Size

The OCCT WASM grows from 17.66 MB to 18.67 MB raw (4.03 to 4.23 MB brotli):
MakePipeShell, ThruSections, the compatible-wires pass, the argument analyser
and the laws it pulls in. The precache is 6.03 MB brotli, about 1 s at 50 Mbit
(NFR-02 holds).

## Alternatives rejected

- **Paths as polylines** (the path pattern's `SketchPathCurve`), fitted with
  `GeomAPI_PointsToBSpline` (the WIP's `pathSpline`): arcs and lines would lose
  their exactness and a sweep's side faces would be B-splines. Staging the
  sketch's exact curves costs one record in the sketch's output.
- **Path pieces built from points in the facade** (`pathLine`, `pathArc`
  through three points, `pathCircle`: the WIP): duplicated the sketch staging
  and lost ellipses and splines.
- **Scale by two passes** (the WIP: sweep once to find the end section, scale
  it, sweep again between two sections): twice the work, and two sections at
  the spine's vertices need the vertex matching the WIP did by distance. The
  law does it in one pass.
- **Twist by sections turned along the path**: MakePipeShell interpolates
  between sections linearly, so a square turned 90° shrinks to 1/√2 halfway.
- **A closed loft sewn into a solid** (the WIP's `closedSolid`): sewing rebuilds
  the faces, so the history found nothing; and the loft wasn't closed anyway
  (see the context).
- **`BRepOffsetAPI_MakePipe`** for plain sweeps (it takes faces with holes):
  no twist, no scale, a second code path to test.
- **The self-intersection check on every sweep**: seconds on a long helix and
  false positives on closed lofts; the cheap pre-test and the coil's own size
  checks cover the cases seen.

## Deferred

- Loft rails and a centre line (ThruSections has neither; a guide-curve sweep
  through `BRepFill_PipeShell` with sections is the likely route).
- A twist along paths with sharp corners; a twist or scale handle in the view.
- A sweep whose profile is a closed sketch curve rather than a region, guide
  rails for a sweep, and a coil of the "spiral" kind (flat).
- Loft sections with holes.
