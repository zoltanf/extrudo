# Spike: STL triangles → B-rep solid (issue #95)

Probe for `docs/plans/stl-to-solid-2026-10-20.md`. Built and run in the pinned
OCCT image (OCCT 8.0.1), 2026-10-20:

```sh
bash spikes/stl-to-solid/run.sh        # about 2 minutes: em++ link + node
```

`harness.cpp` makes a box, a cylinder, a plate with a hole and two spheres
with OCCT, writes each as binary STL, reads it back (`RWStl`, welded nodes,
as our importer's `Mesh.merge()` does), then:
`BRepBuilderAPI_MakeShapeOnMesh` → shell (`BRep_Builder`, the faces share
their edges) → `BRepBuilderAPI_MakeSolid` + `ShapeFix_Solid` →
`ShapeUpgrade_UnifySameDomain` → `ShapeFix_Shape`, and tries a fillet and a
through-cut on the result against an exact-box control. Numbers are in the
plan.

## Prismatic (slice 3, 2026-10-21)

```sh
bash spikes/stl-to-solid/run.sh prismatic      # all cases, about 5 minutes: em++ link + node
bash spikes/stl-to-solid/run.sh prismatic 6    # one case: 1-9, 11, c (curved), t (tori, split clusters), r (regions), u (unfit blends) or x (extra shapes)
STL_DIR=~/Development/extrudo-stl-solid-test FILE=third-party/wyze-garage-bracket.stl bash spikes/stl-to-solid/run.sh prismatic g  # faceted on one corpus file (STL_DIR mounted at /stl)
FACES=1 bash spikes/stl-to-solid/run.sh prismatic 6   # with every face's plane or axis
PIECES=1 bash spikes/stl-to-solid/run.sh prismatic t  # with every surface the segmentation found (regions() cases)
```

`prismatic.cpp` includes the facade itself (`run.sh` copies it with its
private members public into `build/`), stages each mesh through
`meshNodes`/`meshTriangles` with the nodes rounded to float32 (as
`Kernel.meshFrom` keeps a mesh body), and runs `meshToSolid(1, tolerance)`.
The meshes: `fixtures/imports/cube.stl`; cylinders r 5 h 20 at 32, 360 and
16 segments built like manifold's (caps triangulated from their boundary
only); OCCT solids meshed fine or coarse and read back welded through STL (a
plate with a hole, a box with a filleted edge, a 299-step staircase); a UV
sphere (2,208 and 499,000 triangles); the 32-gon with its nodes moved
radially by up to ±0.005 mm. `c` adds the curved cases (slice 4a1, ADR-0097
§3): a sphere r 10, a dome (a cylinder fused with a hemisphere) fine and
coarse, a truncated cone, a countersunk plate, a pointed cone and an
ellipsoid. `t` adds the tori and the split clusters (slice 4a2): a donut
R 10 r 3 fine and coarse, the box with four filleted top edges, a cylinder
with a filleted end, a plate whose hole's top edge is filleted, a box with
all twelve edges filleted, and the ellipsoid again. `x` adds an L-bracket, boxes with four filleted vertical or top
edges, a plate with a 12-gon hole, a slot and a boss, and a tube. It prints
the time, the report, the faces by kind, the validity and the volume against
the exact one. The numbers are in ADR-0097's amendments of 2026-10-21;
disabling the cylinder snap (an edit of the copy) makes the coarse
four-fillet box and the slot fail.

## Real files, sanitizers and stage times (hardening slice A, 2026-10-22)

