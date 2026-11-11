# ADR-0143: Drawings: 2D sheets made from the model

- **Status:** Accepted, 2026-11-10 (the owner: the 14 decisions of the plan's §12, all as
  proposed). S1a (modes) and S0 (spikes) are done, and S1's document and its layout and
  output (no UI yet), see the amendments at the end. Each slice lands with an amendment here.
- **Task:** P6-24 (`docs/03-roadmap.md`); FR-DR-01 to FR-DR-08.
- **Specification and mock-ups:** `docs/plans/drawings-2026-11-10.md` and the five
  `docs/plans/drawings-mock-*.html` pages beside it. This ADR records what was decided and
  what was rejected; the plan holds the detail (tools, flows, messages, the type sketch,
  code pointers).
- **Builds on:** ADR-0001 (the facade), ADR-0003 (commands, undo), ADR-0005 (topological
  naming, `GeomRef`, fingerprints), ADR-0126 (annotations: the model for a document-level
  list whose items are anchored to geometry), ADR-0105 and ADR-0111 (reporting and
  cancelling a kernel wait).
- **Schema change (with S1):** one new optional top-level key, `sheets`. No `formatVersion`
  bump: an older reader drops the key and reports it.
- **Requirements change:** "2D engineering drawings" leaves *Out of scope*
  (`docs/01-requirements.md` §4); §5.11 adds FR-DR.

## Context

A design ends today at a file for a printer or another CAD tool. A person who builds
something from several parts (furniture, a frame, an assembly) also needs paper: views of
chosen bodies with dimensions, a parts list, a few notes. The owner asked for this on
2026-11-10 with six printed sheets as the reference: orthographic and shaded views, linear
dimensions (horizontal, vertical, along a slope), centre lines, balloons with a parts list
that includes board sizes, a title block, A3 and A4 in both orientations, handwritten
corrections and a paper sticky note.

What the code had on that day:

- "2D engineering drawings" stood under *Out of scope* in the requirements.
- The shell knows two modes, the literal `'model' | 'sketch'`, in `SessionState` and in
  about 15 other signatures; `AppShell.tsx` branches on it in roughly 60 places.
- The facade runs hidden-line removal (`edgeVisibility`) but returns one set of flags per
  edge, not the visible and hidden spans. No worker call returns a 2D view of a body.
- `@extrudo/io` writes SVG and DXF from a neutral 2D model without text or line weights.
  There is no PDF code and no PDF library.
- The word "drawing" is taken: Import Drawing (SVG/DXF into a sketch), io's `Drawing` type,
  and a local `drawing` flag in `AppShell.tsx`.

## Decision

### 1. Scope and first release

Drawings are in scope, as task P6-24 in Phase 6. The first release is slices S1 to S5
(sheets, views, dimensions, notes, parts list); S6 (API, CLI, MCP, guide) follows.

A drawing here is **a set of sheets that show the model and stay right when it changes**.
It is not a claim of conformance to a drawing standard, and it has no GD&T, weld or
surface symbols, and no 2D drafting without a model.

### 2. Words

In the interface the feature is **Drawing** (the mode, the tab, "New drawing", "Finish
Drawing") and a page is a **sheet**. In code the noun is always `sheet` (`doc.sheets`,
`SheetSchema`, mode `'sheet'`, `apps/web/src/sheets/`, the package `@extrudo/sheets`), so
no identifier meets io's `Drawing` or the shell's `drawing` flag. **Import Drawing is
renamed Import SVG/DXF** (with S1).

### 3. The shell: a mode, like a sketch

Entering the mode swaps the tabs for `HOME` + `DRAWING`, the 3D view for the sheet, the
timeline for sheet tabs, and the browser's tree for the sheets' tree; **Finish Drawing**
returns to the model. Ways in: a **Drawing** tile in Make › Output, a **Drawings** folder
in the browser, the command search. The sheet is drawn as SVG and needs no WebGL. The
plan's §3 and §4 have each region, tool and flow.

Before the mode, **one preparation change with no behaviour change (S1a)**: an exported
`EditMode` type and a small table per mode (tabs, default tab, keymap mode, marking slots,
finish tool), so the third mode is an addition and not sixty more branches.

Views show **the bodies at the timeline marker**, as export and Measure do.

### 4. The document

- One flat, ordered list per design: `doc.sheets`. A sheet has a size, an orientation, a
  default scale, a projection angle, decimals, an optional border and title block, its
  **views** and its **items** (dimension, centre mark, centre line, text, leader note,
  balloon, sticky note, parts list, table). The type sketch is in the plan's §5.1; S1 fixes
  the schema and amends this section.
- **Nothing derived is stored**: no projected lines, no measured values, no cache. Opening
  a file recomputes its views.
- An item is tied to the model by an **anchor**: a `GeomRef` with a fingerprint, never an
  `index:` ref, resolved like an annotation's (`ok`, `moved`, `detached`). A lost anchor
  never fails a recompute and never refuses a delete; the item is kept and drawn as
  detached.
- Layout numbers are stored as numbers. Fields accept expressions and store the result.
- The author's name is written only when typed into the title block. Material is free
  text per row of the parts list.

### 5. Undo

Every sheet edit is one command and its own undo step. There is no open transaction while
drawing and Finish Drawing is not an undo step: sheets are not timeline features, and
parameters can change while drawing.

### 6. Geometry

A facade method beside `edgeVisibility` returns the visible parameter spans per
hidden-line edge (flat arrays, no OCCT type crosses the facade); a view evaluator in
`packages/kernel/src/sheets/` turns them into exact 2D curves that carry their edge's
topological name; a worker call returns them for the bodies at the marker, cached per
bodies and direction, cancellable. Scale and position are applied on the UI side. **S0
measures this on the benchmark models before S2 commits to it** and compares it with
`HLRBRep_HLRToShape`.

**Dimensions are measured, never driving.** They anchor to edges, vertices and the
outlines of cylinders and cones in the first release.

### 7. Output

One **display list** per sheet (paths, text runs, pictures, in sheet millimetres) drives
the screen, the PDF and the SVG, so what is on screen is what is exported. `writePdf` is
**our own small writer in `@extrudo/io`** (MIT, deflate through `fflate`, which io already
has): text as glyph outlines from the bundled Inter, plus an invisible text layer so it
can be selected and searched. Layout (dimensions, tables, title block) is a new package,
`@extrudo/sheets`, without DOM, running in Node; it goes into
`scripts/check-boundaries.mjs`.

### 8. Defaults

- Paper is white in both themes.
- First angle projection, chosen per sheet.
- A new view has hidden lines, tangent edges and centre lines on.
- The title block is "Simple" (title, drawn by, date, scale, sheet, units, version); the
  zone border is off.
- A sticky note is on screen only until its Print switch is on.

### 9. Slices

| Slice | Holds |
|---|---|
| S0 Spikes | hidden-line spans timed on B1–B10; `writePdf` with outlined text |
| S1a Modes | the `EditMode` preparation, no behaviour change |
| S1 Sheets | schema, commands, the mode, sheet setup, border, title block, text, PDF/SVG export, the Import Drawing rename |
| S2 Views | the facade spans, the evaluator, the worker call, base and projected views |
| S3 Dimensions | anchors resolved, the Dimension tool, detached and moved states |
| S4 Notes | leader notes, sticky notes, centre marks and lines, snapping |
| S5 Lists | parts list, balloons, free table, text fields |
| S6 Outside | API, emitter, CLI, MCP tools, guide page, example |

The plan's §10 has what each is done by. S0 and S1a can run side by side.

## Rejected

- **A Model / Drawing switch in the top bar.** More toolbar room, but it is the workspace
  switcher that was removed on 2026-09-27 (`04-ui-spec.md` §2), and it adds permanent
  chrome to the top bar where a mode adds none.
- **A window or route of its own.** Two shells to keep in step and a second save state to
  explain; the web app has no window management. It can come later as "pop out" on the
  desktop without changing the document.
- **Several named drawings per design, each with sheets.** One more level to name and to
  navigate; a flat list covers the reference.
- **Paper that follows the theme.** The sheet would not look like its PDF.
- **A PDF library.** A new dependency of several hundred kB for features we would not
  use; io already writes SVG and DXF with writers of its own.
- **One collapsed undo step per drawing session, as a sketch.** A sketch is one timeline
  feature; sheets are not, and a parameter edit made while drawing would be caught in it.
- **Dimensions that drive the model.** Not asked for. A length measured on a sheet is
  often not one stored value (a distance between two features), so editing stays in the
  model. "Double-click a dimension to edit the parameter behind it" would be a decision of
  its own.
- **Storing projected lines or a cache in the file.** The document is the source of
  truth and geometry is derived.
- **`BodyMeta.material` now.** A schema addition with uses beyond the parts list; free
  text per row is enough for the first release and does not close that door.
- **Third angle, printed sticky notes and hidden lines off as defaults.** Each stays a
  setting.

## Amendment (S0), 2026-11-10: what HLR costs, the spans method, our PDF writer

The spikes' numbers, drawings and readers are in the plan's §13.

