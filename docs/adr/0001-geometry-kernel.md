# ADR-0001: How Extrudo talks to OpenCascade

- **Status:** Accepted, 2026-09-25
- **Task:** P0-02 (kernel spike). Code and raw numbers: `spikes/p0-02-kernel/`
  (see its `README.md` and `results/summary.md`).
- **Affects:** P0-09 (production kernel package), P2-04 (topological naming),
  P2-15 (trimmed WASM build).

## Context

The geometry kernel is OpenCascade (OCCT) compiled to WASM, running in a Web
Worker in the browser and in Node for tests and the CLI (architecture §1, §5).
We had to choose the layer between our code and OCCT. Four requirements
decided it:

1. **Shape history for topological naming** (architecture §5.2). We need
   `Modified`, `Generated` and `IsDeleted` for faces *and* edges. A fillet face
   is generated from an edge, and the edges a boolean creates are generated
   from faces. A candidate that can't expose history is disqualified.
2. **No leaks.** OCCT objects in WASM are not garbage-collected, and leaks are
   bugs (a hard rule in `CLAUDE.md`).
3. **Single-threaded, no `SharedArrayBuffer`** for now (architecture §7), and a
   download under 8 MB brotli (target for P2-15).
4. **License fit:** the app is GPL-3.0-or-later and loads LGPL code as a
   separate, replaceable `.wasm`.

## Options

| | Packages tested | Layer |
|---|---|---|
| **A. libcascade** | `libcascade` 3.0.2 (OCCT 8.0, LGPL-2.1 + OCCT exception) | Raw OCCT classes through embind: a full prebuilt build, plus `@libcascade/toolchain` for custom builds. |
| **B. replicad** | `replicad` 1.1.0 (MIT) + `replicad-opencascadejs` 1.1.0 (LGPL) | High-level code-CAD API over a trimmed build linked with the same libcascade toolchain image. Raw OCCT is reachable with `getOC()`. |
| **C. brepjs** | `brepjs` 20.0.0 (Apache-2.0) + `occt-wasm` 5.3.5 (tooling MIT/Apache, WASM LGPL) | High-level API over occt-wasm, a C++ facade (about 170 methods, arena handles). No OCCT classes are bound. |

Also looked at and excluded without a full run: `brepkit-wasm` (AGPL-3.0, and
not OCCT); `opencascade.js` 1.1.1 by donalffons (last release in 2023;
libcascade is its maintained successor).

## The test

The same scenario ran for each candidate, in Node 26 and in a Chromium Web
Worker: a box 40×30×20, fillet its 4 vertical edges (r = 3), cut a Ø8
through-hole, tessellate with per-face triangle ranges and edge polylines,
render with three.js, export binary STL and STEP, re-import the STEP. Then:
tag the box's 6 faces and 12 edges, carry the names through the fillet and the
cut using OCCT history, and count how many faces and edges of the final solid
get a name. Finally, rebuild the part 1000 times (4000 for C) with disposal
and watch the WASM heap.

## Measurements

One laptop (Ryzen 7 4700U). Browser figures are headless Chromium 153 loading
from localhost, so they exclude network time.

| | A. libcascade | B. replicad | C. brepjs / occt-wasm |
|---|---|---|---|
| Scenario result (valid solid, exact volume, watertight STL, STEP re-import with 11 faces) | pass | pass | pass |
| Works without `SharedArrayBuffer` (page not cross-origin isolated) | yes | yes | yes |
| WASM size, raw / brotli | 42.7 MB / **8.22 MB** | 23.0 MB / **4.84 MB** | 22.3 MB / **4.76 MB** |
| JS glue + library, brotli | 27 kB | 71 kB | 62 kB |
| Cold load, browser: worker spawn → kernel ready | **784 ms** | 229 ms | 135 ms |
| Cold load, Node: import + init | 970 ms | 202 ms | 163 ms |
| Whole scenario, warm median (Node / browser) | 47 / 60 ms | 51 / 73 ms | 52 / 65 ms |
| Fillet / cut, warm (Node) | 5.7 / 5.4 ms | 4.8 / 9.2 ms | 8.0 / 12 ms |
| Tessellate + extract, warm (Node) | 13 ms (our JS loop) | 4.5 ms | 5.3 ms |
| History exposed | full OCCT: faces, edges, vertices | none through its API; full OCCT through `getOC()` | faces only, as hash → hashes maps |
| Final faces named from history | **11 / 11** | 11 / 11 (via `getOC()`) | 7 / 11 (the 4 fillet faces are lost) |
| Final edges named from history (the rest named from adjacent faces) | 10 / 27 (+17) | 10 / 27 (+17) | 0 / 27 (+27) |
| Heap growth per rebuild, with disposal | **80 KB** (after the `Clear()` fix below) | **446 KB** | **0 KB** over 4000 rebuilds |
| TypeScript types | generated for all of OCCT, with Doxygen docs | good for replicad; OCCT types for `getOC()` | good (branded types, `Result`) |
| Activity (commits in last 90 days / contributors) | 71 / 12 | 43 / 18 | 579 / 6 (brepjs), 140 / 5 (occt-wasm) |
| Last release | 3.0.2, 2026-08-17 | 1.1.0, 2026-09-04 | 20.0.0, 2026-09-21 (19.0.1 was 2026-09-03) |

