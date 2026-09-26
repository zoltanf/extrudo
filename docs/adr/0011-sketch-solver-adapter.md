# ADR-0011: Sketch solver adapter

- **Status:** Accepted, 2026-09-26
- **Task:** P1-03 (solver integration). Code: `packages/sketch/src/solver/`,
  the build in `packages/sketch/planegcs/`, fixtures in
  `packages/sketch/src/fixtures.ts`, the debug page
  `apps/web/src/debug/SolverDebug.tsx` (`#/debug/solver`).
- **Builds on:** ADR-0002 (planegcs, our build, one system per component),
  ADR-0010 (the sketch data model).
- **Affects:** P1-02, P1-04 to P1-10 (tools, auto-constraints, constraints UI,
  dimensions, status colours, dragging).

## Context

ADR-0002 chose planegcs from our own WASM build behind an adapter that keeps
one system per independent component. ADR-0010 fixed what the adapter reads:
points as entities, curves that refer to them, every constraint and
dimension type as records keyed by ID, dimensions as expressions. P1-03 had
to build that adapter, get the build into CI, and measure it against the
criteria ADR-0002 set, plus a gear outline (one closed loop of 100+ curves).

## Decision

### 1. The build runs in CI once per input hash, like OCCT

`packages/sketch/planegcs/` holds `build.sh`, a `Dockerfile` pinned to
`emscripten/emsdk:6.0.10`, and `planegcs.patch` (memory growth, SIMD, the two
pivoting changes; the spike's `fast` variant). The input hash covers those
three files; the pinned planegcs commit is in `build.sh`. The CI job
`planegcs` publishes `dist/` as the release `planegcs-<hash>`, and
`pnpm wasm` (run by `check`, `dev` and `build`) downloads both WASM builds.
The build/publish/fetch logic moved out of `occt.mjs` into
`scripts/wasm-release.mjs`, shared by both; the OCCT hash didn't change.

The JS wrapper (`GcsWrapper`, the primitive types) comes from the npm
package `@salusoft89/planegcs@1.2.0`, the same version as the source we
build. The adapter imports it by deep path, so the package's own WASM never
reaches a bundle. `build.sh` writes a two-line `planegcs.d.ts` for the glue.

### 2. Mapping: one item per entity, constraint and dimension

`mapSketch()` is pure (no WASM). Each document object becomes an item: its
planegcs primitives, the entities they use, and the entities whose unknowns
it couples. Primitive IDs are document IDs, suffixed when an item needs
several (`k7#0`, `a3#rules`), so conflict reports map straight back.

| Document | planegcs |
|---|---|
| point, line, circle | `point`, `line`, `circle` |
| arc (centre, start, end, CCW) | `arc` with angles and radius computed from the points, plus `arc_rules` |
| coincident | `p2p_coincident` |
| pointOnCurve | `point_on_line_pl` / `point_on_circle` / `point_on_arc` |
| collinear | two `point_on_line_pl` (b's endpoints on a) |
| concentric | `p2p_coincident` of the centres |
| midpoint | line: `p2p_symmetric_ppp`; arc: `point_on_arc` + `point_on_perp_bisector_ppp` |
| fix | no equation: the entity's parameters are fixed (below) |
| parallel, perpendicular | `parallel`, `perpendicular_ll` |
| horizontal, vertical | `horizontal_l` / `_pp`, `vertical_l` / `_pp` |
| tangent, smooth | at an endpoint joint: `angle_via_point` (0 or π); otherwise `tangent_lc/la/cc/ca/aa` |
| equal | `equal_length`, `equal_radius_cc/ca/aa` |
| symmetric | points: `p2p_symmetric_ppl`; lines: both endpoint pairs; circles: centres + equal radius; arcs: a.start↔b.end and a.end↔b.start + equal radius |
| distance, aligned | `p2p_distance` (a line alone, two points), `p2l_distance` (point–line, line–line) |
| distance, horizontal/vertical | `difference` on x or y, signed the way the points lie now |
| radius, diameter | `circle_/arc_radius`, `circle_/arc_diameter` |
| angle | `l2l_angle_ll`, signed by the side b lies on now |

A driving dimension's value is a planegcs *sketch parameter* named by the
dimension's ID. The caller passes the evaluated values (mm, degrees; core's
base units) next to the sketch, so a changed value writes one parameter and
re-solves without a rebuild. Driven dimensions and dimensions without a
value are left out and listed as `skipped`.

**Choices read from the geometry.** Which side a tangent joint keeps, which
endpoints a line symmetry pairs, the sign of a horizontal distance and the
side of an angle come from the current coordinates. The document stores
solved coordinates (ADR-0010), so these are stable between solves. The angle
uses only the side (the sign of the cross product), never the nearest
candidate value: choosing the nearest of ±v and ±(180° − v) would make a
new value of 150° on a 30° angle pick the supplement and move nothing.
Tangent is the one choice stored: `tangent` and `smooth` gained an optional
`reversed` field (no format bump, ADR-0010 left room for it).
`tangentReversed(sketch, a, b)` gives P1-06 the value to store when it
creates the constraint; without it the solver reads the side from the
geometry.

**Endpoint joints.** A tangent between curves whose endpoints are joined by
a coincident constraint (directly or through a chain), or where an endpoint
lies on the other curve (`pointOnCurve`), is an `angle_via_point` at that
point, as ADR-0002 found necessary. planegcs's curve normals are the tangent
directions (lines start → end, circles and arcs counter-clockwise) turned by
90°, so the angle is 0 when those directions agree and π when they're opposite.

**Symmetric arcs.** The first mapping mirrored the centres, one endpoint pair
and the radii. planegcs called one of them redundant: mirrored centres plus
one mirrored endpoint already force equal radii. Mirroring both endpoint
pairs plus equal radii is independent (5 equations for the arc's 5 degrees
of freedom); the centres follow.

### 3. Fixed geometry is constants, not equations

`fix` makes the entity's parameters fixed in planegcs (a fixed point's x and
y; a fixed circle's centre and radius; a fixed arc's points and angles,
without `arc_rules`). A fixed entity then has no unknowns, links nothing in
the component split, and is copied into every component that uses it. This
is what keeps a sketch dimensioned from one fixed point in independent
components, as ADR-0002's "anchored" sketches were. The cost: planegcs can't
name a `fix` in a conflict report, because it isn't an equation. `check()`
compensates (§6). A constraint or dimension on fixed geometry only removes
no freedom, so it's reported as redundant without solving.

