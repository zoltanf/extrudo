---
title: Circular Pattern
section: Tools
category: Sketch
order: 94
---

# Circular Pattern

Copies around a center. Type the count and the angle.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<video src="demo:sketchCircularPattern" muted loop autoplay playsinline aria-label="Circular Pattern demo"></video>

<!-- notes -->
## Step by step

1. Select what to copy first if you like. If something is selected when the
   tool starts, go to step 3.
2. Otherwise choose **Circular Pattern** in Sketch › Create and click the
   points and curves to copy, one by one. A click on something already
   picked unpicks it. Nothing snaps while you pick. Press `Enter` when the
   picks are right (it does nothing with no picks).
3. Move the pointer to the center to pattern around. The copies preview
   around it: 6 instances over a full turn to start with. Snapping works
   now.
4. To set the pattern by numbers, type while the copies follow the pointer:
   a digit goes into the **Count** box beside the pointer, `Tab` moves to
   **Angle**.
5. Click the center to place the copies. `Enter` does not place a circular
   pattern. The pattern is one undo step, named Circular pattern. The tool is
   back at the picking step with nothing picked.
6. `Esc` steps back a stage: from the copies to the picking step (the picks
   stay), then it drops the picks, then it ends the tool. `Esc` inside a box
   lets that value go. Another tool or closing the sketch ends the tool too.

## Options

- **Count** (heads-up box): the number of instances, the picked objects
  counting as the first. A whole number of at least 2; a typed decimal is
  rounded. It starts at 6.
- **Angle** (heads-up box): the angle the instances spread over, in degrees.
  It starts at 360. At a full turn the instances are spaced evenly with none
  back on top of the original. At any other angle the last copy sits at that
  angle from the original, and the rest are spaced evenly between.
- A typed **Count** or **Angle** stays for the next pattern while the tool
  runs.
- `Ctrl` (hold): place without snapping.

## What it keeps

- The picked objects stay as the first instance. Every other instance is a
  copy, turned about the center, with its own new points. A copy is
  construction geometry when its original is; `X` does not change that.
- The constraints among the picked objects come along on each copy, except
  Horizontal, Vertical and Fixed, which a turned copy leaves behind. A
  constraint to something not picked is not copied.
- A driving dimension among the picked objects is copied too, with the
  original's parameter as its expression, so changing that one value resizes
  every instance. A horizontal or vertical distance is left behind, as it
  would not hold on a turned copy.
- Nothing ties a copy to its original or to the other copies, and neither
  the center nor the angle is stored. The center you clicked adds no
  constraint, even when it snapped to a point.

## Messages

- "Pick points and curves, then press Enter.": the prompt while you choose
  what to copy.
- "Click the center to pattern around. Type the count, Tab to the angle.":
  the prompt once you have picks.
<!-- /notes -->
