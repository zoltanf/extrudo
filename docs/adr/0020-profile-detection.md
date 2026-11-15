# ADR-0020: Sketch profile detection

- **Status:** Accepted, 2026-09-27
- **Task:** P1-11 (profile detection; FR-SK-11). Code: the arrangement in
  `packages/sketch/src/profiles/profiles.ts` (entry
  `@extrudo/sketch/profiles`: `detectProfiles`, `profileAt`); the reference
  ID helpers `profileRefId`/`parseProfileRefId` in
  `packages/core/src/sketch/feature.ts`; in the app, the per-version cache
  `apps/web/src/sketch/profiles.ts`, the fills in
  `apps/web/src/viewport/Sketches.tsx` (`profileTriangles` in
  `sketchGeometry.ts`), picking in `sketch/tools/host.ts` (`pickItem`), the
  palette toggle and the properties panel's readout in `sketch/panels.tsx`.
- **Builds on:** ADR-0010 (sketch model: curves share no points), ADR-0012
  (intersection helpers in `inference/geometry.ts`), ADR-0014 (ellipse and
  spline polylines), ADR-0018 (selection with no tool running).
- **Affects:** P2 extrude (picks profiles by these IDs; the kernel builds
  the authoritative faces), P1-13 (export of profiles), P2-04 (topological
  naming of profiles).

## Context

FR-SK-11 asks for automatic closed-profile detection with nested regions
(holes), shaded and selectable. Architecture §5.3 planned a fast
TypeScript planar arrangement for instant feedback, with OCCT's
`BOPAlgo_Builder` making the authoritative faces later, and region IDs
derived from their bounding curve IDs. Our sketch model makes this harder
than a shared-vertex model: curves never share points, a coincident
constraint joins them, so where ends meet is only known by position.
Users also draw overlapping shapes (two rectangles, two circles) and
expect every piece of the plane between the curves to be a region, as is
usual in CAD.

## Decision

1. **Exact curves, one tolerance.** Lines, arcs and circles are cut
   exactly (`intersectCurves`), ellipses and splines as their polylines
   (the curve the viewport draws). Cuts come from crossings, tangent
   contacts and T-junctions (an end within tolerance of another curve).
   Positions within `PROFILE_TOLERANCE` = 0.1 µm are one vertex (a hash
   grid). Overlapping pieces (collinear lines, arcs on one circle) keep the
   lowest curve ID's. Construction geometry and points never bound anything.
2. **Half-edge face tracing.** Dangling pieces are pruned, then faces are
   traced with the face on the left; around a vertex, edges are ordered by
   direction and, when two leave the same way (tangent curves), by signed
   curvature. Bridges (a piece with the same face on both sides, such as a
   line joining a hole to its outline) are removed and the tracing repeats,
   so a joined hole stays a hole.
3. **Nesting by groups.** Counter-clockwise cycles are regions; each
   connected group of curves has one clockwise cycle, its outline, which
   becomes a hole of the smallest region of another group containing it.
   A region inside another is both a hole of the outer and a region of its
   own (other CAD tools do the same; the extrude picks which).
4. **Exact areas, fine polygons.** Areas come from Green's theorem per
   piece (exact for lines and arcs). Loops also carry polygons, sampled so
   a chord is within 1 µm of its arc (at least 96 per circle, at most
   2048); containment (nesting, `profileAt`) uses them.
5. **Stable IDs.** A region's ID hashes (cyrb53, base 36) the sorted set of
   `curve+`/`curve−` along its outer loop: which curves bound it and in
   which direction. Direction tells apart the three regions of two
   overlapping circles. Holes aren't part of the ID, so adding a hole keeps
   the plate's ID. Moving or resizing geometry, adding unrelated curves and
   storing entities in another order keep IDs. Rare duplicates (a spline
   weaving across a line) get a `#n` suffix by centroid position before
   hashing. A selection or reference names a profile as
   `<sketch feature ID>/<region ID>` (`profileRefId`).
