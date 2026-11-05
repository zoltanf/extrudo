---
title: Break
section: Tools
category: Sketch
order: 100
---

# Break

Split a curve where other curves cross it.

| Where | Shortcut |
|---|---|
| Sketch › Modify | None |

<video src="demo:break" muted loop autoplay playsinline aria-label="Break demo"></video>

<!-- notes -->
## Step by step

1. Open the **Modify** menu (the group name, with its arrow, under the
   tiles) in a sketch and choose **Break**. Point at a line, circle, arc or
   spline that other curves cross: the preview shows in the accent colour the
   piece between the crossings on either side of the pointer.
2. Click to break. The curve is cut at the crossings on either side of the
   pointer, and the piece under the pointer is a curve of its own. A curve
   crossed only on one side of the pointer breaks in two; one crossed on
   both sides breaks in three. A circle needs two crossings and becomes two
   arcs.
3. The tool stays on for the next curve. `Esc` ends it. A click on nothing,
   or on a curve that is not a line, circle, arc or spline, does nothing.
4. Each click is one undo step, named Break.

A crossing at a line's or an arc's own end doesn't count: only a curve that
crosses it between its ends breaks it.

## What it keeps

- No end is removed: the pieces together are the curve you started with.
  The piece that starts where the curve started keeps its identity, so its
  dimensions and most of its constraints stay with it.
- Neighbouring pieces are joined at the crossing by **Coincident** ends. New
  line pieces are **Parallel** to the first, so with the joint they stay in
  line; new arc pieces are **Concentric** with it. A circle's two arcs meet
  at both crossings and are **Equal**.
- Splines break into control splines, each exactly its part of the original.
  A closed spline crossed once opens there, its two ends held together.
- On a line or an arc, a point held on the curve moves to the piece it now
  sits on, a tangency at a surviving joint follows it, and a fix holds every
  piece. Midpoint on the curve and Symmetric (unless the curve is the axis)
  go, and so do Equal lengths between lines. A circle's held points move to
  the arc they sit on.
- A line's own length dimension goes: it measured the whole line. If another
  expression uses its parameter, nothing changes and a message names what
  uses it.
- A projected curve can't be broken; delete it instead, or bring it in again
  with **Keep linked** off.

## Messages

- "Click a curve where it should break off.": the prompt.
- "Nothing crosses it to break it at.": no other curve crosses the curve
  between its ends. Draw the curve that should cut it.
- "A circle breaks where two curves cross it.": the circle has fewer than two
  crossings. Add another curve through it.
- "A conic can't be cut where curves cross it.": the curve is a conic, which
  can't be broken. Draw it as a spline if you need to cut it.
- "Projected geometry follows the model and can't be changed here. Delete
  it, or change the model.": the curve is a projected one, which only the
  model may move.
<!-- /notes -->
