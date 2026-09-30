# ADR-0046: Shell

- **Status:** Accepted, 2026-09-30
- **Task:** P3-03 (shell; FR-FT-06, FR-UX-06). Code: the facade's `shell`
  and its helpers (`packages/kernel/occt/facade/extrudo_facade.cpp`);
  `Kernel.shell`, `ShellError`, `ShellProblem` (`packages/kernel/src/kernel.ts`);
  the definition `packages/core/src/shell.ts`; the evaluator and the naming
  `packages/kernel/src/features/shell.ts`; the dialog
  `apps/web/src/features/shell.ts`; the file format, `docs/file-format.md` 6.14.
- **Builds on:** ADR-0038 and ADR-0043 (facade features with a diagnosis:
  bisection through `largestThatWorks`, messages worded in the evaluator),
  ADR-0001 (the facade owns OCCT memory), ADR-0005 (names), ADR-0027 (dialog
  fields), ADR-0033 (`LostReferenceError`), ADR-0030 (bodies).
- **Affects:** P3-04 hole and P3-08 (anything else that offsets or refuses a
  face next to a tangent neighbour), P3-14 (B4/B5 shell steps).

## Context

FR-FT-06: remove faces, thickness inside or outside. The toolbar had a Shell
tile marked "comes with P3-03". OCCT offers `BRepOffsetAPI_MakeThickSolid`
(`MakeThickSolidByJoin`): the solid, the faces to remove, a signed offset
(negative goes into the material), a tolerance and a join type.

Facts about OCCT 8.0.1 (read in `BRepOffset_MakeOffset.cxx`, then run in the
native harness on the pinned image):

- **With no face to remove, `MakeThickSolid` doesn't make a solid.** It
  returns the offset *skin* only (a shell). A hollow closed solid is the
  original's shell plus the skin, one of them reversed, put into a solid by
  hand.
- History of the builder: every face that stays is *kept* (the same TShape is
  in the result) and *generates* its offset face; a removed face is
  *modified* into the rim around the opening (its `Modified` is the closing
  face's image); an edge or a vertex generates the pipe or sphere that joins
  two offsets where they diverge (outside on convex, inside on concave
  edges, with the default `GeomAbs_Arc` join). Removing nothing reports the
  same without a rim.
- **OCCT "succeeds" with junk.** A 12 mm wall on a cylinder of radius 10
  gives a valid solid, positive volume, smaller than the original: the
  cylinder's offset surface has turned inside out (radius −2 becomes 2 on the
  far side of the axis). `BRepCheck_Analyzer` and the volume can't tell. The
  distance between the offset faces and the faces they were offset from can:
  it is exactly the thickness (to 1e-6) in every good result of the harness
  and 8 mm for that one.
- **Removing a face that runs smoothly into a neighbour** (the sides of a
  box whose edges are all filleted, a face next to a fillet) makes
  `BRepOffset_Tool::ExtentFace` corrupt the WASM heap inside
  `Approx_SameParameter`: a `RuntimeError: memory access out of bounds` from
  a later `malloc`, not an exception, sometimes several calls after. A
  removed *planar* face of a filleted box, or a removed sphere face, both did
  it; a shell with **no** removed face of the same body is fine, and so is
  removing a face whose neighbours are all at a crease.
- OCCT gives "done, unchanged" (the input again, `NbOF == NbF`) for some
  removed faces of an L-shaped body next to the concave edge; that is a
  failure for us.

## Decision

1. **One facade call.** `shell(shape, thickness, outside)` takes the faces
   to remove staged with `pushArg` (none: closed hollow), the thickness in mm
   (> 0) and the side. Inward is `−thickness`, outward `+thickness`, tolerance
   1e-3, join `GeomAbs_Arc` (true offset walls: rounded where the offsets
   diverge). The builder is on the C++ stack, history is recorded for input 0
   by the existing `recordHistory`. Every build, and every probe of the
   diagnosis, works on a fresh `BRepBuilderAPI_Copy` of the body (OCCT's
   offset repairs its input in place: tolerances, curves through
   `SameParameter`, which would change the cached body every preview builds
   on). A copy keeps the sub-shape order, which is checked by face count.
2. **A result is good when it passes four tests:** a solid inside the
   result, `BRepCheck_Analyzer`, a positive volume (below the original's
   when going inward), and **the minimum distance between the offset faces
   and the kept originals is at least 0.999 × the thickness − 1 µm**
   (`BRepExtrema_DistShapeShape` of two compounds, one call). The last test
   catches the inside-out cylinder; it costs a few milliseconds.
