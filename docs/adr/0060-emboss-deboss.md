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

## Amendment (2026-10-06, P4-12): cones, spheres and free-form faces; more than half way round

The P4-12 backlog's emboss item (branch `p4-12-emboss-faces`). Three of the
Deferred items are done here; two stay deferred (§A5).

### A1. Cones: a wrap like the cylinder's

A cone is wrapped, not projected, by the **same map** as a cylinder (§3): the
sketch plane runs along the axis (its normal square to it, within 1e-6, else
"Sketch on a plane parallel to the cone's axis to emboss on a round face."),
`r` points from the axis towards the sketch plane, `across = a × r`, and a
sketch point `(s, z)` lands at the cone's parameters `(u, v) = (s / R0, z)`,
`u` the angle from `r` and `v` the distance **along the generator**. The
facade's frame is centred on the axis at the **profiles' area centroid's
height** (one height for the whole feature, so the letters of a text stay in
line), `R0` is the cone's radius there and `z` is measured from it. So:

- the map is linear in the cone's parameters, so it is **exact**: a line to a
  line, a circle to an ellipse in `(u, v)`, a B-spline pole by pole — the
  cylinder's `WrapFrame` code unchanged;
- a letter's **height** is kept along the surface and its **width** is exact
  on the centroid's circle and scales with the radius above and below it
  (`R(v) / R0`: ±8.5 % at the top and bottom of a 10 mm letter on a 20 mm radius at 20°). The true
  development is not linear in `(u, v)` (it is polar about the apex: a
  straight line of it is no line, ellipse or B-spline in the cone's
  parameters), so it could only be had by approximating every curve; the
  scaled width is the cone's own taper and reads naturally on a funnel or a
  knob;
- the far cap is on the cone offset by `depth` along its normal (OCCT's simple
  offset of a `Geom_ConicalSurface` face is the cone of the same half-angle,
  exactly), the walls along that normal, so the depth is square to the surface
  and the volume is `A d / R0 · (R0 + z̄ sin α ± d cos α / 2)` for a profile of
  area `A` whose centroid is `z̄` from the frame's circle — the cylinder's
  `A d (R ± d/2) / R` at `α = 0`;
- `convex`/`concave` comes from the new facade query **`coneFace`** (the
  same rule as `threadFace`: the face's normal in its middle against the
  radius), so a countersink's wall takes letters into its free space as a
  hole's wall does;
- refused: a profile that reaches the tip ("The profiles reach past the cone's
  tip.") and an inward depth that would reach the axis.

**Facade:** `wrapOnCylinder` and the new **`wrapOnCone(face, o, a, r, radius,
halfAngle, p, s, depth, outward)`** are one private `wrapOn(…, halfAngle)`;
half-angle 0 builds exactly the `Geom_CylindricalSurface` it always did, so a
cylinder's wrap is unchanged (`wrap.test.ts` and the P4-04 harness pass as
they were). One method with a half-angle of 0 for the cylinder was the other
way; two public methods keep the TypeScript `Kernel.wrapOnCylinder` and every
caller as they are.

### A2. Spheres, tori and free-form faces: projection

