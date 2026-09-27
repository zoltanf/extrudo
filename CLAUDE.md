# Extrudo — agent context

Open-source, browser-based parametric CAD for the 3D-printing community, with a
Fusion 360-style workflow (sketch → features → timeline, parameters everywhere)
and a playful modern UI. Web first (PWA). An Electron desktop build comes later
from the same codebase.

**Repo:** <https://github.com/zoltanf/extrudo>. **Private** until the project
is ready to go public (planned around the v0.3 MVP, task P3-15). CI runs on
every push and pull request.

**Status (2026-09-27):** Phase 0 is done (P0-01 to P0-09); Phase 1 has
P1-01 to P1-08 done. ADR-0001 chose
our own trimmed libcascade build with a small C++ facade that owns OCCT memory
(`docs/adr/0001-geometry-kernel.md`); P0-09 built it in `packages/kernel`
(facade, TS `Kernel`, worker, `KernelClient` with crash restart, memory test,
debug page at `#/debug/kernel`). ADR-0002 chose planegcs from our own WASM
build, one solver system per independent sketch component
(`docs/adr/0002-sketch-solver.md`). ADR-0003 (P0-06) set the document model in
`packages/core`: strict zod schema, migrations on raw JSON, deterministic
commands with Immer patches, nested undo transactions, vanilla Zustand stores.
ADR-0004 (P0-07) set the expression language: Pratt parser in
`packages/core/src/expr/`, length/angle dimensions, plain numbers take the
context unit, parameter graph with cycle paths; `<ExpressionInput>` and the
Parameters dialog live in `apps/web/src/parameters/`. ADR-0007 (P0-04) set the
design system (`apps/web/src/design-system/`: tokens → Tailwind v4, Radix
wrappers, icon pipeline) and the shell (`apps/web/src/shell/`), which opens a
sample document in memory until storage exists. ADR-0008 (P0-05) set the
viewport (`apps/web/src/viewport/`): Z-up world in mm, our own camera
controller (target + quaternion + size, both projections), mouse presets as
tables, shader grid, CSS 3D ViewCube, a viewport store with display settings
as preferences. ADR-0009 (P0-08) set storage (`packages/storage`):
`ProjectStore` over an IndexedDB index and OPFS files, `.extrudo` zips through
core's migrations; in the web app, an async `webPlatform()` with projects,
persistent storage and file download/pick, autosave (`project/autosave.ts`),
routes `#/` (home screen, `home/`) and `#/p/<id>` (`project/ProjectPage.tsx`).
ADR-0010 (P1-01) set the sketch data model in `packages/core/src/sketch/`:
the plane is a `ref` input, `SketchData` holds points, lines, circles and
arcs (each point owned by at most one curve; coincident constraints join
them) plus every constraint and dimension type, as records keyed by ID;
origin plane frames match the ViewCube. Sketch mode (`apps/web/src/sketch/`)
is session state plus one undo transaction; the viewport draws sketches,
makes the origin planes pickable and puts the grid on the sketch plane.
ADR-0011 (P1-03) built the solver adapter in `packages/sketch/src/solver/`:
`SketchSolver.solve(sketch, values)` maps every type to planegcs, treats
fixed geometry as constants, keeps one system per component and solves only
what changed; `beginDrag`/`drag`/`endDrag`; `check()` test-solves a new
constraint. Our planegcs WASM (`packages/sketch/planegcs/`) builds in CI per
input hash like OCCT. A closed gear outline drags at ~1 s per step (risk
register). ADR-0012 (P1-02) set the tool framework: `infer()` in
`@extrudo/sketch/inference` (import that entry in the app, not the main one,
or planegcs's glue lands in the main chunk) with auto-constraints that
`check()` vets before `addToSketch` commits them with solved positions;
tools are plain state machines (`apps/web/src/sketch/tools/`) driven by a
host store; picking uses `viewRay`/`rayPlane` in `viewport/camera.ts`; an
SVG overlay draws preview, guides, snap glyphs and the heads-up box. The
Line tool (`L`) is the reference tool. ADR-0013 (P1-04) added rectangles,
circles, arcs (one tool ID per mode; variants in the Create menu), points,
the Line tool's tangent-arc drag (tools opt into drags with `dragStart`),
shared builders in `sketch/tools/build.ts`, and the construction toggle
(`X`, host state, resets when the sketch closes). ADR-0014 (P1-05) added
polygons and slots (lines, arcs, construction circles/centerlines), and two
entity types: `ellipse` (center, major and minor points; the solver maps it
with a solver-only focus and ordinary constraints) and fit-point `spline`
(points only; `fitSpline` in `core/src/sketch/curves.ts` interpolates the
B-spline). The drawing tools and the overlay are a lazy chunk loaded when a
project opens; `sketch/tools/ids.ts` lists the tool IDs for the shell.
ADR-0015 (P1-06) added the 13 constraint tools (`sketch/tools/constrain.ts`,
tools with `picks: true` that pick entities via `ToolContext.pick`); the host
test-solves a user's constraint (`SketchEdit.verify`) and refuses a redundant,
conflicting or curve-collapsing one; glyphs (`tools/glyphs.ts` placement,
`ConstraintGlyphs.tsx` buttons over the view, `data-view-passthrough` lets
navigation through) select into the session as kind `constraint`, and Delete
runs `removeFromSketch`. ADR-0016 (P1-07) added the Dimension tool
(`sketch/tools/dimension.ts`, a picking tool), labels and the in-place
editor (`tools/DimensionLabels.tsx`, layout in `tools/dimensionLayout.ts`),
measuring and anchors in `core/src/sketch/dimensions.ts`; named driving
dimensions are model parameters (owner type `dimension`,
`evaluation.dimensions` feeds the solver). **Anything that changes a
dimension's value or a parameter goes through `ToolHost.apply`**, which
re-solves the affected sketches in the same undo step. ADR-0017 (P1-08)
added constraint status: our planegcs patch exposes the diagnosis's
dependent parameters (`get_dependent_params`), the solver reports which
entities can still move (`ComponentReport.free`), `sketchStatus` (pure, in
the inference entry) makes each entity free/fixed/conflict, and the host
keeps `status` for the open sketch; the viewport draws three colour layers,
the palette counts DOF, and a new over-constraining dimension waits for
`OverConstrainedDialog` (`overConstrained`, `resolveOverConstrained`).
Next: **P1-09** (selection and editing in sketch). See `docs/03-roadmap.md`.

## Commands

```sh
pnpm install      # after pulling
pnpm dev          # app at http://localhost:5173
pnpm check        # typecheck + Biome + package boundaries + Vitest. Must pass.
pnpm e2e          # build + Playwright (run `pnpm e2e:install` once)
pnpm format       # Biome auto-fix
pnpm wasm         # download the OCCT and planegcs WASM for the current inputs (check/dev/build do this)
pnpm occt build   # build OCCT locally with Docker (~11 min); see packages/kernel/occt/README.md
pnpm planegcs build  # build planegcs locally with Docker (~2 min); see packages/sketch/planegcs/README.md
```

Package dependency rules live in `scripts/check-boundaries.mjs` (run by
`pnpm lint`). Add every new workspace package there. `packages/io` is MIT and
must never depend on the GPL packages.

## Read first

| Doc | What |
|---|---|
| `docs/01-requirements.md` | Vision, principles, functional requirements (IDs like FR-SK-07), NFRs, benchmark models B1–B10 |
| `docs/02-architecture.md` | Stack, package layout, document model, kernel worker, topological naming, storage, file format, testing |
| `docs/03-roadmap.md` | Phases, tasks with acceptance criteria, risks, open decisions. **Tick tasks here.** |
| `docs/04-ui-spec.md` | Layout, interactions, sketch mode, shortcuts, error-message style |
| `docs/05-brand.md` | Logo, colour tokens (Slate dark default + light), type, icon brief, voice. Logo SVGs in `docs/brand/` |
| `docs/references.md` | Other open-source projects we looked at, what to borrow from each, and their licenses |
| `docs/adr/` | Architecture decision records. ADR-0001: geometry kernel (libcascade). ADR-0002: sketch solver (planegcs). ADR-0003: document model, commands and undo. ADR-0004: expressions, units and parameters. ADR-0007: design system and shell. ADR-0008: viewport, camera and navigation. ADR-0009: project storage, autosave, home screen. ADR-0010: sketch data model and sketch mode. ADR-0011: sketch solver adapter. ADR-0012: sketch tool framework and inference. ADR-0013: basic drawing tools, tangent arcs, construction. ADR-0014: polygons, slots, ellipses, fit-point splines, lazy tool chunk. ADR-0015: constraint tools, glyphs, deleting constraints. ADR-0016: sketch dimensions, dimension parameters, re-solving on value changes. ADR-0017: constraint status, colours, over-constraint dialog (0005/0006 are reserved) |

## Stack summary

TypeScript strict · pnpm monorepo · Vite · React 19 · Radix + Tailwind v4 ·
Zustand + Immer · Zod · three.js via @react-three/fiber + drei ·
OCCT WASM (`libcascade`) in a Web Worker via Comlink · planegcs sketch solver ·
Vitest + Playwright · Biome. Desktop later: Electron.

## Hard rules

- **The document is JSON; geometry is derived.** Never store kernel shapes as
  the source of truth.
- **Every document change goes through a command** (undoable). No direct store
  mutation from components. Recipes are deterministic: create IDs with
  `newId()` in the caller and pass them in the payload.
- **The kernel runs only in the worker.** The UI thread never calls OCCT.
- **OCCT objects must be disposed of** (disposal scope / `using`). Leaks are bugs.
  With libcascade, `delete()` from JS often doesn't free what the C++ object
  owns, so heavy OCCT work goes through our C++ facade (ADR-0001). When using
  raw bindings, call `Clear()` before `delete()` on every `BRepAlgoAPI_*`.
- **Face and edge references use the topological-naming service**, never raw
  indices.
- **Platform APIs** (files, storage, dialogs, slicer launch) go through
  `apps/web/src/platform/` interfaces. This keeps the Electron port cheap.
- **Every numeric input is an `<ExpressionInput>`** (expressions and
  parameters, with units).
- **Fusion 360 is a conceptual reference only.** Never copy its code, icons,
  images, text or branding.
- `packages/core` has no DOM and no WASM. `packages/kernel` and
  `packages/sketch` must run in Node (for tests and the CLI).

## Workflow per task

1. Take the next unchecked roadmap task whose dependencies are done.
2. Implement it with tests. `pnpm check` must pass, plus `pnpm e2e` if UI flows
   changed.
3. Tick the task in the roadmap, add a line to `docs/CHANGELOG.md`, and write
   an ADR for any significant decision. Record rejected approaches too.

## Environment notes

- Node 26 and pnpm 12 come from mise (`~/.config/mise/config.toml`). CI uses
  Node 24 LTS; `engines.node` is `>=24`.
- **pnpm 12 refuses packages published less than a day or so ago**
  (`minimumReleaseAge`). If an install adds a `minimumReleaseAgeExclude` entry
  to `pnpm-workspace.yaml`, don't keep it: relax the version range (e.g.
  `^8.3.0` instead of `^8.3.1`) so pnpm picks an older release.
