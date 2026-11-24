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

An independent review of the S7 diff found eight things; the rule
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

## Amendment (S8, 2026-11-14): the stored-shape step in the middle of a body

A PartDesign body no longer ends its history at the first feature that doesn't
hold: the stored shape of that feature takes the rebuilt body's place and the
walk carries on from it (decisions 3 and 5). `packages/fcstd`: `bodies.ts`
(`stop` now starts or extends a run, `ensureBase`, `applyStep`, `undoStep`, one
check for features and steps), `shapes.ts` (`convertStored`, the one conversion
of a stored shape, shared with `importShapes`; `addStepAttachment`,
`attachmentBytes`). Fixtures: ten small parts we made with FreeCAD 1.1.4 through
our own script (`packages/fcstd/scripts/make-step-fixtures.py`; data in
`step-fixtures.ts`, 26 distinct stored shapes once each, spaces collapsed, 238 KB,
written into files by S7's `pattern-parts.ts` with `STEP_FIXTURES`).

### The step

When a feature doesn't hold (a refusal of the closed set, a failed or differing
rebuild, a kernel failure or a call over its time), its own transaction is
cancelled and it **joins a run**: the features since the last one that held.
Nothing is converted yet. When the next feature has decoded and is about to be
tried (`ensureBase`, after `decodeFeature` and before anything else), the run's
**last** stored shape comes in, in one transaction: a `remove` of the FreeCAD
body's Extrudo bodies so far, named `Remove <body>` (none when it has none: a
step first in its body), and an `import` of that stored shape as a STEP
attachment, named `Import <feature>`, through S3's conversion and checks
(`convertStored`: the STEP read back has the solids, volume and box of the shape
as read, at most 25 MB, the design under 100 MB). The design is rebuilt with the
step's file, and the import must measure as the stored shape does with **the
history check's tolerances** (`historyDisagreement`, 1e-6) and leave every other
FreeCAD body's bodies exactly as they were (S7's `untouchedDisagreement`; the
step's rebuild measures them all). Then the feature is tried on it.

- **A run is one step.** A feature tried on a step that fails too joins the run,
  and the step **moves forward**: before the next feature is tried, its import
  and attachment are replaced by the later shape's in one transaction (the
  attachment goes when no other import uses it; the Remove stays). So
  `two_in_a_row` (Draft, Thickness) is one step of the Thickness's shape and the
  Draft's is never converted; `step_then_step` is two steps.
- **A shape that can't come in** (stored entry missing, empty, binary, over
  32 MB, not a shape, no solid; a conversion that fails or fails S3's check; a
  step that fails its own check): the next feature joins the run untried, and the
  run reaches on to the next feature whose shape can.
- **The run reaches the tip** (or the body ends inside a run): a step written for
  that run is taken back (`undoStep`: its import, its Remove and its attachment
  removed, the body's bodies and the last rebuild's as before it), and the body
  ends as before S8: `stop` is the run's first feature with its reason, the
  shapes import brings the body's final shape in after a `Remove <body>`, named
  after the body (if taking the step back fails, the review round's point 3).
  One path, the shapes import's, as before: `last_unmapped`,
  `nothing_after` and every stop test of S5 to S7 come out with the same features
  and report. S5's to S7's tests pass unchanged but one: S7's "an original that
  comes after it" (a pattern repeating the mirror after it, then that mirror) now
  steps over the pattern and the mirror holds on its shape. The report's
  `stop` gains `run`: the run's later features, each with why it didn't hold
  (absent when not tried), when there are any.
- **What ends a body however its features go on:** its own `chain` problems, the
  walk's feature caps (`MAX_BODY_FEATURES`, `MAX_FILE_FEATURES`), the budget
  (`restarts`, `import-time`), and S8's own caps (below). A feature's own `limit`
  refusal (a pattern's instances, a profile's curves) is a step like any other
  refusal. So is `no-base` (a pocket first in its body: its stored shape becomes
  the first step).
- **Second attempts** (S7's hole cut) come first: a feature becomes part of a run
  only when no attempt holds.

### After a step

- **Names, colours, visibility:** a body whose last features hold has no final
  import; its last bodies (the step's import's, or what the features after it
  made) get the file's name, colour and hidden state (`setBodies`, S3's rule), as
  a body with its whole history. A body that ends on its final shape is S3's.
- **The features before a step stay in the timeline**, sketches included, ahead
  of its Remove (the consequence above); they no longer shape the body. The
  timeline of `mid_draft`: Sketch, Pad, the pocket sketch's plane and sketch,
  Pocket, `Remove Part`, `Import Draft`, the second pocket's sketch, Pocket001,
  Fillet (asserted, and `step_then_step`'s twelve).
- **References after a step** (`own()` in the walk): a reference must name the
  last step's `import` or a feature that held after it (every mapped feature when
  there is no step). A superseded step's import and the features before the last
  step don't count: a reply naming only them is nonsense (a restart and the
  feature doesn't hold). `mid_draft`'s fillet names an edge of the import;
  `step_then_step`'s names the second import and never the first.
- **A pattern of a feature from before the step** replays that feature's tool
  onto the import (a replay cuts or joins every body it meets) and **holds equal
  to FreeCAD's**: `pattern_of_earlier` (a row of a pocket from before a Draft)
  drifts under 1e-9 in volume. FreeCAD repeats the pocket's own tool shape on the
  drafted body too, so the two agree. Mapped.
- **S7's "the originals are every feature so far" rule:** after a step the body
  is the stored shape's, not its first pad's, so a pattern or mirror that repeats
  the body's first feature after a step is refused (`original`, "a stored shape
  has taken the body's place since"); `bodyMaker` is the feature that made the
  body only while no step was taken.
- **The walk's invariants across a step:** a step's commit sets `known`, `mine`,
  `lastMeasures` and `restartsAtHold` as a held feature does (so a dress-up or a
  matched reference after it describes that rebuild), and a step taken back
  restores `mine` and `known` and sets `restartsAtHold` to none. Two bodies in a
  file, either first: a step, two steps and a step that moves forward leave the
  other body exactly as it was (every untouched check moved 0); a mirror after a
  step that cuts the other body doesn't hold (S7's check), joins a run and the
  body ends on its final shape.

### Limits (hostile files)

