# P4-12 heap-growth harness

The warm-cache heap growth of ADR-0029's revolve document (ADR-0050 §6, the
P4-12 backlog item), reproduced on plain OCCT calls with the facade's
`heapTop()` (`sbrk(0)`) as the probe. `harness.cpp` `#include`s
`packages/kernel/occt/facade/extrudo_facade.cpp` with `#define private public`
and builds the document's bodies per round the way the evaluator does (a block,
a revolved groove cut, a revolved ring joined, the angle changing), meshes them
as the engine does, keeps a rolling cache of the last `CACHE` rounds' shapes
alive and evicts the rest — the memory test's picture — and prints the heap top
every 50 rounds and the growth after the cache warms.

```sh
sh spikes/p4-12-heap-growth/run.sh ROUNDS=3000 CACHE=256
sh spikes/p4-12-heap-growth/run.sh ROUNDS=3000 CACHE=256 MINIMAL=1   # one revolve
sh spikes/p4-12-heap-growth/run.sh ROUNDS=1200 MODE=same             # one shape, remeshed
MALLOC=dlmalloc sh spikes/p4-12-heap-growth/run.sh ROUNDS=3000 CACHE=256
bash spikes/p4-12-heap-growth/sweep.sh          # the cure table (sweep.log)
bash spikes/p4-12-heap-growth/sweep-minimal.sh  # the cures on the growing variant
```

Knobs: `ROUNDS`, `MODE=fresh|same`, `CACHE`, `MINIMAL`, `NOMESH`, `CLEAN`
(`BRepTools::Clean` after meshing), `COPY` (mesh a `BRepBuilderAPI_Copy`),
`MI` (mimalloc options: `purge0`, `eager`, `retain0`, `collect`). The build
chooses `-sMALLOC` (`mimalloc` by default, mimalloc's options through
`-DMI_ALLOC`), like the real WASM build's `-sMALLOC=mimalloc` (its provenance).

What it found (ADR-0050 §6's 2026-10-06 amendment): the growth is
`BRepMesh_IncrementalMesh` on **fresh** shapes while the cache holds live
triangulations — `NOMESH=1` and `MODE=same` are flat — and it is mimalloc
fragmentation of the mesher's transient `NCollection_IncAllocator` blocks, not a
leak. No cure among `BRepTools::Clean`, meshing a copy, dlmalloc or the mimalloc
options; the app's bound is the worker recycle (ADR-0067 §H4).
