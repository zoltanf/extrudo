# ADR-0025: Sketch to kernel: exact profile faces

- **Status:** Accepted, 2026-09-27
- **Task:** P2-02 (sketch → kernel). Code: the facade's sketch section in
  `packages/kernel/occt/facade/extrudo_facade.cpp` (`sketchLine`,
  `sketchArc`, `sketchEllipse`, `sketchSpline`, `sketchProfiles`,
  `buildProfiles`), `packages/kernel/src/planar.ts` (curve and face types,
  record decoding), `Kernel.planarFaces` in `kernel.ts`, the sketch
  evaluator in `src/features/sketch.ts` (`planarCurves`, `profileFaceIds`,
  `SketchOutputData`), and `profileKey`/`profileIds`/`profileCentroid` in
  `packages/sketch/src/profiles/profiles.ts`.
- **Builds on:** ADR-0001 (the facade owns OCCT memory), ADR-0010 (the
  sketch model and plane frames), ADR-0014 (ellipse shape, fit-point
  splines as poles and knots), ADR-0020 (profile detection and region IDs),
  ADR-0024 (feature outputs and the shape cache).
- **Affects:** P2-04 (topological naming of extrude side faces from the
  sketch curves of each edge), P2-06/P2-07 (extrude and revolve read
  profile faces), P2-09 (sketches on faces and construction planes).

## Context

Architecture §5.3 planned two passes over a sketch's curves: the
TypeScript arrangement (P1-11) for instant shading and picking, and OCCT
for the authoritative faces a solid is built from. A user selects a
profile by the arrangement's region ID (`<sketch>/<region>`), so the
kernel's faces must carry the same IDs, or an extrude would lose its
profile. The arrangement works on polylines for ellipses and splines,
while the kernel must be exact, so the two can't share one computation.

## Decision

1. **The facade builds everything.** The evaluator stages each normal
   (non-construction) curve in the sketch plane's own 2D frame (z = 0),
   in entity ID order: lines from their points, arcs by center, radius,
   start angle and sweep (as the viewport reads them), full circles and
   ellipses as closed edges (OCCT's major radius first: a larger `b`
   swaps the axes and turns a quarter), and splines as the exact poles
   and knots of `fitSpline`, cut where they cross themselves
   (`Geom2dAPI_InterCurveCurve` on the curve alone): General Fuse splits
   an edge only where it meets another, while the arrangement's polyline
   segments meet each other. `sketchProfiles` then runs General Fuse
   (`BOPAlgo_Builder`, fuzzy value = `PROFILE_TOLERANCE`, 0.1 µm, the
   arrangement's vertex tolerance) to split the curves where they cross,
   touch or end on each other, and `BOPAlgo_BuilderFace` on an infinite
   XY plane with every piece in both orientations. One curve skips the
   fuse (it wants two arguments).
2. **Pieces that bound nothing go, as in the arrangement.** A piece that
   lies twice in one face, or inside one (a bridge to a hole, a dangling
   line), or in no face, is dropped and the faces are built again until
   none is left. A bridged hole therefore stays a hole. Wires of a face
   that share a vertex are one loop, as the arrangement's connected
   groups are: a circle touching the outline from inside is part of the
   outline (OCCT makes it a second wire), and two touching holes count as
   one.
3. **Faces are placed with a location.** Each face is moved into the
   plane by the displacement from the XY axes to the plane's
   `gp_Ax3(origin, normal, x)`, so its geometry stays in plane
   coordinates. The faces go into the arena; the evaluator returns them as
   `shapes` keyed by region ID, and the cache owns them (ADR-0024).
4. **The kernel keys faces the way the arrangement keys regions.** For
   each face the facade reports the curves around its outer wire (a piece
   shared by overlapping curves counts as the lowest index, so the lowest
   ID, as in the arrangement) and whether each piece runs against its
   curve, found from the tangent of the piece in its wire against the
   curve's own tangent at that point. The evaluator hashes the (curve,
   direction) set with the arrangement's own `profileKey`/`profileIds`, so
   one rule makes both IDs. Regions sharing a key are numbered by area
   centroid (x, then y) in both; before P2-02 the arrangement used the
   average of its polygon's vertices, which OCCT can't reproduce.
