# ADR-0034: STL, 3MF and STEP export

- **Status:** Accepted, 2026-09-28
- **Task:** P2-12 (STL, 3MF and STEP export; FR-IO-02, FR-IO-03,
  FR-IO-04). Code: the facade's export section
  (`packages/kernel/occt/facade/extrudo_facade.cpp`: `exportMesh`,
  `writeStep`, `readStep`, `weldedMesh`), `Kernel.exportMesh`,
  `Kernel.writeStep`, `Kernel.readStep`, `stepString`
  (`packages/kernel/src/kernel.ts`), `KernelApi.exportMeshes` /
  `exportStep` (`service.ts`, `worker-api.ts`, `browser.ts`,
  `Recomputer`), `RecomputeEngine.latestBody`; `@extrudo/io`'s
  `mesh.ts` (`TriangleMesh`, `checkManifold`), `stl.ts` (`writeStl`,
  `readStl`) and `threemf.ts` (`write3mf`, `read3mf`); the app's
  `apps/web/src/export/` (`modelExport.ts`, `ExportModelDialog.tsx`),
  opened from the 3D Print tab's Export (`export` in `shell/tools.ts`),
  the File menu ("Export 3MF, STL or STEP…") and a body's menu in the
  browser ("Export…").
- **Builds on:** ADR-0001 (the facade owns OCCT memory), ADR-0009
  (platform file download), ADR-0022 (format writers in MIT `packages/io`,
  the export dialog pattern), ADR-0024 (the recompute engine's cache),
  ADR-0030 (body names and colours).
- **Affects:** benchmark B2 (STL/3MF export), P4-06 / FR-IO-05 and
  FR-IO-06 (STEP, STL and 3MF import can start from `readStep`, `readStl`
  and `read3mf`), P4-08 (slicer hand-off sends these files), P5 CLI
  export.

## Context

FR-IO-02 asks for binary STL of one body, selected bodies or all, with
coarse/medium/fine presets and a custom deflection, watertight and
manifold. FR-IO-03 asks for 3MF with several objects, units, colours and
names that open cleanly in Bambu Studio, OrcaSlicer and PrusaSlicer.
FR-IO-04 asks for STEP (AP214 or AP242). The roadmap adds an automated
manifold check on exported STL.

The display mesh (ADR-0024: `Kernel.mesh`, 0.05 mm / 0.3 rad) doesn't
fit: its nodes are per face (each face has its own copy of the nodes
along its edges, for flat shading and per-face picking), so its triangles
don't form a closed surface, and its deflection is the display's. The UI
thread never calls OCCT; shapes live in the worker's cache.

## Decision

1. **Export meshes come from the kernel, welded through the topology.**
   The facade's `exportMesh(shape, linear, angular)` copies the shape's
   topology (`BRepBuilderAPI_Copy`, geometry shared, no triangulation), so
   the display triangulation stays as it is (`BRepMesh_IncrementalMesh`
   would otherwise keep a finer or coarser one it finds), meshes the copy
   at the absolute deflection, and welds it (`weldedMesh`): each face
   edge's `Poly_PolygonOnTriangulation` names the face nodes along it;
   the first face that meets an edge makes the edge's nodes (its ends are
   the edge's vertex nodes), later faces reuse them. Seams (a cylinder's
   edge used twice by one face) take both polygons onto the same nodes;
   a degenerate edge (a sphere's pole, a cone's apex) is all its vertex's
   node, and the triangles that collapse there are dropped. BRepMesh
   discretises each edge once for all its faces, so polygons match node
   for node; their direction along the edge is checked by position, not
   assumed. Positions come back as doubles, triangles counter-clockwise
   from outside (reversed faces flipped, as for the display mesh).
