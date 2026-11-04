---
title: Sketch Scale
section: Tools
category: Sketch
order: 103
---

# Sketch Scale

Scale curves about a point, with their dimensions.

| Where | Shortcut |
|---|---|
| Sketch › Modify | None |

<video src="demo:sketchScale" muted loop autoplay playsinline aria-label="Sketch Scale demo"></video>

<!-- notes -->
## Step by step

1. Choose **Sketch Scale** in Sketch › Modify. It has no shortcut. If curves
   or points are selected already, the tool starts with them and you can
   skip to step 3.
2. Otherwise click what to scale. A click picks a curve or a point, a second
   click lets it go; a point under the pointer wins over a curve. A picked
   curve brings its own end points. Press Enter when the set is right.
3. Click the point to scale about. It stays where it is, and it snaps the way
   the drawing tools do.
4. Move the pointer: the preview shows the scaled geometry, and the
   **Scale** box beside the pointer shows the factor. A pointer as far from
   the point as the middle of the picked geometry gives 1, twice as far gives
   2. The factor is rounded to two decimals and is never below 0.01. If the
   point is at that middle, 10 mm from it gives 1.
5. To use a number, type it instead: a digit goes into the **Scale** box. It
   can be an [expression](../parameters.md).
6. Click, or press Enter, to scale. The picks are dropped and the tool
   waits for the next set of picks; it is still on.
7. `Esc` steps back a stage. From the factor it returns to the point to scale
   about and drops a typed factor; from there it returns to the picks, which
   stay marked. There, `Esc` drops the picks, and once more ends the tool.
8. Each scale is one undo step, named Scale.

## Options

- **Scale** (heads-up box): the factor. Type a number or an expression to
  lock it. 2 doubles the size, 0.5 halves it.
- `Ctrl` (hold): choose the point without snapping.

## What it keeps

- It adds no geometry. Every picked point moves away from the point you
  scaled about (or towards it) by the factor, and every picked circle's radius
  is multiplied by it.
- Constraints stay as they are.
- Length, radius and diameter dimensions that touch only the picked geometry
  are scaled with it. A plain number is multiplied (`20 mm` becomes `40 mm`);
  any other expression is wrapped (`d3 + 1` becomes `(d3 + 1) * 2`). Angle
  dimensions and driven ones are left alone.
- A dimension between picked geometry and something you did not pick is not
  changed. If it would keep the picked geometry from reaching its new size
  or place, the scale is refused.
- Fixed geometry that would move or grow refuses the scale.

## Messages

- "Pick points and curves, then press Enter.": the prompt while you choose
  what to scale.
- "Click the point to scale about.": the prompt after Enter.
- "Move to size it and click, or type the scale.": the prompt after the point.
- "The scale must be more than zero.": the typed factor is zero or less. Type
  a larger one.
- "Fixed geometry can't be scaled; unfix it first.": a Fix would be moved or
  resized. Remove that Fix first.
- "Scale can't be done: constraints hold some of it in place.": the solver
  could not take the picked points where the factor puts them, for example
  because a dimension to geometry you didn't pick holds them.
<!-- /notes -->