6. **In the app.** Profiles are detected once per version of a sketch's
   content (a `WeakMap` keyed by the immutable `SketchData`), for every
   drawn sketch while the palette's **Show profiles** is on (a viewport
   preference, default on). Fills are `profile-fill` (brand §3.4: sketch
   blue at 14 %/12 %, a new `--x-profile-fill` token), triangulated with
   holes (three's `ShapeUtils`), under the curves and not raycast. With no
   tool running, where no entity is under the pointer, the host hovers and
   selects the profile there (kind `profile`; Shift/Ctrl toggles); the
   hovered fill is the accent at 22 %, selected at 40 % (the brand's 45 %
   and 90 % are for curves and edges; on a large fill they hide the
   geometry). The properties panel shows the selected profiles' area and
   hole count. E2E tests read `data-sketch-profiles` ("profiles=2
   holes=1") on the Viewport region and `data-selected-profiles` /
   `data-hover-profile` on the selection overlay.

## Consequences

- Detection runs on every change, drags included: about 6 ms for a
  24-tooth gear (97 curves), 16 ms for 48 teeth, 18 ms for 50 plate cells
  (450 curves, 150 regions). Pairs are tested all against all with a
  bounding-box reject; a sweep or grid would help past ~500 curves.
- Profiles are picked only in sketch mode for now: model-mode picking
  needs a ray per sketch plane and arrives with Extrude (P2), which also
  gets the loops' curve pieces (`edges`: curve, direction, points) to
  build wires from.
- Ellipse and spline areas are their polylines' (0.1 % off for a 96-segment
  ellipse), which is fine for display and picking; the kernel's faces will
  be exact.

## Rejected

- **Everything as polylines.** Simple, but tangent circles become chords
  that cross near the contact and make sliver regions, and T-junctions on
  arcs miss by the sagitta. Exact lines and arcs avoid both.
- **Joining ends through coincident constraints instead of positions.**
  It misses crossings and T-junctions, which have no constraint, and an
  unsolved sketch (before the solver loads) would lose its regions.
- **Waiting for OCCT faces.** The kernel isn't in the sketch loop (it runs
  in the worker, asynchronously) and hover must follow the pointer.
- **Region IDs from the ordered list of pieces.** Changes whenever a new
  curve touches the loop elsewhere (a piece splits), and depends on where
  tracing started. The set of (curve, direction) is coarser and steadier.
- **Hole curves in the ID.** Adding or removing a hole would rename the
  plate, breaking an extrude of it.
- **The brand's 45 %/90 % accent for profile hover/selection.** Too heavy on
  a filled area; the curves on top vanish.

## Open

- Model-mode profile picking and the kernel's authoritative faces (P2).
- A sketch with thousands of curves would want a sweep-line intersection
  pass.
- Polygon containment is exact to about 1 µm; two separate curve groups
  closer than that could nest wrongly.

## Amendment 2026-11-10: the pair search

**What.** `cutSegments` tested every pair of segments for a crossing. A
sketch's ellipses and splines are polylines (16 segments per spline pole),
so two crossing splines of 2,000 poles (64,000 segments, two billion pairs)
took 66 s, and the f3d import met such sketches. Now, from 32 segments on,
`nearPairsWithin` (`packages/sketch/src/profiles/pairs.ts`) puts the
segments' boxes in a grid and yields only the pairs whose boxes meet; below
32, every pair is tested as before. Three more spots went too: the
segments were gathered with a spread (`push(...)`), which throws a
RangeError past about 120,000 segments (a spline of 8,000 poles); the hole
search ran `insidePolygon` for every outline against every region (1,000
separate circles took 0.9 s, 5,000 took 28 s); `profileIds` copied each key's list for every
region (k regions sharing a key cost k²).

**The output must not change.** Region IDs are stored in designs, so the
regions, their order, keys, IDs and every coordinate stay bit for bit as
they were. Rules for any change here:

- The grid only **leaves out pairs whose boxes are apart**; every pair it
  yields goes through the same `overlap` test (0.1 µm) and the same cut code
  (`cutPair`) as before. Its boxes are widened by twice that tolerance, so
  rounding can't make it drop a pair `overlap` would keep. A sketch with a
  box that isn't finite (beyond ±1e300 or NaN) tests every pair.
