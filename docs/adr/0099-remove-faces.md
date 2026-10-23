# ADR-0099: Remove Faces (defeaturing)

- **Status:** Accepted, 2026-10-23
- **Issue:** #78, tester feedback (2026-10-18): "something simple that allows
  to remove fillets or holes on one click". Also the `.f3d` import's face
  deletions (#93: 28 in the issue's second file), left out until now
  (ADR-0083's amendment of 2026-10-22).
- **Builds on:** ADR-0005 (topological naming), ADR-0030 (Remove, the body
  feature), ADR-0051 (Offset Face; its amendment's `BRepAlgoAPI_Defeaturing`
  of kept rounds), ADR-0068 (the document API), ADR-0083 (`.f3d` import).
- **No schema or file-format change**: a new feature type with a plain `ref`
  input.

## Context

A fillet or a hole made in Extrudo goes away by deleting its feature. An
imported body (STEP, `.f3d` file bodies, 3MF) has no feature to delete, and
neither has a round or hole that an earlier boolean or pattern produced. The
source app of the `.f3d` format has a step for this ("delete face"), and
files use it: the issue's bumper has 28 of them, which the import leaves out,
so its replayed body keeps material the file's has not.

OCCT has the operation: `BRepAlgoAPI_Defeaturing` removes faces from a solid
and extends or trims their neighbours until they meet, with a history. The
facade already uses it inside Offset Face (`buildReblendedOffset`). The app
already picks a round's smooth chain (`tangentFaces`) and tells a hole's wall
from a shaft (`threadFace`'s and `coneFace`'s `inside`).

## Decision

1. **A feature `removeFaces`** (`packages/core/src/remove-faces.ts`, label
   **Remove Faces**, category `modify`, icon `remove-faces`) with one input,
   `faces` (`refsOf(['face'])`, at least one face, of one or several bodies).
   Helpers as Offset Face has them: `removeFacesInputs(faces)` and
   `removeFacesFeatureOf(id, name, faces)`. The kernel's evaluator
   (`packages/kernel/src/features/remove-faces.ts`, `bodyAccess: 'write'`)
   resolves the faces by name (`ctx.resolve`, label "a face to remove"),
   groups them by body and removes them body by body. A face that can't be
   found is a `LostReferenceError`, as everywhere.
2. **Facade `removeFaces(shape)`** with the faces passed through `pushArg`
   (0-based indices, as `offsetFaces` takes them): `BRepAlgoAPI_Defeaturing`
   on the shape, `SetToFillHistory(true)`, `SetRunParallel(false)`, every
   picked face added, `Build()`. The result must be done, have no warnings
   (any `BOPAlgo_AlertUnableToRemoveTheFeature` refuses the whole step:
   **all or nothing**, never part of the pick), be one valid solid
   (`BRepCheck_Analyzer`) and differ from the input. No `UnifySameDomain`
   afterwards: it would rename faces. The builder lives on the stack and
   every shape it made but doesn't return is released, as in the other
   facade methods. The history is the builder's own: picked faces deleted,
   neighbours modified. `Kernel.removeFaces(shape, faces)` wraps it and
   returns an `OperationResult` (history input 0), or throws a
   `RemoveFacesError` whose `failed` lists the picked faces (indices) of the
   feature OCCT could not remove.
3. **Names** (ADR-0005): the removed faces' names are gone, so a later
   feature that referred to one of them gets a `LostReferenceError` (Fix
   References), like a face a cut swallowed. **An extended or trimmed
   neighbour keeps its name** (the history's `modified`), so a fillet on
   "the top face" still finds it after the hole in it was removed. New
   edges where the extended neighbours meet get names from their two faces,
   as for any other operation (`withHistory`, op `removeFaces`).
4. **A refusal names what to add** (FR-UX-06). When OCCT can't close the
   gap, the message says which faces were the trouble and what usually
   helps: "Remove Faces can't close the gap these 2 faces leave. Pick the
   rest of the round too (3 more faces run smoothly on from them), or fewer
   faces." The kernel works the count out from the failed faces' smooth
   chains and hole groups (5) that are not picked; with none, the message
   says "The faces around them can't be extended to meet. Pick fewer
   faces, or the whole round or hole." A pick that is every face of a body,
   or leaves nothing, is refused before OCCT runs ("That would remove the
   whole body. Use Remove on the body instead.").
5. **Picks: one click takes a round or a hole** (`removeFacesPick` in the
   kernel, `packages/kernel/src/features/remove-faces.ts`, through the
   engine and `KernelApi` like `smoothFaces`), from the shape's description
   and the existing queries, no new facade query:
   - **A hole's wall** (`threadFace(…).inside` and `whole`, or
     `coneFace(…).inside` going all the way round): the hole, grown from
     the wall across shared edges into every face that is (a) a cylinder,
     cone or torus coaxial with the wall (axis directions parallel within
     1e-6, axis lines within 1e-4 mm), or (b) a plane perpendicular to the
     axis; and, for both, whose edge midpoints and vertices all lie within
     the largest radius found so far (+1e-4 mm) of the axis. An inside
     cylinder or cone added raises that radius to its own largest distance
     from the axis. So a counterbore's step, a countersink, a drill point
     and a blind hole's bottom come along; the face the hole opens onto
     doesn't (its outer boundary lies further out).
   - **A round** (a non-planar face that isn't a hole wall): its smooth
     chain (`tangentFaces`) walked across shared edges through non-planar
     faces only, so a click on one fillet face takes the whole fillet run
     but not the flat faces it blends.
   - **Anything else** (a plane, a shaft's outside wall): the face alone.
   The dialog's face field and Delete (7) use this; the feature stores the
   faces it got, so later edits to the pick rule don't change saved
   features.
6. **The dialog** (Solid › Modify › Remove Faces, after Offset Face; search
   finds it by "defeature", "delete face", "remove fillet", "remove hole",
   "simplify"): one face field ("Faces", multi-pick, the pick rule of 5), an
   info line "N faces" and a live preview like the other modify dialogs.
   The feature's tooltip clip, guide page and tool page come with it
   (docs/assets.md, `pnpm docs:generate`).
7. **Delete on a selection of faces makes the feature in one step**, as
   Delete on bodies makes a Remove (ADR-0030): only faces of solid bodies,
   outside sketch mode, the selection taken through the pick rule (5), one
   undo step, named `Remove Faces N`. A selection that mixes faces with
   other things keeps doing what Delete does today.
8. **`.f3d` face deletions map to `removeFaces`** (ADR-0083, a later slice
   on its own branch): the record's face operands go through the importer's
   face naming like a fillet's or an offset's, and a deletion whose faces
   can't all be named is left out with that reason. Its numbers go into
   ADR-0083's next amendment.
9. **The document API and MCP** get the feature through `pnpm
   api:generate` (ADR-0068); `faces` has a `.describe()`. No face roles: the
   feature makes no body.

## Rejected

- **Keeping what OCCT could remove and skipping the rest.** A feature whose
  result depends on which faces happen to fail can't be reasoned about, and
  a later edit upstream could silently change what it removes. All or
  nothing, with a message that says what to add, is predictable.
- **Healing the gap ourselves** (removing faces and filling the hole with a
  new surface): that is a different feature (patching an open shell), not
  defeaturing; the neighbours meeting each other is what people expect.
- **A unify after the removal** to merge faces that became coplanar: it
  renames faces and breaks references; a later feature can still pick the
  face pieces.
- **A new facade query for hole faces**: the shape description (edge
  midpoints, vertices, face types) and `threadFace` / `coneFace` already say
  enough, and the pick runs in TypeScript where it can be tested without
  WASM changes.
- **Removing a hole by picking only its wall and letting OCCT find the
  rest**: Defeaturing removes exactly the faces it gets; leaving a hole's
  bottom in place makes the removal fail. The pick rule collects them.

## Consequences

- Rounds and holes of imported bodies can be removed in two clicks, and the
  `.f3d` import can replay face deletions once slice 8 lands.
- One facade method more (an OCCT rebuild through CI).
- A face pick that crosses bodies removes per body; a failure in one body
  fails the step and keeps every body as it was.
- Simplify for print (#79: every small round and hole at once) can build on
  this feature and the pick rule.

## Amendment (2026-10-23, the kernel slice): the hole's radius

Decision 5's hole rule, read literally, grows the radius only as walls are
added one by one, so a click on a counterbore's narrow wall or a
countersunk hole's cylinder stops at the step or the cone (its outer edge
lies past the narrow wall's radius, and the wide wall or the cone is
reached only through it). The kernel slice reads it in two passes instead:
first the faces connected to the clicked wall across shared edges that are
on its axis (a coaxial cylinder, cone or torus, a plane square to the axis:
the tolerances of 5), then **the hole's radius is the largest distance from
the axis of an inside cylinder or cone among them**, and the pick is the
faces of that set within the radius (+1e-4 mm) that are still connected to
the wall. The face the hole opens onto stays out (its outer edges lie
further out); a click on any wall of a stepped hole takes the whole hole.
A hole drilled into the floor of a coaxial round pocket is read as a
counterbore (the two can't be told apart from the geometry).
"Inside" and "all the way round" come from `threadFace`, which answers for
cones too; the axis from the surface's geometry (`surfaceGeometry`).

A refusal for one failed face says "this face leaves" rather than "these 1
faces leave".
