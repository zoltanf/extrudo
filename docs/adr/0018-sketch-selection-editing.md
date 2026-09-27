# ADR-0018: Selection, dragging and deleting in sketch mode

- **Status:** Accepted, 2026-09-27
- **Task:** P1-09 (selection and editing in sketch; FR-VP-05 sketch part,
  the dragging half of FR-SK-09). Code: selection, drags, `box`, `moveTo`
  and `setRadius` in `apps/web/src/sketch/tools/host.ts`; `boxSelect` in
  `packages/sketch/src/inference/pick.ts`; several-point drags
  (`beginDrag(ids)`, `dragBy`) in `packages/sketch/src/solver/solver.ts`;
  `removeFromSketch` with entities, `entityRemoval` and
  `setSketchConstruction` in `packages/core/src/sketch/commands.ts`; the
  box in `apps/web/src/viewport/Viewport.tsx`; highlights in
  `sketch/tools/SelectionOverlay.tsx`; `SelectionPanel` in
  `sketch/panels.tsx`.
- **Builds on:** ADR-0011 (solver adapter and its drag), ADR-0012 (tool
  host, picking), ADR-0015 (glyph selection, Delete), ADR-0016 (`apply`),
  ADR-0017 (status).
- **Affects:** P1-10 (modify tools start from a selection), P1-11 (profile
  picking joins the same picking), P1-12 (browser and timeline selection).

## Context

Until now a click in the view with no tool running only cleared the
selection; only constraint glyphs and dimension labels could be selected
and deleted. P1-09 asks for click and box selection (window vs crossing),
dragging geometry with a live solve, deleting with constraint cleanup, and
a properties panel. The solver could drag one point at a time.

## Decision

1. **The tool host does selection when no tool runs.** The viewport already
   sends it pointer moves, clicks and drags on the sketch plane; with no
   tool, the host picks with `pickEntity` (points before curves, 8 px):
   a move sets the session's `hover` (`sketchEntity`, the `GeomRefKind`
   that was already there), a click selects (`replace`, or `toggle` with
   Shift, Ctrl or ⌘; `PlanePointer.toggle`), a click on empty space clears
   unless a modifier is held. One picking path for tools and selection.
2. **A drag is the geometry's if it starts on geometry, else a box.**
   `onDragStart` now returns whether the drag is taken (by a tool, or by the
   entity under the press). The viewport draws a box for a drag nobody
   takes and, on release, maps the screen rectangle's four corners onto the
   sketch plane (`SketchBox`), so a tilted view selects what it shows.
   Left to right is a **window** (solid): what lies wholly inside;
   right to left is **crossing** (dashed): what it touches. `boxSelect`
   tests curve polylines against the quadrilateral. Points count, so a
   window around a line takes its ends too (as Fusion does); Shift adds.
3. **Dragging moves the whole selection if the pressed entity is selected,
   else that entity alone,** as the points that make them up (a line by
   both ends, a circle by its center: moving, not resizing). The solver's
   drag now takes several points, across components: each gets temporary
   coordinate constraints in its own system, all offset by the pointer's
   travel (`dragBy`). Fixed points are left out; the rest follows what
   the constraints allow. Each step is stored with `setSketchGeometry`
   inside a nested undo transaction (`Move`), so the view, glyphs, labels
   and driven values follow live and the drag is one undo step; Esc
   cancels the transaction. The status isn't re-solved during the drag (a
   solve would end it; positions don't change which entities are free) and
   is refreshed at the end.
4. **Deleting geometry cleans up in the command.** `removeFromSketch`
   takes entities; `entityRemoval` works out the rest: a curve takes its
   points; a curve's point takes the curve (a spline with more than two
   points only loses that point); every constraint and dimension on a
   removed entity goes. A removed driving dimension whose parameter another
   expression uses refuses the whole delete (`refuseIfUsed`), as before.
5. **The properties panel floats in the view's bottom-left corner**, only
   while something is selected and no tool runs: type (or "N selected"
   with a breakdown), the entity's status (can move, fully constrained,
   over-constrained), a point's X and Y and a circle's or arc's radius as
   `<ExpressionInput>`s, a line's length and angle as readouts, the
   construction flag (`setSketchConstruction`) and Delete. Typed X/Y move
   the point as a drag would (`moveTo`: a one-step drag), and say so when
   constraints hold it short. A typed radius is set and the sketch solved
   (`setRadius`); if the solve moves it off the value, the edit is refused
   ("change its constraints or dimensions").

## Rejected options

- **Selection as its own module beside the host.** It needs the host's
  picking, solver and undo handling; a second pointer consumer would also
  have to agree with the host on who owns a drag.
- **A preview layer for drags instead of document writes.** Every
  consumer (WebGL sketch, glyphs, labels, driven values, status) would need
  to read it. Writes inside a nested transaction cost a small patch per
  frame and keep one source of truth.
- **Box tests in screen space.** The host has no projection; mapping four
  corners to the plane keeps `boxSelect` pure and testable in sketch mm.
- **Dragging a circle's edge to resize it** (Fusion does). A drag on a
  curve moves it, one rule for every curve; the radius is in the panel.
  *Reversed 2026-09-27, see the amendment:* a circle with a fixed centre
  couldn't be resized by dragging at all.
- **The panel under the palette** in the right column: at 900 px the
  palette leaves too little room and the panel was cut off.
- **Deleting a spline whenever one of its points goes.** Losing one fit
  point of many is the useful edit.

## Consequences

- Drags solve on every pointer move. Small sketches are well under a
  frame; a closed gear-like loop drags at ~120 ms per step (risk register,
  ADR-0011): still to do, a worker or a kept BFGS matrix.
- Nothing snaps or infers while dragging, and no constraints are added.
- Selection lives in the session, so it survives tool switches but not
  leaving the sketch; entities that are deleted (or undone away) drop out
  of it where it is read.
- A drag with the solver not yet loaded does nothing (a few ms after the
  sketch opens).

## Amendment, 2026-09-27 (resizing circles by the rim)

A user fixed a circle's centre, left its radius free ("1 DOF left") and
couldn't drag it bigger: the rim drag tried to move the centre. Now a drag
that starts on a circle's rim, with nothing else selected, **resizes** it
when its radius can change, as in Fusion; a drag on the centre point moves
it. `SketchSolver.beginRadiusDrag(circle)` adds a temporary
`circle_radius` constraint on a drag parameter, and `dragRadius(r)` pulls
toward `r` (the rest of the component follows). The host sets `r` to the
start radius plus the change in the pointer's distance from the centre, so
the grab offset is kept, never below 0.01 mm. To decide, the host pulls the
radius once on trial (`rimDrag`: +10 % or 0.5 mm, whichever is more); if it
doesn't give (a dimension, an equal to a held circle), the drag moves the
circle as before. The undo step is "Resize" or "Move". A circle dragged
with other selected entities still moves with them. Arcs keep moving when
dragged: resizing one also moves its ends, which needs its own rule.

