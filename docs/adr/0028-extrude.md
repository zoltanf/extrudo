# ADR-0028: Extrude

- **Status:** Accepted, 2026-09-28. Written in two steps: the kernel and
  document part (§1–6), then the UI part (§7–10: dialog, manipulators,
  press-pull, bodies in the browser, template).
- **Task:** P2-06 (Extrude; FR-FT-01). Code: `packages/core/src/extrude.ts`
  (definition, inputs schema, `extrudeSettings`, `extrudeInputs`),
  `packages/kernel/src/features/extrude.ts` (the evaluator,
  `ExtrudeOutputData`), the facade's `prism(…, taper)`, `distance` and
  solids (kind 3) in `packages/kernel/occt/facade/extrudo_facade.cpp`,
  `Kernel.prism`/`distance`/`solids` in `packages/kernel/src/kernel.ts`,
  `SweepRoles` in `src/naming/names.ts` and `PrismOptions.taper`/`roles` in
  `src/naming/ops.ts`, `FeatureOutput.previewTools` in
  `src/recompute/types.ts`. Tests: `src/features/extrude.test.ts` with the
  golden table `src/features/golden/extrude-options.json`,
  `src/memory.test.ts`, `packages/core/src/extrude.test.ts`. UI step:
  `apps/web/src/features/extrude.ts` (the dialog spec, `proposeOperation`,
  `extrudeManipulators`) registered in `featureDialogs()`, the framework's
  new `propose` hook and `OpenDialog.chosen` (`features/spec.ts`,
  `dialog.ts`, `values.ts` `changedFields`/`pickFields`), the arrow's
  `scale` (`spec.ts`, `DialogOverlay.tsx`), `apps/web/src/shell/bodies.ts`
  (the browser's bodies), `data-bodies` on the Viewport region, the Wall
  bracket template (`project/templates.ts`, `profilesOf`). Tests:
  `features/extrude.test.ts`, `shell/bodies.test.ts`,
  `project/templates.test.ts` (the template through the real kernel),
  `e2e/extrude.spec.ts`.
- **Builds on:** ADR-0003 (strict schema, optional fields need no format
  bump), ADR-0004 (expressions with units), ADR-0005 (naming operations,
  §6 was the recipe), ADR-0024 (engine, cache, `strictLeaks`), ADR-0025
  (profile faces and their edge sources).
- **Affects:** the extrude dialog and manipulators (P2-06 UI step, on the
  P2-05 dialog framework), revolve (P2-07: same shape of inputs and
  operations), later features that end "up to" an object or pick
  participant bodies (hole, P3).

## Context

Extrude is the first feature that makes bodies. FR-FT-01 asks for profiles
or planar faces, three directions (one side, symmetric, two sides), three
extents (distance, to object, through all), a taper, and four operations
(new body, join, cut, intersect); the roadmap asks for kernel golden tests
of every combination. The document must stay the source of truth
(numbers are expressions, references are persistent names), every face the
extrude makes must be named for later references, and the dialog, which
another agent is building in parallel (P2-05), needs a preview of the
tool before it joins or cuts.

## Decision

### 1. Inputs

`extrudeFeature` (type `extrude`, core) validates:

| Input | Kind | Default | Meaning |
|---|---|---|---|
| `profiles` | `ref`: `profile` (`<sketch>/<region>`) or `face` | none (error) | what to sweep; all in one plane |
| `direction` | `enum` `one-side` / `symmetric` / `two-sides` | `one-side` | |
| `extent` | `enum` `distance` / `to-object` / `through-all` | `distance` | side 1 (and symmetric) |
| `distance` | `expr`, length | — | side 1; the **whole** length when symmetric; negative goes back |
| `toObject` | `ref`: one `face`, `vertex` or `plane` | — | side 1's object |
| `taper` | `expr`, angle | 0 | side 1, degrees; positive widens along the sweep |
| `extent2`, `distance2`, `toObject2`, `taper2` | as above | as above | side 2 of `two-sides` only |
| `flip` | `bool` | false | side 1 against the plane's normal |
| `operation` | `enum` `new-body` / `join` / `cut` / `intersect` | `new-body` | |
| `bodies` | `ref`: `body` (body IDs) | automatic | participants of join, cut, intersect |

Everything but `profiles` is optional so the minimal extrude is
`{ profiles, distance }`, and inputs a direction doesn't use are ignored,
not refused: a dialog keeps side 2's values while the user switches
between one and two sides. `extrudeSettings(inputs)` fills the defaults
(the kernel and the UI read the same ones); `extrudeInputs(profiles,
options)` builds inputs from plain options (tests, scripts). Units are
checked by the schema (`distance` must be a length, `taper` an angle);
cross-field rules (to-object needs an object) are the evaluator's, so they
come back as the feature's status in the user's words, not as schema
errors. `paramName`s are the caller's, as for every feature.

**Old documents.** The Wall bracket template's extrudes (`distance` and
`taper` only, no profiles) are valid under this schema, so the document
loads unchanged and the feature fails with "Pick at least one profile or
face to extrude." until the UI step rewrites the template. The template
was never released and has no stored copies that matter; no migration.

