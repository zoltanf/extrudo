---
title: Tangent Arc
section: Tools
category: Sketch
order: 79
---

# Tangent Arc

Carries on smoothly from the end of a line or an arc.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<video src="demo:arcTangent" muted loop autoplay playsinline aria-label="Tangent Arc demo"></video>

<!-- notes -->
## Step by step

1. Choose **Tangent Arc** in **Sketch › Create** and click the end of a line
   or an arc that is already in the sketch. The click has to snap to that
   end point.
2. Move the pointer. The preview shows the arc that carries on from that end,
   tangent to the curve there, and ends at the pointer. Click to place the
   arc's end. If the pointer is straight ahead on the curve's line, no arc
   fits and the click does nothing.
3. The tool stays on for the next arc. `Esc` steps back a stage: the picked
   end first (back to step 1), then the tool ends. Another tool or closing
   the sketch ends it too. Each arc is one undo step, named Draw.

The [Line](./line.md) tool draws the same arc when you press on the end of its
chain and drag.

## Options

- `Ctrl` (hold): draw without snapping. The first click needs a snap to an
  end point, so hold it only for the second click.
- `X` (Construction): the arcs you draw next are construction geometry, grey
  and dashed, and never a profile.

The tool has no heads-up box and takes no typed values.

## What it keeps

- The arc's start is joined to the end you picked (**Coincident**), and the
  arc is **Tangent** to that line or arc. Both are always kept.
- The arc's end is held where it snapped, as in the other drawing tools:
  **Coincident** with a point, **Midpoint**, on a curve, or on both curves of
  a crossing. A point placed on the origin is fixed there.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn arc stays as clicked.
- The tool adds no dimension.

## Messages

- "Click the end of a line or an arc.": the prompt before the first click.
- "Click the end of the arc.": the prompt after the start is picked.
- "Start on the end of a line or an arc.": the first click did not snap to
  the end of a line or an arc. Click an end point of one.
<!-- /notes -->
