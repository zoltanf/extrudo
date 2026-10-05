# ADR-0060: Emboss and deboss

- **Status:** Implemented 2026-10-04 (branch `p4-04-wrap`, four slices; see
  Results)
- **Task:** P4-04 (FR-FT-16: emboss or deboss text or sketches onto planar and
  cylindrical faces). Builds on ADR-0058 (sketch text, the whole-text
  reference) and the extrude machinery (ADR-0028, `operate`, ADR-0029).

## Context

On a **flat** face, emboss is already possible by hand: sketch on the face,
extrude the profiles out (join) or in (cut). What's missing is a feature that
takes text or profiles from a sketch *near* the face and puts them *on* it in
one step, and, harder, the **cylindrical** case: lettering on a round box, a
knob, a pen. There the profile has to be wrapped around the surface, not
projected, so letters keep their width.

The kernel has what the flat case needs (`partsOf` for profiles and the
whole-text reference, `planeOf`, `namedPrism`, `operate`). The cylindrical case
needs new geometry (a facade method).

## Decision

### 1. One feature type `emboss`

`packages/core/src/emboss.ts`, inputs (plain inputs with defaults, like extrude):

| Input | Kind | Default | Meaning |
|---|---|---|---|
| `profiles` | ref | (required) | sketch profiles and/or whole texts (`sketchEntity` text refs, ADR-0058 §5) |
| `face` | ref | (required) | one face of a body: flat or cylindrical |
| `depth` | expr (length) | `1 mm` | how far the letters stand out or go in; must be > 0 |
| `mode` | enum `emboss` / `deboss` | `emboss` | emboss joins material outwards; deboss cuts inwards |

The target body is the body that owns `face`; nothing else is touched.
A feature with no change (the profiles miss the face entirely) is an error
"The profiles don't touch the face." (`operate` already detects a cut that
removes nothing; check the join case too).

### 2. Flat faces (slices 1 and 2)

- The sketch of the profiles must lie in a plane **parallel** to the face
  (any offset, either side); else the error "Sketch on a plane parallel to the
  face to emboss on a flat face."
- The profile faces are **moved along the face normal onto the face's plane**
  (a translation, `transform`), then swept by `depth` along the face's outward
  normal (emboss) or against it (deboss) with `namedPrism`, and applied with
  `operate` (join / cut) to the target body only.
- Names: the prism's own names under `emboss:<id>` (sides after their source
  curve, caps `start`/`end`), like extrude's.
- `previewTools` like extrude, so the dialog previews the letters.

### 3. Cylindrical faces (slices 3 and 4): wrap, don't project

- The sketch plane must be **parallel to the cylinder's axis** (its normal
  square to the axis, within 1e-6); else "Sketch on a plane parallel to the
  cylinder's axis to emboss on a round face."
- **Unrolling map.** Let the cylinder have axis point `C`, axis direction `a`,
  radius `R`. In the sketch plane, take the frame: `z` = the sketch coordinate
  along `a` (through the projection of `C`), `s` = the in-plane coordinate
  square to `a`, with `s = 0` where the plane's normal through the axis meets
  it (the face of the cylinder that looks at the sketch). A sketch point `(s,
  z)` maps to the cylinder point at angle `θ = θ0 + s / R`, height `z`, where
  `θ0` is the angle of the sketch normal's direction. Letters keep their width
  measured along the surface.
- **Exact, not sampled.** The cylinder's parameter space `(u, v) = (θ, z)` is
  related to the unrolled sketch `(s, z)` by a linear map (`u = θ0 + s / R`,
  `v = z`). So every sketch curve maps exactly to a 2D curve in `(u, v)`: a
  line to a line, a B-spline or Bézier by mapping its poles (affine maps keep
  B-splines), a circle or arc to an ellipse or elliptic arc (non-uniform scale).
  The facade builds edges as `Geom2d` curves **on the cylindrical surface**
  (`BRepBuilderAPI_MakeEdge(curve2d, surface)`, then `BRepLib::BuildCurves3d`),
  wires from them, and faces on the surface (`BRepBuilderAPI_MakeFace(surface,
  wire)`, holes as inner wires).
