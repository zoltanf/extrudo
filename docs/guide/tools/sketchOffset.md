---
title: Offset
section: Tools
category: Sketch
order: 97
---

# Offset

Copy a chain of curves at a distance. Type the distance.

| Where | Shortcut |
|---|---|
| Sketch › Modify | O |

<video src="demo:sketchOffset" muted loop autoplay playsinline aria-label="Offset demo"></video>

<!-- notes -->
## Step by step

1. Press `O` and click a line, arc, circle or spline. The curve and every
   line, arc or open spline joined to it end to end by a Coincident
   constraint come with it, and show as picked. The chain stops where more
   than two curves meet. A circle, or a closed spline, is a chain on its own.
2. Move the pointer to the side you want. The preview shows the copy in the
   accent colour, and the heads-up box beside the pointer shows **Distance**,
   how far the pointer is from the chain, rounded to the document's
   precision. Type a number or an [expression](../parameters.md) to lock the
   distance; the pointer still sets the side.
3. Click to place the copy, or press `Enter` to place it on the pointer's
   side. The chain you picked is let go and the tool stays on: pick another
   chain.
4. `Esc` lets go of the picked chain, if there is one, else ends the tool.
5. Each offset is one undo step, named Offset. The original is not changed.

## Options

- **Distance** (heads-up box): the pointer's distance from the chain, or the
  typed one. A locked distance stays for the next chain, and `Esc` in the box
  clears it. If the preview shows nothing, the pointer is on the curve or
  the distance is too big for this chain.

## What it keeps

- Each new line is **Parallel** to its original and each new arc
  **Concentric** with it. The new pieces meet where the offset curves cross:
  corners stay sharp, and every joint is **Coincident**. A tangent or smooth
  joint of the original is tangent or smooth in the copy.
- With a line in the chain, each new line gets a distance dimension to its
  original. The first is a driving dimension and a parameter, and the others
  use its parameter, so one value drives the whole offset. The later
  parallels and distances are added only where the sketch doesn't already
  hold them, for example through a tangent joint to an arc.
- A circle, or a chain of arcs only, has no line to measure to: the copy of
  a circle gets a diameter dimension, and the first arc of a chain of arcs a
  radius dimension, with the new size as its value.
- A spline has no exact offset. The copy is a fit spline through points of
  the true offset, within 0.001 mm of it, and it is fixed. A chain with a
  spline in it gets no distance or size dimension; its lines stay parallel
  and its arcs concentric.
- Each new curve is construction geometry if its original is.
- A projected curve can be offset. The edges of a projected outline count as
  joined where the model's edges meet, and the copy keeps tangent joints
  where the outline runs smoothly.

## Messages

- "Pick a curve to offset (its joined curves come too).": the prompt.
- "Move to the side to offset to, and click. Type a distance to set it.": the
  prompt once a chain is picked.
- "Move the pointer off the curve.": the distance is zero. Move the pointer
  away from the chain, or type a distance.
- "That is further than the circle is wide.": an inward distance as big as
  the circle's radius, or bigger. Use a smaller one, or the outer side.
- "That is further than an arc is wide.": the same for an arc of the chain.
- "That is further than a line of the chain is long.": the distance turns
  a line of the chain inside out. Use a smaller one.
- "That is further than an arc of the chain is long.": the same for an arc.
- "That is further than a spline of the chain is long.": the same for a
  spline.
- "At that distance two of the curves don't meet any more.": two neighbouring
  pieces of the copy no longer cross. Use a smaller distance.
- "The spline is too tight for that distance.": the copy of a spline can't be
  fitted to the true offset at that distance. Use a smaller one.
- "The offset is larger than the spline's tightest bend.": the distance is
  larger than the radius of the spline's tightest bend. Use a smaller one.

After one of these messages the chain stays picked: change the distance and
click again.
<!-- /notes -->
