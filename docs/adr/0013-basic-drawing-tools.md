# ADR-0013: Basic drawing tools, tangent arcs and construction geometry

- **Status:** Accepted, 2026-09-26
- **Task:** P1-04 (basic drawing tools). Code: tools in
  `apps/web/src/sketch/tools/` (`rectangle.ts`, `circle.ts`, `arc.ts`,
  `point.ts`, the Line tool's drag in `line.ts`, shared builders in
  `build.ts`, registered in `host.ts`), constructions in
  `packages/sketch/src/inference/construct.ts`, drags in `Viewport.tsx`
  (`useSketchInput`), the Construction toggle in `sketch/panels.tsx`, the
  catalogue in `shell/tools.ts`.
- **Builds on:** ADR-0012 (tool framework, inference, heads-up box),
  ADR-0010 (arcs stored counter-clockwise, one owner per point), ADR-0011
  (the `reversed` side of an endpoint tangent).
- **Affects:** P1-05 (more tools on the same builders), P1-06 (tangent and
  construction are ordinary constraints and flags), P1-09 (converting
  selected geometry to construction), P2-07 (centerlines as revolve axes).

## Context

FR-SK-02 lists the drawing tools; P1-04 takes the basic ones: the Line
tool's tangent-arc drag, rectangles (2-point, 3-point, center), circles
(center-diameter, 2-point, 3-point), arcs (3-point, center, tangent) and
points. FR-SK-04 adds the construction toggle (`X`). Each tool has to leave
behind a sketch the solver holds in place: the right constraints, and
nothing inferred that it would reject.

## Decision

1. **One class per family, one tool ID per mode.** `RectangleTool`,
   `CircleTool` and `ArcTool` take a mode; each mode is its own tool
   (`rectangle`, `rectangle3`, `rectangleCenter`, `circle`, `circle2`,
   `circle3`, `arc`, `arcCenter`, `arcTangent`) with its own catalogue
   entry and icon. The toolbar tiles run the default mode (`R` 2-point
   rectangle, `C` center circle, `A` 3-point arc); the other modes are in
   the Create group's menu. Tools stay plain state machines with no mode
   switching inside.
2. **Shared builders** (`build.ts`): `addPoint`, `addLine`, `addCircle` and
   `addArc` create entities with the construction flag; `place` adds the
   inferred constraints for a point where the pointer snapped and aligned;
   `throughPoint` puts a snapped sketch point on a new circle or arc (the
   curve has no point of its own there); `curveEnd` finds the line or arc a
   point ends and its direction out of it; `tangentJoin` adds the
   coincident and tangent between them.
3. **What each shape is made of.** All constraints below are required; only
   snaps and alignments are inferred (and test-solved, ADR-0012).
   - 2-point and center rectangles: four lines joined at the corners,
     horizontal and vertical (4 DOF left: position and size).
   - 3-point rectangle: perpendicular plus two parallels (5 DOF: it can
     rotate). A first edge aligned with its first corner, or typed at a
     multiple of 90°, is also made horizontal or vertical.
   - Center rectangle: two construction diagonals joined to the corners and
     a center point at the midpoint of one of them. The midpoint of the
     second diagonal would be redundant.
   - Circles: no constraints beyond snaps. Arcs are stored counter-clockwise;
     one drawn clockwise swaps its start and end (`ArcShape.reversed`).
4. **Tangent arcs are one construction used twice.** `tangentArc(start,
   dir, end)` puts the center on the normal where it is as far from `end` as
   from `start`. The Arc tool's tangent mode starts on the end of a line or
   arc (the click must snap to an endpoint); the Line tool draws the same
   arc when the user presses on the chain's end (or, before a chain starts,
   on any line or arc end) and drags, then carries on from the arc's end.
   The tangent's `reversed` flag comes from the geometry at hand (the curve's
   stored direction at the joint against the arc's). The solver package's
   `tangentReversed` would give the same answer, but only through the
   `@extrudo/sketch` main entry.
5. **Drags reach tools through two optional hooks.** The viewport reports a
   left press that moves more than 5 px as `onDragStart` (at the press
   position) and its release as `onDragEnd`; a press and release that far
   apart with no move between them (coalesced events) count as a drag too.
   The host passes them on to the tool's `dragStart`, which returns whether
   it takes the drag, and `dragEnd`, which returns an edit like a click.
6. **Construction is a drawing mode, not a document or a preference.** The
   host holds a `construction` flag; `X` and the palette's Construction
   checkbox flip it; tools read it through `ToolContext.construction()` when
   they create curves. It resets when the sketch closes. The preview draws
   dashed and muted while it's on. Points have no construction flag.
7. **Heads-up fields per tool:** rectangles take width and height (3-point:
   the edge's length and angle, then the height); the center circle and the
   2-point circle take the diameter; the 3-point arc takes the radius in
   place of its third point; the center arc takes the radius, then the
   sweep angle (negative is clockwise). Typed widths, heights and lengths
   become `distance` dimensions on the edges, a typed diameter a `diameter`
   dimension, a typed radius a `radius` dimension. A typed sweep only
   places the end: there is no arc-angle dimension type.
8. **The center arc turns the way the pointer went round.** The tool adds up
   the pointer's signed angle steps around the center (each wrapped to ±180°),
   up to a full turn, so arcs over 180° are drawn by going round, and the
   sign picks the direction.
9. **Previews grow arcs and guides.** `ToolPreview` has `arcs` (circles
   when `from`/`sweep` are missing) and thin dashed `guides` (radius lines,
   a center rectangle's diagonals, a 3-point arc's chord). Arcs are drawn as
   polylines projected point by point, so they stay right on a tilted plane.

## Rejected options

- **One Rectangle/Circle/Arc tool with a mode switch inside** (like a
  dropdown on one button): the tool would carry every mode's state, and
  shortcuts and menus would need a second level of IDs. Separate tool IDs
  cost only catalogue entries.
- **A symmetric constraint to center a rectangle**: it needs an axis line,
  so it would need construction geometry anyway; diagonals with a midpoint
  use existing types and look like what the user expects.
- **Choosing the center arc's direction from the shortest way round**: arcs
  over 180° couldn't be drawn.
- **Treating only moves beyond 5 px as a drag**: automation and fast
  gestures can deliver press and release with no move between; they turned
  into a click at the release point, a line segment the user didn't draw.
  Found in manual testing in the browser pane.
- **Throwing on `setPointerCapture`**: synthetic pointers (and some test
  drivers) can't be captured; capture is now best effort, after the drag
  has started.

## Consequences

- P1-05's tools (polygon, slot, ellipse, spline) reuse the builders; slots
  are lines and tangent arcs.
- The toolbar tile of a family isn't shown pressed while one of its other
  modes runs (only the menu shows which is active).
- Converting existing geometry to construction with `X` needs a selection:
  P1-09. Centerlines (a line style for revolve axes) come with P2-07.
- A point placed with the Point tool on an existing point adds a second,
  coincident point. Harmless; P1-09's delete cleans it up if unwanted.
- The app's main chunk is at about 982 kB of the 1000 kB warning limit. If
  P1-05's tools push it over, move the sketch tools into a lazy chunk that
  loads with sketch mode.