- **HLR cost does not follow size.** OCCT's exact hidden-line removal (`Update` + `Hide`)
  takes 7–362 ms for six axis views of B2–B6, B8, B10 and a 209-face assembly (249 ms), but
  13.5 s on B7 (3.3–3.5 s per side view of the knurl), 5.1 s on B9 (3.8 s along the
  thread's axis) and 1.7 s on P4-01; isometric views of the same bodies take 1–250 ms. The
  heap top did not move. A view is one call that can't be interrupted.
- **The facade method is our own walk of HLR's data** (`hlrSpans`, built): per entry the
  model edge (split pieces mapped back through the outliner's `NewSOldS`), its kind (sharp,
  smooth, seam, outline), an outline's face, the edge's parameter range, and the visible and
  hidden spans in the edge's own 3D parameter; outlines HLR adds carry their curve. A smooth
  edge or seam that a face turns away at is an outline that keeps its edge. HLR's status
  intervals are used as they are: they are already 3D parameters.
- **Rejected: `HLRBRep_HLRToShape`.** Its edge building after `Hide` takes under a
  millisecond, so it is no faster, and its compounds carry no link to the model edges or
  faces, so dimension anchors would need geometric matching to get a name back.
- **Rejected: Helvetica with its advance widths** for the selectable text layer (the
  owner, 2026-11-11: Courier stays): better per-letter selection boxes, but the widths are
  Adobe's AFM data, third-party data that would need a `NOTICE` entry, for a small gain.
  Courier, monospaced, needs no table.
- **`hlrPolySpans` (`HLRBRep_PolyAlgo` on the faces' triangulation) is the quick path:**
  2.5 ms for B7's side view and 8 ms for B9's axis view, against 3.4 s and 3.8 s, with each
  piece's source edge, but chords of the mesh with small artefacts. **For S2:** a view is
  drawn from it at once and replaced by `hlrSpans` when that finishes; only the exact result
  feeds dimensions and snapping. Views compute one at a time with progress, cancel acts
  between views, and the per-direction cache (§6.2.3) is required.
- **`writePdf` is in `@extrudo/io`** (`pdf.ts`): PDF 1.4, page size in mm, deflated
  streams, Béziers for arcs, a `text` item that fills the caller's glyph outlines and adds
  the string invisibly (render mode 3) in non-embedded Courier (sized by its cap height,
  600/1000 em per glyph), WinAnsi-encoded and stretched with `Tz` to the outlines' width. A two-page A3/A4 sample opens, renders and
  gives its text back (Ø, ±, ° included) in poppler, Ghostscript and Chromium's PDFium, and
  passes `qpdf --check`. Characters outside WinAnsi draw (outlines) but are `?` in the
  selectable layer; a ToUnicode map can lift that later if it matters.
- **Kept code:** the facade methods `hlrSpans` and `hlrPolySpans` and their `Kernel`
  wrappers (`hlrToShapeCount`, the probe of `HLRToShape`, was removed once timed), their
  tests (`hlr-spans.test.ts`), `pdf.ts` with its tests, the PDF sample
  (`packages/sketch/src/text/pdf-sample.test.ts`, `PDF_OUT=<file>`), and two gated tools:
  `hlr-bench.test.ts` (`HLR_BENCH=1`, `HLR_METHODS=1`) and `hlr-views.test.ts`
  (`HLR_PDF=<file>`, `HLR_POLY=1`), which draws views from the spans.
- The WASM build with the walk's last fixes (`occt-f40f666098be`) passes `hlr-spans.test.ts`,
  and views drawn from it match the polygonal ones. What S0 left unmeasured is in the plan's
  §13.4.

## Amendment (S2, kernel views), 2026-11-11

Package 1 of S2: the kernel turns a sheet view into 2D lines; no UI. Files:
`packages/core/src/sheet-frame.ts` (the frame math only), `packages/kernel/src/sheets/`
(`geometry.ts`, `evaluate.ts`, `views.ts`), `RecomputeEngine.sheetView`,
`KernelApi.sheetViews` and `cancelSheetViews`, `Recomputer.sheetViews`. No facade change.

- **The frame** (`SheetViewFrame`: `direction`, `up`, `right = direction × up`, unit and
  square). A view's own coordinates are mm at model scale, x right, y up, the world origin
  at (0, 0) (`toSheetView`); the app applies scale and position and flips y for the sheet.
  `sheetBaseFrame(direction, up)` turns `up` square to the direction.
  `sheetProjectedFrame(parent, projection, side)`: in third angle a view shows the side it
  is placed on, in first angle the opposite side; a view above or below keeps the parent's
  `right`, one left or right keeps its `up`, so the views line up. **Isometric sides are
  pictorial and the same in both angles**: `iso-above-right` looks from above, from the
  right and from the parent's viewer (the parent's direction plus the third-angle
  directions of those two neighbours: a true isometric of the parent's axes), with the
  parent's up kept as close as it can be. `sheetViewFrame(sheet, id)` walks the parents;
  `SHEET_STANDARD_VIEWS` and `sheetStandardFrom(name)` give the six standard base views
  (Z up, the front faces −Y).
- **`ViewGeometry`** (plan §6.2): curves `{ kind, body, edge?, face?, pieces }`. Kinds:
  `visible` (a sharp edge seen), `hidden` (any edge or outline behind the model; an
  outline's has `face`), `outline` (a silhouette seen), `tangent` (a smooth edge seen);
  hidden tangent edges and seams are left out. Pieces: `line`, `arc`, `ellipse` (angles
  counter-clockwise in view coordinates), exact for lines, circles and ellipses (a tilted
  circle is an ellipse arc, one seen edge-on a line) and `polyline` otherwise (64 samples
  per curve). `edge` and `face` are topological names (ADR-0005); an outline that lies on a
  seam keeps the seam's edge name too. Then `bounds`, `status` (`partial` when a body was
  skipped: `skipped` lists `{ body, reason: 'mesh' | 'missing' }`), and `exact`.
- **Every kind comes back**: the view's style and its tangent-edge switch are filters the
  app applies (`shownCurves`), so they are in no key and changing them computes nothing.
- **In the evaluator** the bodies go through hidden-line removal as one compound, so one
  body hides another; each entry maps back through `Kernel.locate` to its body and that
  body's own edge or face index, then to the name. Raw indices never leave
  `sheets/evaluate.ts`. A hidden stretch lying under a drawn line, or under a drawn arc of
  the same circle, is taken out (a box's back edges behind its front ones); pieces of one
  edge that continue each other are joined (HLR splits an edge at outline points; two
  halves of a circle seen edge-on lie on one line and join into it).
- **The quick view** (`quick: true`) is `hlrPolySpans` chained into polylines, with no
  names and `exact: false`; a quick request is given the exact result when the cache has
  it. **What it does to the display mesh**: `hlrPolySpans` meshes a face that has no
  triangulation and leaves that mesh on it, and the display mesher keeps a mesh at least as
  fine as it asks for. Measured on a box with a round boss at the display tessellation
  (0.05 mm, 0.3 rad): 204 triangles; after a polygonal run at 0.005 mm first, 462; at
  0.05 mm and 0.5 rad first, 156 (coarser than asked); display mesh first and the
  polygonal run after it, 204. So the engine gives a body it has not meshed for display
  (`#meshed`; after a kernel restart the app already holds every mesh and `have` skips
  them) its display mesh, at the last recompute's tessellation, before a quick view.
- **The cache** is in the engine: up to 64 views, keyed by the drawn bodies' versions, the
  skipped bodies, the frame's direction and up, and exact or quick; plain data, no shapes
  held; emptied with the engine. Scale, position and style are not in the key.
- **`sheetViews(requests, onView?)`** computes one view at a time in the order asked,
  each one synchronous engine run, and yields between views: `onView(result, done,
  total)` hears each result; a `false` from it, or `cancelSheetViews()`, stops the run
  before the next view with `SheetViewsCancelledError`. A recompute may run between two
  views, and the later view then draws the new bodies (each result carries the `versions`
  it was drawn from). A view that fails is `{ id, error }`; the others still come.
  `Recomputer.sheetViews` goes through `#wait` ("Computing the sheet views…", ADR-0105).
  A request without `bodies` draws the bodies at the marker that are shown (not hidden,
  not ghosts: `effectiveBodyDisplay`).
- **Times** on the Arch ARM VM, under load from other work, per view (front, right, top,
  iso, first angle): exact B2 1.5–10 ms, B4 6–18 ms, B5 4–11 ms, B10 10–36 ms, B7 3.5 and
  3.7 s for front and right (the knurl side views) and 4.5 and 22 ms for top and iso;
  quick 0.3–7 ms each.
- **Tests**: `sheet-frame.test.ts` (third angle first, then first angle and the isometric
  sides), `sheets/geometry.test.ts` (the 2D math), `sheets/views.test.ts` (a box, a holed
  box and a cylinder from the standard directions in both angles, names, cache hit and
  miss, shown bodies, a mesh body, the display mesh), `sheets/service.test.ts` (order,
  progress, both cancels, a recompute between views) and `sheets/golden.test.ts` (the four
  standard views of B2, B4, B5, B7 and B10 as golden SVGs, `--update` after the path rewrites them,
  `SHEET_TIMES=1` prints times, `SHEET_QUICK=<dir>` writes the quick views beside them).
- **Rejected**: filtering by style in the kernel (the style would join the key and a
  switch would recompute); stopping a run when a newer `sheetViews` call comes (adding
  one view would stop the exact runs of the others); stopping a run on every recompute
  (every sheet edit sends one); isometric sides that follow the projection angle (in first
  angle, `iso-above-right` would look from below and the left).

## Amendment (S3, dimensions: document, anchors, layout), 2026-11-11

Package 1 of S3: dimensions without UI. Files: `packages/core/src/sheet-schema.ts`
(`SheetDimensionItemSchema`, `SheetAnchorSchema`, `dimensionProblems`), `packages/core/src/sheet-anchors.ts`
(the report types, `sheetSilhouetteSide`, `keepLastAnchors`), `remintSheets`,
`packages/kernel/src/sheets/anchors.ts`, `RecomputeEngine.resolveSheet`, `KernelApi.resolveSheet`,
`Recomputer.resolveSheet`, `packages/sheets/src/dimensions.ts`, a `state` field on io's display items.
No facade change.

- **The item** follows plan §5.1: `view`, `type` (`linear`, `radius`, `diameter`, `angle`), `direction`
  (linear only), `anchors` (one or two), `at`, `decimals`, `before`, `after`, `reference`.
  **`at` is in the view's own mm** (model size, y up), like a free anchor, so a dimension moves and
  scales with its view and needs no rewrite when the view is moved.
- **Anchors** are one of three shapes told apart by their keys: `{ ref, at? }` (a vertex; an edge whole
  or its `start`, `end`, `middle`, `centre`; a cylinder's face whole), `{ ref, silhouette: 1 | -1 }` (a
  cylinder's or cone's outline in the dimension's view; `1` is on the side of `axis × direction`, the
  face's axis with its canonical sign) and `{ free }`. Refs name a vertex, edge or face, **carry their
  fingerprint** (required in the schema, stricter than an annotation's) and are never `index:` refs.
- **What fits a type** (`dimensionProblems`, applied by `sheetProblems`): linear takes one whole edge or
  outline or two points or lines; radius one circle; diameter one circle or two outlines; angle two
  lines. Whether a whole edge is a line or a circle is the model's to say at resolve time.
- **`resolveSheet(sheet)`** resolves every anchor against all bodies at the marker as the annotation
  pass does (`#references`; rolled back → `detached`; on a deleted or suppressed feature → `detached`,
  below; exact name `ok`; related name or fingerprint `moved`; nothing → `detached`) and returns, per dimension and anchor, `{ status, geometry?, resolved?,
  message? }`. Geometry: a `point`; a `line`'s ends; a `circle`'s centre, axis, x direction and radius (a
  cylinder face's centre on the axis, level with the face's middle); a `curve`'s ends; a `silhouette`
  (the named side's line from `faceSilhouettes`, the longest piece, and the opposite one). Plain data
  only, no shape made. Anything that throws leaves that anchor `detached`. Evaluates nothing, cached
  nowhere.
- **Measuring** (`@extrudo/sheets`, so app and CLI agree): **linear and angle in the view's plane at
  model size, radius and diameter on the circle itself**. A whole circular edge in a linear dimension
  stands for its centre; point to line is square to the line; two lines must be parallel (else
  `invalid`); an unset direction is horizontal when the text is above or below the two points, vertical
  beside them, else aligned. Text: the item's decimals or the sheet's, the design's unit without the
  unit, `R`/`Ø` prefixes, `°`, `before`/`after`, brackets for a reference.
- **Layout**: lines 0.18 mm, filled 3 × 1 mm arrowheads (outside on stubs when there is no room), 1 mm
  gap and 2 mm overshoot on extension lines, 3.5 mm text above the line along it (reading from below or
  the right); radius and diameter on a leader with a shelf; angles as an arc with level text outside
  it. Items are keyed `item:<id>` and carry `state` (`moved`, `detached`, `invalid`) when not `ok`; the
  writers ignore it, so the export never gets a screen colour.
- **Following the model**: the text's place is `at` plus the mean move of the ref anchors' fingerprint
  points (stored → now) in the view, as an annotation's point follows its geometry.
- **Lost anchors, as proposed**: nothing derived is stored. A `detached` dimension draws from the
  geometry the caller kept in memory (`keepLastAnchors(previous, next)`), still marked detached; with
  none (a file just opened) it is its text alone at `at`, `?` for the value, no extension lines.
- **Tests**: `sheet-schema.test.ts` and `sheets.test.ts` (shapes, rules, commands, remint);
  `kernel/src/sheets/anchors.test.ts` (a box, a cylinder, B2 following `height`, a drain hole deleted,
  rolled back and back again; the pocket deleted, suppressed and made a through cut, below); `sheets/src/dimensions.test.ts` (values,
  positions, text, states, a golden SVG); `sheets/src/dimensions.kernel.test.ts` (every type measured to
  known sizes on a part the kernel builds; `SHEETS_OUT=<dir>` writes a sample PDF, checked with
  `pdftoppm`).
- **Found:** the naming service's fingerprint fallback re-finds a close edge after its feature is
  deleted: deleting B2's pocket made a dimension on the pocket floor's edge `moved` onto the box's
  bottom edge (74 → 80), not `detached`. Annotations and features behave the same and keep doing so;
  for sheet anchors the owner chose to detach instead (next point).
- **Deleted and suppressed features (the owner, 2026-11-11)**: before an anchor is looked for by a
  related name or its fingerprint, the features its persistent name names are read from the name's
  grammar (`featuresOfName` in `kernel/src/naming/topo-id.ts`: each created face's `feature`, nested
  sources too; a script's generated feature counts as the script). If one is no longer in the
  document, the anchor is `detached` with "The feature this was measured on is deleted."; if one is
  suppressed, `detached` with "<name>, the feature this was measured on, is suppressed. Unsuppress it to
  show the dimension again." (deleted outranks suppressed; `lostFeature` in `kernel/src/sheets/anchors.ts`).
  **Package 2 carried it one step further:** a named feature still in the document and active whose status
  was an error in the last recompute detaches the anchor too, with "<name>, the feature this was measured
  on, has an error. Fix it to show the dimension again." (after deleted and suppressed). The statuses are
  the recompute's own: the engine keeps the failed feature IDs with the marker's state (`AtMarker.failed`)
  and passes them to `lostFeature`. Found on B2: the pocket made to cut upwards has nothing to cut and
  fails; its floor edge's dimension was `moved` by fingerprint onto the box's bottom edge (80 for 74).
  No fingerprint search runs then. Why: the closest match on a drawing is another edge, and its number
  is wrong without looking wrong (B2: 80 for 74); a missing number is safer than a wrong one. A
  suppressed feature makes nothing while suppressed, so the same wrong match can happen. Rolled back
  past the marker stays `detached` with no message, checked first. With every named feature there and
  active nothing changes: exact name `ok`, related name or fingerprint `moved`, even when the
  fingerprint finds another edge (B2 with `bottom` 0, the pocket a through cut: the floor edge's
  dimension is `moved` onto the pocket's bottom edge at z = 0, still 74). `keepLastAnchors` keeps the
  detached report's `message`. Annotations are unchanged: their pass still takes the closest match.
- **Rejected**: `at` in sheet mm (moving a view would leave its dimensions behind); storing the last
  measured value or position for a detached dimension (derived data in the document); resolving only
  among the view's bodies (projected views would need the app's body rules in the kernel; annotations
  resolve among all bodies); screen colours or dashes in the display list for a detached dimension.

## Amendment (S4, notes: document, anchors, layout), 2026-11-11

Package 1 of S4: leader notes, sticky notes, centre marks and centre lines without UI (no
tools, no snapping rows). Files: `packages/core/src/sheet-schema.ts` (four item schemas,
`SHEET_STICKY_COLORS`, `sheetItemAnchors`, `mapSheetItemAnchors`, `sheetItemProblems`),
`remintSheets`, the `axis` geometry in `core/src/sheet-anchors.ts`,
`packages/kernel/src/sheets/anchors.ts` (`faceAs`, `lostFeature`'s words per kind),
`RecomputeEngine.resolveSheet`, and in `@extrudo/sheets` the new `anchored.ts` (what every
anchored item shares, moved out of `dimensions.ts` unchanged) and `notes.ts`. No facade
change.

- **The items** follow plan §5.1. `leader`: `view`, one `anchor`, `at`, `text` (not blank,
  newlines kept). `sticky`: `at`, `size` (5 to 1000 mm a side), `text` (not blank),
  `color` (`yellow`, `orange`, `pink`, `blue`, `green`; absent: yellow), `print` (only as
  `true`). `centreMark` and `centreLine`: `view`, `anchors` (one or two in the schema; the
  rule decides). Frames as S3 settled them: a leader's `at` and every anchor are in the
  view's own mm; a sticky note belongs to the sheet and has sheet mm.
- **What fits a kind** (`sheetItemProblems`, applied by `sheetProblems` with the dimension's
  rule): a leader takes any one anchor; a centre mark one whole edge (a circle, told when it
  resolves) or a cylinder's face; a centre line two whole edges or outlines (parallel in the
  view, told at layout) or one cylinder's or cone's face. Every item with a `view` must name
  a view of its own sheet; `removeSheetView` already removes them by `view`.
- **One place says which items have anchors**: `sheetItemAnchors(item)` (a leader's anchor
  as a list of one). The kernel resolves those, `remintSheets` rewrites them through
  `mapSheetItemAnchors`, and layout reads their reports by that index; a new anchored kind is
  added there and nowhere else.
- **Resolving** is the S3 pass for every anchored item, the deleted and suppressed rule
  included, with the message in the item's words ("The feature this was drawn on is
  deleted.", "Unsuppress it to show the note / centre mark / centre line again."; a
  dimension's words are unchanged). **A whole face stands for what the item takes of it**
  (`faceAs`): a circle for a dimension and a centre mark (a cylinder's), the **axis** for a
  centre line (a cylinder's or cone's: the stretch of the axis between the lowest and highest
  points of the face's edges along it, `{ type: 'axis', start, end }`, world mm), and a
  point for a leader (the face's centroid, where its dot goes).
- **Layout** (`notes.ts`; lines 0.18 mm, text 3.5 mm, keys `item:<id>`, `state` as a
  dimension's): a **leader** is a filled 3 × 1 mm arrowhead on the anchor (a 0.75 mm dot on
  a face), the line to `at`, a 3 mm level shoulder away from the arrow and the text 1 mm past
  it, its first line's capitals centred on the shoulder, further lines below (left of the
  arrow the lines end there). On a whole edge the arrow lands on the edge's nearest point to
  the text, on a circle on its rim towards the text. `at` follows the anchor as a
  dimension's text does. A detached leader draws from kept geometry, else it is its text
  alone at `at`, marked. A **centre mark** is a level and an upright line through the
  centre, each a 1.5 mm cross arm, a 1 mm gap and a long dash out to 3 mm past the circle
  (on an ellipse, past its reach each way; one plain line on a small circle); a circle seen
  edge-on is `invalid`. A **centre line** runs midway between its two lines, or along the
  axis, from the first end to the last plus 3 mm each way, **dash-dot built as segments**
  (long dashes near 8 mm stretched so both ends are long, 1.5 mm gaps, 1 mm dots), not a dash
  pattern, so it never starts or ends on a gap; lines not parallel, or an axis seen end-on,
  are `invalid`. A centre mark or line that is lost with no geometry kept, or invalid, draws
  nothing: the browser row says why (`sheetItemStatus`). **A sticky note** is a filled note
  with 1.5 mm rounded corners in its colour (`SHEET_STICKY`: a paper and an ink colour each),
  its text wrapped inside a 3 mm padding (lines past the bottom left out, the last shown one
  ending in "…").
- **Screen or export**: `layoutSheet`'s context takes `output` (`screen` by default for
  `layoutSheet`, `export` by default for `sheetsToPdf` and `sheetToSvg`). On screen every
  sticky note is drawn and one without `print` carries "On screen only" in its ink colour;
  for an export it is left out. `sheetStickiesLeftOut(sheets)` counts those for the export
  dialog's summary. A view's `centreLines: false` leaves out its centre marks and centre
  lines (`sheetItemShown`).
- **Nothing is generated**: this package makes no centre mark or centre line for a view by
  itself; each one is an item someone placed. Automatic centre marks on a view's holes would
  be a later decision.
- **For the tools**: `layoutSheetLeader`, `layoutSheetCentre`, `layoutSheetSticky`,
  `sheetItemStatus` (any item's state and message), `sheetItemShown`,
  `sheetStickiesLeftOut`, `SHEET_NOTE`, `SHEET_STICKY`, `SHEET_STICKY_SCREEN_ONLY`, and
  `SheetItemState` (what `SheetDimensionState` now aliases).
- **Tests**: `sheet-schema.test.ts` and `sheets.test.ts` (shapes, rules, remint, the view
  cascade); `kernel/src/sheets/anchors.test.ts` (a plate with a hole: each kind resolved, a
  leader following its edge, the hole deleted and suppressed, back again; a flat face has no
  axis); `sheets/src/notes.test.ts` (positions, states, export rules, a golden SVG per kind);
  `dimensions.kernel.test.ts` (the same items on the part the kernel builds, through layout;
  `SHEETS_OUT=<dir>` also writes `items.pdf` and `items-screen.pdf`, checked with
  `pdftoppm`).
- **Rejected**: a leader's tip stored as a parameter on its edge (a new anchor shape; the
  nearest point to the text follows a moved text naturally, and `at: 'middle'` pins it);
  an axis anchor of its own (`{ ref, axis: true }`: a whole face already says it, the kind
  decides what a face stands for); the dash-dot as a stroke dash pattern (the ends would
  fall anywhere); a sticky note's "On screen only" left to the screen (the screen draws the
  list as it is and derives nothing, S1's rule).

## Amendment (S5, lists: document, rows, fields, layout), 2026-11-11

Package 1 of S5: parts lists, balloons, free tables and text fields without UI (no tools,
no API, CLI or MCP tools). Files: `packages/core/src/sheet-schema.ts` (three item schemas,
`SHEET_PARTS_COLUMNS`, the rules), the new `core/src/sheet-fields.ts`, `SheetParts` and
`SheetAnchorReport.body` in `core/src/sheet-anchors.ts`, `remintSheets`, the balloon
cascade in `core/src/sheets.ts`, `rewriteReferences` in `core/src/document-commands.ts`,
`sheetListBodies` in `kernel/src/sheets/views.ts`, `RecomputeEngine.sheetParts`,
`KernelApi.sheetParts`, `Recomputer.sheetParts`, and in `@extrudo/sheets` the new `parts.ts`
and `sheetFieldValues` in `layout.ts`. No facade change: the measure is `Kernel.properties`,
Print Info's.

- **The items** follow plan §5.1. `partsList`: `view`, `at` (sheet mm, top-left),
  `columns` (from `item`, `qty`, `name`, `material`, `size`, `mass`, each once, **shown in
  the order listed**; absent: all six) and `rows`, a record from a body ID to what was typed
  over that row (`name`, `material`, free text up to 200 characters each, decision 11).
  `balloon`: `view`, one `anchor`, `at` (the circle's centre, view mm, as a leader's) and
  `list`. `table`: `at` (sheet mm), `columns` (widths, 1 to 1000 mm, 1 to 50 of them) and
  `rows` (1 to 500, cell texts that may be empty). Rules in `sheetProblems` and
  `sheetItemProblems`: an item's `view` on its sheet (as before); a balloon's `list` a
  **parts list of the same sheet**, its anchor on geometry (never `free`: it numbers a
  body); a parts list names each column once; every table row has one cell per column.
  **Deleting a parts list deletes its balloons** in the same step (`removeSheetItems`, and
  `removeSheetView` when the list belongs to the view), so the rule never refuses a delete.
  `sheetItemAnchors`/`mapSheetItemAnchors` cover the balloon; `remintSheets` also renames the
  body IDs a parts list's `rows` are keyed by.
- **Rows from the model** (nothing derived is stored). `KernelApi.sheetParts(sheet)` gives,
  per parts list, its view's bodies at the marker in order (`sheetListBodies`: the base
  view's `bodies` as listed, else every shown body **in timeline order**, the order of the
  features that made them, then the body number) and each one's volume and tight
  axis-aligned box (`Kernel.properties`, as Print Info); a body whose measure fails has none.
  `sheetPartBodies(doc, report)` adds the names and component names the document holds;
  `sheetPartsRows(list, bodies)` merges: a body joins the first earlier row whose first body
  has an **equal volume (to a millionth) and box (its three sides sorted, to 0.001 mm, so a
  quarter-turned copy merges) and either the same component name or the same name stem**
  (`sheetNameStem`: the name without a trailing number and its separator, compared without
  case). A body never measured never merges. Rows keep the order of their first bodies and
  are numbered from 1. A row's name is what was typed over it (under any of its bodies, the
  first in order), else its one body's name, else the merged bodies' shared stem
  ("Leg 1" + "Leg 2" → "Leg"), else their component's name; typing never splits a row.
  Size is the box's sides, longest first, in the design's unit at the sheet's decimals, the
  unit in the header ("SIZE (MM)"). **Mass** is one piece's, from `context.density` (g/cm³,
  the app's filament preference); without it the cells are empty. A balloon's number is the
  item of the row holding the body its anchor resolved on (`SheetAnchorReport.body`, kept
  by `keepLastAnchors`).
- **Text fields** (plan §5.3; `sheet-fields.ts`): `{name}`, `{sheet}`, `{sheets}`, `{scale}`,
  `{date}`, `{version}` and `{= expr}`. **`mapSheetFieldTexts` is the one place that says
  which texts take fields**: text items, leader notes, table cells and the title block's
  typed fields (not sticky notes, dimensions' before/after or parts list cells). Layout fills
  them before drawing (`sheetFieldValues(sheet, context)`): the design's name, page and count
  from `context.sheets`, the sheet's scale, and from the context `date`, `version` and
  `evaluate` (core's `evaluateParameters(doc).evaluate`), an expression written with its unit
  at the sheet's decimals (`formatQuantity`). A field with no value, an unknown field and an
  expression that doesn't evaluate are left as typed. `rewriteReferences` renames a parameter
  inside `{= …}` only, through the same map, in the rename's undo step. Deleting a parameter
  a field uses is not refused: the field shows as typed.
- **Layout** (`parts.ts`, keys `item:<id>`). A **parts list**: a header row filled
  `#eef1f5` with 2.2 mm capitals in the muted colour, then one 7 mm row per row, 3.5 mm
  text, 2 mm padding, grid 0.25 mm and outline 0.5 mm as the title block; **one line per
  cell, fitted**: a column is as wide as its widest text (at least 8 mm), a name or material
  at most 60 mm, a longer one shrinking to 2.5 mm and then cut with "…" (`fitLine`). With no
  bodies known yet it is its header alone. A **free table**: its stored widths, **each cell
  wrapped** inside its column (`wrapText`), a row as tall as its tallest cell (7 mm plus a
  line spacing per extra line), no header row. A **balloon**: a 0.18 mm circle of 4 mm
  radius (more for a long number) round `at`, its number centred, and a leader from the
  circle's edge to the anchor's nearest point (a leader note's rule), ending in a 3 × 1 mm
  arrowhead on an edge or a point and a 0.75 mm dot on a face. Its state follows its anchor
  as a leader's (`moved`, `detached`; lost with nothing kept, the circle alone); its number
  is `?` until the list's bodies are known, and `invalid` with "This balloon points at a
  body that isn't in its parts list." when the row isn't there. `layoutSheet` takes the rows'
  data through `context.parts` as it takes anchors.
- **For the tools**: `sheetParts` (kernel), `sheetPartBodies`, `sheetPartsRows`,
  `sheetPartsCells`, `sheetPartsHeader`, `sheetNameStem`, `sheetBalloonStatus`,
  `layoutSheetPartsList`, `layoutSheetTable`, `layoutSheetBalloon`, `SHEET_TABLE`,
  `sheetFieldValues`; core's `fillSheetFields`, `mapSheetFieldTexts`,
  `renameSheetFieldReferences`, `sheetFieldExpressions`, `SHEET_FIELDS`;
  `sheetItemStatus(…, { parts })` for a balloon's browser row.
- **Tests**: `sheet-schema.test.ts`, `sheets.test.ts` (shapes, rules, the balloon cascade,
  remint), `sheet-fields.test.ts` (filling, what stays typed, a parameter rename through
  `updateParameter` and its undo); `sheets/src/parts.test.ts` (merging and numbering: two
  identical bodies, a quarter-turned copy, a component, a typed name and material; cells in
  mm and inches, mass; positions of each kind; fields through `layoutSheet`; a golden SVG
  per kind); `sheets/src/parts.kernel.test.ts` (a base frame the kernel builds: sizes and
  quantities, balloons on their bodies, taller legs; `SHEETS_OUT=<dir>` writes `lists.pdf`,
  checked with `pdftoppm`).
- **Rejected**: storing a parts list's rows or numbers (derived data, which a sheet never
  stores); `BodyMeta.material` (decision 11, not now); the box in the body's own frame
  (none exists for a body; a copy turned by other than a quarter keeps its own row);
  wrapping parts list cells (rows of one height read as a list; a table's cells are prose and
  wrap); a balloon on a free point (it numbers a body); a balloon left on the sheet with its
  list gone (the rule would refuse the delete, and a number from no list means nothing).

## Amendment (S1a, 2026-11-10): one `EditMode` and a table per mode

Built with no behaviour change, before any drawing code.

- **The type.** `EditMode` (`packages/core/src/stores.ts`, exported from `@extrudo/core`) is
  `'model' | 'sketch'` and is the only place the union is spelled out. `SessionState.mode`,
  the shell's props and contexts (`Toolbar`, `buildCommands`, `menuModel`, `contextEntries`,
  `useViewMenu`, the view's `ViewMenuRequest`, the tutorial's facts, `toolOrTabSelector`)
  take it; `KeymapMode` and `MarkingMode` are aliases of it, so the keymap's and the marking
  menu's modes are the edit modes themselves.
- **The table.** `MODES` in `apps/web/src/shell/modes.ts` has one row per mode: `label`
  (its name in Settings › Keyboard's filter and the marking-menu editor's tabs), `tabs`
  (the toolbar tabs shown, drawn in `TABS` order), `defaultTab`, `markingSlots` (the
  wedges before the `marking.slots` overrides), `repeatSample` (what Customize Marking
  Menu lists as "Repeat last") and `finish` (the Finish tile's tool and the tab it follows;
  the model has none). `EDIT_MODES` lists the modes in Settings' order and `perMode` builds
  one value per mode. `visibleTabs` and `defaultTab` (`tools.ts`), the Finish tile
  (`Toolbar.tsx`), the ring (`viewMenu.tsx`), the editor's tabs (`MarkingMenuEditor.tsx`),
  the Keyboard page's filters and rows, and `AppShell`'s marking-menu listing read it.
- **Entering and leaving.** The session store has `enterMode(mode, fields)` and
  `exitMode()`: one store update that sets the mode and its own fields and clears the
  tool, the selection, the slice side and every mode's fields. `enterSketch`/`exitSketch`
  are `enterMode('sketch', { activeSketchId })` and `exitMode()`, so `sketch/mode.ts`
  goes through them unchanged.
- **AppShell.** Two checks that meant "not the model" became `mode !== 'model'`: an open
  feature or joint dialog is cancelled, and a pose is put back, when another mode is
  entered. The other mode checks stay: they are about what sketching or the model does
  (sketch tools and panels, the sketch's transaction, model-only tools refusing outside
  the model, model picking, per-mode Esc and Delete), not about which chrome is shown.

**Rule for adding a mode:** add it to `EditMode` and give it a `MODES` row (its tabs and
tools in `TABS`/`TOOLS`, its marking wedges, its Finish tool); give it fields of its own
in `ModeFields` and enter it only through `enterMode`/`exitMode`; then add branches only
for what the mode does, never for which tabs, Finish tile, keymap or marking-menu mode it
shows. A check written `mode !== 'model'` already covers the new mode; one written
`mode === 'sketch'` does not and must stay about sketching.

## Amendment (S1, the document), 2026-11-11

`doc.sheets` and its commands, no UI. Files: `packages/core/src/sheet-schema.ts`
(schemas, `sheetProblems`, helpers), `packages/core/src/sheets.ts` (commands),
`SheetIdSchema`, `SheetViewIdSchema` and `SheetItemIdSchema` in `ids.ts`;
`docs/file-format.md` §4.11.

**Names and details that settled** (against plan §5.1):

- **`from` is tagged**: `{ kind: 'base', direction, up }` or
  `{ kind: 'projected', parent, side }`, like every other union in the document.
  `direction` is the way the view looks, `up` the world direction that points up
  the sheet; both any length, not zero, not parallel.
- **Sides**: `left`, `right`, `above`, `below` and the isometric corners
  `iso-above-left`, `iso-above-right`, `iso-below-left`, `iso-below-right`.
  A projected view's parent may itself be projected; no cycle.
- **Scale and style** are refused on a projected view (it takes both from its
  parent), not only the scale.
- **Size**: a named paper or a custom one's two sides, 10 to 10000 mm each;
  `orientation` decides which side is across for both (`sheetPaperSize`).
  `SHEET_PAPER_MM` holds the named sizes.
- **IDs**: sheet, view and item IDs are unique in the whole design, not per
  sheet, so a command names a view or an item by its ID alone. Sheet names are
  unique case-insensitively, view names case-insensitively in their sheet.
- **`bodies`**: at least one, each once; absent means every shown body.
- **Title block fields**: names are a letter then up to 39 letters and digits
  (`title`, `drawnBy`, so S5's `{field}` can name them), values up to 2000
  characters. **Text item**: `at` is its top-left corner, `size` the letter
  height (absent: 3.5 mm), `width` the wrap width; `text` up to 2000
  characters, not blank, not trimmed.
- **The rules live in one place**: `sheetProblems(sheets)` (IDs, names,
  parents, cycles, projected-view fields, base directions, bodies) is applied by
  `DocumentSchema` (`reportSheets`) and by every sheet command, which validates
  the sheets it leaves and refuses with a `CommandError` naming the sheet and
  view. So the sheet rows are not in `DocumentSchema`'s `unique` table, and a
  command can never make a design the loader refuses.
- **Commands**: `addSheet({ sheet, index? })` takes a whole sheet (views and
  items included; core sets no defaults, the paper a new sheet gets is the
  mode's choice), `updateSheet`, `updateSheetView` and `updateSheetItem` take
  `changes` where `null` deletes an optional field and `id`, `kind`, `views`
  and `items` are refused; `moveSheet({ id, index })`; `removeSheetView`
  removes the views projected from it, at any depth, and every item whose
  `view` names one of them (`sheetItemView`: a text has none);
  `removeSheetItems({ ids })` takes items from any sheet. Labels are generic
  ("New sheet item"); a caller may relabel a command. `sheets` is deleted with
  the last sheet. Payloads are copied into the document.
- **Cascades**: `restoreVersion` copies `sheets` (or deletes it);
  `remintSheets` (`remint.ts`) renames the bodies of copied features in a view's
  `bodies`; the documents a Script feature and a plugin command see leave
  `sheets` out (`recompute/engine.ts`, `recomputer.ts`, beside the
  annotations). Sheets are in no cache key.

**Forward compatibility**: on load, a sheet item
whose `kind` this version doesn't know is left out and listed in `dropped` by
its path (`sheets.0.items.2`), the path an unknown key takes
(`parseLeniently`), so `loadNotice` reports it; it never fails the design. An
item with no `kind`, or a known kind that is damaged, still fails. A later
slice adds a kind by adding its schema to `SheetItemSchema`'s union.

**Bodies**: removing a feature or a body is never refused and never changes a
sheet because a view names it. A `bodies` entry the design has no body for is
skipped when the view is evaluated (S2); a view left with none draws nothing.

**Rejected**: per-sheet IDs (a command would need the sheet too); scale and
style inside `from.base` (structural, but further from the accepted shape: a
rule does the same); rows in the `unique` table (the commands need the same
rules, so they live in `sheetProblems`); a label per item kind (one more table
per kind; callers relabel); trimming a text (spaces may be meant).

## Amendment (S1, layout and output), 2026-11-11

A sheet becomes one display list, written as PDF and SVG; no UI. Files:
`packages/io/src/display.ts` (MIT), the new package `packages/sheets/` (`layout.ts`,
`title-block.ts`, `text.ts`, `output.ts`), `measureText` in `packages/sketch/src/text`.

**The display list is a layer above `writePdf`'s items, in io** (`DisplayList`,
`DisplayPath`, `DisplayText`, `DisplayStroke`, `DisplayFill`). It keeps `PdfItem`'s paint
model (stroke width, colour, dash, cap, join; fill and rule; a text run's string, glyph
outlines, baseline start, cap height, advance width, angle) and differs in two things: it
is in **sheet mm from the top-left with y down**, the document's and the screen's frame,
and each item may carry a `key` naming what it is part of, for the screen's picking.
`displayPdfPage` is the only place y is flipped for PDF (y → height − y, arcs' sweep and
angles negated through io's `transformContour`); `writeDisplayPdf` and `writeDisplaySvg`
write lists. The screen uses `displayPathData` (the path data `writeDisplaySvg` writes),
`displayPaint` (its presentation attributes in React's spelling) and `displayTextLayer`, so
it never derives anything of its own.

**SVG text:** each run is its outlines as a `<path>` plus an invisible `<text>`
(`fill-opacity` 0, Inter or a sans-serif, sized to the cap height, `textLength` with
`lengthAdjust="spacingAndGlyphs"` onto the outline width), in one group after the drawing.
Chromium printing such an SVG to PDF gives text that `pdftotext` reads back.

**`@extrudo/sheets`** (GPL; `core`, `sketch`, `io`, `fonts`; no DOM): `layoutSheet(sheet,
context)` with `context = { name?, sheets?, views? }` lays out, in order: the white paper;
the border 10 mm in (a twentieth of the short side on a small sheet), centring marks, and
with `zones` an even number of zones of about 50 mm, numbered left to right and lettered
top to bottom without I and O; the title block in the lower right corner against the
border; the views; the items. `sheetsToPdf(sheets, context)` writes one page per sheet in
the order given, titled with `context.name`; `sheetToSvg(sheet, context)` one SVG.

- **Title blocks** (`SHEET_TITLE_BLOCKS`): `simple`, 160 × 32 mm, cells `title`, `scale`,
  `sheet`, `drawnBy`, `date`, `units`, `version` (decision 8's fields); `full`, 180 × 40 mm,
  adds `checkedBy`, `approvedBy`, `company`, `material`, `partNumber` and `projection`. A
  cell draws its label in capitals (1.6 mm, muted) and its value below it, shrunk to fit
  down to 1.8 mm and then cut with an ellipsis; an empty field draws its label alone.
  `scale` (the sheet's), `sheet` ("n / N" among `context.sheets`) and `projection` ("First
  angle" / "Third angle") are derived and never read from `fields`. Units and version are
  typed fields until S5's `{version}`. `sheetTitleFields(template)` lists the typed ones.
- **Text**: Inter Regular and Bold (`SHEET_FONTS`) through `shapeText` and the new
  `measureText` (a line's advance in cap heights, kerning included); the caller loads the
  fonts, and layout throws if they are not loaded. A text item's first baseline is one
  letter height below its `at`, lines are 1.6 letter heights apart, it breaks at newlines
  and, with `width`, before a word that would end past it (a longer word breaks between
  characters).
- **Lines** (plan §4.2): visible and outline 0.5 mm, hidden 0.25 mm dashed 3/1.5, tangent
  and centre 0.18 mm (centre dash-dot 8/1.5/1/1.5), border and title-block frame 0.5,
  title-block cells and zone ticks 0.25.
- **Views**: lines come in through `context.views`, by view ID, as `SheetViewLines`: curves
  with a kind (`visible`, `hidden`, `outline`, `tangent`, `centre`), an optional edge name,
  and io contours in the view's own frame (mm at 1:1, y up the sheet, origin at the view's
  `at`), so S2 adds geometry without changing the signature. Layout scales them by the
  view's scale (a projected view's base view's), flips y and moves them to `at`, one path
  per kind; the base view's style `visible` (and the shaded ones, for now) leaves hidden
  lines out, `tangentEdges` and `centreLines` false leave theirs out; `label` writes the name
  under the lowest line, with the scale when it differs from the sheet's. A view with no
  lines yet is a thin 60 × 40 mm frame with its name.
- **Keys**: `paper`, `border`, `title-block`, `title-block:<field>`, `view:<id>`,
  `item:<id>` (`SheetDisplayKey`).

**Checked:** the sample (`SHEETS_OUT=<dir> pnpm vitest run packages/sheets/src/sample`:
an A3 landscape with zones, the full block, wrapped text and two views; an A4 portrait with
the simple block; a 150 × 100 sheet) opens in poppler (`pdfinfo`: 3 pages, A3 first, title
set), renders as expected (`pdftoppm`, looked at each page) and gives back every string
(`pdftotext`, Ø, ± and ° included); `rsvg-convert` draws the A3 SVG the same as the PDF.

**Rejected:**

- **`PdfItem` and `PdfPage` under neutral names as the display list.** One type fewer, but
  every consumer would work in y up: the screen and SVG would flip, and so would layout
  (sheets measure from the top-left), three flips instead of one.
- **A display list in `@extrudo/sheets`.** The writers that read it are io's, and io must not
  import a GPL package.
- **Display items per view curve.** One path per view and line kind (plan §7) keeps the
  screen's DOM small; picking a curve for a dimension (S3) uses the view's lines, not the
  display list.
- **A text measurer handed in through the context.** The plan routes text through the
  text module; one function there (`measureText`) is less to wire than an interface.
- **The ISO projection symbol in the full title block.** Words ("First angle") can't be
  drawn the wrong way round; the symbol can come with a title-block editor.

## Amendment (S1, the mode), 2026-11-11

Slice S1's app part: the Drawing mode, built on S1a's mode table, S1's document and its
layout. `EditMode` gains `'sheet'` with the field `activeSheetId`; `MODES` gets its row
(tabs Home and Drawing, the Drawing tab by default, `SHEET_SLOTS`, Repeat last's sample
`newSheet`, Finish Drawing). The functions are in `apps/web/src/sheets/mode.ts`; the screen
is the lazy `sheets/SheetWorkspace.tsx` chunk; UI spec §4a describes what a person sees.

- **Naming:** the UI says "drawing" and "sheet"; code says `sheet`, except the tool
  `finishDrawing` (the plan's name). The Make tile's tool is `sheets`.
- **Entering** (Make › Drawing, the browser's Drawings folder, Ctrl+K) ends an open sketch
  (its edits one undo step), a waiting Create Sketch and a feature dialog. **Every sheet
  command does the same first** (`leaveSketch`), since New Drawing and the Drawings folder
  are reachable while sketching: a sheet change is never part of a sketch's undo step.
- **Undo:** every sheet edit is one command and one undo step with its own label, and
  Finish Drawing is none (decision 13). Undo in the mode is a plain undo, never
  `reopenSketch` (which would leave the drawing). An undo, redo or restore that takes the
  open sheet away opens its neighbour, or ends the mode with the last sheet
  (`keepSheetOpen`).
- **The sheet on screen** is `layoutSheet`'s display list as SVG through io's screen
  helpers, the same list the PDF and SVG writers get. Pan and zoom write the paper
  element's box to the DOM, with no React render per frame; the 3D view stays mounted and
  `inert` underneath. While the Sheets tree shows, the model's browser folders stay mounted
  in a hidden React `Activity`, so their open state survives the visit.
- **Selection is by display key**, not by item kind: a target is `item:<id>`, `view:<id>`
  or `title-block` (its fields' keys fold into it); the paper and the border are not
  targets. A target's box is the union of its drawn items, strokes included; the smallest
  box under the pointer wins. In the session a target is the selection item
  `{ kind: 'sheet', id }`. Moves and deletes of several targets are one undo step
  ("Move on sheet", "Delete from sheet", `selection.ts`); the title block is neither moved
  nor deleted there. An item tied to a view (S3's dimension) keeps its `at` in the view's
  own frame, so its move is scaled by the view's scale and flipped in y, and it is not moved
  again when its view moves with it.
- **Export:** one dialog (mock-up 4) for Export PDF and Export This Sheet: PDF is one file
  with a page per chosen sheet, SVG a file per sheet; the format is the preference
  `export.sheets`. `@extrudo/sheets` loads lazily, never in the entry chunk.
- **Elsewhere in the shell:** an Edit from the drawing that opens a sketch or a feature
  dialog ends the drawing first; Repeat last skips the tools that enter or leave the mode or
  only open a dialog; the web build's Report a Bug attaches a PNG of the sheet, not the
  hidden 3D view; Import Drawing is called Import SVG/DXF; the load notice counts a dropped
  sheet item as an item, not a setting.
- **Plan §3.1** says Home's model-only tools say "Finish the drawing to use …" "as they do
  in a sketch". That was not true when the mode was built: in a sketch their search entries
  and keys said so, but a click on their tile did nothing. The drawing shows the message on
  a click too; a separate change brings sketch mode in line.

**Rejected:**

- **A second shortcut for the sheet tabs.** A browser may keep Ctrl+PageUp/PageDown for its
  own tabs; the sheet tabs are always clickable, and the UI spec says so.
- **Unmounting the model's folders in the drawing.** Simpler, but each folder keeps its
  open state in its own component, so the tree came back with every folder at its default.
- **Refusing a recompute error's Edit in the drawing.** The click says what the person
  wants; ending the drawing (no undo step) and opening the dialog does it.
- **Selection by item kind.** S3 to S5 add dimensions, notes and tables; keys keep the
  selection layer unchanged for them.

## Amendment (S2, the view tools), 2026-11-11

Package 2 of S2: the views drawn from the model in the app, Base View, the view card and an
export that draws the same lines (part 1); Projected View, aligned moves, New drawing's Start
with, a dragged body and the view's menu (part 2, the last bullets). Files: `apps/web/src/sheets/viewLines.ts` (the
adapter and the requests), `viewRunner.ts` (one run at a time), `views.ts` (Looking from,
placing, the card's commands), `SheetViewCard.tsx`, `SheetWorkspace.tsx`, `SheetCanvas.tsx`
(placing, notices), `exportSheets.ts`; `SheetViewLines.bounds` and `.state` in
`@extrudo/sheets`; `Recomputer.bodyVersions()`; `shownBodies` exported from `@extrudo/kernel`.
UI spec §4a describes what a person sees.

- **Where `at` sits**: a view's `at` is **where the world origin lands on the sheet**, as
  the kernel's view coordinates and S3's dimension `at` already assume, not the middle of
  its lines. Views projected from one another then share a sheet coordinate exactly (a view
  above keeps its parent's `right`, so one `at.x` lines both up), a dimension never needs
  rewriting when its view moves, and a model change that grows the part never moves the
  view. Placing puts the middle of the lines (computed before the click, `peek`: the quick
  ones first, then the exact ones) under the pointer and stores the origin that gives, so the view does not jump when its exact
  lines arrive. A new scale moves `at` so the middle of the lines stays put (`rescaledAt`),
  in the same command.
- **Requests** (`sheetViewWants`): the view's frame from `sheetViewFrame` and **always an
  explicit body list**: its base view's `bodies`, or every shown body at the marker
  (`shownBodies`), so hiding a body asks again and the app knows what each result is for.
  The key is direction, up and bodies; never scale, position or style.
- **The runner** (one per kernel, `sheetViewRunner`; its cache of 64 views outlives a visit
  to the drawing, memory only): on each `want` it shows, per view, its exact lines when they
  are the model's now (`linesAreCurrent`: every drawn body's version equals
  `Recomputer.bodyVersions()`, a body skipped as missing is still missing; a mesh body's
  version does not count), else the newest lines it has marked `state: 'stale'` (quick
  lines of the model now, exact lines of an older model, the view's last lines under its old
  direction), else nothing (layout's frame and the screen's "Drawing the view…"). Then one
  run: quick requests for the views with nothing current, then exact ones, in the sheet's
  order, `quiet` (the workspace shows its own notice). A `want` during a run waits for it;
  the run stops early only when none of its later views is wanted (another sheet). It does
  not run again for the same remaining work (an error, or results newer than the model store
  while a recompute finishes, would loop); a model change, a view change or **Draw** does.
- **Cancel** (`cancelSheetViews`) stops before the next view; the views keep what they show
  and the runner stays stopped until the model or the views change. A run stopped by
  someone else's cancel (the export's) is run again. No document change: this is not
  ADR-0111's undoing Cancel, since no edit is behind a view's computation.
- **The notice** (`SheetViewsNotice`) appears 300 ms into a run like other kernel waits
  (ADR-0105's `WAITING_AFTER_MS`), at the top middle of the sheet (the model's own notice
  keeps the top left), with "View n of N", a bar over the exact views and Cancel; after a
  cancel it offers Draw. **While the model is computed** (`status` idle or computing) the
  runner only updates what the views show (`want(wants, hold)`): the kernel has no model yet
  ("The model is still being computed."), or is about to replace it.
- **On screen only**: dimmed stale lines (the paths' `state`, opacity 0.35), "Drawing the
  view…", and plan §4.6's notes under a view ("Box is gone. Choose bodies or delete the
  view.", "Mesh bodies can't be drawn yet.", plus "No shown bodies to draw."). A view whose
  bodies are gone keeps the frame of its last lines in the session (`bounds` with no
  curves); after a reopening it is the 60 × 40 placeholder. The writers ignore `state`, and
  the notes are not in the display list.
- **Export** first computes every view of the chosen sheets exactly through the same runner
  (`exact`: cached exact lines reused, the rest computed one at a time with the dialog's
  progress); closing the dialog cancels it and writes nothing. A view that can't be drawn is
  its frame. So a file never holds a quick placeholder.
- **Base View** (`V`, category `create`, Drawing › Views; the marking menu's wedge that held
  Sheet Setup) is the session's `activeTool` `baseView` (`SHEET_TOOLS`): the right column
  shows Looking from, Scale and Style; the placing frame is in the canvas overlay, its
  transform written per pointer move; a click places ("Base view", one undo step) and
  selects the view, and the tool carries on as Projected View from it; Esc ends the tool.
- **The card** (mock-up 1) for one selected view: name, Looking from (six standard, four
  isometrics from the front's frame named by the faces they show, the model's current view
  from the viewport camera, each named view from its camera), Scale (sheet's, standard,
  custom with two `ExpressionInput`s), Style (visible; visible and hidden: the shaded styles
  are not offered), switches Tangent edges and View label, bodies under All shown (the last
  one can't be unticked; a chosen body that is gone is listed as gone). A view still named
  after its direction takes the new direction's name. A projected view shows its parent and
  its label only. Each change is one `updateSheetView` with its own label.
- **Speed**: `layoutSheet` keeps each view's items per lines object and the keys it depends
  on (position, scale, style, switches, label), places the label from `bounds` instead of
  flattening, and `targetBoxes` keeps each item's box in a `WeakMap`; the canvas memoises
  each path by its item. Measured in Node on the Arch ARM VM, four views of B7 (536 curves):
  layout plus boxes 6.1 ms with no reuse, 0.08 ms after a text moved; B5 (255 curves) 1.15
  and 0.19 ms.
- **Dimensions** a file already holds are drawn detached (their text with "?"): the
  workspace passes no anchors until S3's tool.
- **Tests**: `viewLines.test.ts` (pieces to contours, lines, requests, current or stale,
  notices, the runner's order, stale lines, cancel and export with a fake kernel);
  `templateViews.test.ts` (the wall bracket template's four standard views through the
  kernel, the adapter, layout and the SVG writer, golden
  `apps/web/src/sheets/golden/wall-bracket-views.svg`, the template's IDs fixed in the test);
  `views.test.ts` (part 2's pure functions); `e2e/sheet-views.spec.ts`, with each template's
  Standard views against a golden of its normalised SVG export.
- **Part 2: Projected View** (`P`, `projectedView` in `SHEET_TOOLS`, `useProjectedView.ts`):
  the parent is the view the tool is started from (Base View's, the menu's) or the selected
  one. The side comes from the pointer against the middle of the parent's lines
  (`projectedSide`: within a 2:1 cone of an axis beside, above or below, else the diagonal's
  isometric); `projectedAt` puts the lines' middle under the pointer but takes the parent's
  `at.y` (beside) or `at.x` (above, below) exactly, so aligned views share the coordinate in
  the document, not only on screen. The eight sides' quick lines are peeked when the parent is
  chosen, then their exact ones. Named by `projectedName` (the standard view it is, else
  Isometric or Projected).
- **Part 2: moving** (`viewDeltas` in `selection.ts`): a projected view moves only along its
  parent's line unless Alt (`free`) or its parent moves too; the views projected from a moved
  view follow along the coordinate they share (an isometric one fully), at any depth. A base
  view's new scale (`rescaleSheetView`: the card, Fit Scale) moves each projected view so it
  keeps its place against the parent, scaled, in one step (`runAsOneStep`).
- **Part 2: Standard views** (`standardViews.ts`, loaded lazily with New drawing): one base
  view (Front) and three projected from it (top below in first angle and above in third, the
  side on the right, the isometric's direction above right) in a 2 × 2 grid: the front with
  the side beside it, the top in the front's column and the isometric in the corner left
  free, diagonal from the front (mock-up 2's picture; a row of front, side and isometric was
  tried first and wasted the height the isometric needs). 20 mm gaps, inside the border less
  10 mm and above the title block, at the largest standard scale that fits (5:1 and 2:1
  first, so small parts are enlarged), centred. On A3 with the simple title block: the wall
  bracket, the storage box and the PCB enclosure 1:1 (a front and top stacked in one column
  are too tall for 2:1), the box with a lid 2:1. One view fits the sheet's
  scale to the front view and starts Base View. The sheet with its views is one `addSheet`
  ("New drawing").
- **Part 2: quick bounds are not good enough for layout.** The polygonal run can return stray
  pieces: the wall bracket's isometric once measured x from −36.6 mm instead of −28.3 (one run
  in three). So New drawing's layout, a dropped body's place and Projected View's frames use
  the **exact** lines' bounds (`peek(want, true)`); the quick ones only show a frame early.
- **Part 2: a body dragged** from the browser (`application/x-extrudo-bodies`, the browser's
  own drag data) makes a front base view of those bodies at the drop. **The view's menu**:
  Projected View from This, Fit Scale (its base view, the room inside the border), Delete.
  **The view label** is centred under the middle of the lines' bounds (layout), on screen and
  in every export.
- **Goldens of templates**: a template's feature IDs are new on every call and its edges'
  names follow them, so the order and the direction of a view's curves change between runs.
  The tests fix the IDs (`crypto.randomUUID` counted while the template is built); sorting
  the curves was not enough.
- **Rejected**: the quick lines' bounds for layout (above); aligning projected views only
  while dragging, on screen (the document would drift apart); `at` as the middle of the lines (a model change would move the view, aligned
  views would line up only while their extents agree, and dimension `at`s are origin-based);
  requests without `bodies` (the app could not tell which bodies a result is for); the
  kernel wait notice with a Cancel (ADR-0111 keeps Cancel off kernel waits; this one changes
  no document); the notes in the display list (they would be exported); dimming by colour in
  the list (the display list carries no screen colour).

## Amendment (S3, the Dimension tool), 2026-11-11

Package 2 of S3: dimensions in the app. Part 1 (this part): the open sheet's anchors resolved and
drawn, the detached and moved states, the browser's Dimensions folder, the export; one kernel rule.
Files: `apps/web/src/sheets/sheetAnchors.ts`, `SheetWorkspace.tsx`, `SheetCanvas.tsx` (`screenPaint`),
`SheetsTree.tsx`, `SheetTabs.tsx` (`itemReason`), `exportSheets.ts`, `SheetExportDialog.tsx`; the
kernel's `AtMarker.failed` and `lostFeature`; in `@extrudo/sheets`, a detached dimension's message.

- **When anchors are resolved**: on a new sheet object (a view or an item changed) and after every
  finished recompute (the model store's `features`, new each time), never while the model computes;
  `quiet` (no wait notice: it takes milliseconds). Answers older than the newest request are
  dropped; each answer goes through `keepLastAnchors` with the last one, so a lost dimension stays
  where it was drawn.
- **Waiting for the first answer**: an anchored item the kernel has not been asked about yet (a file
  just opened, a sheet opened, an item brought back by undo) is left out of the layout until the
  answer comes (`drawnItems`), so nothing is drawn detached because the kernel has not answered.
  Without a kernel, or when the first answer fails, every item is drawn (detached).
- **Nothing stored**: the anchors live in memory; `sheetItemsStore` keeps, per sheet visited, what
  was drawn (`kept`, for the screen only: a sheet opened again starts from it), each open-sheet
  item's text, state and reason (`rows`) for the browser and the status bar.
- **States on screen** (plan §4.6): `detached` in the paper's red (`#d93d3d`, the light theme's
  error colour, since the paper is white in both themes) with dashed lines (1.6 1 mm); `invalid`
  in red, solid; `moved` drawn as usual. The browser's row warns ("moved"; red "lost its edge"),
  and the status text says why while the item is selected, else under the pointer. **A detached
  dimension's reason is the kernel's** (deleted, suppressed, failed feature) when it gives one,
  else the plan's "This dimension lost its edge: …" (`measureSheetDimension`); leader notes and
  centre marks keep their own words.
- **The export writes only the model as it is now** (`exportAnchorsOf`): it resolves every chosen
  sheet with anchored items again and keeps **no** geometry, since the writers ignore `state` and a
  kept "74" would print black, like a valid one: the wrong number the owner's rule is there to
  prevent. On the page a lost dimension is its text alone at its place with "?" for the value (as
  a file just opened shows it), a lost leader note its typed text without the arrow, a lost centre
  mark or line nothing. If the kernel can't answer, the export stops with "The drawing couldn't be
  exported: its dimensions couldn't be measured from the model. Try again once the model is
  computed." and writes nothing. It passes the design's units (it wrote millimetres before). Its
  dialog resolves as it opens and adds "· n dimensions detached, written as ?" to the summary. The
  screen is unchanged: last geometry, red and dashed, the reason in the status bar.
- **The browser** (plan §3.1): a Dimensions folder in each sheet's folder when it has dimensions,
  a row per dimension (its text on the open sheet, else "Dimension"; its view's name), a click
  selects it on its sheet.
- **Left for a later schema change** (the owner, 2026-11-11): mock-up 3's "Show the unit" and the
  card's "arrows inside or outside" (plan §4.3). The item has no field for either; the layout puts
  the arrows outside by itself when there is no room between the extension lines.
- **Rejected**: the export keeping the screen's last geometry for a lost dimension (it printed a
  black "74" on B2 with the pocket deleted); writing what the screen last had when the kernel
  can't answer; drawing anchored items detached until the first answer (every opening would
  flash red); keeping the whole sheet bare until then (views would wait on dimensions); the
  theme's error token on the paper (it is a light red in the dark theme, meant for a dark
  background); a message for each kind in the browser row (the status text has room for it).
- **Part 2: the Dimension tool** (`D`, `sheetDimension` in `SHEET_TOOLS`, the Drawing tab's
  Dimensions group, its own icon `sheet-dimension`, New Sheet's wedge in the marking menu).
  Files: `dimensionTool.ts` (pure: `sheetPickables`, `hitPickable`, `dimensionOf`,
  `dimensionItem`, `nextStep`), `useDimensionTool.ts` (`pickOf`, the hook),
  `SheetDimensionCard.tsx` (panel, card, overlay), `RepickHandles.tsx`; `SheetCanvas`'s
  `pointer` and `overlay` props and its control's `sheetPoint` and `tolerance`;
  `runSheetCommand` in `views.ts`; in the kernel, `reference` takes a sub-shape's persistent
  name as well as its index.
- **What can be picked**: a view's curves only when its geometry is exact and current (not
  `pending`): never the quick placeholder, never lines of an older model. Each model edge by its
  name, its curves of every kind together (a circle half hidden is two curves), and each
  cylinder's or cone's outline by its face's name; hidden lines only where the view draws them,
  tangent edges likewise. A line's or an open curve's ends are its vertices. The pointer takes the
  nearest within 5 px (at least 0.8 mm); an end wins when it is within that and not more than a
  third of it further than the line (so the middle of a short edge is the edge).
- **A pick becomes an anchor through the kernel**: `Recomputer.reference(body, kind, name)` gives
  the ref with its fingerprint; an edge whole is `{ ref }`; **a vertex is the edge's `start` or
  `end`** (no vertex name is needed), and which one, like an outline's side, is read back with one
  `resolveSheet` of a throwaway item with both (`~probe`), taking the one under the pointer.
- **Which dimension** (`dimensionOf`): a line its length, a full circle its diameter, an arc its
  radius, an outline its length; of two in one view, two outlines of one face a diameter, two
  lines (edges or outlines) that cross an angle, anything else a linear distance. Placement
  decides horizontal, vertical or aligned (`measureSheetDimension`), unless the panel fixes a
  direction. Once the picks make one, its anchors are resolved once (`~dimension`), and the
  preview is `layoutSheetDimension` of the item at the pointer, drawn in the paper's blue
  (`#2f86f0`) with "Click to place"; the picks in the paper's orange. A click on empty paper places
  it ("Dimension"), its reports merged into the workspace's anchors so it is drawn at once.
  The first Esc drops the picks (a capture listener), the shell's Esc ends the tool.
- **The panel** (mock-up 3) holds the next dimension's Direction, Decimals (an `ExpressionInput`,
  empty for the sheet's), Before, After and In brackets. **The card** (plan §4.3) has the same
  fields for a selected dimension, each one `updateSheetItem` step (a cleared field or Auto is
  `null`), its kind, view and reason, and Delete.
- **Picking again**: a lost or moved dimension selected shows a handle per model anchor, at its
  geometry's point, middle or centre as last drawn (by the text when none was kept); dragging one
  onto something pickable in the dimension's view replaces that anchor ("Pick again"). A one-anchor
  dimension takes the type its new pick makes (and loses a direction it no longer has); a
  two-anchor one keeps its type, and the document refuses an unfitting pair with why.
- **Tests**: `dimensionTool.test.ts` (pickables, hits, which dimension, the item, the panel's
  words, the card's changes, picking again); the kernel's `reference` by name in
  `anchors.test.ts`; `e2e/sheet-dimensions.spec.ts` places a length, a distance, an angle and a
  diameter on the wall bracket template, follows `width`, the card and its undo, the holes deleted
  and a lost end dragged onto an edge, undo, and the PDF's text.
- **Rejected (part 2)**: picking quick lines and fixing the ref later (a quick line has no name,
  and a wrong edge is the wrong number); a vertex name (an edge's end says the same and resolves
  through the same edge); a separate kernel call for an end or a side (one `resolveSheet` of a
  probe answers both); "Show the unit" and arrows inside or outside on the panel and card (no field;
  left for a later schema change, above).

## Amendment (S4, the notes tools), 2026-11-11

Package 2 of S4: the notes in the app, which completes S4 (mock-up 1 rebuilt by hand in
`e2e/sheet-notes.spec.ts`). Files: `apps/web/src/sheets/usePickTool.ts` (the shared pick tool
and `pickOf`), `noteTools.ts` (the notes' specs), `faceHit.ts`, `SheetTextEditor.tsx`,
`SheetNoteCard.tsx`, `snap.ts`; changes in `SheetWorkspace.tsx`, `SheetCanvas.tsx` (`editor`,
`onOpen`, `snap`, `guides`, `--sheet-mm`), `RepickHandles.tsx` (any anchored item),
`SheetsTree.tsx` (the Notes folder), `SheetViewCard.tsx` (Centre lines), `SheetExportDialog.tsx`
and `exportSheets.ts` (Sticky notes), `selection.ts` (`targetName`), `controls.tsx`
(`CommitArea`); `faceAlong` in `selection/pick.ts`; five tools and icons in `shell/tools.ts`.
No schema change, no kernel change.

- **Five tools** in the Drawing tab, as plan §4.1 places them: Dimensions › Centre Mark
  (`sheetCentreMark`, icon `centre-mark`) and Centreline (`sheetCentreLine`, `centreline`),
  category `sketch`; Notes › Text (`sheetText`, `T`, `sheet-text`), Leader Note
  (`sheetLeader`, `N`, `leader-note`) and Sticky Note (`sheetSticky`, `sticky-note`),
  category `inspect`. T is Trim's key in a sketch and N Annotate's on the model; neither is
  offered in the drawing, and no key shared by every mode is taken. Leader Note took the
  marking menu's Fit wedge (F6 and the floating bar's Fit stay). Each is in `SHEET_TOOLS`
  and stays on until Esc.
- **One pick tool, a spec per tool** (`usePickTool`, `PickToolSpec`): the Dimension tool's
  hover, pick, candidate and preview, generalised; a spec says what it `accepts`, whether
  an outline is taken as its face `whole`, how many picks it takes, what item they make and
  whether it is placed by a click (dimension, leader note) or at once (centre mark and
  line). The Dimension tool is that tool with its own spec (`dimensionSpec`); S5's balloon
  is meant to be another. **The candidate is checked**: an item whose resolved anchors
  `sheetItemStatus` calls `invalid` or `detached` is not placed and the tool says why (the
  document's rule takes the shape, the model says whether it fits: a cone for a centre
  mark, an axis seen end-on). Only shapes the kind's rule can take are hovered
  (`noteAccepts`): a centre mark a circle or an outline, a centre line a straight edge and
  then a parallel one in the same view, or an outline (its axis).
- **A leader note on a face** (plan §4.5's "edge, vertex, or face"): a hidden-line view has no
  face regions, so the face under the pointer is the first a ray along the view's direction
  meets in the bodies' display meshes (`faceHit`, through the viewport's picking index
  `faceAlong`), among the bodies the view's exact, current lines are drawn from; its name is
  the mesh's `faceIds`, and the ref comes from the kernel by that name like any pick. An edge
  or vertex within the tolerance wins over the face. The hover is a dot at the pointer.
- **Typing in place** (`SheetTextEditor`): a text, a leader note and a sticky note are typed
  where they are drawn: a textarea laid on the paper in mm (the canvas writes `--sheet-mm`,
  px per mm, with the zoom), Inter at the item's size, its first baseline on the drawn
  text's (from the display list's first run; for a new leader, the placeholder's). **Keys,
  the same for the three kinds and for the cards' Text field (`CommitArea`)**: Enter
  finishes, Shift+Enter starts a new line, Esc leaves it. A new item is added only when its
  text is finished and not blank (one undo step: "Text", "Leader note", "Sticky note"), so
  a placed leader waits for its text in memory; an edit is one `updateSheetItem` ("Edit
  text"), none when unchanged. A click elsewhere finishes, and the press that ends the typing
  starts nothing (the workspace notes whether the press began while typing). A double-click
  on a target (no tool running) types a text, leader note or sticky note again.
- **Cards** (plan §4.3), the fields the items have: text (Text, Letter height, Wrap width),
  leader note (its view, what it points at, Text), sticky note (Text, Colour, Width, Height,
  Print), centre mark and line (their view, hidden when the view's Centre lines is off);
  each change one step, numbers `ExpressionInput`s storing the evaluated mm, Delete. A lost
  or moved anchored note says why and offers its handles.
- **Lost and moved notes**: `RepickHandles` takes any anchored item; what a drag may land on
  and what it changes are the kind's (`repickAccepts`, `repickWhole`, `itemRepick`: a
  dimension by `repickChanges`, a note by `noteRepick`). **A lost note's reason is the
  kernel's when it gives one** ("The feature this was drawn on is deleted."), else the
  layout's own words, in the browser row, the status text and the card; a moved one says it
  moved to matching geometry. This supersedes the S3 note that notes keep their own words.
- **Browser**: one **Notes** folder per sheet (plan §3.1 names "notes" beside dimensions)
  with its texts, leader notes, sticky notes, centre marks and centre lines in the sheet's
  order: the first line in quotes and the kind, the view, "moved" or "lost" with the reason
  as the tooltip.
- **Export**: the dialog's **Sticky notes** switch (mock-up 4; off by default, remembered
  with the format in `export.sheets`). Off, the document decides: only notes switched to
  Print are written, and the summary adds "· n sticky notes left out"
  (`sheetStickiesLeftOut`, loaded lazily with `@extrudo/sheets`). On, every note is written,
  through a copy of the sheet with each note's `print` set (`withEveryStickyNote`); nothing is
  stored. The floating bar's **Show sticky notes** hides them on screen only.
- **The view's Centre lines switch** (base and projected views) sets `centreLines: false`,
  which hides that view's centre marks and lines (`sheetItemShown`); nothing is generated.
- **Snapping** (`snap.ts`, plan §4.2): a dragged selection snaps, each axis on its own, to
  the nearest left, middle or right (top, middle, bottom) of another target's box within the
  pick tolerance (5 px), and **a dimension to rows**: its text's line (`y` of a level text,
  `x` of an upright one; its dimension line is parallel at a fixed distance) to another
  dimension's of the same direction plus a whole number of 10 mm steps (`ROW_STEP`). A
  placed text or note corner, and a dimension or leader following the pointer, snap the
  same way. Dashed guides (`[data-sheet-guides]`, 6 4 px like a sketch's) are written to
  the DOM while dragging; the floating bar's **Snap** (on by default, session only) turns it
  off; arrow-key nudges never snap.
- **Not offered, no field**: a leader note's or sticky note's letter height (both 3.5 mm);
  a text's or leader's font, weight or alignment; a sticky note's rotation (mock-up 1 draws
  one turned); a leader with more than one arrow or a bent leader line; a centre line's
  overshoot or dash lengths; the snap step. Each would be a schema change.
- **Tests**: `noteTools.test.ts` (what each tool takes and makes, the panel's words, picking
  again, the export's copy), `snap.test.ts` (edges, middles, rows, points);
  `e2e/sheet-notes.spec.ts` (Standard views of the wall bracket, two dimensions, a centre mark,
  a centre line, a leader on a hole and one on a face, a text and a sticky note, each one
  undo step; typing in place and a double-click edit; the Centre lines switch; the sticky
  note left out of the PDF, then printed; a snapped drag; the holes deleted, the leader lost
  with the kernel's reason and dragged onto an edge, undo twice). `SHEET_SHOTS=<dir>` saves
  pictures and the PDF.
- **Rejected**: a second hook per tool copying the Dimension tool's (the task asked for one
  way of picking, and S5's balloons need the same); faces picked from the view's outlines
  only (a face seen flat has none; a leader to a face's middle needs the face itself);
  adding a leader note before its text (the schema refuses blank text, and an undo step with
  a placeholder would be one more to undo); a fixed time after typing in which clicks are
  ignored (it swallowed a real pick made soon after); snapping in the document's commands
  (the commands store what the person did; snapping is how the pointer is read).
