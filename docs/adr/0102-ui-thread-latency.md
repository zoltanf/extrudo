# ADR-0102: UI-thread latency: the shell's re-renders, hover and pick, the thumbnail, project open

- **Status:** Accepted, 2026-10-23
- **Task:** P6-14 (slice B of `docs/plans/perf-baseline-2026-10-23.md`:
  options 7, 8 and 9, plus the autosave cost ADR-0100 §4 found).
- **Builds on:** ADR-0100 (the budgets and `e2e/perf.spec.ts`, the yardstick
  for every change here), ADR-0024 (the recomputer), ADR-0030 (silhouettes),
  ADR-0078 (the model cache and progress notice), NFR-01.
- **No schema or file-format change.**

## Context

The baseline (the plan, §1.4 and §3) found the app's interaction cost
structural rather than acute: input handlers take 32–56 ms on a GPU laptop,
within NFR-01's 50 ms but only just, and every one of them is a re-render of
the whole shell. `Shell` (`apps/web/src/shell/AppShell.tsx`, about 2,900
lines) subscribes to the document, the hover and the selection and renders
Toolbar, BrowserPanel, Viewport, Timeline and the Parameters dialog as its
children; there is no `React.memo` in `apps/web/src` and no React Compiler, so
a hover from one face to the next re-renders every panel and every `Body`,
allocates a face-state array per body (`selection/highlight.ts`) and runs
`paintFaces` for each. The first hover after a recompute costs 112 ms because
the picking BVH is built on it (`selection/pick.ts:151`); picking runs on
every pointermove, not once per frame (`viewport/pointer.ts`,
`Viewport.tsx` around line 1460). Opening a project runs two or three
main-thread tasks of 100–160 ms (CI measures 125–198 ms of app JS). And
ADR-0100 §4 measured the one cost that forced a budget wider than planned:
after a parameter edit, the autosave's continuation runs 200–500 ms of JS,
which is the thumbnail: a full re-render of the scene into a 256 px target,
a synchronous `readRenderTargetPixels`, then `toBlob`
(`Viewport.tsx`, `snapshotWith`, around line 1160–1280; wired by
`project/autosave.ts` and `ProjectPage.tsx:246`).

None of this is slow today. All of it grows with every panel, body and
feature, which is what the owner asked to prevent.

## Decision

Four changes, each measured with `e2e/perf.spec.ts` (`E2E_GPU=1` locally,
SwiftShader on CI) before and after, in this order:

1. **The thumbnail leaves the edit's critical path.** The autosave still takes
   one after each save, but: (a) it is skipped when neither the document nor
   the camera has changed since the last thumbnail (compare the document
   object and the viewport store's camera state); (b) it runs in
   `requestIdleCallback` (timeout 2 s; `setTimeout` where the API is missing)
   and never while a recompute is running or a pointer button is down, which
   defers it rather than drops it; (c) the pixel readback is
   `renderer.readRenderTargetPixelsAsync` (three r166+; the app has 0.186), so
   the GPU is not stalled on the main thread. The snapshot API
   (`ViewportState.snapshot`, the export and named-view uses) keeps its shape:
   the options callers pass today keep working; `#88`'s snapshot-with-options
   path takes the async readback too. The home screen's "first thumbnail once
   the viewport has drawn" (`ProjectPage.tsx:275`) is unchanged in behaviour.
   **Acceptance:** `e2e/perf.spec.ts`'s edit budget goes back from 500 to the
   150 ms ADR-0100 §1 planned (CI green with it), and the thumbnails still
   appear on the home screen (`e2e/project.spec.ts` or wherever they are
   checked today).
2. **Hover is O(changed), not O(faces).** `bodyHighlight` is computed only for
   the bodies the hover or selection touches: a per-body memo keyed by the
   mesh and by the items that name that body, so an untouched body keeps its
   `faces` array identity and `useFaceColors`'s layout effect does not run
   (`Bodies.tsx:140-159`, `:380-404`). The picking index is built right after a
   recompute for the bodies whose mesh changed, in idle time
   (`requestIdleCallback`, one body per callback, abandoned when the mesh is
   replaced), so the first hover does not pay it; `indexOf` stays as the
   fallback. Pointer picking is coalesced: `report()` in `viewport/pointer.ts`
   runs the pick at most once per animation frame with the latest pointer
   position, and flushes synchronously before a pointerdown, pointerup or
   leave so a click always sees the hover it was aimed at. The sketch tools'
   pointer path (`sketch/tools/host.ts`) goes through the same `report()`;
   their drag solves are therefore also at most once per frame, which is what
   NFR-01's 8 ms drag budget assumes.
3. **The shell stops re-rendering on every edit and hover.** Try the React
   Compiler first (`babel-plugin-react-compiler` through
   `@vitejs/plugin-react`'s `babel.plugins`, target 19; MIT, in the
   allow-list): it memoises every component and hook automatically and bails
   out per component where a component breaks the rules of React, which is
   safe. Gate: `pnpm check` and the full e2e suite green, the production
   build at most 1.5× its time today, no bundle growth over 5 %, and a
   measured drop in the perf spec's hover and edit app time. Where the gate
   fails, the fallback is explicit: `memo` on Toolbar, BrowserPanel, Timeline,
   `DialogViewport` and `ParametersDialog`, with the hover and selection
   subscriptions moved from `Shell` into the leaves that show them. Either
   way `Shell` must no longer read `session.hover` itself. The choice and its
   numbers go into this ADR's amendment.
4. **Project open: measure, then fix the largest of ours.** The perf spec's
   `perf.json` names the scripts of each long task (`top`, ADR-0100 §4). If
   the largest open-time task is the first geometry build of many bodies
   (`Bodies.tsx:225-240`, `:448`: BufferGeometry, edge segments, silhouette
   plan per body in one commit), the build is spread: the derived parts (edge
   segments, silhouette plan, the pick index) are computed in idle time after
   the first frame while the body is already drawn with its faces, so the
   viewport's `data-bodies` and `data-ready` timing (which the e2e suite
   waits on) do not change. If it is module evaluation of the viewport chunk
   or React's first commit, that is recorded with its number and left for a
   later task (preloading the chunk, option 10 of the plan). Progressive
   *display* of bodies is rejected here: it would change what `data-bodies`
   means to a hundred specs.

