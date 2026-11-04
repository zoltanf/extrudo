# ADR-0125: Project one sketch into another, and auto-project sketches

- **Status:** Accepted, 2026-11-03
- **Issue:** #171 ("Projection Function": bring an earlier sketch's curves into a sketch on another plane).
- **Builds on:** ADR-0031 (the Project tool, `SketchData.projections`, `ToolHost.syncProjections`),
  ADR-0074 and its amendments (auto-project, `ModelSnap`, `ModelAttachment`, pending
  constraints), ADR-0093 (axes and points as projection sources, construction curves),
  the `sketchEntity` reference (`docs/file-format.md` §8).
- **No new schema key.** A projection's `ref` may now be of kind `sketchEntity` (one curve
  or point of an earlier sketch) or `feature` (a whole earlier sketch); both kinds exist.
  `docs/file-format.md` §7.4 says so.

## Context

A sketch can project body edges, faces, vertices and bodies (ADR-0031, P4-12), and the
origin's and construction axes and points (ADR-0093). It cannot use another sketch: the
Project tool's picks are body topology only, `addProjection` refuses a `sketchEntity` ref,
and while a drawing tool runs the auto-project snap filter leaves every other sketch out,
so a point can't even be placed on an earlier sketch's circle centre. The common case is
a hole or a boss on an offset plane that must sit on the base sketch's circle, or a
section on the XZ plane that must share a width with a plan view on XY. Today the user
redraws the geometry and dimensions it by hand, and it doesn't follow.

Everything below the UI exists: a sketch's output already carries every curve of the
sketch exactly (`SketchOutputData.exact`, in sketch coordinates) and every point
(`points`), with the sketch's frame; the sweep's path and the hole's points read them
through `<sketch>/<entity>` references; the projection machinery turns any
`ProjectedCurve` into fixed, linked entities and keeps them in step on every recompute.

## Decision

### 1. A sketch curve, a sketch point or a whole sketch is a projection source (core, kernel)

`addProjection` accepts, in `project` mode only, a ref of kind **`sketchEntity`**
(`<sketchFeatureId>/<entityId>`: one curve or one point of a sketch) and of kind
**`feature`** whose id is a sketch feature (the whole sketch). `intersect` and `center`
refuse them. The schema's `sketchIssues` accepts the two kinds and lets their curves be
points (`POINT_SOURCES`).

The kernel's `projectSource` resolves them from the source sketch's output
(`ctx.output(<sketch>).data`, the `pieceOf` pattern of `sweep.ts`): a source that can't be
found, or an entity that is gone, is a `LostReferenceError`, so the usual "Lost a projected
sketch curve … its curves stay where they were" warning follows. A source sketch is always
**earlier in the timeline** than the sketch that projects it: the tools only offer earlier
sketches, and the dependency graph (`referencedFeatures` splits the ref's id, so a
`sketchEntity` ref depends on its sketch) computes the source first.

How a curve projects, from the source frame along the target sketch's normal:

- A **point** (`points[entity]`): `sketchToWorld(source)` then `projectPoint`, key `point`.
- A **line, arc, circle or ellipse** (`exact[entity]`, the kernel's `PlanarCurve` kinds
  `line`, `arc`, `ellipse`): built as an `EdgeGeometry` in the world (a conic through
  `conicEdge`, exported from `projection.ts`, with the source frame's normal as its axis and
  its X as the x direction; a line from its two world ends) and projected with
  `projectEdge`. Parallel planes give the same curve type exactly; a tilted plane gives an
  ellipse for a circle, a fit spline for an arc or an ellipse; a plane at right angles gives
  the segment the curve is seen as. The same rules as a body edge.
- A **spline or conic** (`PlanarCurve` kinds `spline`, `conic`): the source's path polyline
  (`SketchOutputData.curves[entity]`, type `polyline`) to the world and through
  `projectPolyline`, which fits lines, arcs and control-point splines within 1 µm, as
  silhouettes are. Key `curve`; when it comes out in several pieces, `curve:<n>`.
- A **text** can't be projected (its letters are profiles, not curves): the tools refuse it.

