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
  box that isn't finite (beyond ±1e300 or NaN) tests every pair (replaced on
  2026-11-15: a NaN box stays out of the grid, a box past
  `MAX_PROFILE_COORDINATE` is refused).
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
(`cutPair`) and throws `ProfilesRefusedError` as soon as there are more
than **`MAX_PROFILE_CUTS` = 20,000**. A crossing of two curves makes two
such cuts (one in each), an end of one curve on another makes one, and
curves that meet end to end make none (a cut within `PROFILE_TOLERANCE` of
a segment's end doesn't count; on a circle every cut counts). In plain
words: **about 10,000 crossings**.

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

**Why 20,000.** It was first set at 100,000, the most that keeps the
detection around a second; the owner lowered it to 20,000 after counting
real sketches, because the kernel's face build right under the limit
costs far more than the detection (below), and real sketches stay far
below either.

- **Real sketches.** All 1,017 sketches of the 252 designs of an f3d
  corpus (imported, then counted with the limit lifted): at most 236 cuts
  inside curves; 99.9th percentile 204, 99th 158, median 6, 410 with none;
  none above 1,000. The sketch with the most regions (456) has none: 1,824
  lines in separate loops. Text sketches (39) at most 36. The repository's
  fixture designs, examples and wall-bracket template: none at all. The
  8,959 detections of the whole Vitest suite (templates, examples, imports,
  fuzzing) have at most 40, apart from the profile tests' own stress
  sketches (random sketches up to 784, a 10,000-pole spline across a line
  6,730) and the FreeCAD import's worst case (125,000, below). So 20,000
  is 85 times the largest real sketch.
- **Right under the limit** `detectProfiles` takes 0.3–0.6 s and up to
  150 MB more than before the call: 142 chords (19,840 cuts, 9,779
  regions) 0.29 s, 83 MB; a 100 × 100 grid (19,998 cuts) 0.32 s, 87 MB;
  100 crossing circles (19,800) 0.27 s, 89 MB; 88 weaving splines
  (19,751, 9,856 segments) 0.56 s, 145 MB. Just over it, a sketch is
  refused in 17–39 ms (lines, grid, circles) and 142 ms (splines, whose
  polylines are most of it).
