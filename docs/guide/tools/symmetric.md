---
title: Symmetric
section: Tools
category: Sketch
order: 116
---

# Symmetric

Mirror two things about a line.

| Where | Shortcut |
|---|---|
| Sketch › Constraints | K S |

<video src="demo:symmetric" muted loop autoplay playsinline aria-label="Symmetric demo"></video>

<!-- notes -->
## Step by step

1. Press `K` then `S` and click a point, a line, a circle or an arc. This
   is the thing to mirror. Hovering shows what a click would pick; picks
   stay lit. The pointer does not snap while you pick.
2. Click its mirror image: a point after a point, a line after a line, a
   circle or an arc after a circle or an arc (a circle may pair with an
   arc).
3. Click the line to mirror about. The constraint is added and the sketch
   settles. Any line works, construction or not. The same entity can't be
   picked twice.
4. The tool stays on for the next set. `Esc` drops the last pick; with no
   pick left, `Esc` ends the tool.
5. Each constraint is one undo step, named Draw.

![Symmetric: two things, then the line to mirror about](../images/sketching/constraint-symmetric.figure.svg)

## What it keeps

- Two points: the line runs through their midpoint and is square to the
  line between them.
- Two lines: each end of one is mirrored by an end of the other. Each end
  pairs with the end its mirror image lies nearer to.
- Two circles: the centres are mirrored and the radii are equal. A circle
  with an arc does the same with the arc's centre.
- Two arcs: the ends are mirrored, a's start by b's end (a mirrored arc
  runs the other way), and the radii are equal.
- The solver decides what moves, and the mirror line may turn too. A fixed
  or projected thing does not move.
- The glyph shows on the two mirrored things, not on the mirror line.
  To remove
  the constraint, press `Esc` to leave the tool (glyphs take clicks only
  while no tool runs), then click the glyph and press `Delete`, or
  right-click it for a menu with Delete.
- The origin point, a body vertex or an origin axis can be picked where
  the tool takes a point or a line. A straight body edge counts as a line
  when [Auto-project](../sketching.md#auto-project) is on: it is
  projected into the sketch and the constraint is added once the
  projection arrives.

## Messages

- "Pick a point, line, circle or arc.": the prompt.
- "Pick its mirror image.": the prompt after the first pick.
- "Pick the line to mirror about.": the prompt after the second pick.
- "Pick a straight edge, or project the edge first (P).": with
  Auto-project on, you clicked a curved body edge. Project it with `P`,
  then pick the projected curve.
- "Symmetric isn't needed: the sketch already holds it.": the sketch
  already mirrors those two things about that line. Nothing is added.
- "Symmetric would conflict with the sketch's other constraints.": the
  other constraints or dimensions rule it out. Nothing is added.
- "Couldn't hold Symmetric on the body geometry.": the body edge or vertex
  you picked could not be projected for the constraint. Nothing is added.
<!-- /notes -->
