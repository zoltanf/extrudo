# 03 — Roadmap and Execution Plan

The work is split into **phases**. Each phase ends in a usable release, and each
phase is broken into **tasks** sized for one agent session: roughly a
half-day to two days of human-equivalent work. Every task has an ID,
dependencies, and acceptance criteria.

## How agents execute this plan

1. Pick the **lowest-numbered unchecked task whose dependencies are done**.
   Independent tasks in the same phase can run in parallel in separate
   worktrees.
2. Read `CLAUDE.md`, then the requirement IDs and architecture sections the
   task cites.
3. Implement with tests. A task is done only when its acceptance criteria are
   met, `pnpm check` (typecheck + lint + unit tests) passes, and E2E passes
   where the task touches UI flows.
4. Tick the box here, add a line to `docs/CHANGELOG.md`, and record any
   significant decision as an ADR. If something was tried and rejected, write
   it down so it isn't retried.
5. Spikes (marked ⚗) are timeboxed. Their output is an ADR plus throwaway code
   in `spikes/`, not production code.

Task sizing rule: a task that needs more than ~1 500 lines of changes gets
split before starting.

---

## Phase 0 — Foundations (→ v0.0 "empty workshop")

Goal: a running app with the Fusion-like shell, a navigable 3D viewport, a
project store, the parameter engine, and proof that the kernel and solver work
in the browser.

- [x] **P0-01 Repo and toolchain.** *(done 2026-09-25)* `git init`; pnpm via mise; monorepo
  skeleton per `02-architecture.md §3`; TS strict; Biome; Vitest; Playwright;
  GitHub Actions CI; `pnpm dev`, `pnpm check`, `pnpm e2e` scripts; `.editorconfig`;
  LICENSE placeholder.
  *AC:* `pnpm dev` serves a hello page; CI green on an empty test.
- [x] **P0-02 ⚗ Kernel spike.** Load OCCT WASM (`libcascade`) in a worker in
  the browser and in Node. Build a box, fillet an edge, run a boolean cut,
  tessellate, render with three.js, export STL and STEP. Compare raw
  `libcascade` with replicad and brepjs for API ergonomics, access to shape
  history (needed for topo naming), bundle size and load time.
  *AC:* ADR-0001 written with measurements; recommended approach chosen.
  **Done 2026-09-25:** our own trimmed libcascade build with a small C++ facade
  and a thin TS layer; replicad and brepjs as code references only. See
  `docs/adr/0001-geometry-kernel.md`.
- [x] **P0-03 ⚗ Solver spike.** *(done 2026-09-25)* planegcs in the browser: a rectangle with a
  coincident, horizontal and dimension constraint; drag a corner at 60 fps;
  read DOF and conflict info.
  *AC:* ADR-0002 with timings for 50/200/500-entity sketches.
  **Done 2026-09-25:** planegcs from our own WASM build (memory growth, current
  emsdk + SIMD, two pivoting patches), one solver system per independent
  component, drag through temporary constraints on sketch parameters. The
  rectangle and a 500-entity sketch drag at 60 fps; one coupled component of 200
  entities doesn't (12 fps). See `docs/adr/0002-sketch-solver.md`.
- [x] **P0-04 Design system and app shell.** *(done 2026-09-25, ADR-0007)* Theme tokens (from
  `docs/05-brand.md`: Slate dark default + light), typography, Radix wrappers (button, menu, dialog, tooltip, popover, input),
  and the icon pipeline (SVG → React components, colour per category). A static
  layout matching `04-ui-spec.md §2` with placeholder content.
  *AC:* Screenshot test of the shell in both themes; panels resize and collapse.
- [x] **P0-05 Viewport.** *(done 2026-09-25, ADR-0008)* R3F canvas; adaptive infinite grid; origin
  planes/axes/point; camera controls with Fusion mouse mapping and presets;
  ViewCube (click faces/edges/corners, home, animated transitions); nav bar
  (orbit, pan, zoom, fit, ortho/perspective, visual style, grid toggle).
  *AC:* FR-VP-01..04; E2E clicks the ViewCube "Top" face and asserts the camera
  orientation.
- [x] **P0-06 Document model and commands.** *(done 2026-09-25, ADR-0003)* `core`: zod schema v1, migrations
  scaffold, feature registry types, ID generation, command system with Immer
  patches, undo/redo stack, Zustand stores (document / session / model).
  *AC:* Unit tests for undo/redo round-trips and migration of a v0 fixture.
- [x] **P0-07 Expression and parameter engine.** *(done 2026-09-25, ADR-0004)* Pratt parser; units and
  dimensional analysis; functions; dependency graph with cycle detection;
  Parameters dialog (add, edit, delete, comment; live evaluated value; errors
  inline). Reusable `<ExpressionInput>` component.
  *AC:* FR-PAR-01 (user params), -02, -04; 100+ parser unit tests including
  unit errors (`10 mm + 5 deg` → error).
- [x] **P0-08 Project storage.** *(done 2026-09-25, ADR-0009)* `ProjectStore` interface; OPFS + IndexedDB
  implementation; `.extrudo` zip read/write; home screen (grid, new, open,
  rename, duplicate, trash); autosave with status indicator; persistent-storage
  request.
  *AC:* FR-PRJ-01, -02, -04, -05; E2E: create project, reload the page, the
  project is still there; export/import round-trip.
