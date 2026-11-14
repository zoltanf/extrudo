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

## Amendment (S3, 2026-11-11): the shapes-only import

Home › Import, the home screen's Import card and Import Model take an
`.FCStd` file (any case), in the browser and the desktop app, and make a new
design named after the file: each final shape (decision 7) is an `import`
feature on a STEP attachment, its bodies named by the shape's label, hidden
when FreeCAD hides it, coloured and made transparent as `GuiDocument.xml`
says. No sketches, features or history yet.

### The import kernel, enforced

`KernelApi.storedShapeToStep(text, chain, options?)`
(`packages/kernel/src/stored-shape.ts`) reads the B-rep text (`readBrep`'s
checks), places it by the chain (outermost first), writes STEP with our
writer, reads that STEP back and returns the STEP with the measures of both
(solids, volume, area, tight box), every shape released before it returns or
throws. A shape with no solid comes back with no STEP, not an error. The STEP
header's time stamp is fixed, so the same shape always gives the same bytes
and copies share one attachment.

Decision 5 is enforced in code: the service refuses the call with a
`KernelError` unless it was started with `KernelServiceOptions.importKernel`.
In the app only `apps/web/src/project/kernelWorker.ts` sets it, and only when
its worker was spawned under the name `IMPORT_KERNEL_WORKER_NAME`, which only
the import's spawner (`importKernel.ts`) gives; the project's spawner names
its kernel `extrudo-kernel`, and the kernel's own and the debug worker never
set the option. Tests show a normal kernel refuses and that only the
import's spawner uses the name. (A second entry of its own, the first
version, put another 624 KB copy of the kernel's JavaScript in the build and
took the app over its 2 MB brotli budget, ADR-0100 §5.)

**Where the kernel worker starts:** inside the import's own module worker
(`fcstdWorker.ts`), as a nested worker (`importKernel.ts`). The app already
runs OpenSCAD's compiler as a nested worker under the same COOP/COEP and CSP
(`worker-src 'self'`), and the e2e spec runs under that policy. A nested
worker means the page's one `terminate()` (when the import ends, however it
ends) also ends the kernel, and a restart is a `terminate()` and a new
worker in the import's worker, with no relay through the page.

**What protects the project, and what the check is.** The read-back check
runs in the same import kernel that read the text, so it catches a wrong
conversion, not an attacker who controls that kernel. What protects the
project is that the import kernel is a separate, throwaway WASM instance in
its own worker; that only STEP text and numbers leave it, and the importer
checks their types and ranges before using them (a string STEP, whole solid
counts up to `MAX_SOLIDS_PER_SHAPE`, 10,000, finite measures; anything else
is a kernel failure, "the kernel's answer makes no sense", and restarts the
kernel); and that the project's kernel reads that STEP as it reads any STEP a
user imports.

### The check, and its tolerance

Nothing is trusted because it converted. A shape comes in only when the STEP
read back has the same number of solids as the shape as read, its volume is
within **1e-3** relative and every corner of its tight box within **1e-4 of
the diagonal + 1e-6 mm**. On the library the largest volume drift through
STEP is 1.25e-4 (one shape above 1e-4, five above 1e-5, six above 1e-6 of
291; the 99th percentile 3.1e-5), as S1 measured. The tolerance is eight
times the largest drift: room for files we haven't seen, and still far below
a lost or added piece. Three library shapes fail it: one whose volume through
STEP differs by 160 %, and two that lose their solid through STEP (as S1 found
for two stored solids).

### Failures, restarts, budgets, limits

- A conversion that throws, traps, comes back from a dead worker or runs
  over its time leaves that shape out, and the kernel is thrown away and a
  fresh one started before the next shape; a late answer from the old one is
  never used. At most **3 restarts**; after that every remaining shape is
  left out. A result that came back but fails the check costs no restart.
- **Budgets:** **60 s per shape** and **10 minutes per import**; the app's
  worker is stopped at 11 minutes. On the library (a shared, loaded machine)
  the slowest shape took 7.8 s and the slowest file 22 s.
- **Limits:** a file over 100 MB is refused before it is read; ADR-0066's
  25 MB per attachment and 100 MB per design (a shape that would pass either
  is left out); identical STEP bytes share one attachment (SHA-256 naming).
- **Left out, each with a line:** meshes (S12), empty shapes, FreeCAD's
  binary form, an entry that can't be read, no solid, a failed check, over
  25 MB, over 100 MB in the design, a kernel failure, a shape's or the
  import's time, too many restarts. The report also lists the reader's
  problems and link arrays (one copy each).
- A file with no final shape opens as an empty design, with a notice.
- **Known limit:** a text the kernel refuses counts as a failure and restarts
  the kernel, so a file with more than three refused shapes loses the shapes
  after them (none in the library). S13 revisits it.
- **Memory:** the limits apply as each shape passes, not at the end: its STEP
  text is dropped once it is encoded, a shape over 25 MB or one whose new
  bytes would pass 100 MB is left out there and then, and a copy of a kept
  file costs nothing. The bytes held never pass the design's limit by more
  than the shape at hand.
- **Names from the file** (`names.ts`): labels lose control characters, white
  space is collapsed, they are cut to 120 characters and fall back to the
  object's internal name (`cleanName`), for every body, feature and
  attachment name and the report. An attachment's file name follows the
  export's `safeFileName` rule (`< > : " / \ | ? *` as spaces, leading dots
  dropped) plus `.step`. Report details and the worker's error are cut to
  300 characters.

### Names and colours

`Design.setBody(body, { name, color, opacity, visible })` is new in
`@extrudo/api`: the API had no way to set a body's metadata (the f3d
importer dispatched `updateBody` itself). A compound's bodies are
`<feature>:0`, `<feature>:1` … named "Label", "Label 2" …. The STEP carries
neither name nor colour (the metadata does), so copies share a file.
FreeCAD's default shape colour (204, 204, 204), which 207 of the library's
383 final shapes carry, is treated as no colour: those bodies take Extrudo's
default. Transparency becomes opacity, at least 0.1.

### In a design, and the CLI

Import Model in an open design hands an `.FCStd` file to the same import as
an `.f3d`: it opens as a new design (no `import` features in the current
design). The CLI reads `.extrudo` files only, so a FreeCAD file there needs
the attachments plumbed through its file source: left for a later slice.

### The library (60 files, `corpus-shapes.test.ts`)

