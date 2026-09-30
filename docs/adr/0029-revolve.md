# ADR-0029: Revolve

- **Status:** Accepted, 2026-09-28.
- **Task:** P2-07 (Revolve; FR-FT-02). Code: `packages/core/src/revolve.ts`
  (definition, inputs schema, `revolveSettings`, `revolveInputs`), origin
  axes in `packages/core/src/sketch/planes.ts` (`ORIGIN_AXES`,
  `originAxis`, `originAxisRef`), the input pieces extrude and revolve
  share in `packages/core/src/feature-inputs.ts` (`BODY_OPERATIONS`,
  `enumInput`, `exprOf`, `refsOf`); the evaluator
  `packages/kernel/src/features/revolve.ts` (`RevolveOutputData`), the
  modules moved out of `extrude.ts` (`features/sources.ts`,
  `features/operation.ts`, `features/vec.ts`), `SketchOutputData.lines`
  in `features/sketch.ts`; the dialog `apps/web/src/features/revolve.ts`
  registered in `featureDialogs()`, `axisLine`/`sketchLine` in
  `features/geometry.ts`, the angle arc's `scale` and `fullTurn`
  (`features/spec.ts`, `DialogOverlay.tsx`, `unwrapAngle` in
  `manipulate.ts`), pre-selection into several fields (`features/dialog.ts`),
  origin-axis picking (`PickScene.axes`, `nearAxes` in
  `selection/pick.ts`; `originAxes` in `viewport/Viewport.tsx`) and
  highlighting (`AxisHighlight` in `viewport/Origin.tsx`). Tests:
  `packages/core/src/revolve.test.ts`,
  `packages/kernel/src/features/revolve.test.ts` with the golden table
  `src/features/golden/revolve-options.json`, `src/memory.test.ts`,
  `apps/web/src/features/revolve.test.ts`, `selection/pick.test.ts`,
  `features/manipulate.test.ts`, `e2e/revolve.spec.ts`.
- **Builds on:** ADR-0005 (§6 named the recipe: `namedRevolve`, an edge
  axis from `ctx.resolve` + `describe`), ADR-0024 (engine, dependency
  hashing on `<feature>/…` references), ADR-0025 (profile faces and their
  edge sources), ADR-0026 (model picking), ADR-0027 (dialog framework),
  ADR-0028 (extrude: the shape of the inputs, the operations).
- **Affects:** sketches on faces (P2-09: an axis line is placed by its
  sketch's output frame, not by `originPlane`), bodies (P2-08: the body
  operations moved to a shared module), construction axes (P3-05: `axis`
  references with their own IDs), circular patterns (P3: the same axis
  kinds).

## Context

FR-FT-02 asks for a revolve "around a sketch line, origin axis or
construction axis", with a full or partial angle. Extrude (ADR-0028) had
just set the shape of a solid feature: optional inputs with shared
defaults, profiles or flat faces unioned into one source, the four body
operations with automatic participants, preview tools, names for every
face. Origin axes and sketch lines weren't pickable in the model yet
(ADR-0026's open item), and construction axes arrive with P3-05.

## Decision

### 1. Inputs

`revolveFeature` (type `revolve`, core) validates:

| Input | Kind | Default | Meaning |
|---|---|---|---|
| `profiles` | `ref`: `profile` or `face` | none (error) | what to turn; all in one plane |
| `axis` | `ref`: one `axis`, `sketchEntity` or `edge` | none (error) | what to turn about; in that plane |
| `direction` | `enum` `one-side` / `symmetric` / `two-sides` | `one-side` | |
| `angle` | `expr`, angle | 360° | side 1; the **whole** angle when symmetric; negative turns the other way |
| `angle2` | `expr`, angle | 0 | side 2 of `two-sides`, the other way round |
| `flip` | `bool` | false | reverses the axis |
| `operation` | `enum` `new-body` / `join` / `cut` / `intersect` | `new-body` | |
| `bodies` | `ref`: `body` | automatic | participants, as for extrude |

The minimal revolve is `{ profiles, axis }`: a whole turn, a new body.
There is **no "full" extent**: 360° is a whole turn (the facade treats
|angle| ≥ 2π as one, with no end faces), so a separate choice would only
duplicate it; a future "to object" extent can come as an optional input
without a format bump (ADR-0003). `revolveSettings` fills the defaults
for the kernel and the UI; `revolveInputs(profiles, axis, options)` builds
inputs for tests and scripts. `BODY_OPERATIONS`, `enumInput`, `exprOf` and
`refsOf` moved from `extrude.ts` to `feature-inputs.ts`
(`EXTRUDE_OPERATIONS` is now an alias).

### 2. Axes

- **Origin axes** are `{ kind: 'axis', id: 'origin:x' | 'origin:y' |
  'origin:z' }`, like the origin planes' `origin:xy` (`ORIGIN_AXES` in
  core, labels "X axis"…). Construction axes (P3-05) will be `axis`
  references with their own IDs.
