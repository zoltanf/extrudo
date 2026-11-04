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


## Q3 (run 3): the two lost round trips

### Q3.1 step 1: why these two faces

Probe `Q26TOUCH=1` (spike case `F`, Auto, the run-2 facade): every face of each converted body whose wires share a
vertex, with each wire's pcurve values at that vertex and its distance to the face's u bounds (where a full wrap's
seam lies), then the STEP round trip through the facade's writer and reader, the read-back's invalid faces and any
two read-back vertices within 1e-6 of each other. 73 faces in 13 files have touching wires; 33 are curved:

| file | face | kind | periodic u/v | spans a full turn | wires | shared vertices | smallest distance to the u bounds (rad) | pcurves at the shared vertex differ by | VERTEX_POINTs written per shared vertex | this face read back |
|---|---|---|---|---|---|---|---|---|---|---|
| own/battery-power-adapter | 8 | cylinder | 1/0 | no (0.013) | 4 | 1 | 0.004 | 0 | 2 | valid |
| own/battery-power-adapter | 19 | cylinder | 1/0 | no (1.406) | 2 | 1 | 0.344 | 0 | 2 | valid |
| own/battery-power-adapter | 382 | torus | 1/1 | no (1.983) | 2 | 1 | 0.991 | 0 | 2 | valid |
| own/battery-power-adapter | 432 | cylinder | 1/0 | no (0.807) | 2 | 1 | 0.335 | 0 | 2 | valid |
| own/desk-organizer-module-small | 273 | sphere | 1/0 | no (0.124) | 2 | 1 | 0.031 | 0 | 2 | valid |
| own/kuglbahn-pillar-base | 3267 | cylinder | 1/0 | no (0.873) | 2 | 1 | 0.075 | 0 | 2 | valid |
| own/puzzle-insert-circle | 3 | torus | 1/1 | yes (6.317) | 5 | 4 | 0.410 | 0 | 2 | **invalid** |
| own/shower-holder | 275 | cylinder | 1/0 | no (0.749) | 2 | 1 | 0.079 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 62 | cylinder | 1/0 | no (0.445) | 4 | 3 | 0.044 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 101 | cylinder | 1/0 | no (0.149) | 2 | 1 | 0.069 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 106 | cylinder | 1/0 | no (0.148) | 4 | 3 | 0.039 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 111 | cone | 1/0 | no (1.099) | 7 | 6 | 0.070 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 160 | cylinder | 1/0 | no (0.129) | 2 | 1 | 0.041 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 170 | cylinder | 1/0 | no (0.113) | 2 | 1 | 0.040 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 176 | cylinder | 1/0 | no (0.301) | 3 | 2 | 0.044 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 307 | cylinder | 1/0 | no (0.183) | 2 | 1 | 0.040 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 311 | cylinder | 1/0 | no (0.299) | 5 | 4 | 0.038 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 512 | cylinder | 1/0 | no (0.239) | 2 | 1 | 0.090 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 517 | cylinder | 1/0 | no (0.153) | 4 | 3 | 0.037 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 530 | cylinder | 1/0 | no (0.277) | 3 | 2 | 0.097 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 549 | cone | 1/0 | no (1.129) | 4 | 3 | 0.436 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 557 | cone | 1/0 | no (1.609) | 14 | 13 | 0.077 | 0 | 2 | **invalid** |
| own/spool-screw-v4.1 | 575 | cylinder | 1/0 | no (0.301) | 3 | 2 | 0.034 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 582 | cylinder | 1/0 | no (0.192) | 3 | 2 | 0.045 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 653 | cylinder | 1/0 | no (0.157) | 2 | 1 | 0.044 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 660 | cylinder | 1/0 | no (0.192) | 4 | 3 | 0.036 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 667 | cylinder | 1/0 | no (0.225) | 5 | 4 | 0.043 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 691 | cylinder | 1/0 | no (0.207) | 3 | 2 | 0.042 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 698 | cylinder | 1/0 | no (0.268) | 2 | 1 | 0.125 | 0 | 2 | valid |
| own/spool-screw-v4.1 | 702 | cylinder | 1/0 | no (0.283) | 2 | 1 | 0.141 | 0 | 2 | valid |
| third-party/makita-vacuum-holder | 1027 | torus | 1/1 | no (0.779) | 5 | 1 | 0.131 | 0 | 2 | valid |
| third-party/mms-flat-stand | 28 | cone | 1/0 | yes (6.283) | 3 | 2 | 1.151 | 0 | – (exact rebuild; not matched) | valid |
| third-party/mms-flat-stand | 29 | cylinder | 1/0 | no (2.303) | 3 | 2 | 0.000 | 0.00022 | – (exact rebuild; not matched) | valid |

Plane faces with touching wires (all read back valid): own/numbers-base-top 5, own/puzzle-base-circle 2, own/spool-screw-v4.1 9, own/trashcan-repair-foot 2, third-party/makita-vacuum-holder 1, third-party/micro-sd-keyring-outer 3, third-party/mms-flat-stand 18

**H5 does not hold.** At every shared vertex the two wires' pcurves agree exactly (0 apart; 2e-4 on one exact-rebuild
face), so there is no u against u + 2π. Of the two failing faces only the torus spans a full turn (6.317 rad), and
its shared vertices lie 0.41–1.2 rad from its u bounds. The cone (1.61 rad) doesn't wrap at all.

**What happens instead.** The STEP writer writes every vertex that two loops share as two VERTEX_POINTs at the same
point, one per loop. That holds for all 31 curved touching faces of the hybrid in the table, the 29 that read back
valid included (the exact rebuild's 2 weren't matched). The reader keeps the two apart on exactly these two faces:
their read-backs have one vertex more than the written bodies (2,644 against 2,643; 8,059 against 8,058), two
vertices at exactly the written shared vertex (within 1e-11), and `IntersectingWires` on that face only. Nothing in
the table sets the two apart cleanly: the torus is the only full-turn face, and the cone has the most loops (14
wires, 13 shared vertices; the next has 7). The reader's healing doesn't explain it either (`Q20=1`, case `s`): with
healing off, the read-back is far worse (1,637 and 1,097 edges `InvalidCurveOnSurface`), and switching off any one of
21 fixes leaves the `IntersectingWires` face. A copy of each face with its shared vertex replaced by one vertex per
wire (what the reader gets) is invalid for all 73 faces, planes included, so that doesn't single the two out either.
So there was no narrow criterion for fix (c), and fix (a) has nothing to move.

### Fix (b), as built

`cutTouchingLoops` (facade), after the hybrid's validity stage, on the unified result: every face on a periodic
surface with a hole that shares a vertex n with its outer wire is rebuilt as two faces. The cut is a new edge along a
straight (u, v) segment (a degree-1 B-spline pcurve, its 3D curve built from it) from a vertex h of the hole, the
farthest from n first, to a vertex o of the outer wire, the nearest to h first, that the segment sees: it crosses no
edge's pcurve (16 samples each) and its quarter, mid and three-quarter points classify inside. The pieces are
A = outer from n to o, the cut, hole from h to n; B = outer from o to n, hole from n to h, the cut back; each passes
n once. The face's other holes go to the piece that holds one of their vertices. The pieces reuse every edge the
face had, so its neighbours don't change, and both must check valid or the next candidate is tried. A face with no
valid cut stays as it was. The loop runs until no such face is left (at most 512 cuts), and the body replaces the
result only when it checks valid. Planes stay whole: their touching loops read back whole (40 plane faces above), and
the test's plane case round-trips.