- **Playwright `webServer` must not start through pnpm.** `pnpm --filter …
  preview` and `pnpm exec` leave Vite running after the tests, and the run
  never ends. The config starts `node node_modules/vite/bin/vite.js` with
  `cwd: 'apps/web'`, bound to `127.0.0.1` (Vite otherwise binds IPv6 `::1`
  only while Playwright polls IPv4).
- **`biome migrate` rewrote `"recommended": true` into `"preset": "none"`**,
  which silently disables all rules. The config uses `"preset": "recommended"`.
- Playwright's own Chromium headless shell works on Arch. If it ever breaks,
  set `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium`.
- Don't use `pkill -f <pattern>` in a compound shell command: the pattern
  matches the shell itself and kills it. Kill by PID or port instead.
- This project is intended to become **public open source**. Unlike the rest
  of `~/Work`, it must never contain credentials, home-network details or
  personal data.
- **Spikes** live in `spikes/<task>/` as standalone packages outside the
  workspace (`pnpm install --ignore-workspace`); Biome ignores `spikes/`.
  Node 26 runs their `.ts` files directly (type stripping), and `using` works.
- **libcascade's `delete()` often doesn't free C++-owned memory** (found in
  P0-02): a 100k-point `NCollection_Array1` leaks its 2.4 MB buffer on every
  delete; `BRepAlgoAPI_Cut` leaks unless `Clear()` is called first;
  `BRepFilletAPI_MakeFillet` leaks and `Reset()` doesn't help. Reproduce with
  `spikes/p0-02-kernel/src/node/leak-bisect.ts` (`LIB=custom` for the trimmed
  build). The WASM heap only grows once its initial slack is used up (128 MB
  for the prebuilt build, 23 MB for ours), so run leak tests on a small heap,
  for ≥ 1000 iterations, with a leak control that must fail. A
  `malloc`-address probe was tried and is too noisy; `OSD_MemInfo` and
  embind's instance counters aren't exported. Reported upstream as
  [taucad/opencascade.js#40](https://github.com/taucad/opencascade.js/issues/40); check it before P0-09.
- **brepjs `*WithEvolution` returns empty maps unless the input faces carry
  metadata** (for example `tagFaces`): brepjs only sends face hashes to the
  kernel when there is something to propagate.
- **Custom OCCT builds need Docker** (2.4 GB image, about 10 minutes per
  build). The user was added to the `docker` group on 2026-09-25; until the
  next login, run Docker commands through `newgrp docker` (e.g.
  `echo "npx libcascade build" | newgrp docker`). The daemon is
  socket-activated. The binding list needs every base class and referenced
  type (`custom-build/closure.mjs`); `libcascade check` doesn't catch those.
  `MODULARIZE` + `EXPORT_ES6` and the three exception helpers in
  `EXPORTED_RUNTIME_METHODS` are required.
- **The planegcs WASM is not in git either** (`packages/sketch/planegcs/dist/`):
  CI's `planegcs` job publishes `planegcs-<hash>`, `pnpm wasm` fetches both
  builds. After changing `build.sh`, the `Dockerfile` or the patch, run
  `pnpm planegcs build` (through `newgrp docker` if needed) or let CI build
  it. Its clone lives in `packages/sketch/node_modules/.cache/planegcs-build/`,
  under node_modules so Vitest skips the clone's own tests (it ran them when
  the clone sat in `planegcs/.work/`). Sketch tests
  import `../../planegcs/dist/planegcs.js`; the browser loads it through
  `@extrudo/sketch/browser` (`?url`).