2. **`checkManifold` in `@extrudo/io`**, pure: every edge used by exactly
   two triangles running along it in opposite directions (closed and
   consistently oriented), no triangle repeating a node, finite
   coordinates, positive enclosed volume (facing outwards). It reports
   boundary, non-manifold and misoriented edges, bad triangles and the
   volume. Kernel tests run it on every kind of solid the features make
   (boxes, cylinders, a box with a through hole, a filleted part, a
   revolved sphere with poles, a cone with an apex, a torus, a partial
   revolve of a holed profile, a tapered extrude with a hole, a fused
   box and post), check the Euler characteristic (2 − 2 × genus), the
   volume against OCCT's within area × deflection, and that the STL's
   float32 corners weld back to the same mesh. The e2e test runs it on
   the downloaded STL and 3MF. The dialog runs it before saving and says
   which bodies aren't closed (it never blocks the export: a slicer
   repairs small defects, and an unexpected failure is a bug to report,
   not a reason to refuse the file).
3. **Presets:** Coarse 0.1 mm / 30°, Medium 0.02 mm / 15° (the default),
   Fine 0.005 mm / 5°; Custom takes a deviation (0.001 to 5 mm) and an
   angle (1° to 90°) in `ExpressionInput`s (parameters work). A printer
   resolves about 0.05 mm, so Medium is finer than a print shows; Coarse
   still gives 12 facets around a 2 mm hole.
