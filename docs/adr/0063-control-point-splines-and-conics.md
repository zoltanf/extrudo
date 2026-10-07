# ADR-0063: Control-point splines and conics

- **Status:** Implemented, 2026-10-04 (branch `p4-05-splines`); see Results.
  Amended 2026-10-06 (P4-12: stored knots, closed splines, trim, break and
  offset; branch `p4-12-splines`)
- **Task:** P4-05 (FR-SK-03: "Spline (fit-point and control-point), conic").
- **Builds on:** ADR-0010 (points are entities), ADR-0014 (fit-point splines:
  the curve is derived from points, the solver sees only the points),
  ADR-0020 (profiles from polylines of splines), ADR-0025 (sketch curves to the
  kernel), ADR-0022 (export).

## Context

P1-05 made a fit-point spline `{ points }`, its curve the cubic B-spline through
them (`fitSpline` in `packages/core/src/sketch/curves.ts`). FR-SK-03 also asks
for control-point splines (the points are the B-spline's poles, the curve
follows them without passing through them) and conics (Fusion-style: a start
point, an end point, a shoulder point where the end tangents meet, and a
fullness `rho`). Every part of the pipeline handles fit splines through one
shape: a `BSpline` (degree, poles, clamped knots) computed from the points.

The facade's `sketchSpline` takes **non-rational** B-splines only. An exact
conic is a rational quadratic; changing the facade means a new OCCT build, which
now has to be built and published by hand (the CI runners can't), and the
emboss task (P4-04) is changing the facade at the same time.

## Decision

### 1. One entity: `spline` gets a mode

```ts
SketchSplineSchema = z.strictObject({
  type: z.literal('spline'),
  points: z.array(ref).min(2),
  /** How the points shape the curve; absent = 'fit' (P1-05 files). */
  mode: z.enum(['fit', 'control', 'conic']).optional(),
  /** A conic's fullness, 0 < rho < 1 (0.5 = parabola); only for 'conic'. */
  rho: z.number().gt(0).lt(1).optional(),
  construction: z.boolean(),
})
```

with a refinement: `mode: 'conic'` needs exactly 3 points (start, shoulder,
end) and a `rho`; other modes have no `rho`; `mode: 'control'` needs at least 2
points. `'fit'` is written as absent (old files and new fit splines stay
byte-identical).

- **fit:** as P1-05.
- **control:** the points are the poles of a clamped B-spline of degree
  `min(3, n − 1)` with **uniform** interior knots (n poles; 2 poles is a line,
  3 a quadratic Bézier). The curve starts at the first point, ends at the last,
  and is tangent to the control polygon there.
- **conic:** the rational quadratic Bézier with poles start, shoulder, end and
  weights 1, `w`, 1, `w = rho / (1 − rho)`: rho < 0.5 an ellipse arc, 0.5 a
  parabola, > 0.5 a hyperbola arc. Its end tangents point at the shoulder.

### 2. One function gives every spline's curve

`splineCurve(entity, points: Vec2[]): BSpline` in core's `curves.ts`
dispatches on the mode: `fitSpline`, `controlSpline` (new), `conicSpline`
(new). **Every place that now calls `fitSpline` on an entity's points calls
`splineCurve` instead** (core `curvePolyline`, the kernel's sketch curves,
`@extrudo/sketch/export`, the Spline tool's preview); `fitSpline` stays for
projections and the tool's fit mode.

- `controlSpline(poles)`: exact (the poles are the B-spline's).
- `conicSpline(start, shoulder, end, rho)`: a **non-rational cubic B-spline
  within 1e-5 mm** of the exact conic (exact for rho = 0.5: the parabola's
  quadratic Bézier raised to degree 3). Built from cubic Hermite pieces of the
  exact curve, over parameter intervals that are **subdivided adaptively**: an
  interval over the tolerance (sampled at 8 points inside it against
  `conicPoint`) is split at its middle and looked at again, breadth first, up to
  160 pieces. Splitting halves the parameter span, which brings the piece's
  rational weight towards 1, so it becomes polynomial (fourth order) fast and
  the pieces go where the curve swings. The pieces are joined as one cubic
  B-spline with **double interior knots at their own parameters** (C1, and
  `splinePoint(spline, t)` is the exact conic at every join), and the poles are
  the pieces' control points with each join's shared point dropped — which that
  basis implies from the two poles either side of the join, weighted by their
  spans, because the Hermite tangents are the exact derivative times each span.
  `conicPoint(start, shoulder, end, rho, t)` evaluates the exact rational curve
  for tests and the tolerance check.

So the kernel, profiles, export and the viewport keep working on non-rational
B-splines; **no facade change**.

### 3. The solver, inference and editing

- The solver sees only the points, as for fit splines (no unknowns, no
  equations). Constraints and dimensions on the points work as on any point;
  the spline itself takes `fix` only (ADR-0014's rule stands for all modes).
- Inference: the first and last point are `endpoint`s in every mode (the
  curve ends there); a control spline's inner points and a conic's shoulder are
  plain `point`s.
- Mirror, scale, copy and patterns (`@extrudo/sketch/modify` transform) carry
  `mode` and `rho` over unchanged: B-splines and conics are affine-invariant
  in their control points, and rho doesn't change under affine maps. Trim,
  break, extend and offset refuse every spline mode as they refuse fit splines
  today.
- Projections stay fit splines.

### 4. Drawing and tools

- Sketch mode draws the **control polygon** (thin dashed lines through the
  points in order, construction style) for control splines and conics, only
  while their sketch is open. Fit splines draw none.
- Tools (Create menu, after Fit Point Spline; no keys): **Control Point
  Spline** (`splineControl`: click the poles, Enter or double-click finishes,
  Esc cancels the last; the preview is `controlSpline` of the clicks plus the
  pointer) and **Conic** (`conic`: click start, click end, then move and click
  the shoulder; a unitless heads-up field "Rho", default 0.5, 0.05 to 0.95,
  remembered for the next conic like the polygon's side count).
- Selection panel: a control spline shows "Control points: n"; a conic shows a
  **Rho** field (unitless, 0.05 to 0.95) that edits it through a new command
  `setSplineRho({ feature, id, rho })` (one undo step; the host re-solves
  nothing, only the curve changes).
- Sketch export, profiles (`detectProfiles` uses `curvePolyline`) and the
  kernel follow from §2.

### 5. Files

`formatVersion` stays 1 (optional keys). An older build drops `mode` and `rho`
with its "saved by a newer Extrudo" notice (ADR-0050) and shows those splines
as fit splines through the same points; the format isn't frozen yet, so this
is acceptable. `docs/file-format.md` documents both keys.

## Rejected

- **Separate entity types `controlSpline` and `conic`** (ADR-0014 expected
  one): every switch over entity types (about 20 files) would gain two cases
  that do what the spline case does with a different curve. The mode keeps one
  case and one curve function.
- **Exact rational conics in the kernel** (weights through `sketchSpline`): a
  facade change and an OCCT build for a 1e-6 mm difference. The stored conic
  is exact (three points and rho), so this can come later without a file
  change.
- **A conic as an ellipse arc entity**: covers rho < 0.5 only and needs
  elliptical arcs, which the sketch doesn't have.
- **Storing knots for control splines** (non-uniform, as a fit spline converted
  to poles would need): no tool needs it yet; uniform clamped knots are what
  users expect from control-point editing.

## Deferred

- Closed (periodic) splines, end-tangent handles, degree choice, knot
  insertion, converting between fit and control splines (needs stored knots),
  trimming and offsetting splines, exact rational conics in the kernel. P4-12
  did closed splines, stored knots, trimming, offsetting (the amendment of
  2026-10-06) and exact conics (2026-10-07).

## Results

Everything in the Decision is in, with two places where the design had to bend
(see Deviations).

### Code map

| File | What |
|---|---|
| `packages/core/src/sketch/schema.ts` | `SketchSplineSchema.mode` and `.rho`, the conic refinement in `sketchIssues` (three points and a rho; a rho only for a conic) |
| `packages/core/src/sketch/curves.ts` | `controlSpline`, `conicPoint`, `conicSpline` (`CONIC_TOLERANCE`, `CONIC_MAX_PIECES`), `splineCurve`, `SplineMode`; `curvePolyline` reads the mode |
| `packages/core/src/sketch/commands.ts` | `setSplineRho` |
| `packages/kernel/src/features/sketch.ts` | the sketch evaluator stages `splineCurve`'s curve, so a conic reaches the kernel as the cubic |
| `packages/sketch/src/export/export.ts` | both spline sites read the mode |
| `apps/web/src/sketch/tools/conics.ts` | `SplineControlTool`, `ConicTool`, `inRhoRange`, `DEFAULT_RHO`, `MIN_RHO`, `MAX_RHO` |
| `apps/web/src/viewport/sketchGeometry.ts` | `sketchSegments(…, controlPolygons)` and `SketchSegments.controlPolygons` |
| `apps/web/src/sketch/panels.tsx` | `SplineFields`, the conic's Rho field; "Control points" for a control spline |
| `e2e/spline-conic.spec.ts` | both tools through the UI |

### Deviations

- **Adaptive subdivision, not uniform doubling.** A conic's rational weight
  makes its speed swing wildly between its ends (19:1 at rho 0.95), and uniform
  pieces then spend most of their spans where the curve is nearly straight.
  Subdividing adaptively puts them where they are needed: rho 0.3 needs 32
  pieces (66 poles) where uniform doubling used 64 (130).
- **The tolerance is 1e-5 mm, not 1e-6, and the pieces are capped at 160.** A
  hundredth of a micron is a tenth of the profile detection's own vertex
  tolerance (1e-4 mm) and a hundredth of the finest mesh deflection, and the
  cap holds every rho the UI offers (the fullest, 0.95, asks for 144) while
  stopping a degenerate one. The pieces being short is what makes it affordable:
  a conic's polyline draws four segments per span (and never fewer than 96 in
  all, so the one-span parabola still looks round), so a full conic is drawn,
  picked and profiled in under 600 points where 16 per span took over 2,000, and
  its chords are at worst 2.2e-3 mm inside the exact curve — a tenth of a
  thousandth of the region it bounds, so the detected profile and the kernel's
  face agree to better than a thousandth.

### Measured

`conicSpline` against `conicPoint` at 200 parameters, a 60 × 40 mm conic, and
the polyline `curvePolyline` draws for it (four segments per span, at least 96
in all):

| rho | pieces | poles | worst error | drawn polyline | chord sagitta |
|---|---|---|---|---|---|
| 0.05 | 50 | 102 | 7.5e-6 mm | 201 points | 7.0e-4 mm |
| 0.1 | 50 | 102 | 8.3e-6 mm | 201 points | 7.2e-4 mm |
| 0.3 | 32 | 66 | 8.1e-6 mm | 129 points | 1.0e-3 mm |
| 0.5 | 1 | 4 | 1.3e-14 mm | 97 points | 2.2e-3 mm |
| 0.7 | 66 | 134 | 9.6e-6 mm | 265 points | 1.0e-3 mm |
| 0.9 | 122 | 246 | 8.0e-6 mm | 489 points | 4.4e-4 mm |
| 0.95 | 144 | 290 | 9.8e-6 mm | 577 points | 2.3e-4 mm |

Splitting an interval at its worst point instead of its middle asks for the
same pieces (144 for rho 0.95), so the subdivision is not what the cap would
have cost.

## Amendment, 2026-10-06 — P4-12: stored knots, closed splines, trim, break and offset

The P4-12 backlog takes four of the Deferred items: stored knots, closed
(periodic) splines, trimming and breaking splines, and offsetting them. Exact
rational conics in the kernel stay deferred (they need the facade), as do
end-tangent handles, degree choice and converting a fit spline to a control
spline by hand. **No facade change**: the facade's `sketchSpline` already takes
the poles and the full knot vector, so a non-uniform clamped B-spline reaches
the kernel as it is.

### A1. Stored knots

The spline entity gets an optional `knots: number[]`, only with `mode:
'control'`: the full clamped knot vector of the poles' **cubic**,
`points.length + 4` values, non-decreasing, the first four 0 and the last four
1 (so at least four poles). Absent means §1's uniform interior knots, so every
existing file reads unchanged. `controlSpline(poles, knots?)` takes them; the
degree stays 3 whenever knots are stored. The checks live in `sketchIssues`
beside the conic's (the entity schemas are `strictObject`s in a union, and
every other cross-field rule of a sketch is there).

### A2. Closed splines

An optional `closed: true` on `fit` and `control` splines (refused with
`conic`, and with stored `knots`: a periodic curve's knots come from its
points). A closed **fit** spline is the periodic cubic interpolant through its
points (chord-length parameters round the loop, back to the first point; the
knots are the parameters, which makes the system cyclic tridiagonal), a closed
**control** spline the periodic uniform cubic B-spline of its poles. Both need
at least 3 points. **Both are emitted as the clamped B-spline that is exactly
the periodic curve**: the periodic poles are wrapped (the last pole, then all
of them, then the first two), the knots extended by the period, the knot at
the seam inserted to multiplicity 3 at both ends (Boehm) and the outer knots
and poles dropped, and the last pole is set to the first so the curve closes
exactly. So `BSpline`, the facade, profile detection, export and the kernel
need no new curve kind. The seam is at the first point (a fit spline passes
through it there; a control spline's seam is the curve point nearest its first
pole, `(P[n−1] + 4·P[0] + P[1]) / 6`), and the curve is C2 across it.

The Spline and Control Point Spline tools close a spline when a click lands on
its first point (as the Line tool closes a chain) with three points or more;
the selection panel gets a **Closed** checkbox for a selected fit or control
spline, which writes the new core command `setSplineClosed` through
`ToolHost.apply` (one undo step; closing a control spline drops its stored
knots, since the periodic curve has its own). A closed spline's first and last
points are plain `point`s for inference, not `endpoint`s. A closed spline is a
region on its own in `detectProfiles` (like a circle) and may be crossed by
other curves. Projections stay open fit splines.

### A3. Trim and break on splines

`split.ts` cuts a fit, control or closed spline where the other curves cross
it — found on its polyline and refined by bisection of the signed distance to
the cutter (a line's or a circle's own; a polyline cutter's chord) — by **knot
insertion**: the knot is inserted to multiplicity 3, which makes the pieces the
same curve exactly, and each piece is stored as `mode: 'control'` with its own
`knots` (re-normalised to 0..1) over new pole points. A curve of degree below 3
(two or three points) is raised to a cubic Bézier first. The first piece keeps
the entity's ID; the others get new IDs; a closed spline loses `closed`.

- **Trim** keeps what is outside the crossings around the cursor. On a closed
  spline that is one piece from the far crossing round the seam to the near
  one (the two parts each side of the seam joined into one B-spline, with the
  seam a knot of multiplicity 3: exact, and C2 there in fact), so a trim
  **opens** it; a closed spline crossed once goes whole, as a circle does.
- **Break** makes the part between the crossings a curve of its own, joined by
  coincident ends. A closed spline crossed once is **opened** there: one piece
  whose two ends are held together by a coincident constraint; crossed twice or
  more it becomes two.
- **Points.** A trimmed **fit** spline is a control spline from then on (its
  points become poles; the panel says "Control points: n"). A point of the
  original is kept where a piece still has a pole at the same place — the
  curve's ends always, a control spline's poles away from the cut — and every
  other point goes, **with the constraints and dimensions on it** (resplit's
  rule for a line's lost end, which is `entityRemoval`'s for a removed point).
  New ends at a crossing go on the cutter (`pointOnCurve`, or coincident with
  the cutter's own point there), as a line's do. A `fix` on the spline is
  copied to every piece; a `pointOnCurve` on it moves to the piece the point
  lies on.
- Conics stay refused where curves cross them ("A conic can't be cut where
  curves cross it."); a conic nothing crosses is still trimmed away whole.
- **Extend stays refused for every spline**: a B-spline has no natural
  continuation past its end (a straight tangent, a curvature-continuing arc and
  an extrapolated polynomial all differ, and the last runs away fast).

### A4. Offset of a spline

No exact offset of a B-spline exists, so a spline's offset is a **fit spline**
through the offsets of sample points: the polyline's parameters
(`SPLINE_SEGMENTS_PER_SPAN` per knot span), each point moved along the curve's
normal by the distance (closed stays closed, its seam sample not repeated). It
is then checked: the fit spline's distance from the true offset at the
samples' midpoints must be within **`OFFSET_TOLERANCE` = 1e-3 mm**, else the
sampling is doubled, up to 8 × (128 per span), and past that the offset is
refused ("The spline is too tight for that distance."). An offset towards the
centre of a bend tighter than the distance is refused before any of that
("The offset is larger than the spline's tightest bend."): the rule is signed
— a bend whose centre is on the other side never collapses, so only
`distance × curvature ≥ 1` on the offset's side counts.

A spline joined end to end to lines, arcs or other splines **offsets with the
chain** (`chainOf` follows a spline's first and last points; a closed spline is
a chain on its own). Joints whose offsets still meet (a smooth joint) are
joined at their common point; at a sharp joint the two offsets are trimmed
where they cross, and where they part (the convex side) the spline's offset is
carried on along its end tangent by a **straight line of its own** to where it
meets the neighbour's. The fit-spline offset holds no constraint to its
original (there is none a solver can state), so a chain with a spline gets
**no** distance dimension: its lines and arcs keep their parallel and concentric
constraints, and the offset spline carries a `fix`, so it stays the copy it was
made as. The fit-point solve of a long offset (hundreds of points) needed a
banded solve: `fitSpline` eliminates without pivoting inside the band above 32
points (the B-spline collocation matrix is totally positive, so that is stable,
de Boor), and keeps the dense solve below, so every existing spline computes
the same curve to the last bit.

### A5. Everything else

Transforms (mirror, scale, copy, patterns) carry `knots` and `closed` over
(both are affine-invariant). `drawingToSketch` is unchanged (its cubics are
four-pole uniform Béziers). The export's Bézier pieces already split at every
distinct knot (`bezierPieces` raises each interior knot to the degree), and a
closed spline's contour is written closed. `SketchBuilder.spline(points, {
closed })` and `splineControl(points, { knots, closed })` take the options
(the old one-argument calls are unchanged), `SplineHandle` reads `closed` and
`knots`, and the macro emitter writes them.

### Rejected

- **A periodic curve kind** in `BSpline` or the facade: every reader of
  `BSpline` (profiles, export, kernel staging, the viewport) would need it, and
  OCCT's periodic B-spline needs a facade change. The clamped unwrap is the
  same curve.
- **Splitting by parameter re-fitting** (re-fit a fit spline's two halves
  through its own fit points): the pieces would not be the same curve, so a
  trim would change the shape it keeps.
- **Keeping a trimmed fit spline as a fit spline** through new points: same
  reason; and its points could not reproduce the curve.
- **A tighter `OFFSET_TOLERANCE`** (1e-5 mm, a conic's): the offset is itself
  an approximation of a curve no one stored, and 1e-3 mm is a tenth of the
  finest print line's tolerance while keeping offsets of tight splines in a few
  hundred points.
- **Extending a spline** (see A3).

### Results (2026-10-06)

Everything in A1–A5 is in; no facade change, `formatVersion` stays 1 (two
optional keys, file format §6).

| File | What |
|---|---|
| `packages/core/src/sketch/schema.ts` | `knots`, `closed`; `knotProblem` and the rules in `sketchIssues` |
| `packages/core/src/sketch/curves.ts` | `controlSpline(poles, knots?)`, `closedFitSpline`, `closedControlSpline`, `periodicToClamped`, `insertKnot`, `splitSpline`, `splineRange` (round a seam too), `joinSplines`, `cubicOf`, `normalizeSpline`, `splineDerivative`; `splineCurve` reads `closed` and `knots`; `fitSpline` solves in its band above 32 points |
| `packages/core/src/sketch/commands.ts` | `setSplineClosed`; removing a spline's point drops its stored knots (and `closed` below three points) |
| `packages/sketch/src/modify/split.ts` | `splineSpanOf`, `splineCuts` (polyline hits refined by bisection), trim and break of splines, `replaceSpline`; extend refuses splines |
| `packages/sketch/src/modify/offset.ts` | `chainOf` follows open splines and takes a closed one alone; spline shapes, the density loop, `OFFSET_TOLERANCE`, joints with a spline (`joinWithSpline`, `land`), `splineOffset` |
| `packages/sketch/src/export/export.ts`, `inference/inference.ts`, `build/add.ts` | a closed spline's contour is closed; its first point is no endpoint; `addSpline`'s `shape` |
| `packages/api/src/sketch.ts`, `emit/sketch.ts`, `emit/print.ts` | `spline(points, { closed })`, `splineControl(points, { knots, closed })`, `SplineHandle.closed`/`.knots`; the emitter writes them, and the printer now breaks an array of arrays as Biome does (no fixture had one before) |
| `apps/web/src/sketch/tools/spline.ts`, `conics.ts`, `tool.ts`, `host.ts` | `closesOn` (a click within `ToolContext.snapDistance()` of the first point, with three points or more) |
| `apps/web/src/sketch/panels.tsx` | the Closed checkbox |
| `apps/web/src/sketch/tools/split.ts`, `offset.ts` | Break and Offset pick splines |

Measured (unit probes and the tests):

- **Seam continuity**: a closed fit spline through five points has its first
  and second derivatives equal at the seam to 1.5e-13 and 1.9e-12 (against
  magnitudes of 148 and 910 per unit parameter), a closed control spline to
  2.0e-14 and 2.3e-13. A closed spline's polyline closes exactly (the last pole
  is set to the first).
- **Exactness of a cut**: the pieces of a trim or break lie on the original to
  under 1e-9 mm (the test's bound; knot insertion is exact up to rounding), and
  `splitSpline`'s two halves reproduce the curve at 101 parameters to 1e-12.
- **Offset error** against the true offset at 200 parameters, all at the first
  density (16 samples per span, so no doubling was needed): a five-pole control
  wave at ±2 mm 1.7e-4 / 1.9e-4 mm (65 fit points, 4-15 ms), a closed fit
  spline at 3 mm 1.0e-4 mm (80 points), a closed control spline at −3 mm
  1.8e-5 mm, a fit wave at 1 mm 3.9e-4 mm — all under `OFFSET_TOLERANCE`.
- **Kernel**: a closed fit or control spline extruded 5 mm is one valid solid
  whose volume, read from a 0.2 µm mesh of it, is within 1e-4 of the fine
  polygon area × 5 (7e-6 and 2e-5 measured). OCCT's own `measure` of the same
  solids is about 1e-4 out (1.1e-4 for the fit loop): a prism with B-spline
  walls takes the fixed-order mass integral (ADR-0067 §H3), so that test reads
  the mesh. A trimmed spline's profile extrudes to one valid body.

Deviations from the brief: the knot rules live in `sketchIssues`, not a
`superRefine` (see A1); the tight-bend rule is signed (A4); a closed spline
crossed once is trimmed away whole, as a circle is (A3); a chain with a spline
has no driving dimension and its offset spline is fixed (A4); conics can be
offset (their curve is a B-spline like any other), only cutting them is refused.

## Amendment, 2026-10-07 — P4-12: exact conics in the kernel

The last item of the Deferred list (and of the original Rejected one, "a 1e-6
mm difference"): a sketch conic reaches OCCT as the **rational quadratic** it
is, not as `conicSpline`'s cubic within `CONIC_TOLERANCE`. The stored conic
was always exact (three points and rho), so nothing in the file changes.

### Decision

- **One facade method, `sketchConic(x0, y0, xs, ys, x1, y1, rho)`**, seven
  doubles in and the staged curve's index out, like `sketchEllipse`: the poles
  start, shoulder, end with weights `(1, w, 1)`, `w = rho / (1 − rho)` (0.5 the
  parabola, below an ellipse arc, above a hyperbola arc), as a
  `Geom_BSplineCurve` of degree 2 with knots `[0, 1]` of multiplicity 3, made
  into an edge and staged with `addSketchEdge` as `sketchArc` does. A conic arc
  can't cross itself, so unlike `sketchSpline` it needs no cut at crossings.
  rho outside (0, 1) is refused ("The conic's rho must lie between 0 and 1.");
  a shoulder on the chord is the straight curve the cubic route made too. No
  OCCT type in the signature; `sketchSpline` is unchanged.
- **`PlanarCurve` gains `{ kind: 'conic', start, shoulder, end, rho }`**, which
  `Kernel.#stageCurve` sends to `sketchConic`. `planarCurve` in
  `features/sketch.ts` makes it for a spline with `mode: 'conic'`, a `rho` and
  three points; every other mode keeps `splineCurve`. One entity is still one
  staged curve under the same ID, so **profile IDs don't change**
  (`profileFaceIds` keys by the same curves). There is no second place a conic
  is staged: the sweep's path (`SketchOutputData.exact`, P4-01) is the same
  `planarCurve` output and goes through `Kernel.path` → `#stageCurve` too, so a
  sweep along a conic follows the exact curve. Projection of a conic *edge*
  (`edgeGeometry`, ADR-0031) samples points as for any B-spline edge and comes
  back as the fit spline `projectPieces` makes, as before.
- **Mass properties follow a rational edge** (found by the harness, below).
  OCCT's fixed Gauss order, which `integrateArea`/`integrateVolume` keep for
  planes and prisms (ADR-0067 §H3), is exact on lines, circles and polynomial
  curves but not on a rational one: the face of a hyperbola arc (rho 0.8)
  measured 1.1e-3 out, its prism 3.5e-4. The bounded integral of §H3 is exact
  on the face but worse on the prism (5.4e-3 at `MASS_EPS`, 9.9e-5 even at
  1e-12: the cancellation §H3 describes). So the facade's `hasRationalCurve`
  (a B-spline or Bézier edge whose curve is rational) changes three things:
  `integrateVolume` takes **`VolumePropertiesGK`** at `MASS_EPS` for such a
  shape; `integrateArea` goes **face by face**, the bounded integral on a face
  that needs it or a plane with a rational edge (a cap), the fixed order
  elsewhere (exact on the conic's extrusion wall, where the bounded one is
  7.7e-3 out); and a rational edge's **length** is `GCPnts_AbscissaPoint`'s
  adaptive arc length (`edgeLength`, `edgesLength`: `properties`' length and
  `describe`'s fingerprint size), because `BRepGProp::LinearProperties` has
  no error bound at all — §H3's `integrateLength` had been passing `MASS_EPS`
  into its `SkipShared` flag, kept as it was. `sketchProfiles`' face areas go
  through `integrateArea` too. A shape with no rational edge integrates
  exactly as before.

What changes for the user: an extruded conic's volume and area, Measure's
values, Print Info's numbers and the profile area are exact (within rounding;
the tests measure extrudes, other features get the same curve), and a STEP export carries the true conic (a
`RATIONAL_B_SPLINE_CURVE`); the side is still one face. What does not: the app
draws, picks and detects profiles on the cubic (`conicSpline`),
`@extrudo/sketch/export` keeps its Bézier pieces, projections stay fit
splines; no schema, file-format or API change.

### Rejected

- **Weights through `sketchSpline`** (a staged weight per pole): every caller
  would stage ones, and the facade would need a rational branch with its own
  crossing cuts for a curve that only conics need. A method of its own keeps
  the non-rational path byte-identical.
- **A conic as an OCCT `Geom_Ellipse`/`Geom_Parabola`/`Geom_Hyperbola`
  arc**: three branches, each with its own parametrisation to work out from
  three points and rho, and a parabola branch that flips at rho 0.5 exactly;
  the rational Bézier is one formula and is what `conicPoint` evaluates.
- **The bounded integral for every shape with a rational edge** (only
  widening §H3's `needsTolerance`): exact on the face, 5.4e-3 out on the
  prism. **Gauss–Kronrod for every volume**: not measured on the shapes §H3
  measured (letters, wraps), so not changed for them.
- **Fixing every B-spline edge's length** (`GCPnts_AbscissaPoint` for
  polynomial ones too): it would move every spline edge's fingerprint and
  Measure value by up to 1e-6 (the parabola's edge, polynomial since its
  weights are equal, is 7.8e-7 short with the fixed order) for no user-visible
  gain; left for a task that wants it.

### Results (2026-10-07)

| File | What |
|---|---|
| `packages/kernel/occt/facade/extrudo_facade.cpp` | `sketchConic`; `hasRationalCurve`, `integrateVolume` (GK), `integrateArea` (per face), `integrateLength`, `edgeLength`, `edgesLength`; `sketchProfiles` and `describeEdge` use them |
| `packages/kernel/src/occt/types.ts`, `planar.ts`, `kernel.ts` | `sketchConic`; `PlanarCurve`'s `conic`; `#stageCurve` |
| `packages/kernel/src/features/sketch.ts` | `planarCurve`: a conic spline as a `conic` |
| `packages/kernel/src/features/sketch-conic.test.ts` | the tests below |
| `spikes/p4-12-conics/` | the native harness (`run.sh`, `run.sh probe`, `run.sh leaks 300`) |

Measured, the conics from (−20, 0) to (20, 0) with the shoulder at (0, 15),
closed by their chord and extruded 5 mm (exact areas by Gauss–Legendre of the
rational curve, 400 panels × 5 points; the parabola's is Archimedes' ⅔ ·
40 · 7.5 = 200 mm²):

| Conic | Exact area (mm²) | Volume, cubic route | Volume, exact route | Profile area, exact route |
|---|---|---|---|---|
| rho 0.5 (parabola) | 200 | 2.3e-16 | 0 | 0 |
| rho 0.3 (ellipse arc) | 129.113589607115 | 4.0e-7 | 8.8e-16 | 2.2e-14 |
| rho 0.8 (hyperbola arc) | 277.377827179843 | 7.5e-6 | 2.5e-15 | 2.0e-14 |

(relative errors; the cubic route is the cubic staged through `sketchSpline`
and measured by the same facade, so the parabola — whose cubic is exact — was
already right.) In the native harness the face area, the prism's volume, its
whole surface area (2.5e-11 for the hyperbola) and the conic edge's length
(3e-16) all agree with the quadrature; `run.sh leaks 300` (staging, profiling,
extruding and releasing the three conics 300 times) leaves the heap top flat
(+0 bytes over the last 200 rounds). A STEP export of the hyperbola's prism
reads back to the same volume within 1e-9 and carries
`RATIONAL_B_SPLINE_CURVE`; a sweep path of it is its exact length (1e-9).

Golden tables: no table or fixture holds a conic; the one row that moved is
the Scale table's non-uniformly scaled cylinder (factors 1, 2, 1), whose
circles `BRepBuilderAPI_GTransform` turns into rational B-splines, from
12566.4 to 12566.37 mm³ — π · 10 · 20 · 20 = 12566.37, so the new rule made it
exact.

Size: OCCT input hash `cf0bb43b2ade` (release `occt-cf0bb43b2ade`); the WASM
is 20.57 MB raw, 6.66 MB gzip, 4.63 MB brotli (Node's zlib at its best
settings; 20.50 / 6.62 / 4.60 MB before: +75 kB raw, +34 kB brotli, mostly
`GCPnts_AbscissaPoint` and the Gauss–Kronrod integrator).