- **Solver drag speed depends on iterations, not size alone** (P1-03): with
  temporary constraints planegcs runs an SQP from an identity Hessian every
  call. A chained 99-entity plate drags in 11 ms, a 52-curve gear loop in
  120 ms. Benchmark with an off-path pointer (a pointer on the feasible path
  converges in a few iterations and hides this):
  `BENCH=1 pnpm vitest run packages/sketch/src/solver/perf.test.ts`.
- **The OCCT WASM is not in git.** `packages/kernel/occt/dist/` is built by CI
  once per input hash (config + `facade/` + toolchain version) and published as
  the GitHub release `occt-<hash>`; `pnpm occt ensure` downloads it with `gh`.
  After changing the config or the facade, run `pnpm occt build` locally
  (through `newgrp docker` until the next login) or push and let CI build it.
  The CI path is proven (run 36179601320, 2026-09-25): the `occt` job took
  about 16 minutes and published the release before the tests ran. After a
  local rebuild, restart the dev server: it keeps serving the old WASM.
- **Facade C++ (`packages/kernel/occt/facade/`):** the toolchain binds every
  class in the file, so it holds one class with no overloaded names. Check it
  in seconds with `em++ -fsyntax-only` inside the image (README) before a
  10-minute build. OCCT 8 deprecates `TopTools_*`/`TColStd_*` typedefs (use
  `NCollection_*`), `Standard_False`, and `Standard_Failure::GetMessageString`
  (use `what()`); `DynamicType()` isn't available on `Standard_Failure`.
  `mallinfo()` doesn't link, so the memory probe is `sbrk(0)` (`heapTop()`).
