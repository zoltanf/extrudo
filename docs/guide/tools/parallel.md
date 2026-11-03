---
title: Parallel
section: Tools
category: Sketch
order: 108
---

# Parallel

Make lines parallel.

| Where | Shortcut |
|---|---|
| Sketch › Constraints | K P |

<video src="demo:parallel" muted loop autoplay playsinline aria-label="Parallel demo"></video>

<!-- notes -->
## Step by step

1. Press `K` then `P` and click a line. Hovering shows what a click would
   pick; the picked line stays lit. The pointer does not snap while you
   pick. Near the end of a line you pick the line, not its end point.
2. Click a second line. The constraint is added and the sketch settles.
   The same line can't be picked twice.
3. The tool stays on for the next pair. `Esc` drops the last pick; with no
   pick left, `Esc` ends the tool.
4. Each constraint is one undo step, named Draw.

![Parallel: two lines at an angle, then parallel](../images/sketching/constraint-parallel.figure.svg)

## What it keeps

- The two lines keep the same direction. It holds the direction only, not
  a distance: the lines need not touch.
- The solver decides which line turns. A fixed or projected line does not
  move.
- The glyph shows on each of the two lines. To remove
  the constraint, press `Esc` to leave the tool (glyphs take clicks only
  while no tool runs), then click the glyph and press `Delete`, or
  right-click it for a menu with Delete.
- A straight body edge, with
  [Auto-project](../sketching.md#auto-project) on, or an origin axis can
  be one of the lines. A body edge is projected into the sketch and the
  constraint is added once the projection arrives. For a curved body edge,
  project it first.

## Messages

- "Pick a line.": the prompt.
- "Pick a line to make parallel to it.": the prompt after the first line.
- "Pick a straight edge, or project the edge first (P).": with
  Auto-project on, you clicked a curved body edge, which is not a line.
  Pick a line, or a straight edge.
- "Parallel isn't needed: the sketch already holds it.": the two lines are
  already parallel through other constraints. Nothing is added.
- "Parallel would conflict with the sketch's other constraints.": the
  other constraints or dimensions rule it out. Nothing is added.
- "Couldn't hold Parallel on the body geometry.": the body edge you
  picked could not be projected for the constraint. Nothing is added.
<!-- /notes -->
