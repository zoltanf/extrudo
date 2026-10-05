# ADR-0067: Hardening before Phase 5 (P4-12, first part)

- **Status:** Accepted, 2026-10-04
- **Task:** P4-12 (the backlog carried over from the Phase 3 and 4 ADRs), its
  hardening part. The owner decided on 2026-10-04 to harden what exists before
  Phase 5, now that the repository is public, and to release v0.4.0 after P4-06.
- **Builds on:** ADR-0054 (headers and CSP), ADR-0037/0001 (the WASM builds and
  the facade), ADR-0056 and ADR-0039's B9 amendment (threads, the 150-turn cap),
  ADR-0047 (`mergeTools`), ADR-0035 (`measure`, inspect), ADR-0060 (the wrap
  whose volume is 1-2 % off), ADR-0050 §6 (heap growth), ADR-0055 (sweep
  placement), ADR-0024 (`KernelClient` restarts).

## Context

P4-12 lists about twenty items. Most are modelling depth (more options,
handles, tools); five are about the program being safe, correct and steady, and
those come first:

1. **`'unsafe-eval'` in the CSP.** Both of our embind builds (the OCCT kernel in
   its worker, planegcs in the page) create functions with `new Function`; zod
   probes `new Function` once. manifold-3d's glue (P4-06) has none. With
   `'unsafe-eval'` any injected string could run; it is the weakest line of
   `_headers`.
2. **Threads.** A thread of about 400 turns traps the WASM heap (later features
   read freed memory), so P4-11 refused threads above 150 turns; and
   `mergeTools` asks OCCT for the exact distance between two thread tools (26 s
   of a 30 s recompute on B9), which is why B9 fuzzes 6 steps on request only.
3. **Mass properties.** `measure`/`properties` call
   `BRepGProp::VolumeProperties(shape, props)` without a tolerance: a fixed
   Gauss order, 1-2 % off on B-spline faces (a wrap's walls, lofts, conics).
   Measure, Print Info, the 3MF volume checks and golden tables all read it.
4. **Heap growth.** A warm cache grows the heap top about 11 MB per 100
   recomputes of the revolve document, attributed to `mesh` (16 MB blocks).
   Unmeasured in a real long session; a worker that reaches the browser's
   limit dies (`KernelClient` restarts it, as after a crash).
5. **Sweep placement.** A swept profile lands exactly where its sketch drew it;
   nothing tells the user that the section should be centred on the path's start
   (B10 got 6 mm walls instead of 3).

## Decision

### H1. No `'unsafe-eval'`

- `packages/core`: `z.config({ jitless: true })` before any schema is built
  (zod then never probes `new Function`; parsing is as fast, measured in the
  slice).
- planegcs: `-sDYNAMIC_EXECUTION=0` in `packages/sketch/planegcs/build.sh`;
  OCCT: `DYNAMIC_EXECUTION: 0` (or the flag) in `libcascade.config.ts`. Both change
  their input hashes; **CI builds them** (GitHub-hosted runners have Docker
  again: OCCT about 16 minutes). With dynamic execution off, embind uses
  closures for its invokers: measure the recompute benchmarks before/after (B1-B5
  headless times) and the solver drag benchmark; a slowdown over 10 % is
  reported, not hidden.
- `apps/web/public/_headers` and `apps/site/public/_headers` (if it has it): drop
  `'unsafe-eval'`, keep `'wasm-unsafe-eval'`. `e2e/hosting.spec.ts` asserts the
  CSP has no `'unsafe-eval'` and that a session (open a template, sketch,
  extrude, export) records **no** `securitypolicyviolation`.

### H2. Threads and interference

- **Bisect the 400-turn trap natively** (`spikes/p4-02-harness/` or a new
  `spikes/p4-12-threads/`): `threadSweep` + the cut at 150, 200, 300, 400, 600
  turns, each in its own process, `-g2 -sNODERAWFS=1` so the trace has names
  (CLAUDE.md "A wasm trap is a null-pointer call inside OCCT"). Outcomes: a
  facade fix (then raise `MAX_TURNS` to the largest count that passes, capped at
  1000) or, if the trap is deep in OCCT, a documented limit and the reason in
  the ADR. Either way the cap stays a refusal with a message, never a trap.
- **`mergeTools` without exact distances for heavy tools:** when two tools'
  boxes overlap and either has more than 200 faces, they are **treated as
  interfering** (merged into one group) instead of asking OCCT for the distance.
  Fusing two tools that only nearly touch is still correct (a fuse of disjoint
  solids is a compound), just a bigger boolean; a thread's tools are few, so the
  cost is small. Then B9 fuzzes in the default run again (its own budget, the
  default 200 steps if the times allow, else the most that fit in 60 s per step
  on the CI runner), and `FUZZ_B9` goes away.
- **B8's fuzz step limit:** one step took 21.6 s under load against a 20 s limit
  (a `× 10000` dimension); give B8 its own budget like B9's (30 s), measured.

### H3. Exact enough mass properties

- Facade: `measure`/`properties` (and the facade's own internal volume checks
  where a 1 % error could flip a decision: the offset/shell/draft result checks)
  use `BRepGProp::VolumeProperties(shape, props, eps = 1e-7, onlyClosed)` and the
  `eps` forms of `SurfaceProperties`/`LinearProperties` (relative error bound).
  Measure the cost on B1-B5 (the inspect of every body) and the golden tables
  (they will change in the last digits on curved faces: update them and check
  that every change is on a B-spline or a curved face, never on planar bodies).
- Tests: the wrap's volume against its exact value (`wrap.test.ts` tightens from
  2 % to 1e-5 relative), a loft/conic body against a fine tessellation volume.

