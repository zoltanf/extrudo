# ADR-0015: Constraint tools, glyphs and deleting constraints

- **Status:** Accepted, 2026-09-26
- **Task:** P1-06 (constraints UI, FR-SK-07). Code: the constraint tools in
  `apps/web/src/sketch/tools/constrain.ts` (run by the tool host,
  `host.ts`), glyph placement in `tools/glyphs.ts` and the glyph layer in
  `tools/ConstraintGlyphs.tsx`, deleting in `sketch/selection.ts`,
  `removeFromSketch` and `constraintRefs` in `packages/core/src/sketch/`,
  `pickEntity` in `packages/sketch/src/inference/pick.ts`, the compact
  Constraints group in `shell/Toolbar.tsx`, the passthrough in
  `viewport/Viewport.tsx`.
- **Builds on:** ADR-0010 (constraint shapes), ADR-0011 (`SketchSolver.check`),
  ADR-0012 (tool framework), ADR-0014 (what ellipses and splines take).
- **Affects:** P1-07 (dimensions reuse picking, selection and deleting),
  P1-08 (glyph and geometry colours by status), P1-09 (entity selection,
  box select, deleting geometry).

## Context

The sketch already stored every FR-SK-07 constraint, and the drawing tools
added some automatically, but nothing let the user add one, see one or
remove one. The UI spec asks for a row of constraint icons, glyphs next to
the geometry with a hover highlight, selectable and deletable glyphs, and a
"Show constraints" toggle in the palette.

## Decision

1. **A constraint tool is a sketch tool.** The 13 tools (Coincident …
   Symmetric) are one `ConstraintTool` class with a rule per type (what it
   accepts next, the prompt, the constraint it makes). The host runs them
   like drawing tools: prompt, Esc steps back a pick then leaves, undo
   restarts the tool, and the tool stays on for the next constraint. A tool
   with `picks: true` gets the bare cursor: the host runs no inference.
   `ToolContext.pick` finds the entity under the cursor within the snap
   distance, points before curves (`pickEntity`, measured against
   `curvePolyline`, which the viewport draws from as well).
2. **What the user asks for is checked, not filtered.** A constraint tool's
   edit lists its constraint in `SketchEdit.verify`. The host test-solves it
   (`SketchSolver.check`) and refuses the whole edit with a message in the
   prompt when it is redundant ("isn't needed: the sketch already holds
   it") or conflicts. Inferred constraints are still dropped silently.
3. **A solve that collapses a curve is a conflict.** planegcs satisfies some
   contradictions by shrinking geometry: two horizontal lines made
   perpendicular become two points 0.0001 mm long, and it reports success
   with a plausible DOF count. For a constraint the user asked for, the host
   checks the solved sketch: a line, circle, arc or ellipse that shrinks
   below 1 µm makes it refuse the constraint as a conflict.
4. **Coincident covers both shapes,** as in Fusion: two points make
   `coincident`, a point and a curve (either order) `pointOnCurve`.
   Horizontal and vertical take a line at once, or two points. Fix on a
   fixed entity frees it (`SketchEdit.remove`). A tangent between curves
   that meet at an end stores its side (`reversed`, from `tangentReversed`,
   which the inference entry now exports: it is pure).
5. **Glyphs are HTML buttons over the view,** one layer drawn in screen
   space from sketch coordinates, like the tool overlay. Placement is a pure
   function (`glyphAnchors`, then `layoutGlyphs`): one glyph per constrained
   entity, at a point, a line's or an arc's middle, a circle or an ellipse
   at 45°; a coincidence, a point on a curve and a tangent at a joint show
   once, at the point; a symmetry shows on its pair, not the axis. Glyphs
   move 14 px off their curve (the upper or left side of a line, outward on
   a circle) and those on one spot form a row. Hovering one highlights the
   entities it constrains (`constraintRefs`). Clicking selects it in the
   session selection (a new `constraint` selection kind; Shift or Ctrl
   toggles), Delete or Backspace removes the selected constraints as one
   undo step (`removeFromSketch`), and Esc or a click on empty space clears
   the selection. The glyphs show while a tool runs but don't take clicks.
   Glyphs of constraints added while the sketch is open flash once
   (`prefers-reduced-motion` turns it off).
6. **The camera moves through glyphs.** Navigation listens on the viewport
   section and accepts events from the canvas and from elements marked
   `data-view-passthrough`: the wheel and the middle and right buttons
   navigate over a glyph, and left clicks stay the glyph's.
7. **The toolbar's Constraints group is compact:** 13 icon-only 26 px
   buttons in two rows, with the usual tooltips; nine new icons follow the
   icon rules. "Show constraints" is a saved viewport preference.

## Rejected options

- **Drawing glyphs in the WebGL scene** (sprites): they'd need their own
  picking, hover and focus handling, and their text and icons wouldn't match
  the rest of the UI. A few hundred absolutely positioned buttons are cheap.
- **Glyphs with no pointer events, hit-tested by the viewport:** navigation
  would pass through for free, but hover, click and the e2e tests would all
  need coordinate code; the passthrough attribute is one small check.
- **Trusting `check()` alone for user constraints:** see decision 3. A
  redundancy check can't see the collapse, because the collapsed solution
  is consistent.
- **Refusing any constraint whose check reports anything:** an existing
  conflict elsewhere in the component would block every new constraint.
  Only the new constraint's own redundancy or conflict (and a collapse)
  counts.
- **Hiding coincident glyphs at joined ends** (they are the most numerous):
  then they couldn't be selected or deleted until P1-09. "Show constraints"
  hides all of them; per-type filters can come later.

## Consequences

- Picking is by nearest entity, not yet the selection filter or "select
  other" (P1-09). Entities can't be selected on their own yet, so a
  constraint tool can't start from a pre-selection.
- A refusal leaves the solver's cached system for that component built from
  the refused candidate; the next solve rebuilds it, since its inputs
  differ.
- The collapse check is a heuristic with a fixed 1 µm floor; geometry that
  small on purpose would be refused. Sketches for 3D printing don't go there.
- The roadmap asks for the tools "in the toolbar and palette". The command
  palette (Ctrl+K) doesn't exist yet; the tools are in the toolbar
  catalogue (`shell/tools.ts`), which it will list.
- Glyphs are always blue; P1-08 colours them (and the geometry) by status,
  and marks conflicting constraints in red.
