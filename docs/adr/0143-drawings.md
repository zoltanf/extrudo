# ADR-0143: Drawings: 2D sheets made from the model

- **Status:** Accepted, 2026-11-10 (the owner: the 14 decisions of the plan's §12, all as
  proposed). **Nothing is built yet.** Each slice lands with an amendment here.
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