| | |
|---|---|
| Final shapes | 383 |
| Came in | 291, with 763 solids (the study counted 766: the three missing are the three that failed the check) |
| Left out | 85 meshes, 4 empty bodies, 3 failed checks; no kernel failure, no restart |
| Volume against FreeCAD's own | 291 compared: 14 differ by more than 1e-6, 2 by more than 1e-4, the largest 2.2e-4 |
| Box against FreeCAD's own | for the 289 not turned by a container, ours lies inside FreeCAD's (at most 4.7e-8 of the diagonal outside); FreeCAD's `BoundBox` is looser than our tight box by over 1e-2 of the diagonal for 17 |
| Moved containers | 6 shapes; FreeCAD's numbers are in the container's frame, so these check the chain's transform (the 4 not turned agree; 2 are turned, volume only) |
| Links | 13, all where FreeCAD has them (a link's own shape carries its placement, an independent check) |
| Time per file | median 0.12 s, 95th percentile 5.8 s, slowest 22 s |
| STEP | largest attachment 5.8 MB, largest design 13.2 MB |

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

## Amendment (S5, 2026-11-11): Pad, Pocket, Revolution, Groove, each checked

A PartDesign body now comes in with its history as far as that history can be
rebuilt and proven. `packages/fcstd`: `features.ts` (`decodeFeature`: the four
features as typed data, or a refusal), `bodies.ts` (`bodyChain`,
`importBodies`: the walk), `check.ts` (the comparison), `budget.ts`
(`KernelBudget`: S3's budgets, now shared by the walk and the shapes import).
Written fresh; the prototype was a reference for its rules only.

### The walk

- **Order:** the body's chain, followed back from `Tip` through each feature's
  `BaseFeature`, once (a loop, a member missing from `Group` or the file, or no
  tip ends it with `chain`). The body's own `BaseFeature` (an outside solid the
  first feature builds on) ends the chain too, and a first feature that builds
  on one is refused (`chain`): S5 builds nothing outside the body. A feature
  listed twice in `Group` is walked once.
- **Per feature:** decode (pure), add its sketch through S4's `addSketch` (once
  per sketch, with the revolve's sketch axis drawn as a fixed construction line
  through the new `AddSketchOptions.axes`, decision 8), pick the profile, add the
  `extrude` or `revolve` with **explicit participants** (the bodies this FreeCAD
  body has made so far; the first feature makes a new body), measure the stored
  shape (`measureStoredShape`, placed by the feature's container chain,
  `containerChain`, the same chain S4 flattens sketches with), rebuild
  (`rebuild`), and compare. Everything a feature adds is one transaction,
  **cancelled** when the feature doesn't hold (planes `placeSketch` made are
  forgotten again, `forgetRemovedPlanes`), so the timeline keeps only features
  that were rebuilt equal.
- **One place stops a history** (`stop` in `importBodies`); S8 replaces "stop"
  with "carry on from the stored shape" there. Reasons, a closed set
  (`HistoryStop`): the refusals (`FeatureRefusal`: `type`, `suppressed`,
  `profile`, `sketch`, `taper`, `direction`, `up-to`, `axis`, `value`, `option`,
  `no-base`) and `chain`, `limit`, `stored` (the feature's stored shape can't be
  read), `failed` (Extrudo refused it or it failed), `differs`, `kernel`,
  `time`, `import-time`, `restarts`; with a clipped detail, and the drift for
  `differs`.
- **After the walk:** a body whose every feature came in has no `import` and no
  attachment, and its bodies carry the file's name, colour and hidden state
  (`setBodies`, S3's rule). A body whose history stopped comes in as S3 brings
  it (`import`, same checks and limits), named after the body, and **one
  `Remove <body>`** takes out what was rebuilt, placed before the imports; when
  its final shape can't come in, the rebuilt part stays, named as the file names
  it. A body whose first feature can't be mapped comes in exactly as in S3.
  Everything that is not a PartDesign body is unchanged.

### What is mapped

- **Profile:** a whole sketch that S4 imported. FreeCAD's faces from it are the
  regions inside an odd number of outer loops (`AllowMultiFace`, default true as
  every library file that stores it has it) or exactly one; text regions never.
  At most 1,000 regions per sketch (`MAX_PROFILE_REGIONS`).
- **Pad / Pocket → `extrude`:** a length, two lengths (`TwoLengths`, or 1.1's
  Two sides with a length or through all on side 2), symmetric (`Midplane`, or
  1.1's `SideType`), `Reversed`, through all (Pocket). Direction: the sketch's
  normal for a pad, against it for a pocket, turned by `Reversed` and once more
  when the Extrudo plane faces the other way (`flip`). Lengths finite, ≥ 0, at
  most 10 km (`MAX_FEATURE_LENGTH`), not 0 in total.
- **Revolution / Groove → `revolve`:** an angle in (0°, 360°], symmetric,
  `Reversed` as `flip`; the axis a sketch axis (`H_Axis`, `V_Axis`), a line of the
  sketch (`EdgeN`, `AxisN`), or an origin axis of a body that is not moved.
- **Refused:** a taper, a custom direction or one from a reference, the up-to
  methods, two angles, a groove through all, `N_Axis`, datum lines and edges as
  axes, a profile that is a face or a part of a sketch, a suppressed feature, a
  Pocket or Groove first in its body, and any property it reads that is missing,
  of the wrong kind or not finite. The reader now lists the properties it left
  out as unreadable (`FcObject.unreadable`), so a `1e999` length is refused, not
  read as the default.
- **For S10:** each mapped feature records which FreeCAD property each Extrudo
  input came from (`MappedFeature.sources`) and its expressions as stored; the
  sketches' outcomes (with S4's bindings) are in the report.
- **Not verified on the library:** a partial revolution's sense (the library has
  only full turns). The tests build FreeCAD's rule from the notes (right-handed
  about the axis, `Reversed` the other way, `Midplane` centred) and Extrudo
  rebuilds it; a file that turns the other way would fail the check, not slip
  through.

### The check, and its tolerance

Both sides are measured by the same kernel code (`measureShape` in
`stored-shape.ts`: solids, volume, area, tight box): the stored shape by
`measureStoredShape` (import kernel only, like `storedShapeToStep`), the rebuilt
bodies by `measureBodies` after a `recompute`. Equal means: the same number of
solids, volume and area each within **1e-6** relative
(`HISTORY_VOLUME_TOLERANCE`, `HISTORY_AREA_TOLERANCE`), and every box corner
within **1e-4 of the stored box's diagonal + 1e-6 mm** (`HISTORY_BOX_TOLERANCE`,
S3's). Several Extrudo bodies of one FreeCAD body are added up (`combined`).

On the library, the 51 features rebuilt equal differ from the stored shape by
at most **2.5e-10** in volume (median 4e-16), **1.0e-10** in area and
**7.5e-13** of the diagonal at a box corner: both sides are exact B-rep, no
STEP between them, so the drift is rounding. The nearest feature that differs is
**1.7e-2** off in volume and **1.0e-2** in area, its box the same to 3.5e-9 (a
tapered tool, below). S3's 1e-3 would also separate them, but it would accept
a wrong body: a hole 0.5 mm wide and 1 mm deep missing from a 100 × 100 × 10 mm
plate changes its volume by 2e-6 and its area by 7e-5. At 1e-6 the margin is
4,000 times the largest drift seen, and that hole is caught by both measures: a
missing or extra piece passes only if it changes the volume **and** the area by
less than a millionth, and a hole, a slot or a boss changes the area by its
walls, which for anything a person models on a part is far above that. The box stays at
S3's tolerance because a shape's tolerance zone enlarges its box by up to its
edge tolerance (1e-7 mm on the library, more after some booleans), and the box
only has to catch a body in the wrong place or turned the wrong way, which moves
a corner by a feature's size. Every number from the kernel goes through
`saneMeasure` (S3's rule) and a rebuild's reply through `saneRebuild` (string
IDs, at most 100,000, every measure keyed by one of them); a reply that fails is
a kernel failure.

### The kernel interface

`ImportKernel` gains `measureStoredShape(text, chain)` and
`rebuild(doc, files, skip?)` → `{ ids, bodies, failed }`. The brief's
`rebuild(doc, files)` got a third argument: **`skip`**, the bodies the walk has
settled (other FreeCAD bodies), which are not measured again, so a rebuild
costs the bodies of the body at hand, not of the whole file. In
`packages/kernel`: `measureStoredShape` and `measureBodies` on `KernelApi`
(`worker-api.ts`, `browser.ts`), and `importRebuilder(api)`
(`import-rebuild.ts`), the one implementation the app's import kernel and the
Node test kernel share: it sends each attachment once per kernel, passes the
last recompute's body versions back as `have` (so a rebuild meshes only the
bodies the newest feature changed) and starts over with a new kernel after a
restart. `inspect` could not stand in for the body measure (no solid count).
The app's worker loads planegcs for `addSketch`, as the f3d worker does.

