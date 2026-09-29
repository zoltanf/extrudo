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
  `packages/kernel/src/benchmarks.test.ts`. The standalone Combine step of
  B3 comes with P3-06.

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
- [ ] **P3-02 Chamfer** (3 modes). FR-FT-05.
- [ ] **P3-03 Shell.** FR-FT-06.
- [ ] **P3-04 Hole** (placement by sketch points or click; types; presets incl.
  heat-set inserts). FR-FT-07.
- [ ] **P3-05 Construction geometry** (all planes, axes and points in
  FR-FT-13; browser "Construction" folder).
- [ ] **P3-06 Combine, Move/Copy** (with transform gizmo) **and Mirror.**
  FR-FT-09, -10, -11 (mirror).
- [ ] **P3-07 Patterns** (rectangular, circular, on path) for bodies, features
  and faces. FR-FT-11.
- [ ] **P3-08 Press/Pull, Offset face, Split body, Scale, Draft.** FR-FT-08,
  -12.
- [ ] **P3-09 Section analysis.** FR-VP-06.
- [ ] **P3-10 3D-print aids:** mass properties with filament presets, overhang
  shading, place on bed. FR-3DP-02..04.
- [ ] **P3-11 Marking menu** (right-click radial) and context menus
  everywhere. FR-UX-03.
- [ ] **P3-12 Onboarding:** first-run tutorial, template gallery (B2, B4, B5 as
  starters), tool tooltips with animated demos. FR-UX-04, -05.
- [ ] **P3-13 Hardening pass:** robustness fuzzing (random parameter changes on
  fixtures must not crash), perf profiling against NFR-01, accessibility audit.
- [ ] **P3-14 Benchmarks B4–B7 E2E.**
- [ ] **P3-15 Public release prep:** license, README, contribution guide, code
  of conduct, hosted demo, issue templates.
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

**Phase 3 exit (v0.3 MVP):** a hobbyist can model typical functional prints
end to end, faster than in Fusion 360.

---

## Phase 4 — Advanced modeling and print workflow (→ v0.4–v0.5)

- [ ] **P4-01 Sweep, loft, coil.** FR-FT-14.
- [ ] **P4-02 Modeled threads** with presets and print tolerance. FR-FT-15.
- [ ] **P4-03 Text tool** (opentype.js, bundled OFL fonts, user fonts as
  attachments). FR-SK-13.
- [ ] **P4-04 Emboss/deboss.** FR-FT-16.
- [ ] **P4-05 Control-point splines, conics, sketch polish.** FR-SK-03.
- [ ] **P4-06 Import:** SVG/DXF → sketch; STEP → base body; STL/3MF/OBJ → mesh
  body with Manifold booleans; canvas images. FR-SK-14, FR-IO-05..07.
- [ ] **P4-07 Customizer panel and configurations.** FR-PAR-05, -06.
- [ ] **P4-08 Tolerance helpers and slicer hand-off.** FR-3DP-05, -06.
- [ ] **P4-09 Timeline groups; linked folder storage.** FR-TL-06, FR-PRJ-06.
- [ ] **P4-10 Rib/web; variable-radius fillet.** FR-FT-17.
- [ ] **P4-11 Benchmarks B8–B10 E2E.**

---

## Phase 5 — Programmatic design (→ v0.6)

- [ ] **P5-01 Public document API** (`@extrudo/api`), generated from the feature
  registry, with docs site pages. FR-PRG-01.
- [ ] **P5-02 Script feature:** Monaco editor, sandboxed worker (no DOM, no
  network, time and memory limits), reads parameters, outputs bodies and
  sketches; errors shown inline. FR-PRG-02.
- [ ] **P5-03 Headless CLI:** `extrudo export project.extrudo --param w=40
  --format 3mf`. FR-PRG-03.
- [ ] **P5-04 OpenSCAD import** via openscad-wasm → mesh body. FR-IO-08.
- [ ] **P5-05 Macro recording.** FR-PRG-04.
- [ ] **P5-06 Wall-thickness check.** FR-3DP-07.

---

## Phase 6 — Desktop and community (→ v1.0)

- [ ] **P6-01 Electron app:** electron-vite; the Node-fs `ProjectStore`; native
  menus from the command registry; `.extrudo` file association; recent files;
  auto-update; builds for AppImage/deb, Windows and macOS (signing).
- [ ] **P6-02 Slicer launch** on desktop (detect installed slicers).
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
| LGPL obligations misunderstood | Legal trouble when public | Separate WASM files; NOTICE file; decide license before P3-15. |
| Mimicking Fusion too closely (trade dress) | Legal risk | Own icons, names and branding; copy concepts and workflow only. |

## Open decisions (for the project owner)

1. ~~Name~~ **Decided 2026-09-25: Extrudo.** Files use `.extrudo`; packages
   use `@extrudo/*`. Checked on 2026-09-25: `extrudo.app`, `.dev`, `.io` and
   `.org` were unregistered (`.com` taken), the npm name `extrudo` was free, and
   the GitHub name `extrudo` was free. None of these are registered yet.
2. ~~License~~ **Decided 2026-09-25:** **GPL-3.0-or-later** for the app, so
   forks stay open (as with PrusaSlicer and OrcaSlicer). The file-format spec
   and the `io`/`api` packages are **MIT**, so anyone can read and write the
   format. OCCT and planegcs stay separate LGPL WASM files. Apply in P0-01.
3. **Hosting target** for the public demo: deferred. Leaning toward a Hetzner
   web host. Whatever host is chosen must let us set COOP/COEP response
   headers, which multi-threaded WASM needs later.
4. ~~Brand look~~ **Decided 2026-09-25**, see `docs/05-brand.md`.
   Base is direction **E "Sketch to Solid"**: the logo (dashed blue sketch
   square becoming an amber solid), amber accent, grey tones and Instrument
   Sans. From direction **B** it takes the tool icons (two-tone fill, 1.75 px
   stroke, B's category colours) and the glowing viewport gradient. The dark
   app background is a lighter graphite than E's near-black, with the **Slate**
   glow (blue-grey). Prototypes and logo SVGs are in `docs/brand/`.
