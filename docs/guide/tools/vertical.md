---
title: Vertical
section: Tools
category: Sketch
order: 113
---

# Vertical

Make a line vertical, or line up two points.

| Where | Shortcut |
|---|---|
| Sketch › Constraints | K V |

<video src="demo:vertical" muted loop autoplay playsinline aria-label="Vertical demo"></video>

<!-- notes -->
## Step by step

1. Press `K` then `V`. Hover a line or a point: it lights up where a
   click would pick it.
2. To make a line vertical, click it. The constraint goes in at once. Near
   a line's end a click picks the end point, so click along the line.
3. To line up two points, click the first point, then the second. The first
   point may be a line's end, a circle's center, the origin or a body
   corner; once a point is picked, a line is not taken.
4. The tool stays on for the next one. `Esc` drops a picked point, then ends
   the tool.
5. Each constraint is one undo step, named Draw.

![Vertical: a slanted line, then upright](../images/sketching/constraint-vertical.figure.svg)

## What it keeps

- A line stays vertical: its two ends keep the same left-right place. Two
  points are held one above the other. The solver decides what moves; fixed
  and projected geometry stays.
- A line shows one glyph on its middle, labelled **Vertical**. Two
  points show one glyph halfway between them, with a dotted icon, labelled
  **Vertical (points)**, on the side away from any curve. If one of
  the points is fixed or projected, the glyph sits beside the other.
- An origin axis can't be used: pick the origin point, or a line of the
  sketch.
- To remove it, press `Esc` to leave the tool, click the glyph and press
  `Delete`.

## Messages

- "Pick a line to make vertical, or two points to line up.": the prompt.
- "Pick the second point.": the prompt after the first point.
- "An axis has no length or middle; pick a sketch line.": the click was on
  an origin axis. Pick a line of the sketch.
- "Vertical isn't needed: the sketch already holds it.": the line is
  vertical already, or the two points are aligned already.
- "Vertical would conflict with the sketch's other constraints.": other
  constraints or dimensions forbid it, or solving it would shrink a line to
  nothing. Nothing changed.
- "Pick a straight edge, or project the edge first (P).": the pointer is on
  a curved body edge. Project it with [Project](./project.md) first, or pick
  something else.
- "Couldn't hold Vertical on the body geometry.": the body edge or corner you
  picked could not be projected for the constraint. Nothing changed.
<!-- /notes -->
