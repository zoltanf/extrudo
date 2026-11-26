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

- **A STEP file is read by its exact geometry; faces given as triangles.** A face can hold a
  triangulation and no surface (AP242 tessellated geometry in STEP; OCCT's B-rep text). The rule:
  a STEP file is read by its exact geometry; a tessellated copy of a part that also has exact
  geometry is ignored; a file with a part given only as triangles is refused with a message; no
  body has a face without a surface.
  - Every STEP read (`readStep` and the colour, name and hidden-solid readers, which read the same
    way so their counts and order still match `readStep`'s solids) reads with OCCT's
    `DESTEP_Parameters::ReadTessellated = RWMode_Tessellated_OnNoBRep` (`stepReadParameters`; the
    rest as OCCT's `read.step.*` values give it) and, before the transfer, takes out of the file's
    representations every tessellated item linked to the exact geometry it copies
    (`dropTessellatedCopies`: a `TESSELLATED_SOLID` with its geometric link, a
    `TESSELLATED_SHELL` with its topological link, a tessellated face with its geometric link, or a
    tessellated solid or shell made only of such faces).
  - What OCCT's three settings do, read in the OCCT sources of the build toolchain image this
    repository builds with (`@libcascade/toolchain` 3.1.0; `STEPControl_ActorRead`,
    `StepToTopoDS_TranslateSolid`/`Face`) and tried on hand-written files: `Off` leaves out a
    tessellated shape representation (a part given only as triangles is left out without a word),
    but still reads tessellated items among a B-rep representation's own items: a linked copy there
    puts its triangles on the exact faces, and a lone triangulated face there is read as a face
    without a surface. `On` (OCCT's default) puts a linked copy's triangles on the exact faces, and
    reads a copy in a representation of its own as the part's solid once more (the part twice).
    `OnNoBRep` leaves the exact faces without the file's triangles, but still reads a linked
    tessellated solid as the solid it links to (the part twice again) and a copy the file lists
    before its solid as faces without a surface. With the copies taken out first, the part is read
    once, by its exact faces with no triangles from the file, in each of those layouts and orders.
  - `readStep` then refuses a shape with any face without a surface, in a solid, a shell or on
    its own (`hasSurfacelessFace`): "STEP import failed: the file gives at least one face as
    triangles, not as a surface. Export the part again with its surfaces, or export it as STL or
    3MF and import that as a mesh." The import feature shows it as its error, and the engine goes
    on. Such a face is left only where a part is given as triangles alone, or by a copy with no
    links (nothing in the file ties it to the part it copies).
  - The import centres by what becomes bodies (`bodiesBox`, `features/import.ts`): the whole shape,
    or with two or more solids (one body each, `splitSolids`, which leaves the rest out) the solids
    alone, so a file's free faces, wires or points beside them don't move the bodies.
  - `readBrep` (the FreeCAD import's stored shapes) refuses a solid or shell with such a face
    (`hasTriangleFace`: "B-rep import failed: a face of a solid or shell is given as triangles,
    not as a surface.") and reads a lone one. A stored shape becomes a body only through
    `storedShapeToStep`, whose STEP `readStep` reads, and refuses when such a face is in it.
  - A lone such face is measured by its triangles: `describe` gives it as `other`, with its area
    and centre and no direction; `measure` bounds it by its triangulation; `properties` adds its
    triangulation's points (`addSurfacelessFaces`; the test face 0 … 10 × 0 … 10 × 0 … 5, where the
    file's location puts it), with faces that have a surface the union; a shape without faces and
    a face with a surface are bounded as before. Every reader of the exact box goes through
    `Kernel.properties` (the Measure tool, the status bar and print aids through `inspect`, parts
    lists, the agent host's bodies, the interference result, the import's centring, the FreeCAD
    import's stored-shape measures, the pivots of Move and Scale (`centreOf`) and Place on Bed).
  - The facade calls that take one face by its index and build a surface adaptor on it
    (`surfaceGeometry`, `faceSilhouettes`, `threadFace`, `coneFace`, `faceHit`, `faceSlab`,
    `projectOnFace`) answer such a face with "The face has no surface, only triangles." (the
    Emboss calls with "Emboss failed: " before it); `wholeFace` and `edgeNormal` already answer
    false for it. The calls over a whole shape (booleans, fillets, meshing, sections, hidden
    lines, `tangentFaces`) don't check: no body has such a face.
  - Fixtures: `fixtures/imports/tessellated.step` (a tetrahedron given only as triangles),
    `tessellated-mixed.step` (a box with surfaces beside such a part), `tessellated-copy.step` (a
    red box named Box with surfaces and a `TESSELLATED_SOLID` copy linked to its solid and faces),
    `tessellated-stray.step` (a box with surfaces and a lone `TRIANGULATED_FACE` in a part of its
    own).
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
- **Checked:** compared once, outside the repository, main's code and build against this
  amendment's: the 64 designs in `fixtures/` recomputed from scratch give the same bodies, versions,
  statuses, reports, meshes bit for bit, and the same `inspect` of every body; none of them imports
  a STEP file, so 66 STEP files (the two STEP fixtures, and each design's bodies exported with part
  names, colours, a group and a hidden part; 61 with bodies, 85 bodies, 20 files with two or more)
  imported as designs, placed as in the file and centred, give the same bodies, versions, meshes,
  statuses, reports (names, colours, hidden) and `inspect`. The feature goldens are unchanged.
  Tests: `import.test.ts` (refused with the message, no body, and the same engine computes the next
  design: the tetrahedron, the box beside it, the box with a lone `TRIANGULATED_FACE`,
  `TRIANGULATED_SURFACE_SET` or triangulated face among its own items, and two solids with a lone
  face; the copy file and the same copy among the box's items import as the file without it, and the
  colour, name and hidden readers agree; a copy with no links is refused; two solids and a free face
  100 mm off are centred by the solids), `measure-box.test.ts` (the B-rep reader refuses a shell
  with such a face, directly and through the FreeCAD import's stored-shape functions; a STEP file
  written from a box and a lone such face is refused; the one-face calls answer such a face with the
  message; `describe` of a lone such face; its box, placed or not; both kinds; a shape without
  faces; wires and free edges keep their `measure` box after meshing, fine or coarse),
  `construction-more.test.ts` (the plane before, number for number; after drawing coarse, at the
  view's tessellation and finer; the body's triangle count). Taken out: with the build before this
  round's facade change (`occt-998c7cd40597`) the refusal, copy, one-face and written-STEP tests
  fail; with the build that has OnNoBRep but not `dropTessellatedCopies` (`occt-40ea4d52efaa`) the
  copy test fails; the centring test with the whole shape's box; the box tests with the build before
  this amendment; the fine-drawn and triangle-count tests with the body meshed in place; the wires
  test with the build before the amendment of 2026-11-24 (`occt-8bd8ae5125b7`: a helix's box changed
  after meshing).

## Amendment (2026-11-25): a kernel call never changes the shapes it is given

- **The rule.** No kernel call changes a shape it is given: an edit hands the features bodies (and
  sketches' profile faces) from the recompute engine's cache, so a call that wrote to its
  arguments left the cache different from a recompute from scratch. One exception: `mesh` (and
  the meshing inside a few calls) adds a triangulation to the faces, or replaces one. No box
  reads it since the amendment of 2026-11-24 (every box comes from the geometry); display meshes
  and `hlrPolySpans` do, and a result inherits its inputs' triangulations (the copies share
  them), which is why a body is never meshed in place for a result (the amendment above on the
  tangent plane) and the view meshes every body at one tessellation.
- **What wrote.** OCCT's boolean builders, in the mode the facade uses (the default, not the
  non-destructive one), raise an argument's vertex or edge tolerance in place where the other
  operand meets it within tolerance (`BOPAlgo_PaveFiller::UpdateVertex`, `UpdateEdgeTolerance`,
  OCCT 8.0.1 `BOPAlgo_PaveFiller_10.cxx`). Seen: a plate whose corner lies on a torus's inner
  equator, cut from it, left the plate's corner vertex with a tolerance of 1.000001e-6 (it was
  1e-7); the plate's bottom cap is its sketch's profile face, which the engine keeps, so the next
  edit's prism started from the raised vertex and a join over the torus gave a body 1e-12 mm
  larger in `measure` than a recompute from scratch. The same mode is in OCCT's section, so a
  section through a body's vertex raised the body's tolerances. OCCT's fillet and chamfer builder
  writes a vertex of the shape it is built on (`ChFi3d_IndexPointInDS`, `ChFi3d_Builder.cxx`);
  no test input was found that changes a value there.
- **The change** (`extrudo_facade.cpp`): the plain boolean (`finishBoolean`, every fuse, cut,
  common and split) runs on copies of its arguments, both made in one copy (`copyTogether`) so
  that what they share stays shared; `sectionWithPlane` and `facesMeetPlane` section copies;
  `fillet` and `chamfer` build on a copy of the body. The copies are new sub-shapes (where
  tolerances live) over the inputs' own curves, surfaces and meshes (`BRepBuilderAPI_Copy`
  without copying the geometry), so results, histories and names are what they were. Copying the
  geometry too gives every face its own copy of its surface (`BRepTools_CopyModification::
  NewSurface`): two faces on one closed surface that meet at its seam (a thread's root pieces)
  then stop sharing it, the edge between them no longer reads as closed (`BRep_Tool::IsClosed`,
  ADR-0008 §8), and the view drew it: on the bottle cap benchmark 11 such edges at the threads'
  root came out drawn and pickable, a stray line on each root band. With topology-only copies
  the 64 designs in `fixtures/` give the same bodies, versions, statuses, reports, meshes (edge
  flags included) and `inspect` of every body as main's build, bottle cap included. Rejected:
  the builders' non-destructive mode, which keeps the arguments but leaves the result's edges at
  their old tolerances (it skips `UpdateEdgeTolerance` for shapes that aren't new), so results
  change; the facade dropped it before for that (a fillet after a cut ran forever on two designs).
- **Cost:** no time cost measured; memory was not measured (a boolean's result no longer shares
  the sub-shapes of faces it left untouched with its input: it has the copy's, over the same
  geometry and triangulations). Each feature of the 64 designs timed from scratch (the fastest of four
  runs, main's build → this): the heaviest booleans, the bottle cap's two threads, 6,290 →
  6,263 ms and 1,270 → 1,266 ms; the largest increase of any feature 1.9 ms (a loft, 140 →
  142 ms); all 180 features 11,237 → 11,175 ms. The benchmarks recomputed from scratch and the
  edits of `add-access.test.ts`'s designs are within ±3 % (the spool holder, 40 runs each:
  median 94.8 → 94.0 ms).
- **Not changed:** prisms and revolves add a p-curve of each profile edge on the side face they
  make to that edge (`BRepSweep_Translation.cxx`, `BRepSweep_Rotation.cxx`, at the default
  tolerance), a sketch's cached profile face included. No result reads them: the same face
  extruded fresh, or after a revolve and another prism used it, gives the same prism and the
  same cut with it, bit for bit, boxes included (`arguments-unchanged.test.ts`).
  They add up on a cached profile face used again and again until its sketch is recomputed;
  that was not measured. The offset, shell, draft and face-removal calls, emboss, and the
  simplifying booleans (every Join) already worked on copies (OCCT repairs its input in place
  there); those copies copy the geometry too and were left as they are, so the seam finding
  above was not checked for them.
- **Open** (when this was written; settled by the amendment below): the calls the test below
  didn't list, a tapered prism's loft path, and the halves of a split after a plain boolean.
- **Tested:** `arguments-unchanged.test.ts`: the kernel calls in its list (the booleans plain
  and simplified, the splits, the sections, distance and proximity, the hidden-line calls,
  `mesh`, `exportMesh`, `transform`, `scale`, `locate`, `writeStep`, the one-face and one-edge
  queries, `fillet`, `chamfer`), on inputs that make OCCT's booleans raise tolerances, leave each
  input as it was (the box of every face, edge and vertex
  alone, each enlarged by its own tolerance, and the description); with main's build the plain
  booleans, the split and the two sections through a vertex fail; the fillet and chamfer entries
  pass on both builds, so their copies rest on OCCT's source alone. `cached-body-unchanged.test.ts`:
  a torus or a loft, a plate cut from it or intersected, then edited to a join, with a "through
  all" after: the engine that kept its cache gives a cleared engine's result, every mesh bit for
  bit and every body's `measure` box; with main's build all four fail. `features/thread-seams.test.ts`: the
  bottle cap's two threaded bodies keep their seam edges by name (no golden records edge flags);
  it fails with the copies that copy the geometry.

## Amendment (2026-11-26): the calls left open

- **Checked now** (`arguments-unchanged.test.ts`, each call must compute with its inputs, so a
  refusal can't pass for "unchanged"): `revolve`; a tapered `prism` over lines (its draft path),
  over an ellipse and over a closed B-spline (its loft path, `taperLoft`); `loft` (smooth, ruled,
  to a point); `sweep` along sketch lines, twisted and scaled, and along a body's edge;
  `threadSweep`, straight and tapered; `wrapOnCylinder`; `wrapOnCone`; `filletVariable`;
  `shellFaces` (a shell with a wall set); the STEP writer with a colour (`writeStepXde`) and with
  a group (`writeStepAssembly`). Profiles are sketch faces (`planarFaces`), as a sketch's cached
  profile face reaches these calls; paths are sketch wires (`path`) or a body's edge.
  `offsetProbe` is left out: no `Kernel` method reaches it (the facade's tests and the spike
  harness only).
- **What the comparison sees, and what it doesn't.** The box of every face, edge and vertex,
  each enlarged by its own tolerance, and the description (sub-shapes, their types, sizes and
  neighbours): a tolerance raised or re-set, a sub-shape moved, added or taken away. Not: a
  p-curve added to an edge, an edge's continuity (regularity) record, triangulations and polygons
  on edges, a shape's flags. The facade has no cheap second view of those: it writes no B-rep
  text (only `readBrep` reads it) and no call lists an edge's curve representations (either would
  be a facade change). So each call is also checked by what it would change downstream: its
  profile, path or body, used by the call, then used again, against a fresh one made the same way.
  Profile: a prism of it, a cut of that prism, a revolve, a loft to a small circle and a sweep along
  a line from its middle. Path: a sweep along it. Body: itself and a cut of it. Results compare bit for
  bit (the description and boxes, `measure`, `properties` and the mesh of a copy; a refusal by its
  message).
- **What wrote.** The tapered prism's loft path. Over an ellipse or a spline it re-set the profile's
  vertex and edge tolerances in place: 1e-7 became 1.0000000000000002e-7. Every later prism, cut,
  revolve, loft and sweep of that profile then carried the same value on the sub-shapes it shares
  with the profile, so their boxes per sub-shape differed from a fresh profile's by that much
  (`measure`, `properties` and the meshes did not). Which of its steps writes (`ThruSections`,
  built with its input mutable, or the sewing of the profile face into the solid) was not
  narrowed down. Everything else on the list leaves its arguments as they were, and nothing
  downstream of them differs.
- **The change** (`extrudo_facade.cpp`, `prism`): the loft path takes a topology-only copy of the
  profile (`BRepBuilderAPI_Copy(base, false, true)`, as the booleans do since the amendment
  above). The copy keeps the sub-shapes' order, so the history's indices are the profile's. With
  main's build the two loft-path entries of each test fail; with this one every entry passes.
- **From scratch:** the 64 designs in `fixtures/` give the same bodies, versions, statuses,
  reports, meshes (edge flags included) and `inspect` of every body as main's build.
- **Cost:** none seen. A tapered prism of 10 mm at 0.1 rad, the median of five batches of 40 after
  10 to warm up, two runs each (main's build → this): over a 20 × 10 mm ellipse 98.0, 98.4 →
  94.6, 94.2 ms; over a closed B-spline 1,135, 1,128 → 1,135, 1,110 ms.
- **The halves of a split, then a plain boolean** (a probe, not a test: it needs two builds). Split
  Body's two halves are two `common`s of the body. A box 40 × 30 × 20 mm, the test part (a box with
  rounded vertical edges and a hole) and a torus, each split at x = 3, a 4 mm cube cut from one
  half or its first edge rounded (0.5 mm), then the halves fused, on the build before the amendment
  above and on main's. The halves, the cut half and the rounded half are the same on both, and so
  are the box's and the torus's fusions. The test part's halves shared two edges on the earlier
  build and share none now (each `common` runs on its own copy). Its fusion after the cut, and
  after the rounding, has the same faces (types, areas, counts) and is valid on both, in another
  order, its volumes 4e-12 mm³ apart (22840.17702849743 and 22840.177028497426 mm³). Face names come from
  the history, so they don't move with the order. The 64 designs have no plain boolean between
  such halves and are unchanged (above). Left as it is.
- **`hlrPolySpans`** meshes a face that has no triangulation, in place, at the linear deflection
  it is given and 0.5 rad. A body meshed that way first keeps that triangulation in its later
  display mesh: the test part gives 244 triangles where a fresh one gives 360 at the view's
  tessellation (0.05 mm, 0.3 rad). The engine's quick drawing view meshes every body at the view's
  tessellation first (`sheetView`), so a body it draws keeps its display mesh, and a body that
  reached it unmeshed (its mesh held by the app, `have`) gets the display mesh a fresh engine gives.
  Both are tests now (`arguments-unchanged.test.ts`; the engine's fails without that loop). It
  stays exempt like `mesh`: making it work on a copy would mesh every body for every quick view,
  and passing it the view's angle is a facade change for a path the engine already covers.
