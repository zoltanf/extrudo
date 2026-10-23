# Performance baseline and snappiness plan (2026-10-23)

**Status:** proposal, nothing built. Measured on the Arch laptop (Ryzen 7 4700U,
Radeon integrated GPU, Node 26) against the production build of `main` at
`9ec1a812` (v0.8.3). Code pointers are against that commit. The owner's brief:
the app's snappiness must survive new features, and slow operations should say
so instead of freezing the UI.

Companion files (scratch, not in the repo yet): the browser-side measurement
script `ui-bench.mts` and the raw logs; option 1 below moves the script into
`scripts/`.

## 1. Baseline

### 1.1 Download and startup (`scripts/measure-startup.mjs`, 50 Mbit, brotli)

| Group | Raw | Brotli |
|---|---|---|
| OCCT WASM | 20.75 MB | 4.67 MB |
| App JS | 5.77 MB | 1.48 MB |
| Kernel JS | 1.17 MB | 0.32 MB |
| planegcs WASM | 1.04 MB | 0.35 MB |
| Other (fixtures, pictures) | 1.10 MB | 0.90 MB |
| Precache total | 30.81 MB | 8.24 MB |
| Not precached: OpenSCAD WASM 2.32 MB, demo clips 3.44 MB | | |

| Visit | Home screen | Kernel ready after opening the Wall bracket |
|---|---|---|
| First visit (3 runs) | 0.40–0.48 s | 1.9–2.2 s |
| Repeat visit (service worker, 2 runs) | 0.22–0.23 s | 1.21–1.25 s |
| Repeat visit, offline (2 runs) | 0.23 s | 1.16–1.19 s |

NFR-02 (home under 1.5 s on repeat, kernel under 3 s) holds. The 2.2 s to a
ready kernel is the OCCT download, compile and first recompute, all of which
start only when a project opens (`apps/web/src/project/useRecompute.ts`).

The script's repeat-visit path was broken: once a design is stored the template
gallery folds under "Start from a template" and the script still looked for the
card. The numbers above come from a patched copy; option 5 fixes the script.

### 1.2 Headless kernel recomputes (`packages/kernel/src/benchmarks.test.ts`, cold / warm edit)

| B1 | B2 | B3 | B4 | B5 | B6 | B7 | B8 | B9 | B10 |
|---|---|---|---|---|---|---|---|---|---|
| 83 | 113 / 45 | 130 / 59 | 237 / 103 | 296 / 294 | 172 / 115 | 982 / 709 | 462 / 380 | 7972 / 7750 | 316 / 411 |

Milliseconds. In line with ADR-0067's table (B7 867+625, B8 384+311, B10
249+326); this run shared the CPU with the startup measurement, so treat it as
±15 %. B9's threads are the only recompute over a second.

### 1.3 Sketch solver drags (`BENCH=1 packages/sketch/src/solver/perf.test.ts`)

| Sketch | Drag median | p95 | ADR-0050 |
|---|---|---|---|
| anchored-198 (22 components) | 0.24 ms | 0.30 ms | 0.20 ms |
| chained-99 (one component) | 12.8 ms | 13.9 ms | 11.8 ms |
| gear-52 | 129 ms | 180 ms | 117 ms |
| gear-104 | 1237 ms | 6390 ms | 1021 ms |

Budget 8 ms (NFR-01): the ordinary sketch is far under it, the coupled-loop
cases are the known risk-register item and unchanged.

### 1.4 In the browser (headed Chromium, real GPU, 1440 × 900, service worker off)

Each example opened from `#/example/<id>` on a fresh page. "Long" is the main
thread's long tasks (over 50 ms) in that window; "worst event" the slowest input
event's duration; fps the requestAnimationFrame rate.

| Example | Open → model ready | Long tasks while opening | Orbit 1.5 s | First hover / click | Undo → ready |
|---|---|---|---|---|---|
| storage-box (B2) | 1.08–1.25 s | 2–3 × 230–330 ms, max 120–160 ms | 50 fps, 0.4 ms render, no long task | pointerover 112 ms | not captured |
| pcb-enclosure (B5) | 1.51 s | 2 × 180–200 ms, max 120–127 ms | 50 fps, 0.5 ms | pointerdown 56 ms | 167–186 ms |
| knurled-knob (B7) | 2.00 s | 3 × 220–254 ms, max 98–113 ms | 50 fps, 0.4 ms | pointerdown 40 ms | 1050–1097 ms |
| name-tag (B8) | 1.96–2.00 s | 2 × 150–176 ms, max 100 ms | 50 fps, 0.4 ms | pointerdown 32 ms | 317–331 ms |
| chain-link (B10) | 1.54–1.55 s | 2–3 × 197–265 ms, max 106–121 ms | 50 fps, 0.6 ms | pointerdown 40 ms | 30–41 ms |
| bottle-cap (B9) | 8.54–8.57 s | 3 × 235–246 ms, max 95–103 ms | 50 fps, 0.4 ms | pointerdown 40 ms | not captured |