5. **A safety net, counted.** `profileFaceIds` runs `detectProfiles` on
   the same sketch; a face whose own ID isn't a detected region with the
   same area and centroid (within 5 %, since the arrangement's ellipses
   and splines are polylines; a spline's area is about 1 % off) takes the ID of the unclaimed region that
   matches. The tests expect no such reassignment over the whole
   profile-test corpus.
6. **Output.** `SketchOutputData` holds the plane frame and each profile's
   ID, area, hole count and the sketch curve of every face edge in
   sub-shape order: what P2-04 needs to name an extrude's side faces
   (`extrude:<fid>:side:<curveId>`) without rebuilding the sketch.

## Consequences

- `pnpm vitest run packages/kernel/src/features` checks 28 sketches
  (every `detectProfiles` test sketch plus a rounded rectangle, B1's
  plate, an ellipse crossing a rectangle, touching holes, a spline
  crossing itself): same IDs with no reassignment, same hole counts,
  areas within 2 % (to 1e-9 for lines and arcs), valid faces, no shapes
  left behind. The first run found the two differences above (touching
  wires, self-crossing splines); the safety net had covered the first.
  Building the faces takes about 4 ms for a 13-curve sketch with an
  ellipse, a slot and a spline (1000 rebuilds in 4 s leave the heap flat,
  `memory.test.ts`) and under 80 ms for a 24-tooth gear (97 curves), in
  Node; the worker runs it off the UI thread.
- Pieces stay split where a dropped bridge or dangling line touched a
  curve, and closed curves keep their seam, so a face can have two edges
  from one curve. Extrude will get two side faces there; P2-04 names both
  from the same curve (`#1`, `#2`), and `ShapeUpgrade_UnifySameDomain`
  can merge them later if that proves a nuisance.
- Every sketch edit re-evaluates the sketch in the worker (a cache miss);
  undo takes it from the cache.

## Rejected

- **Building faces from the arrangement's loops.** The arrangement cuts
  ellipses and splines as polylines, off the exact curve by up to its
  sagitta (tens of µm for a 96-segment ellipse), so its loops don't close
  on exact edges. The kernel would have to intersect exactly anyway.
- **Matching faces to regions by geometry only.** The polylines put a
  spline region's area and centroid a percent or so off, so the tolerance
  must be loose, and small regions close together (slivers between
  near-tangent curves) then match the wrong face. The key names a region
  by why it exists; geometry is only the fallback.
- **Origins through `Modified()` alone for directions.** A piece shared by
  two overlapping curves is one edge for both, and General Fuse doesn't
  say which way it runs relative to each; the tangent test does.
- **`BOPAlgo_Tools::EdgesToWires` + `WiresToFaces`.** It wants
  pre-grouped wires and doesn't nest holes by itself; the face builder
  does both.

## Open

- Sketches on faces and construction planes (P2-09, P3-05): the evaluator
  still refuses a face and knows only the origin planes' frames.
- Model-mode profile picking (the Extrude dialog, P2-05/P2-06).

## Amendment, 2026-11-09 — the kernel's faces answer to every region the sketch shows

**What.** The app shows and picks a sketch's regions from `detectProfiles`
(`apps/web/src/sketch/profiles.ts`), and a profile reference stores that
region ID; an extrude then reads the kernel's face under the same ID.
Two sketches from imported files showed a region with no face, so the
extrude failed with "Can't find one of its profiles any more". In both the
arrangement was right and the kernel lost the region:

1. **A spline that doubles back.** A traced outline split a region in two
   with a chain of 86 short curves, one of them a control spline whose
   poles lie in a line and go 3 µm forward before they turn and run on
   back: the curve runs over its own track. The facade cuts a spline where
   it crosses itself (Decision 1), but not where it folds onto itself, so
   General Fuse keeps it one edge and the face builder drops the whole
   chain as a dangling one: one face of both halves' area (1089.68 mm² =
   769.48 + 320.20), under neither ID. Now `planarCurves` stages such a
   spline as its pieces between the folds (`unfolded`), all under the
   spline's own ID. `splineFolds` in core's `curves.ts` finds a fold where
   the tangent turns by more than 150° between neighbouring samples (16 per
   knot span) and bisects to where the derivative stops going forward; a
   smooth curve gives none, so no other sketch is staged differently. Two
   pieces of one curve make the same profile key, so the IDs agree with no
   reassignment.
2. **A thin chord off a circle.** A line starts on a circle (r 5.15) and
   leaves it again 0.049 mm on, so the chord is 0.058 µm from the arc,
   under the fuzzy value. The fuse makes chord and arc one edge, and when
   the line comes first among the curves (its ID sorts first) the face
   builder loses the ring on the other side of the chord too: 9 faces for
   10 regions. Why the order matters inside OCCT was not followed up. Measured on a
   synthetic ring: lost while the chord's sagitta is under about twice the
   fuzzy value, kept with the circle first, kept at a fuzzy value of 1e-5
   or less. The evaluator (`sketchFaces`) now builds the faces once more
   at a tenth of `PROFILE_TOLERANCE` when a detected region has no face,
   and takes from that run only the faces that are such a region (by key,
   or by area and centroid, as the safety net, Decision 5); every other
   face, and its ID, is the first run's. A sketch whose regions all have a
   face makes one run, as before.

**Region IDs.** `detectProfiles` is unchanged, so no ID a design stores can
change. On the kernel side: all 1045 sketches of the 58 designs in
`fixtures/` and of a private corpus of 252 imported files give the same
faces under the same IDs before and after, apart from the five sketches
of the two designs above, which gain the faces they lacked (the halves
replace the joined face). The tests: `splineFolds` in `curves.test.ts`;
"regions the kernel used to lose" in `sketch.test.ts` (a rectangle split
by a chain with a folded spline: both halves have a face, both extrude to
the whole, one to its half; the ring and chord: every region has a face,
the ring extrudes; and the fixed IDs of four plain sketches). Both
sketches fail on the code before.

**Cost.** A second run only where a detected region has no face: in the
corpus three sketches besides the two above, which it doesn't help (a
self-crossing spline chain, and a 0.0001 mm² sliver in two files); the
largest of them took 440 ms instead of 245. Summed over all 1045
sketches the evaluator took 5 % longer, those three sketches included;
`detectProfiles` is untouched.

**Tried and dropped.**
- *A face equal to the union of unclaimed regions answers to all their
  IDs* (a rule in `profileFaceIds`, prototyped on the corpus first). It
  hides the cause, extrudes the whole face when a feature picks only one
  of the regions, and needs a bound on the combinations it tries; with
  the fold split the kernel makes the two faces itself.
- *Make `detectProfiles` treat a curve end within the tolerance of a
  curve as on it.* It already does (`cutSegments`); the line's end was on
  the circle exactly, so the rule wasn't the difference.
- *Stage the curves in another order* (circles before lines). It would
  help the chord, but the facade names a piece shared by two curves after
  the lowest index (Decision 4), so it would move IDs of other sketches.
- *A finer fuzzy value for every sketch.* It keeps the ring, but leaves a
  sliver face the arrangement doesn't have, and the value matches the
  arrangement's vertex tolerance on purpose (Decision 1).
