# ADR-0002: Sketch constraint solver

- **Status:** Accepted, 2026-09-25
- **Task:** P0-03 (solver spike). Code and raw numbers: `spikes/p0-03-solver/`
  (see its `README.md` and `results/summary.md`).
- **Affects:** P1-03 (solver integration), P1-06 to P1-09 (constraints,
  dimensions, status colours, dragging), and the `sketch` package.

## Context

Sketch mode needs a 2D geometric constraint solver (FR-SK-07 to FR-SK-09):
every constraint and dimension type in FR-SK-07/08, the remaining degrees of
freedom, conflict and redundancy reports, and live dragging of
under-constrained geometry. The architecture planned for planegcs (FreeCAD's
solver, compiled to WASM) on the main thread (§5.3). NFR-01 wants a drag to
re-solve in under 8 ms for sketches of up to 200 entities; P1-03's acceptance
criterion says the same.

The spike had to answer: does planegcs meet that in the browser, what does DOF
and conflict reporting look like, and how should our adapter drive it?

## Options

| | Package | Notes |
|---|---|---|
| **A. planegcs, published build** | `@salusoft89/planegcs` 1.2.0 (FreeCAD PlaneGCS, LGPL-2.1-or-later per its source headers; `package.json` says LGPL-2.0-or-later) | JSON primitives, every FreeCAD constraint, B-splines, temporary (drag) constraints, DOF, conflicting/redundant lists. 496 KB WASM (132 KB brotli). |
| **A′. planegcs, our own build** | the same source, pinned commit, built with Docker | Lets us fix the build (memory growth, toolchain, SIMD) and patch the C++. |
| **B. SolveSpace** | `slvs` 3.1.0-dev.14 (GPL-3.0) | SolveSpace's solver. The npm package is an old dev build without types or a README. |
| **C. Ansatz** | `ansatz-wasm` 0.3.0 (MIT) | Published two weeks before this spike, three versions, one maintainer, Node-only build. Excluded without a run. |
| **D. Write our own** | – | Excluded: years of work to match planegcs's constraint set and robustness. |

## The test

In Node 26 and headless Chromium 153 on one laptop (Ryzen 7 4700U):

- **The task's scenario:** a rectangle with coincident, horizontal/vertical
  and width constraints; drag its free corner for 180 animation frames; add a
  second, conflicting width and read the report.
- **Scale:** generated, fully constrained sketches of 50, 100, 200 and 500
  entities (lines, arcs, circles). A cell is a rectangle, a hole and a slot
  with tangent arcs, all dimensioned. Two layouts:
  - *anchored*: every cell dimensioned from the fixed origin, so the sketch
    falls apart into independent components (the usual case);
  - *chained*: each cell dimensioned from the previous one, one coupled system
    (the worst case; a long closed outline such as a gear profile, one loop of
    100+ curves, behaves the same way).
- Per configuration: first solve from a perturbed start, drag steps, a
  driving-dimension change, adding a constraint, a conflict, and the three
  algorithms (DogLeg, Levenberg–Marquardt, BFGS).
- Three builds of our own (A′): `growth` (upstream toolchain + memory growth),
  `modern` (emsdk 6.0.10 + SIMD), `fast` (`modern` + two linear-algebra
  patches, below). All three solve the test sketches to the same geometry as
  the published build, within 1e-11 mm.

## Measurements

### One solver system for the whole sketch

Milliseconds, median. `growth` build (the published one aborts at 100
entities, see below).

| Sketch | Unknowns | First solve | Drag step | Dimension change | Add a constraint |
|---|---|---|---|---|---|
| anchored, 54 entities | 355 | 8.6 | 0.82 | 2.0 | 9.3 |
| anchored, 198 | 1299 | 245 | 3.1 | 6.4 | 276 |
| anchored, 504 | 3305 | 5249 | 8.7 | 17 | 7409 |
| chained, 54 | 355 | 23 | 4.1 | 14 | 11 |
| chained, 99 | 650 | 121 | 19 | 70 | 53 |
| chained, 198 | 1299 | 908 | **137** | 529 | 349 |
| chained, 504 | 3305 | 30 852 | **4006** | 16 833 | 10 927 |

