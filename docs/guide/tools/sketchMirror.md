---
title: Mirror
section: Tools
category: Sketch
order: 93
---

# Mirror

Mirror curves about a line; the copies stay symmetric.

| Where | Shortcut |
|---|---|
| Sketch › Create | None |

<video src="demo:sketchMirror" muted loop autoplay playsinline aria-label="Mirror demo"></video>

<!-- notes -->
## Step by step

1. Select what to mirror first if you like. If something is selected when
   the tool starts, go to step 3.
2. Otherwise choose **Mirror** in Sketch › Create and click the points and
   curves to mirror, one by one. A click on something already picked
   unpicks it. Nothing snaps while you pick. Press `Enter` when the picks
   are right (it does nothing with no picks).
3. Move the pointer over the line to mirror about. The preview shows where
   the copies would land. Click the line. It can be any line of the sketch
   except one of the picked objects.
4. The copies appear at once, and the tool is back at the picking step with
   nothing picked. The mirror is one undo step, named Mirror.
5. `Esc` steps back a stage: from the line to the picking step (the picks
   stay), then it drops the picks, then it ends the tool. Another tool or
   closing the sketch ends it too.

## What it keeps

- Each picked object is copied with its own new points. The originals stay.
- The copies stay symmetric. A **Symmetric** constraint about the line holds
  each line, circle and arc as a whole; a spline or a loose point is held
  point by point, an ellipse by its center and major axis, and a text by its
  two points. Edit the original and the copy follows.
- A point that lies on the mirror line gets a copy **Coincident** with it,
  and the original is held on the line (unless something already holds it
  there). A line or arc with an end on the line has its ends paired this
  way; an arc also gets **Equal** with its copy.
- The copy is construction geometry when the original is. The `X` toggle
  does not change that.
- Dimensions and other constraints on the originals are not copied.

## Messages

- "Pick points and curves, then press Enter.": the prompt while you choose
  what to mirror.
- "Pick the line to mirror about.": the prompt once you have picks.
- "Pick a line to mirror about.": the line you clicked has no length. Click
  another line.
<!-- /notes -->
