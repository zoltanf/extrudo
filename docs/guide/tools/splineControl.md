---
title: Control Point Spline
section: Tools
category: Sketch
order: 88
---

# Control Point Spline

A smooth curve guided by the points you click. Enter to finish.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<video src="demo:splineControl" muted loop autoplay playsinline aria-label="Control Point Spline demo"></video>

<!-- notes -->
## Step by step

1. Choose **Control Point Spline** in Sketch › Create and click the first
   control point. The pointer snaps to existing points, midpoints,
   crossings, curves, and level or plumb with the last point; each snap is
   also a [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Click the next control points. The curve runs from the first point to the
   last and leaves each end along the line to the next control point. It
   does not pass through the points in between.
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
- **Degree** (selection panel): select an open control point spline to set
  its degree, a whole number from 1 (straight lines between the points) to
  5. It needs at least one point more than its degree. Until you set it, the
  degree is 3, or one less than the number of points when there are fewer
  than four. A closed spline is cubic and has no **Degree** field.
- **Closed** (selection panel): turns an open spline into a loop and back.
  The panel also shows the number of **Control points**. Each change is one
  undo step.

## What it keeps

- The spline is one curve over its control points. Each control point is a
  point of the sketch.
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

- "Click the first control point.": the prompt before the first click.
- "Click the next control point.": the prompt after the first click.
- "Click the next control point, Enter to finish, or the first one to close
  it.": the prompt once the spline has two points or more.
- "Degree has to be a whole number from 1 to 5.": the **Degree** field got
  something else. Type a whole number from 1 to 5.
- "A degree-4 spline needs at least 5 points.": the degree is too high for
  the points the spline has (the numbers change with the degree). Pick a
  lower degree or add points.
- "A closed spline needs at least three points.": you switched **Closed** on
  for a spline with two points. Add a point first.
<!-- /notes -->
