# ADR-0086: OpenSCAD export

- **Status:** Proposed, 2026-10-15 (owner chose "real OpenSCAD code with a
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
   suffix. Configurations are not exported.

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
