---
title: Circumscribed Polygon
section: Tools
category: Sketch
order: 81
---

# Circumscribed Polygon

A regular polygon sized across the flats, like a nut.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<!-- notes -->
## Step by step

1. Choose **Circumscribed Polygon** and click the center. The pointer snaps
   to existing points, midpoints, crossings, curves, and level or plumb with
   other points; each snap is also a
   [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Move out to where the middle of one side goes. The preview shows the
   polygon and two dashed circles: the one through the corners and the one
   that touches the sides. The heads-up boxes show **Diameter**, measured
   across the flats like a nut's wrench size, and **Sides**.
3. Click the middle of the side. The polygon is drawn at once, with that
   side as its first, and the tool stays on for the next one.
4. To place it by numbers, type while the preview follows the pointer: a
   digit goes into the **Diameter** box, `Tab` moves to **Sides**, Enter
   places the polygon. Numbers are [expressions](../parameters.md), so
   `wall * 2` works. With a diameter typed, the first side goes toward the
   pointer.
5. `Esc` steps back a stage: the typed diameter, then the center, then the
   tool ends. Each polygon is one undo step, named Draw.

If the pointer is on the center, so the polygon would have no size, a click
draws nothing. Move away and click again.

## Options

- **Diameter** (heads-up box): the live distance across the flats. Type a
  number or an expression to lock it. It must be more than zero.
- **Sides** (heads-up box): the number of sides, 6 to start with. Type a
  whole number from 3 to 64; any other value is ignored and the count goes
  back to 6. The count stays for the next polygon, and `Esc` does not clear
  it.
- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the polygon's sides are construction geometry, grey
  and dashed, and never a profile. The two circles are construction either
  way.

## What it keeps

- As many lines as sides, joined end to end: **Coincident** at every corner.
  All the sides are **Equal** to the first.
- A dashed construction circle through the corners, centered on the polygon,
  with every corner **on** it.
- A second construction circle across the flats, **Concentric** with the
  first and **Tangent** to the first side.
- The center keeps what it snapped to: **Coincident** with a point, on a
  curve. A center on the origin is fixed there.
- The middle of the first side is not held to a snap. If it lines up with
  the center, the first side gets **Vertical** (level with the center) or
  **Horizontal** (plumb with it), square to the guide.
- A typed diameter becomes a driving dimension on the circle across the
  flats, so it stays editable later. With nothing typed the tool adds no
  dimension.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn geometry stays as clicked.

## Messages

- "Click the center.": the prompt before the first click.
- "Click the middle of an edge, or type the diameter across the flats (Tab:
  sides).": the prompt once the center is placed.
<!-- /notes -->