- **Screenshot baselines** (`e2e/*-snapshots/`) are made locally and must
  pass in the Playwright Ubuntu image, which renders like CI. Check with
  `echo "docker run --rm --ipc=host -e CI=1 -v $PWD:/work -w /work --user
  $(id -u):$(id -g) -e HOME=/tmp mcr.microsoft.com/playwright:v1.63.0-noble
  node node_modules/@playwright/test/cli.js test e2e/shell.spec.ts" | newgrp
  docker` (after `pnpm build`). Arch and Ubuntu differ by about 12 pixels per
  shot; the tolerance is 0.1 %.
- **E2E tests start on the home screen with empty storage** (each test has
  its own browser context). Open a project with `openProject(page)` or
  `openProject(page, 'wall-bracket')` from `e2e/helpers.ts`; reloads reopen
  the same stored project. Stub browser APIs with a string init script (for
  example `navigator.storage.persist`), since e2e/ has no DOM types.
- **Regenerate screenshots with `--update-snapshots=all`.** Plain
  `--update-snapshots` only rewrites shots that fail, and a small change (the
  save-state text) stays inside the 0.1 % tolerance, leaving a stale baseline.
- **Viewport tests read the camera from data attributes** on the Viewport
  region (`data-camera-direction`, `-up`, `-target`, `-size`) and wait for
  `data-ready` (first frame drawn; the viewport is a lazy chunk). WebGL runs
  on SwiftShader in headless Chromium and renders the same in the Arch and
  Ubuntu images.