Each change is one commit with its before/after numbers in the message.

## Rejected

- **Throttling the sketch solver on drags separately from picking:** one
  `report()` per frame covers both; a second timer would just add latency.
- **Taking the thumbnail from the last drawn frame's canvas** instead of a
  separate render: the canvas has `preserveDrawingBuffer: false` and the
  thumbnail wants a fixed size and a framed view; the async readback removes
  the stall without changing what the thumbnail shows.
- **Building the pick BVH in the kernel worker** and transferring it: the
  BVH is three-mesh-bvh's own structure and its serialised form is as large
  as the mesh; idle-time building on the main thread costs nothing the user
  feels.
- **A virtualised timeline or browser list:** not until a measurement says
  the list itself is the cost; after change 3 it re-renders only when its own
  inputs change.

## Consequences

- The perf spec's edit budget returns to 150 ms; the hover budget can be
  tightened once a few CI runs show the new numbers.
- Hover changes reach the screen on the next animation frame rather than
  synchronously (at most 16 ms later); unit tests of `pointer.ts` that assert
  a synchronous hover after a synthetic move need a frame flush.
- With the React Compiler on, a component that mutates props or reads refs
  during render is silently left unmemoised; the compiler's ESLint plugin
  (`eslint-plugin-react-compiler`'s rules through Biome where available, or a
  one-off `npx react-compiler-healthcheck`) reports them, and the amendment
  lists the ones found.

## §5. Amendment 2026-10-24: the compiler decision

**Kept: the React Compiler, through `@vitejs/plugin-react`'s native
`compiler` option** (`react({ compiler: { target: '19' } })` in
`apps/web/vite.config.ts`, with `oxc-transform-react` 0.145, MIT, a
devDependency of `@extrudo/web`). The decision text above names
`babel-plugin-react-compiler` through `babel.plugins`; the app's
`@vitejs/plugin-react` 6.1 no longer has a `babel` option, and offers two
routes instead, both measured against the gate (Ubuntu desktop, 4 cores,
three builds each, `pnpm --filter @extrudo/web build`):

| | `vite build` | app JS raw | app JS brotli |
|---|---|---|---|
| no compiler | 2.20 / 2.16 / 2.17 s | 5.78 MB | 1.48 MB |
| Babel (`babel-plugin-react-compiler` 1.0 via `@rolldown/plugin-babel` 0.2 and `reactCompilerPreset`) | 15.74 / 15.79 / 15.95 s (7.2×) | 5.94 MB (+2.8 %) | 1.53 MB (+3.4 %) |
| native (`oxc-transform-react` 0.145) | 2.65 / 2.69 / 2.64 s (1.22×) | 5.99 MB (+3.6 %) | 1.54 MB (+4.1 %) |

The Babel route fails the build-time gate (≤ 1.5×) by far; the native one
passes it and the size gate (≤ +5 %). plugin-react's README calls the native
port experimental and pins its peer to `^0.145.0`: an upgrade of either is a
re-run of this gate.

The perf spec, GPU, three runs each (window `jsTotal` / the worst input
handler's `proc`, ms; "before" is change 2's build, "after" the compiler
with the hover subscription moved, below):

