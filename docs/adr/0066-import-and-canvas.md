# ADR-0066: Import (drawings, STEP, meshes) and canvas images

- **Status:** Accepted, 2026-10-04
- **Task:** P4-06 (FR-SK-14 "Import SVG and DXF into a sketch"; FR-IO-05 "STEP
  import as a (non-parametric) base body"; FR-IO-06 "STL, 3MF and OBJ import as
  mesh bodies that can be used in booleans"; FR-IO-07 "Canvas: a reference image
  on a plane, calibrated to real scale").
- **Builds on:** ADR-0022 (`@extrudo/io`'s `Drawing`), ADR-0019 (`SketchChange`,
  `modifySketch`), ADR-0058/0061 (attachments, bytes before the document, fonts
  sent to the worker before the recompute), ADR-0034 (`readStep`, `exportMesh`,
  `readStl`, `read3mf`, `checkManifold`), ADR-0024 (engine, scopes, strict
  leaks), ADR-0028/0044 (`operate`, `splitSolids`, Combine, Move), ADR-0040
  (reports of features that make no body), ADR-0054 (CSP, licence allow-list),
  ADR-0063 (control-point splines).

## Context

Four kinds of import, of very different weight:

- **Drawings** (SVG, DXF) become ordinary sketch curves. `@extrudo/io` already
  has a neutral `Drawing` (contours of lines, circular arcs, elliptical arcs,
  quadratic and cubic Béziers; mm, y up) that its writers take; readers produce
  the same type. Since P4-05 a cubic Bézier is exactly a control-point spline of
  four poles (`controlSpline` is clamped with uniform interior knots, so four
  poles are one Bézier span).
- **STEP** becomes a solid body. The facade's `readStep(text)` exists (P2-12,
  round-trip tests; `STEPControl_Reader`, converts to mm, `OneShape()`).
- **Meshes** (STL, 3MF, OBJ) are triangles, not B-rep. Turning 100,000
  triangles into 100,000 OCCT faces makes every boolean crawl and the heap
  explode; the architecture's stack table (`docs/02-architecture.md`) already
  names **manifold-3d** for mesh booleans. manifold-3d 3.5.4 is
  Apache-2.0, WASM, runs in Node and workers.
- **Canvas images** are reference pictures on a plane, for tracing. They make no
  geometry.

The bytes of STEP, mesh and image files must travel with the design: they are
**attachments** (ADR-0061), not document JSON.

## Decision

### 0. Attachments for imports

- `doc.attachments[].mediaType` accepts, besides the fonts, `model/step`,
  `model/stl`, `model/3mf`, `model/obj`, `image/png`, `image/jpeg`,
  `image/webp`. The media type comes from the file name's extension (`.step`/`.stp`,
  `.stl`, `.3mf`, `.obj`, `.png`, `.jpg`/`.jpeg`, `.webp`), never from the
  browser's `File.type` (often empty for these).
- **Limits** (storage, ADR-0061 §2): 25 MB a file (was 10), 100 MB a design (was
  50). A 10 MB cap refused ordinary STLs (a binary STL of 200,000 triangles is
  10 MB).
- **The worker gets files like fonts**: `KernelApi.addFile(id, bytes)`
  (`id` = the `AttachmentId`), sent by the `Recomputer` before the first
  recompute (or preview) whose features name that attachment; the worker keeps a
  `Map<AttachmentId, Uint8Array>` for the session and evaluators read it through
  `ctx.file(id)`, which throws `MissingFileError` → "The file <fileName> is missing
  from this design." The app side reads the bytes through the project-scoped
  attachment resolver that `useFontAttachments` set up (generalise it to any
  attachment; fonts keep working through it).
- **One undo step per import, bytes first**: the import commands write the
  bytes (`writeAttachment`), then dispatch `addAttachment` and the feature (or the
  sketch change) **in one transaction**. A dialog that previews before OK puts the
  picked file into the app's attachment cache under its new ID first, so the
  preview's `addFile` finds it; Cancel adds nothing to the document (the bytes
  stay in storage until `collectAttachments`).