- **Sketch lines**, construction or not, are `sketchEntity` references
  `<sketch>/<line>`: the ID starts with the sketch's, so the engine's
  dependency hashing (`featureDependencies`) sees the sketch and a sketch
  edit recomputes the revolve. The kernel places the line with the
  sketch **output's** frame and a new `SketchOutputData.lines` table
  (every line's end points in sketch coordinates, construction lines
  too), never with `originPlane`: a sketch on a face (P2-09) knows its
  frame only in its output. The direction runs from the line's start to
  its end.
- **Straight edges** of bodies are resolved with `ctx.resolve` (label
  "the edge to revolve about") and `describe`: the midpoint and the
  line's direction (a canonical sign: first non-zero component positive).
  Circles and other curves are refused.

Side 1 turns right-handed about the axis direction (counter-clockwise
seen from its tip); Flip reverses the direction. A user who gets the
wrong way round flips, as in Fusion; the arc in the view shows the way.

### 3. What may be turned

The profiles are the extrude's (§2 of ADR-0028): profile references and
flat faces (press-pull style, `side:(<edge name>)` names), united into one
source. Two checks come before the sweep:

- **The axis lies in the profiles' plane** (direction square to the
  normal, a point on it within 1e-6 mm): "The axis doesn't lie in the
  profile's plane. Pick an axis in that plane." An axis off the plane
  (parallel to it or not) can make valid solids, but whether the sweep
  passes through itself then depends on more than a side test; Fusion and
  most CAD refuse it too.
- **Every profile lies on one side of the axis**, touching at most: each
  part's area inside a half-plane face on the axis's positive side
  (`boolean('common')` with a big rectangle from `planarFaces`) must be
  all or none of it (to 1e-7 of its area). A part on both sides is "The
  profile crosses the axis. Pick an axis beside the profile, not through
  it."; parts on different sides are "The profiles lie on both sides of
  the axis. Pick profiles on one side of it." A profile whose edge lies on
  the axis (a cylinder, a cone) passes; the edge sweeps into nothing.

OCCT's `MakeRevol` refuses some crossing profiles on its own ("the
profile probably crosses the axis"), but not all, and not a partial turn;
the area test is exact for every curve type.

### 4. Angles and the sweep

- **One side:** from the profile by `angle` (default 360°), |angle| ≤ 360°,
  not 0.
- **Symmetric:** half of |angle| each way.
- **Two sides:** side 1 by `angle`, side 2 by `angle2` the other way; each
  within ±360°, their sum positive ("The two sides cancel each other out…")
  and at most a whole turn ("The two sides add up to more than a full
  turn…"). A negative side reaches back past the profile, as a negative
  extrude distance does.

A turn that **doesn't start at the profile** (symmetric, two sides) is
built as **one sweep from the profile turned to its start**: the profile
is revolved by the start angle, the `last` faces of that sweep become the
source (a compound when there are several), and their edges take the
source edges' names through the `last` edge records and `locate`. The
real sweep then turns from there by the whole angle. The result has one
face per profile edge and its caps where it starts (`cap:start`) and ends
(`cap:end`), named exactly like a one-sided revolve, so changing the
direction or the angles keeps every name. The turned face is reversed
(the end cap faces the other way); OCCT sweeps it into a valid solid of
positive volume all the same (checked in the tests). A whole turn always
starts at the profile: it has no caps, and its seam doesn't name
anything.

### 5. Operations and output

The body operations are extrude's, moved unchanged into
`features/operation.ts` (`operate`, `newBodies`, `explicitBodies`) with
the feature's words as a parameter (`{ noun: 'revolve', check: 'Check
its axis and angle.' }` in messages, `revolve` as the boolean faces'
`op`); `sources.ts` has the profile and face sources and `vec.ts` the
vector helpers. Extrude's behaviour, messages and golden table didn't
change. Join, cut and intersect return the tool as `previewTools`.

`data: RevolveOutputData` has the profiles' centroid (`origin`), the axis
as turned about (`{ origin, direction }`, flipped), the side `angles` in
degrees and `full`.

### 6. Picking axes in the model

