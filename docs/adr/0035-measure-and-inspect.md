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
- **Two dedicated selection slots (the usual "Selection 1 / 2")**: the
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


## Amendment (2026-11-04): a flat face's normal on a left-handed plane

`surfaceGeometry` took a plane's normal from its frame's axis, turned for a
reversed face. A plane whose frame is left-handed (`gp_Ax3::Direct()` false)
has its surface normal (X ^ Y) against that axis, so the "normal out of the
face" pointed into the body. Every plane of a mirrored body has such a frame
(a mirror flips handedness), and so do some chamfer slopes. Measured with
real OCCT: all six faces of a box mirrored in x, and the slope of two of
the three single-edge chamfers tried on a box.

- **Decision:** the facade's `outwardNormal(face, plane)` gives the plane's
  own normal (the axis, reversed for a left-handed frame), then turns it for
  a reversed face, the same normal `describe` already took from the surface's
  derivatives. `surfaceGeometry` and the facade's other sign-sensitive plane
  normals use it: Shell's wall-thickness checks (`wallThicknesses`,
  `explainShellFaces`) and the press-pull prism path (`prismOffsetGate`, its
  prism). Right-handed planes give the same numbers as before.
- **What changes for users:** Measure shows a mirrored or chamfered flat
  face's normal outwards; a Shell with a different thickness on a wall of a
  mirrored body works (it failed with "OCCT can't offset this body."); an
  Emboss on such a face grows outwards (it changed nothing, a Deboss
  reported that the cut removes nothing); a slider joint on such a face
  slides outwards for positive values, so an existing one on a mirrored or
  chamfered face reverses its direction.
- **Rejected:** fixing each caller in TypeScript from `describe`'s direction:
  it left the facade's own uses wrong and every new caller exposed.

## Amendment (2026-11-24): one box for features, the exact box for people

- **Context:** `measure`'s box came from `BRepBndLib::Add(shape, box)`, which bounds a face by its
  triangulation when it has one. Meshing a body for display (`mesh`) or for a sheet view
  (`hlrPolySpans`) leaves a triangulation on its faces, so the same body measured before and after
  it was drawn gave two boxes, and "through all" lengths and the box filters that find touching
  bodies, which read those boxes, made an edit's result differ from the same design just opened.
  A torus of outer radius 25 measured ±27.06 not drawn and about ±25.01–25.04 drawn; the filleted
  test part 40 not drawn and 40.011 drawn.
- **Decision: two kinds of callers, two boxes.**
  - **Boxes that feed a feature's result or an export's geometry** take `measure`'s box, now
    bounded from the faces' geometry with their tolerances whatever was meshed
    (`useTriangulation = false` on every `BRepBndLib::Add` in the facade). In OCCT 8.0.1 that is
    the path a face without a triangulation always took, so a recompute from scratch is unchanged
    and an edit now gives the same result. A face with no surface (one read from a file without its
    geometry) still uses its triangulation; a mesh body is measured by its own path and never
    gets here.
  - **Boxes a person sees, or that describe a body,** take `properties`'s box:
    `BRepBndLib::AddOptimal(shape, box, false, false)`, the exact extents from the geometry,
    without triangulations or tolerances (the torus ±25, a 40 mm box 40). It never depended on
    meshing and is never looser than a drawn `measure` box.
- **The facade's eleven `BRepBndLib::Add` calls, all A (a feature's or the kernel's own work):**

  | Facade call (`extrudo_facade.cpp`) | Reached from TypeScript |
  |---|---|
  | `measure` (:2641) | `Kernel.measure`, whose callers choose (below) |
  | `sweep`'s profile reach (:4205) | `Kernel.sweep` (the Sweep feature, through `namedSweep`) |
  | `projectOnFace` (:5054, :5055) | `Kernel.projectOnFace` (Emboss and Deboss on a face) |
  | `wrapOn` (:5556) | `Kernel.wrapOnCylinder`, `wrapOnCone` (Emboss wrapped) |
  | `rebuildPrismatic` (:11406, :11444, :11632) | Mesh to Solid's rebuild |
  | `rebuildHybrid` (:13308) | Mesh to Solid's rebuild |
  | `strandedTools` (:16307, :16312) | every boolean (`finishBoolean`: fuse, cut, common) |

- **`Kernel.measure`'s callers:**
  - A (keep `measure`): the features (their through-all lengths, touching-body filters, tool
    placement and ordering), the OpenSCAD export's "through all" (`scad-export/versions.ts`), the
    interference check's box filter (`interference.ts`: it only skips pairs whose boxes don't meet,
    and both boxes hold their bodies), the joint check's box filter (`joints/check.ts`, the same),
    the test features (`recompute/testing.ts`), and the test part (`test-part.ts`, built and
    measured before it is meshed; the debug page shows its volume).
  - B (now `properties`): the interference check's result box, which the agent's `interference`
    tool returns; the agent tests' stand-in host (`agent/kernelTesting.ts`), whose bodies' boxes
    now match the app's host, which already used `inspect`; and the feature tests that record a
    body's size (extrude, revolve, primitives, offset face).
  - Already B and unchanged: the Measure tool and the status bar's size (`inspect`), print aids'
    sizes (`inspect`), the agent host's bodies (`inspect`), parts lists (`properties`),
    `measureBodies` and the FreeCAD import's measures (`properties`). The view's own sizes
    (`data-bodies`, the fit and the camera bounds) come from the meshes, not the kernel.
