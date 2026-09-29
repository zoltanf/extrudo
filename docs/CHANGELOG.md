# Changelog

One line per completed roadmap task, newest first. Dates are absolute.

- 2026-09-29 · **P2-13** Measure and inspect (ADR-0035): Measure (`I`, in
  Solid › Inspect and 3D Print › Prepare) shows a picked body's volume and
  area, a face's area, type, radius or normal, an edge's length, radius
  and sweep, a vertex's position; two plain clicks measure between two
  things: minimum distance with ΔX, ΔY, ΔZ and a line in the view, the
  angle, the distance between hole centres. All from the kernel's exact
  geometry. The status bar shows the size of the box around the
  selection.
- 2026-09-28 · **P2-11** Timeline v2 (ADR-0033): drag the rollback marker
  (or focus it and use the arrow keys, Home and End); drag chips to
  reorder them, refused with a message when a feature would come before
  something it uses; Roll Back to Here and Move to End in the chip and
  browser menus. A sketch can move to another plane or face (Redefine
  Plane). When a change loses a face, edge, profile or plane a feature
  used, Fix References picks it again (in the feature's dialog, or a new
  plane for a sketch); when the kernel took the closest match (a warning
  chip), Keep Closest Match stores it. While a dialog edits a feature, the
  timeline shows the marker after it.
- 2026-09-28 · **P2-12** STL, 3MF and STEP export (ADR-0034): Export in
  the 3D Print tab, the File menu and a body's menu. Pick bodies (the
  selection, or every shown one), 3MF (objects with names, colours and
  millimetres, for slicers), binary STL or STEP AP242 (exact geometry,
  named products), and Coarse, Medium, Fine or a custom deviation and
  angle. The kernel meshes each body at that resolution into one closed
  surface; the dialog shows the triangle count and that every mesh is
  watertight before saving.
- 2026-09-28 · **P2-10** Primitives (ADR-0032): Box, Cylinder, Sphere and
  Torus in the Solid tab's Create menu, each a parametric feature. They
  open on the XY plane with a live preview; click another origin plane or
  a flat face of a body to move them there (a face proposes its centre and
  Join, or Cut for a box or cylinder pushed in with a negative height).
  Sizes, X, Y and Offset in the plane's frame, a box's rotation, arrows
  and an arc to drag, and new body, join, cut or intersect. A primitive on
  a face follows the face when the model changes.
- 2026-09-28 · Fix: a new extrude or revolve hides the sketches whose
  profiles it used (one undo step with it, as in Fusion), so a used
  profile no longer floats over a pocket and takes the clicks meant for a
  sketch on its floor. A toast bottom left says which sketch was hidden,
  with a Show button, for 12 seconds.
