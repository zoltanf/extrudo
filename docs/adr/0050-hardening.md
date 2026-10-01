# ADR-0050: Hardening pass

- **Status:** Accepted, 2026-09-30
- **Task:** P3-13 (robustness fuzzing, format and version-history
  hardening, recompute errors as notifications, chunked export meshing,
  profiling against NFR-01, accessibility audit). Code:
  `packages/kernel/src/fuzz.test.ts`; `@extrudo/sketch`'s
  `solver/gradual.ts` (`solveGradually`, in the `/inference` entry) and its
  use in `apps/web/src/sketch/tools/host.ts`; core `loadDocument` /
  `loadNotice` (`migrations.ts`), storage `readArchive`, `ProjectStore.load`
  / `importFile` options, `deleteVersions`, `lock` (`webLock`, `localLock`),
  the app's `project/actions.ts` notices and `VersionsDialog.tsx`; the
  engine's unknown-input rule and `hold`; `shell/recomputeErrors.ts` and
  `ToastOptions.quiet`; `KernelApi.exportMeshes`' `onProgress` and the
  export dialog's progress bar; `viewport/silhouette.ts`
  (`silhouettePlan`); `e2e/a11y.spec.ts`.
- **ADR number:** written as 0051 on its branch and renumbered to 0050 at
  merge, since P3-08's Press/Pull (merged first) took 0051.
- **Builds on:** ADR-0003 and ADR-0009 (format, storage), ADR-0011 and
  ADR-0016 (solver, dimensions), ADR-0024 (engine), ADR-0029 (heap open
  item), ADR-0030 (silhouettes), ADR-0031 (projection syncs), ADR-0034
  (export), ADR-0036 (versions), ADR-0041 (notifications), ADR-0047
  (patterns).

All numbers below were measured on the Arch workstation (Ryzen 7 4700U,
8 cores, the CPU class NFR-01 names), Node 26, the production OCCT WASM,
unless said otherwise.

## 1. Fuzzing the benchmark fixtures

`fuzz.test.ts` loads each `fixtures/benchmarks/*.extrudo` and makes random
edits with a fixed seed (mulberry32): a user parameter, a sketch dimension or
a feature expression scaled by a factor (mostly 0.5 to 3, a quarter of the
time 0, −1, 1e-4, 0.01, 10, 100 or 1e4), now and then a suppress toggle or a
marker move, and now and then a reset to the fixture. It does what the app
does around an edit: sketches whose dimension values changed are solved (a
failing or collapsing solve refuses the edit, as the host does), the engine
recomputes with its cache kept (`strictLeaks`), and projected curves are
synced to the kernel's reports and solved again (`ToolHost.syncProjections`),
recomputing until nothing changes. A step fails on a crash (an exception out
of the engine or a WASM trap), an "Internal error" status (an evaluator
threw something other than a `KernelError`), a leaked shape, a recompute
over 20 s, or a warm result that differs from a cold recompute of the same
document (checked every 10 steps: statuses and body volumes). CI runs 200
steps per fixture (about 3 s); `FUZZ_STEPS`, `FUZZ_SEED`, `FUZZ_REPORT=1`
(counts of every feature message, and recompute times) for longer runs.

**Found:** 1500 steps per fixture gave no crash, no leak, no internal error
and no warm/cold difference. They did find that a plausible edit broke B2:
depth 60 → 30 mm moves the top edge that Sketch2 projects by 30 mm, and one
solve put the inner wall line 3 mm *outside* it (y = 33, not 27): a distance
dimension is unsigned and planegcs converges to the nearest solution, which
is on the far side once an edge moves more than the distance held from it.
Extrude2 then lost its profile ("Can't find one of its profiles any more").
The same happens in the app, both for projection syncs and for parameter or
dimension changes (a wall of 3 mm changed to 40 mm).

**Fix: `solveGradually`.** When a change is large against the sketch's
smallest size (shortest drawn line, smallest circle, smallest length a
dimension holds), the fixed geometry that moved (projected curves) and the
dimension values go from the last solved state to the new one in steps: each
step moves at most half of that size (30° for angles), every solve starts
next to its answer, and the geometry follows as a drag would. At most 100
steps and about 4000 entity-solves per change (a big sketch takes fewer
steps); a small change is one plain solve, as before. The host's `settle`
(parameter and dimension edits through `apply`) and `settleProjections`
(it now gets the sketch before the sync) use it. Tests: the fuzzer's
regression case (depth 60 → 30 → 12 → 90, the box's exact volume each
time), the host (`projection.test.ts`: an edge moving 10× the distance) and
`gradual.test.ts` (the far side in one solve, the near side in steps).

