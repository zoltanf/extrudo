---
title: Extend
section: Tools
category: Sketch
order: 100
---

# Extend

Lengthen a line or an arc to the next curve.

| Where | Shortcut |
|---|---|
| Sketch › Modify | None |

<video src="demo:extend" muted loop autoplay playsinline aria-label="Extend demo"></video>

<!-- notes -->
## Step by step

1. Open the **Modify** menu (the group name, with its arrow, under the
   tiles) in a sketch and choose **Extend**. Point at a line or an arc near
   the end you want to lengthen: the end nearer the pointer is the one that
   grows. The preview shows in the accent colour the stretch up to the next
   curve in the way.
2. Click to extend. A line grows straight on; an arc grows round its own
   circle. The end stops at the first curve it meets: a line, circle, arc,
   ellipse or spline. A curve the end already sits on is not counted.
3. The tool stays on for the next curve. `Esc` ends it. A click on nothing,
   or on a curve that is not a line or an arc, does nothing.
4. Each click is one undo step, named Extend.

## What it keeps

- The line or arc keeps its place in the sketch, and so does its other end.
  Constraints that still apply to it, such as Horizontal, stay. Equal
  lengths between lines, Midpoint, and Symmetric (unless the curve is the
  axis) go: they no longer hold for the changed curve.
- The new end is held where it lands. On another curve's end point it is
  **Coincident** with that point; anywhere else on a line, circle, arc or
  ellipse it is held **on that curve**. Reaching a spline adds no constraint:
  the end lands on it but isn't held there.
- Whatever held the old end goes with it: a coincident joint to another
  curve, a tangency there, a dimension to that end.
- A line's own length dimension goes too: it measured the old length.
- If another expression uses a removed dimension's parameter, nothing
  changes and a message names what uses it.
- A projected curve can't be extended; delete it instead, or bring it in
  again with **Keep linked** off.

## Messages

- "Click near the end of a line or an arc to extend it.": the prompt.
- "There is nothing for it to reach.": no curve lies in the way of that end.
  Click the other end, or draw the curve it should reach.
- "Projected geometry follows the model and can't be changed here. Delete
  it, or change the model.": the line or arc is a projected curve, which
  only the model may move.
<!-- /notes -->