- The file format: the media types, the limits and the `import`/`canvas` feature
  inputs in `docs/file-format.md`. `formatVersion` stays 1 (new optional values;
  an older app reads the features as unknown types with ADR-0050's notice).

### 1. Drawings → sketch (no attachment)

**Readers in `@extrudo/io` (MIT, no dependencies):**

- `readSvg(text, options?): DrawingImport` and `readDxf(text, options?):
  DrawingImport`, where `DrawingImport = { drawing: Drawing; units: 'mm' | 'cm' |
  'm' | 'in' | 'ft' | 'px' | 'unitless'; skipped: Record<string, number> }`
  (`skipped`: what was left out, by kind, for the panel: `{ text: 4, image: 1 }`).
  Coordinates come out in **mm** for the detected unit (px at 96 per inch;
  unitless DXF as mm), y up.
- **SVG:** our own small XML tokenizer (elements, attributes, the five XML
  entities and numeric references, comments, CDATA and `<!DOCTYPE>` skipped; no
  dependency). Elements: `path` (every command, absolute and relative, `A` arcs
  as elliptical arcs, circular when rx = ry and the transform keeps circles),
  `rect` (with `rx`/`ry` corners), `circle`, `ellipse`, `line`, `polyline`,
  `polygon`, inside any depth of `g`/`svg`; `transform` on every element and
  group (matrix, translate, scale, rotate with centre, skewX/Y) composed down
  the tree; `display="none"` / `style="display:none"` subtrees skipped. Units:
  the root's `width`/`height` with a unit and its `viewBox` give mm per user
  unit; without a unit, user units are px. y is flipped (SVG's y points down).
  Skipped and counted: `text`, `image`, `use`, `defs`, `clipPath`, `mask`,
  `pattern`, `style`, `foreignObject`.
- **DXF:** ASCII only (binary DXF refused: "Binary DXF isn't supported: save it
  as ASCII DXF."). `$INSUNITS` (0 unitless, 1 in, 2 ft, 4 mm, 5 cm, 6 m; others
  as mm). ENTITIES: `LINE`, `ARC`, `CIRCLE`, `LWPOLYLINE` and
  `POLYLINE`/`VERTEX` (bulges as arcs, the closed flag), `ELLIPSE` (whole and
  partial), `SPLINE` (non-rational: converted **exactly** into cubic or lower
  Bézier pieces by knot insertion (degree 2 elevated to 3); rational, or fit
  points only: sampled at 16 points per span into a fit-point spline), `POINT`;
  `INSERT` of a block expanded with its position, scale, rotation and
  row/column counts, up to 8 levels deep. Entities whose extrusion direction is
  (0, 0, −1) are mirrored in x (the usual mirrored-arc case); any other
  extrusion is skipped and counted. Skipped and counted: `TEXT`, `MTEXT`,
  `DIMENSION`, `HATCH`, `SOLID`, `3DFACE`, the rest.

**Sketch side: `@extrudo/sketch/import`** (pure, its own entry like `/export`,
`sketch → core, io`): `drawingToSketch(drawing, sketch, options):
SketchChange`, options `{ scale: number; offset: Vec2; fixed: boolean }`:

| Drawing segment | Sketch entity |
|---|---|
| line | `line` (zero-length dropped) |
| arc, full turn | `circle` |
| arc | `arc` |
| elliptical arc, full turn | `ellipse` |
| elliptical arc | control-point splines, one cubic Bézier per ≤ 45° of parameter (error below 1e-5 × the major radius) |
| cubic Bézier | control-point `spline` of 4 poles (exact) |
| quadratic Bézier | the same, degree-elevated (exact) |

- **Fixed (default on):** every new curve gets a `fix` constraint (whatever
  the schema's `fix` takes: the curve, or its points). The solver treats fixed
  geometry as constants (ADR-0011), so a 3,000-curve logo costs the solver
  nothing; no coincident constraints are added (profile detection joins ends
  within 0.1 µm by geometry). **Fixed off:** ends that coincide within 1e-6 mm
  get coincident constraints (each point keeps one owner, ADR-0010), nothing
  else is constrained.
- Exact duplicates (same type, same points within 1e-9 mm) are dropped.
- **More than 5,000 curves is refused** ("This drawing has 12,400 curves;
  Extrudo imports up to 5,000.").
- The change is one `modifySketch` step labelled "Import <file name>".

**UI:** in an open sketch, the Sketch tab's Create group menu gets "Import
Drawing…" (tool `importDrawing`, no key). It picks a file (`.svg,.dxf`), then
shows the panel "Import drawing" (built like the Text tool's: `textDraft.ts`'s
pattern, a panel plus the tool's preview): the file name; **Units** (combobox,
the detected unit preselected: mm, cm, m, in, ft, px); **Scale** (expression,
default 1); **Position** (combobox: "Drawing origin at sketch origin" (default) /
"Centred on sketch origin" (the drawing's box centre)); **Fixed** (checkbox,
on); a summary line ("312 curves · skipped 4 texts"); OK (commits through
`ToolHost` as one undo step) and Cancel. A reader error or the 5,000-curve limit
shows in the panel and disables OK.

### 2. STEP → base body: feature `import`

**Core** (`packages/core/src/import.ts`): one feature type `import` for STEP
and meshes:

| Input | Type | Default | Meaning |
|---|---|---|---|
| `file` | string (an `AttachmentId` of `doc.attachments`) | – | The file. The schema check: it exists and its media type is `model/*`. |
| `units` | choice `auto`, `mm`, `cm`, `m`, `in` | `auto` | Meshes only. `auto`: a 3MF's own unit, STL and OBJ as mm. STEP converts its own units. |
| `up` | choice `z`, `y` | `z` | The file's up axis; `y` turns it +90° about X (Y-up to Z-up), for OBJ/glTF-style files. |

No placement inputs: the body lands at the file's coordinates, and Move (or
Place on Bed for STEP) puts it elsewhere. `import` is not patternable (its tool
is the file); its bodies are, through Pattern › Bodies.

**Kernel** (`packages/kernel/src/features/import.ts`), STEP branch:
`kernel.readStep(text)` (bytes decoded as UTF-8) → the `up` turn (`transform`) →
`splitSolids` (one body per solid; the largest keeps `<feature>`'s body ID, as
everywhere). A file with no solid ("The STEP file has no solids: Extrudo imports
solid bodies, not surfaces.") or that OCCT can't read (the facade's message) is
an error. **Names:** face `n` (1-based, in the order `TopExp` lists the file's
faces before splitting) is `import:<id>:face:<n>`; the file never changes, so the
order is stable, and a recompute names the same face the same way. No history.

**UI:** the Solid tab gets an **Insert** group with the tile "Import" (tool
`importBody`, no key; File menu "Import…" runs the same command). It picks a
file (`.step,.stp,.stl,.3mf,.obj`), then opens the dialog "Import" (a
`FeatureDialogSpec`: the file name and size as a read-only line, Units for
meshes, Up; live preview), OK commits attachment and feature in one undo step.
Editing an `import` changes only Units and Up (replacing the file is Deferred).

### 3. Mesh bodies

**A mesh body is a `ShapeHandle` the `Kernel` owns, backed by a manifold-3d
`Manifold` instead of an OCCT shape.** The engine, its cache, reference counts,
`hold`, scopes and strict leaks keep working unchanged:

- Handles at or above `MESH_HANDLE_BASE` (2^30) are meshes, kept in
  `Kernel.#meshes: Map<number, Manifold>`; `kernel.isMesh(h)`. `release` deletes
  the `Manifold`; the live-shape count adds `#meshes.size`, so a leaked mesh fails
  strict leaks like a leaked shape.
- **manifold-3d loads only when needed:** `KernelApi.enableMeshes()` (the
  `Recomputer` calls it before the first recompute of a document with an `import`
  of a mesh file) loads the module in the worker; in Node, `loadKernel({ meshes:
  true })` or `kernel.enableMeshes(module)`. Designs without meshes download
  nothing more. The module's `.wasm` is a build asset (precached with the rest;
  check the precache list and the CSP: it needs nothing new beyond
  `'wasm-unsafe-eval'`/`'unsafe-eval'`, which the embind glue already has).
  Licence: Apache-2.0 into `scripts/check-licenses.mjs` and `NOTICE`.
- **Import:** `@extrudo/io` parses (`readStl`, `read3mf`, new `readObj`: `v`
  and `f` lines (triangles and polygons fanned, `v/vt/vn` indices, negative
  indices), `o`/`g` start a new object, everything else ignored; ASCII STL is
  added to `readStl` (`solid`…`endsolid`, detected when the file doesn't fit the
  binary size)), units and `up` are applied, then `kernel.meshFrom(mesh)` welds
  the nodes (`Mesh.merge()`) and builds the `Manifold`. **One body per object**
  (3MF objects of the build, OBJ `o`/`g` groups, an STL's connected pieces via
  `Manifold.decompose()`). A mesh that isn't closed is an error with
  `checkManifold`'s count: "bracket.stl isn't a closed solid (14 open edges):
  repair it in your slicer or a mesh tool and import it again." More than
  1,000,000 triangles is refused before parsing finishes.
- **Display:** `kernel.mesh(h)` gives a `BodyMesh` with **one face** (all
  triangles), flat normals per triangle where the dihedral angle exceeds 30°,
  smooth otherwise; its edges are the feature edges (dihedral over 30°) with a new
  flag `EDGE_MESH` that picking skips (they draw, they don't pick). The body's
  single face is named `mesh:<feature>` (the feature that last made the body), so
  a face pick on a mesh body resolves to that body.
- **Export:** STL and 3MF take the `Manifold`'s triangles directly. **STEP
  skips mesh bodies**: the Export dialog unchecks and disables them under STEP with
  the hint "Meshes can't go into a STEP file". Bodies tell the UI they are meshes
  through `BodyMesh.mesh = true`; the browser's body row shows a "Mesh" tag
  (`data-body-mesh`), and `data-bodies` is unchanged.
- **Inspect / Print Info:** volume, area and box from the `Manifold`; a mesh
  body's face has area only.
- **Everything else refuses a mesh body** with one message from the `Kernel`
  (`MeshBodyError`): "<Operation> needs a solid body: this body is a mesh
  (imported, or combined with a mesh)." Fillet, chamfer, shell, offset face,
  draft, thread, emboss, rib's slab cut **into** a mesh, sketch on face, Project,
  Place on Bed, hole on a mesh face, measure of faces and edges. (Hole and Extrude
  cutting **through** a mesh body from a sketch elsewhere work: §4.)

### 4. Booleans and transforms with meshes

`Kernel.fuse`/`cut`/`common` dispatch: when either operand is a mesh, both go to
manifold-3d — a B-rep operand is meshed through `exportMesh` at
`MESH_BOOLEAN_DEFLECTION` (0.01 mm, 0.1 rad: closed and manifold by
construction, ADR-0034) — and **the result is a mesh**. `OperationResult.history`
is empty; the result's one face is named after the feature. So `operate` (extrude,
revolve, sweep, hole, pattern instances, rib joins), Combine and Mirror's join
work on meshes as they are. `touchingBodies` tests a mesh pair by boxes, then
`Manifold.minGap(other, 1e-3) ≤ 1e-6` instead of OCCT's exact distance.

- A solid body that meets a mesh in a boolean **becomes a mesh**; the feature gets
  a warning once: "A solid body was combined with a mesh and is a mesh from here
  on: fillets and face picks no longer work on it."
- `transform` (Move, Mirror (a reflection reverses the triangles), Scale (equal
  and unequal), pattern copies, the `up` turn): `Manifold.transform` with the
  3×4 matrix.
- Split Body: `Manifold.splitByPlane` (keep above/below/both as now; the cut face
  is part of the one mesh face).
- `splitSolids` on a mesh: `Manifold.decompose()`.

### 5. Canvas: feature `canvas`

**Core** (`packages/core/src/canvas.ts`), feature type `canvas` (no body,
`bodyAccess: 'none'`):

| Input | Type | Default |
|---|---|---|
| `plane` | ref (origin plane, construction plane, flat face) | XY |
| `image` | string, an `AttachmentId` with an `image/*` media type | – |
| `x`, `y` | expr length (the image centre, in the plane's sketch frame) | 0 |
| `width` | expr length (height follows the image's aspect) | the image's pixel width × 0.1 mm |
| `rotation` | expr angle | 0 |
| `opacity` | expr number, 0.05…1 | 0.5 |
| `flip` | bool (mirror left–right) | false |

**Kernel:** the evaluator reads the plane with `planeOf` and reports a
`CanvasReport { frame }` (beside `ConstructionReport`; the `Recomputer` collects
`ModelState.canvases`). No shapes, no bytes in the worker.

**App:** `viewport/Canvas.tsx` draws each visible canvas as a textured quad on its
frame: the image decoded with `createImageBitmap` from the attachment's bytes
(no URL load, so the CSP is untouched), `depthWrite: false`, drawn before bodies,
never picked (clicks pass through to what is behind or to the plane picker).
The Solid tab's Insert group gets "Canvas" (tool `canvas`; picks `.png,.jpg,.jpeg,
.webp`), the dialog "Canvas" has the plane picker field and the inputs, and a
**Calibrate** button: the next two clicks on the canvas's plane (the plane
picker's world point, as Hole's `placeAt`) mark two points, the dialog asks for
their real distance, and `width` becomes `width × real / measured` (as a plain
value, rounded to 0.01 mm). The browser gets a "Canvases" folder (eye per row,
`Feature.visible`), and sketches draw over canvases.

## Slices

1. **Drawings** (§1): readers and tests (hand-written fixtures in
   `packages/io/src/fixtures/`), `@extrudo/sketch/import`, the tool and panel,
   `e2e/import-drawing.spec.ts`. Independent of the rest.
2. **Attachments for imports and STEP** (§0, §2): media types and limits, the
   worker's files, the `import` feature with the STEP branch, the Insert group,
   the dialog, `e2e/import-step.spec.ts` (fixture: a STEP our own `writeStep`
   wrote of B3's bodies).
3. **Mesh bodies** (§3): manifold-3d, mesh handles, `readObj` and ASCII STL, the
   mesh branch of `import`, display, export, inspect, refusals,
   `e2e/import-mesh.spec.ts`.
4. **Mesh booleans and transforms** (§4): the dispatch, `touchingBodies`, the
   warning, Move/Mirror/Scale/Split/patterns, e2e: an imported STL with a hole
   cut through it and a box joined to it, exported to 3MF and checked manifold.
5. **Canvas** (§5): core, kernel report, viewport, dialog with Calibrate, browser
   folder, `e2e/canvas.spec.ts`.

## Results: drawings (slice 1, 2026-10-04)

What the slice delivers: `readSvg` / `readDxf` in `@extrudo/io`, a
`DrawingImport` (`drawing.ts`), `@extrudo/sketch/import`'s `drawingToSketch`,
and the tool `importDrawing` with the panel "Import drawing".
`e2e/import-drawing.spec.ts` imports a 40 × 20 mm plate with a Ø10 hole, reads
`profiles=2 holes=1` and extrudes it to `40,20,5` (`80,40,5` with Scale 2, and
25.4 × 25.4 mm from the inch DXF).

**Measured.** An elliptical arc's pieces stay **1.3 × 10⁻³ mm** or less from the
exact curve over a 120° arc of a 20 × 8 mm ellipse (the ADR asks for 1e-5 of the
major radius, 2 × 10⁻⁴ mm); a cubic Bézier comes back **exactly** (1e-9) and a
rational DXF `SPLINE` within its 16-samples-per-span Catmull-Rom fit. The SVG
round trip of our own writer (`readSvg(writeSvg(d))`) is exact to the writer's
four decimals for lines and Béziers, and to **0.05 mm** for arcs, circles and
ellipses — that is SVG's own limit, not the reader's: an `A` command gives the
endpoints and the radii, so a radius rounded to 0.1 µm makes a half turn a
little longer than π and moves its centre a hundredth of a millimetre. (The DXF
round trip is 1e-5 mm for lines, arcs and circles, and a flattened polyline
within 5 µm for ellipses and Béziers, which R12 cannot express.)

**Where the design moved, and why.**

- **The `viewBox` is read for its scale alone**, never its translation: our own
  writer puts geometry at true coordinates and uses the viewBox as the page
  (`viewBox="-20 -10 40 20"` for a 40 mm plate), so honouring the viewBox's
  origin would move a file Extrudo exported by 20 mm. A file that relies on its
  viewBox's translation (a drawing placed off the origin with a 0 0 viewBox) will
  land at its user coordinates, which is what the geometry says.
- **A nested region counts twice in the view's count.** `detectProfiles` (and
  ADR-0020) says a region inside another is a hole of it *and* a region of its
  own, so the imported plate with its hole reads `profiles=2 holes=1`, not
  `profiles=1 holes=1`: one region is the plate with its hole, the other the disc.
  The e2e and the panel take it as it is.
- **A rational or high-degree DXF `SPLINE` becomes cubic Béziers**, 16 per knot
  span, where the ADR said "a fit-point spline": a `Drawing` has no spline of
  its own, and a four-pole control spline (ADR-0063) *is* a cubic Bézier, so the
  imported curve is the same kind of curve the rest of the pipeline wants.
- **The `insertSvg` placeholder tile in the Insert tab stays.** It was P4-06's
  placeholder for this slice, but the Insert tab is where §2 and §5 put STEP,
  meshes and a canvas, and removing it moves the toolbar in every mode, so eight
  checked-in screenshots would have to be regenerated. The tool therefore lives
  where §1 says it does — the Sketch tab's Create menu, "Import Drawing…", no
  key — and the placeholder (a disabled tile that still reads "Arrives with
  P4-06") is left to the slice that reworks that tab.
- **A DXF `INSERT`'s row and column spacing follows the insert's own axes**, like
  its scale and turn, so a turned array spreads along the turned axes. The
  specification is not explicit; this is the AutoCAD behaviour.
- **`POINT` entities import as nothing**: a drawing has no point, so a DXF point
  becomes a zero-length line that the importer drops. It is read (it is not
  counted as skipped) and it does not appear in the sketch.

**Left out, as Deferred says.** SVG `use`, DXF text as sketch text, and any
re-import that keeps references.

## Rejected

- **Meshes as faceted B-rep** (one OCCT face per triangle, sewn): every feature
  would work, but a 100,000-triangle STL takes minutes to sew and its booleans
  are unusable; the heap grows past what the worker can hold.
- **Meshes in a separate body map beside the shapes:** every engine, cache, hold
  and leak path would need a second kind of body. Handles keep them one kind.
- **Loading manifold-3d at kernel start:** costs every design a second WASM for
  a feature few use.
- **An SVG/DXF library** (e.g. `dxf-parser`, an XML parser): the subsets we need
  are small, `@extrudo/io` stays dependency-free (fflate apart), and a parser of
  ours maps straight onto `Drawing`.
- **Drawings as attachments with a live link to the file:** a drawing becomes
  ordinary editable curves; keeping the file adds nothing the curves don't have.
- **Imported curves free by default:** thousands of free curves with coincident
  constraints make the solver's diagnosis slow; fixed geometry costs nothing,
  and the user frees what they want to edit.

## Deferred

- Replacing an imported file (re-import keeping references), names and colours
  from the file for the bodies (3MF object names and colours, STEP product names).
- Drag and drop of files onto the view; DXF text as sketch text; SVG `use`.
- Mesh repair (open edges), mesh decimation, faces of a mesh as references
  (planar regions), a mesh → B-rep conversion.
- STEP export of mesh bodies (as faceted solids), STEP assemblies and colours.
- Canvas: perspective correction, more than one calibration distance.