### Budgets, failures, limits

- S3's per-call time (60 s), the import's (10 minutes) and the restart cap (3)
  now cover the walk and the shapes import together (`KernelBudget`). A call
  that throws, hangs or lies restarts the kernel and stops that body's history;
  the body then falls back like any other stop. After the total budget or the
  restart cap, the rest of the file is left to the shapes import, which leaves
  it out with S3's reasons.
- What is sent per rebuild is the document; the walk adds no attachments
  (imports come after it), and the rebuilder sends a file once anyway.
- **Limits:** 500 features per body (`MAX_BODY_FEATURES`; the library's
  longest chain is 17) and 2,000 per file (`MAX_FILE_FEATURES`; the library's
  most is 28): past them the history stops with `limit`. The chain is followed
  once (a set of names seen), so a `BaseFeature` loop costs its length.
- **Hardening (review, 2026-11-11):** a rebuild's body IDs are taken only as
  `<ID of a feature in the document sent>:<whole number>`, at most 200
  characters (`MAX_BODY_ID_LENGTH`), its measures only under own keys, into a
  `Map`; anything else is a kernel failure (`saneRebuild`), and the kernel's
  `measureBodies` answers in a prototype-free record. A `work` that throws
  before returning a promise is a kernel failure with a restart, and anything a
  feature's own work throws stops that body (`failed`, clipped), never the
  import. The budget is checked before each feature's work and before each S3
  shape is decoded. Each FreeCAD feature and sketch is walked for one body per
  file: another body reaching it stops with `chain`, so a sketch is decoded and
  tried once per import (the decode is shared with `addSketch`, its new
  `decoded` option). A stored shape over the kernel's `MAX_BREP_BYTES` (32 MB,
  `MAX_STORED_BREP_BYTES` here, a test keeps them equal) is refused by the
  archive's size before it is inflated or decoded. A mapped feature keeps at
  most 64 expressions (`MAX_FEATURE_EXPRESSIONS`; the library's most on one
  PartDesign feature is 2) and counts the rest (`expressionsDropped`). A profile
  sketch may draw at most 500 curves (`MAX_PROFILE_CURVES`; the library's
  largest profile sketch draws 25, but a vent of 60 slots draws 240 and a
  plate of 250 holes 250), checked before its regions are detected;
  `profileRefs` finds a region's point from at most 8 scan lines (linear in its
  vertices; `@extrudo/sketch`'s `interiorPoint` tries every height, the square,
  8.5 s for 200 concentric circles) and tests a loop only where its box holds
  the point. Measured unloaded, one run each (`profileRefs` with the detection,
  and the process's peak memory):

  | Drawn curves | Grid of crossing lines | Concentric circles |
  |---|---|---|
  | 500 | 1.1 s, 485 MB (62,001 regions, refused by `MAX_PROFILE_REGIONS` after the detection) | 2.1 s, 410 MB |
  | 1,000 | 5.6 s, 961 MB (249,001 regions) | 7.0 s, 586 MB |
  | 2,000 | 25.6 s, 3.1 GB (998,001 regions) | 1.9 s, 928 MB (2,000 regions, refused) |

  500 is the highest whose worst cases stay under 3 s. Past it the grid is
  the region detection itself (time and memory grow with the regions, which
  grow with the square of the lines), so raising the cap needs a bound inside
  `@extrudo/sketch`'s detection, not here. The library's numbers are
  unchanged and no cap touches a library file.
- **Known limit (for S13):** the design so far is serialised and sent to the
  kernel for every feature, so a file's cost grows with features × design
  size; the feature caps, the curve and region caps and the import's time
  bound it.

### The report and the app

`FcstdImportReport.bodies`: per body its history (`mapped`: object, kind, the
Extrudo feature and sketch, sources, expressions, drift), where it stopped
(object, type, reason, detail, drift), the Extrudo bodies, the sketches'
outcomes and the outcome (`history`, `shape`, `left-out`). `fcstdNotices` says
how many shapes came in with their history and how many as bodies without,
names the bodies taken from the file's shapes with the two commonest reasons,
and says that the features rebuilt before a stop stay ahead of a Remove.

### The library (60 files, `history-corpus.test.ts`)

| | In the files | In a body's chain | Equal | Differed | Refused | Not reached |
|---|---|---|---|---|---|---|
| Pad | 70 | 41 | 31 | 1 | 1 (up to a face) | 8 |
| Pocket | 67 | 30 | 12 | 0 | 2 (up to a face, up to the first) | 16 |
| Revolution | 11 | 8 | 8 | 0 | 0 | 0 |
| Groove | 3 | 3 | 0 | 0 | 0 | 3 |
| Other PartDesign | | | | | 18 (`type`) | 28 |

- **Bodies (35):** 9 with their whole history (no `import`), 22 from the file's
  shape (19 of them after at least one rebuilt feature: 15 stopped at a fillet,
  chamfer, hole, pattern or sweep, 3 at an up-to, 1 that differs; 3 with nothing
  rebuilt, two starting from a base feature and one from a primitive), 4 empty
  bodies left out as in S3. The import makes **282 `import`s instead of 291**;
  the 348 other final shapes come in exactly as in S3.
- **The one that differs** is a pad in a 0.20 file whose stored tool is a
  frustum (it narrows by about half a degree), with no taper property in the
  file: nothing to map, and the check catches it.
- Of the features outside a body's chain, 28 pads, 36 pockets and 2
  revolutions are in files from before bodies (S12's) and 1 pad, 1 pocket and
  1 revolution are in a body past its tip; the prototype's 62 of 70 pads and 52 of 67 pockets counted those
  and carried on after a stop, where this slice stops (so later features count
  as not reached).
- Time per file: median 0.1 s, slowest 14 s (most of it S3's shapes); no kernel
  failure, no restart.

### What S6 to S9 inherit

- The walk's stop point is S8's step: there, a stop becomes an `import` of that
  feature's stored shape and a Remove, and the walk carries on with the next
  feature against it. S6 and S7 add kinds to `decodeFeature` and to
  `addFeature`; the refusal reasons stay a closed set and grow there.
- The fillets and chamfers (11 of the 18 `type` stops) are what most of the 19
  partial bodies need next, then the up-to methods (3), as the plan says.

## Amendment (S6, 2026-11-12): Fillet and Chamfer, by replay and match

`PartDesign::Fillet` and `PartDesign::Chamfer` join the features the walk maps.
`packages/fcstd`: `features.ts` decodes them, `match.ts` finds a stored element on
the rebuilt body and checks the kernel's replies, `dressups.ts` adds the feature;
the walk (`bodies.ts`) holds it like any other: one transaction, rebuilt and
checked, the one stop point. Fixtures: ten small parts we made with FreeCAD
1.1.4 through our own script (`packages/fcstd/scripts/make-dressup-fixtures.py`,
data in `dressup-fixtures.ts`), so their stored shapes and element numbers are
FreeCAD's own. All ten come in with their whole history.

### The check gets the centre of mass

A chamfer with two sizes and the same chamfer flipped have the same volume, area
and box: S5's check passes either for the other. `measureShape` now returns the
**centre of mass** (`Kernel.properties`' centroid; the origin for a shape with no
mass, on both sides alike), and a rebuilt body holds only when its centre is
within **1e-7 of the stored box's diagonal + 1e-9 mm**
(`HISTORY_CENTRE_TOLERANCE`). Several Extrudo bodies of one FreeCAD body are
combined weighting each centre by its volume.

- **The flip pairs:** two distances (2 and 4 mm on a 20 mm edge of a 10 × 20 ×
  30 box): the twins' centres are 0.0127 mm apart, 3.4e-4 of the diagonal;
  distance and angle (2 mm, 30°): 0.0015 mm, 4.1e-5. With the right flag the
  rebuild is equal to 2e-14; given the twin's stored shape it stops with
  `differs` ("the centre of mass is … away"), the test maps it so on purpose.
- **The library:** the features rebuilt equal drift at most **1.1e-10** of the
  diagonal in centre (median 1.2e-16), so the tolerance has 880 times that
  below it and sits 400 times under the closer twin. S5's results are
  unchanged by it: the same 51 features equal, the same pad differs (its centre
  is also 5.9e-3 of the diagonal off).
- **Principal moments: not added.** They add nothing the centre misses where the
  centre fails: a twin that is the right body's mirror image about a plane of
  symmetry of the part (the same two-size chamfer flipped on all four vertical
  edges of a square prism turns the prism into its own mirror image) keeps its
  centre on the axis, and a mirror image has the same principal moments. Only a
  face-by-face comparison would tell those apart; left for S13.

### Finding the edges (decision 4)

- **What FreeCAD names:** `Base` links the feature before it in the chain and
  lists `EdgeN` and `FaceN` of **that feature's stored shape**, in
  `TopExp::MapShapes` order, which `readBrep` keeps (S1); the kernel's own
  sub-shape order is the same map, so `EdgeN` is the kernel's edge N − 1 of the
  stored text placed by the base's container chain. A face stands for its edges;
  an edge is taken once and only between exactly two faces (FreeCAD's rule; it
  also leaves out an edge whose faces meet smoothly, a flag the description
  doesn't carry, so such an edge would reach Extrudo's fillet and then the check).
  OCCT rounds the whole tangent chain of an edge in FreeCAD and in Extrudo alike:
  the slot fixture names one straight edge and both run round the slot's four
  edges, equal.
- **The description** (`describeElements` in the kernel, the same code for both
  sides): per edge its curve type, length, midpoint, its two ends, a line's
  direction or a circle's axis, centre and radius, and the faces it bounds; per
  face its surface type, area, centroid, normal or axis, and its edges. The
  stored side describes only the elements named, the faces round each named
  edge and the edges of each named face; the rebuilt side every edge and face of
  the FreeCAD body's Extrudo bodies of the last rebuild.
- **The match:** a rebuilt edge's distance from a stored one is the largest of
  the midpoints' distance, the lengths' difference, the ends' (either way
  round), the centres' and radii's differences and the directions' difference
  times the length; another curve type, or ends, a centre or a direction on one
  side only, or an edge not described in detail, is no candidate. A match is within **1e-6 mm + 1e-9 of the point's
  distance from the origin** (`MATCH_TOLERANCE`, `MATCH_RELATIVE`); a face's
  area must agree to 1e-6 relative. **Exactly one** candidate is a match; none
  or several stops the history with `reference` and says which (never the
  closest of several). Candidates come from a grid of 0.01 mm cells (at least
  four tolerances) over the midpoints, the point's cell and its 26 neighbours, so
  a lookup costs a few cells, not every rebuilt edge.
- **Why 1e-6 mm:** on the library the 114 stored edges asked for were matched
  within **8.8e-13 mm**, and the nearest other rebuilt edge to any of them is
  **0.17 mm** away (0.24 mm for one of the same kind): a millionth of a
  millimetre sits six orders of magnitude from both. Two edges of a part closer
  than that in midpoint, length and both ends are the same edge.
- **The reference** is `KernelApi.reference(body, kind, index)` on the last
  rebuild, the call the app makes for a picked edge (`importReferences`), so the
  import stores what a pick would.
- **Chamfer sizes:** FreeCAD puts the first size on the first of the edge's two
  faces in the base's face order (the lower `FaceN`) and on the second with
  `FlipDirection`; the fixtures confirm both. The importer finds that face on the
  rebuilt body too (it must bound the matched edge) and gives it as the set's
  `face` input, so the choice doesn't rest on Extrudo's own face order; edges
  with different faces go in separate sets (at most `CHAMFER_MAX_SETS`, 32). A
  file from before 1.0 with two sizes or an angle has its flag toggled, as
  FreeCAD 1.0 does on opening it; no library chamfer has either mode, so that is
  read from FreeCAD's notes, not verified (the check would catch a wrong one).

### The kernel interface

`ImportKernel` gains `describeStoredShape(text, chain, ask)` (B-rep text: refused
unless the service is an import kernel, like `measureStoredShape`),
`describeBodies(bodies, near)` (the last rebuild's bodies) and `references(items)`.
`KernelApi` gains `describeStoredShape` and `describeBodies`
(`worker-api.ts`, `browser.ts`); the app's `importKernel.ts` and the Node test
kernel share `importReferences`.

- **Bounded, and linear in the body:** a description is `Kernel.describe` (one
  facade call for the whole shape) plus, per edge described **in detail**, its
  ends and circle from `edgeGeometry`, which maps the shape's edges again on
  every call. Described in detail are the stored side's edges (the named ones
  and their faces' edges) and, on the rebuilt side, only the edges whose
  midpoints lie within 4 grid cells of a stored edge's (`describeBodies`'
  `near`): every candidate of a lookup, nothing else. The first version
  detailed every rebuilt edge and was quadratic: 2,400 edges took 1 s, 9,600
  took 15 s; now a 9,600-edge body takes 0.28 s.
- **The caps hold per call, counted first** (`describeShapes`, review of
  2026-11-12): the shapes' edges and faces are counted (`Kernel.count`) before
  any is described, and the caps are shared by every shape of one call:
  **`MAX_DESCRIBED_EDGES` (20,000) edges and `MAX_DESCRIBED_FACES` (20,000)
  faces in all, `MAX_DETAILED_EDGES` (2,000) in detail in all, `MAX_ADJACENT`
  (20,000) faces round an edge or edges round a face**. Past one, every shape
  of the call comes back with its counts only, `over` (how many) and `limit`
  (which cap). So one call costs at most a description of 20,000 edges and
  2,000 `edgeGeometry` calls on shapes of at most 20,000 edges, however many
  bodies it asks for. Measured at the caps on a loaded machine
  (`stored-shape.test.ts`, `BENCH=1`): one body, 2,000 of 19,992 edges in
  detail, **7.7 s**; a stored shape, 2,000 of 19,992 asked, **7.5 s**; ten
  bodies of 1,992 edges, 200 each in detail, 1.2 s; a stored shape of 200,400
  edges turned away by the count in 84 ms. All inside S3's 60 s per call; the
  stored text's read is S1's (32 MB at most). The library's largest body a
  dress-up describes has 90 edges, the slowest description took 6 ms. Batching
  the detail into one pass over the shape needs a facade call (a new
  `edgeGeometry` over many edges): not this round.
- **A cap is a clean stop, never a kernel failure:** a reply at a cap stops
  that body's history with `edges` (the stored side) or `limit` (the rebuilt
  bodies), with a detail that says which cap, and costs no restart. A dress-up
  names at most `MAX_DRESSUP_ELEMENTS` (1,000; the library's most is 12),
  checked before any is looked at, and works on at most `MAX_DRESSUP_EDGES`
  (1,000) once its faces are counted out.
- **Every reply checked** (`saneElements`, `saneBodies`, `checkReference`):
  whole counts in range, every index and adjacency in range and each element
  once, every asked element present (stored side) or every element in order
  (rebuilt side), finite numbers, no key but the known ones (a `__proto__` key
  refuses the reply), exactly the bodies asked for, a cap only with nothing
  described and a cap of the four. Anything else is "the kernel's answer makes
  no sense": a restart and a stop, as in S5.
- **References** (`checkName`, `checkReference`): the ID must be a name as the
  kernel's builders make them, read as the kernel's `featuresOfName` reads it:
  an edge or vertex `e[face|…]` / `v[face|…]` with `@n`; a face
  `op:feature:role…` with `#n` splits, whose role may have colons of its own
  (`cap:start`, `clip:2`) and whose parts after the feature are tokens or a
  parenthesised source; a source that is itself a name has its features
  counted, one that is not (a `sketch/curve`) names none, and is taken only
  where the kernel reads no feature from it either (no colon outside brackets,
  not an edge or vertex name: `featuresOfName` takes features from a name it
  reads only in part, and such a source would name one outside the check). Only a name's
  characters (a token's, `: | ( ) [ ] # @ /`) and brackets that pair up. Every
  feature it names must be one of the document sent, and at least one the
  FreeCAD body's own mapped feature, and its kind the one asked. Core has no
  name parser (`@extrudo/api` only builds names) and the importer may not use
  the kernel outside tests, so this is a second reader of the grammar; a test
  takes every face and edge reference of real bodies (a plate with holes,
  split, patterned, then filleted, 334 names: roles with colons, nested names,
  splits, split cut faces, `@n`) and requires the same features as
  `featuresOfName` for each. A well-formed ID **over 4,000 characters or
  nested past 32 levels** is a `reference` stop with a detail, not a failure.
  The split suffixes are read from the end by hand (a regular expression there
  was quadratic on `#1#1…x`); the worst case at the length cap reads in well
  under a millisecond. The fingerprint's adjacent faces are advisory: they are
  cut to **64** (`MAX_FINGERPRINT_ADJ`; the kernel lists every adjacent face,
  and a top face with 65 holes has more), and an entry that is not a name of
  the document sent is dropped, never a reason to refuse.
- **The last rebuild is the body so far:** a dress-up is reached only after the
  feature before it held, whose rebuild was the kernel's last; the walk also
  refuses (`kernel`) if the kernel was replaced since that rebuild.

### What is refused

Closed set, worded in the app's `HISTORY_STOP`: `base` (no `Base`, or not the
feature before it in this body's chain), `element` (a name that isn't `EdgeN` or
`FaceN` with N from 1, or one past the base's count: `Edge0`, `Edge1e9`,
`Vertex1`, `Edge999999`), `edges` (none, more than the caps, more chamfer sets
than Extrudo takes), `reference` (above), `no-base` (first in its body),
`value` (a radius or size that is not finite, not above 0 or over
`MAX_FEATURE_LENGTH`; an angle outside (0°, 180°); a chamfer type it doesn't
know), `option` (`UseAllEdges`, which no library feature sets), `suppressed`.
The same element named twice is taken once.

### The library (60 files, `history-corpus.test.ts`)

| | In the files | In a body's chain | Equal | Differed | Refused | Not reached |
|---|---|---|---|---|---|---|
| Pad | 70 | 41 | 31 | 1 | 1 (up to a face) | 8 |
| Pocket | 67 | 30 | 17 | 0 | 2 (up to) | 11 |
| Revolution | 11 | 8 | 8 | 0 | 0 | 0 |
| Groove | 3 | 3 | 0 | 0 | 1 (`axis`: an edge) | 2 |
| Fillet | 19 | 13 | 8 | 0 | 2 (`failed`) | 3 |
| Chamfer | 13 | 5 | 4 | 0 | 0 | 1 |
| Other PartDesign | | | | | 9 (`type`) | 19 |

- **References:** 100 found, none missing, none ambiguous (the files name 89
  `EdgeN` and 12 `FaceN` in all; the most in one feature is 12).
- **Drift of the equal ones:** fillets at most 2.8e-10 in volume, 7.6e-11 in
  area, 6.4e-11 of the diagonal in centre (8 features: FreeCAD's OCCT and ours
  agree on the blends to rounding); chamfers 5.7e-16 (4). No fillet or chamfer
  differs, so no tolerance of their own is needed: S5's 1e-6 stays for all.
- **The two `failed`:** fillets of several short sharp edges that meet in
  corners, where rounds of three edges must blend into one corner patch. Each
  edge rounds alone; all together, our OCCT refuses the radius (its diagnosis
  says how much smaller would build), and it refuses it on the file's own
  stored base shape too, so it is the fillet's limit, not the mapping: every
  edge was found. FreeCAD's older OCCT built the corners. The stored shape
  stands in.
- **Bodies (35):** **15 with their whole history** (9 before), 16 from the
  file's shape, 4 empty left out. **276 `import`s** (282 before); the 348
  shapes that aren't bodies come in exactly as in S3. Time per file: median
  0.11 s, slowest 14 s; no kernel failure, no restart.
- **What S6 changed in S5's rows:** 5 more pockets equal and 1 groove reached
  (both after a fillet that now holds), `type` stops from 18 to 9.

### What S7 to S9 inherit

- The stops left (20): `type` 9 (MultiTransform 2, LinearPattern 1,
  PolarPattern 1, Hole 1, subtractive pipe 1, additive sphere 1, a base feature
  2), the body's own `chain` 4, up-to 3, the 2 fillets, a groove about an edge,
  the tapered pad. **MultiTransform is not in S7's list** and stops two bodies
  after 7 rebuilt features: worth adding to S7.
- S8's step would reach 3 fillets, 1 chamfer and 11 pockets now behind a stop,
  and carry the two fillets Extrudo can't build.
- S9 and S7 reuse the matcher: `describeStoredShape` with `ElementIndex.face`
  for an up-to face, `ElementIndex.edge` for a pattern direction or a groove
  axis named `EdgeN`.

## Amendment (S7, 2026-11-14): patterns, Mirrored, MultiTransform and Hole

`PartDesign::LinearPattern`, `PolarPattern`, `Mirrored`, `MultiTransform` and
`Hole` join the features the walk maps. `packages/fcstd`: `features.ts` decodes
them (typed data or a refusal of the closed set), `transforms.ts` turns a
transform's direction, axis or plane into an Extrudo reference and adds the
pattern or mirror, `holes.ts` adds the hole; the walk (`bodies.ts`) holds each
like any other feature: one transaction, rebuilt and checked against its stored
shape with S5's and S6's tolerances (none loosened), the one stop point.
Fixtures: 38 small parts we made with FreeCAD 1.1.4 through our own script
(`packages/fcstd/scripts/make-pattern-fixtures.py`; data in
`pattern-fixtures.ts`, written back into files by `pattern-parts.ts`: each
property as the object's own XML holds it, 58 distinct stored shapes once each,
runs of spaces in the B-rep text made one, 362 KB). All 35 parts this slice maps
come in with their whole history; `multi_linear_mirror`, `multi_mirror_polar`
and `hole_tapered` stop with their reasons and take the file's shape.

### What is mapped

- **Originals** become `objects: 'features'` with `{kind: 'feature', id}`
  references to the Extrudo features this walk made for them, in the order of
  `Originals`. Each must be a pad, pocket, revolution, groove or hole of this
  body that the walk has mapped; a dress-up, another transform, a feature of
  another body, one after the transform, one not in the body or the transform
  itself is a refusal (`original`). **The body's first feature** makes the body
  in Extrudo (`new-body`) and leaves no tool to replay; when the originals are
  every feature mapped so far, the first included, the body itself is repeated
  (`objects: 'bodies'`, `join`); with only some of them it is refused. The
  library's one such case (a body's first pad repeated round a turn) comes in
  equal.
- **LinearPattern** → `rectangularPattern`: `count1` = `Occurrences` (the
  original counts in both), `distance1` = `Length` with `measure1: 'extent'`,
  or `Offset` with `'spacing'` (`Mode` Spacing, 1.0+; a file without `Mode` is
  Extent); FreeCAD 1.1's second direction → `direction2` and its values, used
  when `Occurrences2` is over 1 (refused when it has no `Direction2`).
- **PolarPattern** → `circularPattern`: `count`, `angle` with `measure:
  'total'` (or the step in Spacing mode). FreeCAD spreads a whole turn without
  doubling the first instance and divides anything less by count − 1, as
  Extrudo's `angularStep` does; only −360° differs (FreeCAD divides it by
  count − 1), written as the step.
