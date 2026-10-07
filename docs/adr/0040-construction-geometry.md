# ADR-0040: Construction geometry

- **Status:** Accepted, 2026-09-29
- **Task:** P3-05 (FR-FT-13). Code: `packages/core/src/construction.ts`,
  `packages/kernel/src/features/construction.ts` and `references.ts`,
  `apps/web/src/features/construction.ts`, `apps/web/src/viewport/Construction.tsx`
  and `constructionGeometry.ts`, `e2e/construction.spec.ts`.
- **Builds on:** ADR-0005 (naming, `ctx.resolve`), ADR-0024 (engine
  dependencies), ADR-0027 (dialogs), ADR-0029 (origin axes), ADR-0031
  (`faceSketchFrame`, sketch reports), ADR-0032 (plane picker), ADR-0033
  (timeline references).
- **Affects:** P3-06 (mirror planes, pattern axes), P3-07 (pattern axes),
  P3-08 (split by a plane), Phase 4 (sweep and loft paths).

## Context

FR-FT-13: construction offset plane, plane at angle, midplane, plane
through 3 points, tangent plane, axis (2 points, through a cylinder, along
an edge) and point, as features that sketches, primitives, extrudes and
revolves can use. The facade is closed to this task (Track A's), so
everything had to come from what the kernel already reports.

## Decisions

1. **Nine feature types, one per tool** (`offsetPlane`, `planeAtAngle`,
   `midplane`, `planeThroughPoints`, `tangentPlane`, `axisThroughPoints`,
   `axisThroughCylinder`, `axisAlongEdge`, `constructionPoint`), category
   `construct`, type equal to the tool ID like the primitives. Every input
   is optional in the schema; the kernel says what is missing. Picks that
   are lists (`points`, `planes`) are `ref` inputs with a count limit.
2. **A construction feature is referred to by its own ID.** A later
   feature stores `{ kind: 'plane' | 'axis' | 'point', id: <feature ID> }`.
   That needs no new ID scheme: the engine already turns a reference whose
   ID is a feature's into a dependency (`featureDependencies`), core's
   `referencedFeatures` sees it, so ordering, moves, "delete refused while
   used", Fix References and the cache keys work unchanged. The `point`
   reference kind, reserved in format 1, is now used
   (`docs/file-format.md` 6.10 and 8). Origin IDs (`origin:xy`) can't clash
   with a UUID.
3. **Pure arithmetic in TypeScript, no facade change.** Planes, axes and
   points come from `describe` (face centroids and normals, edge
   midpoints, vertices), `surfaceGeometry` (cylinder, cone, sphere, torus
   axes and radii), `edgeGeometry` (a circle's centre and axis) and sketch
   output (`SketchOutputData.lines`). Faces, edges and vertices resolve
   through `ctx.resolve`, so a lost one throws `LostReferenceError` and
   Fix References offers it. `bodyAccess` is `read` only when an input
   holds a face, edge or vertex (`usesBodies`), else `none`, so a plane
   through origin planes never recomputes on a body change.
4. **A plane's frame comes from its plane alone**: `faceSketchFrame(point,
   normal)`, the rule of a sketch on a flat face (ADR-0031). It reproduces
   the origin planes' frames for their normals, so an offset of XZ is a
   sketch plane with the same axes. The report also carries an `anchor`,
   a point of the plane near what it was made from, where the view draws
   the square (a face's centre, the middle of three points...). The
   frame's origin is the world origin projected onto the plane, so it can
   be far from anything.
5. **The kernel reports through `FeatureOutput.report`** (a
   `ConstructionReport`, also the `data` later features read). The
   `Recomputer` splits reports by shape (`isConstructionReport`) into
   `ModelState.sketches` and the new `ModelState.construction`; a preview
   carries the draft's report (`Preview.construction`), drawn in the
   preview colour while a dialog is open.
6. **Shared readers in the kernel** (`features/references.ts`: `planeOf`,
   `lineOf`, `pointOf`) serve the construction features, sketches
   (`plane` refs), primitives (placement), extrude ("to object" planes)
   and revolve (axes), so a construction plane or axis works anywhere an
   origin one did. In the app, `planeFrame(ref, construction)` and
   `sketchFrame(feature, plane, sketches, construction)` fall back to the
   report until the sketch's own arrives.
7. **Geometry choices.**
   - *Plane at angle*: the plane through a line, normal turned right-handed
     about it by the angle from the reference plane's normal projected
     square to the line (else the kernel's `perpendicular`, so 0° is as
     horizontal as it gets: XY for the X axis).
   - *Midplane*: parallel planes only; the same plane or non-parallel
     planes are errors.
   - *Tangent plane*: cylinders (touching line at the reference normal's
     direction turned by the angle about the axis), cones (through the
     apex, along a generatrix, normal `cos α·out − sin α·opening`) and
     spheres (facing the reference normal, else the polar axis; the angle
     is ignored). Tori and free-form faces are refused.
   - *Axis through a cylinder*: cylinders, cones, tori and faces of
     revolution; a circular edge gives the axis through its centre.
   - *Point*: at a vertex, construction point, circular-edge centre
     (another edge: its middle) or face centre (sphere or torus: its
     centre), or the origin, moved by X, Y and Z.
8. **View.** Construction geometry keeps a steady size on screen like the
   origin planes: planes are squares of 0.16 × the view size around their
   anchor, axes lines of 0.32 ×, points 8 px dots (`Construction.tsx`,
   `constructionGeometry.ts`). Picking is the view's own (`pickStack`):
   points like vertices (8 px), axes like the origin axes, planes where
   the ray meets their square, ranked after faces, profiles and axes and
   before bodies. Planes also join `sketchTargetAt`, so Create Sketch and
   every dialog Plane field (`planePicker.ts`, now string IDs and a list
   of selected planes) offer them beside the origin planes and faces;
   the Create Sketch panel lists them as buttons.
9. **Browser, timeline, keys.** The Construction folder lists the features
   (icon, eye, edit, rename, menu: `SketchLeaf` generalised) with a count
   and a folder eye; hover highlights the drawing. Chips take the tool's
   icon. Keys (declared only in `commands/keymap.ts`): `Shift+P` offset
   plane, `Shift+A` axis through 2 points, `Shift+X` point; the rest live
   in the Construct group's menu and Ctrl+K. The old placeholder tools
   `plane` and `axis` are gone. The Wall bracket template keeps its
   placeholder `plane` feature (Plane1, an error when rolled forward, as
   `e2e/recompute.spec.ts` expects); `toolForFeature` gives it the Offset
   Plane icon.

## Rejected approaches

- **Construction geometry as tessellated shapes through the facade**
  (a sheet face, a wire): needs new facade calls (Track A owns the facade
  this round), costs shapes and their disposal, and gains nothing: a
  plane, an axis or a point is a few numbers.
- **Storing the frame in the document.** Geometry is derived; stored
  frames would go stale when the reference moves.
- **A fixed frame per plane kind** (keeping the base plane's axes for an
  offset): a frame that depends on the whole chain breaks when a base is
  redefined. One rule, from the plane alone, was already ADR-0031's.
- **Origin planes picked by R3F events only.** The view's pick already
  ranks faces and planes by depth (`sketchTargetAt`); construction planes
  join that instead of adding a second event path.
- **Dashed axis lines** through `LineMaterial`'s dash options: the dash is
  measured in geometry units, which the steady-size scaling changes.

## Open items

- No "Point on path", "Point through two edges", "Plane along path" or
  midplane for non-parallel planes (Fusion has them); sketch points can't
  be picked as points yet (only vertices and construction points).
- Planes aren't box-selected, and can't be renamed by a click in the view.
- The kernel reports a plane's square as an anchor only: a plane through
  far-apart references is drawn near the middle, not around them.
- Tangent planes on tori and free-form faces, and an angle for spheres.

## Amendment, 2026-10-06 — P4-12's construction backlog

- **Status:** Accepted, 2026-10-06
- **Task:** P4-12 ("more construction geometry"): point on path, point through
  two edges, plane along a path, midplane of non-parallel planes, tangent
  planes on tori and free-form faces, planes in box selection.
- **Builds on:** this ADR, ADR-0047 (`pathFromRefs`), ADR-0018 (`pickBox`),
  ADR-0026 (the view's picking), ADR-0068 (the API generator).
- **Code:** `packages/core/src/construction.ts`,
  `packages/kernel/src/features/construction.ts`,
  `apps/web/src/features/construction.ts`, `apps/web/src/selection/pick.ts`,
  `e2e/construction.spec.ts`.
- **No facade change.** Everything comes from `describe`, `surfaceGeometry`,
  `edgeGeometry`, `closestPoints` and a fine mesh of a face (0.01 mm
  deflection), as in the original.

### Decisions

1. **Four new feature types** join the nine, one per tool, category
   `construct`, type equal to the tool ID (`pointOnPath`, `pointAtIntersection`,
   `planeAlongPath`, `midplaneAngled`). They make no body, use the same
   `constructionRef` (`{ kind: 'plane' | 'axis' | 'point', id: <feature> }`),
   dependency rules, `ConstructionReport`, view drawing/picking and browser
   folder. Two make a point, two a plane, so `constructionKindOf` just maps
   them.
2. **A path is the path pattern's.** `pointOnPath` and `planeAlongPath` take a
   `path` of sketch curves and edges in any order (`pathFromRefs`, ADR-0047),
   a `by` enum (`position`, a fraction of the path, default, or `length`), a
   `position` (unitless, default 0.5) or a `distance` (a length), and `flip`
   to measure from the far end. The kernel samples the path's polyline by arc
   length (`Path.at`), exactly the maths the path pattern has. A
   `planeAlongPath` plane's normal is the path's tangent there and its frame
   follows `faceSketchFrame` (decision 4 of the original), so the Sweep tool's
   sections can be sketched on it and the sweep places them where they were
   drawn.
3. **`pointAtIntersection`** takes `entities`, up to three references of kind
   `edge`, `plane` or `face`, and reads what they are:
   - two edges: the facade's `closestPoints` on the two **edge sub-shapes**
     (`Kernel.subShape`, in a `kernel.scope()` so they are released), the
     midpoint of the closest points; more than 1e-3 mm apart is an error
     naming the distance ("The two edges don't meet (0.8 mm apart).");
   - an edge and a plane/face: the edge's exact geometry crossed with the
     plane (`planeOf`): a line's ends, a circle's or an ellipse's analytic
     crossing (one `acos`), and a dense polyline (360 samples) for anything
     else; an error when it never crosses and when it lies in the plane;
   - three planes or flat faces: solved in TypeScript (the normals' triple
     product), an error when they share a line or a plane.
   Any other mix is an error saying what to pick.
4. **`midplaneAngled`** bisects two **non-parallel** planes or flat faces:
   the plane through their intersection line whose normal is `n1 + n2`
   (normalised), or the other bisector with `flip`. The two normals are
   **sorted by `(x, y, z)` before `±`**, so the same pair gives the same plane
   whichever face was picked first (the point is symmetric already). Parallel
   planes are refused with the existing Midplane's name in the message
   ("These planes are parallel. Use Midplane."), and the original `midplane`
   stays for the parallel case. The intersection line is found in TypeScript
   (a point on both planes).
5. **`tangentPlane` gained an optional `point`** (a construction point or a
   vertex): the touching point is then the face point nearest it, and the plane
   is square to the surface normal there. A **torus** is exact (the tube's
   centre circle from `surfaceGeometry`'s major radius and axis, then the
   nearest point along the tube's radial direction; a target on the centre
   circle itself takes the outward one); a **free-form** face (or any surface
   `surfaceGeometry` can't place) falls back to **the nearest point of a fine
   mesh of the face (0.01 mm deflection)**, using the nearest triangle's
   outward normal, and says so with `basis: 'mesh'` in the report. Cylinders
   and spheres also get their nearest point; a cone keeps the
   reference-plane/angle rule (its nearest point is not worth the geometry)
   and **warns** that the point is ignored. Without `point`, every surface
   behaves exactly as before.
6. **`ConstructionReport`'s plane gained an optional `basis: 'surface' |
   'mesh'`** (how a tangent plane found its point; absent means the analytic
   surface). It is report-only; nothing stores it and `tidy` keeps it.
7. **Box selection.** `pickBox` gains a `construction` kind, **last** in
   `BOX_ORDER`, taking construction planes (the drawn square, projected),
   axes (the drawn line) and points (their dot) whose screen geometry lies in
   the box; a window needs the whole square inside, a crossing a touch. It is
   off unless the selection filter allows `construction`, so a box round a
   body still takes the body.
8. **Menu, keys and docs.** The four tools are in Construct's `more` menu (the
   existing three tiles keep their keys); no new keys. `docs/file-format.md`
   §6.31 and the tangent-plane row, and the API's example calls, are
   regenerated with `pnpm api:generate`. The icons reuse `point`,
   `plane-angle` and `midplane` (no new icon files).

### Rejected approaches

- **A facade call for the nearest point on a free-form face.** A mesh normal
  is what the ADR's deferred item asked for and needs no build; `surfaceGeometry`
  gives no parameter for a B-spline.
- **Turning `midplane` into one type for both cases.** The parallel case is
  well-defined and common; a second type keeps each error message precise and
  leaves every existing file unchanged.
- **A new path reader for construction.** `pathFromRefs` already chains
  curves and edges and is tested by the path pattern.
- **Box-selecting axes and points under `sketches`.** They are model
  construction geometry, so they belong to `construction` with the planes.

## Results

- **Kernel** (`packages/kernel/src/features/construction-more.test.ts`, real
  OCCT, `strictLeaks`): 12 tests pass — a point on a box edge at 0.25 and 7 mm,
  a two-edge chain across the corner, a plane along a sketch arc at its middle
  (anchor on the arc, normal the tangent to 1e-9), a sweep whose profile is
  sketched on a plane along the path (π·9·60 mm³, tessellation), two box edges
  meeting at their corner, two skew edges refused with "40 mm apart", three
  faces of a box at (0, 0, 0), an edge and a plane, an angled midplane at 45°
  and its flip, parallel planes refused pointing at Midplane, a tangent plane on
  a torus (`basis: 'surface'`, the outer equator) and on an extruded spline's
  free-form face (`basis: 'mesh'`, unit normal).
- **Core** (`packages/core/src/construction.test.ts`): 13 tests pass, including
  the thirteen types and kinds, the new schemas' reference kinds and counts, and
  a timeline dependency (and delete refusal) through a `midplaneAngled`'s plane.
- **App**: `apps/web/src/features/construction.test.ts` 10 tests (field/input
  round trip for all thirteen, and the path handle's distance manipulator);
  `apps/web/src/selection/pick.test.ts` 27 tests (a crossing box takes a plane,
  axis and point; off with the construction filter). The `DialogOverlay`
  manipulator memo needed the preview's `drawing` in its dependencies — without
  it the path handle never appeared (found in the e2e).
- **API**: `pnpm api:generate` wrote the four methods and pages;
  `generated.test.ts` and `docs.test.ts` (26 tests) pass with the new
  `EXAMPLE_INPUTS`.
- **E2E** (`e2e/construction.spec.ts`, `--repeat-each=2`): 12 passed. A Point on
  Path on a Box's bottom front edge reads the midpoint and its `position` handle
  drags along the edge; a Plane Along Path on a sketch line reads
  `plane:20,0,0:1,0,0`; an Angled Midplane of a Box's front and top faces reads
  normal `0,-0.707,0.707`; a window box in the top view selects the Offset
  Plane (`data-model-selection` `plane:<id>`).
- **No facade change**: the OCCT input hash is untouched.
- **`pnpm check` passed**: 284 test files passed, 3 skipped (287); 3,568 tests
  passed, 7 skipped (3,575); typecheck, Biome, the boundaries, the license
  allow-list and the libcascade symbol check all clean. `pnpm build` built the
  app and the site (the site's docs page count grew by four).

### Review fixes (2026-10-06)

A review of this amendment (`2dfd610`) found one UI defect and several geometry
and wording issues; all are fixed here, each with a test.

- **M1 — `pointAtIntersection` couldn't be picked in the view.** Its `entities`
  field takes `edge | plane | face`, and `planeField` treated any field that
  accepts a plane as a plane-only field, so `dialogPlanePick` turned the model
  picker off and `sketchTargetAt` offered planes and faces alone: the two-edge
  and edge-and-plane cases were clickable only by pre-selection. `planeField`
  now leaves a field that also accepts an `edge` to the model picker
  (`apps/web/src/features/planePicker.ts`). Tested in
  `apps/web/src/features/construction.test.ts` ("a field that also takes edges
  keeps the model picker") and in the e2e, which picks two edges of a Box in the
  view and reads their shared corner. (The Wall bracket's 2.4 mm wall puts its
  parallel edges within a pixel of each other in the home view, so their picks
  are unreliable; the Box exercises the same view-picking path.)
- **M2 — an edge crossed with a plane was interpolated on a 24-sample chord.**
  `edgeMeetsPlane` now crosses a line at its exact ends and a circle or an
  ellipse analytically (one `acos`; the conic's own `first`/`last` restrict it
  to the arc), and only falls back to a 360-sample polyline for other edges
  (`packages/kernel/src/features/construction.ts`). A Ø100 rim crossed by a
  plane is exact to 1 µm, where the chord was ~0.5 mm off (a test in
  `construction-more.test.ts` checks `x² + y² = 2500`).
- **M3 — a free-form tangent plane touched at a triangle's centroid.** It now
  finds the nearest point of every triangle (projected and clamped into it),
  chooses the triangle by that distance and takes its outward normal
  (`closestOnTriangle`). The test asserts the touching point is the nearest
  sampled point of the mesh (within 0.05 mm) and that the normal points from the
  body towards a target just outside it; with the centroid rule the test fails
  by 0.16 mm.
- **L1 — `midplaneAngled` depended on pick order.** The two normals are sorted
  by `(x, y, z)` before `±`, so both orders give the same bisector; tested both
  ways.
- **L2 — the sphere's degenerate guard tested a unit vector's length.** It now
  measures the real offset and falls back to the surface direction when the
  target is at the centre.
- **L3 — the torus's 0.5 mm threshold.** The exact nearest point is used (tube
  circle, then the tube's radial direction); a target 0.4 mm above the tube
  circle touches (15, 0, 3) instead of (18, 0, 0).
- **L4 — a cone ignored a `point` silently.** It warns that the nearest-point
  rule doesn't apply yet and keeps the angle rule.
- **L5 — two tolerances.** "Lies in the plane" and "meets" both use `MEET`
  (1e-3 mm); tested with an edge in a plane and one parallel below it.
- **L6 — `basis` was written and read by nothing.** The Tangent Plane dialog
  shows an info line, "Tangent read from the display mesh.", while the report's
  basis is `mesh`.
- **L7 — a wrong section number.** The ADR pointed at "§6.31–6.34"; the file
  format has one section, 6.31, for all four types.
- **L8 — wording.** The face is read from **a fine mesh of it (0.01 mm
  deflection, `MESH_BOOLEAN_DEFLECTION`), not the view's coarser display
  tessellation**; an earlier commit message called it "the view's own
  deflection", which was wrong. The ADR and `docs/file-format.md` now say so.
- **L9 — the doc test.** `PATH_POSITIONS` joined the file-format doc test's
  choices list, so the `by` values are checked.
- **L10 — origin axes in a crossing box.** `pickBox`'s `construction` kind skips
  `origin:*` axes (they are picked by a click, never by a box), with a unit
  test.
- **Test gaps.** `construction-more.test.ts` gained a closed path, a fraction or
  length past either end, parallel edges, three planes with a parallel pair, a
  vertical plane-along-path (frame follows `faceSketchFrame`), a torus inside
  the ring and near the tube circle, and the review tests above; the e2e's Plane
  Along Path now uses an arc, as the brief asked.


### Addendum, 2026-10-07

Two items from the amendment's "still open" list, both in TypeScript, no facade change.

- **A cone's nearest tangency point (replaces L4's warning).** With the apex `A`,
  `opening` the unit axis into the body, `half` the half angle and the target `T`:
  `d = T − A`, `radial = d − (d·opening) opening`. If `radial` is not zero,
  `out = radial / |radial|` picks the generatrix `g = cos(half) opening + sin(half) out`;
  the foot is `A + max(0, d·g) g` (never behind the apex: a point past it touches at
  the apex) and the normal `cos(half) out − sin(half) opening`, the no-point rule's
  formula. `T − foot` is then parallel to the normal. Like a cylinder's, the surface
  is the infinite one, so a target beyond the rim touches past the face. A target on
  the axis has every generatrix as near: the reference-plane/angle rule decides, with
  the warning "The point lies on the cone's axis…".
- **`pointAtIntersection`: an edge and a curved face.** When the face's surface is not
  a plane, the edge and face sub-shapes go to `closestPoints`; within `MEET` (1 µm)
  the point is the midpoint of the two, else "The edge doesn't meet the face (… mm
  apart)." An edge crossing the face twice gives whichever crossing OCCT reports
  first; an edge lying on the face gives a point on it. Flat faces and planes keep
  `edgeMeetsPlane`.
- **Still open:** a point where two curved faces and a plane meet, which needs a
  face-face section the facade doesn't have.
