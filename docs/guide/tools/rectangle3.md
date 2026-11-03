---
title: 3-Point Rectangle
section: Tools
category: Sketch
order: 72
---

# 3-Point Rectangle

One edge at any angle, then the height.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<!-- notes -->
## Step by step

1. Choose **3-Point Rectangle** and click the first corner. The pointer
   snaps to existing points, midpoints, crossings, curves, and level or
   plumb with other points; each snap is also a
   [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Click the end of the first edge, at any angle. The preview shows the edge
   while you move, and the heads-up boxes show **Length** and **Angle**.
   To place it by numbers, type a digit into **Length**, `Tab` to **Angle**,
   and press Enter. Numbers are [expressions](../parameters.md), so
   `wall * 2` works.
3. Move to the side the rectangle goes on and click to set the height. The
   preview shows all four sides, and the **Height** box shows the live
   value. Or type the height and press Enter. The rectangle is drawn at
   once, and the tool stays on for the next one.
4. `Esc` steps back a stage: the typed values, then the last click (the edge,
   then the first corner), then the tool ends. Each rectangle is one undo
   step, named Draw.

## Options

- **Length** (heads-up box, first edge): the edge's live length. Type a
  number or an expression to lock it. A typed length becomes a driving
  dimension on that edge, so it stays editable later.
- **Angle** (heads-up box, first edge): the live angle from horizontal. Type
  one to lock it. A multiple of 90° makes the edge horizontal or vertical
  instead of adding a dimension; any other angle only steers the edge.
- **Height** (heads-up box, second stage): type a number or an expression to
  lock it. It must be more than zero, and becomes a driving dimension on the
  second edge.
- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the four sides are construction geometry, grey and
  dashed, and never a profile.

## What it keeps

- Four lines, joined end to end: **Coincident** at every corner.
- The first edge is **Perpendicular** to the second, and each side is
  **Parallel** to the one opposite. The rectangle gets no Horizontal or
  Vertical of its own, except as below.
- The first corner and the end of the first edge keep what they snapped to:
  **Coincident** with a point, **Midpoint**, on a curve. A corner on the
  origin is fixed there.
- If the end of the first edge lines up level or plumb with the first
  corner, the edge gets **Horizontal** or **Vertical**.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn geometry stays as clicked.
- With nothing typed the tool adds no dimension.

## Messages

- "Click the first corner.": the prompt before the first click.
- "Click the end of the first edge, or type its length (Tab: angle).": the
  prompt once the first corner is placed.
- "Click to set the height, or type it.": the prompt once the first edge is
  placed.
<!-- /notes -->