The sketch has no origin entity yet (ADR-0010), so "anchored" fixtures use a
fixed point. When the projected origin and axes arrive, they should be fixed
entities of this kind.

### 4. Incremental solving per component

`SketchSolver.solve(sketch, values)` takes the whole sketch every call. It
maps it (about 4 ms for 198 entities, warm), splits it into components with
a union-find, and matches each component to an existing system by its
*structure*: the primitives without their coordinate values. Per component:

- **the same input objects as last time** (Immer keeps unchanged ones): no
  work, the cached report and solution are returned;
- **the same structure, other values** (a dimension, an undo, the solution
  written back): the values go into the existing system, which solves
  without re-running planegcs's diagnosis;
- **a new structure** (a constraint added or removed): the system is rebuilt,
  which re-runs the diagnosis for this component only.

Systems of components that disappear are freed. On a failed solve the
component's geometry stays where it was. The result carries the solved
points and circle radii (`applySolution()` writes them into a new
`SketchData`, keeping unchanged entities identical), the DOF over the sketch
and per component, and the conflicting and redundant constraint and
dimension IDs. `stats` counts builds, updates and skips, for tests.

### 5. Dragging

`beginDrag(point)` rebuilds the point's component once with two temporary
`coordinate_x/y` constraints bound to two sketch parameters, starting from
the last solved geometry; `drag(x, y)` sets the two parameters and solves;
`endDrag()` marks the component for a rebuild on the next `solve()`. Only
points can be dragged for now; P1-09 adds curves (a temporary constraint on
a point of the curve). A fixed point can't be dragged.

### 6. Test-solve before committing (`check`)

`check(sketch, values, id)` maps the sketch *with* the new constraint or
dimension, builds the components it touches in a scratch system (the
persistent ones are left alone) and solves. It's accepted if the solve
succeeds and the new ID is neither conflicting nor redundant. A new `fix`
adds no equation planegcs could name, so it's refused if the affected
components report any conflict or redundancy. The UI (P1-06/P1-08) then
refuses the constraint or offers it as driven.

## Measurements