A whole sketch (`feature` ref) projects every curve of `exact` and every **loose point**
(a point no curve uses: `SketchOutputData.loose`, new), keyed by the source entity's id
(and `<id>:<n>` for a spline in pieces). Curve ends and centres come with their curves.
`SketchOutputData` also lists the source's **construction** curves (`construction`, new);
a `ProjectedCurve` from one carries `construction: true`, and `projectionSync`'s
`addCurve` keeps it construction (as it does a datum's line). Construction stays
construction, in a whole sketch and in a single pick alike.

`SOURCE_NOUN` gains `sketchEntity: 'sketch curve'` and `feature: 'sketch'`.

### 2. The Project tool picks sketches (web)

The Project tool's filter adds `sketchEntity`: in the view it picks the curves (construction
ones too) of the shown sketches, and in the browser a **sketch's row** projects the whole
sketch, the way a body's row does. The tool refuses a sketch at or after the open sketch
in the timeline ("Only a sketch earlier in the timeline can be projected."), a text ("Text
can't be projected: project its sketch's curves instead."), and the already-projected ("That's
already projected into this sketch.", as today). The panel's prompt becomes "Pick edges,
faces, vertices or sketch curves in the view, or a body or sketch in the browser: their
outline comes in." Intersect is unchanged. "Keep linked" off includes the curves as plain
entities, as for bodies.

### 3. Auto-project has two switches: Bodies and Sketches (web)

A second preference, **`viewport.autoProjectSketches`** (on by default, persisted like
`autoProject`): while a drawing, constraint or dimension tool runs, the curves and points
of the **earlier, shown sketches** are offered under the pointer as `ModelSnap`s, kinds
`sketchCurve` and `sketchPoint` (`ModelSnapKind` grows; `sketchPoint` is a point snap).
The snap point is the nearest point of the curve's display polyline carried into the open
sketch's plane; a line's `line` stand-in is its two ends; `straight` is true for a point
and a line, so the constraint and dimension tools take those and refuse a curved curve as
they refuse a curved body edge. A sketch snap and a body snap under the same pointer: the
nearer to the cursor wins, a tie goes to the body. The rest is ADR-0074's path unchanged:
`ModelAttachment`, `addProjection` amended into the step, pending constraint resolved in
`syncProjections`, revival of a deleted curve. The sketch's own geometry still wins over
every model snap.

The sketch palette's "View & project" section becomes two: **"View"** (Slice) and
**"Auto-project"** with a two-column row **Bodies | Sketches** (as "Grid" has Show | Snap)
and the Face outline switch under it. Settings and the app menu get "Auto-project sketch
curves" beside "Auto-project body edges". The `toggleAutoProject` command keeps toggling
bodies.

Why two switches rather than one: a busy design with several sketches on one plane
makes every old curve a snap target, and the user can turn Sketches off alone while body
snapping stays on. Why on by default: the case that asked for it (a hole at the base
circle's centre) is the first thing a new user tries.

### Amendment (slice 3, 2026-11-03)

The plan above said the host needed no change beyond `projectionMode`, but a
sketch snap's kernel curve key is not its kind: a sketch point reports `point`
and a sketch curve `curve` (or `curve:<n>` in pieces), while a body vertex or
edge reports its own kind. So `Snap` carries the model snap's own kind
(`Snap.modelKind`, set in `infer`), `place` uses it for the
`ModelAttachment.kind`, and the host resolves a pending constraint or edit
through `projectionCurve(projection, kind)` (a `curveKey` mapping plus the
first `curve:<n>`). `projectedEntities` and `data-sketch-projected` are
unchanged.

## Consequences

- Sketch curves follow the sketch they came from, across parallel and tilted planes, with
  the same purple fixed entities, warnings and undo behaviour as body projections.
- `data-sketch-projected` lists sketch projections like any other.
- A document projecting a sketch depends on it: deleting the source sketch is refused while
  the projection has curves (the existing "A projection keeps its source" rule); deleting
  the curves first removes the projection.
- The f3d importer still drops projected curves (ADR-0083); unchanged.

## Deferred

- Projecting a sketch's **text** (as curves of its letters).
- **Construction planes** as sources (ADR-0093's deferral).
- A sketch snap's **tangent/smooth** constraints to a curved sketch curve (as for body edges).
- The **Intersect** tool with a sketch (a sketch has no volume; nothing to cut).

## Rejected

- **One Auto-project switch for bodies and sketches:** fewer controls, but no way to keep
  body snapping while silencing a crowded plane of old sketches.
- **Explicit Project only, no auto snapping of sketches:** smallest, but misses the common
  "hole at the same centre as the base circle" flow, which the issue describes.
- **Copying the entities into the new sketch** (an include by default): exact today, wrong
  the moment the source sketch changes; "Keep linked" off already gives it.
- **Exact spline transfer through projected poles:** exact only for parallel planes and the
  same knot vector; the fitted route is uniform with silhouettes and within 1 µm.

## Amendment 1 (2026-11-04): a faint preview of what can be snapped

The owner tried Auto-project Sketches on edge and saw nothing happen: nothing is projected
until the pointer finds a curve, and nothing showed where the earlier sketch's curves would
land. Now, **while a drawing tool runs** and the Sketches switch is on, the curves of the
earlier sketches (`carriedSegments` in `apps/web/src/viewport/sketchGeometry.ts`) are drawn on
the open sketch's plane, flattened along its normal, thin, dashed and at half the construct
colour's opacity (`CarriedCurves` in `viewport/Sketches.tsx`). Nothing is added to the
sketch until a snap. The carried copy is where the pointer aims, so `sketchSnapAt` also offers
an earlier sketch's point or curve whose carried copy lies within the snap tolerance of the
cursor (in the open sketch's plane, cached per sketch data and frame), besides the one under
the pointer where the source is drawn; a point still wins over a curve, the nearest wins.
Before this, in a perspective view the copy and the source sit apart on screen and only the
source snapped. Left out of the preview: a text (it
never projects), a segment already in the plane (its own sketch draws it), later sketches,
and everything while no drawing tool runs or the switch is off. The view reports the segment
count as `data-carried-curves`.

**Rejected:** projecting every earlier curve when a sketch opens (clutters the sketch with
geometry the user may not want, and adds fixed entities the solver carries); showing the
preview whenever the sketch is open (with the selection tool there is nothing to snap, so it
is noise).
