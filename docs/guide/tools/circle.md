---
title: Center Diameter Circle
section: Tools
category: Sketch
order: 70
---

# Center Diameter Circle

From the center out to the rim. Type the diameter.

| Where | Shortcut |
|---|---|
| Sketch › Create | C |

<video src="demo:circle" muted loop autoplay playsinline aria-label="Center Diameter Circle demo"></video>

<!-- notes -->
## Step by step

1. Press `C` and click the center. The pointer snaps to existing points,
   midpoints, crossings, curves, and level or plumb with other points; each
   snap is also a
   [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Move the pointer out. The preview shows the circle, with a thin guide from
   the center to the rim. Click a point on the rim to place the circle.
3. To set the size by number, type while the circle follows the pointer: a
   digit goes into the **Diameter** box beside the pointer, and Enter places
   the circle. Numbers are [expressions](../parameters.md).
4. The tool stays on for the next circle. `Esc` steps back a stage: a typed
   value, then the center click, then the tool ends. Another tool or closing
   the sketch ends it too. Each circle is one undo step, named Draw.

## Options

- **Diameter** (heads-up box, after the center): the live diameter. Type a
  number or an expression to lock it. A typed diameter becomes a driving
  dimension on the circle, so it stays editable later.
- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the circles you draw next are construction geometry,
  grey and dashed, and never a profile.

## What it keeps

- The center is held where it snapped: **Coincident** with a point,
  **Midpoint**, on a curve, or on both curves of a crossing. A center placed
  on the origin is fixed there.
- A rim click that snaps to a sketch point puts that point on the circle.
  Other snaps (a curve, a midpoint) are not kept on the rim. With a typed
  diameter the rim click is not used.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn circle stays as clicked.
- The tool adds no dimension unless you type a diameter.

## Messages

- "Click the center.": the prompt before the first click.
- "Click a point on the circle, or type the diameter.": the prompt after the
  center.
<!-- /notes -->