4. **Binary STL** (`writeStl`): 80-byte header ("Extrudo <version>:
   <project> (mm)", never starting with "solid"), little-endian count,
   per triangle a unit normal computed from its corners, the corners as
   float32 and attribute 0. Several bodies are one list of triangles (STL
   has no objects). ASCII STL is left out (FR-IO-02 makes it optional;
   nothing asks for it). `readStl` welds corners that are equal to the
   bit, which rebuilds the topology of our own files for the check.
5. **3MF** (`write3mf`), core specification 1.3 with fflate (MIT, already
   used by `packages/storage`) as the zip: `[Content_Types].xml` (rels
   and model defaults), `_rels/.rels` (the 3D model relationship to
   `/3D/3dmodel.model`), and the model with `unit="millimeter"`,
   `xml:lang`, `Title` and `Application` metadata, one `object`
   (`type="model"`, `name`) per body and one build item per object
   without a transform (placed as modelled; every slicer drops parts to
   the bed). Coordinates have 5 decimals (10 nm), no exponents.
   **Colours** use the materials extension, not marked required (a
   consumer may ignore it): one `m:colorgroup` with a colour per body
   that has one (`BodyMeta.color`; the default appearance means "no
   colour", so the slicer's filament colour shows), the object's
   `pid`/`pindex`, and the same `pid`/`p1` on every triangle, because
   Bambu Studio and OrcaSlicer read colours per triangle only (their
   binaries know `m:colorgroup`, `m:color`, `pid`, `p1` and neither
   `pindex` nor `basematerials`). Opacity isn't exported (it's a display
   setting).
6. **STEP AP242 through the facade**, not the raw `STEPControl_Writer`
   binding (ADR-0001: the facade owns OCCT memory). `writeStep()` takes
   the shapes staged with `pushArg` and names from `pushStepName`,
   transfers each with `DESTEP_Parameters` (OCCT 8's per-transfer
   parameters: schema `AP242DIS`, unit mm), renames the first
   `StepBasic_Product` each transfer made to the body's name (OCCT
   appends the assembly level, "Bracket 1"), and writes with
   `WriteStream` into a string: no Emscripten file system. OCCT's
   message printers are removed (`quietMessages`), so the translator's
   banner doesn't reach the console. Names are STEP strings: `stepString`
   keeps printable ASCII and writes the rest (and `\`) as `\X2\…\X0\` or
   `\X4\…\X0\`; the writer doubles apostrophes. The STEP classes were
   already linked (the binding list has had `STEPControl_Writer` and
   `STEPControl_Reader` since P0-09), so the WASM grew by 20 kB
   (20,186 kB, 6,549 kB gzip). `readStep(text)` (`ReadStream`,
   `TransferRoots`, `OneShape`) reads it back for the tests and is where
   STEP import (FR-IO-05) starts.
7. **Export uses the bodies the model shows.** `KernelApi.exportMeshes`
   and `exportStep` take body IDs and export the engine's shapes of the
   last finished recompute (`RecomputeEngine.latestBody`, pinned in the
   cache), so nothing is recomputed. The dialog waits until the model
   store is `ready` for the current document; a body that has gone
   rejects with a message.
8. **The dialog** (`Export model`): the bodies as checkboxes (a body's
   menu picks that body; else the selected bodies, faces picking their
   body; else every shown body; hidden bodies are listed, unchecked),
   the format (3MF first, "for slicers"; STL; STEP), the resolution for
   mesh formats. It meshes as soon as the choice settles (120 ms) and
   shows "1 body, 620 triangles, watertight" (with the STL's size), or
   which bodies aren't closed; Export saves those same meshes. Format
   and resolution are remembered (preference `export.model`). Files are
   named after the project, plus the body when there is one ("Wall
   bracket - Bracket.3mf"), and download through `FileAccess`.

## What was verified, and how

- **Unit and e2e tests** (above): layout of the binary STL, normals,
  3MF parts, content types, relationship, units, names, colours,
  resource order, build items, the manifold check with failing controls
  (a missing triangle, a flipped one, an edge used three times, inward
  faces, unwelded corners, bad triangles and coordinates), watertight
  kernel meshes for every solid above and for P2-10's sphere, torus and
  box through `KernelService`, STEP header, schema, unit, names
  and read-back volume, and no heap growth over 1000 export meshes and
  200 STEP write/read cycles (the memory test's pattern and control).
- **PrusaSlicer 2.9.6** (installed on the dev machine, 2026-09-28):
  `prusa-slicer --info` on the app's Wall bracket STL and 3MF and a
  two-body coloured 3MF: `manifold = yes`, sizes 40 × 80 × 60 mm, both
  objects of the 3MF; `--export-3mf` of it keeps the object names
  (UTF-8 "Pin Größe" included). PrusaSlicer ignores 3MF colours.
- **OrcaSlicer 2.4.2** (installed): `orca-slicer --export-3mf` of the
  same files succeeds, keeps both object names and reports
  `mesh_stat edges_fixed="0" degenerate_facets="0" facets_removed="0"
  facets_reversed="0" backwards_edges="0"` for every part. The CLI
  doesn't apply file colours (a colour group, with or without
  per-triangle properties, left every part on filament 1): Bambu
  Studio and OrcaSlicer map file colours to filaments in a GUI dialog.
- **lib3mf 2.5.0** (pip, in a throwaway venv) in strict mode reads both
  3MF files without warnings: unit millimetre, names, colour group
  `#FF7A66FF`, `#5B7CFFFF` as the objects' properties, every object
  `IsManifoldAndOriented`.
- **FreeCAD 1.1.3** (`freecadcmd`, `Import.insert`) reads the STEP files:
  valid solids named "Bracket", "Plate" and "Pin Größe", the right sizes
  and volumes in mm.
- **Not verified:** Bambu Studio (not installed), and colours in any
  slicer's GUI. Manual check for the user: open a coloured two-body 3MF
  (and the STL and STEP) in Bambu Studio, OrcaSlicer and PrusaSlicer;
  expect two named objects on the plate at their size, no repair
  warning, and in Bambu Studio / OrcaSlicer the colours offered for the
  filaments.

## Rejected

- **Reusing the display mesh**, or welding it by position: its nodes are
  per face and its deflection is the display's; welding by position
  merges distinct nodes that happen to coincide and needs a tolerance.
  The topological weld is exact and cheap.
- **Meshing the cached shape itself**: BRepMesh keeps a triangulation it
  finds if it is fine enough, so a coarse export after a fine one would
  stay fine, and a fine export would refine the next display mesh
  (tested: the display triangle count is unchanged with the copy).
- **OCCT's `StlAPI_Writer`** (bound since P0-09): it writes per-face
  triangles without shared nodes, gives us no check and needs the file
  system; our writer is a few lines in the MIT package.
- **XDE (`STEPCAFControl_Writer`, `XCAFDoc`) for names and colours in
  STEP:** it links TKXCAF, TKLCAF, TKCAF, TKCDF and TKV3d-level
  dependencies into the WASM for colours FR-IO-04 doesn't ask for;
  renaming the products gives names at no cost. Revisit with STEP import
  (FR-IO-05), which wants names and colours read back.
- **Core `basematerials` for 3MF colours** (tried first): valid core 3MF,
  but OrcaSlicer's (and Bambu Studio's) reader only knows the materials
  extension's colour groups per triangle.