- 2026-09-28 · Fixes: the new **Extrudo** mouse preset is the default
  (middle-drag orbits, right-drag pans, the left button as before;
  Onshape / SolidWorks is still in the Mouse controls menu); dropdown
  options (a dialog's Operation, for one) are readable in the dark theme
  where the browser draws its list white.
- 2026-09-28 · **P2-07** Revolve (ADR-0029): the Solid tab's Revolve
  turns sketch profiles or flat faces about an origin axis, a sketch line
  (construction lines too) or a straight edge: a whole turn by default,
  or an angle one way, symmetric or two ways, flipped as needed; new
  body, join, cut or intersect. Select a profile and an axis first and
  both land in the dialog; an arc in the view drags the angle all the way
  round. The origin axes can now be picked (and are highlighted) in the
  model. The kernel says when the axis isn't in the profile's plane or
  the profile crosses it.
- 2026-09-28 · **P2-09** Sketch on face and Project (ADR-0031): Create
  Sketch now also takes a flat face of a body (click it, or select it
  first); the sketch sits on the face and moves with it when the model
  changes. The Project tool (P, in the Sketch tab's Create menu) brings
  body edges and faces into a sketch, outlines of cylinders included; the
  projected curves are purple, fixed, make profiles, take constraints, and
  follow the model when it changes. A profile drawn on a face and pushed
  in cuts by default.
- 2026-09-28 · **P2-08** Bodies (ADR-0030): new bodies are named Body1,
  Body2… as they appear and keep their names; the browser's Bodies folder
  shows how many there are and renames, hides, colours (ten swatches) and
  fades (opacity) them; a click selects a body. Deleting a body adds a
  Remove feature to the timeline, so undo or rolling back brings it back.
  A cut that splits a body makes one body per piece. Wireframe and
  hidden-edge styles now draw the outlines of holes and other curved
  faces.
- 2026-09-28 · **P2-06** Extrude (ADR-0028): E extrudes selected sketch
  profiles or flat faces into solids, one side, symmetric or two sides,
  each side to a distance, up to a face or vertex, or through all, with a
  taper per side and Flip; new body, join, cut or intersect, with the
  bodies found automatically or picked. The preview shows the new body,
  a green join or a red cut; arrows and taper arcs in the view drag the
  values. Press-pull: select a face and press E; pulling it out joins,
  pushing it in cuts. The browser lists the model's bodies, and the Wall
  bracket template now builds its bracket.
- 2026-09-28 · **P2-05** Feature dialog framework (ADR-0027): features get
  their command dialog from a declarative spec (selection, expression,
  dropdown and toggle fields): it opens on the right with the current
  selection already filled in, picks in the view go into its selection
  fields, and the kernel previews the draft live as a translucent ghost
  (joins green, cuts red), dimmed while an input is invalid or the
  feature fails. Distance arrows and angle arcs drag values, with a
  heads-up box that takes typing. OK is one undo step; a timeline chip
  reopens the dialog for editing, with the model rolled back to the
  feature. Tried on the dialog debug page until Extrude arrives.
- 2026-09-28 · **P2-03** B-rep rendering and 3D selection (ADR-0026): in
  the model, the pointer pre-highlights faces, edges, vertices, sketch
  curves and profiles, a click selects (Shift or Ctrl toggles), Esc
  clears; window and crossing boxes select bodies, or faces with bodies
  filtered out. Hidden geometry is offered by "Select other…" (long press
  or right-click). A selection filter sits beside the nav bar's Select;
  the status bar says what is selected ("2 faces"). Selections turn into
  references through the persistent IDs on body meshes (P2-04).
- 2026-09-27 · **P2-04** Topological naming v1 (ADR-0005): every face,
  edge and vertex of a body has a persistent name from why it exists (an
  extrude's caps and the sketch curve of each side), carried through
  booleans and fillets by OCCT's history; split faces are numbered by
  position, edges and vertices named after their faces. References keep a
  fingerprint; a feature finds its face or edge by name, by a related name
  after a split, or by fingerprint with a warning, and says what to do
  when it's gone. The kernel sweeps (extrude, revolve) with history, and
  body meshes carry the names for selection. A 19-scenario naming suite
  and a 1000-rebuild memory test.

- 2026-09-27 · **P2-02** Sketch → kernel (ADR-0025): the kernel turns a
  sketch's curves into exact OCCT edges (splines cut where they cross
  themselves), splits them where they meet and makes a face for every
  profile, holes included, placed in the sketch plane. Faces carry the
  same region IDs as the profiles the sketch shows, so a later feature
  reads the face a user picked; bridges and dangling lines drop out as in
  the sketch. A 1000-rebuild memory test.

- 2026-09-27 · **P2-01** Recompute engine (ADR-0024): the kernel worker
  walks the timeline and caches each feature's result under a hash of its
  inputs, expression values, references and the bodies before it, so an
  edit at feature 25 of 30 re-evaluates 25–30 and undo re-evaluates
  nothing. Shapes are reference-counted in the cache; a newer request
  cancels a running one between features; dialog previews; the
  `Recomputer` keeps the model store current and survives kernel crashes by
  skipping the feature that crashed. Timeline chips show ✕/⚠ with the
  reason; the status bar counts errors and shows the kernel state. A
  500-recompute memory test.

- 2026-09-27 · **Edits made just before a reload are kept** (found by
  P1-15): the page writes a synchronous rescue copy of an unsaved document
  when it is hidden or goes away, and the next start saves it
  (`Platform.rescue`, `recoverRescued`). ADR-0009 amended. **Parameters on
  the Sketch tab** (Modify group), so the dialog opens while sketching
  without Ctrl+K.

- 2026-09-27 · **P1-15** Benchmark B1 end to end, and the **Phase 1 exit
  (v0.1)**: Playwright builds the parametric plate with four corner holes
  through the UI (user parameters, a fully constrained sketch of 16
  constraints and 7 expression dimensions), changes the hole spacing in the
  open sketch and the width outside it, reloads, and checks the dimension
  labels and every path of the SVG export. `newSketchOnXY` e2e helper.

- 2026-09-27 · **No timeline scrollbar with room to spare** (user report):
  the marker's triangle is wider than its bar and stuck out a pixel at the
  ends of the chip list, which then scrolled; the list has 4 px of padding
  at each end now.

- 2026-09-27 · **F6 fits tightly; no stuck selection box** (user reports):
  Fit frames the box of the bodies, sketches and placed dimension labels
  as seen from the camera, with a 15 % margin, instead of a bounding
  sphere (a face-on sketch filled half the view). A press released over
  the nav bar or a menu no longer leaves a selection box following the
  pointer. ADR-0008 amended.

- 2026-09-27 · **Onshape / SolidWorks mouse controls by default** (owner's
  choice): first in the Mouse controls menu and the default preset
  (right-drag orbits, middle-drag pans); Fusion's mapping is second.
  FR-VP-01, UI spec §3.1 and ADR-0008 updated.

- 2026-09-27 · **No browser menu on right-click** (user report): the
  browser's own "Copy / Select all" menu no longer opens over the view,
  the nav bar, the ViewCube or the panels (it got in the way of Onshape's
  right-button orbit); text fields, links and selected text keep it.
  ADR-0008 amended.

- 2026-09-27 · **Resize circles by the rim** (not a roadmap task, user
  feedback): with no tool running, dragging a circle's rim changes its
  radius while the radius is free (a circle with a fixed centre could not
  be resized by dragging before), and moves the circle when a dimension
  holds it. Solver `beginRadiusDrag`/`dragRadius`. ADR-0018 amended.

- 2026-09-27 · **Pointer modes** (not a roadmap task, user feedback): the
  nav bar's first button is Select, the default pointer mode, pressed
  whenever no nav tool or command runs; it stops either. Starting a tool
  ends Orbit/Pan/Zoom. Orbit and Zoom have their own cursors (they all
  showed a hand). The Solid tab's Select tile is gone; a tool from a
  group's menu lights up its group's label. ADR-0007 and ADR-0008 amended.

- 2026-09-27 · **P1-14** Command search and shortcuts v1: one keymap
  table (`commands/keymap.ts`, Fusion's keys plus Shift+1…7 for the
  standard views) that the toolbar, menus and shortcut handler all read;
  a per-mode command list (`shell/commands.tsx`: the shown tabs' tools,
  edit, view, panel, file and theme commands); fuzzy search that favours
  word starts ("3pr" → 3-Point Rectangle) and falls back to group and
  hint words; the Ctrl+K palette and the S toolbox at the pointer with
  pinned commands (Shift+Enter pins; kept in preferences) and recent
  commands. Keys of tools that come later say when they arrive. The app
  bar has a search button after Undo/Redo, and Help is a menu with Search
  commands and Toolbox. ADR-0023.

- 2026-09-27 · **Design review** (not a roadmap task): the workspace
  switcher is removed; the toolbar's tabs are Solid · Insert · 3D Print
  (Insert and Export left Solid; the model's Export is in 3D Print); the
  browser slides closed in 200 ms and leaves a small "Show browser" tab
  instead of a rail; the status bar shows the viewport's render rate and
  frame time ("idle" while the view is still). ADR-0007 amended.

- 2026-09-27 · **P1-13** SVG and DXF export: `@extrudo/io` gets a neutral
  2D `Drawing` (layers; contours of lines, arcs, elliptical arcs and
  Béziers) with `writeSvg` (width/height in mm, bounding-box viewBox, y
  flipped, exact `A`/`Q`/`C` curves, layers as Inkscape layers) and
  `writeDxf` (R12: LINE/ARC/CIRCLE, POLYLINE for ellipses and splines,
  profiles as closed polylines with bulges, `$INSUNITS` mm).
  `@extrudo/sketch/export` maps a sketch's curves (construction optional,
  on a dashed layer) or its profiles (filled, even-odd, with holes) onto
  it, splines as the Bézier pieces of their B-spline. An "Export sketch"
  dialog (format, contents, selected profiles first, size summary) opens
  from the Sketch tab's new Export group and from a sketch's timeline or
  browser menu. Golden-file tests. ADR-0022.

- 2026-09-27 · **P1-12** Timeline v1 and browser tree: right-click menus
  on timeline chips and browser rows (Edit Sketch, Rename, Show/Hide,
  Suppress, Delete; new design-system `ContextMenu`); rename in place
  (F2 or the menu: a field in the row, a popover over the chip); the
  pointer on a chip or row draws its sketch in the accent; eyes on
  sketches and on the Origin, Sketches and Bodies folders (one undo step
  each); a Construction folder; suppressed chips dashed, rows struck
  through. Core: optional `Feature.visible`, `setFeatureVisibility`, and
  `removeFeature` refuses while another feature refers to the feature or
  an expression outside it uses one of its named dimensions. Suppress and
  delete wait until an open sketch is finished. ADR-0021.

- 2026-09-27 · **P1-11** Profile detection: a TypeScript planar
  arrangement (`@extrudo/sketch/profiles`) finds every closed region of a
  sketch, where curves cross, touch or end on each other, with nested
  groups as holes; exact lines and arcs, ellipses and splines as
  polylines; exact areas; region IDs hashed from their boundary's curves
  and directions (stable across moves, resizes and unrelated edits).
  Profiles are shaded in the view (new `profile-fill` token), hovered and
  selected where no entity is (kind `profile`, `<sketch>/<region>`), with
  their area in the properties panel; the palette's "Show profiles" hides
  them. Also fixed a CI-only e2e failure from P1-10 (a constraint glyph
  over a corner took the click). ADR-0020.

- 2026-09-27 · **P1-10** Modify tools: Trim (`T`, previews what goes),
  Extend, Break; Sketch Fillet (`F`) and Chamfer on a corner point or two
  lines, keeping a virtual sharp so dimensions to the corner survive, with
  a driving radius (distance); Offset (`O`) of a joined chain with parallel
  or concentric pieces and linked distance dimensions; Mirror with
  symmetric constraints; Move (`M`, a solver drag) and Copy; Rectangular
  and Circular Pattern (copies take the original's dimension parameters);
  Scale (points, radii and dimension expressions; refuses fixed geometry).
  Pure operations in `@extrudo/sketch/modify` returning a change for the
  new `modifySketch` command (replace, remove, re-express; one named undo
  step). Seven new tool icons. ADR-0019.

- 2026-09-27 · **P1-09** Selection and editing in sketch: with no tool
  running, hover pre-highlights, click selects (Shift/Ctrl toggles), a drag
  over empty space draws a window (left to right, solid) or crossing box
  (dashed), and a drag on geometry moves it, or the whole selection, with a
  live solve as one undo step (Esc puts it back). The solver drags several
  points across components (`beginDrag(ids)`, `dragBy`). Delete removes
  geometry with its points, constraints and dimensions (`removeFromSketch`
  entities, `entityRemoval`; a spline loses just the point). Properties
  panel in the view's bottom-left: type and status, point X/Y and radius as
  expressions, line length and angle, construction toggle, Delete.
  ADR-0018.

- 2026-09-27 · **P1-08** Constraint status: per-entity colours in the open
  sketch (free `sketch` blue, fully constrained `ink`, over-constrained
  `error` red; construction stays grey), from planegcs's dependent
  parameters (new `get_dependent_params` binding in our planegcs patch;
  `ComponentReport.free`, `sketchStatus`). Red glyphs and labels for what
  over-constrains, including driving dimensions the geometry doesn't meet
  (`unmetDimensions`); constraints on fixed geometry alone don't count.
  DOF counter in the palette. A new over-constraining dimension opens a
  dialog (add as driven, or cancel) instead of going in driven; turning a
  driven dimension driving, or a value the solve doesn't meet, is refused.
  ADR-0017.

- 2026-09-27 · **P1-07** Dimensions: the Sketch Dimension tool (`D`) picks
  a line (length), two lines (angle, or distance if parallel), a point and
  a line, two points, a circle (diameter) or an arc (radius), and places
  the label where you click: horizontal, vertical or aligned by where it
  goes, an angle's pair by its sector (`supplement`). New dimensions drive
  at their measured value and open for editing in place
  (`<ExpressionInput>`, a Driven checkbox, `name = value` creates a
  parameter); one that would over-constrain goes in driven. Labels with
  extension lines and arrows (`tools/dimensionLayout.ts`) select, drag
  (label offset stored from the anchor), and delete. Named driving
  dimensions (`d1`…, typed heads-up values too) are model parameters in the
  Parameters dialog; renames and delete checks cover them. Changing a
  value, or a parameter it uses, re-solves every affected sketch in the
  same undo step (`ToolHost.apply`), and refuses a value the sketch can't
  take. "Show dimensions" palette toggle. ADR-0016.
- 2026-09-26 · **P1-06** Constraints UI: 13 constraint tools (Coincident …
  Symmetric) in a compact two-row Constraints group, with nine new icons.
  They pick points and curves under the cursor (`pickEntity`), highlight
  what a click would pick, and refuse a redundant or conflicting constraint
  with a message; a solve that shrinks a curve to nothing counts as a
  conflict (planegcs reports it as solved). Fix toggles. Glyphs next to the
  geometry (placement in `tools/glyphs.ts`): hover highlights the
  constrained entities, click selects, Delete removes (`removeFromSketch`,
  one undo step), new ones flash; the wheel and middle/right drags pass
  through them to the view. "Show constraints" palette toggle.
  `curvePolyline` in core now shapes every drawn curve. ADR-0015.
- 2026-09-26 · **P1-05** More drawing tools: regular polygons (inscribed,
  circumscribed across the flats, from an edge; equal edges with corners on
  a construction circle; a Sides heads-up field that persists), slots
  (center to center, overall; tangent lines and arcs with a construction
  centerline), ellipses and fit-point splines. Two new entity types in the
  core schema: `ellipse` (three points, mapped to planegcs's ellipse through
  a solver-only focus and ordinary constraints) and `spline` (fit points;
  the curve is a cubic B-spline interpolation in `sketch/curves.ts`, no
  solver equations). Previews draw polylines and construction circles. The
  drawing tools and overlay moved into a lazy chunk (main chunk 950 kB, was
  about 1 MB). ADR-0014.
- 2026-09-26 · **P1-04** Basic drawing tools: rectangles (2-point `R`,
  3-point, center with construction diagonals), circles (center-diameter
  `C`, 2-point, 3-point), arcs (3-point `A`, center point, tangent), points,
  and the Line tool's tangent-arc drag (press on the chain's end and drag).
  Each commits with its structural constraints (corners, H/V or
  perpendicular/parallel, tangent with its side) plus test-solved snaps;
  typed widths, heights, diameters and radii become dimensions. Construction
  toggle (`X`, palette checkbox). Previews draw arcs, circles and dashed
  guides; the viewport reports drags to tools. Variants live in the Create
  menu with their own icons. ADR-0013.
- 2026-09-26 · **P1-02** Sketch tool framework: the inference engine in
  `@extrudo/sketch/inference` (endpoint, center, point, origin, intersection,
  midpoint, on-curve, H/V alignment and guide crossings, grid; unit tested)
  and its auto-constraints, test-solved with `SketchSolver.check` before
  they're committed; `addToSketch` in core (additions plus solved positions
  in one step). Web: tools as state machines under a host, pick rays and
  projection in `camera.ts`, an SVG overlay (rubber band, dashed guides,
  snap glyphs, prompt), the heads-up box (typed length → dimension, typed
  90° multiples → horizontal/vertical), grid snapping that follows the
  visible grid ("Snap to grid" in the palette), Ctrl/⌘ turns snapping off.
  The Line tool (`L`) is the reference tool. ADR-0012.
- 2026-09-26 · **P1-03** Solver integration: `SketchSolver` in
  `packages/sketch` (planegcs adapter): every entity, constraint and
  dimension type mapped (endpoint tangency as `angle_via_point`, an optional
  `reversed` side on `tangent`/`smooth`), fixed geometry as constants, one
  persistent system per independent component, solving only what changed,
  drag with temporary constraints, DOF, conflict and redundancy reports, and
  `check()` to test-solve a new constraint. Our planegcs WASM builds in CI
  once per input hash (`pnpm planegcs`, `pnpm wasm`; shared
  `scripts/wasm-release.mjs`). Fixtures and a benchmark (plates, gear
  outline); debug page `#/debug/solver`. ADR-0011.
- 2026-09-25 · **P1-01** Sketch feature and sketch mode: `SketchData` schema
  in core (points, lines, circles, arcs; every FR-SK-07 constraint and FR-SK-08
  dimension; records keyed by ID; reference checks on load), origin plane
  frames, the `sketch` feature definition (plane `ref` input + sketch data),
  `createSketch`, v0 sketch data migrated to records. Web: Create Sketch
  picks an origin plane in the view (hover highlight) or in a prompt; Look
  At; sketch mode as one undo transaction; the Sketch tab with Finish Sketch;
  the sketch palette; the grid on the sketch plane; sketches drawn in the
  viewport; browser and timeline open sketches; 17 new sketch icons. The Wall
  bracket template has real sketches. ADR-0010.
- 2026-09-25 · **P0-08** Project storage: `packages/storage` with the
  `ProjectStore` interface over an IndexedDB index and OPFS files (IndexedDB
  fallback), `.extrudo` zip read/write through core's migrations, and
  in-memory versions for tests. Web: async platform with project store,
  persistent-storage request and file download/pick; autosave (800 ms, save
  state in the app bar, retry, flush on hide/leave); thumbnails from the
  viewport; hash routes `#/` and `#/p/<id>`; home screen (new design, Wall
  bracket template, grid, search, sort, rename, duplicate, export, import,
  trash, delete forever, storage badge). ADR-0009.
- 2026-09-25 · **P0-05** Viewport: R3F canvas over the glowing background,
  Z-up world; our own camera controller (target + quaternion + size, one
  scale for perspective and orthographic, zoom to cursor, fit, 350 ms
  transitions, instant under reduced motion); Fusion, Blender,
  Onshape/SolidWorks and trackpad mouse presets; adaptive shader grid with X/Y
  axes, Z axis, origin point and planes (Browser eyes); CSS 3D ViewCube with
  faces, edges, corners, home, turn and roll arrows; nav bar (orbit/pan/zoom
  tools, fit F6, orthographic, visual styles, grid, mouse preset); bodies
  from the model store in four visual styles, tried on `#/debug/kernel`.
  Settings are preferences. The viewport is a lazy chunk. Seam edges are
  flagged by the kernel facade and not drawn. ADR-0008.
- 2026-09-25 · **P0-04** Design system and app shell: brand tokens as CSS
  variables (Slate dark default, light) mapped into Tailwind v4, bundled
  Instrument Sans and JetBrains Mono, Radix wrappers (button, icon button with
  tooltip, menu, dialog, popover, inputs), two-tone icon pipeline (17 SVGs,
  rules test), platform preferences, shortcut registry, and the shell: app
  bar, toolbar tabs and groups, resizable and collapsible browser, viewport
  placeholder, timeline with working playback. Parameters dialog moved into
  the shell. Screenshot tests in both themes. ADR-0007.
- 2026-09-25 · **P0-07** Expressions and parameters: Pratt parser with
  source spans, length/angle dimensional analysis (mm and degrees; plain
  numbers take the context unit), the FR-PAR-02 functions, parameter graph
  with cycle paths and "did you mean", model parameters (`ExprInput.unit`),
  rename that rewrites references, refusal to delete a used parameter.
  `<ExpressionInput>` (live value, exact error underline, never commits an
  invalid draft) and the Parameters dialog at `#/debug/parameters`. 226 unit
  tests, Playwright E2E. ADR-0004.
- 2026-09-25 · **P0-06** Document model in `packages/core`: zod schema v1
  (strict objects, document invariants), `loadDocument` with a migration chain
  on raw JSON and a v0 fixture, branded IDs, feature registry types (core holds
  the data part; kernel and web extend it), commands with Immer patches, undo
  history with nested transactions (commit collapses, cancel reverts), and
  vanilla Zustand document/session/model stores. ADR-0003.
- 2026-09-25 · **P0-03** Solver spike (`spikes/p0-03-solver/`): planegcs in
  Node and the browser on a constrained rectangle and on generated 50–500-entity
  sketches; our own planegcs builds (the published one has a fixed 16 MB heap);
  per-component solving; SolveSpace (`slvs`) compared. ADR-0002: planegcs from
  our own build, one solver system per independent component, drag through
  temporary constraints on sketch parameters.
- 2026-09-25 · **P0-09** Kernel package: our trimmed OCCT WASM with a C++
  facade (shapes in an arena, flat result/history/mesh arrays, LGPL-2.1+),
  TS `Kernel` layer, Comlink worker, `KernelClient` that restarts the worker
  after a WASM abort, debug page `#/debug/kernel` rendering the test part.
  Memory test (1000 rebuilds + a leak control) and crash test in Vitest and
  Playwright. CI builds the WASM once per input hash and publishes it as a
  release (`pnpm occt ensure` downloads it).
- 2026-09-25 · **P0-02** Kernel spike (`spikes/p0-02-kernel/`): libcascade,
  replicad and brepjs/occt-wasm compared on the same scenario in Node and a
  browser worker, with sizes, load times, op timings, a memory test and a
  topological-naming history test. Built our own trimmed libcascade WASM
  (4.34 MB brotli, about 200 ms cold start). Found that libcascade's `delete()`
  often doesn't free C++-owned memory. ADR-0001: own trimmed build + a C++
  facade that owns memory + a thin TS layer.
- 2026-09-25 · **P0-01** Repo and toolchain: git, pnpm 12 monorepo (`apps/web`,
  `packages/{core,sketch,kernel,io,storage}`), TypeScript 7 strict, Biome 2.5,
  Vitest 5, Playwright 1.63, GitHub Actions CI, GPL-3.0 (+ MIT for `io`),
  package-boundary check, branded hello page.