Two runs; where they differ both values are given. The undo column is the
round trip of one parameter change (document edit → worker → meshes → view),
measured through undo because the attribute observer lost track while the
Parameters dialog was open; the edit itself takes the same path. "Not captured"
means the observer saw no status change in 30 s (B2's round trip may fit in one
React commit; B9's is unexplained), to be fixed in option 1's spec.

What this says:

- **Interaction is in budget.** Orbiting never blocks the main thread; the
  renderer spends half a millisecond per frame on these models. Keydown and
  pointerdown handlers take 32–56 ms, under the 50 ms line but not by much,
  and that cost is a full re-render of the shell (section 3), so it grows with
  every panel added.
- **Opening a project is the one NFR-01 miss:** two or three long tasks of
  100–160 ms while the viewport chunk loads and the first bodies are built.
- **The first hover over a body costs 112 ms:** the picking BVH is built on the
  first pointer move after a recompute (`apps/web/src/selection/pick.ts:151`).
- **Opening the Parameters dialog is one 55–79 ms task.**
- Everything longer than that is kernel time (B7 1.1 s, B9 8 s), already
  covered by the "Updating the model…" notice after 800 ms.

## 2. What keeps it snappy today (keep these)

Kernel in a worker, meshes transferred not copied and only for changed bodies
(`packages/kernel/src/worker-api.ts`, `recomputer.ts`); edits coalesced for
30 ms and a superseded recompute cancelled in the worker; the canvas renders on
demand (`frameloop="demand"`); the model cache lists last session's bodies
before the kernel answers and the progress notice appears after 800 ms
(ADR-0078); export meshes body by body with progress and Cancel (ADR-0050);
wall thickness is time-sliced at 40 ms (`print/useThickness.ts`), the pattern
to copy for any new main-thread analysis.

## 3. Hazards (verified pointers; they grow with model or feature count)

1. **One `Shell` renders everything.** `shell/AppShell.tsx` (2,900 lines)
   subscribes to the whole document, hover and selection and renders Toolbar,
   BrowserPanel, Viewport, Timeline and the Parameters dialog as children. There
   is no `React.memo` anywhere in `apps/web/src` and no React Compiler, so every
   hover change and every edit re-renders the whole tree. This is where the
   32–56 ms input handlers come from, and it is the cost every new panel adds to.
2. **Hover is O(all faces).** `viewport/Bodies.tsx:140-159` re-renders every
   body on a hover; `selection/highlight.ts:39` allocates a face-state array
   per body and `paintFaces` diffs all of them.
3. **Picking runs per pointermove**, not per frame (`viewport/pointer.ts:129`,
   `Viewport.tsx:1461`), and `nearEdges`/`nearVertices` scan every edge point
   and vertex of every body each move (`pick.ts:336-400`).
4. **Silhouettes allocate per frame:** `Bodies.tsx:465-490` calls
   `geometry.setPositions` on every camera frame in wireframe and hidden-edge
   styles, which allocates a new interleaved buffer and recomputes bounds
   (three 0.186 `LineSegmentsGeometry`). Fine today at 0.5 ms; linear in curved
   triangles.
5. **All changed bodies are built in one React commit** (`Bodies.tsx:225-240`,
   `:448`): BufferGeometry, edge segments, silhouette plan. The open-time long
   tasks.
6. **Per-recompute `JSON.stringify` compares** of sketches, construction,
   canvases, imports, joints and every feature's refs (`recomputer.ts:744-758`,
   `:891`): linear in document size, on the UI thread, every recompute.
7. **Autosave side work:** after every save (800 ms after edits stop) the
   thumbnail re-renders the scene into a 256 px target and reads pixels back
   synchronously (`Viewport.tsx:1203-1262`); `projects.save` stringifies and
   encodes the document on the main thread; a linked folder re-zips every
   version (`packages/storage/src/archive.ts:84-100`), at most every 10 s.
8. **Sketch drags dispatch a document command per pointermove**
   (`sketch/tools/host.ts:1482-1501`), so each move also pays hazard 1 and
   schedules a recompute.
9. **Imports hash on the main thread:** STEP, mesh and SCAD files are hashed
   twice with a pure-TS SHA-256 (`features/import.ts:100`,
   `packages/storage/src/project-store.ts:284`); `.extrudo` import and export
   unzip and zip on the main thread.

### Kernel waits with no feedback

| Operation | Feedback today |
|---|---|
| Recompute after an edit | notice after 800 ms, status bar, browser rows `aria-busy` |
| Feature dialog preview | `data-preview-status="pending"`, nothing visible checked |
| Face or edge pick for a dialog field (`features/dialog.ts:615`) | none |
| Sketch on a face (`AppShell.tsx:1852`), Section on a face, Project onto sketch, joint pick | none |
| Clearance check, Measure, OpenSCAD variables, wall thickness | text ("Checking…", "Measuring…") |
| Export STL/3MF | progress bar; STEP/SCAD only disabled buttons; script export none |
| Plugin command (`AppShell.tsx:1808`) | none until a toast at the end |
| `.extrudo` import and export | none until a toast at the end |

