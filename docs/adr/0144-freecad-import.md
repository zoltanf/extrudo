# ADR-0144: FreeCAD file import (`.FCStd`), with history

- **Status:** Accepted, 2026-11-11 (the owner, after the investigation and the
  prototype of 2026-11-10: a native importer with history; the prototype's
  code is a reference only; stored shapes come in as STEP, so the STEP writer
  is fixed instead of adding a B-rep attachment kind; the slice order below).
- **Task:** P6-25.
- **Builds on:** ADR-0083 (`.f3d` import: a pure-TS package that maps a file
  onto a design through the API, the report, "opens as a new design", import
  off the UI thread, hostile-file rules), ADR-0084 (the file's own bodies where
  the replay misses: a throwaway kernel at import, STEP attachments on `import`
  features), ADR-0066 (the `import` feature, attachments, 25 MB / 100 MB),
  ADR-0115 (the desktop's cadmpeg route, which this replaces for one format),
  ADR-0001 (heavy OCCT work behind our C++ facade), ADR-0024 (the kernel only
  in a worker).
- **Schema change:** none. A design made from a FreeCAD file is an ordinary
  design; shapes the file stores come in as STEP attachments.
- **Background:** `docs/plans/freecad-import-2026-11-10.md` (the file format in
  brief, the measurements on a 60-file library, the prototype's results).

## Context

A FreeCAD file is a zip with `Document.xml` (every object with typed
properties, links and expressions), `GuiDocument.xml` (visibility, colours)
and one OCCT B-rep text entry per shape. FreeCAD's kernel is OCCT and its
sketch solver is planegcs, the same two Extrudo uses. Two properties of the
format decide the design:

- **Every feature stores the whole body after it.** So each rebuilt step can
  be compared with the shape the author saw, and where Extrudo can't rebuild a
  step the stored shape can stand in for it.
- **A reference is an object name plus `Face6` / `Edge12`**, the N-th face or
  edge of that object's stored shape in OCCT's order (measured: 23,475
  sub-elements, no mismatch). So a reference resolves from the file alone,
  given a reader for the stored shape.

Until now the desktop app converts the format through cadmpeg (ADR-0115):
every stored shape, intermediate ones included, no history; the browser
refuses the format.

The prototype rebuilt 153 of the library's 221 PartDesign features to a shape
equal to the stored one (patterns and holes not yet mapped), found every
fillet and chamfer edge on a body that matched (146 of 146), and placed 219 of
221 sketches from the stored placement alone, 215 of them solving without
moving. FreeCAD's own recompute changes or breaks 22 of the 60 files, so the
stored shapes, not a replay, are the reference.

## Decision

1. **A native importer in its own package.** `packages/fcstd`
   (`@extrudo/fcstd`, GPL-3.0-or-later like `@extrudo/f3d`, pure TypeScript;
   dependencies `@extrudo/api`, core, sketch, storage and `fflate`; the kernel
   only in tests). It works the same in the browser, the desktop app and the
   CLI. The format is written down in `packages/fcstd/FORMAT.md`, from
   FreeCAD's source read as a description (no code taken) and cross-checked
   with cadmpeg's FCStd specification (CC BY 4.0, credited there).
2. **Three layers.** `readFcstd(bytes)` decodes the archive into plain data
   (objects, properties, sketches, the stored-shape entries) and knows nothing
   of Extrudo. The mapper writes a design through `@extrudo/api`. Everything
   that needs geometry goes through a small interface the caller supplies
   (`ImportKernel`: rebuild the design so far, measure and describe a body,
   describe a stored shape, give a persistent reference for the N-th face or
   edge of a rebuilt body, turn a stored shape into STEP). The app implements
   it with a throwaway kernel worker, tests and the CLI with a kernel in Node.
3. **The kernel takes part in the import, step by step.** After each mapped
   feature the importer rebuilds the body and compares it with the shape the
   file stores for that feature (volume, area, tight bounding box). Equal: the
   feature stays, editable. Different, failed or not mappable: **the stored
   shape wins** and the body carries on from it (decision 5). Nothing is
   trusted because it mapped without an error.
4. **References by replay and match.** `EdgeN` / `FaceN` is taken on the
   referenced object's stored shape, described by its geometry (kind, place,
   size, direction) and looked up on the body Extrudo has rebuilt at that point
   of the timeline; the match is written as Extrudo's persistent reference
   (the topological-naming service), never as an index. Exactly one candidate
   is a match. None or several: the feature is not guessed at, it becomes a
   stored-shape step with a note. FreeCAD 1.0's element maps are not read: no
   file needed them, and old files have none.
5. **Stored shapes come in as STEP.** The import's kernel reads the B-rep
   text (`readBrep`) and writes STEP with the existing writer; the STEP is an
   attachment on an `import` feature, as ADR-0084 does. A step the importer
   can't rebuild becomes: one Remove of the rebuilt body, one `import` of the
   stored shape, named after the feature. **B-rep text is read only by the
   import's throwaway kernel**: it never reaches the project's kernel and is
   never stored in a design, so a design holds only STEP that Extrudo wrote.
6. **`readBrep` in the facade** reads OCCT's B-rep text as stored: nothing
   healed, sub-shapes in the text's order (that order is what makes decision 4
   work). The TypeScript wrapper passes a number with a long integer part in
   its short form (OCCT's reader in this build never returns from a
   hundred-digit number, which old files contain) and refuses text over a
   size limit or without the format line. FreeCAD's binary shape form (a user
   setting, none seen) is not read; such a file imports without those shapes
   and says so.
