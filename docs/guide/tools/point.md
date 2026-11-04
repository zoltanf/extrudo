---
title: Point
section: Tools
category: Sketch
order: 79
---

# Point

A sketch point, for construction and hole centers.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<!-- notes -->
## Step by step

1. Choose **Point** in **Sketch › Create** and click where the point goes. The
   pointer snaps to existing points, midpoints, crossings, curves, and level
   or plumb with another point; each snap is also a
   [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. The point is placed at once. The tool stays on, so every click adds
   another point. Each point is its own undo step, named Draw.
3. `Esc` ends the tool. Another tool or closing the sketch ends it too.

[Hole](./hole.md) can drop one hole at each sketch point.

## Options

- `Ctrl` (hold): place the point without snapping, so nothing is tied down.
- `X` (Construction) makes no difference here: a point has no construction
  flag, only curves do.

The tool has no heads-up box and takes no typed values.

## What it keeps

- A point snapped to another point is held there: **Coincident**. On a curve
  it is held on the curve, at a midpoint it gets **Midpoint**, and on a
  crossing it is held on both curves. A point placed on the origin is fixed
  there.
- A point level or plumb with another point is tied to it: **Horizontal** or
  **Vertical** between the two points.
- A point snapped to a body's edge or corner projects it and is held on it
  (see [Auto-project](../sketching.md#project-and-intersect)).
- The solver drops an automatic constraint that would conflict with or
  repeat another; the point stays where you clicked.
- The tool adds no dimension.

## Messages

- "Click to place a point.": the only prompt, shown the whole time the tool
  is on.
<!-- /notes -->