Why not the brief's plane through the node and `BRepAlgoAPI_Splitter`: a cutting plane crosses the face's boundary
edges in their middle, and the neighbours that share those edges would have to be split too (the cut can no longer
be one face's business). A cut between two existing vertices splits no edge. The first prototype, `BRepFeat_SplitShape`
with the same edge, didn't split the face: it joined the hole to the outer wire with a slit (379 → 379 faces, body
invalid), since it doesn't see that the two wires already meet at n. The pieces are built by hand instead.

The fix also leaves no face with loops that share a vertex on a periodic surface in the exported STEP, which some
other kernels refuse to read; planes with touching loops are still written (as before slice D11, too, by the exact
rebuild: mms-flat-stand, numbers-base-top, puzzle-base-circle, trashcan-repair-foot, micro-sd-keyring-outer).

Spike first (case `F` with `Q26TOUCH=1`, the new facade): cuts in 6 files, every body valid, every read-back valid
except makita-vacuum-holder's, which is 31c's own: the invalid face is a cone with one wire, not a touching face. Its
touching torus 1027 (5 wires, 1 shared vertex) is not cut and reads back valid; whether its shared vertex is between
two holes rather than on the outer wire, or no cut gave two valid faces, was not looked into.

### Sweep (2026-11-01b) against 31c and against 2026-11-01

    31c:          files 41, prismatic converted 36 refused 5, faceted converted 26 refused 15, prismatic faces 27581, prismatic facets 17790, prismatic ms 253658, faceted ms 104971, round trips failed 7 (own/battery-power-adapter.stl, own/phone-stand-foldable.stl, own/spool-nut-v4.1.stl, third-party/gear-bearing-5.stl, third-party/makita-vacuum-holder.stl, third-party/micro-sd-keyring-inner.stl, third-party/spaghetti-measure.stl)
    2026-11-01:   files 41, prismatic converted 36 refused 5, faceted converted 26 refused 15, prismatic faces 22498, prismatic facets 12565, prismatic ms 264074, faceted ms 109045, round trips failed 9 (the 7, plus own/puzzle-insert-circle.stl, own/spool-screw-v4.1.stl)
    2026-11-01b:  files 41, prismatic converted 36 refused 5, faceted converted 26 refused 15, prismatic faces 22569, prismatic facets 12565, prismatic ms 264862, faceted ms 107397, round trips failed 7 (own/battery-power-adapter.stl, own/phone-stand-foldable.stl, own/spool-nut-v4.1.stl, third-party/gear-bearing-5.stl, third-party/makita-vacuum-holder.stl, third-party/micro-sd-keyring-inner.stl, third-party/spaghetti-measure.stl)

The sweep test passes (63 passed, 1 skipped; against 31c). The 7 failing round trips are 31c's 7 files;
phone-stand-foldable now reads back valid with its faces but its read-back volume ratio stays 0.99957 (31c: 0.99958),
off by more than the 1e-4 rule, as before. Against 2026-11-01 only the six cut files move, and only in faces and
round trip:

| file | faces 2026-11-01 → 11-01b | cuts | facets | round trip (read back valid, faces) | ms |
|---|---|---|---|---|---|
| own/battery-power-adapter | 583 → 587 | 4 | 0 | yes, 587 | 2471 → 2728 |
| own/desk-organizer-module-small | 377 → 378 | 1 | 0 | yes, 378 | 16527 → 16951 |
| own/kuglbahn-pillar-base | 3881 → 3882 | 1 | 3348 | yes, 3882 | 10814 → 11380 |
| own/puzzle-insert-circle | 379 → 383 | 4 | 0 | no, 379 → **yes, 383** | 15068 → 15394 |
| own/shower-holder | 869 → 870 | 1 | 439 | yes, 870 | 1983 → 2182 |
| own/spool-screw-v4.1 | 1361 → 1421 | 60 | 256 | no, 1361 → **yes, 1421** | 41836 → 44064 |