### 2. What gets swept

Profile references read `ctx.output(sketch).shapes[region]` and the
region's `edges` (sketch curves) from `SketchOutputData`; face references
are resolved (`ctx.resolve`, label "the face to extrude"), must be planar
("Can only extrude flat faces…") and become sources through
`faceEdgeSources`, so press-pull sides are `extrude:F:side:(e[…])`. The
direction is the first reference's plane normal (the sketch frame's, or
the face's outward normal), reversed by `flip`. All references must lie in
one plane.

Several sources are **fused into one** first (a 2D boolean, simplified),
carrying edge sources through the fuse's history. The ADR-0005 recipe
swept a compound, but two profiles sharing an edge (a region split by a
line, a ring and the disc inside it) then become two solids with a face
between them, and a taper would lean their shared wall both ways. The
union sweeps as the user sees it: one face per outer curve.

### 3. Extents

- **Distance:** signed along the side's direction; 0 is an error.
- **Symmetric:** half the distance each way; to-object is refused ("Use
  two sides instead").
- **Two sides:** the extrude spans from −`distance2` to `distance` along
  the normal; they may be negative as long as the span is positive.
- **Through all:** just past the farthest corner of the participants'
  bounding boxes (all bodies when automatic) along the side, plus 5 % (at
  least 1 mm). Nothing ahead is an error ("Flip the direction…"), and so
  is through all with no bodies.
- **To object:** an origin plane, a flat face (resolved like any face
  reference) or a vertex (the plane through it square to the extrude).
  Parallel to the profile, it is an exact distance; on one side an object
  behind the profile turns the side round (flip is ignored). An
  **inclined** face is reached by sweeping past it everywhere and
  trimming there: `common` with a big box on the profile's side whose face
  in the plane is named `cap:end` (side 2: `cap:start`), so the trimmed
  end is named like any end. An object that cuts through the profile, that
  lies behind a side of a two-sided extrude, or that the extrude runs
  alongside is refused with its own message. Curved faces and bodies as
  objects are not supported yet.

### 4. Taper: `BRepOffsetAPI_DraftAngle` in the facade

`prism(shape, shift, vector, taper)` sweeps straight, then tilts every side
face (the faces the profile's edges generate) about its edge in the start
plane, `DraftAngle` with the start plane as neutral plane. The history is
the straight sweep's carried through the draft (`ModifiedShape`, since
DraftAngle reports tilted faces as *generated*), so `nameSweep` names a
tapered extrude exactly like a straight one. Positive widens the outline
along the sweep, negative narrows it; holes do the opposite. Planes stay
planes, circles and arcs become cones; ellipse and spline sides are
refused ("Can't taper sides made from ellipses or splines yet").

DraftAngle tilts sides past each other without complaint, and the result
can even pass `BRepCheck`. `taperHolds` therefore also checks that every
straight end-cap edge runs the same way as its profile edge and that no
cone has its tip before the end; failing either is "The taper is too steep
for this distance: the sides meet before the end." (Conservative: an edge
that would merely vanish, which Fusion allows, counts as too steep.)

