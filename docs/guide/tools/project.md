---
title: Project
section: Tools
category: Sketch
order: 90
---

# Project

Bring body edges, faces, vertices and bodies, and curves of earlier sketches, into the sketch; they follow their source.

| Where | Shortcut |
|---|---|
| Sketch › Create | P |

<video src="demo:project" muted loop autoplay playsinline aria-label="Project demo"></video>

<!-- notes -->
## Step by step

1. Press `P`. The view then picks body edges, faces and vertices and the
   curves of earlier sketches, and the panel in the sketch's column says what
   to pick.
2. Click an edge, a face, a vertex or a sketch curve in the view, or a body or
   a sketch by its row in the browser. What a click brings in: an edge its
   curve; a face its outline, with the silhouette lines of a cylinder or a
   cone and of any curved face; a vertex a fixed point; a body its outline and
   the sharp edges seen from the sketch's side; a sketch curve its curve, a
   sketch point a point; a whole sketch its curves, its construction curves and
   its loose points.
3. The curves come in one recompute after the click, purple and fixed.
4. `Esc`, the panel's **Done** button or another tool ends the tool.

![An edge picked in the view comes into the sketch as a fixed purple curve that follows the model](../images/sketching/project-steps.figure.svg)

## Options

- **Keep linked** (panel, on): off, the next picks come in as plain curves
  that don't follow the model. They take one undo step, "Include 4 curves"
  (the number that came in).
- In a sketch that later features build on, the view shows and picks the
  bodies as they were before the sketch while the tool runs, so the curves
  the sketch can use are the ones it can see.
- Only a sketch **earlier in the timeline** than the open one can be projected:
  a later sketch's curve is refused, and a text can't be projected (project its
  sketch's curves instead).

## What it keeps

- The projected curves are fixed: the solver holds them and a drag can't
  move them. They make [profiles](../sketching.md#profiles), and you can
  constrain and dimension against them.
- They follow their source: change the body or sketch underneath and the
  curves move with it, together with whatever is constrained or dimensioned to
  them, in the same undo step as the change. A curve from another sketch
  follows that sketch.
- Deleting one keeps it deleted; the projection goes when its last curve
  goes. Nothing else can change a projected curve: see
  [Trim](./trim.md) and [Sketch Fillet](./sketchFillet.md).
- A construction curve of the source sketch stays construction; a whole sketch
  brings its curve ends and centres with the curves, and its loose points as
  points.

## Messages

- "Pick edges, faces, vertices or sketch curves in the view, or a body or
  sketch in the browser: their outline comes in.": the panel's prompt.
- "Can't project that yet: the model is still computing.": the click landed
  while the kernel was still computing the body. Try again once it settles.
- "That's already projected into this sketch.": the edge, face, vertex,
  body, sketch curve or sketch is already in. Nothing changes.
- "Only a sketch earlier in the timeline can be projected.": the sketch you
  picked comes at or after the open one.
- "Text can't be projected: project its sketch's curves instead.": a text's
  letters aren't curves.
- "Lost a projected sketch curve …"/"Lost a projected sketch …": an earlier
  change removed the source; its curves stay where they were.
<!-- /notes -->