### H4. Heap growth: recycle the worker when idle

- `KernelApi.heap()` (the facade's `heapTop()` and the WASM memory size) after
  each recompute; the `Recomputer` restarts the kernel worker **between**
  recomputes when the heap top passes `HEAP_RECYCLE_BYTES` (1 GiB) and no
  dialog/preview is open: the new worker recomputes cold, the model store keeps
  showing the old result until the new one is ready (no flash), fonts and files
  are re-sent (the existing restart path, ADR-0024). A quiet notification in the
  history only ("The geometry kernel was restarted to free memory.").
- Test: a fake client whose heap passes the limit → one restart, at the right
  moment (not during a preview), the store never empty. The real growth curve
  stays measured by `memory.test.ts` (unchanged).

### H5. Sweep says where the profile lands

- The sweep evaluator measures the profile's centroid against the path's start
  point and tangent: when the centroid is more than 1 % of the path length (or
  0.5 mm, whichever is larger) off the path's start, the feature warns: "The
  profile is swept where it is drawn, <d> mm from the path's start: draw it
  centred on the path's start to sweep it around the path." The dialog's preview
  shows the warning like any other.

## Slices and order

Three parallel branches after P4-06 is merged (or now, where they don't touch
P4-06's files): **H1** (build flags, zod, headers: OCCT rebuild in CI),
**H2 + H5** (threads, `mergeTools`, fuzz budgets, sweep warning; a facade fix
only if the bisect finds one), **H3 + H4** (facade mass properties: OCCT rebuild
in CI; worker recycling). Each is merged on its own; branches that change the
OCCT input hash are merged one after the other, the later one re-running CI so
the combined hash is built.

## Results: H1 (2026-10-04)

What the slice delivers: `z.config({ jitless: true })` in
`packages/core/src/zod.ts` (our one zod import, called before any schema
exists), `DYNAMIC_EXECUTION: 0` in `packages/kernel/occt/libcascade.config.ts`
and in planegcs's link flags (`planegcs.patch`, beside
`ALLOW_MEMORY_GROWTH`; its `build.sh` has no link flags of its own to set),
`'unsafe-eval'` out of `apps/web/public/_headers` (only
`'wasm-unsafe-eval'` is left), and `e2e/hosting.spec.ts` plus a session test in
`e2e/hosting.spec.ts`. New input hashes, both built and published by CI:
**OCCT `7e63f57a1697`** (`occt-7e63f57a1697`, WASM 18.74 MB raw, 6.10 MB gzip,
4.25 MB brotli) and **planegcs `73d135604959`** (`planegcs-73d135604959`, 0.52 MB
raw, 0.19 MB gzip). `grep -c "new Function"` is **0** in both glues now (1 and 2
before), and neither has an `eval(`. `DYNAMIC_EXECUTION` changes only the JS
glue: both `.wasm` files come out byte-identical to the builds before it (md5
`55f41fc0…` and `71ef6ef8…`), and the glues got smaller (OCCT 53,350 → 52,632
bytes, planegcs 22,218 → 21,062). The app build's precache is 24.10 MB raw /
6.32 MB brotli (ADR-0037's 5.7 MB was P2-15's, before the P4 chunks), 1.0 s of
transfer at 50 Mbit against NFR-02's 8 s first visit
(`node scripts/measure-startup.mjs --no-browser`).

**Measured.** The worry was closures for embind's invokers. Everything is
within noise on the Arch workstation (Node 26, warm, the machine otherwise
idle; medians):

| | before | after |
|---|---|---|
| `loadDocument`, B1–B5 (ms) | 0.38 / 0.41 / 0.28 / 0.28 / 0.35 | 0.26 / 0.39 / 0.27 / 0.28 / 0.35 |
| recompute, B1–B5 (ms) | 5 / 18 / 21 / 49 / 172 | 5 / 17 / 22 / 53 / 174 |
| `benchmarks.test.ts`, B1/B2/B3/B4/B5/B6/B7/B8/B10 (ms) | 71 / 80+29 / 76+35 / 174+90 / 261+216 / 139+92 / 867+625 / 384+311 / 249+326 | 77 / 80+29 / 84+33 / 174+86 / 256+210 / 140+93 / 855+611 / 378+301 / 249+326 |
| solver drag, `anchored-198` median / p95 (ms) | 0.18 / 0.25 | 0.20 / 0.26 |
| solver drag, `chained-99` median / p95 (ms) | 11.24 / 11.50 | 11.42 / 11.64 |
| solver drag, `gear-52` median (ms) | 115.4 | 113.5 |
| solver drag, `gear-104` median (ms) | 647.7 | 643.9 |

`BENCH=1 packages/sketch/src/solver/perf.test.ts`, and the same with the
previous planegcs release fetched for comparison, in the same session. The first
"after" run came out 34 % slower on `chained-99` (15.13 ms) and was noise, not
the build: its own p95 was 27.6 ms against 11.6 ms in every other run, and
running the same build again gave 11.31 ms. zod's JIT is worth nothing to lose:
parsing the five fixtures with the runtime parser is as fast as with the
compiled one (0.26–0.44 ms against 0.27–0.53 ms).

**Proof, not measurement.** `zod.test.ts` builds and parses the document schema
in a fresh module registry with `globalThis.Function` replaced by a stub that
records every call: no attempt is recorded, and taking `z.config` out makes it
fail with exactly zod's probe (`['']`) and then its compiled parser.
`e2e/hosting.spec.ts` reads the served `script-src` (no `'unsafe-eval'`,
`'wasm-unsafe-eval'` there), then opens the Wall bracket template, waits for the
kernel, sketches on XY beside the bracket (a line with the Line tool and a
rectangle, planegcs in the page), finishes the sketch, extrudes a picked
profile (the kernel in its worker), opens Ctrl+K and exports a 3MF — with
`watchPolicy` listening: no `securitypolicyviolation`, no console error.

**Not needed.** Embind's `EMBIND_AOT` (invokers generated at compile time,
which emscripten documents as keeping DYNAMIC_EXECUTION=0 at
DYNAMIC_EXECUTION=1 speed for a bigger glue) is the knob for a slowdown we did
not measure, so the build does not set it.