`BENCH=1 pnpm vitest run packages/sketch/src/solver/perf.test.ts` writes
`packages/sketch/bench/results.json`. Node 26, one thread, Ryzen 7 4700U,
milliseconds, medians. The pointer moves off the path the point can follow,
as a real pointer does.

| Sketch | Curves | Components | Open | Drag step (median / p95 / max) | Failed steps | Dimension change | `check`, fits | `check`, conflicts |
|---|---|---|---|---|---|---|---|---|
| Plate, anchored | 198 | 22 | 53 | **0.18** / 0.29 / 3.2 | 0 / 400 | 7.3 | 6.5 | 8.8 |
| Plate, chained | 99 | 1 | 83 | **11.4** / 12.0 / 39 | 0 / 400 | 46 | 82 | 761 |
| Gear, 13 teeth | 52 | 1 | 40 | 116 / 174 / 174 | 0 / 20 | 20 | 37 | 408 |
| Gear, 26 teeth | 104 | 1 | 275 | **953** / 5518 / 5518 | 2 / 20 | 127 | 270 | 11 227 |

"Plate" is the spike's cell (a rectangle, a hole, a slot with tangent arcs;
9 curves), placed from a fixed point (anchored) or from the previous cell
(chained), with the last cell's height free for the drag. "Open" builds and
solves every component from a perturbed start. "Dimension change" includes
mapping the whole sketch. `check` test-solves a constraint that fits (the
dragged point's missing dimension) and one that conflicts (fixing the
dragged point).

In the browser (`#/debug/solver`, dev server, main thread, Chromium): the rectangle-hole-slot cell drags at 0.8 ms per frame, the
198-entity plate at 0.7 ms, the 99-entity chained plate at 12.4 ms, all at
60 fps. The WASM loads in about 20 ms and is 515 KB (187 KB gzipped).

**The criteria hold:** 0.18 ms < 8 ms at 198 entities in 22 components,
11.4 ms < 16 ms for one 99-entity component (little room to spare on
this laptop).

**The gear outline is the finding.** A closed loop of tip and root arcs
joined by flanks, fully constrained except for the tip radius, drags far
worse than its size suggests: about 120 ms per step at 52 curves, about 1 s
(median) and up to 5.5 s at 104 curves, where 2 of 20 steps failed. The chained
plate of the same size drags in 11 ms. The difference is iterations, not
size: with temporary constraints planegcs solves with an SQP whose BFGS
Hessian starts from the identity on every call, and on a coupled loop of
arcs it needs about 30 iterations per step (capping them makes the hard
constraints fail). Opening the gear (275 ms) and dimension changes (125 ms)
are tolerable; the test-solve of a conflicting constraint takes about 11 s,
because planegcs's conflict search re-solves per candidate. Recorded in
the risk register, with mitigations for P1-09: solve drags of large
components in a worker at the latest pointer position; keep the BFGS matrix
between drag steps (a patch in our build); or sparse matrices.

## Rejected options

- **`fix` as `coordinate_x/y` equations** (how the P0-03 spike anchored
  cells). Planegcs could then name a fix in conflicts, but every fixed point would couple what
  is dimensioned from it into one component, which is what per-component
  solving exists to avoid.
- **Re-solving every component on every call.** Simple, but a dimension
  change would cost the whole sketch; comparing input objects is cheap
  because Immer preserves identity.
- **Choosing an angle's quadrant by the nearest value** (see §2).
- **Capping SQP iterations during a drag.** At 15 iterations the gear's
  hard constraints stop converging (steps fail); at 30 nothing is gained.
- **Vendoring planegcs's TS wrapper.** It's LGPL and maintained upstream at
  the version we build; a deep import is enough.

## Consequences

- `@extrudo/sketch` exports `SketchSolver`, `loadPlanegcs`, `applySolution`,
  `mapSketch`, `splitComponents`, `tangentReversed`; `@extrudo/sketch/browser`
  adds `loadSketchSolver()` with the bundled WASM URL; `@extrudo/sketch/fixtures`
  has the builder and generators. The web app depends on `@extrudo/sketch`
  (the debug page only, so far).
- The sketch package's tests need the WASM: `pnpm wasm` (part of `check`)
  fetches it.
- Not done here: wiring the solver into sketch mode (P1-06 onwards),
  per-entity constraint status (P1-08 can refine the per-component DOF),
  dragging curves (P1-09), splines and ellipses (P1-05).
