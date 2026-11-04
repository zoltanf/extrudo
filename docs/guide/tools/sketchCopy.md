---
title: Copy
section: Tools
category: Sketch
order: 102
---

# Copy

Copy curves from one point to another, as often as you click.

| Where | Shortcut |
|---|---|
| Sketch › Modify | None |

<video src="demo:sketchCopy" muted loop autoplay playsinline aria-label="Copy demo"></video>

<!-- notes -->
## Step by step

1. Choose **Copy** in Sketch › Modify. It has no shortcut. If curves or
   points are selected already, the tool starts with them and you can skip
   to step 3.
2. Otherwise click what to copy. A click picks a curve or a point, a second
   click lets it go; a point under the pointer wins over a curve. A picked
   curve brings its own end points. Press Enter when the set is right.
3. Click the point to copy from. It snaps the way the drawing tools do.
4. Move the pointer: the preview shows the copy where it would land, with a
   guide from the point you clicked. To place it by numbers, type while the
   preview follows: a digit goes into the **Distance** box beside the
   pointer, `Tab` moves to **Angle**. Numbers are
   [expressions](../parameters.md).
5. Click, or press Enter, to drop a copy. The tool stays on: every further
   click drops another copy of the same originals, measured from the same
   first point.
6. `Esc` steps back a stage. From the second point it returns to the first
   and drops typed values; from the first point it returns to the picks, which
   stay marked. There, `Esc` drops the picks, and once more ends the tool.
7. Each copy is one undo step, named Copy.

## Options

- **Distance** (heads-up box): how far to put the copy. Type a number or an
  expression to lock it; the direction still follows the pointer. The typed
  values are used for one copy; the next click starts from the pointer again.
- **Angle** (heads-up box): the direction, in degrees from horizontal. Type
  one to lock it; with no distance typed, the distance is how far the
  pointer reaches along that direction.
- `Ctrl` (hold): choose the points without snapping.

A click at the point you started from, which would put the copy on its
original, does nothing.

## What it keeps

- A copy of each picked curve and point, with its end points, the same size
  and kind, and the same construction setting.
- The constraints among the copied geometry come with the copy, Fix,
  Horizontal and Vertical included. A constraint to geometry you didn't copy
  stays with the original.
- So do the dimensions whose geometry is all copied. Each copy keeps the
  original's expression (`20`, or `wall`) and gets a parameter of its own.
- Nothing ties a copy to its original: it is placed, and moves on its own.
- The original is not changed.

## Messages

- "Pick points and curves, then press Enter.": the prompt while you choose
  what to copy.
- "Click the point to move from.": the prompt after Enter.
- "Click where each copy goes. Esc when done.": the prompt after the first
  point.
<!-- /notes -->