The origin axes are pickable in model mode wherever they are drawn
(ADR-0026's open item): `PickScene.axes` lists the visible ones (the
viewport's `origin` settings `x`, `y`, `z`) as segments as long as the
grid reaches (`GRID_RADIUS × view size` each way); `nearAxes` picks them
by the ray's closest approach within 6 px, like edges, under the
`construction` filter kind, **after** vertices, edges and sketch curves
(a sketch line on an axis is the more specific pick) **and after profiles
and faces**: the axes run through the model, and a click on a profile
the Z axis passes behind must take the profile (found by P2-09's e2e
test after the merge). Over a face, an axis is offered by "Select
other…"; an axis field's filter leaves faces and profiles out, so there
the axis is picked directly. Hidden axes are offered last. Boxes never take them. `Origin.tsx` draws a hovered or
selected axis as a thick accent line over the grid's (`AxisHighlight`);
"Select other…" names them "X axis"…; the session's hover of an axis is
cleared with the other picked kinds. Sketch lines were already pickable
(`<sketch>/<entity>`). The changes to `pick.ts` are additive (a new
scene field, a new function, one line in `pickStack`); `pointer.ts`
didn't change.

While a dialog is open, the sketches now show the dialog's picks as
selected (profiles and a revolve's axis line), not the session's.

### 7. The dialog

`revolveDialog`'s fields are named like the inputs (the framework's
default mapping): Profiles, Axis (one pick; "Y axis" for an origin axis,
"1 sketch curve"/"1 edge" otherwise), Direction, Angle (360 deg), Angle 2
(two sides, 90 deg), Flip, Operation, Bodies. Its own check refuses a
picked sketch curve that isn't a line ("Pick a straight line for the
axis."); everything else is the kernel's to say through the preview.
`propose`: profiles propose a new body, faces of a body join (a face
turned about one of its edges grows its body).

**Pre-selection into several fields** (framework change): the selection
fills the first field that takes it, as before, and what that field
doesn't take goes on to the next shown fields that take it, each item
into one field. Select a profile and an axis, press Revolve, and both are
filled. Extrude is unaffected (its other selection fields are hidden by
default).

**Arcs:** one angle arc about the axis (flipped with Flip) through the
foot of the profiles' centre on it, starting towards the centre; side 2
has its own arc about the reversed axis; the symmetric arc has the new
`AngleManipulator.scale` 0.5 (the handle at half the whole angle, like
the symmetric extrude arrow). Revolve arcs set the new `fullTurn`: a
drag follows the handle round (`unwrapAngle`: the value congruent to the
reading nearest the last one, within ±360°) instead of wrapping at
±180° as taper arcs do.

## Consequences

- The Revolve tool is live (Solid › Create, no key, as in Fusion). The
  shell's and the commands' "arrives with" examples moved to Shell
  (P3-03).
- `revolve.test.ts` covers full and partial turns (volumes against
  formulas, the way round, flip, symmetric, two sides), profiles with an
  edge on the axis (cylinder, cone), sketch-line axes (construction,
  drawn backwards, from another sketch on another plane), a body edge as
  the axis and a face turned about its edge (join), join/cut/intersect
  with previews and the warning, several profiles, every error message,
  names that survive an angle change and a fillet on a revolve's edge.
  The golden table (`golden/revolve-options.json`, 36 cases: direction ×
  operation × 90°, −60°, 360°, a groove about Z half inside a block;
  volume, area, bbox, counts, validity, the revolve's face names) is a
  file snapshot: update with `pnpm vitest run -u
  packages/kernel/src/features/revolve` and review the diff.
- `memory.test.ts` recomputes a block with a symmetric groove cut about
  Z, a two-sided ring about a construction line and a face turned about
  an edge (join) 300 times after a warm-up through every angle, **from
  an empty cache each run**, with a flat heap. With the engine's cache
  kept between runs, the heap top moves by 16 MB every few hundred runs:
  OCCT 8's booleans and mesher grow their incremental allocator's blocks
  up to 16 MB, and cached shapes that stay alive split the freed block,
  so the next request extends the heap. Cleared each run (and in loops of
  the bare kernel ops: planar faces, partial and full revolves, the turned
  start face, half-plane `common`, meshing a revolve or a joined block)
  nothing grows, so it is fragmentation, not a leak. It is worth
  watching in long sessions (see Open).
- The facade didn't change (its `revolve` with history and the
  `Revol().Shape` fix were ADR-0005's).

## Rejected

- **Two revolves fused** for symmetric and two-sided turns (as tapered
  two-sided extrudes are two prisms): a boolean per revolve, names that
  depend on whether OCCT merges the halves' faces (`side2:` or not), and
  a seam face in the profile plane to get rid of. Turning the profile to
  its start first costs one cheap sweep and gives one-sided names.
- **A transform op in the facade** to rotate the profile: the task was
  to leave the facade alone, and the end face of a revolve is the
  rotated profile, with history.
- **A "full" extent** beside the angle: 360° says the same (§1).
- **Axes off the profile plane:** see §3.
- **Sampling the profile's edges** (mesh polylines) for the one-side
  check: misses shallow crossings of arcs and splines; the half-plane
  overlap is exact.
- **Placing sketch-line axes with `originPlane`:** breaks for sketches on
  faces (P2-09).
- **Picking origin axes in boxes:** a box around a part would take the
  axes through it.

## Open

- Heap fragmentation with the engine's cache (Consequences): measure a
  long editing session in the browser; if the WASM heap keeps growing,
  cap OCCT's incremental allocator blocks or trim the cache harder.

- Construction axes (P3-05) as `axis` references; the kernel says "Can't
  find the axis…" for anything but the origin axes today.
- Revolve "to object" (Fusion's "To"), and an angle measured from a
  reference other than the profile.
- The field names a sketch-line axis "1 sketch curve"; "Line · Sketch1"
  would read better (all selection fields could name single picks).
- Origin axes are pickable only while drawn; showing them while an
  axis field takes picks (as Create Sketch shows the planes) would help
  when they are hidden.
- The arc starts at the axis; for large profiles an arc through the
  profile's centre would be easier to grab.
- The press-pull style proposal for faces is only "join"; a face turned
  into its body should propose a cut (the way extrude's rule does). Done in
  P3-08: one rule for both, ADR-0051 §7.
