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
