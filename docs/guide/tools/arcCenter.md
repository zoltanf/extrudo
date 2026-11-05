---
title: Center Point Arc
section: Tools
category: Sketch
order: 77
---

# Center Point Arc

The center, the start, then how far round.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<video src="demo:arcCenter" muted loop autoplay playsinline aria-label="Center Point Arc demo"></video>

<!-- notes -->
## Step by step

1. Choose **Center Point Arc** in **Sketch › Create** and click the center.
   The pointer snaps to existing points, midpoints, crossings and curves;
   each snap is also a
   [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Click where the arc starts: its distance from the center is the radius. To
   set the radius by number, type it in the **Radius** box beside the pointer
   and press Enter (or click). The start then sits that far from the center,
   in the direction of the pointer. A start on the center itself is not
   taken.
3. Move the pointer round the center. The arc turns the way you go, and the
   preview shows it with a guide from the center to each end. Click to
   place the end. The end lands on the circle in the direction of the pointer,
   not at the pointer itself. To set the sweep by number, type it in the
   **Angle** box and press Enter.
4. The pointer's turns add up from the start, up to a full turn. A full turn
   is not an arc: nothing is drawn at 360°, and a click there does nothing.
5. The tool stays on for the next arc. `Esc` steps back a stage: a typed
   value, then the last click, then the tool ends. Another tool or closing
   the sketch ends it too. Each arc is one undo step, named Draw.

## Options

- **Radius** (heads-up box, after the center): the distance from the center
  to the start, or the typed one. Type a number or an
  [expression](../parameters.md) to lock it.
- **Angle** (heads-up box, after the start): the live sweep in degrees, with
  clockwise as negative. Type one to lock it; a negative number turns the
  arc clockwise.
- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the arcs you draw next are construction geometry, grey
  and dashed, and never a profile.

## What it keeps

- The center and the start are held where they snapped: **Coincident** with a
  point, **Midpoint**, on a curve, or on both curves of a crossing. A center
  placed on the origin is fixed there.
- The end keeps a snap only when the snapped point lies on the arc's circle
  (and no angle is typed). Then it is held like the others. A snap off the
  circle is not kept.
- A typed radius becomes a driving dimension on the arc, so it stays
  editable. A typed angle adds no dimension; it only sets where the end is.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn arc stays as clicked.

## Messages

- "Click the center.": the prompt before the first click.
- "Click the start, or type the radius.": the prompt after the center.
- "Click the end, or type the angle.": the prompt after the start.
<!-- /notes -->
