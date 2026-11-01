---
title: Sketch Dimension
section: Tools
category: Sketch
order: 71
---

# Sketch Dimension

Lengths, radii and angles that drive the sketch.

| Where | Shortcut |
|---|---|
| Sketch › Create | D |

<video src="demo:dimension" muted loop autoplay playsinline aria-label="Sketch Dimension demo"></video>

<!-- notes -->
```widget dimension-label
Drag the label: where it sits decides what it measures.
```

## Step by step

1. Press `D` and click the first thing: a line for its length, a circle for
   its diameter, an arc for its radius, or a point.
2. Click a second thing, or click empty space to place what the first pick
   measures alone: a line's length, a circle's diameter, an arc's radius.
   A second pick makes a distance or an angle instead: two lines their angle
   (or the distance between them when they are parallel), a point its
   distance to the line or to another point, a circle or an arc the distance
   from its edge.
3. Click where the label should sit. Where you put it decides the kind:
   above or below the two picks a horizontal distance, beside them a vertical
   one, on the slant an aligned one. For an angle it picks which pair of
   angles between the lines is measured.
4. The value opens for editing at the label. Type a number or an
   [expression](../parameters.md) and press Enter, or press Esc to keep the
   measured value.
5. The tool stays on for the next dimension. `Esc` drops the current picks;
   `Esc` again ends the tool.

![The Dimension tool: pick a line for its length, two lines for their angle, or a circle for its diameter, then click where the label goes](../images/sketching/dimension-steps.figure.svg)

## Options

- **First pick**: a line, a circle, an arc or a point. The origin point, the
  axes and the construction datums made before the sketch count as things to
  click too, and with auto-project on so do body edges and vertices.
- **Second pick**: the things the first pick pairs with, listed in the step
  above. A circle or an arc followed by a line, a point or another circle
  dimensions from its edge: click the half facing the other thing for the
  near edge, the other half for the far edge.
- **Label place**: where the click sits decides horizontal, vertical or
  aligned, as in the step above. For a circle's or an arc's edge distance the
  extension lines start at the edge point.
- **Driven (measures only)** (value box): tick it and the dimension only
  shows the measurement, in grey and brackets, without holding anything.
- A line to an axis parallel to it, or a point to an axis, is dimensioned at
  once, with no click to place the label.

## What it keeps

- The new dimension is **driving**: it starts at the measured size and from
  then on holds the sketch to it. It becomes a parameter, `d1`, `d2` and so
  on, that other fields can use; type `width = 40 mm` in its box to give it
  a name.
- It opens for editing as soon as it is placed. To change it later,
  double-click the label.
- A dimension to a body edge or vertex sits on the projected curve, which
  follows the model; whatever is constrained to it follows too.
- A dimension that would over-constrain the sketch asks first: add it as a
  driven one, or drop it (see
  [over-constraining](../sketching.md#over-constraining)).
- The tool adds no constraints. It keeps what the sketch has.

## Messages

- "Pick a line, circle or arc to dimension, or a point.": the prompt before
  the first pick.
- "Click to place the length, or pick a second line, a point or a circle.":
  the prompt after a line.
- "Click to place the diameter, or pick a line, a point, a circle or an arc
  for the distance.": the prompt after a circle.
- "Click to place the radius, or pick a line, a point, a circle or an arc
  for the distance.": the prompt after an arc.
- "Pick a second point, a line or a circle.": the prompt after a point.
- "Click to place the dimension.": the prompt with two picks; the next click
  places it.
- "Pick a straight edge, or project the edge first (P).": the pointer is over
  a curved body edge, which the tool can't pick yet. Project the edge into
  the sketch first, or pick a straight one.
- "Over-constrained": the dialog a new dimension opens when the sketch is
  already fully held. Choose **Add as driven** to keep it as a measurement,
  or cancel to drop it.
- "This distance would over-constrain the sketch: its constraints and
  dimensions already fix it. Add it as a driven dimension? It will show the
  value without changing anything.": that dialog's text; distance reads
  radius, diameter or angle for the other kinds of dimension.
- "Distance would over-constrain the sketch.": a dimension to model geometry
  that the sketch can't take as driving. It reads radius, diameter or angle
  like the dialog.
<!-- /notes -->
