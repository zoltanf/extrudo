# ADR-0031: Sketch on face and Project

- **Status:** Accepted, 2026-09-28
- **Task:** P2-09 (sketch on face and project/include; FR-SK-01 faces,
  FR-SK-12). Code: `faceSketchFrame` and `fingerprintFrame` in
  `packages/core/src/sketch/planes.ts`; `SketchData.projections`,
  `ProjectionId`, `sketchIssues` checks in `sketch/schema.ts`;
  `packages/core/src/sketch/projection.ts` (`ProjectedCurve`,
  `SketchReport`, `projectedEntities`, `addProjection`, `projectionSync`,
  `syncProjections`); `forgetRemovedProjections` and the refusal of edits
  to projected geometry in `sketch/commands.ts`; `GeomRef` schemas moved to
  `packages/core/src/refs.ts`; `ModelState.sketches`. The facade's
  `edgeGeometry` and `faceSilhouettes` in
  `packages/kernel/occt/facade/extrudo_facade.cpp`,
  `Kernel.edgeGeometry`/`faceSilhouettes`/`decodeEdgeGeometry` in
  `kernel.ts`, the sketch evaluator (`src/features/sketch.ts`:
  `sketchFrame`, `projectAll`, `projectSource`), the projection maths
  (`src/features/projection.ts`), `FeatureOutput.report` and
  `RecomputeResult.reports` (`recompute/types.ts`, `engine.ts`), the
  `Recomputer` filling `ModelState.sketches`. The solver holds projected
  geometry fixed (`packages/sketch/src/solver/mapping.ts`). In the app:
  `sketch/frame.ts` (`sketchFrame`), `sketch/facePick.ts`
  (`sketchTargetAt`, `originPlaneAt`, `isFlatFace`), `sketch/project.ts`
  (the Project tool), `ToolHost.syncProjections`
  (`sketch/tools/host.ts`), `PlanePicker.faces` and
  `useSketchTargetInput` in `viewport/Viewport.tsx`, projected curves in
  `viewport/sketchGeometry.ts` and `Sketches.tsx`, the shell's wiring in
  `shell/AppShell.tsx`, the extrude proposal for profiles on faces
  (`features/extrude.ts`). Tests: `core/src/sketch/projection.test.ts`,
  `kernel/src/features/sketch-on-face.test.ts`, `projection.test.ts`,
  `memory.test.ts`, the solver's projected-geometry test,
  `apps/web/src/sketch/facePick.test.ts`, `sketch/tools/projection.test.ts`,
  `e2e/sketch-on-face.spec.ts`.
- **Builds on:** ADR-0005 (persistent names, `ctx.resolve`, fingerprints),
  ADR-0010 (the plane is a `ref` input; sketch data is 2D and stored
  solved), ADR-0011 (fixed geometry as solver constants), ADR-0020 and
  ADR-0025 (profiles from the stored curves), ADR-0024 (recompute,
  `bodyAccess: 'read'`), ADR-0026 (3D picking), ADR-0027 (the preview base),
  ADR-0030 (`DocumentState.amend`).
- **Affects:** P2-07 revolve (reads a sketch line's 3D position through
  `SketchOutputData.frame`, which now also holds for sketches on faces),
  P2-11 ("fix references" for lost faces and projections), P3-05
  (construction planes: the same frame channel), P4 (sketch slice, text).

## Context