| Window | B5 before | B5 after | B7 before | B7 after |
|---|---|---|---|---|
| edit | 124–132 / 42–45 | 100–104 / 39–40 | 111–113 / 35–40 | 94–106 / 33–35 |
| undo | 15–18 / 13–15 | 11–12 / 9 | 14–16 / 13–14 | 10–11 / 8 |
| hover | 38–40 / 23 | 10–24 / 8–13 | 37–40 / 22–26 | 23 / 12–13 |

(B7's hover after is the Escape keydown crossing the spec's 16 ms event
threshold, which adds its handler to `jsTotal`; with the compiler alone it was
10–11 / 7.) A CPU profile of a 60-move hover sweep over the model (unminified
builds, GPU, two runs) is the clearer number: B5 284–288 → 92 ms of JS, B7
407–423 → 108–114 ms. Before, the sweep was React re-rendering the shell
(`renderWithHooks`, Radix's `mergeProps`/`cloneElement`); picking was ~15 ms
of it.

**`Shell` no longer reads `session.hover`.** `DialogViewport`
(`shell/AppShell.tsx`) subscribes to it and adds it to what the shell builds
without it: the sketch drawings (`shell/hoverDrawings.ts`,
`sketchesWithHover`: `highlight`, `hoverEntity`, `hoverProfile`), the ghosts
(`ghostsFor(hoveredFeatures)`, a callback the shell memoises on everything
else) and the view's `hover`. `PlanePicker` lost its `hover` field: the view
derives the hovered plane from its own `hover`, so `dialogPlanePicker`,
`useSection` and Create Sketch's picker no longer take one.

**What the compiler leaves alone.** Its diagnostics (203, in 56 functions)
are bail-outs, safe by design: the function runs as before. The ones that
matter: `Shell` (34 reads of refs during render, the `latest.current = …`
pattern), `Viewport`, `Scene`, `Body`, `Silhouettes`, `EdgeMarks`,
`VertexMarks`, `Sketch` and the other three.js leaves (they mutate three
objects in render), Timeline's `Chip`, `GroupChip` and `Marker`,
`DialogOverlay`, and the hooks `useSection`, `useThickness`, `useOverhang`,
`useJointCheck`, `useFeatureDialogs`. Toolbar, BrowserPanel, Timeline and
ParametersDialog compile. List them again with the compiler's
`logDiagnostics: true` or `oxc-transform-react`'s `transformSync` per file.

**What the compiler broke, and the rule.** It assumes a component's output
depends only on its props, state and context. Two components read mutable
state during render through an object whose identity doesn't change, and
went stale: the notification history's actions (`action.available()`,
`notifications.spec.ts`) and the Joint dialog's frame fields
(`controller.frameText(side)`, `joints.spec.ts`). They, and the feature
dialog's components that read `controller.context()` while drawing
(`features/FeatureDialog.tsx` and `features/ScadOverrides.tsx` as whole
modules, `CanvasCalibrate`), now start with `'use no memo'`. The rule: a
component that reads state through a method, a getter or `getState()` while
it draws must take that state as props or say `'use no memo'`.

Rejected: `memo` on the panels by hand — the gate passed, and the compiler
covers every component rather than five; the Babel route — 7× the build
time.

