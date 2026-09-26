# ADR-0014: Polygons, slots, ellipses and fit-point splines

- **Status:** Accepted, 2026-09-26
- **Task:** P1-05 (more drawing tools). Code: tools in
  `apps/web/src/sketch/tools/` (`polygon.ts`, `slot.ts`, `ellipse.ts`,
  `spline.ts`, registered in `host.ts`, IDs in `ids.ts`), the new entities in
  `packages/core/src/sketch/schema.ts`, their shapes in
  `packages/core/src/sketch/curves.ts`, the ellipse's solver mapping in
  `packages/sketch/src/solver/mapping.ts`, drawing in
  `viewport/sketchGeometry.ts`, the lazy tool chunk in `shell/AppShell.tsx`.
- **Builds on:** ADR-0010 (points are entities, one owner per point),
  ADR-0011 (solver adapter), ADR-0012 (tool framework), ADR-0013 (builders).
- **Affects:** P1-06 (which constraints ellipses and splines take), P1-07
  (dimensioning ellipses), P1-10 (trim and offset on the new curves), P1-11
  (profiles with ellipses and splines), P2 (kernel edges from sketches).

## Context

FR-SK-02 still lacked polygons (inscribed, circumscribed, edge), slots
(center to center, overall) and ellipses; FR-SK-03 asks for fit-point
splines. Polygons and slots are lines and arcs, which the sketch already
has. Ellipses and splines are new curve kinds: the schema, the solver, the
viewport, inference and (later) the kernel all have to know them.

## Decision

1. **Polygons are lines plus a construction circle.** n lines joined at the
   corners, all equal to the first, each corner on a construction circle
   through them: 4 degrees of freedom (center, size, rotation) for any n,
   with no redundant constraint (tested for n = 3…8). The circumscribed mode
   adds a second construction circle inside, concentric and tangent to the
   first edge, and a typed diameter dimensions that one (across the flats,
   a nut's wrench size). The edge mode takes two corners, then a click for
   the side. The side count is a unitless heads-up field (`FieldKind`
   `'unitless'`), 3 to 64, and stays set for the next polygon.
2. **Slots are two lines and two half arcs**, joined and tangent all round
   (`reversed: false`: the outline runs one way), with equal radii, plus a
   construction centerline: 5 degrees of freedom. In the center-to-center
   mode the centerline joins the arc centers; in the overall mode it runs
   end to end, the centers on it and its ends on the arcs. A typed length
   dimensions the centerline either way; a typed width is the distance
   between the two lines.
3. **An ellipse is three points:** `{ center, major, minor }`, no numbers.
   Radii and rotation are the points' distances and angle; `minor` sits
   square to the major axis. Typed radii become ordinary point-to-point
   distance dimensions, which P1-07 can edit like any other.
4. **The solver maps an ellipse with ordinary constraints.** planegcs's
   ellipse is center + focus + minor radius. The focus is a solver-only
   point (`<id>#focus`, placed from the document points; `uses` and `links`
   skip it). Two solver-only lines, center to focus and center to minor,
   hold the axis points: the major point is on the ellipse and on the axis
   (a vertex), the minor point is on a line perpendicular to the axis at
   the minor radius (`p2p_distance` to the ellipse's `radmin` parameter).
   4 equations on 9 unknowns: 5 degrees of freedom. `pointOnCurve` on an
   ellipse maps to `point_on_ellipse`; a fixed ellipse fixes its focus and
   minor radius like a fixed arc.
5. **A fit-point spline is its points:** `{ points: [...] }`, at least two.
   The curve is a cubic B-spline through them (global interpolation with
   chord-length parameters and averaged knots, Piegl & Tiller §9.2.1; two
   points give a line, three a parabola), computed by `fitSpline` in core.
   The solver sees only the points: the spline adds no unknowns and no
   equations. The kernel will get the interpolated poles and knots, so the
   screen and the model show the same curve.
6. **What the new curves take, for now:** ellipses take `pointOnCurve` and
   `fix`; splines take `fix`. Tangent, equal, symmetric and dimensions on the
   curves themselves are refused by the schema until their tasks (P1-06,
   P1-07) need them. Inference snaps to an ellipse's center (as a center)
   and axis points, and to a spline's end points (as endpoints) and fit
   points; not yet onto the curves or their intersections.
7. **The drawing tools are a lazy chunk.** P1-05 took the main chunk over
   the 1000 kB warning. The shell loads the tool host and the overlay with
   one dynamic import as soon as a project opens, and renders the overlay
   component it got, not a `React.lazy` one; `ids.ts` answers "is this a
   drawing tool?" without loading the tools (a test keeps it in step with
   the host's factories).

## Rejected options

- **planegcs's internal-alignment constraints for the ellipse axes**
  (`internal_alignment_point2ellipse`, FreeCAD's way): in our build they
  converge at once without moving anything and remove the wrong number of
  degrees of freedom (4 of them removed 2). Probed in a scratch test;
  ordinary constraints do the same job and are well tested.
- **Storing an ellipse as center, radii and rotation** (like a circle's
  radius): every dimension and constraint on its axes would need new
  solver plumbing, and the axis ends couldn't be snapped to or dimensioned
  as points.
- **The minor radius as `dist = b` plus the minor point on the ellipse**:
  at a minor vertex both constraints have the same gradient (the distance
  is at its minimum there), a degenerate pair like endpoint tangency.
- **A circumscribed polygon made only of the inner circle** (edges tangent
  to it, equal edges): for an even number of sides equal tangent edges
  don't make a regular polygon (a rhombus has them) and one of the
  equalities is redundant. The circle through the corners works for every n.
- **The overall slot's typed length as `length − width` on the center
  distance**: the dimension's expression wouldn't be what the user typed.
  A centerline between the ends carries the length itself.
- **Catmull-Rom or Bézier segments for splines**: not what OCCT builds from
  interpolation points, and not C2. A B-spline in core can go to the kernel
  as poles and knots unchanged.
- **Mapping splines to planegcs B-splines** (poles as unknowns, fit points
  with `point_on_bspline`): adds a parameter per fit point and makes the
  shape depend on the solver; nothing in P1 constrains a spline's shape yet.
- **`React.lazy` for the overlay**: the first tool suspended its boundary,
  and React holds a suspended boundary back for up to about 300 ms; keys
  typed into the heads-up box in that time were lost (a flaky e2e test,
  failing 1 run in 4). The overlay first shared the Viewport's boundary,
  which hid the whole viewport and broke drags.

## Consequences

- An ellipse whose radii become equal is ill-conditioned for the solver (the
  focus meets the center); the tool refuses to draw one, and a dimension
  that forces it may fail to solve. Circles are the tool for that.
- Trim, offset, profiles and intersections (P1-10, P1-11) need
  nearest-point and intersection routines for ellipses and B-splines.
- Closed (periodic) splines, control-point splines and end tangents are
  left for later; a control-point spline would be its own entity type.
- A newer file with ellipses or splines fails to load in an older build
  with a schema error, not the "saved by a newer Extrudo" message; the
  format version stays 1 until the file format is frozen for release.