- **`MAX_BODY_STEPS` 8** steps per body (the library's most is 1). A ninth ends
  the body with `limit` ("more than 8 stored-shape steps"): its 8 steps stay, and
  the body's final shape comes in after a Remove of its last bodies.
- **`MAX_STEP_TEXT_BYTES` 256 MB** of stored text converted by steps per import.
  S3's per-shape limits bound one conversion; a total is needed because a run
  whose tried features all fail converts once per feature tried (the step moves
  forward each time), so without it the work is bounded only by the clock. 256 MB
  is the step cap times the 32 MB a shape may be. Over it the body ends with
  `limit`. Over either cap, `stop.run` keeps the run with its reasons.
- **One conversion per run:** a stored shape is converted only when a feature
  after it is about to be tried, and a run's earlier shapes never are. Measured
  (Ubuntu machine, loaded, one run each): 2,000 features, a run of 1,996
  unmappable ones between a pocket and a pocket, **one conversion, 0.46 s**;
  1,998 unmappable features to the tip, no step conversion (only the final
  shape's); a body at the step cap (8 steps, a pocket on each) **1.3 s**; a run of
  eleven tried features that each fail, eleven conversions, 0.7 s. The library's
  largest stored shape (4.4 MB of B-rep) as a step: **14.8 s** for the whole
  import (its conversion, the rebuild with its STEP, the feature tried on it), and
  29 s with two such conversions; at the caps a body is bounded by S3's 60 s per
  call and the import's 10 minutes.
- **Hostile tests** (`step-hostile.test.ts`): the above; a stored shape over
  32 MB, missing, not a shape, or without a solid in the middle (the run
  extends); a kernel that lies, throws or hangs in a step's conversion or in the
  rebuild after it (one restart, the run extends, the body carries on); a rebuild
  that measures the import wrongly (a failed check, no restart); a conversion that
  always fails (three restarts, then the body ends as before S8, with nothing of a
  step left); a reference naming only a superseded step's import (refused); a
  fillet whose base is before the last step (`base`).

### The report and the app

`BodyHistory.steps`: per step its run's features (internal name, cleaned label,
type, and why each tried one didn't hold), the first one's reason and detail, the
feature whose shape it holds, its `import` and Remove, and how many mapped
features came before it (`after`); `heldAfterLastStep`. `outcome` keeps its three
values. `fcstdNotices` counts a body with steps and live features after them
apart, so the first notice still adds up to the file's shapes, and gives such
bodies their own line. The sentences:

- "Imported from the FreeCAD file: *n* of *m* shapes, *a* with their history, *b*
  with part of their history and *c* as bodies without history." (each part only
  when it isn't 0; "its", "a body" for one), and when every body that came in took
  a step, "…, with part of its history (sketches and features)."
- One body: "Rebuilt on the file's own shape part way through: *Name*, because
  *reason*. The features after that point come in with their history; the ones
  before it stay in the timeline but no longer shape the body." Several: "Rebuilt
  on the file's own shapes part way through: *A*; *B*. Most often because
  *reason*, or *reason*. … no longer shape the bodies."
- When every step of the bodies listed is first in its body (review round, 6):
  one body "Starts from the file's own shape: *Name*, because *reason*. The
  features after it come in with their history."; several "Start from the file's
  own shapes: *A*; *B*. Most often because *reason*, or *reason*. The features
  after them come in with their history." A mix keeps the sentence above. Reasons
  through `HISTORY_STOP` (one body with two steps of different reasons: "because
  *x*, and *y*").

### The library (60 files, `history-corpus.test.ts`)

| | In the files | In a body's chain | Equal | Differed | Refused | Not reached |
|---|---|---|---|---|---|---|
| Pad | 70 | 41 | 36 | 1 | 4 (up to 2, a tilted sketch 2) | 0 |
| Pocket | 67 | 30 | 24 | 1 | 4 (up to) | 0 (1 not tried) |
| Revolution | 11 | 8 | 8 | 0 | 0 | 0 |
| Groove | 3 | 3 | 2 | 0 | 1 (`axis`: an edge) | 0 |
| Fillet | 19 | 13 | 11 | 0 | 2 (`failed`) | 0 |
| Chamfer | 13 | 5 | 5 | 0 | 0 | 0 |
| LinearPattern | 9 | 4 | 3 | 0 | 1 (`transform-reference`) | 0 |
| PolarPattern | 8 | 4 | 2 | 0 | 2 (`original`) | 0 |
| Mirrored | 19 | 1 | 0 | 0 | 1 (`original`) | 0 |
| MultiTransform | 10 | 10 | 8 | 0 | 2 (`multi-transform`, `original`) | 0 |
| Hole | 4 | 4 | 3 | 1 (another body) | 0 | 0 |
| Other PartDesign | | | | | 5 (`type`), 4 (`chain`) | 0 |

- **Steps: 6** in 6 bodies (the most in one body: 1), by the first feature's
  reason: `type` 2 (a subtractive pipe, an additive sphere first in its body),
  `multi-transform` 1, `up-to` 1, `transform-reference` 1, `differs` 1 (the
  tapered pad of S5). One run is longer than one feature (five: two up-to
  pockets, two polar patterns of them, a subtractive helix).
- **What holds after a step: 12 features**: 3 pockets, 3 fillets, 2 pads, 1
  chamfer, 1 groove, 1 polar pattern, 1 MultiTransform. Every feature of a body's
  chain is now reached (S7: 21 not reached). S6's estimate of "11 pockets behind a
  stop" was made before S7 rebuilt 4 of them; the rest are the up-to pockets (S9).
- **Bodies (35): 21 with their history** (17 whole, as in S7, and 4 with part of
  it), **10 from the file's shape** (14 before), 4 empty left out. **270
  `import`s** (274 before); the 348 shapes that aren't bodies come in exactly as in
  S3. Attachments over the library: 56.9 MB, 0.28 MB fewer than with the steps
  turned off (a step's shape stands in for a body's final one); the largest step
  attachment 0.66 MB.
- **References: 118 found** (101 before), none missing or several, the furthest
  match 7.8e-13 mm. Restarts 0, second attempts 0, construction features 0.
  Untouched checks: 5, four moved exactly 0, the fifth is S7's through hole into
  another body. Time per file: median
  0.1 s, slowest 14.4 s (16 s before, a loaded machine both times).
- **Drift of the equal ones:** at most 1.4e-8 in volume and 1.2e-8 in area (a
  pad, the only kind above 3.1e-10: one joined to a step's import, whose STEP
  round trip's rounding is under it), the 99th percentile 3e-10; box 9.4e-10 and
  centre 1.8e-9 of the diagonal. All far inside 1e-6, so no tolerance changes.
- **What still doesn't hold after a step (8 features, in 3 bodies)**, and why:
  in the run of five, an up-to pocket, two polar patterns repeating a feature that
  didn't come in (that pocket, a helix) and a subtractive helix (`type`); after the
  additive sphere's step, two pads whose sketches lie on planes tilted off every
  origin axis (S4's gap); and in a file from FreeCAD 0.20, after the tapered pad's
  step, a pocket that **differs by 1.5e-5**, then the pocket after it, not tried:
  that pocket's own stored shape loses 1.5e-5 of its volume through STEP, so it
  can't be a step under the history tolerance, and the pocket rebuilt on the
  pad's imported shape comes out as that STEP version does. Raising the step's
  tolerance to S3's 1e-3 would let the shape in but not make the pocket hold (it
  is checked against the B-rep at 1e-6); left as it is.
- **Bodies with no step that end on their final shape** (8 of the 10; the other
  2 end so after a step, above): a mirror repeating a groove about an edge (S9), a
  MultiTransform repeating the hole that cut another body, a pad and a pocket
  going up to a face after one that does (S9), the two fillets Extrudo can't build
  (each the tip itself), and two bodies that are a base feature. The 4 left out
  are the empty bodies.

### Decisions made on the way

- **Which attachments are in use:** core's `usedAttachments` counts only the fonts
  of text entities, not an `import` feature's file, so the walk decides from the
  `import` features' own file inputs (`importFiles`): a step's attachment goes
  when no `import` names it, and the tests check that every attachment of the
  design is an import's file.
- **The 2,000-feature test** raises the body cap to the file's: `MAX_BODY_FEATURES`
  (500) would otherwise end that body at its 501st feature.
- **A body ended by a cap after steps keeps them;** only a step of the run that
  reaches the end is taken back, since the steps before it held.
- `FORMAT.md` is unchanged: nothing new about the format was needed.

### Review round (2026-11-14)

An independent review of the S8 diff found six things in the code; the rule for
each, as in S6 and S7: a value or a reply the importer can't use is a refusal
with the right reason before the work it would cause, a limit of ours a clean
stop, never a kernel failure, a restart or a throw out of the import.

1. **The 100 MB count.** A step that moves forward leaves its old file out of the
   count only when its own `import` is the one import that uses it; a file another
   body's step shares (identical stored shapes) stays in the design and counts.
   Before, such a move could take the design up to 25 MB past 100 MB, after which
   every final shape was `design-full` and saving refused the design. Test: two
   bodies whose steps share a file, one moving forward under a cap one byte short
   of both files (`maxAttachmentsBytes`, a test option on the import, the walk and
   the shapes import): the move is refused and the files stay within the cap.
2. **Guard before the commit, state before the callback.** A feature is tried only
   on a run whose shape has come in; that is checked before anything is added
   (`failed` if it ever weren't), and the commit sets `restartsAtHold`, `known`,
   `mine` and `lastMeasures` before the caller's record of what held, which no
   longer throws.
3. **Taking a step back can fail.** `undoStep` runs inside a guard: if removing the
   step's import, its Remove or its file throws, the design's transaction rolls
   back, so **the design keeps the step as it was** (its Remove and its `import`,
   with the run's earlier features before them, still in `steps`), and the body
   ends with `failed` ("taking back its stored-shape step failed: …", `stop.run`
   the whole run). The shapes import then takes out the step's bodies with
   `Remove <body>` and brings the body's final shape in, as for any body that ends
   on its shape; the import goes on with the next body. Test: a `remove` that
   throws; the next body still comes in with its history and the design validates.
4. **A full design converts no more steps.** When a step's shape doesn't fit the
   design's attachments, the import remembers it, and no later step of any body
   converts a shape: each later run ends as a shape that can't come in, without a
   conversion (the run reaches on; at the end the body's final shape goes to the
   shapes import, which reports `design-full` itself). Chosen over ending the
   body with `limit`: the reason the report gives is then the true one, the
   design being full. Test: the counted conversions are the first step's, the
   refused one's and the final shape's, never the next run's.
5. **A cap that ends a run keeps the run in the report.** `stop.reason` is the cap
   (or the budget) that ended the body, and `stop.run` lists the run's features,
   the first included, each with its own reason. Test: the step cap and the text
   cap.
6. **A body whose every step is first in it starts from the file's shape:** the
   notice no longer says "part way through" there (below).

### What S9 to S13 inherit

- The steps make every chain feature reachable, so each later slice's gain shows
  directly as features that hold after a step: the up-to methods (5 features),
  datum lines and an edge as an axis (2, and the patterns that repeat them), a
  sketch plane from an arbitrary frame (2 pads).
- A step's import is an ordinary `import` feature: S10's expressions on features
  after it work as on any; S11 and S12 reuse `convertStored` and the step for
  booleans and containers that can't be rebuilt.
- S13: the STEP round trip's drift decides whether a stored shape can be a step;
  the one library shape it rules out drifts 1.5e-5. A B-rep attachment kind was
  rejected (above); a per-shape tolerance from the STEP drift S3 already measures
  is the cheaper option if more files need it.

## Amendment (S9, 2026-11-14): up-to extents, datums, tilted sketch planes, projected geometry

Four kinds of reference a feature or sketch makes now come in, each found on
the body the walk has rebuilt or brought in from the file's own numbers, and
each feature is still rebuilt and checked against its stored shape with S5's
and S6's tolerances (none loosened); a feature this slice can't prove is a
refusal of the closed set and so a stored-shape step (S8). `packages/fcstd`:
`features.ts` (the up-to sides and the axes as typed data), `upto.ts` (the
faces "up to first" and "last" try), `transforms.ts` (`TransformMapper`
gains `face`, `datum`, `sketchPlane` and `externals`), `attach.ts` (the map
mode list and the supports), `sketch-decode.ts` (external links and stored
projections), `sketch-map.ts` (projections drawn and vetted),
`sketch-place.ts` (a given plane for a tilted frame), `bodies.ts` (the walk:
`walkUpTo`, `walkAxis`, `sketchExtras`, the checks of datums and
projections). In `packages/kernel`, `importRebuilder.rebuild` returns the
kernel's reports of the features asked for (`reports`, at most 64): a
construction feature's plane or axis and a sketch's projections. No facade
change, no schema change. Fixtures: 28 small parts we made with FreeCAD 1.1.4
through our own script (`packages/fcstd/scripts/make-reference-fixtures.py`;
data in `reference-fixtures.ts`, 36 distinct stored shapes once each, spaces
collapsed, 359 KB, written into files by S7's `pattern-parts.ts` with
`REF_FIXTURES`, which now also writes a sketch's constraints, external links,
stored projections, supports and map mode, and an object's own placement).
**All 28 come in with their whole history.**

The fixture writer had written every placement with `A="0"`, and FreeCAD's
reader (and ours, S2) takes the angle and axis before the quaternion: S7's
and S8's parts were all unrotated, so nothing changed for them, but a turned
sketch or datum read as unturned. It now writes the angle and axis of the
same rotation.

### Up-to extents (Pad, Pocket)

- **Up to a face** (`UpToFace` a feature's `FaceN`, or `UpToShape` with
  exactly one face): the face is described on that feature's stored shape and
  found on the rebuilt body by S6's matcher (exactly one candidate, flat or
  curved; the reference must name this body's own features after a step,
  `own()`), and the side becomes Extrudo's `to-object` on it. An origin plane
  is `to-object` on that plane; a datum plane on its construction (below).
- **Offset:** FreeCAD's `Offset` is Extrudo's `offset`, the same sign:
  positive ends past the face along the sweep, for a pad and a pocket alike.
  The fixtures with 1.5 hold; read with −1.5 or 0 they are refused by the
  check, and an offset that leaves no length (−18 on the 18 mm bridge) is
  Extrudo's refusal ("With this offset the extrude would end at or behind the
  profile"), a `failed` stop.
- **Up to first, up to last:** FreeCAD works the face out when it computes the
  feature (the faces of the body before it that a line through the profile's
  centre along the sweep meets, the nearest or the farthest). Extrudo's
  `to-object` on a **body** stops where the sweep first meets it, which is
  FreeCAD's "first" for a pad (the sweep's piece touching the profile), but not
  for a pocket that starts outside the body (its first piece is outside, so it
  cuts nothing); `through-all` goes just past the last face, not to it. So the
  importer picks the face as FreeCAD does: the flat faces of the rebuilt body
  whose plane the line from the profile's centre (the middle of the box of what
  the sketch draws) meets ahead of the profile, inside the box their edges can
  reach (a superset of the face: the check decides), one per plane, ordered
  along the sweep (nearest first for "first", farthest first for "last"). A
  pad up to the first face tries `to-object` on the body first (the one
  meaning that follows the model). Each target is a whole try, a transaction
  and a rebuild, kept only when the check holds; Extrudo's refusal of a target
  ("it lies behind the profile") moves to the next as `differs` does. **At
  most 4 tries a feature** (`MAX_UP_TO_TRIES`); the references of every
  target are asked for at once before the first try, since a try's rebuild
  renumbers the body. The tries count as second attempts in S7's sense and
  are reported per body (`BodyHistory.upToTries`) and per feature
  (`MappedFeature.upTo`: method, target, the try that held). The fixtures hold
  at the first try: the pad on the body, the pocket on the first wall's far
  face, the pad up to the last face on the third wall's far face. **The face
  the importer picks is a fixed face in Extrudo:** the extrude goes up to that
  face (or that body) from then on and doesn't choose again when the model
  changes, where FreeCAD would. Read as up to
  the first face, the "last" fixture holds at the fourth try, on the third
  wall's near face: the solid up to it is the same solid, the walls filling the
  rest.
- **A second side** (1.1's `Type2` with `UpToFace2` / `UpToShape2`) maps to
  Extrudo's `toObject2` by the same rule; a second side up to the first or last
  face, and a symmetric up-to side, stay `up-to`. S5's mappings are unchanged.
- **Revolution and Groove** up to a face stay refused (`up-to`): Extrudo's
  revolve has `to-object` too, but no fixture or library file has one to prove
  it.

### An edge or a datum line as a revolve's axis

`ReferenceAxis` may name a straight edge (`EdgeN` of a feature walked before:
described on its stored shape, found by the matcher, given to the revolve as
the `edge` reference itself, which Extrudo's revolve takes) or a datum line
(its construction). FreeCAD turns right-handed about the line's own direction
(an edge's curve from its first parameter to its last, a datum's local Z);
Extrudo about its reference's (an edge's canonical direction, a construction
axis's first point to its second). Where they disagree the revolve's `flip`
turns, except for a symmetric one: the half turn about a datum line holds, and
the same datum turned round is refused by the check.

### Datum lines and planes

`PartDesign::Line` and `PartDesign::Plane` come in as Extrudo construction
features when a feature that comes in uses one (an axis, a pattern's direction
or axis, a mirror plane, an up-to target, a sketch's plane), **once per datum
per import**, in the transaction of its first user (cancelled with it, and
then forgotten), named after the datum. The truth is the datum's stored
placement, moved by its containers as a sketch's is: the line through the
position along local Z, the plane through it with local Z as its normal. The
attachment (`MapMode`, supports) only chooses the construction:

| Map mode | Comes in as | Relation |
|---|---|---|
| any, the line or plane on an origin axis or plane | that origin axis or plane | kept |
| `FlatFace` on an origin plane, moved along its normal only (any `AttachmentOffset` that leaves the plane parallel) | `offsetPlane` of that origin plane by the distance | kept |
| `TwoPointLine` on one straight edge of a feature walked before | `axisAlongEdge` of the edge the matcher finds | kept |
| `TwoPointLine` on one line of a sketch of this body that came in | `axisAlongEdge` of the drawn line | kept |
| every other mode (`TwoPointLine` on two vertices, `FlatFace` on a face, `ObjectXY` …, `ThreePointsPlane`, `NormalToEdge`, `TangentPlane`, …) | construction points from the placement's numbers, an `axisThroughPoints` through two or a `planeThroughPoints` through three | fixed |

No mode is refused for want of a construction: fixed points express any line
or plane. What Extrudo lacks to keep the other relations: a construction point
on a body's **vertex** that the import can name (the matcher describes edges
and faces only, so a line through two vertices comes in fixed, the library's
one datum line among them), and an offset plane on a **face** whose normal's
sense the importer knows before the rebuild (left fixed rather than guessed).

**Each datum is checked:** the rebuild returns the construction's report, and
its axis must lie along the file's line (directions within 1e-9 as a sine, the
point within 1e-7 mm + 1e-9 of its distance from the origin) or its plane on
the file's plane (normals likewise, either sense): S7's tolerances for a line
or plane, which the constructions meet to rounding (their numbers are the
placement's to 15 significant digits). A datum that isn't stops its user with
the new reason **`datum`** ("its datum DatumLine came in at another place");
a report that is missing or isn't a construction's is a kernel failure. A
datum whose placement disagrees with its attachment takes the placement (the
mirror fixture with its offset changed to 7 mm still mirrors at 3 mm and
holds); a datum placed elsewhere than the stored shapes say is refused by the
check. `transforms.ts` takes a datum as one more source of a world line or
plane: the pattern, the polar pattern and the mirror then work as with a
sketch axis.

### Sketches on tilted planes and on faces

A sketch whose frame none of S4's planes holds (tilted off every origin axis)
now comes in on a plane made in its feature's transaction: its **datum
plane's construction** when it is attached (`FlatFace`) to a datum plane of
this body, else a **plane through three fixed points of its own frame**
(`planeThroughPoints`, named "<sketch> plane"). A construction plane's sketch
frame is `faceSketchFrame` of its point and normal, so the importer knows it
before the rebuild and S4's 2D map moves FreeCAD's geometry into it (turned in
the plane: horizontal and vertical become parallels, as in S4's turned
frames); the feature's check proves the profile lands where the file has it
(moved 1 mm in its plane, the tilted pad is refused). Sketches S4 places today
are unchanged.

**A sketch on a body's face** sits on a plane, not on the face: S4's planes
where they hold (as before), the fixed plane through its frame otherwise. A
sketch on the face itself would follow the model, but its frame is the face's
`faceSketchFrame`, whose normal's sense comes from the face's orientation in
the rebuilt body, which the importer can't prove before the rebuild; the plane
is provably the file's. `SketchOutcome.plane` says `datum` or `points`, and
the app says such planes don't follow the model (below).

**The library's two tilted sketches** are attached (`TangentPlane`) to a
vertex of another sketch and an origin plane; their placement is that
attacher's result, so they come in on planes through their own frames, and
the two pads on them hold (below).

### Projected (external) geometry in sketches

A constraint that names external geometry was left out (`external`), the
geometry where the file has it. Now, for each external curve a constraint of
a sketch names (at most `MAX_EXTERNAL_PER_SKETCH` = 64 per sketch and
`MAX_EXTERNAL_PER_FILE` = 1,000 per import; the rest stay out as before):

- **Its source**, by the link that made it (FORMAT.md: the stored projection's
  `ref`, or the link's place before 1.0): an `EdgeN` of a feature walked before
  in this body, described on its stored shape and found by the matcher on the
  body as it is when the sketch is made (the reference must name this body's
  own features, `own()`); or a line of another sketch of this body that came
  in (ADR-0125's sketch-curve projection). Vertices (the matcher describes
  none), other bodies, ShapeBinders, Part features and anything before a step
  stay out.
- **Its curve** is where FreeCAD stored its projection (1.0+), else the source
  projected along the sketch's normal (a line's ends, a circle whose axis is
  the normal); a line, a circle or a point, in the sketch's map. It is drawn
  as construction (FreeCAD's external geometry never bounds a profile) and
  registered as the sketch's projection (`addProjection`, then its curve under
  the kernel's key: `edge`, `curve`), so the app's projection sync owns it
  afterwards; while the constraints are vetted the solver holds it fixed, as
  the app's solver holds projected curves.
- **The check:** the rebuild returns the sketch's report, and each projected
  curve must be where it is drawn (the same kind, ends in order, centre and
  radius, within 1e-6 mm + 1e-9 of the distance from the origin: S4's
  tolerance for what may move). A line the kernel projects the other way round
  is drawn its way at the next try (turned back once if the next report
  disagrees, then left out); anything else elsewhere, another kind or lost
  stays out at the next try (at most three tries more,
  `MAX_PROJECTION_REPEATS`). So a projection never costs a sketch: the worst
  case is today's outcome. A report missing or not a sketch's is a kernel
  failure.
- **The constraints** that name it then go through S4's mapping and vetting
  (nothing kept may move the sketch), and the counts still add up: each
  FreeCAD constraint has one outcome, `mapped` included those through a
  projection. A projection no kept constraint names comes out again, record
  and curve. `SketchOutcome.external`: the external curves its constraints
  name, those projected, and the mapped constraints through them.

All seven projected fixtures keep every constraint (the dimension from a
projected top edge, the one from a bottom edge not on the sketch's plane, the
corner on two projected edges, the counterbore concentric with a projected
rim, the dimension from another sketch's line, the face sketch with two
projected edges); the unused link makes no projection. A stored projection 1 mm
off the edge, or a link changed to another edge, comes back elsewhere from the
kernel: the constraint stays out and the sketch is as before.

### Limits (hostile files)

| Limit | Value | What happens past it |
|---|---|---|
| Up-to tries per feature | 4 (`MAX_UP_TO_TRIES`) | the targets past it are not tried |
| Datums per import | 200 (`MAX_DATUMS`) | the feature needing one more stops with `limit` |
| External curves projected per sketch / per import | 64 / 1,000 | the rest stay out (`external`), as before S9 |
| Projection tries per feature | 3 more (`MAX_PROJECTION_REPEATS`) | — |
| Feature reports per rebuild | 64 (`MAX_REBUILD_REPORTS`) | — |

Refused before any kernel work: an offset past 10 km or not finite (`value`),
a datum at a position past 10 km (`transform-reference`, no construction
made), an `UpToFace` naming the feature itself, two elements, an edge, an
object not in the file (`up-to`) or a face past its feature's count
(`element`), a feature after it or outside the body (`up-to`), an
`UpToShape` of more than one face (`up-to`), a revolve axis naming itself,
a face or two edges (`axis`), a datum outside the body. A rotation of all
zeros reads as no rotation, as FreeCAD's reader takes it (a zero axis keeps
+Z), so a datum always has a direction; read so, the fixtures' features are
refused by Extrudo or the check, a clean stop. A kernel that names another
feature for an up-to face (a restart and `kernel`), throws or hangs while the
first face is looked for (`kernel`, `time`), answers a sketch report without
projections, reports a feature it wasn't asked about, or reports a datum
elsewhere (`datum`), each stops that feature cleanly (`reference-hostile.test.ts`).

**Measured** (Ubuntu machine, shared, one run each, the whole import,
`reference-limits.test.ts`, `BENCH=1`): a body of pads each up to a datum
plane of its own (one offset plane each, checked against its report): 11
datums 0.86 s, 51 datums 2.1 s, **200 datums (the cap) 9.7 s**, and the 201st
stops with `limit`. An up-to feature costs at most four tries, each one
rebuild (the library's slowest try sequence, three tries, adds under 0.3 s).
A projection costs no extra kernel call when it holds (the sketch's report
comes with the feature's rebuild); the worst case is three more tries of the
feature. The import's time and kernel budgets (S3, S5) stay the judges of the
whole.

### The report and the app

`BodyHistory.upToTries`; `MappedFeature.upTo` (method, target, try) and
`datums` (map mode, how it came in); `SketchOutcome.plane` (`datum`,
`points`) and `external` (named, projected, constraints). The app's notices
change in two places: `HISTORY_STOP['up-to']` now reads "a feature goes up to
a face or a shape Extrudo can't find or use" (most up-to features come in), a
new reason `datum` reads "a datum line or plane didn't come in where the file
has it", and one new sentence when datums or sketch planes came in fixed: "A
datum line or plane came in fixed where the file has it: it doesn't follow
what it was attached to in FreeCAD when the model changes." (plural: "2 datum
lines and planes and the plane of a tilted sketch came in fixed where the
file has them: they don't follow …"; "the planes of *n* tilted sketches").

### The library (60 files, `history-corpus.test.ts`)

| | In the files | In a body's chain | Equal | Differed | Refused | Not reached |
|---|---|---|---|---|---|---|
| Pad | 70 | 41 | 40 | 1 | 0 | 0 |
| Pocket | 67 | 30 | 28 | 1 | 0 | 0 (1 not tried) |
| Revolution | 11 | 8 | 8 | 0 | 0 | 0 |
| Groove | 3 | 3 | 3 | 0 | 0 | 0 |
| Fillet | 19 | 13 | 11 | 0 | 2 (`failed`) | 0 |
| Chamfer | 13 | 5 | 5 | 0 | 0 | 0 |
| LinearPattern | 9 | 4 | 4 | 0 | 0 | 0 |
| PolarPattern | 8 | 4 | 3 | 0 | 1 (`original`) | 0 |
| Mirrored | 19 | 1 | 1 | 0 | 0 | 0 |
| MultiTransform | 10 | 10 | 8 | 0 | 2 (`multi-transform`, `original`) | 0 |
| Hole | 4 | 4 | 3 | 1 (another body) | 0 | 0 |
| Other PartDesign | | | | | 5 (`type`), 4 (`chain`) | 0 |

- **Up-to features: 6 of 6 come in** (S8: 0): a pad up to a face that is a
  datum plane and two pockets likewise (`to-object` on its construction, the
  first try), a pad up to the last face (the first try), two pockets up to the
  first face (one at the first try, one at the third: the two nearer faces gave
  another solid). 5 up-to tries in all.
- **Datums:** in the files 1 line (`TwoPointLine` on two vertices), 1 plane
  (`FlatFace`), 4 planes (`Deactivated`, in two files of the 0.14 builds,
  whose bodies list their members in `Model`); brought in 3, all fixed: the
  line (a linear pattern's direction, now equal) and the two datum planes the
  three up-to features go to. Nothing that came in uses the `FlatFace` plane.
- **Axes:** 12 revolves about a sketch's V axis, 1 about an origin axis and 1
  about a datum line: all 11 in a chain come in, the groove about the datum line
  (S5's `axis` refusal) among them.
- **Tilted sketches: 2 of 2 come in** on planes through their own frames
  (`TangentPlane` on another sketch's vertex and an origin plane), and the two
  pads on them hold after the additive sphere's step.
- **External geometry:** links in the files by source: pads' edges 18,
  pockets' 24, MultiTransforms' 5, chamfers' 4, linear patterns' 3, a polar
  pattern's 1, a fillet's 1, a subtractive pipe's 1, pads' vertices 2, other
  sketches' lines 6, ShapeBinders' edges 12, Part features 3. In the bodies the
  walk reaches, 17 sketches have links: their constraints name 27 external
  curves, **7 came in as projections and 9 constraints through them** (a
  fillet's, two pads' and four pockets' edges), 25 constraints stay out. Since
  the arcs amendment below, 12 and 16 (the five arcs), 18 stay out. The
  curves that stay out, by cause (`SketchOutcome.external.out`, summed by the
  library test; 20 in S9, 15 since the arcs):

  | Cause | Curves |
  |---|---|
  | The source is outside the body's walked features (ShapeBinders, S12's) | 9 |
  | An arc (files from before 1.0; S9 projected only whole circles) | 5 in S9, 0 since the arcs amendment |
  | No counterpart on the rebuilt body (`none`) | 2 |
  | A curve the importer doesn't project (`kind`: not a line, nor a circle or an arc of one square to the sketch) | 2 |
  | A line of another sketch that didn't come in with this body | 1 |
  | A vertex (the matcher describes none) | 1 |

  None was reported elsewhere by the kernel, none past a cap, none ambiguous.
  The arcs were the one cause a small change would cover; the arcs amendment
  below brings them in.
- **Bodies (35): 25 with their history** (21 before; 21 whole and 4 with part
  of it), **6 from the file's shape** (10 before), 4 empty left out. **266
  `import`s** (270 before); the 348 shapes that aren't bodies come in exactly as
  in S3. Steps: 5 (6 before), by the first feature's reason `type` 3,
  `multi-transform` 1, `differs` 1, each body at most one; 12 features hold
  after a step.
- **References: 126 found** (118 before), 2 none (two projected edges, which
  stay out), 0 several, the furthest match 7.8e-13 mm. Construction features
  made: 19. Restarts 0. Second attempts 2 (the up-to pocket's two extra
  tries), up-to tries 5. Untouched
  checks 5, as S8. Time per file: median 0.1 s, slowest 14.5 s.
- **Drift of the equal ones:** at most 1.4e-8 in volume and 2.5e-8 in area (the
  pad joined to a step's import, as S8), box 9.4e-10 and centre 1.6e-8 of the
  diagonal: no tolerance changes.
- **What changed in S5's to S8's rows:** 4 pads and 4 pockets more are equal
  (the up-to ones and the two pads on tilted sketches), 1 groove (about a datum
  line), 1 linear pattern (along a datum line), and a mirror and a polar pattern
  that repeat features which now come in; the `up-to`, `transform-reference` and
  `axis` refusals are gone. Nothing of S5 to S8 that held before stops now.
- **What doesn't come in yet, and why:** no up-to, axis, datum or tilted-sketch
  feature. The rest: two fillets Extrudo can't build, a hole that cuts another
  body, a MultiTransform of a linear pattern then a mirror, two patterns that
  repeat a feature that didn't come in, a pocket that differs by 1.5e-5 after a
  step (S8's), five features of kinds not mapped and four bodies' own chains.
- **A plain distance in place of an up-to extent** would save no feature: all
  six come in with their meaning.

### Review round (2026-11-14)

Two reviews of the S9 diff found nine things. The rule for all: a feature that
doesn't hold leaves nothing behind (design, the walk's maps, counters); a
reference is found on the body as it is before the feature; a relation the
report calls kept is the file's. Tests: `reference.test.ts`'s "the fix round"
and the hostile tests' turned-projection cases.

1. **Found once, before the first try.** A failed try's rebuild is the
   kernel's last finished recompute and still holds the cancelled feature
   (`restartsAtHold` can't see it: there was no restart), so a later try that
   matched again described the wrong body: `external_corner`, with a kernel
   that reports the projected lines turned round once, found 21 edges and 9
   faces (the notch already cut) and lost both projections. Chosen: everything
   a feature's tries find on the body (stored descriptions, matches and their
   references) is found once, on the body before the first try, and reused by
   every later try (`TransformContext.found`, the walk's `featureFound`, kept
   for one feature); references persist, so a later try names what the first
   found. Rebuilding the design as it was before each retry would cost a
   rebuild per try and gain nothing. Kernel-call stops are never remembered.
   Now that case ends with both projections in, every constraint mapped, no
   restart; with the cache turned off the test fails.
2. **Inside the try, from a fresh mapper.** `walkUpTo` resolved a named up-to
   target before the tries, so a datum plane's construction was made outside
   the feature's transaction and stayed (with its entry in the datums map,
   unchecked) when the feature didn't hold; and one mapper's checks,
   constructions and tally built up over the tries, so a second try asked for
   the report of a construction the first had taken back (nonsense, a kernel
   stop). Each try now has its own `TransformMapper`, and a named face or plane
   is found inside it; "first" and "last" targets are still found before the
   tries (they add nothing to the design). Tests: the up-to-datum pad and
   pocket with an offset that doesn't fit leave no construction of the datum;
   the tilted pad read as up to the first face stops with `differs`, no
   restart.
3. **A sketch on its datum plane only when its frame lies in it** (normals
   within 1e-9 as a sine, its origin within 1e-7 mm + 1e-9 of its distance from
   the origin of the plane), else on the plane through its own frame. The
   tilted sketch moved 2 mm along its normal is tried on its own frame's plane;
   its pad no longer fits its stored shape and doesn't hold.
4. **A datum refused for a sketch's plane** (outside the body, past
   `MAX_DATUMS`, an unreadable placement …) no longer stops the feature: the
   plane through the sketch's own frame takes its place, for every refusal that
   isn't a kernel call's. Test: the sketch on a datum outside the body comes in
   on a `points` plane and its pad holds.
5. **An offset plane is kept only on an origin plane of the feature's own
   body** (the origin's `OriginFeatures`), not on any `App::Plane` with that
   role; another body's origin plane gives a fixed plane (tested).
6. **Counters:** projections count against `MAX_EXTERNAL_PER_FILE` as they are
   kept (a held feature's sketch), never for a try taken back; `upToTries`
   counts tries with another target, not a try repeated for its projections; a
   datum plane as an up-to target reports `target: 'datum'` (the library's
   keys: `face → datum`).
7. **The turned-projection test** now asserts the projection is in and every
   constraint mapped (it passed either way before).
8. **The notice** says "the plane of a tilted sketch" / "the planes of *n*
   tilted sketches": the library's two are not on faces.
9. **The external curves that stay out have a cause** (the table above).

The library's numbers are unchanged by the round: 25 bodies with their
history, 6 from the file's shape, 266 imports, 126 references found, 6 of 6
up-to features, 0 restarts; median 0.1 s a file, slowest 14.4 s.

### What S10 to S13 inherit

- A feature's `sources` now name `UpToFace`, `UpToShape`, `Offset` and their
  second-side twins: S10 can bind an offset's expression like a length's.
- The fixed datums and planes carry the file's numbers as expressions of
  construction points: S10 may bind a datum's `AttachmentOffset` expressions
  only where the relation is kept (`offsetPlane`'s distance).
- S12 (other bodies, ShapeBinders, Part features as sources): the external
  links to them stay out today, counted in the library table.
- A body's vertex as a reference (datum lines through vertices, projected
  vertices) needs the kernel to describe vertices for the matcher: one
  `describe` change in `stored-shape.ts`, no facade change.

## Amendment (S9, arcs, 2026-11-15): arcs as projected edges

An external curve that is an arc of a circle now comes in as a projection, as
lines and whole circles do (S9's "Projected (external) geometry in
sketches"); nothing else of S9 changes. `packages/fcstd`: `transforms.ts`
(`externals()` plans the arc, `arcThrough`), `sketch-map.ts` (the arc drawn,
`ProjectedEntity.kind: 'arc'`), `bodies.ts` (`projectionVerdict` checks it).
No facade change, no schema change, no new app sentence.

- **Files from 1.0 on** store the projection: a `Part::GeomArcOfCircle` in the
  sketch's coordinates (FORMAT.md), read by S4's decoder (a radius that isn't
  positive and finite, or angles that make no arc, leave the record unread,
  cause `link`), drawn from there as lines and circles are.
- **Files from before 1.0** store none. An edge whose curve is a circle, whose
  two ends are apart and whose axis is the sketch's normal (either sense,
  within 1e-9 as a sine) is projected along the normal: its centre, radius and
  two ends from the matcher's description of the stored edge, and **which of
  the two arcs between the ends it is from the edge's middle point**
  (`ElementEdge.midpoint`, in the description already): the arc runs
  counter-clockwise from the end after which the middle comes first
  (`arcThrough`). An end or the middle off the circle (1e-6 mm + 1e-9 of the
  centre's distance from the origin), the two ends on each other, the middle
  on an end, a radius of zero, not finite or past `MAX_FEATURE_LENGTH` make no
  arc: it stays out, `kind`. A whole circle keeps its own path; an arc whose
  axis isn't the normal, an ellipse or a spline stays out (`kind`). The cause
  `arc` is gone from `ExternalCause`: what it counted now comes in or is
  `kind`.
- **Either way the arc is drawn** as an Extrudo construction arc, as S4 draws a
  sketch's arc (counter-clockwise in Extrudo's frame, the ends swapped in a
  mirrored one), its point positions FreeCAD's (1 its start, 2 its end, 3 its
  centre), and registered as the sketch's projection under the kernel's key
  `edge`, so the app's projection sync owns it afterwards (an arc entity takes
  a reported arc's centre, start and end in place). A drawn arc whose ends lie
  within the tolerance of each other is left out (`kind`).
- **The check** is the line's: the sketch's report must give an arc (the
  kernel's `{ type: 'arc', center, start, end }`, counter-clockwise from
  `start`) with the drawn centre, both ends on the drawn radius, and the drawn
  start and end, within S9's projection tolerance. **The other way round** for
  an arc in Extrudo is a report with the two ends swapped: since an Extrudo
  arc always runs counter-clockwise, that is the other arc of the same circle
  between the same ends. It is drawn the kernel's way at the next try (from
  FreeCAD's end to its start), by the line's rule and counters
  (`projectionTry`: turned back once if the next report disagrees, then left
  out, at most `MAX_PROJECTION_REPEATS` tries more). **A turned arc keeps
  FreeCAD's names for its ends:** position 1 is whichever drawn end lies on
  FreeCAD's start, so a constraint on the start still names the point where
  the file's start is; the vetting proves it (with the names swapped instead,
  the solver would move the notch's corners, and the test that turns the arc
  sees two of its three constraints refused). What changes is the curve
  between the ends, which only a constraint on the curve itself sees; the
  vetting decides those as for any other.
- **Constraints** through it go through S4's mapping and vetting as through a
  sketch's arc: its centre, its ends, point on object, tangent, concentric,
  equal radius where S4 maps them; one S4 doesn't map stays out as before.
- **Hostile** (`reference-hostile.test.ts`): a stored arc with a radius of zero
  or not finite, a centre not finite, a start equal to the end (`link`: not
  read), a radius or centre past the length limit, a sweep of 1e-11 rad, a
  radius too small to tell the ends apart (`kind`), another radius (the kernel
  reports it elsewhere: `elsewhere`); a kernel that reports a line, a circle,
  another radius or nothing for it (`elsewhere`), or turns it every time it is
  drawn (turned back once, then out); a description with the arc's middle off
  the circle (before 1.0: `kind`). Each leaves the projection out and the
  sketch as before (the constraints through it out as `external`), no stop. A
  kernel that turns it once ends with the arc in as the file has it (the third
  try); one that always reports the other arc, with it in the kernel's way and
  every constraint mapped (the second try).
- **Fixtures:** five more parts (`make-reference-fixtures.py`, FreeCAD 1.1.4;
  5 distinct stored shapes more, 43 KB): the plate with one vertical corner
  rounded (radius 6), a pocket's circle concentric with the projected top arc,
  the same from the bottom arc 10 below the sketch's plane, a notch with its
  corners on the arc's start, end and centre, a circle tangent to the arc, and
  a side sketch that sees the arc edge-on. The first four come in with their
  whole history, the projection in and every constraint mapped, with the
  stored projection and with it taken away (the path before 1.0). The edge-on
  one: FreeCAD 1.1.4 stores its projection as a line, which comes in as S9's
  lines do (the kernel projects the edge-on arc to the same line); with the
  stored projection taken away it stays out (`kind`) and its sketch is as in
  S9.
- **The library** (`history-corpus.test.ts`): **all 5 arcs come in** (files
  before 1.0: three from a pocket's edges in one sketch, one each from two
  MultiTransforms' edges), and **7 constraints more through them** (16
  through projections in all, 9 before); those three sketches now map every
  constraint. Named external curves 27, projected 12 (7 before), out 15 (the
  table above without the arcs); constraints left out through external
  geometry 18 (25). References found 131 (126: the five arcs' matches), 2
  none. Unchanged: 25 bodies with history, 6 from the file's shape, 266
  imports, 0 restarts, every feature row of S9's table; median 0.1 s a file,
  slowest 14.5 s.

## Amendment (S10, 2026-11-15): parameters and expressions

A FreeCAD file's spreadsheet cells and variable-set numbers come in as Extrudo
user parameters, and the file's expressions on sketch dimensions, feature
inputs and plane offsets come in as Extrudo expressions wherever Extrudo
computes the file's value from them. `packages/fcstd`: `fc-expr.ts` (FreeCAD's
expression language: tokenizer, recursive-descent parser, limits), `fc-emit.ts`
(the tree as Extrudo text), `params.ts` (`prepareParameters`: the sources,
every expression of the file parsed once, kinds, names, the parameters added),
`bind.ts` (`Binder`: the rule, as the walk adds each feature),
`parameters-report.ts`; S4's `sketch-map.ts` records how each dimension's value
is its constraint's and takes the import's names. No schema change, no facade
change, no change to Extrudo's expression language. Fixtures: 11 small parts we
made with FreeCAD 1.1.4 through our own script
(`packages/fcstd/scripts/make-parameter-fixtures.py`; `parameter-fixtures.ts`
keeps each object's own `<Object>` XML with the properties the importer never
reads left out, numbers' trailing zeros cut, a constraint's redundant
`ElementIds` dropped and FreeCAD's repeated markup as tokens, 22 distinct
stored shapes, 336 KB; `parameter-parts.ts` writes them back into files). **All
11 come in with their whole history**, as they did before this slice.

### The rule

**An expression comes in only when Extrudo's own evaluation of what the
importer wrote gives the value the file stores for that property.** The file
stores every property's last computed value beside its expression, so the
translation is never trusted: inside the feature's transaction, before its
rebuild, the importer writes the translated expression into the dimension
(`updateSketchDimension`, no geometry moved) or the input (`updateFeatureInputs`),
evaluates the whole design with `@extrudo/core`'s `evaluateParameters`, and
compares each value with the stored one: `|got − want| ≤ 1e-9 · max(1, |want|)`,
mm or degrees (an angle constraint's radians turned into degrees first; a count
must be exactly the stored integer). The floor of 1e-9 mm or degree for values
below 1 is six orders below OCCT's confusion tolerance (1e-7 mm) and seven
above what two doubles of the same 15 or 16 digits differ by; every kept row
of the truth table and of the library is within it. What fails goes back to the
importer's literal, in rounds (an error that comes from another failing
expression waits a round; at most 64, `MAX_BIND_ROUNDS`, each taking at least
one out), so a kept set is always one that evaluates. Then the feature is
rebuilt and checked against its stored shape **with the expressions in it**,
as before; a feature that doesn't hold takes its bindings back with its
transaction. Nothing is evaluated by a second evaluator of ours: the importer
translates text to text.

### What becomes a parameter

- **Cells with an alias** whose content is a number, a quantity (`6 mm`) or a
  formula, one parameter each, named after the alias, in a group named after
  the sheet's label (cleaned, cut to the schema's 40 UTF-16 units, never inside
  a surrogate pair). **A cell
  without an alias** only when something that comes in reads it (by address,
  or from a formula of a cell that comes in), named `<sheet label>_<address>`
  (`Params_B6`). A text cell never.
- **Variable-set properties** of type Length, Distance, Angle, Float, Integer
  (and their constraint and percent forms), named after the property, grouped
  under the set's label, the property's description (`doc`) as the comment.
  Bool, String, Link and other types stay out (`type`); an expression that
  reads one is a number (`reference`).
- They come in whether or not something reads them, before the first sketch or
  feature, in one undo step ("Parameters from the file"), in document order.
- **A cell's value is not in the file.** A formula that translates is the
  parameter's expression and Extrudo computes it; whatever reads it proves it
  (the rule). A formula that doesn't translate (a function Extrudo lacks, a
  model value it reads, a loop of cells, an Extrudo error such as a division
  by zero) comes in as a plain number only when the file proves the value: a
  property bound to exactly that cell stores it (all such properties agreeing);
  otherwise the cell stays out with its reason and what reads it is a number.
  **A proof comes only from a target that stores the value as it is given**: a
  sketch constraint, a plane offset, a property of type Length, Distance, Angle
  or Float; never a count (it rounds: `Occurrences` from `=exp(1.1)` stores 3
  for 3.004) nor a `…Constraint` or `Percent` type (they clamp). **A formula
  that translates is checked against its proofs too**: where Extrudo computes
  another value than the proven one (beyond the rule's tolerance) the parameter
  takes the proven number (`from: 'proven'`, the formula's reason `differs`)
  and the set is evaluated again for what reads it.
- **Kinds.** FreeCAD's plain numbers have no unit; Extrudo wants a length in a
  length field. Each plain-number source gets votes from what reads it, in one
  pass over each expression's tree: a source that alone carries the result's
  unit to a length or angle target (through sums, products, a numerator, `abs`,
  `min`, `max`, `sum`, `average`, `hypot`, `cath`) votes for that kind; one in
  a trigonometric function, a rounding, an exponent, a denominator, read by a
  count, or multiplied with a value that already has the unit votes unitless;
  two plain sources sharing a product vote nothing. A formula cell's own votes
  then pass to the one source it carries, in one pass backwards over the cells
  in dependency order. Unanimous votes decide; mixed votes make it unitless
  (the truth table's `n`, read by `n / 3` and by `sin(n)`); no votes: its own
  unit (a quantity, a property's type), then a formula's kind from its parts
  (one pass forwards), then its display unit when that is a length or an angle,
  else unitless. The emitter makes any choice exact (below), so the kinds only
  decide how readable the expressions are; the outcome doesn't depend on the
  order the file lists things in, and the work is linear in the expressions'
  size.

### Names

One namespace: user parameters first (aliases, then variable-set properties,
in document order), then the **named driving constraints** of the sketches
PartDesign bodies hold (in document order; the dimension gets the name as its
`paramName` whether or not an expression reads it), then names the importer
makes up (unaliased cells, `dN` for every other driving dimension and for a
feature input an expression reads, skipping every name taken). The
constraints' names are fitted **after** the parameters' evaluation, so a name
whose parameter stayed out is free again (`Names.release`) and no rename is
reported for a name nobody took; unaliased cells carry a provisional name
until then and get theirs after the constraints'. **A try that doesn't hold
gives back the names it took** (the `Binder` snapshots `Names` in `begin` and
restores it in `discard`, called by the walk when a try's check fails and by
the next `begin` or `finish` for a try nobody committed): a feature that holds
at its second try gets the `dN`s it would have got at its first, and the rule's
round count counts held tries only. The rule,
`Names.fit`: a name Extrudo takes (`PARAMETER_NAME`, not a unit, function or
constant, not taken; case matters, so `Width` and `width` both stay) is kept;
otherwise characters outside the pattern become `_`, a name that would start
with a digit gets `p_`, it is cut to 64 characters (`MAX_PARAMETER_NAME`), and
`_1`, `_2` … is added until one is free (at most 1,000 tries,
`MAX_RENAME_TRIES`, then the parameter stays out with `limit`). Every
expression is written from what it **reads**, never from its text, so a
renamed name is read by its new name everywhere. The report lists each change
of a name that came in (old, new, why: `reserved`, `taken`, `invalid`,
`long`). The `names` fixture: `cos` → `cos_1`, `max` → `max_1`, `round` →
`round_1` (reserved), the constraints `width` → `width_1` and `d` → `d_1`
(taken by the aliases); `sin_`, `in_`, `d`, `e1`, `x1`, `A1x`, `Pad`, `Width`
and `width` stay. JavaScript's own property names (`__proto__`,
`constructor`, `toString`, `hasOwnProperty`) as aliases, variable names and
constraint names come in working: the importer keeps them in `Map`s and
null-prototype records only, and `@extrudo/core` evaluates them (its
`evaluateParameters` keys by `Map`, `ownEntry` guards its unit table): nothing
mishandles one.

FreeCAD's references resolve as FreeCAD resolves them: `<<Label>>.x` by label
only; `Name.x` by internal name first, then by label, unresolved when the name
is also another object's label or two objects share the label; `Name.x` where
no object is called `Name` is the owner's own property; `prop` and `.prop` the
owner's. In a cell's formula a bare name is the sheet's own alias, then its
address. Cell addresses are upper case (FreeCAD 1.1 takes `e1` and `x1` as
aliases); an alias that is an address is no alias.

### What an expression reads, and where it is written

**Reads:** a cell (alias or address), a variable-set property, a sketch
constraint by name or index (its driving dimension's name), a feature input the
importer maps (`Pad.Length`, an own `Length`; the input gets a `dN`). A model
value whose Extrudo value isn't FreeCAD's is read through the same
transformation (`-d3`, `d5 * 2`) or not at all. A driven dimension, a placement
member, `Shape.*`, a label, a sub-object, another document, the pseudo-properties
and `hiddenref` stay numbers (`reference`).

**Targets.** A sketch constraint S4 mapped to a dimension (one S4 left out or
made driven takes its expression with it: `unmapped`); a feature input through
`MappedFeature.sources`; a plane offset (below); anything else a number or
nothing, as before (`target`).

| Feature | Extrudo input | FreeCAD property | Binding |
|---|---|---|---|
| Pad, Pocket | `distance` | `Length` (one side, symmetric: the whole length) | as written |
| | `distance2` | `Length2` (TwoLengths, Two sides) | as written |
| | `offset`, `offset2` | `Offset`, `Offset2` (up-to) | as written |
| | `flip`, `direction`, `toObject` | `Reversed`, `Midplane`, `SideType`, `Type`, `UpToFace` | not a number (`target`) |
| Revolution, Groove | `angle` | `Angle` | as written |
| Fillet | `radius` | `Radius` | as written |
| Chamfer | `distance`, `distanceB`, `angle` | `Size`, `Size2`, `Angle` | as written |
| LinearPattern | `count1`, `count2` | `Occurrences`, `Occurrences2` | as written; must be the stored integer exactly (Extrudo refuses a count that isn't whole, FreeCAD rounds) |
| | `distance1`, `distance2` | `Length` (Extent) or `Offset` (Spacing), and `…2` | as written, or negated where the importer writes the other sense |
| PolarPattern | `count` | `Occurrences` | as written, the integer exactly |
| | `angle` | `Angle` (Extent) or `Offset` (Spacing) | as written or negated; not bindable where the importer writes the step for FreeCAD's whole angle (−360°, a turn short by under 1e-7) |
| MultiTransform | its steps' inputs | its children's properties | not bound in this slice (`unmapped`) |
| Hole | `diameter`, `tipAngle` | `Diameter`, `DrillPointAngle` | as written |
| | `depth` | `Depth` | as written; not bindable with `DrillForDepth` (the importer takes the point off) |
| | `cbDiameter` / `csDiameter`, `cbDepth`, `csAngle` | `HoleCutDiameter`, `HoleCutDepth`, `HoleCutCountersinkAngle` | as written |
| Sketch on an offset plane (S4) | the plane's `distance` | the sketch's `AttachmentOffset.Base.z` | as written or negated, when the plane was made for this sketch, the sketch is attached to one origin plane by an offset that doesn't turn it and no container moves it; the plane is then the sketch's own (no later sketch shares it) |
| Datum plane kept as an offset plane (S9) | its construction's `distance` | `AttachmentOffset.Base.z` | as written or negated, when the offset doesn't turn it |
| Sketch constraints | `distance` | Distance | as written |
| | X or Y `distance` | DistanceX, DistanceY | negated where FreeCAD stores a negative value |
| | `radius`, `diameter` | Radius; Diameter of a circle; Diameter of an arc | as written; an arc's diameter halved |
| | `angle` | Angle | in degrees, as written when FreeCAD's value is in 0…180°, else not bindable |

"As written or negated" is read off the numbers: the input the importer wrote
equals the stored property or its negation (the same tolerance), else the
input is not bindable. **A stored 0 fits both senses, so such an input is not
bound** (`target`, "its value is 0 in the file, so its sense can't be told").
Of the negated inputs, a linear pattern's distance and a polar pattern's angle
can be 0 with one occurrence (tested: the pattern comes in, its expression
doesn't); a sketch's or a datum's plane offset can't reach it (an offset of 0
is the origin plane itself, never an offset plane); an X or Y distance takes
its sense from the mapping (the stored sign), and a distance of 0 is no
dimension but a coincidence. The other inputs are written as they are and
can't be 0 where an expression would bind (a length, a size, an angle, a
count is above 0, and an up-to offset of 0 isn't written). **An angle
dimension** is bound only while FreeCAD stores it in 0…180°, and Extrudo's
angle is unsigned: a parameter that later takes it out of that range
diverges from FreeCAD. **Old two-length pads:** S5 maps FreeCAD's `TwoLengths`
as the file has it (side 1 `Length`, side 2 `Length2`), without FreeCAD 1.1's
swap, so their expressions keep their meaning unchanged; the rule checks them
like any other.

### The translator

FreeCAD's meaning, from its grammar and the truth table (FORMAT.md): `^` left
to right and looser than a unary minus, `%` and `mod`, `;` or `,` between
arguments, `1,5` as 1.5, a unit only right after a number, `1' 2"` as a sum, a
plain number in `sin`/`cos`/`tan` read as degrees (also a name's value),
inverse functions giving degrees, `pi`, `e`, units as tokens that are never
names. The emitter keeps each piece's FreeCAD and Extrudo dimensions; both
languages hold mm and degrees, so only the dimensions can differ, and where an
operator needs them to agree it writes `* 1 mm`, `/ 1 mm`, `* 1 deg` (a number
literal takes the unit directly: `2 mm`). It writes parentheses wherever the
languages group differently (`(2 ^ 3) ^ 2`, `(-2) ^ 2`), and:

| FreeCAD | Extrudo |
|---|---|
| `mm cm m in ft deg rad`, `"` `'` `°` | as they are |
| `nm um µm dm km thou mil yd mi`, `gon M ′ AS ″`, a unit to a power | the number in mm or degrees (`1500 um` → `1.5 mm`, `50 gon` → `45 deg`, `5 (mm ^ 2)` → `5 * 1 mm ^ 2`) |
| units of other dimensions | `unit` |
| `sin(x)` with a plain `x` | `sin(x * 1 deg)` (`sin(30)` → `sin(30 deg)`) |
| `asin acos atan sqrt abs min max` | as they are (arguments brought to one dimension) |
| `floor ceil` | only of a plain number (Extrudo rounds in display units otherwise): `function` |
| `trunc(x)` | `(max(floor(x), 0) + min(ceil(x), 0))`, of a plain number only |
| `round(x)` (half away from zero; Extrudo's `round` goes half up) | `(max(floor(x + 0.5), 0) + min(ceil(x - 0.5), 0))`, of a plain number only |
| `a % b` (the floored remainder, also for quantities) | `(a - b * floor(a / b))`, `b` given `a`'s dimension so `floor` sees a plain number |
| `mod(a; b)` (C's `fmod`, the dividend's sign) | `(a - b * T)` with `T` the `trunc` form of `a / b` |
| `pow(a; b)` | `a ^ b` |
| `cbrt(x)` (negative for a negative x) | `(max(x, 0) ^ (1 / 3) - max(-x, 0) ^ (1 / 3))` |
| `hypot(a; b[; c])`, `cath(h; a[; b])` | `sqrt(a ^ 2 + b ^ 2 …)`, `sqrt(h ^ 2 - a ^ 2 …)` |
| `sum`, `average`, `count` of values | `(a + b …)`, `(a + b …) / n`, `n` |
| `pi`, `e` | `pi`, `2.718281828459045` |
| comparisons, `? :`, text, `True`/`False`/`None` | `operator` |
| `exp log log10 atan2 sinh cosh tanh stddev`, vectors, placements, ranges | `function` |
| a constraint target given a value of another unit | FreeCAD's number, as FreeCAD takes it (`1 / 2 in` → `1 / 2 in * 1 mm ^ 2`, 0.0197 mm) |
| a quantity property given a value of another unit | `unit` (FreeCAD refuses it) |

`atan2` has no rewrite that holds for every sign without a condition.
**Every rewrite is exact for every value, not only at the stored one** (the
rule only sees the stored value): `sweep.test.ts` evaluates each of the 69
expressions of FreeCAD's own sweep (`sweep-fixtures.ts`, made by
`scripts/make-expression-sweep.py`: 13 values of a cell `n` from −27 to 27,
the negative halves included) in Extrudo at each value: 55 translate and are
equal to FreeCAD's number and unit at all 13 (where FreeCAD has an error,
a division by zero, a root or a fractional power of a negative number, `7 % 0`,
Extrudo has one too; no row has a FreeCAD error where Extrudo has a value), 14
are refused (`round`, `floor`, `ceil`, `trunc` of a length or an angle; `atan2`,
`exp`, `log`, `log10`, `sinh`, `cosh`, `tanh`: `function`; the conditional and
the comparison: `operator`). The rounding forms rest on Extrudo's `floor` and
`ceil` of a plain number being `Math.floor` and `Math.ceil` (their display-unit
factor is 1 there); `x + 0.5` for an x one unit in the last place below a half
(0.49999999999999994) rounds up in both forms' floating point, which the rule
would catch at the stored value. The
reasons are a closed set (`EXPRESSION_REASONS`, a sentence each): `syntax`,
`function`, `operator`, `unit`, `reference`, `target`, `unmapped`, `differs`,
`cycle`, `limit`. Core's errors map by their code (`cycle`) or, where core has
no code, by its words, pinned by `bind.test.ts`: "Nested more than 256 levels
deep" (a FreeCAD chain whose tree is too tall for Extrudo's parser) is
`limit`, "Uses `…`, which has an error" marks a dependent failure that waits a
round.

**The truth table** (85 rows, 4 of them refused by FreeCAD and so not in the
file): 74 kept, each evaluating in Extrudo to FreeCAD's stored value; 7
numbers: `exp`, `log`, `log10` and the two `atan2` rows (`function`),
the conditional and the comparison (`operator`). `round`, `floor` and `ceil` of
literals are kept, and `trunc`; all 12 angle rows are kept (`gon` scaled, `pi / 6 rad`
taken as FreeCAD's number).

**Cycles.** Cells whose formulas read each other (strongly connected
components, iterative) are not translated: they come in as proven numbers or
stay out (`cycle`). Expressions the walk writes that close a loop are found by
Extrudo's own evaluation, which marks every member, and go back to their
numbers (`cycle`), so a design never gets a cyclic set from an import.

### Limits (hostile files)

| Limit | Value | Past it |
|---|---|---|
| An expression's length / tokens / nesting | 4,096 characters / 1,024 / 64 (`MAX_EXPRESSION_*`; the library's longest is 66 characters) | a number (`limit`), checked before any recursion: 1 MB and 100,000 parentheses are refused by the length |
| Extrudo text the emitter writes | 16,384 characters (`%` repeats its operands) | `limit` |
| Expressions per object / per import | 256 / 10,000 (S5's 64 per mapped feature stays) | `limit` |
| Parameters per import | 1,000 (`MAX_IMPORT_PARAMETERS`) | the rest stay out (`limit`) |
| Cells read per sheet | 10,000 | not read |
| A name / a group / a comment | 64 / 40 / 300 characters | cut |
| Renaming tries | 1,000 | the parameter stays out |
| The rule's rounds per feature | 64 | the rest are numbers (`limit`) |

**Measured** (Ubuntu machine, shared, one run each, `parameter-limits.test.ts`,
`BENCH=1`): a chain of cells each the one before plus one, imported with
`sheet_plate`: 100 parameters 0.5 s, evaluating the design 0.9 ms, opening it
(`loadDocument`) 5 ms; **1,000: 1.9 s, 3.8 ms, 6.5 ms**; 10,000: 141 s, 44 ms,
63 ms. The import's cost is adding them (each `addParameter` command is linear
in the design, so the whole is quadratic), not evaluating; 1,000 keeps an
import's parameters under 2 s and each later edit's evaluation under 4 ms. A
sheet of a million cells (2.4 MB zipped) imports in 2.2 s: the XML reader reads
every element (its 4,000,000 elements stop a larger one) and this importer the
first 10,000 cells. The rule costs one evaluation of the design per feature
with expressions, plus one per round that took something out (the library: 18
rounds in all). Also clean: a number that isn't finite in a cell (`limit`), a
formula Extrudo computes to infinity or divides by zero (out, or the proven
number), an alias that is a cell address, the same alias in two sheets
(renamed), two sheets of one label and a name that is another object's label
(unresolved), inputs of one feature that read each other (`cycle`).

### The report and the app

`FcstdImportReport.parameters` (`ParametersReport`): the parameters that came
in (name, sheet or variable set, the cell or property, kind, expression,
group, from its value, its formula or a proven number, and for a proven one
its formula's reason), the sources left out with why, **every
`ExpressionEngine` entry of the file with one outcome** (kept with its Extrudo
text, or the reason it is a number; `unmapped` for what didn't come in), the
names changed (of names that came in), the rule's rounds. An entry whose target
came in as a number of the design (a dimension, an input, a plane's distance
the walk added) and isn't kept has **`number: true`**: only those are "plain
numbers". An expression on a property Extrudo has no counterpart for, or on an
object that came in as a shape only, keeps its outcome (`target`) without the
flag and is in no number of the design. `parameterCounts` adds them up
by source and kind, target and outcome. `fcstdNotices` adds, only when the file
has parameters or expressions: "*n* parameters came in from the file's
spreadsheets; *k* of its *t* expressions came in live and *m* as plain
numbers." (singular and plural, "spreadsheet and variable set", "its one
expression", "both of", "all *t* of"; only kept expressions and those with
`number` are counted, so a file whose expressions are all on other targets
gets the parameters' sentence alone: "*n* parameters came in from the file's
spreadsheets."), and when names changed: "*r* names changed to fit Extrudo's
rules: cos to cos_1, max to max_1 and round to round_1, and 1 more." (each
name shown is cut to its first 40 characters and "…").

### The library (60 files, `history-corpus.test.ts`)

- **Parameters: 50** came in: 46 from 5 spreadsheets (32 lengths, 14
  unitless), 4 from a variable set (lengths). 9 sources stayed out: 7
  variable-set properties that are bools or links (`type`), 1 text cell, 1
  formula that reads a shape's volume (`reference`).
- **Expressions: 168** in the files, each with one outcome:

  | Target | Kept | As numbers | Didn't come in |
  |---|---|---|---|
  | Sketch dimension | 41 | 0 | 3 (`unmapped`) |
  | Feature input | 10 | 3 (1 `syntax`, 2 `target`) | 1 (`unmapped`) |
  | Plane offset | 1 | 2 (`target`) | 0 |
  | Anything else | 0 | 107 (`target`) | 0 |

- **What stays a number on something that comes in, by reason:** `syntax` 1,
  a pad length read from a sheet alias that is a unit token (FreeCAD itself
  drops it when it opens the file); `target` 2, two holes' thread sizes, an
  enumeration read from a text cell; `target` 2, the offsets of the two tilted
  sketches, which sit on planes through their own frames (S9), not on an offset
  plane of an origin plane. The 4 `unmapped` are on a sketch and a pad of a
  body whose history ends before them. The 107 other targets are Arch objects'
  sizes, labels and elevations (85, `.Height.Value` and the like), extrusions
  of the Part workbench (4, S11's), visibility and link properties read from
  bools and links (8), sketch placement members other than an offset (5), a
  Draft array's intervals (2), drawing scales (2) and a configuration table's
  binding and enumeration (2). No `differs`, no `cycle`, no `limit`.
- **Names changed: 11**, all named constraints whose names a parameter or an
  earlier sketch's constraint had taken. The rule took 18 rounds over the
  whole library.
- **The standing numbers did not move:** 25 bodies with their history (21 whole
  and 4 after a step), 6 from the file's shape, 4 empty, 266 `import`s, 131
  references found (the arcs amendment's number; 126 before it), 0 restarts,
  median 0.1 s a file (slowest 14.4 s).
- **The fix round (2026-11-15) moved none of these numbers:** the same 50
  parameters, 52 expressions kept, 11 names changed, 18 rounds; 25 bodies with
  history, 266 imports, the references as before, 0 restarts. No library expression uses
  `mod`, `round`, `trunc` or `cbrt`, none is proven by a count, and none has a
  stored 0 where its sense would be read off the numbers.
- **What Extrudo's language would save:** no expression in the library uses
  `%`, a comparison or a condition, and `%` translates anyway; in the truth
  table a comparison and a conditional would save 2 rows, `trunc`, `exp`,
  `log`, `log10` and `atan2` 6.

### What S11 to S13 inherit

- S11: the 4 Part-workbench extrusions' `LengthFwd` read variable-set lengths
  that already come in as parameters; their inputs bind through the same
  `Binder` once S11 maps the extrusion (its `sources` and a `bind` call in its
  transaction).
- S12: expressions on objects outside the bodies the walk reaches are
  `unmapped` or `target` today; a container's placement members stay numbers.
- MultiTransform steps' inputs (their children's properties) could bind through
  the step's `sources` (`0.count1` …), not done here.
- A configuration table (a sheet's row bound to another through
  `.cells.Bind…`) maps onto ADR-0059's configurations; 1 library file has one.

## Amendment (S11, 2026-11-15): the Part workbench's primitives and booleans as a timeline

A Part-workbench document is a graph of objects, each with its own stored shape, where a
boolean names its operands by link. Until now (S3) only the top of each such tree came in, as
the file's stored shape. Now the tree comes in as an Extrudo timeline: primitives, combines and
moves the user can edit, **each object checked against the shape the file stores for it** with
S5's check and tolerances (none loosened), in its own transaction, before the next is added.
What can't be rebuilt, or doesn't hold, comes in as the file's own shape for that object (S8's
stored-shape step: `convertStored`, a STEP attachment, an `import`), placed where the file has
it, and the tree carries on above it. `packages/fcstd`: `part-tree.ts` (`partTrees`: the trees
from the file alone), `part-import.ts` (`importTrees`: the build), `part-read.ts` (a Part
fillet's edge list); `bind.ts` gains `bindPart`, `mark`; `params.ts` takes a Part object's sizes
and placement members as inputs; `import.ts` runs the trees between the body walk and the shapes
import. No facade change, no schema change, nothing in `packages/core`. Fixtures: 22 small
documents we made with FreeCAD 1.1.4 through our own script
(`packages/fcstd/scripts/make-part-fixtures.py`; `part-fixtures-to-module.py` turns its JSON into
`part-fixtures.ts`, 250 KB: each object's own XML with the properties the importer never reads
left out and FreeCAD's repeated markup as tokens; the 175 distinct stored shapes, 586 KB as
plain text with runs of spaces made one, are joined and deflated, base64; `part-parts.ts` writes
them back into files).

### The rules

1. **Every object that comes in as a feature is checked against its own stored shape**, inside
   its own transaction, before the next object is added. A translation that can't be proven is
   never kept.
2. **An object that can't be rebuilt, or doesn't hold, comes in as the file's own shape for
   that object** (a *stored leaf*), and the tree carries on above it. **Nothing of its own
   operands stays in the design** (below: one transaction a unit, whole retries).
3. **The top of a tree that can't come in this way comes in as today** (S3's final shape), and
   the report says why. No shape that came in before is lost or changed: a tree's top body
   measures as its stored shape (it is checked like every node), or it is the stored shape.
4. **The order:** a tree's objects in an order where every operand comes before what uses it
   (an iterative depth-first walk, operands in the file's order, base first), trees in
   document order; within a unit the stored leaves come first (they need nothing, and one that
   can't come in then ends what uses it before anything is built for it); deterministic, never
   recursion on the file's depth.

### Which objects

A **tree** starts at a final shape of S3's kind `shape` whose object is a `Part::Box`,
`Cylinder`, `Sphere`, `Torus`, `Cut`, `Fuse`, `Common`, `MultiFuse`, `MultiCommon`, `Fillet` or
`Chamfer`. Its nodes are found through `Base`, `Tool`, `Shapes` and a compound's `Links`.
Everything else S3 does (bodies, links, meshes, chain tips, other shapes) is as it was.

| FreeCAD | Comes in as | Notes |
|---|---|---|
| `Part::Box` | `box` | FreeCAD's corner at its origin; Extrudo's box sits on the centre of its base: `x`, `y` are that centre, `length`, `width`, `height` the sizes |
| `Part::Cylinder`, whole and upright (`Angle` 360, `FirstAngle` and `SecondAngle` 0) | `cylinder` | `diameter` twice `Radius`, `height`; base centred on its origin |
| `Part::Sphere`, whole (`Angle1` −90, `Angle2` 90, `Angle3` 360) | `sphere` | `diameter` twice `Radius`, centred |
| `Part::Torus`, whole (`Angle1` −180, `Angle2` 180, `Angle3` 360) | `torus` | `diameter` twice `Radius1`, `tube` twice `Radius2`, centred, axis Z |
| `Part::Cut` | one `combine` (cut) per body of the base, all with the tool's bodies, `keepTools` on all but the last | |
| `Part::Fuse`, `Part::MultiFuse` | one `combine` (join): the first shape's first body the target, every other body a tool | shapes that don't touch: no feature (below) |
| `Part::Common` | one `combine` (intersect) per body of the base | |
| `Part::MultiCommon` | a chain of intersects: the first shape with the second, the result with the third … | Extrudo's intersect with several tools is the target with the tools' **union** (`kernel/src/features/combine.ts`), not the common of all; a newer file's `Behavior` "common of the first and the rest" is exactly that, one combine |
| `Part::Fillet`, `Part::Chamfer` | S6's `fillet`, `chamfer` on the base's bodies | below |
| `Part::Compound` as a cut's tool or a fuse's member | nothing of its own: its members' bodies | anywhere else (a base, in a common, under a fillet), or with a placement of its own: a stored leaf; at the top: as today |
| a `PartDesign::Body` as an operand | the body S5 to S10 bring in, walked when the tree reaches it | only when it comes in with its whole history or with steps, and nothing moves it; else a stored leaf |
| anything else with a stored shape: a cone, a partial or skewed primitive, an ellipsoid, a prism, a wedge, `Part::Feature`, `Part::Extrusion` and the other sweeps, `Part::Mirroring`, offsets, Draft and Python objects, a PartDesign feature outside a body | **stored leaf**; its own operands are not walked | |

- **Refine** has no counterpart, and the check decides: the solids are the same, the faces
  aren't. The `refine` fixture: all three trees hold; FreeCAD's unrefined fuse has 10 faces
  where Extrudo's join (which always merges faces on one surface) has 6, an unrefined fuse
  under a refined cut 12 against 10, and the refined cut 6 against Extrudo's 8 (its cut never
  merges). The report records the face counts where they differ (`TreeNodeReport.faces`).
- **A fuse of shapes that don't touch** (the `nested` fixture's two holes): Extrudo's join
  refuses them; FreeCAD's result is a compound of the two solids. When the join fails for that
  reason, the node is tried again with no feature at all, its result the operands' bodies as
  they are, checked against the stored compound (`apart`). It holds in `nested`.
- **A result of several solids** (`split`): one Extrudo body per solid, as S5's walk measures a
  FreeCAD body that rebuilds as several (`combined`); the top's bodies are named "Cut", "Cut 2".
  An operand of several bodies is used as all of them (a cut's or common's base: one combine
  per body; a tool: all its bodies).
- **Part fillets and chamfers:** the edges are `EdgeN` of the base's stored shape, from the
  binary entry (FORMAT.md); each is described on the base's stored shape and found on the
  rebuilt bodies by S6's matcher (`addDressUp`, unchanged), exactly as a PartDesign fillet. A
  fillet maps when every edge has one radius (start and end equal) and all edges the same; a
  chamfer when all edges have the same sizes: equal sizes as `equal`, two sizes as
  `two-distances` with the first size on the edge's first face in the base's face order (the
  fixture's chamfer of 2 and 4 mm holds with it). Anything else is a stored leaf (`edges`).

### Placement, as built

FreeCAD builds a primitive in its own frame and places it by `Placement`; a boolean computes
from its operands as placed, then puts **its own** `Placement` on the result; an `App::Part`
adds its placement to everything in it. The importer writes, in this order of preference:

1. **The primitive's own inputs.** The origin plane whose normal is along the primitive's
   turned Z (either way: a negative height for a box or cylinder pointing the other way), its
   position in that plane's frame (`x`, `y`, `offset`), a box's turn about the normal
   (`rotation`, from where its turned X lies in the plane). A sphere is always on XY.
2. **One `move` after the primitive** for any other turn: the primitive at the origin as
   FreeCAD builds it, then a free move. Extrudo's free move turns about world X, then Y, then Z
   through the **box centre of the bodies it moves**, then moves; the importer reads the three
   angles off the rotation (`eulerXYZ`) and the move as `t + R·c − c`, `c` that box centre
   **measured by a rebuild inside the node's transaction** (the same kernel call the move
   evaluates with, so the pivot is exact).
3. **A stored leaf** when neither holds (a placement that isn't finite, past 10 km, or no
   rotation is refused before anything is written, `placement`).

A boolean's (or a fillet's) own placement, when it isn't the identity, is one `move` of its
result (split pieces included) in the same transaction, after a rebuild that measures the
result's box, checked together with the boolean. A tree under containers whose chain isn't
the identity gets one `move` of its top's bodies at the end ("Place <top>"), checked against
the stored shape as S3 places it; nothing inside the tree knows about the container (each
node is built and checked in its top's frame: a node in another container than its top is
placed relative to it. Trees that share an object are built in the first top's frame, so a top
whose containers place it otherwise comes in as today, `container`: left in that frame, it would
not be where the file has it).

Every fixture root: by its own inputs BoxMoved, BoxTurnedZ (turned about Z: `rotation`),
BoxQuarterX (a quarter turn about X: on the XZ plane), CylMoved, CylAlongX (on YZ), CylAlongMinusY
(on XZ), CylDown (on XY, height negative), SphereMoved, SphereTilted (a sphere's turn is
nothing), Torus; with a move BoxTilted, CylTilted, TorusTilted (general axes); the booleans of
`placed_booleans` each with a move of their own (CutMoved, FusionTilted, Inner below Outer,
MultiMoved); `in_containers` with one move of each top whose container is moved and turned.

### Shared operands, and what a node that doesn't hold costs

- **A shared operand exists once per use.** Before each use but the last, the user's
  transaction first copies the operand's bodies (`move` with `copy`, nothing moved: "Copy
  <operand>") and the user consumes the original; the copy is what the next user gets. This is
  the plainest timeline the check proves: one feature per extra use, whatever the operand's
  own depth (building it again would copy its whole subtree; `keepTools` keeps every tool of a
  combine, not one). So an object used twice at each of *n* levels costs one copy per extra
  link, not 2ⁿ. `shared_operand`: one cylinder the tool of two cuts (one copy), one box the
  base of a cut and of a fuse (one copy). An operand of two trees is built in the first and
  kept, by the copy, for the second: trees that share an object are one **unit**.
- **Rule 2, as built: one transaction a unit, whole retries.** A unit (the trees that share
  objects) is built inside one outer transaction (Extrudo's history nests them); each node in
  its own inner one. When a node that didn't hold had operands built for it, or a top doesn't
  hold, the pass has **waste**: the outer transaction is cancelled (the binder's state, the
  attachment bytes and the body list go back with it, `Binder.mark`) and the unit is built
  again from the start with what the pass learnt: that node is a stored leaf from the start
  (its operands not built), that top comes in as today. A pass learns at least one thing, and
  everything the check proved holds again on the same inputs. At most **4 passes**
  (`MAX_TREE_PASSES`); past them the unit's tops come in as today (`passes`). Chosen over
  removing the dead features one by one: a removal has to find every copy, move and import the
  operands made and every later feature that named them, where a cancel is exact by
  construction, and a second pass costs only the unit's own rebuilds. `nested` with its cut's
  base and tool swapped: pass 1 builds the box, cylinder, fusion and holes, the cut doesn't
  hold; pass 2 imports the cut's own shape and builds the box and the common: the timeline is
  `Import Cut`, `Box001`, `Common`.
- **Kernel calls:** a node is one `measureStoredShape` and one rebuild (a leaf: one
  `storedShapeToStep` and one rebuild; a turned primitive or placed boolean one more rebuild
  for the pivot; a fillet S6's describe and reference calls). A tree of *n* nodes costs about
  2·*n* calls a pass, and a rebuild sends the design so far (S5's known limit: a file's cost
  grows with nodes × design size). A retry costs another pass.

### Expressions (S10's binder)

A primitive's sizes (`Length`, `Width`, `Height`, `Radius`, `Radius1`, `Radius2`) bind through
the `Binder` as feature inputs do (`Binder.bindPart`, in the node's transaction, before its
rebuild; the rule decides, the shape check runs with the expressions in). A radius is written
as a diameter, so the binder's transforms gain `double` (`2 * (…)`, read back as `(name / 2)`).
A placement member (`.Placement.Base.x` …) binds only where the importer writes exactly that
member as one input, as written or negated (S10's rule; never a stored 0): a cylinder's,
sphere's or torus's `x`, `y`, `offset` on an origin plane whose axes are world axes, and a
boolean's own translation (`dx`, `dy`, `dz` of its move when it doesn't turn). A box's `x` and
`y` are its base's centre, never a member; **when a box's length or width is bound, its `x`
and `y` follow it** (`followText`: `corner + (length) / 2`), so a changed parameter grows the
box from FreeCAD's corner as the file's model does. A literal size edited in Extrudo grows the
box about its centre (Extrudo's box sits on its centre). **A primitive or boolean placed by a
turning move follows FreeCAD's model only at the imported sizes:** the kernel computes a free
move's pivot when it evaluates (the bodies' box centre `c′`), while the move's distances were
written for the centre `c` at import, so after a size changes the result differs from FreeCAD's
by (I − R)(c′ − c). A box placed by a move also keeps its `x` and `y` as numbers: they don't
follow a bound length or width. Part fillets' and chamfers' sizes live
in the binary edge list, which has no expressions. The `bound` fixture comes in live: all 11 of
its expressions are kept, and with `length` set to 40 and `lift` to 2 the cut measures what
FreeCAD's changed model must (the box from 0 to 40, the hole following `length / 2`, the cut 2
up). An expression on an object that ends as a stored leaf stays a number of the file's shape:
on a type that never maps (an extrusion, a mirror, a Python object) it is an `other` target as
before; on a primitive or boolean type it is an `input` target whose object didn't come in, so
it ends `unmapped`. A fuse kept apart has no feature to hold one, a boolean turned by its own
placement no input for a member, and an input left out because the file stores 0 has S10's
reason for a stored 0: each ends `target` with that reason. **S10's note that S11
would map the Part extrusions is corrected**: extrusions are stored leaves here, so their
`LengthFwd` expressions stay numbers on what came in as a shape.

### Limits (hostile files)

| Limit | Value | Past it |
|---|---|---|
| Objects one tree | 500 (`MAX_TREE_NODES`) | the top comes in as today (`limit`) |
| Objects the trees of one import | 2,000 (`MAX_IMPORT_TREE_NODES`, counted per tree walked) | the later trees' tops as today |
| Shapes one MultiFuse or MultiCommon lists | 64 (`MAX_MULTI_OPERANDS`) | a stored leaf (`limit`) |
| Features the trees of one import add (copies, moves and the features of a body a tree uses included) | 4,000 (`MAX_TREE_FEATURES`), a node's counted before any of them is added | the trees that would pass it as today |
| Bodies one operand brings to the node that uses it | 256 (`MAX_OPERAND_BODIES`; the library's largest stored shape has 86 solids) | the user is a stored leaf (`limit`), a top as today |
| Passes per unit | 4 (`MAX_TREE_PASSES`) | the unit's tops as today (`passes`) |
| Edges in a fillet's or chamfer's list | 1,000 (S6's), the entry exactly 4 + 20 per edge | a stored leaf (`edges`) |
| A primitive's size | above 1e-6 mm, at most 10 km, finite | a stored leaf (`value`) |
| A placement | finite, within 10 km, a rotation | a stored leaf (`placement`) |
| Stored leaves | S8's per-shape limits and the design's 100 MB | a leaf that can't come in makes its user a leaf, and so on up; a top that can't is as today |

Also clean, each with its reason: a link to an object that isn't in the file, to itself, to a
sketch, a sheet or a container (`operand`); a cycle of links (the node that links back is a
leaf, `cycle`); the same object twice in one `Shapes` list, a boolean with one operand or none
(`operand`); a count larger than the edge entry, a truncated entry, an index of 0, sizes that
are 0, negative or not finite, a missing entry (`edges`); an index past the base's edges
(S6's `element`); an operand whose stored shape is missing or has no solid (its user and the
top as today); a root whose stored shape is a compound of nothing (no final shape, so no tree).
The walk is iterative: a chain of 10,000 cuts is planned (and refused at the tree cap) in well
under a second. The budgets (S3's time per call and per import, the restart cap) stay the
judges of the whole import; a call that fails makes its node a leaf.

**Measured** (Ubuntu machine, shared and loaded, one run each; `part-hostile.test.ts`,
`BENCH=1`): a chain of fuses of one box, each fuse the base of the next: 12 fuses (25 objects)
1.6 s and 62 kernel calls, 100 fuses 4.1 s and 502 calls, **300 fuses (601 objects, past the
tree cap, raised for the test) 12.1 s and 1,502 calls**: about 2.5 calls an object and linear,
since a rebuild remeshes only what the newest feature changed. The `deep_chain` fixture (twelve
cuts in a row, 25 objects) takes 0.7 s. 500 objects a tree keeps one tree well inside S3's 60 s
a call and the import's 10 minutes; 2,000 an import bounds the whole file's trees to about four
such trees. What a tree costs beyond that is the kernel's own work on large shapes (below).

### The report and the app

`FcstdImportReport.trees` (`TreeImport`): per tree its top (object, name, type), the outcome
(`history`, `leaves`: with stored leaves and live features above, `shape` and `left-out`: as
today, with the reason), the passes, the container move, and per node (`TreeNodeReport`) the
object, its type, what it became (`feature`, `leaf` with its reason and detail, `members`,
`body` with the body's history), the features it added, the moves written for placements, the
copies made of it, the references a fillet found, how a primitive was placed, the inputs bound,
the face counts where they differ, `apart`. Every object of every tree has one outcome.

`fcstdNotices`: a tree that came in counts as a shape "with its history", one with stored leaves
"with part of its history", as a body with steps does; the first notice's bracket says what the
history is made of ("sketches and features", "primitives and booleans", or "sketches, features,
primitives and booleans"). A tree that came in as today joins the line "Taken from the file's own
shapes, without their whole history: …" with its reason. One new sentence: "Built on the file's
own shape for a part of it: *Name*, because *reason*. What uses that part comes in with its
history." (several: "Built on the file's own shapes for parts of them: *A*; *B*. Most often
because *reason*, or *reason*. What uses those parts comes in with its history.").

### The library (60 files, `history-corpus.test.ts`)

- **Trees: 33** (a final shape of S3's kind `shape` whose object is one of the tops above; by
  the Part links alone there are 41 tops, and the other 8 are no final shape: used by sketches,
  a Python object, a thickness or a PartDesign fillet, or holding no solid), and
  they hold 296 of the library's 321 Part primitives, booleans, fillets and chamfers; the other
  25 are used by Python objects, PartDesign features and objects that are no final shape.
  **8 with their whole history** (3
  cuts, 2 boxes, 2 cylinders, a sphere), **11 with stored leaves and live booleans above them**
  (6 MultiFuses, 4 cuts, a MultiCommon), **14 as today** (5 chamfers, 5 MultiCommons, 3 cuts, a
  fillet that S3 leaves out too).
- **Objects of the trees that came in:** 60 features (19 boxes, 11 cylinders, a sphere, 14
  cuts, 12 MultiFuses, a MultiCommon, 2 Part fillets) and 35 stored leaves: 33 by type (17 Part
  extrusions, 8 Python objects, 4 PartDesign features outside a body, a plain stored shape, a
  mirror, a sweep, a revolution) and 2 that don't hold (`differs`: a MultiFuse whose stored
  shape has 2 solids where Extrudo's join makes 3, a MultiCommon of 6 solids where the chain
  of intersects keeps 2). Primitives placed by their own inputs 29, with a move 2 (boxes);
  moves written 7; container moves 0; copies of shared operands 0 (no tree uses an object twice,
  and no two trees that came in share one); expressions bound on tree objects 0 (the library's bound sizes are on objects of
  trees that come in as today, or on extrusions); retried units 4, the most passes 2. The
  features that held drift at most 1.8e-8 in volume from their stored shapes; 6 hold with face
  counts that differ from FreeCAD's (refine, and joins that merge where FreeCAD's fuse didn't).
  The trees' Part fillets found 3 edges, none missing.
- **The census** (by the links alone): 175 primitives (91 boxes, 82 cylinders, a sphere, a
  cone; 32 turned: 16 boxes about Z, 11 cylinders by quarter turns, 5 otherwise), 131 booleans (51 cuts, 24 fuses, 7
  commons, 42 MultiFuses, 7 MultiCommons), 47 of them with a placement of their own, 15 Part
  fillets and chamfers, 18 compounds.
- **The standing numbers did not move:** 25 bodies with their history, 6 from the file's
  shape, 4 empty; 131 references found; 50 parameters; 52 expressions kept; no restart; every
  final shape that isn't a tree's top comes in exactly as before (329 compared, 0 differ). The
  count of final shapes is unchanged.
- **`import`s:** the final shapes' imports go from **266 to 247**: the 19 tops that now come
  in with their history (8) or with leaves (11) have none. The trees' stored leaves add **35**
  imports. 287 `import` features in all, S8's steps included.
- **Expressions:** 4 entries on Part objects' sizes and placements moved from `other` targets to
  feature inputs, where they are `unmapped` (3) or `target` (1): their objects belong to trees
  that come in as today.
- **Time per file:** median 0.17 s (0.1 before), **slowest 56 s (14.4 s before)**. The slowest
  is a file of letters cut and intersected: four MultiCommon trees each import nine Part
  extrusions of text (each a STEP import Extrudo takes seconds to rebuild and mesh) and two of
  them can't come in after all. Two changes measured on it took it from 119 s: a fuse whose
  stored shape is its operands side by side (their solids and volumes add up) is tried apart
  first (Extrudo's join took 21 s to find that nine letters don't touch), and the file's own
  shapes are built first in a pass, so a leaf that can't come in ends its users before anything
  is built for them. Another file of extruded text took 1.6 s before and 42 s now, for the same
  reason (a boolean on imported letters rebuilt in Extrudo's kernel); the import's budgets
  bound both.
- **The 14 trees that come in as today, by reason:** 4 chamfers (`reference`) in one file,
  each on a deep tree of booleans that held, where an edge the chamfer names has no counterpart
  on the rebuilt body (the check compares the solids' measures, not their edges; of the
  library's 50 dress-up lookups, bodies' included, 10 met a rebuilt body with another number of edges than
  the stored base); 1 chamfer (`failed`): our OCCT refuses its size on
  an edge it doesn't fit, as S6's two fillets; 3 MultiCommons (`failed`): a common
  whose first shape is several solids, where Extrudo's intersect refuses a solid that misses the
  tool and FreeCAD drops it; 2 MultiCommons (`operand`): a shape they use is a Python
  object whose stored shape can't come in; 2 cuts (`differs`, by 4.5e-5 and 5.9e-5 in volume:
  both have stored leaves below them, and the drift is of the size S8 measured through STEP); 1 cut
  (`failed`): its tool doesn't overlap its base, a cut Extrudo refuses as removing nothing; 1
  fillet whose own stored shape S3 already leaves out (`differs` by 160 %, as its STEP does).
- **Where the rest are:** the 14 trees that come in as today name 227 primitives, booleans,
  fillets and chamfers (an object in two trees counted in each), against 71 in the trees that
  came in.
- **What the gaps would save, as counts:** a cone primitive 0 (the library's one cone is used by
  an object that is no tree); a part cylinder or other partial primitive 0; a refine flag 0 (6 trees
  hold without it, faces aside); a combine that keeps one tool of several 0 (no tree that came
  in shares an operand); an intersect that drops a body missing the tool 3 trees; a cut that
  may remove nothing 1; extrusions as features 17 leaves.

### Review round (2026-11-18)

An independent review of the slice found these; each has a test in `part-review.test.ts`.

1. **What one node adds is known first.** A cut writes a combine per body of its base, an
   intersect one per body and per shape after the first, so a stored compound of many solids
   could make one attempt add thousands of features with no time check inside. The count (copies,
   combines, moves) is taken before anything is added; past `MAX_TREE_FEATURES` the node's trees
   come in as today, and an operand of more than `MAX_OPERAND_BODIES` bodies makes its user a
   stored leaf, so one attempt is bounded whatever the cap is.
2. **One set of counters per import** (`WalkShared`, `newWalkShared`, `markWalkShared`): the
   features walked, the steps' stored text, the projections, the datums, which body owns which
   feature and sketch, and whether the design's attachments are full. The body walk before the
   trees and each body a tree uses share it, a cancelled pass gives back what it counted, and the
   features of a body a tree uses count towards `MAX_TREE_FEATURES`.
3. **A compound uses nothing up; what uses the compound uses its members**
   (`effectiveOperands`): a member a compound holds and something else uses directly is copied
   for each use but the last, whichever comes first.
4. **An object named as both `Base` and `Tool`** is refused (`operand`), as one listed twice in
   `Shapes` is.
5. **A cancelled pass forgets its planes** (`forgetRemovedPlanes`): an offset plane the sketch of
   a body operand made went with the pass, and the next pass's sketch would have named it. The
   datums and owners go back with the counters; decoded sketches are the file's and stay.
6. **A pass that loses its first top runs again.** The unit is built in that top's frame, so the
   other tops can only be judged against a first top still there.
7. **Words and reports:** a tree whose body operand took a stored-shape step comes in `leaves`; a
   tree that uses a body says "sketches, features, primitives and booleans"; one tree on several
   of the file's shapes reads "Built on the file's own shapes for parts of it".

Measured (Ubuntu machine, shared; `BENCH=1`): a tree of 456 objects, seven MultiFuses of 64 stored
leaves each, none with a stored shape, so that every leaf changes what the pass needs: 0.7 s.

### After main's limits and the STEP pass (2026-11-18)

- **Core's limits on an expression** (ADR-0004's amendment: 10,000 characters, 1,000 values a
  call, 256 levels, 10,000 levels through parameters) are tighter than the emitter's 16,384
  characters. Text between the two is written, core refuses it with the code `limit`, and the
  rule puts the number back with that reason (tested). `fc-expr.ts`'s own 4,096 characters of
  FreeCAD text stay the first gate. **A box's centre** reads both its sizes, so it can pass the
  limit where each size doesn't: it is kept only where core evaluates it to the file's number,
  else it stays a number (tested) and the bound sizes stay live.
- **The STEP pass** (`step-reals.ts`) rewrites reals written without a decimal point before an
  `import` reads them. The STEP of a stored leaf or step is our own writer's, whose reals all
  have the point, so the pass returns it unchanged and what the read-back checked is what the
  feature reads (tested on the fixtures' leaves). The library's numbers did not move.

### What S12 and S13 inherit

- **S12:** compounds at the top (18 in the library) still come in as the file's shape; a
  compound could come in as its members' trees, one body each, which this slice's code does for
  a compound used as a tool. Part containers as Extrudo components: a tree inside an `App::Part`
  already comes in with one move of its top, so a component would take that move's place. Files
  from before bodies: a PartDesign feature outside a body is a stored leaf here (4 in the
  library's trees).
- **S13:** the time a tree costs on large imported shapes (two files above), the chamfers whose
  edges a rebuilt boolean doesn't share with FreeCAD's, and S8's STEP drift as a tolerance per
  shape. Hostile input: the passes rebuild a unit from the start, so a unit whose nodes keep
  failing one by one costs up to 4 passes of its own rebuilds; the feature cap and the import's
  time bound it.

## Amendment (S12a, 2026-11-19): PartDesign features that are in no body

FreeCAD had no bodies before 0.17. A file from 0.14 to 0.16 holds a part as a row of PartDesign
features, each with its own stored shape, and newer files can hold such features too. Until now
(S3) the last feature of such a row came in as one `import`. Now the row comes in as a body's
history does: sketches and features the user can edit, **each checked against the shape the file
stores for it** with S5's check and tolerances (none loosened), in its own transaction, with S8's
stored-shape step where a feature can't be rebuilt, S9's references and S10's bound expressions.
`packages/fcstd`: `loose-chains.ts` (the plan, from the file alone); `bodies.ts`'s one walk now
takes a body or a loose chain; `transforms.ts` `sketchFace`; `sketch-place.ts` a sketch on a face;
`part-tree.ts` and `part-import.ts` a loose chain as an operand. No facade change, no schema change,
nothing in `packages/core`. Fixtures: 14 small documents we made with FreeCAD 1.1.4 through our own
script (`packages/fcstd/scripts/make-chain-fixtures.py`, `chain-fixtures-to-module.py`;
`chain-fixtures.ts` is 66 KB, one deflated JSON text); `chain-parts.ts` writes them back into files,
in FreeCAD 1.1's grammar or, through `asOldFile`, a 0.14 or 0.16 file's.

### What a loose chain is

A **loose feature** is an object of a PartDesign feature type (not a body, a datum or a binder)
that no body holds. A **loose chain** is a tip and the loose features reached from it by following
each one's base, root first. Its tips are those of S3's `chain-tip` final shapes that are loose
features, and any loose feature of a type the walk maps that a Part boolean uses; a binder at the
top stays the plain shape it was. A tip of a type the walk has no mapping for (a Python feature, a
draft) comes in as today without its chain being walked. A feature's **base** is, in this order:

1. its `BaseFeature`, when the property names an object;
2. a dress-up's `Base`;
3. of a pattern's or mirror's originals, the one no other of them builds on (the last of them in
   their row); the first when they aren't in one row;
4. the object its sketch is attached to, when that object stores a solid.

A sketch with no support, or on a plane or a datum, gives no base: the feature starts a new solid.
Where rules 1 and 4 name different objects rule 1 wins and the plan counts it. The base as read is
never trusted: a base read wrong gives a feature that doesn't hold. **A pattern whose base isn't the
feature before it** builds on that original, and what lies between is in no chain of its.

- **The walk is the body's.** `importBodies` takes its ordered features from a body (`bodyChain`) or
  a loose chain (`BodyWalkOptions.loose`); nothing else about it differs. A chain has no `Origin`,
  no `Tip` and no placement of its own: every place that reads the body's origin refuses cleanly
  (the feature is then a stored-shape step), and a chain inside `App::Part`s is placed as a body in
  them is (`containerChain`).
- **Branches.** A feature that is the base of several others belongs to several chains, and each
  chain walks its **own copy** of what they share: the sketches and features come in once per
  chain, under the same names (`branch`: two tips, a pad and its sketch twice). **A loose chain
  takes nothing from a body:** it neither claims an object in `WalkShared.owner` nor is refused by
  a claim, so a sketch a body and a loose feature share comes in once for each, in either document
  order and for a body a Part tree uses. The import's counters count every copy.
- **A foreign base.** A root that builds on an object that is no loose feature (a Part box, a cut,
  any stored shape) starts with S8's stored-shape step holding that object's stored shape (reason
  `foreign-base`), and the features after it are live. The base object is consumed as it always was.
  That reason stands only while no feature of the chain has failed after it: a step that moved on
  past the base, and a chain that ends as today, report the first feature that didn't hold.
- **As today.** A chain that can't come in (a broken link, a cycle, past a limit, or a last feature
  that doesn't hold) comes in as S3 brought it: the tip's stored shape as one `import`, with the
  reason in the report. No shape that came in before is lost or changed, and the count of final
  shapes is the same. A first feature that doesn't hold is a stored-shape step when features follow
  it, as in a body; a chain of that one feature comes in as today.

### Sketches: a face that stays, a plane that doesn't move

A sketch's frame is its stored `Placement` in its containers (S4), in both grammars. Before 0.17 a
sketch has no `MapMode` and `Support` is one link; the placement is what FreeCAD last wrote.

**A loose chain's sketch stays on the flat face its support names**, whichever feature it is for (a
pad or pocket, up to a face or not, a revolution, a groove, a hole), when that face is on a feature
walked before, S6's matcher finds exactly one counterpart on the rebuilt body, and the stored frame
lies in the face's plane (parallel to 1e-9 as a sine, within 1e-7 mm + 1e-9 of the distance from
the origin: S9's tolerances for a datum). The sketch is then written on the face (`GivenPlane` of
kind `face`, `TransformMapper.sketchFace`) and follows the model: lengthen the pad and the pocket
stays on its top. Extrudo's frame on a flat face depends only on the plane and its outward normal
(`faceSketchFrame`), and the matcher compares normals, so the frame the importer writes in is the
one the kernel computes. S9 kept body sketches on fixed planes because it couldn't prove that
before the rebuild; here a try that doesn't hold on the face is made again on the fixed plane its
stored placement gives (S4's planes, else S9's plane through three points). It isn't made again when
no face was found (the same try would only repeat), when the failure is final, or when the kernel
call failed, ran out of time or restarted the kernel. `faceFallbacks` counts the features whose try
on the fixed plane held after their try on the face didn't; a feature's second attempts count its
other targets (an up-to pair, a hole's cut), and a body's features are tried as before. **Bodies are unchanged**:
their sketches stay on S9's planes, so their standing numbers don't move.

### The old grammar, as read

`FORMAT.md` has the table. S4's sketch reader and S5 to S7's decoders needed **nothing new**: they
already read `Sketch` for `Profile`, the integer `Type`, `Midplane`, the single `Support` and the
constraints without `IsDriving`. A census test (`chain-corpus.test.ts`, counts only) checks that
every property `asOldFile` writes has the declared type the library's files of that version use.
An old file can say what a feature builds on only through its sketch's `Support`. In the library
every old pocket's sketch is on a face and the two old revolutions on no face start their solids;
there is no old groove. A groove whose sketch has an empty `Support` says nothing of what it cuts:
it starts a new solid, is refused (`no-base`) and comes in as today.

### Part trees (S11)

A loose feature of a type the walk maps that a Part boolean uses was a stored leaf. It is now a node
of kind `loose`, walked when
the tree reaches it as a PartDesign body is (`walkBody`): the chain comes in with its history and
the boolean is live above it. The import's counters and S11's feature cap count its features, and a
cancelled pass gives them back. A chain that doesn't come in whole, one under a moved container, or
one that ends in a stop is that tree's stored leaf, as a body is.

**Not built: a root whose foreign base is a tree S11 could build.** The chain would have to start
from a tree's result bodies, which neither `walkBody` nor a unit's passes can hand on: a node would
have to be both a tree's top and a chain's first step, a second mechanism on S11's units. The
foreign base stays the stored-shape step, and what comes after it is live.

### Limits (hostile files)

| Limit | Value | Past it |
|---|---|---|
| Features one chain | 500 (`MAX_BODY_FEATURES`, the library's longest is 8) | as today (`limit`) |
| Chains at an import's top | 256 (`MAX_LOOSE_CHAINS`, the library has 14) | the rest as today (`limit`) |
| Features the top's chains plan | 2,000 (`MAX_FILE_FEATURES`), shared features counted per chain; a refused chain gives back what it counted | later tips as today, unfollowed |
| Features one chain under a tree plans | 500 a call, the tree's nodes and passes bounding the calls | a stored leaf |
| Features the planner visits, refused chains included | 4 × `MAX_FILE_FEATURES` (`PLAN_VISITS_PER_FEATURE`) | as today (`limit`) |
| Links followed among patterns' originals, in the whole file | 20,000 (`MAX_ORIGINAL_LINKS`; the library needs none) | as today (`limit`) |
| A stored shape read to tell whether it holds a solid | 32 MB (`MAX_STORED_BREP_BYTES`), each entry scanned once however many objects name it or whether it can be read | no solid, so no base |
| A sketch's supports read | the first of 16 (`supportsOf`), once per sketch | |
| Originals compared for a pattern's base | 100, 500 links followed | the first original |
| Features one import walks | 2,000, bodies, chains and trees' operands together (`WalkShared.walked`) | the chain ends (`limit`), as today |
| Steps one chain | 8 (`MAX_BODY_STEPS`) | as today (`limit`) |

Also clean, each with its reason: a base cycle (two features on each other, a feature on itself, a
pattern its own original) and a base or first original that isn't in the file, or is a sketch, a
spreadsheet or a container (`chain`, as today); a body, a body's feature or a Part object as a base (a
foreign base); `Originals` empty or listing the pattern itself (`original`); a support whose sub-name isn't a face, or a face
number past the base's faces (the fixed plane); one sketch used by two features (the check decides);
a feature with neither `Profile` nor `Sketch` (`profile`); a sketch `Placement` that isn't finite
(`sketch`). The plan is iterative and reads each feature's base once.

**Measured** (Ubuntu machine, shared and loaded; `chain-import.test.ts`, `BENCH=1`): a comb of 1,500
tips on one row, which by the links alone is 1.1 million walked features, stops at the cap in
**0.73 s**; a row of 10,000 features is refused at the cap in **0.53 s**, the file's own reading
included; 200 objects naming one stored shape of 30 MB take **0.25 s**, the entry read once; 256 rows
of 501 patterns of two originals each, about 64 million links without the budgets, are planned in
**0.13 s**.

### The report and the app

`FcstdImportReport.bodies` lists a chain as it lists a body, with `loose` set (and `foreignBase`
naming what its root builds on); `HistoryStop` gains `foreign-base`. S11's reason for an operand that
doesn't come in reads "a body or a row of features it uses didn't come in with its history". `fcstdNotices` needed no new
sentence: a chain counts as a shape "with its history (sketches and features)". The new reason reads
"Starts from the file's own shape: *Name*, because it is built on another shape in the file. The
features after it come in with their history."

### The library (60 files, `chain-corpus.test.ts`, `history-corpus.test.ts`)

- **14 loose chains at the top of 13 files, 47 features.** Lengths: four of 1, two of 2, four of
  3, one of 4, one of 7, two of 8. **8 with their whole history; 5 with a stored-shape step (4 on a
  foreign base: a Part chamfer, a cut, a revolve and a plain stored shape; 1 where a pattern
  touches another shape of the file, so S7's rule takes it out); 1 as today**: its last feature is
  a fillet whose edges are all found and whose volume, area and box agree, while its centre of mass
  differs by more than the check allows. The edges are among those the stored fillet consumed and
  the body before it is equal, but the stored fillet's centre lies further from its base's than a
  fillet of its size could move it: the centre the kernel reads for that shape isn't a sound solid's,
  so the check can't prove the feature.
- **Bases:** 26 by a sketch's support, 7 by a pattern's original (each of the library's 8 old patterns
  has one), 4 by a dress-up's `Base`,
  none by `BaseFeature`, 10 roots with no base; no file names two different bases.
- **Features held:** 13 pads, 22 pockets, 4 polar and 2 linear patterns, 2 fillets, 1 chamfer, 1
  revolution: 45 of 47. **Sketches:** 24 stay on a face (23 before 0.17), 12 on fixed planes (11
  before 0.17). 49 references found, 2 none.
- **Under Part trees:** 5 loose chains (12 features, all held; 4 whole, 1 with a step). The trees go
  from 8 with their whole history and 11 with stored leaves to **9 and 10** (one tree's only leaf
  was such a chain); 14 as today, unchanged. The trees' stored leaves go from 35 to 30.
- **`import`s:** the final shapes' go from **247 to 234** (the 13 chains that came in); the chains'
  steps add **5**, and a chain under a tree adds 1 where 5 stored leaves went: **287 to 275** in all.
- **Branches:** no two of the 14 chains share a feature. The library's expressions don't touch a
  loose feature or its sketch, so this slice binds none in it.
- **The standing numbers did not move:** 25 bodies with their history, 6 from the file's shape, 4
  empty; 131 references found; 50 parameters; 52 expressions kept; 383 final shapes; no restart.
- **Time per file** on the shared machine: median 0.26 s, slowest 54 s (0.17 s and 57 s after S11,
  measured alone).

### What S12b and S13 inherit

- **S12b:** part containers, links, compounds at the top and meshes are untouched here. A chain
  inside an `App::Part` comes in flattened to world coordinates, as a body inside one does.
- **S13:** a foreign base that S11 could build; the tips another object uses that no tree walks
  (they stay out of the design's history); sketches of bodies on faces, which could take this
  slice's rule once the bodies' standing numbers may move.

## Amendment (S12b, 2026-11-20): meshes, part containers as components, links as copies, compounds at the top

Four things a FreeCAD document has around its shapes came in flat, not at all, or several times
over: meshes were left out, `App::Part` containers only placed what they hold, each link was one
more `import` of its target's stored shape with the link's placement baked in, and a compound at the
top was one `import` of its stored shape. Now a closed mesh is a mesh body, each part a component, a
link a copy of what its target became, and a compound its members, each as it would come in at the
document's top. `packages/fcstd`: `mesh-read.ts` (the mesh kernel entry, pure), `meshes.ts`,
`structure-build.ts` (the transactions and rebuilds below), `compounds.ts`, `links.ts`,
`components.ts`, `structure.ts` (the stage after the shapes import); `final-shapes.ts` shares its
consumer index and solid test (`consumersOf`, `hasSolid`); `@extrudo/io` is a new dependency of
`@extrudo/fcstd` (`writeStl` and the mesh checks; io gains nothing). In `packages/kernel` only
`importRebuilder` changed: it turns the kernel's mesh bodies on once when it sends a mesh
attachment, as the project's recomputer does. No facade change, no schema change, nothing in
`packages/core`. Fixtures: 16 small documents we made with FreeCAD 1.1.4 through our own script
(`packages/fcstd/scripts/make-structure-fixtures.py`, self-contained;
`structure-fixtures-to-module.py` makes `structure-fixtures.ts`, 75 KB, one deflated JSON text;
`structure-parts.ts` writes them back into files). Each object carries FreeCAD's measure of the
shape it shows in the document's frame, through its containers and links (`world`), and a mesh what
FreeCAD says about it (`mesh`): the truths the tests check against.

### The rules

1. **Nothing comes in unproven.** A mesh body, a link's copies and a compound's placed members are
   each added in a transaction of their own, the design is rebuilt in the import kernel, and the
   transaction is kept only when the check holds (`StructureBuild.attempt`: a rebuild that measures
   only the bodies that are new or moved; a cancel takes the attachment and the body metadata back
   with it).
2. **No shape that came in before is lost or changed.** The count of final shapes is unchanged. The
   shapes import converts every link and every compound that may come in another way along with
   the rest, under the same budgets as before this slice, and keeps the bytes (`defer`); a link or
   compound whose new attempt doesn't hold is added from those bytes as S3 brought it, with no
   kernel call (`DeferredShapes.add`). So a mesh, a copy or a member walk that times out or uses up
   the kernel's restarts can't make what came in before be left out. The one exception is a
   scaled link (below): S3 brought it in at the wrong size.
3. **From the file alone, iterative, every count checked first.** The plans (`planCompounds`,
   `planLink`) never recurse on the file's depth; a mesh entry's and a placement list's counts are
   checked against the entry's length before anything is allocated.

The timeline's order: the bodies' histories, the Part trees, the shapes import (S3 to S12a), then
each compound's members with the move that places them, the meshes, the links' copies, and last the
imports of the links and compounds that came in as before after all. Converting the fallbacks first
was chosen over running the new attempts after them: an attempt replaces a fallback that would
otherwise already be in the design, so it could only follow it as a removal, which leaves the
fallback's attachment behind; converting costs the kernel what S3 always spent on those shapes.
**The bytes stay held for them** (`DeferredShapes.held`: each distinct file of a shape not yet
settled once, none the design already has) until each is settled: released when it came in another
way (a copy, a compound's members), added when it falls back. Everything that adds attachments
meanwhile, the meshes and a compound's members (their steps, leaves and imports), is judged against
the design plus what is still held, so the fallbacks' add can never be refused or pass the design's
100 MB: a mesh that would is left out (`design-full`), and a compound whose members wouldn't fit
beside what is held comes in as before. A compound's members add nothing to the import's progress,
which never goes back nor past its total.

**A compound that comes in as before leaves nothing behind.** Its members are walked (the body walk,
the trees, the shapes import, each as at the document's top) inside one transaction with the placing
move and the check; when the check doesn't hold, that transaction is cancelled whole and the binder,
the walk's counters, the planes the members' sketches made and their attachment bytes go back with
it (S11's rule for a unit that doesn't hold): the design's features, attachments and parameters are
what they were before this slice for that file.

### Meshes

**The entry** (`*.bms`, `MeshKernel::Write` in FreeCAD's source; FORMAT.md): little-endian, the magic
`0xA0B0C0D0`, the version `0x00010000`, 256 bytes of header text, the point and facet counts, three
`float32` a point, three point indices and three neighbour facets (`uint32`) a facet, then six
`float32` of bounding box: exactly 296 + 12 *p* + 24 *f* bytes (the mesh box fixture: 680). FreeCAD
reads the same layout big-endian (magic and version swapped) and, without the magic, an older layout
of its own; it writes neither, the library has neither, and the reader refuses both (`format`).
`readMeshKernel` refuses, each with its detail: another magic or version, an entry shorter than the
head or not exactly what its counts say (`length`), more facets than the cap (`facets`, from the
header alone), a point index past the points or a neighbour past the facets that isn't the open-edge
mark (`index`), a coordinate that isn't finite (`coordinate`), a facet that names one point twice
(`degenerate`). No facets is `empty`.

**The frame.** The points are in the object's own frame: `meshes`' turned cylinder stores its points
from 0 to 20 along X, and FreeCAD shows it from x 35 to 45 and z −20 to 0, its `Placement` (a quarter
turn about Y, then 40 along X) applied; `mesh_in_part`'s mesh box is in its part's frame (the part's
placement isn't in FreeCAD's mesh box). The import places the points by the containers' chain and
then the object's `Placement`, in double precision, and rounds them to single precision once: the
STL holds those numbers and the check is measured from them.

**What it becomes.** Binary STL (`writeStl`), an attachment of media type `model/stl` named by its
SHA-256 (equal meshes share one, as STEP attachments do), and an `import` feature (`units` mm, `up`
z, `position` file) named, coloured and shown as S3 does for a shape. Only a `Mesh::Feature` is a
mesh: a link to a mesh is a link (a copy below), never a second mesh import. **The check** runs the kernel's
own pure steps on the placed triangles (`meshFacts`): weld by exact position as `readStl` does, drop
flat and repeated triangles, split the edges where surfaces only touch (`splitNonManifoldEdges`),
`checkManifold`; then the pieces (triangles joined by edges), the signed volume, area and box. The
kernel's bodies must be as many as the pieces, their volume and area within 1e-6 and their box within
S5's tolerance. A mesh that isn't closed (open, non-manifold after the split, flipped edges, bad
triangles) is left out before anything is added (`not-closed`, with the count); `mesh_odd`'s open box
and sheet are, its two pieces are two bodies, its empty mesh is `empty`. A mesh something else
consumes is no final shape and stays as before.

**Each entry is read once**, however many objects name it, and one whose header counts more facets
than the import has left is refused from those first 272 bytes, never inflated whole; an entry with
more points than three a
facet is refused (`points`: a point no facet can use still costs a weld). **The first kernel failure
ends the meshes**: after a mesh whose rebuild throws, runs out of time or finds no mesh kernel, every
other mesh is left out with the same reason, so one failure costs one restart, not one a mesh.

**Caps.** `MAX_MESH_FACETS` 500,000 a mesh: binary STL is 84 bytes plus 50 a triangle, so the STL
stays at 25,000,084 bytes, under ADR-0066's 25 MiB an attachment (26,214,400), and half the kernel's
own 1,000,000 triangles a mesh import; an entry larger than such a mesh can be is left out from the
archive's size, before it is inflated. `MAX_IMPORT_MESHES` 512 an import (the library's most in one
file is 83), and `MAX_IMPORT_MESH_FACETS` 2,000,000 an import, all meshes together: at 50 bytes a
facet of STL that is the design's 100 MB as distinct meshes, which bytes alone don't bound when many
objects show one entry at one place and share one STL. The design's 100 MB of attachments is the existing judge.

### Part containers as components

Each `App::Part` from which a body came into the design is one component (ADR-0081), named by its
label: S3's `cleanName`, then the rule `packages/f3d` uses (`uniqueComponentName`): cut to 90
characters so " (12)" fits the 100, unique ignoring case ("in a FOLDER (2)" beside "In a folder" in
`part_odd`), "Component1" for a label that cleans to nothing (an empty label falls back to the
object's name first). No component for an empty part, a folder or a part none of whose bodies came
in. **Nesting:** `packages/f3d` makes every component of its file and lets a nested one stand alone
with a note; here a body joins its **innermost** part's component and an outer part with no body of
its own gets none (`part_placed`: Frame holds the body and the box, Axle the cylinder). Membership is
stamped on the bodies (every imported body has metadata, which ADR-0081 §2 puts first) and on every
feature whose live bodies all joined one component (a tree's box, a body's pad, an import, a copy's
move), so a body such a feature makes again joins it; in one undo step. Placement is unchanged (a
part's placement stays baked, a walk's container chain, S11's `Place` move); components carry no
transform. **Visibility** stays the bodies': S3 never read a part's visibility, and a hidden part
(`part_odd`) still hides nothing. At most `MAX_IMPORT_COMPONENTS` (1,000); past it the bodies stay
loose and the report counts them.

### Links as copies

A link's target is what `LinkedObject` names, through further links (S3's 32 hops). Where the target
came into the design as bodies (a body or a loose chain, a tree's top, a plain shape, a mesh, a
compound's members, another link's copies), the link is one `move` with `copy` over those bodies per
instance, named by the link's label; the copies take the link's label ("Link", "Link 2" …), colour
and visibility, and the source bodies stay as they are.

**The placement, as built.** S3 places a target's stored shape for a link by its chain C: the link's
containers, then its `LinkPlacement`, then, with `LinkTransform` **off** (the link replaces its
target's placement), the inverse of the target's own `Placement`; with it **on** (the link applies on
top of it) nothing more. The target's bodies stand at its own containers' chain F applied to the same
stored shape, so the copy is placed by C · F⁻¹: a free move about the box centre of the bodies it
copies, as S11 writes one (`moveFor`). `link_transform`'s two links hold, each where FreeCAD shows it
(`world`). For a mesh target the same holds with its placement at the end of both chains.

**Checked** against the target's stored shape placed by C (what S3 bakes into its STEP; `world` in
the fixtures), with S3's check (solids, volume within 1e-3, box within 1e-4 of the diagonal) and the
centre of mass within 1e-4 of the diagonal. S3's tolerance, not S5's: a target that came in through
STEP drifts from its stored shape by up to 1.25e-4 (S3), and its copy with it; the centre tells a copy
turned the wrong way. A copy that doesn't hold, a target that didn't come in (left out, consumed, a
sketch or a sheet) and a kernel failure leave the link as before, with the reason. Each stored
shape's text is decoded once for all the checks that need it (kept while they fit in 64 MB), and a
mesh target is measured once: its pieces, volume and area don't change under a placement, so each
copy's expected box is its used nodes placed and its centre placed. **A copy follows
its target**: a longer pad makes a longer copy (tested, and in the app). As with S11's turning moves,
a turned copy follows FreeCAD's model exactly only at the imported sizes: the move's distances were
written for the pivot c at import, and the kernel turns about the box centre c′ of what it copies
then, so after a size change the copy is off by (I − R)(c′ − c).

**A link to a part** copies every body of the part's final shapes (nested parts and links inside it
included) with one `move`, into a component of its own named by the link's label (ADR-0081 §10; the
name rule above makes "Wheel 2 (2)" of a clash); each copy keeps its source's name and look, as
core's Copy Component does (body names need not be unique; the component says whose copy it is),
and takes the link's visibility. It is checked against each shape placed by C and its own chain
inside the part; a link inside the part to a further part stands for that part's shapes, followed
with a work list before any shape is measured. A cycle is a part already on the way from the link to
the part at hand; a part reached along two ways (two wheels of one kind on a car, the car linked
again) is visited along each. What bounds the walk is one count for the import of the shapes the
checks visit, `MAX_PART_MEMBERS` (10,000, five times the import's copies: each is a stored shape the
kernel measures, and a diamond of parts n deep would visit 2ⁿ); past it the link comes in as before
(`limit`). One copy takes at most `MAX_OPERAND_BODIES` bodies (256, S11's bound on what an operand
brings); past it, too, `limit`. **Order:** the part → final shapes index and each final shape's
parts are built once; a link to a part waits on a count of the part's unsettled links and is queued
when it reaches 0, so the links are settled in dependency order in time linear in links × nesting
depth. A part that holds a link back to itself, directly or through others, never reaches 0 and ends
`cycle`. The budget is checked at the top of every link's turn: once the kernel failed too often or
the time is up, each link left comes in as before without being planned or decoded.

**Arrays** (`ElementCount` > 0) are one copy an element, each element on top of the array's own
`LinkPlacement`: by the `App::LinkElement`s of `ElementList` when the array shows its elements (each a
link of its own: its `LinkPlacement`, `LinkTransform`, target), else by the `PlacementList` entry
(FORMAT.md: a `uint32` count, then seven `float64` a placement, the position and the rotation's
quaternion x, y, z, w; FreeCAD also writes seven `float32` when the property is marked single
precision, which the reader takes too). `link_array`'s list elements (0, 20 and 40 along X, turned 0,
15 and 30° about Z) and its three link elements land where FreeCAD shows them. The list must hold
exactly `ElementCount` finite placements within 10 km with a non-zero rotation; else the array can't
be expanded and comes in as before, one copy, and only then does the notice "Of each link array only
one copy came in" name it (and only for an array whose own import came in). A negative count is no
array. **The copies are one count for the import**, `MAX_LINK_COPIES` (2,000) by default: each plan
is given what is left of it before it is expanded, and every plan counts, also one whose target then
didn't come in. **Scale:** Extrudo's `move` doesn't scale.
S3 baked a scaled link at scale 1: `link_scaled`, which FreeCAD shows at 8,000 mm³ (a box of 1,000
scaled by 2), came in at 1,000. That was a wrong shape; a link with a `Scale` or `ScaleVector` that
isn't 1 (or that the reader couldn't read: a `NaN` is dropped from the file's properties with a
problem), or an array whose scale list holds anything but 1 or doesn't parse, is now **left out**
(`scaled`). Scale is judged first, along the whole way from the link to what it shows (each link's
scale, each array's scale list, each listed element's scale), before the element cap, the placement
list or the copies count, so a scaled array refused for another reason can't come in at scale 1. Element
visibility (`VisibilityList`) isn't read: every element comes in shown.

### Compounds at the top

A `Part::Compound` that is a final shape comes in as its **members** (`Links`, through nested
compounds, iteratively), each handed to the body walk, the Part trees or the shapes import as a final
shape of its own: a body or a loose chain with its history, a tree through S11, a plain shape as an
`import`. Members that hold no solid (sketches, wires, 2D objects, meshes) give nothing. The members'
names and colours are their own (a member with no colour takes the compound's), their visibility the
compound's. Then, in one transaction, one `move` per distinct placement beyond their own (the
compounds' placements composed, outermost first, acting in the containers' frame: F · P · F⁻¹) and
one check of all their bodies together against the compound's stored shape placed as S3 places it:
its number of solids, volume within 1e-6 and box (S5's tolerances). If it doesn't hold, the
transaction around the members' walk is cancelled (above) and the compound comes in as before. **`compound_touching`**:
two overlapping boxes come in as two bodies (a compound's volume is its solids' sum, which the check
compares), never fused. Two or more bodies from a compound form one component named by its label.
**As before, with the reason:** a member another object uses too (`shared`), one object twice or a
compound inside itself (`repeated`), a member that isn't in the file (`missing`), a link member
(`member`), a member in other containers than the compound (`container`), no member with a solid
(`empty`), more than `MAX_COMPOUND_OBJECTS` (1,000) objects reached (`limit`), and the check (`check`).

### Which stored shapes hold a solid

The final shapes' test (`hasSolid`), S12a's and a compound's members' share one scan by entry
(`storedSolid`, as bytes, each entry once however many objects name it, any failure to read it
that entry's). It never reads past `MAX_STORED_BREP_BYTES` (32 MB): **an object whose stored shape
is larger counts as a final shape** without being read, and the shapes import leaves it out as too
large to read (`unreadable`). Before, such an entry was read whole, and one that held no solid was
no final shape at all; now it is counted and reported left out. The library has none (its largest
entry is 6.3 MB). A compound's members are tested without noting a problem: a member whose entry is
missing gives nothing, and the compound's own shape is what the report speaks of.

### Limits (hostile files)

| Limit | Value | Past it |
|---|---|---|
| Facets a mesh | 500,000 (`MAX_MESH_FACETS`) | left out (`too-large`), from the header or the archive's size |
| Meshes an import | 512 (`MAX_IMPORT_MESHES`) | left out (`limit`) |
| Facets an import, all meshes together | 2,000,000 (`MAX_IMPORT_MESH_FACETS`) | left out (`limit`) |
| Points a mesh | three a facet | left out (`unreadable`, `points`) |
| Elements an array | 1,000 (`MAX_ARRAY_ELEMENTS`) | as before (`limit`) |
| Copies an import | 2,000 (`MAX_LINK_COPIES`), one count for all links, arrays of arrays counted before they are expanded | as before (`limit`) |
| Hops through links | 32 (S3's) | left out with S3's problem |
| Objects a compound reaches | 1,000 (`MAX_COMPOUND_OBJECTS`) | as before (`limit`) |
| Components an import | 1,000 (`MAX_IMPORT_COMPONENTS`) | the bodies stay loose |

Also clean, each tested: a mesh entry with counts of 2³²−1 in 300 bytes, one byte short or long, an
index past the points, NaN and infinite coordinates, a facet naming one point three times, a missing
entry; a link to itself, a cycle of links, 33 hops, a link to a missing object, to a sketch, to a
sheet; an `ElementCount` of 2³¹−1 with a short list, a negative one, a truncated list, placements that
aren't finite; three arrays of 20 on each other (8,000 copies, refused before expanding); a scale of
0, −1, NaN, a scale list of 2; a part that links to itself through a link inside it; a compound nested
10,000 deep, a compound inside itself, a member twice, a member another object uses; 10,000 parts;
labels empty, longer than 100 characters, alike but for case, with control characters; 2,000 parts
each holding a link to the next; 1,001 links onto one array of two (the import's copies counted
together); 40,000 compounds on one member; 200 objects naming one stored shape and one past 32 MB
(read once, the large one never inflated); 20 meshes naming one entry (read once); a kernel that fails
on every mesh and may not restart (the link and the compound in the same file still come in). The
import's time and kernel budgets stay the judges of the whole import.

**Measured** (Ubuntu machine, shared and loaded; `BENCH=1`): a mesh entry of a million facets (24,000,296
bytes) is refused from its header in 0.03 ms; one at the cap, 500,000 facets (18,000,296 bytes), is
read, placed and measured in 1.9 s; a closed mesh of 50,500 facets (1,515,320 bytes) comes in, STL,
attachment, rebuild and check, in 0.8 s; three arrays of 20 on each other (8,000 copies) are refused
in 22 ms of planning; a compound nested 10,000 deep is planned and refused at its cap in 27 ms;
10,000 parts are grouped (1,000 components, the rest loose) in 3.1 s; 2,000 parts each linking the
next are put in order in 0.9 s, with no copy made (the import's copies set to none: what is
measured is the order alone; a wait loop over every link per pass took 364 s); a chain of 30 parts
each linking the next, every copy made and checked, takes 0.3 s; a diamond of parts 24 deep is
refused by the bound on one copy's bodies in 6.2 s; 40,000 compounds on one member are planned in
0.09 s (scanning every user per member took 53 s).

### The report and the app

`FcstdImportReport` gains `meshes` (`MeshImport`: in, with its feature, bodies, facets, pieces and STL
size, or left out with the reason; the left out are in `leftOut` too), `links` (`LinkImport`: `copy`
with its moves, copies and the final shapes it copied, `today` with the reason, `left-out` when
scaled; arrays with their elements and whether they were expanded), `compounds` (`CompoundImport`:
`members` with their bodies and moves, or `today` with the reason) and `components`
(`ComponentsReport`: the components made, by kind; the parts and how many gave none; how many groups
were past the cap). `linkArrays` names only the arrays that couldn't be expanded and whose own import
came in. In `fcstdNotices`
a compound counts once, with its members' history (all with their history: "with its history"; some:
"with part of"; none: without), and a copy counts with what it copies; a mesh that came in is a body
without history; the mesh sentence no longer says Extrudo doesn't import meshes ("a mesh whose
surface isn't closed" in the "Not imported" line); a scaled link is "a link with a scale, which
Extrudo's copies don't have". Two new sentences: "Taken from the file's own shape, not copied from
what it links to: *Name*, because *reason*." (several: "… shapes, not copied from what they link to:
*A*; *B*. Most often because …"), only for links whose own import came in (one that didn't is in the
"Not imported" line alone), and "Grouped into components as the file's
parts group them: *A*; *B*." ("parts and compounds", "parts, compounds and links to parts"), said at
the end of the first notice: the app shows three toasts at a time, and as a fourth it pushed the first
out. e2e (`import-fcstd.spec.ts`): `part_basic`'s part as a component holding its bodies, and
`links_basic`'s copy following its target when the pad's distance changes.

### The library (60 files, `history-corpus.test.ts`, `s12b`)

- **Meshes: 85 in 2 files**, none placed, none in a container (the census agrees), the largest entry
  253,280 bytes, the most facets 8,432. **4 come in** as 4 mesh bodies; **68 are left out as not
  closed** and **13 as empty**. Each of the 68 repeats triangles with the same three corners in the
  other winding; the kernel drops a repeated triangle in any mesh import (ADR-0066's 2026-10-31
  amendment), and what is left has open edges, so `meshFrom` would refuse them too.
- **Parts: 21 in 11 files**, 4 with a placement, 2 nested in another, 1 empty. **17 components** from
  parts; 4 parts gave none (the empty one, one that holds only a nested part, two whose final shapes
  came in as no body); 2 more components from compounds' members; 38 bodies in components.
- **Links: 13 in one file**, all single, all to plain stored shapes, `LinkTransform` off, no arrays.
  **12 are copies**; **1 comes in as before** (`kernel`): the kernel's move refuses its copy, whose
  shape it reads as no sound solid, so that link is its own STEP import as S3 made it.
- **Compounds: 18**, 10 with a placement of their own, **5 at the top**: **2 come in as their members**
  (10 members, all plain stored shapes, now an `import` each; neither compound has a placement, so no
  move); **2 as before because they share a member** (`shared`: each uses a member the other uses
  too); **1 as before by the check**: its 7 members together differ from its stored shape by 1.6e-5
  in volume, the drift of members that came in through STEP, which S5's 1e-6 refuses. No member of
  those holds no solid, none is nested, and none is a loose chain's tip: of the 12 tips S12a found
  another object using, no compound at the top holds one, so this slice brings in none of them.
- **`import`s:** the final shapes' go from **234 to 230** (12 links are copies, the 3 compounds that
  came in or were tried have none of their own, the 10 members of the 2 that came in have one each,
  the one that came back has its own again); the meshes add **4**. All `import` features in the
  designs stay at 275: 12 fewer for the copies, 4 more for the meshes, and 8 more for the compounds
  (10 members' imports where the 2 compounds that came in as members had one each; the one that came
  back leaves nothing of its members behind).
- **The standing numbers did not move:** 25 bodies with their history, 6 from the file's shape, 4
  empty; 131 references found; 50 parameters; 52 expressions kept; S11's trees 9 / 10 / 14; S12a's
  chains 8 / 5 / 1; 383 final shapes; no restart; the 216 final shapes S12b doesn't touch come in
  exactly as S3 brings them (216 compared, 0 differ).
- **Time per file** on the shared machine with other jobs running: median 0.26 s, slowest 71 s
  (S12a's run: 0.26 s and 54 s). The slowest file is the one whose compound is tried as its 7
  members and then comes in as before (`check`): timed alone, each run after a warm-up, 70 s with
  this slice and 55 s with compounds not tried; walking, converting, rebuilding and checking those
  members, all cancelled, is that file's whole difference. A cheaper refusal before the walk (the
  members' stored shapes measured against the compound's) is S13's.

### What S13 inherits

- Link arrays' `VisibilityList` and per-element scales; scaled links (a copy and a Scale feature
  could rebuild them, with a pivot of their own).
- A compound whose members came in through STEP and drift by S8's size (S5's tolerance refuses
  them); members in other containers; links as members.
- A mesh refused for a facet that names a point twice (the kernel would drop it); mesh colours.
- The time a file of many shapes costs, now with the compounds' members as shapes of their own.

## Amendment (S13, 2026-11-23): the second hostile-file pass, what the earlier slices left, the guide

The last slice. A pass over the whole importer as it stands, from the file's bytes to what the app
shows; a seeded mutation test; the limits the earlier slices left open; the user guide's page
(`docs/guide/freecad.md`). With it P6-25 is done. No facade change, no schema change, nothing in
`packages/core`.

### The work list

Every line of S3 to S12b that named S13 or a known limit, and its answer here.

| From | What | Answer |
|---|---|---|
| S3 | A text the kernel refuses restarts the kernel, so more than three lose the rest | **Done**: a refusal is an answer (below) |
| S5 | The design so far is sent for every feature: cost grows with features × design size | **Measured**, not changed (below) |
| S6 | A mirror-image twin only a face-by-face comparison tells apart | Not done: no library case; it needs the kernel to describe every face of both shapes (a describe call per feature) |
| S8 | The STEP round trip's drift decides whether a stored shape can be a step (one library shape, 1.5e-5) | Not done (part 2, item 3) |
| S9 | A body's vertex as a reference | Not done: needs `describe` to describe vertices (a kernel change) |
| S10 | MultiTransform steps' inputs bound through their `sources`; configuration tables | Not done: no library expression reads them; a configuration table maps onto ADR-0059 and is a feature of its own |
| S11 | A unit whose nodes fail one by one costs up to four passes | **Measured** (below) |
| S11 | The time a tree costs on large imported shapes; chamfers whose edges a rebuilt boolean doesn't share | Measured with the library run (below); the chamfers not done (part 2, item 8) |
| S12a | A foreign base S11 could build; tips another object uses that no tree walks; sketches of bodies on faces | Sketches on faces **done**; the rest a finding (part 2, items 6 and 7) |
| S12b | `MAX_PART_MEMBERS` one count for the import | **Done**: per distinct part and turn |
| S12b | A compound refused only after its members were walked | Measured, and **not done**: no compound gains (below) |
| S12b | `doc.problems.length` reset with no test | `markProblems`, a guard no path reaches today (below) |
| S12b | A mesh refused for a facet that names a point twice | **Done**: dropped |
| S12b | Scaled links, `VisibilityList`, per-element scales, mesh colours, members in other containers, links as members | Not done (part 2, item 9): no library file has them |
| S12b | The time a file of many shapes costs | Measured (the library table) |

### The inventory

Every loop, recursion, allocation, map key, kernel call and string the file drives, by module, with
its bound and the test that shows it. Rows marked (S13) changed in this slice; "none" is a bound
no test exercises by name.

| Module | What the file controls | Bound | Test |
|---|---|---|---|
| archive | Entry count, EOCD scan, declared sizes, inflated-entry cache | `MAX_ENTRIES` 20,000 before the walk; `MAX_ENTRY_BYTES` 128 MiB; `MAX_TOTAL_BYTES` 512 MiB | hostile.test.ts: 'refuses an archive with too many entries' (sizes: none) |
| archive | Deflate ratio; inflate output size and CRC | `MAX_RATIO` 500 (+4096 B); output exactly the declared size | hostile.test.ts: 'refuses a ratio bomb before inflating it'; 'refuses an entry that unpacks to more than it declares' |
| archive | ZIP64, encryption, multi-disk, odd methods; entry names and duplicates (Map keys) | refused or left out with a problem; bad names (`..`, `/`, `\`, drive, C0) left out | hostile.test.ts: 'refuses ZIP64 and encrypted entries'; 'leaves out a name that climbs out of its folder, and a second entry of one name' |
| archive | Overlapping entries (one deflate stream feeding several) | (S13) refused | hostile-s13.test.ts: 'refuses an archive whose entries overlap' |
| xml | Nesting | `MAX_DEPTH` 256 | hostile.test.ts: 'refuses 10^5 levels of nesting' |
| xml | Attributes per element, elements per document | (S13) `MAX_ATTRIBUTES` 256; `MAX_NODES` 1,000,000 (was 4,000,000; 990k elements measured +0.7 GB); `parseXml(text, what, maxNodes)` | hostile-s13.test.ts: 'refuses an element with more attributes than MAX_ATTRIBUTES'; heap.test.ts: 'a Document.xml of 990,000 elements' |
| xml | Entities, long values, DOCTYPE, UTF-8 | five predefined entities, reference ≤ 12 characters; linear scan; DOCTYPE and `<!` refused; fatal UTF-8 | hostile.test.ts: 'refuses an entity bomb, and any entity but the five predefined'; 'reads a 10 MB attribute in bounded time' |
| xml | Characters XML forbids (C0 but tab/LF/CR, U+FFFE/FFFF) | (S13) read as U+FFFD, literal or referenced | hostile-s13.test.ts: 'reads control characters XML forbids, literal or referenced, as U+FFFD' |
| xml | Attribute keys (object keys), duplicates | null-prototype object; duplicate attribute refused | hostile.test.ts: 'reads a property type named like an object member as no unit' (duplicates: none) |
| model | Stored B-rep text | `MAX_STORED_BREP_BYTES` 32 MiB from the archive size; (S13) format line from `head(entry, 128)` before inflating | history-hardening.test.ts: 'are left out by the archive’s size, never inflated or decoded'; hostile-s13.test.ts: 'knows a stored shape that is not B-rep text from its first bytes' |
| model | Colour side entries (DiffuseColor, ShapeAppearance) | (S13) `head(entry, 32)`; count checked against the declared size | hostile-s13.test.ts: 'reads only the head of a colour entry' |
| model | Float lists; numbers read from properties | `MAX_FLOAT_LIST` 100,000 from the archive size; `finite()` leaves out NaN and ±Infinity with a problem | hostile.test.ts: 'leaves out a property whose number is NaN or 1e999, with a problem' (float lists: none) |
| names | Names, labels and details that leave the importer | (S13) `MAX_NAME_LENGTH` 120, `MAX_DETAIL_LENGTH` 300 code points; `plainText` drops bidi, zero-width and C1 characters, mends lone surrogates | hostile-s13.test.ts: 'drops bidirectional controls and zero widths'; shapes.test.ts: 'cleans a label: control characters, white space, length, fallback' |
| final-shapes | Link chain, container chain, solid scan | `MAX_LINK_HOPS` 32; container depth 64; seen sets; scan once per entry, 32 MiB cap | structure-hostile.test.ts: 'a link to itself, a cycle, 33 hops'; hostile.test.ts: 'ends the final-shape walk on links to nothing and on cycles' |
| mesh-read | Facets and points | `MAX_MESH_FACETS` 500,000; exact length checked before any allocation; points ≤ 3 per facet | mesh-read.test.ts: 'counts of 2³²−1 in a 300-byte entry: refused before anything is allocated' |
| mesh-read | Facets naming one point twice | (S13) dropped, as the kernel drops them (`dropped`) | mesh-read.test.ts: 'S13: a facet naming one point three times, or twice, is dropped' |
| mesh-read | Placed coordinates | (S13) `MAX_MESH_COORDINATE` 1e7 (`far`); meshes.ts leaves such a mesh out as unreadable | hostile-s13.test.ts: 'refuses a mesh a placement takes past 10 km' |
| meshes | Meshes and facets per import | `MAX_IMPORT_MESHES` 512; `MAX_IMPORT_MESH_FACETS` 2,000,000, from the header before reading | structure-bounds.test.ts: 'meshes: one read an entry, the import’s facets counted together' (mesh count: none) |
| meshes | STL size and design room; kernel failure while meshing | `MAX_ATTACHMENT_BYTES` 25 MB, `MAX_ATTACHMENTS_BYTES` 100 MB; the first kernel failure ends the meshes | structure-bounds.test.ts: 'a mesh that would pass the design’s limit beside the links’ held STEP'; 'one mesh the kernel fails on ends the meshes: one restart, not one each' |
| sketch-decode | Curves and constraints per sketch | `MAX_SKETCH_GEOMETRY` 10,000, `MAX_SKETCH_CONSTRAINTS` 20,000 | sketch-hostile.test.ts: 'refuses a sketch over the geometry limit'; 'constraints, in bounded time' |
| sketch-decode | B-spline poles and knots; indices; external links | `MAX_BSPLINE_POLES` 1,000, knots ≤ poles + 7; indices \|v\| ≤ 2^31; external links ≤ 10,000 | sketch-hostile.test.ts: 'refuses a B-spline over the pole limit'; 'leaves out constraints naming geometry out of range or past the axes' (links: none) |
| sketch-map | Constraints vetted | `MAX_CANDIDATES` 1000, the rest left over the limit | sketch-hostile.test.ts: 'constraints, the rest over the limit' |
| sketch-map | Vet and trial solves (planegcs, outside the kernel budget); container chain of a sketch (sketch-place) | `MAX_VET_ROUNDS` 64 then ≤ 1000 removals; `TRIAL_BUDGET` 256, `MAX_TRIALS` 24; container depth 64 | none |
| fc-expr | Expression text, tokens, nesting | `MAX_EXPRESSION_LENGTH` 4,096; `MAX_EXPRESSION_TOKENS` 1,024; `MAX_EXPRESSION_DEPTH` 64 | fc-expr.test.ts: 'refuses past each limit, cleanly' |
| fc-emit | Emitted expression text | `MAX_EMITTED_LENGTH` 16,384 (core refuses above 10,000) | none |
| params | Plain-number cell regex | (S13) `\d+(?:\.\d*)?` cannot backtrack; `MAX_CELL_NUMBER_LENGTH` 400 | hostile-s13.test.ts: 'reads a cell of 200,000 digits and a letter in bounded time' |
| params | Cells and variables read | (S13) `MAX_SHEET_CELLS` 10,000 a sheet, `MAX_IMPORT_CELLS` 20,000 a file | hostile-s13.test.ts: 'reads at most MAX_IMPORT_CELLS cells over all the sheets of a file' |
| params | Expressions read, parameters added, names, lookups by file names | `MAX_OBJECT_EXPRESSIONS` 256, `MAX_IMPORT_EXPRESSIONS` 10,000; `MAX_IMPORT_PARAMETERS` 1,000; `MAX_PARAMETER_NAME` 64; `MAX_RENAME_TRIES` 1,000; Maps and `Object.hasOwn` | parameter-hostile.test.ts: 'more expressions on one object than it reads'; 'a name with no free number left'; 'JavaScript’s own names as variables and constraints' |
| params | Rename `from`, group and comment text | (S13) `from` clipped to `MAX_NAME_LENGTH`; `MAX_GROUP_LENGTH` 40, `MAX_COMMENT_LENGTH` 300 | parameter-hostile.test.ts: 'a name past its length is cut; a group past its length is cut' |
| params | Settling chains of cells | ≤ names + 1 rounds, each of ≤ 1,000 parameters | parameter-hostile.test.ts: 'a chain of cells past the depth limit' |
| params | Dependency order (`topological`) | (S13) a node's reads are filtered once, so linear in the edges | none |
| params | Constraint records of a sketch | (S13) cached per object; none past `MAX_SKETCH_CONSTRAINTS` | hostile-s13.test.ts: 'makes a sketch’s constraint records once, and none past the sketch limit' |
| bind | Rule rounds per feature | `MAX_BIND_ROUNDS` 64; no cap across the import | none |
| bodies | Feature chain of a body, one body per feature, features walked | seen set; `MAX_BODY_FEATURES` 500 a body, `MAX_FILE_FEATURES` 2,000 a file | history-hardening.test.ts: 'does not map a feature a second body reaches'; chain-import.test.ts: 'more features than a chain may have: as today' |
| bodies | Profile sketch curves and regions | `MAX_PROFILE_CURVES` 500, `MAX_PROFILE_REGIONS` 1,000 | history-hardening.test.ts: 'drawn curves before its regions' |
| bodies | Stored-shape steps and their text | `MAX_BODY_STEPS` 8; `MAX_STEP_TEXT_BYTES` 256 MiB an import | step-hostile.test.ts: 'the step text cap ends the body as the step cap does' |
| bodies | Kernel rebuild reply | `MAX_REBUILD_BODIES` 100,000; `MAX_BODY_ID_LENGTH` 200; Map and `Object.hasOwn` | history-hardening.test.ts: 'takes only `<feature of the document>:<n>`, short, with measures under own keys' |
| bodies | Tries per feature; expressions kept per feature | `MAX_UP_TO_TRIES` 4; `MAX_PROJECTION_REPEATS` 3; `MAX_FEATURE_EXPRESSIONS` 64 | reference-hostile.test.ts: 'an up-to feature is tried at most'; history-hardening.test.ts: 'keeps at most 64 and says how many were dropped' |
| features | Lengths, offsets and sizes | `MAX_FEATURE_LENGTH` 1e7 mm | dressup-hostile.test.ts: 'refuses a radius of %s' |
| features | Pattern instances, originals, steps, hole centres, self-listing MultiTransform | `MAX_TRANSFORM_INSTANCES` 500 with `HOLE_CENTRE_WEIGHT` 2; `MAX_ORIGINALS` 100; `MAX_TRANSFORM_STEPS` 16; `MAX_HOLE_CENTRES` 200 | pattern-hostile.test.ts: 'a pattern of more instances than the cap is a clean stop before the kernel'; 'a MultiTransform that lists itself, 10,000 steps, or one step twice' |
| dressups | Sub-elements, edges taken, chamfer sets | `MAX_DRESSUP_ELEMENTS` 1,000 before the loop; `MAX_DRESSUP_EDGES` 1,000; `CHAMFER_MAX_SETS` (core) | dressup-hostile.test.ts: 'refuses 100,000 sub-elements before looking at one' (edges, chamfer sets: none) |
| match | Kernel descriptions and reference names | `MAX_DESCRIBED_EDGES`/`FACES` 20,000, `MAX_ADJACENT` 20,000 (over is a limit, no restart); `MAX_REFERENCE_ID_LENGTH` 4,000; `MAX_NAME_DEPTH` 32; `MAX_FINGERPRINT_ADJ` 64 | dressup-hostile.test.ts: 'a body past the cap is a limit, not a kernel failure: no restart'; dressup-limits.test.ts: 'a well-formed reference longer than the cap stops with `reference`' |
| transforms | External links and datums | `MAX_EXTERNAL_PER_SKETCH` 64, `MAX_EXTERNAL_PER_FILE` 1,000; `MAX_DATUMS` 200 | reference-hostile.test.ts: 'past the datums an import may bring in'; 'past the external links an import projects' |
| attach | Supports read | `MAX_SUPPORTS` 16 | loose-chains.test.ts: 'a long support list costs its first item' |
| part-tree | Operand tree of a Part feature | `MAX_TREE_NODES` 500 a tree, `MAX_IMPORT_TREE_NODES` 2,000 an import, `MAX_MULTI_OPERANDS` 64; iterative | part-hostile.test.ts: 'a chain of 10,000 cuts'; 'nodes per import' |
| part-tree | Compound `Links` list; Part fillet edge list | list: no cap of its own (XML `MAX_NODES` only), (S13) appended by a loop; edges: `MAX_PART_DRESSUP_EDGES` 1,000 | hostile-s13.test.ts: 'reads a compound of 300,000 links as one operand'; part-hostile.test.ts: 'an index past the base’s edges' |
| part-import | Passes, features and operand bodies per unit | `MAX_TREE_PASSES` 4; `MAX_TREE_FEATURES` 4,000, given back when a pass is cancelled; `MAX_OPERAND_BODIES` 256 | part-hostile.test.ts: 'a unit that needs more passes than the cap comes in as today'; part-review.test.ts: 'a leaf of more bodies than an operand may have' |
| loose-chains | Chain walk | `MAX_BODY_FEATURES` 500, `MAX_FILE_FEATURES` 2,000; visits `PLAN_VISITS_PER_FEATURE` 4 × file cap | loose-chains.test.ts: 'refuses a chain of 10,000 at the cap, without recursion' |
| loose-chains | Originals of patterns; chains planned | `MAX_ORIGINALS` 100; `MAX_ORIGINAL_STEPS` 500 a list; `MAX_ORIGINAL_LINKS` 20,000 a file; `MAX_LOOSE_CHAINS` 256 | loose-chains.test.ts: '256 rows of 501 patterns of two originals cost the budgets, not their product'; 'refuses the chains past the import’s cap' |
| structure | Decoded stored text kept | `MAX_TEXT_CACHE` 64 MiB, FIFO | structure-once.test.ts: 'an array of three onto a box: its stored shape decoded once for the three checks' |
| structure | Link wait list and link order | (S13) every list the file sets appended by a loop (`lists.ts`), here and in part-import, transforms, params, components, compounds, links; one turn per link | structure-bounds.test.ts: '2,000 parts each linking the next are settled in linear time' |
| structure | Part measures, members walked under links, turned measures | (S13) `partMemo` per (part, turn); `MAX_PART_MEMBERS` 10,000 per distinct part and turn; one kernel call per (object, rotation) | structure-bounds.test.ts: 'S13: each distinct part and turn counts once toward the import’s shapes'; 'S13: a hundred links to one part measure its shapes once, not once a link' |
| structure | Link copies and array elements | `MAX_LINK_COPIES` 2,000 an import, counted before expanding; `MAX_ARRAY_ELEMENTS` 1,000 | structure-bounds.test.ts: 'the copies are one count for the import, MAX_LINK_COPIES by default' |
| structure | Bodies copied by links; details of refusals | (S13) `MAX_COPIED_BODIES` 20,000 an import; `MAX_OPERAND_BODIES` 256 an instance; details clipped to `MAX_DETAIL_LENGTH` | structure-bounds.test.ts: 'S13: the bodies all copies make are one count for the import' (clipping: none) |
| links | Placement and scale lists | length checked against `ElementCount` before the loop; ≤ `MAX_ARRAY_ELEMENTS` | structure-hostile.test.ts: 'an ElementCount of 2³¹−1 with a short list' |
| links | Scale of a link and of the links on its way; scaled links | (S13) `ownScale` memo per link; hops ≤ `MAX_LINK_HOPS`; scaled links never converted (`scaledOnTheWay` before the shapes import) | structure-bounds.test.ts: 'a link onto a scaled link is scaled, past an array on the way' (no conversion: none) |
| compounds | Members walked through nested compounds | `MAX_COMPOUND_OBJECTS` 1,000 a compound; refused at the first outside consumer | structure-hostile.test.ts: 'nested 10,000 deep: planned iteratively, refused at the cap' |
| compounds | Moves per distinct placement; one check | members ≤ `MAX_COMPOUND_OBJECTS`; (S13) bodies appended by a loop | structure-cases.test.ts: 'a compound whose members don’t add up to its stored shape comes in as today, leaving nothing behind' |
| components | Components made; name cut | `MAX_IMPORT_COMPONENTS` 1,000; (S13) name cut at 90 code units, outside surrogate pairs | structure-hostile.test.ts: '10,000 parts: the first 1,000 are components, the rest stay loose, quickly'; hostile-s13.test.ts: 'cuts a component name within the schema’s length, never inside a surrogate pair' |
| shapes | Kernel reply sanity | `MAX_SOLIDS_PER_SHAPE` 10,000; `MAX_ELEMENT_COUNT` 1e8 | shapes.test.ts: 'refuses a reply whose numbers or types make no sense, as a kernel failure' (`MAX_ELEMENT_COUNT`: none) |
| shapes | STEP and design bytes; deferred shapes' bytes | `MAX_ATTACHMENT_BYTES` 25 MB a file, `MAX_ATTACHMENTS_BYTES` 100 MB a design; (S13) `DeferredShapes.release` drops bytes no shape needs | shapes.test.ts: 'keeps each attachment under 25 MB and the design under 100 MB' (release: none) |
| budget | Every kernel call | budget: 60 s a call / 10 min / 3 restarts | shapes.test.ts: 'gives up after three restarts and leaves the rest out'; 'stops at the whole import budget' |
| budget | Kernel refusals (`KERNEL_REFUSALS`, `KERNEL_FAILURES`) | (S13) no restart, not counted against the 3, unless out of memory or the heap top past `IMPORT_HEAP_RECYCLE_BYTES` 1 GiB; together at most `MAX_REFUSED_SHARE` 0.25 of the import's time | kernel-refusals.test.ts: 'brings in the five good shapes of ten when five are refused'; 'replaces a kernel whose refusal says memory ran out'; 'gives slow refusals a quarter of the import' |
| budget | Design serialised per rebuild | no count cap; feature caps × tries, then the budget above | none |
| import | File size; problems noted by a cancelled walk | (S13) `MAX_FCSTD_BYTES` 100 MiB enforced in `importFcstd`; `markProblems` truncates `doc.problems` back | hostile-s13.test.ts: 'refuses a file over MAX_FCSTD_BYTES before reading it, whoever calls it'; 'takes back what a cancelled walk noted about the file' |
| import | Seeded mutants of every fixture, reader and full import | (S13) a result or a clean refusal, bounded, the same twice | mutate.test.ts: 'the whole import on' |
| app worker | The whole import | `FCSTD_IMPORT_TIMEOUT_MS` 11 min, then the worker is terminated | fcstdImport.test.ts: "rejects with the worker's error, a crash or the time budget, and terminates it" |
| app worker | File size at the app; error text shown | `MAX_FCSTD_BYTES` 100 MiB on `file.size` before reading; `clip` 300 on the error | actions.test.ts: 'refuses a file over 100 MB before reading it' (error clip: none) |

**The gaps and what was done with each:**

- **Bounded only by the clock, now by a count:** a cell's plain-number pattern backtracked
  quadratically on a long run of digits (`\d+\.?\d*`; 40,000 digits took 6 s, and a cell has no
  length cap) and now has one way to match each character; a sketch's constraint records were
  made again for every expression and path that read them, with no cap, and are made once per
  object and none past `MAX_SKETCH_CONSTRAINTS`; the parameters' order filtered a cell's reads on
  every visit (the square of its reads) and filters them once; cells and variables are at most
  `MAX_IMPORT_CELLS` (20,000) a file over all sheets and sets (each sheet's 10,000 stays); the
  links' copies make at most `MAX_COPIED_BODIES` (20,000) bodies an import (2,000 copies of 256
  bodies each were allowed, past the kernel's 100,000 bodies a rebuild, which reads as nonsense
  and restarts a sound kernel); whether a link scales is judged once per link (`ownScale`), not by
  rescanning an array's lists for every link that reaches it.
- **Work before the refusal:** a colour list of `GuiDocument.xml` was inflated whole (up to
  128 MB) to read its first 8 to 28 bytes; a stored shape's entry was inflated whole before its
  format line was read; a scaled link was converted to STEP and then left out from the file
  alone, its bytes held while the meshes were judged. Each now reads the entry's head, or is left
  out before the shapes import converts it.
- **Memory:** the XML reader's 4,000,000 elements cost about 2.2 GB; it reads 1,000,000 (below).
  Bytes the deferred shapes no longer need are dropped when they are released, not held to the
  end.
- **Lists:** a list whose length the opened file sets is never spread into a call
  (`push(...list)`, `Math.max(...list)` and the like): such lists are appended by a loop
  (`lists.ts`), whether or not a cap bounds them today.
- **Keys:** every lookup by a file-given name was already a `Map`, a null-prototype object or
  `Object.hasOwn` (`__proto__`, `constructor`, `hasOwnProperty` as object, property and entry
  names are tested). Keys joined with U+0000 could meet, since the XML reader kept a literal
  U+0000 in a name; the characters XML 1.0 forbids (C0 controls but tab, newline and carriage
  return, U+FFFE, U+FFFF), literal or referenced, now read as U+FFFD. No entry name is ever a path:
  entries are a `Map` in memory.
- **The archive:** entry count, ratio, CRC, ZIP64, encryption, `../` names and repeated names were
  refused or left out and tested; now two entries whose bytes overlap are refused too (one deflate
  stream fed several entries, each judged against the ratio on its own), and `importFcstd`
  enforces its 100 MB itself rather than trusting the caller.
- **Numbers:** every number read goes through `finite` or an integer check; a placement's
  quaternion is normalised and a zero rotation is no rotation (S9). New: a mesh point a placement
  takes past 10 km, or to infinity, leaves the mesh out (`MAX_MESH_COORDINATE`). `Number()` reads
  `0x10` as 16 and refuses `1,5`; both are what FreeCAD's own writer never writes, and the checks
  against the stored shapes judge what they make.
- **Strings that leave the importer:** names went through `cleanName` (C0 controls, 120
  characters) and details through `clip` (300). Both now go through `plainText`: the
  bidirectional embeddings, overrides and isolates (U+202A to U+202E, U+2066 to U+2069), U+061C,
  the marks U+200E and U+200F, zero-width characters and U+FEFF are **removed**, C1 controls and
  line and paragraph separators become spaces, and a lone surrogate becomes U+FFFD; so are U+180E,
  the interlinear annotation characters U+FFF9 to U+FFFB and the tag characters U+E0000 to
  U+E007F. Removed, not shown escaped: a name is the author's label and these characters have no
  glyph. Letters keep their own direction: a right-to-left name still reads right to left, and
  can move the digits and punctuation beside it as any such text does. A renamed parameter's old name, the one raw file text a
  notice showed, is clipped by the same rule, and so are the links' and compounds' details. A
  component name is cut at 90 UTF-16 units outside a surrogate pair. The app renders every notice
  as text (the only `dangerouslySetInnerHTML` is the icon set's, by internal names); no file text
  becomes an ID (an attachment is stored by its SHA-256), a CSS value or a URL. An attachment's
  `fileName` is the cleaned label by the export's rule (`stepFileName`, `modelFileName`): no
  `< > : " / \ | ? *`, no control character, no leading dot or space (tested on `../`, `\`,
  drive and hidden names).
- **Entry points:** the home screen's Import card, Home › Import and Import Model all reach
  `importFcstdFile`: the app's 100 MB check, the import's worker, its 11-minute stop and the kernel
  budgets. The app has no drop of files onto it. The desktop app opens `.extrudo` files and reaches
  FreeCAD files only through the same pickers. The CLI reads no FreeCAD file, and the MCP server
  has no tool that takes a file's bytes; neither was added.

**Not changed, with the reason:** `MAX_EMITTED_LENGTH` (16,384) stays above core's 10,000
(text between is refused by core as `limit`, tested since S11); `MAX_BIND_ROUNDS` (64 a feature)
has no count across the import, the feature caps and the time bound it; a kernel's refusals have
no count of their own: each is one call under 60 s, and the import's 10 minutes end them.

### Peak memory at the caps

Measured as the growth of the process's peak resident memory (`heap.test.ts`, `BENCH_HEAP`, each
case alone in a process of its own, the file already read from disk):

| Case | Peak growth |
|---|---|
| A 101 MB file of three stored shapes at the 32 MB limit (fake kernel) | +99 MB: one copy as text, nothing held twice |
| A `Document.xml` of 990,000 elements (4.6 MB zipped) | +705 MB (2.9 million elements: +1.6 GB) |
| 512 meshes of 3,888 facets, the facets cap, with the kernel in the same process | +933 MB, the kernel's own included |

`MAX_NODES` went from 4,000,000 to **1,000,000**, 18 times the library's largest document: a
million elements cost about 0.7 GB, where 4 million would have cost about 2.2 GB in a worker. The
mesh case's growth is mostly the kernel's: in the app it is the import kernel's own worker.

### The mutation test

`mutate.ts` makes hostile files from our own fixture documents of every slice (S3's shapes, the
body and sheet fixtures, S7's patterns, S8's steps, S9's references, S10's parameters, S11's trees,
S12a's chains, S12b's structure documents; 150 in all) by seed: one to three of byte flips, drops, repeats and
cuts of `Document.xml`, `GuiDocument.xml` and binary entries; properties and objects swapped,
removed and repeated; numbers replaced by NaN, infinities, `-0`, `1e308`, denormals, 2³¹, 2⁵³ + 1,
hex and locale forms; links pointed at other objects, themselves, nothing; container lists
re-nested; names made `__proto__`, 10,000 characters, bidirectional, control characters; entries
removed, copied under path-like names; and now and then the finished archive's bytes flipped.
`mutate.test.ts` reads every mutant twice (the same result, under 5 s each) and imports every
tenth with the kernel in Node, a fresh one each: it must end as a design that `loadDocument`
accepts, whose expressions parse and whose parameters evaluate, whose files are exactly its
attachments, whose report never has one shape both in and out, that rebuilds in a fresh kernel,
and whose kernel holds no shape once its rebuild cache is emptied (`dispose`); or as a clean
`FcstdFormatError`. The normal run is 240 reader mutants and 24 imports (about 20 s);
`FCSTD_MUTATE_STEPS` and `FCSTD_MUTATE_SEED` set a long run.

**The long run** (Ubuntu machine, shared; seeds 1, 37, 100003 and 200011, 5,000 steps each,
consecutive seeds so each seed's 500 imports cover all 150 bases): **20,000 reader mutants**
(14,815 read, 5,185 refused cleanly, the slowest 156 ms) and **2,000 whole imports** (1,486
designs, 514 refused cleanly, 8 kernel restarts in all, every design rebuilt with no failed
feature, no shape left held on the current kernel, the slowest 49 s; 303 imported twice, each
the same design and report), in 79 minutes. **It found nothing**: no throw past the entry
point, no hang, no unsound design, no second run that differed. (A first long run of the same
size imported only 15 of the bases, the import share stepping its seeds by 10; that is fixed.)
The gaps above were found by reading the code; each has its own regression test
(`hostile-s13.test.ts`, `kernel-refusals.test.ts`, `structure-bounds.test.ts`,
`structure-cases.test.ts`, `mesh-read.test.ts`).

### The open limits

- **S3: a refusal is an answer.** `KernelBudget.call` tells a refusal from a failure by the
  error's name: `KernelError` and every class that extends it (`KERNEL_REFUSALS`; a test reads the
  kernel's sources and keeps the list equal), which Comlink carries across the worker by name. Such
  an error comes from the facade's caught OCCT exception or from our own checks, so the kernel is
  sound: no restart, not counted against `MAX_RESTARTS`, counted as `report.refusals`, and the
  shape is left out as before (`kernel`, "the geometry kernel couldn't read it"). A
  `KernelCrashError`, a dead worker's plain error, a timeout or a reply that makes no sense still
  restarts it. Test: ten shapes of which five are text the kernel refuses past its format line:
  the other five come in, no restart (before: three restarts, and the last two good shapes out).
  A refusal's words decide nothing (the kernel quotes the file in some messages, so a file could
  word one as it likes): after any refusal the budget reads the kernel's heap
  (`ImportKernel.heap`, inside the import's time) and replaces the kernel when its top has passed
  `IMPORT_HEAP_RECYCLE_BYTES` (1 GiB, the project kernel's own threshold for a fresh worker,
  ADR-0067 §H4; the heap only grows, and a failed allocation inside OCCT comes back as a refusal
  with a grown heap); a kernel that can't report its heap is kept. Refused calls together may
  take at most `MAX_REFUSED_SHARE` (a quarter) of the import's time, each counted only for the
  time past `REFUSAL_ALLOWANCE_MS` (a second: the kernel refuses unreadable text in milliseconds,
  so only a refusal that kept it working counts); past the share every later call is left out
  with the import's time ("the geometry kernel refused shapes for too long"). The share is tested
  when a call starts, so one call may pass it by its own time, at most a shape's 60 s. Every class
  that extends `KernelError`, at any depth in `packages/kernel/src`, must be in `KERNEL_REFUSALS`
  or `KERNEL_FAILURES` (a test). Tests with fake kernels and an injected clock.
- **S5: features × design size.** Measured on S11's chain of fuses (`part-hostile.test.ts`,
  `BENCH=1`, the design's structured clone timed as the worker gets it): 100 fuses 3.9 s, 5.9 MB of
  designs sent, the largest 58 KB, 0.17 s copying; 300 fuses 12.6 s, 52.6 MB, 175 KB, 1.4 s; 450
  fuses 27.6 s, 118 MB, 262 KB, 3.0 s. Copying grows with the square of the features and the
  kernel's own work a little faster than linearly. What bounds it: `MAX_FILE_FEATURES` (2,000) and
  `MAX_IMPORT_TREE_NODES` (2,000) and the import's 10 minutes; at 2,000 features the designs sent
  would be about 1.2 GB in all, about 30 s of copying. Sending only what changed is a change to the
  kernel's import interface, not small: not done.
- **S11: passes.** A chain of 240 fuses whose four lowest store another shape: 21.4 s and 2,387
  kernel calls (a clean 300 took 1,502 calls), so about two passes; each pass costs what one clean
  build does, at most four, at the tree cap (500 objects) about 13 s a pass.
- **S12b: links to parts.** A part's shapes together are measured once for each rotation they are
  seen at (`partMemo`) and moved for every further use (a translation moves a measure's box and
  centre and changes nothing else), and a stored shape once per rotation (`turned`). So
  `MAX_PART_MEMBERS` counts the members of each distinct part and turn walked. Tests: 101 links to
  one part make as many kernel measures as two; the car of S12b's test needs 6 members where every
  way down counted 12. A memo is never stale: stored shapes don't change, and a memoised part has
  no cycle through it (one would have stopped its own walk).
- **S12b: a compound refused before its walk.** Measured, and not kept. A compound's members'
  stored shapes, placed where it shows them, can prove before the walk that the full check fails
  only when they are further off than the loosest check a member passes, and the library's slow
  file is not such a case: its members' stored shapes together differ from the compound's own by
  8.6e-6 in volume, inside what the walk could change and outside S5's 1e-6. No library compound
  gains, every compound would pay one kernel measure a member, and at its margins such a test can
  refuse what the full check accepts (a member's check is relative to the larger volume, members'
  volumes may have either sign, a member's box is checked in its own frame), so the slice doesn't
  have it. S12b's reading of that file was wrong: no member of that compound comes in through STEP
  (they are Part trees whose tops hold at 1e-6), and the compound's own stored shape is not its
  members'. The full check refuses it, rightly, and the file's time is unchanged (below).
- **S12b: `doc.problems`.** The reset is now `markProblems(doc)`, with a unit test of its own.
  **No path reaches it today**: every reader the walk calls takes back its own problems when it
  fails, so no library or fixture file has a line it would take back, and removing the call fails
  no import test. It stays as a guard for a later reader.
- **S12b: a facet that names a point twice** is dropped in the reader (`MeshKernel.dropped`), as
  the kernel's own mesh import drops it, and the closed check judges the rest; a mesh of only such
  facets is `empty`. Chosen over refusing: the kernel would build the same mesh from what is left,
  and the closed check already refuses one that a dropped facet leaves open.

### What the earlier slices left (part of P6-25's backlog)

1. **The census** (the library's stops, numbers only). Bodies from the file's shape: 6 (2 fillets
   our OCCT refuses, 2 bodies that are one base feature and nothing else, 1 hole that changes
   another FreeCAD body, 1 pocket after a step that differs by 1.5e-5). Steps in the middle of
   bodies: 5 (3 by type, 1 MultiTransform, 1 pad that differs). Tree leaves: 30 (17 extrusions, 8
   Python objects, 1 plain shape, 1 mirror, 1 sweep: types Extrudo doesn't rebuild; 2 that
   differ). Trees as today: 14 (S11's reasons). Chains: 1 as today (S12a's fillet). References not
   found: 2 (pockets). Expressions not kept: 103 on targets Extrudo has no input for, 7 whose
   target didn't come in, 5 on inputs Extrudo doesn't take as expressions, 1 that names `H`
   (FreeCAD's unit symbol) as a variable. Shapes left out: 68 open meshes, 13 empty meshes, 4
   empty bodies, 3 failed checks. **None is a small gap of ours** (a property form not read, a
   case of a mapped feature not handled): each is a missing Extrudo feature, the file's own state,
   or a check doing its job. Not changed.
2. **Open meshes (68).** All 70 non-empty meshes of that file hold each triangle exactly twice,
   once in each winding, the 68 left out among them. FreeCAD's `solid` flag is set for all 85, the
   13 empty ones included, so it says nothing. **FreeCAD's own volume** for every one of the 70 is
   under a thousandth of what keeping one triangle of each pair would enclose (for 20 of them under
   a millionth): FreeCAD doesn't measure them as closed solids either, and the repair would make a
   shape FreeCAD doesn't show. They stay out (68).
3. **STEP drift as a tolerance:** not done. The library's one compound refused by the check has no
   member that came in through STEP (item above), and a compound of STEP members that doesn't
   hold comes in as its own shape through STEP with the same history (none), so a looser check
   would buy nothing. For a step in a body (the pocket that differs by 1.5e-5), widening a
   feature's volume check would also have to widen its area and centre, and the centre's 1e-7 of
   the diagonal is what tells S6's mirror twins apart: not safe without a face-by-face comparison.
4. **The ellipsoid** is in our own S11 fixture (`other_primitives`), not the library (which has
   none). It is left out by S3's check: the STEP read back has the same volume and a box 0.035 mm
   larger than the stored shape's (the ellipsoid is a sphere under a non-uniform scale, a B-spline
   surface). Whether that is the writer or the box of a re-read B-spline needs the kernel: not
   found here.
5. **The link whose copy the kernel refuses** (the kernel's move makes a body it reads as no sound
   solid) and **the chain fillet whose stored centre isn't a sound solid's** (S12a) are as S12b
   and S12a describe them; both are the kernel's reading of the file's own shapes. Not changed.
6. **Sketches of bodies on faces: done.** S12a's rule now holds for bodies too: a sketch FreeCAD
   attaches to a flat face of its own body is first tried on that face (found on the rebuilt
   body as any reference is) and kept there when the feature holds; else on the fixed plane its
   stored placement gives, as before. The library: 17 body sketches are attached to faces, 16 now
   stay on them, 1 falls back to its fixed plane (its face isn't found); all 25 bodies still hold
   with their history; references found go from 131 to 147 (the 16 faces) and not found from 2
   to 3 (that one face). Tests: `pocket_on_tilted_face`'s sketch is on its face, its plane input
   a face reference, and the design rebuilds after the face below moves.
7. **Chains: a finding.** The library's loose features used by an object outside their own chain
   (11 by this importer's own index; S12a counted 12): 6 by Python objects that come in as stored
   leaves of trees (their own stored shapes; the chain under them changes nothing), 3 by
   compounds that are no final shape, 1 by a Draft object, 1 by a pocket of another chain (and a
   sketch). None is used by something this importer builds from its operands, so none comes in
   another way. The chain on a base S11 could build (one of S12a's four foreign bases is a cut):
   the bodies and chains are walked before the trees, so a tree under a chain would need that
   order changed for one unit; not done.
8. **Chamfers on rebuilt booleans** (4 trees, `reference`) and the mirror twin: not done; the first
   needs edges matched across a boolean that FreeCAD's and Extrudo's kernels split differently.
9. **Scaled links, `VisibilityList`, per-element scales, mesh colours**: not done; no library file
   has any, and a scaled copy needs a Scale feature pivoting at the link's origin, which only a
   FreeCAD-made fixture (`link_scaled`) could check. No builder was added.
10. **Time: measured.** Per kernel call, each file alone with a kernel of its own: the median file
   spends 93 % of its import in the kernel (rebuilds 57 %, stored-shape measures 22 %), the three
   slowest 100 %, 100 % and 99 % (rebuilds 33 to 92 %, STEP conversions 8 to 52 %). The importer's
   own work is at most 7 %. Meshing the import's rebuilds coarsely (they are never shown) was
   tried: the slowest file took 108 s instead of 68 s, so it was not kept. Nothing cheap is left
   on the importer's side.

### Round two (part of the slice): extrusions, expressions, pictures

- **Part extrusions (done).** Of the library's 65 `Part::Extrusion` objects, 2 extrude a sketch;
  the others extrude Draft and Python objects (28), plain shapes (29), mirrors (3), a loft (1)
  and other extrusions (2). Of the 17 that are tree leaves, none extrudes a sketch (5 Draft
  objects, 3 mirrors, 9 plain shapes). Settings over all 65: `DirMode` Normal 18, Custom 16,
  absent 31; `Solid` on 31; `Symmetric` 1; `Reversed` 1; no taper; 4 lengths read expressions
  (all on Draft-based extrusions). Now an extrusion of a sketch with `DirMode` Normal, `Solid` on
  and no taper (`extrusionPlan`) is a tree node of its own (`extrude`): the sketch as S4 brings
  one and one Extrude (one way, both ways or symmetric, `Reversed` and a mirrored sketch flipping
  it), checked against the extrusion's stored shape as every node is, its lengths bound through
  the binder (`Part::Extrusion` joins the Part objects whose properties are inputs). An extrusion
  at the top is a tree only where it is rebuilt, so one that isn't stays a plain shape. As every
  node, it is built in its unit's frame: its sketch by its own placement when it is in the same
  containers as the extrusion (`addSketch`'s `local`), and the unit's containers move the whole
  once (S11's `Place` move); a sketch in other containers, or an extrusion with a placement of its
  own, is a stored leaf (`placement`). Lengths are decided in the plan: symmetric is `LengthFwd`
  in all (written with `symmetricMeasure: 'whole'`), so a symmetric one with no `LengthFwd` has no
  length; `LengthFwd` 0 with a `LengthRev` is one side turned round; both lengths make a
  two-sided extrude.
  Tests (`extrusion.test.ts`): S11's `extrusion_leaf` comes in whole and live; symmetric,
  reversed, two-sided and longer variants of it are refused by the check; tapered, custom
  direction, no solid, not a sketch and an out-of-range length are leaves from the file alone;
  an expression on `LengthFwd` is kept; at the top. **The library doesn't move**: neither of its
  two sketch extrusions is a tree node (one is used by a Python object, the other is in a file
  that stores no `DirMode`). The trees stay 9 / 10 / 14. **A fix on the way:** a profile's inside
  point (S5's `insidePoint`) found none in a rectangle whose hole has a vertex at the rectangle's
  mid-height (its one scan band's middle); it now tries other heights in the band.
  **The FreeCAD-made cases** (`final-fixtures.ts`, FreeCAD 1.1.4, our own
  `scripts/make-final-fixtures.py`; `final-cases.test.ts`, each body measured against FreeCAD's
  record): forward, both ways, symmetric, reversed, a moved and tilted sketch, inside a moved and
  turned part (with its `Place` move), with a bound length (live), and under a cut (live) all come
  in with their history and measure as FreeCAD's; tapered, along a custom direction and of a
  `Part::Plane` are refused from the file alone with their reasons and come in as the plain shape
  they were; `body_on_face`'s pocket sketch stays on the pad's top face and follows it when the
  pad gets longer. The fixture converter keeps a sketch's attachment for this set
  (`--keep-attachment`; S11's set drops it).
- **Expressions not kept (a finding).** The 103 whose target Extrudo has no input for: 72 sizes of
  Arch Python objects (`OverallHeight`, `OverallWidth` 36 each), 13 other properties of Python
  objects, 4 extrusion lengths (Draft-based, so stored leaves), 3 extrusion bases, 4 sketch
  attachment offsets in their plane, 2 TechDraw scales, 1 placement member of a Draft object, 1
  configuration binding, 1 loft's sections, 1 part's shape type. None targets an input of a
  feature this importer maps; 52 stay kept.
- **The tree caps:** the trees that came in before this slice keep their room. An extrusion at
  the top is planned after every other tree and stays a plain shape when it doesn't fit
  `MAX_IMPORT_TREE_NODES`; an extrusion node counts against `MAX_TREE_FEATURES` as the one feature
  its stored leaf did, and `MAX_TREE_EXTRUSIONS` (1,000) bounds what they add beyond it (at most
  two each). Tests: a top-level extrusion ahead of a cut, at either cap: the cut keeps its history.
- **Planes of a cancelled node:** a tree node or a structure attempt that is cancelled forgets
  the planes its sketch made (`forgetRemovedPlanes`), as a body's feature does, so a later sketch
  at that offset makes its plane again. Test: an extrusion under a cut that doesn't hold at an
  offset, then one that does at the same offset: the second comes in with its history.
- **Pictures:** the guide page has two, recorded by `e2e/guide-shots.spec.ts` from S10's own
  `sheet_plate` fixture: the imported plate with its notices and timeline, and its spreadsheet as
  parameters.

### The library (60 files, `history-corpus.test.ts`, `chain-corpus.test.ts`, `corpus-shapes.test.ts`)

| | Before S13 | After S13 |
|---|---|---|
| Bodies with their history / from the file's shape / empty | 25 / 6 / 4 | 25 / 6 / 4 |
| References found (none) | 131 (2) | 147 (3): 16 body sketches on their faces |
| Parameters; expressions kept | 50; 52 | 50; 52 |
| Part trees: history / leaves / as today | 9 / 10 / 14 | 9 / 10 / 14 |
| Loose chains: whole / with steps / as today | 8 / 5 / 1 | 8 / 5 / 1 |
| Final shapes | 383 | 383 |
| Meshes: in / not closed / empty | 4 / 68 / 13 | 4 / 68 / 13 |
| Components: from parts / from compounds | 17 / 2 | 17 / 2 |
| Links: copies / as before | 12 / 1 | 12 / 1 |
| Compounds at the top: members / shared / check | 2 / 2 / 1 | 2 / 2 / 1 |
| Final shapes S12b doesn't touch, compared with S3's import | 216 same, 0 differ | 216 same, 0 differ |
| `import` features: final shapes S3 / now | 291 / 230 | 291 / 230 |
| Kernel restarts; refusals | 0 | 0; 0 |
| Time a file, the whole library run (shared machine) | median 0.26 s, slowest 74 s | median 0.27 s, slowest 75 s (with round two) |
| The slowest file alone, after a warm-up | 74.7 s | 73.9 s (67.7 s with round two) |

**One standing number moved, up:** references found, 131 to 147, for the 16 body sketches that
now stay on their faces (and not found 2 to 3, the one whose face isn't found; that sketch comes
in on its fixed plane as before). Everything else is a bound, a refusal made earlier or cheaper,
or a case no library file has: no refused shape, no scaled link, no assembly of links to one
part, no degenerate mesh facet, no forbidden XML character, no name with a direction control,
no sketch extrusion in a tree. The slowest file is the
compound of S12b's last paragraph: its members are walked and checked and it comes in as before,
because its own stored shape is not its members' (above), which only the walk can show.

### The report and the app

`FcstdImportReport.refusals` (new) counts the kernel's refusals. No sentence the app shows changed: a refused
shape is left out as "the geometry kernel couldn't read it", as before; a mesh a placement takes
past 10 km is "its shape can't be read from the file". The guide page quotes every sentence and
reason `fcstdNotices` can show, each sentence as a whole quote with the file's text in italics,
and states the limits. `fcstd-guide.test.ts` drives `fcstdNotices` through reports that reach
every branch (`fcstd-notice-reports.ts`) and fails when a notice isn't made of the page's quoted
sentences, when the page quotes a sentence no notice reads so, when any one quote can go and
every notice still matches (each quote is removed in turn), when a reason or a limit is missing,
or when the notices gain a sentence the reports don't reach. An italic part of a quote matches
only what the reports put there (their names, numbers and the reason words), never a sentence
after it. The reasons are checked by table: every reason word is on the page, and a notice's
reason may only be one of them; the reports reach a few of them. Refused calls past their
share of the import's time are left out as "the import ran out of time", as any call after the
import's time. No e2e change: the app's behaviour is the same.

### Known limits

What the FreeCAD import doesn't do, as P6-25 leaves it:

- **Not read:** assemblies and their joints; TechDraw and other drawings; links to other files;
  FreeCAD's binary shape form; scaled links and array scales (left out); a link array's
  `VisibilityList` (every element shown); mesh colours; per-face colours (a body takes the first);
  FreeCAD 1.0's element maps (never needed).
- **Not rebuilt, so the file's own shape for that step:** sweeps, lofts, helixes, pipes,
  thickness, drafts and every PartDesign feature but Pad, Pocket, Revolution, Groove, Fillet,
  Chamfer, the patterns, Mirrored, MultiTransform and Hole; tapered, custom-direction and
  some up-to extrudes; Part extrusions of anything but a sketch along its normal, Python objects,
  mirrors and offsets; partial primitives,
  cones, ellipsoids, prisms and wedges; Draft, BIM, FEM and CAM objects beyond their solids; a
  boolean whose result Extrudo's kernel splits differently (a common of several solids, a cut that
  removes nothing).
- **Checks that refuse what may be right:** a feature after a stored-shape step whose STEP drift
  passes 1e-6 (one in the library); a compound whose own stored shape is not its members' (one);
  a mirror-image twin is told apart only by the centre of mass.
- **Links and parts:** a turned copy follows FreeCAD exactly only at the imported sizes (S11's
  pivot); components carry no transform and don't nest; a part's visibility isn't read.
- **Sketches:** a sketch on a face stays on it only where the face is found; external geometry
  that is a vertex, a spline or an ellipse stays out.
- **Coplanar faces:** a sketch on one of two coplanar faces stays on the face the file names,
  found by its geometry; where both give the same plane at import the check can't tell them
  apart, so after an edit the sketch may follow the other one.
- **Expressions:** only what Extrudo's language can compute to the file's number stays live;
  configuration tables and MultiTransform step inputs come in as numbers.
- **Cost:** each feature sends the design so far to the kernel (quadratic copying, bounded by the
  feature caps and 10 minutes); a unit of Part trees may be built up to four times.
- **Entry points:** the app's three import commands only; not the CLI, not the MCP server.
