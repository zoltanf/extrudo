# ADR-0112: Distance dimensions to a circle's or an arc's edge

- **Status:** Accepted, 2026-10-28 (the owner asked for it)
- **Builds on:** ADR-0016 (sketch dimensions, the Dimension tool), ADR-0011
  (the solver adapter, solver-only primitives like the ellipse's focus),
  ADR-0002 (planegcs).
- **Schema change:** `distance` dimensions take a circle or an arc as `a` or
  `b`, and two optional fields `sideA`, `sideB` (`docs/file-format.md`).

## Context

The Dimension tool (`D`) dimensioned a circle only by its diameter (an arc by
its radius); its position needed its center: a center-to-line distance, or a
construction line tangent to it to reach its edge. Other parametric CAD tools
dimension from a circle's edge directly. The owner's example: a Ø20 circle left
of a 50 × 100 rectangle, a `25.00` horizontal dimension from the circle's right
edge to the rectangle's left edge.

## Decision

1. **Schema.** A `distance` dimension's `a` or `b` may be a circle or an arc,
   with a point, a line or another circle or arc as the other entity (a round
   alone stays a radius or a diameter, so a round needs `b`). Circle/arc pairs
   take all three orientations, to lines too (a point or a line with a line
   stays aligned only). `sideA`/`sideB: 'near' | 'far'` say which edge of a
   round `a`/`b` the distance runs to; absent means `near`. A side is only
   allowed on a round.
2. **Which edge point** (`roundEdgePoint` in `core/src/sketch/dimensions.ts`).
   An arc counts as its whole circle. Aligned: on the ray from the center
   toward the other entity's reference point (a point itself, the center's foot
   on a line, the other round's center), `near` = toward it, `far` = away.
   Horizontal/vertical: the quadrant point (center ± r along x or y), `near` =
   the one on the side of the reference point. To a line, a horizontal or
   vertical distance runs from the edge point along x or y to where it meets
   the line (`lineMeet`); an aligned one to the foot of the perpendicular. The
   measurement is unsigned, like every distance.
3. **The tool sets the side from the click.** Clicking the half of the circle
   that faces the other entity's reference point gives `near`, the other half
   `far` (sign of the dot product of click − center and reference − center).
   The tool flow follows the line's: a circle or arc first waits for a second
   pick (a line, a point, a circle or an arc, not its own center or ends);
   clicking empty space places its diameter or radius as before. Like after
   a line, the label's click must stay free: after a circle or an arc, datum
   axes (unseen lines through the view) and body edges are not taken as the
   second pick (pick the axis first, then the circle); the origin and datum
   points are. The
   orientation comes from `orient` on the two end points, as for two points,
   so a circle next to a vertical line gets an aligned distance that reads
   horizontal.
4. **Solver** (`packages/sketch/src/solver/mapping.ts`). Where planegcs has a
   constraint that means exactly what we measure, it is used: aligned, near
   side only: `p2cdistance` (round ↔ point: `|pc| = r + d` outside, `r − d`
   inside, both our near edge), `c2ldistance` (round ↔ line: `h = r + d`, used
   while the center is at least `r` from the line), `c2cdistance` (round ↔
   round, both near: `|c1c2| = r1 + r2 + d`, used while the circles are apart;
   its "inner" case for nested circles measures a different gap). Everything
   else (a far side, horizontal, vertical, a round crossing the line, overlapping
   or nested circles) uses **solver-only helper points**, like the ellipse's
   focus: `<id>#qa`/`<id>#qb`, the edge point of round `a`/`b`. Horizontal or
   vertical, it is the quadrant point on a fixed side: level with the center
   (`horizontal_pp`/`vertical_pp`) and one radius off (`difference` of the
   coordinates equal to the round's `radius` parameter), so no change of value
   can flip it to the other quadrant. Aligned, it is on the round
   (`point_on_circle`/`point_on_arc`, which planegcs maps to a distance from the
   center, without the arc's angular range) and on the line through the center
   square to the other line (`perpendicular_pppp`) or through the other point
   or center (`point_on_line_ppp`). Then the ordinary distance runs from the
   helper (`p2l_distance`, `p2p_distance`, `difference`). A horizontal or
   vertical distance to a line also has `<id>#m` on the line
   (`point_on_line_pl`) level with the edge point. Each helper adds two
   unknowns and two equations, so the DOF count is the same as a center
   distance's. Helpers start at the edge point the geometry has now;
   `System.setValues` writes them again when a system is reused. An aligned
   helper has two solutions on its line (near and far); starting on the stored
   side keeps it there for the bounded steps `gradual.ts` takes, the same
   guard that keeps a line on its side of an edge.

## Rules

- The measurement (`distanceEnds`, `measureDimension`) and the solver mapping
  must agree for every pair, side and orientation; `solver.test.ts` checks the
  solved value against `measureDimension`.
- A side is stored only on a round, and only for a round with a second entity.
- Helper points are solver-only (`#` IDs, not entities): never in `uses`,
  `free` or the solution; a dimension's redundancy counts its equations, not
  its helper points.
- A native planegcs constraint is used only where its equation is our
  measurement for the geometry as it stands; otherwise the helper route.

## Consequences

- No new primitive in planegcs, no patch change.
- A near-side distance to a line that the circle crosses measures `r − h`; it
  stays crossing while solved (helper route), rather than jumping out.
- The label's context menu could later flip a side; for now the user redraws
  the dimension, clicking the other half.

## Rejected

- **Tangent construction lines** (what users had to do): two extra entities
  and a constraint for one measurement, and the line has to be long enough.
- **Near side only** (one other open-source CAD does this): the far edge of a
  hole is a common reference (overall widths).
- **A `min | max | center` choice per dimension**, as some tools offer in a
  dialog: `center` is the existing center distance, and min/max is our
  near/far; a dialog per dimension is slower than clicking the edge you mean.
  It can come later as a context-menu toggle on the label.
- **Horizontal/vertical to a line through the perpendicular's foot**: for a
  slanted line the foot's x is not where a horizontal from the edge meets the
  line, which is what a horizontal distance means.