Until now a sketch could only lie on an origin plane, whose frame is a
constant in core; the kernel refused faces ("This version of Extrudo can't
place a sketch on a face."). FR-SK-01 asks for sketches on flat faces that
follow the face when the model changes, and FR-SK-12 for projecting body
edges and faces into a sketch, associatively. Both need something the UI
thread never had: geometry the kernel knows (where a face is now, what an
edge looks like) while the sketch itself is solved and stored on the UI
thread (ADR-0010).

## Decision

### 1. The face frame rule

A sketch's plane stays a `ref` input; for a face it is the face's
persistent reference with its fingerprint (ADR-0005), never an `index:`
reference. Its frame follows one rule from the face's plane alone,
`faceSketchFrame(point, outwardNormal)`, which the kernel and the UI share:

- **Normal:** the face's outward normal.
- **Origin:** the world origin projected onto the plane. A sketch on a
  box's top face has the same x and y as one on XY, and the frame doesn't
  move when the face changes outline (a hole cut into it, a wider box). A
  centroid origin would shift every curve of the sketch whenever the face's
  shape changed.
- **Axes:** a face within 40° of horizontal (a floor or a roof) takes
  sketch X along world X, as the Top and Bottom views show it; a steeper
  face (a wall) takes sketch Y straight up the face (world Z projected), as
  the Front, Back, Left and Right views do. The other axis completes a
  right-handed frame. On the origin planes' normals this gives exactly
  their frames (ADR-0010), and Look At shows sketch X to the right.
- **Stability:** every tilt has to switch somewhere (there is no smooth
  choice on the whole sphere). The switch sits at 40°, away from the
  common 0°, 45° (chamfers) and 90°: a face whose tilt changes a little
  never flips its frame. Tests check orthonormality, handedness, the six
  view directions and that 0.1° more tilt turns the axes by about that much.

### 2. The kernel resolves the face and reports the frame

The sketch evaluator resolves a face plane with `ctx.resolve` (label "the
face to sketch on"), refuses a face that isn't planar any more ("The face
this sketch is on isn't flat any more…"), and takes its frame from the
description (centroid and outward normal). The frame goes out twice:

- `SketchOutputData.frame`, for later features, keeps its meaning: the
  sketch-to-world frame. Extrude reads the normal as before; P2-07's
  revolve reads sketch lines' 3D positions through it.
- `FeatureOutput.report`, a new optional field: plain JSON for the UI
  thread. The engine collects every computed feature's report into
  `RecomputeResult.reports`, and the `Recomputer` puts them in
  `ModelState.sketches` (keeping the old object when nothing changed). A
  sketch reports a `SketchReport`: `{ frame, projections }`.

A lost face fails the sketch with the naming service's message ("Can't
find the face to sketch on any more…"); a guess (fingerprint, split face)
is a warning, as for every reference.

### 3. The UI takes the kernel's frame, or the fingerprint's

`sketchFrame(feature, plane, reports)` in the app: an origin plane's
constant frame; else the kernel's reported frame; else the frame of the
reference's fingerprint (its centroid and normal at pick time). So a
sketch on a face draws and opens at once in a project just opened (before
the first recompute), and when the kernel has lost the face it still shows
where it was. Every place that used `planeFrame` goes through it: the
drawn sketches (hence the grid, the overlays, picking on the sketch plane
with `rayPlane`, profiles and model-mode picking), Look At (`SketchModeStores`
takes the model store), and the extrude manipulators (`DialogContext`
carries `sketches`). Export works in sketch coordinates and needs no frame.

### 4. Create Sketch on a face

While Create Sketch waits, the view picks faces and origin planes itself
(`PlanePicker.faces`, `useSketchTargetInput`): the flat face (all its mesh
triangles facing one way, `isFlatFace`) or the origin plane square under
the pointer, whichever is nearer along the pick ray (`sketchTargetAt`);
R3F's plane events are off then, so one handler decides. The face hovers
in the preselect tint like any face. A click asks the kernel for the
reference (`reference`, with its fingerprint) and creates the sketch if
the fingerprint is a plane; a curved face gets "A sketch needs a flat face
or a plane…". A single face selected before Create Sketch takes the sketch
at once (pre-selection); a curved one says why and waits for a pick.

### 5. Projections: records in the sketch, curves as entities

`SketchData.projections` (optional: no format bump, ADR-0003) maps a
projection ID (same ID space as entities, constraints and dimensions) to
`{ ref, curves }`:

- `ref` is the projected body edge or face, persistent, with fingerprint.
- `curves` maps a **source key** to the entity of the curve made from it:
  a face's boundary edges by their persistent edge names, its silhouette
  lines as `sil:<n>`, a projected edge as `edge`. A key whose value is
  `null` is a curve the user deleted; it doesn't come back.

The curves are **ordinary sketch entities** (lines, circles, arcs,
ellipses, fit-point splines with their points), so profiles (ADR-0020),
the kernel's faces (ADR-0025), inference and snapping, constraints,
dimensions, selection, export and the construction toggle all work on them
unchanged. What makes them projected is only their listing in a record
(`projectedEntities`):

- the solver treats them and their points as fixed, like `fix` (so the
  status shows them fixed and a drag can't move them);
- commands refuse to change them in place (`modifySketch` updates: trim,
  fillet…), with "Projected geometry follows the model and can't be
  changed here…"; deleting one marks its key `null`
  (`forgetRemovedProjections`), and the record goes with its last curve;
- they draw in the construct colour (brand §3.4 `sketch-projected`),
  dashed if made construction.

### 6. Associativity: the kernel projects, the app syncs

On every recompute the sketch evaluator resolves each projection's source
(`bodyAccess` is `read` when a sketch has projections, so edits upstream
re-evaluate it) and projects it straight along the sketch normal
(`projectEdge`), from exact geometry the facade gives
(`Kernel.edgeGeometry`: type, samples, and a circle's or ellipse's center,
axis, x direction, radii and angle range):

| Source | In the sketch |
|---|---|
| line | line (dropped when seen end-on) |
| circle or arc in a parallel plane | circle, or arc counter-clockwise in the sketch (ends swapped when the axis points away) |
| whole circle, tilted | ellipse, exact (major axis along the planes' intersection) |
| circle or ellipse seen edge-on | line between its extreme points (found analytically, not from samples) |
| partial tilted arc, ellipse arcs, B-splines, others | fit-point spline through the projected samples (24), or a line if they are collinear |

A face projects its boundary edges (seams left out: an edge whose only
face is this one) and its silhouettes: the facade's `faceSilhouettes`
finds the lines of a cylinder or cone where the normal is square to the
view (closed form in the surface's own frame), and clips each line to the
face by sampling it through `BRepTopAdaptor_FClass2d` and bisecting the
changes (so partial and trimmed faces work). Numbers are rounded to 1e-9
mm so the same model reports the same curves.

The report carries the curves by key. The **kernel builds faces from the
stored curves**, not the fresh ones: the stored sketch is the one whose
user geometry was solved against the projections, so it is consistent;
fresh projections with stale user geometry could leave gaps. The app then
catches the sketch up (`useEffect` in `AppShell` → `ToolHost.syncProjections`)
whenever a recompute of the **current** document (`ModelState.doc`)
reports something the sketch doesn't show:

1. `projectionSync` (pure, core) matches curves by key: a curve whose
   source is still there and whose type fits keeps its IDs and moves
   (constraints and dimensions on it stay); one whose type changed is
   replaced; one whose source went is removed with its constraints and
   dimensions (unless another expression uses such a dimension: then the
   curve stays frozen); new keys add curves. A lost source changes nothing.
2. `syncProjections` applies it, and the host solves that sketch so
   geometry constrained to the projections follows (a sketch that no
   longer solves keeps the solver's best, and its status shows the
   conflict; before the solver has loaded, the solve waits for it).
3. Both are **amended into the latest undo step** (`DocumentState.amend`,
   shared with ADR-0030's body names): they follow from the edit that
   moved the model, so one undo takes back the edit and its consequence.
   The new document recomputes once more; now the sketch matches and
   nothing else happens. The loop converges in one round.

The Project tool itself only adds the record (`addProjection`, "Project");
the curves arrive with the next recompute, a few tens of milliseconds
later, amended into the same step.

### 7. The Project tool

`P` (Fusion's key; free until now), in the Sketch tab's Create menu after
Spline; icon `project` (a face dropped onto a plane). It is a session tool
(`PROJECT_TOOL`), not a tool-host tool: it picks in 3D with the model's
picking (`useModelInput`), restricted to faces and edges by the field
filter, hover in the preselect tint, and a click projects the pick. Esc or
the nav bar's Select stops it. A source already projected into the sketch
is refused ("That's already projected into this sketch.").

A sketch can only use geometry made **before** it (`ctx.resolve` looks at
the bodies before the feature). While the tool runs on a sketch that later
features build on, the view shows and picks the bodies before the sketch
(the kernel's preview with `base`, as a dialog editing a feature does), and
the references come from that base.

### 8. Extrude proposes for profiles on faces

ADR-0028's open item: a profile of a sketch on a body's face now behaves
like the face in the press-pull proposal: drawn on a lid and pulled out, it
joins; pushed in, it cuts.

## Rejected

- **A frame stored in the sketch** (as a cache). Every upstream change
  would rewrite the document and re-evaluate everything after the sketch
  twice; the fingerprint already gives a frame for the moments before the
  kernel answers.
- **The face's centroid as origin**, or its longest edge as X. Both change
  when the face's outline changes (a notch, a fillet), and every curve of
  the sketch would move with them.
- **An X axis from world X everywhere.** Walls facing +Y would come out
  upside down (Y pointing down the wall) in the Back view.
- **Solving sketches in the kernel worker** (planegcs next to OCCT), so
  projections could re-solve during recompute. A second WASM in the
  worker, and the stored sketch would disagree with what the kernel drew
  until the app re-solved anyway; the amended sync keeps one solver and
  one source of truth.
- **Projected geometry as derived, unstored curves** (FreeCAD's external
  geometry with negative indices). Constraints, inference, profiles and
  export would all need a second kind of entity; stored curves with a
  record reuse all of it, and the solver just holds them fixed.
- **A marker on each projected entity** instead of the record. It would
  survive code that rebuilds `SketchData` objects, but duplicates the
  source for every curve of a face and can't remember deleted curves.
- **Projecting on the UI thread from the meshes.** Mesh edges are float32
  polylines: no exact circles, and no silhouettes.
- **OCCT's HLR (`HLRBRep_Algo`) for silhouettes.** Exact for any surface,
  but a new toolkit in the trimmed build and far more work per face; the
  closed form covers cylinders and cones, the common curved faces of
  printed parts.
- **A separate undo step for the sync.** Undo would take back the sketch's
  catch-up without the edit that caused it, and the next recompute would
  sync it again.

## Consequences

- The facade changed (`edgeGeometry`, `faceSilhouettes`); the OCCT input
  hash is now `585344a70679` (built locally with `pnpm occt build`; CI
  publishes the release on push). The native harness showed 0 bytes of
  heap growth between 300 and 1500 iterations; `memory.test.ts` runs both
  ops 1000 times on a cut cylinder.
- Every feature can now report JSON to the UI thread; the Recomputer keeps
  the reports' identity when they don't change.
- A sketch with projections reads the bodies, so it re-evaluates when
  anything before it changes (a sketch on an origin plane without them
  still doesn't).
- The Viewport region has `data-sketch-frames` ("<id>:<origin>:<normal>"
  per drawn sketch) and `data-sketch-projected` ("<id>:curves=4:x=…:y=…"
  per sketch with projected curves) for tests.
- The engine test that expected the face refusal now expects a lost face.

## Open

- ~~**Redefine the plane** of an existing sketch (after its face is lost,
  or to move it): P2-11's "fix references" flow.~~ Done in P2-11
  (Redefine Plane, ADR-0033).
- Silhouettes of spheres, tori and free-form faces (only cylinders and
  cones now); a sphere's outline is a circle, the others need HLR.
- ~~Projecting vertices (a point) and whole bodies (their outline); an
  "include" mode that copies without the link (Fusion's "break link").~~
  Done in P4-12 (the amendment below).
- ~~Intersection curves (Fusion's "Intersect"), and a sketch slice (the
  palette's Slice) through the bodies.~~ Done in P4-12 (the amendment
  below; the slice in §5).
- When a projected face is split by a later edit, keys by edge name change
  and those curves are replaced (their constraints go). Following edges
  through splits by related names, as `ctx.resolve` does, would keep them.
- ~~Sketches on construction planes (P3-05) use the same report channel.~~
  Done in P3-05 (ADR-0040).

## Amendment (P3-17)

**Offset follows a projected outline.** `chainOf` (`packages/sketch/src/modify/offset.ts`)
joins the ends of **projected** curves that lie in one place (within 10 nm) as
if a coincident constraint tied them, so Offset on a projected face outline takes
the whole outline (four sides, or lines and arcs of a rounded one), not one line.
Only projected curves are joined this way: two sketched lines that merely end at
one spot are still two chains. A projected outline has no tangent constraints,
so `offset()` adds a tangent constraint between the new pieces wherever two
projected neighbours (a line and an arc, or two arcs) run smoothly into each
other; without them a rounded outline's offset kept 8 freedoms. The benchmark
B2 now uses Offset instead of four hand-made dimensions (ADR-0039 item 2).

## Amendment (P4-12, 2026-10-06): every surface, vertices and bodies, Intersect, Include

The P4-12 backlog took four items of the Open list. Code: the facade's
`faceSilhouettes` (now with a `deflection`), `sectionWithPlane` and
`edgeVisibility` (`packages/kernel/occt/facade/extrudo_facade.cpp`);
`Kernel.faceSilhouettes`/`sectionWithPlane`/`edgeVisibility`,
`CurvePiece`, `decodeCurvePieces` in `kernel.ts`; `projectPieces`,
`joinArcs`, `projectPolyline`, `projectPoint`, `withoutRepeats` in
`src/features/projection.ts`; `projectBody` and `intersectSource` in
`src/features/sketch.ts`; core's `fitControlPoles` (`sketch/curves.ts`),
`SketchProjectionSchema.mode`/`linked`, `addProjection`'s `mode` and `linked`,
`includedCurves`, `includeProjection`, `includeLabel` (`sketch/projection.ts`)
and `DocumentState.amend(command, { relabel })`; in the app `sketch/project.ts`
(`INTERSECT_TOOL`, `isProjectTool`), `ProjectPanel` (`sketch/panels.tsx`) and
`ToolHost.syncProjections`. Native harness: `spikes/p4-12-project/`. Tests:
`kernel/src/features/project.test.ts`, core's `projection.test.ts`,
`curves.test.ts`, `stores.test.ts`, the app's `sketch/tools/projection.test.ts`,
`e2e/project.spec.ts`.

### 1. Silhouettes of every surface

`faceSilhouettes(shape, face, dx, dy, dz, deflection)` keeps the closed form for
cylinders and cones (§6) and sends every other curved surface through
**`Contap_Contour`**, TKHLR's contour finder: the very call `HLRBRep_Algo`
makes per face (through `HLRTopoBRep_DSFiller`) to find its outlines, but
without the projection and the hiding, which a sketch doesn't want: a
projection takes the visible and the hidden outline alike, and it wants the
curves **in 3D on the surface**, which the contour finder has before
`HLRBRep_Algo` flattens them. It gives three kinds of line, and the facade
returns them as they are:

- **analytic** lines and circles (`Contap_Lin`, `Contap_Circle`, the quadrics:
  a sphere's outline is exactly its great circle square to the view), cut where
  they leave the face (the line's vertices);
- **walked** lines (`Contap_Walking`, a torus, a B-spline face): the walk's own
  points, each a surface evaluation, so they lie on the surface;
- **restrictions** (`Contap_Restriction`): the contour runs along a boundary
  edge. Kept (as the edge's own curve) on a seam and where the face meets its
  neighbour smoothly, since no sharp edge draws that outline; left out on any
  other edge, which projects as an edge already.

The numbers are a list of pieces, shared with `sectionWithPlane`:
`[0, start xyz, end xyz]` a line, `[1, centre, axis, x, radius, first, last]` a
circle arc (counter-clockwise about the axis, `last − first = 2π` whole),
`[2, n, xyz × n]` a polyline, `[3, centre, axis, x, major, minor, first, last]`
an ellipse arc; the return value is the count. A polyline sampled from an edge
is within `deflection` (`CURVE_DEFLECTION`, 0.01 mm, through
`GCPnts_TangentialDeflection`).

In the kernel, `projectPieces` puts them in the sketch plane:

- **arcs of one circle or ellipse are joined first** (`joinArcs`: the union of
  their angles, a run that closes is the whole curve). The contour finder cuts
  a sphere's circle at the seam and, seen square to the seam, reports the seam
  twice: four half-circles for a sphere seen along Y (harness);
- lines and conics go through `projectEdge` (§6's table), so a sphere seen
  along the sketch normal is **one exact circle**;
- a polyline is split at sharp turns (over 30°: an outline seen along the view
  has cusps) and, when it closes, in two (closed splines arrived the same day
  in ADR-0063's amendment; fitting a periodic one to the samples is left open);
  each run is the **line or circle arc** its
  points lie on (within 1e-6 mm: a torus seen along its axis walks its inner
  equator, which comes out an exact circle of 15), or **one control-point
  spline** (`mode: 'control'`, ADR-0063) fitted to the samples within
  `FIT_TOLERANCE` (1e-3 mm) — `fitControlPoles`: least squares on
  `controlSpline`'s uniform knots, ends held, chord-length parameters corrected
  by projecting the samples back onto each fit, the pole count found by
  doubling and then bisection. At most 120 samples of a run are fitted (picked
  evenly): a fit takes 40–70 ms for 200–400 points before that cap. Not a chain
  of lines, and not a fit-point spline through hundreds of points (§6 keeps
  those for projected B-spline edges, 24 samples).

`ProjectedCurve`'s `spline` gained `mode?: 'control'`, and `projectionSync`
keeps a spline in place only when its mode matches.

### 2. Vertices and bodies

`addProjection` takes a **vertex** (one fixed point entity, key `vertex`;
`ProjectedCurve` `{ type: 'point', at }`) and a **body** (`{ kind: 'body', id }`,
picked through the body's browser row while the tool runs: the row calls the
active `modelSelect`, which the tool owns). A body projects as its outline seen
along the sketch normal:

- every **outline edge**: its two faces, at the edge's middle, face opposite
  ways along the view (strictly: a face seen edge-on is neither);
- every curved face's **silhouettes** (§1), keyed `sil:<face name>:<n>`;
- the **sharp edges that can be seen** from the sketch's side, through OCCT's
  hidden-line removal: `edgeVisibility(shape, dx, dy, dz)` runs `HLRBRep_Algo`
  (its projector's eye on the side the normal points to, so Look At sees what
  the sketch projects) and returns a flag sum per edge: 1 some of it is visible
  (`HLRAlgo_EdgeIterator` over its status), 2 an outline, 4 sharp (no seam, not
  G1 with its neighbour). Edges keep their names as keys.

**Visible edges only, not all sharp edges**: seen square to a face, a body's
hidden edges lie exactly under its visible ones (a box from above: the bottom
square under the top one), so "all sharp edges" stacks fixed duplicates on top
of each other, which profile detection and picking then fight over; obliquely
they clutter the outline with lines the user can't see in Look At. A partly
hidden edge comes whole (keys are edge names; a piece of an edge has none).
`withoutRepeats` drops a curve that repeats an earlier one (the same type and
points within 1e-6 mm: a silhouette along a boundary edge, a cylinder's
silhouette on its own smooth edge), first key kept — for faces too.

A lost body (`ctx.bodies` lacks its ID) reports `lost: true` and warns "Lost a
projected body…"; a mesh body warns with `MeshBodyError`'s own message.

### 3. Intersect

The tool `intersect` (Sketch › Create's menu after Project, **Shift+P**, which
is Offset Plane on the model — never offered together, like F — icon
`intersect`) picks faces and bodies (`INTERSECT_FILTER`) and adds a record with
**`mode: 'intersect'`** (`SketchProjectionSchema.mode`, absent = project,
`docs/file-format.md`). The sketch evaluator dispatches on it
(`intersectSource`): the facade's **`sectionWithPlane(shape, ox, oy, oz, nx, ny,
nz, deflection)`** is `BRepAlgoAPI_Section` of the face (alone, as a sub-shape)
or the body with the sketch plane, its edges in §1's encoding (lines, circles
and ellipses exact, else polylines), keyed `cut:<n>` in the section's order,
through the same `projectPieces`. It follows the model like a projection. A
cylinder cut by a plane at 45° is one exact ellipse of 14.142 × 10 (harness and
kernel test).

### 4. Include

The Project and Intersect tools have a panel ("Project"/"Intersect", in the
sketch's panel column above the palette) with **"Keep linked"** (default on;
session state of the shell). Off, `addProjection` stores the record with
`linked: false`; the kernel reports its curves like any projection; and
`ToolHost.syncProjections` then **amends** `includeProjection` into the step
that added the record: the curves become new plain entities (no `fix`, nothing
holds them, `projectedEntities` doesn't list them) and the record goes. The
amend **relabels the step** "Include <n> curves" (`includeLabel`;
`UndoHistory.amend(entry, relabel)`, `DocumentState.amend(command,
{ relabel })`), since only the report says how many there are. So an include is
one command on the host and one undo step, the report coming a recompute later
as for every projection. A lost source drops the record with nothing added.
`projectionSync` leaves `linked: false` records alone.

### 5. Slice (2026-10-07)

The palette's Slice is a section view while sketching: while a sketch is
open and the display setting `sketch.slice` is on (a preference beside
auto-project's, default off), the bodies are cut away on the camera's side
of the sketch plane, so a person sketching on a face inside a model sees
the plane. View state only — nothing in the document, nothing undoable,
like section analysis (ADR-0045) — and no kernel, facade, schema or
file-format change.

It is one more `SectionClip` in `useSection`'s list (ADR-0045), after the
person's own planes, so it is clipped, capped (`SectionCap`) and respected
by picking exactly as they are; `data-section-clip` lists it last,
`data-sketch-slice` says on or off while a sketch is open. With it on, the
person's own sections keep clipping in sketch mode too, ahead of it;
with it off, a sketch is still drawn without the section. The sketch's own
geometry, the grid, the origin and its glyphs stay unclipped: they are on
the clip plane, and a point on the plane is kept (`CLIP_EPS`), so the
auto-project snap still finds the body edges and vertices in the plane.

**The removed side is the side the camera is on** when the sketch opens or
Slice is turned on, and then it is frozen (the session's
`sketchSliceFlip`, reset by entering or leaving a sketch): orbiting to the
other side must not flip the cut under the person, which would lose the
very geometry they were sketching against. The next sketch, or toggling
Slice off and on, decides afresh.

*Rejected: a document setting* — the slice is about the person's view of
the model while they work, not about the design; like the section
analysis, it belongs to the session and must not change what the file
means, what undo holds or what a script sees.

### Harness results (`spikes/p4-12-project/`, `bash run.sh`, OCCT 8.0.1 in the pinned image)

- **Sphere r 10**: along +Z and (1, 1, 1) one exact arc of a whole turn on the
  great circle (radius 10.000000000, centre at the origin, axis along the view);
  along +Y, where the outline is the seam, four half-circles that cover one turn
  together (hence `joinArcs`). `HLRBRep_Algo`'s own outline of the same sphere,
  sampled 33 times, is within 1.8e-15 mm (3.6e-15 obliquely) of the exact
  circle: the contour finder's circle is the exact one. An upper half sphere seen
  from +Y: four quarter arcs covering half a turn.
- **Torus R 20 r 5** along its axis: the outer equator as exact arcs (it is the
  v-seam) covering one turn, the inner one walked: 201 points with |r − 15| +
  |z| ≤ 2.5e-14 mm. From the side (+Y, (0, 1, 1), (0.3, 1, 2)): 3–9 pieces, 409–646
  points, all within 2.3e-14 mm of the torus and with |n · d| ≤ 1.4e-15.
- **A lofted free-form body** (circle, tilted ellipse, circle; two B-spline side
  faces): one side face keeps n · d's sign everywhere and has no contour; the
  other gives 2–4 walked polylines, 413–434 points within 1.7e-12 mm of the
  surface; |n · d| ≤ 3.7e-13 obliquely, and 0.013 along Y where a restriction
  piece (a smooth boundary edge taken whole, as HLR takes it) is reported.
- **A 20 mm box with every edge filleted at 4 mm** seen along (1, −2, 1.5): 12
  pieces over its 26 faces, every point within 2e-15 mm of its face.
- **Sections**: a cylinder r 10 by a plane at 45° through z = 20 is one ellipse,
  14.142135624 × 10.000000000; a sphere at z = 6 one circle of 8; a torus by a
  tilted plane through its centre two polylines.
- **Visibility**: a 20 × 10 × 5 box from +Z: its four top edges seen, none of
  the bottom ones (and the reverse from −Z); obliquely (1, −2, 1.5) 9 edges seen,
  6 on the outline; at 30° about X 7 seen, 2 on the outline.
- **Leaks**: every call 100 and then 500 rounds, heap top unchanged (0 bytes).

### Consequences

- The facade changed (three methods, `faceSilhouettes`' signature), so the OCCT
  input hash is now `f25e8583481f` (release `occt-f25e8583481f`, built by CI);
  the build now pulls in TKHLR's contour finder and hidden-line removal (the
  toolchain links every library of the image, so `libcascade.config.ts` is
  unchanged): the WASM grew from 18.80 MB raw, 6.13 MB gzip, 4.26 MB brotli to
  **19.19 MB raw, 6.25 MB gzip, 4.34 MB brotli** (+388 kB raw, +0.08 MB brotli;
  Node's zlib at its best settings, as ADR-0037 measures).
- A face projection of a sphere or torus, which used to give its boundary edges
  only, now gives its outline too: an existing sketch gains those curves on its
  next recompute, under new `sil:<n>` keys (amended into the latest step, §6).
- The Rejected entry "OCCT's HLR for silhouettes" is reversed for the surfaces
  the closed form can't do; cylinders and cones keep the closed form.
- Projected splines (`mode: 'control'`) and points are ordinary entities: the
  solver holds them fixed, profiles cut them, export writes them.
