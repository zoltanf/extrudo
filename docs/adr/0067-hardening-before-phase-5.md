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

## Rejected

- **Keep `'unsafe-eval'` and rely on the rest of the CSP:** the app is public,
  takes files from strangers (fonts, STEP, meshes, SVG) and has no reason to
  evaluate strings; the cost is two rebuilds.
- **A smaller interference test inside OCCT (`BOPAlgo_ArgumentAnalyzer`,
  `BRepAlgoAPI_Check`):** they run the same intersection machinery as the
  distance; boxes are free.
- **A fixed higher Gauss order instead of `eps`:** still wrong on long B-splines;
  the adaptive form bounds the error.
- **Patching OCCT's mesher block size** for the heap: an OCCT source patch for a
  growth we have only measured in a synthetic loop; recycling covers any cause.

## Deferred

The rest of P4-12 (modelling depth: fillet/chamfer handles and more sets, shell
per face, primitive handles, construction variants, extrude to object on curved
faces, HLR silhouettes, STEP colours, section boxes, Print Info costs, pattern
skip lists and handles, ghosts of lost geometry, marking-menu remapping, emboss on
cones/spheres, a cheaper join of many interfering copies) stays in the backlog,
picked up between Phase 5 tasks.
