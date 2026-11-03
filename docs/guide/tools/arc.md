---
title: 3-Point Arc
section: Tools
category: Sketch
order: 70
---

# 3-Point Arc

Start, end, then a point it passes through.

| Where | Shortcut |
|---|---|
| Sketch › Create | A |

<video src="demo:arc" muted loop autoplay playsinline aria-label="3-Point Arc demo"></video>

<!-- notes -->
## Step by step

1. Press `A` and click where the arc starts. The pointer snaps to existing
   points, midpoints, crossings, curves, and level or plumb with other
   points; each snap is also a
   [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Click where the arc ends. A thin guide line follows the pointer from the
   start until you do.
3. Move the pointer to bend the arc: it passes through the pointer, and the
   preview shows it. Click to place it. If the three points are on one
   line there is no arc, and the click does nothing.
4. To give the arc a radius instead, type after step 2: a digit goes into
   the **Radius** box beside the pointer. Enter places the
   arc. The arc bulges to the side of the chord the pointer is on, and it is
   the shorter of the two arcs of that radius. A radius under half the
   distance between the ends makes no arc.
5. The tool stays on for the next arc. `Esc` steps back a stage: a typed
   value, then the last click, then the tool ends. Another tool or closing
   the sketch ends it too. Each arc is one undo step, named Draw.

## Options

- **Radius** (heads-up box, after the second click): the radius of the arc
  through the pointer, or the typed one. Type a number or an
  [expression](../parameters.md) to lock it. A typed radius becomes a driving
  dimension on the arc, so it stays editable later.
- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the arcs you draw next are construction geometry, grey
  and dashed, and never a profile.

## What it keeps

- A start or end snapped to another point or a curve is held there:
  **Coincident** with a point, **Midpoint**, on the curve, or on both curves
  of a crossing. A point placed on the origin is fixed there.
- An end level or plumb with the start gets **Horizontal** or **Vertical**
  between the two end points. Level with another point, the two points are
  tied.
- The third click: if it snaps to a sketch point, that point is put on the
  arc. Other snaps (a curve, a midpoint) are not kept. With a typed radius
  there is no third click and nothing is put on the arc.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn arc stays as clicked.
- The tool adds no dimension unless you type a radius.

## Messages

- "Click the start of the arc.": the prompt before the first click.
- "Click the end of the arc.": the prompt after the start.
- "Click a point on the arc, or type the radius.": the prompt after the end.
<!-- /notes -->
