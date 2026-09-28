# ADR-0028: Extrude

- **Status:** Accepted (kernel and document part), 2026-09-28. The UI part
  (dialog, manipulators, press-pull, red cut preview, template) extends this
  ADR in the second step of P2-06.
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
  `src/memory.test.ts`, `packages/core/src/extrude.test.ts`.
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
