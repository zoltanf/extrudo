---
title: Midpoint
section: Tools
category: Sketch
order: 106
---

# Midpoint

Put a point at the middle of a line or an arc.

| Where | Shortcut |
|---|---|
| Sketch › Constraints | K M |

<video src="demo:midpoint" muted loop autoplay playsinline aria-label="Midpoint demo"></video>

<!-- notes -->
## Step by step

1. Press `K` then `M` and click a point and a line or an arc, in either
   order. Hovering shows what a click would pick; picks stay lit. The
   pointer does not snap while you pick.
2. The second pick adds the constraint and the sketch settles.
3. The tool stays on for the next pair. `Esc` drops the last pick; with no
   pick left, `Esc` ends the tool.
4. Each constraint is one undo step, named Draw.

![Midpoint: a point off a line, then on its middle](../images/sketching/constraint-midpoint.figure.svg)

## What it keeps

- On a line, the point stays halfway between the line's two ends. On an arc,
  the point stays on the arc, equally far from both ends.
- The solver decides what moves to make it true. A fixed or projected
  point, line or arc does not move.
- The glyph sits on the point. To remove
  the constraint, press `Esc` to leave the tool (glyphs take clicks only
  while no tool runs), then click the glyph and press `Delete`, or
  right-click it for a menu with Delete.
- A datum axis has no length or middle, so it can't be the line. The
  origin point can be the point.
- With [Auto-project](../sketching.md#auto-project) on, a body vertex works
  as the point and a straight body edge as the line. The edge or vertex is
  projected into the sketch and the constraint is added once the
  projection arrives. For a curved body edge, project it first.

## Messages

- "Pick a point, or the line or arc to put one at the middle of.": the
  prompt.
- "Pick the line or arc to put it at the middle of.": the prompt after a
  point.
- "Pick the point to put at its middle.": the prompt after a line or an arc.
- "An axis has no length or middle; pick a sketch line.": you clicked a
  datum axis. Pick a line you drew, or a body edge.
- "Pick a straight edge, or project the edge first (P).": with
  Auto-project on, you clicked a curved body edge. Project it with `P`,
  then pick the projected arc.
- "Midpoint isn't needed: the sketch already holds it.": the sketch
  already puts that point at that middle. Nothing is added.
- "Midpoint would conflict with the sketch's other constraints.": the
  other constraints or dimensions rule it out. Nothing is added.
- "Couldn't hold Midpoint on the body geometry.": the body edge or vertex
  you picked could not be projected for the constraint. Nothing is added.
<!-- /notes -->
