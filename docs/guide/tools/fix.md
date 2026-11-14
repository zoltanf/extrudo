---
title: Fix/Unfix
section: Tools
category: Sketch
order: 109
---

# Fix/Unfix

Lock something in place, or free it again.

| Where | Shortcut |
|---|---|
| Sketch › Constraints | K F |

<video src="demo:fix" muted loop autoplay playsinline aria-label="Fix/Unfix demo"></video>

<!-- notes -->
## Step by step

1. Press `K` then `F` and hover something: it lights up where a click would
   pick it.
2. Click a point, line, circle, arc or any other sketch curve. The constraint
   goes in at once.
3. Click something that is already fixed this way and it is freed instead:
   the tool removes its Fix.
4. The tool stays on for the next one. `Esc` ends it.
5. Each Fix is one undo step, named Draw; each Unfix is one, named Unfix.

![Fix: a free line, then a fixed one held by the lock](../images/sketching/constraint-fix.figure.svg)

## What it keeps

- A fixed point stays where it is. A fixed line keeps both ends; a circle,
  arc or ellipse keeps its points and its shape, radius included; a spline
  or text keeps its points. Everything else moves around it.
- A click frees only a Fix that was set on that same thing. A line whose
  ends are fixed one by one is not freed by a click on the line: that adds a
  Fix on the line.
- The lock glyph sits on the fixed thing, labelled **Fix**. A fully fixed
  shape shows in the fixed color.
- Projected geometry is held like a fix already: it follows the model, and
  nothing else moves it.
- To remove a Fix another way, press `Esc` to leave the tool, click the
  glyph and press `Delete`.

## Messages

- "Pick something to fix in place, or something fixed to free it.": the
  prompt.
- "Fix would conflict with the sketch's other constraints.": holding it
  contradicts other constraints or dimensions. Nothing changed.
<!-- /notes -->
