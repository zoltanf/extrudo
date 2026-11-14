---
title: Center Rectangle
section: Tools
category: Sketch
order: 75
---

# Center Rectangle

From the center out to a corner.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<video src="demo:rectangleCenter" muted loop autoplay playsinline aria-label="Center Rectangle demo"></video>

<!-- notes -->
## Step by step

1. Choose **Center Rectangle** and click the center. The pointer snaps to
   existing points, midpoints, crossings, curves, and level or plumb with
   other points; each snap is also a
   [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Move to a corner. The preview shows the four sides and the two diagonals
   through the center, and the heads-up boxes show **Width** and **Height**,
   the size of the whole rectangle.
3. Click the corner. The rectangle is drawn at once, and the tool stays on
   for the next one.
4. To place the corner by numbers, type while the preview follows the
   pointer: a digit goes into the **Width** box, `Tab` moves to **Height**,
   Enter places the rectangle. Numbers are [expressions](../parameters.md),
   so `wall * 2` works. The rectangle grows toward the side of the center
   where the pointer is.
5. `Esc` steps back a stage: the typed values, then the center, then the
   tool ends. Each rectangle is one undo step, named Draw.

If the pointer is on the center's row or column, so the rectangle would have
no width or no height, a click draws nothing. Move away and click again.

## Options

- **Width** (heads-up box): the live width of the whole rectangle, not half
  of it. Type a number or an expression to lock it. It must be more than
  zero.
- **Height** (heads-up box): the live height, locked the same way. You can
  lock one or both.
- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the four sides are construction geometry, grey and
  dashed, and never a profile. The two diagonals are construction either
  way.

## What it keeps

- Four lines, joined end to end: **Coincident** at every corner.
- The two sides that run left to right get **Horizontal**, the other two
  get **Vertical**.
- Two construction diagonals, one between each pair of opposite corners,
  with their ends **Coincident** with the corners.
- A center point held by **Midpoint** on one diagonal, so the rectangle
  stays centered on it. The center and the corner keep what they snapped
  to; a center placed on the origin is fixed there.
- A typed width or height becomes a driving dimension on a side. The corner
  you typed values for is not held to a snap. With nothing typed the tool
  adds no dimension.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn geometry stays as clicked.

## Messages

- "Click the center.": the prompt before the first click.
- "Click a corner, or type the width (Tab: height).": the prompt once the
  center is placed.
<!-- /notes -->
