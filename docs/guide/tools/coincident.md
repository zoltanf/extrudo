---
title: Coincident
section: Tools
category: Sketch
order: 104
---

# Coincident

Join two points, or put a point on a curve.

| Where | Shortcut |
|---|---|
| Sketch › Constraints | K C |

<video src="demo:coincident" muted loop autoplay playsinline aria-label="Coincident demo"></video>

<!-- notes -->
## Step by step

1. Press `K` then `C`. Hover a point or a curve: it lights up where a click
   would pick it.
2. Click the first thing: a point, or a line, circle, arc or ellipse. The
   origin counts as a point and an origin axis as a line.
3. Click the second. After a point, it can be another point (the two are
   joined) or a curve (the point is put on it). After a curve, it must be a
   point. The same thing can't be picked twice.
4. The second click adds the constraint and solves the sketch in the same
   step. The tool stays on for the next one. `Esc` drops the last pick, then
   ends the tool.
5. Each constraint is one undo step, named Draw.

A body corner or straight edge works as a pick too when **Auto-project** is
on: the pick [projects](./project.md) it into the sketch, and the constraint
goes in once the projection arrives.

![Coincident: two ends apart, then meeting at one point](../images/sketching/constraint-coincident.figure.svg)

## What it keeps

- Two points become one place. A point and a curve keep the point on the
  curve.
- The solver decides what moves. Fixed and projected geometry stays where it
  is.
- The glyph sits on the point and is labelled **Coincident** for both kinds.
  A constraint that over-constrains the sketch shows red.
- To remove it, press `Esc` to leave the tool (glyphs take clicks only while
  no tool runs), click the glyph and press `Delete`. Deleting a point or
  curve takes its constraints with it.

## Messages

- "Pick a point, or a curve to put a point on.": the prompt for the first
  pick.
- "Pick a point or a curve to join it to.": the prompt after a point.
- "Pick a point to put on the curve.": the prompt after a curve; only a
  point is taken now.
- "Coincident isn't needed: the sketch already holds it.": the two are tied
  already. Pick something else.
- "Coincident would conflict with the sketch's other constraints.": other
  constraints or dimensions forbid it, or solving it would shrink a curve to
  nothing. Nothing changed; delete the one in the way first.
- "Pick a straight edge, or project the edge first (P).": the pointer is on
  a curved body edge. Project it with [Project](./project.md) first, or pick
  something else.
- "Couldn't hold Coincident on the body geometry.": the body edge or corner you
  picked could not be projected for the constraint. Nothing changed.
<!-- /notes -->