All three run OCCT 8.0, which is why warm speed is the same. libcascade's slow
cold start comes from embind registering the whole OCCT class surface at
init, not from the download. A trimmed build fixes it: replicad's 302-class
build of the same toolchain starts in about 200 ms.

### What the history test showed

With raw OCCT (A, or B through `getOC()`) the history is complete and does
what §5.2 assumes:

- Fillet: the 6 box faces are `Modified` (trimmed) into one face each. The 4
  vertical edges are `IsDeleted`, and `Generated(edge)` returns the fillet
  face. The 8 horizontal edges are `Modified` (shortened).
- Cut: the top and bottom faces are `Modified`. Each also `Generated` the
  hole's rim on that face (a full-circle edge) and a vertex on the rim. The
  hole tool's side face is `Modified` into the hole wall, and it generates both
  rims too, so each rim edge carries two names (`cut(box:z+)` and
  `cut(hole:side)`). That is correct, and useful. The tool's end caps are
  `IsDeleted`.
- The edges that bound a fillet face, and the hole wall's seam, have no
  history entry. We name them from their adjacent faces (for example
  `edge[box:x-|fillet(box:x-y-)]`). All 17 such names were unique here.
- History also returns vertices. The spike didn't index them, but P2-04 can,
  in the same way.

occt-wasm's facade reports history for faces only, keyed by
`TopoDS_Shape` hash codes. Two things follow. First, a fillet face is
generated from an edge, and edges are not tracked, so the fillet faces come
back unnamed. Second, the `generated` lists also contain the new rim edges, but
labelled as face hashes. brepjs's own code calls the kernel's generated-face
hashes "unreliable" and names edges from their adjacent face roles instead.
replicad's `fillet()` and `cut()` return only the new shape and drop the OCCT
builder, so its API has no history at all.

### What the memory test showed

All three leak control runs (the same loop without disposal) grew, so the
method detects leaks. With disposal:

- **occt-wasm:** zero heap growth and zero live arena shapes after 4000
  rebuilds. So OCCT 8's fillet and boolean don't leak by themselves.
- **libcascade:** `delete()` on a `BRepAlgoAPI_Cut` through embind leaks about
  130 KB per cut. Calling `Clear()` before `delete()` removes the leak
  completely. `BRepFilletAPI_MakeFillet` leaks too: about 10 KB just to
  construct it and add an edge, about 32 KB after `Build()`. `Reset()` doesn't
  help. Box, cylinder, explorers, `GProp` and meshing are clean.
  `spikes/p0-02-kernel/src/node/leak-bisect.ts` reproduces each case.
- **replicad:** its build has the same leaks, and its API gives no way to call
  `Clear()`, so a replicad rebuild leaks about 446 KB.

The heap-growth test is coarse: the heap only grows once its initial slack
(about 50 MB) is used up. A small leak needs thousands of iterations to show.

## Decision

**Use libcascade's raw OCCT bindings, inside our own thin TypeScript layer in
`packages/kernel`. Do not depend on replicad or brepjs. Use them as code
references.**

1. **P0-09 starts on the prebuilt `libcascade` package**, with:
   - a disposal scope for every embind object (the spike's `Scope` in
     `raw-occt.ts` works, and so does `using`);
   - `Clear()` before `delete()` on every `BRepAlgoAPI_*` boolean (the spike's
     `trackBoolean()`);
   - a Vitest memory test (rebuild a fixture ≥ 1000 times, fail on heap growth,
     plus a leak control that must fail);
   - the fillet leak reported upstream to `taucad/opencascade.js`, with the
     bisect script as the reproduction.
