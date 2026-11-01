# Mesh to Solid: exploded regions, Q1 measurements (ADR-0097 slice D11, run 1)

2026-11-01. The question: why does the hybrid rebuild turn 17,742 triangles of recognised regions into facets at Auto,
and which of the brief's hypotheses (H1 pinches, H2 invalid planes, H3 loops the wrong way, H4 keep the last valid
build) would give them back? Measured before any facade change, on the slice D9 facade (`4d9e3849`, unchanged on
`b6b7bbf6`). This note moves into an ADR-0097 amendment if slice D11 goes on.

**Answer, in short.**

- **H1 holds, in a different shape than briefed.** The 44 "touches itself" regions (6,886 triangles, 3,753 facets on
  their own, all in converted files) are never two lobes: a region is edge-connected by construction, so a cut at the
  pinch nodes leaves one piece every time. They are one face whose boundary passes a node twice: a hole touching the
  outer loop, or two holes touching. Walked again with each boundary edge paired to the next one round the same fan,
  and split at every node a loop passes twice, **all 44 give simple loops with the right signs and a valid face**
  (polylines, built alone). Kept as one loop that passes the node twice, only 3,345 of the triangles build.
- **H2 has one cause with three geometries.** Every "invalid face" plane (37 regions, 7,609 triangles) is a wire that
  crosses itself in the plane's (u, v): BRepCheck says `SelfIntersectingWire` (with `UnorientableShape`), or
  `BadOrientationOfSubshape` for 3 regions, the same in pass 0 (collapsed chains) and pass 1 (polylines), and a face
  built alone from polylines on its own edges fails the same way. So the collapsed chains and the neighbours' pcurves
  are not the cause. The geometry: **absorbed steps** (5,324 triangles, 2,893 of them in refused whiteboard-tray-v5): a
  plane that took in a step wall lower than T, whose boundary folds back on itself when projected; **degenerate
  fits** (1,153, all phone-stand-foldable): a wall strip under T high "fitted" by a plane square to its triangles;
  **micro zigzags** (1,132, gear-bearing-5): boundary nodes 1.8e-5 mm apart that cross in (u, v).
- **H3 is two things.** The 744 "outer loop" planes are phone-stand-foldable's degenerate fits again (the chart normal
  square to the triangles, cos ≈ 0, or a wall band whose two rims project onto one curve). The 472 "inner loop"
  triangles (hot-wheels-connector, 2 regions) each hold a 3-edge hole of 1e-4 mm² whose loop runs the wrong way.
- **H4 gives nothing.** Over Auto and the four fixed steps there are 15 refusals; none had an earlier attempt with a valid
  solid under the facet cap. The "invalid" refusals (whiteboard-tray-v5, mms-m5-nut) never had valid cells in any
  attempt; the cap refusals are over the cap on their first (and only) attempt or on the estimate; no budget refusal.

## Method

- **Meshes.** Slice D10's kernel-staged meshes (`MESH_OUT`, 38 files; the 3 the importer refuses are absent), copied to
  `/tmp/m2s-exploded/meshes/`. At Auto the probe's run gives the sweep's facets exactly: 0 per-file differences against
  `baseline-2026-10-31c-auto.jsonl`, total facets 17,790, exploded triangles 17,742 (the D10 numbers).