- **The kernel right under the limit** (`planarFaces` + `profileFaceIds`,
  in Node): the 142 chords 3.1 s and 304 MB of process (186 before), the
  100 circles 9.8 s and 356 MB, the 88 splines 32 s and 435 MB, plus a
  second run of about as long for the 1,286 regions only the finer fuzzy
  value finds (ADR-0025's amendment of 2026-11-09). Under a limit of
  50,000 the same took 8.0 s, 32 s (and a second run) and 88 s (and a
  second run); under 100,000 about 15 s, 50 s and minutes.

**Early and the same everywhere.** The count is checked after each pair, so
a refused sketch costs the pairs up to the limit and no more: 100,000 lines
that all cross (5 billion pairs and crossings) are refused after about
10,000 pairs (`limit.test.ts` counts the `intersectCurves` calls), in
0.39 s and 170 MB, most of both for the 100,000 segments and their grid.
What is left is linear in the curves: with the limit at 100,000, 1,000
weaving splines (112,000 segments) were refused in 0.47 s, 5,000
(560,000) in 1.3 s. The
total doesn't depend on the order the pairs come in, so the grid's pairs
and every pair agree. The one constant serves the app and the kernel, so
they never disagree on whether a sketch has regions:

- **The app** (`apps/web/src/sketch/profiles.ts`): `sketchProfiles` gives
  no profiles for such a sketch (no fills, nothing to pick) and
  `sketchProfilesProblem` says why; the sketch palette shows
  `TOO_MANY_CROSSINGS` ("This sketch has too many curve crossings to find
  its profiles. Remove or simplify curves.") under the DOF counter, the way
  the counter shows an over-constrained sketch. It is asked only while
  **Show profiles** is on: then the fills' cached detection answers it.
- **The kernel's sketch feature** detects the regions *before* its face
  build (`planarFaces`) and on a refusal makes no faces at all: the sketch
  ends with a warning (the same text, in the timeline), no `profiles`, and
  `profilesRefused` (the feature message) in its output; its curves, points and lines are
  there as before (paths, holes, revolve axes, projections still work). A
  feature that picked one of its profiles (`profilePart`, a whole text in
  `textParts`, the OpenSCAD export's `sketchOutput`) fails with
  `TOO_MANY_CROSSINGS_TO_PICK` ("Its sketch has too many curve crossings to
  find its profiles. Remove or simplify curves in the sketch.") instead of
  "Can't find one of its profiles any more".
- **The API**: `SketchHandle.regions` (and so `profiles()`, `profileAt`,
  `profilesInside`) throws an `ApiError` with the same message, its `cause`
  the `ProfilesRefusedError`, as its other refusals do; the script emitter
  names such a sketch's profiles by ID (`design.ref`) instead of by a point
  inside. The app's agent tools (`agent/tools.ts`) describe such a sketch
  with no profiles or regions and the reason as `problem`.
- **The importers**: the f3d import's `selectProfiles` gives its own
  `TOO_MANY_CROSSINGS` reason (its work budget `MAX_PIECE_WORK` is
  unchanged), the FreeCAD import's `profileRefs` the same words; both skip
  the feature with that reason, as before for their own budgets
  (`profilesRefusal` finds the error behind an `ApiError`). The FreeCAD
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
limit) went through the code before and after, with every rule of this
amendment and the limit at 20,000: a digest of the whole output is the
same for all 1,348 under the limits, and the one refused is the FreeCAD
grid above (no other suite sketch comes near). The counting costs nothing
measurable: per sketch, interleaved, median of 9 runs, the median time
went 0.057 → 0.056 ms, the median ratio 1.001 (10th–90th percentile
0.95–1.05), and 0.985 with the order swapped.

**The kernel at the limit.** Its face build costs more per region than the
detection (about 0.3 ms a face for lines, 1 ms for circles, 3 ms for
splines, in Node, same machine; 300 chords, 44,145 faces: 13.6 s and 600
MB). Right under 20,000 a sketch keeps the worker busy for 3 s (lines) to
about a minute (crossing splines, with the second run); it is in the
worker: the app stays responsive, and the recompute can be cancelled.

**Considered and dropped.** A time or memory budget (not deterministic).
Counting the pieces after the cutting (too late: the cutting itself is the
quadratic part on a refused sketch). A limit on the curves or segments
(refuses a long spline or a line of text that costs little). A separate
cheap check before `detectProfiles` (it would repeat the cutting; the
detection's own cutting stops just as early). A result with a reason
instead of a throw (every caller would change; with a typed error only the
callers that must go on catch it, and the rest fail loudly).

**Two more rules (same day).** Cuts inside curves are not the only work
that grows with a sketch's arrangement, so the detection refuses two more
kinds of sketch through the same error (`ProfilesRefusedError`, its
`reason` `crossings` or `size`) and the same paths in the app, the kernel,
the API and the importers:

- **All cuts count too.** Every cut a pair makes is counted, ends included
  (two curves that meet end to end cut each other four times: each end on
  the other curve, found twice). A sketch may have `MAX_PROFILE_CUTS` plus
  `PROFILE_CUTS_PER_SEGMENT` = 8 per segment; past that it is refused with
  the crossings message. Curves that only meet at their ends, many of them
  at one point or stacked on each other, otherwise piled cuts up at their
  ends without counting (1,000 such lines 1.1 s and 2,000 4.2 s before;
  refused in about 50 ms now). Real sketches: at most 14 cuts per segment
  (1,017 sketches of the f3d corpus), and their cuts over 8 per segment at
  most 217 in all; a 60,000-line closed polyline (4 per segment) passes.
  The total doesn't depend on the order of the pairs either. The worst
  accepted sketch sorts and merges `MAX_PROFILE_CUTS` + 8 per segment cuts:
  linear in its curves beyond the limit's own share.
- **Coordinates.** A sketch whose normal curves reach past
  `MAX_PROFILE_COORDINATE` = 10⁹ mm (1,000 km, either axis of a segment's
  box; an infinite one too) is refused before any pair is tested, with its
  own message: "This sketch has coordinates too large to find its
  profiles." (features: "Its sketch has coordinates too large to find its
  profiles."; the importers' reason "its sketch has coordinates too large to
  find its profile(s)"). Why 10⁹: a double there still resolves 0.12 µm,
  about 800 steps inside `PROFILE_TOLERANCE`, squares (10¹⁸) and products
  stay far from overflow, and the vertex grid's cell numbers (10¹³) stay
  exact integers. Far above real use: the corpus's largest coordinate is
  4.7 m, the test suite's 20 km. Lines tens of orders longer overflowed
  their own squared length, so their cuts landed nowhere and counted as
  nothing (100 such lines took 8.6 s; refused in 1 ms now). The old switch
  that tested every pair when a coordinate passed 10³⁰⁰ is gone with it: a
  large polyline with one line far out took 4.6 s (20,000 lines), now
  refused in 59 ms.
- **What stays as it was.** A curve at no number (a NaN coordinate, a
  degenerate curve: 12 of the suite's sketches have one) meets nothing:
  `overlap` is false for its box, so it now stays out of the grid instead
  of switching it off (20,000 lines and one such curve: 4.6 s → 0.44 s,
  the same regions), and a vertex at no finite position no longer scans
  the others (it never merged with any). A cut that is not clearly within
  the tolerance of a segment's end counts as inside (`inside` fails
  closed; for any number the answer is as before).

**Still not bounded** (bounded since the second amendment of 2026-11-15,
below). Work that grows without crossings: boxes that overlap without
crossing (10,000 concentric circles: 50 million pairs, 16.5 s, no cut
inside a curve), and the linear work of a huge polyline (two crossing
splines of 20,000 poles: 640,000 segments, 11.7 s, 2.4 GB).

## Amendment 2026-11-15 (second): work linear in the sketch, and bounded

**What.** Detection's work without cuts is linear in the segments in the
steps below (a text's ink, the pair search's grids for boxes of every size,
a fit spline's system, the hole search, the vertex grid), and everything
that can still grow faster, or that grows with the sketch at all, is
charged while detecting against three limits and refused through
`ProfilesRefusedError` with a third reason, `curves`: the segments and
sample points (charged before a curve's polyline is made), and the tests of
curves near each other (the pair search's own work included, charged before
the cells it stands for are made). Each rule keeps the output the same to
the last bit:

**A text's outline is laid out once per detection.** The text's polylines
are sampled once per detection and shared by its segments and its ink
(`TextLines`); the ink is made once per text, its rings are prepared once
(`windingRings`), and `windingNumberOf` walks only the rings whose box holds
the point's row (exact: no edge of another ring counts) and column (by more
than 1e-9 × the box's coordinates sideways: a ring wholly left or right of
the point has as many edges counting up as down). `ink.test.ts` checks
`windingNumberOf` against `windingNumber` on random rings, with points on
vertices and box sides; `text-ink-once.test.ts` counts one `textPolylines`
per text and detection.

**The pair search keeps its cell size whatever the sketch's extent.** Cells
are keyed by column and row (`Cells`: one number while columns × rows is an
exact integer, a map per column beyond), never by a grid side capped by the
extent, so the cell is the median side wherever the curves are.

**A box meets only the boxes near it, whatever its size.** Each box has a
level `(a, b)` (`levelsOf`): the fewest doublings of the base side (the
median of the larger sides, as before) along x and along y after which it
spans at most 4 cells of each; a box whose larger side is an eighth of that
or less goes to a finer level instead, the base side halved the same along
both axes until it spans at most 4 cells (no finer than 2⁵⁰ cells over the
extent, so cell numbers stay exact). Boxes of one level meet in its grid; a
box and one of a level wider and taller (or equal in one axis) meet in the
wider one's grid, where the other spans fewer cells; a box and one wider
but lower meet in the grid `(wider a, own b)`, where the wider box is kept
too (in each such grid of the heights of narrower levels). Each box looks
only in the levels that can hold a partner (worked out once per level).
Each pair is found once, from one side; pairs across levels are kept by the
lower index, and the pairs still come out **in the order of the all-pairs
loop** (`i`, then `j`), so the cuts, regions, IDs and points stay the same.
A sketch whose boxes are all alike has one level and no second pass.

The search's own work is charged (`PairSearchStats`, `PairSearchBudget`):
every cell a box is put in or looked up in, every box looked at there, the
levels' look lists, and the wider boxes kept in other grids, which are
counted for all boxes before any is kept. Detection charges it with the
pairs' tests against `MAX_PROFILE_TESTS` (below), checked as it counts.
Linear in the boxes for boxes of one level, small boxes among large ones,
and long boxes among short ones; what is not (many thin boxes side by side
in one cell, many levels, many wide boxes kept in many grids) is bounded by
that charge. `pairs.test.ts` compares the search with every pair on box
sets of several levels (long, tall and small boxes of many sizes, far
outliers), counts its work for one curve at the coordinate limit, long boxes
among short ones and small boxes in one large cell (a few tests per box),
and checks that the budget refuses as soon as it is passed.

**The hole search asks a grid.** From 4,096 outline–region pairs on, a grid
of the regions' boxes widened sideways by the margin (`BoxesAt`, the same
levels) gives each probe the regions whose box holds it; those are tested
in ascending order with the same rules, so the chosen region is the one the
loop over all of them chose (a box with a NaN is always a candidate).
`pairs.test.ts` checks `BoxesAt` against a test of every box.

**The vertex grid's cells are keyed by numbers.** `Vertices` keeps a map
per column of maps per row instead of string keys: the same cells, scanned
in the same order, so every vertex is the one it was.

**Refused: too many curves.** What a sketch costs without cuts is counted
while detecting (`Work`, `detectProfilesWork` for tests and censuses), each
against its own limit, and past one the sketch is refused with the reason
`curves`:

- **Segments**, `MAX_PROFILE_SEGMENTS` = 200,000, and **sample points**,
  `MAX_PROFILE_POINTS` = 2,000,000, counted curve by curve before any pair
  is tested. A line, arc or circle is one segment (an arc or circle its
  samples in points, up to 2,048). An ellipse, spline or text is charged
  one segment and one point per piece of its polyline **before the
  polyline is made**: an ellipse's 96, a spline's from its knots (its spans
  × the samples per span, `splineSampling`, `splinePolylinePieces`: the
  curve itself is made first, linear in its points), a text's from its
  placed curves (a line one, a glyph curve 16; a text has at most 1,000
  characters). So no curve's polyline or segments are made past the limits.
- **Tests of curves near each other**, `MAX_PROFILE_TESTS` = 10,000,000:
  the pair search's own work (above), every pair of segments whose boxes
  meet (counted in `cutPair` after the same `overlap` on either path), and
  in the hole search every level and region looked at and every point of
  every polygon a probe is tested against. None of these depends on the
  order of the pairs. Checked as they are counted.
- **Why these.** Segments and points are known before any of the work, the
  tests as they are made; the regions only after it. The pair search's
  charge shares the tests limit because its total stays far under it for
  every real sketch (below). A time or memory
  budget stays out (the same sketch must give the same answer everywhere).
  The first amendment dropped a limit on segments while other steps were
  not linear in them; now they are, and it bounds what is left.
- **Real sketches** (counted with the limits lifted): the 1,047 sketches
  of the 252 designs of an f3d corpus (imported) and of the repository's
  fixtures, examples and template reach at most 11,562 segments (99th
  percentile 5,300), 12,516 points and 963,675 tests (the pair search's
  work included; 99th percentile 395,981); the 39 text sketches at most
  6,023 segments. The Vitest suite's own sketches, stress tests included,
  reach 159,953 segments, 1,019,073 points and 7.7 million tests, all
  accepted. So the limits are 17, 160 and 10 times the largest real
  sketch. Text comes nearest:
  every glyph curve is 16 segments, about 200 to 500 a letter by font, so
  the texts of one sketch together may have some 480 (Fredoka) to 1,170
  (JetBrains Mono) characters of ordinary prose.
- **Messages.** "This sketch has too many curves to find its profiles.
  Remove or simplify curves." (`TOO_MANY_CURVES`: the palette line and the
  sketch's warning); features: "Its sketch has too many curves to find its
  profiles. Remove or simplify curves in the sketch."
  (`TOO_MANY_CURVES_TO_PICK`); the importers' reason "its sketch has too
  many curves to find its profile(s)". The API, the emitter and the agent
  tools pass the error on as they do the others.

**The proof that nothing else moved.** Every sketch the Vitest suite
detects (saved while it ran on the code before the crossing limit, and
again on the code before this amendment) and 51 made for it (texts in
every bundled font, fit splines of 3 to 300 points across a line, plates
with hundreds of separate and nested loops): 1,545 distinct sketches went
through the code before and after. The whole output's digest is the same
for all 1,534 the code before accepted; the 11 it refused (the limits'
own tests) are refused the same way, and none is newly refused. Per
sketch, interleaved, median of 9 runs: the median ratio is 0.79 (10th–90th
percentile 0.57–1.11; mostly the vertex grid's number keys). The six
digests of `limit.test.ts` are unchanged. Seeded random runs besides:
5,000 box sets (241 million pairs; on cell borders, of no size, of 3 to 16
base sides, far out, of sizes from 10⁻⁷ to 10⁷ mixed, duplicated, hatched)
give the same pairs in the same order as the code before and as a test of
every pair, and `BoxesAt` the same boxes as a test of every box; 6,000
random sketches (lattice lines, nested and separate squares, circles and
arcs, texts in every bundled font, fit, control and closed splines,
ellipses, degenerate curves, at scales from 10⁻³ to 10⁴ and near the
coordinate limit) give the same output, 149 refused by both and none newly
refused; 9,000 fit splines the same poles and knots.

## Amendment 2026-11-16: detection remembers its result per sketch

**What.** `detectProfiles` keeps what it found for each sketch data object
in a `WeakMap` keyed by that object: the regions, or the reason it refused
them (`ProfilesRefusedError.reason`). The same object again gets the same
answer without the work: a new list of the same profiles, or a new
`ProfilesRefusedError` with the same reason (callers test the class, the
reason and the message, never the error's identity). Other errors are not
kept. The profiles kept are frozen, with their loops, edges and points:
callers share them, and a write into one throws; each call gets its own
list, so sorting or filtering it is the caller's own. `detectProfilesWork`
and `detectProfilesAllPairs` never use what is kept: they exist to do and
measure the work.

**Why.** Many callers ask for the regions of the same unchanged sketch:
the API (`regions`, `profiles()`, `profileAt`, `profilesInside`: each a
whole detection, and the agent's tools call two of them per request), the
emitter and the OpenSCAD export once per profile reference, the importers
once per feature that uses the sketch, the kernel's sketch feature and the
export in the same recompute. A large sketch, or one refused after seconds
of work, costs that time on every call. The app's own cache
(`apps/web/src/sketch/profiles.ts`, per data object and fonts' version)
already answers the viewport, picking and panels: in the app a design
open in model or sketch mode for half a minute, with the pointer moving
over it, detects nothing again (wall bracket template: 2 detections per
sketch on opening, the template's own and the viewport's, none while idle;
a refused sketch: 1 on the main thread, 1 in the kernel).

**A sketch's data is never changed in place**, which is what makes the
object a sound key (checked, not assumed): the document store holds
frozen documents (Immer's `produceWithPatches` and `applyPatches` freeze,
`replaceDocument` freezes deeply), so every edit, solve, drag step, undo
and redo makes a new data object for the sketch it touches and keeps the
others. The solver and settling copy what they change and hand it back
through a command. The builders whose maps grow while a sketch is built
(the API's `SketchBuilder.data`, the tests' `SketchBuilder.sketch`) hand
out a new object at every look, so a look during a build is never
answered from an earlier one; the importers change builder entities only
inside the build, before detection sees the document. The kernel worker
gets a copy of the document with every recompute and changes nothing. The
whole Vitest suite ran with every remembered answer detected again and
compared: no difference. Rules: never change a `SketchData` after it may
have been detected (make a new object), and never key this cache by
`data.entities` (a builder's map grows under it).

**Left out: a sketch with text** (any text entity that is not
construction). Its ink depends on the fonts loaded, which can arrive after
the first detection; the app's cache keys text sketches by the fonts'
version instead. Construction geometry, construction text included, is
never read by detection, so it doesn't matter.

**No bound is needed.** An entry lives as long as its data object: the
store's document (one object per sketch), the undo history (up to 500
steps of patches, which can hold earlier objects) and, in the worker, the
last recompute's outputs. The app's cache already held the same results
for the same objects and now shares the frozen profiles. The largest
sketch of the f3d corpus (11,562 segments) keeps about 3 MB (49,000
points in its loops and edges); a stress test of the suite with 3,294
regions about 23 MB.

**Numbers.** That corpus sketch: 1.2 s the first time, 0.05 ms the
second; a suite sketch refused for its size 118 ms, then 0.03 ms; one
refused for its crossings 23 ms, then 0.01 ms. Freezing costs nothing
measurable. The 1,545 sketches of the second amendment's proof, each
detected on the code before and twice on the same object (and once on a
new copy) on the code after: the same digest for all, the same 11
refusals; the second calls of the 1,465 without text take 5 ms together
against 6.2 s for the first. 6,000 seeded random sketches give the same
output before and after, and the same on the second call (149 refused by
both). Over the 252 designs of an f3d corpus, importing them asked 2,570
times for the regions of 1,001 sketch objects and now does the work 1,035
times (text sketches every time), and emitting each design's script asked
5,199 times and now does the work 76 times (16.6 s → 4.0 s in all). The f3d
corpus gate (the 252 designs replayed and their bodies checked, before and
after): no design's verdict or body outcome changed (170 match, 47
mismatch, 18 partial; 248 bodies editable, 111 frozen, 26 unchecked), and
no run failed.

**Rejected.** A key by the sketch's content (a hash or serialisation per
call costs about what detecting a small sketch costs, and nothing would
need it: an unchanged sketch keeps its object). A size or age bound (the
entries already go with their sketches). Remembering text sketches by the
fonts' version in this package (the version lives in the app; the kernel
and the CLI load their fonts before they compute). Copying the profiles
for every caller (as dear as freezing them once, on every call).