- Biome needs `css.parser.tailwindDirectives` for Tailwind's `@theme` and
  `@custom-variant`, and the icon sources are exempt from
  `noSvgWithoutTitle` (they are decorative; controls carry the label).
- E2E specs typecheck without the DOM library: pass browser-side code to
  `page.evaluate` as a string (`'document.fonts.ready.then(() => true)'`).
- **Vite's watcher can miss a second edit to a file made within about a
  second of the first** (seen with two scripted edits in a row): the dev
  server keeps serving the old transform. `touch` the file, then reload.
- **Sketch e2e tests read the open sketch from the tool overlay's
  `data-sketch-summary`** ("points=8 lines=4 … constraints=8 dimensions=0"),
  and map sketch mm to page pixels from the camera attributes in the Top
  view (`sketchOnXY` in `e2e/helpers.ts`). The overlay exists only while a
  drawing tool runs. Tool unit tests use `sketch/tools/testing.ts`
  (`setup({ tool })`, real planegcs).
- **The browser pane's `left_click_drag` sends press and release with no
  move between**, and its screenshots can lag one action behind; read state
  with `javascript_tool` (the summary attribute) rather than trusting a
  screenshot taken right after an action. The viewport treats a press and
  release more than 5 px apart as a drag even without moves.
- **planegcs's `internal_alignment_point2ellipse` does nothing useful in our
  build** (converges without moving, wrong DOF count; P1-05). Ellipses use
  ordinary constraints instead (ADR-0014). Vitest swallows `console.log` in
  probe tests: write to a file in the scratchpad to see output.
