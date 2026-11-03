---
title: 2-Point Rectangle
section: Tools
category: Sketch
order: 68
---

# 2-Point Rectangle

From two opposite corners. Type the width, Tab to the height.

| Where | Shortcut |
|---|---|
| Sketch › Create | R |

<video src="demo:rectangle" muted loop autoplay playsinline aria-label="2-Point Rectangle demo"></video>

<!-- notes -->
## Step by step

1. Press `R` and click the first corner. The pointer snaps to existing
   points, midpoints, crossings, curves, and level or plumb with other
   points; each snap is also a [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Move to the opposite corner. The preview shows the four sides, and the
   heads-up boxes beside the pointer show **Width** and **Height**.
3. Click the opposite corner. The rectangle is drawn at once, and the tool
   stays on for the next one.
4. To place the corner by numbers, type while the preview follows the
   pointer: a digit goes into the **Width** box, `Tab` moves to **Height**,
   Enter places the rectangle. Numbers are [expressions](../parameters.md),
   so `wall * 2` works. The rectangle grows toward the side of the first
   corner where the pointer is.
5. `Esc` steps back a stage: the typed values, then the first corner, then
   the tool ends. Each rectangle is one undo step, named Draw.

If the pointer is on the first corner's row or column, so the rectangle
would have no width or no height, a click draws nothing. Move away and
click again.

## Options

- **Width** (heads-up box): the live width. Type a number or an expression
  to lock it. It must be more than zero.
- **Height** (heads-up box): the live height, locked the same way. You can
  lock one or both.
- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the four sides are construction geometry, grey and
  dashed, and never a profile.

## What it keeps

- Four lines, joined end to end: **Coincident** at every corner.
- The two sides that run left to right get **Horizontal**, the other two
  get **Vertical**, so it stays square to the axes.
- A first or opposite corner snapped to a point or a curve is held there:
  **Coincident** with a point, **Midpoint**, on the curve. A corner on the
  origin is fixed there.
- A corner level or plumb with the end of a level or plumb line makes the
  two edges **Collinear** instead of tying the corner points. Level with a
  lone point or a circle centre, the two points are tied.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn geometry stays as clicked.
- A typed width or height becomes a driving dimension on that side, so it
  stays editable later. A corner you typed values for is not held to a
  snap. With nothing typed the tool adds no dimension.

## Messages

- "Click the first corner.": the prompt before the first click.
- "Click the opposite corner, or type the width (Tab: height).": the prompt
  once the first corner is placed.
<!-- /notes -->
