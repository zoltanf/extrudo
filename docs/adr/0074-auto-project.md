# ADR-0074: Auto-project

- **Status:** Accepted, 2026-10-06
- **Task:** P6-07 (FR-SK-17: "Auto-project (Fusion's 'auto project edges on
  reference'): a body edge or vertex a sketch tool snaps, constrains or
  dimensions to is projected into the sketch on the fly … optionally the
  face's outline when a sketch starts on a face").
- **Builds on:** ADR-0031 and its P4-12 amendment (projections: a
  `SketchData.projections` record, `addProjection`, the kernel reporting
  curves on the next recompute, `ToolHost.syncProjections`), ADR-0012 (the
  sketch tool framework: `infer()`, `ToolContext.pick`, the host store, the
  SVG overlay), ADR-0026 (model picking: `pickTop`/`pickStack`, `PickScene`,
  `BodyMesh.edgeIds`/`vertexIds`), ADR-0023 (preferences and commands),
  ADR-0068 (`.describe()` on a new schema field; the file-format doc test).

## Context

A sketch is a snapshot of a plane. To line geometry up with the body it is
drawn on, the user must project the body's edges into the sketch first — the
Project tool (P, ADR-0031) by hand, one pick at a time. Fusion's "auto
project edges on reference" removes that step: as soon as a sketch tool
snaps to a body edge or vertex, the edge or vertex is projected into the
sketch on the fly, as if the user had projected it.

The pieces are already there. A projection is a *record* (`SketchProjection`)
holding a persistent `GeomRef`; the kernel resolves it on every recompute and
reports the curves; `ToolHost.syncProjections` adds them as ordinary, fixed
sketch entities and solves the sketch, all amended into the same undo step
(ADR-0031). A projected curve is then indistinguishable from a drawn one, so
profiles, inference, constraints and dimensions all work on it.

What is missing is the *offer*: while a sketch tool runs, the view does not
pick the body at all — it only maps the pointer onto the sketch plane. And a
point that snapped to a body cannot hold to it until the projected entity
exists, which is a recompute later.

## Decision

### 1. The view offers body edges and vertices while a sketch tool runs

In sketch mode, with a drawing, constraint or dimension tool running (not
with no tool, and not while the Project/Intersect tool runs), the view also
picks the shown bodies' **edges and vertices** through the model picker, with
a filter of edges and vertices only (faces never). It picks **behind** the
sketch's own geometry: an inference that finds a sketch point or curve wins,
and only then a body vertex (within the vertex tolerance, 8 px), then a body
edge (6 px). A body edge or vertex hidden behind a face is still offered — a
sketch on a face routinely snaps to geometry seen through the face — so the
pick takes the first edge or vertex in "Select other…" order regardless of
occlusion, preferring vertices and visible items.

The edge or vertex under the pointer reaches the tool as a `ModelSnap`:

```ts
interface ModelSnap {
  /** The body edge or vertex, with its persistent name (topologyRef). */
  ref: GeomRef;
  /** The snap point in sketch coordinates (mm). */
  point: Vec2;
  kind: 'vertex' | 'edge';
}
```

For a vertex, `point` is the vertex projected orthogonally onto the sketch
plane. For an edge, it is the nearest point of the edge's **display
polyline** projected onto the plane: the display tessellation is an
approximation, and the exact curve arrives from the kernel on the next
recompute, exactly as the Project tool's does.

The view passes it on every `PlanePointer` as `model`, the host stashes it,
and `ToolContext.model()` returns the current one. `infer()` takes it as
`InferenceOptions.model` and inserts one more target after the sketch's own
curves: a `vertex` is an ordinary point target, an `edge` an `onCurve`-like
target whose `ids` is empty and whose `Snap.model` carries the ref. The
heads-up glyphs then show the snap as they show a sketch point or curve.

The ref comes from `topologyRef` (the mesh's persistent `edgeIds`/
`vertexIds`), synchronously: hovering must not wait for a kernel round-trip,
and a `GeomRef`'s `fingerprint` is optional (the kernel resolves the name
exactly). The Project tool's asynchronous `kernel.reference` path is
unchanged.

### 2. Committing a snap projects the ref in the same undo step

When a drawing tool commits an edit whose point snapped to a `ModelSnap`, the
edit carries a `ModelAttachment` (`point`, `ref`, `kind`). The host, on
commit:

- **Skips the work when the sketch already projects that ref** (same kind and
  ID): the existing projected entity is used at once, and the constraint goes
  into the edit like any inferred one.
- Otherwise adds a **projection record** for the ref (`addProjection`,
  `mode: 'project'`, `linked`) with `DocumentState.amend`, so it joins the
  step that added the geometry. The record starts without curves, as the
  Project tool's does.
