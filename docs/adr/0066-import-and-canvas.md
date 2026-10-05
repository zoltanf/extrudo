# ADR-0066: Import (drawings, STEP, meshes) and canvas images

- **Status:** Implemented (accepted 2026-10-04; all five slices done 2026-10-05)
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

**UI:** the toolbar's **Insert tab** gets the tile "Import" (tool
`importBody`, no key; File menu "Import STEP or mesh…" runs the same command).
It picks a file (`.step,.stp,.stl,.3mf,.obj`), then opens the dialog "Import"
(a `FeatureDialogSpec`: the file name and size as a read-only line, Units for
meshes, Up; live preview), OK commits attachment and feature in one undo step.
Editing an `import` changes only Units and Up (replacing the file is Deferred).

The Insert tab, not a group in the Solid tab: the app already had one (with
the `insertSvg` placeholder this ADR's slice 1 left), it is where STEP, the
meshes and the canvas all belong, and adding or removing tabs moves the toolbar
in every mode (eight checked-in screenshots). The placeholder tile is replaced
by `importDrawing`, so the Insert tab holds both: "Import" and "Import
Drawing…". The drawing import is only available in a sketch — it becomes the
open sketch's curves — and says so outside one ("Open a sketch to import a
drawing into it.").

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

## Results: STEP import (slice 2, 2026-10-04)

What the slice delivers: `packages/core/src/media-types.ts` (the ten media
types and `mediaTypeOf`, the extension table every party reads), a `file` input
kind and the document check that it names an attachment the feature can read,
25 MB a file and 100 MB a design, `KernelApi.addFile` beside `addFont`,
`EvalContext.file`/`fileType` with `MissingFileError`, the `Recomputer` sending
every attachment an `import` names before the recompute **or preview** that
needs it, the `import` feature (`packages/core/src/import.ts`,
`kernel/src/features/import.ts`) with its STEP branch, and the Insert tab's
"Import" tile with the dialog, the File menu entry and
`e2e/import-step.spec.ts`.

**Measured.** The fixture is B3's two bodies written by our own `writeStep`
(`fixtures/imports/b3.step`, rewritten with `WRITE_FIXTURES=1`): importing it
gives two bodies of 60 × 80 × 10 mm and 60 × 31.838 × 60 mm, volumes 48 000
and 36 000 mm³, **exact to 1e-9 mm** through the STEP round trip (boxes are
prisms, so nothing is approximated; `measure`'s own error on a box is 1e-9).
`up: 'y'` turns the file +90° about X, so the sizes' y and z swap
((x, y, z) → (x, −z, y)), and the turn is part of the cache key: with one
engine both results sit in the cache and each recompute of either is a hit. The
face names `import:<id>:face:1…6` are the same on a warm and a cold recompute,
as they must be: they come from the order `TopExp` lists the file's faces in,
and the turn keeps a shape's sub-shape order.

**Where the design moved, and why.**

- **The dialog framework grew two small things**, both asked for by this slice
  and both general enough to be worth having. A field kind `info` — a
  read-only line — because the file is not a field the dialog can change
  (replacing it is Deferred) but a user needs to see what is being imported;
  and `shown(values, ctx)`, because whether `units` shows depends on the
  *document* (only a mesh has units of its own), which `shown` could not
  previously see. The dialog's OK grew `spec.commitWith`, the commands a
  feature needs beside itself: an import adds its attachment record through
  it, and the framework runs both in one transaction, which is the "one undo
  step per import" of §0 in the only place that can promise it.
- **The bytes go to storage before the dialog opens**, not when OK is pressed:
  the dialog previews, and the preview needs the file in the worker, and the
  worker may only have what the design names. So the picked file's bytes are
  written (ADR-0061 §2), put in the app's attachment cache under the new ID
  (`putAttachmentBytes`) and the dialog's `addFile` finds them there. Cancel
  then adds nothing to the document and leaves the bytes for
  `collectAttachments` — which is exactly what §0 asked for.
- **The fixture is B3 rolled back before its Combine**, so the file holds two
  separate solids: an import of one solid would never reach `splitSolids`, and
  two bodies are what the timeline and the e2e's undo checks are worth.
- **A file the design names but the worker has no bytes for** is the feature's
  error, worded with the file's own name ("The file b3.step is missing from
  this design."), not an internal one: `MissingFileError` is a `KernelError`,
  so the engine reports it like any other.

## Results: mesh bodies (slice 3, 2026-10-04)

What the slice delivers: manifold-3d 3.5.4 (Apache-2.0, `NOTICE`) as a
dependency of the kernel and `Kernel.#meshes`, the mesh handles
(`MESH_HANDLE_BASE` = 2^30, `isMesh`, `release`, scopes, `liveShapes`),
`meshFrom` and the mesh branches of `mesh`, `exportMesh`, `measure`,
`properties`, `describe`, `count`, `solids`, `transform`, `writeStep`'s
refusal and every other shape-taking method's `MeshBodyError`;
`KernelApi.enableMeshes` and the `Recomputer`'s lazy call; `readStl`'s ASCII
branch, `readObj` and `write3mf`'s `unit` in `@extrudo/io`; the mesh branch of
`import` with `EvalContext.fileName`; inspect's mesh face; the browser's
"Mesh" tag and the Export dialog's STEP exclusion; the fixtures in
`fixtures/imports/` and `e2e/import-mesh.spec.ts`.

**Measured** (`BENCH=1 pnpm vitest run packages/kernel/src/features/import-mesh-bench`,
4-core Ubuntu machine, Node 24; a 204,800-triangle sphere written through our
own `writeStl`): the file is **10.2 MB**, the import **1.4 s** cold (reading
the file, welding it, building the manifold and meshing the body for the
view), the body's volume 33,508 mm³ (the sphere's own), and the JS heap grows
**+66 MB** while the manifold's WASM heap holds the rest — the body is **one**
live shape, so the cache, `hold` and strict leaks count it like any other. A
20 mm cube imports in under 50 ms.

The second WASM costs **0.54 MB raw, 0.16 MB brotli** (`manifold.wasm`, 541 kB)
and its glue 0.14 MB of the kernel chunk; the whole precache goes from 24.02 MB
/ 6.30 MB brotli to **24.76 MB / 6.51 MB** (`node scripts/measure-startup.mjs
--no-browser`). It is **precached**: importing a mesh is as ordinary as
everything else in the app, and a 0.5 MB file on top of 18.7 MB of OCCT is
3 %; the CSP needs nothing new for it, since `'wasm-unsafe-eval'` is already
there for the other two WASM files (`e2e/hosting.spec.ts` passes).

The unit conversion is exact where it can be: `units` scales the coordinates
before the mesh is built, so a 3MF in centimetres comes out as exactly
40 000 mm³ for a 4 cm cube (float32 only enters where the file was float32),
and `up` is the same 3 × 4 turn `Move` uses, so `(x, y, z) → (x, −z, y)`.

**Where the design moved, and why.**

- **A mesh body's centre is the centre of its box, not a centre of mass.**
  manifold-3d has no such value, and computing one from the triangles is
  cheap but a second definition to keep right; §3 said "the centre of mass if
  the API gives it, else the box centre, and say which" — this is the "which".
- **`Kernel` counts a mesh in `liveShapes` and frees it in `release`.** The
  scope, the cache's reference counting, `hold` and the strict-leak check then
  need nothing: a leaked mesh fails a test exactly like a leaked shape. The
  facade's arena keeps its own handles, so `release` sends a mesh handle to
  the map and a shape to OCCT.
- **The guards name the operation the user asked for**, not the kernel method:
  a `Shell` on a mesh body says "Shell needs a solid body: this body is a mesh
  (imported, or combined with a mesh)." and an Emboss says "Emboss…". Booleans
  (`fuse`/`cut`/`common`) say "Boolean needs a solid body…", which §4 replaces
  with manifold's own booleans.
- **A mesh body's edges are the creases and nothing picks them.** `EDGE_MESH`
  is a new flag beside `EDGE_SEAM`, the view draws them as any edge, and
  `pick.ts` skips both (one `UNPICKABLE` constant): there is no B-rep edge
  behind a crease to name, and a fillet dialog that could be filled with one
  would fail later instead of now.
- **A file that isn't closed is refused before it becomes a body, with the
  count.** `checkManifold` runs in `meshFrom` and its counts (`openEdges`,
  `nonManifoldEdges`, `misorientedEdges`, `badTriangles`, `badNodes`, and the
  signed volume for a mesh that is closed but inside-out) are carried on a
  `MeshError`, which the evaluator rewords with the file's name: "open.stl
  isn't a closed solid (3 open edges): repair it in your slicer or a mesh tool
  and import it again." manifold's own `status()` is the second net, and
  `Mesh.merge()` welds the corners that a file stores apart before that.
- **The 1,000,000-triangle cap is read before a binary STL is parsed**
  (`stlTriangleCount`), so a 50 MB file is refused in milliseconds; ASCII STL
  has no count to read, so it is counted as it parses.
- **The mesh branch numbers its bodies as `splitSolids` does** — the largest
  piece keeps the feature's first body ID, the rest follow in geometric order
  with `ctx.bodyId(n)` — and its faces are `mesh:<feature>`, with `#2`, `#3`…
  for the bodies after the first (one face per body has to be able to tell two
  bodies apart for ADR-0005's references). §3 left the numbering open ("`#n`
  per body if names must be unique across bodies").
- **A file's name travels with its bytes.** `addFile` carries it (the app
  knows a file it just picked, before the design names it), so a message about
  a previewed file says "open.stl", not an attachment ID — which also fixes
  `MissingFileError`'s message for that case.
- **`inspectShapes` measures a mesh body's face from the body itself** (its
  area, centre and box, with no surface under it), and `subShape` on a mesh is
  refused, so a mesh body can be measured but has no edges to measure.
