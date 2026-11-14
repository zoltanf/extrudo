---
title: Center to Center Slot
section: Tools
category: Sketch
order: 84
---

# Center to Center Slot

A slot from one arc center to the other, then the width.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<video src="demo:slot" muted loop autoplay playsinline aria-label="Center to Center Slot demo"></video>

<!-- notes -->
## Step by step

1. Choose **Center to Center Slot** and click the first arc center. The
   pointer snaps to existing points, midpoints, crossings, curves, and level
   or plumb with other points; each snap is also a
   [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Click the second arc center. A dashed line shows the distance between the
   centers while you move, and the heads-up boxes show **Length** and
   **Angle**. To place it by numbers, type a digit into **Length**, `Tab` to
   **Angle**, and press Enter. Numbers are [expressions](../parameters.md),
   so `wall * 2` works.
3. Move out to set the width. The preview shows the whole slot, and the
   **Width** box shows the live value. The width follows how far the pointer
   is from the line through the two centers: the pointer marks one long side.
   Click to draw the slot, or type the width and press Enter. The tool stays
   on for the next one.
4. `Esc` steps back a stage: the typed values, then the last click (the
   second center, then the first), then the tool ends. Each slot is one undo
   step, named Draw.

If the two centers are on the same spot, or the width is zero, a click
draws nothing. Move away and click again.

## Options

- **Length** (heads-up box, first stage): the distance between the two
  centers. Type a number or an expression to lock it. It must be more than
  zero, and becomes a driving dimension on the centerline.
- **Angle** (heads-up box, first stage): the live angle from horizontal. Type
  one to lock it. A multiple of 90° makes the centerline horizontal or
  vertical instead of adding a dimension; any other angle only steers it.
- **Width** (heads-up box, second stage): the distance between the two long
  sides, so twice the end radius. Type a number or an expression to lock it.
  It must be more than zero, and becomes a driving dimension between the two
  sides.
- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the sides and end arcs are construction geometry, grey
  and dashed, and never a profile. The centerline is construction either way.

## What it keeps

- Two lines and two half-circle arcs, joined end to end: **Coincident** at
  the four joins, with four **Tangent** constraints, one at each join, and
  the two arcs **Equal**.
- A construction centerline whose two ends are **Coincident** with the arc
  centers.
- The two centers keep what they snapped to: **Coincident** with a point,
  **Midpoint**, on a curve. A center on the origin is fixed there. If the
  second center lines up level or plumb with the first, the centerline gets
  **Horizontal** or **Vertical**.
- A typed length becomes a driving dimension on the centerline. The center
  you typed a length or angle for is not held to a snap. With nothing typed
  the tool adds no dimension.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn geometry stays as clicked.

## Messages

- "Click the first center.": the prompt before the first click.
- "Click the second center, or type the length (Tab: angle).": the prompt
  once the first center is placed.
- "Click to set the width, or type it.": the prompt once the second center
  is placed.
<!-- /notes -->
