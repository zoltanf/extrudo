---
title: Edge Polygon
section: Tools
category: Sketch
order: 81
---

# Edge Polygon

A regular polygon built on one edge.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<!-- notes -->
## Step by step

1. Choose **Edge Polygon** and click the first corner of the first side. The
   pointer snaps to existing points, midpoints, crossings, curves, and level
   or plumb with other points; each snap is also a
   [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Click the other end of that side, at any angle. The preview shows the side
   while you move, and the heads-up boxes show **Length**, **Angle** and
   **Sides**. To place it by numbers, type a digit into **Length**, `Tab` to
   **Angle**, and press Enter. Numbers are [expressions](../parameters.md),
   so `wall * 2` works.
3. Move to the side the polygon goes on. The preview shows the whole polygon
   built on the first side, and the **Sides** box is the only one left.
   Click to draw it. The tool stays on for the next one.
4. To change the number of sides, press `Tab` to the **Sides** box and type
   a number at either stage.
5. `Esc` steps back a stage: the typed values, then the last click (the
   side, then the first corner), then the tool ends. Each polygon is one
   undo step, named Draw.

## Options

- **Length** (heads-up box, first side): the side's live length. Type a
  number or an expression to lock it. It must be more than zero.
- **Angle** (heads-up box, first side): the live angle from horizontal. Type
  one to lock it. A multiple of 90° makes the side horizontal or vertical
  instead of adding a dimension; any other angle only steers the side.
- **Sides** (heads-up box): the number of sides, 6 to start with. Type a
  whole number from 3 to 64; any other value is ignored and the count goes
  back to 6. The count stays for the next polygon, and `Esc` does not clear
  it.
- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the polygon's sides are construction geometry, grey
  and dashed, and never a profile. The circle through the corners is
  construction either way.

## What it keeps

- As many lines as sides, joined end to end: **Coincident** at every corner.
  All the sides are **Equal** to the first.
- A dashed construction circle through the corners, with every corner **on**
  it.
- The two ends of the first side keep what they snapped to: **Coincident**
  with a point, **Midpoint**, on a curve. A corner on the origin is fixed
  there. The third click is not held to anything; it only picks the side.
- If the second end lines up level or plumb with the first, the first side
  gets **Horizontal** or **Vertical**.
- A typed length becomes a driving dimension on the first side, so it stays
  editable later. The end you typed a length or angle for is not held to a
  snap. With nothing typed the tool adds no dimension.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn geometry stays as clicked.

## Messages

- "Click the first corner.": the prompt before the first click.
- "Click the end of the edge, or type its length (Tab: angle, sides).": the
  prompt once the first corner is placed.
- "Click the side the polygon goes on.": the prompt once the first side is
  placed.
<!-- /notes -->