7. **What a file's final shapes are** (for the shapes-only step and for what
   is shown): each PartDesign body's own shape, each top-level object no other
   object uses, one copy per link, and the meshes; never a feature's
   intermediate state or a tool shape. Names, visibility and colours come from
   the two XML files.
8. **Sketches from what the file stores:** the solved geometry, the
   constraints and the solved placement (no face lookup is needed to place a
   sketch). A constraint is kept only if the drawn geometry satisfies it, as
   the f3d importer does; references to the sketch origin and its axes become
   importer-drawn fixed construction geometry.
9. **The app treats it like an `.f3d`:** Home › Import and the home screen's
   Import card take `.FCStd` in the browser and the desktop app, make a new
   design, and show the same kind of report (what came in editable, what came
   in as a stored shape and why, what was left out). The work runs off the UI
   thread under a time budget; a check that fails or runs out of time leaves
   the import as far as it got, with a notice. The desktop's cadmpeg route no
   longer handles this format.
10. **Hostile files.** Every reader stays linear in its input, as ADR-0083's
    amendments require: the zip is inflated streaming with size, ratio and
    entry-count limits; the XML reader has no DTD or entity support and caps
    depth and size; numbers go through `finite`; attachments keep ADR-0066's
    limits; the kernel steps run under time budgets.
11. **Test files.** The public repository holds only files we authored:
    hand-written documents and shapes made by our own scripts. The 60-file
    library stays private and outside the repository; `FCSTD_SAMPLES=<dir>`
    runs `corpus.test.ts` over it and `FCSTD_REPORT=<file>` writes what each
    file left out, as `F3D_SAMPLES` does. No library file, file name or content
    goes into the repository.
12. **First version's scope:** PartDesign (Pad, Pocket, Revolution, Groove,
    Fillet, Chamfer, linear and polar patterns, Mirrored, Hole), the Part
    workbench's primitives and booleans, parameters (spreadsheet aliases,
    VarSets, expressions that Extrudo's language can hold), and the
    stored-shape fallback for everything else. Later, by demand: profiles from
    2D Draft objects, sweeps along a helix, a pattern of a pattern, live
    links, assembly joints. BIM, FEM, drawing and CAM objects only ever
    contribute their solids.

## Slices

Each is its own pull request with its own check on the private library.

| | Slice | Needs |
|---|---|---|
| S1 | Kernel: `readBrep` (limits, docs, tests) and the STEP writer fix for a shape whose root carries a location | |
| S2 | The reader package: archive, XML, object model, final-shape rule, `FORMAT.md` | |
| S3 | Shapes-only import, end to end: final shapes as STEP attachments with names, colours and visibility; the app flow and report; replaces the cadmpeg route for this format | S1, S2 |
| S4 | Sketches: geometry, constraints, placement | S2 |
| S5 | Pad, Pocket, Revolution, Groove, each checked against its stored shape | S3, S4 |
| S6 | Fillet and Chamfer by replay and match | S5 |
| S7 | Patterns, Mirrored, Hole | S5 |
| S8 | The stored-shape step in the middle of a body | S5 |
| S9 | Projected geometry in sketches, up-to-face, reference axes | S6 |
| S10 | Parameters and expressions | S4 |
| S11 | Part workbench: primitives and booleans as a timeline | S5 |
| S12 | Structure: part containers, links as copies, files from before bodies existed, meshes | S5 |
| S13 | User guide page, a second hostile-file pass | all |

