---
title: 2-Point Circle
section: Tools
category: Sketch
order: 75
---

# 2-Point Circle

Across a diameter, from one side to the other.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<video src="demo:circle2" muted loop autoplay playsinline aria-label="2-Point Circle demo"></video>

<!-- notes -->
## Step by step

1. Choose **2-Point Circle** in **Sketch › Create** and click one end of the
   diameter. The pointer snaps to existing points, midpoints, crossings,
   curves, and level or plumb with other points.
2. Click the other end. The center is halfway between the two, and the
   preview shows the circle while you move.
3. To set the size by number, type while the circle follows the pointer: a
   digit goes into the **Diameter** box beside the pointer, and Enter places
   the circle. The second end is put that distance from the first, in the
   direction of the pointer. Numbers are [expressions](../parameters.md).
4. The tool stays on for the next circle. `Esc` steps back a stage: a typed
   value, then the first click, then the tool ends. Another tool or closing
   the sketch ends it too. Each circle is one undo step, named Draw.

## Options

- **Diameter** (heads-up box, after the first end): the live diameter. Type a
  number or an expression to lock it. A typed diameter becomes a driving
  dimension on the circle, so it stays editable later.
- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the circles you draw next are construction geometry,
  grey and dashed, and never a profile.

## What it keeps

- An end that snaps to a sketch point (an end point, a center or a lone
  point) puts that point on the circle. Other snaps (a curve, a midpoint)
  are not kept. With a typed diameter only the first end counts.
- The circle's center is a new point with no constraint of its own.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn circle stays as clicked.
- The tool adds no dimension unless you type a diameter.

## Messages

- "Click one end of the diameter.": the prompt before the first click.
- "Click the other end, or type the diameter.": the prompt after the first
  end.
<!-- /notes -->