## Results: canvas (slice 5, 2026-10-04)

What the slice delivers: `packages/core/src/canvas.ts` (the feature `canvas`,
its inputs, defaults and the `CanvasReport`), its kernel evaluator
(`packages/kernel/src/features/canvas.ts`) and `ModelState.canvases` through
the `Recomputer`; `apps/web/src/viewport/Canvas.tsx` with `canvasGeometry.ts`
(pure: the drawing, its size, the test summary, the calibration maths) and
`canvasImages.ts` (the decoded pictures and their textures); the Insert tab's
"Canvas" tile (tool `canvas`) with the dialog "Canvas" and its **Calibrate**
panel; the browser's "Canvases" folder; and `e2e/canvas.spec.ts`.

**Measured.** A 200 × 100 px picture comes in at 200 px × 0.1 mm = **20 mm**
wide and, from its own aspect, 10 mm high. Calibrating marks the picture's two
15 mm apart (150 px at 100 dpi) and asks what they really measure: at 30 mm
the width becomes `20 × 30 / 15` = **40 mm** and the picture 40 × 20 mm; the
e2e checks the formula against the measurement the dialog shows, because a
click lands within a pixel of the mark and the measurement is that click's.

**Where the design moved, and why.**

- **The picture's pixel size lives in the app, not the document.** An
  attachment record holds a hash and a byte count, not the picture's
  dimensions, so **the dialog writes `width`** when the file is picked
  (`CANVAS_PIXEL_MM` a pixel) and the schema's default (100 mm) is only what a
  canvas without a width gets. The pixels come from `createImageBitmap` on the
  app's side, which the view does anyway to draw the picture.