- **What changes for users:** the agent's `interference` tool reports the exact box of an overlap
  (a torus inside a box: ±25, not ±27.06 or ±25.04). Nothing else a person is shown changes.
  Feature results computed from scratch don't change: the 64 designs in `fixtures/` give the same
  bodies, versions, statuses, reports and meshes bit for bit with the old and the new build
  (compared once, outside the repository). An edit over bodies already drawn now gives that same
  result. In the OpenSCAD export the bodies were already meshed when it measured them, drawn or not,
  so its "through all" numbers came from triangulations and now come from the geometry: for a slot cut through all of
  the chain-link benchmark, 71.5111553974 → 71.4000001063, the length the kernel's own cut uses;
  never drawn and drawn give the same export in both builds.
- **Cost:** `properties` costs about what `measure` does: over the 80 bodies of the fixtures, median
  0.60 against 0.61 ms, the slowest body (the coil benchmark's post, 27 faces) 212 against 196 ms,
  a sweep 62 against 12 ms. It runs on a person's request (an inspection, an interference check),
  not on every edit.
- **Left as they are (they use triangulations on purpose):** `hlrPolySpans` draws a sheet view from
  whatever triangulation a body's faces have, and `mesh` keeps a finer triangulation than asked.
  `hlrPolySpans` feeds no feature's result. `mesh` does in one place, not changed here: a
  construction plane tangent to a free-form face meshes that body in place (`construction.ts`,
  `meshTangent`), so its result can depend on a triangulation already on the faces.
- **Tested:** `measure-box.test.ts` (`measure` the same before and after meshing, a cylinder, a box
  and the test part; a New Body extrude "through all" over plates that were meshed equals a kernel
  that never meshed them; `properties` exact before and after meshing); `interference.test.ts` (a
  torus inside a box: the box reported is ±25); the feature goldens' boxes now exact: 689 numbers
  in four tables (extrude 498, revolve 165, primitives 16, offset face 10), each moved inwards to
  the exact extent (40.05 → 40, 15.01 → 15, 4.99 → 5, -0.02 → 0, a min of 12.9 → 13) and none
  outwards; no volume, area, count or name in them changed. Taken out, the measure-box tests fail
  on the old build, and the interference test with `measure`'s box.

## Amendment (2026-11-25): faces given as triangles, and the tangent plane's mesh

- **Faces given as triangles, not as surfaces.** A face can hold a triangulation and no surface
  (AP242 tessellated geometry in STEP; OCCT's B-rep text). The STEP reader (`readStep`) and the
  B-rep reader (`readBrep`, which reads the FreeCAD import's stored shapes) refuse a shape with
  such a face in a solid or a shell (`hasTriangleFace`). The STEP reader's message, which the
  import feature shows as its error: "STEP import failed: the file gives at least one face as
  triangles, not as a surface. Export the part again with its surfaces, or export it as STL or
  3MF and import that as a mesh." (`fixtures/imports/tessellated.step`, a tetrahedron given only
  as triangles, and `tessellated-mixed.step`, a box with surfaces beside it). So no body has such a
  face. A lone such face (in no solid or shell) is read and measured by its triangles: `describe`
  gives it as `other`, with its area and centre and no direction; `measure` bounds it by its
  triangulation; `properties` adds its triangulation's points (`addSurfacelessFaces`; the test
  face 0 … 10 × 0 … 10 × 0 … 5, where the file's location puts it), with faces that have a surface
  the union; a shape without faces and a face with a surface are bounded as before. Every reader
  of the exact box goes through `Kernel.properties` (the Measure tool, the status bar and print
  aids through `inspect`, parts lists, the agent host's bodies, the interference result, the
  import's centring, the FreeCAD import's stored-shape measures, the pivots of Move and Scale
  (`centreOf`) and Place on Bed).
- **The construction plane tangent to a free-form face meshes a copy** (`meshTangent`,
  `features/construction.ts`): `Kernel.transform` by the identity rebuilds the body (same faces in
  the same order, no triangulation), the copy is meshed at `MESH_NORMAL` and released. Meshing the
  body itself left the 0.01 mm triangulation on it, which its next display mesh kept (the test
  body drawn at the view's tessellation: 842 triangles, 3,870 after a tangent plane), and a
  triangulation finer than 0.01 mm already on it (a headless session's `tessellation` draws at
  that) was kept and changed the plane. Now the plane is the same, number for number, as before
  on a body never drawn, and the same after the body was drawn coarse, at the view's tessellation
  or finer; the body's triangulation is what it was drawn with. With that, no result reads a
  triangulation left on a body (`hlrPolySpans` draws sheet views from one, as before).
- **Checked:** the 64 designs in `fixtures/` recomputed from scratch with the old and the new
  build give the same bodies, versions, statuses, reports, meshes bit for bit, and the same
  `inspect` of every body (once, outside the repository; the old build twice). The feature
  goldens are unchanged. Tests: `import.test.ts` (both fixtures refused with the message, no
  body, and the same engine computes the next design), `measure-box.test.ts` (the B-rep reader
  refuses a shell with such a face, directly and through the FreeCAD import's stored-shape
  functions; `describe` of a lone such face; its box, placed or not; both kinds; a shape without
  faces; wires and free edges keep their `measure` box after meshing, fine or coarse),
  `construction-more.test.ts` (the plane before, number for number; after drawing coarse, at the
  view's tessellation and finer; the body's triangle count). Taken out: the refusal and
  `describe` tests fail with the build without the readers' check and `describe`'s case, the box
  tests with the build before this amendment, the fine-drawn and triangle-count tests with the
  body meshed in place, and the wires test with the build before the amendment of 2026-11-24
  (`occt-8bd8ae5125b7`: a helix's box changed after meshing).