**Left as legitimate** after reading every "lost" case: edits that destroy
the side information (a wall of 0 mm, or ×100 so the inner outline turns
inside out), a reversed extrude that flips the face a sketch sits on, a
change larger than 100 steps can follow (a 24 m box with 3 mm walls), and
B3's geometry (a rest set back beyond the base, a base thinner than where
the rest starts: "doesn't touch").

## 2. The file format version and unknown keys

Before, a file of a newer format version was refused, and so was a file of
the same version with an optional field the reader didn't know (strict
schemas), although `docs/file-format.md` promised optional fields need no
version bump.

1. **Unknown keys are left out, not refused.** `loadDocument` validates as
   before; when the only issues are `unrecognized_keys`, it deletes those
   keys (their paths come with the issues, at any depth: settings,
   parameters, features, inputs, sketch entities, references, bodies) and
   validates again. `LoadResult.dropped` lists the paths. Any other issue
   still makes the document `invalid`.
2. **A newer format version is read as far as this version understands it.**
   The document is read as the current version with unknown keys left out;
   if that validates, it opens, else it is `too-new` as before (with the
   issues). A reshaped field or a changed type fails; a new feature type
   loads and computes as an error, as it always did.
3. **The manifest's `formatVersion` is checked**: it must be an integer
   (else damaged), and a newer one counts as a newer file even if its
   document isn't (`Archive.loadedVersion` is the newer of the two).
4. **The user is told.** `loadNotice(result, 'drops' | 'copy')` words it:
   "This design was saved by a newer Extrudo (file format 2; this version
   reads 1). 1 setting this version doesn't know was left out. Saving here
   loses them; reload to update Extrudo first if you need them." for a
   stored project, "The file itself is unchanged." for an import.
   `ProjectStore.load` and `importFile` take `{ onNotice }`; the app keeps
   the message per project across the navigation (`noteOnOpen`,
   `takeOpenNotices`) and shows it as an info toast for 20 s when the
   project opens, so it is in the notification history too.