The STEP writer fix was planned for S8. It moved to S1 because the
shapes-only import (S3) writes STEP too: about 190 of the library's 1,012
stored solids lose their solid on the way through today's writer.

## Rejected

- **Staying with cadmpeg** for this format: desktop only, no history, and the
  intermediate shapes arrive as bodies (hidden since ADR-0066's amendment of
  2026-11-10, but still there).
- **A FreeCAD add-on that writes `.extrudo`:** users would need FreeCAD and
  the add-on; it is not "open the file".
- **A B-rep attachment kind**, so stored shapes skip the STEP round trip: a
  document-format change, and the project's kernel would then read third-party
  B-rep text for the life of the design. Fixing the writer is small and keeps
  decision 5's boundary.
- **Building on the prototype's branch:** it was written to measure, with the
  kernel called directly and no limits on input. Its numbers and its rules
  (directions, sides, tolerances) carry over; its code is rewritten slice by
  slice.
- **A B-rep text parser in TypeScript** to avoid the kernel at import: a second
  implementation of OCCT's curve and surface types, and matching still needs
  the rebuilt body, which only the kernel has.
- **Trusting a replay without the check**, or preferring the replay where the
  two differ: FreeCAD itself rebuilds 22 of the 60 library files differently
  from what they store.

## Consequences

- The browser opens FreeCAD files, with history where the features map and
  the author's exact shapes where they don't.
- Importing starts a kernel and rebuilds after each feature, so it takes
  longer than an `.f3d` import; the budgets of decision 9 bound it, and S3 and
  S5 measure it on the library.
- After a stored-shape step in the middle of a body, the features before it
  stay in the timeline but no longer shape the body (in the prototype 8 of 80
  features stayed live in the bodies that needed one). Mapping the common
  features matters more than the fallback, which is why S6 and S7 come before
  S8.
- The kernel gains a second reader of third-party text. It is reachable only
  from the import's throwaway kernel (decision 5).
- Known gaps met in the prototype, each for its own slice or issue: a join
  refuses tools that don't touch the target, where FreeCAD keeps both solids;
  no sketch plane from an arbitrary frame; no cone primitive; extrude "to
  object" is not FreeCAD's "up to first" for a sketch on the body's own face.

## Amendment (S1, 2026-11-11): `readBrep`'s checks, and the STEP writer

### What `readBrep` checks and refuses

The text comes from third-party files, so what must hold (decision 5) is: a
bad text ends in a `KernelError` or a shape, in bounded time, with no shape
left behind and the kernel usable for the next call.