- **planegcs "solves" some contradictions by collapsing geometry** (P1-06):
  two horizontal lines made perpendicular become dots 0.0001 mm long, with
  `ok: true`, and `check()` accepts the constraint. The host refuses a user
  constraint whose solve shrinks a curve below 1 µm (`collapses` in
  `sketch/tools/host.ts`).
- **planegcs names redundant equations, not constraints** (P1-06): a
  multi-equation constraint (collinear, some midpoints) can be partly
  redundant and still remove a freedom, and duplicates get their redundancy
  spread over both. `SketchSolver.check` therefore decides "not needed" by
  comparing DOF with and without the constraint whenever any redundancy
  shows (`#dofWithout`); reports have `redundant` (all equations) and
  `partlyRedundant`.
- **planegcs "solves" contradicting dimension values** (P1-08): a line
  10 mm long by one dimension and 20 mm by another solves with `ok: true`,
  the second listed as redundant and simply unmet. Check that dimensions
  hold by measuring (`unmetDimensions` in `packages/sketch/src/solver/status.ts`).
  Constraints on fixed geometry alone come back as redundant too
  (`overdetermined`); the status ignores them.
- **Sketch e2e tests read constraint status** from the Viewport region's
  `data-sketch-status` ("free=… fixed=… conflict=…") and the palette's
  `data-constraint-state`/`data-dof`. The browser pane may not draw the
  WebGL viewport at all (no `data-ready`); take screenshots with Playwright.
- **The Claude browser pane freezes its page while the pane is hidden**:
  input times out ("Timed out getting the tab ready") and scripts hang for
  45 s. That's not an app hang; reload, or check the flow in Playwright.
- **Don't render tool UI through `React.lazy`**: a suspended boundary is held
  back for up to ~300 ms, and keys typed into the heads-up box in that time
  are lost (flaky e2e). Load the module and render the component directly.
- **The Claude browser pane's `type` action inserts text without keydown
  events**, so it can't test "typing goes into the heads-up box"; use `key`
  presses, or Playwright's `keyboard.type`, which do fire keydown.
- Playwright's `toHaveAccessibleDescription` reads nothing from an
  `<output>` element referenced by `aria-describedby`; use a `<div>` with
  `aria-live` for field messages.
- Vitest 5 takes test options as the **second** argument:
  `it(name, { timeout }, fn)`; the old third-argument form throws.
- **planegcs (P0-03):** the published `@salusoft89/planegcs` WASM has a fixed
  16 MB heap and aborts with `Aborted(OOM)` at about 100 entities in one
  system; we build our own (`spikes/p0-03-solver/planegcs-build/build.sh`).
  Its bindings generator needs tree-sitter, which doesn't compile on Node 26:
  it runs in a `node:20-bookworm` container. Endpoint tangency must be
  `angle_via_point`: `tangent_la` + coincident endpoints gives false
  redundancies and a wrong DOF from a solved state. Set
  `debug_mode = DebugMode.NoDebug` or it prints to stdout. Adding or removing a
  constraint re-runs the full diagnosis (QR); changing parameter values doesn't.
- **SolveSpace's `slvs` npm package (3.1.0-dev.14)** is an old dev build:
  fixed heap, `tangent()` aborts, no `setParamValue`, entity objects without
  `point`. Rejected in P0-03; don't re-evaluate it without a newer build.
- **`LineSegments2.computeLineDistances()` throws on an empty geometry**
  ("reading 'count'": no `instanceStart` attribute yet). Call it only after
  `setPositions` with at least one segment.
- **R3F can deliver `pointerout` for the plane behind after `pointermove` on
  the one in front** (propagation stopped). Clear a hover only if it still
  names the object that was left (read the store, not the render closure).
- **The dev server takes an assigned port** (`.claude/launch.json` has
  `autoPort` and `--port "${PORT:-5173}"`), so a second session can run its
  own server while another holds 5173.
- OCCT's STEP writer prints a banner to stdout from inside WASM. Route
  Emscripten's `print` to a logger (or ignore it in tests).
