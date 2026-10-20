# ADR-0093: Dimensions and constraints to the origin, axes and construction points

- **Status:** Accepted, 2026-10-19
- **Issue:** #61 ("Not possible to measure sketch to an axis").
- **Builds on:** ADR-0031 (sketches on faces, the Project tool, `SketchData.projections`),
  ADR-0074 (auto-project; slice 2: the constraint and dimension tools pick body
  edges and vertices through `ToolContext.pickModel`), ADR-0068 §4 (the origin's
  reference IDs), the construction features (`packages/core/src/construction.ts`).
- **No new schema key.** A projection's `ref` may now be of kind `axis` or `point`
  (both kinds already exist); `docs/file-format.md` says so.

## Context

In sketch mode the Sketch Dimension tool and the constraint tools pick only the
sketch's own entities (`ToolContext.pick`) and, through auto-project, body edges
and vertices (`ToolContext.pickModel`). The origin point, the origin axes and the
construction axes and points are none of these, so a user cannot dimension a
line to the Y axis or a point to the origin, nor make a point coincident with the
origin or a line collinear with an axis. Reproduced on v0.8.1: Dimension, pick a
line, click the Y axis → the click counts as empty space and places the line's
length; pick a point, click the origin → nothing happens.

The only origin support today is inference: a point placed on the origin gets a
`fix` (`packages/sketch/src/inference/constraints.ts`). That pins it but can't be
measured from, and it says nothing about the axes.

