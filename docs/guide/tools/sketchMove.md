---
title: Move
section: Tools
category: Sketch
order: 102
---

# Move

Move curves from one point to another; constraints come along.

| Where | Shortcut |
|---|---|
| Sketch › Modify | M |

<video src="demo:sketchMove" muted loop autoplay playsinline aria-label="Move demo"></video>

<!-- notes -->
## Step by step

1. Press `M`. If curves or points are selected already, the tool starts with
   them and you can skip to step 3.
2. Otherwise click what to move. A click picks a curve or a point, a second
   click lets it go; a point under the pointer wins over a curve. A picked
   curve brings its own end points. Press Enter when the set is right.
3. Click the point to move from. It snaps the way the drawing tools do.
4. Move the pointer: the preview shows the picked geometry where it would
   land, with a guide from the point you clicked. To place it by numbers,
   type while the preview follows: a digit goes into the **Distance** box
   beside the pointer, `Tab` moves to **Angle**. Numbers are
   [expressions](../parameters.md).
5. Click, or press Enter, to move it. The sketch is solved as the geometry
   moves, so what is tied to it comes along.
6. The tool stays on with the same picks: the next click is a new point to
   move from.
7. `Esc` steps back a stage. From the second point it returns to the first
   and drops typed values; from the first point it returns to the picks, which
   stay marked. There, `Esc` drops the picks, and once more ends the tool.
8. Each move is one undo step, named Move.

## Options

- **Distance** (heads-up box): how far to move. Type a number or an
  expression to lock it; the direction still follows the pointer.
- **Angle** (heads-up box): the direction, in degrees from horizontal. Type
  one to lock it; with no distance typed, the distance is how far the
  pointer reaches along that direction.
- `Ctrl` (hold): choose the points without snapping.

A click at the point you started from, which moves nothing, does nothing.

## What it keeps

- It adds no geometry, constraint or dimension, and it removes none.
- It moves the geometry with the solver, not by overwriting positions. A
  line whose end is coincident with an end you moved, for example, follows
  it. If constraints hold the geometry in place, it ends where the solver
  could take it, or does not move at all.

## Messages

- "Pick points and curves, then press Enter.": the prompt while you choose
  what to move.
- "Click the point to move from.": the prompt after Enter.
- "Click where it goes. Type a distance, Tab to the angle.": the prompt after
  the first point.
- "The sketch solver is still loading.": you clicked before the solver was
  ready. Wait a moment and click again.
- "Its constraints don't let it move.": constraints hold the picked geometry
  so that it can't move at all. Remove one, or pick other geometry.
- "Its constraints kept it from moving all the way.": the geometry moved as
  far as constraints let it, and stopped short of the place you chose.
<!-- /notes -->
