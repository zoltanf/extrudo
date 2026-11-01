---
title: Trim
section: Tools
category: Sketch
order: 95
---

# Trim

Cut curves back to where they cross.

| Where | Shortcut |
|---|---|
| Sketch › Modify | T |

<video src="demo:trim" muted loop autoplay playsinline aria-label="Trim demo"></video>

<!-- notes -->
```widget trim
Point at a piece, then click to trim it.
```

## Step by step

1. Press `T` and hover a curve: it shows in red the part a click would cut
   away, the piece between the crossings on either side of the pointer.
2. Click to cut it off. A line shortens to the crossings; a circle crossed
   twice becomes the arc round the far side; a curve nothing crosses goes
   away whole.
3. The tool stays on for the next curve. `Esc` ends it.
4. Each click is one undo step, named Trim.

## What it keeps

- The remaining piece keeps the constraints and dimensions that still apply
  to it: a point held on the curve moves to the piece it now sits on, a
  tangency at a surviving joint follows it, and a fix holds every piece that
  is left. What sat on the part that went goes with it.
- A line's own length dimension goes too: it measured the whole line, and
  the piece that keeps the curve's place is shorter now.
- The new ends are held on the curves that crossed there, or on their end
  points.
- A projected curve can't be trimmed where it would have to change; delete
  it instead, or bring it in again with **Keep linked** off.

## Messages

- "Click the part of a curve to cut away.": the prompt.
- "Text can't be trimmed.": the click was on a text entity.
- "Only lines, circles, arcs and splines can be trimmed where curves
  cross.": the curve is an ellipse with curves crossing it. Trim it where
  nothing crosses, or draw it as a spline.
- "A conic can't be cut where curves cross it.": the same, for a conic.
- "Projected geometry follows the model and can't be changed here. Delete
  it, or change the model.": the piece to cut off is part of a projected
  curve, which only the model may move.
<!-- /notes -->