```sh
STL_DIR=~/stl FILE=own/part.stl TOL=0.05 bash spikes/stl-to-solid/run.sh prismatic f   # one file
STL_DIR=~/stl TOL=auto bash spikes/stl-to-solid/run.sh prismatic f                      # Auto (ADR-0097 slice D2; picks 0.01/0.02/0.05/0.1)
STL_DIR=~/stl TOL=0.01 bash spikes/stl-to-solid/run.sh prismatic F                     # every .stl/.mesh under STL_DIR, one process
STL_DIR=~/stl FILE=own/part.stl TOL=auto bash spikes/stl-to-solid/run.sh prismatic s  # one file, then the STEP round-trip diagnosis (ADR-0097 D7)
STL_DIR=~/stl TOL=auto bash spikes/stl-to-solid/run.sh prismatic S                    # every file, the diagnosis per file and a summary table
SAN=1 STL_DIR=~/stl FILE=… bash spikes/stl-to-solid/run.sh prismatic f                  # AddressSanitizer (about 4 min to link)
TIMES=1 …   # the rebuild's stage times, cell counts and the check that refused
PIECES=1 …  # how many surfaces each region is on, every surface as fitted and as rebuilt
GAPS=1 …    # with PIECES: MakerVolume's warnings, the snaps and reverts, inside samples in no cell by surface
BUDGET=ms … # a lower rebuild budget than PRISMATIC_REBUILD_BUDGET_MS, to see it hit
SEGMENT=1 … # with PIECES: the segmentation only
UNFIT=1 …   # every unfit surface: regions, triangles, nodes, area and share, box, thinnest triangle, each kind's fit deviation, its neighbours
UNFIT=2 …   # with UNFIT: also the median region area and the 20 largest regions of each unfit surface
```

`GAPS=1` also prints every MakerVolume cell (kept or dropped, volume, inside
and outside votes, centre), every 20th outside vote's point and surface, and
each curved face's u/v bounds. Case `u` (hardening slice C) is a box 20 × 20
× 10 with one vertical edge cut by a twisted chamfer (2 → 1 mm, a ruled
saddle no primitive fits: 1.4 % of the surface, left out of the rebuild) and
the same at three times the size (4.8 %: refused).