- **The solid.** The same `(u, v)` wires on a second cylinder of radius `R +
  depth` (emboss) or `R − depth` (deboss; refused when `depth ≥ R`), side
  faces as ruled surfaces between corresponding edges (`BRepFill::Face(e1,
  e2)`), sewn (`BRepBuilderAPI_Sewing`) and made a solid; checked with
  `BRepCheck_Analyzer` and a positive volume. Then `operate` join or cut.
- **Facade:** one new method, `wrapOnCylinder(...)` taking the staged planar
  profile curves (as for `sketchProfiles`/`pathSketch`: lines, arcs, ellipses,
  B-splines, with their loop structure), the cylinder (`C`, `a`, reference
  direction for `θ0`, `R`), `depth` and the sign. It returns the tool solid and
  per-face history (which source curve each side came from) so naming works.
  **Prototype it natively first** in `spikes/p4-04-harness/` (the way
  `spikes/p4-01-harness/` works: `run.sh`, real OCCT in the emscripten image),
  including a leak round, before the facade build. Wraps of more than half
  the circumference (`|s| / R > π`) are refused ("The text is longer than half
  way round the cylinder.").
- Cones, spheres and free-form faces: refused for now ("Emboss works on flat
  and cylindrical faces.").

### 4. The dialog

`apps/web/src/features/emboss.ts`, tool `emboss` in Solid › Create's menu
after Coil, no key. Fields: Profiles (selection; profiles and whole texts:
`wholeTexts: true` like extrude's, so a click on a letter picks the text), Face
(selection: faces, one), Depth (expression, with a distance manipulator along
the face normal at the profiles' centre), Mode (choice Emboss / Deboss).
Pre-selection: a selected text or profile fills Profiles, a selected face
fills Face.

## Slices

All four are done (2026-10-03 and 2026-10-04, branch `p4-04-wrap`).

1. **Core and kernel, flat faces:** schema, settings and inputs, the evaluator
   for flat faces (cylindrical faces error "not yet" until slice 4), kernel
   tests (volume = ink area × depth for emboss and deboss on a box's top; a
   sketch below or above the face; a non-parallel sketch refused; profiles
   off the face refused; whole-text reference survives a string edit), golden
   table, file format.
2. **App and e2e, flat faces:** the dialog, pre-selection, preview,
   `e2e/emboss.spec.ts` (emboss "ABC" on a box's top and deboss on a side).
3. **Facade `wrapOnCylinder`:** native prototype and harness with tests (a
   rectangle, a circle, a letter with a hole, a B-spline glyph; exact volume
   checks against `area × depth × (R ± depth/2) / R`; leaks), then the facade
   method and the TS wrapper, CI OCCT build.
4. **Kernel, app, e2e and docs for cylinders:** the evaluator's cylindrical
   branch, kernel tests, the dialog on round faces, e2e on a Cylinder
   primitive, docs (CLAUDE.md, CHANGELOG, roadmap, this ADR's results).

## Rejected

- **Projecting onto the cylinder** (sweeping the profile along the sketch
  normal into the cylinder): letters get narrower towards the sides and their
  depth varies; wrapping keeps both.
- **Sampling curves into polylines** for the wrap: the parameter-space map is
  linear and exact, so exact edges cost nothing extra and keep fillets and
  measurements working.
- **A separate deboss feature:** one feature with a mode, like extrude's
  operation.
- **Emboss on any face via OCCT's `BRepOffsetAPI_MakeOffset` of a projected
  face:** unreliable on thin letters and not exact.

## Results

What the four slices came to, and what the implementation changed in §1-§4.

- **The evaluator** (`packages/kernel/src/features/emboss.ts`) reads the face
  with `Kernel.threadFace` (which a thread needs anyway, ADR-0056): the axis
  with the facade's canonical sign, the radius and **whether the wall is a
  hole's** (its normal points towards the axis), which is the convex/concave
  question. `outward = convex` for an emboss and `!convex` for a deboss, so a
  hole's wall takes its letters into the hole's free space and a boss's out of
  its own. No facade change for this.
- **The frame** (§3) as designed: `|n · a| ≥ 1e-6` refuses, `r` points from the
  axis to the sketch plane, `across = a × r`, and `corner` is the foot of the
  axis on the plane. Every profile point keeps its world position, so the map
  is exact and nothing can be mirrored by it; the axis's canonical sign only
  decides which way the letters read (they read as the sketch does when the
  sketch's up is along `a`).
- **The tool** is one `namedWrap` per part (a whole text has one part per ink
  region, ADR-0058 §5) fused by `mergeTools`, then `operate` join or cut on the
  face's own body and `splitSolids`, exactly as the flat branch. The wrap's
  history is a prism's (`first` and `last` for the caps, `generated` per source
  edge for the walls), so `namedWrap` is `nameSweep` and the names are the
  prism's: `emboss:<id>:cap:end`, `emboss:<id>:side:<sketch curve>`.
  `cap:start` merges into the wall it stands on, as on a flat face.
- **The wrap** (§3, slice 3) is OCCT's **simple offset** of the wrapped cap,
  not the ruled faces and sewing §3 first described. Building both caps and
  sewing ruled walls between them was tried in `spikes/p4-04-harness` and is
  both slower and worse: `BRepFill::Face` between two corresponding edges
  wants edges it can pair by parameter, and the corner edges (a vertex shared
  by two wrapped curves) come out unpaired. `BRepOffset_MakeSimpleOffset`
  maps the cap onto the coaxial cylinder of radius R ± depth — the same curves,
  so **both caps are exact surfaces** — and makes every wall between them,
  sharing the radial edge at a corner between the two walls that meet there.
  One call, and a hole in the profile, a corner or a whole closed curve (a
  letter's O) all come out right. `BRepLib::OrientClosedSolid` turns over a
  solid the sign left inside out; the result goes through `BRepCheck_Analyzer`
  and a positive volume.
- **A bug found by the harness**: the simple offset wraps *the whole basis* of
  a curve, so a trimmed B-spline (a glyph outline is one) turned into a
  different curve over its full range. The fix is in the wrap's own edge
  mapping: a B-spline edge's trimmed **piece** (`Geom_BSplineCurve` + its
  first/last parameters) is mapped pole by pole, not the whole curve.
- ~~**`Kernel.measure`'s volume is 1-2 % off on a B-spline wall** (the wrap's
  curved walls are B-spline surfaces, like the lofter's), so the wrap's exact
  volumes are only as exact as the integrator: the kernel tests use 2 % where a
  wall is curved (a rectangle of lines is exact to 1e-7) and the arithmetic is
  in **P4-12**.~~ **Resolved 2026-10-05** (ADR-0067 §H3): the facade integrates
  BRepGProp with an error bound where a B-spline face makes OCCT's fixed-order
  integral wrong, so a wrap's volume is exact to 1e-5 of
  `area × depth × (R ± depth/2) / R` where its reference is exact (and 1e-4
  against a fine mesh where the profile's own area is the limit); the kernel
  tests use 1e-5 and 1e-4 now, not 2 %.
- **The dialog** puts its depth arrow on the wall at the letters: the frame is
  taken at the point of the surface nearest the profiles' centre
  (`surfaceFrameNear`), because a cylinder's own middle is on the axis, nowhere
  near them, and the normal there is the radius — out of a boss's wall, into a
  hole's. The face field and its pre-selection take a round face as they do a
  flat one; nothing else changes.
- **Rejected in slice 4** as planned: projecting the profiles onto the
  cylinder (the letters narrow and their depth varies) and sampling curves into
  polylines (the map is linear, so exact edges cost nothing).
- **Left for P4-12**: cones, spheres and free-form faces, more than half way
  round, a "tangent to the face" option for a flat sketch far from the face,
  and emboss onto several faces at once.

## Deferred

- Cones (a linear map too, with a varying radius), spheres and free-form
  faces; wrapping more than half way round; a "tangent to the face" option
  for flat sketches far from the face; emboss onto several faces at once.
