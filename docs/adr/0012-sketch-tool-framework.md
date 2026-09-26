# ADR-0012: Sketch tool framework, inference and heads-up input

- **Status:** Accepted, 2026-09-26
- **Task:** P1-02 (sketch tool framework). Code: inference in
  `packages/sketch/src/inference/` (entry `@extrudo/sketch/inference`), the
  `addToSketch` command in `packages/core/src/sketch/commands.ts`, tools in
  `apps/web/src/sketch/tools/` (`tool.ts`, `line.ts`, `host.ts`,
  `SketchOverlay.tsx`), picking in `apps/web/src/viewport/camera.ts`
  (`viewRay`, `rayPlane`, `viewProject`, `worldPerPixel`) and `Viewport.tsx`
  (`useSketchInput`), grid steps in `viewport/grid.ts`.
- **Builds on:** ADR-0010 (sketch data, sketch mode as one transaction),
  ADR-0011 (`SketchSolver.solve` and `check`), ADR-0004 (expressions),
  ADR-0008 (the camera).
- **Affects:** P1-04 and P1-05 (every drawing tool), P1-06 (constraint
  glyphs), P1-07 (dimensions from typed values), P1-09 (dragging reuses
  picking and `exclude`).

## Context

FR-SK-05 asks for snapping and inference while drawing (endpoint, midpoint,
center, on-curve, intersection, horizontal and vertical alignment with
dashed guides, grid) with the matching constraints applied; FR-SK-06 asks
for a heads-up box (type a length, Tab to the angle, Enter). UI spec §3.4
says typing goes straight into the box and accepts expressions. P1-04 and
P1-05 add a dozen tools on top, so the parts they share had to be settled
here, with one tool to prove them.

## Decision

