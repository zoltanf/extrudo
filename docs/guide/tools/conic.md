---
title: Conic
section: Tools
category: Sketch
order: 88
---

# Conic

A conic from its two ends and the shoulder point. Rho sets how full it is.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<!-- notes -->
## Step by step

1. Choose **Conic** in **Sketch › Create** and click where the curve starts.
   The pointer snaps to existing points, midpoints, crossings, curves, and
   level or plumb with other points; each snap is also a
   [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Click where it ends. A second click on the start is ignored.
3. Move the pointer to place the shoulder, the point where the tangents at
   the two ends meet. The preview shows the curve with a guide from each end
   to the shoulder. Click to place the conic, or press Enter to place it at
   the pointer. A shoulder on the line between the two ends would be a
   straight line, not a conic, and the click does nothing.
4. To change how full it is, type while you draw: a digit goes into the
   **Rho** box beside the pointer, which appears after the first click.
5. The tool stays on for the next conic. `Esc` steps back a stage: a typed
   Rho, then the last click, then the tool ends. Another tool or closing the
   sketch ends it too. Each conic is one undo step, named Draw.

## Options

- **Rho** (heads-up box): how full the conic is, a number from 0.05 to 0.95,
  0.5 by default. Below 0.5 the curve is an ellipse arc, at 0.5 a parabola
  and above 0.5 a hyperbola arc. A typed Rho stays for the next conic. A
  number outside the range is not taken, and the box goes back to 0.5.
- After drawing, select the conic and change **Rho** in the selection panel,
  in one undo step.
- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the conics you draw next are construction geometry,
  grey and dashed, and never a profile.

## What it keeps

- One spline of three points: the start, the shoulder and the end. The curve
  runs from the start to the end, and its end tangents point at the
  shoulder.
- Each point is held where it snapped: **Coincident** with a point,
  **Midpoint**, on a curve, or on both curves of a crossing. A point placed
  on the origin is fixed there. A point level or plumb with another is
  tied to it with **Horizontal** or **Vertical**.
- Rho is a shape number, not a dimension, so it has no unit and no
  parameter.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn conic stays as clicked.
- The tool adds no dimension.

## Messages

- "Click the start of the conic.": the prompt before the first click.
- "Click the end of the conic.": the prompt after the start.
- "Click the shoulder, where the end tangents meet (Tab: rho).": the prompt
  after the end.
- "Rho has to be between 0.05 and 0.95.": shown by the selection panel when
  you type a Rho outside the range there.
<!-- /notes -->
