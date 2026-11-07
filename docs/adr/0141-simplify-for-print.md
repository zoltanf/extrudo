# ADR-0141: Simplify for Print (small rounds and holes removed at once)

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
dozens of small fillets and holes a print doesn't need; picking each is
slow, and one failure refuses the whole pick (all or nothing, by design).

Everything detection needs is already in the kernel: a face's surface
(`surfaceGeometry`: type, radius, a torus's minor radius), whether a
cylinder is a hole's wall and goes all the way round (`threadFace`'s
`inside`, `whole`), a face's smooth chain (`tangentFaces`), and the hole
rule of Remove Faces' picks (`removeFacesPick`: a wall with its floor,
counterbore, countersink, drill point).

## Decision

1. **A feature `simplifyForPrint`** (`packages/core/src/simplify-for-print.ts`,
   label **Simplify for Print**, category `modify`, icon
   `simplify-for-print`; tool in **Make › Prepare**, category `export`).
   Inputs: `bodies` (`refsOf(['body'])`), `rounds` (bool) with
   `maxRoundRadius` (length expr), `holes` (bool) with `maxHoleDiameter`
   (length expr). A kind is on while its limit is given and its toggle isn't
   false (`simplifyKinds`); neither on is an error ("Turn on rounds or holes
   (or both) to simplify."); a limit ≤ 0 is an error. **The feature stores
   no faces**: the kernel finds the rounds and holes on every recompute, so
   a changed limit or an upstream edit finds them again, and there is no
   face reference to lose. Helpers: `simplifyForPrintInputs(bodies,
   options)`, `simplifyForPrintFeatureOf(id, name, bodies, options)`.
2. **Detection** (`findSimplifyGroups`, pure, in
   `packages/kernel/src/features/simplify-for-print.ts`; the surface and
   chain come from `kernelSimplifySurface` and `tangentFaces`):
   - **Holes**: a hole wall is an inside cylinder all the way round, or a
     **ring** of inside cylinder pieces on one axis with one radius whose
     shared edges close the ring (n pieces, ≥ n shared edges: imports often
     split a wall in halves). Each wall takes the faces `removeFacesPick`'s
     hole rule takes (ring pieces count as whole there). The hole's size is
     **twice the widest inside cylinder's radius** among its faces, so a
     counterbore counts by its counterbore; over the limit, the whole hole
     stays (never a part of it). Ring pieces are never rounds.
   - **Rounds**: candidates are cylinder faces **not** all the way round,
     torus faces (by their minor radius) and sphere faces (corner blends),
     with the radius at most the limit, not in a hole, and with a smooth
     chain of more than the face itself (a face with no tangent neighbour is
     no round). A round is a connected run of candidates across shared edges
     where one is in the other's chain. Its size is its largest radius.
     Cones are never rounds (a chamfer is not a round).
   - A group of every face of the body is skipped. No face is in two groups.
     Groups come rounds first, then holes.
3. **Removal**, per body: **all groups in one `removeFaces`** first (one
   defeaturing, the common case). When that throws `RemoveFacesError`,
   **each group on its own**, in order, on the shape the ones before left;
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
   hole: `kind`, `body`, `size` (radius or diameter, mm), `faces` (count),
   `removed`. The recomputer puts it on `FeatureStatus.simplify` and on the
   preview (`Preview.simplify` → `DialogContext.draftSimplify`), as Mesh to
   Solid's. Warnings: nothing found ("No rounds or holes under the limits:
   nothing changed."), some failed ("N of the M rounds and holes found
   couldn't be removed; the rest are."), all failed. A warning, not an
   error: the bodies the removals left are still the result.
5. **Preview**: one preview tool, a compound of the removed groups' faces of
   the input body, style `cut` (red, drawn through the bodies), so the view
   shows **the faces that go** rather than the simplified body. Failed
   groups aren't drawn; the dialog lists them.
6. **Dialog** (`apps/web/src/features/simplify-for-print.ts`): Bodies;
   Rounds toggle + Max radius (default 1 mm); Holes toggle + Max diameter
   (default 3 mm); a hidden limit makes no input (the framework's default
   mapping). The Found line is `simplifySummary` ("12 rounds, 3 holes",
   "· 2 couldn't be removed"); under it, the info field's new **`lines`**
   (`InfoField.lines`, a small list) gives one `simplifyGroupLine` per group
   ("Hole Ø3 mm, 2 faces: removed"), what stayed first, at most 8 and "and N
   more".

## Rejected

- **Storing the found faces** (as Remove Faces does): the feature would be
  a Remove Faces with a picker, and a changed limit or an upstream edit would
  need a re-pick. Finding them in the kernel keeps it parametric.
- **One at a time always**: N defeaturings per recompute and preview; the
  all-at-once first pass is one in the usual case.
- **Retrying the all-at-once pass without the faces `RemoveFacesError`
  names**: OCCT's list is not always complete, and a second failure needs the
  one-at-a-time pass anyway.
- **A facade query for detection**: the existing queries are enough, and a
  new one would need a new OCCT WASM build.
- **Treating a whole outside cylinder (a pin) as a round**: it blends nothing.

## Consequences and follow-ups

- A slot's round end or a half-hole on a body's edge is a round by this
  rule; the limit decides, as in other tools of the kind.
- A hole whose mouth is rounded: the mouth's torus is a round (under the
  round limit) and goes first, then the hole. Over the round limit the hole
  usually fails and is listed. Merging a coaxial mouth round into its hole
  is a follow-up.
- Tooltip clip still to record (`DEMO_CLIPS_PENDING`).
- No pick in the view to keep one found round or hole: a follow-up (an
  "except" list of faces by name).
