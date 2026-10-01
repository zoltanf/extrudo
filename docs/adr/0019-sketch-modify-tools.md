# ADR-0019: Sketch modify tools

- **Status:** Accepted, 2026-09-27
- **Task:** P1-10 (modify tools; FR-SK-10). Code: the geometry in
  `packages/sketch/src/modify/` (entry `@extrudo/sketch/modify`: `split.ts`
  trim, break, extend; `corner.ts` fillet, chamfer; `offset.ts`;
  `transform.ts` copy, mirror, patterns, scale; `change.ts` the change
  builder); the `modifySketch` command in `packages/core/src/sketch/commands.ts`;
  the tools in `apps/web/src/sketch/tools/` (`split.ts`, `corner.ts`,
  `offset.ts`, `transform.ts`); the host's new edit fields in `host.ts`.
- **Builds on:** ADR-0010 (sketch model), ADR-0012 (tool framework,
  `auto` constraints), ADR-0015 (picking tools), ADR-0016 (dimensions as
  parameters), ADR-0018 (selection, the solver's `dragBy`).
- **Affects:** P1-11 (profiles see the trimmed and filleted geometry),
  P1-15 (B1 uses offset and fillet), later sketch patterns as constraints.

## Context

FR-SK-10 asks for trim, extend, break, sketch fillet, sketch chamfer,
offset, mirror, move/copy, rectangular and circular pattern, and scale.
Until now a tool could only add (`addToSketch`) or, for Fix, remove a
constraint. The modify tools change existing geometry: a trimmed line's
end moves and loses what held it, a circle becomes an arc, a fillet
replaces a corner. Our sketch has no special constraints for offsets,
patterns or virtual sharps, and planegcs flags redundant equations, so
every result must solve cleanly with the constraints we have.

## Decision

1. **Pure operations, one command.** Each tool's geometry is a pure
   function of the sketch in `@extrudo/sketch/modify` (no WASM, like
   `/inference`) that returns a `SketchChange`: new entities, constraints
   and dimensions, replaced entities (`update`, the ID kept even when a
   circle becomes an arc), constraints and dimensions changed in place
   (`replace`, keeping IDs and parameter names), removals with no implicit
   clean-up, and new expressions (`exprs`). Core's `modifySketch` applies
   it as one undo step named after the tool; `addToSketch` shares its
   recipe. The tool host treats a change like a drawing edit: `auto` items
   are test-solved and dropped when redundant, the result is solved, and
   solved positions go into the same command.
2. **Trim, break and extend split a curve into pieces of its parameter.**
   The piece that holds the curve's start keeps its ID (and so its
   dimensions and most constraints); other pieces are new curves held to it
   (collinear lines, or concentric arcs with equal radii; a break's joined
   pieces use parallel and no equal, as the joint already implies the
   rest). An end that no piece keeps is removed with everything on it; a
   new end at a crossing gets `pointOnCurve` on the crossing curve, or
   `coincident` with its end. The curve's own constraints go where they
   still mean the same: point-on-curve follows the point's piece,
   tangency follows the joint's end, midpoint, equal length, symmetric
   (as a pair) and a line's length go. Crossings come from every other
   curve, construction included; ellipses and splines cut as polylines.
3. **Fillet and chamfer keep a virtual sharp.** The corner becomes a point
   on both lines, and whatever was on the old corner ends moves to it:
   constraints, distances, and a line's length becomes the distance from
   the sharp to the far end. A dimensioned, fixed rectangle stays fully
   constrained after a fillet or a chamfer, and its width parameter still
   drives it. The fillet adds an arc, coincident and tangent to both
   lines, and a driving radius; the chamfer a line and two distances from
   the sharp, the second linked to the first's parameter (`links`: the host
   names new parameters and writes `d7` into the linked expression). The
   size is typed, or a quarter of what fits.
