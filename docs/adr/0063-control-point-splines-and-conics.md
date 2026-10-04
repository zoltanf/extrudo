# ADR-0063: Control-point splines and conics

- **Status:** Implemented, 2026-10-04 (branch `p4-05-splines`); see Results
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
  trimming and offsetting splines, exact rational conics in the kernel.

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
