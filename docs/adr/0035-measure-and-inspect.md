# ADR-0035: Measure and inspect

- **Status:** Accepted, 2026-09-29
- **Task:** P2-13 (measure and inspect; FR-3DP-01). Code: the facade's
  `distance` (now with the closest points), `properties` and
  `surfaceGeometry` (`packages/kernel/occt/facade/extrudo_facade.cpp`);
  `Kernel.closestPoints`, `Kernel.properties`, `Kernel.surfaceGeometry`
  (`packages/kernel/src/kernel.ts`); `packages/kernel/src/inspect.ts`
  (`inspectShapes`, `pairMeasure`, `unionBox`); `KernelApi.inspect`
  (`service.ts`, `worker-api.ts`, `browser.ts`, `Recomputer`); the app's
  `apps/web/src/measure/` (`inspection.ts`: `useInspection`,
  `createMeasureSelect`; `format.ts`; `MeasurePanel.tsx`;
  `MeasureOverlay.tsx`), the status bar's size readout
  (`shell/Timeline.tsx`), the Measure tool (`I`, Solid › Inspect and 3D
  Print › Prepare).
- **Builds on:** ADR-0001 (the facade owns OCCT memory), ADR-0024 (the
  engine's latest body shapes, as export uses them), ADR-0026 (topology
  items in the session selection, picking), ADR-0027 (a floating panel
  on the right of the view).
- **Affects:** FR-3DP-02 (mass and filament: `properties` has the
  volume), FR-3DP-04 (place on bed: planar normals), P3 construction
  geometry (measuring to planes and axes), sketch measuring.

## Context