## Results: H3 and H4 (2026-10-05)

### H3. Mass properties

**The decision, as measured.** `spikes/p4-12-mass` (a native harness over the
facade, run by `run.sh` in the pinned OCCT image) builds the bodies the ADR
names and integrates each of them four ways: OCCT's plain two-argument form (a
fixed Gauss order, which is what the facade used), the `eps` form at 1e-5, 1e-7,
1e-9 and 1e-12, and a fine tessellation of the body as a second reference. The
first finding is the ADR's own: where a body has a **B-spline surface** OCCT
cannot integrate with a fixed order, the plain form is 1-3 % out and the bound
form is exact. The second finding is not in the ADR: where the curved face is a
**surface of linear extrusion or of revolution**, the bound form is the *worse*
of the two, because the terms of the volume integral cancel there (a prism
wall's exact contribution to its prism's volume is zero, whatever the caps say)
and subdividing each term to a bound leaves more of the cancellation behind.
Numbers against the reference, relative:

| body | plain | eps 1e-5 | eps 1e-7 | eps 1e-9 | eps 1e-12 | reference |
|---|---|---|---|---|---|---|
| wrap of a circle, 1 mm out (`BRepOffset_MakeSimpleOffset`'s B-spline wall) | **1.08e-2** | 0 | 0 | 0 | 0 | 28.981192 (closed form) |
| the same wrapped inwards | **1.08e-2** | 0 | 0 | 0 | 0 | 27.567476 |
| wrap of a closed B-spline glyph | **2.80e-2** | 1.1e-4 | 1.1e-4 | 1.1e-4 | 1.1e-4 | 26.312312 (mesh) |
| loft between two circles | 0 | 0 | 0 | 0 | 0 | 32840.115206 (closed form) |
| conic (a parabola) extruded 5 mm | 0 | 0 | 0 | 0 | 0 | 1333.333333 |
| prism of a B-spline region (a letter's wall) | **3.8e-4** | 4.1e-3 | 4.1e-3 | 1.3e-3 | 8.8e-3 | 511.944097 (mesh) |
| the same, 20x further out | **4.8e-5** | 1.9e-4 | 1.9e-4 | 6.9e-5 | 4.9e-4 | 10056.038788 |
| a B5-sized filleted box with three holes | 9.4e-6 | 9.4e-6 | 9.4e-6 | — | — | 187154.566654 |

So the facade asks the shape, not the call site: `needsTolerance(shape)` is
true when one of its faces is a B-spline, Bezier or offset surface (what our own
maps make: a wrap's wall, a sweep's, a scale's, a loft's side), and then
`integrateVolume`, `integrateArea` and `integrateLength` use the bound; where it
is false they keep the cheap form. That is the deviation from the wording above
("the eps forms of `SurfaceProperties`/`LinearProperties`"), and it is what the
numbers asked for. `MASS_EPS` is 1e-7 because on the rows where it decides the
answer it gives the same value as 1e-12, at about half the time: 0.38 ms to
3.4 ms on a wrap (6.4 ms at 1e-12) and 0.9 ms to 3.8 ms on the B5-sized body
(6.6 ms at 1e-12). Where the cheap form is picked the bound is never asked for.

**What the slice delivers.** `measure` and `properties` on the facade, and
through them `Kernel.measure`/`properties`, `KernelApi.inspect` (Measure, the
status bar), Print Info (ADR-0048) and the volume the sketch evaluators report;
and `exactVolume` for the facade's own checks where a percent could flip the
decision (`shellIsGood`, `offsetIsGood`, `draftIsGood`, `taperHolds`, the wrap
of an emboss). The checks that only ask whether a volume is *positive*
(`volumeOf`, in `prism`, `asSolid`, `sweep`, the thread) keep the cheap form: a
percent cannot move a sign. Three calls keep the cheap form on purpose, and say
why where they are: `planarFaces`' small-face filter (a rough area is the
point), the sweep's "which end of the path is nearer the profile" comparison
and the thread's face centre of mass (a comparison of two distances, on a face
that is planar or the answer is a sign).