- Pairs come **in the order of the all-pairs loop** (`i` ascending, then
  `j`): a segment's cuts are pushed in the same order, and equal cuts (a
  `-0`, a `NaN` from a degenerate curve) sort the same way.
- The hole search skips a region only when the probe is outside its
  polygon's box: above or below it (exact: no edge straddles the row), or
  sideways by more than 1e-9 × the box's coordinates (every straddling edge
  is crossed or none is, and a closed polygon has an even number). A NaN box
  never skips. The boxes are made only when there are several outlines.
- `detectProfilesAllPairs` is the reference: `pairs.test.ts` compares it
  with `detectProfiles` on 250 seeded random sketches (lines, arcs, circles,
  open and closed splines on a coarse lattice, so they cross, touch, overlap
  and share ends) with `toStrictEqual`, and `nearPairsWithin` with a test of
  every pair on 300 random box sets (clustered, degenerate, long and thin).

**The grid.** The cell's side is the median of the boxes' larger sides, so a
segment covers a few cells whatever the sketch's extent (a dense spline in a
large plate); a box covering more than 16 cells (a long line among short
spline segments) stays out of the grid and is a candidate of every box.
Cells live in a `Map` keyed by `row × columns + column` (at most 2²⁰ per
side). Within a cell the list ascends, so a binary search skips to `j > i`;
the box test comes before the sort.

**Numbers** (Ubuntu machine, Node 24). Two crossing splines of 500 / 2,000 /
20,000 poles: 1.8 s / 66.5 s / RangeError before; 0.25 s / 0.83 s / 10.3 s
now (the last is linear work on 640,000 segments: vertices, pieces, loops).
1,000 / 5,000 separate circles: 0.9 s / 28.5 s before; 57 ms / 0.35 s now.
1,045 sketches of 310 designs (an f3d corpus and the repository's
fixtures): the same output bit for bit (a digest of the whole output per
sketch), the whole Vitest suite run with every `detectProfiles` call
checked against the reference (7,332 sketches) the same; per-sketch time
median 0.209 → 0.211 ms (within noise either way round), sketches of 5–20
curves median ratio 1.00, sum over all sketches 7.9 s → 3.2 s, the dearest
1.25 s → 0.55 s.

**Still unbounded:** the output itself. n lines that all cross each other
make about n²/2 regions: 1,000 lines 0.49 million regions in 10 s (11 s before) and 2 GB,
2,000 lines 2 million regions in 60 s and 7.3 GB; 5,000 would need about
12 million regions and some 45 GB. No limit was added (the largest sketch of
the census has 456 regions); a limit is an open question below.

**Tried and dropped.** Sharing the f3d import's grid (`nearPairs` in
`packages/f3d/src/regions.ts`, ADR-0083): it is sized by the two curves'
common extent with at most 1,024 cells a side, which on one long thin sketch
put about a thousand candidates in each cell (two 20,000-pole splines spent
5 s in it), breaks down the same way on a dense curve inside a large
outline, and charges the import's work budget, whose verdicts must not
move. A sweep on x: quadratic on a hatch of parallel lines.

**Open.** (Done in the amendment of 2026-11-15.) A limit for sketches whose regions run into the millions (refuse
past a number of pieces, with a message on the sketch, and the kernel
refusing the same way).

## Amendment 2026-11-15: the crossing limit

**What.** The amendment of 2026-11-10 left the output unbounded: n lines
that all cross make about n²/2 regions, and a design, a pasted sketch or an
import with some thousand of them froze the tab or ran it out of memory
(1,000 lines: 494,000 regions, 10.8 s, 1.6 GB; 2,000 lines: 2 million
regions, 66 s, 6.5 GB), and the kernel's face build after it took longer
still. Now `detectProfiles` counts the **cuts inside curves** while it cuts
(`cutPair`) and throws `TooManyCrossingsError` as soon as there are more
than **`MAX_PROFILE_CUTS` = 100,000**. A crossing of two curves makes two
such cuts (one in each), an end of one curve on another makes one, and
curves that meet end to end make none (a cut within `PROFILE_TOLERANCE` of
a segment's end doesn't count; on a circle every cut counts). In plain
words: **about 50,000 crossings**.

