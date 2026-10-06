# ADR-0032: Primitives

- **Status:** Accepted, 2026-09-28.
- **Task:** P2-10 (Box, cylinder, sphere, torus with placement on a plane
  or face; FR-FT-03). Code: `packages/core/src/primitives.ts` (four
  definitions, inputs schemas, `primitiveNumbers`, `primitiveSettings`,
  `primitiveInputs`), the evaluators
  `packages/kernel/src/features/primitives.ts` (`PrimitiveOutputData`,
  `KERNEL_PRIMITIVES`), the dialogs `apps/web/src/features/primitives.ts`
  (`PRIMITIVE_DIALOGS`, `placementFrame`, `primitiveFrame`,
  `proposePrimitive`, `primitiveManipulators`) registered in
  `featureDialogs()`, plane picking for dialogs
  `apps/web/src/features/planePicker.ts` (`dialogPlanePicker`,
  `dialogPlanePick`, `PlanePicker.selected`, `Origin`'s `selected`), the
  tools in `shell/tools.ts`, the icons `cylinder`, `sphere`, `torus`.
  Tests: `packages/core/src/primitives.test.ts`,
  `packages/kernel/src/features/primitives.test.ts` with the golden table
  `src/features/golden/primitive-options.json`, a primitives loop in
  `src/memory.test.ts`, `apps/web/src/features/primitives.test.ts`,
  `e2e/primitives.spec.ts`.
- **Builds on:** ADR-0005 (naming: `namedPrism`, `namedRevolve`),
  ADR-0027 (dialog framework, `propose`), ADR-0028 and ADR-0029 (the body
  operations, `operate`, `splitSolids`), ADR-0031 (the face frame rule,
  Create Sketch's plane and face picking).
- **Affects:** construction planes (P3-05: a primitive's `plane` takes
  them once they are `plane` references with a frame), P2-11 (primitives
  are inserted through the dialog controller like any feature).

## Context

FR-FT-03 asks for box, cylinder, sphere and torus "as parametric
features", and the roadmap for "placement on a plane or face". Fusion has
one command per primitive, each placed on a plane or planar face with a
sketch-like point and sizes, and a body operation. The OCCT facade already
had `makeBox` and `makeCylinder`, but they return shapes without history,
so their faces would only get positional names; and the facade belonged
to P2-12 this round.

## Decision

### 1. Four feature types, one placement

`box`, `cylinder`, `sphere` and `torus` are feature types of their own
(the tool IDs are the same, so timeline chips show the right icon through
`toolForFeature`). Every input is optional with a default, so `{}` is a
valid primitive:

| Input | Types | Default | Meaning |
|---|---|---|---|
| `plane` | all | XY plane | one `plane` (origin plane) or `face` (flat face) ref |
| `x`, `y` | all | 0 | the centre in the plane's frame |
| `offset` | all | 0 | along the plane's normal |
| `rotation` | box | 0° | about the normal through the centre |
| `length`, `width`, `height` | box | 20 mm | along the frame's X, Y and normal; height may be negative |
| `diameter`, `height` | cylinder | 20 mm | base disc centred on the point; height may be negative |
| `diameter` | sphere | 20 mm | centred on the point |
| `diameter`, `tube` | torus | 40, 10 mm | centred on the point, about the normal; `tube < diameter` |
| `operation`, `bodies` | all | new body, automatic | as extrude's |

**The frame** is the one a sketch on that plane gets: an origin plane's
fixed frame, or `faceSketchFrame(centroid, normal)` for a face (world
origin projected onto the plane; X along world X on floors, Y up walls),
resolved through topological naming on every recompute, so a primitive
on a face follows the face's plane as a sketch does (ADR-0031). X and Y
are measured in that frame, like sketch coordinates. A box and a cylinder
stand on the plane (their base centred on the point, a negative height
going into it); a sphere and a torus are centred on the point (Fusion
places them the same way). `PRIMITIVE_SIZES` and `PLACEMENT_NUMBERS` list
every number with its label, unit, default expression and default value,
shared by the kernel (defaults, positivity checks) and the dialogs (the
fields).

### 2. Solids from named sweeps, no facade change

Each primitive is a planar face from `Kernel.planarFaces` in its frame,
swept by the existing named operations, so every face has a persistent
name and edges and vertices follow (ADR-0005):

| Type | Built as | Face names |
|---|---|---|
| box | prism of a centred rectangle | `box:<id>:cap:start` (on the plane), `cap:end`, `side:front`/`right`/`back`/`left` (the frame's −Y, +X, +Y, −X) |
| cylinder | prism of a disc | `cylinder:<id>:cap:start`, `cap:end`, `side:wall` |
| sphere | a whole turn of a half disc about the normal | `sphere:<id>:side:surface` (the diameter on the axis sweeps into nothing) |
| torus | a whole turn of a circle about the normal | `torus:<id>:side:surface` |

The half disc and the circle lie in the upright half-plane through the
normal (a planar frame whose "normal" is the frame's −Y, so its 2D v runs
along the primitive's normal). Names don't depend on the sizes, the
placement or the rotation (tested). The result goes through the shared
`operate` and `splitSolids` with the words "box"… and "Check its size and
where it sits."; `data: PrimitiveOutputData` has the primitive's frame and
every number's value.

Checks, each with a message: sizes must be greater than 0 ("The length
must be greater than 0."), a height other than 0, a tube thinner than the
torus, a plane that exists, a face that is flat ("The face the box sits on
isn't flat…"); a face that can't be found gets `ctx.resolve`'s usual
message.

### 3. The dialogs

One spec per type (`primitiveDialog(type)`), fields named like the inputs:
Plane; the sizes; X, Y, Offset; Rotation (box); Operation; Bodies. Their
`propose`:

- **Plane:** the XY plane while the field is empty and the user hasn't
  cleared it, so the dialog opens with a live preview. A face selected
  before the tool fills it (pre-selection).
- **X and Y:** a picked face's centre in its sketch frame (from the mesh,
  the fingerprint's `at` until then), 0 on an origin plane; rounded to
  1 µm. They stay once the user sets them.
- **Operation:** new body on a plane; on a face, join, or cut for a box or
  cylinder with a negative height (press-pull's rule, ADR-0028).

`validate` refuses a face the meshes show curved ("Pick a flat face or a
plane."). Manipulators: arrows for a box's length and width and every
diameter from the centre (scale 0.5: they reach the side), height arrows
along the normal from the base, the torus's tube arrow from the ring, and
a box's rotation arc about the normal from the plane's X. Positions have
no handles (typed, or taken from the face).

### 4. Picking a plane into a dialog

While an open dialog's pick field accepts `plane` (a primitive's Plane),
the shell gives the view a `PlanePicker` (`dialogPlanePicker`) instead of
the dialog's model selection: the origin planes show, and the nearer of
an origin plane and a flat face under the pointer takes the click, exactly
as Create Sketch picks (ADR-0031, `sketchTargetAt`); both go into the
field through the controller's `select`, so they are persistent
references with fingerprints. The picked origin plane is drawn highlighted
(`PlanePicker.selected`). Once the user makes another field the pick field
(Bodies), the view picks in the model again. The field shows "XY plane"
for an origin plane.

## Consequences

- Box, Cylinder, Sphere and Torus are live in Solid › Create's menu (no
  keys, as in Fusion). Their chips, edit, suppress and delete work like
  any feature's.
- The kernel suite covers every type and origin plane, placement and
  rotation, negative heights, a cylinder joined on a face that follows the
  face, a pocket cut into a face with named floor and walls, a sphere on a
  wall (join, intersect, new body), the warnings and errors, names that
  survive changes, a primitive on another primitive's face, and a golden
  table (4 types × XY/face × 4 operations: volume, area, bbox, counts,
  validity, names). Update it with `pnpm vitest run -u
  packages/kernel/src/features/primitives` and review the diff. The memory
  loop recomputes four primitives on each other's faces 300 times, flat.
- The facade didn't change.

## Rejected

- **The facade's `makeBox`/`makeCylinder`** (and a new `makeSphere` or
  `makeTorus`): no history, so only positional names that break when the
  size changes; and the facade was P2-12's this round.
- **One `primitive` type with a `shape` enum:** one chip icon and label
  for four things, inputs that mean different things per shape, and
  switching shapes in a dialog isn't something Fusion or users do.
- **A box anchored at a corner** (Fusion draws it from two corners): a
  centred box turns about its centre, is symmetric about the point and
  matches the other three primitives.
- **Placing on the face's centroid** instead of the face's sketch frame:
  the centroid moves whenever the face's outline changes (a notch cut
  earlier moves the primitive); the sketch frame depends only on the
  plane (ADR-0031). The dialog proposes the centroid as numbers instead.
- **Picking planes in the model selection** (origin planes as pickable
  items everywhere): the planes are only drawn when asked for, and Create
  Sketch's picker already resolves plane-versus-face under the pointer.
- **Reporting the primitive's frame to the UI** (like a sketch's
  `SketchReport`): the dialog computes the same frame from the meshes of
  the bodies it shows, before and while editing.

## Open

- ~~Position handles (drag the centre in the plane), and a click point on
  the face as the centre instead of the face's centroid.~~ Done 2026-10-06
  (amendment below).
- ~~Construction planes (P3-05) as `plane` references with frames.~~ Done in
  P3-05 (`planeOf`, ADR-0040).
- The dialog's Plane field keeps the origin planes on screen while it is
  the pick field, even after a plane is picked.
- ~~Fusion's torus position option (inside / on centre / outside)~~ Done
  2026-10-06 as `axis` and `seat` (the amendment below; Fusion's inside /
  outside, which resizes the ring around the point, stays deferred).

## Amendment 2026-10-06: placement by handle and click (P4-12)

No kernel, facade, schema or file-format change; all in `apps/web/src/features/`.

- **Position handles.** `positionManipulators` (in `primitives.ts`) appends
  three `distance` arrows to every type's handles: `x` from the plane's origin
  along the plane's sketch-frame X, `y` from there (the foot at X) along the
  frame's Y, and `offset` from the centre point on the plane up the normal.
  A `distance` arrow's value is the distance from its origin, so the chain is
  how all three can stay ordinary arrows with no new manipulator kind; the
  chain's last head is the primitive's base centre, where the size arrows
  start. The frame is `placementFrame` (origin plane, construction plane or the
  face's sketch frame), so a tilted plane works. A head that lands on an
  earlier one of the three gets `lift` (14 px, 28 for a third); the overlay's own
  near-head lift covers the size heads. The sizes' handles are unchanged and
  come first in `data-manipulators`.
- **Click to place.** `placeAt` on every primitive spec (`primitivePlaceAt`):
  the click on the picked plane or face sets X and Y to the point in the plane's
  frame (three decimals, as the hole's) and, as for the hole, the click adds the
  plane rather than toggling it. A face click no longer centres the primitive on
  the face's centroid; the centre is still what is proposed when a face is
  picked some other way (selected before the tool, the pick field's own button).
- **A box from two corners.** The Box dialog's "Two corners" button
  (`primitiveCorners.tsx`, `spec.extra`; its state `cornersStore`, like the
  canvas's calibration) arms the next two clicks on the box's plane: they stay
  out of the plane field (`placeAtOnly`) and set X and Y (the centre), Length
  and Width, as `N mm` strings to 0.01 mm (an unambiguous unit, as Calibrate
  writes `width`). The first corner is drawn with the calibration marks
  (`[data-corners]` = `off`, `0`, `1`); the second disarms. Height stays; **a
  turned box is put back to 0°** (the sides are measured on the plane's own
  axes), and a pair that doesn't differ by 0.01 mm in both directions makes no
  box: the panel says why and waits for a new first corner. Esc with focus in
  the dialog disarms (not the dialog); the button toggles too.
- **Rejected:** a delta-based move arrow (a `distance` handle writes the
  distance from its own origin, and a new manipulator kind is more machinery
  than a chain of three arrows needs).
- ~~**Still deferred:** the torus placement options (inside / on centre /
  outside), the roadmap bullet keeps them.~~ Done in the amendment below.

## Amendment 2026-10-06: torus placement options (P4-12)

Two optional `enum` inputs on `torus` alone; a file without them reads and
computes exactly as before, and the face name stays
`torus:<id>:side:surface`.

- **`axis`** — `normal` (the default: the ring's axis along the plane's
  normal, the ring flat in the plane, as it always was), `x` or `y`: the
  axis along the plane frame's X or Y, so the ring stands on edge, seen
  from above as a bar. The kernel picks the revolve's frame from the
  choice (its normal is the axis; the circle is drawn along the frame's X,
  or Y when the axis is that one), so it is still a whole-turn
  `namedRevolve` of a circle and a proper torus surface.
- **`seat`** — `centre` (the default: the ring's centre on the point) or
  `plane`: the torus rests on the plane, its circle's centre lifted along
  the normal by the tube's radius (`tube / 2`) with the axis along the
  normal, by `diameter / 2 + tube / 2` with the axis in the plane, so the
  torus's lowest point is the frame's origin and `offset` still adds on
  top.
- **The dialog** has an Axis select (Normal / X / Y) and a Seat select
  (Centre / On the plane) after the sizes; its `toInputs` stores the two
  only when they aren't the default. The position handles are unchanged —
  the Offset arrow still measures `offset` from the plane point, which is
  the seat's base when it rests on the plane — and the two ring arrows
  (Diameter from the centre, Tube from the ring) follow the axis (along
  the frame's X, or its Y when the axis is X) and start at the lifted
  centre.
- **Tests:** the kernel checks the surface's exact geometry
  (`Kernel.surfaceGeometry`: a torus whose axis is the plane's X or Y, the
  radii as entered, the centre at the seat's lift) and the tight box it
  gives (the shape's own box is that within OCCT's 1e-7 shape tolerance);
  `e2e/primitives.spec.ts` sets Axis X and Seat "On the plane" and reads
  `Body1:1:10,50,50` (one face; the default 40/10 torus on XY). The golden
  table grew four rows (`torus axis x/y`, `torus seat plane`, `torus axis
  x seat plane`); the diff is additions only. No facade change.
- **Rejected:** Fusion's inside / outside position (the ring resized
  around the point, inside the tube) — `seat: 'plane'` covers resting the
  torus, and inside/outside changes what `diameter` means, which the
  templates and files rely on.
