# P4-12: shell with a thickness per face, and openings next to a fillet

Native harness for ADR-0046's amendment (P4-12): the facade's `shellFaces`
(walls staged with `clearWalls`/`pushWall`, per-face offsets with sharp
joins) and the plug route for removed faces that run smoothly into a
neighbour (`openingRoute`, `buildPlugged`, `plugShell`). It includes the
facade with `#define private public`, so it calls the private helpers too.

    bash spikes/p4-12-shell-faces/run.sh             # the volume table (exits 1 on a mismatch)
    bash spikes/p4-12-shell-faces/run.sh probe       # the table, then round against sharp joins and the plug steps
    bash spikes/p4-12-shell-faces/run.sh plug        # the first plug prototype (the prism alone; see the ADR)
    bash spikes/p4-12-shell-faces/run.sh faces round3    # a body's faces, numbered, with `tangent=1` where one runs into a neighbour
    bash spikes/p4-12-shell-faces/run.sh trap round3 10 2 raw   # one raw MakeThickSolidByJoin, no refusal
    bash spikes/p4-12-shell-faces/run.sh useq round3:10:2 …     # unguarded shells (build, check, bisection) in one process
    bash spikes/p4-12-shell-faces/run.sh sweep       # sweep.sh: raw shells of tangent faces, one process each
    bash spikes/p4-12-shell-faces/run.sh sweep2      # sweep2.sh: the plug route through the facade, one process each

Builds: `DEBUG=1` adds `-g2` (function names in a trap's stack), `SAFE=1`
`-sSAFE_HEAP=1`, `MALLOC=mimalloc` (what the real build links) or
`MALLOC=emmalloc-memvalidate` (checks the heap at every allocation), `OPT=-O3`,
and `BUILD=<name>` writes `build/<name>.cjs` so builds can sit side by side.

Bodies (`body()` in harness.cpp): `box` (20 mm cube), `cyl` (r 10, h 20),
`round<r>` (every edge of the cube rounded), `vert<r>` (its four vertical
edges), `top<r>` (its four top edges: a sharp edge inside a smooth chain),
`one<r>` (one top edge), `cylr<r>` (the cylinder's top rim).

Needs Docker and the pinned image (`OCCT_IMAGE`, default `74e2918318e4`).
The results are in `docs/adr/0046-shell.md`'s amendment.