- **ASCII STL**, **3MF thumbnails** and **Bambu/Prusa project metadata**
  (`Metadata/model_settings.config`, `Slic3r_PE_model.config`): not
  needed to open cleanly; the slicers make their own.
- **Build item transforms that drop parts onto the bed:** slicers do it,
  and keeping the modelled position keeps parts where they were relative
  to each other.

## Consequences and open items

- The manual slicer check above (Bambu Studio; colours in the GUIs).
- ~~STEP carries names but no colours (XDE later, see Rejected).~~ Colours
  both ways since P4-12 (the amendment below).
- Meshing runs on the worker thread in one call; a very fine export of a
  big model blocks recomputes until it is done (no progress or cancel
  yet).
- The dialog's meshes are held while it is open (two copies at most:
  the dialog's and the file). Large Fine exports of big assemblies may
  want streaming writers later.
- `readStl`, `read3mf` and `readStep` are test-grade readers: no ASCII
  STL, no 3MF components, transforms or per-triangle properties, STEP
  text only. FR-IO-05/06 extend them.

## Amendment (2026-10-06, P4-12): STEP colours through XDE

The P4-12 backlog's "STEP colours (XDE)": a STEP file's colours become the
imported bodies' appearance, and a body's colour is written to the STEP file it
exports to. The Rejected item above ("XDE … revisit with STEP import") is
revisited here; STEP import itself is ADR-0066 §2.

### Decisions

1. **Reading.** `readStep` is unchanged (the shape). The facade's new
   `readStepColors(text)` reads the same text through XDE:
   `STEPCAFControl_Reader` (colour mode only: names, layers, properties,
   metadata, SHUOs, GD&T, materials and views off) into a **fresh
   `TDocStd_Document` per call** (format `BinXCAF`, `XCAFDoc_DocumentTool::Set`
   on its main label, never registered with an application), whose attributes
   are forgotten (`Root().ForgetAllAttributes(true)`) before the handle goes —
   an XCAF document is OCCT memory the facade owns (ADR-0001) and outlives no
   call. It returns, **per solid in the order `readStep`'s shape lists them**,
   `[r, g, b]` in 0..1 (sRGB, as STEP's `COLOUR_RGB` holds them) or
   `[-1, -1, -1]`: the solid's own sub-shape colour, else its part's
   (`XCAFDoc_ColorSurf`, then `XCAFDoc_ColorGen`), else the nearest assembly
   instance's, else none; and the number of **faces with a colour of their
   own**, which never becomes a body's colour. Read through `geometryPtr/Size`
   as `[faces, r, g, b, …]`; `Kernel.readStepColors` gives `{ solids:
   ('#rrggbb' | undefined)[], coloredFaces }`.
2. **The order.** `count`/`subShape` (and so `Kernel.solids`) list a shape's
   solids by `TopExp::MapShapes`. `readStepColors` walks the XCAF document's
   free shapes in order; an assembly's components in label order (the order
   `AddShape` made them from the compound's `TopoDS_Iterator`, which is the
   order the plain reader's compound holds them in); a part's solids by
   `TopExp::MapShapes` of its own shape. The two readers transfer the same
   roots in the same order, so the lists agree. **How that was made sure**:
   the native harness reads a file of two parts and a file with an assembly
   (one part placed twice, the second instance coloured, plus a loose solid
   with a generic colour) through both readers and matches every solid by its
   position; the kernel test reads three boxes of different volumes. The
   import feature also **drops the colours if the counts ever differ**, rather
   than put a colour on the wrong body.
3. **The import feature** calls `readStepColors` only when the text names a
   colour at all (`COLOUR_RGB` or `DRAUGHTING_PRE_DEFINED_COLOUR`), so a file
   without colours is read once, as before, and computes exactly as before. A
   body's colour follows **its solid, not its position**: `splitSolids` orders
   bodies by size, so each body's first face name (`import:<id>:face:<n>`)
   says which solid of the read shape it came from (`Kernel.locate` per solid).
   The output's `report` is an **`ImportReport`** (`kind: 'import'`,
   `colors: Record<BodyId, '#rrggbb'>`, `coloredFaces`), which the
   `Recomputer` puts in **`ModelState.imports`**; a file with colours but none
   on any solid or face has no report. The kernel stores nothing.
