# ADR-0016: Sketch dimensions, dimension parameters and re-solving

- **Status:** Accepted, 2026-09-27
- **Task:** P1-07 (dimensions, FR-SK-08, FR-PAR-03 for sketches). Code: the
  Dimension tool in `apps/web/src/sketch/tools/dimension.ts`, label layout
  in `tools/dimensionLayout.ts`, the label layer and in-place editor in
  `tools/DimensionLabels.tsx`, `apply` in `tools/host.ts`; in
  `packages/core`: `sketch/dimensions.ts` (measuring, anchors),
  `updateSketchDimension` and `setSketchGeometry` in `sketch/commands.ts`,
  dimension parameters in `expr/parameters.ts`, inline definitions in
  `expr/inline.ts`.
- **Builds on:** ADR-0004 (expressions and parameters), ADR-0010 (dimension
  shapes), ADR-0011 (solver values, `check`), ADR-0012 (tool framework),
  ADR-0015 (picking tools, glyph layer, selection, deleting).
- **Affects:** P1-08 (over-constraint dialog, status colours), P1-09
  (deleting geometry must take its dimensions; dragging), P2-01 (recompute
  must re-solve sketches when parameters change).

## Context

The schema has held every FR-SK-08 dimension since P1-01, and the solver
maps them all (P1-03), but only the drawing tools' typed values created
any, nothing drew them, and a dimension's value couldn't be changed after
it was made. A dimension also has to be a model parameter (`d1`…) that
other expressions can use and the Parameters dialog lists, and changing
its value, or a parameter it uses, has to move the geometry.

## Decision

1. **The Dimension tool (`D`) is a picking tool,** like the constraint
   tools: no inference, hover shows what a click picks. One or two picks
   decide the type: a line gives its length (a click on empty space places
   it), or with a second line an angle (a distance if they are parallel),
   or with a point the point-to-line distance; a circle its diameter, an
   arc its radius; two points their distance. The next click places the
   label. A length or a two-point distance is horizontal when the label is
   above or below the geometry's extent, vertical when it is beside it,
   aligned otherwise; a horizontal or vertical pair is always aligned.
2. **An angle dimensions a pair of angles.** Two crossing lines make two
   pairs of opposite angles, θ and 180° − θ, where θ is the angle between
   the lines' directions (what planegcs constrains). The label's sector
   picks the pair, stored as `supplement` on the angle. The solver maps a
   supplement as 180° − value.
3. **A new dimension drives at what it measures,** rounded to the document
   precision, so placing one moves the geometry by at most half a display
   step. The host gives every new driving dimension the next free
   parameter name (`d1`…), those typed into a drawing tool's heads-up box
   too. A new dimension that would over-constrain the sketch
   (`SketchSolver.check` refuses it) goes in **driven** instead, and the
   prompt says so; P1-08 turns this into a question. After placing, the
   host opens the new dimension's value for editing.
4. **The label's place is an offset from the dimension's anchor,** in
   sketch mm (`label: {x, y}`): the middle of a distance, the center of a
   circle or arc, where an angle's lines cross. So the label follows the
   geometry. Without an offset, it sits 32 px from the geometry at the
   current zoom. `label` and `supplement` are optional fields: no format
   version bump, older documents load unchanged.
5. **Named driving dimensions are model parameters.** The parameter graph
   reads them from sketch features (owner `{ type: 'dimension', featureId,
   input, dimension }`) and evaluates every driving dimension, named or
   not, into `evaluation.dimensions`; the solver's values come from there,
   so cycles and name errors behave as everywhere else. A driven dimension
   is not a parameter: turning one driven gives up its name (refused while
   another expression uses it), and turning it driving again takes the
   next free name and the value it measures now. Renaming a user
   parameter renames it in dimension expressions; deleting a parameter, or
   a dimension whose name is used, is refused with the users listed (named
   dimensions by name, feature inputs by feature). A driven dimension's
   `expr` only records what it measured and is never counted.
6. **Changing a value re-solves, in the same undo step.** `ToolHost.apply`
   runs commands in a nested transaction, then solves every sketch whose
   evaluated dimension values changed (open or not) and stores what moved
   (`setSketchGeometry`), and commits the lot as one step. If a sketch that
   solved before no longer does, or a curve collapses (ADR-0015), it
   cancels the transaction and throws a `CommandError`: the value is
   refused. The in-place editor and the Parameters dialog both go through
   it. The solver now loads when a sketch opens, or at once when the
   document has driving dimensions.
7. **Labels are HTML buttons over an SVG layer,** like the constraint
   glyphs; `dimensionLayout.ts` shapes the lines, extension lines, arcs and
   arrowheads in sketch space (unit-tested), and the layer projects them.
   Arrowheads are drawn in screen pixels. A label selects its dimension
   (kind `dimension`; Shift or Ctrl toggles), drags to a new place (one
   `updateSketchDimension` on release), and a double-click opens the
   editor: an `<ExpressionInput>` for the value and a "Driven" checkbox.
   Enter or leaving the editor commits, Esc closes it, and a refused value
   shows as a toast. Delete removes selected dimensions with constraints.
   Driven labels are grey and in parentheses, expressions show `fx:`.
   "Show dimensions" is a saved viewport preference.
8. **`name = value` defines a parameter inline** in the dimension editor
   (FR-PAR-03): `inlineParameter` finds the form and `evaluateInline`
   checks the name like a new parameter and evaluates the value, with error
   spans in the typed text. Committing adds the user parameter and sets the
   dimension to its name, as one step.

## Rejected options

- **Storing the label's absolute position:** it would stay behind when the
  geometry moves. **Storing a screen offset:** it would change meaning with
  the zoom.
- **Re-solving from a store subscription** after any document change: the
  solve would be its own undo step, and undoing it would re-trigger it, so
  the user could never undo past it.
- **Driven dimensions as parameters holding their measurement:** geometry
  would feed back into expressions, and through them into the solver.
  Possible later with care; nothing asks for it yet.
- **Refusing an over-constraining dimension outright:** Fusion offers to
  make it driven instead, which is what the user usually wants; P1-08 adds
  the question.
- **A radius for circles:** Fusion and most drawings use the diameter;
  the radius is for arcs.
- **Inline definitions in every `<ExpressionInput>`:** the heads-up box
  and feature dialogs need their own create step (the parameter must exist
  before the typed value is used). The dimension editor is where the
  roadmap asks for it; others can follow with the same helpers.

## Consequences

- Deleting geometry (P1-09) must delete the dimensions on it, and refuse
  (or ask) when their names are used elsewhere.
- Sketches re-solve on the main thread whenever a parameter they use
  changes: cheap for ordinary sketches, slow for large coupled loops
  (ADR-0011's gear). P2-01's recompute takes over when features depend on
  sketches.
- An edit made before the solver has loaded (the first moments after
  opening) is applied without a solve; the next change settles the sketch.
- The Parameters dialog is on the Solid tab only, so a sketch's parameters
  are edited there after Finish Sketch, or in place in the sketch.
- The line from ADR-0004's consequences ("P1-07 must add sketch-dimension
  expressions to rename and delete checks") is done.
