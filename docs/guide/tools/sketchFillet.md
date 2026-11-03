---
title: Sketch Fillet
section: Tools
category: Sketch
order: 94
---

# Sketch Fillet

Round the corner between two lines. Type the radius.

| Where | Shortcut |
|---|---|
| Sketch › Modify | F |

<video src="demo:sketchFillet" muted loop autoplay playsinline aria-label="Sketch Fillet demo"></video>

<!-- notes -->
## Step by step

1. Press `F` and click the corner: the point where two lines end. Or click
   the first of the two lines, then the second.
2. The heads-up box beside the pointer shows **Radius**, a quarter of what
   the corner allows. Type a number or an
   [expression](../parameters.md) to lock it; the preview follows as you
   type.
3. The preview shows the arc and, in red, the corner pieces it replaces.
   Click to round the corner.
4. The tool stays on with the same radius for the next corner. `Esc` drops
   the first line if you picked one, else ends the tool.
5. Each corner is one undo step, named Fillet.

![Click a corner, type the radius, and the corner is rounded by a tangent arc dimensioned R3](../images/sketching/sketch-fillet-steps.figure.svg)

## Options

- **Radius** (heads-up box): the suggested radius, a quarter of what the
  corner allows, or the typed one. A locked radius stays for the next
  corner; if the preview shows nothing, the value is too big for this
  corner.

## What it keeps

- The arc is tangent to both lines: each line's new end is coincident with
  an arc end, and two tangencies hold the arc between them.
- The radius is a driving dimension and a parameter, so it stays editable
  and other fields can use it.
- The corner's end points are pulled back along the lines, and a virtual
  sharp stays where the corner was, held on both lines. Constraints and
  dimensions on the old ends move to the sharp: a line's length now measures
  from the sharp to its far end. A midpoint or equal lengths at the corner
  go, as does a tangency that sat there.
- If both lines were construction geometry, the arc is construction too.

## Messages

- "Pick a corner, or the first of two lines.": the prompt.
- "Pick the second line.": the prompt after the first of two lines.
- "Those two lines make no corner to round.": the two clicks were on lines
  that don't share an end. Click the corner point, or two lines that meet.
- "Text can't be filleted.": one of the corner's curves is a text entity.
- "The radius must be more than zero.": the typed radius is zero or less.
- "That radius doesn't fit this corner.": the radius is too long for one of
  the lines; a smaller one fits.
- "Projected geometry follows the model and can't be changed here. Delete
  it, or change the model.": one of the corner's lines is a projected curve,
  which only the model may move.
<!-- /notes -->