**Why this quantity.** It is known before the work that grows with the
output (pieces, vertices, faces, loops, IDs) and predicts it: every piece
of the arrangement is a segment or a piece cut off by one of these cuts, so
there are at most segments + cuts pieces, and the regions are fewer still.
Measured on the Ubuntu machine (Node 24, `detectProfiles` alone, peak RSS
of the process, which starts at about 115 MB), the cost per cut is the
same whatever crosses:

| sketch | cuts inside curves | regions | time | peak RSS |
|---|---|---|---|---|
| 300 chords all crossing | 88,888 | 44,145 | 0.82 s | 415 MB |
| 450 chords | 200,244 | 99,673 | 1.9 s | 497 MB |
| 1,000 chords | 989,880 | 493,941 | 10.8 s | 1.6 GB |
| 2,000 chords | 3,961,710 | 1,970,928 | 66 s | 6.5 GB |
| grid of 200 × 200 lines | 79,998 | 39,601 | 0.85 s | 371 MB |
| grid of 300 × 300 | 179,998 | 89,401 | 2.0 s | 492 MB |
| 200 circles all crossing | 79,600 | 39,801 | 0.80 s | 403 MB |
| 300 circles | 179,400 | 89,701 | 1.8 s | 598 MB |
| 200 fit splines weaving (22,400 segments) | 102,874 | 51,192 | 1.6 s | 460 MB |
| 400 such splines | 413,204 | 205,989 | 6.2 s | 1.2 GB |

The alternatives: the crossing points `intersectCurves` finds count the
joints of every spline's and text's polyline too (two crossing splines of
20,000 poles find 680,000 and have 84 cuts inside curves); the pieces are
known only after all the cutting, too late to stop early; the regions
later still. Time or memory measurements were never an option: the same
sketch must give the same answer on every machine, in the worker and in
the app.

**Why 100,000.** Far above real use: the largest real sketch seen (1,045
sketches of imported and example designs) has 456 regions. Counted in this
repository: its fixture designs have no cut inside a curve at all; the
8,959 detections of the whole Vitest suite (templates, examples, imports,
fuzzing) have at most 40, apart from the profile tests' own stress
sketches (random sketches up to 784, a 10,000-pole spline across a line
6,730) and the FreeCAD import's worst case (125,000, below); text has
none worth counting (a glyph's outline meets itself end to end: 1,223
segments, 0 cuts inside curves). At the limit a sketch has up to about
50,000 regions, a hundred times the largest real one. Low enough: right at
it `detectProfiles` takes about a second and 300 MB more than before the
call (318 chords: 49,622 regions, 1.0 s; a 223 × 223 grid: 99,456 cuts,
49,284 regions, 0.92 s, 283 MB; 224 crossing circles: 99,904 cuts, 0.93 s,
313 MB); one chord, line or circle more is refused in 40–65 ms.

**Early and the same everywhere.** The count is checked after each pair, so
a refused sketch costs the pairs up to the limit and no more: 100,000 lines
that all cross (5 billion pairs and crossings) are refused after about
50,000 pairs (`limit.test.ts` counts the `intersectCurves` calls), in
0.43 s and 215 MB, most of both for the 100,000 segments and their grid;
2,000 lines in 84 ms. What is left is linear in the curves: 1,000 weaving
splines (112,000 segments) are refused in 0.47 s, 5,000 (560,000) in 1.3 s. The
total doesn't depend on the order the pairs come in, so the grid's pairs
and every pair agree. The one constant serves the app and the kernel, so
they never disagree on whether a sketch has regions:

