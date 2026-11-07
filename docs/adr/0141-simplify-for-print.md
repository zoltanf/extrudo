# ADR-0141: Simplify for Print (small rounds, chamfers and holes removed at once)

- **Status:** Accepted (pilot), 2026-11-07
- **Issue:** #79, follow-up to #78. Tester feedback (2026-10-18): removing
  features is common in CAD tools for simplifying geometry, "tends to fail a
  lot being a semi automatic tool".
- **Builds on:** ADR-0099 (Remove Faces: facade `removeFaces`, the pick rule
  `removeFacesPick`), ADR-0005 (topological naming), ADR-0027 (live preview,
  preview tools), ADR-0068 (the document API), ADR-0097 (Mesh to Solid: a
  feature report on the status and in the dialog's preview).
- **No schema or file-format change**: a new feature type with `ref`, `bool`
  and `expr` inputs. **No new facade method, no new WASM.**

## Context

Remove Faces (ADR-0099) takes a click per round or hole. A part imported
from engineering CAD (STEP, `.f3d` file bodies, a recognised STL) can have
dozens of small fillets, chamfers and holes a print doesn't need; picking each is
slow, and one failure refuses the whole pick (all or nothing, by design).

Everything detection needs is already in the kernel: a face's surface
(`surfaceGeometry`: type, radius, a torus's minor radius), whether a
cylinder is a hole's wall and goes all the way round (`threadFace`'s
`inside`, `whole`), and the hole
rule of Remove Faces' picks (`removeFacesPick`: a wall with its floor,
counterbore, countersink, drill point). A face's plane normal and its
edges' directions and midpoints are in the shape description. The kernel's
`tangentFaces` (a face's smooth chain) was used at first and dropped: on a
Mesh to Solid body of 388 faces it took about 340 ms a call, 9.5 s for one
detection.

## Decision

1. **A feature `simplifyForPrint`** (`packages/core/src/simplify-for-print.ts`,
   label **Simplify for Print**, category `modify`, icon
   `simplify-for-print`; tool in **Make › Prepare**, category `export`).
   Inputs: `bodies` (`refsOf(['body'])`), `rounds` (bool) with
   `maxRoundRadius` (length expr), `chamfers` (bool) with
   `maxChamferSize` (length expr), `holes` (bool) with `maxHoleDiameter`
   (length expr). A kind is on while its limit is given and its toggle isn't
   false (`simplifyKinds`); none on is an error ("Turn on rounds, chamfers
   or holes to simplify."); a limit ≤ 0 is an error. **The feature stores
   no faces**: the kernel finds them on every recompute, so
   a changed limit or an upstream edit finds them again, and there is no
   face reference to lose. Helpers: `simplifyForPrintInputs(bodies,
   options)`, `simplifyForPrintFeatureOf(id, name, bodies, options)`.
2. **Detection** (`findSimplifyGroups`, pure, in
   `packages/kernel/src/features/simplify-for-print.ts`; the surface comes
   from `kernelSimplifySurface`). Two faces **meet smoothly** across an edge
   when their normals at its midpoint are parallel within about 2°
   (`smoothAcross`; normals from the plane's normal or the surface's axis,
   centre or apex: `normalAt`; a spline face meets nothing smoothly):
   - **Holes**: a hole wall is an inside cylinder all the way round, or a
     **ring** of inside cylinder pieces on one axis with one radius whose
     shared edges close the ring (n pieces, ≥ n shared edges: imports often
     split a wall in halves). Each wall takes the faces `removeFacesPick`'s
     hole rule takes (ring pieces count as whole there), plus its **mouth
     round**: a torus on the hole's axis next to one of its walls (an inside
     cylinder or cone), whatever the round limit, so a hole with a rounded
     edge goes whole (`withMouth`; a chamfered mouth is a countersink cone,
     already in the hole rule). The hole's size is
     **twice the widest inside cylinder's radius** among its faces, so a
     counterbore counts by its counterbore; over the limit, the whole hole
     stays (never a part of it). Ring pieces are never rounds.
   - **Rounds**: candidates are cylinder faces **not** all the way round,
     torus faces (by their minor radius) and sphere faces (corner blends),
     with the radius at most the limit, not in a hole, and meeting at least
     one neighbour smoothly (a face with no tangent neighbour is no round). A
     round is a connected run of candidates across edges where they meet
     smoothly. Its size is its largest radius.
     Cones are never rounds (a chamfer is not a round).
   - **Chamfers** (`bevelOf`): a **plane** with two parallel straight edges
     on two different flat neighbours whose normals aren't parallel, at an
     angle to each (cosine of the normals in 0.05–0.99985: not square, not
     smooth), with every vertex inside the strip between those edges; its
     legs run from each edge to the line where the two neighbours would meet
     (three-plane intersection in the edges' cross-section), and its size is
     the **longer leg**, so "1 mm" means a 1 mm chamfer, as the Chamfer tool
     sets it. Or a **cone** whose circle edges are at two levels (radius,
     height along the axis) that meets no neighbour smoothly: legs are the change
     in radius and in height (a countersink not taken by a hole is a
     chamfer). Between two bevel-shaped faces (an octagon's side between two
     chamfers), a face is **no chamfer when one of the two faces it bevels
     between is a bevel at most its size**: the narrower wins. Touching
     chamfers are one group, with any **corner patch**: a plane whose every
     neighbour is a chamfer and whose vertices lie within twice their size
     of its centroid (the triangle where three chamfers meet; not a face
     ringed by chamfers). Size: the largest.
   - A group of every face of the body is skipped. No face is in two groups.
     Groups come rounds, chamfers, then holes; holes are found first, so a
     countersink is the hole's.
3. **Removal**, per body: **all groups in one `removeFaces`** first (one
   defeaturing, the common case). When that throws `RemoveFacesError`,
   **all but the groups with a face OCCT named** (`error.failed`) in one,
   then each named group alone; when that second call fails too (or OCCT
   named none or all), **each group on its own**. Alone means in order, on
   the shape the ones before left;
   a later group's faces are found again **by name** in the shape's naming
   table (`withHistory`, op `simplifyForPrint`), and a group with a face no
   longer found is counted as not removed. A failed group leaves the shape
   as it was and the next one goes on. Errors other than
   `RemoveFacesError` propagate. Intermediate shapes are released as they
   are replaced; results are kept only after the last call that can throw
   (`scope.keep`). Removed faces' names are gone; extended neighbours keep
   theirs (Remove Faces' history). A mesh body is refused ("Mesh to Solid
   first").
4. **Report and status.** The evaluator's report is
   `{ kind: 'simplifyForPrint', groups }`, one `SimplifyGroup` per round or
   chamfer or hole: `kind`, `body`, `size` (radius, longer leg or diameter,
   mm), `faces` (count),
   `removed`. The recomputer puts it on `FeatureStatus.simplify` and on the
   preview (`Preview.simplify` → `DialogContext.draftSimplify`), as Mesh to
   Solid's. Warnings: nothing found ("Nothing under the limits: the body is
   unchanged."), some failed ("N of the M found couldn't be removed; the
   rest are."), all failed. A warning, not an
   error: the bodies the removals left are still the result.
5. **Preview**: one preview tool, a compound of the removed groups' faces of
   the input body, style `cut` (red, drawn through the bodies), so the view
   shows **the faces that go** rather than the simplified body. Failed
   groups aren't drawn; the dialog lists them.
6. **Dialog** (`apps/web/src/features/simplify-for-print.ts`): Bodies;
   Rounds toggle + Max radius (default 1 mm); Chamfers toggle + Max size
   (default 1 mm); Holes toggle + Max diameter (default 3 mm); a hidden
   limit makes no input (the framework's default mapping). The Found line is
   `simplifySummary`, the kinds removed with a count above 0 ("12 rounds, 3
   holes", "Nothing removed", "Nothing under the limits"; "· 2 couldn't be
   removed"); under it, the info field's new **`lines`**
   (`InfoField.lines`, a small list) gives one `simplifyGroupLine` per group
   ("Hole Ø3 mm, 2 faces: removed"), what stayed first, at most 8 and "and N
   more".

## Rejected

- **Storing the found faces** (as Remove Faces does): the feature would be
  a Remove Faces with a picker, and a changed limit or an upstream edit would
  need a re-pick. Finding them in the kernel keeps it parametric.
- **One at a time always**: N defeaturings per recompute and preview; the
  all-at-once first pass is one in the usual case.
- **Going straight from the all-at-once pass to one at a time**: on the
  drill-block tester part (Mesh to Solid, 388 faces, 61 groups) that was 62
  defeaturings, about 60 s; OCCT named exactly the 18 failing groups, so the
  second pass is 2 calls plus the 18 alone. OCCT's list isn't trusted on its
  own: a failing second call still falls back to one at a time.
- **A facade query for detection**: the existing queries are enough, and a
  new one would need a new OCCT WASM build.
- **Treating a whole outside cylinder (a pin) as a round**: it blends nothing.
- **A chamfer's size as its face's width**: a 1 mm 45° chamfer is 1.41 mm
  wide, so a "1 mm" limit wouldn't find it; the Chamfer tool's distance is
  the leg.
- **Chamfers between curved faces** (a flat chamfer on a cylinder's
  straight edge, a chamfer along a spline): the legs need the neighbours'
  meeting line; only plane–plane strips and cones for now.

## Consequences and follow-ups

- A slot's round end or a half-hole on a body's edge is a round by this
  rule; the limit decides, as in other tools of the kind.
- **Speed** is OCCT's defeaturing on big bodies: on the drill-block part one
  call with all 61 groups took about 25 s (detection: 60 ms). Each limit
  change re-runs it in the preview.
- **A WASM trap**: on the peg-perego tester part (Mesh to Solid) with large
  limits, OCCT's defeaturing trapped (`unreachable`) on a single torus face
  (r 2), which stops the kernel until it restarts. Remove Faces on that face
  traps the same way: a facade follow-up, not catchable in TypeScript.
- On Mesh to Solid bodies, slivers between planar regions (0.02–0.13 mm)
  are found as chamfers and mostly can't be removed; a faceted rim is found
  as one 44-face chamfer that takes OCCT about 86 s to refuse (the track
  tester part). Exact STEP and f3d bodies are the target; a minimum chamfer
  size or a face-count cap would be guesses.
- A thin plate with both edges of a side chamfered can leave a side strip
  narrower than the chamfers: the strip is then taken as the chamfer and
  the chamfers stay. Geometry alone can't tell these apart.
- Tooltip clip still to record (`DEMO_CLIPS_PENDING`).
- No pick in the view to keep one found round or hole: a follow-up (an
  "except" list of faces by name).
