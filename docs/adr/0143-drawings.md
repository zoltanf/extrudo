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
  nor deleted there.
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
