---
title: Sketch Chamfer
section: Tools
category: Sketch
order: 99
---

# Sketch Chamfer

Cut the corner between two lines. Type the distance.

| Where | Shortcut |
|---|---|
| Sketch › Modify | None |

<video src="demo:sketchChamfer" muted loop autoplay playsinline aria-label="Sketch Chamfer demo"></video>

<!-- notes -->
## Step by step

1. Open the **Modify** menu (the group name, with its arrow, under the
   tiles) in a sketch and choose **Sketch Chamfer**. Click the corner: the
   point where two lines end. Or click the first of the two lines, then the
   second. Click each line on the side you want to keep. The lines don't have
   to touch: the corner is where they meet when extended.
2. The heads-up box beside the pointer shows **Distance**, a quarter of what
   the corner allows. Type a number or an
   [expression](../parameters.md) to lock it; the preview follows as you
   type. `Enter` keeps the value but doesn't place the chamfer.
3. The preview shows the new line and, in red, the corner pieces it
   replaces. Click to cut the corner.
4. The tool stays on with the same distance for the next corner. `Esc` drops
   the first line if you picked one, else ends the tool.
5. Each corner is one undo step, named Chamfer.

## Options

- **Distance** (heads-up box): how far from the corner the cut starts on each
  line. It is a quarter of what the corner allows, or the typed value. A
  locked distance stays for the next corner; if the preview shows nothing,
  the value is too big for this corner. `Esc` in the box clears the typed
  value.

## What it keeps

- The chamfer is a straight line between the two cut ends, the same distance
  from the corner along each line. Each line's new end is **Coincident** with
  an end of the chamfer.
- The distance is a driving dimension and a parameter. The corner gets two
  distance dimensions, one along each line, and the second uses the first's
  parameter, so one value drives both and other fields can use it.
- The corner's end points are pulled back along the lines, and a virtual
  sharp stays where the corner was, held on both lines. Constraints and
  dimensions on the old ends move to the sharp: a line's length now measures
  from the sharp to its far end. A midpoint or equal lengths on the two lines
  go, as does a tangency that sat at the corner.
- If both lines were construction geometry, the chamfer is construction too.

## Messages

- "Pick a corner, or the first of two lines.": the prompt.
- "Pick the second line.": the prompt after the first of two lines.
- "Those two lines make no corner to cut.": the second click was on a line
  that makes no corner with the first: it is parallel, or the corner lies
  past the end of a line on the side you clicked. The first line stays
  picked; click another line, or press `Esc` to start over.
- "The distance must be more than zero.": the typed distance is zero or less.
- "That distance doesn't fit this corner.": the distance is as long as the
  shorter of the two lines, measured from the corner, or longer; a smaller
  one fits.
- "Projected geometry follows the model and can't be changed here. Delete
  it, or change the model.": one of the corner's lines is a projected curve,
  which only the model may move.
<!-- /notes -->
