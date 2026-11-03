---
title: Project
section: Tools
category: Sketch
order: 89
---

# Project

Bring body edges, faces, vertices and bodies into the sketch; they follow the model.

| Where | Shortcut |
|---|---|
| Sketch › Create | P |

<video src="demo:project" muted loop autoplay playsinline aria-label="Project demo"></video>

<!-- notes -->
## Step by step

1. Press `P`. The view then picks body edges, faces and vertices, and the
   panel in the sketch's column says what to pick.
2. Click an edge, a face or a vertex in the view, or a body by its row in the
   browser. What a click brings in: an edge its curve; a face its outline,
   with the silhouette lines of a cylinder or a cone and of any curved face;
   a vertex a fixed point; a body its outline and the sharp edges seen from
   the sketch's side.
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

## What it keeps

- The projected curves are fixed: the solver holds them and a drag can't
  move them. They make [profiles](../sketching.md#profiles), and you can
  constrain and dimension against them.
- They follow the model: change the body underneath and the curves move with
  it, together with whatever is constrained or dimensioned to them, in the
  same undo step as the change.
- Deleting one keeps it deleted; the projection goes when its last curve
  goes. Nothing else can change a projected curve: see
  [Trim](./trim.md) and [Sketch Fillet](./sketchFillet.md).

## Messages

- "Pick edges, faces or vertices in the view, or a body in the browser:
  their outline comes in.": the panel's prompt.
- "Can't project that yet: the model is still computing.": the click landed
  while the kernel was still computing the body. Try again once it settles.
- "That's already projected into this sketch.": the edge, face, vertex or
  body is already in. Nothing changes.
<!-- /notes -->
