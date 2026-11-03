---
title: Line
section: Tools
category: Sketch
order: 67
---

# Line

Lines from point to point. Type a length, Tab to the angle.

| Where | Shortcut |
|---|---|
| Sketch › Create | L |

<video src="demo:line" muted loop autoplay playsinline aria-label="Line demo"></video>

<!-- notes -->
## Step by step

1. Press `L` and click where the line starts. The pointer snaps to existing
   points, midpoints, crossings, curves, and level or plumb with the last
   point; each snap is also a [constraint](../sketching.md#constraints-you-didn-t-ask-for).
2. Click where the segment ends. It is drawn at once and the chain goes on
   from it: the next click adds another segment. A chain's segments are
   joined end to end.
3. To place the end by numbers, type while the segment follows the pointer:
   a digit goes into the **Length** box beside the pointer, `Tab` moves to
   **Angle**, Enter places the segment. Numbers are
   [expressions](../parameters.md), so `wall * 2` works.
4. Click the chain's first point to close the loop. The next click starts a
   new line.
5. Press on the chain's end and drag to draw an arc tangent to the curve
   there instead of a line; the chain carries on from the arc. This also
   works to start, from the end of any line or arc already in the sketch.
6. `Esc` steps back a stage: a typed value, then the point the chain sits on
   (the drawn lines stay), then the tool ends. Another tool or closing the
   sketch ends it too. Each segment is its own undo step.

![A line drawn from one click, its length typed into the heads-up box, Tab to the angle, and the finished line with its 40 and 30° dimensions](../images/sketching/line-steps.figure.svg)

## Options

- **Length** (heads-up box): the segment's live length. Type a number or an
  expression to lock it. A typed length becomes a driving dimension on the
  segment, so it stays editable later.
- **Angle** (heads-up box): the live angle from horizontal. Type one to lock
  it. A multiple of 90° makes the line horizontal or vertical instead of
  adding a dimension; any other angle only steers the segment.
- `Ctrl` (hold): draw without snapping, so nothing is tied down.
- `X` (Construction): the lines you draw next are construction geometry,
  grey and dashed, and never a profile.

## What it keeps

- A point snapped to another point or a curve is held there: **Coincident**
  with a point, **Midpoint**, on the curve, or on both curves of a crossing.
  A point placed on the origin is fixed there.
- A segment level or plumb with the point it starts from gets **Horizontal**
  or **Vertical**. Level with the end of another level line, the two get
  **Collinear** instead. Level with a lone point or a circle centre, the two
  points are tied.
- The solver drops an automatic constraint that would conflict with or
  repeat another; the drawn geometry stays as clicked.
- The tool adds no dimension unless you type a length.

## Messages

- "Click to start a line. Drag from the end of a curve for a tangent arc.":
  the prompt before the first click.
- "Click the next point, or type a length. Drag from the end for an arc; Esc
  ends.": the prompt while a chain is open.
- "Release to place the tangent arc.": the prompt while a tangent arc is
  being dragged.
<!-- /notes -->
