---
title: Collinear
section: Tools
category: Sketch
order: 106
---

# Collinear

Put two lines on one straight line.

| Where | Shortcut |
|---|---|
| Sketch › Constraints | K L |

<video src="demo:collinear" muted loop autoplay playsinline aria-label="Collinear demo"></video>

<!-- notes -->
## Step by step

1. Press `K` then `L` and hover a line: it lights up where a click would pick
   it.
2. Click the first line. An origin axis counts as a line.
3. Click the second line. It can't be the first one again.
4. The second click adds the constraint and solves the sketch in the same
   step. The tool stays on for the next pair. `Esc` drops the last pick,
   then ends the tool.
5. Each constraint is one undo step, named Draw.

A body edge works as a line when **Auto-project** is on and the edge is
straight: the pick [projects](./project.md) it into the sketch, and the
constraint goes in once the projection arrives.

![Collinear: two segments at two heights, then on one line](../images/sketching/constraint-collinear.figure.svg)

## What it keeps

- Both ends of the second line are held on the first line. The solver
  decides what moves; fixed and projected geometry stays.
- Two lines that are both horizontal can still be made collinear. Asking for
  it again is refused.
- One glyph sits on each line, labelled **Collinear**.
- To remove it, press `Esc` to leave the tool, click a glyph and press
  `Delete`.

## Messages

- "Pick a line.": the prompt for the first line.
- "Pick a line to make collinear with it.": the prompt for the second.
- "Collinear isn't needed: the sketch already holds it.": the lines are tied
  onto one line already.
- "Collinear would conflict with the sketch's other constraints.": other
  constraints or dimensions forbid it, or solving it would shrink a line to
  nothing. Nothing changed.
- "Pick a straight edge, or project the edge first (P).": the pointer is on
  a curved body edge. Project it with [Project](./project.md) first, or pick
  a line.
- "Couldn't hold Collinear on the body geometry.": the body edge you picked
  could not be projected for the constraint. Nothing changed.
<!-- /notes -->