2. **Move to our own build with `@libcascade/toolchain`** when the fillet leak
   isn't fixed upstream, or at P2-15, whichever comes first. The toolchain lets
   us:
   - bind only what we use (expected about 4.5–5.5 MB brotli and about 200 ms
     cold start, judging by replicad's build and occt-wasm);
   - compile our own C++ into the same WASM (`customBindings`). The heavy
     builders (booleans, fillet and chamfer, shell) go behind a small C++
     facade that owns builder lifetime in C++ and returns results and history
     for faces, edges and vertices as flat arrays. This is occt-wasm's pattern,
     and occt-wasm is the one candidate that didn't leak. Bulk mesh extraction
     (one buffer copy instead of an embind call per node) goes there too.
   - Everything else keeps using the raw bindings. A new OCCT capability costs
     one line in the binding list, not a fork.
3. **Code references:**
   - replicad (MIT): wire, face and sketch builders, meshing, and its public
     build config (`packages/replicad-opencascadejs/build-source`) as a
     starting binding list.
   - brepjs (Apache-2.0): `shapeRef` / `EdgeRef` (face roles plus geometric
     hints, edges named by their two adjacent face roles). This is close to
     §5.2 and is the model for P2-04's fingerprint fallback.
   - occt-wasm (MIT/Apache tooling): the facade pattern and the
     flat-array history encoding.

### Why not the others

- **B. replicad as a dependency.** Its API hides the builders, so every feature
  that needs history (all of them, for topological naming) would bypass it
  through `getOC()`. What's left is 265 kB of JS we wouldn't use, a build we
  don't control, and a leak we can't work around through its API. Its trimmed
  build also lacks helpers we used (`NCollection_IndexedMap` can't be
  constructed, and `TopExp` isn't bound).
- **C. brepjs on occt-wasm.** Best on size, cold start and memory. It fails the
  deciding test: with no edge history, fillet faces lose their names (7 of 11
  faces). Hash codes identify faces only within one kernel session. occt-wasm
  binds no OCCT classes, so anything its facade doesn't offer means forking
  both the C++ facade and its Rust build. The project is effectively one
  maintainer, and brepjs changes fast: 579 commits in 90 days, and major
  version 19 → 20 within three weeks. Its good ideas (the facade and the naming
  model) are reusable without the dependency.

## Consequences

- **P0-09:** the kernel package wraps libcascade with a disposal scope,
  `trackBoolean()`, a memory test in CI and a JS mesh extractor. Cold start is
  about 780 ms in the browser until the custom build lands, so the UI must not
  wait for the kernel before showing the home screen (the risk register already
  says so).
- **P2-04:** history is enough to name every face through fillet and boolean,
  and to name edges generated by booleans. Edges without history (a fillet's
  boundary edges) get a name from their two adjacent faces. A geometric
  tiebreaker is needed when two faces share more than one edge. Splits get
  suffixes ordered by centroid (the spike's rule), plus the fingerprint
  fallback of §5.2.
- **P2-15 / custom build:** needs Docker with socket access and the pinned
  2.4 GB `ghcr.io/taucad/opencascade.js` image, locally and in CI (GitHub
  Actions runners have Docker). On the development laptop the current user
  can't reach the Docker socket yet. Run `npx libcascade check` in CI so a
  missing binding fails the build instead of throwing `BindingError` at run
  time. Trimming only helps a lot when many classes go: the toolchain's own
  measurement is −0.9% brotli for −14% symbols.
- **I/O:** OCCT's `StlAPI_Writer` can only write ASCII through the bindings,
  because `ASCIIMode()` returns a reference that JS can't assign. So STL (and
  3MF) are written in JS from the export tessellation, in `packages/io` (MIT).
  STEP goes through OCCT. The STEP writer prints a banner to stdout, so route
  Emscripten's `print` to the worker's logger.
- **Licensing:** unchanged for the prebuilt package (a separate LGPL `.wasm`).
  With a custom build, our C++ facade is compiled into that LGPL `.wasm`.
  License the facade's source LGPL-2.1-or-later, keep it in its own directory,
  and include it in the P3-15 license review.
- **Re-check before P3-15:** occt-wasm/brepjs may add edge history, and
  libcascade may fix the leaks upstream. The spike's scripts re-run the whole
  comparison in a few minutes.