Everything below the UI already exists: `GeomRef` kinds `axis` (`origin:x|y|z`,
or a construction axis feature's ID) and `point` (`origin:point`, or a
construction point feature's ID), and the kernel resolves them for other features
(`lineOf` and `pointOf` in `packages/kernel/src/features/references.ts`). The
sketch's projections (ADR-0031) already turn a referenced source into fixed sketch
entities that follow it on every recompute, and ADR-0074 slice 2 already lets the
constraint and dimension tools pick a model source, measure against a stand-in,
and resolve it to the projected entity in the same undo step.

## Decision

### 1. Datums are projectable sources (core and kernel)

`addProjection` (`packages/core/src/sketch/projection.ts`) accepts `axis` and
`point` refs in `project` mode (not `intersect`). The kernel's `projectSource`
(`packages/kernel/src/features/sketch.ts`) handles them:

- **`point`**: `pointOf(ctx, ref, …)` projected onto the plane (`projectPoint`),
  key `point`.
- **`axis`**: `lineOf(ctx, ref, …)`, an origin and a direction. If the direction is
  parallel to the sketch normal (|cos| ≥ `PARALLEL`), the axis projects to a point,
  key `point` (the Z axis in an XY sketch). Otherwise it projects to a **line of
  fixed length `DATUM_SPAN` = 100 mm centred on the projection of the axis's
  origin**, key `axis`. The length only matters for display: dimensions and
  constraints against a line treat it as infinite. A fixed span keeps the result
  deterministic and independent of the sketch's contents.
- `SOURCE_NOUN` gains `axis: 'axis'` and `point: 'point'`, so a deleted
  construction feature gives "Lost a projected axis …" and the curves stay.

Because the projection is linked, it stays right when the sketch plane is a face
or an offset plane that moves later, and when a construction axis or point moves.
Dependencies need no change: `referencedFeatures` already follows projection refs,
and the `origin:*` IDs are not feature IDs.

### 2. Datum curves are construction geometry

Curves from an `axis` or `point` projection are added with `construction: true`
(`syncProjections`' `addCurve`), so a projected axis never splits a profile.
Projected edges keep today's behaviour.

### 3. The tools pick datums (web)

`ToolContext.pickModel` also returns the **datums shown in the view** under the
pointer: the origin point, the three origin axes and (slice 2) the shown
construction axes and points. A datum is a `ModelSnap` of `kind: 'point'` or
`kind: 'axis'` with its `GeomRef`, its point or its `line` stand-in, already in
sketch coordinates. Order of preference under the pointer: the sketch's own
geometry, then datum points, then datum axes, then body vertices and edges. A
datum hidden with its browser eye is not offered. Datums are offered whether or
not auto-project is on (that preference is about body geometry).

The rest is ADR-0074 slice 2's path unchanged: a stand-in entity for measuring
(`modelStandIn`), a `ModelAttachment` per datum pick, `addProjection` (or reuse of
an existing projection of the same ref) and a `PendingModelEdit` resolved to the
projected entity in `syncProjections`, in the same undo step. An axis that
projects to a point is a point pick.

### 4. Sketch Dimension: a sketch line, then an axis

Today, after a sketch line is picked, `#pickAt` refuses every model pick so that
the next click can place the line's length. A **datum axis or point** is now taken
as the second pick (line to axis: the distance between parallel lines, or the
angle; line to point: the distance). A body edge or vertex there is still refused,
as before. To place a length near an axis, click away from the axis.

### Amendment (slice 1 review, 2026-10-19)

- **Pick order:** sketch geometry, then datum points, then **body vertices**, then
  datum axes, then body edges: a body vertex lying on an axis (a box corner on X)
  stays a vertex.
- **§4 refined:** after a sketch line, the origin, a datum point and an axis
  **parallel** to the line are taken as the second pick; an axis **across** the
  line is left for the label (a centred line's label lands on the other axis). For
  the angle to a crossing axis, pick the axis first.
- **A projected axis line gives way to a datum point** under the pointer, so the
  origin stays pickable where projected axes cross it.
- **Slice 2:** construction axes and points before the sketch in the timeline,
  shown and not suppressed, are offered like the origin's (`constructionDatums`).
- **No placement click for a datum distance** (owner's test, 2026-10-19): line ↔
  parallel axis and point ↔ axis commit on the second pick with the label past the
  line's end; point ↔ point and angles keep the placement click.
- **Datum projections are not drawn** (the view draws the datum).
- **A stored axis is never drawn as a segment**, not even highlighted; a tool
  hovering or picking it shows the same marker as an axis not yet stored; the origin
  keeps its point highlight.
- **An axis has no length or middle:** Equal, Midpoint and Horizontal/Vertical
  refuse a datum axis line (its stored 100 mm span is display only); the origin
  point is still accepted by all of them.
- **A line's distance to an axis hangs on the line:** the dimension runs from the
  sketch line's middle to its foot on the axis, whichever was picked first (an axis's
  middle is arbitrary).
- **The Dimension tool keeps the hovered pick visible:** with a line picked, its
  length preview is hidden while a second pick is under the cursor, so the hover
  marker stays visible.
- **A fresh axis pick counts as a datum in the tool's view:** its stand-in line is
  treated like the stored axis, so the label placed for it stays put once the axis is
  stored.

## Consequences

- Dimensions and constraints to the origin and the axes work in every sketch,
  including sketches on faces and offset planes, and follow later changes.
- A sketch that used a datum gains a projection record and one or two
  construction entities, listed like any projection.
- Picking near the origin now prefers the datum to empty space, which changes
  where a Dimension click on an axis goes (point 4).

## Deferred

- **Construction planes** as sources (a plane at right angles to the sketch
  projects to a line; a parallel one to nothing).
- **Inference onto datums** while drawing (a point placed on an axis getting
  `pointOnCurve` to a projected axis). The origin snap keeps its `fix`.
- **The Project tool (`P`) picking datums** directly.

## Rejected

- **A fixed construction copy** (picking the origin or an axis adds a construction
  point or line with `fix`): small and web-only, exact on origin-plane sketches,
  but wrong once a face or offset plane, or a construction axis, moves.
- **Implicit datum entities in every sketch** (a hidden origin point and axis
  lines in `SketchData`): a schema change and solver work for every sketch, and
  still wrong on moving planes unless they were projected anyway.