`STL_DIR` is mounted read-only at `/stl`; `FILE` is relative to it, `TOL`
defaults to 0.01 and `TOL=auto` (or `TOL=0`) means Auto (ADR-0097 slice D2:
the facade picks 0.01/0.02/0.05/0.1 mm from the mesh, the `rebuild … tolerance`
line and `TIMES=1`'s `auto <tol>: unfit <share> %` name it). `f` stages the file through `stlFile()` (`RWStl`, nodes
welded by position; or a `.mesh` file: uint32 nodes, uint32 triangles,
float32 xyz, uint32 corners), rounds the nodes to float32, runs
`meshRegions`, then `meshToSolid(1, TOL)`, and prints the time, the report
or the refusal. `F` runs every file in one process, so state one file leaves
shows in the next (the 2026-10-21 trap corrupted the heap for every later
file). The kernel orders a mesh as manifold's `getMesh()` does, which can
segment differently: write that order with
`MESH_OUT=<dir> STL_DIR=… pnpm vitest run packages/kernel/src/mesh-to-solid-files.test.ts --project @extrudo/kernel`.
Cases `s`/`S` diagnose the STEP round trip (ADR-0097 D7): `s` is `f` on one file (STL_DIR, FILE, TOL) then writes the
converted body to STEP, reads it back and prints the settings in force, the written body's edges by class and tolerance
buckets, the read-back `shapeDiagnose` and BRepCheck statuses by name, the invalid edges by class and faces by kind, the
summed area per face kind written vs read back, and a `ShapeFix_Shape` pass at the written tolerances; `S` does that for
every file and ends with one summary row per file (Markdown, printed to stdout). Neither changes the converter.
The settings line calls `STEPControl_Controller::Init()` first (else every value reads 0); the summary gains the
`u2 valid`/`u2 faces`/`u2 solids`/`u2 ratio`/`uncertainty` columns of a second round trip with
`write.precision.mode` Greatest, and each file's flagged `SelfIntersectingWire` wires and
`UnorientableShape`/`BadOrientationOfSubshape` faces with their edges' classes, and a second summary table: the
BREP round trip (`BRepTools::Write`/`Read`), a `ShapeFix_Shape`-healed body's STEP round trip, a no-pcurve write and a
`2DUse_Preferred` read (`stepDirect` writes with a plain `STEPControl_Writer` because the facade's `writeStep()` overwrites
the transfer parameters), and the flagged wires' smallest edges (ADR-0097's 2026-10-30b amendment). Each file also prints
its read-back `other` faces' surface type and its written tori (radii, degenerate), and the cap sweep runs the same `S`
with `FACADE=` set to a copy of the facade whose `HYBRID_EDGE_TOLERANCE_MAX` is 0.1/0.05/0.02.
Each flagged wire is then analysed with `ShapeAnalysis_Wire` (Q15: each edge with itself, adjacent and non-adjacent pairs),
its face matched to the written body and the pair search re-run there (Q16), and each pair classified hairpin / 3D-close /
2D-only (Q17) — a fourth summary table; because ShapeAnalysis reproduces `BRepCheck_Wire::SelfIntersect` on only 7 of the 25
flagged wires, a fifth table classifies the pair `BRepCheck_Wire::SelfIntersect` itself returns (ADR-0097's 2026-10-30b amendment).
The kernel sweep writes the same numbers machine-readably: `SWEEP_OUT=<file>.jsonl` appends one JSON line per file (both methods' report, validity, volume ratio, time and STEP round trip), and `SWEEP_BASELINE=<file>.jsonl` compares each file against a previous run's line and fails it when it got worse (refused where it converted, over 10 % more faces, or a STEP read-back that was valid there and kept the face count there but not now).
`BUILD=<folder>` builds into `spikes/stl-to-solid/<folder>` (default
`build`), so two runs don't share one; `NOBUILD=1` reruns the last build;
`FACADE=<file>` builds an edited copy of the facade (it must have the members prismatic.cpp reads; an older facade needs its own run.sh and prismatic.cpp).
`SAN=ub` (UBSan) and `SAN=heap` (`SAFE_HEAP`) are wired up but untried.

## The hybrid rebuild (slice D1, 2026-10-23)

Prismatic's second stage (ADR-0097's 2026-10-23 amendment) runs when the exact
rebuild is skipped or refuses. The same `f`/`F` cases show it:

```sh
TIMES=1 …          # also the hybrid's stages ("hybrid loops", "faces", "facets", "solid", "unified", "healed",
                   # "validity", "checked against the mesh"), why it refused and how many regions it exploded
FACES=1 …          # per recognised region: kind, triangles, loops, edges, the largest edge tolerance, built or
                   # exploded and why; and BRepCheck's statuses when the unified result needed healing
HYBRID_BUDGET=ms … # a lower budget than HYBRID_BUDGET_MS (90 s)
```

The report line gains `rebuild exact|hybrid, facets N`; a converted file
prints `rebuild hybrid, facets N, exploded N, pl/cy/co/sp/to …` (the
recognised faces by kind, facets not counted).

## Boundary chains (slice D3, 2026-10-23)

The hybrid's boundary chains between two recognised regions collapse into one
line, circle or ellipse edge where the nodes lie on the surfaces' curve
(ADR-0097's slice D3 amendment). The same `f`/`F` cases show them:

```sh
TIMES=1 …   # also "hybrid chain curves <ms>" and "hybrid chains: 293 collapsed (64 lines, 229 circles, 0 ellipses), 148 polylines"
FACES=1 …   # one line per chain: collapsed ("chain 17 cylinder|plane: circle, regions 6|154, 11 mesh edges, tolerance 0.002")
            # or kept as the mesh's polyline and why ("chain 33 sphere|plane: node 0 off by 0.01893"; "(build 2)" on a rebuild)
```

A converted hybrid file also prints
`chains: … ; kept as polylines: a node off 8, no curve: off axis 8, …` (the
reasons counted) and, for every converted file, `edges N (lines, circles,
ellipses)`: the result's edges by curve type. An older facade lacks
`hybridChains_`: build it with its own `run.sh` and `prismatic.cpp` (`FACADE=`).

## STEP read-back probes (slice D8, 2026-10-31)

Case `s` (one file) and `S` (all) run more probes after the 2026-10-30b ones
(ADR-0097's 2026-10-31 amendment); each prints `qNN` lines under the file:

```sh
STL_DIR=~/Development/extrudo-stl-solid-test TOL=auto BUILD=diag FILE=own/scrap-plate.stl \
  Q23=1 bash spikes/stl-to-solid/run.sh prismatic s
```

- always: `q18` (the written wires at vertex tolerance 1e-7 through
  `BRepCheck_Wire::SelfIntersect`, next to the read's flagged count) and
  `q19` (the default file read at a user precision of 1e-3, and written with
  the least and with a session uncertainty of 1e-3), the `chains:` line with
  its keptWhy counts and `exact chain ends: N edges, M off`;
- `Q20=1`: the read with no shape processing, then the FixShape operator
  replayed and once per mode switched off (`Q20OFF=<name part>` picks modes,
  `Q20FACES=1` lists the faces the healing splits or changes);
- `Q21=1`: the reader's pcurves against ours on the flagged raw wires, the
  file's PCURVE/SURFACE_CURVE/EDGE_CURVE counts, and the
  `read.surfacecurve.mode` matrix;
- `Q22A=1` with `FACES=1`: each hairpin pair on the read matched to the written
  edges and their build records (`hybridEdges_`), angles, overlap and flags;
  `Q22OLD=1` looks the saved pairs (`diag/q22a-pairs-*.txt`) up in an older
  build (`FACADE=`); `Q22B=1`: volumes written, raw and read, and the faces
  whose area moves on the read;
- `Q23=1`: the cone faces whose area moves on the read, per edge the pcurves,
  the circle's distance to the cone, its axis against the cone's and its
  pcurve against the exact projection.

- `Q24=1` (slice D9): every written face on a spindle torus (R ≤ r) or a
  surface of revolution and every read-back one: radii, u/v range, area,
  BRepCheck on the face alone and `ShapeFix_Face`'s result. With `UNFIT=1`,
  case `f` also lists each torus surface with R ≤ r that the segmentation
  finds with slice D8's R > r gates off (`q24 spindle surface`: regions,
  triangles, area, R, r, axis, where its nodes sit against the axis and the
  poles, the plane/cylinder/cone/sphere fits on the same nodes). run.sh's
  facade copy takes two hooks for that: `spikeSpindle` (the gates off;
  `Q24SPINDLE=1`) and `spikeTorusSurface` (`Q24REV=1`: the chart's torus as a
  surface of revolution of its meridian circle). Both are for slice D8's
  facade (`FACADE=` a copy of it); on slice D9's, `Q24SPINDLE` only turns the
  two snap gates off, `Q24REV` matches nothing, and the listing shows the
  spindle tori the segmentation's retry keeps.

- `Q25=1` (slice D10, case `f`/`F`): the rolling-ball fillet candidates at every Auto ladder step up to the one Auto
  picks (`q25 auto`). Each unfit surface (one band per connected piece over mesh edges), each piece the "< 4 regions"
  rule turned into planes (`keep`; run.sh's facade copy records them in `spikeKeepPieces`) and, for a band that fails,
  its sub-bands (split by each pair of planes it borders: the facets whose normals lie in their arc) get one
  `q25 band` line: triangles, area, class (`ff` two planes border it by 80 % or more, `ff?` they don't, `pc` a plane
  and a cylinder, `other:<kinds>`), the first test that fails (`coverage`, `angle` 30-170 degrees, `area` 3 x the
  largest facet, `normals` within 5 degrees of the n_A n_B plane and inside their arc, `side`), the planes' angle,
  the rolling-ball radius (per node the root of |q - axis(r)| = r on the corner's side, the median after dropping
  the 10 % farthest), the radii's spread, the nodes' distances to that cylinder (p50/p75/p90/max in multiples of T)
  and `pass` (75 % within 2 T, all within 5 T, neither beyond 4 % of r). Every cylinder region growing fitted gets the
  same line (`cyl`, with its fitted radius as `fit r`): a check of the method. `q25 step` sums a step (the unfit share
  before and after taking the accepted bands out), `q25 exploded` the hybrid's exploded regions by kind and reason.
  `Q25ONLY=1` skips the conversion. On kernel-staged meshes (`MESH_OUT`) the numbers match the sweep's.
  `python3 spikes/stl-to-solid/q25.py <log>` turns the log into the tables of ADR-0097's 2026-10-31c amendment (slice D10).

- `Q26=1` (slice D11, case `f`/`F`): the hybrid's exploded regions. run.sh's facade copy gets spike-only hooks in
  `rebuildHybrid` (`spikeQ26*`; with `Q26` unset they change nothing) that record every region face build (attempt,
  pass, the collapsed chains it used; for an invalid face BRepCheck's statuses per sub-shape kind and
  `ShapeAnalysis_Wire`'s checks), every attempt's outcome and a copy of the regions and the mesh. One `q26 region`
  line per exploded region: the stage (`loops`, `build0`/`build1`, `culprit`, `nodeoff`), the boundary walked again
  with each boundary edge paired to the next one round the same fan (`pinch` nodes two boundary edges leave, `pieces`,
  `simple`, `signs` as `meshLoops` tests them, `seam`, `wrap`), the chart normal against the triangles (`normal`,
  `folded`), the loop segments that cross in (u, v) (`selfx`, `crossx`; `across`/`touch`/`coincident`, `apart` in 3D,
  `local`: within 8 along the loop; up to six `q26 cross` lines), the facets the region makes on its own, and faces
  built from polylines on their own edges: from the fan-paired loops (`fan`) and from those split at every node a loop
  passes twice (`split`). `p0`/`p1` are the facade's own pass 0 and pass 1 there. One `q26 attempt` line per build
  attempt (estimate, valid, `cellsvalid`: the solids before unify, faces, facets, volume, nodes off) and a
  `q26 outcome`. `Q26=2` prints only the attempts. `python3 spikes/stl-to-solid/q26.py <auto log> [fixed-step logs]`
  turns the logs into the tables of `docs/plans/m2s-exploded-q1-2026-11-01.md`.

Case `f` with `TIMES=1` also prints `calls:` (chainCurve and
`Geom2dAPI_Interpolate` calls, the mesh check's nodes, BRepExtrema calls and
face classifier time); with `FACES=1` the validity stage lists each region
whose collapses it undoes (kind, area, outline length, its chains).

## Browser timings (slice D4, 2026-10-23)

```sh
PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/google-chrome-stable E2E_GPU=1 bash spikes/stl-to-solid/browser-timing.sh
```

Builds the app, copies `battery-holder.stl`, `phone-stand-foldable.stl` and
`spool-screw-v4.1.stl` from `$STL_DIR/own` into `MESH_TIMING_DIR` (default
`/tmp/extrudo-mesh-timing`, never the repository), then runs
`e2e/mesh-to-solid-timing.spec.ts` with `MESH_TIMING=1` (unset it is skipped,
so CI ignores it). The spec imports each fixture and own file through the
Import dialog ("As solid" off), opens Convert to Solid… (Prismatic, Auto)
and times from the dialog's OK to the body row losing its mesh flag, twice per
file; it prints one `TIMING {file, run, ms}` line per run. Pair each file with
the kernel sweep's time at Auto (ADR-0097's slice D4 amendment has the table).

## Outside converters (2026-10-22)

`bench/verify_step.cpp` checks a STEP file another tool made against the STL it
came from, with desktop OCCT 7.9 (not the facade), and prints one JSON line:
validity, faces by surface type, volume against the mesh's signed volume, and
exact / faceted / failed. `bench/verify_all.sh` runs it over a list of STLs.
The results and the tools' versions are in
`docs/plans/mesh-to-solid-bench-2026-10-22.md`.

```sh
g++ -std=c++17 -O2 spikes/stl-to-solid/bench/verify_step.cpp -o /tmp/verify_step \
  -I/usr/include/opencascade -lTKDESTEP -lTKXSBase -lTKBRep -lTKTopAlgo \
  -lTKGeomBase -lTKG3d -lTKMath -lTKernel
(cd "$STL_DIR" && find . -name '*.stl' | sed 's|^\./||') > /tmp/list.txt
bash spikes/stl-to-solid/bench/verify_all.sh /tmp/verify_step "$STEP_DIR" "$STL_DIR" /tmp/list.txt > verify.jsonl
```

`$STEP_DIR` holds one `<name>.step` per `<name>.stl`, written by the tool under
test; keep both folders outside the repository.