- **Probe `Q26`** (`spikes/stl-to-solid/prismatic.cpp`, `README.md`; tables by `q26.py`). run.sh's facade copy gets
  spike-only hooks in `rebuildHybrid` (sed lines; with `Q26` unset they change nothing): every region face build
  (attempt, pass, the collapsed chains it used; for an invalid face BRepCheck's statuses per sub-shape kind and
  `ShapeAnalysis_Wire`'s order, connected, small, closed and self-intersection checks), every attempt's outcome (the
  estimate, valid or not, the cells before unify, faces, facets, volume, nodes off), and a copy of the regions, the
  segmentation and the mesh after each attempt's faces. After the conversion, one `q26 region` line per exploded
  region: the stage it exploded in, its boundary walked again (each boundary half-edge paired with the next one round
  the same fan of the end node's triangles), pinch nodes (nodes two boundary edges leave), edge-connected pieces,
  loop signs as `meshLoops` tests them, seam crossings (raw ElSLib parameters jump) and wraps (the centred chart's
  parameters jump by more than π), the chart normal against the area-weighted triangle normal, triangles folded in
  (u, v), loop segments that cross or touch in (u, v) (how: across, an end on the other segment, coincident nodes; how
  far apart in 3D; whether the two segments are within 8 of each other along the loop), the facets the region makes
  on its own (the facet estimate's coplanar rule inside the region), and two faces built through a copy of
  `makeFace`'s polyline path on their own vertices and edges: from the fan-paired loops (`fan`), and from those loops
  split at every node a loop passes twice (`split`, outer = largest |area|, signs tested again). `Q26=2` records only
  the attempts (the fixed-step runs).
- **Runs.** `STL_DIR=/tmp/m2s-exploded/meshes TOL=auto BUILD=d11 Q26=1 bash run.sh prismatic F`, then `TOL=0.01`,
  `0.02`, `0.05`, `0.1` with `Q26=2`; the two "invalid" refusals again with the cells check (`cells valid`), which the
  probe gained after the fixed-step runs. Tables: `python3 spikes/stl-to-solid/q26.py <auto log> [fixed-step logs…]`.

## Q1.1 Every exploded region

188 regions in 18 files. By reason and kind:

| reason | kind | regions | triangles | files |
|---|---|---|---|---|
| invalid face | plane | 37 | 7609 | 5 |
| touches itself at node | torus | 4 | 2992 | 3 |
| touches itself at node | cylinder | 25 | 2434 | 4 |
| touches itself at node | cone | 4 | 1145 | 1 |
| its outer loop runs the wrong way | plane | 12 | 744 | 1 |
| invalid face | cylinder | 1 | 574 | 1 |
| invalid after unify | plane | 2 | 563 | 2 |
| an inner loop runs the wrong way | plane | 2 | 472 | 1 |
| edge tolerance | cone | 18 | 312 | 1 |
| touches itself at node | plane | 10 | 273 | 2 |
| edge tolerance | torus | 13 | 165 | 4 |
| edge tolerance | sphere | 36 | 150 | 3 |
| invalid face | torus | 10 | 142 | 3 |
| its outer loop runs the wrong way | torus | 9 | 83 | 2 |
| touches itself at node | sphere | 1 | 42 | 1 |
| invalid after unify | cylinder | 1 | 21 | 1 |
| its outer loop runs the wrong way | cone | 1 | 16 | 1 |
| edge tolerance | cylinder | 1 | 4 | 1 |
| its outer loop runs the wrong way | sphere | 1 | 1 | 1 |
| **total** |  | 188 | 17742 | 18 |

The stage each exploded in (build1: pass 1 failed after `undoChains`; build0: pass 0 failed and the region had no
collapsed chain to undo; culprit: invalid in the unified solid; no region exploded for a node off its face at Auto):

| stage | reason | regions | triangles |
|---|---|---|---|
| build1 | invalid face | 33 | 7999 |
| loops | touches itself at node | 44 | 6886 |
| loops | its outer loop runs the wrong way | 23 | 844 |
| build0 | edge tolerance | 66 | 608 |
| culprit | invalid after unify | 3 | 584 |
| loops | an inner loop runs the wrong way | 2 | 472 |
| build0 | invalid face | 15 | 326 |
| build1 | edge tolerance | 2 | 23 |

Chart and loops, by reason (triangles; `seam`: a loop crosses the raw parameters' seam, harmless after centring;
`wrap`: a loop's centred parameters jump by more than π; `chains>0`: the pass-0 face used a collapsed chain):

| reason | regions | tris | periodic | seam | wrap | chains>0 | loops>1 | pinch>0 |
|---|---|---|---|---|---|---|---|---|
| invalid face | 48 | 8325 | 716 | 142 | 142 | 7999 | 5502 | 0 |
| touches itself at node | 44 | 6886 | 6613 | 3792 | 0 | 0 | 603 | 6886 |
| its outer loop runs the wrong way | 23 | 844 | 100 | 100 | 90 | 0 | 197 | 0 |
| edge tolerance | 68 | 631 | 631 | 500 | 447 | 0 | 0 | 0 |
| invalid after unify | 3 | 584 | 21 | 0 | 0 | 0 | 532 | 0 |
| an inner loop runs the wrong way | 2 | 472 | 0 | 0 | 0 | 0 | 472 | 0 |

The "edge tolerance" regions are small periodic ones (cones, tori, spheres), 447 of their 631 triangles in loops that
wrap the centred chart; the edge tolerance they would need is 1.03–40 mm (the limit is 1 mm).

Per file, every file with an exploded region (the ten facet-heavy files are all here except object-permanence-base,
1,620 facets, all from 2,938 unfit triangles; "facets" empty: refused):

| file | T | facets | unfit tris | exploded tris | exploded regions | invalid face | touches | outer wrong | edge tol | culprit | inner wrong |
|---|---|---|---|---|---|---|---|---|---|---|---|
| own/battery-power-adapter | 0.1 | 415 | 0 | 742 | 4 |  | 742 |  |  |  |  |
| own/desk-organizer-module-small | 0.01 | 42 | 0 | 42 | 1 |  | 42 |  |  |  |  |
| own/drill-block | 0.01 | 208 | 360 | 52 | 4 | 52 |  |  |  |  |  |
| own/kuglbahn-pillar-base | 0.1 | 3409 | 5377 | 237 | 3 | 144 | 93 |  |  |  |  |
| own/mirna-doodle-1 | 0.1 | 23 | 30 | 16 | 2 |  |  |  | 16 |  |  |
| own/phone-stand-foldable | 0.1 | 1847 | 0 | 4179 | 39 | 3435 |  | 744 |  |  |  |
| own/puzzle-insert-circle | 0.05 | 1230 | 0 | 2460 | 2 |  | 2460 |  |  |  |  |
| own/remove-before-flight-cover | 0.01 | 120 | 84 | 66 | 4 | 66 |  |  |  |  |  |
| own/shower-holder | 0.01 | 472 | 439 | 50 | 1 |  | 50 |  |  |  |  |
| own/spool-screw-v4.1 | 0.05 | 2123 | 0 | 3249 | 33 |  | 3249 |  |  |  |  |
| own/whiteboard-tray-v5 | 0.02 |  | 639 | 4058 | 8 | 3491 |  | 35 |  | 532 |  |
| third-party/gear-bearing-5 | 0.1 | 1418 | 1588 | 1132 | 6 | 1132 |  |  |  |  |  |
| third-party/hot-wheels-connector | 0.01 | 1833 | 1909 | 477 | 3 | 5 |  |  |  |  | 472 |
| third-party/makita-vacuum-holder | 0.05 | 2649 | 3106 | 674 | 25 |  | 250 | 16 | 408 |  |  |
| third-party/micro-sd-keyring-inner | 0.01 | 18 | 0 | 36 | 34 |  |  | 1 | 35 |  |  |
| third-party/mms-m5-nut | 0.02 |  | 0 | 52 | 2 |  |  |  |  | 52 |  |
| third-party/sock-clips-6x | 0.01 | 90 | 0 | 174 | 14 |  |  | 48 | 126 |  |  |
| third-party/spaghetti-measure | 0.01 | 36 | 0 | 46 | 3 |  |  |  | 46 |  |  |

Triangles are not facets: a flat exploded region's coplanar triangles merge into few facets. What each group costs in
facets of the 36 converted files (the facets the regions make on their own; refused files left out):

| group | regions | triangles | facets on their own |
|---|---|---|---|
| touches itself at node | 44 | 6886 | 3753 |
| invalid face, plane: degenerate fit | 24 | 1153 | 951 |
| outer loop the wrong way (20 regions: 12 phone-stand planes, 8 small periodic) | 20 | 809 | 614 |
| invalid face, plane: absorbed step | 6 | 2431 | 386 |
| edge tolerance | 68 | 631 | 375 |
| invalid face, other kinds | 8 | 118 | 88 |
| inner loop the wrong way | 2 | 472 | 84 |
| invalid face, plane: micro zigzag | 6 | 1132 | 26 |

## Q1.2 H1: "touches itself"

Every region is one edge-connected piece (`pieces>1` is 0 everywhere): `hybridRegions` makes regions as connected
pieces over mesh edges, so two lobes that meet only at a node are two regions. What passes a node twice is the
boundary. Walked with fan pairing, 42 of the 44 regions have one loop that passes 1–13 nodes twice; split at those
nodes they have 2–14 simple loops (a hole touching the outer loop, holes touching each other):

| fan loops | split loops | regions | triangles |
|---|---|---|---|
| 1 | 2 | 19 | 1364 |
| 1 | 3 | 13 | 3149 |
| 1 | 4 | 5 | 643 |
| 1 | 5–7 | 4 | 759 |
| 1 | 14 | 1 | 368 |
| 3 | 4 | 1 | 367 |
| 4 | 5 | 1 | 236 |

Per kind and per file (`fan valid`: the face from the fan-paired loops, one wire passing the node twice; `split`: the
loops split at those nodes, sharing the node's vertex):

| group | regions | tris | pinch nodes | simple | fan valid | split signs ok | split valid | split valid, signs ok | would not build |
|---|---|---|---|---|---|---|---|---|---|
| torus | 4 | 2992 | 6 | 0 | 236 | 2992 | 2992 | 2992 | 0 |
| cylinder | 25 | 2434 | 44 | 0 | 1961 | 2434 | 2434 | 2434 | 0 |
| cone | 4 | 1145 | 27 | 0 | 860 | 1145 | 1145 | 1145 | 0 |
| plane | 10 | 273 | 16 | 0 | 246 | 273 | 273 | 273 | 0 |
| sphere | 1 | 42 | 1 | 0 | 42 | 42 | 42 | 42 | 0 |
| **total** | 44 | 6886 | 94 | 0 | 3345 | 6886 | 6886 | 6886 | 0 |

| file | regions | tris | pinch nodes | fan valid | split valid, signs ok |
|---|---|---|---|---|---|
| own/spool-screw-v4.1 | 33 | 3249 | 81 | 2612 | 3249 |
| own/puzzle-insert-circle | 2 | 2460 | 4 | 0 | 2460 |
| own/battery-power-adapter | 4 | 742 | 4 | 391 | 742 |
| third-party/makita-vacuum-holder | 2 | 250 | 2 | 250 | 250 |
| own/kuglbahn-pillar-base | 1 | 93 | 1 | 0 | 93 |
| own/shower-holder | 1 | 50 | 1 | 50 | 50 |
| own/desk-organizer-module-small | 1 | 42 | 1 | 42 | 42 |

The one-wire faces that fail say `UnorientableShape` and `NotClosed` (wire in face), e.g. puzzle-insert-circle's two
tori (1,232 and 1,228 triangles). Split, all build. The faces were built alone with polylines; whether they survive
the collapsed chains, the shared edges and unify in the assembled solid is the first thing Q2 must measure.

## Q1.3 H2 and H3

### "invalid face" planes

BRepCheck's statuses, pass 0 and pass 1 (`-`: no pass 1, the region had no collapsed chain):

| pass 0 | pass 1 | regions | triangles | files |
|---|---|---|---|---|
| face:UnorientableShape + wire:SelfIntersectingWire + wire@face:SelfIntersectingWire | the same | 32 | 7425 | 5 |
| face:BadOrientationOfSubshape | - | 3 | 172 | 1 |
| face:UnorientableShape + wire:SelfIntersectingWire + wire@face:SelfIntersectingWire | - | 2 | 12 | 1 |

No edge or vertex status (no `InvalidCurveOnSurface` from a collapsed chain), no `IntersectingWires`, no
`InvalidImbricationOfWires`. `ShapeAnalysis_Wire` finds a self-intersection in 14 regions (5,683 triangles) in pass 0
and in 13 (2,790) in pass 1, and nothing else (order, connection, small edges, closure all clean); the probe's own
segment test finds a crossing in (u, v) within one loop in all 37 and between loops in none. A face built alone from
polylines on its own edges is invalid in all 37, so neither the collapsed chains nor the pcurves neighbours put on
shared edges cause it. By geometry:

| geometry | regions | triangles | files | largest (file id triangles) |
|---|---|---|---|---|
| absorbed step: local folds, the crossing segments within 1.5 T in 3D | 7 | 5324 | 4 | whiteboard-tray-v5 42 2893; phone-stand-foldable 53 781; phone-stand-foldable 2 764 |
| degenerate fit: the plane square to its triangles (cos < 0.5) | 24 | 1153 | 1 | phone-stand-foldable 271 131; 285 105; 336 79 |
| micro zigzag: the crossing segments under 0.001 mm apart in 3D | 6 | 1132 | 1 | gear-bearing-5 152 554; 0 554; 959 6 |

- **Absorbed steps.** phone-stand-foldable 53 (781 triangles, T 0.1, one loop of 265 edges, nodes up to 0.090 mm off
  the plane): the four crossings are an end of one boundary segment on another 2–3 edges further on, 0.028 and
  0.074 mm apart in 3D, at (0.15, 5, 0) and (3.15, 21, 0). That fits a boundary that runs down a wall lower than T
  which the plane took in, and back: projected, the wall's edges lie on top of the floor's (an interpretation of the
  numbers; the mesh wasn't looked at in a viewer). whiteboard-tray-v5 42
  (2,893 triangles, T 0.02, 15 loops): segments 4 apart along a 200-edge loop cross 0.019 mm apart in 3D at z 5 and
  5.019, a 0.019 mm step the z = 5 plane took in; 15 of its triangles are folded in (u, v). phone-stand 2 and 72 are
  the same notch on the stand's other parts. In words: a flat face with a ledge lower than T at its edge; the ledge's
  wall stands square to the plane, so it projects onto a line and the outline doubles back over it.
- **Degenerate fits.** phone-stand-foldable 271 (131 triangles), 285, 336 and 21 more: the chart normal is square to
  the triangles (cos 0.0–0.03), 45 of 131 triangles fold, the crossings sit 0.150 mm apart in 3D, nodes up to
  0.075–0.09 mm off the plane. Each is a strip of wall 0.15 mm high: every node lies within T = 0.1 of a plane
  through the strip's middle, square to the wall, so the segmentation accepts the "plane". Projected, the strip's two
  long edges coincide and cross all along. The 3 `BadOrientationOfSubshape` regions (172 triangles: 337, 347, 405)
  are such strips projecting to zero area (8e-17 mm²).
- **Micro zigzags.** gear-bearing-5 0 and 152 (554 triangles each, the bearing's two exactly flat end faces, 0 mm off
  the plane, 2 loops of 454 and 100 edges): four crossings each between segments two apart along the loop, 1.85e-5 mm
  apart in 3D, at (±22.54, ±0.81) and (±23.30, 0.00): where the gear's parts meet, the outline has nodes 2e-5 mm apart
  and steps back over itself by that much. The four 6-triangle regions are the same at the same corners.

The other kinds: whiteboard-tray-v5's cylinder 108 (574 triangles) crosses itself once, the two segments 0.022 mm apart in 3D
and far apart along the loop (not a local fold); 10 small tori (142 triangles) wrap their chart.

### "the wrong way"

| file | T | id | kind | tris | loop sizes | signed areas (u, v) | side | normal (cos) | folded | crossings | alone |
|---|---|---|---|---|---|---|---|---|---|---|---|
| hot-wheels-connector | 0.01 | 33 | plane | 243 | 70, 3 | 54.87, 0.0001086 | 1 | 1.0000 | 0 | 0 | BadOrientationOfSubshape |
| hot-wheels-connector | 0.01 | 141 | plane | 229 | 54, 3 | 54.4, 7.8e-05 | 1 | 1.0000 | 0 | 0 | BadOrientationOfSubshape |
| phone-stand-foldable | 0.1 | 358 | plane | 101 | 53, 48 | 8.145, -8.142 | -1 | -1.0000 | 69 | 48 between loops | IntersectingWires |
| phone-stand-foldable | 0.1 | 266 | plane | 96 | 48, 48 | -8.142, 8.142 | 1 | 0.0000 | 96 | 144 between loops | IntersectingWires |
| phone-stand-foldable | 0.1 | 276, 344, 288, 353, 360, 334, 268, 267, 306, 332 | plane | 35–68 each, 547 | 1 loop | 0–0.0027 | ±1 | -0.007–0 | most | 3–73 within the loop | SelfIntersectingWire (334: valid) |
| makita, whiteboard, sock-clips, micro-sd-keyring-inner | 0.01–0.05 | 9 regions | cone, torus, sphere | 1–16 each, 100 | 1 loop | | | | | wrap the chart | edge tolerance 1.3–18 mm |

- The 744 phone-stand planes are degenerate fits like those above: ten strips (one loop of almost zero area,
  chart normal square to the triangles) and two wall bands round a hole (358, 266: two loops of equal |area|, the
  top and bottom rims projected onto one curve). No region has several loops of similar area other than these two
  bands, and none has a loop crossing a seam (planes have none).
- hot-wheels-connector 33 and 141 (472 triangles): a correct outer loop and a 3-edge hole of 1e-4 mm² whose loop runs
  the wrong way (an inverted sliver triangle of another region inside the plane).
- The 100 periodic triangles wrap their chart (the region is cut in a way the centred chart doesn't cover); they would
  need edge tolerances far over 1 mm anyway.

## Q1.4 H4: refusals and their attempts

15 refusals over the five runs, no "past the budget" among them:

| T | refused | reason |
|---|---|---|
| Auto | whiteboard-tray-v5 (0.02), mms-m5-nut (0.02) | invalid |
| 0.01 | kuglbahn-pillar-base, gear-bearing-5, makita-vacuum-holder | facet cap, on the estimate before any build (13,915 / 14,648 / 10,512) |
| 0.01 | whiteboard-tray-v5, mms-m5-nut | invalid |
| 0.02 | kuglbahn-pillar-base | facet cap: attempt 0 valid, 7,105 facets |
| 0.02 | puzzle-insert-circle | facet cap: attempt 0 valid, 5,899 facets |
| 0.02 | gear-bearing-5, makita-vacuum-holder | facet cap, on the estimate (14,636 / 8,715) |
| 0.02 | whiteboard-tray-v5, mms-m5-nut | invalid |
| 0.05 | whiteboard-tray-v5 | facet cap: attempt 0 valid (unify undone), 8,774 facets |
| 0.1 | whiteboard-tray-v5 | invalid |

The "invalid" refusals, attempt by attempt (`cells valid`: the solids before unify, what "unify undone" delivers):

| file | T | attempt | facet estimate | unified valid | cells valid | invalid faces after healing | faces | next |
|---|---|---|---|---|---|---|---|---|
| whiteboard-tray-v5 | 0.02 (Auto) | 0 | 527 | no | no | 1 | 1302 | undo the collapses of 1 region |
| | | 1 | 622 | no | no | 1 | 1302 | explode 1 region |
| | | 2 | 644 | no | no | 0 | 1323 | refused: invalid |
| mms-m5-nut | 0.02 (Auto) | 0 | 0 | no | no | 2 | 63 | undo the collapses of 2 regions |
| | | 1 | 0 | no | no | 2 | 63 | explode 2 regions |
| | | 2 | 15 | no | no | 2 | 74 | refused: invalid |

At 0.01 and 0.1 the two files run the same three attempts, all invalid, cells invalid. whiteboard-tray-v5's last
attempt has no invalid face left but the unified solid isn't valid (`SubshapeNotInShape` on the solid before healing).
mms-m5-nut converts at 0.05 and 0.1.

So there is no earlier valid attempt to keep: at Auto neither refusal ever had a valid solid, and every cap refusal is
over the cap on its first build or on the estimate (explosions only add facets, so a later attempt can't be under it
either). Keeping the last valid build would change no result in this corpus. Of the converted files, four ran a second
attempt (gardena-end at Auto, 0.01, 0.02 and 0.1: 2 culprits exploded; phone-stand-foldable at 0.01 and 0.02 and
track-straight-100mm at 0.05: nodes off; hot-wheels-connector at 0.1: unify undone).

## Q1.5 The files with nothing unfit

Every facet triangle of these files is an exploded region's (unfit triangles 0). Triangles by reason, and in brackets
the facets those regions make on their own (they merge across regions in the solid, so the sum can differ from the
file's facets by a few):

| file | facets | exploded tris | facets, regions alone | touches itself | invalid face | outer wrong | edge tolerance |
|---|---|---|---|---|---|---|---|
| own/spool-screw-v4.1 | 2123 | 3249 | 1833 | 3249 (1833) |  |  |  |
| own/phone-stand-foldable | 1847 | 4179 | 1851 |  | 3435 (1272) | 744 (579) |  |
| own/puzzle-insert-circle | 1230 | 2460 | 1230 | 2460 (1230) |  |  |  |
| own/battery-power-adapter | 415 | 742 | 410 | 742 (410) |  |  |  |
| third-party/sock-clips-6x | 90 | 174 | 90 |  |  | 48 (26) | 126 (64) |
| own/desk-organizer-module-small | 42 | 42 | 42 | 42 (42) |  |  |  |
| third-party/spaghetti-measure | 36 | 46 | 36 |  |  |  | 46 (36) |
| third-party/micro-sd-keyring-inner | 18 | 36 | 36 |  |  | 1 (1) | 35 (35) |

spool-screw-v4.1's solid has 290 facets more than its regions' own count (1,833): the probe's coplanar rule merges
more triangles than unify does there. Not looked into; the 1,833 is a lower bound of what the pinch regions cost. phone-stand-foldable's 3,435 "invalid face" triangles are 2,282 absorbed-step triangles
(3 regions, few facets) and 1,153 degenerate-fit triangles (951 facets).

## What this means for Q2

Candidates by what they could recover at Auto (converted files only):

1. **H1, split the boundary at pinch nodes** (in `meshLoops`: pair each incoming boundary edge with the outgoing one
   round the same fan, then split a loop at every node it passes twice): 6,886 triangles, 3,753 facets on their own,
   in 7 files (spool-screw 1,833, puzzle-insert-circle 1,230, battery-power-adapter 410…). All build alone; that is
   20 % of the corpus's facets, enough for the owner's −10 % bar if most survive assembly.
2. **Degenerate plane fits** (phone-stand-foldable): 1,153 + 744 triangles, about 1,500 facets, one file. The cause is
   in the segmentation (a strip under T high accepted as a plane square to it), not in the hybrid; a normals test on
   plane regions would stop it, and what the strips become instead is open.
3. **Absorbed steps**: 2,431 triangles but only 386 facets in converted files (plus whiteboard-tray-v5's 2,893, which
   is refused for another reason). A fix would take the steep triangles out of a plane region before its loops.
4. **edge tolerance / wraps** (375 facets), **the 3-edge sliver holes** (84 facets), **micro zigzags** (26 facets):
   small.
5. **H4, keep the last valid attempt**: nothing in this corpus.

H3 as briefed (a better largest-|area| rule) has no case: the wrong-way loops are degenerate fits and sliver holes.


## Q2 (run 2)

Two facade changes, each measured with the spike on the staged meshes and then with the kernel sweep at Auto against
`baseline-2026-10-31c-auto.jsonl` (sweep A: Q2.1 alone, written as `baseline-2026-11-01-q21-auto.jsonl`; sweep B:
Q2.1 and Q2.2, written as `baseline-2026-11-01-auto.jsonl`). The spike's facets per file match the sweep's exactly.

### Q2.1 The boundary split at the nodes it passes twice

`meshLoops` keeps its walk for every region without such a node (the loops, their order and their start nodes stay as
they were). Where a node has two outgoing boundary edges, `meshFanLoops` pairs each boundary edge with the next one
round the same fan of the region's triangles at its end node, closes the walks, and cuts each walk at every node it
passes twice into simple loops that keep the node (so the face's wires share its vertex). Outer loop, sign test, "a
loop that doesn't close" and "no boundary" are unchanged; a fan that doesn't end at a boundary edge counts as a loop
that doesn't close. The region diagnostics line says "split at N nodes". Such nodes are chain break nodes already
(4 boundary edges), so the chains need no change.

Spike, Auto (before = Q1's run):

| file | faces | facets | valid | volume ratio | ms | split regions (triangles built / exploded again) |
|---|---|---|---|---|---|---|
| own/battery-power-adapter | 994 → 583 | 415 → 0 | 1 → 1 | 0.9996 → 0.9981 | 2445 → 2562 | 4 (742 / 0) |
| own/desk-organizer-module-small | 418 → 377 | 42 → 0 | 1 → 1 | 0.99994 → 0.99994 | 15353 → 15709 | 1 (42 / 0) |
| own/kuglbahn-pillar-base | 3941 → 3881 | 3409 → 3348 | 1 → 1 | 1.0012 → 1.0012 | 10203 → 11416 | 1 (93 / 0) |
| own/puzzle-insert-circle | 1609 → 379 | 1230 → 0 | 1 → 1 | 0.99843 → 0.99848 | 14944 → 15192 | 2 (2460 / 0) |
| own/shower-holder | 901 → 869 | 472 → 439 | 1 → 1 | 0.99991 → 0.99993 | 2609 → 1710 | 1 (50 / 0) |
| own/spool-screw-v4.1 | 3197 → 1361 | 2123 → 256 | 1 → 1 | 1.0006 → 1.0008 | 23166 → 49068 | 33 (2872 / 377) |
| third-party/makita-vacuum-holder | 3467 → 3336 | 2649 → 2516 | 1 → 1 | 0.99993 → 0.99994 | 8468 → 9357 | 2 (250 / 0) |

Of the 44 split regions, 42 (6,509 triangles) survive the collapsed chains, the shared edges and unify in the assembled
solid; 2 in spool-screw-v4.1 (a cone of 285 triangles split at 5 nodes, a cylinder of 92 split at 1) are invalid in
the unified solid and explode on a second attempt ("invalid after unify" 584 → 961 triangles). That second attempt is
spool-screw's extra time (23 → 49 s in the spike, 22.5 → 41.8 s in sweep B). Exploded triangles 17,742 → 11,233;
facets 17,790 → 14,009.

Sweep A (Q2.1), totals (the test's own rules, recomputed from the JSONL: the `sweep totals` line still doesn't reach
the log):

    31c:  files 41, prismatic converted 36 refused 5, faceted converted 26 refused 15, prismatic faces 27581, prismatic facets 17790, prismatic ms 253658, faceted ms 104971, round trips failed 7 (own/battery-power-adapter.stl, own/phone-stand-foldable.stl, own/spool-nut-v4.1.stl, third-party/gear-bearing-5.stl, third-party/makita-vacuum-holder.stl, third-party/micro-sd-keyring-inner.stl, third-party/spaghetti-measure.stl)
    Q2.1: files 41, prismatic converted 36 refused 5, faceted converted 26 refused 15, prismatic faces 23840, prismatic facets 14009, prismatic ms 307531, faceted ms 130372, round trips failed 9 (… the 7, plus own/puzzle-insert-circle.stl, own/spool-screw-v4.1.stl)

Sweep A ran while other jobs loaded the machine: faceted, which didn't change, took 24 % longer too; its times are not
comparable. Sweep B (below) ran on a quieter machine.

**Two round trips lost.** In puzzle-insert-circle and spool-screw-v4.1 the converted body is valid, but its STEP
read-back is not: one face each, `IntersectingWires` (puzzle-insert-circle: the rescued torus R 26.5, r 1, 1,232
triangles; spool-screw-v4.1: a rescued cone). The read-back has one vertex more than the written body (2,644 against
2,643; 8,059 against 8,058): the reader splits the vertex the face's touching loops share, and the two loops then
cross. A healing pass, the 1e-3 and least uncertainties and writing without pcurves don't mend it (spike case `s`). Of
the 44 split faces, these two fail; the synthetic test's plane face (two inner loops touching) round-trips. The change
stays in, as briefed; see "for run 3".

Test: `mesh-to-solid.test.ts`, "splits a top face whose two dimples touch at a node": a plate with two square pyramid
dimples whose rims touch at a corner. `meshLoopsDebug` gives the top region an outer loop and two inner loops of 4
(before slice D11 the region was exploded, so `meshLoopsDebug` listed no loops for it: from the code, not run
against the old WASM); with a freeform boss beside them the hybrid builds the top as
one plane face of 1,200 − 36 − 25π mm², and the body round-trips. The case without the boss converts exactly (the
exact stage, which never reaches `meshLoops`). The committed fixtures of `mesh-to-solid-files.test.ts` keep their pins
(61 passed in both sweeps).

### Q2.2 Plane fits square to their facets

Measured first (`Q26PLANES`): plane surfaces whose fitted normal and facets' area-weighted mean normal are under
|cos| 0.5 apart. At Auto: only own/phone-stand-foldable (T 0.1), 41 surfaces, 2,006 triangles, |cos| 0 to 0.114, each a
group of 8 to 90 regions; the plane square to the mean normal through the area-weighted centroid holds every node
within T in none of them. At 0.01 mm: none in any file. So the rule is contained to one file, and was implemented.

Where: `fitKind`'s plane case, which tries the largest region's plane, then the area-weighted plane, then the
least-squares plane. The least-squares plane is now kept only when its normal agrees with the facets' area-weighted
mean normal by |cos| ≥ 0.5 (`MESH_PLANE_NORMAL_AGREEMENT`); otherwise the area-weighted plane stands, outside the
tolerance, so the group is no plane and is fitted as the other kinds (or left unfit). The brief's refit (the mean
normal through the area-weighted centroid) is that area-weighted plane, already computed there. What the strips
became: phone-stand-foldable's segmentation goes from 471 planes / 10 cylinders / 10 tori to 496 / 49 / 11, unfit 0:
the strips are cylinders (walls along curved outlines) and smaller planes. Spike: phone-stand-foldable faces
2,325 → 983, facets 1,847 → 403, valid, 19.6 → 4.7 s; no other file moves.

### Sweep B (Q2.1 and Q2.2) against 31c

    31c:       files 41, prismatic converted 36 refused 5, faceted converted 26 refused 15, prismatic faces 27581, prismatic facets 17790, prismatic ms 253658, faceted ms 104971, round trips failed 7 (own/battery-power-adapter.stl, own/phone-stand-foldable.stl, own/spool-nut-v4.1.stl, third-party/gear-bearing-5.stl, third-party/makita-vacuum-holder.stl, third-party/micro-sd-keyring-inner.stl, third-party/spaghetti-measure.stl)
    2026-11-01: files 41, prismatic converted 36 refused 5, faceted converted 26 refused 15, prismatic faces 22498, prismatic facets 12565, prismatic ms 264074, faceted ms 109045, round trips failed 9 (own/battery-power-adapter.stl, own/phone-stand-foldable.stl, own/puzzle-insert-circle.stl, own/spool-nut-v4.1.stl, own/spool-screw-v4.1.stl, third-party/gear-bearing-5.stl, third-party/makita-vacuum-holder.stl, third-party/micro-sd-keyring-inner.stl, third-party/spaghetti-measure.stl)

Every file that moved:

| file | faces | facets | Auto step | valid | round trip (read back valid, faces) | ms |
|---|---|---|---|---|---|---|
| own/battery-power-adapter | 994 → 583 | 415 → 0 | 0.1 → 0.1 | yes → yes | yes, 994 → yes, 583 | 2518 → 2471 |
| own/desk-organizer-module-small | 418 → 377 | 42 → 0 | 0.01 → 0.01 | yes → yes | yes, 418 → yes, 377 | 16414 → 16527 |
| own/kuglbahn-pillar-base | 3941 → 3881 | 3409 → 3348 | 0.1 → 0.1 | yes → yes | yes, 3941 → yes, 3881 | 10406 → 10814 |
| own/phone-stand-foldable | 2325 → 983 | 1847 → 403 | 0.1 → 0.1 | yes → yes | no, 2325 → yes, 983 | 18085 → 4538 |
| own/puzzle-insert-circle | 1609 → 379 | 1230 → 0 | 0.05 → 0.05 | yes → yes | yes, 1609 → **no**, 379 | 15249 → 15068 |
| own/shower-holder | 901 → 869 | 472 → 439 | 0.01 → 0.01 | yes → yes | yes, 901 → yes, 869 | 2945 → 1983 |
| own/spool-screw-v4.1 | 3197 → 1361 | 2123 → 256 | 0.05 → 0.05 | yes → yes | yes, 3197 → **no**, 1361 | 22537 → 41836 |
| third-party/makita-vacuum-holder | 3467 → 3336 | 2649 → 2516 | 0.05 → 0.05 | yes → yes | no, 3468 → no, 3337 | 8762 → 9427 |

Against the owner's bars: facets −29 % (17,790 → 12,565; bar ≤ 16,000) and faces down in all 8 files that moved; no
new refusal; no file with more facets; prismatic time +4.1 % (faceted, unchanged, +3.9 %: the machine); every
converted body valid. **Missed: two round trips lost** (puzzle-insert-circle, spool-screw-v4.1, above). The sweep
test fails on exactly those two files ("STEP read back valid before, invalid now"). phone-stand-foldable now reads
back valid with the same face count (31c: invalid), but still counts as a failed round trip by the test's rule: its
read-back volume ratio is 0.99957 (31c: 0.99958), off by more than 1e-4.

## Q1b (ScanRuler ideas)

### Q1b.1 The mesh's own noise against the Auto rung

`spikes/stl-to-solid/noise.py` over the 38 staged meshes, as briefed: up to 4,000 nodes spread over each mesh (one per
cell of a voxel grid sized for that many; all nodes when there are fewer), the least-squares plane through the nodes
within two triangle rings, noise = 1.4826 × the median distance. Unfit shares per rung from `Q26LADDER` (the Q2.1-only
facade, so the segmentation is 31c's); Auto's rung from 31c; faces/facets at another rung from Q1's fixed-step runs.

**Answer: no.** On these meshes, which are exported from CAD and not scanned, a two-ring plane measures the meshes'
curvature and creases, not noise: a sphere's ball.stl gives 0.167 mm, the drill block 0.078 mm. 3 × noise is above the
ladder's top rung for 31 of the 36 files Auto converts; Auto's rung is the noise rung for 2 (kuglbahn-pillar-base and
phone-stand-foldable, both 0.1); no file would skip a rung; 3 would land coarser than Auto (puzzle-base-circle 0.01 →
0.05: 37 faces / 0 facets both; micro-sd-keyring-outer 0.01 → 0.05: 41 → 59 faces, 0 facets; trashcan-repair-foot
0.01 → 0.1: 16 faces / 0 facets → 155 faces / 72 facets).

| own/ball | 0.167 | 0.501 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/battery-holder | 0.1774 | 0.532 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/battery-power-adapter | 0.0905 | 0.272 | 0.1 | 21.01 / 20.07 / 6.80 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/desk-organizer-module-small | 0.05017 | 0.151 | 0.01 | 0.00 / 71.80 / 71.88 / 71.88 | None | no rung (3 x noise > 0.1) |
| own/drill-block | 0.07762 | 0.233 | 0.01 | 0.35 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/hole-filler-35mm | 0.4017 | 1.21 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/hole-filler-5mm | 0.04196 | 0.126 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/kuglbahn-pillar-base | 0.02394 | 0.0718 | 0.1 | 41.80 / 39.08 / 36.55 / 36.55 | 0.1 | same |
| own/mirna-doodle-1 | 1.54 | 4.62 | 0.1 | 6.10 / 6.10 / 5.02 / 2.60 | None | no rung (3 x noise > 0.1) |
| own/numbers-base-top | 1.769 | 5.31 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/object-permanence-base | 0.04781 | 0.143 | 0.01 | 0.53 / 15.26 / 83.24 / 83.11 | None | no rung (3 x noise > 0.1) |
| own/peg-perego-button | 0.05788 | 0.174 | 0.02 | 38.56 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/phone-stand-foldable | 0.02182 | 0.0655 | 0.1 | 48.46 / 95.00 / 94.80 / 0.00 | 0.1 | same |
| own/puzzle-base-circle | 0.01247 | 0.0374 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | 0.05 | coarser: Auto 0.01 37 faces / 0 facets; 0.05: 37 faces / 0 facets |
| own/puzzle-insert-circle | 0.05161 | 0.155 | 0.05 | 6.13 / 6.12 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/remove-before-flight-cover | 0.2631 | 0.789 | 0.01 | 0.53 / 0.53 / 0.48 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/scrap-plate | 0.1325 | 0.398 | 0.02 | 44.67 / 0.00 / 44.67 / 44.67 | None | no rung (3 x noise > 0.1) |
| own/shower-holder | 0.04494 | 0.135 | 0.01 | 0.93 / 2.91 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/spool-nut-v4.1 | 0.3688 | 1.11 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/spool-screw-v4.1 | 0.2568 | 0.77 | 0.05 | 5.98 / 2.93 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/track-straight-100mm | 0.4199 | 1.26 | 0.01 | 0.50 / 0.00 / 0.25 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/trashcan-repair-foot | 0.02369 | 0.0711 | 0.01 | 0.00 / 0.00 / 34.38 / 38.21 | 0.1 | coarser: Auto 0.01 16 faces / 0 facets; 0.1: 155 faces / 72 facets |
| own/trashcan-spacer | 0.2548 | 0.765 | 0.05 | 82.02 / 82.02 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| own/whiteboard-tray-v5 | 0.184 | 0.552 | None | 58.84 / 0.12 / 0.00 / 0.00 | None | refused at Auto |
| third-party/door-stopper-top | 0.06785 | 0.204 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| third-party/gardena-end | 0.2638 | 0.791 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| third-party/gear-bearing-5 | 0.3841 | 1.15 | 0.1 | 56.87 / 56.87 / 21.35 / 18.56 | None | no rung (3 x noise > 0.1) |
| third-party/hot-wheels-connector | 0.04898 | 0.147 | 0.01 | 0.94 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| third-party/makita-vacuum-holder | 0.05962 | 0.179 | 0.05 | 97.26 / 96.33 / 1.45 / 92.40 | None | no rung (3 x noise > 0.1) |
| third-party/micro-sd-keyring-inner | 0.07568 | 0.227 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| third-party/micro-sd-keyring-outer | 0.009007 | 0.027 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | 0.05 | coarser: Auto 0.01 41 faces / 0 facets; 0.05: 59 faces / 0 facets |
| third-party/mms-camera-mount | 0.09107 | 0.273 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| third-party/mms-flat-stand | 0.1621 | 0.486 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| third-party/mms-m5-nut | 0.2447 | 0.734 | None | 32.26 / 0.00 / 0.00 / 0.00 | None | refused at Auto |
| third-party/sock-clips-6x | 0.09317 | 0.28 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| third-party/spaghetti-measure | 0.09274 | 0.278 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| third-party/vented-funnel | 0.09339 | 0.28 | 0.02 | 2.08 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |
| third-party/wyze-garage-bracket | 0.4647 | 1.39 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | None | no rung (3 x noise > 0.1) |

Auto rung = noise rung: 2; noise rung below Auto (same result): 0, of them skipping rungs: 0 (segmentation saved 0 ms); coarser: 3; above the ladder: 31; refused at Auto: 2

A variant beyond the brief, the residual of a quadric height field over the same two-ring patch (curvature taken
out), gets close to the float32 floor on smooth meshes (ball.stl 0.0003 mm) but still sees the creases: 18 files above
the ladder, 5 at Auto's rung, 4 below it (2 of them skipping rungs: phone-stand-foldable 2 rungs, makita-vacuum-holder
1, together 1.3 s of segmentation), 9 coarser than Auto, among them hot-wheels-connector 2,015 faces / 1,833 facets
→ 682 / 439 at 0.05, and scrap-plate 154 / 0 → 274 / 173 at 0.05. The rows that aren't "no rung":

| own/ball | 0.0002909 | 0.000873 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | 0.01 | same |
| own/battery-power-adapter | 0.02091 | 0.0627 | 0.1 | 21.01 / 20.07 / 6.80 / 0.00 | 0.1 | same |
| own/desk-organizer-module-small | 0.0003643 | 0.00109 | 0.01 | 0.00 / 71.80 / 71.88 / 71.88 | 0.01 | same |
| own/hole-filler-5mm | 0.02153 | 0.0646 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | 0.1 | coarser: Auto 0.01 6 faces / 0 facets; 0.1: 6 faces / 0 facets |
| own/kuglbahn-pillar-base | 0.002126 | 0.00638 | 0.1 | 41.80 / 39.08 / 36.55 / 36.55 | 0.01 | below Auto (same result), skips 0 rung(s), 0 ms |
| own/object-permanence-base | 0.005573 | 0.0167 | 0.01 | 0.53 / 15.26 / 83.24 / 83.11 | 0.02 | coarser: Auto 0.01 1985 faces / 1620 facets; 0.02: 1711 faces / 1210 facets |
| own/peg-perego-button | 0.00604 | 0.0181 | 0.02 | 38.56 / 0.00 / 0.00 / 0.00 | 0.02 | same |
| own/phone-stand-foldable | 0.009342 | 0.028 | 0.1 | 48.46 / 95.00 / 94.80 / 0.00 | 0.05 | below Auto (same result), skips 2 rung(s), 630 ms |
| own/puzzle-base-circle | 0.004728 | 0.0142 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | 0.02 | coarser: Auto 0.01 37 faces / 0 facets; 0.02: 37 faces / 0 facets |
| own/puzzle-insert-circle | 0.0004303 | 0.00129 | 0.05 | 6.13 / 6.12 / 0.00 / 0.00 | 0.01 | below Auto (same result), skips 0 rung(s), 0 ms |
| own/scrap-plate | 0.007765 | 0.0233 | 0.02 | 44.67 / 0.00 / 44.67 / 44.67 | 0.05 | coarser: Auto 0.02 154 faces / 0 facets; 0.05: 274 faces / 173 facets |
| own/shower-holder | 0.007974 | 0.0239 | 0.01 | 0.93 / 2.91 / 0.00 / 0.00 | 0.05 | coarser: Auto 0.01 901 faces / 472 facets; 0.05: 369 faces / 74 facets |
| own/trashcan-repair-foot | 0.0001896 | 0.000569 | 0.01 | 0.00 / 0.00 / 34.38 / 38.21 | 0.01 | same |
| own/whiteboard-tray-v5 | 0.1792 | 0.538 | None | 58.84 / 0.12 / 0.00 / 0.00 | None | refused at Auto |
| third-party/hot-wheels-connector | 0.01084 | 0.0325 | 0.01 | 0.94 / 0.00 / 0.00 / 0.00 | 0.05 | coarser: Auto 0.01 2015 faces / 1833 facets; 0.05: 682 faces / 439 facets |
| third-party/makita-vacuum-holder | 0.005516 | 0.0165 | 0.05 | 97.26 / 96.33 / 1.45 / 92.40 | 0.02 | below Auto (same result), skips 1 rung(s), 713 ms |
| third-party/micro-sd-keyring-inner | 0.03181 | 0.0954 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | 0.1 | coarser: Auto 0.01 66 faces / 18 facets; 0.1: 84 faces / 0 facets |
| third-party/micro-sd-keyring-outer | 0.02187 | 0.0656 | 0.01 | 0.00 / 0.00 / 0.00 / 0.00 | 0.1 | coarser: Auto 0.01 41 faces / 0 facets; 0.1: 55 faces / 0 facets |
| third-party/mms-m5-nut | 0.2153 | 0.646 | None | 32.26 / 0.00 / 0.00 / 0.00 | None | refused at Auto |
| third-party/vented-funnel | 0.01215 | 0.0364 | 0.02 | 2.08 / 0.00 / 0.00 / 0.00 | 0.05 | coarser: Auto 0.02 632 faces / 0 facets; 0.05: 439 faces / 0 facets |

Auto rung = noise rung: 5; noise rung below Auto (same result): 4, of them skipping rungs: 2 (segmentation saved 1343 ms); coarser: 9; above the ladder: 18; refused at Auto: 2

Neither estimate is a floor Auto could start from: the plane one says nothing for most files, and the quadric one would
move 9 files to a coarser rung, some better, some worse. A noise floor for these meshes would need patches inside one
face (no crease), which is what the segmentation already finds.

### Q1b.2 Torus faces' loop orientation in the written STEP

`spikes/stl-to-solid/torus_loops.py` over the STEP files of the 36 converted bodies at Auto (written with `STEP_OUT` by
the facade's own writer, Q2.1 and Q2.2 in), with two independent checks per face. The (u, v) one: every edge sampled
at 64 points in the direction its ORIENTED_EDGE, EDGE_CURVE and bound flag give, (u, v) on the torus from its
placement, unwrapped; a loop that doesn't wrap must have the area sign its role (outer = the largest, else a hole)
and `same_sense` give; a band's two u-wrapping rims must run opposite ways in u. The edge-use one: in a closed shell,
the two faces on an edge use it in opposite directions; a bound with a wrong flag uses its edges the same way as the
neighbours.

**Check of the method on OCCT's own fillets** (the kernel's `fillet`, its STEP writer): a cylinder r 5 with both rims
filleted r 1, a holed block, a boss on a plate. In each file one torus face fails **both** checks: on the filleted
cylinder, the bottom rim's torus (axis −z, at z 1) has bound flag .F.; with .T. both its edges would run opposite to
the neighbours' as they must. Harness case `H` shows OCCT's frame of that torus is indirect (`gp_Ax3::Direct()` false,
face reversed), and the top rim's is direct and fine. So the defect the brief describes is in the STEP files Extrudo
writes today for an ordinary fillet on a cylinder's rim. OCCT's reader mends it: the three files read back valid with
the same face counts (5, 9, 10).

In the converted bodies:

| file | faces | torus faces | unrolled | loops | disagree | ambiguous | edge uses the same way | read-back faces / valid |
|---|---|---|---|---|---|---|---|---|
| own/battery-power-adapter | 583 | 2 | 2 | 3 | 0 | 0 | 0 / 3439 | 583 / 1 |
| own/desk-organizer-module-small | 377 | 12 | 12 | 12 | 0 | 0 | 0 / 6454 | 377 / 1 |
| own/drill-block | 388 | 2 | 2 | 2 | 0 | 0 | 0 / 1864 | 388 / 1 |
| own/hole-filler-35mm | 6 | 1 | 1 | 1 | 0 | 0 | 0 / 9 | 6 / 1 |
| own/kuglbahn-pillar-base | 3881 | 10 | 10 | 10 | 0 | 0 | 0 / 10258 | 3881 / 1 |
| own/peg-perego-button | 212 | 2 | 2 | 2 | 0 | 0 | 0 / 1738 | 212 / 1 |
| own/phone-stand-foldable | 983 | 13 | 13 | 13 | 1 | 0 | 0 / 4426 | 983 / 1 |
| own/puzzle-base-circle | 37 | 1 | 1 | 1 | 0 | 0 | 0 / 101 | 37 / 1 |
| own/puzzle-insert-circle | 379 | 1 | 1 | 5 | 0 | 0 | 0 / 3019 | 379 / 0 |
| own/trashcan-spacer | 78 | 4 | 4 | 4 | 0 | 0 | 0 / 359 | 78 / 1 |
| third-party/gardena-end | 17 | 4 | 4 | 4 | 0 | 0 | 0 / 316 | 17 / 1 |
| third-party/makita-vacuum-holder | 3336 | 5 | 5 | 9 | 0 | 0 | 0 / 8762 | 3337 / 0 |
| third-party/sock-clips-6x | 161 | 6 | 6 | 6 | 0 | 0 | 0 / 489 | 161 / 1 |
| third-party/vented-funnel | 632 | 6 | 6 | 6 | 0 | 0 | 0 / 5163 | 632 / 1 |

Totals: 36 files, 22,498 faces, 69 torus faces, all unrolled, 78 loops; the edge-use check passes on all 90,989 edges;
the (u, v) check disagrees on 1 loop: phone-stand-foldable's face 96465 (R 2.88, r 0.086, one loop, same_sense .F.,
flag .F.), which the edge-use check passes and which reads back valid. That is not the writer defect (that fails
both checks); it may be my (u, v) sampling on a tube that thin, not looked into. The hybrid builds its tori on direct
frames (`gp_Ax3(origin, direction)`), so its tori don't meet the defect. The three read-back failures in the table
(puzzle-insert-circle, spool-screw-v4.1, makita-vacuum-holder) are not torus loop orientations: both checks pass on
those files; the first two are Q2.1's touching loops, makita's is 31c's own.

## For run 3

1. **Q2.1's two lost round trips.** Options, cheapest first: (a) explode a split region again when its pinch node
   is shared by loops of a curved face (both failures are curved; the plane in the test round-trips) — costs those
   faces' facets back, in the files the split helped most; (b) cut such a region into two faces along mesh edges
   from the pinch node to its outer loop, so no face's loops touch; (c) find out why the reader splits the shared
   vertex in those two faces and not the other 42.
2. **The writer's torus flags (Q1b.2)**, outside Mesh to Solid: Extrudo's STEP of a filleted cylinder rim has a torus
   bound flag that a reader trusting flags turns into a cove. A writer-side fix (write such faces on a direct frame, or
   check and flip the bound flags against the neighbours' edge uses before writing) and a test reading the flags.
3. **Q2.2 holds** (one file, no side effect).
4. Neither noise estimate should move Auto.