3. **Refuse before OCCT runs:** a removed face whose edges meet a neighbour
   at normals agreeing within 2° (`touchesTangentFace`, the normals at each
   edge's middle through the pcurve) is not tried at all, because the attempt
   corrupts the heap. The message says which face and why. All faces removed
   and a non-solid are refused too.
4. **Diagnosis.** After a failed build the facade bisects the thickness with
   `largestThatWorks` (7 steps, on fresh copies, about 80 ms for a box) and
   returns `[status, value]` in `geometryNumbers`: 1 too thick (the largest
   thickness that works), 2 no thickness works (OCCT can't offset this,
   typically fillets or tangent surfaces), 3 every face removed, 4 not a
   solid, 5 anything else, 6 a removed face is tangent to its neighbour (its
   index). `Kernel.shell` throws `ShellError` with `ShellProblem`s.
5. **Messages** are worded in the evaluator, faces counted from 1, the
   maximum rounded down to two digits so it works (the same floor as
   fillet's):
   - "A 12 mm wall is too thick for this body (max ≈ 9.9 mm). Try a thinner
     wall."
   - "Face 3 can't be removed: it runs smoothly into the faces next to it (a
     fillet or another tangent face), so there is no edge to open the wall
     at. Pick a flat face that meets its neighbours at an edge, or shell
     before rounding the edges."
   - "The walls can't be built with those faces removed, at any thickness.
     Fillets and curved faces that run into each other often stop this: try
     removing a flat face, or shell before rounding the edges."
   - "Every face of the body is picked for removal, so no walls would be
     left. Pick fewer faces."
6. **Inputs:** `faces` (refs of kind `face`, optional), `bodies` (refs of
   kind `body`, optional), `thickness` (length, required) and `direction`
   (`inside` default, `outside`). Faces of several bodies shell each body on
   its own (the evaluator groups them by body like fillet does); `bodies`
   adds bodies hollowed closed, and it is the way to hollow a body when no
   face is picked, so at least a face or a body is needed.
7. **Names: the outer skin keeps the original names** (`nameShell`, on
   `deriveNames`, the rules of ADR-0005): inside, the kept faces are the
   outside and keep their names, the offset faces are the cavity
   `shell:<id>:inner:(<face>)`; outside, the offset faces are the outside and
   take the original names, the originals become the cavity
   `shell:<id>:inner:(<face>)`. The rim around an opening is
   `shell:<id>:rim:(<removed face>)`, a rounded join `shell:<id>:round:(<edge
   or vertex>)`. So a later reference to "the top face" or "the front face"
   survives a change of direction and of thickness (tested), and only the
   cavity's names depend on the direction.
8. **The dialog** (`apps/web/src/features/shell.ts`) has Faces to remove
   (optional), Body (shown while no face is picked, or once a body is: a body
   selected before Shell fills it), Thickness (default 2 mm) and Direction.
   No on-canvas handle yet. The tool is the Modify group's Shell tile; **it
   has no default key** (Fusion has none either); it is in Ctrl+K and the
   toolbox like every command.
9. **Memory:** `memory.test.ts` runs 1000 rounds of shells inside, outside
   and closed, a filleted body hollowed closed, a wall too thick with its
   probing, all faces removed and a cylinder's wall, and expects a flat heap
   and no leftover shapes; a control (300 shells kept and meshed show as 300
   live shapes) sits last in the file, after the chamfer one.

## Rejected

- **`MakeThickSolidBySimple`.** Its own documentation says it can't remove
  faces and computes no intersections; its result for a closed solid is a
  bare skin too.
- **`BRepOffsetAPI_MakeOffsetShape` plus a boolean cut** (offset the solid,
  subtract from the original). It would make the closed hollow trivially and
  work for the openings by cutting the opening's prism, but the history
  would come from two operations, the rim would have no face to be named
  after, and the cuts fail differently. `MakeThickSolid` gives the rim and
  the history in one.
- **`GeomAbs_Intersection` as the join** (sharp inner corners). It leaves
  walls thicker than asked at concave edges and is slower to fail. A "sharp
  or round corners" choice is a small later addition.
- **Trying tangent faces and catching the failure.** The failure is a wasm
  trap, not an exception: the worker would crash and restart on every
  keystroke of a preview. Refusing first is the only safe way with this build.
- **Judging a result by validity and volume alone.** The inside-out cylinder
  passes both (see above).
- **Different thickness per face.** `BRepOffset_MakeOffset::SetOffsetOnFace`
  exists, but the requirement names one thickness and the dialog would need
  a set per thickness, as fillet has for radii. Later, if asked.
- **Naming the offset faces after the removed face** (`shell:<id>:inner:<n>`,
  numbered). References to a face survive a thickness change only if the name
  comes from the source face, and the numbers would reorder.

## Consequences

- The facade has a new method: the OCCT input hash is recorded in the
  changelog once CI has built it. P3-06 (transform) adds another method in
  the same file; merge them one at a time and rebuild on the combined inputs.
- The Shell tile is enabled, so the shell screenshots (dark and light) were
  regenerated.
- A shell's Thickness is a model parameter like any other (`wall / 2` works
  and updates with it).
- A shell needs a wall ≤ half of the thinnest section; a body with a very
  thin feature reports the maximum found by bisection, which is the truth for
  that body ("max ≈ 0.4 mm").
- Removing a face next to a fillet is refused, which is a real limit for
  designs that round first and shell after: the message says to shell first.
  A workaround inside the kernel (unify or extend the neighbours) is a topic
  for a later task, and a wall-thickness shell with **inside** direction on a
  fully rounded body works when no face is removed.
- Shelling a body twice works (the cavity's faces are ordinary faces), and a
  sealed void is a legitimate result the slicers accept; a warning about
  trapped resin or powder is P3-10's (3D-print aids) business.