- [x] **P0-09 Kernel worker plumbing.** *(done 2026-09-25)* Production kernel package (from the
  spike's decision): worker bootstrap, Comlink API, OCCT disposal scopes, crash
  and restart handling, typed mesh transfer, a debug command that renders a test
  box. Per ADR-0001: our own trimmed OCCT build (`@libcascade/toolchain`,
  starting from `spikes/p0-02-kernel/custom-build/`) with a small C++ facade
  that owns OCCT memory (shapes in an arena, results and history as flat
  arrays), raw bindings only inside disposal scopes, a memory test (≥ 1000
  rebuilds on a small initial heap, plus a leak control that must fail), CI
  that can build the WASM (Docker). Upstream leak report:
  [taucad/opencascade.js#40](https://github.com/taucad/opencascade.js/issues/40); check its status first.
  *AC:* NFR-03 crash test (forced abort → worker restarts, app survives);
  memory test green.
  **Done 2026-09-25:** `packages/kernel` with the facade in `occt/facade/`,
  `Kernel` (TS layer), `KernelService` (worker side), `KernelClient`
  (restart on crash), and a debug page at `#/debug/kernel`. The WASM is built
  once per input hash by CI and downloaded by `pnpm occt ensure`. Memory test:
  0 bytes of heap growth over 2000 rebuilds. See ADR-0001, *Follow-up: P0-09*.

**Phase 0 exit:** the app opens to a home screen; a new project shows the
viewport; navigation feels like Fusion; save and reload work; the kernel renders
a test solid.

---

## Phase 1 — Sketching (→ v0.1 "draw it")

Goal: full parametric 2D sketching with constraints, dimensions and SVG export.
Benchmark **B1** buildable.

- [x] **P1-01 Sketch feature and sketch mode.** `sketch` feature type and
  `SketchData` schema; "Create Sketch" (pick an origin plane with hover
  highlight) → Look At animation → sketch-mode UI (toolbar swaps to the Sketch
  tab, sketch palette, green "Finish Sketch"). Browser tree "Sketches" folder.
  *Deps:* P0-05, P0-06. *AC:* FR-SK-01 (origin planes), FR-VP-07 (partial).
  Done 2026-09-25 (ADR-0010): the plane is a `ref` input, `SketchData` holds
  points, lines, circles, arcs and every constraint and dimension type as
  records; sketches open by double-click in the browser or timeline too.
- [x] **P1-02 Sketch tool framework.** Tool state-machine base, sketch-plane
  raycasting, snapping/inference engine (endpoint, midpoint, center, on-curve,
  intersection, H/V alignment with dashed guides, grid), heads-up numeric input
  (length/angle, Tab, Enter, Esc), preview rendering, auto-constraint emission.
  *AC:* FR-SK-05, -06; unit tests of the inference engine.
  Done 2026-09-26 (ADR-0012): `infer` in `@extrudo/sketch/inference` with
  unit tests for every snap kind and the priorities; snaps and alignments
  become constraints, each test-solved with `SketchSolver.check` before it
  is committed, and the sketch is solved in the same `addToSketch` step.
  Tools are plain state machines driven by a host; picking by our own ray
  math; an SVG overlay for preview, guides and snap glyphs; the heads-up box
  with `<ExpressionInput>`s (a typed length becomes a dimension). The Line
  tool (`L`, chained, closes on its first point) is the reference tool;
  "Snap to grid" in the palette.
- [x] **P1-03 Solver integration.** `sketch` package planegcs adapter (ADR-0002):
  our planegcs WASM build (from `spikes/p0-03-solver/planegcs-build/`, built in
  CI once per input hash like OCCT); map every entity and constraint type
  (endpoint tangency as `angle_via_point`); one persistent solver system per
  connected component, re-solving only affected components; drag solving
  (temporary constraints on two sketch parameters, updated per frame, no
  rebuild); DOF count; conflict and redundancy reporting, with a test-solve
  before a new constraint is committed.
  *Deps:* P0-03. *AC:* one unit test per constraint type; drag solve < 8 ms at
  200 entities in independent components, and < 16 ms for a single component
  of up to 100 entities; a gear-outline fixture (one closed loop, 100+ curves)
  measured and recorded.
  Done 2026-09-26 (ADR-0011): `SketchSolver` in `packages/sketch` maps every
  entity, constraint and dimension type, splits components with fixed
  geometry as constants, solves only what changed, drags without rebuilds and
  test-solves new constraints (`check`). The WASM builds in CI like OCCT
  (`pnpm planegcs`). Drag steps: 0.18 ms at 198 entities in 22 components,
  11.4 ms for one 99-entity component; the 104-curve gear drags at about 1 s
  per step (risk register). Debug page `#/debug/solver`.
- [x] **P1-04 Basic drawing tools.** Line (chained, tangent-arc drag), rectangle
  (2-point, 3-point, center), circle (center, 2-point, 3-point), arc (3-point,
  center, tangent), point, construction toggle (X).
  *AC:* FR-SK-02 (subset), -04; E2E draws each.
- [x] **P1-05 More drawing tools.** Polygon (3 modes), slot (2 modes), ellipse,
  fit-point spline.
  *AC:* FR-SK-02 complete, FR-SK-03 (fit-point).
- [x] **P1-06 Constraints UI.** Constraint tools in the toolbar and palette;
  glyph rendering next to geometry (with a hover pair-highlight); select and
  delete constraints; "show constraints" toggle.
  *AC:* FR-SK-07.
- [x] **P1-07 Dimensions.** Sketch Dimension tool (`D`) that infers the dimension
  type from the selection; placement drag; inline edit with `<ExpressionInput>`;
  driving vs driven; auto model-parameter naming (`d1`…); dimension appears in
  the parameters table.
  *Deps:* P0-07. *AC:* FR-SK-08, FR-PAR-03 for sketches.
- [x] **P1-08 Constraint status and coloring.** Blue (under-constrained),
  black/white (fully constrained), red (conflict); DOF display in the palette;
  over-constraint dialog offering to make the dimension driven.
  *AC:* FR-SK-09.
- [x] **P1-09 Selection and editing in sketch.** Click and box select (window vs
  crossing); drag geometry with live solve; delete with constraint cleanup;
  a properties panel for the selected entity.
  *AC:* FR-VP-05 (sketch part). *Done 2026-09-27, ADR-0018.*
- [x] **P1-10 Modify tools.** Trim, extend, break, sketch fillet, sketch
  chamfer, offset (with a dimension), mirror (with a symmetry constraint),
  move/copy, rectangular and circular pattern, scale.
  *AC:* FR-SK-10; unit tests on the geometry operations. *Done 2026-09-27,
  ADR-0019. Not yet: trimming ellipses and splines, line–arc fillets,
  round offset joins, pattern instances tied to the original's position.*
- [x] **P1-11 Profile detection.** TS planar arrangement → closed regions with
  nesting; shaded profile display; hover and select profiles; stable region IDs.
  *AC:* FR-SK-11; unit tests with overlapping and nested shapes.
- [x] **P1-12 Timeline v1 and browser tree.** Timeline bar with sketch chips;
  double-click to edit a sketch; rename, delete, suppress; hover highlight.
  Browser tree: origin, sketches, visibility toggles.
  *AC:* FR-TL-01, -03 (partial), FR-VP-07.
- [x] **P1-13 SVG and DXF export.** Export the selected sketch (or its
  profiles) to SVG at 1 mm scale, with construction geometry optional; DXF R12
  export.
  *AC:* FR-SK-15, -16; golden-file tests; the SVG opens at the correct size in
  Inkscape. *Done 2026-09-27, ADR-0022. Size checked in Inkscape 1.4.4 (100 × 60 mm
  plate: 100 × 60 mm page), DXF with ezdxf's audit. Not yet: export from model-mode selection or the File menu.*
- [x] **P1-14 Command search and shortcuts v1.** Shortcut registry with
  Fusion defaults (`L R C A P D T O X E` …); `S` toolbox and Ctrl+K palette
  (fuzzy search over commands).
  *AC:* FR-UX-03 (partial).
- [x] **P1-15 Benchmark B1 E2E.** Playwright builds B1 through the UI, changes a
  user parameter, asserts the sketch updates and the SVG export matches.
  *Done 2026-09-27 (`e2e/benchmark-b1.spec.ts`): user parameters `width`, `depth`,
  `spacing`, `hole` and `margin = (width - spacing) / 2`; a rectangle fixed at the
  origin and four circles (inferred alignments), three Equal constraints and seven
  dimensions typed as expressions make it fully constrained. `spacing` changes from
  the command palette inside the sketch, `width` from the toolbar outside it; after a
  reload the labels and the exported SVG's paths match the expected plate exactly.*

**Phase 1 exit (v0.1):** a user can make a fully constrained parametric sketch,
drive it with parameters, save it, and export SVG.
*Met 2026-09-27: P1-01 to P1-15 done; B1 passes end to end.*

---

## Phase 2 — Solids (→ v0.2 "first print")

Goal: turn sketches into bodies, edit history, and export printable STL, 3MF
and STEP. Benchmarks **B2** and **B3** buildable.

- [x] **P2-01 Recompute engine.** Timeline walk in the worker; per-feature
  status; input hashing and shape cache; cancellation; debounced previews;
  modelStore updates; error display.
  *Deps:* P0-09. *AC:* recompute of a 30-feature fixture edited at feature 25
  re-evaluates only 25–30 (asserted via counters).
  *Done 2026-09-27* (ADR-0024): content-keyed cache with reference-counted
  shapes, body access per feature, cancellation at yields, previews,
  `Recomputer` on the UI thread, status glyphs on timeline chips.
- [x] **P2-02 Sketch → kernel.** Sketch curves → OCCT edges/wires; OCCT-based
  authoritative profile faces with persistent region IDs; sketch plane
  placement.
  *Done 2026-09-27* (ADR-0025): exact lines, arcs, ellipses and splines in
  the facade, split by General Fuse into faces placed in the sketch plane;
  their region IDs match `detectProfiles` over a 28-sketch corpus; the
  sketch's output has a face per profile and the sketch curve of each
  face edge for P2-04.
- [x] **P2-03 B-rep rendering and 3D selection.** Body meshes with face ranges,
  edge lines, vertices; pre-highlight; selection of faces, edges, vertices and
  bodies; selection filter menu; "select other" long-press list.
  *AC:* FR-VP-05 (3D part).
  *Done 2026-09-28* (ADR-0026): pure picking over the meshes (a
  three-mesh-bvh ray cast for faces, screen-space distance for edges and
  vertices, occlusion by a second ray), hover and click/Shift/Ctrl
  selection in the session store, window and crossing boxes that take one
  kind, face tints through a colour attribute, accent overlays for edges and
  vertices, "Select other…" on a long press or right-click, the selection
  filter with the nav bar's Select, the status bar summary; sketch curves
  and profiles are picked in the model too. Faces, edges and vertices are
  mesh indices turned into `GeomRef`s through `BodyMesh.faceIds`/
  `edgeIds`/`vertexIds` (filled by P2-04). E2E on the kernel debug
  page's test part until extrude makes bodies.
- [x] **P2-04 Topological naming v1.** Persistent-ID generation for extrude and
  revolve; propagation through booleans via OCCT history; fingerprints;
  reference resolution API used by every feature.
  *AC:* ADR-0005; topo-naming test suite (≥ 15 scenarios) green.
  *Done 2026-09-27* (ADR-0005): faces named by why they exist
  (`extrude:E:side:<curve>`, `…:cap:end`) and carried through booleans and
  fillets by OCCT history, split pieces `#n` in a geometric order, edges and
  vertices named after their faces; facade sweeps with history, simplifying
  booleans, `describe`; naming tables in the shape cache and on
  `BodyMesh`; `GeomRef.fingerprint`; `ctx.resolve` (exact, related name,
  fingerprint with a warning, else an error); `KernelApi.reference`. A
  19-scenario suite and a 1000-rebuild memory test.
- [x] **P2-05 Feature dialog framework.** Right-side command dialog: selection
  fields (with count, clear, filter), `<ExpressionInput>` fields, dropdowns,
  OK/Cancel, live preview, validation messages; in-canvas manipulators (distance
  arrow, angle arc) with a heads-up value box.
  *Done 2026-09-28* (ADR-0027): declarative dialog specs registered in
  `featureDialogs()` (their tool's command then runs, and timeline chips
  open them for editing); one generic, draggable, non-modal dialog with
  selection, expression, choice and toggle fields; pre-selection;
  selection fields of persistent references with fingerprints and their
  own selection filter; model parameter names per dialog; live previews
  through the `Recomputer`, drawn as ghosts from the kernel's new
  `previewTools` (new, join green, cut red, intersect), dimmed with the
  last good result on invalid input or a kernel error (whose message the
  dialog shows); editing shows the model rolled back to the feature
  (`preview(…, base)`); a distance arrow and an angle arc with a heads-up
  box that takes typing; OK as one command (insert, or replace the
  inputs). E2E on the dialog debug page (`#/debug/dialog`, a test
  press-pull) until Extrude has its dialog.
- [x] **P2-06 Extrude.** All options in FR-FT-01; cut preview shown red; face
  extrude (press-pull on planar faces).
  *AC:* FR-FT-01; kernel golden tests for each option combination.
  *Done 2026-09-28* (ADR-0028): core `extrude` feature (profiles or flat
  faces; one side, symmetric, two sides; distance, to object, through
  all; taper per side; flip; new body, join, cut, intersect with
  automatic or picked bodies) and its kernel evaluator (profiles fused
  first, tapers by `BRepOffsetAPI_DraftAngle` with a too-steep check,
  inclined to-object faces by trimming, every face named, the swept tool
  as a preview tool; 108-case golden table, 1000-iteration memory test).
  The Extrude dialog on the P2-05 framework: fields named like the
  inputs, distance arrows per side (halved when symmetric) and taper
  arcs, previews styled by the operation; press-pull proposes join
  outwards and cut inwards until the user picks an operation (a new
  `propose` hook in dialog specs). The browser's Bodies folder lists the
  model's bodies ("Body1"… without stored names). The Wall bracket
  template computes its bracket (symmetric L, tapered holes cut).
  E2E in a real project (`e2e/extrude.spec.ts`).
- [x] **P2-07 Revolve.** FR-FT-02.
  *Done 2026-09-28* (ADR-0029): core `revolve` feature (profiles or flat
  faces; an origin axis, a sketch line, construction or not, or a
  straight body edge; one side, symmetric, two sides; an angle, a whole
  turn by default; flip; new body, join, cut, intersect with automatic or
  picked bodies) and its kernel evaluator (axis in the profiles' plane,
  profiles on one side of it by half-plane overlap, symmetric and
  two-sided turns as one sweep from the profile turned to its start, so
  every face is named like a one-sided revolve; sketch-line axes placed
  by the sketch output's frame and its new `lines` table; extrude's
  sources and body operations moved to shared modules unchanged; 36-case
  golden table, a 300-recompute memory test). The Revolve dialog on the
  P2-05 framework, with an angle arc about the axis that goes on round a
  whole turn (symmetric at half the angle, one arc per side); the origin
  axes are pickable and highlighted in the model; pre-selection fills
  every field that takes part of the selection (profile and axis). E2E in
  a real project (`e2e/revolve.spec.ts`).
- [x] **P2-08 Bodies.** Browser "Bodies" folder; rename, visibility, colour and
  appearance; delete body (as a "Remove" feature); body count badge.
  Silhouette edges of curved faces (view-dependent) in the wireframe and
  hidden-edge styles; seams are already hidden (ADR-0008).
  *Done 2026-09-28* (ADR-0030): every body gets stored metadata when a
  recompute first shows it ("Body3", the lowest free number), amended into
  the undo step that made it (`DocumentState.amend`), so names never
  shift and undo takes them along; the Bodies folder with a count badge,
  colour dots, rename (F2 or the menu), eyes, Appearance (ten colour
  swatches and four opacities), rows that pick the body into the
  selection or an open dialog and highlight it on hover; Delete (browser,
  menu, or the view's selection) adds a **Remove** feature (core
  definition, kernel evaluator, a Modify chip), and a feature whose
  bodies a later one names can't be deleted. A cut or intersect that
  leaves separate solids makes one body per solid (`splitSolids`, the
  largest keeps the ID, the rest `<feature>:<n>`). Bodies draw with their
  colour and opacity; wireframe and hidden edges draw curved faces'
  silhouettes as the zero line of `n · (eye − p)`, updated with the
  camera. E2E in `e2e/bodies.spec.ts`.
- [x] **P2-09 Sketch on face and project/include.** Sketch on a planar face
  (follows the face through recompute); Project tool (associative edges and
  silhouettes into the sketch).
  *Deps:* P2-04. *AC:* FR-SK-01 (faces), FR-SK-12.
  *Done 2026-09-28* (ADR-0031): Create Sketch picks the nearer of a flat
  face and an origin plane (or takes a selected flat face at once); the
  face is a persistent reference, and the kernel resolves it on every
  recompute and derives the frame by one rule (origin = world origin on
  the plane, floors and roofs X along world X, walls Y up the face,
  switching at 40° tilt), published as `SketchOutputData.frame` and, new,
  as a per-feature report to the UI (`ModelState.sketches`; the
  fingerprint's frame until then). The Project tool (P) picks body edges
  and faces (on the bodies before the sketch) and stores a projection
  record; the kernel projects exactly (lines, arcs, ellipses, splines,
  circles seen edge-on as lines) plus cylinder and cone silhouettes (new
  facade ops `edgeGeometry`, `faceSilhouettes`), and the app syncs the
  projected curves (ordinary entities, held fixed by the solver, drawn in
  the construct colour) and re-solves the sketch, amended into the undo
  step that moved the model. A profile on a face proposes join or cut
  like the face. Kernel, core, host and e2e tests
  (`e2e/sketch-on-face.spec.ts`: a hole cut from a top-face sketch that
  rides up with a taller box; a projected face following a taper).
- [x] **P2-10 Primitives.** Box, cylinder, sphere, torus with placement on a
  plane or face.
  *AC:* FR-FT-03.
- [x] **P2-11 Timeline v2.** Rollback marker (drag + playback buttons);
  insertion at the marker; edit-feature reopens its dialog; reorder by drag with
  dependency validation; error and warning chips; "fix references" flow.
  *AC:* FR-TL-02..05.
- [x] **P2-12 STL, 3MF and STEP export.** Export dialog (bodies, format,
  resolution presets); binary STL; 3MF with objects, names, colours and units
  (verified in Bambu Studio, OrcaSlicer and PrusaSlicer); STEP AP242.
  *AC:* FR-IO-02..04; an automated manifold check on exported STL.
  *Done 2026-09-28* (ADR-0034): the kernel meshes a copy of each body at
  the export's deviation and welds it through the topology (closed,
  manifold, checked by `checkManifold` in `@extrudo/io` in unit and e2e
  tests); binary STL and 3MF (objects, names, millimetres, colours as a
  materials-extension colour group, per triangle too) in `@extrudo/io`;
  STEP AP242 with named products from the facade. PrusaSlicer 2.9.6,
  OrcaSlicer 2.4.2 (CLI), lib3mf 2.5 (strict) and FreeCAD 1.1.3 read the
  files cleanly; Bambu Studio and colours in the slicer GUIs are a manual
  check still to do.
- [x] **P2-13 Measure and inspect.** Measure tool (distance, angle, radius, area,
  volume); selection bounding-box readout in the status bar.
  *AC:* FR-3DP-01. Done 2026-09-29 (ADR-0035): exact measures from the
  kernel (`KernelApi.inspect`); two plain clicks measure between two
  things; the status bar shows the selection's size.
- [x] **P2-14 Version history.** "Save version" with a description; version list
  panel; open or restore an old version.
  *AC:* FR-PRJ-03. Done 2026-09-29 (ADR-0036): Ctrl+S opens the Versions
  dialog; Restore is one undo step and keeps the current state as a
  version first; Open copy opens a version as a new design; versions
  travel in `.extrudo` files.
- [x] **P2-15 WASM size and startup.** Custom trimmed OCCT build; service worker
  precache (PWA); measure against NFR-02. The trimmed build itself moved to
  P0-09 (ADR-0001: 4.34 MB brotli, about 200 ms cold start); this task trims
  further and adds the precache.
  *AC:* NFR-02, NFR-06. Done 2026-09-29 (ADR-0037): a hand-written service
  worker precaches the app, both WASM files and every lazy chunk (build
  plugin lists them; updates keep one generation of old files), a web app
  manifest and icons, registration through `platform/` in production
  builds only; the OCCT build binds only the facade (no raw classes, built
  by CI: WASM 20.19 to 15.76 MB raw, 4.52 to 3.69 MB brotli, cold start
  about 2.5 times faster); measured with `scripts/measure-startup.mjs` at
  50 Mbit: 4.9 MB brotli in all (5.7 MB before the trim), first visit home
  screen 0.8 s, repeat visit 0.22 s, kernel ready 1.1 s after opening a
  project.
- [x] **P2-16 File-format spec.** Write `docs/file-format.md` from the zod
  schema. Done 2026-09-29: `docs/file-format.md` specifies the `.extrudo` zip
  (entries, manifest, versions, import rules), format versioning and
  migrations, every document field, feature type and input, sketch data,
  references and names, with a complete example. A test
  (`packages/storage/src/file-format-doc.test.ts`) loads the example through
  the real schema and fails when a key, type or enum value is undocumented.
- [x] **P2-17 Benchmarks B2, B3 E2E.**
  *Done 2026-09-29* (ADR-0039): B2 (storage box: parameters, sketch on XY,
  extrude, sketch on the top face with the outline projected and four
  `wall` dimensions, cut by `height - bottom`; 3MF and STL closed, exact
  size and volume) and B3 (phone stand: base plate, a tilted back rest
  dimensioned by `setback`, `base`, `rest`, `rise` and the angle `tilt`,
  two bodies, then one by a join that bridges them; 3MF) are built through
  the UI in `e2e/benchmark-b2.spec.ts` and `-b3`; their designs, and B1's,
  are the fixtures in `fixtures/benchmarks/`, recomputed headless by
  `packages/kernel/src/benchmarks.test.ts`. B3's merge became a real
  Combine in P3-06.

**Phase 2 exit (v0.2):** the first real printable parts; the classic
parametric box exported as 3MF opens in a slicer and prints.

---

## Phase 3 — Modify and construct (→ v0.3 "real CAD", the MVP)

Goal: the modify toolset that makes parts printable and pretty. Benchmarks
**B4–B7**. This is the first public release candidate.

- [x] **P3-01 Fillet** (constant radius, edge sets, tangent chains; preview;
  friendly failure messages with a suggested max radius). FR-FT-04, FR-UX-06.
  *Done 2026-09-29* (ADR-0038): up to eight edge sets per fillet, each with
  its own radius expression (`edges`/`radius`, `edges2`/`radius2` …); picking
  an edge brings its whole tangent chain, because OCCT rounds chains (the
  dialog asks the kernel, `KernelApi.tangentChain`); live preview; the facade
  builds the fillet on its stack and, when it fails, finds the failing chains
  and the largest radius that works by bisection, so the message reads
  "Radius 50 mm is too large for edge 12 (max ≈ 19 mm)" (also: an edge that
  can't be filleted, two radii in one chain, fillets that collide at a
  corner). Faces are named `fillet:<id>:from:(<edge>)`; lost edges are
  references Fix References can repair. The Wall bracket's Fillet1 now
  computes (two sets: the bend's inside and outside corners). No on-canvas
  radius handle and no variable radius yet.
- [x] **P3-02 Chamfer** (3 modes). FR-FT-05. *Done 2026-09-29* (ADR-0043):
  up to eight edge sets per chamfer, each with its own type and values:
  equal distance, two distances (distance 1 goes on the edge's lower-numbered
  face, Flip takes the other) and distance and angle; picking an edge
  brings its tangent chain (fillet's query); live preview; the facade builds
  the chamfer on its stack and, when it fails, finds the failing chains and
  the largest factor their distances take by bisection, so the message reads
  "Distance 50 mm is too large for edge 12 (max ≈ 19 mm)" (also: two
  distances, distance and angle, an edge that can't be chamfered, two
  settings in one chain, chamfers that collide). Faces are named
  `chamfer:<id>:from:(<edge>)`; lost edges go through Fix References. The
  Modify group's Chamfer tile is ready; it has no default key. No on-canvas
  handles and no pickable reference face (a default and Flip).
- [x] **P3-03 Shell.** FR-FT-06. *Done 2026-09-30* (ADR-0046): pick faces to
  remove (openings, on one or several bodies), a thickness expression and a
  direction (inside, the default, or outside); with no face a body picked in
  the Body field is hollowed closed, a sealed void. The facade's `shell`
  builds it with `BRepOffsetAPI_MakeThickSolid` on the stack and on a copy of
  the body, and checks the result by its distance to the faces it was offset
  from (OCCT builds valid junk when a wall is thicker than a curved face's
  radius); on failure it bisects the thickness, so the message reads "A 12 mm
  wall is too thick for this body (max ≈ 9.9 mm)". A removed face that runs
  smoothly into a neighbour (next to a fillet) is refused before OCCT runs,
  because OCCT corrupts its heap there. The outer skin keeps the original
  face names in both directions; new faces are `shell:<id>:inner:(<face>)`,
  `:rim:(<removed face>)` and `:round:(<edge>)`. The Modify group's Shell tile
  is ready; it has no default key. No on-canvas handle and one thickness for
  the whole shell.
- [x] **P3-04 Hole** (placement by sketch points or click; types; presets incl.
  heat-set inserts). FR-FT-07. *Done 2026-09-30* (ADR-0049): the `hole`
  feature (H, Solid › Create's menu) drills simple, counterbored or
  countersunk holes, blind (with a drill point of 118° by default, 0° for a
  flat bottom) or through all, from a plane or flat face, at the point you
  click on the face (X and Y in the face's frame) or at picked sketch points
  (dropped onto the plane). Presets fill the sizes: M2 to M8 clearance (normal
  fit, with the socket-head counterbore and flat-head countersink) and
  heat-set inserts M2 to M5; nothing about a preset is stored. Each hole is a
  turned half section (no facade change); faces are `hole:<id>:side:<part>`
  and survive size changes; a hole that misses the body says so (an error when
  none reaches it, a warning when some do not); patterns and mirrors repeat a
  hole as a feature. Sketch points are pickable in the model view while a
  dialog's Points field picks. Open: a `bodies` input, several clicked points
  in one feature, vendor insert lists, close/coarse fits.
- [x] **P3-05 Construction geometry** (all planes, axes and points in
  FR-FT-13; browser "Construction" folder). Done 2026-09-29 (ADR-0040): nine
  timeline features (offset plane, plane at angle, midplane, plane through 3
  points, tangent plane, axis through 2 points, through a cylinder, along an
  edge, and point) with dialogs and live previews, computed in the kernel
  from geometry it already reports (no facade change). They are referred to
  by their feature ID (`plane`, `axis`, `point` references), so sketches,
  primitives, extrude "to object" and revolve axes use them, the timeline
  orders and protects them, and lost references go through Fix References.
  The view draws and picks them; the browser's Construction folder lists
  them with eyes; the `point` reference kind is now used.
- [x] **P3-06 Combine, Move/Copy** (with transform gizmo) **and Mirror.**
  FR-FT-09, -10, -11 (mirror). *Done 2026-09-30* (ADR-0044): **Combine**
  joins, cuts or intersects a target body with tool bodies (tools used up
  unless kept; a join of bodies that don't touch, a cut that removes nothing
  and an empty intersection say why); **Move/Copy** has a free mode (X, Y, Z
  distances and turns, with an in-view gizmo: an arrow and a ring per axis),
  a rotate-about-axis mode (origin or construction axis, straight edge,
  sketch line) and point to point, and a copy option that keeps the original;
  **Mirror** about an origin or construction plane or a flat face, as a copy
  (default), in place or joined to the original. One new facade method,
  `transform` (a 3 × 4 matrix through `BRepBuilderAPI_Transform` with
  history), so faces keep their names through a move or mirror; copies get
  names of their own so references stay unambiguous. B3 now merges its two
  bodies with a real Combine (fixture rewritten). Mirroring *features* came
  with the patterns (P3-07).
- [x] **P3-07 Patterns** (rectangular, circular, on path) for bodies, features
  and faces. FR-FT-11. Done 2026-09-30 (ADR-0047): Rectangular, Circular and
  Path Pattern in Solid › Create's menu. A pattern copies bodies (new bodies,
  or Join: fused into the original) or repeats *features*: the tool of an
  extrude, revolve or primitive that joins or cuts is copied to every instance
  and joined or cut like the feature did (the dialog lists the eligible
  features; reference kind `feature`). Rectangular: one or two directions
  (axis, straight edge, sketch line), count and distance (between neighbours
  or first to last), symmetric; circular: axis, count, whole angle or angle
  between instances; path: sketch curves and edges chained end to end,
  spacing or extent, optionally turning with the path. Counts and distances
  are expressions; the original counts as an instance. Instance faces are
  `pattern:<id>:<label>:from:(<name>)`, labelled by position, so names and
  body IDs stay when counts grow. Many instances go through one boolean
  (interfering instances are fused in trees first): a 10 × 10 pattern takes
  0.5 to 2 s. Mirror got the same features mode. Ghosts in the preview, a
  distance arrow per direction and an angle ring. No facade change. Not
  built: patterns of faces, a skip list.
- [x] **P3-08 Press/Pull, Offset face, Split body, Scale, Draft.** FR-FT-08,
  -12. **First half done 2026-09-30 (ADR-0051): Press/Pull and Offset Face.**
  Solid › Modify has Press Pull (Q, the marking menu's wedge, Ctrl+K), which
  opens the dialog that fits the selection with it filled in: a face opens
  Offset Face, an edge Fillet, a sketch profile Extrude (a profile wins over a
  face over an edge); with nothing usable selected it says what to select. Offset
  Face (a new feature `offsetFace`: `faces`, `distance`, positive out along the
  outward normal) moves faces of any kind, the neighbours extended or trimmed
  to follow: a pad grows or sinks, a cylinder wall changes its radius, a hole
  narrows or widens, and the faces that run smoothly into a picked face (fillets)
  move with it (the dialog picks the chain and shows it). Built by OCCT's offset
  with per-face values and sharp joins in a new facade method `offsetFaces`
  (plus `tangentFaces`); junk OCCT calls valid is refused by a distance test,
  a failure says the largest distance that works, and **every face keeps its
  name**, so fillets and holes after an offset survive editing it. Press-pull's
  proposal is one rule for Extrude and Revolve now (`features/operation.ts`):
  a face turned into its body, or a profile drawn on a face swept into it,
  proposes a cut, out of it a join. Not done: patterns of faces (they don't fall
  out of Offset Face, see the ADR). **Left for the second half:** Split body
  (by a plane or face), Scale (uniform and non-uniform), Draft; open items of
  ADR-0051 (a distance per face, solids with a sealed void, bodies whose
  rounded edges meet at a sharp corner, self-intersecting offsets, face
  patterns). Big enough to run as two agent tasks. **Second half done
  2026-10-01 (ADR-0053): Split Body, Scale and Draft**, in Solid › Modify's
  menu. Split Body cuts bodies along an origin or construction plane or a
  flat face's plane; each side is a body (the largest keeps the body), or one
  side is kept; faces cut in two are `#1`/`#2`, the new ones
  `split:<id>:cut:above|below`. Scale works about a vertex, a construction
  point or the bodies' box centre, by one factor or one per axis, in place or
  as a copy; a per-axis scale keeps flat faces flat and straight edges
  straight (OCCT makes everything B-splines; the facade puts planes and lines
  back). Draft tilts flat, cylindrical and conical faces about a neutral plane
  (its normal the pull, Flip), with an angle arc in the view; drafts whose
  faces cross are refused with the largest angle that works. New facade
  methods `scale` and `draft`; every face keeps its name through all three.
  Left open (ADR-0053): drafting next to fillets, splitting by curved faces or
  bodies, cylinders scaled along their axis stay B-splines, B-spline volumes
  0.8 % off in measurements.
- [x] **P3-09 Section analysis.** FR-VP-06. Done 2026-09-30 (ADR-0045):
  Solid › Inspect › Section Analysis (Shift+S, Ctrl+K) cuts the view at an
  origin plane, a construction plane or a flat face, with an offset
  expression along the normal, a Flip, and a draggable arrow in the view.
  The cut is capped (stencil buffer, per body: the body's colour towards
  the Inspect teal, screen-space hatch in `ink`, readable in both
  themes); faces, edges, silhouettes and dialog previews are clipped, the
  grid, origin and sketches aren't, and picking skips what is cut away
  and what the cap hides. The section is view state in the viewport store
  (not in the document, not undoable), survives recomputes and edits, and
  is turned off and on, edited or removed from the browser's Analysis
  folder; a selected flat face takes it at once ("Section Here" in the
  context list). Model mode only; a sketch is drawn without it.
- [x] **P3-10 3D-print aids:** mass properties with filament presets, overhang
  shading, place on bed. FR-3DP-02..04. Done 2026-09-30 (ADR-0048): 3D Print ›
  Prepare has Print Info (volume, weight and filament length of the selected or
  all shown bodies from the kernel's exact volumes; PLA 1.24, PETG 1.27, ABS 1.04,
  TPU 1.21 g/cm³ or a custom density expression; 1.75 or 2.85 mm filament; kept
  in the `print.material` preference; "solid, 100 % infill" — since P4-12 it
  estimates a print with walls and infill and costs it, see the P4-12 item
  below), Overhang Analysis
  (view state like the section: faces whose normal points more than N° (an
  angle expression, 45° default) below the horizontal for a chosen down
  direction (-Z default) are shaded in the error colour by a shader patch, faces
  on the lowest level are not overhangs; counts in `data-overhang`; a row in the
  browser's Analysis folder) and Place on Bed (a new feature `placeOnBed`, one
  flat face: the kernel turns its body by the smallest rotation so the face lies
  on z = 0 facing down, recomputed from the face on every change; context entry
  on a flat face; undoable, exports as it lies). No facade, schema-version or
  migration change.
- [x] **P3-11 Marking menu** (right-click radial) and context menus
  everywhere. FR-UX-03. Done 2026-09-29 (ADR-0042): a right-click without
  movement opens a ring of eight wedges (model: Sketch, Extrude, Fillet,
  Move, Press Pull, Undo, Repeat last, Delete; sketch: Line, Rectangle,
  Circle, Dimension, Trim, Undo, Construction, Finish Sketch) and a list
  below it that depends on what is under the pointer or selected (Select
  other…, Sketch on Face, Measure, Hide Body, Appearance…, Export…, view
  commands over empty space; Cancel, Delete, Look At Sketch in a sketch).
  Wedges are command IDs in two tables, dimmed until the command exists
  (Fillet, Move, Press Pull); click, aim-and-click or press-drag-release
  (flick) picks; arrows, Tab, Enter and Esc work; right-drag still
  navigates; "Right-Click Menu: Use a List" in Ctrl+K turns the ring into a
  plain list. Repeat last repeats the last tool started through commands.
  Folders, origin rows, parameter rows and design cards got context
  menus.
- [x] **P3-12 Onboarding:** first-run tutorial, template gallery (B2, B4, B5 as
  starters), tool tooltips with animated demos. FR-UX-04, -05. Done 2026-10-02
  (ADR-0052): the home screen has a "Take the tour" card (once) and a row of
  four templates (Wall bracket and B2, B4, B5 from the benchmark fixtures, each
  with a picture, a copy under a new ID); a five-step tutorial (sketch,
  rectangle, dimension, extrude, fillet) whose steps are read from the design
  (Help, Ctrl+K "Tutorial"); a hint over an empty design; tooltips carry a
  looping WebM demo for twelve tools, fetched when the tooltip opens and not
  precached, recorded from the app by `pnpm demos`. Open: demos for the tools
  that sit only in menus, a menu-item tooltip, i18n of the new strings.
- [x] **P3-13 Hardening pass:** robustness fuzzing (random parameter changes on
  fixtures must not crash), perf profiling against NFR-01, accessibility audit.
  Done 2026-09-30 (ADR-0050): every item below, with the numbers in the ADR.
  The silhouette pass is 3× faster and stays on the frame path; a facade
  list-fuse was measured and rejected (slower than cutting per colour class of
  the interference graph, which needs no facade change and is left for P3-17,
  since it lives in `features/pattern.ts`). The warm-cache heap levels off for
  the fixtures but keeps growing (about 11 MB per 100 recomputes) for
  ADR-0029's revolve document; no shape leaks, the allocator and cache size
  don't cure it, and it is left open (P3-17). Also carried over (2026-09-30):
  - WASM heap growth with a warm engine cache (ADR-0029): measure a long
    scripted editing session in the browser; if it keeps growing, trim the
    cache or cap OCCT's allocator blocks.
  - Silhouettes recomputed per frame on big meshes (ADR-0030), and
    overlapping curved pattern instances (7.9 s for 10 × 10, ADR-0047):
    profile; a facade call that fuses a list of shapes at once, and
    silhouettes off the per-frame path.
  - Export meshes in one blocking call (ADR-0034): chunked meshing with
    progress and Cancel.
  - `manifest.formatVersion` isn't checked on read, and strict schemas make
    older readers reject newer optional fields (`docs/file-format.md`): warn
    on a newer file version, read unknown optional keys leniently, tests.
  - Versions (ADR-0036): two tabs can lose an index entry (lock across tabs
    with the Web Locks API); Delete / prune versions.
  - The first new error of a recompute becomes a notification, so it is in
    the history (ADR-0041).
- [x] **P3-14 Benchmarks B4–B7 E2E.**
  *B4, B5 and B7 done 2026-09-30* (ADR-0039 amendment), built through the UI
  in `e2e/benchmark-b4.spec.ts`, `-b5`, `-b7`, exported as fixtures and
  recomputed headless: B4 (box with a lid that fits: Box, Shell, bottom
  Chamfer, an offset plane at the rim carrying the lid, a lip joined under
  it `clearance` inside the cavity, filleted top; two bodies in the 3MF, the
  gap on each side equal to `clearance` before and after it changes), B5
  (PCB enclosure: shelled tray, a screw post with an M3 heat-set insert hole
  patterned 2 × 2, a lid with countersunk M3 holes mirrored; volumes exact
  to 0.1 %) and B7 (knurled knob: revolved profile, chamfered top, a groove
  repeated by a circular pattern, a shaft hole; `dia`, `grooves` and
  `groove` change it). *B6 done 2026-10-01* (ADR-0053): the wall hook, three
  joined boxes (plate, arm, lip), the arm's sides and top drafted by `taper`
  about the plate's front face, the plate's four top edges (meeting at its
  corners) and the inside corner under the arm filleted; `e2e/benchmark-b6.spec.ts`,
  fixture `b6-wall-hook.extrudo`, recomputed headless with the drafted volume
  exact, and in the fuzzer's list.
- [x] **P3-15 Public release prep:** license, README, contribution guide, code
  of conduct, hosted demo, issue templates. Done 2026-10-02 (ADR-0054) except
  the owner's own steps, which are in `docs/release-checklist.md` (**the owner
  does these**: the slicer check of the exported 3MF, STL and STEP in the
  OrcaSlicer and PrusaSlicer GUIs on the Arch workstation (ADR-0034), the
  decision about the commit author address, making the repository public,
  enabling private vulnerability reporting and Discussions, the Cloudflare
  project and secrets (`docs/deploy.md`), attaching `extrudo.org` to it,
  tagging v0.3.0 and the GitHub release). Decisions of 2026-10-02: GPL-3.0-or-later
  with MIT for `packages/io` and the file-format spec; Cloudflare Pages deployed
  from GitHub Actions; Contributor Covenant 2.1 with GitHub-based reporting;
  GitHub private vulnerability reporting. Delivered: README with screenshots,
  CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, issue forms and a pull request
  template, NOTICE (taucad/opencascade.js#40 named) with a license check in
  `pnpm lint`, `_headers` (COOP/COEP, CSP, caching), `deploy.yml` (after CI on
  main, skips without secrets), `SITE_URL` for the canonical and Open Graph
  tags (default `https://extrudo.org`), the service worker's "update
  available" toast, `e2e/hosting.spec.ts`, the public-readiness audit, version
  0.3.0. `'unsafe-eval'` is out of the CSP since P4-12 (ADR-0067 §H1).
- [x] **P3-16 Notification history.** A button beside the toasts (the view's
  bottom-right corner) opens the session's earlier notifications, errors
  first-class, with their actions where they still apply (e.g. Show a
  hidden sketch). Asked for by the owner on 2026-09-28, when toasts moved
  into the view. Done 2026-09-29 (ADR-0041): every notification is kept for
  the session (repeats counted, at most 100) in the toasts' store; a bell
  button below the toasts (drawn once something was notified, with an
  unread badge, red for errors) and Ctrl+K "Notification History" open a
  panel with errors in a group of their own on top, then the rest, newest
  first; an action's optional `available()` says whether it still applies
  (Show for a hidden sketch), else its button is disabled; clear all; Esc
  closes and returns focus; session only.
- [x] **P3-17 Polish: open items carried from Phase 2 and 3.** Done
  2026-10-01 in two parts (part 1: items up to the Measure bullet and the
  section clipping; part 2: the rest, one heap item moved to P4-12). Added
  2026-09-30 by the owner, to run after P3-08 and before P3-12. Small UX gaps
  the ADRs left open:
  - ~~**First, two bugs the fuzzer found** in B4 and B5~~ **Done 2026-10-01**
    (`fix-fuzz-b4-b5`; ADR-0038 and ADR-0047 amendments). B4 step 5 (seed
    20260982): a fillet radius of `(rounding) * 2` ran into a wall of the
    lid's side faces and trapped OCCT; the facade now refuses a radius that
    reaches a parallel wall of an adjacent face before OCCT runs ("max ≈
    2.9 mm"). B5 step 11 (seed 20260983): a failed second round of
    Rectangular Pattern1 left the first round's kept shapes behind; rounds
    now keep their results only after the last one worked (the same latent
    leak in Fillet, Chamfer and Mirror's join is fixed). B4 and B5 are in the
    fuzzer's list.
  - A Remove feature dialog (edit which bodies it removes; ADR-0030, -0033).
  - A custom colour field in Appearance, beside the swatches (`BodyMeta`;
    schema and `docs/file-format.md`; ADR-0030).
  - Timeline: auto-scroll while dragging near the edges; move several
    selected features at once (ADR-0033).
  - Feature status (✕/⚠) in browser rows, as on timeline chips (ADR-0024,
    -0033).
  - A right-click menu (Delete) on constraint glyphs and dimension labels
    (ADR-0042).
  - Selection fields name a single pick ("Line · Sketch1", not "1 sketch
    curve"); origin axes are drawn while an axis field takes picks (ADR-0029).
  - ~~Offset follows a projected face outline: projected curves chain by
    shared endpoints in `chainOf` (ADR-0031, ADR-0039).~~ **Done (part 2)**;
    B2 uses it.
  - The notification panel re-reads `available()` when the document changes
    (ADR-0041).
  - Measure: sketch entities and origin geometry as targets; debounce the
    status bar's "Selection size" (ADR-0035).
  - ~~Place on Bed: a Spin angle about Z, several bodies; Overhang Analysis:
    the down direction from a picked face (ADR-0048).~~ **Done (part 2).**
  - Section analysis clips vertex dots and projected sketch curves too
    (ADR-0045).
  - ~~A checked-in screenshot of the overhang shading, taken in CI's
    Playwright image (ADR-0048).~~ **Done (part 2).**
  - ~~Patterns: `count2 × 10` on B5's Rectangular Pattern1 (2 × 20
    instances) takes 54-162 s, 90 % in `kernel.distance` from `operate`'s
    target filter~~ **Done (part 2)**: targets are found solid by solid, 55 s
    to 2.4 s; the fuzzer keeps B5's seeds 7 and 2026 (ADR-0047 amendment).
  - ~~Patterns: cut or join interfering instances one colour class of the
    interference graph at a time~~ **Done for cuts (part 2)**: overlapping
    10 × 10 holes 7.7 s to 3.7 s; joins keep the fuse, since colour classes
    measured slower for them (ADR-0047 amendment).
  - WASM heap growth with a warm cache on ADR-0029's revolve document:
    attributed (all of it in `mesh`) but not fixed; moved to **P4-12** with
    the findings (ADR-0050 amendment).
  - ~~The feature dialog's OK button key hint: 3.9:1 contrast in the light
    theme (axe, `KNOWN` in `e2e/a11y.spec.ts`; ADR-0050 §7).~~ **Done
    (part 2)**; `KNOWN` is empty.
  - Strike open items the ADRs still list that later tasks did: construction
    axes and planes as revolve axes and primitive planes, sketches on
    construction planes (P3-05); Redefine Plane (P2-11); revolve's
    `splitSolids`, body names and colours (P2-08); the Move wedge (P3-06).

**Phase 3 exit (v0.3 MVP):** a hobbyist can model typical functional prints
end to end, faster than in Fusion 360.

---

## Phase 4 — Advanced modeling and print workflow (→ v0.4–v0.5)

- [x] **P4-01 Sweep, loft, coil.** FR-FT-14. Done 2026-10-03 (ADR-0055):
  three feature types with dialogs in Solid › Create. Sweep moves profiles or
  flat faces (holes kept) along exact sketch curves or edges chained in any
  order, following the path or fixed, with a twist and an end scale; Loft goes
  through profiles, faces and an end point, smooth or ruled, open or closed;
  Coil is a primitive-placed spring of three types, a taper, either hand and
  four sections in three positions, whose `helix` builds one edge per turn
  (P4-02's threads sweep their own `threadSweep`).
  New facade methods `pathSketch`, `pathEdge`, `pathWire`, `helix`, `sweep`,
  `loft`, checked natively first (`spikes/p4-01-harness`). Patterns and
  mirrors repeat all three. Deferred: loft rails and centre line, twist on
  sharp paths, loft sections with holes.
- [x] **P4-02 Modeled threads** with presets and print tolerance. FR-FT-15.
  Done 2026-10-03 (ADR-0056): Thread in Solid › Modify, ISO metric, UNC/UNF,
  fit-the-face sizing, tolerance (the `tolerance` parameter when it exists),
  lead-ins.
- [x] **P4-03 Text tool** (opentype.js, bundled OFL fonts, user fonts as
  attachments). FR-SK-13. Done 2026-10-03 (ADR-0058): a `text` sketch entity
  sized by two points and shaped with opentype.js through a registry in core;
  six bundled fonts (Inter, Noto Serif, JetBrains Mono, Allerta Stencil,
  Fredoka) as versioned IDs; the letters are closed ink regions, so an extrude
  of a whole text sweeps every letter and a plate round a text has it as
  holes; the Text tool (Shift+T) with a non-modal panel, and the selection
  panel edits the string, font, alignment and the height dimension.
- [x] **P4-03b User fonts** as document attachments (ADR-0058 Deferred).
  Done 2026-10-03 (ADR-0061): `doc.attachments` records the files a design
  carries, their bytes live beside the document (content-addressed by SHA-256,
  shared with the `.extrudo` file and with saved versions), a text's font may
  be `attachment:<id>`, and "Add font…" in both Font selects brings in a
  TTF, OTF or WOFF file (WOFF2 refused).
- [x] **P4-04 Emboss/deboss.** FR-FT-16. Done 2026-10-04 (ADR-0060): one
  `emboss` feature with a `mode` (Emboss joins material outwards, Deboss cuts
  inwards); the profiles or a whole text of a sketch in any plane parallel to
  the face are put **onto** it in one step — moved onto it on a flat face,
  **wrapped round it** on a cylindrical one (letters keep their width, exact
  caps, radial walls), cones and free-form faces refused.
- [x] **P4-05 Control-point splines, conics, sketch polish.** FR-SK-03. Done
  2026-10-04 (ADR-0063). Sketch polish beyond the two curve types is deferred:
  what P4-05 added is the modes, the tools and the control polygon.
- [x] **P4-06 Import:** SVG/DXF → sketch; STEP → base body; STL/3MF/OBJ → mesh
  body with Manifold booleans; canvas images. FR-SK-14, FR-IO-05..07. Done
  2026-10-05 (ADR-0066) in five slices: **drawings** into a sketch (SVG, DXF,
  `e2e/import-drawing.spec.ts`), **attachments for imports and STEP** as a
  non-parametric base body (`e2e/import-step.spec.ts`), **mesh bodies** kept by
  manifold-3d (`e2e/import-mesh.spec.ts`), **mesh booleans and transforms**
  (a boolean with a mesh in it goes to manifold-3d and gives a mesh body again;
  Move, Mirror, Scale, Split Body and patterns work on it), and **canvas
  images** on a plane with a calibration (`e2e/canvas.spec.ts`). Deferred, as
  ADR-0066's Deferred says: replacing an imported file, names and colours from
  the file, drag and drop, DXF text as sketch text, mesh repair and decimation,
  faces of a mesh as references, STEP export of a mesh body, and the canvas's
  perspective correction.
- [x] **P4-07 Customizer panel and configurations.** FR-PAR-05, -06. Done
  2026-10-03 (ADR-0059).
- [x] **P4-08 Tolerance helpers and slicer hand-off.** FR-3DP-05, -06. Done
  2026-10-03 (ADR-0062): the print tolerance is the user parameter
  `tolerance`, set from the 3D Print tab's Tolerance panel (a field, the Tight
  0.1 / Normal 0.2 / Loose 0.3 mm buttons and a usage count, one undo step
  each through the shell's parameter `apply`); hole presets add it to every
  diameter they write ("3.4 mm + 2 * tolerance") and the Preset dropdown
  recognises both forms. The platform interface has the optional `openInSlicer`
  and the Export dialog a Slicer select and "Open in slicer" button where it
  exists — **the launch itself is P6-02**, since the browser build can't hand a
  local design to another program.
- [x] **P4-09 Timeline groups; linked folder storage.** FR-TL-06, FR-PRJ-06.
  Done 2026-10-04 (ADR-0065): timeline groups as ranges of the timeline (slice
  1) and a folder of `.extrudo` files on disk, linked through the File System
  Access API, read and written beside the browser's own copy (slice 2,
  Chromium only).
- [x] **P4-10 Rib/web; variable-radius fillet.** FR-FT-17, FR-FT-04's variable
  radius. Done 2026-10-04 (ADR-0064): a **rib** from one sketch **line** (a
  slab cut by the bodies, so nothing is placed by hand) and a **variable
  fillet**: an end radius per edge set (`radiusEnd<n>`, `swap<n>`) through the
  facade's new `filletVariable`, used only when some set has an end radius.
- [x] **P4-11 Benchmarks B8–B10 E2E.** Done 2026-10-04 (ADR-0039's amendments):
  B9 (threaded bottle cap and thread adapter, `e2e/benchmark-b9.spec.ts`, which
  took the ISO coarse thread series to M64 and the thread turn limit to 150 with
  it), B8 (name tag: a plate, rounded corners, a hanging hole, a text
  sketched on its top face and embossed out of it,
  `e2e/benchmark-b8.spec.ts`) and B10 (cable chain link: a rounded centreline
  path swept with a section, a pin, a clearance hole
  `pin + 2 * tolerance` and a pattern of three links,
  `e2e/benchmark-b10.spec.ts`). Both fixtures recompute headless and fuzz
  clean; B10 found that a sweep carries its profile exactly where the sketch
  drew it, so a swept section has to be *centred on the path*.
- [ ] **P4-12 Modeling depth backlog (from the Phase 3 ADRs).** Added
  2026-09-30; split into tasks as needed:
  - ~~Fillet and chamfer: on-canvas radius/distance handles, more than 8
    sets, a pickable reference face for chamfer~~ **done 2026-10-05**
    (ADR-0038 and ADR-0043 amendments): 32 sets each
    (`FILLET_MAX_SETS`, `CHAMFER_MAX_SETS`; a document with fewer reads
    unchanged), a per-set `face` for a chamfer's unequal modes that decides
    `flip` in the kernel (an equal set ignores it, and the dialog hides its
    Flip while a face is picked), and a `distance` handle on set 1's first
    edge along the outward bisector of its two faces' normals (no handle
    where that can't be read: a seam, a smooth chain, a face the meshes
    don't have). **Handles for every set, a variable fillet's two ends and a
    chamfer's face directions are done** (2026-10-05, the amendments' second
    part). Still open: a chamfer's handles on curved faces or edges (they keep
    the single bisector handle) and a handle for a chamfer's Angle.
  - Shell: a thickness per face; removing faces next to a fillet (ADR-0046).
  - Primitives: ~~position handles and a click point as the centre~~, torus
    placement options, ~~a box from two corners~~ (ADR-0032; done 2026-10-06,
    the torus options stay open).
  - ~~Construction: point on path, point through two edges, plane along a
    path, midplane of non-parallel planes, tangent planes on tori and
    free-form faces, planes in box selection~~ **done 2026-10-06**
    (ADR-0040's amendment): four new types — `pointOnPath` and `planeAlongPath`
    (a fraction or a length along a path of sketch curves and edges,
    `pathFromRefs`), `pointAtIntersection` (two edges, an edge and a plane, or
    three planes) and `midplaneAngled` (the bisector of two non-parallel
    planes) — plus a `point` on `tangentPlane` (a torus analytically, a
    free-form face from a fine mesh of it, `basis: 'mesh'` in the report) and
    `pickBox` taking construction planes, axes and points under the
    construction filter (origin axes excepted). No facade change. Still open: a
    point at the intersection of two curved faces, and a cone's nearest
    tangency point.
  - ~~Extrude to object on curved faces and bodies, with an offset; revolve
    "to"~~; taper on ellipse and spline sides; symmetric half-length
    (ADR-0028, -0029; the first two done 2026-10-06, the taper and the
    half-length stay open).
  - Silhouettes of spheres, tori and free-form faces (HLR); projecting
    vertices and bodies, an "include" mode; Intersect and Slice
    (ADR-0031).
  - STEP colours (XDE) (ADR-0034; the readers are P4-06).
  - ~~Section analysis on several planes, a section box~~ **done
    (P4-12, 2026-10-06, ADR-0045's amendment: up to three planes, a box of
    six)**; sections saved with named views, a hatch per material (ADR-0045).
  - ~~Threads: a thread of about 400 turns traps the WASM heap~~ **done in
    ADR-0067 §H2 (P4-12, 2026-10-05): it is OCCT's boolean running out of
    memory** (the heap 403 MB → 1903 MB at 350 turns, over 2 GB at 400), found
    by bisecting it natively in `spikes/p4-12-threads`; the tooth is cut out of
    the ring in pieces of `THREAD_CHUNK` turns now, so no turn count can trap
    (`MAX_TURNS` stays 150 for the time it takes). **`mergeTools`' exact
    distance between two heavy tools is gone** (over `HEAVY_TOOL_FACES`
    faces they are merged without it; two 36- and 30-turn threads' tools were
    277 s in one call), and B9 is back in the default fuzz run. Still open: a
    bottle-cap profile of its own (ADR-0056 Deferred).
  - ~~Sweep: say where a profile lands~~ **done in ADR-0067 §H5 (P4-12,
    2026-10-05): the sweep warns** when its profile is drawn more than max(1 %
    of the path's length, 0.5 mm) from the path's start line, naming the
    distance. Still open: an edit dialog that reads where the profile will
    sit.
  - ~~Print Info: support volume, infill, cost per kg~~ (ADR-0048). **Done
    2026-10-05** for infill and cost (ADR-0048's P4-12 amendment): the panel
    estimates a print from each body's exact volume *and* area —
    `skin = min(volume, area × walls × lineWidth)` per body, `printed = skin +
    interior × infill`, at 100 % infill exactly the solid numbers — with a wall
    count, a line width, an infill and a price per kg in the `print.material`
    preference, and "Printed (est.)" and "Cost" rows. **Still open: support
    volume**, which needs a slicer's support generation.
  - ~~Patterns: a skip list, count and path handles~~ **done 2026-10-05**
    (ADR-0047's amendment): all three pattern types take a `skip` input (the
    position labels of the instances they leave out, a new `labels` input
    kind), which the kernel drops before the boolean and previews as a faint
    ghost of each skipped instance; the original can't be skipped, a label past
    the count is ignored and kept, and every instance skipped says so. The
    evaluators report the layout (`PatternReport`: every instance's centre and
    each series' first and last), which the dialogs read for a dot on every
    instance (a click skips or keeps it), a **count handle** on the last
    instance of each series (rectangular and circular) and the path pattern's
    **distance handle** at its last instance. A pattern's handles float clear of
    the instances so the dots stay clickable.
  - ~~A ghost of lost geometry in the view (ADR-0005, -0033); remappable
    marking-menu wedges (ADR-0042).~~ **Done 2026-10-06**: a lost or guessed
    reference is drawn dashed in the error colour from its fingerprint (a
    square for a plane, a circle for a curved face or circle edge, a segment
    for a line, a cross for a vertex) while its chip or row is hovered, its
    Fix References is open or its chip is picked (`data-ghosts`); the
    `marking.slots` preference and the Customize Marking Menu dialog give each
    wedge of both rings any command the mode offers.
  - Emboss: cones, spheres and free-form faces; more than half way round a
    cylinder; "tangent to the face" for a flat sketch far from it; several
    faces at once (ADR-0060). ~~`Kernel.measure`'s volume is 1-2 % off on the
    B-spline walls of a wrap (its own gap, like the lofter's), so the wrap's
    exactness is only as good as the integrator.~~ **Done 2026-10-05**
    (ADR-0067 §H3): the facade integrates with an error bound where a B-spline
    surface makes OCCT's fixed-order integral wrong (and keeps the cheap form
    where the bound is worse, a prism wall), so a wrap's volume is exact to
    1e-5 relative where it was 1-3 % out.
  - WASM heap growth with a warm cache (ADR-0029, ADR-0050 §6): about 11 MB
    per 100 recomputes of the revolve document with all three revolves.
    Attributed in P3-17 to `mesh` alone (`HEAP_ATTRIBUTE=1`, 4 jumps of
    16 MB in 1200 calls, every other call flat); cleaning the triangulation
    after meshing (`BRepTools::Clean`, built in CI) gave 3 jumps instead of
    4, so it isn't the cure. Ideas left: patch OCCT's mesher block size
    (`IMeshData::MEMORY_BLOCK_SIZE_HUGE`, 1 MB), a dlmalloc build with
    `heapTop` inside `mesh()`. ~~Recycling the kernel worker when the heap top
    passes a limit~~ **Done 2026-10-05** (ADR-0067 §H4): `KernelApi.heap()`
    after every recompute, and the `Recomputer` replaces the worker between
    recomputes over `HEAP_RECYCLE_BYTES` (1 GiB) with no dialog open, keeping
    the model on screen and noting it in the history. The growth itself is
    still unfixed, as the two ideas above are.
  - Patterns: colour classes made joins slower than fusing the instances
    (3.9 s against 2.1 s for overlapping bosses); a cheaper join of many
    interfering copies (ADR-0047).
  - Content policy: `'unsafe-eval'` dropped from `script-src` in
    `apps/web/public/_headers`. **Done 2026-10-04** (ADR-0067 §H1): both WASM
    builds are made with dynamic execution off (`DYNAMIC_EXECUTION: 0`, beside
    `ALLOW_MEMORY_GROWTH` in planegcs's link flags, in the emcc settings for
    OCCT; CI built both, new input hashes), and `packages/core/src/zod.ts` is the
    one place zod is imported from, calling `z.config({ jitless: true })` before
    any schema exists. Embind then builds its invokers as closures; the solver
    drag and the B1-B5 recomputes measured within noise (ADR-0067 §Results).
    `e2e/hosting.spec.ts` asserts the served `script-src` and walks a whole
    session under it with no violation. No further work here.

---

## Phase 5 — Programmatic design (→ v0.6)

- [x] **P5-01 Public document API** (`@extrudo/api`), generated from the feature
  registry, with docs site pages. FR-PRG-01. Done 2026-10-05 (ADR-0068) in three
  slices: the package and its generated methods, sketches and face roles with the
  examples as tests, and the reference (`docs/api/`, one page per feature type,
  generated with the methods) published by the landing page's site under
  `/docs/api/`.
- [x] **P5-02 Script feature:** editor (CodeMirror 6, not the Monaco the first
  draft named — ADR-0070 §3), sandboxed worker (no DOM, no network, time and
  memory limits), reads parameters, outputs bodies and sketches; errors shown
  inline. FR-PRG-02. **Done 2026-10-05**, all three slices (ADR-0070).
  QuickJS runs add-only API programs with bounded time/memory; generated features
  recompute under persistent IDs in the kernel and CLI. The lazy CodeMirror
  dialog adds completion, inline errors, output and one-step edits; e2e and guide.
- [x] **P5-03 Headless CLI:** `extrudo export project.extrudo --param w=40
  --format 3mf`. FR-PRG-03. Done 2026-10-05 (ADR-0069) in two slices: the
  library (`@extrudo/cli`: open, parameters and configurations with the
  re-solve, compute, export, save) and the binary (`info`, `export`, `set`,
  `check`, `--json`, exit codes 0/1/2/3). The re-solve and the export's own
  logic moved into `@extrudo/sketch` and `@extrudo/kernel`, so the app and the
  CLI do the same thing; `docs/cli.md`.
- [x] **P5-04 OpenSCAD import** via openscad-wasm → mesh body. FR-IO-08. Done
  2026-10-05 (ADR-0071) in two slices: the kernel, Node and the CLI
  (`@extrudo/openscad`: OpenSCAD's own WASM snapshot, mirrored, in a worker of
  its own with a time limit and a heap ceiling; the `import` feature's `.scad`
  branch and its 32 numbered overrides; the engine's async `prepare`) and the
  app (Insert › Import takes `.scad`; the Import dialog lists the file's
  customizer variables as rows of `<ExpressionInput>`s, from
  `KernelApi.scadParameters`; the `Recomputer` loads OpenSCAD once per kernel;
  the service worker caches the 11 MB WASM on first use, not at install, and a
  design computes offline after that).
- [x] **P5-05 Macro recording.** FR-PRG-04. Done 2026-10-06 (ADR-0073): the
  emitter `emitScript` in `@extrudo/api` (every fixture round-trips) and
  `extrudo script`; the app's Record and Stop, the Macro dialog (Copy, Replace
  with a Script in one undo step, Keep both suppressed) and File › Export design
  as script…, with e2e proving a recorded sketch, extrude and fillet give the
  same body as the Script that replaces them.
- [x] **P5-06 Wall-thickness check.** FR-3DP-07. Done 2026-10-05 (ADR-0072):
  thickness per triangle of the display mesh by a ray along its inward normal
  (the picking BVH, cached by mesh), as view state with the Wall Thickness
  panel (a Minimum expression, two line widths by default), red shading, the
  thinnest spot marked, `data-thickness` and a browser Analysis row.

---

## Phase 6 — Desktop and community (→ v1.0)

- [ ] **P6-01 Electron app:** electron-vite; the Node-fs `ProjectStore`; native
  menus from the command registry; `.extrudo` file association; recent files;
  auto-update; builds for AppImage/deb, Windows and macOS (signing).
- [ ] **P6-02 Slicer launch** on desktop (detect installed slicers): implement the
  platform's `openInSlicer` (ADR-0062), which the Export dialog already offers
  when it exists — write the exported bytes to a temporary file and launch
  PrusaSlicer, OrcaSlicer, Bambu Studio or Cura with it. The browser build
  leaves it out (a slicer can't fetch a `blob:` URL). FR-3DP-06.
- [ ] **P6-03 Plugin API** (custom features and commands; sandboxed).
- [ ] **P6-04 i18n** (community translations).
- [ ] **P6-05 Components and simple assemblies** (multiple components, as-built
  joints), if demand warrants.
- [ ] **P6-06 Docs site, tutorials, example library.**
- [ ] **P6-07 Auto-project** (Fusion's "auto project edges on reference"): a
  body edge or vertex a sketch tool snaps, constrains or dimensions to is
  projected into the sketch on the fly (a P2-09 projection record), with a
  preference to turn it off; optionally the face's outline when a sketch
  starts on a face. The Project tool (P) does this by hand today.
  *Deps:* P2-09. *AC:* FR-SK-17.

---

## Critical path and parallelism

```
P0-01 ─┬─ P0-02⚗ ─ P0-09 ─ P2-01 ─ P2-02 ─ P2-04 ─ P2-06 ─ … Phase 3 features
       ├─ P0-03⚗ ─ P1-03 ─ P1-04 … P1-11 ─────────┘
       ├─ P0-04 ─ P0-05 ─ P1-01 ─ P1-02
       ├─ P0-06 ─ P0-07 ─ P1-07
       └─ P0-08
```

After P0-01, the spikes, the shell/viewport, the document core and storage can
proceed in parallel. **Topological naming (P2-04) is the riskiest item.** Start
thinking about it during P0-02 (which kernel layer gives access to history) and
don't let Phase 3 features be built without it.

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Topological naming breaks references on edits | Users lose work, trust | Designed in from Phase 2 (§5.2 of architecture); a dedicated test suite; fingerprint fallback; repair UI. |
| OCCT operations fail on edge cases (fillets especially) | Features go red | Friendly messages with suggested values; fall back to per-edge attempts; a fuzz test corpus. |
| OCCT WASM size and load time | Slow first start | Trimmed custom build; PWA cache; show the home screen before the kernel is ready. |
| WASM memory leaks (manual `delete()`) | Tab crashes after long sessions | Disposal scopes as a lint-checked rule; a memory test that recomputes a fixture 500×. |
| Scope creep toward "full Fusion" | Never ships | Phases with exit criteria and benchmark models; out-of-scope list in requirements. |
| Solver instability (flipping solutions) | Sketches jump on edit | Start from stored solved positions; small-step drag solving; tests. |
| Large coupled sketch components solve slowly (planegcs uses dense matrices; ADR-0002) | Dragging a 200-entity single component runs at ~12 fps; edits take 0.1–1 s. **Measured in P1-03 (ADR-0011): a closed gear outline drags far worse than its size suggests, about 120 ms per step at 52 curves and 1–5 s at 104, because planegcs's drag solve (SQP) needs ~30 iterations per step on a coupled loop of arcs** | Per-component solving covers the usual sketch. For loops like gears: solve drags of large components in a worker at the latest pointer position; keep the SQP's BFGS matrix between drag steps or patch it to sparse matrices in our build; or drag with a lighter formulation. P1-09 (ADR-0018) drags on the UI thread, one solve per pointer move, which is fine for ordinary sketches; the gear case is still open. |
| LGPL obligations misunderstood | Legal trouble when public | Separate WASM files; NOTICE file (done in P3-15). |
| Mimicking Fusion too closely (trade dress) | Legal risk | Own icons, names and branding; copy concepts and workflow only. |

## Open decisions (for the project owner)

1. ~~Name~~ **Decided 2026-09-25: Extrudo.** Files use `.extrudo`; packages
   use `@extrudo/*`. Checked on 2026-09-25: `extrudo.app`, `.dev`, `.io` and
   `.org` were unregistered on that day (`.com` taken; `extrudo.app` was taken
   by 2026-10-02, `extrudo.org` was registered then), the npm name `extrudo` was free, and
   the GitHub name `extrudo` was free. None of these are registered yet.
2. ~~License~~ **Decided 2026-09-25:** **GPL-3.0-or-later** for the app, so
   forks stay open (as with PrusaSlicer and OrcaSlicer). The file-format spec
   and the `io`/`api` packages are **MIT**, so anyone can read and write the
   format. OCCT and planegcs stay separate LGPL WASM files. Apply in P0-01.
3. ~~Hosting target~~ **Decided 2026-10-02: Cloudflare Pages**, deployed from
   GitHub Actions (ADR-0054; steps in `docs/deploy.md`). Custom headers (COOP and
   COEP) come from `_headers`. **Domain: `extrudo.org`**, registered 2026-10-02 in
   Cloudflare (`extrudo.app` was taken). The owner still has to attach it to the
   Pages project (until then the demo is at `https://extrudo.pages.dev`); the
   build already uses `https://extrudo.org` as `SITE_URL`.
4. ~~Brand look~~ **Decided 2026-09-25**, see `docs/05-brand.md`.
   Base is direction **E "Sketch to Solid"**: the logo (dashed blue sketch
   square becoming an amber solid), amber accent, grey tones and Instrument
   Sans. From direction **B** it takes the tool icons (two-tone fill, 1.75 px
   stroke, B's category colours) and the glowing viewport gradient. The dark
   app background is a lighter graphite than E's near-black, with the **Slate**
   glow (blue-grey). Prototypes and logo SVGs are in `docs/brand/`.