- **`bodyAccess` is `none` only for a plane that is not a face.** §5 said the
  evaluator reads the plane with `planeOf`; a `plane` reference may also be a
  **flat face** (the field takes one, as a primitive's placement does), and a
  face comes from a body, so the evaluator asks for the bodies it needs with
  construction's own `usesBodies` rule. A canvas on an origin or construction
  plane still reads no bodies.
- **The numbers are the app's to read.** The report is the frame alone, as
  designed; the picture, its centre, width, turn and opacity come from the
  feature's own inputs through `canvasNumbers`, which the kernel feeds with
  `ctx.value` and the view feeds with the document's evaluation — one function,
  two callers, so the preview and the stored feature draw the same picture.
- **The dialog framework grew a second small hook, `spec.extra`**, a component
  of the spec's own rendered under the fields. Calibrate needs UI that keeps
  state of its own (the two marked points, the text of the real distance) and
  re-renders itself, which is what the field kinds are not for; `info` and
  `shown` were the precedents. `spec.placeAtOnly` came with it: a
  calibration's clicks are the user's two marks, so they stay out of the Plane
  field instead of replacing the plane they are measured on.
- **A plain click on the plane moves the picture** (as a hole's click places
  the hole, ADR-0049), because `placeAt` is the hook the calibration clicks
  need anyway; a click during a calibration marks a point instead.
- **The texture is disposed when the last canvas using it goes**, not when a
  canvas is hidden (ADR-0024's rule about OCCT objects, as far as it reaches
  the GPU); the pixel size stays while the project is open, so `data-canvases`
  keeps the same height. Both are dropped when another project opens.
- **The browser's "Canvases" folder appears while there is one**, like the
  Analysis folder (ADR-0045) and unlike Sketches, Construction and Bodies,
  which draw an empty state. A folder that is always there puts a row in the
  browser of every design, and the browser floats over the view's left edge
  (ADR-0007's amendment), so it would change the app's checked-in screenshots
  for designs that have no canvas at all.
- **The numbers' limits are the kernel's.** A width of nothing and an opacity
  outside 0.05…1 are errors there, worded for the user ("A canvas needs a
  width. Set one, or pick a wider image."), and reach the dialog through the
  live preview like every other feature's error; the dialog's own check only
  refuses a canvas with no picture, because `spec.validate` is given a
  `DialogContext` and cannot read a field's value.

**Left out, as Deferred says.** Perspective correction and more than one
calibration distance; replacing a stored picture.

## Results: mesh booleans (slice 4, 2026-10-05)

What the slice delivers: the boolean dispatch in `Kernel.boolean` (a B-rep
operand meshed at `MESH_BOOLEAN_DEFLECTION` and the result a mesh body, with no
history), `Kernel.minGap`, `Kernel.splitByPlane` and `Kernel.scale`'s mesh
branch, `features/mesh-bodies.ts` (the three naming and warning rules), mesh
branches in `splitSolids`, `touchingBodies`, Combine, Move, Mirror, Scale,
Split Body, patterns, Hole's reach test and `planeOf`/`planeFrame`'s refusals,
`packages/kernel/src/mesh-boolean.test.ts` and the four new e2e tests in
`e2e/import-mesh.spec.ts`. **No facade change.**

**Measured** (`BENCH=1 pnpm vitest run packages/kernel/src/mesh-boolean-bench`,
4-core Ubuntu machine, Node 24; the same 204,800-triangle 10.2 MB sphere STL as
slice 3, cut by a Ø10 mm B-rep cylinder through its middle):

| B-rep deflection | time | volume | against the exact 30 418.34 mm³ | result |
|---|---|---|---|---|
| **0.01 mm / 0.1 rad** (`MESH_BOOLEAN_DEFLECTION`) | **193 ms** | 30 418 mm³ | **−0.001 %** | closed, 198 464 triangles |
| 0.001 mm / 0.02 rad | 203 ms | 30 417 mm³ | −0.004 % | closed, 200 480 triangles |
| 0.5 mm / 0.5 rad | 184 ms | 30 446 mm³ | +0.09 % | closed, 198 160 triangles |

So the deflection is **not** where a mesh boolean loses accuracy: the sphere
alone is 33 508 mm³ against its own 33 510 (−0.007 %, its own tessellation), and
the bore's inscribed polygon removes slightly less than the exact cylinder, so
the two errors very nearly cancel. Coarsening the tool 50× costs 0.09 % of
volume and saves 9 ms; the triangle count of the *result* barely moves (198k to
200k), because the sphere's own 200,000 triangles dominate whatever the tool is
cut with. 0.01 mm / 0.1 rad is therefore the right default: the fine end of what
the view draws at, and cheap.

An everyday cut — the imported 20 mm cube of `fixtures/imports/cube.stl` less a
Ø6 mm circle extruded through it — comes out at **7434.75 mm³** against the exact
7434.05 (the circle's own inscribed polygon takes off a little less), and the
e2e exports it as a closed 3MF. A hole pattern of three Ø2 mm holes through the
same cube lands within 0.1 % of 7811.5 mm³. `e2e/import-mesh.spec.ts` takes
20.7 s for its nine tests (1.7 s to 6.8 s each; a cut, a join, a move and a
split each take a mesh boolean), and 27/27 with `--repeat-each=3`.

**Where the design moved, and why.**

- **`touchingBodies` asks manifold a shorter question than OCCT.** §4 said
  `Manifold.minGap(other, 1e-3) <= 1e-6`, and that is what `bodiesTouch` does
  (`MESH_TOUCH` = 1e-6 mm, a nanometre, with the search length it caps the
  answer at). A B-rep pair keeps `TOUCH` = 1e-4 mm, so a mesh body 1e-5 mm away
  from a tool is *not* a target where two solids would be: `minGap` is exact
  where it is measured, and a cut that meets the body exactly — which is the
  case a mesh cut is in, since the tool is the same shape — is well inside a
  nanometre. The alternative (1e-4 mm for meshes too) would call a cut a miss
  when it removes 0.1 mm³ out of a 1 m body, and then report "The cut doesn't
  remove anything", which is worse than not trying.
- **A body a boolean made is named `mesh:<feature>`; one a transform made keeps
  the name the transform gave it.** A boolean's mesh result has no history, so
  `propagateNames` would call its single face `<op>:<feature>:new` and two mesh
  bodies made by one feature would answer to one name; `nameMeshBodies` (at the
  end of each evaluator) renames those and numbers them `mesh:F1`, `mesh:F1#2`,
  … over the bodies that feature touched, the same rule slice 3 uses for an
  import's pieces. A transform's names say more and are left alone: a move keeps
  the name the body had and a copy has ADR-0044's or ADR-0047's copy rule
  (`pattern:P1:2:from:(mesh:Import1)`, which also says which instance a body
  is). `:new` is how the pass tells a name of its own making from one somebody
  chose.
- **A move keeps a mesh body's face name; a copy gets the copy rule.** §4 said
  transforms work; it left naming to ADR-0044, and a move *must* keep the name
  (a fillet or a reference to that face still has to resolve, ADR-0005), while a
  copy must not share it: `move:M1:from:(mesh:Import1)`, a pattern's instance
  `pattern:P1:1:from:(mesh:Import1)`. `transformedNames` is that rule for every
  transform, and a solid's names still come from the transform's history.
- **Split Body keeps a mesh's two halves as two bodies.** §4 suggested
  `Manifold.splitByPlane`, and that is what the feature does, but the two sides
  cannot be joined back into one shape first (fuse is boolean): the union of a
  body's halves *is* the body, so `splitSolids` had nothing to take apart. The
  feature therefore writes both halves out itself, the larger keeping the body's
  ID (ADR-0030's rule, which `splitSolids` gives the largest piece), and the cut
  face is part of the one face each half has — there is no B-rep face for the
  plane's cut to name (`split:<id>:cut:above|below` stays a solid's names).
- **A hole on a mesh face, a Place on Bed and a Rib refuse in their own words.**
  A mesh body's one face *is* pickable (that is how a face reference resolves),
  and it is "all its triangles", so the shared plane readers (`planeOf`,
  primitives' `planeFrame`) and Place on Bed now say "The hole needs a solid
  body: this body is a mesh (imported, or combined with a mesh)." instead of the
  misleading "… isn't flat". Rib refuses up front for the same reason it refused
  its slab: it cuts **every** body out of its slab.
- **The warning is one line per feature, whatever it touched.** It is raised
  where a body that was a solid is a mesh after a boolean (`warnIfBecameMesh`, in
  `operate`, Combine and a pattern's join) and the engine collects a feature's
  warnings into one status, dropping the repeats.

**Left out, as §4 and Deferred say.** B-splines' exact rational conics, faces of
a mesh as references (a planar region of a mesh is still not a pickable face),
mesh repair, and STEP export of a mesh body.

**With P4-12's hardening (ADR-0067), merged 2026-10-05.** Three places where
main had changed the same code, all of which had to hold:

- `mergeTools` (ADR-0067 §H2) treats two overlapping tools as interfering when
  either is **heavy** (over `HEAVY_TOOL_FACES` = 200 faces), without asking
  OCCT for the distance between them. That test runs *before* the mesh-aware
  one, so a heavy B-rep pair never asks for a distance at all (277 s between the
  tools of two long threads) while a pair with a mesh in it still goes to
  manifold's `minGap`: `bodiesTouch` is the one question both rules share.
- `Kernel.stats` now reads the facade's heap through `Kernel.heap()`
  (ADR-0067 §H4) and still counts a leaked mesh as a leaked shape.
- **A kernel worker that ADR-0067 §H4 recycles** (its heap top over 1 GiB, with
  no dialog open) gets manifold-3d loaded again and every file re-sent: the
  recycle goes through `KernelClient.restart()`, whose `onRestart` is the
  `#resend` that clears the resource list (`#meshesEnabled` and the fonts and
  files together), so the next recompute loads the module and re-sends the bytes
  before it. `recomputer-recycle.test.ts` covers it with a fake kernel, and fails
  without the reset.

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