- **Before the heap** (`Kernel.readBrep`, a linear scan): more than
  **`MAX_BREP_BYTES` = 32 MB** of UTF-8 (the library's largest stored entry
  is 4,357,460 bytes, of 1,894 entries; none in FreeCAD's binary form); a
  table count (`Locations` … `TShapes`) that isn't a plain number or exceeds
  half the text's length (every entry takes two characters or more); a word
  of 200 characters or more (OCCT copies words into 255-byte buffers);
  `nan`, `inf` or an exponent over 308. The short form of an 18+-digit
  integer part stays as it was.
- **In the facade**: `CheckedShapeSet`, a `BRepTools_ShapeSet` that reads
  ahead and puts the stream back: the `TShapes` count; per shape, its flags
  and its sub-shape list, which must end in `*`, with every reference naming
  a shape already read and the parts nesting at most 256 deep; the root
  reference likewise. The stream throws on a failed read. After the read,
  every non-degenerate edge needs its 3D curve, every pcurve and surface
  record its curve or surface, every face a surface (or a triangulation).
  Refusals say what is wrong in plain words.

### What the hostile tests found

`read-brep-hostile.test.ts` damages the box text of `read-brep.test.ts` in
94 ways (each run in its own process, with a 30 s kill, to find the hangs).
What OCCT did before, and what stops it now:

| Damage | OCCT before | Now |
|---|---|---|
| Cut off at a section header or just after one | refused | refused |
| Cut off in the middle of `TShapes` | **never returned** | the stream throws |
| A table count of -1, -2^31 or 0 where entries follow | refused | refused |
| A table count of 10^9 or 2^31 | **25 s to refuse, or never returned**; `TShapes`: **out-of-bounds read** | the scan |
| A curve or surface index of 0, one past the end, 10^9, -1 | a shape that **traps** on its first check | refused after the read |
| A pcurve index of the same | a valid shape (OCCT makes the pcurve on a plane) | the same |
| A location index past the table | a valid shape (OCCT's lookup is checked) | the same |
| A sub-shape or root index of 10^9 | **out-of-bounds read** | `CheckedShapeSet` |
| A sub-shape index of 0, one past the end, -1 | refused | refused |
| An unknown curve, pcurve, surface or shape type | refused | refused |
| A B-spline degree of 10^9 | a shape that **traps** | refused after the read |
| A B-spline knot count of 10^9 | **trap that leaves the kernel broken** | the stream throws (the first read past the text) |
| A B-spline pole count of 10^9 or -1 | **out-of-bounds write** | **not stopped** (below) |
| `NaN`, `inf`, `1e999` as a coordinate or tolerance | a shape (invalid for `inf`) | the scan |
| A location that refers to itself or to a later one, a power of 10^9, a singular matrix | a shape | the same |
| 1,000 nested compounds | a shape | the depth limit (deeper than 256) |
| 10^5 nested compounds | **stack overflow** | the depth limit |

**Not stopped:** OCCT sizes a B-spline's pole array from the count in its
record before it reads a pole, and the poles it reads then go past the array.
Only a reader of every curve and surface record could tell which number is
such a count: a second B-rep parser, which the rejected list rules out. Those
two tests are `it.skip`. Within the import they cost the throwaway kernel (decision 5),
which the import must then replace, and the time budget of decision 9 covers
the rest (S3).

### The STEP writer

185 of the library's 1,012 stored solids (186 in this run) came back from
`writeStep` → `readStep` as faces with no solid. The cause: `stepShape()`
(ADR-0034's third amendment) rebuilt a face with a reversed wire from the face
an explorer gives, which carries every location above it, and added the
face's own wires, relative to the face, to that located copy;
`BRep_Builder::Add` moves a child by the inverse of its parent's location, so
the wires moved (or, for an identity location, sat under a location OCCT no
longer finds the edges' pcurves by). The fix rebuilds the bare face and gives
it its location back (ADR-0034's fourth amendment). A design made in Extrudo
can't meet it (that amendment says why), so it matters for imports.

Library, stored solids written as STEP and read back: **186 lose their solid
before, 2 after**. The 2 are zero-thickness boxes (FreeCAD's own volume 0, a
flat bounding box), which a STEP reader drops; there is nothing to import.

Of the 1,010 that keep their solid, 14 differ in volume by more than 1e-6
relative (the largest 1.3e-4; 10 of them among the 184 the fix brings back,
one an invalid shape) and 6 in face count (all 6 already before). S3 compares
what it imports with the stored shape and will show which of those matter.

### The library through the checked reader

All 1,784 non-empty stored shapes go through `readBrep` in 9.6 s (the
slowest 450 ms, the largest 4.4 MB). Two are refused, "an edge lacks its
curve": stored shapes that are a single edge with no curve at all (an empty
`Curves` table), so there is nothing to show. The first run of the checks
refused 29 more, every one for a degenerate edge's null 3D curve (a sphere's
pole), which is legitimate; the check allows it since.

## Amendment (S2, 2026-11-11): the reader package

`packages/fcstd` has its first layer: `unzipFcstd`, our own XML reader,
`readFcstd` and `finalShapes`, written fresh to the rules of ADR-0083's
hostile-file amendments (the prototype was a reference for the rules only).
The format as read is in `packages/fcstd/FORMAT.md`.

- **Limits, set from the library with room:** 20,000 entries (largest file
  1,657), 128 MB per entry (largest 6.3 MB, a `Document.xml`), 512 MB declared
  in total (largest file 25 MB), 500 to 1 per entry (highest 145; deflate's
  ceiling is about 1,032), stored and deflate only. ZIP64, encryption and
  multi-disk archives are refused: FreeCAD writes none of them. Entries are
  inflated only when asked for, so a file's element maps and side lists cost
  nothing. XML: 256 levels (library 9), 256 attributes per element (17),
  4 M elements (55,138).
- **A tree, not events.** The model needs two passes over the objects (types
  in `Objects`, properties in `ObjectData`) and looks properties up by name.
  The library's largest `Document.xml` (6.3 MB) parses in about 80 ms into a
  27 MB tree (34 MB with the model on top); the whole read of that file,
  `GuiDocument.xml` included, about 0.3 s, and the slowest file read plus its
  final shapes about 0.4 s. Events would save the tree's memory and cost a
  second reader shape for no measured need.
- **Values by element.** A property is decoded by its value element, not its
  declared type (FreeCAD retyped properties over the versions). Unknown
  elements are kept raw and counted: in the library only three display-only
  types (column widths and row heights, 5 each, and the sketcher's layer list,
  71).
- **Not read yet:** sketch geometry and constraints stay raw records (S4), mesh
  kernels, colour lists past the first colour, list side entries, element
  maps, link arrays (one instance and a problem), links to other documents,
  the binary shape form.
- **Library numbers** (`FCSTD_SAMPLES`): all 60 files read; 2,547 objects,
  221 sketches and 1,784 non-empty stored shapes, equal to the investigation's
  census per file; 383 final shapes (35 bodies, 14 chain tips, 236 other
  shapes, 13 links, 85 meshes; 27 hidden), equal to the study's count per file
  and in hidden ones. No problems recorded on any library file.
- **Solid check without a kernel.** The final-shape rule needs "has a solid"
  for objects outside bodies; the study took it from FreeCAD's own counts. The
  reader looks for a solid record in the B-rep text's shape table
  (`brepHasSolid`), one forward scan, no parsing; it selects the same objects.

## Amendment (S4, 2026-11-11): sketches

`packages/fcstd` turns a sketch object into an Extrudo sketch through the API:
`decodeSketch` (`sketch-decode.ts`) reads the geometry and constraint records
into typed data, `sketchFrame` and `placeSketch` (`sketch-place.ts`) choose the
plane, `mapSketch` (`sketch-map.ts`) draws and vets, and `addSketch`
(`sketches.ts`) does one sketch and returns plain outcome data for S5.
Written fresh; the prototype was a reference for the rules only.

- **Placement.** The frame is the stored `Placement` times the placements of
  the containers that move what they hold (bodies, parts, origins, coordinate
  systems, PartDesign booleans, assemblies; folders pass through), outermost
  first: the sketch lands where FreeCAD shows it, in world coordinates. The
  frame becomes an origin plane when its normal is along one's (mirrored when
  it points against it), that plane moved along its normal when the origin is
  off it, or a plane turned about an origin axis from the origin plane through
  it (moved likewise), as the f3d importer does. A frame tilted off every
  origin axis gets no plane and the sketch is not imported, with the reason:
  never a guessed plane. In the library that is the 2 tangent-plane sketches.
  A frame that is not a finite position and a unit rotation (container
  placements that add up past the largest number, a rotation of all zeros) is
  refused before a plane is looked for.
  **Containers with a placement of their own** are applied, not kept: Extrudo
  components carry no transform yet (ADR-0081), so the world frame is the
  only one that puts the geometry where the author saw it. 101 of the 221
  sketches sit in a container, 21 in one that is moved; 4 of those are turned
  in their plane by it, so their horizontal and vertical constraints have no
  Extrudo counterpart as such (below).
- **Geometry.** Lines, circles, arcs, points and plain B-splines (not
  periodic, all weights 1, clamped knots) are drawn through the 2D map; a
  mirrored map draws an arc from its other end, so it still runs
  counter-clockwise. Ellipses, arcs of ellipses, other conics, rational or
  periodic B-splines, helper geometry (pole circles, knot points) and
  zero-length lines are left out and counted, and so is every constraint on
  them. The construction flag is read in each version's form.
- **Constraints**, by FreeCAD's table: coincident, horizontal and vertical (a
  line or two points; which is which follows the map, so a swapped frame
  swaps them; in a frame turned in its plane a level line becomes parallel to
  the drawn sketch axis, point pairs and X/Y distances are left out), parallel,
  tangent (two curves; a joint as coincident + tangent or, for two lines,
  collinear; a point on a curve as point-on-curve + tangent), distance (a
  line, two points, a point and a line), X/Y distance (a line, two points, a
  point's coordinate from the origin), angle (with `supplement` when a
  direction is taken from a line's end; 0° or 180° as parallel), perpendicular
  (two lines; a line and a circle as the line through its centre; at a joint
  with a coincident), radius, diameter (an arc's as a radius), equal, point on
  object, symmetric about a line, symmetric about a point when the two points
  are one line's ends (as a midpoint), block (as fix). A reference dimension
  comes in driven. A FreeCAD name becomes the dimension's parameter name when
  it is a free, valid one. References to the origin and the two axes are
  fixed construction geometry the importer draws (decision 8), kept only when
  a kept constraint uses them.
- **Vetting** follows the f3d importer (ADR-0083): a constraint goes in only
  when the drawn geometry satisfies it (1e-6 mm, 1e-9 in sine or cosine,
  1e-7°); the sketch is solved; what the solver calls redundant or
  conflicting comes out, the latest first, one per component and round; while
  a solve still moves a point or a radius by more than 1e-6 mm, each
  candidate on what moved is tried out alone and the one without which the
  sketch moves least comes out (the latest of equals; latest-first alone
  took out 18 innocent constraints on the library before the culprit, this
  takes out 4). A constraint stated twice is redundant without asking the
  solver. Without a solver no constraint goes in. Every FreeCAD constraint
  gets one outcome: `mapped`, or `unreadable`, `external` (S9), `geometry`,
  `internal`, `unsupported`, `inactive`, `mismatch`, `overconstrains`,
  `moves`, `limit`, `failed` or `unchecked`. Expressions on constraints are
  not evaluated: the stored number goes in and the binding (sketch,
  constraint index, name, expression, the dimension that holds it) comes back
  for S10.
- **Limits** (from the library, with room): 10,000 curves per sketch (largest
  28), 20,000 constraints (71), 1,000 poles per B-spline (3); a sketch over
  one is not imported. Vetting takes the first 1,000 constraints
  (`MAX_CANDIDATES`, f3d's), at most 64 solve rounds (`MAX_VET_ROUNDS`), after
  which everything still in trouble comes out at once, and at most 256 trial
  solves. Every step is linear in the sketch's size.
- **Library numbers** (`FCSTD_SAMPLES`, `sketch-corpus.test.ts`): 219 of 221
  sketches placed (97 on an origin plane, 121 on an offset plane, 1 on a plane
  at an angle; 27 mirrored; FreeCAD's axes on Extrudo's 207, swapped 7, turned
  5), as the prototype. Constraints, on the placed sketches' 2,984 (the base
  the prototype used; 3,114 over all 221): **2,744 mapped (92.0 %)** against
  the prototype's 2,784, which mapped without vetting. The difference: 35 the
  solver calls redundant (FreeCAD saves redundant sets; the prototype saw the
  same 18 sketches with redundancies) and 4 that move (one per sketch of the
  prototype's 4 moving ones, the stored arc centre 1e-5 mm off square under a
  joint), now left out; 2 X/Y distances in the moved part's turned frames left
  out, which the prototype read in the part's own frame; 1 level line in a
  turned frame now kept as a parallel. Left out: 94 internal (B-spline helper
  ties), 91 external, 35 overconstraining, 16 unsupported (14 point
  symmetries, the 2 X/Y distances), 4 moving. **Nothing kept moves**: the
  largest displacement after the final solve is 6e-8 mm (the prototype's 4
  movers went up to 1.4e-5). 96 sketches come in fully constrained. 44
  bindings, every one on a mapped dimension. The stored placement equals
  FreeCAD 1.1's own for 219 sketches (the other 2 are 0.14 back-side
  sketches FreeCAD re-attaches), and the 2D map puts every sketch point where
  FreeCAD's frame does to 1e-11 mm. All 221 import in 0.8 s, the slowest
  in 44 ms.
- **Gaps met, for later slices:** a plane from an arbitrary frame (the 2
  tangent-plane sketches; also what would keep horizontal/vertical in a frame
  turned in its plane); symmetry about a point that isn't a line's middle (14);
  arc length, angle of an arc, via-point tangency and angles, point on a
  B-spline; ellipse arcs, rational and periodic B-splines (none in the
  library); a component with a transform (ADR-0081), so a moved body's
  sketches could stay in its frame.
