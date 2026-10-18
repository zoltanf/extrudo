# ADR-0088: OpenSCAD export

- **Status:** Accepted, 2026-10-16 (proposed 2026-10-15; owner chose "real OpenSCAD code with a
  mesh fallback" over a mesh-only file).
- **Task:** P6-09, FR-IO-09.
- **Builds on:** ADR-0030 (bodies, one body per solid), ADR-0034 (model
  export, resolutions), ADR-0059 (customizer), ADR-0069 (CLI shares the
  kernel's export), ADR-0071 (OpenSCAD import, `@extrudo/openscad`),
  ADR-0073 (the macro emitter, the TypeScript counterpart).
- **No schema change.**

## Context

Export as Script (ADR-0073) writes a design back as TypeScript for Extrudo's
own API. Users of the 3D-printing community also share and remix models as
OpenSCAD files, which open in OpenSCAD's Customizer and on model sites. An
`.scad` file that rebuilds a design as OpenSCAD code — not just its triangles
— lets them do that.

OpenSCAD is a much smaller modelling language. It has CSG (`union`,
`difference`, `intersection`), transforms, `polygon`, `linear_extrude`,
`rotate_extrude`, primitives and `polyhedron`. It has no fillet, chamfer,
shell, loft, sweep, draft, face references or constraint solver. So a full
translation is impossible; the question is how to translate what maps and
stay exact for the rest.

## Decision

1. **One `.scad` file per export, OpenSCAD 2021.01 syntax** (it also runs on
   the nightly builds and the WASM snapshot we ship). Millimetres and
   degrees, Z up, Extrudo's world coordinates unchanged. The file is
   deterministic: the same document and options give the same bytes (no
   date; the header names the Extrudo version and the project).

2. **Body versions.** The kernel's last recompute already holds every
   feature's output body map (`AtMarker.outputs`); an unchanged body keeps
   its `ShapeHandle`. Walking the timeline, each body ID gets a new
   **version** whenever a feature replaces its handle. A version is one of:
   - **csg**: the feature's CSG hook (§3) said how to build it from earlier
     versions and tool geometry, for example `difference() { Body1_v1();
     Extrude3_tool(); }`;
   - **mesh**: a `polyhedron` of the shape *at that version*, meshed at the
     export's resolution.

   A version falls back to **mesh** when its feature has no hook, the hook
   returns `null` for the inputs it got, the feature split a body into pieces
   (an origin from it, or several new bodies from one expression: OpenSCAD
   can't pick one piece out of a union), or anything the hook refers to
   is itself unavailable. **Later features build on a mesh version with
   CSG again**, so a hole cut after a fillet stays a live `difference`.
   The emitter walks back from the exported bodies' last versions; only
   versions it reaches are written and meshed.

3. **CSG hooks on kernel feature definitions:** an optional
   `csg(ctx)` on `KernelFeatureDefinition`, run at export time with the same
   resolved references and the body map the feature saw. It returns a small
   IR (node types for the transforms, booleans, primitives, `polygon`,
   `linear_extrude`, `rotate_extrude`, a reference to a body version, a
   reference to a shared tool module) per body the feature makes or changes,
   or `null`. Evaluators are not touched. Which bodies the feature joined,
   cut or removed comes from comparing the body maps before and after it,
   not from the inputs (an empty `bodies` input means "whatever it touches",
   which only the evaluation knows).

4. **Geometry as numbers, scalars as expressions.** Placements — sketch
   frames, axes, mirror planes, profile outlines — are written as numbers
   from the resolved geometry (`multmatrix`, `polygon` points from the
   sketch's own profile loops, arcs and splines already as polylines). A
   scalar input (a length, an angle, a count, a scale factor) is written as
   an OpenSCAD expression over the parameter variables when its Extrudo
   expression translates (§6), else as its value. **Sketch geometry is
   fixed:** the coordinates come from the constraint solver, which OpenSCAD
   doesn't have.

5. **Parameters and the Customizer.** Only parameters the written code uses
   (directly or through other parameters) become top-level variables, in
   document order. One with a `customizer` (ADR-0059) goes in its group's
   `/* [Group] */` section with `// [min:step:max]` from its range (base
   units); the others go under `/* [Hidden] */`. A parameter that also sets
   geometry the file holds fixed (a sketch dimension, a mesh version's
   feature) gets a comment saying so, naming the features. Names that aren't
   OpenSCAD identifiers or clash with its keywords and built-ins get a `_`
   suffix. Configurations are not exported. Document text that lands in a comment (a
   comment, a feature name) is written on one line, and a group header has
   `*/` broken up (`* /`) and brackets turned into parentheses, so none of it
   can end the comment.

   Since ADR-0086 (the Parameters dialog), slider ranges are expressions and
   the group sits on the parameter. The export writes each range's evaluated
   value in base units (core's `customizerRows`) and takes the section from
   `parameter.group`; a range that doesn't evaluate, or a min above the max,
   writes no range comment.

6. **Expression translation** (`@extrudo/core`'s parser, base units):
   a number with a unit becomes `value * factor` folded to one number; a
   bare number in a length context takes the document's length unit; `^`
   becomes `pow`; `sin`/`cos`/`tan` of a unitless, non-bare argument
   (radians in Extrudo) get `* 180 / PI`; `asin`/`acos`/`atan` already give
   degrees in both; `round`/`floor`/`ceil` round in display units as Extrudo
   does; `pi` becomes `PI`. Anything the translator can't reproduce exactly
   is written as its evaluated value.

7. **What has a hook in the first version:**

   | Feature | Translated | Falls back to mesh |
   |---|---|---|
   | Box, Cylinder, Sphere, Torus | all operations | — |
   | Extrude | sketch profiles and texts; `distance` on every side; `through-all` for cut and intersect (a number past the model's bounding box) | faces as profiles, `to-object`, a taper, `through-all` for new body and join |
   | Revolve | sketch profiles, an axis in the profile's plane, `angle` extents | faces, an axis out of the plane, `to-object` |
   | Combine, Remove | all | — |
   | Move | free, rotate, point-to-point, copy | — |
   | Mirror | bodies, copy, join | features |
   | Scale | uniform and non-uniform, copy | — |
   | Rectangular and Circular Pattern | bodies, join, skip | features |
   | Sketch, construction, canvas, joints | make no bodies | — |
   | Everything else (fillet, chamfer, shell, loft, sweep, hole, thread, draft, offset face, rib, emboss, coil, split, place on bed, import, script, plugin) | — | mesh |

   Hole, Place on Bed and Path Pattern are the likely next hooks, and a
   partial Fillet: straight edges between two flat faces as subtracted
   (convex) or added (concave) edge masks, with sphere patches where three
   rounded edges meet; any other fillet stays a mesh version (owner,
   2026-10-15: polyhedron first, edge masks later).

8. **Mesh versions** are written as `polyhedron(points, faces)` from the
   welded export mesh at the chosen resolution (the Export Model presets),
   with faces ordered clockwise seen from outside, as OpenSCAD expects,
   and points rounded to 1e-4 mm. A mesh body (imported STL, OpenSCAD import)
   is just that.

9. **File layout:** header comment; `$fa`/`$fs` from the resolution; the
   parameters; one module per written body version (`Bracket_v3()`, from the
   body's name) and per shared tool (`Extrude3_tool()`, used when one tool
   cuts several bodies); then each exported body, `color()` from its colour,
   under a comment naming its component. Hidden bodies are left out unless
   chosen, as in Export Model.

10. **Where it lives:** `packages/kernel/src/scad-export/` (Node-able, so the
    CLI shares it, ADR-0069): the IR, the printer, the expression translator
    and the version walk. The app offers it as a fourth format in Export
    Model ("OpenSCAD (.scad)"), which already has the body choice and the
    resolution; the CLI as `extrudo export --format scad`.

11. **Verification:** tests render the exported file with
    `@extrudo/openscad`'s Node compiler and compare each body's volume and
    bounding box with the kernel's within the mesh tolerance, and check that
    a fully translatable design writes no `polyhedron` at all.

## Rejected

- **A mesh-only file** (every body a `polyhedron`): exact and small, but not
  editable; Export Model already covers it. It stays as the fallback.
- **Emitting from `@extrudo/api`, next to `emitScript`:** the emitter there
  sees only the document; OpenSCAD needs resolved geometry (frames, profile
  outlines, which bodies a cut touched).
- **One CSG expression per feature, without body versions:** wrong as soon as
  a join merges two bodies or a cut touches several.
- **Whole-body fallback** (a body with any fillet becomes one polyhedron):
  simpler, but loses the live features after the fillet, which is the common
  case in a print part.
- **Approximating fillets and chamfers** with `minkowski`, `offset` or
  `hull`: different geometry from the model, and slow to render.
- **Sketch constraints as OpenSCAD functions:** would need a solver in
  OpenSCAD.
- **Exporting configurations** as Customizer parameter sets (a JSON file next
  to the `.scad`): possible later; the first version has one file.

## Consequences

- A design made of sketches, extrudes, revolves, primitives, booleans and
  patterns opens in OpenSCAD as readable, parametric code; one with fillets
  is still exact, with polyhedra where OpenSCAD can't follow.
- Parameters that drive sketch dimensions don't change the sketch in
  OpenSCAD; the Customizer comment says so.
- Polyhedra make big files for finely meshed round bodies; the resolution is
  the user's choice.
- Each new feature type should consider a `csg` hook; without one it falls
  back, so nothing breaks.

## Results, slice 1 (2026-10-15)

Built: §1–§3 and §8–§11 without the scalar expressions — the IR, the printer,
the hook, the version walk, mesh versions, the file and the CLI. Hooks for
**Combine** (`union`, `difference`, `intersection` of the target's and tools'
versions; intersect takes the tools together) and **Remove** (an empty map:
it changes no body).

**Files** (`packages/kernel/src/scad-export/`): `ir.ts` (the node types and
`boolean`, `torus`, `matrixOf`), `print.ts` (IR → text), `context.ts`
(`CsgContext`, `CsgInput`, `CsgResult`), `versions.ts` (`ScadStep`,
`ScadSource`, `walkVersions`), `mesh.ts` (`polyhedronOf`), `file.ts`
(`writeScad`, `ScadBody`, `ScadExportOptions`, `scadIdentifier`,
`fragmentSize`), `number.ts` (`scadNumber`, before this slice). The engine's
`AtMarker` gained `steps` (each write feature of the last recompute with its
inputs, values and the body maps before and after; references only), and
`RecomputeEngine.exportScad(options, scalar?)` builds the `ScadSource` from it;
`KernelService`, `KernelApi`, the worker API and `Recomputer` pass
`exportScad(options)` through. The CLI's `export --format scad` is
`DesignJob.export({ format: 'scad' })`.

**The IR.** A `Scalar` is `number | { expr, value }`: the printer writes `expr`
when there is one, so slice 2's translator plugs in without a type change
(`ScadSource.scalar`, the engine's `exportScad(options, scalar)`). Nodes:
`translate`, `rotate` (Euler vector, or angle and axis), `scale`, `mirror`,
`multmatrix` (3 × 4 rows), `color`, `union`/`difference`/`intersection`,
`cube`, `cylinder` (`r1`, `r2`, `center`), `sphere`, `polyhedron`, `circle`,
`square`, `polygon` (with `paths`), `linear_extrude` (`center`, `twist`,
`scale`), `rotate_extrude` (`angle`), `version` (a body's version, by the
walk's index) and `tool` (a shared tool, by index).

**`CsgContext`** gives a hook: `kernel`, `feature`, `inputs` (parsed as the
evaluator had them); `input(name)` → `{ value, expr, unit }`, `scalar(name)`,
`value(name)`; `resolve(ref)` (the engine's resolver over the bodies before
the feature), `output(feature)`, `describe`, `featureName`; `before`, `after`,
`changed` (bodies of `after` with a new shape), `removed`; `body(id)` (the
version node of a body before the feature; throws when there is none),
`bounds()` (the box around the bodies before, for `through-all`), `tool(node)`
and `unsupported(reason)` (returns `null` and names the reason in the header).

**Fallback, as built:** a changed body is a mesh version when its feature has
no hook, the hook returns `null` or leaves the body out of its map, the feature
broke a body into pieces (an `origins` entry from a body that existed before:
the source and its pieces), or the hook throws a `KernelError` (another error
is a bug and fails the export). The hook runs for every write step (cheap);
only the versions the exported bodies reach are meshed and written. A tool is
a module (`<Feature>_tool`, `_tool2`…) when the written versions use it twice
or more, else written in place.

**Deviations and choices:**

- `$fa` is the angular deflection in degrees; `$fs` is the chord the linear
  deflection allows on a 1 mm radius, `√(8·d)` (0.4 mm at Medium), so small
  holes are as fine as Export Model's mesh and large ones follow `$fa`.
- Module names: a body's name as the caller gives it, else its stored name,
  else `<Feature> body` (`<Feature> body 2` for `:1`), as an identifier
  (letters, digits, `_`; a leading digit gets `_`), made unique in the order
  first written, then `_v<n>` (the body's n-th version in the timeline,
  unwritten ones counted, so numbers stay put when the choice of bodies
  changes).
- The header names a script's generated feature as `Script1 › Box1`.
- The CLI writes the shown bodies without `--bodies`/`--component` (every
  body when none is shown), as §9 says; its STL, 3MF and STEP exports still
  write every body, as before.
- Hidden bodies are the caller's choice: `exportScad` writes the bodies it is
  given. The app's dialog (a later slice) chooses them as Export Model does.

**For slices 3–4 (the other hooks):** return a node for every body in
`ctx.changed` you can translate; build it from `ctx.body(id)` for bodies the
feature changes and from fresh geometry for what it makes; use `ctx.tool`
for one tool cut into or joined to several bodies; write scalars with
`ctx.scalar(name)` and placements as numbers (`multmatrix` from a resolved
frame); several new bodies from one solid (a new-body extrude whose profile
gives two solids) can't be told apart in OpenSCAD — leave them out of the
map. A cut or join decides its bodies by comparing `before`/`after`, never
from the inputs. A hook must release any shape it makes.

## Results, slice 3 (2026-10-15)

Built: the §7 hooks for **Box, Cylinder, Sphere, Torus** (every operation),
**Move** (free, rotate, point-to-point, copy), **Mirror** (bodies, copy,
join; features fall back), **Scale** (uniform and non-uniform, about a point
or the centre, copy) and the **Rectangular and Circular Patterns** of bodies
(copies, join, skip; features fall back). Path Pattern has no hook yet.

**The operation helper.** `scad-export/operation.ts`:
`operationCsg(ctx, operation, tool)` is `operate`'s counterpart, read from
`ctx.changed`/`ctx.removed` only: one new body is the tool (several, a solid
that fell apart, are `unsupported` and so meshes); join is
`union(version, the versions it merged in, tool)`; cut and intersect a
`difference`/`intersection` of each changed body's version and the tool,
which goes through `ctx.tool` when two or more bodies use it; a body a cut
removed is gone. It knows nothing of primitives, so Extrude and Revolve
reuse it.

**Placement math is the evaluators', not a copy.** Each hook calls the same
functions its evaluator does:

- `lineOf`, `planeOf`, `pointOf` take a `GeometryReader`
  (`Pick<EvalContext, 'kernel' | 'resolve' | 'describe' | 'output'>`), which
  `CsgContext` satisfies; `centreOf`, `existing` and `existingBodies` take
  `Pick<EvalContext, 'kernel' | 'bodies'>` / `'bodies' | 'feature'`.
- `CsgContext` gained `bodies` (the same map as `before`, under
  `EvalContext`'s name) and `bodyId(n)` (`<feature>:<n>`, as the evaluator
  numbered its new bodies), so copies get the IDs `transformBodies` and
  `patternBodies` gave them.
- Move's matrix is now built in two steps, `moveMotion` (mode, pivot, turns,
  distances, axis, points) then `motionMatrix`; the hook writes the motion.
  Scale's centre is `scaleCentre`. The patterns' inputs are read by
  `rectangularRows` and `circularTurns`, and the hook lays out the instances
  with `rectangularPlacements`/`circularPlacements` and drops the skipped ones
  with `splitSkip`. The torus's frame is `torusFrame`. A primitive's own frame
  and numbers come from its output (`PrimitiveOutputData`).

The evaluators do the same arithmetic in the same order; every kernel test
passes unchanged and the recompute does no new work.

**IR helpers** (`ir.ts`): `half`, `negate`, `absolute` (a number for a
number, `(a) / 2`, `-(a)`, `abs(a)` for an expression, brackets only where
needed); `frameMatrix(frame)`; `placed(matrix, child)` (nothing for the
identity, `translate` for a move alone, else `multmatrix`, with rounding
noise below 1e-12 as 0); `about(point, transform, child)`
(`translate(p) T translate(-p)`).

**Deviations and choices:**

- A Box and a Cylinder are written centred, `translate([0, 0, h / 2])
  cube([l, w, abs(h)], center = true)`: OpenSCAD's sizes take no sign, and this
  way one file is right for a negative height and for a parameter that changes
  sign in the Customizer.
- Placements are numbers, as §4 says: a primitive's x, y, offset and rotation
  are in its `multmatrix`, a pattern's instances unrolled (no `for` in the IR),
  so a pattern's count and spacing are not live in OpenSCAD. Sizes, Move's
  distances and angles, Rotate's angle and Scale's factors are scalars. Move
  leaves out a zero only when it is a number.
- A Mirror join tells its touching copies (a union with the original) from
  the ones that stayed apart (new bodies, numbered in order) by which sources
  changed, not by measuring again.
- Tests: the shared render and measure helpers are `scad-export/testing.ts`.
  Their box is now the box of a fine mesh of the kernel's body (OCCT's own box
  is loose around trimmed spheres and B-splines; it was off by 1.6 mm), the
  volume still the exact one. `export.test.ts` runs with the primitives' hooks
  taken off (`featuresWithoutHooks`), so it still tests the fallback it was
  written for. `hooks.test.ts` exports at the Fine resolution: at Medium
  OpenSCAD's 24-sided circles lose 1.1 % of a cylinder's volume, more than
  the 0.5 % tolerance.

**For slice 4 (Extrude, Revolve, wiring the translator):** build the tool in
place (`placed(frameMatrix(sketch frame), linear_extrude(…))`) and hand it to
`operationCsg`; read inputs with `ctx.input(name) ? ctx.scalar(name) :
default` so absent inputs stay numbers. Once `ScadSource.scalar` is the
translator, every scalar above becomes live without a change to the hooks;
check that `half`/`negate`/`absolute` keep their brackets right around the
translator's output. Patterns and Mirror of features need a hook that can
replay another feature's tool (its hook's node), which none returns yet.

## Results, slice 4a (2026-10-16)

Built: the §7 hooks for **Extrude** and **Revolve** (their profile and text
references, every extent and direction), and the profile conversion they share.

**Profiles to 2D nodes** (`scad-export/profile.ts`, used by both hooks). A
picked `profile` or whole-text `sketchEntity` reference resolves to the sketch
output's own regions — the same `detectProfiles` the sketch evaluator keyed
them by, so no copy of the arrangement — one `polygon(points, paths)` per
region with the outer loop and its holes as paths (OpenSCAD fills even-odd).
A loop that is one whole circle is `translate(centre) circle(r = radius)`
instead, a hole under a polygon outer loop then a `difference` of it. A
**line** is its two end points; an **arc** is sampled with `ctx.fragments(radius)`
segments a full turn, proportionally for its sweep (at least one), so a
profile's arcs facet exactly as OpenSCAD's own circles and cylinders; any
other curve (spline, ellipse, conic, text glyph) the polyline `detectProfiles`
already sampled at a 1e-3 mm sagitta, finer than the export's linear
deflection. Points are numbers: the sketch geometry is fixed (ADR §4). Regions
from different sketches are mapped into the first's plane frame. A face of a
body is `ctx.unsupported('faces as profiles')`.

`SketchOutputData` gained `sketch` (the `SketchData` the evaluator already
had): one recorded reference, no extra recompute work, and the hook runs
`detectProfiles` at export time only.

**`CsgContext.fragments(radius)`** is OpenSCAD's own count for a full circle,
`ceil(max(min(360 / $fa, radius * 2π / $fs), 5))` with `$fn = 0`, from the
`$fa`/`$fs` `writeScad` writes (the same values, so a hook's arcs and
OpenSCAD's circles agree). `writeScad` builds it from the tessellation and
passes it through `walkVersions` into the context (`ScadSource.fragments`).

**Extrude.** `linear_extrude` of the 2D nodes per side, placed by the sketch
frame (`placed(frameMatrix(frame), …)`), then `operationCsg`. A distance is
`ctx.scalar` of its input; its sign and side are `absolute`, `negate`, `half`
and a `translate` along the plane's normal, so a negative distance and a
`flip`, and a symmetric sweep measured `whole` or `half`, all come out right
and stay live. Two sides are the union of a side each way. `through-all` (cut
and intersect only) is a number past `ctx.bounds()` on that side, from the
plane along the extrude direction, plus the kernel's margin. `to-object`, a
taper, a face profile and `through-all` for a new body or join go through
`ctx.unsupported`.

**Revolve.** `rotate_extrude` of the 2D nodes, each point written as
(distance from the axis, position along it) and placed so OpenSCAD's Z is the
revolve axis and its X points from the axis into the profile's half (which
keeps OpenSCAD 2021.01's x ≥ 0 rule); `flip` reverses the axis, as the
evaluator does. Every extent the evaluator takes: one side, symmetric (whole
and half), two sides and the sign, a full turn written as `rotate_extrude()`
without an `angle`. A partial side that doesn't start at the profile is the
sector turned about the axis (the placement's local Z) by its start. The
evaluator's `axisOf` is now shared (narrowed to a `GeometryReader`, which
`CsgContext` satisfies). `to-object`, a face profile and an axis out of the
plane go through `ctx.unsupported`; a profile on both sides of the axis never
reaches the hook (the evaluator fails first).

**Deviations and choices:**

- A `through-all` reads `ctx.bounds()` (every body before the feature), not
  the evaluator's explicit participants; the ADR asks for "past the model's
  bounding box", and the common automatic case matches.
- The revolve's radial direction is the perpendicular of the profile's point
  farthest from the axis; a profile across the axis is the evaluator's error,
  not the hook's.
- `export.test.ts` is untouched; the new tests are `extrude.test.ts`.

**For slice 4b (wiring the translator):** `ctx.scalar(name)` already flows
through `half`/`negate`/`absolute` and the `translate`s, so every distance,
angle and factor becomes live without a hook change; check the bracket
placement around the translator's output.

## Results, slice 4b (2026-10-16)

Built: §4–§6 wired in. Scalars are live expressions over the parameter
variables, and the parameter block is collected from the walk.

**The scalar wiring.** `ScadExpression` gained `refs` (the Extrudo parameter
names it uses); `half`, `negate`, `absolute` and the new `sum` keep them.
`scad-export/live.ts` holds `scadParameters(doc)` (`evaluateParameters`, the
document's length unit, `scadNames`) and `liveScalar(parameters)`, which the
engine's `exportScad(options)` passes as `ScadSource.scalar` along with
`ScadSource.parameters`. `ScadSource.scalar(input, { feature, input })`
writes:

- the variable of the **named model parameter** that owns the input
  (`ParameterOwner` `model`, same feature and input): `boxLen`, under
  `/* [Hidden] */` with its own translated expression;
- else `translateExpression(expr, unit, ctx)`: a result with refs is
  `{ expr, value, refs }`; no result, or no refs (a constant such as
  `10 mm + 5`), is the value as a number.

Brackets are the IR helpers' (`operand`): a cylinder of diameter `width + 2`
writes `r1 = (width + 2) / 2`; the translator strips its own outer pair, so
every helper sees a bare expression.

**`used` and `fixed`.** `writeScad` scans the written nodes (versions and the
tools they reach; not polygon or polyhedron points) for `refs`: that is
`used`. The walk records, per step, the inputs its hook read through
`ctx.scalar` **as an expression** (`Versions.reads`). `parameterUse` (in
`live.ts`) then collects, per written step:

- every expression input of a step with a mesh version among the written
  ones, and every input of a CSG step that isn't in its reads (a pattern's
  count and spacing, a box's x offset);
- following the step feature's stored references (`referencedFeatures`)
  through features that wrote no body in the walk (sketches, construction
  planes, axes, points), and on through theirs: their expression inputs and
  their driving sketch dimensions;

a named input counts as its own parameter, anything else by its expression's
references, then every parameter those refer to (`EvaluatedParameter.refs`,
transitively). Each parameter lists its features in timeline order, each
once, named as the header names them; `parameterBlock` writes the "Also sets
…, which this file holds fixed." line above the ones `used` brings in, and a
parameter only fixed things use is not written. A source without
`parameters` (tests that build one by hand) writes no block;
`ScadExportOptions.parameters` (slice 1's placeholder) is gone.

**The torus seat.** `torusSolid` places the ring by `torusFrame` with the
seat left out (the axes stay the evaluator's), then lifts it with a
`translate` along the plane's normal expressed in the torus's frame: by
`half(tube)` with the axis along the normal, by
`sum(half(diameter), half(tube))` with it in the plane. A live diameter or
tube keeps the torus on its plane in the Customizer.

**Known limits.**

- A placement that depends on another body's geometry (a box on a face of an
  extrude whose height is live, a move along an edge) is a number and not
  tracked: the parameter behind it gets no "holds fixed" note.
- A script's features (ADR-0070) write their values; the parameters a script
  reads are not listed as fixed.
- A Customizer parameter is written as its value (OpenSCAD's Customizer shows
  only literals), as slice 2 did; everything that refers to it follows.

**Deviations and choices:**

- `exportScad(options, scalar?)` keeps its second argument as a test
  override (`hooks.test.ts`'s stand-in translator checks the helpers'
  brackets on odd expressions); without it the scalars are live.
- A scalar read that came back as a number (a constant, or no translation)
  is not a read: its references, if any, count as held fixed.
- Every expression core evaluates translates today, so "an input that
  doesn't translate is its value" is tested on `liveScalar` with a name the
  context lacks, as `params.test.ts` does for the block.

**Tests** (`scad-export/live.test.ts`): most export a design, render it as
written and with a parameter overridden (`defines`, OpenSCAD's `-D`), and
compare each with the kernel recomputed at that value (volume and box,
Fine): a Customizer `width` with a hidden `wall = width / 10`; a cylinder of
`width + 2` cut from a box; `height = 2` in a cm document written as 20; a
named input `boxLen`; Move by `width`, Rotate by an angle, Scale by a
factor; seated tori, one per axis case. Without an override: the pattern and
fillet notes (and an unwritten `gap`), the sketch-dimension and
offset-plane notes, the value fallback, byte-identical output twice.
`hooks.test.ts` adds a joined Mirror copy that stays apart (a new body);
the CLI test exports a design with a Customizer parameter and gets the
kernel service's bytes.

**For slice 5 (the app):** Export Model's OpenSCAD format calls
`exportScad(options)` with the chosen bodies and resolution; the parameters
come from the marker's document, so nothing else needs passing. The guide
page should say which parameters stay live (sizes, distances, angles,
factors) and that sketch geometry, placements and pattern counts are
fixed, with the note in the file naming them.

**Acceptance (slice 6):** `scad-export/acceptance.test.ts` renders the real
file and compares it with the kernel, one test per roadmap AC bullet: AC 1
(a 60 × 40 × 15 box — a sketch rectangle extruded — with a pocket cut into
its top by a sketch on its top face and a circular pattern of six holes cut
from it) writes no `polyhedron`; AC 2 the same part with the box's four outer
vertical edges filleted first writes exactly one `polyhedron` (the filleted
version) with the pocket and the holes as `difference()` of it; AC 3 a
Customizer `height` in group `Size`, range 5…50 step 1, value 20, drives the
box's extrude distance and, rendered with `height = 35`, matches the kernel
recomputed at 35; AC 4 the same document exported twice gives the same bytes.
AC 5 (`packages/cli/src/headless.test.ts`, next to the export test) builds the
AC 1 document, exports it through `DesignJob.export({ format: 'scad' })` and
finds it byte-identical to `KernelService.exportScad`. This slice also fixes
a symmetric extrude with `through-all` (cut or intersect): it went through
`distanceScalar`, which threw "Enter a distance." and fell back to a mesh, so
`features/extrude.ts` now writes both sides at the larger of the two
`through-all` lengths, through the non-throwing `reachLength`, throwing only
when neither direction reaches anything (a new `extrude.test.ts` case cuts a
mid-plane box symmetrically through everything with no `polyhedron`).

## Amendment: Export as script offers OpenSCAD (2026-10-18)

**Decision.** *Export Design as Script…* is the code export and opens a dialog,
**Export as script**: TypeScript (today's export of the whole design through the
document API) or OpenSCAD (the §9 export). Export Model keeps its OpenSCAD format
unchanged; the two are different doors to the same `scadFile`.

- **Fields.** Language (each option with its description always shown); for
  OpenSCAD only, Bodies (the Export Model list, without "Keep components
  together") and Resolution (same control and validation). The bodies start from
  `initialBodies(bodies, selection, undefined)` on every opening.
- **Preview and Copy.** The exact text Export would write, up to 400 lines, in
  a scrolling box (`max-h-60`, both axes), then `… N more lines` only when the file is
  longer. With OpenSCAD unwritable (no kernel, no body chosen, model not current, bad
  custom resolution) there is no box: the summary says why. The text is written 120 ms after a choice changes, and a
  result a newer choice or closing has superseded is dropped (Export Model's
  meshing pattern). Export downloads that same text, never a second write; Copy
  puts all of it on the clipboard. Both are disabled while there is no current
  file (OpenSCAD only writes when the model is current).
- **Preference** `export.script`: `{ language: 'ts' | 'scad', resolution,
  deviation, angle }`, TypeScript by default; an unknown language falls back to it.
- **Shared code.** `apps/web/src/export/exportFields.tsx` holds `BodiesField`,
  `ResolutionField` and the hooks (`useBodyRows`, `useChosenBodies`,
  `useResolutionEvaluate`, `useTessellation`); both dialogs use them.
- **Order.** In the Home tab's Export group, Export as Script moves next to Export
  .extrudo, ahead of Export Model (owner, 2026-10-18): the two whole-design exports
  come first. `topbar.spec.ts` checks the order.

**Rejected.** Moving OpenSCAD out of Export Model (the owner wants both); a second
file-type step in the save dialog (the choice belongs before the file is written,
where the preview can show it).
