# ADR-0129: A line's middle on another line or an axis (`midpointOnLine`)

- **Status:** Accepted, 2026-11-06 (the owner's review of a screen recording: option
  1.1, "Midpoint accepts an axis or another line after a line").
- **Builds on:** ADR-0010 (sketch data), ADR-0093 (datum picks, "an axis has no length
  or middle"), ADR-0074 (auto-project).
- **Schema change:** a new constraint type, `midpointOnLine` (`docs/file-format.md`
  §7.2). No migration: older files don't have it.

## Context

In the recording, the owner picked a rectangle's top line with Midpoint and then the
Y axis, to centre the rectangle on the axis. Midpoint only knew "a point at the middle
of a line or an arc", so the axis was refused with "An axis has no length or middle;
pick a sketch line." That message was also misleading: a sketch line had been picked,
and the tool was waiting for a point. The owner then centred the rectangle by
dragging it by eye.

Centring a line on an axis (or on another line) is a common need, and the existing
alternatives each fall short:

- **Symmetric** on the line's two ends about the axis also forces the line square to
  the axis. With the rectangle's own Horizontal that is redundant, so the sketch turns
  over-constrained.
- **A construction point** at the line's middle with Coincident on the axis takes three
  steps and leaves an extra point.

## Decision

1. **A new constraint, `midpointOnLine` `{ a, b }`:** line `a`'s middle lies on line
   `b`, taken as endless. `b` may be a datum axis (its projected construction line), a
   projected body edge or any other sketch line, distinct from `a`. It is a separate
   type, not `midpoint` with a line in `point`: trim, break, fillet and transform treat
   `midpoint.point` as a point.
2. **Solver:** planegcs's `midpoint_on_line_ll` (`l1` = `a`, `l2` = `b`), one equation.
3. **The Midpoint tool** keeps its point ↔ line or arc pairs and adds:
   - a sketch line, then a line or an axis: `midpointOnLine` with the first line as `a`;
   - an axis first, then a sketch line: the line is `a`, the axis `b`.

   The prompt after a line reads "Pick the point to put at its middle, or a line or an
   axis to put its middle on."; after an axis, "Pick the line to put its middle on the
   axis." An axis is still refused after a point, an arc or another axis (the old
   hint). The glyph sits on `a` and shows Midpoint's icon; the UI calls the
   constraint "Midpoint".
4. **Modify tools:** breaking or trimming `a` drops the constraint (its middle moves);
   cutting `b` keeps it on the piece that keeps `b`'s ID (the endless line is the same).
   Fillet and chamfer drop it when `a` is a corner's line.
5. **API:** `k.midpointOnLine(line, on)`; the code emitter writes it.

## Rejected

- **`midpoint` with `point` a line:** no new type, but `point` would name a line, and
  every place that reads `midpoint.point` as a point (split, corner, glyphs, f3d) would
  need a guard.
- **Symmetric under the hood:** wrong for a line not square to the axis, and redundant
  with Horizontal/Vertical (above).
