---
title: Equal
section: Tools
category: Sketch
order: 115
---

# Equal

Give lines the same length, or circles the same radius.

| Where | Shortcut |
|---|---|
| Sketch › Constraints | K E |

<video src="demo:equal" muted loop autoplay playsinline aria-label="Equal demo"></video>

<!-- notes -->
## Step by step

1. Press `K` then `E` and hover a line, circle or arc: it lights up where a
   click would pick it.
2. Click the first: a line, circle or arc.
3. Click the second, of the same kind. After a line, only a line is taken
   (same length). After a circle or an arc, a circle or an arc is taken
   (same radius), in any mix. A line with a circle is not allowed. The same
   thing can't be picked twice.
4. The second click adds the constraint and solves the sketch in the same
   step. The tool stays on for the next pair. `Esc` drops the last pick (so
   you can start with another kind), then ends the tool.
5. Each constraint is one undo step, named Draw.

A body edge works as a line when **Auto-project** is on and the edge is
straight: the pick [projects](./project.md) it into the sketch, and the
constraint goes in once the projection arrives.

![Equal: two lines of different length, then equal, each marked with an equals sign](../images/sketching/constraint-equal.figure.svg)

## What it keeps

- Lines keep the same length, circles and arcs the same radius. The solver
  decides what moves; fixed and projected geometry stays.
- An origin axis can't be used: it has no length.
- One glyph sits on each of the two, labelled **Equal**.
- To remove it, press `Esc` to leave the tool, click a glyph and press
  `Delete`.

## Messages

- "Pick a line, circle or arc.": the prompt for the first pick.
- "Pick a line to make the same length.": the prompt after a line.
- "Pick a circle or an arc to give the same radius.": the prompt after a
  circle or an arc.
- "An axis has no length or middle; pick a sketch line.": the click was on
  an origin axis. Pick a line of the sketch.
- "Equal isn't needed: the sketch already holds it.": the two are tied to
  one size already.
- "Equal would conflict with the sketch's other constraints.": other
  constraints or dimensions fix the two to different sizes, or solving it
  would shrink a curve to nothing. Nothing changed.
- "Pick a straight edge, or project the edge first (P).": the pointer is on
  a curved body edge. Project it first, or pick a line of the sketch.
- "Couldn't hold Equal on the body geometry.": the body edge you picked
  could not be projected for the constraint. Nothing changed.
<!-- /notes -->