5. **Feature inputs:** the engine used to fail a feature whose inputs had a
   name its type doesn't define ("Invalid inputs"). It now leaves such
   inputs out and marks the feature with a warning ("This version of
   Extrudo doesn't know the input "draft" and left it out."). A missing or
   malformed input is still an error.

The spec's rule "a reader must not guess; it must refuse… never write back a
downgraded file" is replaced: the app opens what validates and says what it
left out; an imported file is a copy, a stored project is written in this
version's format on the next save (which the notice says). There is no
read-only mode.

## 3. Version history: locks, delete and prune

- **Web Locks.** Every read-modify-write of a project's version index runs
  under the lock `extrudo:versions:<id>` (`ProjectStoreOptions.lock`). The
  browser store passes `navigator.locks.request` (`webLock`), which holds
  across tabs; without the API, and in tests, `localLock` chains tasks per
  name within the page. A test with two stores over the same files shows
  the lost entry without a shared lock and none with it.
- **`deleteVersions(id, numbers)`** rewrites the index first, then removes
  the files (a crash leaves an unlisted file, never a listed version without
  one). The index now records `next`, so numbers are never given out twice
  even after the newest version is deleted; an index without `next` (older
  files) counts from the highest.
- **UI:** a Delete button per version and, with more than 10 versions,
  "Delete older versions" (keeps the newest 10), both behind a
  `ConfirmDialog` ("Delete V1–V5?"; it can't be undone). The result is said
  in the dialog's own status line: a toast behind a modal dialog is hidden
  from assistive technology (the modal marks the rest of the page inert).

## 4. A recompute's first new error becomes a notification

`watchRecomputeErrors` (started in `AppShell`) follows the model store. For
each result of the current document, the first feature in timeline order
whose error is new (it had none, or another message, in the last result)
goes into the notification history: "Extrude1: The distance is 0 mm. Enter
a distance other than 0.", with an **Edit** action that applies while the
feature still fails and can be opened. A recompute that fails as a whole
(the kernel stopped) is noted once per message.

These are **quiet** notifications (`ToastOptions.quiet`): recorded, counted
by the bell's badge (red for errors), but no toast. The error already shows
on its chip and in the status bar where the user is looking; a sticky error
toast on every broken parameter would cover the view's corner, and the
history is what was missing (ADR-0041's open item).

## 5. Export meshing in chunks

`KernelApi.exportMeshes(bodies, tessellation, onProgress?)` meshes one body
per facade call and yields between bodies, so a recompute waits for one
body, not the whole export. Before each body and at the end it calls
`onProgress(done, total)` (a Comlink proxy across the worker); a `false`
stops the export with `ExportCancelledError`. The engine's new `hold(bodies)`
keeps the shapes referenced until the export ends: a recompute in between
may drop them from the cache without freeing what is still being meshed (a
test with a one-entry cache recomputes another document mid-export; without
the hold it fails with "unknown shape").

The dialog shows a progress bar (by bodies; a moving bar for a single body)
and "Meshing 3 bodies… 1 of 3 done". Its Cancel (closing it), another choice
of bodies or resolution, or a new model stop the kernel before its next body.

**Not chunked:** one body is still one call. BRepMesh has no finer unit
without a facade change that meshes faces separately while sharing edge
discretisation (the weld relies on one discretisation per edge, ADR-0034).
STEP is still one call too.

## 6. Profiling against NFR-01

| What | Before | After | Notes |
|---|---|---|---|
| Silhouette pass, 1 M curved triangles (torus 1000 × 500) | 20.5 ms | 6.2 ms | per frame of a camera move in wireframe or hidden-edge style |
| 10 × 10 overlapping 6 mm holes at 5 mm (pattern of a cut) | 5.5 s (7.9 s on the shared Ubuntu box) | unchanged | see below |
| Same case, prototype: one cut per colour class | 3.8 s (tree fuse + cut, same harness) | 1.9 s | same volume and area, valid |
| Warm edit recompute + projection sync, fuzzed B1/B2/B3 (400 steps) | | median 1–3 ms, p95 9–30 ms, max 48 ms | budget 150 ms |
| Sketch drag, 198 entities in 22 components | | median 0.20 ms, p95 0.29 ms | budget 8 ms |
| Sketch drag, one component of 99 chained entities | | median 11.8 ms | (ADR-0011) |
| Sketch drag, gear loop of 52 / 104 curves | | median 117 ms / 1021 ms | risk register, unchanged |
| WASM heap top, 10 000 fuzzed B3 then B2 edits, warm cache | | 19.25 MB, one 16 MB step at about edit 2250, then flat at 35.4 MB | |
| WASM heap top, ADR-0029's revolve document, warm cache (256 entries) | | 35 → 196 MB over 1500 recomputes, about 11 MB per 100 | live shapes constant (424); not fixed, see below |
| Same, 24 entries / only the pinned results | | a 16 MB step about every 300 recomputes | 38 / 9 live shapes |
| Same, cache cleared after every recompute | | flat | the memory test |

- **Silhouettes:** the pass evaluated the facing function at each
  triangle's three corners; nodes are shared by about six triangles.
  `silhouettePlan(mesh)` lists the curved faces' nodes once (with the
  per-node buffer), and the pass evaluates each node once, then only reads.
  6 ms at a million curved triangles leaves room in a 16.7 ms frame; it
  stays on the frame path (no throttling needed at this size).
- **Overlapping pattern instances:** `mergeTools` tree-fuses every group of
  interfering instances, and a 10 × 10 grid of overlapping holes is one
  group. Colouring the interference graph instead (here instances two steps
  apart never meet, so (i mod 2, j mod 2) gives 4 classes) makes each class
  a compound of tools that don't interfere, a valid boolean argument, and
  the body is cut once per class: 1.9 s against 3.8 s in the production WASM
  (`boolean-bench.test.ts`, `BENCH=1`). A native harness in the OCCT image
  also timed a facade list-boolean (`BRepAlgoAPI_Cut`/`Fuse` with every tool
  in the tool list): list cut 1.57 s, list fuse then cut 1.34 s, tree fuse
  2.07 s, colour classes 1.09 s. So **no facade change**: the colour classes
  beat a list-fuse without an OCCT build. The change belongs in
  `packages/kernel/src/features/pattern.ts` (`mergeTools`), which P3-04 and
  P3-08 are changing; it is left as an open item (greedy colouring over the
  interference graph `mergeTools` already builds; history per cut composes
  like any sequence of booleans).
- **Heap with a warm cache:** two different pictures. The fuzzed
  fixtures (extrudes, a combine, projections) step up once by 16 MB and
  then stay flat for 10 000 edits. ADR-0029's revolve document (a groove
  cut G, a two-sided ring R about a construction line, a face F turned
  about an edge and joined; every recompute a new angle for G and R)
  **keeps growing**, about 11 MB per 100 recomputes:
  - with the default cache (256 entries) 16 MB about every 150
    recomputes; with 24 entries, or only the pinned current results
    (9 live shapes), about every 300; cleared after every recompute, flat;
  - the number of live shapes stays constant throughout (no shape leaks);
  - the allocator doesn't matter: our build already links **mimalloc**
    (the toolchain's default; setting `MALLOC: 'mimalloc'` changed
    nothing), and a local build with `MALLOC: 'dlmalloc'` grew at the same
    rate, smoothly instead of in 16 MB steps, and was about 30 % slower;
  - **only all three revolves together grow**: G, R, F alone and every pair
    (G+F, R+F, G+R) stay flat after one step (`HEAP_ONLY`);
  - a native harness (the OCCT image, plain OCCT calls: a persistent block
    and profile face, a revolve and a cut every run, with or without
    `SetNonDestructive` or copied inputs, and a rolling cache of cut and
    meshed results) stayed flat under dlmalloc, emmalloc and mimalloc.

  So it is neither a shape leak nor plain fragmentation that a smaller
  cache or another allocator cures; something in our pipeline keeps about
  110 kB per recompute when all three run. **Not fixed**: trimming the cache
  only slows it, and the cause needs attributing inside the facade (the
  next step: a dlmalloc build, where growth is smooth, and `heapTop` around
  each `Kernel` call of one recompute of the full document). At this rate a
  1000-edit session of such a document costs about 110 MB; running out of
  memory (2 GB) crashes the worker, which restarts (NFR-03). Gated
  measurements:
  `FUZZ_HEAP=5000 pnpm vitest run packages/kernel/src/fuzz.test.ts -t heap`,
  `HEAP_RUNS=700 [HEAP_MAX_ENTRIES=24] [HEAP_ONLY=GF] pnpm vitest run packages/kernel/src/memory.test.ts -t "warm cache"`
  (about 0.3 s a recompute). They run the WASM the browser runs, so a
  browser session adds nothing for the heap itself.

## 7. Accessibility audit

`e2e/a11y.spec.ts` runs axe-core (`@axe-core/playwright`, WCAG 2.1 A and
AA) on the home screen, the shell with the Wall bracket, a feature dialog,
Parameters, Versions, the command palette, Export, Measure, Section
Analysis, Print Info, the notification history and sketch mode, in the dark
and the light theme. It fails on any violation that isn't in its `KNOWN`
list (rule + a piece of the node's HTML + why).

**Fixed:** the New design card's muted line on the accent tint (4.2:1, now
ink at 75 %); `aria-selected` on a body's `<li>` in the browser (not allowed
on a list item; the name button's `aria-pressed` says it, the row keeps
`data-selected`); `aria-label` on the 3D view's wrapper div without a role
(now `role="img"`); the "Esc" key hints on accent buttons (Measure, Section,
Print Info, Overhangs) at 70 % opacity, 3.9:1 in the light theme (now 85 %,
about 5.3:1).