4. **Offset works on chains.** The picked curve's chain is the lines and
   arcs joined end to end by coincident constraints, up to a joint with a
   third curve; a circle is its own chain. Each piece is offset (lines
   parallel, arcs concentric) and neighbours are cut or extended to meet;
   tangent joints keep their tangency. The first line gets a distance
   dimension; the others get a parallel and a distance linked to it, both
   `auto`, since tangent joints to arcs can already fix those lines (a
   slot's second side). A chain of arcs gets the first one's radius (a
   circle's diameter) as a number.
5. **Copies copy constraints and dimensions, not position.** Copy, and the
   pattern instances, bring the constraints and dimensions wholly among the
   copied entities; a rotation leaves horizontal, vertical, fix and
   horizontal or vertical distances behind. A pattern instance's dimension
   takes the original's parameter as its expression, so one value sizes
   them all. Instances are placed, not tied to the original's position.
6. **Mirror is symmetric.** Lines, circles and arcs get a `symmetric`
   constraint with their copy (an arc's copy runs the other way round);
   points and spline points one per point; an ellipse its center and major
   point. A point on the mirror line gets a coincident copy and is held on
   the line (`auto`, kept only if it isn't held there already).
7. **Move drags; Scale moves and checks.** Move uses the solver's drag
   (`dragBy`, as a pointer drag does), so moved geometry keeps its
   constraints and the rest follows. Scale moves points and radii and
   scales the expressions of dimensions wholly on the objects ("20 mm" →
   "40 mm", "d3 + 1" → "(d3 + 1) * 2"); it refuses fixed geometry, and the
   host refuses the change if the solve moves a scaled point (`hold`), as
   when a dimension ties it to something else.
8. **The tools follow the picking and placing tools.** Trim, Extend,
   Break, Fillet, Chamfer, Offset and Mirror pick (no snapping; hover
   previews what the click does: red for what goes, the accent for what
   comes). Move, Copy, the patterns and Scale start from the selection or
   picks plus Enter, then place with inference and heads-up fields. Esc
   steps back. Shortcuts: T, O, F (sketch fillet in sketch mode), M.

## Consequences

- Every modify result the unit tests check solves with no conflicting,
  redundant or partly redundant constraint, and keeps the DOF the design
  implies (a fully constrained rectangle stays fully constrained through
  fillet, chamfer and offset).
- A virtual sharp is an ordinary sketch point: it draws as a point and can
  be deleted, which takes the dimensions on it along.
- Pattern and copy instances can drift: their positions aren't
  constrained to the original.

## Rejected

- **A replace-everything edit (remove the curve, add pieces).** New IDs
  would drop the curve's dimensions and every constraint on it, and
  selections and glyph positions would jump. Keeping the first piece's ID
  keeps them.
- **Keeping all offset distances required.** A slot's offset then has a
  redundant parallel and distance (the tangent arcs already place the
  second side); planegcs flags them. Test-solving them as `auto` keeps them
  where they're needed (a rectangle) and drops them where they aren't.
- **Symmetric centres and ends for arcs touching the mirror line.** Six
  equations for an arc's five unknowns; planegcs calls one redundant. The
  ends and an equal radius do it.
- **Relying on the solve to refuse scaling fixed geometry.** A fix holds
  whatever position it finds, so the moved point stays fixed where it
  moved; the operation refuses instead.
- **Linking pattern instances' positions with dimensions** (a horizontal
  distance per instance, `i × spacing`): correct, but a 5 × 5 pattern gets
  48 dimension labels. A pattern constraint that draws as one glyph is the
  better way; later.

## Open

- Trimming or breaking ellipses and splines (needs elliptical arcs, and a
  spline sub-curve that keeps its shape).
- Fillets and chamfers between a line and an arc, or two arcs.
- Offset corners are always sharp (no round joins); a chain whose offset
  pieces stop meeting is refused.
- Pattern instances and copies aren't tied to the original's position
  (see Rejected); rotating Move isn't there.

## Amendment (P3-17)

The chain Offset takes follows projected curves that end in one place (see the
ADR-0031 amendment), and a smooth joint between projected neighbours gets a
tangent constraint on the offset pieces. B2 uses it.