**Proof, not measurement.** `wrap.test.ts` tightens from 2 % to 1e-5 relative
where the reference is exact (a wrapped circle, the letter D's arc) and to 1e-4
against a fine tessellation of the wrap itself where it is not (a closed
B-spline glyph, a letter O of Inter: the profile of those is bounded by a
B-spline, and a planar face stays on the cheap integral, so the closed form
carries the face's own 3e-5). `mass-properties.test.ts` is new and checks a loft
and a conic extrude against a fine tessellation to 1e-4, the loft also against
the frustum's closed form, which it holds to 2e-11.

**The golden tables.** One number in twenty tables moved: `scale`'s "cylinder
1,2,1", 12663.27 to 12566.4. That body is a cylinder put through `gp_GTrsf`,
which turns every surface into a B-spline (ADR-0053), and the exact volume of
the result is 12566.371: the old number was 0.77 % over, the new one exact.
Nothing else moved, and nothing on a planar body moved, as the ADR expected.
On the benchmark fixtures every volume is bit for bit the same (B2 48144, B3
84000, B4 15488.6827 and 17001.5234, B5 25325.8493 and 14214.0727, B7's
knurled knob 10615.05556, B8's name tag 3628.804984, B10's link 2428.106689
three times), because their curved faces are analytic (a cylinder, a cone, a
fillet, a sphere, a torus) or extrusions and revolutions, which is where the
cheap form is the right one. Inspecting every body of a document (Measure, the
status bar, Print Info's volumes), median of seven, on the Arch workstation:

| | B1 | B2 | B3 | B4 | B5 | B7 | B8 | B10 |
|---|---|---|---|---|---|---|---|---|
| before | 0.0 | 0.8 | 0.7 | 13.3 | 19.3 | 35.3 | 17.3 | 16.9 |
| after | 0.0 | 0.8 | 0.7 | 14.3 | 20.4 | 34.1 | 16.5 | 16.4 |

(B1's fixture is the sketch alone, so it has no body to inspect.) Within noise:
no fixture's body reaches `needsTolerance`, so none of them pays for the bound.
A body that does -- a wrapped letter, a scaled one -- costs 0.4 ms to 3.4 ms for
its volume instead of 0.4 ms, which is the price of the exactness and only paid
on Measure.

### H4. Recycling the worker

`KernelApi.heap()` (the facade's `heapTop()` and the WASM memory's byte length),
read by the `Recomputer` after every finished recompute. Over
`HEAP_RECYCLE_BYTES` (1 GiB, `RecomputerOptions.heapRecycleBytes` for tests)
and with no dialog open, the worker is terminated and a new one booted through
`KernelClient.restart()` -- the same path a crash takes, so the fonts are sent
again and the document recomputed cold. The model store keeps the result it has
until the new one arrives (`computing()` only sets the status), so there is no
empty frame; the app puts "The geometry kernel was restarted to free memory."
into the notification history, quietly, from `useRecompute`'s `onRecycle`.

Two rules beyond the ADR's wording, both from what the tests found. The worker
is only replaced when the heap has been *under* the limit since the last
replacement, so a limit below what a fresh WASM starts on cannot put a loop of
restarts going (the real kernel's heap top is 19.3 MB after `init`, so a few-MB
test limit crosses from the start). And a replacement waits for the dialog to
close: `preview()` marks a draft open from the first draft until `endPreview()`,
not only while a preview is in flight.

`recomputer-recycle.test.ts` covers it with a fake kernel (the events the
recomputer sends, in order: one restart after the recompute, never under a
dialog, once and only once while the heap stays over, none under the limit or
with 0, the fonts re-sent to the new worker before its recompute) and with the
real kernel at a limit of 3 MB, where the worker is replaced, the body comes
back the same, and the next edit recomputes on the new worker.

## Results: H2 and H5

The branch `p4-12-threads` did H2 and H5 (2026-10-05). H1, H3 and H4 are other
branches.

### H2, first: the 400-turn trap is OCCT running out of memory

`spikes/p4-12-threads/` is the p4-02 harness with B9's thread (the ISO 68-1
tooth, ring and lead-ins of `features/thread.ts`, an internal M20 × 2.5 in a
block with a Ø17.3 mm bore), one process per turn count, every step printing
before it runs and the malloc top (`sbrk(0)`) after it. One cut of the whole
tooth out of the ring, as the evaluator used to do:

| turns | result | time | faces of the tooth | heap after the cut |
| --- | --- | --- | --- | --- |
| 150 | ok | 41 s | 914 | – |
| 200 | ok | 54 s | 1214 | – |
| 300 | ok | 80 s | 1814 | – |
| 350 | ok | 94 s | 2114 | 403 MB → **1903 MB** |
| 400 | **traps** | 26 s in | 2414 | 403 MB, then nothing |
| 600 | **traps** | 39 s in | 3614 | 289 MB, then nothing |

"traps" is `RuntimeError: table index is out of bounds`, at the step that
prints `tool = ring - tooth`, which is what B9's fuzzing reported. With
`OCCT_DEBUG=1` (`-g2 -sNODERAWFS=1`) the trace has names:

```
GeomAdaptor_TransformedSurface::~GeomAdaptor_TransformedSurface()
IntCurvesFace_Intersector::IntCurvesFace_Intersector(const TopoDS_Face&, double, bool, bool)
BRepClass3d_SolidExplorer::InitShape(const TopoDS_Shape&)
BRepClass3d_SolidExplorer::BRepClass3d_SolidExplorer(const TopoDS_Shape&)
BRepClass3d_SolidClassifier::BRepClass3d_SolidClassifier(const TopoDS_Shape&)
IntTools_Context::SolidClassifier(const TopoDS_Solid&)
BOPAlgo_BuilderSolid::PerformAreas(const Message_ProgressRange&)
BOPAlgo_BuilderSolid::Perform(const Message_ProgressRange&)
BOPAlgo_SplitSolid::Perform()
OSD_Parallel::For<BOPTools_Parallel::Functor<NCollection_DynamicArray<BOPAlgo_SplitSolid>>>(int, int, …)
```

`BRepAdaptor_Surface` derives from `GeomAdaptor_TransformedSurface` (one
`IMPLEMENT_STANDARD_RTTIEXT`), so the top frame is the destructor of the
`BRepAdaptor_Surface surface;` local at the end of `IntCurvesFace_Intersector`'s
constructor — a **virtual call through a vtable that is not in the function
table**, which is what a null or freed object calls through (CLAUDE.md: "a wasm
trap is a null-pointer call inside OCCT"). It happens while an exception is
unwinding (the constructor's two `new BRepAdaptor_Surface` and `new
BRepTopAdaptor_TopolTool` are freed by the unwind), so the facade's `catch
(...)` never sees it.

**The cause is memory, not a bug in OCCT or in the facade.** A boolean needs
memory proportional to the faces it works on: 350 turns take the heap from
403 MB to 1903 MB (about 4 MB a turn), 400 turns need more than the 2 GB a
32-bit WASM module can grow to, `operator new` returns null, and OCCT calls
through it. So the trap cannot be guarded against in the facade — only avoided
by asking for less at once.

**The fix is to cut the tooth out of the ring in pieces** (`THREAD_CHUNK` in
`features/thread.ts`, `toothPieces`): the tooth is swept and cut in pieces of
`MAX_TURNS` turns, each released as soon as it has been cut, so a boolean only
ever meets one piece's worth of faces. A thread of as many turns as may be
modeled is one piece, so its cut is exactly what it was. Measured the same way:

| turns | piece | result | time | heap |
| --- | --- | --- | --- | --- |
| 400 | 20 | ok | 176 s | 1161 MB (all of it in `body − tool`) |
| 600 | 20 | ok | 315 s | 1739 MB |
| 600 | 100 | ok | 189 s | 1736 MB (773 MB after the ring − tooth) |

No turn count can trap the heap now: the memory each boolean needs is flat, and
what still grows with the length is the final `body − tool` (the tool's own
faces), which is ~1 GB at 600 turns.

**`MAX_TURNS` stays 150.** The cap is no longer about memory, so it can be
about what a person should wait for: 150 turns is about 25–40 s of booleans on
this machine, and a piece-wise cut costs about 0.35 s a turn instead of 0.1 s,
so 300 turns would be minutes and over a gigabyte. Raising it would also make
B9's fuzzing build such threads (`capHeight` × 100 is 311 turns of M39 in the
cap's Ø36 bore), which is exactly the expense ADR-0039's B9 amendment kept B9
out of the default run for. The cap stays a refusal with a message, before
anything is built — and now the thing it refuses is a slow thread, not a heap
trap.

### H2, second: heavy tools merge without the exact distance

`mergeTools` puts two tools in one group whose boxes overlap when either has
more than `HEAVY_TOOL_FACES` (200) faces, without asking OCCT for the exact
distance (`operation.ts`'s `isHeavyTool`). Fusing tools that only nearly touch
is still correct — a fuse of disjoint solids is a compound, and the boolean
after it takes their union — and light tools keep the exact test, so a pattern
of small holes is as small as it was. `toolSet` (a pattern's cut) keeps the
exact test deliberately: a colour class has to be a valid boolean argument, so a
wrong "these two meet" costs a pass there, and enough of them fall back to the
fuse.

How expensive it was: the exact distance between the tools of two threads of
36 and 30 turns (150 faces each, **light** by this rule) was **277 s** in one
`BRepExtrema_DistShapeShape` call — measured by timing every `Kernel` method in
`thread.test.ts`'s step. B9's own case was 26 s of a 30 s
recompute. With the rule, two tools of 72 and 60 turns (250 and 210 faces) ask
nothing: the kernel test asserts zero calls and that the cut is the same
material off as a feature per face (to 1e-6), and the light pair still asks
once.

**B9's own `capDia` × 2 no longer needs the rule, and this branch does not make
it faster.** `BENCH=1 pnpm vitest run packages/kernel/src/features/thread-bench`
(added with it): warm 14 ms, cold 8.1 s, exact distance asked twice — the same
twice with the rule reverted (warm 14 ms, cold 7.9 s). B9's threads are a few
turns each, so their tools have 30-odd faces, are light, and keep the exact
test; ADR-0039's 26 s was measured when `METRIC_COARSE` stopped at M30 and
`capDia` × 2 refit the adapter's collar to a much longer thread. What the rule
buys is the document B9 was a stand-in for: two tools of 36 and 30 turns cost
277 s in one call, and over `HEAVY_TOOL_FACES` faces nothing is asked.

### H2, third: the fuzz budgets

B9 is back in the default run at **120 steps with a 90 s step limit** and
`FUZZ_B9` is gone. B8 gets a **40 s step limit**. The ADR asked for the most
steps that fit in about 60 s a step on a CI runner, so the numbers are
measured here (`FUZZ_REPORT=1`, 2026-10-05, 4 cores) and the budgets cover
2.5× them:

| fixture | steps | warm step times (median / p95 / max) | case time here |
| --- | --- | --- | --- |
| B1 | 200 | 3 ms / 14 ms / 34 ms | 3.9 s |
| B2 | 200 | 1 ms / 26 ms / 63 ms | 2.0 s |
| B3 | 200 | 3 ms / 18 ms / 36 ms | 2.1 s |
| B4 | 200 | 3 ms / 74 ms / 102 ms | 4.9 s |
| B5 | 200 | 25 ms / 267 ms / 348 ms | 18.3 s |
| B6 | 200 | 32 ms / 80 ms / 198 ms | 8.0 s |
| B7 | 200 | 2 ms / 953 ms / 2.2 s | 27.4 s |
| B8 | 200 | 124 ms / 336 ms / 11.8 s | 84.6 s |
| **B9** | 120 (200 measured) | 5 ms / 18.2 s / **39.1 s** | 875 s at 200 |
| B10 | 200 | 4 ms / 216 ms / 337 ms | 15.2 s |
| P4-01 | 200 | 1 ms / 1.4 s / 1.9 s | 60.0 s |

B9's slowest step builds a modelled thread (its `capHeight` x 10 and the like),
so it needs the ADR's per-step allowance; at 120 steps it is about 9 minutes
here and 23 at 2.5×, which its 23-minute timeout covers. B8's 11.8 s step is a
`× 10000` dimension. `FUZZ_ONLY=B9` runs one fixture, for a slow case on its
own.

### H5: the sweep says where the profile lands

The warning is the ADR's wording, with the distance the profile really is from
the path's start line. `placementOffset` measures the profile's centroid against
the path's **start point and the line the path runs along there**, so a profile
drawn anywhere along the path is fine — its place along it shifts the whole
sweep, and B10's section is 10.6 mm along its path — while its offset across
the path is what is wrong: B10's original section, drawn centred on the sketch
origin instead of the path's centreline, is 20 mm off and warned.

## Rejected

- **Keep `'unsafe-eval'` and rely on the rest of the CSP:** the app is public,
  takes files from strangers (fonts, STEP, meshes, SVG) and has no reason to
  evaluate strings; the cost is two rebuilds.
- **A smaller interference test inside OCCT (`BOPAlgo_ArgumentAnalyzer`,
  `BRepAlgoAPI_Check`):** they run the same intersection machinery as the
  distance; boxes are free.
- **A fixed higher Gauss order instead of `eps`:** still wrong on long B-splines;
  the adaptive form bounds the error.
- **`eps` everywhere** (what this ADR first said): right where a B-spline
  surface makes the fixed order wrong, worse where the volume integral's terms
  cancel (a prism wall, a surface of revolution) -- 0.3 % out against 3.9 % on
  an extruded letter, and the same letter's two bodies then disagree by 2.7 %
  with their sum. `needsTolerance` asks the shape instead (§Results: H3).
- **Patching OCCT's mesher block size** for the heap: an OCCT source patch for a
  growth we have only measured in a synthetic loop; recycling covers any cause.

## Deferred

The rest of P4-12 (modelling depth: fillet/chamfer handles and more sets, shell
per face, primitive handles, construction variants, extrude to object on curved
faces, HLR silhouettes, STEP colours, section boxes, Print Info costs, pattern
skip lists and handles, ghosts of lost geometry, marking-menu remapping, emboss on
cones/spheres, a cheaper join of many interfering copies) stays in the backlog,
picked up between Phase 5 tasks.
