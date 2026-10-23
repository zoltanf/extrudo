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