- **The app** (`apps/web/src/sketch/profiles.ts`): `sketchProfiles` gives
  no profiles for such a sketch (no fills, nothing to pick) and
  `sketchProfilesRefused` says so; the sketch palette shows
  `TOO_MANY_CROSSINGS` ("This sketch has too many curve crossings to find
  its profiles. Remove or simplify curves.") under the DOF counter, the way
  the counter shows an over-constrained sketch. It is asked only while
  **Show profiles** is on: then the fills' cached detection answers it.
- **The kernel's sketch feature** detects the regions *before* its face
  build (`planarFaces`) and on a refusal makes no faces at all: the sketch
  ends with a warning (the same text, in the timeline), no `profiles`, and
  `tooManyCrossings: true` in its output; its curves, points and lines are
  there as before (paths, holes, revolve axes, projections still work). A
  feature that picked one of its profiles (`profilePart`, a whole text in
  `textParts`, the OpenSCAD export's `sketchOutput`) fails with
  `TOO_MANY_CROSSINGS_TO_PICK` ("Its sketch has too many curve crossings to
  find its profiles. Remove or simplify curves in the sketch.") instead of
  "Can't find one of its profiles any more".
- **The API**: `SketchHandle.regions` (and so `profiles()`, `profileAt`,
  `profilesInside`) throws an `ApiError` with the same message, its `cause`
  the `TooManyCrossingsError`, as its other refusals do; the script emitter
  names such a sketch's profiles by ID (`design.ref`) instead of by a point
  inside. The app's agent tools (`agent/tools.ts`) describe such a sketch
  with no profiles or regions and the reason as `problem`.
- **The importers**: the f3d import's `selectProfiles` gives its own
  `TOO_MANY_CROSSINGS` reason (its work budget `MAX_PIECE_WORK` is
  unchanged), the FreeCAD import's `profileRefs` the same words; both skip
  the feature with that reason, as before for their own budgets
  (`isTooManyCrossings` knows the error behind an `ApiError`). The FreeCAD
  import's worst case at its curve cap, a grid of 250 × 250 lines
  (125,000 cuts), was refused after the detection by its region cap; it is
  now refused while it is cut.
- **Templates** call `detectProfiles` on sketches of their own, far below
  the limit; a refusal there would be a bug and throws.

No file-format change: the sketch is stored as before and stays editable;
deleting curves until it is under the limit brings its regions and the
features on them back.

**Under the limit nothing changes.** The cuts are pushed exactly as before
(the parameters computed once, then pushed in the same order); only the
count is new. `limit.test.ts` holds a digest of the whole output of six
sketches (plate, gear, grid, chords, crossing circles, weaving splines)
recorded on the code before the limit. The whole Vitest suite's sketches
(1,349 distinct ones, saved while the suite ran on the code before the
limit) went through the code before and after: a digest of the whole
output is the same for all 1,348 under the limit, and the one refused is
the FreeCAD grid above. The count costs nothing measurable: per sketch,
interleaved, median of 7 runs, the median time went 0.061 → 0.063 ms, the
median ratio 1.002 (10th–90th percentile 0.92–1.10), and 0.993 with the
order swapped.

**The kernel at the limit.** Its face build costs more per region than the
detection (`planarFaces` + `profileFaceIds` in Node, same machine): 300
chords (44,145 faces) 13.6 s and 600 MB; a 200 × 200 grid (39,601) 11.6 s;
100 crossing circles (9,901) 9.6 s; 100 weaving splines (12,657) 41 s,
1,990 regions found only in the finer second run. So a sketch right under
the limit can keep the worker busy for tens of seconds to minutes (it is
in the worker: the app stays responsive, and the recompute can be
cancelled). A lower limit would bound that too; 100,000 was kept for the
detection's budget of about a second (an open question for the owner).

**Considered and dropped.** A time or memory budget (not deterministic).
Counting the pieces after the cutting (too late: the cutting itself is the
quadratic part on a refused sketch). A limit on the curves or segments
(refuses a long spline or a line of text that costs little). A separate
cheap check before `detectProfiles` (it would repeat the cutting; the
detection's own cutting stops just as early). A result with a reason
instead of a throw (every caller would change; with a typed error only the
callers that must go on catch it, and the rest fail loudly).

**Still not bounded.** Work that grows without crossings: boxes that
overlap without crossing (10,000 concentric circles: 50 million pairs,
16.5 s, no cut inside a curve), and the linear work of a huge polyline (two
crossing splines of 20,000 poles: 640,000 segments, 11.7 s, 2.4 GB).
