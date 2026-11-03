---
title: Smooth
section: Tools
category: Sketch
order: 113
---

# Smooth

Join curves with no jump in curvature (G2).

| Where | Shortcut |
|---|---|
| Sketch › Constraints | K G |

<video src="demo:smooth" muted loop autoplay playsinline aria-label="Smooth demo"></video>

<!-- notes -->
## Step by step

1. Press `K` then `G` and click a line, a circle or an arc. Hovering shows
   what a click would pick; the picked curve stays lit. The pointer does
   not snap while you pick.
2. Click a second line, circle or arc. The constraint is added and the
   sketch settles. Two lines are refused, and the same curve can't be
   picked twice.
3. The tool stays on for the next pair. `Esc` drops the last pick; with no
   pick left, `Esc` ends the tool.
4. Each constraint is one undo step, named Draw.

![Smooth: two curves meeting at a corner, then meeting smoothly](../images/sketching/constraint-smooth.figure.svg)

## What it keeps

- The solver holds Smooth as a tangency, exactly as [Tangent](./tangent.md)
  does: the curves meet with no corner. Splines can't be picked by this
  tool.
- Two curves that share an end point keep touching there. The constraint
  remembers the side it was added on: whether the curves point the same
  way or opposite ways at that end. Curves with no shared end are tangent
  at a point the solver finds, with no side to keep.
- The solver decides what moves. A fixed or projected curve does not move.
- The glyph shows once at the shared end point when the curves end at the
  same spot, otherwise on each curve. Its tooltip says Smooth. To remove
  the constraint, press `Esc` to leave the tool (glyphs take clicks only
  while no tool runs), then click the glyph and press `Delete`, or
  right-click it for a menu with Delete.
- A straight body edge, with
  [Auto-project](../sketching.md#auto-project) on, or an origin axis can
  be the line. A body edge is projected into the sketch and the constraint
  is added once the projection arrives. For a curved body edge, project it
  first.

## Messages

- "Pick a line, circle or arc.": the prompt.
- "Pick a curve to make smooth (G2) with it.": the prompt after the first
  curve.
- "Pick a straight edge, or project the edge first (P).": with
  Auto-project on, you clicked a curved body edge. Project it with `P`,
  then pick the projected curve.
- "Smooth isn't needed: the sketch already holds it.": the two curves are
  already tangent through other constraints. Nothing is added.
- "Smooth would conflict with the sketch's other constraints.": the other
  constraints or dimensions rule it out. Nothing is added.
- "Couldn't hold Smooth on the body geometry.": the body edge you picked
  could not be projected for the constraint. Nothing is added.
<!-- /notes -->
