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
- [ ] **P0-05 Viewport.** R3F canvas; adaptive infinite grid; origin
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
- [ ] **P0-08 Project storage.** `ProjectStore` interface; OPFS + IndexedDB
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

- [ ] **P1-01 Sketch feature and sketch mode.** `sketch` feature type and
  `SketchData` schema; "Create Sketch" (pick an origin plane with hover
  highlight) → Look At animation → sketch-mode UI (toolbar swaps to the Sketch
  tab, sketch palette, green "Finish Sketch"). Browser tree "Sketches" folder.
  *Deps:* P0-05, P0-06. *AC:* FR-SK-01 (origin planes), FR-VP-07 (partial).
- [ ] **P1-02 Sketch tool framework.** Tool state-machine base, sketch-plane
  raycasting, snapping/inference engine (endpoint, midpoint, center, on-curve,
  intersection, H/V alignment with dashed guides, grid), heads-up numeric input
  (length/angle, Tab, Enter, Esc), preview rendering, auto-constraint emission.
  *AC:* FR-SK-05, -06; unit tests of the inference engine.
- [ ] **P1-03 Solver integration.** `sketch` package planegcs adapter (ADR-0002):
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
- [ ] **P1-04 Basic drawing tools.** Line (chained, tangent-arc drag), rectangle
  (2-point, 3-point, center), circle (center, 2-point, 3-point), arc (3-point,
  center, tangent), point, construction toggle (X).
  *AC:* FR-SK-02 (subset), -04; E2E draws each.
- [ ] **P1-05 More drawing tools.** Polygon (3 modes), slot (2 modes), ellipse,
  fit-point spline.
  *AC:* FR-SK-02 complete, FR-SK-03 (fit-point).
- [ ] **P1-06 Constraints UI.** Constraint tools in the toolbar and palette;
  glyph rendering next to geometry (with a hover pair-highlight); select and
  delete constraints; "show constraints" toggle.
  *AC:* FR-SK-07.
- [ ] **P1-07 Dimensions.** Sketch Dimension tool (`D`) that infers the dimension
  type from the selection; placement drag; inline edit with `<ExpressionInput>`;
  driving vs driven; auto model-parameter naming (`d1`…); dimension appears in
  the parameters table.
  *Deps:* P0-07. *AC:* FR-SK-08, FR-PAR-03 for sketches.
- [ ] **P1-08 Constraint status and coloring.** Blue (under-constrained),
  black/white (fully constrained), red (conflict); DOF display in the palette;
  over-constraint dialog offering to make the dimension driven.
  *AC:* FR-SK-09.
- [ ] **P1-09 Selection and editing in sketch.** Click and box select (window vs
  crossing); drag geometry with live solve; delete with constraint cleanup;
  a properties panel for the selected entity.
  *AC:* FR-VP-05 (sketch part).
- [ ] **P1-10 Modify tools.** Trim, extend, break, sketch fillet, sketch
  chamfer, offset (with a dimension), mirror (with a symmetry constraint),
  move/copy, rectangular and circular pattern, scale.
  *AC:* FR-SK-10; unit tests on the geometry operations.
- [ ] **P1-11 Profile detection.** TS planar arrangement → closed regions with
  nesting; shaded profile display; hover and select profiles; stable region IDs.
  *AC:* FR-SK-11; unit tests with overlapping and nested shapes.
- [ ] **P1-12 Timeline v1 and browser tree.** Timeline bar with sketch chips;
  double-click to edit a sketch; rename, delete, suppress; hover highlight.
  Browser tree: origin, sketches, visibility toggles.
  *AC:* FR-TL-01, -03 (partial), FR-VP-07.
- [ ] **P1-13 SVG and DXF export.** Export the selected sketch (or its
  profiles) to SVG at 1 mm scale, with construction geometry optional; DXF R12
  export.
  *AC:* FR-SK-15, -16; golden-file tests; the SVG opens at the correct size in
  Inkscape.
- [ ] **P1-14 Command search and shortcuts v1.** Shortcut registry with
  Fusion defaults (`L R C A P D T O X E` …); `S` toolbox and Ctrl+K palette
  (fuzzy search over commands).
  *AC:* FR-UX-03 (partial).
- [ ] **P1-15 Benchmark B1 E2E.** Playwright builds B1 through the UI, changes a
  user parameter, asserts the sketch updates and the SVG export matches.

**Phase 1 exit (v0.1):** a user can make a fully constrained parametric sketch,
drive it with parameters, save it, and export SVG.

---

## Phase 2 — Solids (→ v0.2 "first print")

