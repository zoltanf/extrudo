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
