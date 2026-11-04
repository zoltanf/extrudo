---
title: Concentric
section: Tools
category: Sketch
order: 106
---

# Concentric

Give circles and arcs the same center.

| Where | Shortcut |
|---|---|
| Sketch › Constraints | K O |

<video src="demo:concentric" muted loop autoplay playsinline aria-label="Concentric demo"></video>

<!-- notes -->
## Step by step

1. Press `K` then `O` and hover a circle or an arc: it lights up where a
   click would pick it.
2. Click the first circle or arc.
3. Click the second. It can't be the first one again.
4. The second click adds the constraint and solves the sketch in the same
   step. The tool stays on for the next pair. `Esc` drops the last pick,
   then ends the tool.
5. Each constraint is one undo step, named Draw.

A body edge is not taken as a pick, because it comes in as a line or a
point. To use a round one, [project](./project.md) it first; the projected
circle can then be picked.

![Concentric: two circles offset, then sharing one centre](../images/sketching/constraint-concentric.figure.svg)

## What it keeps

- The two centers become one point. Radii and arc ends are not touched. The
  solver decides what moves; fixed and projected geometry stays.
- One glyph sits on each circle or arc, labelled **Concentric**.
- To remove it, press `Esc` to leave the tool, click a glyph and press
  `Delete`.

## Messages

- "Pick a circle or an arc.": the prompt for the first pick.
- "Pick a circle or an arc to share its center.": the prompt for the second.
- "Concentric isn't needed: the sketch already holds it.": the centers are
  tied together already.
- "Concentric would conflict with the sketch's other constraints.": other
  constraints or dimensions forbid it, or solving it would shrink a curve to
  nothing. Nothing changed.
- "Pick a straight edge, or project the edge first (P).": the pointer is on
  a curved body edge. Project it first, or pick a circle or arc of the
  sketch.
<!-- /notes -->