**Known, left:**
- The feature dialog OK button's "Enter" hint has the same 3.9:1 in the
  light theme; it is in `features/FeatureDialog.tsx`, which P3-04/P3-08 are
  changing (in `KNOWN`).
- What axe can't see: the 3D view is a canvas, so picking, the ViewCube's
  faces and hover highlights have no keyboard or screen-reader path except
  through the browser, the timeline and Ctrl+K; sketch constraint status is
  colour plus glyphs but the glyphs aren't announced; `prefers-reduced-motion`
  isn't checked by a test; focus order across the floating panels isn't
  audited. These need a manual pass with a screen reader (the owner's, P3-15
  or P3-17).

## Rejected

- **Fuzzing through the UI** (Playwright): far slower per step and flaky
  under load; the kernel and the solver are where crashes and leaks live,
  and the fuzzer drives them exactly as the host does.
- **Fixing the side flip with signed distances:** changes the dimension
  model and every tool that makes dimensions. Stepping keeps the model and
  only costs solves on large changes.
- **Refusing unknown keys but ignoring them in the schema (`z.object`
  instead of `strictObject`):** loses the list of what was dropped, which
  the notice needs, and would let typos in our own writers through tests.
- **A read-only mode for newer files:** the app has none, and a copy
  (import) or a clear notice covers the cases that matter.
- **Toasts for recompute errors:** see §4.
- **A facade list-fuse for patterns:** slower than colour classes (§6).
- **Trimming the cache or switching the allocator for the heap growth:**
  measured, neither stops it (§6).
- **Meshing in a second worker:** the shapes live in the kernel worker's
  heap; moving them would mean serialising B-reps (a facade change) for a
  gain only big single bodies would see.

## Consequences and open items

- Pattern colour classes in `features/pattern.ts` (§6), after P3-04/P3-08.
- The warm-cache heap growth of the revolve document (§6): attribute it
  inside the facade.
- The feature dialog's "Enter" hint contrast (§7).
- A face-level chunked export would need facade support (§5).
- The manual accessibility pass (§7).
- The fuzzer covers the benchmark fixtures; add new fixtures (B4–B7, P3-14)
  to its list when they exist.