A taper grows away from the sketch plane on both sides, so a tapered
**symmetric or two-sided** extrude is two prisms from the plane, fused
with simplify: side 1 named as usual, side 2 with roles (`SweepRoles`)
`side2:<source>` and `cap:start` for its far end (its face in the plane
disappears in the fuse). Opposite tapers on the two sides make one plane,
and simplify merges it back into `side:<source>`; cones stay two faces.
Without a taper, symmetric and two-sided extrudes stay one prism with a
shift (ADR-0005 §6), so their sides are single faces.

### 5. Operations and participants

- **New body:** one body per separate solid (`Kernel.solids`), IDs
  `ctx.bodyId(n)` in geometric order (by bounding-box centre), each with
  its share of the naming table (face names from the whole, edges and
  vertices derived again).
- **Join:** the participants are the bodies the tool touches
  (`Kernel.distance` ≤ 0.1 µm, which counts a tool standing on a face and
  one inside a solid); they are fused into the first, simplified, and the
  others disappear from the body set. Nothing to touch makes a new body
  with a warning ("Nothing to join to, so the extrude made a new body.").
- **Cut:** each participant minus the tool (not simplified, as in
  ADR-0005). A body whose volume doesn't change is left as it was (same
  handle, same names); a body cut away completely is removed with a
  warning; nothing changed at all is an error ("The cut doesn't touch any
  body" / "doesn't remove anything").
- **Intersect:** each participant keeps the overlap; an automatic
  participant it only touches is left alone, an explicit one that would
  vanish is an error, and no overlap at all is an error.
- **Explicit `bodies`** replace the automatic choice; a missing body is an
  error ("One of the bodies to cut no longer exists…").

Press-pull needs nothing special: a face pushed out of its body touches
it and joins by default; pulled into it, it cuts it. Which operation the
dialog proposes (join outwards, cut inwards) is the UI's decision.

### 6. Output

`bodies` and `names` as ADR-0005; `data: ExtrudeOutputData` with the
profiles' area centroid (`origin`), side 1's unit `direction`, `extents`
(how far each side reaches along the line through `origin`, side 2
against the direction) and `tapers` in degrees, for the manipulators; and
for join, cut and intersect `previewTools: [{ shape, style }]`, the swept
tool before the boolean. `previewTools` is new in `FeatureOutput`
(contract with P2-05, which meshes them for previews); the engine counts
their handles as the entry's like `shapes` (`outputHandles`), so they are
reference-counted, evicted with the entry and not reported as leaks.

### 7. The dialog

`extrudeDialog` is a P2-05 spec whose **fields are named like the
inputs**, so the framework's default mapping makes the inputs and reads
them back (no `toInputs`/`fromInputs`); an old extrude without options
opens with the defaults. Profiles (`profile`, `face`), Direction, Extent,
Distance (shown for a distance), To object (one face, vertex or plane;
shown for to-object), Taper, then for two sides Extent 2, Distance 2 /
To object 2 and Taper 2, Flip, Operation, and Bodies (`body`, optional,
"Automatic" while empty; shown unless the operation is a new body).
Hidden fields make no input but keep their values while the dialog is
open, which §1's "unused inputs are ignored" allows without extra care.
Taper always makes an input (`0 deg`, a model parameter like the
distance), so editing it later needs no field that appears. The only
check of its own is symmetric + to-object (the kernel's message, shown
at once under Extent); everything else is the kernel's to say, through
the preview. The dialog scrolls its fields when it is taller than the
view (two sides).

### 8. Manipulators

Before and after a kernel result alike, the arrow starts at the mean of
the picks' centroids (`profileFrame`, `faceFrame`) along the first pick's
normal, reversed by Flip: the same direction the kernel takes (§2).
One **distance arrow** per side that ends at a distance (side 2 against
the normal); the symmetric arrow has `scale: 0.5`, a new optional field
of `DistanceManipulator`: the head sits at half the value (where the
extrude ends) and a drag writes twice the distance. One **taper arc** per
side at the end of that side (at the profile for to-object and through
all), opening from the way the side goes (back, for a negative
distance) towards a fixed in-plane direction, so a positive angle leans
outwards: it widens, as the kernel does. `ExtrudeOutputData` isn't
exposed to the UI thread (previews return meshes only); the frames agree
with it for flat profiles, and nothing needed it.

### 9. Press-pull: the proposal rule

A feature spec may now **propose values** (`propose(values, ctx)`):
the controller calls it on every change, after the draft's expressions
are evaluated, and applies the proposal to every field the user hasn't
set, then rebuilds the draft before it is checked and previewed. A field
counts as set once the user changes it in the dialog (`chosen`). For an
edited feature, the first refresh counts the stored values that differ
from the proposal as set: an operation the rule would have given stays
automatic, one the user picked stays put, and opening a dialog never
changes a feature by itself.

Extrude's rule (`proposeOperation`): **profiles propose a new body**;
**faces** propose **join** when side 1 goes out of the face's body and
**cut** when it goes in: the sign of the distance times Flip (through
all: Flip alone); symmetric goes both ways and joins; to-object and a
distance that doesn't evaluate (or is 0) propose nothing, keeping the
last proposal. So dragging a face's arrow into its body turns the
preview red, and automatic participants (§5) pick up the face's own
body. Sketches on faces (P2-09) should extend it: a profile on a body's
face behaves like the face.

### 10. Bodies in the document and the template

New bodies still get **no `doc.bodies` entry** when they are made (P2-08
decides naming, colours and "Remove"). The browser's Bodies folder now
lists the model's live bodies (`bodyEntries`), in timeline order (the
`<feature>:<n>` ID), named from `doc.bodies` when there is an entry and
"Body1", "Body2"… (skipping names in use) otherwise; the view gets the
same names (selection labels, `data-bodies`). The first use of a body's
eye stores its metadata with the shown name (`updateBody` upserts).
Metadata of bodies that no longer exist is kept but not listed.

