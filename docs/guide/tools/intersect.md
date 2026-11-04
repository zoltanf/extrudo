---
title: Intersect
section: Tools
category: Sketch
order: 91
---

# Intersect

Bring in the curves where a face or body meets the sketch plane; they follow the model.

| Where | Shortcut |
|---|---|
| Sketch › Create | Shift+P |

<!-- notes -->
## Step by step

1. In an open sketch, press `Shift+P`. The view then picks faces, and
   the panel in the sketch's column says what to pick.
2. Click a face in the view, or a body by its row in the browser. What comes
   in is the curves where that face or body meets the sketch plane: a
   cylinder cut by a slanted sketch plane gives an ellipse.
3. The curves come in one recompute after the click, purple and fixed.
4. The tool stays on, so you can pick more. `Esc`, the panel's **Done**
   button or another tool ends the tool.

![Project copies a body's outline onto the sketch plane; Intersect brings in the section where a cylinder crosses the plane](../images/sketching/project-intersect.figure.svg)

## Options

- **Keep linked** (panel, on): off, the next picks come in as plain curves
  that don't follow the model. They take one undo step, "Include 4 curves"
  (the number that came in).
- In a sketch that later features build on, the view shows and picks the
  bodies as they were before the sketch while the tool runs, so the curves
  the sketch can use are the ones it can see.

## What it keeps

- The curves are fixed: the solver holds them and a drag can't move them.
  Closed ones make [profiles](../sketching.md#profiles), and you can
  constrain and dimension against them.
- They follow the model: change the body underneath and the curves are cut
  again at the same plane, together with whatever is constrained or
  dimensioned to them.
- Deleting one keeps it deleted; the projection goes when its last curve
  goes. Nothing else can change these curves: see [Trim](./trim.md) and
  [Sketch Fillet](./sketchFillet.md).
- [Project](./project.md) works the same way but brings in the outlines of
  edges, faces, vertices and bodies instead of where they cut the plane.

## Messages

- "Pick a face in the view, or a body in the browser: its curves in the
  sketch plane come in.": the panel's prompt.
- "Can't intersect that yet: the model is still computing.": the click landed
  while the kernel was still computing the body. Try again once it settles.
- "That's already intersected with this sketch.": the face or body is
  already in. Nothing changes.
- "Lost an intersected face after an earlier change; its curves stay where
  they were. Delete them, or intersect the face again.": a change to the model
  removed the face (for a body, the message says body). Delete the curves, or
  pick the face again.
<!-- /notes -->
