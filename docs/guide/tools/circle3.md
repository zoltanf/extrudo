---
title: 3-Point Circle
section: Tools
category: Sketch
order: 76
---

# 3-Point Circle

Through three points on the rim.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<video src="demo:circle3" muted loop autoplay playsinline aria-label="3-Point Circle demo"></video>

<!-- notes -->
## Step by step

1. Choose **3-Point Circle** in **Sketch › Create** and click the first point
   on the rim. The pointer snaps to existing points, midpoints, crossings,
   curves, and level or plumb with other points.
2. Click the second point. A thin line joins the two while you move.
3. Move the pointer: the preview shows the circle through the three points.
   Click the third point to place it. If the three points are on one line
   there is no circle, and the click does nothing.
4. The tool stays on for the next circle. `Esc` takes back the last click,
   and when there is none the tool ends. Another tool or closing the sketch
   ends it too. Each circle is one undo step, named Draw.

## Options

- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the circles you draw next are construction geometry,
  grey and dashed, and never a profile.

The tool has no heads-up box and takes no typed values. To set the size by
number, use [Center Diameter Circle](./circle.md) or
[2-Point Circle](./circle2.md).

## What it keeps

- A point that snaps to a sketch point (an end point, a center or a lone
  point) puts that point on the circle. Other snaps (a curve, a midpoint)
  are not kept.
- The circle's center is a new point with no constraint of its own.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn circle stays as clicked.
- The tool adds no dimension.

## Messages

- "Click the first point on the circle.": the prompt before the first click.
- "Click the second point.": the prompt after the first point.
- "Click the third point.": the prompt after the second point.
<!-- /notes -->