Against 31c no file is worse on any column: every moved file has fewer faces and facets, the same step, a valid body,
and a round trip that passes where it passed (phone-stand-foldable's read-back is valid now). The cut costs 71 faces
over the corpus and its time is inside the totals (prismatic +4.4 % against 31c, faceted, unchanged, +2.3 %: the
machine). spool-screw-v4.1's two regions that are invalid after unify (the cone split at 5 nodes, the cylinder at 1)
are unchanged: they explode on the second attempt before the cut runs.

Tests: `mesh-to-solid.test.ts` "cuts a boss wall whose dimple touches its rim at a node in two, so it round-trips
(slice D11)": a cylindrical boss with a square pyramid dimple cut radially into its wall, the dimple's top corner on
the boss's top rim; with a freeform boss beside it the hybrid runs. On the run-2 WASM the body was valid and its
read-back invalid (a scratch run of the same shape); on the new one it round-trips. The Q2.2 test was not added: a
round boss r 5, 0.06 mm high at T 0.1 converts exactly as six planes (the segmentation takes the boss into the top
plane: Q1.3's absorbed step), and at 0.15 mm it is a cylinder by region growing, not by the new rule.

OCCT WASM: the input hash went `c7ba43be3df2` (run 2) → `5d22216cd3d7`, published by CI 41271268117.

### Q3.2 Why the reader keeps the shared vertex split on only two faces (2026-11-03)

Fix (c) of "For run 3", answered after D11 shipped (so it changes nothing that ships; the cut stays). Probe
`Q26SPLIT=1` with `Q26TOUCH=1` (spike, the run-3 facade with `TOUCH_CUT_MAX` set to 0 so the touching faces are written
as before the cut): the written STEP read without healing (`readStepUnhealed`), with the reader's healing
(`fixLikeReader`, Q20) and with that healing minus one mode at a time; in each, the pairs of distinct vertices within
1e-7 of each other on two wires of one face; then, per raw and healed face with such a pair, the 2D intersections of
the two wires' edges as `ShapeFix_IntersectionTool::FixIntersectingWires` computes them (tolerance 1e-10), and that tool
run on the face alone.

- **The writer splits every shared vertex; the reader's healing joins them again.** The raw read has one vertex per
  loop at every shared vertex of every touching face (battery-power-adapter 4, desk-organizer-module-small 1,
  kuglbahn-pillar-base 1, shower-holder 1, puzzle-insert-circle 4, spool-screw-v4.1 63). The step that joins them is
  the face fix `FixIntersectingWiresMode`: without it no pair is joined in any file (battery-power-adapter 4 of 4
  left, puzzle-insert-circle 4 of 4, spool-screw-v4.1 63 of 63). At each split vertex the two wires' edges meet end to
  end in (u, v), which the tool takes as one vertex (`UnionVertexes`). Plane faces are not split by the writer.
- **On the two failing faces one pair survives the full healing.** puzzle-insert-circle's torus (outer wire of 540
  edges, 4 holes of 8, each touching the outer wire once): run alone on the raw face, the tool joins all 4 pairs; after
  the reader's whole healing, 1 is left (at −26.45, 4.56, 8.94, the duplicate vertex the read-back has). spool-screw-v4.1:
  63 raw pairs, 1 left after healing (face 1146 of the healed shape, a cylinder).
- **What takes the join away: the wire fixes that rebuild edges.** Switching off `FixShiftedMode` alone (both files) or
  `FixEdgeCurvesMode` alone (puzzle-insert-circle; on spool-screw-v4.1 that run throws) leaves no pair, and so does
  the face's whole `FixWireMode`, which runs them (puzzle-insert-circle; it throws on spool-screw-v4.1). The other 26
  wire, face and shape modes each leave the one pair (`FixIntersectingWiresMode` and the solid's `FixShellMode`, which
  skips the face fixes, leave all of them). Running the tool again on the healed face joins the pair, and the face is then
  valid (both files).
- **Reading (not proven):** the healing works face by face through one shared `ShapeBuild_ReShape`. The tool replaces
  the edges at the joined vertex with copies that carry the joined vertex. A later wire fix that rebuilds one of those
  edges, on the same face or on the neighbour that shares it, replaces it again from a copy that still has the old
  vertex. Which pair loses depends on the order the faces and edges are processed in. That fits "nothing in the table
  sets the two apart cleanly" (§Q3.1): the two faces are not special in kind, they are where the order works out wrong.

So the cause is OCCT's healing order, not something in the faces, and there is still no narrow criterion for fix (a)
or (c). D11's cut stays the right fix. It writes no periodic face with loops that share a vertex, so the reader never
has to join one. Not done: tracing the `ReShape` history to confirm the reading, and why OCCT's writer writes one
VERTEX_POINT per loop instead of one per vertex.

### Q3.3 (2026-11-03): makita-vacuum-holder's touching torus

Probe `Q26TOUCH=1`, spike case `f`, Auto, the 2026-11-01b facade (the spike's `q26 touch` line now says whether the
wire is the face's outer one):

    prismatic 3336 faces: 3074 plane 237 cyl 8 cone 12 sphere 5 torus, valid 1, volume 378801 / mesh 378824 = 0.999939
    q26 touch written face 1715 kind Torus uper 1 vper 1 uspan 0.778594 vspan 1.21931 seams 0 wires 5 outer 0 vertex 67.3794,11.6557,0.679272 tol 0.0109589 wire 1 du 0.130848 dv 0.510132 valid 1 splitvalid 0 pcurves (6.174039, 1.919864) (6.174039, 1.919864)
    q26 touch written face 1715 kind Torus uper 1 vper 1 uspan 0.778594 vspan 1.21931 seams 0 wires 5 outer 0 vertex 67.3794,11.6557,0.679272 tol 0.0109589 wire 2 du 0.130848 dv 0.510132 valid 1 splitvalid 0 pcurves (6.174039, 1.919864) (6.174039, 1.919864)

(Q3.1's face 1027; the spike numbers faces in explorer order.) The shared vertex is between holes 1 and 2, neither the
outer wire: case (a), not detected. With the hole-to-hole cut (ADR-0097's 2026-11-03 amendment):

    prismatic 3337 faces: 3074 plane 237 cyl 8 cone 12 sphere 6 torus, valid 1, volume 378801 / mesh 378824 = 0.999939
    q26 back valid 1 faces 3337

and no periodic face of makita's with touching wires (one plane is left, as planes are). The corpus (case `F`, Auto,
`Q26TOUCH=1 Q26NAMED=1`, the new facade), faces whose wires share a vertex, per file and kind:

| file | kind | faces |
|---|---|---|
| own/numbers-base-top | plane | 5 |
| own/puzzle-base-circle | plane | 2 |
| own/spool-screw-v4.1 | plane | 9 |
| own/trashcan-repair-foot | plane | 2 |
| third-party/gear-bearing-5 | plane | 2 |
| third-party/makita-vacuum-holder | plane | 1 |
| third-party/micro-sd-keyring-outer | plane | 3 |
| third-party/mms-flat-stand | plane | 18 |
| third-party/mms-flat-stand | cylinder (face 28, exact rebuild) | 1 |
| third-party/mms-flat-stand | cone (face 29, exact rebuild) | 1 |

mms-flat-stand's two curved faces come from the exact rebuild (Q3.1's table has them), which `cutTouchingLoops` doesn't
run on. Each has two holes of one closed circle edge whose only vertex is on the outer wire (instrumented build: hole
`BRepTools_WireExplorer` uses 0, `TopExp` edges 1, a circle), so no cut between existing vertices exists; a call after
the exact rebuild cut nothing and was dropped. Both read back valid.

The spike's read-back fails on whiteboard-tray-v5 (a plane, 7 wires) and sock-clips-6x (a plane, 1 wire); both pass
the sweep's round trip, which converts the kernel's staged mesh; the spike reads the STL itself, and its nodes
probably differ slightly from the kernel's weld (not checked), so its round trips aren't the sweep's.

**Sweep** (Auto, against 2026-11-01b; `baseline-2026-11-03-touching-holes-auto.jsonl`): 63 passed, 1 skipped.

    2026-11-01b:  files 41, prismatic converted 36 refused 5, faceted converted 26 refused 15, prismatic faces 22569, prismatic facets 12565, prismatic ms 264862, faceted ms 107397, round trips failed 7
    2026-11-03:   files 41, prismatic converted 36 refused 5, faceted converted 26 refused 15, prismatic faces 22570, prismatic facets 12565, prismatic ms 272785, faceted ms 108644, round trips failed 7

| file | faces | cuts | facets | round trip (read back valid, faces) | ms |
|---|---|---|---|---|---|
| third-party/makita-vacuum-holder | 3336 → 3337 | 1 | 2516 | no, 3337 → no, 3338 (0 solids, as before) | 8719 → 10023 |

No other file moves on any column; the times are the shared machine (faceted, unchanged, +1.2 %).

**makita's own round-trip failure** ("31c's own"). On the kernel's staged mesh (`MESH_OUT`, then spike case `f` on the
`.mesh`, `Q26NAMED=1 Q26CONE=1`) the read-back's one extra face is invalid:

    q26 back valid 0 faces 3338
    q26 back invalid face 3337 kind Cone wires 1
    q26 face back Cone orient 0 u 0..6.2831853 v 0..0 tol 1e-07 status own27
    q26 face back cone r 0 semi 1.3533905 apex 66.23082,82.551102,33.730818 at 66.23082,82.551102,33.730818 axis -0.36183684,-0.85915673,-0.36183397
    q26 face back wire orient 0 status 28
    q26 face back  edge 1 orient 0 closed 0 degen 1 tol 1e-07 pc (0, 0) -> (6.2831853, 0) status

A cone face made of its degenerated apex edge alone, on the cone that the body has as two faces of half a turn (u
0.71..3.85 and 3.85..6.99) on one surface. Their shared edge at u 0.71 ≡ 6.99 has a pcurve for each face, 2π apart,
so it is stored like a seam (`BRep_Tool::IsClosed` is true for it on the face u 0.71..3.85), and the reader builds the
extra apex face from it. The mirror cone at x −66.23 has the same two-halves layout and reads back. The fix belongs in
the unify path (one face per such surface, or a surface copy per face), not in the cut: not built here.

## Run 4 (D12): the remaining facet sources

2026-11-03, ADR-0097 slice D12. Spike runs on the staged meshes in `/tmp/m2s-exploded/meshes/` at Auto (`Q26=1`;
`D12=<mm²>` prints the faces over that area with their planes, `D12V=1` their vertices' distance from them), then the
kernel sweep. "Before" is the 2026-11-01b facade (its spike run gives the sweep's numbers file for file).

**Exploded regions by reason, before → after** (all files, the refused whiteboard-tray-v5 included; facets are the
regions' own):

| reason, kind | before: regions / triangles / facets | after |
|---|---|---|
| an inner loop runs the wrong way, plane (sliver holes) | 2 / 472 / 84 | 0 |
| invalid face, plane (absorbed steps, micro zigzags) | 13 / 6456 / 445 | 2 / 1108 / 2 (gear-bearing-5 0 and 152) |
| edge tolerance (wrapped charts): cone / sphere / torus / cylinder | 18 / 312 / 157; 36 / 150 / 97; 13 / 165 / 119; 1 / 4 / 2 | the same |
| invalid after unify: plane / cylinder / cone | 2 / 563 / 29; 2 / 113 / 58; 1 / 285 / 168 | the same |
| invalid face, cylinder / torus | 1 / 574 / 50; 10 / 142 / 100 | the same |
| its outer loop runs the wrong way | 12 / 201 / 152 | the same |

**Per source, spike at Auto** (faces, facets, ms; before → after):

| source | file | faces | facets | ms |
|---|---|---|---|---|
| sliver holes (rule 1) | hot-wheels-connector | 2015 → 1928 | 1833 → 1745 | 2812 → 1690 |
| absorbed steps (rule 2) | phone-stand-foldable | 983 → 868 | 403 → 287 | 4390 → 4287 |
| absorbed steps (rule 2) | whiteboard-tray-v5 | refused → 2586 | → 1900 | 56857 → 18934 |
| micro zigzags | gear-bearing-5 | 2304 → 2304 | 1418 → 1418 | 13009 → 14374 |
| wrapped charts | (not built) | | | |
| invalid after unify | spool-screw-v4.1 | 1421 → 1419 | 256 → 256 | 50335 → 51505 |

Rule 1 also moved battery-power-adapter (587 → 581 faces), kuglbahn-pillar-base (3882 → 3880, facets 3348 → 3346)
and makita-vacuum-holder (3336 → 3335).

**Absorbed steps, the variants** (phone-stand-foldable, Auto 0.1 mm):

| variant | faces | facets | volume ratio |
|---|---|---|---|
| before | 983 | 403 | 0.99919 |
| steep triangles (> 60°) out of the plane, if they touch its outline | 983 | 403 (none moved: the wall is another region's) | 0.99919 |
| fill the notch: a steep triangle with two edges on the folded plane, nodes within T, joins it | 667 | 86 | 0.97840 |
| the same, the mesh moved to its centroid / by (100, 100, 0) | 674 / 679 | | 0.98046 / 0.98406 (before: 1.00134 / 1.00511) |
| off-plane triangles (> 0.1 T) of a folded plane to facets (built) | 868 | 287 | 0.99867 |

Filling the notch builds the three planes but leaves their outlines up to 0.09 mm off the plane all round (the D12V
probe: vertices 0.0904 off); the 2 % volume deficit holds wherever the mesh sits, so it is the B-rep's, not the
volume integral's origin. On a synthetic plate with a rounded ledge under one corner (the test's `plateWithLedge`, with
`bossWithBump` beside it), the off-plane rule without the alone check gave 3 facets where the folded face built valid
(0 before), hence `meshPlaneFaceValid`; with the ledge's foot as one long edge (the test's version) the face fails
alone, the first bar (0.1 T) still folds, the second fixes it: 6 → 5 facets.

**Micro zigzags.** gear-bearing-5 0's outline passes nodes 5830 and 5831, 1.8e-5 mm apart; their edge is also an
edge of 16557, a standing sliver of the wall (3.4e-5 mm², its third node at z 3.7). Merging the nodes would change
the wall region's outline as well; not done. The four 6-triangle regions (0.097 mm off their planes, folded) are
taken out by rule 2: the same facets.

**spool-screw-v4.1.** BRepCheck on regions 214 (cone, split at 5 nodes, 6 wires) and 271 (cylinder, split at 1
node, 2 wires): valid as built, valid once every face is built, valid in the cells before and after
`ShapeFix_Solid`; after unify and healing, both fail at face level with `IntersectingWires`. Tried: unify again with
both faces' edges kept (`KeepShape`, in place, +2.4 s): still invalid after healing; `cutTouchingLoops` before the
explosion: it refuses both (no valid cut). Stage times at Auto: unify 11.0 s and healing 6.2–6.7 s per attempt, so
the second attempt is about 20 s of the 44–50 s. Left.

**Sweep** (`TOL=auto`, against `baseline-2026-11-01b-auto.jsonl`, written to `baseline-2026-11-03-auto.jsonl`;
`Tests 63 passed | 1 skipped`; totals recomputed from the JSONL):

    2026-11-01b:  files 41, prismatic converted 36 refused 5, faceted converted 26 refused 15, prismatic faces 22569, prismatic facets 12565, prismatic ms 264862, faceted ms 107397, round trips failed 7
    2026-11-03:   files 41, prismatic converted 37 refused 4, faceted converted 26 refused 15, prismatic faces 24942, prismatic facets 14259, prismatic ms 232772, faceted ms 107193, round trips failed 7

The per-file table is in ADR-0097's 2026-11-03 amendment. OCCT WASM: the input hash went `3d788da00513` →
`1076701bd590`, published by CI 41686876602.

## Run 5 (2026-11-04): main combined, the half-turn cone, spool-screw's second attempt

Kernel-staged meshes (`MESH_OUT`) in `/tmp/m2s-unify/meshes/`, spike case `f` at Auto (`BUILD=build-unify`).

### Step 0: the combined sweep on main

`baseline-2026-11-04-main-auto.jsonl` against `baseline-2026-11-03-auto.jsonl`: 63 passed, 1 skipped.

    2026-11-03-touching-holes:  files 41, prismatic converted 36 refused 5, faceted converted 26 refused 15, prismatic faces 22570, prismatic facets 12565, prismatic ms 272785, faceted ms 108644, round trips failed 7
    2026-11-03 (D12):           files 41, prismatic converted 37 refused 4, faceted converted 26 refused 15, prismatic faces 24942, prismatic facets 14259, prismatic ms 232772, faceted ms 107193, round trips failed 7
    2026-11-04 main:            files 41, prismatic converted 37 refused 4, faceted converted 26 refused 15, prismatic faces 24943, prismatic facets 14259, prismatic ms 234451, faceted ms 107788, round trips failed 7

Files that differ from either baseline (touching-holes → D12 → main; "vol" is the 1e-4 volume rule failing, as before):

| file | faces | facets | round trip (read back valid, faces) | Auto step | ms |
|---|---|---|---|---|---|
| own/battery-power-adapter | 587 → 581 → 581 | 0 | yes 587 → yes 581 → yes 581 (vol) | 0.1 | 2830 → 2624 → 2643 |
| own/kuglbahn-pillar-base | 3882 → 3880 → 3880 | 3348 → 3346 → 3346 | yes | 0.1 | 11219 → 10337 → 10272 |
| own/phone-stand-foldable | 983 → 868 → 868 | 403 → 287 → 287 | yes (vol) | 0.1 | 4636 → 4244 → 4340 |
| own/spool-screw-v4.1 | 1421 → 1419 → 1419 | 256 | yes | 0.05 | 46531 → 44047 → 44223 |
| own/whiteboard-tray-v5 | refused → 2586 → 2586 | – → 1900 → 1900 | yes 2586 | 0.02 | 43400 → 13999 → 14142 |
| third-party/hot-wheels-connector | 2015 → 1928 → 1928 | 1833 → 1745 → 1745 | yes | 0.01 | 3039 → 1608 → 1624 |
| third-party/makita-vacuum-holder | 3337 → 3335 → 3336 | 2516 | no 3338 → no 3336 → no 3337 | 0.05 | 10023 → 8701 → 9487 |

main equals D12 except makita +1 face (the touching-holes cut); every difference from the touching-holes run is D12's.

### Slice 1: makita-vacuum-holder's half-turn cone

`Q26TOUCH=1 Q26NAMED=1 Q26CONE=1` (the probe now prints each face's surface handle, a closed edge's other pcurve, the
edge's mid point and handle; `Q26CONE=all` also every read-back cone face). Both cones, main's facade (edges with
`closed 1` only; the failing cone is the one at +x):

    q26 face written Cone orient 0 u -0.70981158..2.4318397 v 0.15321691..0.83177087 surface 0x13226c8          (−x, half A)
    q26 face written  edge orient 1 closed 1 tol 0.1953002 pc (2.4318397, 0.20620139) -> (-0.70981158, 0.15321691) other (2.4318397, 0.20620139) -> (5.5733737, 0.15321691) mid -66.19878,82.526672,33.698778
    q26 face written  edge orient 1 closed 1 tol 0.0062269628 pc (2.4318189, 0.5547165) -> (2.4318397, 0.20620139) other (2.4318189, 0.5547165) -> (2.4318397, 0.20620139)
    q26 face written Cone orient 0 u 2.4318189..5.5733867 surface 0x1325c98                                       (−x, half B: the same edges, closed 0)
    q26 face written Cone orient 0 u 0.70978098..3.8513799 v 0.15321827..0.83177617 surface 0x15a7928             (+x, half A)
    q26 face written  edge orient 0 closed 1 tol 0.006226585 pc (0.7097841, 0.55471508) -> (0.70978098, 0.20619996) other (6.9929694, 0.55471508) -> (6.9929663, 0.20619996)
    q26 face written  edge orient 0 closed 1 tol 0.19529508 pc (0.70978098, 0.20619996) -> (3.8513662, 0.15321827) other (6.9929663, 0.20619996) -> (3.8513662, 0.15321827) mid 66.19878,82.526672,33.698778
    q26 face written Cone orient 0 u 3.8513662..6.9929694 surface 0x15a92c0                                       (+x, half B)
    q26 back valid 0 faces 3337
    q26 face backall Cone u 0..6.2831853 v 0..0 status own27, one degenerated apex edge                           (the extra face, +x)

Each half has its own surface. The long edge (tolerance 0.195) is the mesh edge between the halves past the apex (its
mid point 0.051 mm from it); the short generatrix next to it is stored with two pcurves on the +x half A (2π apart)
and on the −x half A (equal). FACES=1: regions 402/405 and 845/846 (12 triangles each, "tolerance 0.1953" built).

Variants on makita (spike, Auto):

| variant | faces | cones | read back |
|---|---|---|---|
| main | 3336 | 8 | invalid, 3337 faces |
| `dropStaleSeams` (each edge a face uses once keeps only its own pcurve) | 3336 | 8 | invalid, 3337 faces |
| apex route, without the retry | 3364 | 5 | valid 3364 (a half failed alone and exploded: legs' orientation) |
| apex route, orientation fixed | 3350 | 5 | valid (region 36 failed with a route, exploded, mismatched edge: a second attempt, 28.9 s) |
| apex route, the region across must build too | 3344 | 5 | valid (region 36 still exploded: no retry without its routes) |
| apex route, a failed region retries without its routes (built) | 3334 | 6 | valid 3334, 8.8 s |

Synthetic cones (`pointedCone`, joined with `bossWithBump`, T 0.05, main's facade): with 32 sides at 0.01 mm no cone
(planes); a fan straight to the tip fits a sphere; with rings and the widest gap at +x the halves split on the edge
past the tip as makita's. Tip offsets (a, b) = (0.02, 0.15), (0.03, 0.2), (0.04, 0.06), (0.05, 0.2), (0.1, 0.3),
(0.15, 0.2): every one reads back valid on main (172 faces, 2 cones); with the route 171 faces, 1 cone. The test pins
the route; makita pins the round trip.

Sweep (`baseline-2026-11-04-half-cone-auto.jsonl` against main's, 63 passed, 1 skipped): only makita moves, 3336 →
3334 faces, round trip no → yes; `round trips failed 6`.

### Slice 2: spool-screw-v4.1's second attempt

A copy of the facade with prints after `stage("solid")` (regions 214 and 271 in the cells), after unify and after
healing (every face invalid alone or in the body, its regions, BRepCheck statuses, and per wire the (u, v) box of its
pcurves); `FACADE=` the copy, case `f`, Auto. Statuses: 22 `IntersectingWires`, 23 `InvalidImbricationOfWires`, 27
`UnorientableShape` (merged full-turn faces checked alone; valid in the body).

    P2 cells attempt 0 region 214 alone 1 wires 6
    P2W cells wire outer edges 94 u 5.4550..6.6922 v 24.3585..28.2387
    P2W cells wire inner edges 3 u 6.4641..6.4969 v 25.4641..25.9860      (and 6.5296.., 6.5949.., 5.5240.., 5.5232..)
    P2 cells attempt 0 region 271 alone 1 wires 2
    P2W cells wire outer edges 39 u 6.1639..6.3892 / inner edges 3 u 6.3346..6.3511
    P2 unified   face 260 type 2 alone 0 own[ 23] wires 6 edges 107 u 0.180964..6.69219 regions[ 214]
    P2W unified wire outer edges 92 u 5.4550..6.6922
    P2W unified wire inner edges 3 u 0.1810..0.2137                       (the three holes past 2π: −2π)
    P2 unified   face 429 type 1 alone 0 own[ 23] wires 2 u 0.0514616..6.3892 regions[ 271]
    P2 healed   face 260 type 2 alone 0 own[ 22] u 5.45496..6.69219       (holes back at 6.46.., IntersectingWires)
    P2 healed   face 429 type 1 alone 0 own[ 22] u 6.16386..6.3892
    P2 healed attempt 1 solid 0 valid 1                                    (the second attempt, both exploded)

The same on `bossWithRimDimple` (`rim-0.stl` below): the merged wall (regions 20 and 22) `own[ 23]` u −0.14..7.72 after
unify, `own[ 22]` after healing. Spike case `f`, main's facade against `rewrapHoles` (Q26=2 attempts; the boss with a
square dimple in its wall at 8 mm from the axis, turned by the angle; at the rim z 9.5, else z 8):

| mesh | main: attempts, faces, ms | with `rewrapHoles` |
|---|---|---|
| boss-0 (z 8) | 1, healed, 1644, 2524 | 1, not healed, 1644, 1354 |
| boss-15 (z 8) | 1, healed, 1644, 2190 | 1, not healed, 1644, 1109 |
| rim-0 | 2 (the first invalid after healing), 1645, 3944 | 1, 1645, 1366 |
| rim-45 | 2, 1645, 3827 | 1, 1645, 1342 |
| the other 14 angles | 1 | the same |

spool-screw-v4.1, stage times (ms) at Auto, spike:

| stage | main (two attempts, each) | `rewrapHoles` | and cuts in rounds |
|---|---|---|---|
| unified | 10783, 10688 | 10802 | 10853 |
| healed | 6223, 6266 | 6182 | 6193 |
| touching loops cut | 3143 (59 cuts) | 3228 (65) | 1529 (65) |
| total | 45630 | 25380 | 23763 |

The healer still runs once (the unified body has other faces with edges moved onto merged planes); the result is
1171 faces, 0 facets, read back valid with 1171.

Sweep (`baseline-2026-11-04-second-attempt-auto.jsonl` against the half-cone run, 63 passed, 1 skipped): only
spool-screw moves, 1419 → 1171 faces, 256 → 0 facets, 43270 → 23945 ms.

## Run 6 (2026-11-04): the volume-only round trips, makita's facets

Kernel-staged meshes (`MESH_OUT`) of the six files and makita-vacuum-holder; spike case `V` (new: one file converted,
written with the facade's `writeStep`, read back with its `readStep`, both measured several ways, then face by face)
at Auto, `BUILD=d13`.

### Slice 1: where the volume goes

Main's facade (`700b080c6fb2`), every integral of both bodies (fixed order, bounded 1e-7 / 1e-9, Gauss–Kronrod 1e-9)
gives the same ratio:

| file | written / read back (fixed) | ratio | the faces that differ |
|---|---|---|---|
| own/battery-power-adapter | 24505.713 / 24499.918 | 0.999764 | torus 154: area 37.486 → 38.044 (solid 1 only) |
| own/phone-stand-foldable | 11957.775 / 11952.660 | 0.999572 | 10 tori |
| own/spool-nut-v4.1 | 9893.972 / 9899.185 | 1.000527 | cone 175 (1146 edges): area 340.651 → 341.277 |
| third-party/micro-sd-keyring-inner | 942.716 / 942.095 | 0.999342 | 4 spheres: 1.680 → 3.345 each |
| third-party/spaghetti-measure | 16092.078 / 16094.963 | 1.000179 | sphere 109: 5.546 → 6.080 |
| third-party/gear-bearing-5 | 22265.831 / 22257.462 | 0.999624 | 18 spheres, 4 revolutions |

Planes, cylinders and facets match face by face to about 1e-9 in all six. `QVFACE=<i>` compares a face edge by edge
(the pcurves' images, in 3D and in (u, v), against each other and against the 3D curve):

    spool-nut-v4.1 face 175 (cone, a 0.785, full turn):
      written area fixed 340.650627, Green (du form) 340.650627
      back    area fixed 341.277363, Green (du form) 340.650627
      edge 185 (the seam line) uv written (9.21384597, 45.6800113)-(9.21384597, 47.3770676) back (9.21384597, 45.676923)-(…)
               vertex gap 0.00439 slide 0.00309      (the only edge of 3780 that slides)
      every other edge: pcurves 1e-11 apart
    battery-power-adapter face 154 (torus R 32.4 r 4.27):
      edge 12 len 4.765 images apart 0.088 written off 3d 0.111 back off 3d 0.075 uv apart 0.020
    micro-sd-keyring-inner face 22 (sphere r 1.385):
      edge 10 len 2.400 images apart 0.836 written off 3d 0.909 back off 3d 0.690 uv apart 0.628

`gap` is a vertex's distance from its 3D curve's end, `slide` how far its projection onto the curve lies from that end
(what a reader moves the end by). The written STEP has pcurves (7560 PCURVE entities for spool-nut) and
`UNCERTAINTY_MEASURE_WITH_UNIT(5.E-03)`. OCCT's reader (`StepToTopoDS_TranslateEdgeLoop`, `CheckPCurves` →
`XSAlgo_ShapeProcessor::CheckPCurve`, sources in the image under `/opencascade.js/deps/OCCT/src/`) drops every plane
pcurve, and re-tests the others with `FixSameParameter` at the uncertainty p, taking the projection where the
deviation exceeds min(1, 2p) and the projection strays less; a pcurve whose ends lie farther than p from the 3D
curve's is dropped and projected again.

The fix prototyped in the spike (`QVFIX=1`: the reader's deviation rule applied to the converted body before writing),
then in the facade (`pcurvesAsRead`, and the seam through its vertices):

| file | main | `QVFIX` | `QVFIX` + `QVENDS` (the end rule too) | facade |
|---|---|---|---|---|
| own/battery-power-adapter | 0.999764 | 1.0000003 (2 pcurves, 62 ms) | 1.0000000 (365, 353 ms) | 1.0000003 |
| own/phone-stand-foldable | 0.999572 | 0.999966 (232) | 0.999982 (545, 554 ms) | 0.999966 |
| own/spool-nut-v4.1 | 1.000527 | 1.000527 (0) | 1.000527 | 1.0000000 (seam) |
| third-party/micro-sd-keyring-inner | 0.999342 | 1.0000000 (4) | 1.0000000 | 1.0000000 |
| third-party/spaghetti-measure | 1.000179 | 1.0000000 (1) | 1.0000000 | 1.0000000 |
| third-party/gear-bearing-5 | 0.999624 | 0.999802 (68) | 0.999881 (2994, 1160 ms) | 0.999802 |
| third-party/makita-vacuum-holder | 0.999956 | 0.999998 (34) | 1.0000023 (1039) | 0.999998 |

Synthetic candidates on main's facade (each beside `bossWithBump`, hybrid): a 16-segment sphere with a box corner at
0.1 mm 1.0000000; **a 24-segment sphere with a box corner at 0.05 mm 1.00047** (233 faces, valid; the test); a sphere
with a small sphere on it, a coarse donut, a 12-sided torus with a box, a noisy cone band at 0.01: all within 2e-8.
With the facade's fix the 24-segment sphere reads back at 1.0000000.

Sweep: ADR-0097's 2026-11-04c amendment (round trips failed 6 → 1; no face or facet moves).

### Slice 2: makita-vacuum-holder's facets

Spike case `f` at Auto with `Q26=1` (exploded regions), `Q25=1 Q25ONLY=1` (unfit bands) and `UNFIT=1` at 0.05 (the
unfit surfaces), the kernel-staged mesh:

    rebuild hybrid, facets 2516, tolerance 0.05, exploded 23, pl/cy/co/sp/to 557/237/6/12/6
    unfit surface 641: 1481 regions, 3106 triangles, 1815 nodes, area 707.59 (1.4491 %), thinnest triangle 0.10283, longest edge 14.07, dev 3.0492
    q25 step 0.05: unfit share 1.4491 % (1 surfaces, 3106 triangles), bands 1301; pass unfit 0 bands / 0 tris
    q25 band T 0.05 unfit surface 641 tris 3106 … class ff? test coverage cover 0.1562 … dev/T p50 217.2 … pass 0
    q25 band T 0.05 sub surface 641 tris 229 … class ff? test coverage cover 0.1389 … dev/T p50 7.353 p75 10.95 … pass 0
    q25 band T 0.05 sub surface 641 tris 87 … class ff? test coverage cover 0.1795 … dev/T p50 4.505 p75 6.33 … pass 0

Exploded regions (`q26 region`, by kind and reason): cone "edge tolerance" 18 regions / 312 triangles (1.18–3.53 mm),
torus "edge tolerance" 4 / 96 (1.36–4.25 mm), plane "its outer loop runs the wrong way" 1 / 16.

With the chord's image as pcurve (a copy of the facade, `FACADE=`), the same run: cone "edge tolerance" 18 / 312
(1.18–3.42 mm), torus 2 / 62, plane 1 / 16; makita 3306 faces, 2486 facets. Spike case `V`, the same build, against
2026-11-04c's (round-trip ratio):

| file | 2026-11-04c | chord images |
|---|---|---|
| third-party/makita-vacuum-holder | 3334 / 2516, 0.999998 | 3306 / 2486, 0.999997 |
| third-party/micro-sd-keyring-inner | 66 / 18, 1 | 51 / 3, 1 |
| third-party/gear-bearing-5 | 0.999802 | 0.999921 |
| own/phone-stand-foldable | 0.999966 | 0.999989 |
| synthetic: 8-segment ball r 2, box corner, `bossWithBump`, 0.05 | 120 faces, 1.00035 | 120 faces, 1.0000004 |

Synthetic candidates that changed nothing (no region exploded for edge tolerance in either build): coarse tori 8 × 8
(R 10, r 1.5) and 12 × 6 (R 12, r 1), a 12-segment sphere's pole under a box, a twisted 16-sided cone band, a plate
with a 12-sided hole, each at 0.05 and 0.1 mm.

Sweep: ADR-0097's 2026-11-04d amendment (facets 14,003 → 13,958, round trips failed 1 → 0).

### Review: gardena-end with the chord images

Spike case `D` (new: each face's BRepGProp and triangulated area at deflection 0.005, the mesh nodes' distance to the
body, each face's triangulation nodes' distance to the mesh triangles), gardena-end at Auto (T 0.01), 2026-11-04c's
facade against the 17-point images:

| face | surface | BRepGProp area 04c → 04d | triangulated area 04c → 04d |
|---|---|---|---|
| 0 | torus | 613.750 → 616.442 | 616.283 → 616.283 |
| 8 | cone | 46.342 → 46.262 | 46.353 → 46.355 |
| 11 | torus | 184.909 → 181.978 | 181.945 → 181.946 |
| 13 | sphere | 74.653 → 74.941 | 75.102 → 75.103 |
| 14 | torus | 104.181 → 105.337 | 105.333 → 105.528 |

    04c: volume 13102.5488 (mesh 13060.2678, 1.00323738), triangulated 13120.2411; nodes to body max 0.00728673 mean 7.967e-05; faces to mesh max 0.0853445 mean 0.0205110
    04d: volume 13130.0358 (1.00534201),                  triangulated 13120.4241; nodes to body max 0.00728673 mean 7.967e-05; faces to mesh max 0.0853445 mean 0.0204570

`chordPcurve` (a probe copy printing each call): 884 calls (torus 488, cylinder 154, cone 122, sphere 120), 594
replaced, the straight pcurve's stray 0.0217–0.0513 mm, the image's at most 0.0482. Stage times (`TIMES=1`, load
under 1, two runs each, ms, 04c → 04d): hybrid faces 41 → 113 and 30 → 87, hybrid solid 78 → 400 and 73 → 409, hybrid
unified 65 → 94 and 81 → 342, healed 180 → 264, checked against the mesh 83 → 438; face classifiers built in 3.0 →
20.2 ms, classifying 58 → 277 ms.

Narrowings (spike, round-trip ratio, faces / facets):

| variant | gardena-end | makita | micro-sd-keyring-inner | gear-bearing-5 | phone-stand-foldable |
|---|---|---|---|---|---|
| 17 points, stray > 1.5 T (04d) | 594 replaced, 1.000013 | 3306 / 2486 | 51 / 3 | 0.999921 | 868 / 287 |
| stray > 10 T | 0 replaced, 1.000012 | 3306 / 2486 | 51 / 3 | 0.999802 (fails) | 868 / 287 |
| only with a facet across | 0 replaced | 3334 / 2516 | 79 / 18 | 0.999838 (fails) | 961 / 381 |
| 3 points | 1.000014 | 3306 / 2486 | 51 / 3 | 0.999920 | 868 / 287 |

gear-bearing-5's replacements stray 1.5–6.0 T, gardena-end's 2.2–5.1 T; the image's gain (its stray over the straight
one's) overlaps too (micro-sd 0.59–1.0, gardena-end from 0.006). Whole conversions of gardena-end (case `D`, two runs,
load under 2): 04c 3843 / 3950 ms, 17 points 5494 / 5532, 3 points 4037 / 4030. Sweep: ADR-0097's 2026-11-04d
amendment, "Review".

## Run 7 (2026-11-04): makita-vacuum-holder's fillet network and cone fits

The kernel-staged mesh (`/tmp/m2s-rest/mesh/`, the same as Run 6's) at T 0.05, spike case `f` with the new `DUMP`
probe (the segmentation as text, README "The segmentation as text"), numpy on the dump; then `SPLIT`/`SEED` prints in
a facade copy (`FACADE=`), not committed.

### Diagnosis

Main's segmentation: 835 surfaces (558 planes, 232 cylinders, 24 cones, 12 spheres, 8 tori, 1 unfit). The cup:
the inner wall is a drafted cone (facet normals at z 0.099, 5.7°) cut into 2.2° facets of two triangles each (70 mm²);
the outer wall is a cylinder r 67.49 in 2° facets; the top is the plane z 35; the front slot runs from about −128° to
−52° with r 15 corner cylinders.

| what | triangles | where it lies |
|---|---|---|
| unfit surface 641 (1,481 regions, 707.6 mm²), rim part | 1,801 (579.8 mm²) | one torus, nodes within 0.0000 mm: axis Z through the origin, R 59.31, tube centre z 33, r 2 |
| unfit surface 641, the rest | 654 + 651 | the slot's two top corners, z 7–35: r 2 blends between the drafted inner wall and the slot's r 15 corner cylinders (the ball centres form one smooth curve) |
| cones 311–324 (half-angles 88.6–89.3°), spheres 320–321, planes 333–362 | 216 + 36 + 83 | the rim torus's top rows, nodes 0.0000 off |
| cones 326–330 | 89 | the bottom inner round: R 56.21, z 2, r 2, 0.0000 off |
| cones 294, 297, torus 299 | 52 | the left side plate's round, the mirror of torus 291 (R 107.69, r 2): 0.026, 0.002, 0.002 off |

`SPLIT` on 641 (1,481 regions): 178 seeds; 38 large seeds became planes; the others' patches (6–10 regions, one
column of the round) fitted cylinders first (100 pieces) and planes; one leftover component of 6 regions (3.165 mm²)
made the split return the whole component unfit. The facade's torus fit can't fix the axis on a strip: the flatness
of g − ρn has its minimum at the sampling bound (ρ −100) on 4° of the ring, an axis 16° off on 10°, the right one on
30°. A trimmed fit over all of 641 (flatness estimate and circle, keep the triangles within max(T, 60th percentile),
refit) reaches the rim torus in 5 iterations: 1,803 triangles within T.

### Variants (spike `F` over the 38 staged meshes, Auto; main gives the sweep baseline's totals exactly)

| variant | makita faces / facets | corpus faces / facets | what went wrong |
|---|---|---|---|
| main | 3306 / 2486 | 24,650 / 13,958 | |
| E1: every kind that holds a seed patch grows, the largest wins | 878 / 32 | 20,821 / 11,384, ms +23 % | facets up on 5 files (phone-stand-foldable 287 → 387, spaghetti-measure 36 → 106, spool-screw-v4.1 0 → 104, puzzle-insert-circle 0 → 36, battery-power-adapter 0 → 24); the rim 151 small faces |
| E1 + merging adjacent pieces one surface holds | 722 / 32 | | the rim still 72 cylinders |
| V1: a split whose leftovers hold ≤ 10 % stands | 1211 / 219 | (stopped) | Auto 0.1 → 0.01 on phone-stand-foldable (287 → 2,098 facets), battery-power-adapter 0 → 1,050 |
| V1 + merging | 877 / 157 | | volume 0.999669 |
| VAB2: V1 + dominant torus (trimmed, no Gauss–Newton) + every torus absorbs | 1210 / 466 | | 311-region component left whole and unfit (19 % leftover after the torus) |
| VAB4: leftover rule only with a dominant piece, retry without the torus | 907 / 128 | (partial) | hole-filler-35mm 6 → 703 faces, peg-perego-button 0 → 1,068 facets (absorb took a plane); Auto finer on phone-stand-foldable and spool-screw-v4.1 |
| VAB5: only a dominant torus absorbs, never a plane | 950 / 128 | (partial) | Auto still finer |
| VAB6: the Auto ladder without the new rules | 950 / 128 | 21,345 / 11,164, ms −3 % | track-straight-100mm: a torus through nodes only (centroids 0.61 mm off at T 0.01), 440 ms → 9.2 s |
| VAB8: VAB6, the strict refit or nothing | 3283 / 2486 | | the rim's refit fails: no torus |
| VAB9: VAB6 + centroids within T (rules 1 and 4): **built** | 950 / 128 | 21,426 / 11,132, ms −7 % | shower-holder and vented-funnel keep main's result (VAB6 had 870 → 730 and 632 → 568 faces) |

Case `D` (spike, body against mesh), main → VAB6:

| file, T | nodes to body max / mean | faces to mesh max / mean | volume ratio |
|---|---|---|---|
| own/track-straight-100mm, 0.01 | 8.4e-5 / 7.8e-6 → 9.9e-4 / 8.2e-5 | 0.0060 / 0.0013 → 0.694 / 0.218 | 1.00004 → 1.00143 |
| own/battery-power-adapter, 0.1 | 0.1179 / 0.0107 → 0.1179 / 0.0104 | 0.1185 / 0.0046 → 0.1185 / 0.0084 | 0.99781 → 0.99716 |

Triangle centroids' distance from each torus over 40 triangles (VAB6 dumps): makita's 291, 541, 606 (the rim) and
758 at most 0.036, 0.033, 0.038, 0.042 (T 0.05); battery-power-adapter's ten at most 0.081 (T 0.1);
track-straight-100mm's R 26.57 torus 0.611 (T 0.01), its two R 20.20 tori 0.005.

makita at VAB6: 950 faces, 128 facets: 6 cones and 2 tori explode for edge tolerance, 1 plane for its outer loop, 2
small unfit pieces (40 triangles). Of the 2,369 triangles above z 32.9 within T of the rim torus, one torus face holds
1,986, the top plane 252, and 20 small planes and a cylinder the rest; volume 378,824 against the mesh's 378,824.

VAB9 against main, the files that change (spike `F`, Auto; volume ratio body / mesh):

| file | faces | facets | volume ratio | ms | Auto step |
|---|---|---|---|---|---|
| own/battery-power-adapter | 581 → 512 | 0 → 0 | 0.997812 → 0.997161 | 3099 → 2587 | 0.1 |
| own/kuglbahn-pillar-base | 3880 → 3559 | 3346 → 3346 | 1.00118 → 0.999514 | 13200 → 10190 | 0.1 |
| own/peg-perego-button | 212 → 160 | 0 → 0 | 1.00293 → 1.00295 | 1596 → 1191 | 0.02 |
| own/phone-stand-foldable | 868 → 862 | 287 → 287 | 0.998266 → 1.00004 | 5022 → 4768 | 0.1 |
| own/track-straight-100mm | 306 → 101 | 237 → 0 (the exact stage now holds) | 1.00004 → 1.00000 | 440 → 1073 | 0.01 |
| own/whiteboard-tray-v5 | 2586 → 2547 | 1900 → 1865 | 1.00006 → 1.00005 | 15725 → 14466 | 0.02 |
| third-party/hot-wheels-connector | 1928 → 1752 | 1745 → 1549 | 0.999856 → 0.999857 | 2041 → 1824 | 0.01 |
| third-party/makita-vacuum-holder | 3306 → 950 | 2486 → 128 | 0.999861 → 1.000000 | 10945 → 6590 | 0.05 |
| **totals (38 files)** | 24,650 → 21,426 | 13,958 → 11,132 | | 225,174 → 209,650 | |

The kernel sweep, the round trips and case `D` on every changed file follow in the implementation slice.