The **Wall bracket template** now computes: Sketch1's L (from
`detectProfiles` at build time, so region IDs are the kernel's) is
extruded **symmetric, `width` (d1)**, centred on the XZ plane; Sketch2's
two holes (moved to y = ±20 mm, inside the 80 mm width) are **cut `wall
* 5` (d3) up with a `tilt / 3` (d2) taper**, so they widen towards the
top. The cut keeps Extrude1's body ID, so `doc.bodies` names it
"Bracket" (`<Extrude1>:0`). Fillet1 (no evaluator) is the one error;
Plane1 stays rolled back. The taper moved from Extrude1 to the holes: a
5° taper on an 80 mm L either widens its 2.4 mm walls to 17 mm or is
too steep. `templates.test.ts` recomputes the template with the real
kernel (one body, 40 × 80 × 60 mm, 10 faces).

## Consequences

- Every combination of direction × extent × operation × taper (0, −5°,
  +5°) runs through the engine in `extrude.test.ts` and is compared with
  `golden/extrude-options.json` (volume, area, bbox, face/edge/vertex
  counts and the extrude's face names per body): 108 cases, 12 of them the
  symmetric to-object error. Rewrite it with `pnpm vitest run -u
  packages/kernel/src/features/extrude` and review the diff. Focused tests
  check volumes against formulas (prisms, frustums of cones and of a
  rectangle, holes), names, press-pull, inclined to-object, through all,
  explicit participants, the warnings, the preview tool and every error
  message; a fillet on an extrude's edge survives a sketch edit, tapered
  or not.
- `memory.test.ts` runs the new facade ops 1000 times (tapered sweeps of a
  plate with a hole and a slot, a too-steep failure, distances, solids)
  and real extrude features through the engine 300 times with a flat
  heap; the native harness showed 0 bytes of growth between 300 and 1500
  iterations.
- The facade changed: the OCCT input hash is now `cfdcd0070c9c` (built
  locally with `pnpm occt build`; CI publishes the release on push).
- A join or cut keeps a second shape per extrude alive in the cache (the
  preview tool). Cheap for Phase 2 models; drop it from recomputes (only
  previews need it) if memory shows up.
- The Extrude tool is live (E, Solid › Create); `featureDialogs()` has
  its first spec. The debug page `#/debug/dialog` registers the app's
  dialogs plus the test press-pull, and keeps the framework's e2e
  tests (a toggle that shows a field, a custom input mapping, an angle
  arc on a ready-made box); Extrude's own run in a real project
  (`e2e/extrude.spec.ts`: a profile with a hole, press-pull out and in,
  undo/redo, editing to two sides; the template's cut edited to through
  all).
- The Viewport region has `data-bodies` ("Body1:7:60,40,15": name, face
  count, bounding-box size in mm) for tests.
- The template's timeline no longer allows deleting Sketch1 or Sketch2
  (their extrudes use them); e2e tests delete an extrude first.

## OCCT facts found on the way

- `BRepOffsetAPI_DraftAngle::Modified` returns nothing for a tilted face
  (it is "generated": a new surface); `ModifiedShape` maps any sub-shape.
  `ConnectedFaces` throws before `Build`. Adding a face that an earlier
  `Add` already tilted (tangent propagation) is a no-op.
- DraftAngle's "positive angle removes matter on the `Direction` side":
  with the pull direction, a positive angle narrows.
- DraftAngle produces "valid" solids whose sides crossed (a rectangle
  narrowed past its width) and cones through their apex (a circle
  narrowed past its radius); only the edge-direction and apex checks catch
  all of them.
- `BRepExtrema_DistShapeShape` only looks inside a solid (`InnerSolution`)
  when the argument *is* a solid; booleans return compounds, so the facade
  measures solid by solid.
- A fuse of coplanar faces with `SimplifyResult` gives one face, and its
  history maps the surviving edges (`kept`, `modified`).
- `ShapeUpgrade_UnifySameDomain` merges two coplanar tilted planes, not
  two cones on the same surface built from opposite neutral-plane sides.

## Rejected

- **Switching the operation in the dialog's drag handler** (or in the
  extrude spec's manipulator code). A typed negative distance, Flip or a
  through-all would miss it; a spec-level `propose` sees every change.
- **Proposing only while nothing was ever proposed**, or never in edit
  mode. The first stops following the arrow back out; the second leaves
  an edited press-pull joining a face pushed into its body (a join that
  changes nothing).
- **Writing `doc.bodies` entries on OK** (a new body named at creation,
  as Fusion does). The number of bodies is known only after the kernel
  runs (a new body per separate solid), and a join or a cut can remove
  them again; which body keeps which name through edits is P2-08's
  question. Derived names cost nothing and keep documents clean.
- **A symmetric template bracket with its holes where they were**
  (y = −20 and −60 mm): half of it would lie outside a symmetric 80 mm
  extrude. One-sided along −Y would have kept them, but a bracket centred
  on the origin frames better and shows the symmetric option.

- **`LocOpe_DPrism` / `BRepFeat_MakeDPrism`** for the taper: built on
  `BRepFill_Evolved`, which rounds the corners it offsets outwards (cones
  at convex corners of a widening taper) and has one angle for both sides.
- **Lofting (`ThruSections`) between the profile and its 2D offset:**
  handles splines, but needs matching wires per loop, holes cut
  separately, and breaks when an inward offset drops an edge.
- **Sweeping a compound of profiles** (ADR-0005 §6's sketch): see §2.
- **A migration for the template's extrudes:** the schema accepts them.
- **Half-space solids** for trimming at an inclined face: a finite box
  from `planarFaces` + `prism` needs no new facade op and is what booleans
  are tested with.
- **Automatic participants by boolean trial** (fuse and count solids):
  twice the booleans; `distance` answers "touches" directly.

## Open

- To-object on curved faces and bodies (Fusion's "to object" on a body),
  and an offset from the object.
- Taper on ellipse and spline sides.
- A cut that splits a body stays one body with several solids (P2-08
  decides whether it becomes several).
- Symmetric "half length" measurement (Fusion offers both); here
  `distance` is the whole length.
- Body metadata (`doc.bodies` names and colours) for new bodies: P2-08.
  Derived "Body<n>" names shift when an earlier body goes away.
- A distance arrow per picked face (ADR-0027 open item); the arrow sits
  at the mean centroid of all picks.
- Picking origin planes for To object (they aren't pickable in the model
  yet); faces and vertices work.
- The press-pull rule for profiles sketched on a body's face (P2-09).