Every call shares the one kernel worker, so a pick during a long recompute
waits for it with nothing shown.

### Instrumentation today

The status bar's render meter (`viewport/renderMeter.ts`) and the model
stats; two `performance.measure` marks (preview, script host load); the
`#/debug/solver` page. No long-task or event-timing observer anywhere.

## 4. Options (numbered for decisions)

### 4.1 Guardrails: keep it this way

1. **A performance spec in CI.** `e2e/perf.spec.ts` built from the scratch
   script: opens B5 and B7, records long tasks and event durations through
   `PerformanceObserver`, and asserts budgets on the main thread only (SwiftShader
   makes render time meaningless in CI): no long task over 200 ms while opening,
   none over 50 ms during an edit, undo or orbit, no input event over 100 ms.
   Writes its numbers as a JSON artifact like `e2e/timings.json` so trends are
   visible. **Recommended**, the cheapest insurance.
2. **Kernel budgets in the unit tests.** `benchmarks.test.ts` already times
   every benchmark; add ceilings at about 2× today's numbers (B9 has one at 30 s)
   so a slower evaluator fails `pnpm check`.
3. **Size budget.** `measure-startup.mjs --no-browser` in the check job, failing
   over 2 MB brotli of app JS or 10 MB of precache (today 1.48 and 8.24).
4. **Long-task observer in dev builds** (`import.meta.env.DEV`): logs any task
   over 50 ms with the last command name, and shows a count next to the render
   meter. Regressions are seen while developing, not in the next review.
   **Recommended** with 1.
5. **Fix `measure-startup.mjs`** (the folded gallery) and record the baseline in
   the NFR table or an ADR; rerun as a step of `docs/release-checklist.md`.
6. **Two rules for the ADR digest / CLAUDE.md:** per-edit work on the UI
   thread is O(changed), never O(document); any kernel wait the user triggers
   shows feedback within 300 ms (option 11 makes that automatic).

### 4.2 Make it faster

7. **Split the shell's re-renders.** Either wrap Toolbar, BrowserPanel,
   Timeline and the Viewport in `memo` and move the hover and selection
   subscriptions into the leaves that show them, or turn on the React Compiler
   (`babel-plugin-react-compiler` in `vite.config.ts`), which memoises
   automatically. The compiler is less work and covers future panels; it needs a
   check of build time and a full e2e run. The biggest lever on input latency.
   **Recommended**: try the compiler first, fall back to targeted `memo`.
8. **Hover and pick:** reuse the face-state arrays so unchanged bodies skip
   `paintFaces`; build the pick BVH right after a recompute in an idle callback
   instead of on the first hover (112 ms); coalesce pointer picking to one per
   animation frame. Small, local changes in `selection/` and `viewport/`.
9. **Spread geometry building when many bodies change:** build BufferGeometries
   over several frames (or in a `requestIdleCallback` loop) on project open and
   after a kernel restart. Removes the open-time long tasks.
10. **Hide the kernel start:** preload the Viewport chunk from the home screen
    (`modulepreload`) and spawn the kernel worker while the home screen shows,
    so the OCCT WASM is compiled before a design is picked (2.2 s → mostly
    hidden); keep the worker when switching designs.
11. **Idle-schedule the save side work:** thumbnail only when the view changed
    since the last one and in `requestIdleCallback`; the linked-folder archive
    likewise. Silhouette lines: update one buffer in place instead of
    `setPositions` per frame.
12. **Replace the `JSON.stringify` compares** in the recomputer with version
    numbers from the worker (it knows what changed).

### 4.3 Show that something is happening

13. **One busy indicator for every kernel wait.** Wrap the kernel client so each
    call from the UI carries a label ("Picking the face…", "Exporting STEP…",
    "Running the plugin…") and counts as in flight; a small store feeds the
    existing progress notice (the cube) and sets the `progress` cursor after
    300 ms, cleared when the call ends. One change in the client, a label per
    call site, no per-dialog spinners. **Recommended**; it covers the whole
    table above, including picks that queue behind a long recompute.
14. **Determinate progress for long recomputes.** The worker reports the feature
    it is on (n of m, name); the notice shows a bar and the timeline chips mark
    the computing feature. Visible gain on B9 (8 s) and on imports with many
    features; needs a progress channel in `worker-api.ts`.
15. **Cancel.** Escape stops a running preview or recompute where the kernel
    supports it (export does today) and the notice offers it.
16. **Thresholds.** Keep 800 ms before the recompute notice (quick edits must not
    flash); explicit waits (option 13) show at 300 ms; buttons disable at once.

## 5. Suggested order

- **Slice A (guardrails):** options 1, 4, 5. One job, about half a day on the Ubuntu machine;
  the spec is the yardstick for the next slices.
- **Slice B (latency):** options 7, 8, 9, measured before and after with slice A's
  spec. Facade untouched; the risky part is the compiler's correctness, so a full
  e2e run.
- **Slice C (feedback):** options 13 and 14, a UI change the owner should see
  running before a PR go.
- Later, as single commits: 10, 11, 12, 2, 3, 6, 15, 16.