No map keeps lengths on a doubly curved face, so these take the profiles
**projected along the sketch plane's normal** (a flat sketch beside the face):
the facade's new **`projectOnFace(profile, body, face, depth, outward)`**
sweeps each part's face as a prism through the face and keeps the part of it
between the face and the face offset by `depth` along its outward normal
(emboss) or against it (deboss) — the `common` of the prism and that thick
piece of the face. The thick piece is OCCT's simple offset of a copy of the
face; a **sphere or a torus** (a whole one is a closed face with poles the
simple offset can't take) is the shell between two concentric spheres or two
tori on the same centre circle, exactly, with its seam turned away from the
sketch (a sphere's along the travel, its poles square to it; a torus's round
the axis away from the profile) so the caps aren't cut in two — a torus's tube
seam runs round its outer equator and can't be turned, so a profile projected
onto that equator from the side gets its caps in two pieces (`cap:end#1`,
`#2`), which is sound. The face's outward normal falls back to second
derivatives where the first ones give none: the line through the centre of a
circle sketched over a Sphere primitive lands on its pole, and without that
no piece of the face looked at the sketch (the kernel test found it, the
harness's pole case covers it). Which side the profiles come from is the
side of the sketch the face looks at (the hit nearest the sketch, on the line
through the profiles' centre, where the face's outward normal looks back);
from there:

- **refused**: a profile whose line misses the face ("The profiles don't touch
  the face."), and any sample of the outline (twelve per curve) whose first hit
  isn't on the face where it looks back at the sketch, or that misses the
  offset face — past the face's edge or past its silhouette, where the column
  would run round behind it ("The profiles reach past the face's edge as seen
  from the sketch."). The kept solid may only be bounded by the face, its
  offset and the prism's walls, which catches the rest;
- a closed face (a whole sphere) gives the prism's piece on its far side too:
  only the solids standing on the part of the face that looks at the sketch
  are kept;
- names as a prism's: the face's pieces `cap:start`, the offset's `cap:end`,
  the walls `side:<curve>`;
- **the method is not an input**: the kernel moves the profiles onto a plane,
  wraps them round a cylinder or a cone and projects them onto anything else,
  and reports which (`EmbossReport` `{ kind: 'emboss', method }`, through
  `Preview.emboss` to the dialog's read-only line "Moved onto the face",
  "Wrapped round the cylinder", "Wrapped round the cone" or "Projected onto
  the face"). A cylinder or cone whose sketch plane doesn't run along its axis
  is still refused rather than projected: the wrap is the better answer and
  the message says how to get it.

The depth of a projection is measured **along the face's normal**, so a column
on a slanted part of the face is longer along the ray than `depth`; walls stay
along the projection, so letters narrow towards a sphere's outline, which is
what projection means (§Rejected's reason to wrap a cylinder).

### A3. More than half way round

The old limit was `|u| ≤ π` from the frame (half way round **each way** from
the point that looks at the sketch, so a profile off to one side was refused
long before it went round). The harness found no seam trouble: a wrapped face
whose `u` runs from 0 to 5.24 (300°) on the periodic surface is a sound face,
OCCT's simple offset thickens it, and the boolean with a cylinder whose own
seam it crosses joins and cuts exactly. So the face is **not** cut at the seam
(one face per curve, as before, no `#1`/`#2`), and the limit is the profile's
**whole** `u` range (`BndLib_Add2dCurve::AddOptimal` of every wrapped curve):
refused only past a whole turn, less 0.01 mm at the smallest radius the
profile reaches so its ends never meet ("The profile is wider than the face's
circumference."). `threadFace`'s convex/concave rule is the face's, not the
profile's, so it holds however far round the profile runs.

### A4. Results

Native harness `spikes/p4-12-emboss-faces/` (`run.sh`, `run.sh leaks 300`;
`#define private public` over the facade, real OCCT 8 in the emscripten image,
every volume integrated with a 1e-12 tolerance):

- cone (20°, R0 = 20): a 10 × 4 rectangle out and in, 1 mm: 40.9396927 /
  39.0603073 against the formula's 40.9396926 / 39.0603074; off the frame's
  circle (z̄ = 3) and on a narrowing cone, inwards: to 1e-9; a letter O (its
  counter kept, 4 faces) out and in and a B-spline glyph to 1e-9; a frustum
  joined and cut adds and subtracts to 1e-9; the tip and the axis refused;
  56 ms for the first wrap, 9 ms after;
- 300° round a cylinder from the frame (out) and past the back (in): 429.3509951
  and 408.4070458 against 429.3509960 and 408.4070450; joined to and cut from a
  cylinder to 1e-9; 300° round the cone too; past a whole turn and within
  0.01 mm of one refused;
- a Ø10 circle projected onto a R 20 sphere, out and in by 1 mm: 79.7447292 and
  79.8759564, the column between concentric spheres exactly
  (`2π/3 [(r³ − (r² − a²)^{3/2})]` between the two radii); 3 faces; the
  boolean with the sphere exact; from the other side onto the far half; a
  letter O (4 faces) exact; past the outline, past the inner sphere's outline
  for a deboss and off the sphere refused; about 50 ms;
- the Sphere primitive's own shape (a half disc turned about Z) with a Ø6
  circle above it, through the pole: 28.4274498 / 28.4437619, exact, 3 faces;
- a Ø4 circle onto a torus's tube (major 15, tube 5) from above, out and in by
  0.5 mm: valid, 3 faces, 6.40 / 6.43 mm³ (2 % over area × depth: the tube
  curves under it), the boolean exact;
- an 8 mm square onto a lofted B-spline side, out and in: valid, 6 faces,
  65.15 mm³ (between 0.9 and 1.3 × the column's 64), the boolean exact to 1e-9;
  past the face's top edge refused; about 0.55 s;
- leaks: five cases × 300 rounds, heap 7.5 MB at 60 and at 300 rounds (flat),
  the control grows 18.5 MB.

### A5. Still deferred

- **"Tangent to the face"** for a flat sketch far from a cylinder or cone
  (today the frame rule only asks the sketch plane to run along the axis, and
  the profile keeps its own `s`; an option that rolls the sketch onto the face
  from a far plane is a UI question as much as a kernel one).
- **Several faces at once** (a text across two faces of a body): each face
  would need its own method and the letters split between them.
- A cylinder or cone sketched across its axis is refused, not projected (A2).
- An inward offset of a free-form face where the face curves tighter than the
  depth folds the offset surface; the simple offset doesn't refuse it and the
  result's validity check is what catches it.