4. **The app applies them once**: `followBodyNames`, when it first names a body
   (the same amend into the latest undo step as the name, ADR-0030), takes the
   report's colour as the body's `color` and leaves `opacity`. A body with
   stored metadata — named, recoloured, or simply shown before — keeps what the
   document says (`nameBodies` never overwrites), so a recompute, a re-import or
   an Up change never repaints. No schema or file-format change: the colour
   lands in `BodyMeta.color` as Appearance's does. Mesh and `.scad` imports are
   untouched.
5. **Writing.** `writeStep` gets a colour per staged part (`clearStepColors()`,
   `stageStepColor(r, g, b)`, -1 for none, beside `pushStepName`). **Only when
   some part has a colour** it writes through `STEPCAFControl_Writer`: each
   part is a free shape of a per-call XCAF document (length unit mm), its
   colour `XCAFDoc_ColorSurf` on its label, and it is transferred **one label
   at a time** with the same `DESTEP_Parameters` (AP242, mm), so the same scan
   renames the transfer's first product to the body's name as on the plain
   path; XDE's name mode is off, so ADR-0034's `\X2\` encoding of non-ASCII
   names is unchanged. With no colour, `STEPControl_Writer` writes exactly what
   it wrote before (the B3 fixture's data section is compared byte for byte in
   `import-fixture.test.ts`; `WRITE_FIXTURES=1` changed only the header's time
   stamp, so `fixtures/imports/b3.step` was **not** rewritten).
   `KernelApi.exportStep` takes `{ id, name, color? }` (`StepBody`,
   `stepBody(ExportBody)`); the app's `stepFile` and the headless CLI pass
   `meta.color`. The CLI's bodies now carry the document's colour into its 3MF
   export too, which it didn't before (`exportBody` gave only the name).

### Results

- **Native harness** (`spikes/p4-12-step-colours/`, `run.sh`): an XDE file
  with one solid red and two faces of another blue reads `red, none` with 2
  coloured faces; the assembly file reads `none` for the first placement,
  green for the second and yellow (a generic colour) for the loose solid, each
  matched to `readStep`'s solid at the same place; our coloured export of
  three boxes (one uncoloured, one named `G\X2\00E4\X0\mma`) keeps every
  product name and mm and reads back within 1/255; a plain export is the same
  bytes before and after a coloured one; text that isn't STEP gives no solids.
  **Heap** (`run.sh leaks 500`: every round writes a coloured file and reads
  the colours of two files): top 8,912,896 bytes after 520 rounds and after
  2,520, **no growth**. Without `ForgetAllAttributes` it was flat too; it stays
  as cheap insurance.
- **WASM** (`occt-3e0fd2a88782`; XDE's libraries were already in the image
  and the toolchain links every one, so `libcascade.config.ts` didn't change):
  19.19 → **20.01 MB** raw (+0.83 MB), 6.25 → **6.48 MB** gzip, 4.34 →
  **4.50 MB** brotli (quality 11, Node's zlib), all of it the XCAF reader,
  writer and document code the facade now reaches.
- A coloured file is read twice (the shape, then the colours); a file without
  colours once.

### Rejected

- **One reader for shape and colours** (the XDE document's shape as the body):
  it would change `readStep`, which names every face by the plain reader's
  order (ADR-0066 §2), and keep an XCAF document alive with the shape.
- **Matching colours to bodies by geometry** (centres or volumes): the face
  names already say which solid a body came from, exactly.
- **A face's colour as the body's** (a majority, say): a body has one colour in
  Extrudo, and a part painted on one face is not a red part; the count is
  reported instead.
- **Repainting on every recompute** from the report: it would undo the user's
  own colour after any change to the import.
