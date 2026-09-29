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
   (`docs/file-format.md` 6.9 and 8). Origin IDs (`origin:xy`) can't clash
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