1. **Inference is pure math in `packages/sketch`.** `infer(sketch, cursor,
   options)` returns the point to use, what it snapped to (`Snap`: kind and
   entity IDs) and the alignments (guides). Priorities, first match wins:
   points (endpoints, centers, loose points, the sketch origin), then
   intersections and midpoints, then an alignment guide crossing a curve,
   then on-curve, then horizontal/vertical alignment (both at once snap to
   the guides' crossing), then the grid, then the cursor. Within a tier the
   nearest candidate wins; for alignment the anchor (the tool's last point)
   wins ties. Candidate points, midpoints and intersections are cached per
   `SketchData` object (documents are immutable, so a `WeakMap` is enough).
   The tolerance comes in mm (8 px × mm per pixel at the pointer), so the
   engine knows nothing about screens. Unit tests cover every snap kind and
   the priorities.
2. **Snaps and alignments map to constraints in one place**
   (`inference/constraints.ts`): endpoint/center/point → `coincident`;
   midpoint → `midpoint`; on-curve → `pointOnCurve`; intersection → two
   `pointOnCurve`; origin → `fix` (the origin isn't a sketch entity until
   projected geometry, P2); an alignment with the anchor → `horizontal` or
   `vertical` on the new line; with another point → the same between the two
   points.
3. **A tool is a small state machine in plain TypeScript** (`SketchTool`):
   `move`, `click`, `enter`, `escape`, `fields`, `lock`, `preview`,
   `anchor`, `prompt`. It never touches a store; it returns a `SketchEdit`
   (new entities, constraints, dimensions, and which constraints were
   inferred). Tools get IDs from a context, so tests pass a counter.
4. **The host commits one command per completed piece of geometry**
   (`addToSketch`, inside the sketch's transaction, so each segment is one
   undo step while editing and the whole sketch is one step after Finish).
   Before committing, each inferred constraint is test-solved with
   `SketchSolver.check` and dropped if it conflicts or is redundant; the
   tool's required constraints (the join to the previous segment) always go
   in. Then the sketch is solved and the solved positions go into the same
   command (new points, and existing points and radii that moved). Until the
   solver has loaded (it loads on the first tool start, in its own chunk),
   edits go in unsolved with every inferred constraint. Any other document
   change while a tool runs (undo, redo) restarts the tool, since it may
   hold points that no longer exist.
5. **Typed values**: the heads-up box shows the tool's fields (the line's
   length and angle) as `<ExpressionInput>`s. Typing a character that can
   start a number focuses the first field; Tab moves on; only typing locks a
   field (leaving an untouched field must not lock it to the stale live
   value it had when focused). A locked length becomes a driving `distance`
   dimension with the typed expression; a locked angle that is a multiple of
   90° becomes horizontal or vertical. Other angles only place the point:
   an angle dimension needs a second line, which comes with P1-07. While
   anything is locked, inference doesn't apply and its guides are hidden.
6. **Picking is our own math, not three.js raycasting.** `viewRay` builds
   the pick ray from the same `View` the cameras use, `rayPlane` meets the
   sketch plane, `worldPerPixel` gives the tolerance in mm, and
   `viewProject` is the inverse. They run in Node tests and don't need the
   R3F scene. Moves are reported again when the camera moves under a still
   pointer (wheel zoom) and when Ctrl/⌘ changes. Holding Ctrl/⌘ turns
   inference and grid snapping off. A left press that moves less than 5 px
   is a click, which leaves drags free for P1-04's tangent arcs.
7. **Feedback is a screen-space overlay** (`SketchOverlay`): the rubber-band
   preview, dashed guides, a snap glyph per kind (square, triangle, circled
   dot, cross, circle), the heads-up box and a prompt line, drawn as SVG and
   HTML over the canvas from sketch coordinates. It uses the theme's CSS
   variables directly and is visible to Playwright (`data-snap`,
   `data-guide`, and a `data-sketch-summary` count of the open sketch).
8. **Grid snapping follows the visible grid**: the step is the finest power
   of ten (at least 1 mm) whose cells are 12 px or wider (`gridStep`). It is
   the palette's "Snap to grid", on by default, stored with the viewport
   preferences.
9. **The Line tool is the framework's reference tool** (key `L`): click a
   start, then click point after point; each segment is committed on its
   click, joined to the last by a coincident; clicking the chain's first
   point closes the loop; Esc steps back (typed values, then the chain,
   then the tool). P1-04 adds the tangent-arc drag and the other tools.

## Rejected options

- **Drawing the preview in three.js** (like committed sketches): the glyphs
  and guides need theme colours, crisp screen-size shapes and test hooks;
  an SVG overlay has all three for free. Straight lines project exactly;
  arcs will be projected as polylines.
- **Committing a chain as one command when it ends**: an undo inside the
  sketch would then remove the whole chain, and a crash or reload mid-chain
  would lose it. One command per segment matches Fusion.
- **Committing every inferred constraint and letting P1-08 show conflicts**:
  inference would routinely over-constrain (closing loops, alignments with
  already-placed points) and turn sketches red for no reason the user
  chose.
- **Locking a field on blur** (`ExpressionInput`'s commit): an untouched
  field commits the live value it had when focused. Found in manual testing
  when a Tab through the Length field locked a stale length.
- **Importing inference from `@extrudo/sketch`'s main entry**: it re-exports
  the solver loader, which pulled planegcs's glue into the app's main chunk
  (over the 1000 kB limit). The `@extrudo/sketch/inference` entry keeps the
  solver in its lazy chunk.

## Consequences

- P1-04 and P1-05 add tools as new `SketchTool` classes registered in the
  host's factory table; the overlay draws arcs once `ToolPreview` grows an
  arc member.
- Dimensions created from typed lengths have no `paramName` yet; P1-07
  names them (`d1`…) and lists them in the parameters table.
- Snap glyphs double as the "auto-constraint" feedback for now; the flash of
  applied constraint glyphs (UI spec §4) comes with P1-06's glyph rendering.
- The solver runs on the main thread on every commit; the gear-loop risk
  (ADR-0011) applies to clicks in such sketches too until P1-09.