- Records a **pending constraint**: for a vertex a `coincident` between the
  placed point and the projected point entity, for an edge a `pointOnCurve`
  of the placed point on the projected curve. `ToolHost.syncProjections`
  resolves it when the kernel's report lands: it finds the projected entity
  by the projection's source key (`vertex`/`edge`), test-solves the
  constraint with `SketchSolver.check`, and — if the solver accepts — amends
  it into the same undo step before solving the sketch; a refused constraint
  is dropped with the usual message. The prefixed pending list is session
  state (it never enters the document), so a projection whose report hasn't
  arrived keeps waiting and one that is lost is skipped.

Nothing is projected for a hover that isn't committed.

### 3. The preference

`viewport.autoProject` (a `ViewportSettings` field, default **on**) gates
the whole thing: off, the view offers no body geometry and nothing above
happens, while the Project tool still works by hand. A checkbox
"Auto-project" sits in the sketch palette beside "Snap to grid"/"Show
constraints", and the Ctrl+K command `toggleAutoProject` toggles it.

### 4. The face outline when a sketch starts on a face

`viewport.autoProjectFace` (default **off**, a checkbox under the first,
enabled only while "Auto-project" is on): when Create Sketch puts a new
sketch on a **flat face**, `createSketchOn` adds a projection of that face
(`addProjection` of the face ref) in the same undo step as the sketch's
creation, so its outline is there as fixed curves before the first click. An
origin or construction plane is not a face, so nothing is projected.

### 5. Nothing in the file format or the kernel changes

Projections are P2-09's records; no key is added to the document. The kernel
already reports edges, faces, vertices and bodies (P4-12). `packages/sketch`'s
`infer` gains the optional model target only (pure, unit-tested).

## Rejected

- **Async `KernelApi.reference` per hover** (fingerprint and all): a kernel
  round-trip on every pointer move, racy with the recompute, and a snap must
  feel instantaneous. The mesh already carries the persistent names, so
  `topologyRef` gives the same `id` without the wait; the fingerprint is only
  a fallback for a lost name.
- **Creating the projected entity optimistically from the display
  polyline**: for a vertex it would be exact, but for an edge the display
  polyline is a fit approximation while the kernel reports a line, circle,
  arc, ellipse or spline. `projectionSync` matches a curve to the report by
  its source key and *type*; a guessed spline would be replaced on the first
  report, taking the coincident constraint with it. Letting the kernel report
  the keyed curve once is simpler and always matches.
- **Extending `addToSketch` to carry projections**: one more pair of fields
  every caller must know about, where `amend` already joins a command to the
  latest step.

## Deferred

- **Direct picking of body geometry by the constraint and dimension tools.**
  The model target reaches `infer`, and `ToolContext.model()` is there, but a
  constraint or dimension tool that picked a body edge would write its
  constraint against the projected curve in the same commit — the pending
  machinery generalized from one constraint type to any. Today such a tool
  picks the projected entity once it exists (a normal fixed sketch entity),
  which is what the on-the-fly projection produces. The essential path
  (a drawing tool placing a point on a body edge or vertex) is complete.
- **Silhouettes and whole bodies for auto-project**: only edges and vertices,
  as the task says.

## Results

- `infer` handles the model target after the sketch's own curves; unit tests
  cover a vertex beating the grid and losing to a sketch point, and an edge
  giving an on-curve snap with its ref.
- Host tests cover: a line end snapped to a model vertex adds the projection
  record in the same undo step, and after a faked report the projected point
  and the coincident constraint, all undone by one `undo`; a ref already
  projected is reused; `autoProject` off offers no model snaps.
- E2E (`e2e/auto-project.spec.ts`, `--repeat-each=2`): a line snapping to a
  vertex of a Box's top face seen from the sketch's Top view; after Finish
  Sketch and the recompute `data-sketch-projected` lists the vertex and
  `data-sketch-summary` counts the coincident constraint; Ctrl+Z after
  reopening takes the line, the projection and the constraint away;
  `autoProject` off gives no snap and no projection; `autoProjectFace` on
  starts a new sketch on the top face with `curves=4` projected.
- The preference is a persisted `ViewportSettings` field; the palette
  checkbox and the `toggleAutoProject` command write it.
- **A trap found by CI**: the model-snap picker must be held in a ref inside
  `useSketchInput`, as `useModelInput` holds its scene. Putting it in the
  pointer handlers' `useMemo` dependencies made the handlers re-bind whenever
  the scene changed — and a drag step changes the sketch — so the press state
  was dropped mid-drag and `sketch-select.spec.ts`'s rim-resize and edge-drag
  tests failed. The handlers now read the latest picker from a ref, so a drag
  survives the sketch changing under it.
