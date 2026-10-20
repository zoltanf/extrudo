# ADR-0094: Aligned edges infer Collinear; a point pair's Horizontal/Vertical gets its own glyph

- **Status:** Accepted, 2026-10-19
- **Issue:** the owner's test of 2026-10-19: two rectangles drawn level with
  each other read as "a point is horizontal".
- **Builds on:** ADR-0012 (inference and auto-constraints: `infer()`,
  `alignmentConstraints`, the host's test-solve), ADR-0013 (the Rectangle
  tool and the shared shape builders), ADR-0015 (constraint glyphs).
- **No schema or file-format change.** No new constraint type; the stored
  `collinear`, `horizontal` and `vertical` are used as they are.

## Context

Draw a rectangle, then a second one beside it whose bottom corner snaps level
with the first one's bottom corner (the dashed horizontal guide). The guide's
source is a *sketch point* (the first rectangle's corner), so the drawing tool
adds a **Horizontal between the two corner points** (`alignmentConstraints` in
`packages/sketch/src/inference/constraints.ts`). Two things went wrong for the
person drawing:

1. The constraint is drawn as **two ordinary Horizontal glyphs**, one beside
   each corner, identical to a line's own Horizontal glyph. Nothing says the
   two rectangles are tied together; it reads as "this point is horizontal".
2. Even read correctly, "these two points are level" is a weaker statement
   than what the person meant: the two bottom edges line up.

## Decision

### 1. Aligned edges become Collinear (`alignmentConstraints`, `place`, the Rectangle tool)

`AnchorEntities` gets `along`: the new lines leaving the placed point along
each axis (`{ horizontal?, vertical? }`), and `alignmentConstraints` and
`place` take the `sketch` to look the guide's source up in. When an alignment
with a sketch point has a new line along its axis **and** the source point
ends an existing line that runs along the same axis (`lineAlong`: geometry
decides, within 1e-6 relative; the source point's coincident points count,
because a rectangle's corner is two points), the tool adds **Collinear between
the two lines** instead of the point pair. `place` then **drops the new line's
own Horizontal/Vertical from the edit**: the Collinear implies it, both
together would be redundant, and the host's test-solve (which vets inferred
constraints in order) might have dropped the Collinear instead.

The Rectangle tool passes `along` for its axis-aligned modes (2-point and
centre; edges 0 and 2 run horizontal, 1 and 3 vertical at each corner), not
for the 3-point one (its edges are at an angle). The other shapes have no
axis-parallel edges to pass (a slot's or polygon's first edge aligned with the
anchor is the anchor case, unchanged), and the Line tool's segment is only
axis-parallel through a typed angle, which places no inference.

**Point pairs stay** where either side has no such line: a circle centre, a
lone point, an arc end, a slanted line's end, or a placed point that is not
the end of a new axis-parallel line.

### 2. A point pair's own glyph (`glyphs.ts`, `ConstraintGlyphs.tsx`)

A Horizontal or Vertical with `b` set shows **one glyph, halfway between the
two points**, placed like a point glyph (up and right, in a row with anything
else at that spot), with its own icons `horizontal-points` and
`vertical-points` (two dots joined by a dashed line, no solid line) and the
label "Horizontal (points)" / "Vertical (points)" in its tooltip and
accessible name. Hovering it still highlights both points. `glyphs.ts` decides
the icon and label (`glyphFace`), so the choice is unit-tested with the
placement; the component only draws what it is given.

## Rejected

- **Only a new glyph** (keep the point pair, draw it once in the middle with
  the dotted icon). Honest about what is stored, but the stored thing is the
  weaker one: the person meant the edges, and a later edit (say, extending
  one rectangle) keeps the corners level while the edges may still drift
  apart in their own lengths. Collinear says what was meant.
- **Collinear always** (whenever the source point ends a line). A slanted
  line's end aligned with a new corner must not make the corner's edge
  collinear with the slanted line: the new edge is horizontal, the other is
  not, and the solver would conflict or turn the rectangle. Collinear only
  when both lines run along the guide's axis.
- **Keep the new line's own Horizontal as a fallback** (mark it inferred
  after the Collinear, so the test-solve drops whichever is redundant). It
  works when the solver is loaded and leaves two redundant constraints in the
  sketch when it is not (the first seconds of a session); dropping the own
  constraint outright is deterministic.
