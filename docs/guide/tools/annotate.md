---
title: Annotate
section: Tools
category: Construct
order: 66
---

# Annotate

Pin a numbered note (#1, #2, …) to a face, an edge, a point or empty space. Click, type, Enter.

| Where | Shortcut |
|---|---|
| Construct › Inspect | N |

<video src="demo:annotate" muted loop autoplay playsinline aria-label="Annotate demo"></video>

<!-- notes -->
## Step by step

1. Press `N` (or Construct › Inspect › Annotate). Hovering lights up what a
   click pins the note to: a face, an edge, a vertex, a body, a plane, an
   axis, a point or a sketch curve.
2. Click where the note belongs. On the part, the note sits exactly where
   you clicked; on empty space, it sits on the grid. A box opens with the
   note's number already shown.
3. Type the note. `Shift+Enter` starts a new line, `Enter` adds it (one undo
   step). `Esc`, or leaving the box empty, adds nothing.
4. The tool stays on for the next note. `Esc` ends it.

## Working with notes

- Every note has a number, `#1`, `#2`, …, and keeps it. A deleted note's
  number is never given again, so "#3" always means the same note, to you
  and to an AI agent working on the design.
- Double-click a note to change its text, drag it to move it out of the
  way, right-click it to hide it, mark it done or delete it. `Delete`
  deletes the selected notes.
- A note on the part follows it: change a parameter and the note moves with
  its face. If what it was on is gone, the note is drawn dashed where it
  was: delete it, or keep it as a reminder.
- A note on the far side of the part is drawn as a faint number, so it never
  looks like a note about the face in front. Select it to see it in full.
- The **Annotations** folder in the browser lists them. Its eye hides all
  notes (for screenshots), each row's eye hides one, and the tick marks one
  done (it shrinks to its number). The folder's menu has **Numbers only**
  for a crowded view.
<!-- /notes -->
