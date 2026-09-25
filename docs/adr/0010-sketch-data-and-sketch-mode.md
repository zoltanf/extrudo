# ADR-0010: Sketch data model and sketch mode

- **Status:** Accepted, 2026-09-25
- **Task:** P1-01 (sketch feature and sketch mode). Code:
  `packages/core/src/sketch/`, `apps/web/src/sketch/`,
  `apps/web/src/viewport/` (`Sketches.tsx`, `sketchGeometry.ts`, `Grid.tsx`,
  `Origin.tsx`).
- **Affects:** P1-02 to P1-13 (tools, solver, constraints, dimensions,
  selection, profiles, SVG export), P2 (extrude reads profiles, sketches on
  faces, topological naming of sketch curves).

## Context

ADR-0003 left `SketchData` as an open record for P1-01 to define. The sketch
holds entities, constraints and dimensions, and stores its solved
coordinates (architecture §4.1). P1-03 maps it onto planegcs, which models
points as primitives of their own and keeps one system per connected
component (ADR-0002). FR-SK-01 asks for sketches on the origin planes with a
Look At animation; UI spec §4 describes sketch mode: the Sketch tab, the
palette, Finish Sketch, undo that steps through the sketch's edits and
collapses them into one step at the end.

## Decision

1. **The plane is a separate `ref` input; `SketchData` is only the 2D
   content.** A sketch feature has two inputs: `plane` (a `ref` input with
   exactly one `plane` or `face` reference) and `sketch` (a `sketchData`
   input). This keeps every reference to geometry in `ref` inputs, so
   dependency checks and the topological-naming service (P2-04) scan one
   kind of input for every feature type. The architecture had the plane
   inside `SketchData`; the v0 draft format already had it as a `ref`.
2. **Points are entities; each point belongs to at most one curve.** The
   entity types are `point` (x, y), `line` (start, end), `circle` (center,
   radius) and `arc` (center, start, end, counter-clockwise, radius from the
   start point); lines, circles and arcs have a `construction` flag.
   Curves refer to their points by ID. Two curves that meet don't share a
   point: a `coincident` constraint joins their endpoints, as in FreeCAD and
   Fusion and as ADR-0002 decided for the solver. The schema rejects a point
   used by two curves, so there is one way to say "these meet".
3. **Records keyed by ID, not arrays.** `entities`, `constraints` and
   `dimensions` are records. Deleting an entity is one small Immer patch; in
   an array it would rewrite every later index, and undo entries would grow
   with the sketch. IDs are unique across the three records, so a selection
   can hold any of them.
4. **Every FR-SK-07 constraint and FR-SK-08 dimension has a shape now.**
   Constraints: `coincident` (two points), `pointOnCurve` (the UI calls it
   coincident too), `collinear`, `concentric`, `midpoint`, `fix`,
   `parallel`, `perpendicular`, `horizontal` and `vertical` (a line or two
   points), `tangent`, `smooth`, `equal`, `symmetric` (two entities and an
   axis line). Dimensions: `distance` (a line's length, two points aligned or
   horizontal or vertical, point to line, two parallel lines), `radius`,
   `diameter`, `angle`. A dimension's value is an expression (`expr`, an
   optional `paramName`, `driven`). P1-03 can map every type at once; later
   tasks add optional fields (the tangent's 0/π choice, dimension label
   positions, the angle's quadrant) without a format bump.
5. **The schema checks references, not geometry.** `sketchIssues` reports a
   reference to a missing entity or to the wrong kind of entity, an entity
   constrained to itself, a shape a type doesn't take (a tangent between two
   lines, an equal between a line and a circle, a horizontal dimension to a
   line) and an ID used in two records. It runs on load as part of the
   document schema. Whether the geometry satisfies the constraints is the
   solver's job (P1-03).
6. **Origin plane frames match the ViewCube.** `origin:xy`, `origin:xz` and
   `origin:yz` have fixed frames (`sketch/planes.ts`): looking at a plane
   from its normal (Top, Front, Right), sketch X points right and sketch Y
   up. XY: X, Y, normal +Z. XZ: X, Z, normal −Y. YZ: Y, Z, normal +X. Faces
   and construction planes get their frames from the kernel later. Look At
   uses `lookFrom(normal, up = frame.y)`, a new optional `up` for the camera.
7. **Sketch mode is session state plus one undo transaction**
   (`apps/web/src/sketch/mode.ts`). Create Sketch sets the session's active
   tool to `sketch`: the viewport shows all three origin planes as pickable
   (hover in the `preselect` colour, nearest plane wins), and a prompt
   offers them as buttons, which also highlight their plane. Picking
   dispatches `createSketch` (its own undo step, "Create sketch"), then
   enters the sketch: `beginTransaction('Edit sketch')`,
   `session.enterSketch`, Look At. Undo inside the sketch steps through its
   edits and can't remove the sketch itself. Finish Sketch commits, so the
   edits are one step; with no edits there's no extra step. Entering another
   sketch finishes the open one. The timeline's marker can't move while a
   sketch is open, since rolling back could remove it.
8. **The UI shows the real layout.** The Sketch tab replaces Solid while a
   sketch is open, with Create, Modify, Constraints and Inspect groups and
   a green Finish Sketch; the palette has Look at, Sketch grid, Show points,
   Finish Sketch, and the options of later tasks, disabled with the task that
   brings them. The grid lies on the sketch plane, its axes coloured by the
   world axes they follow. Sketches are drawn with screen-space lines
   (construction dashed, 6/4 px), the open one at full strength with its
   points; others at 55 %. Status colours wait for the solver (P1-08).

## Rejected options

- **Plane inside `SketchData`** (the architecture's first sketch): the
  sketch's one reference to other geometry would sit where generic code
  doesn't look for references.
- **Shared endpoints** (a line's end is the next line's start): shorter
  documents and no coincident constraints, but two ways to express the same
  thing, and it doesn't match the solver adapter ADR-0002 chose.
- **Arrays of entities with an `id` field**, like the v0 draft: see 3. The
  v0 migration turns those arrays into records.
- **Creating the sketch inside the edit transaction**, so that creation and
  edits are one step: undo inside the sketch could then remove the sketch
  being edited, which sketch mode would have to guard against. The cost is
  two steps after Finish ("Edit sketch", then "Create sketch").
- **Computing the plane frame in the web app**: the kernel needs the same
  frames to place sketch wires, so they live in core.

## Consequences

- **Existing documents.** v1 documents with a sketch feature whose inputs
  are empty (the old Wall bracket template) still load: the document schema
  checks input shapes, and the feature registry reports the missing inputs.
  `readSketch` returns `undefined` for them, so they are listed but not
  drawn or opened. Nothing released wrote them.
- **The Wall bracket template** now has real sketches: the L profile on XZ
  and two holes on XY (`outline`, `circles` in `project/templates.ts`).
- **Not done here:** editing sketch content (the tools, P1-02 onwards),
  sketch visibility toggles and hover highlighting in the browser (P1-12),
  sketches on faces (P2-09), dimensions in the parameters table and in
  parameter renames (P1-07), turning off Look At as a preference.
