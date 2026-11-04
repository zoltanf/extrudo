---
title: Rectangular Pattern
section: Tools
category: Sketch
order: 93
---

# Rectangular Pattern

Copies in rows and columns. Type the counts and spacing.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<video src="demo:sketchRectangularPattern" muted loop autoplay playsinline aria-label="Rectangular Pattern demo"></video>

<!-- notes -->
## Step by step

1. Select what to copy first if you like. If something is selected when the
   tool starts, go to step 3.
2. Otherwise choose **Rectangular Pattern** in Sketch › Create and click the
   points and curves to copy, one by one. A click on something already
   picked unpicks it. Nothing snaps while you pick. Press `Enter` when the
   picks are right (it does nothing with no picks).
3. Move the pointer. The copies preview in rows and columns, 3 columns and 1
   row to start with. The spacing follows the pointer: the middle of the last
   copy, the one in the far corner, lands at the pointer. Snapping works
   now.
4. To set the grid by numbers, type while the copies follow the pointer: a
   digit goes into the **Columns** box beside the pointer, `Tab` moves on to
   **Rows**, **X spacing** and **Y spacing**. Numbers are
   [expressions](../parameters.md), so `wall * 2` works in the spacing boxes.
5. Click, or press `Enter`, to place the copies. The pattern is one undo
   step, named Rectangular pattern. The tool is back at the picking step with
   nothing picked, and the typed values are cleared.
6. `Esc` steps back a stage: from the copies to the picking step (typed values
   dropped, picks stay), then it drops the picks, then it ends the tool.
   `Esc` inside a box lets that value go. Another tool or closing the sketch
   ends the tool too.

## Options

- **Columns** and **Rows** (heads-up boxes): how many instances along X and
  along Y, the picked objects counting as the first. A whole number of at
  least 1; a typed decimal is rounded. They start at 3 and 1.
- **X spacing** and **Y spacing** (heads-up boxes): the distance between
  neighbouring instances along each axis. Typed, they replace the pointer
  for that axis. A negative number puts the copies to the left or below. With
  1 column there is no X spacing, and with 1 row no Y spacing.
- `Ctrl` (hold): place without snapping.

## What it keeps

- The picked objects stay as the first instance. Every other instance is a
  copy with its own new points. A copy is construction geometry when its
  original is; `X` does not change that.
- The constraints among the picked objects come along on each copy: a
  Horizontal on a picked line, a Fixed on a point, a Tangent between two
  picked curves. A constraint to something not picked is not copied.
- A driving dimension among the picked objects is copied too, with the
  original's parameter as its expression, so changing that one value resizes
  every instance.
- Nothing ties a copy to its original or to the other copies, and the spacing
  is not stored. The point you clicked adds no constraint, even when it
  snapped to a point.

## Messages

- "Pick points and curves, then press Enter.": the prompt while you choose
  what to copy.
- "Click where the last copy goes. Type the columns, rows and spacing to set
  them.": the prompt once you have picks.
- "A pattern needs at least two instances.": **Columns** and **Rows** are both
  1, so there is nothing to copy. Raise one of them.
<!-- /notes -->
