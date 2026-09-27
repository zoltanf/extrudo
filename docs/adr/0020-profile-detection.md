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
expect every piece of the plane between the curves to be a region, as in
Fusion.

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
   own (Fusion does the same; the extrude picks which).
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