Goal: turn sketches into bodies, edit history, and export printable STL, 3MF
and STEP. Benchmarks **B2** and **B3** buildable.

- [ ] **P2-01 Recompute engine.** Timeline walk in the worker; per-feature
  status; input hashing and shape cache; cancellation; debounced previews;
  modelStore updates; error display.
  *Deps:* P0-09. *AC:* recompute of a 30-feature fixture edited at feature 25
  re-evaluates only 25–30 (asserted via counters).
- [ ] **P2-02 Sketch → kernel.** Sketch curves → OCCT edges/wires; OCCT-based
  authoritative profile faces with persistent region IDs; sketch plane
  placement.
- [ ] **P2-03 B-rep rendering and 3D selection.** Body meshes with face ranges,
  edge lines, vertices; pre-highlight; selection of faces, edges, vertices and
  bodies; selection filter menu; "select other" long-press list.
  *AC:* FR-VP-05 (3D part).
- [ ] **P2-04 Topological naming v1.** Persistent-ID generation for extrude and
  revolve; propagation through booleans via OCCT history; fingerprints;
  reference resolution API used by every feature.
  *AC:* ADR-0005; topo-naming test suite (≥ 15 scenarios) green.
- [ ] **P2-05 Feature dialog framework.** Right-side command dialog: selection
  fields (with count, clear, filter), `<ExpressionInput>` fields, dropdowns,
  OK/Cancel, live preview, validation messages; in-canvas manipulators (distance
  arrow, angle arc) with a heads-up value box.
- [ ] **P2-06 Extrude.** All options in FR-FT-01; cut preview shown red; face
  extrude (press-pull on planar faces).
  *AC:* FR-FT-01; kernel golden tests for each option combination.
- [ ] **P2-07 Revolve.** FR-FT-02.
- [ ] **P2-08 Bodies.** Browser "Bodies" folder; rename, visibility, colour and
  appearance; delete body (as a "Remove" feature); body count badge.
- [ ] **P2-09 Sketch on face and project/include.** Sketch on a planar face
  (follows the face through recompute); Project tool (associative edges and
  silhouettes into the sketch).
  *Deps:* P2-04. *AC:* FR-SK-01 (faces), FR-SK-12.
- [ ] **P2-10 Primitives.** Box, cylinder, sphere, torus with placement on a
  plane or face.
  *AC:* FR-FT-03.
- [ ] **P2-11 Timeline v2.** Rollback marker (drag + playback buttons);
  insertion at the marker; edit-feature reopens its dialog; reorder by drag with
  dependency validation; error and warning chips; "fix references" flow.
  *AC:* FR-TL-02..05.
- [ ] **P2-12 STL, 3MF and STEP export.** Export dialog (bodies, format,
  resolution presets); binary STL; 3MF with objects, names, colours and units
  (verified in Bambu Studio, OrcaSlicer and PrusaSlicer); STEP AP242.
  *AC:* FR-IO-02..04; an automated manifold check on exported STL.
- [ ] **P2-13 Measure and inspect.** Measure tool (distance, angle, radius, area,
  volume); selection bounding-box readout in the status bar.
  *AC:* FR-3DP-01.
- [ ] **P2-14 Version history.** "Save version" with a description; version list
  panel; open or restore an old version.
  *AC:* FR-PRJ-03.
- [ ] **P2-15 WASM size and startup.** Custom trimmed OCCT build; service worker
  precache (PWA); measure against NFR-02. The trimmed build itself moved to
  P0-09 (ADR-0001: 4.34 MB brotli, about 200 ms cold start); this task trims
  further and adds the precache.
- [ ] **P2-16 File-format spec.** Write `docs/file-format.md` from the zod
  schema.
- [ ] **P2-17 Benchmarks B2, B3 E2E.**

**Phase 2 exit (v0.2):** the first real printable parts; the classic
parametric box exported as 3MF opens in a slicer and prints.

---

## Phase 3 — Modify and construct (→ v0.3 "real CAD", the MVP)

Goal: the modify toolset that makes parts printable and pretty. Benchmarks
**B4–B7**. This is the first public release candidate.

- [ ] **P3-01 Fillet** (constant radius, edge sets, tangent chains; preview;
  friendly failure messages with a suggested max radius). FR-FT-04, FR-UX-06.
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
| Large coupled sketch components solve slowly (planegcs uses dense matrices; ADR-0002) | Dragging a 200-entity single component runs at ~12 fps; edits take 0.1–1 s | Per-component solving covers the usual sketch; if real sketches hit it: solve large components in a worker, or patch planegcs to sparse matrices in our build. |
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
