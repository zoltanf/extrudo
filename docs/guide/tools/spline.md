---
title: Fit Point Spline
section: Tools
category: Sketch
order: 86
---

# Fit Point Spline

A smooth curve through the points you click. Enter to finish.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<!-- notes -->
## Step by step

1. Choose **Fit Point Spline** in Sketch › Create and click the first point.
   The pointer snaps to existing points, midpoints, crossings, curves, and
   level or plumb with the last point; each snap is also a
   [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Click each point the curve should pass through. The preview shows the
   curve through the points you clicked and the pointer.
3. To finish, press `Enter` or click the last point again. The curve ends at
   the last point you clicked, not at the pointer. It needs at least two
   points.
4. To close the curve into a loop instead, click the first point once the
   spline has three points or more.
5. The tool stays on: the next click starts a new spline. `Esc` takes back
   the last point; with no points left, it ends the tool. Another tool or
   closing the sketch ends it too. Nothing is added until you finish, and
   the whole spline is one undo step.

## Options

- `Ctrl` (hold): place points without snapping, so nothing is tied down.
- `X` (Construction): the spline you draw next is construction geometry,
  grey and dashed, and never a profile.
- **Closed** (selection panel): select a spline to see its number of **Fit
  points** and a **Closed** switch. It turns an open spline into a loop and
  back, as one undo step.
- Select an open fit point spline and drag the small square at either end to
  set the curve's direction and pull there. One drag is one undo step.
  **Free ends** in the selection panel lets the ends go again; it shows only
  while an end has been set.

## What it keeps

- The spline is one curve over its fit points. Each fit point is a point of
  the sketch, so a spline can start and end on other curves.
- A point snapped to another point or a curve is held there: **Coincident**
  with a point, **Midpoint**, on the curve, or on both curves of a crossing.
  A point placed on the origin is fixed there.
- A point level or plumb with the previous point, or with another point it
  lined up with, gets **Horizontal** or **Vertical** between the two.
- With Auto-project on, a point that snaps to a body edge or corner projects
  it and is held on it: see
  [Project and Intersect](../sketching.md#project-and-intersect).
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn geometry stays as clicked.
- The tool adds no dimension.

## Messages

- "Click the first point of the spline.": the prompt before the first click.
- "Click the next point.": the prompt after the first click.
- "Click the next point, Enter to finish, or the first point to close it.":
  the prompt once the spline has two points or more.
- "A closed spline needs at least three points.": you switched **Closed** on
  for a spline with two points. Add a point first.
<!-- /notes -->