FR-3DP-01 asks for measuring distance, angle, radius, area and volume,
and an always-visible size of the selection's bounding box. The display
mesh is on the UI thread, but it is a tessellation: its box of a
cylinder is up to the deflection too small, its areas are the triangles',
and it knows no radii or axes. The kernel had `distance` (a number),
`measure` (volume, area, a loose box: `BRepBndLib::Add` uses the
triangulation and adds tolerances; extrude relies on it and on its speed)
and `edgeGeometry` (a circle's centre, axis and radius), but nothing for
a face's surface or a closest point.

## Decision

1. **Measurements come from the kernel's exact geometry**, never the
   display mesh. `KernelApi.inspect(targets)` takes topology items
   (`{ kind, body, index }`, the mesh's indices, as picked) of the last
   finished recompute (`RecomputeEngine.latestBody`, like export) and
   returns an `Inspection`: each item's measures, the box around them
   all and, for exactly two, a `PairMeasure`. It rejects when a body is
   gone; the UI shows the message.
2. **Three facade changes, no new bound classes.** `distance` also
   leaves the closest points in `geometryNumbers` (both the inner
   shape's point where one is inside the other). `properties(shape)`
   gives volume (only for shapes with solids: `VolumeProperties` of a
   bare face is a signed cone volume), area (faces), length (edges of a
   shape without faces), a centre of mass (volume, else area, else
   length, else the vertex) and a tight box from
   `BRepBndLib::AddOptimal(shape, box, false, false)`. `measure` keeps
   its fast, loose box for extrude. `surfaceGeometry(shape, face)` gives
   the surface type (describe's codes) with a plane's point and normal
   out of the face (reversed faces flipped), a cylinder's, cone's,
   torus's and revolved surface's axis (canonical sign), a sphere's or
   torus's centre, radii and a cone's half angle.
3. **Per item:** a body's volume, area and centre; a face's type, area,
   radius and diameter (cylinder, sphere), major and minor radii
   (torus), half angle (cone), normal (plane), centre; an edge's type
   (line, arc, circle, ellipse), length, radius and diameter, sweep for
   arcs, centre; a vertex's position. Each has its exact box.
4. **Between two** (`pairMeasure`, pure, tested without OCCT): the
   minimum distance with its closest points and their ΔX, ΔY, ΔZ; an
   angle where both have a direction (line edges, circle and round-face
   axes as lines; planar faces as planes): line–line and plane–plane
   0–90°, line–plane the complement of the angle to the normal; two line
   edges sharing an end give the corner's angle, 0–180°. A **centre
   distance** where both have a centre or an axis (vertex, circle,
   sphere, torus centres; cylinder, cone and revolved-face axes): point
   to point, point to axis, or parallel axes (skew axes: none); left out
   when it equals the distance. More than two items get totals (volume
   of bodies, area of faces, length of edges).
5. **The status bar shows the selection's size** ("2 faces · 75.00 ×
   20.00 × 20.00 mm ·") whenever the model selection has topology: the
   shell asks the kernel on each selection or model change
   (`useInspection`, stale answers dropped). It is idle in sketch mode
   and while a feature dialog is open.
6. **The Measure tool** (`I`) is a mode like Project: the session's
   `activeTool` is `measure`, the toolbar tile is pressed, the nav bar's
   Select is not, Esc or Close ends it (the selection stays). It uses
   the model selection itself, so highlights, the filter and "Select
   other…" work as always, with one change to clicks
   (`createMeasureSelect`): a plain click adds until two things are
   picked, and the next one starts again with itself, so two clicks
   measure between two things; Shift toggles, empty space clears. A
   panel on the right (where feature dialogs open) lists the sections
   in the document's unit and precision; a dashed line with a distance
   label joins the closest points in the view, a fainter one the
   centres. Starting a feature dialog or a sketch ends it.

## Consequences

- One kernel round trip per selection change; a box select of hundreds
  of edges measures each (cheap, but not free). ~~No debounce yet.~~ The
  status bar's question waits 150 ms for a still selection since P3-17.
- Values are shown only; nothing is stored in the document (no
  persistent measurements or driven dimensions).
- ~~Sketch curves, profiles, origin planes and axes can't be measured
  yet: the panel says so. Construction geometry (P3-05) and sketch
  measuring should add them through the same `Inspection`.~~ Done in P3-17
  (amendment below), except profiles.
- The facade change is a new OCCT input hash (built locally and by CI).

## Rejected

- **Measuring on the UI thread from the display mesh**: fast and
  synchronous, but boxes and areas of curved faces are off by the
  deflection, and it has no radii, axes or closest points.
- **Changing `measure` to the tight box**: extrude's through-all and
  to-object logic calls it per evaluation; `AddOptimal` is slower on
  B-spline faces and would change its golden tables for nothing.
- **A feature-dialog spec for Measure** (selection fields, no OK):
  dialogs pick into persistent references and commit a command; Measure
  wants the plain selection and never commits.
- **Two dedicated selection slots (Fusion's "Selection 1 / 2")**: the
  session selection already has order, highlight and pruning after
  recomputes; a click rule on top of it was enough.

## Amendment (P3-17)

- **Sketch entities and origin geometry are measured on the UI thread**
  (`measure/analytic.ts`), not by the kernel: their geometry is exact in
  the document (sketch coordinates in a frame, `sketchFrame`) or in the
  kernel's construction reports, and the kernel has no shapes for them
  (sketch evaluators return faces, origin geometry isn't a shape). A
  sketch point is a `vertex` item, a curve an `edge` item (line, circle,
  arc, ellipse; a spline as `other`; lengths of ellipses and splines from
  their polyline); origin and construction axes and planes are two new
  unbounded `ItemMeasure` kinds, `axis` and `plane`, which `pairMeasure`
  takes for angles and centre distances (an axis is a centre line).
  Construction points are vertices.
- **Distances between them are computed here** (`closestBetween`) for
  points, straight segments, axes and planes in any mix, which also covers
  a body's vertex or straight edge (the kernel's item has its ends). A face,
  a body or a curved edge on either side has no distance without OCCT:
  the pair then shows only the angle and the centre distance
  (`MeasuredPair` has an optional distance, the panel and the in-view line
  leave it out). Exact distances from sketch curves to faces would need
  the facade to build edges from sketch data; left for later.
- `measureState` merges the kernel's answer and these items in selection
  order, with labels (`pickName`: "Line · Sketch1", "X axis"); it needs no
  kernel round trip when nothing of a body is selected. The status bar's
  size includes sketch entities' boxes; axes and planes have none.
- **Debounce**: outside the Measure tool, `useInspection` waits
  `SIZE_DELAY_MS` (150 ms) after the last selection change before asking
  the kernel; inside it, it asks at once.