**Dev server, 2026-10-24 (coordinator's review).** The compiler option
makes `@vitejs/plugin-react` transform every file its filter matches, and in
`pnpm dev` that transform adds the Fast Refresh wrapper (`$RefreshReg$`), so
the kernel worker's modules got it too and the worker died on start ("The
kernel stopped: Uncaught ReferenceError: $RefreshReg$ is not defined"); no CI
run sees it since e2e tests production builds. `react()` now takes
`exclude: [/\/node_modules\//, /\/packages\//, /[wW]orker\.ts$/]`, which the
plugin's own documentation names for worker code: only `apps/web` has React,
so nothing compiled is lost. Checked in the dev server: the knurled knob
opens with the kernel ready. Rule in the digest: `pnpm dev` is checked after
any change to the plugin's options.

**Audit, 2026-10-24 (coordinator's review).** An independent pass ran the
compiler over every file and read the compiled output of each function that
reads mutable state in render. One regression beyond the five marked
components: the key labels. `keysFor(id)` reads a module variable
(`commands/keymap.ts`), and the design relied on `App`'s `useKeymap` re-render
to refresh every label after a change in Settings › Keyboard; compiled, the
labels were memoised on `id` alone and stayed stale until a reload (the
Undo, Redo and Search tooltips in `shell/AppBar.tsx`, the app menu's items,
the toolbar tiles, the sketch palette's Construction key, the annotation
menu's Delete). Fix: `useKeysFor()` (`commands/keymapStore.ts`) subscribes to
the keymap with `useSyncExternalStore` and returns a lookup bound to the
live overrides, so a label computed from it has the overrides as a
dependency; the five sites use it, `keysFor` outside render is unchanged.
`e2e/settings-keyboard.spec.ts` now checks the tile's tooltip shows the new
key before the reload. Known and accepted, each rare and small: the status
bar's `SoftwareRendering` keeps the probe result from before a WebGL retry
(`shell/Timeline.tsx`); a clearance section's "= x mm" readout follows a
parameter edit only when its text changes (`joints/ClearanceSection.tsx`);
a feature context menu opened during a recompute keeps its issue count
until reopened (`shell/FeatureMenu.tsx`); a floating dialog re-clamps its
position on the next move after a window resize
(`design-system/FloatingDialog.tsx`); a profile readout follows a font that
finishes loading on the next selection (`sketch/panels.tsx`). The rule
stands: state read through a method, a getter, `getState()` or a module
variable in render is taken through a hook (`useSyncExternalStore`) or as
props, or the component says `'use no memo'`.

## §6. Amendment 2026-10-24: what project open spent, and the fix

The perf spec's `open` window (GPU, three runs before any change) names only
entry points: B5's three largest long tasks were `MessagePort.onmessage`
306 / 259 / 262 ms, then 159–166 ms (`Worker.onmessage` or
`MessagePort.onmessage`), then 102–120 ms; B7's 94–158, 58–126 and
63–65 ms. `MessagePort.onmessage` is React's scheduler (it runs renders and
commits from a `MessageChannel`), so the largest task is a React render — but
not the first geometry build §4 expected. A CPU profile of the open
(unminified builds, GPU, `Profiler` at 100 µs, two runs per example) names
the functions: the largest single cost of ours was **ADR-0076's WebGL probe**
(`viewport/webglSupport.ts`, `detectWebgl`, called from `Viewport`'s first
render): `rendererOf` 50–201 ms, `lose` 5–206 ms, `tryContext` 12–17 ms per
open — two throwaway contexts made and lost while the GPU process is busy
starting the view. Then three's own context start (`getExtension`, 6–209 ms,
the first context of a cold GPU process pays it), then React
(`renderWithHooks` ~20 ms, `measure` ~15–24 ms). `Bodies.tsx`'s geometry,
`edgeSegments` and `silhouettePlan` were not among the 15 largest functions
for either example, so §4's idle-time geometry is not done: it would move
little and change what the view draws first.

**The fix:** the home screen runs the (cached, per-page) probe right after
its first paint (`home/HomeScreen.tsx`, `afterPaint` in `src/idle.ts`), where
it costs 40–90 ms with the GPU idle (measured on the home page in Chrome with
a GPU: context 13–16 ms, renderer string 1–52, lose 2–16, the strict context
12–20, lose 1–7). Opening a design from the home screen then finds it done.
A design opened by a direct link still probes in the view's first render, as
before. Measured with the perf spec (GPU, three runs; before = change 3):

| | B5 open `appMax` | B5 `appTotal` | B5 open → ready | B7 open `appMax` |
|---|---|---|---|---|
| before | 252–267 ms | 598–620 ms | 2.46–2.49 s | 89–97 ms |
| after | 115–135 ms | 277–333 ms | 2.15–2.18 s | 90–94 ms |

(B7's test runs second in the same browser, whose GPU process is already
warm, so its probe was cheap before too.) The CPU profile agrees: the open's
JS, B5 878–985 → 588–663 ms.

Rejected here: dropping the second (`failIfMajorPerformanceCaveat`) probe
context — it is how ADR-0076 tells a blocklisted GPU, a behaviour change for
another ADR; probing from a worker with `OffscreenCanvas` — `webglSupport()`
is synchronous for its callers, a larger change for ~100 ms; spreading the
bodies' derived geometry over idle time — not where the time goes.

## §7. Amendment 2026-10-24: the perf spec's round trip starts at the edit

CI (SwiftShader) failed `e2e/perf.spec.ts` on B5's parameter round trip on
this branch (`roundTripAppMs` 1861 / 1581 for change 1, 1988 / 1766 for
change 3; budget 1500) and on main too (1945 in run 40018954732, 2592 in
40000512395), with the app's own JS in that window 80–150 ms. The observer
was armed before the Parameters dialog opened, so the round trip also timed
the click that opens it, the dialog's first SwiftShader frames and finding
the field — not the document edit → worker → meshes → view that ADR-0100 §1
defines. It is now armed once the parameter's expression field is visible,
still before typing (the field applies while typing). Measured locally,
before → after: SwiftShader B5 906 → 426 / 446 ms, B7 1727 → 1350 / 1379;
GPU B5 663 → 377, B7 1617 → 1295. The budgets are unchanged.