- **Mirrored** → `mirror` with `objects: 'features'` and a plane.
- **MultiTransform:** its `Transformations` are objects of the body outside the
  chain (no `BaseFeature`), so the walk never counts them; each is decoded with
  the MultiTransform and belongs to it (`owner`, one object once per file: a
  step another MultiTransform already took is a refusal). One step is that
  transform. **Linear then linear** (neither with a second direction) is one
  `rectangularPattern` with two directions. **Mirror then mirror in planes at
  right angles** is three features in one transaction, checked together: a
  `mirror` in each plane and a `circularPattern` of 2 over 180° about the line
  where they meet (the diagonal copy; for the body itself, two joined mirrors,
  the second mirroring the first's copy too). Two mirrors alone, the second
  taking the first among its features, came out right for one original and
  wrong for two (the library's two-original case differed by 2.1 % in volume):
  Extrudo's replay takes a mirror's first tool only (`previewTools[0]`). Every
  other chain (linear then mirror, mirror then polar …) is refused
  (`multi-transform`) for S8.
- **Hole** → `hole`: at the centres of the profile sketch's drawn circles and
  arcs, and its drawn points where `BaseProfileType` has OnPoints (bits:
  points 1, circles 2, arcs 4; a file without it drills at circles and arcs),
  in the sketch's order, referenced as the sketch's own points (S4's sketch now
  returns `centres`, the Extrudo point at each centre by geometry index, and
  `plane`, the Extrudo plane the sketch is on). The plane is the sketch's;
  FreeCAD drills against the sketch's normal and `Reversed` along it, so
  `flip` is `Reversed` once more turned when the Extrudo plane faces the other
  way (`mirrored`). Sizes are what the file stores (`Diameter`, `Depth`,
  `HoleCutDiameter`, `HoleCutDepth`, `HoleCutCountersinkAngle`,
  `DrillPointAngle`), never a thread or screw table. `DepthType` Dimension →
  blind, ThroughAll → through, anything else (the up-to methods) refused.
  `DrillPoint` Flat → `tipAngle` 0, Angled → `DrillPointAngle`.
  **Depth rules, as the fixtures proved them:** FreeCAD's blind depth runs from
  the sketch plane to the end of the full diameter, as Extrudo's, counterbore
  or not (read from the counterbore's floor instead, the check refuses it);
  with `DrillForDepth` it runs to the point's tip, so the importer takes the
  point off (`r / tan(angle / 2)`); read the wrong way, either is refused. A
  counterbore's depth is from the plane; a countersink's cone has
  `HoleCutDiameter` at the plane and the full angle (a stored `HoleCutDepth`
  is not used: the cone ends at the hole's diameter in both). `HoleCutType` by
  **name** where the file stores the names (1.0+: None, Counterbore,
  Countersink; Counterdrill refused); a bare index 0, 1 or 2 is those three (the
  same in every version), any later index or a screw standard's name says only
  "counterbore or countersink": counterbore first, countersink as the one
  second attempt (below). **Threaded but not modelled** is a plain hole of the
  stored diameter, the tap drill (the fixture's 5 mm for M6; the thread's 6 mm
  is refused by the check), and counts as `threadLost` (the app says how many);
  `ModelThread` (0.18: `ModelActualThread`) with `Threaded`, `Tapered` and
  `Midplane` are refused (`option`). A custom thread clearance changes only a
  value FreeCAD stores as `Diameter`, so nothing more is read for it.

### References (a direction, an axis, a plane)

Worked out in world coordinates from the file first, then written as the
Extrudo reference that **is** that line or plane, in this order:

1. **An origin axis or plane** when the line or plane coincides with one (a
   direction within 1e-9 of parallel, a point within 1e-7 mm + 1e-9 of its
   distance from the origin): a sketch on the XY plane mirrored in its V axis
   is a mirror in `origin:yz`; the polar axis of a sketch's `N_Axis` at the
   origin is `origin:z`. An origin feature the file names directly is used as
   it is, refused for a moved body as S5's revolve is.
2. **The sketch's own line or plane** when the sketch came in with this body:
   `H_Axis` / `V_Axis` as the fixed construction lines `addSketch` draws (the
   walk looks ahead at the body's transforms and their steps and asks for them
   when the sketch is added, decision 8), `EdgeN` and `AxisN` as the drawn
   line; for a mirror, `N_Axis` or the whole sketch is the sketch's plane, and
   a line's plane (through the line and the sketch's normal) is a
   `planeAtAngle` of 90° about the drawn line from the sketch's plane.
3. **A matched edge or face**: `EdgeN` (a straight edge) or `FaceN` (a flat
   face) of a feature of this body before the transform, described on that
   feature's stored shape (`describeStoredShape`), looked up on the rebuilt
   bodies with S6's `ElementIndex` (exactly one candidate; none or several stop
   with `reference`, never the nearest) and written through `references` and
   `checkReference`. Used only when the kernel wasn't replaced since the last
   held feature (`restartsAtHold`, S6's rule).
4. **Construction features** where none of those exists (the line or plane of
   a sketch that didn't come in, or a sketch's normal off every origin axis):
   construction points from the file's numbers, an `axisThroughPoints` through
   two (pointing FreeCAD's way) or a `planeThroughPoints` through three, in the
   same transaction. No new construction kind was needed.

Refused (`transform-reference`): a datum line or plane (S9), a vertex, a
whole object, a curved edge as a direction or axis, a face as a direction, a
line as a mirror plane, an edge of a feature of another body or after the
transform. A test turns step 1 off (`originFirst: false`) so the fixtures
reach the planes at 90° and the construction axis, which hold as well.

### Senses

FreeCAD steps along **the line's own direction** and turns right-handed about
it; `Reversed` (and `Reversed2`) goes the other way. The line's own direction
is a sketch axis's (the sketch frame's x, y or normal), a sketch line's start
to end, an origin axis's, and for an edge **its curve's direction, not the
edge's orientation**: in `linear_edge` and `linear_edge_y` the edge is
reversed in the shape and FreeCAD still stepped along the line's +x and +y.
The importer reads it from the stored edge's two ends in curve order
(`edgeGeometry` evaluates the curve from its first parameter to its last,
like FreeCAD's `BRepAdaptor_Curve`). Extrudo steps along its reference's
direction: a sketch line start to end (drawn as FreeCAD's, so the same), an
origin axis's, an edge's canonical direction (`describe`: the first component
over 1e-9 made positive), a construction axis's first point to its second.
Where the two disagree the distance or angle is negated (Extrudo takes negative
ones). So every sense is known from what the kernel describes: **no second
attempt is used for a sense**. For each sense (`Reversed`, an edge's direction,
the polar turn, `Reversed2`) the fixtures read the wrong way on purpose are
refused by the check (or by Extrudo, where the copies fall off the part).

### Second attempts

`holdAll` runs at most two attempts at one feature, each a whole transaction
with its own rebuild and check, the second only after the first failed with
`differs`, and never after a failure that no reading of the file changes (a
feature that touched another FreeCAD body, below) nor for a tolerance or a
reference match. It applies only to a hole whose cut type the file doesn't
name (counterbore, then countersink). `BodyHistory.secondAttempts` counts
them, `MappedFeature.secondAttempt` marks one that held so. The library: 0
(its one hole with a late index stops before a second attempt, for the reason
below).

### What a feature may not touch

A pattern's replay and a hole join or cut every body their tools meet
(`operate` with no participants: neither feature has a body list), where
FreeCAD's touch only their own body. So the rebuild after a transform or a
hole measures the other FreeCAD bodies' Extrudo bodies too (no `skip`), and
each must be as it was when last held (`lastMeasures`, the same check);
otherwise the feature stops with `differs` ("it changed a body of another
FreeCAD body"). The library has one: a through hole in one body that reaches
into another body below it. Extrudo would need a body list on `hole`
and on a replay to rebuild it (a schema change, not this slice).

### What is refused, and the limits

The closed set grows by three, worded in the app's `HISTORY_STOP`:
`original`, `transform-reference`, `multi-transform`; `limit` is now also a
`FeatureRefusal`, and S5's and S6's reasons are reused (`value`, `option`,
`suppressed`, `up-to`, `sketch`, `element`, `reference`, `kernel`). A
TransformMode of "Whole shape" (`option`; the library has none), a gap of its
own (read in Spacing mode only, as FreeCAD does: a `Spacings` entry other
than −1 or `Offset`, 0 included, or a `SpacingPattern` of more than one
entry, is `option`; the library has none; see the review round below), positions left out (`SuppressedIndices` /
`SuppressedPositions`, none in the library). Numbers through `finite` and the
reader's unreadable list: `Occurrences` a whole number from 1, lengths
finite, ≥ 0 and at most S5's 10 km, 0 refused with more than one instance,
angles within ±360°, not 0 with more than one instance. Float lists are read
from their own archive entry (`floatList` in `model.ts`, FORMAT.md), bounded
by the archive's size before inflating. **Caps of ours** (a count over one is
a clean `limit` stop before any kernel call, never a failure):
`MAX_ORIGINALS` 100 (checked before any is read), `MAX_TRANSFORM_STEPS` 16,
`MAX_TRANSFORM_INSTANCES` **500** instances times originals (every step of a
MultiTransform multiplied; a hole original counts twice per centre, below), `MAX_HOLE_CENTRES` 200 (Extrudo's `MAX_HOLES`, a
test keeps them equal). The instance cap is half of Extrudo's own 1,000
(`MAX_PATTERN_INSTANCES`) because of its worst case. Measured on the Ubuntu
machine, one run each, the whole import (`pattern-limits.test.ts`, `BENCH=1`):

| Case | At the cap | At 1,000 |
|---|---|---|
| Pockets round a whole turn, each overlapping its neighbours | 500: 20.6 s | 54.8 s (next to the 60 s a kernel call may take) |
| A grid of pockets overlapping their neighbours | 25 × 20: 12.5 s | 40 × 25: 26.2 s |
| A grid of pockets apart | 25 × 20: 1.8 s | 40 × 25: 3.4 s |
| Counterbored holes through a plate | 200: 3.9 s | |

The library's largest pattern makes 28 instances.

### The library (60 files, `history-corpus.test.ts`)

| | In the files | In a body's chain | Equal | Differed | Refused | Not reached |
|---|---|---|---|---|---|---|
| Pad | 70 | 41 | 34 | 1 | 1 (up to a face) | 5 |
| Pocket | 67 | 30 | 21 | 0 | 2 (up to) | 7 |
| Revolution | 11 | 8 | 8 | 0 | 0 | 0 |
| Groove | 3 | 3 | 1 | 0 | 1 (`axis`: an edge) | 1 |
| Fillet | 19 | 13 | 8 | 0 | 2 (`failed`) | 3 |
| Chamfer | 13 | 5 | 4 | 0 | 0 | 1 |
| LinearPattern | 9 | 4 | 3 | 0 | 1 (`transform-reference`: a datum line) | 0 |
| PolarPattern | 8 | 4 | 1 | 0 | 0 | 3 |
| Mirrored | 19 | 1 | 0 | 0 | 0 | 1 |
| MultiTransform | 10 | 10 | 7 | 0 | 1 (`multi-transform`: linear then mirror) | 2 |
| Hole | 4 | 4 | 3 | 1 (another body) | 0 | 0 |
| Other PartDesign | | | | | 4 (`type`) | 1 |

- "In the files" counts a MultiTransform's steps (19 of the linear, polar and
  mirrored objects); they are never in a chain.
- **Bodies (35): 17 with their whole history** (15 before), 14 from the file's
  shape, 4 empty left out. **274 `import`s** (276 before); the 348 shapes that
  aren't bodies come in exactly as in S3.
- **References: 101 found** (100 before; the one more is a pattern's edge),
  none missing, none ambiguous. Construction features made: 0. Second attempts:
  0. Threads lost: 1. Restarts: 0. Time per file: median 0.11 s, slowest 16 s.
- **Drift of the equal ones:** MultiTransforms at most 3.0e-15 in volume, holes
  2.1e-16, linear patterns 1.5e-15 in area, the polar pattern
  4.8e-11 in area and 3.3e-11 of the diagonal in centre; the box drifts at
  most 9.4e-10 of the diagonal (7.5e-13 before), well inside S3's 1e-4. No new
  feature differs by its own mapping, so no tolerance changes.
- **The one that differed** is the hole above (it cut another body). **The new
  stops:** the MultiTransform of a linear pattern then a mirror (S8), and a
  linear pattern along a datum line (S9).
- **What S7 changed in S5's and S6's rows:** 3 more pads, 4 more pockets and 1
  groove are equal (they come after a pattern or hole that now holds), and the
  `type` stops fall from 9 to 4 (a subtractive pipe, an additive sphere, two
  base features).

### Review round (2026-11-14)

The owner's independent review of the S7 diff found eight things; the rule
for each, as in S6: a value or a reply the importer can't use is a refusal
with the right reason before the work it would cause, a limit of ours a clean
stop. Tests: `pattern-review.test.ts` (18).

1. **The element asked for.** A description may hold more elements than were
   asked (`saneElements` allows it), so a transform's edge or face is the one
   whose index is the one asked, never the reply's first; a reply without it
   (where the count and no cap explain its absence) is nonsense: a kernel
   failure and a restart.
2. **A direction that isn't one.** A straight edge whose ends lie within
   1e-9 mm of each other, a face whose direction is shorter than 1e-9, and any
   line or plane that isn't a finite point within 10 km and a finite unit
   direction are refused (`transform-reference`) before they are compared;
   the origin and right-angle comparisons are written so that a non-finite
   number fails them (`!(x <= tolerance)`).
3. **A hole among the originals counts by its centres, twice each.** The cap
   counts instances × originals, a hole original as `HOLE_CENTRE_WEIGHT` (2) ×
   its centres (`MappedFeature.centres`), checked in the walk before the
   transform's work (`limit`). Measured (whole import, one run each): a hole
   of two centres repeated so that 500 hole cuts overlap their neighbours took
   **49.9 s**, next to the 60 s a call may take; 250 such cuts (the most the
   weight lets in, counted 500) took **18.7 s**, as the 500 overlapping
   pockets round a turn do (20.7 s); 250 cuts apart 1.0 s.
4. **The sketch axes asked for up front** (`axesWanted`) are looked for only
   in the first `MAX_BODY_FEATURES` of the chain and their MultiTransforms'
   first `MAX_TRANSFORM_STEPS` steps, and only on a reference with one
   sub-element (what the decode takes); 100,000 sub-elements are refused in
   well under a second.
5. **Construction features** go through one guard (`#construct`: Extrudo's
   refusal is a `failed` stop with the detail, never the walk's catch-all),
   and every point is checked against `MAX_FEATURE_LENGTH` per coordinate
   first (`transform-reference`, "past 10000000 mm").
6. **Extents.** A row whose instances reach past `MAX_FEATURE_LENGTH` (the
   spacing times count − 1, or the extent) is refused (`value`). **Past a
   whole turn:** FreeCAD's pattern extension (its source read as a
   description, `PolarPatternExtension::getTransformations` on main of
   2026-09) places instance *i* of a Spacing-mode pattern at the sum of the
   first *i* steps and rotates by it without a limit, so steps past 360° go
   on round and land where the angle mod 360° says (on another instance when
   it is a multiple); Extrudo's step mode rotates instance *i* by *i* steps
   too, so it maps as it is (the fixture with more instances than fit a turn
   rebuilds and reaches the check). In Extent mode FreeCAD takes 360°
   (within 1e-7) as a whole turn and divides any other angle by count − 1;
   where Extrudo would read it as a turn (−360°, the last 1e-7 short of 360°)
   the importer writes the step. The same source settles the gaps: FreeCAD
   reads `Spacings` and `SpacingPattern` only in Spacing mode (an entry ≠ −1
   is used, 0 included; an entry equal to `Offset` it turns into −1 itself;
   a pattern of one entry is not used), so the importer reads them so too and
   refuses a gap of its own only there. The S7 rule (0 as the default, read
   in every mode) was wrong: it would have taken a gap of 0 for the spacing.
7. **A hole's cut against its hole** is refused in the decode (`value`) on
   Extrudo's own conditions (`packages/kernel/src/features/hole.ts`): a cut
   diameter not over the hole's by 1e-6 mm, a counterbore depth not in
   (1e-6 mm, the blind depth − 1e-6 mm), a countersink angle not in
   (1e-6°, 180° − 1e-6°) or its cone as deep as the blind hole. Where the file
   doesn't name the cut, only the kinds that pass are tried
   (`DecodedHole.cuts`): a stored depth of 0 rules out the counterbore, and
   the countersink is then the one attempt.
8. **The other bodies, exactly.** The measure now also counts faces and edges
   (`measureShape`, `faces`, `edges`: both sides through the same code; a
   reply may leave them out, `saneMeasure` requires whole numbers when they are
   there), and a body that should be untouched must have the same solid, face
   and edge counts and its volume, area, box and centre within
   **`UNTOUCHED_TOLERANCE` 1e-12** (`untouchedDisagreement`). Measured: on the
   fixtures, every transform and hole part with a second body beside it, 37
   checks, every measure moved **exactly 0**; on the library 3 checks, the two
   untouched ones 0, the third the through hole above (5.5e-4 of the other
   body's volume). 1e-12 is far below anything a feature makes and above
   rounding should a rebuild ever reorder the arithmetic. **Finding:** a cut
   into another body under 1e-6 of its volume cannot happen in Extrudo:
   `operate` leaves a body exactly as it was when a cut would take less than
   1e-6 of its volume, so a hole whose tool clips another body by 3e-8 of its
   volume leaves it bit-identical (the test asserts the drift is 0 and the
   part holds, as in FreeCAD). The tighter check matters at and past that
   threshold, where the counts catch any cut or join: a clip of 2.8e-6 stops
   with "its solids, faces or edges changed".

The library's numbers are unchanged by the round: 17 bodies with their whole
history, 274 imports, 101 references found, no restart, no second attempt.

### What S8 and S9 inherit

- The stops left (18): `chain` 4 (the bodies' own), `type` 4, up-to 3, the 2
  fillets, the groove about an edge, the tapered pad, the hole that reaches
  another body, the MultiTransform linear-then-mirror, the pattern along a
  datum line. S8's stored-shape step would carry the MultiTransform (14
  features rebuilt before it, 2 MultiTransforms and more behind it), the hole,
  the fillets and the up-to's on.
- S9: datum lines and planes as a pattern's or mirror's reference
  (`transform-reference` names them), an edge as a groove's axis, the up-to
  methods. `transforms.ts` already resolves an edge or face by the matcher and
  falls back to construction features; a datum would be one more source of a
  world line or plane there.
- A pattern of a pattern, of a dress-up or "Whole shape" mode, and a hole or
  replay that may touch only its own body, each need Extrudo itself to change.