- **The published build has a fixed 16 MB heap.** It aborts with out of
  memory at around 100 entities (about 650 unknowns) in one system; whether
  exactly 650 fits depends on what ran before. Building with
  `ALLOW_MEMORY_GROWTH` fixes it.
- **Adding or removing a constraint re-runs the diagnosis** (a QR
  decomposition over the whole system that yields DOF, conflicts and
  redundancies): 245 ms at 200 entities, 5 s at 500. Changing parameter values
  (a dimension, a drag target) doesn't; the diagnosis is cached until the
  constraint set changes.
- **The solvers work on dense matrices.** Each DogLeg iteration factors the
  Jacobian with a full-pivoting LU, and each SQP iteration (used whenever
  temporary drag constraints are present) a full-pivoting QR, both O(n³). So
  cost explodes with the size of one coupled system: a drag step takes 19 ms
  at 100 chained entities, 137 ms at 200 and 4 s at 500.

### One solver system per independent component

The anchored sketches, split into components with a union-find over what each
primitive references (constraints to fixed geometry don't join components).
Published build: every system stays small, so the heap limit doesn't bite.

| Entities | Components | Open (solve all) | Drag step | Add a constraint | Dimension change (all components) |
|---|---|---|---|---|---|
| 54 | 6 | 7.7 | 0.16 | 0.87 | 1.7 |
| 198 | 22 | 18 | 0.15 | 0.87 | 6.6 |
| 504 | 56 | 42 | **0.16** | **0.78** | 17 |

### Browser, main thread

| Sketch | Build | Solve per frame | Frame rate |
|---|---|---|---|
| The task's rectangle | published | 0.2 ms | **60 fps** |
| 500 entities, anchored (56 components) | published | 0.7 ms | **60 fps** |
| 100 entities, one component | `fast` | 12.6 ms | 60 fps, 2 slow frames |
| 200 entities, one component | `fast` | 77.5 ms | **12 fps** |

The conflict report for the rectangle names exactly the two width
constraints; in the generated sketches it names the group of 4–5 constraints
involved, always including the one just added. The rectangle's DOF reads 1
while dragging (temporary drag constraints don't count).

### Builds and patches

On the single-system cases: the `modern` toolchain with SIMD is 10–17% faster
than upstream's emsdk 3.1.45. On top of that, the `fast` patches take the
chained 198-entity drag from 116 ms to 79 ms and the dimension change from
412 ms to 261 ms (1.4–1.6×; 1.6–1.9× against the upstream toolchain):

- DogLeg's Gauss step uses `LeastNormLdlt` (an existing FreeCAD option)
  instead of `FullPivLU`;
- the SQP step's QR (`qp_eq`) uses column pivoting instead of full pivoting
  (still rank-revealing).

WASM size stays 486–503 KB (132–142 KB brotli); instantiation takes 17–23 ms.

### SolveSpace

`slvs` 3.1.0-dev.14 on the anchored 54-entity sketch: first solve 88 ms
(planegcs: 8.6 ms), a drag step 355 ms (the build has no `setParamValue`, so
it rebuilds). It runs out of memory on the chained 54-entity sketch and at
100 anchored entities, and its `tangent()` aborts ("Cannot find handle").
SolveSpace's current source is newer than this package, but nothing here
justifies building it.

### Correctness findings

- **Endpoint tangency must be `angle_via_point`** (angle 0 or π at the shared
  point), as FreeCAD does it. The simpler `tangent_la` plus coincident
  endpoints is degenerate at the solution: from a solved state the diagnosis
  then reports false redundancies and a wrong DOF (8 instead of 0 here).
- Planegcs prints debug output to stdout unless the debug mode is set to
  `NoDebug`.

## Decision

**Use planegcs, from our own WASM build, behind an adapter in the `sketch`
package that solves each independent component separately.**

1. **Our own build (A′)**, like the OCCT build (ADR-0001): the pinned planegcs
   commit, `ALLOW_MEMORY_GROWTH`, the current emsdk with SIMD, and the two
   pivoting patches (the spike's `fast` variant; recipe and patches in
   `spikes/p0-03-solver/planegcs-build/`). It builds in about a minute. P1-03
   moves it into `packages/sketch` and builds it in CI the same way as OCCT
   (once per input hash). The patched C++ stays LGPL-2.1-or-later and ships as
   a separate `.wasm`.
2. **One planegcs system per connected component.** The adapter splits the
   sketch with a union-find over referenced IDs and keeps a persistent system
   per component. A constraint edit rebuilds only its component; a dimension
   change re-solves only the components that use it; a drag re-solves only the
   dragged component.
3. **Dragging** adds two temporary coordinate constraints on the dragged point,
   bound to two sketch parameters, and updates only those parameters per
   animation frame. No rebuild, so no re-diagnosis (rebuilding per step was
   2.4× slower on the chained 198-entity sketch and several hundred times
   slower on the anchored 504-entity one). Solve at most once per frame, with the latest pointer
   position.
4. **Tangency at endpoints** uses `angle_via_point`. The adapter picks 0 or π
   from the current geometry when the constraint is created.
5. **The document keeps coincident constraints** (FreeCAD and Fusion do the
   same). Merging coincident points before solving cut the single-system
   diagnosis 1.8–5×, but with per-component solving it makes no noticeable
   difference, so it isn't worth the bookkeeping now.
6. **Conflicts:** before committing a new constraint or dimension, the adapter
   test-solves its component. If the constraint is in the conflicting or
   redundant set, the UI refuses it, or offers to add it as driven (FR-SK-09,
   `04-ui-spec.md`). The reported group is shown as "involved".
7. **Main thread**, as planned: 17–23 ms to instantiate, sub-millisecond
   drags for the usual sketch.

### Why not the others

- **A. The published build as is:** it aborts at about 100 entities in one
  system, and we can't change its toolchain or patch it.
- **B. SolveSpace:** slower on everything measured, crashes on tangency, runs
  out of memory on small sketches, and the package is an old dev build. It is
  also GPL-3.0 rather than LGPL (compatible with the app, but not a separate
  replaceable library).
- **C. Ansatz:** too new to depend on. Its diagnostics-first design is worth a
  look again later.

## Consequences

- **Known limit: one large coupled component.** A single component of about
  100 entities drags at 12.6 ms per frame; at 200 entities, 78 ms (12 fps).
  That's the dense linear algebra, not the adapter. The usual sketch (features
  dimensioned from the origin or from each other in small groups) isn't
  affected. If real sketches hit it:
  - move solving of large components to a worker (the UI stays at 60 fps and
    the geometry follows a few frames behind), or
  - patch the solver to use sparse matrices (DogLeg and the SQP step) in our
    build. That is a real C++ task; FreeCAD's solver has the same limit.
  Added to the roadmap risks; revisit in P1-03 with the B1 benchmark and a
  gear-outline fixture.
- **P1-03's acceptance criterion changes** from "drag solve < 8 ms at 200
  entities" to "< 8 ms at 200 entities in independent components, and < 16 ms
  for a single component of up to 100 entities".
- **P1-03 scope:** the build (CI, once per input hash), the component
  splitter, persistent systems, drag parameters, `angle_via_point` tangency,
  the test-solve for new constraints, and the per-constraint-type tests.
- **Licensing:** planegcs's source headers say LGPL-2.1-or-later; the npm
  `package.json` says LGPL-2.0-or-later. Use the source headers, and ship the
  patches with the source (P3-15 license review).
- **Architecture §1 and §5.3** now describe the build and the per-component
  adapter.
