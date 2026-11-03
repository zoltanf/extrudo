---
title: Ellipse
section: Tools
category: Sketch
order: 84
---

# Ellipse

An ellipse from its center and two axes.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<!-- notes -->
## Step by step

1. Choose **Ellipse** in **Sketch › Create** and click the center. The
   pointer snaps to existing points, midpoints, crossings, curves, and level
   or plumb with other points; each snap is also a
   [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Click the end of the first axis. A thin guide runs from the center to the
   pointer. To place it by numbers, type: a digit goes into the **Radius**
   box beside the pointer, `Tab` moves to **Angle**, Enter places the end.
   Numbers are [expressions](../parameters.md). With only one typed, the
   other follows the pointer.
3. Move the pointer to set the other radius: it is the pointer's distance from
   the first axis, on the side the pointer is on. The preview shows the
   ellipse with a guide from the center to each axis end. Click to place it,
   or type the **Radius** and press Enter.
4. If the second radius is longer than the first, the axes swap roles and the
   first one becomes the minor axis. Two equal radii would make a circle, and
   the click does nothing; use [Circle](./circle.md) for that.
5. The tool stays on for the next ellipse. `Esc` steps back a stage: typed
   values, then the last click, then the tool ends. Another tool or closing
   the sketch ends it too. Each ellipse is one undo step, named Draw.

## Options

- **Radius** and **Angle** (heads-up box, after the center): the live length
  and angle of the first axis, the angle in degrees from horizontal. Type
  one to lock it.
- **Radius** (heads-up box, after the first axis): the other radius, live or
  typed.
- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the ellipses you draw next are construction geometry,
  grey and dashed, and never a profile.

## What it keeps

- The ellipse is three points, its center, the end of its major axis and the
  end of its minor axis. The solver keeps the minor end square to the major
  axis.
- The center is held where it snapped: **Coincident** with a point,
  **Midpoint**, on a curve, or on both curves of a crossing. A center placed
  on the origin is fixed there.
- The end of the first axis is held where it snapped the same way. Level or
  plumb with the center it gets **Horizontal** or **Vertical** between the
  two points. With a typed radius or angle the end is not snapped.
- The last click is not snapped or tied to anything: only its distance from
  the first axis counts.
- A typed radius becomes a driving distance dimension from the center to that
  axis end, so it stays editable. A typed angle adds no dimension.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn ellipse stays as clicked.

## Messages

- "Click the center.": the prompt before the first click.
- "Click the end of the first axis, or type its radius (Tab: angle).": the
  prompt after the center.
- "Click to set the other radius, or type it.": the prompt after the first
  axis.
<!-- /notes -->
